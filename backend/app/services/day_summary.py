"""Итоги дня кассы (решение владельца 02.10: админы перестают вести Excel и
пересчитывать недельную скидку вручную — пользуются только сайтом).

ОДНА функция compute_day_summary считает все цифры дня на сервере. Её зовут и
экран «Итоги дня» в кассе (GET /cashbox/day-summary, компьютер и телефон), и
ежедневная сводка в Telegram (telegram.daily_summary_endpoint) — цифры везде
одни и те же. ТОЛЬКО ЧТЕНИЕ: ничего не пишет и деньги не пересчитывает.

День — календарный по Тбилиси (UTC+4, без летнего времени). Время в базе —
наивное UTC (дата операции кассы `date`, `created_at` ленты баланса, смены),
поэтому день D — это [D−1 20:00, D 20:00) по UTC. Дата брони (`Booking.date`) —
уже календарный день по Тбилиси (полночь), её сравниваем как есть.

По филиалу:
  • «Пришло» — реальные деньги: наличные / TBC / BOG. Тот же набор операций,
    что в журнале кассы за день, но без корректировок:
      – payment_method='adjustment' (недельная скидка, правка баланса клиента —
        запись для истории, денег в кассе нет);
      – category_id='cash_reconciliation' — «корректировка при закрытии смены»,
        показываем отдельной строкой «расхождение смены»;
      – «[КОРРЕКЦИЯ …]» — корректировка остатка из меню кассы, тоже отдельно.
    Пришло + расхождение смены + корректировка остатка = приходы журнала.
  • «Ушло» — расходы по тем же счетам с теми же исключениями.
  • «Списано с балансов клиентов» — по ленте баланса (booking_charge и всё,
    что его правит: перенос, смена цены, допы, продление, откат) за брони ЭТОГО
    дня; филиал — по кабинету брони. Возвраты за эти брони — отдельно.
  • «Смена» — открытия и закрытия за день: ожидалось / по факту / расхождение.
Общее для всех филиалов (у клиента нет филиала):
  • недельные скидки, начисленные в этот день;
  • «Должны на конец дня» — клиенты с балансом ниже нуля на конец дня.
"""
from __future__ import annotations

from collections import defaultdict
from html import escape
from datetime import date, datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, desc, select

from app.models.balance_ledger import BalanceLedger
from app.models.booking import Booking
from app.models.cashbox_transaction import CashboxTransaction
from app.models.location import Location
from app.models.shift_open_log import ShiftOpenLog
from app.models.shift_report import ShiftReport
from app.models.user import User
from app.models.weekly_rebate import WeeklyRebate

TZ = timedelta(hours=4)  # Тбилиси, без перехода на летнее время

# Счета с настоящими деньгами — как в остатках кассы (/cashbox/balance).
MONEY_METHODS = ("cash", "card_tbc", "card_bog")
# Корректировка — не деньги (недельная скидка, ручная правка баланса клиента).
NON_MONEY_METHOD = "adjustment"
# «Корректировка при закрытии смены» (выравнивание кассы под пересчёт).
SHIFT_RECON_CATEGORY = "cash_reconciliation"
# «Корректировка остатка» из меню кассы (/cashbox/balance-correction) —
# пишется с настоящим счётом, отличаем по началу описания.
BALANCE_FIX_PREFIX = "[КОРРЕКЦИЯ"
# Филиалы кассы (owner 2026-07-22). Остальные (Neo School, «без филиала»)
# показываем, только если в этот день по ним что-то было.
CASH_BRANCHES = ("Unbox One", "Unbox Uni")

# Возвраты за бронь — отдельной строкой. Всё остальное по брони (списание,
# откат «горячей» брони, перенос, смена цены/формата, допы, продление, перевод
# на абонемент) — это и есть «списано за бронь», со знаком.
REFUND_REASONS = frozenset({
    "booking_refund", "double_charge_refund", "trim_refund", "shorten_refund", "extras_refund",
})

