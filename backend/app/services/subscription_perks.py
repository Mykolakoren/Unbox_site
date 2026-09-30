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


# ── Заморозка по тарифу (владелец 01.10, «как на сайте») ─────────────────────
# Бюджет дней паузы на абонемент: Пробный/Тёплый/Групповой 0, Регулярный 7,
# Профи+ 30. Бюджет делится: можно несколько пауз, пока использовано меньше
# положенного. При снятии паузы срок абонемента продлевается на min(факт,
# выданное на эту паузу). Пауза по сроку снимается сама (крон charge-due).
#
# Поля пула: freeze_days_total (бюджет), freeze_days_used (израсходовано),
# freeze_days_left (осталось — для экрана), frozen_days_granted (сколько дней
# выдано на текущую паузу), плюс прежние is_frozen/frozen_at/frozen_until/
# freeze_count.

# Старые паузы (до 01.10) давались по 7 дней, по одной на абонемент.
LEGACY_FREEZE_DAYS = 7.0


class FreezeError(ValueError):
    """Паузу поставить/снять нельзя — текст для администратора."""


def _days(value: Any) -> float:
    return round(max(0.0, float(value)), 2)


def freeze_days_total(sub: Optional[dict]) -> float:
    """Бюджет дней паузы: записанный в пуле, иначе по тарифу (plan_id)."""
    stored = subscription_pool.get(sub, "freeze_days_total")
    if stored is not None:
        try:
            return _days(stored)
        except (TypeError, ValueError):
            pass
    return _days(plan_of(sub).get("freeze_days", 0))


def freeze_days_used(sub: Optional[dict]) -> float:
    """Израсходовано дней паузы. Старый пул без поля: если пауза уже была и
    сейчас не идёт — считаем, что израсходовано 7 дней (так их выдавали)."""
    stored = subscription_pool.get(sub, "freeze_days_used")
    if stored is not None:
        try:
            return _days(stored)
        except (TypeError, ValueError):
            pass
    if (int(subscription_pool.get_float(sub, "freeze_count")) >= 1
            and not subscription_pool.get(sub, "is_frozen", False)):
        return LEGACY_FREEZE_DAYS
    return 0.0


def freeze_days_left(sub: Optional[dict]) -> float:
    return _days(freeze_days_total(sub) - freeze_days_used(sub))


def _granted_days(sub: Optional[dict]) -> float:
    """Сколько дней выдано на ТЕКУЩУЮ паузу. Старая пауза (до 01.10) без поля —
    как её выдали: frozen_until − frozen_at, но не меньше остатка бюджета."""
    stored = subscription_pool.get(sub, "frozen_days_granted")
    if stored is not None:
        try:
            return _days(stored)
        except (TypeError, ValueError):
            pass
    at = subscription_pool._parse_dt(subscription_pool.get(sub, "frozen_at"))
    until = subscription_pool._parse_dt(subscription_pool.get(sub, "frozen_until"))
    legacy = _days((until - at).total_seconds() / 86400) if at and until else 0.0
    return max(legacy, freeze_days_left(sub))


def with_freeze_budget(sub: Optional[dict]) -> dict:
    """Записать в пул бюджет / израсходовано / осталось (оба диалекта)."""
    total, used = freeze_days_total(sub), freeze_days_used(sub)
    return subscription_pool.update(
        sub, freeze_days_total=total, freeze_days_used=used,
        freeze_days_left=_days(total - used),
    )


def start_freeze(sub: Optional[dict], now: datetime, days: Optional[float] = None,
                 override: bool = False) -> dict:
    """Поставить паузу. Без `days` — на весь остаток бюджета. `override`
    (владелец / старший админ) — можно сверх бюджета и при бюджете 0."""
    from datetime import timedelta
    if not sub:
        raise FreezeError("У клиента нет абонемента")
    if subscription_pool.get(sub, "is_frozen", False):
        raise FreezeError("Абонемент уже на паузе")
    total, used = freeze_days_total(sub), freeze_days_used(sub)
    left = _days(total - used)
    name = subscription_pool.get(sub, "name") or plan_of(sub).get("name") or "абонемент"
    if days is not None:
        try:
            days = float(days)
        except (TypeError, ValueError):
            raise FreezeError("Число дней паузы — числом")
        if days <= 0:
            raise FreezeError("Число дней паузы должно быть больше 0")
        if days > left + 0.001 and not override:
            raise FreezeError(
                f"По тарифу «{name}» осталось {left:g} дн. паузы. Больше может разрешить "
                f"владелец или старший администратор."
            )
        grant = _days(days)
    else:
        if left <= 0:
            if total <= 0:
                raise FreezeError(
                    f"Заморозка не входит в тариф «{name}». Разрешить паузу может владелец "
                    f"или старший администратор, указав число дней."
                )
            raise FreezeError(
                f"Дни заморозки по тарифу «{name}» закончились (использовано {used:g} из {total:g}). "
                f"Разрешить ещё может владелец или старший администратор, указав число дней."
            )
        grant = left
    return subscription_pool.update(
        sub,
        is_frozen=True,
        freeze_count=int(subscription_pool.get_float(sub, "freeze_count")) + 1,
        frozen_at=now.isoformat(),
        frozen_until=(now + timedelta(days=grant)).isoformat(),
        frozen_days_granted=grant,
        freeze_days_total=total,
        freeze_days_used=used,
        freeze_days_left=left,
    )


