from sqlmodel import Session, select
from datetime import datetime, timedelta
from app.models.booking import Booking

def time_to_minutes(t_str: str) -> int:
    h, m = map(int, t_str.split(':'))
    return h * 60 + m

def check_availability(
    session: Session, 
    resource_id: str, 
    date: datetime, 
    start_time: str, 
    duration: int,
    exclude_booking_id: str = None
) -> tuple[bool, str | None]:
    """
    Check if a slot is available.
    Returns True if available, False if overlapping.
    """
    # 1. Get all confirmed bookings for this resource and date
    # Note: date comparison needs to be precise. 
    # Usually frontend sends date as midnight? Or specific time?
    # Backend model `date` is datetime. 
    # We should compare the date part.
    
    # SQLite might need string comparison for dates if not strict. 
    # But SQLModel should handle it if passed correctly.
    # Let's assume date is passed as datetime object representing the day.
    
    # Filter by resource and status
    # Handling NULLs for boolean field (SQLite/Postgres compatibility)
    from sqlmodel import or_
    statement = select(Booking).where(
        Booking.resource_id == resource_id,
        Booking.status == "confirmed",
        or_(Booking.is_re_rent_listed == False, Booking.is_re_rent_listed == None)
    )
    
    # Exclude specific booking (for updates)
    if exclude_booking_id:
        statement = statement.where(Booking.id != exclude_booking_id)
        
    all_bookings = session.exec(statement).all()
    
    # Filter by date in python to be safe with time components (or enforce midnight in DB)
    target_date_str = date.strftime("%Y-%m-%d")
    
    day_bookings = [
        b for b in all_bookings 
        if b.date.strftime("%Y-%m-%d") == target_date_str
    ]
    
    new_start = time_to_minutes(start_time)
    new_end = new_start + duration
    
    for b in day_bookings:
        existing_start = time_to_minutes(b.start_time)
        existing_end = existing_start + b.duration
        
        # Check overlap
        # (StartA < EndB) and (EndA > StartB)
        if new_start < existing_end and new_end > existing_start:
            # print(f"DEBUG: Conflict found! New: {new_start}-{new_end} vs Existing: {existing_start}-{existing_end} (ID: {b.id}, Date: {b.date})")
            return False, f"Conflict with booking {b.id} ({b.start_time}-{existing_end // 60}:{existing_end % 60:02d})"
            
    return True, None
