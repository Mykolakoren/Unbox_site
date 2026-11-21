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

    # Переезд 21.11.2026: филиал принимает брони только в этом промежутке дат
    # (обе границы включительно, 'ГГГГ-ММ-ДД' по Тбилиси; пусто = без границы).
    # Проверяет сервер (services/location_dates.py → check_availability),
    # экраны берут эти же даты из /locations и закрывают клетки заранее.
    open_from: Optional[str] = None
    open_until: Optional[str] = None

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
    open_from: Optional[str] = None
    open_until: Optional[str] = None
