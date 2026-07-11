"""Помесячный снимок ключевых метрик (owner-аналитика).

Сохраняется в конце месяца (cron 1-го числа за прошлый месяц) — чтобы история
не терялась и можно было сравнивать месяцы, даже если исходные данные меняются.
Идемпотентно по `month` (YYYY-MM).
"""
from typing import Optional
from uuid import UUID, uuid4
from datetime import datetime

from sqlmodel import Field, SQLModel, JSON
from sqlalchemy import Column


class MonthlyMetrics(SQLModel, table=True):
    __tablename__ = "monthly_metrics"  # type: ignore

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    month: str = Field(index=True)          # "2026-06" — месяц, который покрывает
    revenue: float = 0.0
    bookings: int = 0
    hours: float = 0.0
    occupancy_pct: float = 0.0
    avg_check: float = 0.0
    # Полный снимок разрезов (by_center / by_room / by_admin) — JSON.
    data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
