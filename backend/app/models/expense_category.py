"""
ExpenseCategory — категории расходов/доходов для кассы.
Поддерживает один уровень вложенности (parent_id).
"""
from typing import Optional, List
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class ExpenseCategoryBase(SQLModel):
    name: str = Field(index=True)
    parent_id: Optional[str] = Field(default=None)
    icon: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)


class ExpenseCategory(ExpenseCategoryBase, table=True):
    __tablename__ = "expense_categories"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ExpenseCategoryCreate(SQLModel):
    name: str
    parent_id: Optional[str] = None
    icon: Optional[str] = None


class ExpenseCategoryRead(ExpenseCategoryBase):
    id: str
    created_at: datetime
    children: List["ExpenseCategoryRead"] = []
