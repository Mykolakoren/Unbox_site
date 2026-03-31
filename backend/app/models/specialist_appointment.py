from sqlmodel import SQLModel, Field
from typing import Optional
from uuid import UUID
import uuid
from datetime import date, datetime


class SpecialistAppointmentBase(SQLModel):
    specialist_id: UUID = Field(foreign_key="specialists.id", index=True)
    client_name: str = Field(max_length=200)
    client_phone: Optional[str] = Field(default=None, max_length=30)
    client_email: Optional[str] = Field(default=None, max_length=200)
    client_user_id: Optional[UUID] = Field(default=None, foreign_key="user.id")
    date: date
    start_time: str = Field(max_length=5)  # "10:00"
    duration: int = Field(default=60)  # minutes
    location_id: Optional[str] = Field(default=None, max_length=50)  # null = online
    status: str = Field(default="confirmed", max_length=20)  # confirmed | cancelled
    notes: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SpecialistAppointment(SpecialistAppointmentBase, table=True):
    __tablename__ = "specialist_appointments"  # type: ignore
    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class SpecialistAppointmentRead(SpecialistAppointmentBase):
    id: UUID


class SpecialistAppointmentCreate(SQLModel):
    client_name: str
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    date: date
    start_time: str
    duration: int = 60
    location_id: Optional[str] = None
    notes: Optional[str] = None
