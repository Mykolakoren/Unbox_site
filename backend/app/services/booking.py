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
) -> bool:
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
    statement = select(Booking).where(
        Booking.resource_id == resource_id,
        Booking.status == "confirmed"
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
            return False # Overlap found
            
    return True