# Списание «при создании брони» пишется в ленту без номера брони (ref_id пустой).
# Запись и бронь создаются одним запросом — узнаём бронь по клиенту и времени.
UNLINKED_MATCH_SECONDS = 10

EPS = 0.005


# ── Дни и недели по Тбилиси ──────────────────────────────────────────────

def tbilisi_today(now_utc: Optional[datetime] = None) -> date:
    """Сегодняшний календарный день по Тбилиси."""
    return ((now_utc or datetime.utcnow()) + TZ).date()


def day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """Границы дня по Тбилиси в наивном UTC: [D−1 20:00, D 20:00)."""
    start = datetime(day.year, day.month, day.day) - TZ
    return start, start + timedelta(days=1)


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def last_monday_start_utc(now_utc: Optional[datetime] = None) -> datetime:
    """Полночь последнего понедельника по Тбилиси (сегодняшнего, если сегодня
    понедельник) — в наивном UTC."""
    return day_bounds_utc(monday_of(tbilisi_today(now_utc)))[0]


def recent_weekly_rebates(
    session: Session, now_utc: Optional[datetime] = None, user_id: Optional[str] = None,
) -> list[BalanceLedger]:
    """Недельные скидки из ленты баланса (reason='weekly_rebate'), начисленные с
    последнего понедельника по Тбилиси, — свежие сверху.

    Одно правило «скидка этой недели» для «Сегодня» (метка у клиента) и для
    попапа брони (estimate_booking_rebate.last_rebate). Начисляет их крон в
    понедельник 05:00 по Тбилиси; кнопка в кассе — в любой день после.
    """
    stmt = select(BalanceLedger).where(
        BalanceLedger.reason == "weekly_rebate",
        BalanceLedger.created_at >= last_monday_start_utc(now_utc),
    )
    if user_id:
        stmt = stmt.where(BalanceLedger.user_id == str(user_id))
    return list(session.exec(stmt.order_by(desc(BalanceLedger.created_at))).all())


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _r(x: float) -> float:
    return round(float(x or 0.0), 2)


# ── Касса ────────────────────────────────────────────────────────────────

def tx_kind(tx: CashboxTransaction) -> str:
    """money | adjustment | shift_recon | balance_fix — куда операция идёт в итогах."""
    if (tx.payment_method or "") == NON_MONEY_METHOD:
        return "adjustment"
    if tx.category_id == SHIFT_RECON_CATEGORY:
        return "shift_recon"
    if (tx.description or "").startswith(BALANCE_FIX_PREFIX):
        return "balance_fix"
    return "money"


def _money_bucket() -> dict:
    return {"cash": 0.0, "card_tbc": 0.0, "card_bog": 0.0, "total": 0.0, "count": 0}


def _new_block(branch: Optional[str]) -> dict:
    return {
        "branch": branch,
        "income": _money_bucket(),    # «Пришло за день»
        "expense": _money_bucket(),   # «Ушло»
        # Уже есть в журнале, но не «пришло/ушло» — отдельными строками.
        "shift_recon": {"income": 0.0, "expense": 0.0, "net": 0.0, "count": 0},
        "balance_fix": {"income": 0.0, "expense": 0.0, "net": 0.0, "count": 0},
        # «Списано с балансов клиентов» за брони этого дня.
        "charges": {"charged": 0.0, "refunded": 0.0, "net": 0.0, "bookings": 0},
        "shift": None,
    }


def _add_money(bucket: dict, method: str, amount: float) -> None:
    if method in MONEY_METHODS:
        bucket[method] += amount
    bucket["total"] += amount
    bucket["count"] += 1


# ── Брони дня и лента баланса ────────────────────────────────────────────

def _user_key(b: Booking) -> Optional[str]:
    return str(b.user_uuid) if b.user_uuid else None


