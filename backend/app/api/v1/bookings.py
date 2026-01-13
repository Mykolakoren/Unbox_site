from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select, Session
from app.api import deps
from app.models.booking import Booking, BookingCreate, BookingRead
from app.models.user import User

router = APIRouter()

@router.get("/me", response_model=List[BookingRead])
def read_my_bookings(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """
    Retrieve current user's bookings.
    """
    statement = select(Booking).where(
        (Booking.user_uuid == current_user.id) | 
        (Booking.user_id == current_user.email)
    ).offset(skip).limit(limit)
    bookings = session.exec(statement).all()
    return bookings

from app.services.booking import check_availability

@router.get("", response_model=List[BookingRead])
@router.get("/", response_model=List[BookingRead], include_in_schema=False)
def read_bookings(
    session: Session = Depends(deps.get_session),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Retrieve all bookings (Admin only).
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    bookings = session.exec(select(Booking).offset(skip).limit(limit)).all()
    return bookings

@router.get("/public", response_model=List[BookingRead])
@router.get("/public/", response_model=List[BookingRead], include_in_schema=False)
def read_public_bookings(
    session: Session = Depends(deps.get_session),
    start_date: str = None, 
    end_date: str = None
) -> Any:
    """
    Retrieve ALL confirmed bookings for availability display (Public).
    Hides user details automatically via response_model selection or we can use a slimmer model.
    """
    # TODO: Filter by date range for optimization
    query = select(Booking).where(Booking.status == "confirmed")
    bookings = session.exec(query).all()
    return bookings

@router.post("", response_model=BookingRead)
@router.post("/", response_model=BookingRead, include_in_schema=False)
def create_booking(
    *,
    session: Session = Depends(deps.get_session),
    booking_in: BookingCreate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Create new booking.
    """
    # Check availability
    is_available = check_availability(
        session=session,
        resource_id=booking_in.resource_id,
        date=booking_in.date,
        start_time=booking_in.start_time,
        duration=booking_in.duration
    )
    
    if not is_available:
        raise HTTPException(status_code=400, detail="Time slot is already booked")

    # Determine Booking Owner
    booking_owner = current_user
    if current_user.is_admin and booking_in.target_user_id:
        # Try to find target user
        from uuid import UUID
        target = None
        try:
             target = session.get(User, UUID(booking_in.target_user_id))
        except ValueError:
             pass
        
        if not target:
             target = session.exec(select(User).where(User.email == booking_in.target_user_id)).first()
             
        if target:
             booking_owner = target
    
    # Payment Processing (Charge booking_owner)
    if booking_in.payment_method == 'subscription':
        # Check subscription
        if not booking_owner.subscription or booking_owner.subscription.get('remainingHours', 0) < (booking_in.duration / 60):
             raise HTTPException(status_code=400, detail="Insufficient subscription hours")
        
        # Deduct hours
        new_sub = booking_owner.subscription.copy()
        deduction = booking_in.duration / 60
        new_sub['remainingHours'] -= deduction
        booking_owner.subscription = new_sub
        
    else:
        # Balance deduction (allow negative for credit)
        booking_owner.balance -= booking_in.final_price

    session.add(booking_owner)
    
    booking = Booking.from_orm(booking_in)
    booking.user_uuid = booking_owner.id
    booking.user_id = booking_owner.email 
    
    if booking.payment_method == 'subscription':
         booking.hours_deducted = booking.duration / 60
    
    session.add(booking)
    session.commit()
    session.refresh(booking)
    return booking

@router.get("/{booking_id}", response_model=BookingRead)
def read_booking(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Get booking by ID.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")
        
    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Access control: Owner or Admin
    if booking.user_uuid != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    return booking

@router.delete("/{booking_id}", response_model=BookingRead)
def cancel_booking(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Cancel a booking (Soft delete or Status change).
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")
        
    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
        
    # Access control
    if booking.user_uuid != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    if booking.status == "cancelled":
        return booking

    # Refund Logic
    if booking.payment_method == 'subscription':
        if current_user.subscription:
            new_sub = current_user.subscription.copy()
            refund = booking.hours_deducted or (booking.duration / 60)
            new_sub['remainingHours'] += refund
            current_user.subscription = new_sub
            session.add(current_user)
    else:
        current_user.balance += booking.final_price
        session.add(current_user)

    booking.status = "cancelled"
    booking.cancellation_reason = "User cancelled" # TODO: Allow passing reason
    booking.cancelled_by = current_user.email
    
    session.add(booking)
    session.commit()
    session.refresh(booking)
    
    # --- AUDIT LOGGING ---
    from app.services.timeline import timeline_service
    from datetime import datetime, timedelta
    
    # Calculate time to booking
    booking_start = datetime.fromisoformat(booking.date + "T" + booking.start_time)
    hours_until_start = (booking_start - datetime.utcnow()).total_seconds() / 3600
    is_late_cancellation = hours_until_start < 24
    
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(booking.id),
        target_type="booking",
        event_type="booking_cancelled",
        description=f"Booking cancelled by {current_user.name} ({current_user.role}). Time to start: {hours_until_start:.1f}h",
        metadata={
            "is_late_cancellation": is_late_cancellation,
            "hours_until_start": hours_until_start,
            "refunded_amount": booking.final_price if booking.payment_method != 'subscription' else 0,
            "refunded_hours": booking.hours_deducted if booking.payment_method == 'subscription' else 0
        }
    )
    # ---------------------
    
    return booking
