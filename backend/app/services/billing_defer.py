"""24-hour deferred billing for bookings.

Replaces the legacy "charge balance/subscription on create" model with:
  - On create  : if start > T+24h → payment_status=pending, no money/hours moved.
                 if start ≤ T+24h → charge immediately (legacy path), payment_status=paid.
  - At T-24h   : cron sweeps `pending` bookings where start_dt - now ≤ 24h and charges.
  - On cancel  : `pending` → just cancel; `paid` → existing >24h-refund rule.
  - Admin waive: cancel the charge with a reason. `pending` → just mark `waived`;
                 `paid` → refund + mark `waived`. Audit trail stays on the row.

TZ: bookings store Tbilisi-naive midnight `date` + "HH:MM" `start_time`. We
compute start_dt in Tbilisi and compare with Tbilisi-now (datetime.utcnow + 4h).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple

from sqlmodel import Session, select

from app.models.booking import Booking
from app.models.user import User
from app.services import subscription_pool
from app.services import wallet

logger = logging.getLogger(__name__)

DEFER_WINDOW_HOURS = 24

# Tbilisi is fixed UTC+4 (no DST). Server runs UTC; bookings carry naive Tbilisi
# `date` + "HH:MM". For comparisons we lift naive UTC `now()` into Tbilisi by
# adding 4 hours so the deltas are directly meaningful.
_TBS = timedelta(hours=4)


def booking_start_dt_tbilisi(b: Booking) -> Optional[datetime]:
    """Reconstruct the booking's start moment in Tbilisi local (naive)."""
    try:
        if not b.date or not b.start_time:
            return None
        h, m = b.start_time.split(":")
        return b.date.replace(hour=int(h), minute=int(m), second=0, microsecond=0)
    except Exception:
        return None


def tbilisi_now() -> datetime:
    return datetime.utcnow() + _TBS


def hours_until_start(b: Booking) -> Optional[float]:
    start = booking_start_dt_tbilisi(b)
    if start is None:
        return None
    delta = start - tbilisi_now()
    return delta.total_seconds() / 3600.0


def should_defer_charge(b: Booking) -> bool:
    """True iff the slot is more than DEFER_WINDOW_HOURS away from now.

    `b` only needs `date` + `start_time` populated; safe to call on a
    not-yet-persisted Booking object (for the create path). Returns False
    on parse failure so callers default to the legacy charge-now path
    rather than silently skipping a deduction.
    """
    h = hours_until_start(b)
    if h is None:
        return False
    return h > DEFER_WINDOW_HOURS


def find_due_pending(session: Session, *, lookahead_hours: float = 24.0) -> list[Booking]:
    """Return confirmed `pending` bookings whose start is within the next
    `lookahead_hours`. The cron typically passes 24 — meaning "anything that
    has crossed the T-24h gate".

    Bookings whose start has already passed are also returned: a momentarily
    stalled cron should still settle them rather than leave the user
    perpetually un-billed.
    """
    # Pull the candidate set narrowly via SQL (status + payment_status), then
    # filter by start_dt in Python — start_dt is computed from two columns
    # (`date` + `start_time` string) so it's not a single SQL expression.
    candidates = session.exec(
        select(Booking).where(
            Booking.status == "confirmed",
            Booking.payment_status == "pending",
        )
    ).all()
    cutoff = tbilisi_now() + timedelta(hours=lookahead_hours)
    out: list[Booking] = []
    for b in candidates:
        start = booking_start_dt_tbilisi(b)
        if start is None:
            continue
        if start <= cutoff:
            out.append(b)
    # Charge nearer-due first so cron iteration latency hurts the right rows.
    out.sort(key=lambda b: booking_start_dt_tbilisi(b) or datetime.max)
    return out


CREDIT_TOPUP_WARNING_RATIO = 0.8  # warn user when credit-line utilisation crosses this


