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
    if b.payment_status != "pending":
        return False, f"not_pending(status={b.payment_status!r})"

    user = session.get(User, b.user_uuid) if b.user_uuid else None
    if not user:
        return False, "user_missing"

    method = (b.payment_method or "balance").lower()
    amount = float(b.final_price or 0)
    snapshot: float = amount

    if method == "subscription":
        sub = dict(user.subscription or {})
        rem = float(sub.get("remaining_hours") or 0)
        used = float(sub.get("used_hours") or 0)
        hrs = float(b.hours_deducted or (b.duration or 0) / 60.0)
        if rem >= hrs > 0:
            sub["remaining_hours"] = max(0.0, rem - hrs)
            sub["used_hours"] = used + hrs
            user.subscription = sub
            snapshot = hrs
        else:
            # Subscription can't cover (expired / depleted) — fall back to
            # cash balance debt so the slot stays bookable. Log so admin
            # can chase the user.
            user.balance = round((user.balance or 0) - amount, 2)
            logger.info(
                "[billing] booking %s sub-fallback to balance: had %.2fh, needed %.2fh, charged %.2f₾",
                b.id, rem, hrs, amount,
            )
            snapshot = amount
    elif method == "bonus":
        # Bonus pool is FIFO with expiry. We don't decrement the pool here —
        # the existing /bonuses path already does it on cancel/refund — to
        # keep this MVP simple we just charge balance instead. TODO: hook
        # into BonusService.consume() when we wire bonuses into deferred
        # billing properly.
        user.balance = round((user.balance or 0) - amount, 2)
        snapshot = amount
    else:
        # balance (default) and unknown methods
        user.balance = round((user.balance or 0) - amount, 2)
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
    if method != "subscription":
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


def waive_charge(session: Session, b: Booking, *, reason: str, by_user: User) -> Tuple[bool, str]:
    """Admin: cancel the charge.

    `pending` → status moves to `waived`, no money touched (cron will skip).
    `paid`    → refund the captured `charge_amount` (or `final_price` as
                fallback for legacy rows missing the snapshot), then mark
                `waived`. Subscription refunds go back to remaining_hours.

    `waived` rows can still be cancelled with no refund — the slot itself
    is still confirmed until cancel.
    """
    if not reason or not reason.strip():
        return False, "reason_required"

    if b.payment_status == "waived":
        return False, "already_waived"

    if b.payment_status == "pending":
        b.payment_status = "waived"
        b.waiver_reason = reason.strip()
        b.waived_at = datetime.utcnow()
        b.waived_by = by_user.id
        session.add(b)
        return True, "waived_pending"

    # paid (or NULL == legacy paid)
    user = session.get(User, b.user_uuid) if b.user_uuid else None
    if not user:
        return False, "user_missing"

    method = (b.payment_method or "balance").lower()
    amount = float(b.charge_amount if b.charge_amount is not None else (b.final_price or 0))

    if method == "subscription":
        sub = dict(user.subscription or {})
        rem = float(sub.get("remaining_hours") or 0)
        used = float(sub.get("used_hours") or 0)
        hrs = float(b.hours_deducted or (b.duration or 0) / 60.0)
        sub["remaining_hours"] = rem + hrs
        sub["used_hours"] = max(0.0, used - hrs)
        user.subscription = sub
    else:
        user.balance = round((user.balance or 0) + amount, 2)

    b.payment_status = "waived"
    b.waiver_reason = reason.strip()
    b.waived_at = datetime.utcnow()
    b.waived_by = by_user.id
    session.add(user)
    session.add(b)
    return True, "waived_paid_refunded"
