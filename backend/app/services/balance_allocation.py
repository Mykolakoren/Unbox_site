"""Куда ушли деньги клиента — распределение баланса по броням (решение владельца 03.10).

Владелец: «при начислении недельной скидки на баланс все первые брони,
покрываемые скидкой за прошлую неделю, показывать как оплаченные…; если
накопленного хватает на часть брони — к оплате только разница; и чтобы на
балансе было видно, что было начислено и куда списалось».

Источник правды — лента баланса (balance_ledger, инвариант «баланс == сумма
ленты»). Эта функция ничего не пишет и деньги не двигает: она только
раскладывает уже случившиеся движения «какие деньги за что заплатили».

ПРАВИЛО «первыми тратятся самые старые деньги» (FIFO)
  • Каждое начисление (delta > 0) — «партия денег» своего вида: оплата
    (topup; способ — из кассовой проводки), скидка за неделю (weekly_rebate),
    возврат, корректировка, остаток на начало (baseline), прочее.
  • Каждое списание (delta < 0) — «потребитель»: бронь (все её списания
    вместе) или само списание, если оно не про бронь (абонемент, корректировка…).
  • Деньги идут потребителям по порядку: самые старые деньги — самым ранним
    броням (по времени начала брони; не-бронь — по времени списания). Это то же
    правило, что владелец утвердил 29.09 для «к оплате» (вариант В: «оплаты
    закрывают брони по порядку, от старых к новым; долг — на самых свежих»),
    поэтому суммы «к оплате» по броням совпадают с прежним расчётом фронта.
  • Возврат за бронь (отмена, перенос дешевле, «на абонемент», снятие штрафа…)
    сначала гасит списание СВОЕЙ брони — отменённая и возвращённая бронь ни
    денег, ни долга не держит. Остаток возврата — новая партия «возврат».
    Так же отмена/правка кассовой проводки гасит своё пополнение.
  • Что не покрыто — долг, привязанный к брони (или к списанию). Новое
    начисление закрывает самые ранние долги, остальное — плюс на балансе.
  • Остаток на начало (baseline, 21.07) — деньги/долг ДО ленты: самые старые.

Итог по клиенту всегда сходится: Σ партий на балансе − Σ долгов == сумма
ленты. Если сумма ленты ≠ баланс клиента (баланс правили мимо кошелька) —
флаг consistent = False, без падения: экраны тогда считают «к оплате» по
балансу, как раньше.

Ещё не списанные брони (списание за 24 ч до начала) в ленте не видны: их
покрывает плюс на балансе — партии по порядку, ближайшие брони первыми
(project_coverage) — так же, как фронт (src/utils/dueAmounts.ts).

Все суммы внутри — в копейках (int), чтобы 0,1 + 0,2 не давали хвостов.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

TZ = timedelta(hours=4)  # Тбилиси, без летнего времени
EPS = 0.005
# Списание «при создании брони» пишется в ленту без номера брони — узнаём
# бронь по клиенту и времени (то же окно, что в «Итогах дня», day_summary).
UNLINKED_MATCH_SECONDS = 3
# Строка недельной скидки ↔ запись WeeklyRebate (неделя) — одним коммитом.
REBATE_MATCH_SECONDS = 600

KIND_TOPUP = "topup"
KIND_REBATE = "weekly_rebate"
KIND_REFUND = "refund"
KIND_CORRECTION = "correction"
KIND_BASELINE = "baseline"
KIND_OTHER = "other"

# Начисления «вернули деньги» (если не про свою бронь — партия «возврат»).
REFUND_REASONS = frozenset({
    "booking_refund", "booking_charge_revert", "reschedule_diff", "price_change",
    "format_change", "trim_refund", "shorten_refund", "extras_refund",
    "booking_to_subscription", "double_charge_refund", "consecutive_recompute",
})

METHOD_LABELS = {"cash": "наличные", "card_tbc": "TBC", "card_bog": "BOG"}

# Фронт (computeDueByBooking) берёт в «к оплате» только такие брони — держим
# одинаково, иначе покрытие несписанных броней разойдётся с экраном.
DUE_STATUSES = ("confirmed", "pending_approval", "completed")
MONEY_METHODS = ("balance", "bonus", "", None, "subscription")

_MIN_KEY = datetime.min


# ── Входные данные ───────────────────────────────────────────────────────

@dataclass
class Row:
    """Строка ленты баланса (BalanceLedger) — то, что нужно распределению."""
    id: str
    at: datetime                       # created_at, наивное UTC
    delta: float
    reason: str
    description: str = ""
    ref_type: Optional[str] = None
    ref_id: Optional[str] = None
    booking_id: Optional[str] = None   # бронь: ref_id или найденная по времени
    method: Optional[str] = None       # пополнение: cash | card_tbc | card_bog
    week_start: Optional[date] = None  # недельная скидка: понедельник недели


@dataclass
class BookingRef:
    """Бронь — для порядка (время начала) и подписи «05.10 14:00 Каб. 2»."""
    id: str
    day: date                          # календарный день по Тбилиси
    start_time: str = "00:00"
    duration: int = 60
    resource_id: Optional[str] = None
    resource_name: Optional[str] = None
    status: str = "confirmed"
    payment_status: Optional[str] = None
    payment_method: Optional[str] = None
    final_price: float = 0.0

    def start(self) -> datetime:
        h, m = _hm(self.start_time)
        return datetime(self.day.year, self.day.month, self.day.day, h, m)


# ── Мелочи ───────────────────────────────────────────────────────────────

def _c(x: float) -> int:
    """₾ → копейки."""
    return int(round(float(x or 0) * 100))


def _g(c: int) -> float:
    """копейки → ₾."""
    return round(c / 100.0, 2)


def _hm(s: Optional[str]) -> tuple[int, int]:
    m = re.match(r"^\s*(\d{1,2}):(\d{2})", s or "")
    if not m:
        return 0, 0
    return min(int(m.group(1)), 23), min(int(m.group(2)), 59)


def _ddmm(d) -> str:
    return f"{d.day:02d}.{d.month:02d}"


def _tbs(at: datetime) -> datetime:
    return at + TZ


def short_room(name: Optional[str], resource_id: Optional[str] = None) -> str:
    """«Кабинет 2» → «Каб. 2»; без названия — id кабинета."""
    n = (name or resource_id or "").strip()
    return re.sub(r"^Кабинет\s+", "Каб. ", n)


def booking_label(b: Optional[BookingRef], fallback: str = "бронь") -> str:
    """«05.10 14:00 Каб. 2»."""
    if b is None:
        return fallback
    room = short_room(b.resource_name, b.resource_id)
    label = f"{_ddmm(b.day)} {b.start_time or '00:00'}" + (f" {room}" if room else "")
    # Отменённая бронь со штрафом (списание не вернули) — долг есть, а в шахматке
    # её нет: подписываем, чтобы не искали.
    return f"{label}, отменена" if (b.status or "") == "cancelled" else label


def booking_public(b: Optional[BookingRef]) -> Optional[dict]:
    if b is None:
        return None
    return {
        "id": b.id,
        "date": b.day.isoformat(),
        "startTime": b.start_time,
        "duration": b.duration,
        "resourceId": b.resource_id,
        "resourceName": b.resource_name,
        "status": b.status,
        "paymentStatus": b.payment_status,
        "paymentMethod": b.payment_method,
        "finalPrice": round(float(b.final_price or 0), 2),
        "label": booking_label(b),
    }


def source_kind(row: Row) -> str:
    r = row.reason or ""
    if r in ("topup", "topup_adjust"):
        return KIND_TOPUP
    if r == "weekly_rebate":
        return KIND_REBATE
    if r == "baseline":
        return KIND_BASELINE
    if r == "correction":
        return KIND_CORRECTION
    if r in REFUND_REASONS:
        return KIND_REFUND
    return KIND_OTHER


def source_label(row: Row) -> str:
    """Короткая подпись партии: «оплата 30.09», «скидка за неделю», …"""
    kind = source_kind(row)
    d = _ddmm(_tbs(row.at))
    if kind == KIND_TOPUP:
        return f"оплата {d}"
    if kind == KIND_REBATE:
        return "скидка за неделю"
    if kind == KIND_BASELINE:
        return "остаток на начало"
    if kind == KIND_CORRECTION:
        return f"корректировка {d}"
    if kind == KIND_REFUND:
        if row.reason == "consecutive_recompute":
            return f"пересчёт «часы подряд» {d}"
        return f"возврат {d}"
    if row.reason == "merge":
        return f"перенос с другого профиля {d}"
    if row.reason == "subscription_purchase":
        return f"возврат за абонемент {d}"
    desc = (row.description or "").strip()
    return f"{desc[:60]} {d}".strip() if desc else f"начисление {d}"


def source_detail(row: Row) -> Optional[str]:
    """Уточнение партии: способ оплаты, неделя скидки."""
    kind = source_kind(row)
    if kind == KIND_TOPUP and row.method:
        return METHOD_LABELS.get(row.method, row.method)
    if kind == KIND_REBATE:
        ws = row.week_start
        if ws is None:
            ws = _monday(_tbs(row.at).date()) - timedelta(days=7)
        return f"{_ddmm(ws)}–{_ddmm(ws + timedelta(days=6))}"
    return None


def debit_label(row: Row, booking: Optional[BookingRef]) -> str:
    """На что списано: бронь «05.10 14:00 Каб. 2» или само списание."""
    if row.booking_id:
        return booking_label(booking, fallback=f"бронь (удалена) {_ddmm(_tbs(row.at))}")
    d = _ddmm(_tbs(row.at))
    r = row.reason or ""
    if r == "subscription_purchase":
        m = re.search(r"«([^»]+)»", row.description or "")
        return f"абонемент «{m.group(1)}»" if m else f"абонемент {d}"
    if r == "correction":
        return f"корректировка {d}"
    if r == "baseline":
        return "долг на начало"
    if r == "merge":
        return f"перенос на другой профиль {d}"
    if r == "topup_reversal":
        return f"отмена пополнения {d}"
    if r == "topup_adjust":
        return f"правка пополнения {d}"
    if r == "consecutive_recompute":
        return f"пересчёт «часы подряд» {d}"
    if r in ("booking_charge", "extend_charge", "extras_charge", "reschedule_diff"):
        return f"списание за бронь {d}"
    desc = (row.description or "").strip()
    return f"{desc[:60]} {d}".strip() if desc else f"списание {d}"


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


# ── Внутренние единицы распределения ─────────────────────────────────────

@dataclass
class _Supply:
    row: Row
    cents: int
    left: int
    order: tuple


@dataclass
class _Portion:
    row: Row
    cents: int
    left: int = 0


@dataclass
class _Demand:
    key: tuple
    booking_id: Optional[str]
    portions: list = field(default_factory=list)


# ── Распределение ────────────────────────────────────────────────────────

def allocate(
    rows: Iterable[Row],
    bookings: Optional[dict] = None,
    balance: Optional[float] = None,
) -> dict:
    """Разложить ленту клиента: какие деньги за что заплатили.

    rows      — вся лента клиента (порядок любой);
    bookings  — id брони → BookingRef (для порядка и подписей);
    balance   — текущий баланс клиента (для проверки consistent).
    """
    bookings = bookings or {}
    rows = sorted(rows, key=lambda r: (r.at, str(r.id)))
    by_id = {str(r.id): r for r in rows}

    info: dict[str, dict] = {
        str(r.id): {
            "id": str(r.id), "delta": round(float(r.delta or 0), 2), "reason": r.reason,
            "bookingId": r.booking_id,
            "spentOn": [], "left": 0.0, "reversed": [],
            "paidFrom": [], "debtClosed": [], "debtOpen": 0.0, "reversedBy": [],
        }
        for r in rows
    }

    def src_public(r: Row) -> dict:
        return {
            "rowId": str(r.id), "kind": source_kind(r), "label": source_label(r),
            "detail": source_detail(r), "date": r.at.isoformat(),
        }

    def tgt_public(r: Row) -> dict:
        b = bookings.get(r.booking_id) if r.booking_id else None
        return {
            "rowId": str(r.id), "bookingId": r.booking_id, "label": debit_label(r, b),
            "booking": booking_public(b), "date": r.at.isoformat(),
        }

    # 1. Группы «своих» движений: бронь (списания + её возвраты) и кассовая
    #    проводка (пополнение + её отмена/правка). Остальное — по одному.
    groups: dict[tuple, list[Row]] = defaultdict(list)
    singles: list[Row] = []
    for r in rows:
        if abs(_c(r.delta)) == 0:
            continue
        if r.booking_id:
            groups[("booking", str(r.booking_id))].append(r)
        elif (r.ref_type or "") == "cashbox_tx" and r.ref_id:
            groups[("cashbox", str(r.ref_id))].append(r)
        else:
            singles.append(r)

    supplies: list[_Supply] = []
    demands: list[_Demand] = []

    def add_supply(r: Row, cents: int):
        order = (_MIN_KEY if r.reason == "baseline" else r.at, str(r.id))
        supplies.append(_Supply(row=r, cents=cents, left=cents, order=order))

    def demand_key_for_row(r: Row) -> tuple:
        k = _MIN_KEY if r.reason == "baseline" else _tbs(r.at)
        return (k, 1, str(r.id))

    for (gtype, gid), grp in groups.items():
        primary_sign = -1 if gtype == "booking" else 1
        prim = [_Portion(row=r, cents=abs(_c(r.delta))) for r in grp if (1 if r.delta > 0 else -1) == primary_sign]
        revs = [r for r in grp if (1 if r.delta > 0 else -1) != primary_sign]
        for p in prim:
            p.left = p.cents
        # Возврат/отмена гасит СВОИ движения, начиная с последнего (LIFO).
        for rv in revs:
            amt = abs(_c(rv.delta))
            for p in reversed(prim):
                if amt <= 0:
                    break
                if p.left <= 0:
                    continue
                take = min(amt, p.left)
                p.left -= take
                amt -= take
                if gtype == "booking":
                    info[str(rv.id)]["reversed"].append({**tgt_public(p.row), "amount": _g(take)})
                    info[str(p.row.id)]["reversedBy"].append({**src_public(rv), "amount": _g(take)})
                else:
                    info[str(rv.id)]["reversed"].append({**src_public(p.row), "amount": _g(take)})
                    info[str(p.row.id)]["reversedBy"].append({
                        "rowId": str(rv.id), "label": debit_label(rv, None), "date": rv.at.isoformat(),
                        "amount": _g(take),
                    })
            if amt > 0:
                # Вернули больше, чем списали (или наоборот) — остаток живёт сам по себе.
                if rv.delta > 0:
                    add_supply(rv, amt)
                else:
                    d = _Demand(key=demand_key_for_row(rv), booking_id=None, portions=[_Portion(row=rv, cents=amt)])
                    demands.append(d)
        rest = [p for p in prim if p.left > 0]
        if not rest:
            continue
        if gtype == "booking":
            b = bookings.get(gid)
            if b is not None:
                key = (b.start(), 0, gid)
            else:
                key = (_tbs(min(p.row.at for p in rest)), 0, gid)
            demands.append(_Demand(key=key, booking_id=gid,
                                   portions=[_Portion(row=p.row, cents=p.left) for p in rest]))
        else:
            for p in rest:
                add_supply(p.row, p.left)

    for r in singles:
        cents = abs(_c(r.delta))
        if r.delta > 0:
            add_supply(r, cents)
        else:
            demands.append(_Demand(key=demand_key_for_row(r), booking_id=None,
                                   portions=[_Portion(row=r, cents=cents)]))

    supplies.sort(key=lambda s: s.order)
    demands.sort(key=lambda d: d.key)

    # 2. Старые деньги — ранним броням (жадно, по двум очередям).
    si = 0
    per_booking: dict[str, dict] = {}
    for d in demands:
        for p in sorted(d.portions, key=lambda p: (p.row.at, str(p.row.id))):
            need = p.cents
            while need > 0 and si < len(supplies):
                s = supplies[si]
                if s.left <= 0:
                    si += 1
                    continue
                take = min(need, s.left)
                s.left -= take
                need -= take
                # Деньги уже лежали на балансе к моменту списания → «оплачено из»;
                # пришли позже → «в долг, закрыто …». Остаток на начало — самый
                # старый: плюс на начало оплачивает сразу, долг на начало закрывают.
                if p.row.reason == "baseline":
                    credit_first = s.row.reason == "baseline"
                else:
                    credit_first = s.row.reason == "baseline" or s.row.at <= p.row.at
                src = {**src_public(s.row), "amount": _g(take)}
                tgt = {**tgt_public(p.row), "amount": _g(take), "closedDebt": not credit_first}
                info[str(s.row.id)]["spentOn"].append(tgt)
                if credit_first:
                    info[str(p.row.id)]["paidFrom"].append(src)
                else:
                    info[str(p.row.id)]["debtClosed"].append(src)
                if d.booking_id:
                    pb = per_booking.setdefault(d.booking_id, {"sources": [], "debt": 0})
                    pb["sources"].append(src)
            p.left = need
            if need > 0:
                info[str(p.row.id)]["debtOpen"] = _g(need)

    # 3. Итоги: плюс на балансе (партии по порядку траты) и долги (от старых к новым).
    batches = []
    for s in supplies:
        if s.left > 0:
            info[str(s.row.id)]["left"] = _g(info_left_cents(info[str(s.row.id)]) + s.left)
            batches.append({**src_public(s.row), "amount": _g(s.left)})
    batches = _merge_by_row(batches)

    debts = []
    for d in demands:
        left = sum(p.left for p in d.portions)
        if left <= 0:
            continue
        b = bookings.get(d.booking_id) if d.booking_id else None
        first = min(d.portions, key=lambda p: (p.row.at, str(p.row.id))).row
        entry = {
            "bookingId": d.booking_id,
            "rowIds": [str(p.row.id) for p in d.portions if p.left > 0],
            "amount": _g(left),
            "label": debit_label(first, b),
            "booking": booking_public(b),
            "date": first.at.isoformat(),
        }
        debts.append(entry)
        if d.booking_id:
            per_booking.setdefault(d.booking_id, {"sources": [], "debt": 0})["debt"] += left

    # Брони с деньгами: сколько списано (нетто), чем оплачено, сколько в долг.
    booking_rows: dict[str, dict] = {}
    for d in demands:
        if not d.booking_id:
            continue
        pb = per_booking.get(d.booking_id, {"sources": [], "debt": 0})
        charged = sum(p.cents for p in d.portions)
        booking_rows[d.booking_id] = {
            "bookingId": d.booking_id,
            "charged": _g(charged),
            "debt": _g(pb["debt"]),
            "sources": _merge_sources(pb["sources"]),
            "booking": booking_public(bookings.get(d.booking_id)),
        }
    # Бронь, списание которой целиком вернули, — тоже видна (нетто 0).
    for (gtype, gid), grp in groups.items():
        if gtype == "booking" and gid not in booking_rows:
            booking_rows[gid] = {
                "bookingId": gid, "charged": 0.0, "debt": 0.0, "sources": [],
                "booking": booking_public(bookings.get(gid)),
            }

    ledger_sum = _g(sum(_c(r.delta) for r in rows))
    plus = sum(_c(b["amount"]) for b in batches)
    minus = sum(_c(d["amount"]) for d in debts)
    computed = _g(plus - minus)
    bal = round(float(balance), 2) if balance is not None else ledger_sum
    consistent = abs(computed - bal) <= EPS and abs(computed - ledger_sum) <= EPS

    for r in rows:
        i = info[str(r.id)]
        i["spentOn"] = _merge_targets(i["spentOn"])
        i["paidFrom"] = _merge_sources(i["paidFrom"])
        i["debtClosed"] = _merge_sources(i["debtClosed"])

    return {
        "balance": bal,
        "ledgerSum": ledger_sum,
        "allocatedBalance": computed,
        "consistent": consistent,
        "batches": batches,
        "debts": debts,
        "bookings": list(booking_rows.values()),
        "rows": [info[str(r.id)] for r in rows],
    }


def info_left_cents(i: dict) -> int:
    return _c(i.get("left") or 0)


def _merge_by_row(items: list[dict]) -> list[dict]:
    out: list[dict] = []
    pos: dict[str, int] = {}
    for it in items:
        k = it["rowId"]
        if k in pos:
            out[pos[k]]["amount"] = _g(_c(out[pos[k]]["amount"]) + _c(it["amount"]))
        else:
            pos[k] = len(out)
            out.append(dict(it))
    return out


def _merge_sources(items: list[dict]) -> list[dict]:
    return _merge_by_row(items)


def _merge_targets(items: list[dict]) -> list[dict]:
    out: list[dict] = []
    pos: dict[tuple, int] = {}
    for it in items:
        k = (it.get("bookingId") or it["rowId"], bool(it.get("closedDebt")))
        if k in pos:
            out[pos[k]]["amount"] = _g(_c(out[pos[k]]["amount"]) + _c(it["amount"]))
        else:
            pos[k] = len(out)
            out.append(dict(it))
    return out


# ── Покрытие ещё не списанных броней плюсом баланса ──────────────────────

def due_kind(b: BookingRef, now_tbs: datetime) -> Optional[str]:
    """'charged' | 'pending' | None — как computeDueByBooking на фронте."""
    status = b.status
    if status == "confirmed":
        end = b.start() + timedelta(minutes=int(b.duration or 60))
        if end < now_tbs:
            status = "completed"
    if status not in DUE_STATUSES:
        return None
    if status == "completed" and b.payment_status == "pending":
        return None
    if float(b.final_price or 0) <= 0 or b.payment_status == "waived":
        return None
    if (b.payment_method or None) not in MONEY_METHODS:
        return None
    charged = b.payment_status != "pending" and status != "pending_approval"
    return "charged" if charged else "pending"


def project_coverage(batches: list[dict], pending: Iterable[BookingRef]) -> list[dict]:
    """Плюс баланса заранее покрывает ближайшие несписанные брони (по порядку)."""
    queue = [[dict(b), _c(b["amount"])] for b in batches]
    qi = 0
    out = []
    for b in sorted(pending, key=lambda x: (x.start(), x.id)):
        price = _c(b.final_price)
        need = price
        parts = []
        while need > 0 and qi < len(queue):
            src, left = queue[qi]
            if left <= 0:
                qi += 1
                continue
            take = min(need, left)
            queue[qi][1] = left - take
            need -= take
            parts.append({**{k: src[k] for k in ("rowId", "kind", "label", "detail", "date")}, "amount": _g(take)})
        out.append({
            "bookingId": b.id, "price": _g(price), "covered": _g(price - need), "due": _g(need),
            "sources": _merge_sources(parts), "booking": booking_public(b),
        })
    return out


# ── Привязка строк «при создании брони» (без номера брони) ──────────────

_DESC_DATE = re.compile(r"(\d{4}-\d{2}-\d{2})")
_DESC_TIME = re.compile(r"\b(\d{1,2}:\d{2})(?::\d{2})?\b")


def link_unlinked(rows: list[Row], created: dict[str, tuple[datetime, BookingRef]]) -> None:
    """Строкам ref_type='booking' без ref_id найти бронь: тот же клиент, бронь
    создана в пределах UNLINKED_MATCH_SECONDS (запись и бронь — один запрос).
    Предпочтение: совпала дата/время из описания (серия, мульти-слот), сумма,
    бронь ещё без такой же строки, ближе по времени. Меняет rows на месте."""
    gap = UNLINKED_MATCH_SECONDS
    taken: dict[tuple, int] = defaultdict(int)
    for r in sorted(rows, key=lambda x: (x.at, str(x.id))):
        if r.booking_id or (r.ref_type or "") != "booking" or r.ref_id:
            continue
        dm = _DESC_DATE.search(r.description or "")
        times = _DESC_TIME.findall(r.description or "")
        want_day = dm.group(1) if dm else None
        want_time = times[-1] if times else None
        best, best_key = None, None
        for bid, (at, b) in created.items():
            dt = abs((at - r.at).total_seconds())
            if dt > gap:
                continue
            desc_miss = 0
            if want_day and b.day.isoformat() != want_day:
                desc_miss += 1
            if want_time and want_day and (b.start_time or "") != want_time.zfill(5):
                desc_miss += 1
            price_miss = abs(abs(float(r.delta or 0)) - float(b.final_price or 0)) > 0.01
            dup = taken[(bid, r.reason, r.delta > 0)]
            key = (desc_miss, dup, price_miss, dt, bid)
            if best_key is None or key < best_key:
                best, best_key = bid, key
        if best is not None:
            r.booking_id = best
            taken[(best, r.reason, r.delta > 0)] += 1


# ── Загрузка из базы ─────────────────────────────────────────────────────

def _booking_ref(b, names: dict) -> BookingRef:
    d = b.date.date() if isinstance(b.date, datetime) else b.date
    return BookingRef(
        id=str(b.id), day=d, start_time=b.start_time or "00:00", duration=int(b.duration or 60),
        resource_id=b.resource_id, resource_name=names.get(b.resource_id),
        status=b.status or "confirmed", payment_status=b.payment_status,
        payment_method=b.payment_method, final_price=float(b.final_price or 0),
    )


def _resource_names(session, ids: set) -> dict:
    from sqlmodel import select
    from app.models.resource import Resource
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {r.id: r.name for r in session.exec(select(Resource).where(Resource.id.in_(list(ids)))).all()}


def load_inputs(session, users: list) -> dict:
    """Лента, брони и метки (способ оплаты, неделя скидки) для набора клиентов.

    Возвращает {user_id: {"rows": [Row], "bookings": {id: BookingRef}, "all": [BookingRef]}}.
    Брони — ВСЕ брони клиента (а не только окно админки в 5000): долг брони
    вне окна не теряется.
    """
    from sqlmodel import select, or_
    from app.models.balance_ledger import BalanceLedger
    from app.models.booking import Booking
    from app.models.cashbox_transaction import CashboxTransaction
    from app.models.weekly_rebate import WeeklyRebate

    out: dict[str, dict] = {}
    if not users:
        return out
    ids = [str(u.id) for u in users]
    by_uuid = {str(u.id): u for u in users}
    by_email = {(u.email or "").lower(): str(u.id) for u in users if u.email}

    ledger = session.exec(
        select(BalanceLedger).where(BalanceLedger.user_id.in_(ids))
        .order_by(BalanceLedger.created_at, BalanceLedger.id)
    ).all()

    uuids = [u.id for u in users]
    emails = [u.email for u in users if u.email]
    conds = [Booking.user_uuid.in_(uuids)]
    if emails:
        conds.append(Booking.user_id.in_(emails))
    blist = session.exec(select(Booking).where(or_(*conds))).all()
    names = _resource_names(session, {b.resource_id for b in blist})

    tx_ids = {r.ref_id for r in ledger if (r.ref_type or "") == "cashbox_tx" and r.ref_id}
    methods: dict[str, str] = {}
    if tx_ids:
        for tx in session.exec(select(CashboxTransaction).where(CashboxTransaction.id.in_(list(tx_ids)))).all():
            methods[str(tx.id)] = tx.payment_method
    rebates_by_user: dict[str, list] = defaultdict(list)
    if any(r.reason == "weekly_rebate" for r in ledger):
        for wr in session.exec(select(WeeklyRebate).where(WeeklyRebate.user_id.in_(uuids))).all():
            rebates_by_user[str(wr.user_id)].append(wr)

    for uid in ids:
        out[uid] = {"rows": [], "bookings": {}, "all": [], "created": {}}
    for b in blist:
        uid = str(b.user_uuid) if b.user_uuid and str(b.user_uuid) in by_uuid else by_email.get((b.user_id or "").lower())
        if not uid:
            continue
        ref = _booking_ref(b, names)
        out[uid]["bookings"][ref.id] = ref
        out[uid]["all"].append(ref)
        if b.created_at:
            out[uid]["created"][ref.id] = (b.created_at, ref)

    for r in ledger:
        uid = str(r.user_id)
        if uid not in out:
            continue
        row = Row(
            id=str(r.id), at=r.created_at, delta=float(r.delta or 0), reason=r.reason or "",
            description=r.description or "", ref_type=r.ref_type, ref_id=r.ref_id,
        )
        if (r.ref_type or "") == "booking" and r.ref_id:
            row.booking_id = str(r.ref_id)
        if (r.ref_type or "") == "cashbox_tx" and r.ref_id:
            row.method = methods.get(str(r.ref_id))
        if row.reason == "weekly_rebate":
            best = None
            for wr in rebates_by_user.get(uid, []):
                if abs(float(wr.amount or 0) - row.delta) > 0.01 or not wr.created_at:
                    continue
                dt = abs((wr.created_at - row.at).total_seconds())
                if dt <= REBATE_MATCH_SECONDS and (best is None or dt < best[0]):
                    best = (dt, wr.week_start)
            if best:
                row.week_start = best[1]
        out[uid]["rows"].append(row)

    for uid, data in out.items():
        link_unlinked(data["rows"], data["created"])
    return out


def _now_tbs(now_utc: Optional[datetime] = None) -> datetime:
    return (now_utc or datetime.utcnow()) + TZ


def client_allocation(session, user, now_utc: Optional[datetime] = None) -> dict:
    """Полная раскладка одного клиента — для карточки и попапа брони."""
    data = load_inputs(session, [user])[str(user.id)]
    res = allocate(data["rows"], data["bookings"], balance=float(user.balance or 0))
    now = _now_tbs(now_utc)
    pending = [b for b in data["all"] if due_kind(b, now) == "pending"]
    res["coverage"] = project_coverage(res["batches"], pending) if res["consistent"] else []
    res["userId"] = str(user.id)
    res["email"] = user.email
    return res


def summary(session, now_utc: Optional[datetime] = None) -> dict:
    """Сводка для значков «к оплате» по всем клиентам с ненулевым балансом.

    С плюсом — партии (что лежит на балансе и в каком порядке потратится);
    с минусом — долги по броням (в т.ч. по броням вне окна админки) и по
    списаниям не за брони. Клиенты с нулём не нужны: у них всё списанное
    оплачено, а несписанное — целиком «к оплате».
    """
    from sqlmodel import select
    from app.models.user import User

    users = [
        u for u in session.exec(select(User).where(User.archived_at.is_(None))).all()  # type: ignore[union-attr]
        if abs(float(u.balance or 0)) >= EPS
    ]
    inputs = load_inputs(session, users)
    clients = []
    for u in users:
        data = inputs[str(u.id)]
        res = allocate(data["rows"], data["bookings"], balance=float(u.balance or 0))
        clients.append({
            "userId": str(u.id),
            "email": u.email,
            "balance": res["balance"],
            "consistent": res["consistent"],
            "ledgerSum": res["ledgerSum"],
            "batches": [
                {k: b[k] for k in ("rowId", "kind", "label", "detail", "date", "amount")}
                for b in res["batches"]
            ],
            "debts": res["debts"],
        })
    return {"generatedAt": datetime.utcnow().isoformat(), "clients": clients}
