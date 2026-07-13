"""
WeeklyRebate — журнал начисленных недельных кредитов (скидка за объём).

Owner 2026-06-16: недельная скидка применяется не в момент брони, а
кредитом в конце недели на ВСЕ часы по итоговому тарифу. Эта таблица —
защита от двойного начисления: одна строка на (user_id, week_start).
"""
from sqlmodel import SQLModel, Field, UniqueConstraint
from typing import Optional
from datetime import date, datetime
from uuid import UUID
import uuid


class WeeklyRebate(SQLModel, table=True):
    __tablename__ = "weekly_rebates"  # type: ignore
    # Защита от двойного начисления живёт В БАЗЕ, а не только в SELECT-проверке
    # перед вставкой: два параллельных прогона (крон + ручной запуск, два таба)
    # оба видели «строки нет» и оба кредитовали баланс. Теперь второй упадёт на
    # констрейнте. Индекс создаётся в run_migrations() — для уже существующей
    # таблицы create_all() его не добавит.
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_weekly_rebate_user_week"),)

    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: UUID = Field(index=True)
    # Понедельник недели, за которую начислен кредит (date, без времени).
    week_start: date = Field(index=True)
    total_hours: float = Field(default=0.0)   # суммарные подтверждённые часы недели
    tier_percent: int = Field(default=0)      # итоговый недельный тариф
    amount: float = Field(default=0.0)         # начисленный кредит (₾)
    # ID проводки в кассе (для аудита/отмены), если создавалась.
    cashbox_tx_id: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
