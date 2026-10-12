"""СТОРОЖ: вечерняя сверка балансов с таблицей (чат админов 12.10).

1. Анна Калекина: «Принять оплату» в карточке брони подставляла 93 ₾ вместо 37.
   Правило владельца 06.10 «долг за брони после сегодня не просим» смотрело на
   d.date — время СПИСАНИЯ, а завтрашние брони списываются сегодня (за сутки),
   поэтому их долг считался сегодняшним. День долга — день БРОНИ.
2. Лиза: вечером баланс уже без завтрашних броней — с таблицей за день не
   сверить. Рядом с балансом — «на сегодня» (баланс + уже списанное за брони
   после сегодня) в карточке брони и в карточке клиента.

    python3 backend/tests/guard_reconcile_2026_10.py
"""
import os
import re
import sys

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _src(rel):
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _fn(src, name):
    i = src.index(f"export function {name}(")
    j = src.find("\nexport ", i + 10)
    body = src[i:j if j != -1 else len(src)]
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    return re.sub(r"//[^\n]*", "", body)


def test_debt_day_is_booking_day():
    a = _src("src/utils/balanceAllocation.ts")
    for name in ("debtAfterDay", "chargedAfterDay"):
        body = _fn(a, name)
        assert ".booking?.date" in body, f"{name}: день — по брони"
        assert "d.date ?" not in body and "(d.date)" not in body, f"{name}: снова время списания вместо дня брони"
    h = _src("src/components/admin/BookingMoneyHints.tsx")
    assert "debtAfterDay(alloc!, todayKey, bookingDayKey)" in h
    assert "d.date ? bookingDayKey(d.date)" not in h, "карточка брони снова считает день долга по времени списания"


def test_balance_today_line_shown():
    h = _src("src/components/admin/BookingMoneyHints.tsx")
    assert "chargedAfterDay(alloc!, todayKey, bookingDayKey)" in h and "data-balance-today" in h
    u = _src("src/pages/admin/UserDetails.tsx")
    assert "chargedAfterDay(balAlloc!, batumiDayKey(), bookingDayKey)" in u and "data-balance-today" in u
    assert re.search(r"на сегодня", u) and re.search(r"На сегодня", h)


def test_backend_debt_entry_carries_booking_day():
    """Фронт берёт день брони из debts[].booking.date — сервер его отдаёт."""
    b = _src("backend/app/services/balance_allocation.py")
    i = b.index("debts.append(entry)")
    entry = b[b.rindex("entry = {", 0, i):i]
    assert '"booking": booking_public(b)' in entry
    assert '"date": b.day.isoformat()' in _src("backend/app/services/balance_allocation.py")


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:300]}")
    sys.exit(1 if fails else 0)
