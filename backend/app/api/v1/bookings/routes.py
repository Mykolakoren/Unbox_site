"""Bookings — all booking endpoints: list, create, cancel, reschedule, re-rent, link-client."""
from typing import Any, List, Optional
from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select, Session
from pydantic import BaseModel as PydanticBaseModel
from app.api import deps
from app.models.booking import Booking, BookingCreate, BookingRead
from app.models.user import User
from app.services.google_calendar import gcal_service
from app.services.timeline import timeline_service
from app.services.booking import check_availability, find_re_rent_conflicts

router = APIRouter()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _booking_end_dt(booking: Booking) -> datetime:
    """Get booking end datetime (UTC)."""
    try:
        h, m = map(int, booking.start_time.split(":"))
        return booking.date.replace(
            hour=h, minute=m, second=0, microsecond=0
        ) + timedelta(minutes=booking.duration)
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
    return (booking.user_uuid and booking.user_uuid == user.id) or (
        booking.user_id == user.email
    )


def _resolve_booking_owner(session: Session, booking: Booking) -> User | None:
    """Resolve the actual owner of a booking from user_uuid or user_id (email)."""
    if booking.user_uuid:
        owner = session.get(User, booking.user_uuid)
        if owner:
            return owner
    if booking.user_id:
        owner = session.exec(
            select(User).where(User.email == booking.user_id)
        ).first()
        if owner:
            return owner
    return None


def _refund_booking_to_owner(
    session: Session, booking: Booking, owner: User, refund_percent: float = 1.0
) -> dict:
    """
    Refund booking cost to owner. Returns metadata dict for audit logging.
    Handles both balance and subscription payment methods.

    refund_percent: 1.0 = full refund (cancellation), 0.5 = 50% (re-rent claim).
    The non-refunded portion is retained as Unbox income.
    """
    refund_meta = {
        "refunded_to": str(owner.id),
        "refunded_to_email": owner.email,
        "refund_percent": refund_percent,
    }

    if booking.payment_method == "subscription":
        if owner.subscription:
            new_sub = owner.subscription.copy()
            full_hours = (
                booking.hours_deducted
                if booking.hours_deducted is not None
                else (booking.duration / 60)
            )
            refund_hours = round(full_hours * refund_percent, 4)
            retained_hours = round(full_hours - refund_hours, 4)
            rem = new_sub.get("remaining_hours", new_sub.get("remainingHours", 0))
            new_sub["remaining_hours"] = float(rem) + refund_hours
            if "remainingHours" in new_sub:
                del new_sub["remainingHours"]
            owner.subscription = new_sub
            session.add(owner)
            refund_meta["refunded_hours"] = refund_hours
            refund_meta["retained_hours_unbox_income"] = retained_hours
        else:
            refund_meta["refunded_hours"] = 0
            refund_meta["warning"] = "Owner has no subscription to refund to"
    else:
        full_amount = booking.final_price if booking.final_price is not None else 0.0
        refund_amount = round(full_amount * refund_percent, 2)
        retained_amount = round(full_amount - refund_amount, 2)
        owner.balance += refund_amount
        session.add(owner)
        refund_meta["refunded_amount"] = refund_amount
        refund_meta["retained_amount_unbox_income"] = retained_amount

    return refund_meta


# ─── GET endpoints ────────────────────────────────────────────────────────────

