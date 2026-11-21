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
    group_rate: Optional[float] = None  # цена для групповых занятий
    capacity: int
    area: int
    min_booking_hours: int = 1
    description: Optional[str] = None
    
    # JSON Fields
    formats: List[str] = Field(sa_column=Column(JSON), default=["individual"])
    photos: List[str] = Field(sa_column=Column(JSON), default=[])
    services: List[str] = Field(sa_column=Column(JSON), default=[])
    video_url: Optional[str] = None

    is_active: bool = True
    sort_order: int = Field(default=0)

class Resource(ResourceBase, table=True):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    # Закреплённый кабинет (21.11.2026, кабинет 1 в UNBOX 99 — практика владельца):
    # список id тех, на чьё имя здесь может стоять бронь. Пусто = кабинет для всех.
    # Кабинет виден на шахматке, но бронь на другого человека сервер не примет
    # (services/staff_scope.py → check_availability). В Create и Update поля нет
    # нарочно: закрепляет кабинет только владелец через базу.
    allowed_user_ids: Optional[List[str]] = Field(default=None, sa_column=Column(JSON))

class ResourceCreate(ResourceBase):
    pass

class ResourceRead(ResourceBase):
    # Экранам нужно знать, кому кабинет не предлагать (utils/roomAccess.ts).
    allowed_user_ids: Optional[List[str]] = None

class ResourceUpdate(SQLModel):
    name: Optional[str] = None
    hourly_rate: Optional[float] = None
    group_rate: Optional[float] = None
    capacity: Optional[int] = None
    area: Optional[int] = None
    min_booking_hours: Optional[int] = None
    description: Optional[str] = None
    photos: Optional[List[str]] = None
    services: Optional[List[str]] = None
    formats: Optional[List[str]] = None
    video_url: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
