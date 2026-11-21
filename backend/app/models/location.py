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

    # Кто из администраторов ведёт филиал (21.11.2026): список id пользователей.
    # Пусто = все администраторы. Если список задан, чужие брони, блокировки и
    # карточки кабинетов этого филиала меняют только владелец и люди из списка;
    # остальные администраторы здесь — как обычные клиенты (только свои брони).
    # Проверяет сервер (services/staff_scope.py). Поля нет ни в Read, ни в
    # Create, ни в Update нарочно: наружу id не уходят, а список меняет только
    # владелец через базу, а не любой админ с правом «редактировать филиалы».
    staff_ids: Optional[List[str]] = Field(default=None, sa_column=Column(JSON))

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
