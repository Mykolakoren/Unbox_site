import hashlib
from typing import List
from uuid import UUID as _UUID
from sqlmodel import Session, select
from sqlalchemy import text
from datetime import datetime, timedelta
from app.models.booking import Booking


def time_to_minutes(t_str: str) -> int:
    """Convert 'HH:MM' string to minutes since midnight. Returns -1 on invalid input."""
    try:
        h, m = map(int, t_str.split(":"))
        if not (0 <= h <= 23 and 0 <= m <= 59):
            return -1
        return h * 60 + m
    except (ValueError, AttributeError, TypeError):
        return -1


def _acquire_slot_lock(session: Session, resource_id: str, date: datetime) -> None:
    """Advisory lock scoped to (resource_id, YYYY-MM-DD).
    Held until transaction commits/rolls back. Serialises parallel writers on
    the same day+resource, preventing the phantom-row race that SELECT FOR
    UPDATE cannot fix (no existing row to lock on an empty slot).

    No-op on non-Postgres backends (dev SQLite has single-writer semantics
    so the race doesn't apply there).
    """
    dialect = session.bind.dialect.name if session.bind else ""
    if dialect != "postgresql":
        return
    key = f"{resource_id}:{date.strftime('%Y-%m-%d')}"
    # 64-bit signed int from SHA-256 prefix — stable hash across processes
    digest = hashlib.sha256(key.encode()).digest()
    as_int = int.from_bytes(digest[:8], "big", signed=True)
    session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": as_int})


def check_availability(
    session: Session,
    resource_id: str,
    date: datetime,
    start_time: str,
    duration: int,
    exclude_booking_id: str = None,
    lock_rows: bool = False,
    requester_user_uuid=None,
) -> tuple[bool, str | None]:
    """
    Check if a slot is available.
    Returns (True, None) if available, (False, reason) if overlapping.
    All confirmed bookings block the slot, including re-rent listed ones.

    lock_rows=True: take a Postgres advisory lock on (resource_id, date) BEFORE
    the read, so two parallel booking creations on the same slot serialise.
    This fixes the phantom-row race where SELECT FOR UPDATE alone would let both
    transactions see an empty slot and both insert.
    """
    # Resource-level access-window check (e.g. Neo School weekdays 18–22).
    # The frontend greys out forbidden slots, but the backend is the
    # enforcing authority. `is_within_window` returns (True, None) for any
    # resource without a window config, so unconstrained resources are
    # unaffected.
    new_start_mins = time_to_minutes(start_time)
    if new_start_mins < 0:
        return False, f"Некорректный формат времени: {start_time}"
    from app.services.resource_windows import is_within_window
    within, win_reason = is_within_window(
        resource_id, date.weekday(), start_time, duration
    )
    if not within:
        return False, win_reason

    # Take the day-scope advisory lock FIRST — before any reads.
    # This is what actually prevents the race (SELECT FOR UPDATE alone cannot).
    if lock_rows:
        _acquire_slot_lock(session, resource_id, date)

    day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    statement = select(Booking).where(
        Booking.resource_id == resource_id,
        Booking.status == "confirmed",
        Booking.date >= day_start,
        Booking.date < day_end,
    )

    if exclude_booking_id:
        # Callers hand this in as a str while Booking.id is a UUID. Postgres'
        # driver quietly adapts it; SQLite does not, so the comparison blew up
        # in the driver. Coerce once here and both dialects behave the same.
        exclude_id = exclude_booking_id
        if isinstance(exclude_id, str):
            try:
                exclude_id = _UUID(exclude_id)
            except ValueError:
                exclude_id = None
        if exclude_id is not None:
            statement = statement.where(Booking.id != exclude_id)

    day_bookings = session.exec(statement).all()

    new_start = time_to_minutes(start_time)
    if new_start < 0:
        return False, f"Некорректный формат времени: {start_time}"
    new_end = new_start + duration

    for b in day_bookings:
        existing_start = time_to_minutes(b.start_time)
        if existing_start < 0:
            continue  # Skip corrupted bookings in DB
        existing_end = existing_start + b.duration

        # Overlap: (StartA < EndB) and (EndA > StartB)
        if new_start < existing_end and new_end > existing_start:
            end_str = f"{existing_end // 60:02d}:{existing_end % 60:02d}"
            # Friendlier message: tell the client whether the conflicting
            # row is their own (very common path — they already booked
            # this slot from another tab) vs someone else's. Falls back to
            # the neutral "слот занят" wording for unknown owners.
            is_own = (
                requester_user_uuid is not None
                and b.user_uuid is not None
                and str(b.user_uuid) == str(requester_user_uuid)
            )
            if is_own:
                msg = f"У вас уже есть бронь в это время ({b.start_time}–{end_str})"
            else:
                msg = f"Слот занят ({b.start_time}–{end_str})"
            return False, msg

    return True, None


def find_re_rent_conflicts(
    session: Session,
    resource_id: str,
    date: datetime,
    start_time: str,
    duration: int,
) -> List[Booking]:
    """Find all re-rent-listed bookings that conflict with the requested slot."""
    day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    statement = select(Booking).where(
        Booking.resource_id == resource_id,
        Booking.status == "confirmed",
        Booking.is_re_rent_listed == True,  # noqa: E712
        Booking.date >= day_start,
        Booking.date < day_end,
    )

    day_bookings = session.exec(statement).all()
    conflicts = []

    new_start = time_to_minutes(start_time)
    if new_start < 0:
        return []
    new_end = new_start + duration

    for b in day_bookings:
        existing_start = time_to_minutes(b.start_time)
        if existing_start < 0:
            continue
        existing_end = existing_start + b.duration
        if new_start < existing_end and new_end > existing_start:
            conflicts.append(b)

    return conflicts
