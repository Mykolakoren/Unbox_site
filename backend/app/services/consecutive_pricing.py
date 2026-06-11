"""Consecutive-hours discount engine.

Domain rule (per Микола, 2026-05-04):
  When a balance-paying client books N hours back-to-back (zero gap)
  in the same cabinet on the same calendar day, all bookings in that
  chain share a single duration-tier discount:
      2.00–2.99 h  → -10 %
      3.00–3.99 h  → -15 %
      4.00 h+      → -20 %
  Discounts do NOT stack — if the client has a bigger personal /
  weekly-progressive discount, that wins (`max(personal, weekly,
  consecutive)`). Subscription-paid bookings never get this discount
  (the subscription itself is already a wholesale tier).

  When a chain changes (new booking joins, or a member is cancelled
  and the chain shrinks), prices on every member are recomputed and
  the balance delta is settled with a Timeline audit row. So a client
  who cancels the second hour of a 2 h-chain gets the 10 % refund
  reverted on the surviving hour automatically.

Always idempotent — running ``recompute_user_chains_for_day`` twice
with no booking changes between runs yields zero delta. Failures
inside this module are caught at the caller layer (routes) so a
booking mutation is never blocked by a recompute glitch.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from sqlmodel import Session, select

from app.models.booking import Booking
from app.models.user import User
from app.services.pricing import PricingService
from app.services.timeline import timeline_service

logger = logging.getLogger(__name__)


def _time_to_min(t: str) -> int:
    h, m = map(int, t.split(":"))
    return h * 60 + m


def _booking_end_min(b: Booking) -> int:
    return _time_to_min(b.start_time) + int(b.duration or 0)


def find_consecutive_chains_for_user_day(
    session: Session,
    user_uuid,
    resource_id: str,
    date: datetime,
) -> List[List[Booking]]:
    """Group every confirmed balance-paid booking the user holds on
    (resource_id, calendar day of `date`) into consecutive 0-gap chains.
    Returns chains sorted earliest-first; each chain is sorted by
    start_time. A solo booking (no neighbours) is its own chain of 1.
    """
    day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start.replace(hour=23, minute=59, second=59, microsecond=999_999)

    rows = session.exec(
        select(Booking).where(
            Booking.user_uuid == user_uuid,
            Booking.resource_id == resource_id,
            Booking.date >= day_start,
            Booking.date <= day_end,
            Booking.status == "confirmed",
            Booking.payment_method == "balance",
        )
    ).all()

    if not rows:
        return []

    # Sort by start minute (handles "9:00" vs "10:00" correctly even
    # if start_time stays string-only)
    rows.sort(key=lambda b: _time_to_min(b.start_time))

    chains: List[List[Booking]] = []
    current: List[Booking] = [rows[0]]
    for b in rows[1:]:
        if _time_to_min(b.start_time) == _booking_end_min(current[-1]):
            current.append(b)
        else:
            chains.append(current)
            current = [b]
    chains.append(current)
    return chains


def _chain_total_hours(chain: List[Booking]) -> float:
    return sum(int(b.duration or 0) for b in chain) / 60.0


def recompute_chain_and_settle(
    session: Session,
    user: User,
    chain: List[Booking],
) -> dict:
    """Recompute every booking in the chain at the chain-total tier and
    settle the price delta on user.balance. Positive delta = client
    owes more (debit balance), negative = refund. Returns a structured
    log used by ``recompute_user_chains_for_day`` for the timeline row.
    """
    if not chain:
        return {"chain_size": 0, "chain_hours": 0.0, "total_delta": 0.0, "per_booking": []}

    total_hours = _chain_total_hours(chain)
    pricing = PricingService(session)
    total_delta = 0.0
    per_booking: List[dict] = []

    for b in chain:
        try:
            h, m = map(int, b.start_time.split(":"))
            start_dt = b.date.replace(hour=h, minute=m, second=0, microsecond=0)
        except Exception:
            start_dt = b.date

        new_quote = pricing.calculate_price(
            user=user,
            resource_id=b.resource_id,
            start_time=start_dt,
            duration_minutes=int(b.duration or 0),
            format_type=b.format,
            consecutive_total_hours=total_hours,
        )

        old_final = float(b.final_price or 0.0)
        new_final = float(new_quote.final_price)
        delta = round(new_final - old_final, 2)
        if abs(delta) < 0.01:
            continue

        per_booking.append({
            "id": str(b.id),
            "old_final": round(old_final, 2),
            "new_final": round(new_final, 2),
            "delta": delta,
            "applied_rule": new_quote.applied_rule,
            "discount_percent": int(new_quote.discount_percent),
        })

        b.final_price = new_final
        b.base_price = float(new_quote.base_price)
        b.applied_rule = new_quote.applied_rule
        b.discount_amount = float(new_quote.discount_amount)
        b.discount_percent = int(new_quote.discount_percent)
        b.updated_at = datetime.now()
        session.add(b)
        total_delta += delta

    if abs(total_delta) >= 0.01:
        # Positive delta = price went UP (e.g. chain shrank, lost discount) →
        # client owes more, so debit balance. Negative = refund.
        user.balance = round((user.balance or 0.0) - total_delta, 2)
        session.add(user)

    return {
        "chain_size": len(chain),
        "chain_hours": round(total_hours, 2),
        "total_delta": round(total_delta, 2),
        "per_booking": per_booking,
    }


def recompute_user_chains_for_day(
    session: Session,
    user: User,
    resource_id: str,
    date: datetime,
    actor_id: Optional[str] = None,
    actor_role: str = "system",
    reason: str = "consecutive_recompute",
) -> dict:
    """Find every chain the user has on this resource+day, recompute &
    settle each. One audit timeline row is written if anything changed.
    Caller passes the trigger context (`reason`) so the audit row reads
    e.g. ``"create_booking"`` / ``"cancel_booking"``.
    """
    chains = find_consecutive_chains_for_user_day(session, user.id, resource_id, date)
    summary = {
        "reason": reason,
        "chains": len(chains),
        "total_delta": 0.0,
        "details": [],
    }

    for chain in chains:
        result = recompute_chain_and_settle(session, user, chain)
        summary["total_delta"] += result["total_delta"]
        if result["per_booking"]:
            summary["details"].append(result)

    summary["total_delta"] = round(summary["total_delta"], 2)

    if summary["details"]:
        try:
            timeline_service.log_event(
                session=session,
                actor_id=actor_id or str(user.id),
                actor_role=actor_role,
                target_id=str(user.id),
                target_type="user",
                event_type="consecutive_pricing_recompute",
                description=(
                    f"Пересчёт по правилу «часы подряд»: {summary['chains']} "
                    f"цепоч{'ка' if summary['chains'] == 1 else 'ек'}, "
                    f"баланс {summary['total_delta']:+.2f} ₾ ({reason})"
                ),
                metadata=summary,
            )
        except Exception:
            logger.exception("[consecutive] timeline log failed")

    return summary
