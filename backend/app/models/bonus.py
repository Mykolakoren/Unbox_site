"""Bonus model — free hours gifted to users by admins."""
from typing import Optional
from uuid import UUID, uuid4
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON
from sqlalchemy import Column


class BonusBase(SQLModel):
    user_id: str = Field(index=True)                     # target user UUID
    type: str = Field(default="free_hour")               # free_hour | discount | ...
    description: str = Field(default="")                  # e.g. "Новогодний бонус"
    quantity: float = Field(default=1.0)                  # hours or amount
    status: str = Field(default="pending")                # pending | approved | active | used | expired | rejected
    granted_by_id: str = Field(default="")                # admin who initiated
    granted_by_name: str = Field(default="")
    approved_by_id: Optional[str] = Field(default=None)   # senior/owner who approved
    approved_by_name: Optional[str] = Field(default=None)
    reject_reason: Optional[str] = Field(default=None)
    expires_at: Optional[datetime] = Field(default=None)
    used_at: Optional[datetime] = Field(default=None)
    is_bulk: bool = Field(default=False)                  # part of bulk bonus
    bulk_id: Optional[str] = Field(default=None)          # group bulk bonuses


class Bonus(BonusBase, table=True):
    __tablename__ = "bonuses"  # type: ignore

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BonusRead(BonusBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
