from typing import Optional, List
from sqlmodel import SQLModel, Field
from pydantic import ConfigDict
from sqlalchemy import Column, JSON

class LocationBase(SQLModel):
    id: str = Field(primary_key=True) # e.g. 'unbox_one'
    name: str
    address: str
    image: Optional[str] = None
    
    # JSON Fields
    features: List[str] = Field(sa_column=Column(JSON), default=[])
    
    # Map Coordinates
    lat: Optional[float] = None
    lng: Optional[float] = None
    
    is_active: bool = True

class Location(LocationBase, table=True):
    model_config = ConfigDict(arbitrary_types_allowed=True)

class LocationCreate(LocationBase):
    pass

class LocationRead(LocationBase):
    pass

class LocationUpdate(SQLModel):
    name: Optional[str] = None
    address: Optional[str] = None
    image: Optional[str] = None
    features: Optional[List[str]] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    is_active: Optional[bool] = None
