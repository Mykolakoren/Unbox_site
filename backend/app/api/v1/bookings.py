from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select, Session
from app.api import deps
from app.models.booking import Booking, BookingCreate, BookingRead
from app.models.user import User
from datetime import datetime
from uuid import UUID
from app.services.google_calendar import gcal_service
from app.services.timeline import timeline_service

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
        # (Booking.user_uuid == current_user.id) | # Disable until DB migration
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
    query = select(Booking).where(Booking.status == "confirmed")
    
    if start_date:
        try:
             # Assuming YYYY-MM-DD
             s_date = datetime.strptime(start_date, "%Y-%m-%d")
             query = query.where(Booking.date >= s_date)
        except ValueError:
             pass # Ignore invalid date
             
    if end_date:
        try:
             e_date = datetime.strptime(end_date, "%Y-%m-%d")
             # Include the end date fully (up to 23:59:59)
             e_date = e_date.replace(hour=23, minute=59, second=59)
             query = query.where(Booking.date <= e_date)
        except ValueError:
             pass

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
    # Import service here or at top (using local for safety in this edit)
    # from app.services.google_calendar import gcal_service (Moved to top)

    try:
        # Check availability
        # Check availability
        is_available, reason = check_availability(
            session=session,
            resource_id=booking_in.resource_id,
            date=booking_in.date,
            start_time=booking_in.start_time,
            duration=booking_in.duration
        )
        
        if not is_available:
            raise HTTPException(status_code=400, detail=f"Time slot is already booked: {reason}")
    
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
        
        # ---------------------------------------------------------
        # Pricing & Payment Logic (Using PricingService)
        # ---------------------------------------------------------
        from app.services.pricing import PricingService
        from datetime import datetime, time
        
        # Combine date and time
        # booking_in.date is datetime, booking_in.start_time is "HH:MM"
        # We need a full datetime for PricingService to check Hot Booking etc.
        try:
            h, m = map(int, booking_in.start_time.split(':'))
            # Combine booking_in.date (which might be just date part effectively) with time
            start_dt = booking_in.date.replace(hour=h, minute=m, second=0, microsecond=0)
        except Exception:
            # Fallback if parsing fails (shouldn't happen with valid input)
            start_dt = booking_in.date
            
        pricing_service = PricingService(session)
        quote = pricing_service.calculate_price(
            user=booking_owner,
            resource_id=booking_in.resource_id,
            start_time=start_dt,
            duration_minutes=booking_in.duration,
            format_type=booking_in.format
        )
        
        # Validate Payment Method compatibility
        if booking_in.payment_method == 'subscription':
            if quote.applied_rule != 'SUBSCRIPTION':
                # User wanted subscription, but PricingService says not applicable
                # (Likely insufficient hours or format mismatch)
                raise HTTPException(status_code=400, detail="Insufficient subscription hours or invalid format for plan")
            
            # Deduct Hours
            if booking_owner.subscription:
                new_sub = booking_owner.subscription.copy()
                rem = new_sub.get('remaining_hours', new_sub.get('remainingHours', 0))
                used = new_sub.get('used_hours', new_sub.get('usedHours', 0))
                
                new_sub['remaining_hours'] = max(0, float(rem) - quote.hours_deducted)
                new_sub['used_hours'] = float(used) + quote.hours_deducted
                
                # Cleanup old camelCase if present to keep DB clean
                if 'remainingHours' in new_sub: del new_sub['remainingHours']
                if 'usedHours' in new_sub: del new_sub['usedHours']
                
                booking_owner.subscription = new_sub
            
        else:
            # Payment Method: Balance (or others)
            # Check if user has enough funds (balance + credit limit)
            available_funds = booking_owner.balance + booking_owner.credit_limit
            if available_funds < quote.final_price:
                 raise HTTPException(status_code=400, detail=f"Insufficient funds. Required: {quote.final_price}, Available: {available_funds}")
            
            # Deduct Money
            booking_owner.balance -= quote.final_price
            
        # Update Booking Object with Pricing Details
        booking_in.final_price = quote.final_price
        booking_in.base_price = quote.base_price
        booking_in.applied_rule = quote.applied_rule
        booking_in.discount_amount = quote.discount_amount
        booking_in.discount_percent = quote.discount_percent
        booking_in.hours_deducted = quote.hours_deducted
        # ---------------------------------------------------------
    
        session.add(booking_owner)
        
        # FIX: Create dict first, add required fields, then instantiate
        booking_data = booking_in.dict()
        booking_data['user_uuid'] = booking_owner.id
        booking_data['user_id'] = booking_owner.email
        
        # Remove fields not in Booking model (like target_user_id)
        if 'target_user_id' in booking_data:
            del booking_data['target_user_id']
            
        booking = Booking(**booking_data)
        
        if booking.payment_method == 'subscription':
                booking.hours_deducted = booking.duration / 60
        
        session.add(booking)
        session.commit()
        session.refresh(booking)
        
        # --- GOOGLE CALENDAR SYNC ---
        try:
            event_id = gcal_service.create_event(booking)
            if event_id:
                booking.gcal_event_id = event_id
                session.add(booking)
                session.commit()
                session.refresh(booking)
        except Exception as e:
            print(f"GCal Sync Failed (Non-blocking): {e}")
        # ----------------------------
    
        return booking

    except HTTPException:
        raise
    except Exception as e:
        # Log to server console but return clean error to user
        print(f"Booking Creation Error: {e}") 
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{booking_id}", response_model=BookingRead)
def cancel_booking(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    # ... (Fetch booking logic) ...
    # ... (Fetch booking logic) ...
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")
        
    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
        
    # Access control
    # Check UUID first, then fallback to email (legacy support)
    is_owner = (booking.user_uuid and booking.user_uuid == current_user.id) or \
               (booking.user_id == current_user.email)
               
    if not is_owner and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    if booking.status == "cancelled":
        return booking

    # --- GOOGLE CALENDAR SYNC (DELETE) ---
    if booking.gcal_event_id:
        try:
            gcal_service.delete_event(booking.gcal_event_id, booking.resource_id)
        except Exception:
            pass # Non-critical
        booking.gcal_event_id = None # Clear references
    # -------------------------------------

    # Refund Logic
    if booking.payment_method == 'subscription':
        if current_user.subscription:
            new_sub = current_user.subscription.copy()
            # Handle legacy data where hours_deducted might be None
            refund_hours = booking.hours_deducted if booking.hours_deducted is not None else (booking.duration / 60)
            
            rem = new_sub.get('remaining_hours', new_sub.get('remainingHours', 0))
            new_sub['remaining_hours'] = float(rem) + refund_hours
            
            # Cleanup old camelCase
            if 'remainingHours' in new_sub: del new_sub['remainingHours']
            
            current_user.subscription = new_sub
            session.add(current_user)
    else:
        # Refund Balance
        # Handle legacy data where final_price might be None
        refund_amount = booking.final_price if booking.final_price is not None else 0.0
        current_user.balance += refund_amount
        session.add(current_user)

    booking.status = "cancelled"
    booking.cancellation_reason = "User cancelled" # TODO: Allow passing reason
    booking.cancelled_by = current_user.email
    
    session.add(booking)
    session.commit()
    session.refresh(booking)
    
    # --- AUDIT LOGGING ---
    # from app.services.timeline import timeline_service (Moved to top)
    from datetime import datetime, timedelta
    
    # Calculate time to booking
    # booking.date is datetime object. booking.start_time is "HH:MM".
    try:
        h, m = map(int, booking.start_time.split(':'))
        booking_start = booking.date.replace(hour=h, minute=m, second=0, microsecond=0)
    except Exception:
        # Fallback if parsing fails
        booking_start = booking.date

    hours_until_start = (booking_start - datetime.utcnow()).total_seconds() / 3600
    is_late_cancellation = hours_until_start < 24
    
    # Enforce Cancellation Policy (No cancellation < 24h)
    if is_late_cancellation and not current_user.is_admin:
         raise HTTPException(
             status_code=400, 
             detail=f"Cancellation is not allowed less than 24 hours before start. Time remaining: {hours_until_start:.1f}h"
         )
    
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
