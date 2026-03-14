"""
CashboxTransaction — операции кассы (приход/расход).
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class CashboxTransactionBase(SQLModel):
    type: str = Field(index=True)  # "income" | "expense"
    amount: float
    currency: str = Field(default="GEL")
    payment_method: str = Field(default="cash")  # cash | card_tbc | card_bog
    category_id: Optional[str] = Field(default=None, foreign_key="expense_categories.id")
    description: Optional[str] = Field(default=None)
    branch: Optional[str] = Field(default=None)
    date: datetime = Field(index=True)


class CashboxTransaction(CashboxTransactionBase, table=True):
    __tablename__ = "cashbox_transactions"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    admin_id: str = Field(index=True)
    admin_name: str = Field(default="")
    shift_report_id: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CashboxTransactionCreate(SQLModel):
    type: str  # "income" | "expense"
    amount: float
    currency: str = "GEL"
    payment_method: str = "cash"
    category_id: Optional[str] = None
    description: Optional[str] = None
    branch: Optional[str] = None
    date: Optional[datetime] = None


class CashboxTransactionRead(CashboxTransactionBase):
    id: str
    admin_id: str
    admin_name: str
    shift_report_id: Optional[str] = None
    created_at: datetime
    category_name: Optional[str] = None
