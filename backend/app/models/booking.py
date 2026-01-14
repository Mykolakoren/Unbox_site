from typing import Optional, List
from uuid import UUID, uuid4
from sqlmodel import Field, SQLModel, JSON
from sqlalchemy import Column
from datetime import datetime

class BookingBase(SQLModel):
    resource_id: str
    location_id: str = Field(default="unbox_one")
    date: datetime # Stored as datetime, frontend sends ISO string
    start_time: str # "10:00"
    duration: int # minutes
    status: str = Field(default="confirmed") # confirmed, cancelled
    
    # Pricing & Payment
    final_price: float
    payment_method: str # balance, subscription
    payment_source: Optional[str] = None # deposit, credit, subscription
    hours_deducted: Optional[float] = None # For subscription payments
    
    # Metadata
    format: str = Field(default="individual") # individual, group
    extras: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    
    # Cancellation Details
    cancellation_reason: Optional[str] = None
    cancelled_by: Optional[str] = None
    
    # Re-Rent Logic
    is_re_rent_listed: bool = Field(default=False)
    
    # Google Calendar Sync
    gcal_event_id: Optional[str] = None
    gcal_calendar_id: Optional[str] = None

class Booking(BookingBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: str = Field(index=True) # Linking to User.email for now (legacy compatibility), or User.id?
    # NOTE: Optimally should link to User.id (UUID), but frontend uses email as ID often.
    # Let's start with User.id (UUID) relation, but keep email if needed? 
    # Decision: Link to User.id (UUID). Frontend migration will need to handle this lookup.
    
    user_uuid: Optional[UUID] = Field(default=None, foreign_key="user.id")
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class BookingCreate(BookingBase):
    user_email: Optional[str] = None # Optional, derived from auth
    target_user_id: Optional[str] = None # Admin can specify target user (UUID or Email)

class BookingRead(BookingBase):
    id: UUID
    user_uuid: Optional[UUID]
    user_id: str # Return email for frontend compatibility
    created_at: datetime
