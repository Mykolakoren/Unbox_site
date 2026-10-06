"""СТОРОЖ: «к оплате» только за сегодняшние и прошедшие брони (владелец 06.10).

Бронь на завтра сайт списывает за сутки — долг по ней сегодня не просим:
«Взять сегодня», «Принять оплату» в «Сегодня», на телефоне и в окне брони.

    python3 backend/tests/guard_pay_only_past_2026_10.py
"""
import pathlib, sys
ROOT = pathlib.Path(__file__).parent.parent.parent
r = lambda p: (ROOT / p).read_text(encoding="utf-8")

def test_future_charged_due_excluded():
    t = r("src/utils/adminToday.ts")
    assert "export function futureChargedDue(" in t and "if (!k || k <= dayKey) continue;" in t
    assert "futureDue?.get(String(list[0].userId))" in t
    assert "byClient(rows, users, futureDue)" in r("src/pages/admin/Dashboard.tsx")
    assert "futureChargedDue(bookings, dueMap, todayKey)" in r("src/pages/mobile/admin/MobileAdminDashboard.tsx")
    assert "futureChargedDue(bookings, dueMap, batumiDayKey())" in r("src/pages/mobile/admin/adminPayment.ts")
    h = r("src/components/admin/BookingMoneyHints.tsx")
    assert "laterDebt" in h and "k > todayKey" in h

if __name__ == "__main__":
    f = 0
    for n, fn in sorted(globals().items()):
        if n.startswith("test_"):
            try: fn(); print(f"  ✓ {n}")
            except AssertionError as e: f += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not f else f"УПАЛО: {f}"); sys.exit(1 if f else 0)
