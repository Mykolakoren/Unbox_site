from typing import Annotated, List
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from app.db.session import get_session
from app.api import deps
from app.models.user import User
from app.models.notification import Notification, NotificationRead

router = APIRouter()


@router.get("/", response_model=List[NotificationRead])
def list_notifications(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(deps.require_admin)],
    unread_only: bool = Query(False),
    skip: int = 0,
    limit: int = 50,
):
    query = select(Notification).where(
        Notification.recipient_id == str(current_user.id)
    )
    if unread_only:
        query = query.where(Notification.is_read == False)
    query = query.order_by(Notification.created_at.desc()).offset(skip).limit(limit)
    return session.exec(query).all()


@router.get("/unread-count")
def unread_count(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(deps.require_admin)],
):
    count = session.exec(
        select(func.count(Notification.id)).where(
            Notification.recipient_id == str(current_user.id),
            Notification.is_read == False,
        )
    ).one()
    return {"count": count}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(deps.require_admin)],
):
    n = session.get(Notification, notification_id)
    if not n or n.recipient_id != str(current_user.id):
        return {"ok": False}
    n.is_read = True
    session.add(n)
    session.commit()
    return {"ok": True}


@router.post("/read-all")
def mark_all_read(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(deps.require_admin)],
):
    notifications = session.exec(
        select(Notification).where(
            Notification.recipient_id == str(current_user.id),
            Notification.is_read == False,
        )
    ).all()
    for n in notifications:
        n.is_read = True
        session.add(n)
    session.commit()
    return {"ok": True, "marked": len(notifications)}
