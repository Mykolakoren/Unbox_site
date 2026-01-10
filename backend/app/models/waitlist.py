from typing import Optional
from uuid import UUID, uuid4
from sqlmodel import Field, SQLModel
from datetime import datetime

class WaitlistBase(SQLModel):
    resource_id: str
    date: datetime # Stored as datetime
    start_time: str # "10:00"
    end_time: str # "12:00"
    status: str = Field(default="active") # active, fulfilled, cancelled

class Waitlist(WaitlistBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: str = Field(index=True) # Linking to User.email (legacy)
    user_uuid: Optional[UUID] = Field(default=None, foreign_key="user.id")
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class WaitlistCreate(WaitlistBase):
    pass

class WaitlistRead(WaitlistBase):
    id: UUID
    user_uuid: Optional[UUID]
    user_id: str
    created_at: datetime