def end_freeze(sub: Optional[dict], now: datetime) -> tuple[dict, float, float]:
    """Снять паузу. Возвращает (пул, дней на паузе, на сколько продлён срок).

    Срок абонемента сдвигается на min(факт, выдано на эту паузу); в бюджет
    записывается израсходованное — тоже не больше выданного (если крон снял
    паузу позже её срока, лишнее время клиенту в бюджет не засчитывается)."""
    from datetime import timedelta
    if not sub or not subscription_pool.get(sub, "is_frozen", False):
        raise FreezeError("Абонемент не на паузе")
    at = subscription_pool._parse_dt(subscription_pool.get(sub, "frozen_at"))
    fact = _days((now - at).total_seconds() / 86400) if at else 0.0
    granted = _granted_days(sub)
    extend = min(fact, granted)
    total = freeze_days_total(sub)
    used = _days(freeze_days_used(sub) + extend)
    fields: dict[str, Any] = dict(
        is_frozen=False, frozen_at=None, frozen_until=None, frozen_days_granted=None,
        freeze_days_total=total, freeze_days_used=used, freeze_days_left=_days(total - used),
    )
    expiry = subscription_pool._parse_dt(subscription_pool.get(sub, "expiry_date"))
    if expiry is not None and extend > 0:
        fields["expiry_date"] = (expiry + timedelta(days=extend)).isoformat()
    return subscription_pool.update(sub, **fields), fact, extend


def freeze_is_over(sub: Optional[dict], now: datetime) -> bool:
    """Пауза идёт, и её срок (frozen_until) уже прошёл."""
    if not subscription_pool.get(sub, "is_frozen", False):
        return False
    until = subscription_pool._parse_dt(subscription_pool.get(sub, "frozen_until"))
    return until is not None and until <= now


def auto_unfreeze_expired(session, now: datetime) -> list[dict]:
    """Снять паузы, чей срок вышел (крон charge-due).

    Каждая строка — под замком (SELECT … FOR UPDATE), чтобы не столкнуться
    с ручным снятием паузы администратором в ту же секунду. Коммит — по
    одному клиенту вместе с событием (timeline.log_event коммитит сам)."""
    from sqlmodel import select
    from app.models.user import User
    from app.services.timeline import SYSTEM_ACTOR_ID, timeline_service
    done: list[dict] = []
    for u in session.exec(select(User).where(User.subscription.is_not(None))).all():  # type: ignore[union-attr]
        if not freeze_is_over(u.subscription, now):
            continue
        locked = session.exec(
            select(User).where(User.id == u.id).with_for_update()
            .execution_options(populate_existing=True)
        ).one()
        if not freeze_is_over(locked.subscription, now):
            continue
        new_sub, fact, extend = end_freeze(locked.subscription, now)
        locked.subscription = new_sub
        session.add(locked)
        row = {"user_id": str(locked.id), "email": locked.email, "fact_days": fact,
               "extended_days": extend, "expiry_date": subscription_pool.get(new_sub, "expiry_date"),
               "freeze_days_left": subscription_pool.get(new_sub, "freeze_days_left")}
        timeline_service.log_event(
            session=session, actor_id=SYSTEM_ACTOR_ID, actor_role="system",
            target_id=str(locked.id), target_type="user", event_type="subscription_freeze",
            description=f"Пауза снята автоматически по сроку, срок абонемента +{extend:g} дн.",
            metadata={"action": "AutoUnfreezing", **row},
        )
        done.append(row)
    return done
