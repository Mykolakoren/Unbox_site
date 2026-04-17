"""Waitlist notifier — when a booking slot frees up, tell everyone waiting.

Called from booking mutations (cancel, reschedule away, toggle re-rent).
Each call is fire-and-forget: exceptions are logged, never propagated — a
booking cancellation must succeed even if Telegram is down.

Design:
- An entry matches a freed slot iff:
    (resource_id matches) AND (date = same calendar day) AND
    (waitlist window overlaps the freed window).
- Matched entries are marked `fulfilled` so the same user isn't pinged twice
  if the slot gets booked-and-re-cancelled later.
- Also writes an in-app Notification so users who haven't linked TG still see
  the alert in the web UI next time they log in.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlmodel import Session, select

from app.models.booking import Booking
from app.models.location import Location
from app.models.notification import Notification
from app.models.resource import Resource
from app.models.user import User
from app.models.waitlist import Waitlist
from app.services.telegram import telegram_service

logger = logging.getLogger(__name__)


def _time_to_minutes(t: str) -> int:
    try:
        h, m = map(int, t.split(":"))
        return h * 60 + m
    except Exception:
        return -1


def _booking_end_time(booking: Booking) -> str:
    start = _time_to_minutes(booking.start_time)
    if start < 0:
        return booking.start_time
    end = start + int(booking.duration or 0)
    return f"{end // 60:02d}:{end % 60:02d}"


def notify_waitlist_for_freed_slot(session: Session, booking: Booking) -> int:
    """Find active waitlist entries covering this slot and notify their users.

    Returns the number of entries marked fulfilled. Never raises.
    """
    try:
        freed_start = _time_to_minutes(booking.start_time)
        if freed_start < 0 or not booking.duration:
            return 0
        freed_end = freed_start + int(booking.duration)

        day_start = booking.date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)

        matches = session.exec(
            select(Waitlist).where(
                Waitlist.resource_id == booking.resource_id,
                Waitlist.status == "active",
                Waitlist.date >= day_start,
                Waitlist.date < day_end,
            )
        ).all()

        if not matches:
            return 0

        # Preload resource + location for rendering
        resource = session.get(Resource, booking.resource_id)
        res_name = (resource.name if resource else booking.resource_id) or booking.resource_id
        location = None
        if resource and resource.location_id:
            location = session.get(Location, resource.location_id)
        loc_name = (location.name if location else None) or None

        end_time_str = _booking_end_time(booking)

        # Overlap check: waitlist [w_start, w_end) intersects freed [freed_start, freed_end)
        fulfilled_count = 0
        for entry in matches:
            w_start = _time_to_minutes(entry.start_time)
            w_end = _time_to_minutes(entry.end_time)
            if w_start < 0 or w_end <= w_start:
                continue
            if not (w_start < freed_end and w_end > freed_start):
                continue

            # Resolve the waitlisted user
            user = _resolve_user(session, entry)
            if not user:
                # Orphan entry — clean it up so we don't retry forever
                entry.status = "cancelled"
                session.add(entry)
                continue

            # 1) Telegram (best-effort)
            try:
                telegram_service.send_slot_available(
                    chat_id=user.telegram_id or "",
                    user_name=user.name,
                    resource_name=res_name,
                    location_name=loc_name,
                    date=booking.date,
                    start_time=entry.start_time,
                    end_time=entry.end_time,
                )
            except Exception as e:  # pragma: no cover — defensive
                logger.warning("[waitlist] TG send failed: %r", e)

            # 2) In-app notification (always, even if TG is linked —
            #    it serves as an audit trail and reaches web-only users).
            try:
                day_label = booking.date.strftime("%d.%m")
                notif = Notification(
                    type="slot_freed",
                    title="Слот освободился!",
                    description=(
                        f"{res_name} · {day_label} {entry.start_time}–{entry.end_time} "
                        "— успейте забронировать."
                    ),
                    recipient_id=str(user.id),
                    icon="Bell",
                    link="/booking",
                )
                session.add(notif)
            except Exception as e:
                logger.warning("[waitlist] in-app notif failed: %r", e)

            # Mark fulfilled so we don't spam the same user later
            entry.status = "fulfilled"
            session.add(entry)
            fulfilled_count += 1

        if fulfilled_count:
            session.commit()
        return fulfilled_count

    except Exception as e:
        # Never break the caller's booking mutation
        logger.error("[waitlist] notify error: %r", e, exc_info=True)
        return 0


def _resolve_user(session: Session, entry: Waitlist) -> Optional[User]:
    if entry.user_uuid:
        u = session.get(User, entry.user_uuid)
        if u:
            return u
    if entry.user_id:
        u = session.exec(select(User).where(User.email == entry.user_id)).first()
        if u:
            return u
    return None
