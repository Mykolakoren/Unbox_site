"""
TeamMember — карточки команды на главной странице.
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class TeamMemberBase(SQLModel):
    name: str = Field(index=True)
    role: str  # Отображаемая должность
    role_type: str = Field(default="admin")  # founder | senior_admin | admin | other
    photo_url: Optional[str] = Field(default=None)
    bio: Optional[str] = Field(default=None)
    sort_order: int = Field(default=0, index=True)
    is_active: bool = Field(default=True)


class TeamMember(TeamMemberBase, table=True):
    __tablename__ = "team_members"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TeamMemberCreate(SQLModel):
    name: str
    role: str
    role_type: str = "admin"
    photo_url: Optional[str] = None
    bio: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class TeamMemberRead(TeamMemberBase):
    id: str
    created_at: datetime


class TeamMemberUpdate(SQLModel):
    name: Optional[str] = None
    role: Optional[str] = None
    role_type: Optional[str] = None
    photo_url: Optional[str] = None
    bio: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
