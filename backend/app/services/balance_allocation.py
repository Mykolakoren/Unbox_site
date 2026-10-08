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
  • Списания не за бронь (абонемент с баланса, корректировка, склейка, «часы
    подряд») оплачиваются ПЕРВЫМИ, до броней. Иначе более новое такое списание
    «забирало» долг у неоплаченных броней, и они получали «✓ оплачено» (ревью
    денег 03.10). Так и в прежнем расчёте фронта: минус баланса — на бронях.
  • Продажа абонемента с кассы — пара: пополнение «… — оплата абонемента» и
    списание абонемента той же суммы одним действием. Абонемент оплачен ЭТОЙ
    оплатой, старые деньги клиента остаются броням.
  • unlinked_charged — списанные брони, о которых в ленте нет ни строки (части
    после деления брони, брони склеенного профиля, брони до ленты): экран кладёт
    на них долг не на бронях, самые свежие первыми, как прежний расчёт.

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

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

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
        # «Слияние баланса из …» — пришло с другого профиля; иначе это обнуление
        # долга на профиле, который склеили в другой («Баланс перенесён на …»).
        return f"перенос с другого профиля {d}" if "Слияние" in (row.description or "") \
            else f"долг перенесён на другой профиль {d}"
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
        # Брони нет среди броней клиента (удалена или числится на другом профиле).
        return booking_label(booking, fallback=f"бронь не найдена (списание {_ddmm(_tbs(row.at))})")
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
        return f"долг с другого профиля {d}" if "Слияние" in (row.description or "") \
            else f"перенос на другой профиль {d}"
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
    detail: bool = True,
) -> dict:
    """Разложить ленту клиента: какие деньги за что заплатили.

    rows      — вся лента клиента (порядок любой);
    bookings  — id брони → BookingRef (для порядка и подписей);
    balance   — текущий баланс клиента (для проверки consistent);
    detail    — False: только партии и долги (сводка по всем клиентам), без
                раскладки по строкам ленты и броням — в разы быстрее.
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

    # 0. Продажа абонемента с кассы (subscription_sale): пополнение «… — оплата
    #    абонемента» и списание абонемента той же суммы, одним действием (≤ 2 с).
    #    Абонемент оплачен своей оплатой; кассовую проводку потом не правили.
    per_tx: dict[str, int] = defaultdict(int)
    for r in rows:
        if (r.ref_type or "") == "cashbox_tx" and r.ref_id:
            per_tx[str(r.ref_id)] += 1
    paired: set[str] = set()
    sale_tops = [r for r in rows if r.reason == "topup" and r.delta > 0
                 and "оплата абонемента" in (r.description or "") and per_tx.get(str(r.ref_id), 0) == 1]
    for sp in (r for r in rows if r.reason == "subscription_purchase" and r.delta < 0):
        cand = [t for t in sale_tops if str(t.id) not in paired and _c(t.delta) == -_c(sp.delta)
                and abs((t.at - sp.at).total_seconds()) <= 2]
        if not cand:
            continue
        t = min(cand, key=lambda x: abs((x.at - sp.at).total_seconds()))
        paired.update({str(t.id), str(sp.id)})
        if detail:
            amount = _g(abs(_c(sp.delta)))
            info[str(t.id)]["spentOn"].append({**tgt_public(sp), "amount": amount, "closedDebt": False})
            info[str(sp.id)]["paidFrom"].append({**src_public(t), "amount": amount})

    # 1. Группы «своих» движений: бронь (списания + её возвраты) и кассовая
    #    проводка (пополнение + её отмена/правка). Остальное — по одному.
    groups: dict[tuple, list[Row]] = defaultdict(list)
    singles: list[Row] = []
    for r in rows:
        if abs(_c(r.delta)) == 0 or str(r.id) in paired:
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
        # Не за бронь — раньше всех броней, между собой по времени (остаток на
        # начало — самый первый). См. docstring: иначе ложное «✓ оплачено».
        return (_MIN_KEY, 1, _MIN_KEY if r.reason == "baseline" else r.at, str(r.id))

    for (gtype, gid), grp in groups.items():
        primary_sign = -1 if gtype == "booking" else 1
        prim = [_Portion(row=r, cents=abs(_c(r.delta))) for r in grp if (1 if r.delta > 0 else -1) == primary_sign]
        revs = [r for r in grp if (1 if r.delta > 0 else -1) != primary_sign]
        for p in prim:
            p.left = p.cents
        # Возврат/отмена гасит СВОИ движения: последнее, сделанное ДО него (LIFO);
        # если до него ничего не осталось — ближайшее после. Так откат горячей брони
        # гасит списание при создании, а не списание при подтверждении.
        for rv in revs:
            amt = abs(_c(rv.delta))
            before = [p for p in prim if (p.row.at, str(p.row.id)) <= (rv.at, str(rv.id))]
            after = [p for p in prim if (p.row.at, str(p.row.id)) > (rv.at, str(rv.id))]
            for p in list(reversed(before)) + after:
                if amt <= 0:
                    break
                if p.left <= 0:
                    continue
                take = min(amt, p.left)
                p.left -= take
                amt -= take
                if not detail:
                    pass
                elif gtype == "booking":
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
                if not detail:
                    continue
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
            if need > 0 and detail:
                info[str(p.row.id)]["debtOpen"] = _g(need)

    # 3. Итоги: плюс на балансе (партии по порядку траты) и долги (от старых к новым).
    batches = []
    for s in supplies:
        if s.left > 0:
            if detail:
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
    for d in (demands if detail else []):
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
    for (gtype, gid), grp in (groups.items() if detail else []):
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

    for r in (rows if detail else []):
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
        "rows": [info[str(r.id)] for r in rows] if detail else [],
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
    from sqlalchemy import or_
    from sqlmodel import select
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

    # Только нужные колонки (сводка зовётся на каждом изменении балансов в админке).
    L = BalanceLedger
    ledger = session.exec(
        select(L.id, L.user_id, L.delta, L.reason, L.description, L.ref_type, L.ref_id, L.created_at)
        .where(L.user_id.in_(ids))
        .order_by(L.created_at, L.id)
    ).all()

    uuids = [u.id for u in users]
    emails = [u.email for u in users if u.email]
    conds = [Booking.user_uuid.in_(uuids)]
    if emails:
        conds.append(Booking.user_id.in_(emails))
    blist = session.exec(
        select(Booking.id, Booking.user_uuid, Booking.user_id, Booking.date, Booking.start_time, Booking.duration,
               Booking.resource_id, Booking.status, Booking.payment_status, Booking.payment_method,
               Booking.final_price, Booking.created_at)
        .where(or_(*conds))
    ).all()
    names = _resource_names(session, {b.resource_id for b in blist})

    tx_ids = {r.ref_id for r in ledger if (r.ref_type or "") == "cashbox_tx" and r.ref_id}
    methods: dict[str, str] = {}
    if tx_ids:
        for tx_id, method in session.exec(
            select(CashboxTransaction.id, CashboxTransaction.payment_method)
            .where(CashboxTransaction.id.in_(list(tx_ids)))
        ).all():
            methods[str(tx_id)] = method
    rebates_by_user: dict[str, list] = defaultdict(list)
    if any(r.reason == "weekly_rebate" for r in ledger):
        for wr in session.exec(
            select(WeeklyRebate.user_id, WeeklyRebate.amount, WeeklyRebate.created_at, WeeklyRebate.week_start)
            .where(WeeklyRebate.user_id.in_(uuids))
        ).all():
            rebates_by_user[str(wr.user_id)].append(wr)

    for uid in ids:
        out[uid] = {"rows": [], "bookings": {}, "all": [], "created": {}}
    for b in blist:
        uid = str(b.user_uuid) if b.user_uuid and str(b.user_uuid) in by_uuid else by_email.get((b.user_id or "").lower())
        if not uid or not b.date:
            continue
        try:
            ref = _booking_ref(b, names)
        except Exception:  # noqa: BLE001 — битая бронь не роняет раскладку клиента
            logger.warning("[balance-allocation] бронь %s пропущена: не разобрать дату", b.id)
            continue
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


# Брони старше — уже не в окне админки; список держим коротким.
UNLINKED_LOOKBACK_DAYS = 120


def unlinked_charged(rows: list, all_bookings: list, now_tbs: datetime) -> list[str]:
    """Списанные брони (как их видит экран), о которых в ленте нет ни строки:
    части после деления брони, брони склеенного профиля, брони до ленты, строка
    «при создании», не нашедшая бронь. Экран кладёт на них долг не на бронях."""
    linked = {str(r.booking_id) for r in rows if r.booking_id}
    since = now_tbs - timedelta(days=UNLINKED_LOOKBACK_DAYS)
    return [b.id for b in all_bookings
            if b.id not in linked and b.start() >= since and due_kind(b, now_tbs) == "charged"]


def _now_tbs(now_utc: Optional[datetime] = None) -> datetime:
    return (now_utc or datetime.utcnow()) + TZ


def client_allocation(session, user, now_utc: Optional[datetime] = None) -> dict:
    """Полная раскладка одного клиента — для карточки и попапа брони."""
    data = load_inputs(session, [user])[str(user.id)]
    res = allocate(data["rows"], data["bookings"], balance=float(user.balance or 0))
    now = _now_tbs(now_utc)
    pending = [b for b in data["all"] if due_kind(b, now) == "pending"]
    res["coverage"] = project_coverage(res["batches"], pending) if res["consistent"] else []
    res["unlinked"] = unlinked_charged(data["rows"], data["all"], now)
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
    from sqlalchemy import or_
    from sqlmodel import select
    from app.models.user import User

    users = session.exec(
        select(User.id, User.email, User.balance).where(
            User.archived_at.is_(None),  # type: ignore[union-attr]
            or_(User.balance >= EPS, User.balance <= -EPS),
        )
    ).all()
    inputs = load_inputs(session, users)
    now = _now_tbs(now_utc)
    clients = []
    for u in users:
        try:
            clients.append(_summary_entry(u, inputs[str(u.id)], now))
        except Exception:  # noqa: BLE001 — один клиент не роняет сводку для всех
            logger.exception("[balance-allocation] клиент %s пропущен в сводке", u.id)
    return {"generatedAt": datetime.utcnow().isoformat(), "clients": clients}


def _summary_entry(u, data: dict, now: datetime) -> dict:
    """Строка сводки одного клиента (партии при плюсе, долги и брони без ленты при минусе)."""
    res = allocate(data["rows"], data["bookings"], balance=float(u.balance or 0), detail=False)
    return {
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
        # Только при минусе: при плюсе списанные брони и так «оплачено».
        "unlinked": unlinked_charged(data["rows"], data["all"], now) if res["balance"] < 0 else [],
    }


# ── «Чем оплачено» в таблице броней (06.10) ──────────────────────────────

# Способ оплаты в словах стойки: наличные — в кассу, карта — перевод на счёт.
PAID_VIA_METHOD = {"cash": "наличные в кассу", "card_tbc": "на счёт TBC", "card_bog": "на счёт BOG"}
PAID_VIA_MAX_IDS = 200


def _src_day(src: dict) -> Optional[date]:
    """День партии по Тбилиси (date партии — наивное UTC в isoformat)."""
    try:
        return _tbs(datetime.fromisoformat(str(src.get("date")))).date()
    except (TypeError, ValueError):
        return None


def paid_via_label(sources: list[dict], debt: float, today: Optional[date] = None) -> list[str]:
    """Подписи «чем оплачено» по партиям, которые раскладка положила на бронь.

    today (06.10→08.10, просьба админов «свести кассу за день»): у оплаты
    дописывается день — «наличные в кассу · сегодня» / «· 06.10».
    """
    out: list[str] = []

    def add(s: str):
        if s and s not in out:
            out.append(s)

    for s in sources or []:
        kind = s.get("kind")
        if kind == KIND_TOPUP:
            base = {v: PAID_VIA_METHOD[k] for k, v in METHOD_LABELS.items()}.get(s.get("detail") or "", "оплата на баланс")
            d = _src_day(s) if today is not None else None
            add(f"{base} · {'сегодня' if d == today else _ddmm(d)}" if d else base)
        elif kind == KIND_REBATE:
            add("скидка за неделю")
        elif kind == KIND_REFUND:
            add("возврат")
        elif kind == KIND_BASELINE:
            add("остаток на начало")
        elif kind == KIND_CORRECTION:
            add("корректировка")
        else:
            add("с баланса")
    if debt >= EPS:
        add(f"в долг {debt:g} ₾")
    return out


def paid_via(session, booking_ids: list[str], now_utc: Optional[datetime] = None) -> dict:
    """Чем оплачена каждая бронь: {"items": [{bookingId, via: [...], kind}]}.

    kind: subscription | bonus | paid | debt | pending | free | none.
    Абонемент и бонус — по способу брони; деньги — по раскладке ленты клиента
    (самые старые деньги — самым ранним броням), т.е. какое пополнение (наличные,
    TBC, BOG) реально за неё заплатило. Только чтение.
    """
    from sqlalchemy import or_
    from sqlmodel import select
    from app.models.booking import Booking
    from app.models.user import User

    from uuid import UUID
    ids = []
    for x in dict.fromkeys(str(x).strip() for x in booking_ids):
        try:
            ids.append(UUID(x))
        except ValueError:
            continue  # мусор в запросе — пропускаем, не 500
    ids = ids[:PAID_VIA_MAX_IDS]
    if not ids:
        return {"items": []}
    blist = session.exec(
        select(Booking.id, Booking.user_uuid, Booking.user_id, Booking.payment_method, Booking.payment_status,
               Booking.final_price).where(Booking.id.in_(ids))
    ).all()
    uuids = {b.user_uuid for b in blist if b.user_uuid}
    emails = {b.user_id for b in blist if b.user_id and not b.user_uuid}
    conds = []
    if uuids:
        conds.append(User.id.in_(list(uuids)))
    if emails:
        conds.append(User.email.in_(list(emails)))
    users = session.exec(select(User.id, User.email, User.balance).where(or_(*conds))).all() if conds else []
    by_uuid = {str(u.id): u for u in users}
    by_email = {(u.email or "").lower(): u for u in users if u.email}

    money_users = []
    for b in blist:
        if (b.payment_method or "") in ("subscription", "bonus"):
            continue
        u = by_uuid.get(str(b.user_uuid)) if b.user_uuid else by_email.get((b.user_id or "").lower())
        if u and u not in money_users:
            money_users.append(u)
    inputs = load_inputs(session, money_users) if money_users else {}
    now = _now_tbs(now_utc)
    per_booking: dict[str, dict] = {}
    pending_ids: set[str] = set()
    charged_ids: set[str] = set()
    for u in money_users:
        data = inputs.get(str(u.id))
        if not data:
            continue
        try:
            res = allocate(data["rows"], data["bookings"], balance=float(u.balance or 0))
        except Exception:  # noqa: BLE001 — один клиент не роняет таблицу
            logger.exception("[paid-via] клиент %s пропущен", u.id)
            continue
        for row in res["bookings"]:
            per_booking[row["bookingId"]] = row
        pending_ids.update(b.id for b in data["all"] if due_kind(b, now) == "pending")
        charged_ids.update(b.id for b in data["all"] if due_kind(b, now) == "charged")

    today = now.date()
    items = []
    for b in blist:
        bid = str(b.id)
        pm = b.payment_method or ""
        if pm == "subscription":
            items.append({"bookingId": bid, "kind": "subscription", "via": ["часы абонемента"]})
            continue
        if pm == "bonus":
            items.append({"bookingId": bid, "kind": "bonus", "via": ["бонус"]})
            continue
        row = per_booking.get(bid)
        if not (row and _c(row["charged"]) > 0) and pm == "service":
            items.append({"bookingId": bid, "kind": "free", "via": ["служебная"]})
            continue
        if not (row and _c(row["charged"]) > 0) and (
                float(b.final_price or 0) <= 0 or b.payment_status == "waived"):
            items.append({"bookingId": bid, "kind": "free", "via": ["без оплаты"]})
            continue
        if row and (_c(row["charged"]) > 0 or _c(row["debt"]) > 0):
            via = paid_via_label(row["sources"], float(row["debt"] or 0), today)
            kind = "debt" if _c(row["debt"]) > 0 else "paid"
            paid_today = any(x.get("kind") == KIND_TOPUP and _src_day(x) == today for x in row["sources"])
            items.append({"bookingId": bid, "kind": kind, "via": via, "paidToday": paid_today})
        elif bid in pending_ids:
            items.append({"bookingId": bid, "kind": "pending", "via": ["ещё не списано"]})
        elif bid in charged_ids:
            # Списана, но в ленте строки нет (часть после деления, старый профиль).
            items.append({"bookingId": bid, "kind": "paid", "via": ["с баланса"]})
        else:
            items.append({"bookingId": bid, "kind": "none", "via": []})
    return {"items": items}


# ── «Оплачено сегодня» в списке броней (08.10, просьба админов) ──────────

def paid_today(session, day: Optional[date] = None, now_utc: Optional[datetime] = None) -> dict:
    """Какие брони оплачены деньгами, принятыми в этот день (по Тбилиси).

    Берём пополнения дня (касса → баланс) и смотрим по раскладке ленты, на
    какие брони они ушли. Часть денег могла лечь на баланс вперёд (бронь ещё
    не списана) или закрыть долг не за бронь — это «unallocated».
    Ответ: {day, items: [{bookingId, amount, methods}], total, toBookings,
    unallocated: [{userId, name, amount}]}. Только чтение.
    """
    from sqlmodel import select
    from app.models.balance_ledger import BalanceLedger as L
    from app.models.user import User

    now = _now_tbs(now_utc)
    day = day or now.date()
    start = datetime.combine(day, datetime.min.time()) - TZ
    end = start + timedelta(days=1)
    rows = session.exec(
        select(L.id, L.user_id, L.delta).where(
            L.reason.in_(("topup", "topup_adjust")), L.created_at >= start, L.created_at < end,
        )
    ).all()
    today_rows = {str(r.id): r for r in rows if float(r.delta or 0) > 0}
    if not today_rows:
        return {"day": day.isoformat(), "items": [], "total": 0.0, "toBookings": 0.0, "unallocated": []}
    uids = sorted({str(r.user_id) for r in today_rows.values()})
    users = session.exec(select(User.id, User.email, User.name, User.balance).where(User.id.in_(uids))).all()
    inputs = load_inputs(session, users)
    per_booking: dict[str, dict] = {}
    unallocated = []
    total = sum(_c(r.delta) for r in today_rows.values())
    for u in users:
        data = inputs.get(str(u.id))
        if not data:
            continue
        try:
            res = allocate(data["rows"], data["bookings"], balance=float(u.balance or 0))
        except Exception:  # noqa: BLE001
            logger.exception("[paid-today] клиент %s пропущен", u.id)
            continue
        mine = {rid for rid, r in today_rows.items() if str(r.user_id) == str(u.id)}
        used = 0
        for brow in res["bookings"]:
            for src in brow["sources"]:
                if src.get("rowId") in mine:
                    it = per_booking.setdefault(brow["bookingId"], {"bookingId": brow["bookingId"], "amount": 0, "methods": []})
                    it["amount"] += _c(src.get("amount") or 0)
                    m = PAID_VIA_METHOD.get({v: k for k, v in METHOD_LABELS.items()}.get(src.get("detail") or "", ""), "оплата на баланс")
                    if m not in it["methods"]:
                        it["methods"].append(m)
                    used += _c(src.get("amount") or 0)
        got = sum(_c(today_rows[rid].delta) for rid in mine)
        if got - used > 0:
            unallocated.append({"userId": str(u.id), "name": u.name or u.email, "amount": _g(got - used)})
    items = [{**v, "amount": _g(v["amount"])} for v in per_booking.values()]
    return {
        "day": day.isoformat(), "items": items, "total": _g(total),
        "toBookings": _g(sum(_c(i["amount"]) for i in items)), "unallocated": unallocated,
    }