def _resource_type(session: Session, resource_id: Optional[str]) -> Optional[str]:
    """Тип помещения брони ('capsule' | 'cabinet' | …) — для доп. пула абонемента."""
    if not resource_id:
        return None
    from app.models.resource import Resource
    r = session.get(Resource, resource_id)
    return getattr(r, "type", None) if r else None


# ── Деньги абонементной брони: ЕДИНОЕ ПРАВИЛО (ревизия 03.10) ────────────────
# У брони по абонементу две части:
#   * часы — hours_deducted (из них extra_hours_deducted — доп. пул);
#   * деньги — final_price: пиковая надбавка (5 ₾/ч), допы (песочница, кофе…) и
#     деньги за продление, на которое часов не хватило.
# Пока бронь оплачена часами (hours_deducted > 0), деньги = final_price, и КАЖДЫЙ
# путь списания снимает их с баланса В ТОТ ЖЕ МОМЕНТ, что и часы: создание ≤24 ч,
# крон T-24ч, одобрение горячей брони, корзина, серия, продление. Поэтому отмена
# и снятие штрафа возвращают часы → в пул, final_price → на баланс — ровно то,
# что взяли (subscription_money_taken).
# Если часов не хватило / абонемент не действует — бронь целиком деньгами
# (subscription_cash_price): hours_deducted = 0, charge_amount = снятые ₾, возврат
# — по charge_amount.
# charge_amount у брони С ЧАСАМИ для денег не читается: исторически там два
# «диалекта» — крон пишет часы, немедленный путь писал ₾. Старые брони так и
# лежат, и их возврат этим правилом не меняется (final_price, как и раньше).

# Ярлыки пула, которые stamp_booking ставит, когда бронь оплачена ЧАСАМИ
# (pool_label(h, x) → 'main' | 'extra' | 'mixed'; при 0 часов — None).
_HOURS_POOL_LABELS = ("main", "extra", "mixed")


def subscription_hours_held(b: Booking) -> float:
    """Сколько часов абонемента держит бронь по абонементу.

    hours_deducted > 0 — оно и есть. Старые брони серий (ревизия 03.10, прод
    b894240e): крон снимал часы и ставил пул (hours_pool = main/extra/mixed), но
    hours_deducted оставался 0/None, а снимок часов лежал в charge_amount. Такая
    бронь оплачена ЧАСАМИ: часы = charge_amount (не больше длительности брони).
    hours_pool пустой при 0 часов (stamp_booking(b, 0, 0) пишет None) — бронь
    ушла в деньги, часов 0."""
    h = float(b.hours_deducted or 0)
    if h > 0:
        return h
    if (getattr(b, "hours_pool", None) or "") in _HOURS_POOL_LABELS and float(b.charge_amount or 0) > 0:
        cap = float(b.duration or 0) / 60.0 if b.duration else float(b.charge_amount)
        # Снимок часов не бывает больше длительности брони: charge_amount = 36
        # у брони 2 ч — это деньги (₾), а не часы. Такую строку считаем
        # денежной, даже если ярлык пула по ошибке остался (ревизия 04.10).
        if b.duration and float(b.charge_amount) > cap + 0.01:
            return 0.0
        return round(min(float(b.charge_amount), cap), 4)
    return 0.0


def heal_legacy_subscription_hours(b: Booking) -> None:
    """Старая «часовая» бронь (часы сняты, hours_deducted = 0/None) — дописать
    часы в бронь, чтобы возврат и правки работали с часами, а не с деньгами.
    Только в памяти: в базу уйдёт вместе с правкой, которая её вызвала."""
    if (b.payment_method or "").lower() != "subscription" or float(b.hours_deducted or 0) > 0:
        return
    held = subscription_hours_held(b)
    if held > 0:
        b.hours_deducted = held
        subscription_pool.stamp_booking(b, held, b.extra_hours_deducted)


