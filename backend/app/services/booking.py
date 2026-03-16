from typing import List
from sqlmodel import Session, select
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


def check_availability(
    session: Session,
    resource_id: str,
    date: datetime,
    start_time: str,
    duration: int,
    exclude_booking_id: str = None,
) -> tuple[bool, str | None]:
    """
    Check if a slot is available.
    Returns (True, None) if available, (False, reason) if overlapping.
    All confirmed bookings block the slot, including re-rent listed ones.
    """
    day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    statement = select(Booking).where(
        Booking.resource_id == resource_id,
        Booking.status == "confirmed",
        Booking.date >= day_start,
        Booking.date < day_end,
    )

    if exclude_booking_id:
        statement = statement.where(Booking.id != exclude_booking_id)

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
            return False, f"Conflict with booking {b.id} ({b.start_time}-{existing_end // 60}:{existing_end % 60:02d})"

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
