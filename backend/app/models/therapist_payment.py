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
    specialist_id: str = Field(index=True)  # User UUID as string (no FK due to SQLite UUID limitation)
    created_at: datetime = Field(default_factory=datetime.now, index=True)


class TherapistPaymentCreate(SQLModel):
    client_id: str
    amount: float
    currency: str = "GEL"
    account: str = "Cash"
    # Без даты форма «Новый платёж» в Финансах получала 422: день оплаты — сегодня.
    date: datetime = Field(default_factory=datetime.now)
    session_id: Optional[str] = None
    # «Доплатить» по сессии: сервер не даст внести больше остатка (цена − внесённое),
    # так что повторный клик/тап не задвоит доплату. Нет флага — как раньше.
    cap_to_remaining: bool = False


class TherapistPaymentRead(TherapistPaymentBase):
    id: str
    specialist_id: str
    created_at: datetime


class TherapistPaymentUpdate(SQLModel):
    """Правка платежа: сумма, валюта, счёт и дата. Клиента и сессию менять нельзя —
    для этого платёж удаляют и вносят заново."""
    amount: Optional[float] = None
    currency: Optional[str] = None
    account: Optional[str] = None
    date: Optional[datetime] = None
