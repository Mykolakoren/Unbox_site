from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select, Session
from app.api import deps
from app.models.waitlist import Waitlist, WaitlistCreate, WaitlistRead
from app.models.user import User

router = APIRouter()

@router.get("/my", response_model=List[WaitlistRead])
def read_my_waitlist(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """
    Retrieve current user's waitlist entries.
    """
    statement = select(Waitlist).where(Waitlist.user_uuid == current_user.id).offset(skip).limit(limit)
    entries = session.exec(statement).all()
    return entries

@router.post("/", response_model=WaitlistRead)
def create_waitlist_entry(
    *,
    session: Session = Depends(deps.get_session),
    entry_in: WaitlistCreate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Add to waitlist.
    """
    entry = Waitlist.from_orm(entry_in)
    entry.user_uuid = current_user.id
    entry.user_id = current_user.email
    
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry

@router.delete("/{entry_id}", response_model=WaitlistRead)
def delete_waitlist_entry(
    entry_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Delete from waitlist (Cancel).
    """
    entry = session.get(Waitlist, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
        
    if entry.user_uuid != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    session.delete(entry)
    session.commit()
    
    return entry
