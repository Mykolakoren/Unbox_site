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
    client_id: Optional[str] = Field(default=None, index=True)  # CRM client link
    client_name: Optional[str] = Field(default=None)  # denormalized for display


class CashboxTransaction(CashboxTransactionBase, table=True):
    __tablename__ = "cashbox_transactions"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    admin_id: str = Field(index=True)
    admin_name: str = Field(default="")
    shift_report_id: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.now)
    # If set, this transaction credited the given user's balance at creation.
    # Used by delete/update to reverse the credit automatically on rollback.
    credited_user_id: Optional[str] = Field(default=None, index=True)


class CashboxTransactionCreate(SQLModel):
    type: str  # "income" | "expense"
    amount: float
    currency: str = "GEL"
    payment_method: str = "cash"
    category_id: Optional[str] = None
    description: Optional[str] = None
    branch: Optional[str] = None
    date: Optional[datetime] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    # If True + type=income + client_id set, the client's User.balance
    # is topped up by `amount` and `credited_user_id` is recorded so the
    # credit can be reversed if the transaction is later deleted/edited.
    credit_user_balance: bool = False


class CashboxTransactionRead(CashboxTransactionBase):
    id: str
    admin_id: str
    admin_name: str
    shift_report_id: Optional[str] = None
    created_at: datetime
    category_name: Optional[str] = None
    credited_user_id: Optional[str] = None
