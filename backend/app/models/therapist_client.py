"""
TherapistClient — клиенты специалиста (терапевта).
Привязан к Specialist через specialist_id.
"""
from typing import Optional, List
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, JSON


class TherapistClientBase(SQLModel):
    name: str = Field(index=True)
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram: Optional[str] = None
    alias_code: Optional[str] = Field(default=None, index=True)
    base_price: float = Field(default=0)
    currency: str = Field(default="GEL")
    default_account: str = Field(default="Cash")
    is_active: bool = Field(default=True, index=True)
    pipeline_status: str = Field(default="ACTIVE", index=True)  # LEAD, ACTIVE, VIP, SLEEPING, INACTIVE
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    notes_text: Optional[str] = None  # Quick notes field


class TherapistClient(TherapistClientBase, table=True):
    __tablename__ = "therapist_clients"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    specialist_id: str = Field(index=True)  # User UUID, no FK constraint (type mismatch str vs uuid)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TherapistClientCreate(SQLModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram: Optional[str] = None
    alias_code: Optional[str] = None
    base_price: float = 0
    currency: str = "GEL"
    default_account: str = "Cash"
    pipeline_status: str = "ACTIVE"
    tags: List[str] = []


class TherapistClientRead(TherapistClientBase):
    id: str
    specialist_id: str
    created_at: datetime
    updated_at: datetime


class TherapistClientUpdate(SQLModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram: Optional[str] = None
    alias_code: Optional[str] = None
    base_price: Optional[float] = None
    currency: Optional[str] = None
    default_account: Optional[str] = None
    is_active: Optional[bool] = None
    pipeline_status: Optional[str] = None
    tags: Optional[List[str]] = None
    notes_text: Optional[str] = None