@router.get("/me", response_model=List[BookingRead])
def read_my_bookings(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """Retrieve current user's bookings."""
    statement = (
        select(Booking).where(Booking.user_id == current_user.email).offset(skip).limit(limit)
    )
    bookings = session.exec(statement).all()
    return [enrich_booking_status(b) for b in bookings]


@router.get("/", response_model=List[BookingRead])
def read_bookings(
    session: Session = Depends(deps.get_session),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Retrieve all bookings (Admin only)."""
    bookings = session.exec(select(Booking).offset(skip).limit(limit)).all()
    return [enrich_booking_status(b) for b in bookings]


@router.get("/public", response_model=List[BookingRead])
def read_public_bookings(
    session: Session = Depends(deps.get_session),
    start_date: str = None,
    end_date: str = None,
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
    date: str  # "YYYY-MM-DD"
    start_time: str  # "HH:MM"
    duration: int  # minutes


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

        if not available:
            # Check if conflict is with a re-rent-listed booking
            re_rent = find_re_rent_conflicts(
                session=session,
                resource_id=slot.resource_id,
                date=date,
                start_time=slot.start_time,
                duration=slot.duration,
            )
            if re_rent:
                results.append({
                    "available": False,
                    "conflict": conflict,
                    "re_rent_available": True,
                    "re_rent_booking_ids": [str(b.id) for b in re_rent],
                })
                continue

        results.append({"available": available, "conflict": conflict})
    return results


# ─── Create booking ──────────────────────────────────────────────────────────

@router.post("/", response_model=BookingRead)
def create_booking(
    *,
    session: Session = Depends(deps.get_session),
    booking_in: BookingCreate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Create new booking."""
    try:
        # Minimum booking duration: 60 minutes (Unbox policy)
        MIN_BOOKING_DURATION = 60
        if booking_in.duration < MIN_BOOKING_DURATION:
            raise HTTPException(
                status_code=400,
                detail=f"Минимальная длительность бронирования — {MIN_BOOKING_DURATION} минут (1 час).",
            )

        # Normalize date — strip time component to avoid timezone shift issues
        if booking_in.date:
            booking_in.date = booking_in.date.replace(
                hour=0, minute=0, second=0, microsecond=0
            )

        is_available, reason = check_availability(
            session=session,
            resource_id=booking_in.resource_id,
            date=booking_in.date,
            start_time=booking_in.start_time,
            duration=booking_in.duration,
        )

        if not is_available:
            # Check if conflict is with re-rent-listed booking(s)
            re_rent_conflicts = find_re_rent_conflicts(
                session=session,
                resource_id=booking_in.resource_id,
                date=booking_in.date,
                start_time=booking_in.start_time,
                duration=booking_in.duration,
            )

            if not re_rent_conflicts:
                # Genuine conflict with non-re-rent booking
                raise HTTPException(
                    status_code=400, detail=f"Time slot is already booked: {reason}"
                )

            # Auto-cancel all conflicting re-rent bookings with 50% refund.
            # Re-rent policy: original owner gets 50%, remaining 50% = Unbox income.
            RE_RENT_REFUND_PERCENT = 0.5

            for re_rent_booking in re_rent_conflicts:
                re_rent_owner = _resolve_booking_owner(session, re_rent_booking)
                refund_meta = {}

                if re_rent_owner:
                    refund_meta = _refund_booking_to_owner(
                        session, re_rent_booking, re_rent_owner,
                        refund_percent=RE_RENT_REFUND_PERCENT,
                    )

                # Cancel the re-rent booking
                re_rent_booking.status = "cancelled"
                re_rent_booking.cancellation_reason = (
                    "Auto-cancelled: slot re-rented to another user (50% refund)"
                )
                re_rent_booking.cancelled_by = "system:re-rent"
                re_rent_booking.is_re_rent_listed = False
                session.add(re_rent_booking)

                # GCal cleanup
                if re_rent_booking.gcal_event_id:
                    try:
                        gcal_service.delete_event(
                            re_rent_booking.gcal_event_id,
                            re_rent_booking.resource_id,
                        )
                    except Exception:
                        pass
                    re_rent_booking.gcal_event_id = None

                # Audit log for auto-cancel with 50% refund details
                timeline_service.log_event(
                    session=session,
                    actor_id=current_user.id,
                    actor_role=current_user.role,
                    target_id=str(re_rent_booking.id),
                    target_type="booking",
                    event_type="booking_auto_cancelled_re_rent",
                    description=(
                        f"Booking auto-cancelled due to re-rent claim by {current_user.name}. "
                        f"Owner refunded {int(RE_RENT_REFUND_PERCENT * 100)}%, rest → Unbox income."
                    ),
                    metadata={
                        "refund_percent": RE_RENT_REFUND_PERCENT,
                        "new_booking_user": current_user.email,
                        **refund_meta,
                    },
                )
            # Slot is now free — proceed with creating the new booking

        # Determine Booking Owner
        booking_owner = current_user
        if current_user.is_admin and booking_in.target_user_id:
            target = None
            try:
                target = session.get(User, UUID(booking_in.target_user_id))
            except ValueError:
                pass
            if not target:
                target = session.exec(
                    select(User).where(User.email == booking_in.target_user_id)
                ).first()
            if target:
                booking_owner = target

        # Pricing & Payment
        from app.services.pricing import PricingService

        try:
            h, m = map(int, booking_in.start_time.split(":"))
            start_dt = booking_in.date.replace(
                hour=h, minute=m, second=0, microsecond=0
            )
        except Exception:
            start_dt = booking_in.date

        pricing_service = PricingService(session)
        quote = pricing_service.calculate_price(
            user=booking_owner,
            resource_id=booking_in.resource_id,
            start_time=start_dt,
            duration_minutes=booking_in.duration,
            format_type=booking_in.format,
        )

        if booking_in.payment_method == "subscription":
            if quote.applied_rule != "SUBSCRIPTION":
                raise HTTPException(
                    status_code=400,
                    detail="Insufficient subscription hours or invalid format for plan",
                )
            if booking_owner.subscription:
                new_sub = booking_owner.subscription.copy()
                rem = new_sub.get(
                    "remaining_hours", new_sub.get("remainingHours", 0)
                )
                used = new_sub.get("used_hours", new_sub.get("usedHours", 0))
                new_sub["remaining_hours"] = max(
                    0, float(rem) - quote.hours_deducted
                )
                new_sub["used_hours"] = float(used) + quote.hours_deducted
                if "remainingHours" in new_sub:
                    del new_sub["remainingHours"]
                if "usedHours" in new_sub:
                    del new_sub["usedHours"]
                booking_owner.subscription = new_sub
        else:
            available_funds = booking_owner.balance + booking_owner.credit_limit
            if available_funds < quote.final_price:
                user_name = booking_owner.name or booking_owner.email
                raise HTTPException(
                    status_code=400,
                    detail=f"Недостаточно средств у пользователя {user_name}. "
                    f"Необходимо: {quote.final_price}₾, доступно: {available_funds}₾ "
                    f"(баланс: {booking_owner.balance}₾, кредит: {booking_owner.credit_limit}₾). "
                    f"Пополните баланс перед бронированием.",
                )
            booking_owner.balance -= quote.final_price

        booking_in.final_price = quote.final_price
        booking_in.base_price = quote.base_price
        booking_in.applied_rule = quote.applied_rule
        booking_in.discount_amount = quote.discount_amount
        booking_in.discount_percent = quote.discount_percent
        booking_in.hours_deducted = quote.hours_deducted

        session.add(booking_owner)

        booking_data = booking_in.dict()
        booking_data["user_uuid"] = booking_owner.id
        booking_data["user_id"] = booking_owner.email
        if "target_user_id" in booking_data:
            del booking_data["target_user_id"]

        booking = Booking(**booking_data)
        # hours_deducted already set from quote via booking_data (line 252)

        session.add(booking)
        session.commit()
        session.refresh(booking)

        # Google Calendar Sync
        try:
            print(
                f"[GCal Sync] Attempting for booking {booking.id}, resource={booking.resource_id}, connected={gcal_service.is_connected()}"
            )
            event_id = gcal_service.create_event(booking)
            if event_id:
                booking.gcal_event_id = event_id
                session.add(booking)
                session.commit()
                session.refresh(booking)
                print(f"[GCal Sync] SUCCESS: event_id={event_id}")
            else:
                print(
                    f"[GCal Sync] No event created (service not connected or no calendar ID)"
                )
        except Exception as e:
            print(f"[GCal Sync] FAILED (Non-blocking): {e}")
            import traceback

            traceback.print_exc()

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
        if current_user.role not in ("senior_admin", "owner"):
            raise HTTPException(
                status_code=403,
                detail="Past bookings cannot be modified. Only senior admin or owner can delete them.",
            )

    # ── Time-based cancellation policy (>24h check) ──
    try:
        h, m = map(int, booking.start_time.split(":"))
        booking_start = booking.date.replace(
            hour=h, minute=m, second=0, microsecond=0
        )
    except Exception:
        booking_start = booking.date

    hours_until_start = (booking_start - datetime.utcnow()).total_seconds() / 3600
    is_late_cancellation = hours_until_start < 24

    if is_late_cancellation and not _is_past(booking) and not current_user.is_admin:
        raise HTTPException(
            status_code=400,
            detail=f"Cancellation is not allowed less than 24 hours before start. Time remaining: {hours_until_start:.1f}h",
        )

    # ── Google Calendar Sync (Delete) ──
    if booking.gcal_event_id:
        try:
            gcal_service.delete_event(booking.gcal_event_id, booking.resource_id)
        except Exception:
            pass
        booking.gcal_event_id = None

    # ── Refund to booking OWNER (not current_user!) ──
    booking_owner = _resolve_booking_owner(session, booking)
    refund_meta = {}
    if not booking_owner:
        print(f"[WARN] Cannot refund: booking owner not found for booking {booking.id}")
        refund_meta = {"warning": "Booking owner not found, no refund issued"}
    else:
        refund_meta = _refund_booking_to_owner(session, booking, booking_owner)

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
            **refund_meta,
        },
    )

    return booking