def _attach_unlinked(session: Session, day_bookings: list[Booking]) -> dict[str, list[BalanceLedger]]:
    """Записи ленты «при создании брони» без номера брони → к какой брони дня.

    Кандидаты — ВСЕ брони того же клиента, созданные в пределах
    UNLINKED_MATCH_SECONDS от записи (не только брони этого дня: запись могла
    относиться к брони на другой день). Берём совпадение по сумме, иначе
    ближайшую по времени. Возвращаем только то, что легло на брони этого дня.
    """
    mine: dict[str, list[Booking]] = defaultdict(list)
    for b in day_bookings:
        if _user_key(b) and b.created_at:
            mine[_user_key(b)].append(b)
    if not mine:
        return {}
    created = [b.created_at for lst in mine.values() for b in lst]
    gap = timedelta(seconds=UNLINKED_MATCH_SECONDS)
    rows = session.exec(
        select(BalanceLedger).where(
            BalanceLedger.ref_type == "booking",
            col(BalanceLedger.ref_id).is_(None),
            col(BalanceLedger.user_id).in_(list(mine)),
            BalanceLedger.created_at >= min(created) - gap,
            BalanceLedger.created_at <= max(created) + gap,
        )
    ).all()
    day_ids = {str(b.id) for b in day_bookings}
    out: dict[str, list[BalanceLedger]] = defaultdict(list)
    for r in rows:
        near = [b for b in mine.get(r.user_id, [])
                if abs((b.created_at - r.created_at).total_seconds()) <= UNLINKED_MATCH_SECONDS]
        if not near:
            continue
        try:
            uid = UUID(str(r.user_id))
        except ValueError:
            continue
        cands = session.exec(
            select(Booking).where(
                Booking.user_uuid == uid,
                Booking.created_at >= r.created_at - gap,
                Booking.created_at <= r.created_at + gap,
            )
        ).all()
        best, best_key = None, None
        for b in cands:
            price_miss = abs(abs(float(r.delta or 0)) - float(b.final_price or 0)) > 0.01
            key = (price_miss, abs((b.created_at - r.created_at).total_seconds()))
            if best_key is None or key < best_key:
                best, best_key = b, key
        if best is not None and str(best.id) in day_ids:
            out[str(best.id)].append(r)
    return out


def _booking_charges(session: Session, day: date, loc_names: dict[str, str]) -> dict[str, dict]:
    """Списано с балансов за брони дня — по филиалу брони."""
    d0 = datetime(day.year, day.month, day.day)
    bookings = session.exec(
        select(Booking).where(Booking.date >= d0, Booking.date < d0 + timedelta(days=1))
    ).all()
    if not bookings:
        return {}
    by_id = {str(b.id): b for b in bookings}
    entries: dict[str, list[BalanceLedger]] = defaultdict(list)
    for r in session.exec(
        select(BalanceLedger).where(
            BalanceLedger.ref_type == "booking",
            col(BalanceLedger.ref_id).in_(list(by_id)),
        )
    ).all():
        entries[r.ref_id].append(r)
    for bid, rows in _attach_unlinked(session, list(bookings)).items():
        entries[bid].extend(rows)

    out: dict[str, dict] = {}
    for bid, rows in entries.items():
        b = by_id[bid]
        branch = loc_names.get(b.location_id, b.location_id)
        acc = out.setdefault(branch, {"charged": 0.0, "refunded": 0.0, "bookings": 0})
        charged = 0.0
        for r in rows:
            if r.reason in REFUND_REASONS:
                acc["refunded"] += float(r.delta or 0)
            else:
                charged -= float(r.delta or 0)
        acc["charged"] += charged
        if charged > EPS:
            acc["bookings"] += 1
    return out


# ── Смена ────────────────────────────────────────────────────────────────

