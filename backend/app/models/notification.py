"""
Notification — уведомления для админов о системных событиях.
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class NotificationBase(SQLModel):
    type: str = Field(index=True)
    # Types: crm_access_request, booking_cancelled, task_deadline, admin_request, system
    title: str
    description: str = Field(default="")
    icon: Optional[str] = Field(default=None)
    link: Optional[str] = Field(default=None)


class Notification(NotificationBase, table=True):
    __tablename__ = "notifications"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    recipient_id: str = Field(index=True)
    is_read: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class NotificationCreate(SQLModel):
    type: str
    title: str
    description: str = ""
    recipient_id: str
    icon: Optional[str] = None
    link: Optional[str] = None


class NotificationRead(NotificationBase):
    id: str
    recipient_id: str
    is_read: bool
    created_at: datetime
