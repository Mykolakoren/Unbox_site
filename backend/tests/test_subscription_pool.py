"""Unit tests for app.services.subscription_pool — the money-critical bits.

Pure logic, no DB, no network. Run either way:

    python3 backend/tests/test_subscription_pool.py     # plain asserts
    pytest backend/tests/test_subscription_pool.py

NB: do NOT run bare `pytest` inside backend/ — the legacy backend/test_*.py
scripts execute against DATABASE_URL (i.e. prod) on import.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import subscription_pool as sp  # noqa: E402


def test_admin_topup_is_visible_to_the_charge_cron():
    """The bug that made clients pay twice.

    An admin top-up used to write only camelCase, while billing_defer read only
    snake_case: the cron saw an empty pool, fell back to cash and charged the
    balance for hours the client had already bought.
    """
    topped_up = {"remainingHours": 10.0, "totalHours": 10.0}
    assert sp.get_float(topped_up, "remaining_hours") == 10.0


def test_deduction_stays_visible_to_the_ui():
    """The mirror-image bug: deductions used to delete the camel keys, so the
    subscription card lost its remaining balance after the first booking."""
    pool = sp.update({"remainingHours": 10.0}, remaining_hours=8.0, used_hours=2.0)
    assert pool["remainingHours"] == 8.0  # UI
    assert pool["remaining_hours"] == 8.0  # billing
    assert pool["usedHours"] == 2.0


def test_freeze_flag_reaches_both_sides():
    pool = sp.update({"planId": "warm"}, is_frozen=True, freeze_count=1)
    assert pool["isFrozen"] is True  # SubscriptionCard
    assert sp.get(pool, "is_frozen", False) is True  # PricingService


def test_legacy_one_sided_pools_are_readable_and_repairable():
    legacy = {"remaining_hours": 3.5, "used_hours": 6.5, "plan_id": "regular"}
    assert sp.get_float(legacy, "remaining_hours") == 3.5
    assert sp.sync(legacy)["remainingHours"] == 3.5


def test_garbage_values_do_not_break_pricing():
    assert sp.get_float({"remainingHours": None}, "remaining_hours") == 0.0
    assert sp.get_float({"remaining_hours": ""}, "remaining_hours") == 0.0
    assert sp.get_float(None, "remaining_hours") == 0.0


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
    print("OK" if not failures else f"{failures} FAILED")
    sys.exit(1 if failures else 0)