def _shift_info(session: Session, branch: str, start: datetime, end: datetime) -> dict:
    """Смена филиала за день: открыта/закрыта, ожидалось / по факту / расхождение.

    Состояние — на конец дня (для сегодняшнего дня это «сейчас»): последнее
    открытие против последнего закрытия этого филиала или общего (branch NULL
    закрывает все филиалы — как в /shifts/pending-close). Цифры «ожидалось /
    по факту» — только у закрытия этого филиала: у общего они по всей кассе.
    """
    closes_cond = (ShiftReport.branch == branch) | (col(ShiftReport.branch).is_(None))
    opens = session.exec(
        select(ShiftOpenLog).where(
            ShiftOpenLog.branch == branch, ShiftOpenLog.opened_at >= start, ShiftOpenLog.opened_at < end,
        ).order_by(ShiftOpenLog.opened_at)
    ).all()
    closes = session.exec(
        select(ShiftReport).where(closes_cond, ShiftReport.shift_end >= start, ShiftReport.shift_end < end)
        .order_by(ShiftReport.shift_end)
    ).all()
    last_open = session.exec(
        select(ShiftOpenLog).where(ShiftOpenLog.branch == branch, ShiftOpenLog.opened_at < end)
        .order_by(desc(ShiftOpenLog.opened_at)).limit(1)
    ).first()
    last_close = session.exec(
        select(ShiftReport).where(closes_cond, ShiftReport.shift_end < end)
        .order_by(desc(ShiftReport.shift_end)).limit(1)
    ).first()
    is_open = last_open is not None and (last_close is None or last_close.shift_end < last_open.opened_at)
    # Закрытие этого филиала важнее общего: у него свои «ожидалось / по факту».
    own_closes = [c for c in closes if c.branch == branch]
    close = own_closes[-1] if own_closes else (closes[-1] if closes else None)
    own = close is not None and close.branch == branch

    # Наличные по записям кассы филиала на конец дня — «должно быть в кассе».
    # Та же сумма, что «ожидалось» при закрытии смены (итог наличных за всё время).
    cash = {}
    for kind in ("income", "expense"):
        cash[kind] = float(session.exec(
            select(func.coalesce(func.sum(CashboxTransaction.amount), 0)).where(
                CashboxTransaction.type == kind, CashboxTransaction.payment_method == "cash",
                CashboxTransaction.branch == branch, CashboxTransaction.date < end,
            )
        ).one() or 0)

    opened = last_open if is_open else (opens[0] if opens else None)
    return {
        "status": "open" if is_open else ("closed" if close else "none"),
        "opened_at": _iso(opened.opened_at) if opened else None,
        "opened_by": (opened.admin_name or None) if opened else None,
        "closed_at": _iso(close.shift_end) if close else None,
        "closed_by": (close.admin_name or None) if close else None,
        # Общее закрытие (по всем филиалам) — цифр по филиалу у него нет.
        "closed_all_branches": bool(close is not None and close.branch is None),
        "expected": _r(close.expected_balance) if own else None,
        "actual": _r(close.actual_balance) if own else None,
        "discrepancy": _r(close.discrepancy) if own else None,
        "closes": len(closes),
        "cash_by_records": _r(cash["income"] - cash["expense"]),
    }


# ── Должники ─────────────────────────────────────────────────────────────

def debtors_at(session: Session, at_utc: datetime, limit: int = 200) -> dict:
    """Клиенты с балансом ниже нуля на момент at_utc (наивное UTC).

    Баланс на момент = текущий баланс − всё, что прошло по ленте после него
    (инвариант ленты: сумма движений = баланс). Для сегодняшнего дня это просто
    текущие балансы. Архивные профили не считаем — как «долг клиентов» в
    аналитике владельца (решение 2026-08-22: это закрытые и склеенные аккаунты).
    """
    after = {
        uid: float(s or 0)
        for uid, s in session.exec(
            select(BalanceLedger.user_id, func.sum(BalanceLedger.delta))
            .where(BalanceLedger.created_at >= at_utc)
            .group_by(BalanceLedger.user_id)
        ).all()
    }
    items = []
    for uid, name, email, balance in session.exec(
        select(User.id, User.name, User.email, User.balance).where(col(User.archived_at).is_(None))
    ).all():
        bal = round(float(balance or 0) - after.get(str(uid), 0.0), 2)
        if bal < -EPS:
            items.append({"user_id": str(uid), "name": name or email, "email": email, "debt": _r(-bal)})
    items.sort(key=lambda x: (-x["debt"], (x["name"] or "").lower()))
    return {
        "count": len(items),
        "amount": _r(sum(x["debt"] for x in items)),
        "items": items[:limit],
        "as_of": _iso(at_utc),
    }


