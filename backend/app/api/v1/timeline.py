from typing import Any, List, Optional
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, desc
from app.api import deps
from app.db.session import get_session
from app.models.timeline import TimelineEvent, TimelineEventRead
from app.models.user import User

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
    """
    Retrieve timeline events.
    """
    # Access Control: Only admins
    if not current_user.is_admin:
        # Or maybe allow users to see their own history?
        # For now, strict admin only.
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Not authorized")
        
    query = select(TimelineEvent)
    
    if target_id:
        query = query.where(TimelineEvent.target_id == target_id)
        
    if event_type:
        query = query.where(TimelineEvent.event_type == event_type)
        
    query = query.order_by(desc(TimelineEvent.timestamp)).offset(skip).limit(limit)
    
    events = session.exec(query).all()
    return events
