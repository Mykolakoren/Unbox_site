from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select, Session
from pydantic import BaseModel as PydanticBaseModel
from app.api import deps
from app.models.booking import Booking, BookingCreate, BookingRead
from app.models.user import User
from datetime import datetime, timedelta
from uuid import UUID
from app.services.google_calendar import gcal_service
from app.services.timeline import timeline_service
from app.services.booking import check_availability

router = APIRouter()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _booking_end_dt(booking: Booking) -> datetime:
    """Get booking end datetime (UTC)."""
    try:
        h, m = map(int, booking.start_time.split(':'))
        return booking.date.replace(hour=h, minute=m, second=0, microsecond=0) + timedelta(minutes=booking.duration)
    except Exception:
        return booking.date


def _is_past(booking: Booking) -> bool:
    return _booking_end_dt(booking) < datetime.utcnow()


def enrich_booking_status(booking: Booking) -> Booking:
    """Mark past 'confirmed' bookings as 'completed' in the response (no DB mutation)."""
    if booking.status == "confirmed" and booking.start_time and _is_past(booking):
        booking.status = "completed"
    return booking


def _check_ownership(booking: Booking, user: User) -> bool:
    return (booking.user_uuid and booking.user_uuid == user.id) or \
           (booking.user_id == user.email)


# ─── GET endpoints ────────────────────────────────────────────────────────────

