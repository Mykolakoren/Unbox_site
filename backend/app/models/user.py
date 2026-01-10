from typing import Optional, List
from uuid import UUID, uuid4
from sqlmodel import Field, SQLModel, JSON
from sqlalchemy import Column
from datetime import datetime

class UserBase(SQLModel):
    email: str = Field(unique=True, index=True)
    name: str = Field(index=True)
    phone: Optional[str] = None
    role: str = Field(default="user") # owner, senior_admin, admin, user
    balance: float = Field(default=0.0)
    
    # JSON Fields for complex data structures
    subscription: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    admin_tasks: List[dict] = Field(default_factory=list, sa_column=Column(JSON)) # Frontend: adminTasks
    comment_history: List[dict] = Field(default_factory=list, sa_column=Column(JSON)) # Frontend: commentHistory
    discount_history: List[dict] = Field(default_factory=list, sa_column=Column(JSON)) # Frontend: discountHistory
    crm_data: Optional[dict] = Field(default_factory=dict, sa_column=Column(JSON))

    
    # Settings
    pricing_system: str = Field(default="standard") # standard, personal
    personal_discount_percent: int = Field(default=0)
    
    is_admin: bool = Field(default=False) # Legacy flag, check usage

    # OAuth
    google_id: Optional[str] = Field(default=None, index=True)
    telegram_id: Optional[str] = Field(default=None, index=True)
    avatar_url: Optional[str] = None

class User(UserBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    hashed_password: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(UserBase):
    password: str

class UserRead(UserBase):
    id: UUID
    created_at: datetime
    
class UserUpdate(SQLModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    
    # User settable? Or Admin only?
    # Let's start with basic profile fields.
    # Advanced fields (balance, role, subscription) should probably be separate or protected.
    
class UserUpdateAdmin(UserUpdate):
    role: Optional[str] = None
    balance: Optional[float] = None
    subscription: Optional[dict] = None
    pricing_system: Optional[str] = None
    personal_discount_percent: Optional[int] = None
    tags: Optional[List[str]] = None
    crm_data: Optional[dict] = None
    admin_tasks: Optional[List[dict]] = None
    comment_history: Optional[List[dict]] = None
    # Tasks likely need their own management or full replacement

