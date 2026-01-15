from typing import Optional, List
from sqlmodel import SQLModel, Field
from pydantic import ConfigDict
from sqlalchemy import Column, JSON

class ResourceBase(SQLModel):
    id: str = Field(primary_key=True) # Manually set IDs like 'unbox_one_room_1'
    name: str
    type: str # 'cabinet' or 'capsule'
    location_id: str
    hourly_rate: float
    capacity: int
    area: int
    min_booking_hours: int = 1
    description: Optional[str] = None
    
    # JSON Fields
    formats: List[str] = Field(sa_column=Column(JSON), default=["individual"])
    photos: List[str] = Field(sa_column=Column(JSON), default=[])
    video_url: Optional[str] = None
    
    is_active: bool = True

class Resource(ResourceBase, table=True):
    model_config = ConfigDict(arbitrary_types_allowed=True)

class ResourceCreate(ResourceBase):
    pass

class ResourceRead(ResourceBase):
    pass

class ResourceUpdate(SQLModel):
    name: Optional[str] = None
    hourly_rate: Optional[float] = None
    capacity: Optional[int] = None
    description: Optional[str] = None
    photos: Optional[List[str]] = None
    video_url: Optional[str] = None
    is_active: Optional[bool] = None