def subscription_money_due(final_price) -> float:
    """Сколько ₾ снять с баланса вместе с часами абонемента: вся денежная часть
    брони (пик + допы) — её final_price. Отрицательной не бывает."""
    try:
        return round(max(0.0, float(final_price or 0)), 2)
    except (TypeError, ValueError):
        return 0.0


def subscription_money_taken(b: Booking) -> float:
    """Сколько ₾ реально снято за денежную часть абонементной брони, оплаченной
    часами (см. правило выше) — столько и возвращают отмена и снятие штрафа."""
    return subscription_money_due(b.final_price)


def subscription_cash_price(session: Session, user: User, b: Booking) -> float:
    """Цена абонементной брони ДЕНЬГАМИ — когда часов не хватило или абонемент не
    действует (запасной путь крона T-24ч и одобрения горячей брони).

    Аренда — движком на момент списания (скидка тарифа SUBSCRIPTION_DISCOUNT
    остаётся, покрытие часами выключено — иначе при «почти хватает» часов
    котировка вернула бы 0 ₾ и комната ушла бы бесплатно) + допы, уже входящие в
    цену брони (раньше выпадали: песочница при нехватке часов была бесплатной).
    Бросает исключение, если цену посчитать нельзя — вызывающий решает, что делать
    (крон оставляет бронь pending и шлёт алерт, одобрение отказывает)."""
    from app.services.pricing import PricingService, booking_extras_money
    hrs = float(b.hours_deducted or (b.duration or 0) / 60.0)
    start_dt = booking_start_dt_tbilisi(b) or b.date
    breakdown = PricingService(session).calculate_price(
        user=user,
        resource_id=b.resource_id,
        start_time=start_dt,
        duration_minutes=int(b.duration or round(hrs * 60)),
        format_type=(b.format or "individual"),
        exclude_booking_id=str(b.id) if b.id else None,
        subscription_hours_cover=False,
    )
    return round(float(breakdown.final_price or 0) + booking_extras_money(b), 2)