# ── Главная функция ──────────────────────────────────────────────────────

def compute_day_summary(
    session: Session,
    day: date,
    branch: Optional[str] = None,
    *,
    now_utc: Optional[datetime] = None,
    debtors_limit: int = 200,
) -> dict:
    """Итоги дня по Тбилиси. branch=None — все филиалы (по филиалу и «всего»)."""
    start, end = day_bounds_utc(day)
    loc_names = {loc.id: loc.name for loc in session.exec(select(Location)).all()}

    blocks: dict[Optional[str], dict] = {}

    def block(name: Optional[str]) -> dict:
        if name not in blocks:
            blocks[name] = _new_block(name)
        return blocks[name]

    if branch:
        block(branch)
    else:
        for b in CASH_BRANCHES:
            block(b)

    # Касса: операции дня — ровно те, что в журнале за этот день.
    adjustments = {"income": 0.0, "expense": 0.0, "count": 0}
    stmt = select(CashboxTransaction).where(CashboxTransaction.date >= start, CashboxTransaction.date < end)
    if branch:
        stmt = stmt.where(CashboxTransaction.branch == branch)
    for tx in session.exec(stmt).all():
        amount = float(tx.amount or 0)
        kind = tx_kind(tx)
        if kind == "adjustment":
            adjustments[tx.type if tx.type in ("income", "expense") else "expense"] += amount
            adjustments["count"] += 1
            continue
        blk = block(tx.branch or None)
        if kind in ("shift_recon", "balance_fix"):
            part = blk[kind]
            part["income" if tx.type == "income" else "expense"] += amount
            part["count"] += 1
            continue
        _add_money(blk["income"] if tx.type == "income" else blk["expense"], tx.payment_method or "", amount)

    # Списано с балансов за брони этого дня — по филиалу брони.
    for name, ch in _booking_charges(session, day, loc_names).items():
        if branch and name != branch:
            continue
        acc = block(name)["charges"]
        acc["charged"] += ch["charged"]
        acc["refunded"] += ch["refunded"]
        acc["bookings"] += ch["bookings"]

    total = _new_block(None)
    for blk in blocks.values():
        for side in ("income", "expense"):
            for k in ("cash", "card_tbc", "card_bog", "total"):
                blk[side][k] = _r(blk[side][k])
                total[side][k] += blk[side][k]
            total[side]["count"] += blk[side]["count"]
        for part in ("shift_recon", "balance_fix"):
            p = blk[part]
            p["income"], p["expense"] = _r(p["income"]), _r(p["expense"])
            p["net"] = _r(p["income"] - p["expense"])
            for k in ("income", "expense", "count"):
                total[part][k] += p[k]
        ch = blk["charges"]
        ch["charged"], ch["refunded"] = _r(ch["charged"]), _r(ch["refunded"])
        ch["net"] = _r(ch["charged"] - ch["refunded"])
        for k in ("charged", "refunded", "bookings"):
            total["charges"][k] += ch[k]
        # Смена — только у филиалов кассы (у Neo School и «без филиала» смен нет).
        if blk["branch"] in CASH_BRANCHES:
            blk["shift"] = _shift_info(session, blk["branch"], start, end)
    for side in ("income", "expense"):
        for k in ("cash", "card_tbc", "card_bog", "total"):
            total[side][k] = _r(total[side][k])
    for part in ("shift_recon", "balance_fix"):
        p = total[part]
        p["income"], p["expense"] = _r(p["income"]), _r(p["expense"])
        p["net"] = _r(p["income"] - p["expense"])
    total["charges"]["charged"] = _r(total["charges"]["charged"])
    total["charges"]["refunded"] = _r(total["charges"]["refunded"])
    total["charges"]["net"] = _r(total["charges"]["charged"] - total["charges"]["refunded"])
    del total["shift"]
    del total["branch"]

    # Недельные скидки, начисленные в этот день (по понедельникам), — общие.
    rebate_amount, rebate_users = session.exec(
        select(func.coalesce(func.sum(BalanceLedger.delta), 0), func.count(func.distinct(BalanceLedger.user_id)))
        .where(BalanceLedger.reason == "weekly_rebate", BalanceLedger.created_at >= start,
               BalanceLedger.created_at < end)
    ).one()

    # Порядок: филиалы кассы, затем прочие (Neo School), «без филиала» — в конце.
    order = {b: i for i, b in enumerate(CASH_BRANCHES)}
    ordered = sorted(blocks.values(), key=lambda x: (x["branch"] is None, order.get(x["branch"], 99), x["branch"] or ""))

    return {
        "date": day.isoformat(),
        "branch": branch,
        "is_today": day == tbilisi_today(now_utc),
        "branches": ordered,
        "total": total,
        "adjustments": {
            "income": _r(adjustments["income"]),
            "expense": _r(adjustments["expense"]),
            "count": adjustments["count"],
        },
        "weekly_rebates": {"amount": _r(float(rebate_amount or 0)), "count": int(rebate_users or 0)},
        "debtors": debtors_at(session, min(end, now_utc or datetime.utcnow()), limit=debtors_limit),
    }


