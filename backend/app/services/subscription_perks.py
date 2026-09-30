"""Обещания тарифов в системе (владелец 01.10): то, что написано на сайте про
абонемент, должно реально работать, а не только показываться.

Переносы позже суток. Клиент бесплатно переносит бронь, если до начала
≥ 24 ч. Абонемент добавляет N переносов ПОЗЖЕ суток (но не позже чем за 3 ч):
Тёплый старт 1, Регулярный практик 2, Профи+ 3 (Пробный, Групповой — 0).
Счётчик — в пуле абонемента: `free_reschedules` (осталось) и
`free_reschedules_used` (потрачено). Тратит только клиент; перенос
администратором счётчик не трогает.

Читаем/пишем пул только через subscription_pool (оба диалекта полей).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from app.services import subscription_pool

# Позже этого клиент не переносит даже бесплатным переносом абонемента.
LATE_RESCHEDULE_MIN_HOURS = 3.0
# Обычный перенос клиентом — не позже чем за сутки.
RESCHEDULE_NOTICE_HOURS = 24.0


def plan_of(sub: Optional[dict]) -> dict:
    """Тариф абонемента из каталога (subscription_sale.PLANS) — {} если нет."""
    from app.services.subscription_sale import PLANS
    return PLANS.get(str(subscription_pool.get(sub, "plan_id") or ""), {})


# ── Переносы позже суток ─────────────────────────────────────────────────────

def free_reschedules_left(sub: Optional[dict]) -> int:
    """Сколько бесплатных переносов позже суток осталось в абонементе."""
    return max(0, int(subscription_pool.get_float(sub, "free_reschedules")))


def late_reschedule_refusal(
    sub: Optional[dict],
    *,
    hours_until: float,
    new_start_utc: Optional[datetime],
    now: datetime,
) -> Optional[str]:
    """Почему клиенту нельзя перенести бронь позже суток до начала (текст для
    400) — или None, если можно бесплатным переносом абонемента.

    Условия (все сразу): абонемент действует; переносы по нему остались;
    до начала не меньше 3 ч; новая дата в пределах срока абонемента.
    """
    base = (f"Перенос невозможен менее чем за 24 часа до начала (осталось {hours_until:.1f} ч). "
            f"Можно выставить бронь на переаренду или написать администратору.")
    if not subscription_pool.is_active(sub, now):
        return base
    if free_reschedules_left(sub) <= 0:
        used = int(subscription_pool.get_float(sub, "free_reschedules_used"))
        if used > 0:
            return (f"Бесплатные переносы позже суток по абонементу закончились (использовано: {used}). "
                    f"Можно выставить бронь на переаренду или написать администратору.")
        return base
    if hours_until < LATE_RESCHEDULE_MIN_HOURS:
        return (f"Перенос невозможен менее чем за {LATE_RESCHEDULE_MIN_HOURS:g} часа до начала "
                f"(осталось {max(hours_until, 0):.1f} ч). Можно выставить бронь на переаренду "
                f"или написать администратору.")
    expiry = subscription_pool._parse_dt(subscription_pool.get(sub, "expiry_date"))
    if (expiry is not None and new_start_utc is not None
            and not subscription_pool.is_flexible(sub) and new_start_utc > expiry):
        return (f"Бесплатный перенос по абонементу — только в пределах его срока "
                f"(до {expiry.strftime('%d.%m.%Y')}). Выберите время раньше или напишите администратору.")
    return None


def spend_free_reschedule(sub: Optional[dict]) -> dict:
    """Потратить один бесплатный перенос: осталось −1, потрачено +1."""
    left = free_reschedules_left(sub)
    used = int(subscription_pool.get_float(sub, "free_reschedules_used"))
    return subscription_pool.update(
        sub,
        free_reschedules=max(0, left - 1),
        free_reschedules_used=used + 1,
    )


def perks_snapshot(sub: Optional[dict]) -> dict[str, Any]:
    """Для логов/событий: счётчики обещаний тарифа как есть сейчас."""
    return {
        "free_reschedules": free_reschedules_left(sub),
        "free_reschedules_used": int(subscription_pool.get_float(sub, "free_reschedules_used")),
    }
