from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List, TYPE_CHECKING
from sqlalchemy import Column, String, JSON
from uuid import UUID
import uuid

if TYPE_CHECKING:
    from .user import User

class SpecialistBase(SQLModel):
    first_name: str
    last_name: str
    photo_url: Optional[str] = None
    tagline: str = Field(default="", max_length=150)
    bio: str = Field(default="")

    # Store lists as JSON in the database
    specializations: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    formats: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    base_price_gel: int = Field(default=0)
    is_verified: bool = Field(default=False)
    # Category for public catalog filtering
    # Values: psychology | psychiatry | narcology | coaching | education
    category: Optional[str] = Field(default=None)

class Specialist(SpecialistBase, table=True):
    __tablename__ = "specialists" # type: ignore
    
    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="user.id", index=True, unique=True)
    
    # Optional relationship back to user
    user: Optional["User"] = Relationship(back_populates="specialist_profile")

class SpecialistCreate(SpecialistBase):
    user_id: UUID

class SpecialistUpdate(SQLModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    photo_url: Optional[str] = None
    tagline: Optional[str] = None
    bio: Optional[str] = None
    specializations: Optional[List[str]] = None
    formats: Optional[List[str]] = None
    base_price_gel: Optional[int] = None
    is_verified: Optional[bool] = None
    category: Optional[str] = None

class SpecialistRead(SpecialistBase):
    id: UUID
    user_id: UUID
