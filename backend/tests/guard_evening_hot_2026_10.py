"""СТОРОЖ: бронь после 21:00 на завтра до 12:00 — на подтверждение админа (владелец 06.10).

    python3 backend/tests/guard_evening_hot_2026_10.py
"""
import pathlib, sys
ROOT = pathlib.Path(__file__).parent.parent.parent

def test_backend_rule():
    s = (ROOT / "backend/app/api/v1/bookings/routes.py").read_text(encoding="utf-8")
    assert "_now_tb.hour >= 21" in s and "start_dt.hour < 12" in s
    assert "start_dt.date() == (_now_tb + _td(days=1)).date()" in s
    assert "or (_diff_hours > 0 and _evening_next_morning)" in s

def test_mobile_mirrors_rule():
    s = (ROOT / "src/pages/mobile/MobileCheckout.tsx").read_text(encoding="utf-8")
    assert "now.h >= 21" in s and "first.start.getHours() < 12" in s

if __name__ == "__main__":
    f = 0
    for n, fn in sorted(globals().items()):
        if n.startswith("test_"):
            try: fn(); print(f"  ✓ {n}")
            except AssertionError as e: f += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not f else f"УПАЛО: {f}"); sys.exit(1 if f else 0)
