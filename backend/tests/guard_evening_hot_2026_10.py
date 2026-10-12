"""СТОРОЖ: бронь после 21:00 на завтра до 12:00 — на подтверждение админа (владелец 06.10).

    python3 backend/tests/guard_evening_hot_2026_10.py
"""
import pathlib, sys
ROOT = pathlib.Path(__file__).parent.parent.parent

def test_backend_rule():
    # 12.10: правило — в services/booking_policy.is_hot_start (одно на все пути).
    s = (ROOT / "backend/app/services/booking_policy.py").read_text(encoding="utf-8")
    assert "now_tb.hour >= 21" in s and "start_tb.hour < 12" in s
    assert "start_tb.date() == (now_tb + timedelta(days=1)).date()" in s
    assert "or (diff_hours > 0 and evening_next_morning)" in s
    r = (ROOT / "backend/app/api/v1/bookings/routes.py").read_text(encoding="utf-8")
    assert "is_hot = is_hot_start(start_dt)" in r


def test_backend_rule_cases():
    import os
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ.setdefault("ENVIRONMENT", "development")
    from datetime import datetime, timezone
    from app.services.booking_policy import is_hot_start
    now = datetime(2026, 10, 12, 18, 30, tzinfo=timezone.utc)          # пн 22:30 по Тбилиси
    assert is_hot_start(datetime(2026, 10, 13, 11, 0), now)            # завтра 11:00 — после 21:00 на утро
    assert not is_hot_start(datetime(2026, 10, 13, 13, 0), now)        # завтра 13:00 — 14,5 ч, не срочно
    early = datetime(2026, 10, 12, 10, 0, tzinfo=timezone.utc)         # пн 14:00
    assert is_hot_start(datetime(2026, 10, 12, 20, 0), early)          # через 6 ч
    assert not is_hot_start(datetime(2026, 10, 13, 11, 0), early)      # 21 ч, днём
    sat = datetime(2026, 10, 16, 8, 0, tzinfo=timezone.utc)            # пт 12:00
    assert is_hot_start(datetime(2026, 10, 17, 10, 0), sat)            # сб 10:00 — 22 ч < 24 в выходные
    assert not is_hot_start(datetime(2026, 10, 12, 9, 0), early)       # уже прошла — не «срочная»

def test_mobile_mirrors_rule():
    s = (ROOT / "src/pages/mobile/MobileCheckout.tsx").read_text(encoding="utf-8")
    # 12.10: каждый слот корзины (item), не только первый
    assert "now.h >= 21" in s and "item.start.getHours() < 12" in s

if __name__ == "__main__":
    f = 0
    for n, fn in sorted(globals().items()):
        if n.startswith("test_"):
            try: fn(); print(f"  ✓ {n}")
            except AssertionError as e: f += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not f else f"УПАЛО: {f}"); sys.exit(1 if f else 0)
