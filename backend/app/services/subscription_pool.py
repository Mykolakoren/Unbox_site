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
    "expiry_date": "expiryDate",
    "plan_id": "planId",
    "free_reschedules": "freeReschedules",
    "included_formats": "includedFormats",
    "discount_percent": "discountPercent",
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
