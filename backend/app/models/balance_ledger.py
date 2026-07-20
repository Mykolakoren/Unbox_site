"""BalanceLedger — единая лента движений баланса клиента (Шаг 3).

Раньше user.balance правился напрямую из ~36 мест — свести и проверить было
невозможно. Теперь каждое изменение баланса проходит через wallet-сервис и
пишет сюда строку: сколько, каким стал баланс, за что, кто и на что ссылка.

Инвариант (цель): sum(delta по клиенту) == текущий user.balance.
Это делает баланс проверяемым и любой перекос — видимым в ленте.
"""
from typing import Optional
from uuid import UUID, uuid4
from datetime import datetime

from sqlmodel import Field, SQLModel


class BalanceLedger(SQLModel, table=True):
    __tablename__ = "balance_ledger"  # type: ignore

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: str = Field(index=True)                 # User.id (UUID as str)
    delta: float                                     # +пополнение / −списание
    balance_after: float                             # баланс сразу после операции
    # За что: topup | booking_charge | booking_refund | reschedule_diff |
    # extend_charge | extras_charge | weekly_rebate | correction | ...
    reason: str = Field(index=True)
    description: str = Field(default="")             # человекочитаемо
    ref_type: Optional[str] = Field(default=None)    # booking | cashbox_tx | shift | ...
    ref_id: Optional[str] = Field(default=None, index=True)
    actor_id: Optional[str] = Field(default=None)    # кто инициировал (админ/система)
    actor_name: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
