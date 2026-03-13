"""
TherapistPayment — платежи за терапевтические сессии.
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class TherapistPaymentBase(SQLModel):
    client_id: str = Field(index=True, foreign_key="therapist_clients.id")
    amount: float
    currency: str = Field(default="GEL")
    account: str = Field(default="Cash")
    date: datetime = Field(index=True)
    session_id: Optional[str] = Field(default=None, foreign_key="therapy_sessions.id")


class TherapistPayment(TherapistPaymentBase, table=True):
    __tablename__ = "therapist_payments"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    specialist_id: str = Field(index=True)  # User UUID, no FK constraint (type mismatch)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TherapistPaymentCreate(SQLModel):
    client_id: str
    amount: float
    currency: str = "GEL"
    account: str = "Cash"
    date: datetime
    session_id: Optional[str] = None


class TherapistPaymentRead(TherapistPaymentBase):
    id: str
    specialist_id: str
    created_at: datetime
