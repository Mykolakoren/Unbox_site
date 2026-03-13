"""
TherapySession — сессии терапии.
Привязана к TherapistClient и Specialist (через user_id).
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class TherapySessionBase(SQLModel):
    client_id: str = Field(index=True, foreign_key="therapist_clients.id")
    date: datetime = Field(index=True)
    duration_minutes: int = Field(default=60)
    status: str = Field(default="PLANNED", index=True)  # PLANNED, COMPLETED, CANCELLED_CLIENT, CANCELLED_THERAPIST
    price: Optional[float] = None  # Override price for this session; None → use client.base_price
    is_paid: bool = Field(default=False, index=True)
    is_booked: bool = Field(default=False)  # Room/cabinet booked for this session
    notes: Optional[str] = None  # Inline notes for this session
    google_event_id: Optional[str] = Field(default=None, unique=True)
    booking_id: Optional[str] = None  # Link to Unbox room booking if applicable


class TherapySession(TherapySessionBase, table=True):
    __tablename__ = "therapy_sessions"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    specialist_id: str = Field(index=True)  # User UUID, no FK constraint (type mismatch)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TherapySessionCreate(SQLModel):
    client_id: str
    date: datetime
    duration_minutes: int = 60
    status: str = "PLANNED"
    price: Optional[float] = None
    is_booked: bool = False
    notes: Optional[str] = None
    booking_id: Optional[str] = None
    push_to_calendar: bool = False  # If True, create Google Calendar event


class TherapySessionRead(TherapySessionBase):
    id: str
    specialist_id: str
    created_at: datetime
    updated_at: datetime


class TherapySessionUpdate(SQLModel):
    date: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    status: Optional[str] = None
    price: Optional[float] = None
    is_paid: Optional[bool] = None
    is_booked: Optional[bool] = None
    notes: Optional[str] = None
    booking_id: Optional[str] = None
