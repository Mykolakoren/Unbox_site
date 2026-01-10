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
    statement = select(Booking).where(Booking.user_uuid == current_user.id).offset(skip).limit(limit)
    bookings = session.exec(statement).all()
    return bookings

from app.services.booking import check_availability

@router.get("/", response_model=List[BookingRead])
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

@router.post("/", response_model=BookingRead)
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
    
    # Payment Processing
    if booking_in.payment_method == 'subscription':
        # Check subscription
        if not current_user.subscription or current_user.subscription.get('remainingHours', 0) < (booking_in.duration / 60):
             raise HTTPException(status_code=400, detail="Insufficient subscription hours")
        
        # Deduct hours
        new_sub = current_user.subscription.copy()
        deduction = booking_in.duration / 60
        new_sub['remainingHours'] -= deduction
        current_user.subscription = new_sub
        
        # We need to set hours_deducted on the booking object
        # but booking_in is a Pydantic model. 
        # We'll set it on the ORM object below.
        
    else:
        # Balance deduction (allow negative for credit)
        current_user.balance -= booking_in.final_price

    session.add(current_user)
    
    booking = Booking.from_orm(booking_in)
    booking.user_uuid = current_user.id
    booking.user_id = current_user.email # Legacy support
    
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
    booking = session.get(Booking, booking_id)
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
    booking = session.get(Booking, booking_id)
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
    booking.cancellation_reason = "User cancelled"
    booking.cancelled_by = current_user.email
    
    session.add(booking)
    session.commit()
    session.refresh(booking)
    return booking