@router.get("/me", response_model=List[BookingRead])
def read_my_bookings(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """Retrieve current user's bookings."""
    statement = select(Booking).where(
        Booking.user_id == current_user.email
    ).offset(skip).limit(limit)
    bookings = session.exec(statement).all()
    return [enrich_booking_status(b) for b in bookings]


@router.get("", response_model=List[BookingRead])
@router.get("/", response_model=List[BookingRead], include_in_schema=False)
def read_bookings(
    session: Session = Depends(deps.get_session),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Retrieve all bookings (Admin only)."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    bookings = session.exec(select(Booking).offset(skip).limit(limit)).all()
    return [enrich_booking_status(b) for b in bookings]


@router.get("/public", response_model=List[BookingRead])
@router.get("/public/", response_model=List[BookingRead], include_in_schema=False)
def read_public_bookings(
    session: Session = Depends(deps.get_session),
    start_date: str = None,
    end_date: str = None
) -> Any:
    """Retrieve ALL confirmed bookings for availability display (Public)."""
    query = select(Booking).where(Booking.status == "confirmed")

    if start_date:
        try:
            s_date = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.where(Booking.date >= s_date)
        except ValueError:
            pass

    if end_date:
        try:
            e_date = datetime.strptime(end_date, "%Y-%m-%d")
            e_date = e_date.replace(hour=23, minute=59, second=59)
            query = query.where(Booking.date <= e_date)
        except ValueError:
            pass

    bookings = session.exec(query).all()
    return [enrich_booking_status(b) for b in bookings]


# ─── Availability check ──────────────────────────────────────────────────────

class SlotCheckItem(PydanticBaseModel):
    resource_id: str
    date: str       # "YYYY-MM-DD"
    start_time: str # "HH:MM"
    duration: int   # minutes


@router.post("/check-availability")
def check_slots_availability(
    *,
    session: Session = Depends(deps.get_session),
    slots: List[SlotCheckItem],
) -> Any:
    """Pre-check slot availability (no auth required)."""
    results = []
    for slot in slots:
        try:
            date = datetime.strptime(slot.date, "%Y-%m-%d")
        except ValueError:
            results.append({"available": False, "conflict": "Некорректная дата"})
            continue

        available, conflict = check_availability(
            session=session,
            resource_id=slot.resource_id,
            date=date,
            start_time=slot.start_time,
            duration=slot.duration,
        )
        results.append({"available": available, "conflict": conflict})
    return results


# ─── Create booking ──────────────────────────────────────────────────────────

@router.post("", response_model=BookingRead)
@router.post("/", response_model=BookingRead, include_in_schema=False)
def create_booking(
    *,
    session: Session = Depends(deps.get_session),
    booking_in: BookingCreate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Create new booking."""
    try:
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
            target = None
            try:
                target = session.get(User, UUID(booking_in.target_user_id))
            except ValueError:
                pass
            if not target:
                target = session.exec(select(User).where(User.email == booking_in.target_user_id)).first()
            if target:
                booking_owner = target

        # Pricing & Payment
        from app.services.pricing import PricingService
        from datetime import time

        try:
            h, m = map(int, booking_in.start_time.split(':'))
            start_dt = booking_in.date.replace(hour=h, minute=m, second=0, microsecond=0)
        except Exception:
            start_dt = booking_in.date

        pricing_service = PricingService(session)
        quote = pricing_service.calculate_price(
            user=booking_owner,
            resource_id=booking_in.resource_id,
            start_time=start_dt,
            duration_minutes=booking_in.duration,
            format_type=booking_in.format
        )

        if booking_in.payment_method == 'subscription':
            if quote.applied_rule != 'SUBSCRIPTION':
                raise HTTPException(status_code=400, detail="Insufficient subscription hours or invalid format for plan")
            if booking_owner.subscription:
                new_sub = booking_owner.subscription.copy()
                rem = new_sub.get('remaining_hours', new_sub.get('remainingHours', 0))
                used = new_sub.get('used_hours', new_sub.get('usedHours', 0))
                new_sub['remaining_hours'] = max(0, float(rem) - quote.hours_deducted)
                new_sub['used_hours'] = float(used) + quote.hours_deducted
                if 'remainingHours' in new_sub: del new_sub['remainingHours']
                if 'usedHours' in new_sub: del new_sub['usedHours']
                booking_owner.subscription = new_sub
        else:
            available_funds = booking_owner.balance + booking_owner.credit_limit
            if available_funds < quote.final_price:
                raise HTTPException(status_code=400, detail=f"Insufficient funds. Required: {quote.final_price}, Available: {available_funds}")
            booking_owner.balance -= quote.final_price

        booking_in.final_price = quote.final_price
        booking_in.base_price = quote.base_price
        booking_in.applied_rule = quote.applied_rule
        booking_in.discount_amount = quote.discount_amount
        booking_in.discount_percent = quote.discount_percent
        booking_in.hours_deducted = quote.hours_deducted

        session.add(booking_owner)

        booking_data = booking_in.dict()
        booking_data['user_uuid'] = booking_owner.id
        booking_data['user_id'] = booking_owner.email
        if 'target_user_id' in booking_data:
            del booking_data['target_user_id']

        booking = Booking(**booking_data)
        if booking.payment_method == 'subscription':
            booking.hours_deducted = booking.duration / 60

        session.add(booking)
        session.commit()
        session.refresh(booking)

        # Google Calendar Sync
        try:
            event_id = gcal_service.create_event(booking)
            if event_id:
                booking.gcal_event_id = event_id
                session.add(booking)
                session.commit()
                session.refresh(booking)
        except Exception as e:
            print(f"GCal Sync Failed (Non-blocking): {e}")

        return booking

    except HTTPException:
        raise
    except Exception as e:
        print(f"Booking Creation Error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ─── Cancel booking ──────────────────────────────────────────────────────────

@router.delete("/{booking_id}", response_model=BookingRead)
def cancel_booking(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status == "cancelled":
        return booking

    # ── Past booking protection ──
    if _is_past(booking):
        if current_user.role not in ('senior_admin', 'owner'):
            raise HTTPException(status_code=403, detail="Past bookings cannot be modified. Only senior admin or owner can delete them.")
        # Senior admin / owner can delete past bookings

    # ── Time-based cancellation policy (>24h check) ──
    try:
        h, m = map(int, booking.start_time.split(':'))
        booking_start = booking.date.replace(hour=h, minute=m, second=0, microsecond=0)
    except Exception:
        booking_start = booking.date

    hours_until_start = (booking_start - datetime.utcnow()).total_seconds() / 3600
    is_late_cancellation = hours_until_start < 24

    if is_late_cancellation and not _is_past(booking) and not current_user.is_admin:
        raise HTTPException(
            status_code=400,
            detail=f"Cancellation is not allowed less than 24 hours before start. Time remaining: {hours_until_start:.1f}h"
        )

    # ── Google Calendar Sync (Delete) ──
    if booking.gcal_event_id:
        try:
            gcal_service.delete_event(booking.gcal_event_id, booking.resource_id)
        except Exception:
            pass
        booking.gcal_event_id = None

    # ── Refund ──
    if booking.payment_method == 'subscription':
        if current_user.subscription:
            new_sub = current_user.subscription.copy()
            refund_hours = booking.hours_deducted if booking.hours_deducted is not None else (booking.duration / 60)
            rem = new_sub.get('remaining_hours', new_sub.get('remainingHours', 0))
            new_sub['remaining_hours'] = float(rem) + refund_hours
            if 'remainingHours' in new_sub: del new_sub['remainingHours']
            current_user.subscription = new_sub
            session.add(current_user)
    else:
        refund_amount = booking.final_price if booking.final_price is not None else 0.0
        current_user.balance += refund_amount
        session.add(current_user)

    booking.status = "cancelled"
    booking.cancellation_reason = "User cancelled"
    booking.cancelled_by = current_user.email

    session.add(booking)
    session.commit()
    session.refresh(booking)

    # ── Audit logging ──
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

    return booking


# ─── Reschedule booking (drag-to-move) ────────────────────────────────────────

class RescheduleRequest(PydanticBaseModel):
    new_date: str                       # "YYYY-MM-DD"
    new_start_time: str                 # "HH:MM"
    new_resource_id: Optional[str] = None  # If moving to a different room


@router.patch("/{booking_id}/reschedule", response_model=BookingRead)
def reschedule_booking(
    booking_id: str,
    data: RescheduleRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Reschedule a booking to a new date/time/resource."""
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed bookings can be rescheduled")

    # Past booking check
    if _is_past(booking):
        raise HTTPException(status_code=400, detail="Cannot reschedule a past booking")

    # 24h policy
    try:
        h, m = map(int, booking.start_time.split(':'))
        booking_start = booking.date.replace(hour=h, minute=m, second=0, microsecond=0)
    except Exception:
        booking_start = booking.date

    hours_until = (booking_start - datetime.utcnow()).total_seconds() / 3600
    if hours_until < 24 and not current_user.is_admin:
        raise HTTPException(status_code=400, detail=f"Cannot reschedule less than 24h before start ({hours_until:.1f}h remaining)")

    # Parse new date
    try:
        new_date = datetime.strptime(data.new_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    new_resource = data.new_resource_id or booking.resource_id

    # Check availability at new slot (exclude this booking)
    available, conflict = check_availability(
        session=session,
        resource_id=new_resource,
        date=new_date,
        start_time=data.new_start_time,
        duration=booking.duration,
        exclude_booking_id=str(booking.id),
    )
    if not available:
        raise HTTPException(status_code=400, detail=f"New slot is not available: {conflict}")

    # Store old values for audit
    old_date = booking.date
    old_time = booking.start_time
    old_resource = booking.resource_id

    # Update booking
    booking.date = new_date
    booking.start_time = data.new_start_time
    booking.resource_id = new_resource
    booking.updated_at = datetime.utcnow()

    # Update GCal event
    if booking.gcal_event_id:
        try:
            gcal_service.delete_event(booking.gcal_event_id, old_resource)
            booking.gcal_event_id = None
        except Exception:
            pass
        try:
            event_id = gcal_service.create_event(booking)
            if event_id:
                booking.gcal_event_id = event_id
        except Exception as e:
            print(f"GCal reschedule sync failed: {e}")

    session.add(booking)
    session.commit()
    session.refresh(booking)

    # Audit
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(booking.id),
        target_type="booking",
        event_type="booking_rescheduled",
        description=f"Booking rescheduled by {current_user.name}: {old_time} → {data.new_start_time}",
        metadata={
            "old_date": old_date.isoformat(),
            "old_time": old_time,
            "old_resource": old_resource,
            "new_date": data.new_date,
            "new_time": data.new_start_time,
            "new_resource": new_resource,
        }
    )

    return enrich_booking_status(booking)


# ─── Link CRM client to booking ──────────────────────────────────────────────

class LinkClientRequest(PydanticBaseModel):
    crm_client_id: Optional[str] = None  # None to unlink


@router.patch("/{booking_id}/link-client", response_model=BookingRead)
def link_crm_client(
    booking_id: str,
    data: LinkClientRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Link or unlink a CRM client to a booking."""
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Validate CRM client belongs to this specialist
    if data.crm_client_id:
        from app.models.therapist_client import TherapistClient
        client = session.get(TherapistClient, data.crm_client_id)
        if not client:
            raise HTTPException(status_code=404, detail="CRM client not found")
        if client.specialist_id != str(current_user.id):
            raise HTTPException(status_code=403, detail="CRM client does not belong to you")

    booking.crm_client_id = data.crm_client_id
    booking.updated_at = datetime.utcnow()

    session.add(booking)
    session.commit()
    session.refresh(booking)

    return enrich_booking_status(booking)


# ─── Toggle re-rent ───────────────────────────────────────────────────────────

@router.patch("/{booking_id}/re-rent", response_model=BookingRead)
def toggle_re_rent(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Toggle re-rent listing for a booking."""
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed bookings can be listed for re-rent")

    if _is_past(booking):
        raise HTTPException(status_code=400, detail="Cannot re-rent a past booking")

    booking.is_re_rent_listed = not booking.is_re_rent_listed
    booking.updated_at = datetime.utcnow()

    session.add(booking)
    session.commit()
    session.refresh(booking)

    return enrich_booking_status(booking)
