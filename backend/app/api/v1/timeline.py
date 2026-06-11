from typing import Any, List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, desc
from app.api import deps
from app.db.session import get_session
from app.models.booking import Booking
from app.models.timeline import TimelineEvent, TimelineEventRead
from app.models.user import User
from app.core.permissions import ADMIN_ROLES

router = APIRouter()

@router.get("/", response_model=List[TimelineEventRead])
def read_timeline_events(
    session: Session = Depends(get_session),
    skip: int = 0,
    limit: int = 50,
    target_id: Optional[str] = Query(None, description="Filter by target (user/booking) ID"),
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Retrieve timeline events.

    Admins see everything. Non-admins must scope to a single `target_id`
    they own (their own user record, or a booking they own) — that lets
    a specialist see their own booking's audit trail (waiver, format
    change, etc.) without leaking other users' events.
    """
    if current_user.role not in ADMIN_ROLES:
        if not target_id:
            raise HTTPException(
                status_code=400,
                detail="Non-admins must scope by target_id (their own booking or user ID)",
            )

        # Allow self-scope (user record) or own-booking scope.
        is_self = target_id == str(current_user.id) or target_id == (current_user.email or "")
        owns_booking = False
        if not is_self:
            try:
                booking = session.get(Booking, UUID(target_id))
            except (ValueError, TypeError):
                booking = None
            if booking and (
                booking.user_uuid == current_user.id
                or (booking.user_id or "").lower() == (current_user.email or "").lower()
            ):
                owns_booking = True
        if not (is_self or owns_booking):
            raise HTTPException(status_code=403, detail="Not authorized for that target_id")

    query = select(TimelineEvent)
    if target_id:
        query = query.where(TimelineEvent.target_id == target_id)
    if event_type:
        query = query.where(TimelineEvent.event_type == event_type)
    query = query.order_by(desc(TimelineEvent.timestamp)).offset(skip).limit(limit)
    return session.exec(query).all()
