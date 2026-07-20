"""Списание и возврат бонусных бесплатных часов (free_hour).

Раньше бонус-час не тратился вовсе (в billing_defer стоял TODO): бронь «бонусом»
списывала полную цену с баланса. Этот сервис — единая точка расхода/возврата
бесплатных часов.

Правило (owner 2026-07-20): сколько часов выдано бонусом — бесплатно, всё сверх
по обычной цене. Списание FIFO — сначала тратим бонусы, что раньше истекают.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.models.bonus import Bonus

logger = logging.getLogger(__name__)


def available_free_hours(session: Session, user_id) -> float:
    """Сколько активных бесплатных часов у клиента прямо сейчас (не истёкших)."""
    now = datetime.now()
    rows = session.exec(
        select(Bonus).where(
            Bonus.user_id == str(user_id),
            Bonus.type == "free_hour",
            Bonus.status == "active",
        )
    ).all()
    return round(sum(
        float(b.quantity or 0) for b in rows
        if not (b.expires_at and b.expires_at < now)
    ), 2)


def consume_free_hours(session: Session, user_id, hours_needed: float) -> float:
    """Потратить до `hours_needed` бесплатных часов (FIFO по сроку истечения).

    Возвращает СКОЛЬКО часов реально покрыто бонусом. Полностью потраченный
    бонус → status='used'; частично → уменьшаем quantity. Истёкшие по пути
    помечаем 'expired'. Caller коммитит.
    """
    if not hours_needed or hours_needed <= 0:
        return 0.0
    now = datetime.now()
    bonuses = session.exec(
        select(Bonus).where(
            Bonus.user_id == str(user_id),
            Bonus.type == "free_hour",
            Bonus.status == "active",
        )
    ).all()
    # FIFO: сначала те, что раньше истекают (None-срок — в конец).
    bonuses.sort(key=lambda b: (b.expires_at is None, b.expires_at or datetime.max))

    covered = 0.0
    for b in bonuses:
        if hours_needed - covered <= 0.001:
            break
        if b.expires_at and b.expires_at < now:
            b.status = "expired"
            b.updated_at = now
            session.add(b)
            continue
        take = min(float(b.quantity or 0), hours_needed - covered)
        if take <= 0:
            continue
        covered += take
        b.quantity = round(float(b.quantity or 0) - take, 2)
        if b.quantity <= 0.001:
            b.status = "used"
            b.used_at = now
        b.updated_at = now
        session.add(b)

    return round(covered, 2)


def refund_free_hours(session: Session, user_id, hours: float, reason: str = "Возврат при отмене брони") -> None:
    """Вернуть клиенту `hours` бесплатных часов (при отмене бонусной брони).

    Создаём новый активный free_hour-бонус на возвращаемое количество. Срок —
    30 дней (не знаем исходный, даём разумный запас). Caller коммитит.
    """
    if not hours or hours <= 0:
        return
    session.add(Bonus(
        user_id=str(user_id),
        type="free_hour",
        quantity=round(float(hours), 2),
        status="active",
        description=reason,
        granted_by_id="system",
        granted_by_name="Система (возврат)",
        expires_at=datetime.now() + timedelta(days=30),
    ))
