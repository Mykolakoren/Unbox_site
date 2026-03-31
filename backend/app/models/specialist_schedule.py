from sqlmodel import SQLModel, Field
from typing import Optional
from uuid import UUID
import uuid
from datetime import date


class SpecialistScheduleBase(SQLModel):
    specialist_id: UUID = Field(foreign_key="specialists.id", index=True)
    # Weekly template: day_of_week 0=Mon..6=Sun, specific_date=null
    # Date override: specific_date set, day_of_week ignored
    day_of_week: Optional[int] = Field(default=None)  # 0-6
    specific_date: Optional[date] = Field(default=None)
    start_time: str = Field(max_length=5)  # "09:00"
    end_time: str = Field(max_length=5)    # "18:00"
    location_id: Optional[str] = Field(default=None, max_length=50)  # null = online
    is_available: bool = Field(default=True)


class SpecialistSchedule(SpecialistScheduleBase, table=True):
    __tablename__ = "specialist_schedule"  # type: ignore
    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class SpecialistScheduleRead(SpecialistScheduleBase):
    id: UUID


class SpecialistScheduleCreate(SQLModel):
    day_of_week: Optional[int] = None
    specific_date: Optional[date] = None
    start_time: str
    end_time: str
    location_id: Optional[str] = None
    is_available: bool = True
