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

    Matching is **location-scoped**: a subscription on Кабинет 5 in Unbox UNI
    fires when ANY UNI cabinet (5/6/7/8/9, capsules) frees up at the same
    time. Specialists asked for this — they don't actually care which exact
    room opens, they care about the time slot at the branch.

    Each match is committed separately so a mid-loop crash can't leave a
    user double-notified later (the commit moves the row to `fulfilled`
    immediately after the TG/in-app side-effects succeed).

    Returns the number of entries marked fulfilled. Never raises.
    """
    try:
        freed_start = _time_to_minutes(booking.start_time)
        if freed_start < 0 or not booking.duration:
            return 0
        freed_end = freed_start + int(booking.duration)

        day_start = booking.date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)

        # Resolve the freed booking's location once. Waitlist entries are
        # stored anchored to a specific resource_id — to broaden to the
        # whole branch we collect every resource in the same location and
        # match on that set.
        freed_resource = session.get(Resource, booking.resource_id)
        freed_location_id = freed_resource.location_id if freed_resource else None
        if freed_location_id:
            sibling_resources = session.exec(
                select(Resource).where(Resource.location_id == freed_location_id)
            ).all()
            sibling_ids = [r.id for r in sibling_resources] or [booking.resource_id]
        else:
            # Resource has no location (legacy / orphan) — fall back to the
            # narrower exact-resource match so we never widen unsafely.
            sibling_ids = [booking.resource_id]

        matches = session.exec(
            select(Waitlist).where(
                Waitlist.resource_id.in_(sibling_ids),  # type: ignore[attr-defined]
                Waitlist.status == "active",
                Waitlist.date >= day_start,
                Waitlist.date < day_end,
            )
        ).all()

        if not matches:
            return 0

        res_name = (freed_resource.name if freed_resource else booking.resource_id) or booking.resource_id
        location = session.get(Location, freed_location_id) if freed_location_id else None
        loc_name = (location.name if location else None) or None

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
                try:
                    session.commit()
                except Exception:
                    session.rollback()
                continue

            # 1) Telegram (best-effort)
            tg_sent = False
            try:
                tg_sent = bool(telegram_service.send_slot_available(
                    chat_id=user.telegram_id or "",
                    user_name=user.name,
                    resource_name=res_name,
                    location_name=loc_name,
                    date=booking.date,
                    start_time=entry.start_time,
                    end_time=entry.end_time,
                ))
            except Exception as e:  # pragma: no cover — defensive
                logger.warning("[waitlist] TG send failed: %r", e)

            # 1b) If we couldn't reach the user via TG (no chat_id linked),
            # ping the admin chat so someone can call/text them manually.
            # Without this fallback the user's only signal is the in-app
            # toast — easy to miss before the slot is taken again.
            if not tg_sent and not user.telegram_id:
                try:
                    day_label = booking.date.strftime("%d.%m")
                    where_label = f"{loc_name} · {res_name}" if loc_name else res_name
                    telegram_service.send_admin_event(
                        event="waitlist_user_no_tg",
                        fields={
                            "Клиент": user.email or user.name or str(user.id),
                            "Контакт": user.phone or "—",
                            "Слот": f"{where_label} · {day_label} {entry.start_time}–{entry.end_time}",
                            "Действие": "Позвоните — TG не привязан, сам не узнает",
                        },
                    )
                except Exception:
                    logger.warning("[waitlist] admin no-tg alert failed", exc_info=True)

            # 2) In-app notification (always, even if TG is linked —
            #    it serves as an audit trail and reaches web-only users).
            try:
                day_label = booking.date.strftime("%d.%m")
                where_label = f"{loc_name} · {res_name}" if loc_name else res_name
                notif = Notification(
                    type="slot_freed",
                    title="Слот освободился!",
                    description=(
                        f"{where_label} · {day_label} {entry.start_time}–{entry.end_time} "
                        "— успейте забронировать."
                    ),
                    recipient_id=str(user.id),
                    icon="Bell",
                    link="/dashboard/waitlist",
                )
                session.add(notif)
            except Exception as e:
                logger.warning("[waitlist] in-app notif failed: %r", e)

            # Mark fulfilled — committed per-iteration so a crash mid-loop
            # can't double-notify (TG already went out, but the row was
            # not yet flipped from active).
            entry.status = "fulfilled"
            session.add(entry)
            try:
                session.commit()
                fulfilled_count += 1
            except Exception as e:
                session.rollback()
                logger.warning("[waitlist] commit failed for entry %s: %r", entry.id, e)

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
