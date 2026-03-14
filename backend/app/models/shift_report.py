"""
ShiftReport — отчёт о закрытии смены (сверка кассы).
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class ShiftReportBase(SQLModel):
    expected_balance: float
    actual_balance: float
    discrepancy: float
    notes: Optional[str] = Field(default=None)
    shift_start: datetime
    shift_end: datetime


class ShiftReport(ShiftReportBase, table=True):
    __tablename__ = "shift_reports"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    admin_id: str = Field(index=True)
    admin_name: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ShiftReportCreate(SQLModel):
    actual_balance: float
    notes: Optional[str] = None


class ShiftReportRead(ShiftReportBase):
    id: str
    admin_id: str
    admin_name: str
    created_at: datetime