def settle_pending_charge(session: Session, b: Booking) -> Tuple[bool, str]:
    """Apply the deferred charge to a `pending` booking.

    Returns (success, reason). Success means payment_status is now `paid`.
    Reasons strings: `ok` | `ok_topup_warn` (charged + 80%-utilization warn)
    | `ok_over_limit` (charged but exceeded credit_limit; user/admin alerted)
    | `not_pending` | `user_missing`.

    Strategy by payment_method:
      - balance      : balance -= final_price; allowed to go negative within
                       `credit_limit`. If that would breach the limit, we
                       still charge (the slot is already booked and clients
                       must not be surprised at the door), but tag the
                       result so the caller can fire a TG alert.
      - subscription : subscription.remaining_hours -= hours_deducted; if pool
                       expired or insufficient → fall back to balance debt.
      - bonus        : try bonus pool, fall back to balance debt.
      - else (cash, etc.): no-op, just mark paid (record-keeping).

    Caller commits.
    """
    # ── Атомарный claim против двойного списания ──
    # Раньше проверка ниже читала payment_status БЕЗ блокировки строки: два
    # прогона крона внахлёст (или ручной запуск поверх крона) читали 'pending'
    # оба и списывали ОДНУ бронь дважды, без возврата (12 случаев 21.07–07.08).
    # Перечитываем строку брони с FOR UPDATE (populate_existing — чтобы лок
    # реально ушёл в БД, а не вернулся кэш из identity-map): второй прогон
    # упрётся в блокировку, дождётся коммита первого и увидит 'paid' → пропустит.
    # Лок снимается commit'ом (успех) или rollback'ом вызывающего (пропуск/ошибка).
    # На SQLite (dev/tests) FOR UPDATE — no-op, там конкуренции нет.
    b = session.exec(
        select(Booking)
        .where(Booking.id == b.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()
    if b is None:
        return False, "gone"
    if b.payment_status != "pending":
        return False, f"not_pending(status={b.payment_status!r})"

    user = session.get(User, b.user_uuid) if b.user_uuid else None
    if not user:
        return False, "user_missing"

    method = (b.payment_method or "balance").lower()
    amount = float(b.final_price or 0)
    snapshot: float = amount
    # True когда абонементная бронь не покрылась часами и ушла в баланс-долг —
    # тогда снимаем реальные деньги и проверяем кредитный лимит как для balance.
    sub_fell_back_to_balance = False

    if method == "subscription":
        # Read via subscription_pool: an admin top-up writes the camelCase pool,
        # and reading snake-only here made those hours invisible — the booking
        # then fell through to the cash fallback below and charged the client's
        # balance for hours they had already paid for.
        rem = subscription_pool.get_float(user.subscription, "remaining_hours")
        hrs = float(b.hours_deducted or (b.duration or 0) / 60.0)
        # Доп. пул (часы капсулы / «4 ч индивидуально»): раскладку «сколько из
        # доп., сколько из основного» считаем ЗДЕСЬ, по живому пулу — при
        # создании брони заранее она была только прикидкой (несколько будущих
        # броней могли «рассчитывать» на один и тот же час капсулы). Без доп.
        # пула для этой брони — ровно прежнее правило (остаток ≥ часов).
        extra = 0.0
        if subscription_pool.extra_applies(user.subscription, _resource_type(session, b.resource_id), b.format):
            _x = subscription_pool.plan_split(
                user.subscription, hrs,
                resource_type=_resource_type(session, b.resource_id), format_type=b.format,
            )
            covered = _x is not None and hrs > 0
            extra = _x or 0.0
        else:
            covered = rem >= hrs > 0
        if covered:
            user.subscription = subscription_pool.debit_hours(user.subscription, hrs, extra=extra)
            # Ревизия 03.10: снятые часы — в бронь ВСЕГДА. Раньше у старых броней
            # серий hours_deducted был 0/None (часы брались из длительности), он
            # таким и оставался — и бронь, оплаченная часами, выглядела как
            # ушедшая в деньги (отмена вернула бы 1 ₾ вместо 1 ч).
            b.hours_deducted = hrs
            subscription_pool.stamp_booking(b, hrs, extra)
            snapshot = hrs
            # Пиковая надбавка абонемента (pricing: final_price = subscription_peak_debt)
            # — это РЕАЛЬНЫЕ деньги, часами не покрывается. Немедленный путь списывает
            # её отдельно (routes ~975), а отложенный (крон) раньше не списывал —
            # Unbox недополучал ~5₾/ч на пиковых абонементных бронях, забронированных
            # заранее (>24ч). Списываем с баланса тут, как немедленный путь.
            # Ревизия 03.10: та же денежная часть (пик + допы), что снимают все
            # остальные пути — subscription_money_due.
            _money = subscription_money_due(b.final_price)
            if _money >= 0.01:
                wallet.debit(session, user, _money, reason="booking_charge",
                             description="пиковая надбавка абонемента (T-24ч)",
                             ref_type="booking", ref_id=str(b.id))
        else:
            # Subscription can't cover (expired / depleted) — fall back to
            # cash balance debt so the slot stays bookable. §5#1 fix
            # (2026-07-06): списываем РЕАЛЬНУЮ кэш-цену комнаты, пересчитанную
            # на момент списания, а не сохранённый `final_price` — у
            # абонементной брони он ≈0 (стоимость была в часах), из-за чего
            # истёкший абонемент давал бесплатную комнату.
            # Ревизия 03.10: общая функция с одобрением горячей брони; допы,
            # входящие в цену брони, больше не выпадают.
            try:
                cash_amount = subscription_cash_price(session, user, b)
            except Exception as e:
                # Аудит 2026-08-27: раньше здесь был фолбэк «спишем сохранённый
                # final_price» — у броней абонементных серий он 0₾, и падение
                # пересчёта (например, кабинет переименован/удалён за долгую
                # жизнь серии) ТИХО дарило комнату: списывалось 0 и бронь
                # помечалась paid. Теперь честный отказ: бронь остаётся pending,
                # sweep кладёт её в failures → TG-алерт админам (§5#6).
                logger.error(
                    "[billing] booking %s sub-fallback price recompute failed: %r — оставляю pending",
                    b.id, e,
                )
                return False, f"price_recompute_failed:{type(e).__name__}"
            wallet.debit(session, user, cash_amount, reason="booking_charge",
                         description="абонемент исчерпан → списание с баланса (T-24ч)",
                         ref_type="booking", ref_id=str(b.id))
            snapshot = cash_amount
            sub_fell_back_to_balance = True
            # §5#12: часы НЕ списаны (ушли в баланс) — обнуляем hours_deducted,
            # чтобы waive/refund вернул ДЕНЬГИ, а не фантомные часы в пул.
            b.hours_deducted = 0
            subscription_pool.stamp_booking(b, 0, 0)
            logger.info(
                "[billing] booking %s sub-fallback to balance: had %.2fh, needed %.2fh, charged %.2f₾ (cash-recomputed)",
                b.id, rem, hrs, cash_amount,
            )
    elif method == "bonus":
        # Бесплатные часы уже списаны при СОЗДАНИИ брони (bonus_service.
        # consume_free_hours в create_booking), и final_price там уменьшен до
        # НЕпокрытой части. Здесь просто снимаем этот остаток с баланса —
        # ровно как для balance-брони. Пул бонусов тут не трогаем.
        wallet.debit(session, user, amount, reason="booking_charge",
                     description="бонус: остаток сверх бесплатного (T-24ч)",
                     ref_type="booking", ref_id=str(b.id))
        snapshot = amount
    else:
        # balance (default) and unknown methods
        wallet.debit(session, user, amount, reason="booking_charge",
                     description="списание с баланса (T-24ч)",
                     ref_type="booking", ref_id=str(b.id))
        snapshot = amount

    b.payment_status = "paid"
    # `charged_at` — event timestamp (когда списали), не slot time. Хранится
    # в UTC-naive (intentionally — отличается от `Booking.date`, которая
    # Tbilisi-day midnight). Frontend парсит через parseUTC. Все наши гейты
    # (find_due_pending) сравнивают tbilisi_now() с booking_start_dt_tbilisi —
    # `charged_at` в эти сравнения не входит.
    b.charged_at = datetime.utcnow()
    b.charge_amount = snapshot
    session.add(user)
    session.add(b)

    # ── Credit-line utilisation classification ─────────────────────────────
    # We only consider this for cash-balance debts (subscription burns hours,
    # not credit). After the deduction:
    #   utilisation = max(0, -balance) / credit_limit
    # We tag the result so the caller can fire targeted TG alerts:
    #   * crossed 100% → over_limit (red, also pings admin)
    #   * crossed 80%  → topup_warn (amber, owner only)
    if method != "subscription" or sub_fell_back_to_balance:
        credit = float(user.credit_limit or 0)
        debt = max(0.0, -(user.balance or 0))
        if credit > 0:
            ratio = debt / credit
            if ratio > 1.0:
                return True, "ok_over_limit"
            if ratio >= CREDIT_TOPUP_WARNING_RATIO:
                return True, "ok_topup_warn"
        elif debt > 0:
            # No credit set, balance went negative → effectively over limit.
            return True, "ok_over_limit"

    return True, "ok"


def booking_refunded_money(session: Session, b: Booking) -> float:
    """Сколько ₾ по брони уже вернули клиенту при отмене (лента баланса, ref_id
    брони, reason='booking_refund'). Возвраты при отмене всегда пишутся с ref_id
    — и у старых броней тоже, поэтому «уже возвращено» по ленте надёжно."""
    from app.models.balance_ledger import BalanceLedger
    rows = session.exec(
        select(BalanceLedger).where(
            BalanceLedger.ref_type == "booking",
            BalanceLedger.ref_id == str(b.id),
            BalanceLedger.reason == "booking_refund",
        )
    ).all()
    return round(sum(float(r.delta) for r in rows if float(r.delta) > 0), 2)


def _refund_percent_from_text(desc: str, event_type: str = "booking_cancelled") -> Optional[float]:
    """Доля возврата из текста старого события отмены (до 04.10 доля политики не
    хранилась отдельным полем). Имя админа стоит В НАЧАЛЕ текста и может само
    содержать «Refund: 5%» или «возврат 30%» (ревизия 04.10), поэтому шаблон
    выбирается по типу события, привязан к своему хвосту, и берётся ПОСЛЕДНЕЕ
    совпадение:
      переаренда       — «… Owner refunded 50%, rest → Unbox income.»;
      отмена серии     — «Отмена серии: возврат 50%» (имени нет, с начала);
      одиночная отмена — «… Refund: 50%. Time to start: …»."""
    import re as _re
    if event_type == "booking_auto_cancelled_re_rent":
        found = _re.findall(r"Owner refunded (\d+(?:\.\d+)?)%, rest", desc)
    else:
        found = (_re.findall(r"^Отмена серии: возврат (\d+(?:\.\d+)?)%", desc)
                 or _re.findall(r"Refund: (\d+(?:\.\d+)?)%\. Time to start", desc))
    return (float(found[-1]) / 100.0) if found else None


def _cancel_refund_share(session: Session, b: Booking, money_base: float, refunded: float) -> float:
    """Какую долю брони вернула отмена (1.0 — всё, 0.0 — штраф 100 %).

    Отмена возвращает часы и деньги ОДНОЙ долей, поэтому если у брони есть
    деньги — доля точно по ленте. Нет денег (бронь по абонементу без пика и
    допов) — доля из события отмены в ленте событий брони (refund_percent пишут
    отмена брони, отмена серии и переаренда). Ничего не нашли — считаем, что
    вернули всё: второй раз часы не вернём.

    Доля политики — policy_refund_percent (с 04.10). В старых событиях отмены
    брони, по которой денег ещё не брали (skipped_reason = pending/waived),
    refund_percent перетёрт нулём («денег не брали»), хотя бонус-часы отмена
    вернула долей политики — тогда доля берётся из текста события («Refund:
    50%», «возврат 50%», «refunded 50%»)."""
    if money_base >= 0.01:
        return max(0.0, min(1.0, refunded / money_base))
    try:
        from app.models.timeline import TimelineEvent
        ev = session.exec(
            select(TimelineEvent)
            .where(TimelineEvent.target_id == str(b.id),
                   TimelineEvent.event_type.in_(("booking_cancelled", "booking_auto_cancelled_re_rent")))
            .order_by(TimelineEvent.timestamp.desc())
        ).first()
        if ev is not None:
            md = ev.metadata_dump or {}
            pct = md.get("policy_refund_percent")
            if pct is None and md.get("skipped_reason"):
                pct = _refund_percent_from_text(ev.description or "", ev.event_type)
            elif pct is None:
                pct = md.get("refund_percent")
            if pct is not None:
                return max(0.0, min(1.0, float(pct)))
    except Exception:
        logger.warning("[waive] booking %s: доля возврата при отмене не прочиталась", b.id, exc_info=True)
    return 1.0


def _return_gift_hour(session: Session, b: Booking, user: Optional[User], share_returned: float) -> float:
    """«Час в подарок» (applied_rule = BONUS_HOUR): бонус-час клиента погашен
    при подарке. Снятие штрафа делает бронь бесплатной — бонус-час возвращаем
    ту долю, что ещё у брони (отмена вернула свою долю). После возврата бронь
    его больше не держит: метка — просто ручная цена (MANUAL_OVERRIDE), чтобы
    отмена waived-брони не вернула его второй раз. Ревизия 04.10."""
    if (b.applied_rule or "") != "BONUS_HOUR":
        return 0.0
    back = round(1.0 * (1.0 - share_returned), 2)
    if back > 0 and user is not None:
        from app.services.bonus_service import refund_free_hours
        refund_free_hours(session, user.id, back, reason="Снятие штрафа: «Час в подарок»")
    else:
        back = 0.0
    b.applied_rule = "MANUAL_OVERRIDE"
    return back


def waive_charge(session: Session, b: Booking, *, reason: str, by_user: User,
                 result: Optional[dict] = None) -> Tuple[bool, str]:
    """Admin: cancel the charge.

    `pending` → status moves to `waived`, no money touched (cron will skip).
    `paid`    → вернуть то, что бронь ЕЩЁ держит, и пометить `waived`.

    Ревизия 03.10: снятие штрафа после отмены возвращало всё второй раз (бронь
    20 ₾ отменили со 100 % возвратом, потом waive — ещё +20 ₾). Теперь:
      деньги = взято (единое правило: у брони с часами — final_price, у денежной
               и ушедшей в деньги — charge_amount) − уже возвращено отменой
               (лента, ref_id брони);
      часы   = hours_deducted × (1 − доля, которую вернула отмена).
    Штраф после отмены с 0 % возврата так и снимается целиком (прощение штрафа);
    у неотменённой брони «уже возвращено» = 0 — как раньше.
    `result` (необязательно) — сюда кладём, сколько вернули (₾ и ч) для текста.
    """
    if not reason or not reason.strip():
        return False, "reason_required"

    if b.payment_status == "waived":
        return False, "already_waived"

    # Срочная бронь, ждущая подтверждения, ничего не держит (часы и деньги
    # снимаются при одобрении) — снимать нечего, а «снят штраф» + одобрение
    # давали разное: денежная всё равно списывалась (100 → 80), бонусная
    # выходила бесплатной с возвращённым часом (ревизия 04.10). Решение админа
    # здесь — подтвердить или отклонить; штраф снимается после подтверждения.
    if b.status == "pending_approval":
        return False, "pending_approval"

    if b.payment_status == "pending":
        # Денег по брони ещё не брали (их возьмёт крон) — их и не возвращаем.
        # Но у бонусной брони бонус-часы сняты СРАЗУ при создании: снятие
        # штрафа делает бронь бесплатной, и бонус-часы возвращаются ту долю,
        # что ещё у брони (как в оплаченной ветке ниже). Ревизия 04.10: раньше
        # здесь был ранний выход — бронь бесплатна, а бонус-час сгорел.
        bonus_back = 0.0
        if (b.payment_method or "").lower() == "bonus" and float(b.hours_deducted or 0) > 0:
            owner = session.get(User, b.user_uuid) if b.user_uuid else None
            share_returned = _cancel_refund_share(session, b, 0.0, 0.0) if b.status == "cancelled" else 0.0
            bonus_back = round(float(b.hours_deducted) * (1.0 - share_returned), 4)
            if bonus_back > 0 and owner is not None:
                from app.services.bonus_service import refund_free_hours
                refund_free_hours(session, owner.id, bonus_back, reason="Снятие штрафа за бронь")
            elif owner is None:
                bonus_back = 0.0
            # Бронь больше не держит бонус-часов — отмена waived-брони не
            # вернёт их второй раз.
            b.hours_deducted = 0.0
            subscription_pool.stamp_booking(b, 0, 0)
        if (b.applied_rule or "") == "BONUS_HOUR":
            _owner = session.get(User, b.user_uuid) if b.user_uuid else None
            _share = _cancel_refund_share(session, b, 0.0, 0.0) if b.status == "cancelled" else 0.0
            bonus_back = round(bonus_back + _return_gift_hour(session, b, _owner, _share), 4)
        b.payment_status = "waived"
        b.waiver_reason = reason.strip()
        b.waived_at = datetime.utcnow()
        b.waived_by = by_user.id
        session.add(b)
        if result is not None:
            result.update(money=0.0, hours=0.0, bonus_hours=bonus_back,
                          cancelled=(b.status == "cancelled"))
        return True, "waived_pending"

    # paid (or NULL == legacy paid)
    user = session.get(User, b.user_uuid) if b.user_uuid else None
    if not user:
        return False, "user_missing"

    method = (b.payment_method or "balance").lower()
    heal_legacy_subscription_hours(b)
    # §5#12: часы — только у абонементной брони, где они реально списаны
    # (hours_deducted>0); ушедшая в баланс-долг (hours_deducted=0) — деньгами.
    hours_used = float(b.hours_deducted or 0) if method == "subscription" else 0.0
    if hours_used > 0:
        money_base = subscription_money_taken(b)
    else:
        money_base = round(float(b.charge_amount if b.charge_amount is not None else (b.final_price or 0)), 2)
    refunded = booking_refunded_money(session, b)
    money_back = round(max(0.0, money_base - refunded), 2)
    share_returned = _cancel_refund_share(session, b, money_base, refunded) if b.status == "cancelled" else 0.0
    hours_back = round(hours_used * (1.0 - share_returned), 4)
    extra_back = round(subscription_pool.booking_extra(b) * (1.0 - share_returned), 4)

    if hours_back > 0 and subscription_pool.hours_return_allowed(user.subscription, b.date):
        # Часы — ровно в тот пул, откуда сняты (доп. / основной).
        user.subscription = subscription_pool.credit_hours(
            user.subscription, hours_back, extra=extra_back,
            kind=subscription_pool.kind_for_resource(_resource_type(session, b.resource_id)),
        )
    elif hours_back > 0:
        hours_back = 0.0  # неделя недельного пакета прошла — часы сгорели
    # Бонусная бронь: бонус-часы потрачены при создании — снятие штрафа
    # возвращает их ту долю, что ещё у брони (после отмены 0 % — все, после 50 %
    # — половину). Ревизия 03.10: раньше waive их не возвращал вовсе. Бронь
    # больше не держит бонус-часов — иначе отмена waived-брони вернула бы их
    # второй раз.
    bonus_back = 0.0
    if method == "bonus" and float(b.hours_deducted or 0) > 0:
        bonus_back = round(float(b.hours_deducted) * (1.0 - share_returned), 4)
        if bonus_back > 0:
            from app.services.bonus_service import refund_free_hours
            refund_free_hours(session, user.id, bonus_back, reason="Снятие штрафа за бронь")
        b.hours_deducted = 0.0
        subscription_pool.stamp_booking(b, 0, 0)
    bonus_back = round(bonus_back + _return_gift_hour(session, b, user, share_returned), 4)
    if money_back >= 0.01:
        # Аудит 2026-08-27: у абонементной брони это пиковая надбавка/допы —
        # деньги, снятые отдельно от часов; у денежной — сама цена.
        wallet.credit(session, user, money_back, reason="booking_refund",
                      description=("снятие штрафа (waive) — возврат пиковой надбавки" if hours_used > 0
                                   else "снятие штрафа (waive) — возврат на баланс"),
                      ref_type="booking", ref_id=str(b.id), actor=by_user)
    if result is not None:
        result.update(money=money_back, hours=hours_back, bonus_hours=bonus_back,
                      cancelled=(b.status == "cancelled"))

    b.payment_status = "waived"
    b.waiver_reason = reason.strip()
    b.waived_at = datetime.utcnow()
    b.waived_by = by_user.id
    session.add(user)
    session.add(b)
    return True, "waived_paid_refunded"
