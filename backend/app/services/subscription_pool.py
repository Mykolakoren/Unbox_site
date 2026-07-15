"""Single source of truth for reading/writing ``user.subscription``.

``user.subscription`` is a free-form JSON blob passed verbatim between frontend
and backend — there is no serializer in between. The two sides ended up speaking
different dialects of it, and each one silently overwrote the other's:

* the frontend writes and reads camelCase (``remainingHours``, ``isFrozen``);
* the billing code writes and reads snake_case (``remaining_hours``) and used to
  *delete* the camel keys after every deduction.

That cost real money in both directions:

* an admin top-up wrote only ``remainingHours``, so ``billing_defer`` (snake-only)
  saw an empty pool, fell through to the cash fallback and charged the client's
  balance for hours they had already paid for;
* a deduction deleted ``remainingHours``, so the subscription card in the UI lost
  the remaining balance right after the first booking.

Read with :func:`get_float` / :func:`get`, write with :func:`update`. Both keep
the two dialects in sync, so neither side can starve the other. Legacy one-sided
pools are read correctly and repaired on the next write — no migration needed.
"""

from datetime import datetime
from typing import Any, Optional

# snake_case (backend) → camelCase (frontend). Every field either side writes.
_ALIASES: dict[str, str] = {
    "remaining_hours": "remainingHours",
    "used_hours": "usedHours",
    "total_hours": "totalHours",
    "bonus_hours": "bonusHours",
    "is_frozen": "isFrozen",
    "freeze_count": "freezeCount",
    "frozen_until": "frozenUntil",
    "frozen_at": "frozenAt",
    "expiry_date": "expiryDate",
    "plan_id": "planId",
    "free_reschedules": "freeReschedules",
    "included_formats": "includedFormats",
    "discount_percent": "discountPercent",
    # Особые условия клиента: абонемент без ограничения срока (owner-решение,
    # напр. Светлана Розова — «добивает часы вне рамок сроков»). Такой пул
    # никогда не истекает и не переходит в «завершён».
    "flexible": "flexible",
    # Жизненный цикл: active | frozen | completed. Стамп ставит крон/ревизор;
    # РЕАЛЬНЫЙ гейт денег — is_active(), считается вживую, а не по этому полю.
    "status": "status",
}


def get(sub: Optional[dict], field: str, default: Any = None) -> Any:
    """Read ``field`` (snake_case) from the pool, whichever dialect wrote it."""
    if not sub:
        return default
    for key in (field, _ALIASES.get(field, field)):
        value = sub.get(key)
        if value is not None:
            return value
    return default


def get_float(sub: Optional[dict], field: str, default: float = 0.0) -> float:
    """Read a numeric pool field as float, tolerating None/"" /bad values."""
    try:
        return float(get(sub, field, default) or default)
    except (TypeError, ValueError):
        return default


def update(sub: Optional[dict], **fields: Any) -> dict:
    """Copy ``sub`` with ``fields`` (snake_case) written in BOTH dialects."""
    new = dict(sub or {})
    for field, value in fields.items():
        new[field] = value
        new[_ALIASES.get(field, field)] = value
    return new


def sync(sub: Optional[dict]) -> dict:
    """Mirror every known field into both dialects — repairs legacy one-sided pools."""
    new = dict(sub or {})
    for snake, camel in _ALIASES.items():
        if snake in new and camel not in new:
            new[camel] = new[snake]
        elif camel in new and snake not in new:
            new[snake] = new[camel]
    return new


# ── Жизненный цикл абонемента ────────────────────────────────────────────────
# Единый источник правды: истёк / на паузе / активен. И движок цен, и статус-
# стамп спрашивают отсюда, чтобы правило не разъехалось по файлам (ровно так
# рождались прошлые денежные баги).

def _parse_dt(value: Any) -> Optional[datetime]:
    """ISO-строка (в т.ч. с Z) → naive datetime. None на мусоре — не роняем цену."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def is_flexible(sub: Optional[dict]) -> bool:
    """Особые условия: пул без ограничения срока (owner-решение по клиенту)."""
    return bool(get(sub, "flexible", False))


def is_expired(sub: Optional[dict], now: datetime) -> bool:
    """Срок действия закончился (с учётом пауз и особых условий).

    - flexible → никогда не истекает (Светлана: часы вне рамок сроков).
    - на паузе → не истёк (часы заблокированы, но клиент своё время не теряет).
      Срок продлевается на длительность паузы в момент разморозки, поэтому
      здесь достаточно сравнить now с expiry_date.
    - нет expiry_date → легаси-пул без срока, не истекает.
    """
    if not sub or is_flexible(sub):
        return False
    if get(sub, "is_frozen", False):
        return False
    expiry = _parse_dt(get(sub, "expiry_date"))
    if expiry is None:
        return False
    return now > expiry


def is_active(sub: Optional[dict], now: datetime) -> bool:
    """Может ли абонемент СЕЙЧАС покрыть бронь.

    Существует, не на паузе, не истёк. Остаток часов проверяется отдельно
    в _apply_subscription — тут только про статус пула, не про баланс часов.
    """
    if not sub:
        return False
    if get(sub, "is_frozen", False):
        return False
    if is_expired(sub, now):
        return False
    return True


def lifecycle_status(sub: Optional[dict], now: datetime) -> str:
    """active | frozen | completed | none — для отображения и стампа."""
    if not sub:
        return "none"
    if get(sub, "is_frozen", False):
        return "frozen"
    if is_expired(sub, now):
        return "completed"
    return "active"