# ── Ежедневная сводка в Telegram ─────────────────────────────────────────

def _clients_word(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return "клиент"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return "клиента"
    return "клиентов"


def telegram_day_lines(summary: dict) -> list[str]:
    """Строки для ежедневной сводки владельцу: по филиалам пришло нал/TBC/BOG
    (реальные деньги, без корректировок) и «должны на конец дня». Коротко —
    сводка и так длинная. Числа — из compute_day_summary, как на экране."""
    lines = ["<b>Пришло по филиалам</b> (без корректировок)"]
    for blk in summary["branches"]:
        inc = blk["income"]
        # Неосновные (Neo School, «без филиала») — только если по ним что-то пришло.
        if blk["branch"] not in CASH_BRANCHES and not inc["count"]:
            continue
        name = escape(blk["branch"] or "Без филиала")
        lines.append(
            f"• {name}: нал <b>{inc['cash']:g}</b> · TBC <b>{inc['card_tbc']:g}</b> · "
            f"BOG <b>{inc['card_bog']:g}</b> ₾"
        )
    d = summary["debtors"]
    lines.append(f"• Должны на конец дня: <b>{d['amount']:g}</b> ₾ · {d['count']} {_clients_word(d['count'])}")
    return lines


# ── Недельные скидки за неделю (раздел кассы) ────────────────────────────

def weekly_rebate_report(session: Session, week_start: date) -> dict:
    """Начисленные недельные скидки за неделю броней [пн, вс] — из журнала
    начислений WeeklyRebate (одна строка на клиента и неделю). Заменяет ручной
    подсчёт по понедельникам: кто, сколько часов, какой процент, сколько ₾."""
    ws = monday_of(week_start)
    rows = session.exec(
        select(WeeklyRebate, User)
        .join(User, User.id == WeeklyRebate.user_id, isouter=True)
        .where(WeeklyRebate.week_start == ws)
    ).all()
    items = [{
        "user_id": str(r.user_id),
        "name": (u.name or u.email) if u else str(r.user_id),
        "email": u.email if u else None,
        "hours": round(float(r.total_hours or 0), 1),
        "percent": int(r.tier_percent or 0),
        "amount": _r(r.amount),
        "credited_at": _iso(r.created_at),
    } for r, u in rows]
    items.sort(key=lambda x: (-x["amount"], (x["name"] or "").lower()))
    return {
        "week_start": ws.isoformat(),
        "week_end": (ws + timedelta(days=6)).isoformat(),
        # Крон начисляет в понедельник после недели (05:00 по Тбилиси).
        "credited_on": (ws + timedelta(days=7)).isoformat(),
        "items": items,
        "count": len(items),
        "total": _r(sum(x["amount"] for x in items)),
    }
