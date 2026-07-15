"""Жизненный цикл абонемента: срок, пауза, особые условия.

Что это ловит (решения owner, 2026-07-15):
  1. Истёкший абонемент НЕ должен покрывать брони — до этого бэкенд срок не
     проверял вовсе, и абонемент с остатком часов давал бесплатный кабинет
     бессрочно (Надежда Мирошина: истёк 09.07, часы «работали»).
  2. Пауза продлевает срок на своё время — иначе клиент терял оплаченные дни.
  3. flexible-пул не истекает никогда (Светлана: часы вне рамок сроков).

Чистая логика, без БД и сети.

    python3 backend/tests/test_subscription_lifecycle.py
    pytest backend/tests/test_subscription_lifecycle.py
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import subscription_pool as sp  # noqa: E402

NOW = datetime(2026, 7, 15, 12, 0, 0)


def _pool(**over):
    base = {
        "plan_id": "PRO_PLUS",
        "total_hours": 40.0, "used_hours": 0.0, "remaining_hours": 40.0,
        "included_formats": ["individual"],
        "expiry_date": (NOW + timedelta(days=10)).isoformat(),  # ещё действует
    }
    base.update(over)
    return base


# ── срок ─────────────────────────────────────────────────────────────────────

def test_active_within_validity():
    assert sp.is_active(_pool(), NOW) is True
    assert sp.is_expired(_pool(), NOW) is False
    assert sp.lifecycle_status(_pool(), NOW) == "active"


def test_expired_subscription_is_not_active():
    """Истёк вчера — брони больше не покрывает (уходит на баланс)."""
    p = _pool(expiry_date=(NOW - timedelta(days=1)).isoformat())
    assert sp.is_expired(p, NOW) is True
    assert sp.is_active(p, NOW) is False
    assert sp.lifecycle_status(p, NOW) == "completed"


def test_nadezhda_case_expired_but_has_hours():
    """Надежда: срок истёк 09.07, но в пуле 42 часа. Часы НЕ должны работать."""
    p = _pool(remaining_hours=42.0, expiry_date="2026-07-09T00:00:00")
    assert sp.is_active(p, NOW) is False, "истёкший абонемент не покрывает бронь"


def test_no_expiry_date_is_treated_as_non_expiring():
    """Легаси-пул без срока не должен внезапно 'истечь'."""
    p = _pool()
    del p["expiry_date"]
    assert sp.is_expired(p, NOW) is False
    assert sp.is_active(p, NOW) is True


def test_garbage_expiry_does_not_crash():
    p = _pool(expiry_date="не-дата")
    assert sp.is_expired(p, NOW) is False  # мусор → не истекаем, цену не роняем


# ── пауза ────────────────────────────────────────────────────────────────────

def test_frozen_is_paused_not_expired_and_not_active():
    """На паузе: не активен (часы заблокированы), но и не 'завершён'."""
    p = _pool(is_frozen=True)
    assert sp.is_active(p, NOW) is False
    assert sp.is_expired(p, NOW) is False
    assert sp.lifecycle_status(p, NOW) == "frozen"


def test_frozen_past_expiry_does_not_complete():
    """Клиент на паузе не должен 'завершиться', даже если формальный срок прошёл —
    срок продлится на разморозке."""
    p = _pool(is_frozen=True, expiry_date=(NOW - timedelta(days=2)).isoformat())
    assert sp.is_expired(p, NOW) is False
    assert sp.lifecycle_status(p, NOW) == "frozen"


# ── особые условия ───────────────────────────────────────────────────────────

def test_flexible_never_expires():
    """Светлана: абонемент без ограничения срока — истечь не может."""
    p = _pool(flexible=True, expiry_date="2026-05-31T00:00:00")  # формально давно прошёл
    assert sp.is_expired(p, NOW) is False
    assert sp.is_active(p, NOW) is True
    assert sp.lifecycle_status(p, NOW) == "active"


def test_flexible_still_blocked_while_frozen():
    """Даже гибкий абонемент на паузе не покрывает бронь."""
    p = _pool(flexible=True, is_frozen=True)
    assert sp.is_active(p, NOW) is False


# ── интеграция с движком цен ─────────────────────────────────────────────────

def test_pricing_ignores_expired_subscription():
    """_apply_subscription обязан отказать по истёкшему абонементу → цена на баланс."""
    from types import SimpleNamespace
    from app.services.pricing import PricingService, PriceBreakdown

    svc = PricingService.__new__(PricingService)  # без БД
    breakdown = PriceBreakdown(base_price=20.0, hourly_rate=20.0, booked_hours=1.0,
                               applied_rule="NONE", final_price=20.0)
    user = SimpleNamespace(
        subscription=_pool(expiry_date=(NOW - timedelta(days=1)).isoformat()),
        email="x@test", pricing_system="standard", personal_discount_percent=0,
    )
    # истёкший абонемент → _apply_subscription = False (не применён)
    assert svc._apply_subscription(user, breakdown, resource=None, format_type="individual") is False
    assert breakdown.final_price == 20.0, "цена осталась к оплате с баланса"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  ✗ {name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("OK" if not failures else f"FAILED ({failures})")
    sys.exit(1 if failures else 0)
