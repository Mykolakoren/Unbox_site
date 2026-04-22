"""
AppSetting — simple key-value store for app-wide configuration.

Right now only used for exchange_rates, but built as a generic bag so future
knobs (tax rate, working hours, display units…) can live here without new
migrations. Value is JSON so each knob can carry its own shape.
"""
from datetime import datetime
from typing import Any, Optional
from sqlalchemy import Column, JSON
from sqlmodel import SQLModel, Field


class AppSetting(SQLModel, table=True):
    __tablename__ = "app_settings"  # type: ignore

    key: str = Field(primary_key=True, index=True)
    value: Any = Field(default=None, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=datetime.now)
    updated_by_user_id: Optional[str] = Field(default=None)
