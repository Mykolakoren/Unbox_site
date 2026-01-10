from datetime import datetime
from typing import Optional, Dict
from sqlmodel import SQLModel, Field, JSON
from uuid import UUID, uuid4

class TimelineEventBase(SQLModel):
    event_type: str  # e.g., "role_change", "discount_applied", "booking_cancelled"
    actor_id: UUID = Field(index=True)
    actor_req_role: str # Role of the actor at the time
    target_id: Optional[str] = Field(default=None, index=True) # ID of user/booking affected
    target_type: str # "user", "booking"
    description: str
    metadata_dump: Dict = Field(default={}, sa_type=JSON) # Stores before/after values
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class TimelineEvent(TimelineEventBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)

class TimelineEventCreate(TimelineEventBase):
    pass

class TimelineEventRead(TimelineEventBase):
    id: UUID