# ─── Reschedule booking (drag-to-move) ────────────────────────────────────────

class RescheduleRequest(PydanticBaseModel):
    new_date: str  # "YYYY-MM-DD"
    new_start_time: str  # "HH:MM"
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
        raise HTTPException(
            status_code=400, detail="Only confirmed bookings can be rescheduled"
        )

    if _is_past(booking):
        raise HTTPException(
            status_code=400, detail="Cannot reschedule a past booking"
        )

    # 24h policy
    try:
        h, m = map(int, booking.start_time.split(":"))
        booking_start = booking.date.replace(
            hour=h, minute=m, second=0, microsecond=0
        )
    except Exception:
        booking_start = booking.date

    hours_until = (booking_start - datetime.utcnow()).total_seconds() / 3600
    if hours_until < 24 and not current_user.is_admin:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reschedule less than 24h before start ({hours_until:.1f}h remaining)",
        )

    try:
        new_date = datetime.strptime(data.new_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD"
        )

    new_resource = data.new_resource_id or booking.resource_id

    available, conflict = check_availability(
        session=session,
        resource_id=new_resource,
        date=new_date,
        start_time=data.new_start_time,
        duration=booking.duration,
        exclude_booking_id=str(booking.id),
    )
    if not available:
        raise HTTPException(
            status_code=400, detail=f"New slot is not available: {conflict}"
        )

    old_date = booking.date
    old_time = booking.start_time
    old_resource = booking.resource_id

    # ── Price recalculation when room changes ──
    room_changed = new_resource != booking.resource_id
    old_price = booking.final_price or 0.0
    new_price = old_price
    price_diff = 0.0

    if room_changed:
        # Block room change for subscription bookings (complex hour recalc)
        if booking.payment_method == "subscription":
            raise HTTPException(
                status_code=400,
                detail="Нельзя менять комнату для бронирований по абонементу. "
                "Отмените текущее и создайте новое.",
            )

        booking_owner = _resolve_booking_owner(session, booking)
        if not booking_owner:
            raise HTTPException(
                status_code=400,
                detail="Не удалось определить владельца бронирования для перерасчёта",
            )

        from app.services.pricing import PricingService

        try:
            h, m = map(int, data.new_start_time.split(":"))
            new_start_dt = new_date.replace(hour=h, minute=m, second=0, microsecond=0)
        except Exception:
            new_start_dt = new_date

        pricing_service = PricingService(session)
        new_quote = pricing_service.calculate_price(
            user=booking_owner,
            resource_id=new_resource,
            start_time=new_start_dt,
            duration_minutes=booking.duration,
            format_type=booking.format,
        )

        new_price = new_quote.final_price
        price_diff = new_price - old_price

        if price_diff > 0:
            # Price increased — check funds and charge
            available_funds = booking_owner.balance + booking_owner.credit_limit
            if available_funds < price_diff:
                raise HTTPException(
                    status_code=400,
                    detail=f"Недостаточно средств для перерасчёта. "
                    f"Доплата: {price_diff}₾, доступно: {available_funds}₾.",
                )
            booking_owner.balance -= price_diff
            session.add(booking_owner)
        elif price_diff < 0:
            # Price decreased — refund the difference
            booking_owner.balance += abs(price_diff)
            session.add(booking_owner)

        # Update booking price fields
        booking.final_price = new_quote.final_price
        booking.base_price = new_quote.base_price
        booking.applied_rule = new_quote.applied_rule
        booking.discount_amount = new_quote.discount_amount
        booking.discount_percent = new_quote.discount_percent

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
            "room_changed": room_changed,
            "old_price": old_price if room_changed else None,
            "new_price": new_price if room_changed else None,
            "price_diff": price_diff if room_changed else None,
        },
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

    if data.crm_client_id:
        from app.models.therapist_client import TherapistClient

        client = session.get(TherapistClient, data.crm_client_id)
        if not client:
            raise HTTPException(status_code=404, detail="CRM client not found")
        if client.specialist_id != str(current_user.id):
            raise HTTPException(
                status_code=403, detail="CRM client does not belong to you"
            )

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
        raise HTTPException(
            status_code=400,
            detail="Only confirmed bookings can be listed for re-rent",
        )

    if _is_past(booking):
        raise HTTPException(
            status_code=400, detail="Cannot re-rent a past booking"
        )

    booking.is_re_rent_listed = not booking.is_re_rent_listed
    booking.updated_at = datetime.utcnow()

    session.add(booking)
    session.commit()
    session.refresh(booking)

    return enrich_booking_status(booking)
