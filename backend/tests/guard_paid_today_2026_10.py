"""СТОРОЖ «Оплачено сегодня» в списке броней (просьба админов 08.10: свести кассу за день).

У оплаты в «чем оплачено» — день («наличные в кассу · сегодня» / «· 06.10»),
сегодняшние — зелёным; фильтр «₾ Оплачено сегодня» оставляет брони, оплаченные
деньгами, принятыми сегодня (по раскладке ленты), и пишет, сколько принято,
сколько ушло на брони и сколько легло на баланс вперёд.

    python3 backend/tests/guard_paid_today_2026_10.py
"""
import importlib.util, pathlib, sys
from datetime import date

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _m():
    spec = importlib.util.spec_from_file_location("ba_guard_paid_today", ROOT / "backend/app/services/balance_allocation.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules["ba_guard_paid_today"] = m
    spec.loader.exec_module(m)
    return m


def test_label_has_day():
    m = _m()
    today = date(2026, 10, 8)
    # 08.10 05:00 UTC = 09:00 Тбилиси — сегодня; 07.10 21:00 UTC = 08.10 01:00 Тбилиси — тоже сегодня.
    src = lambda d, det="наличные": {"kind": "topup", "detail": det, "date": d}
    assert m.paid_via_label([src("2026-10-08T05:00:00")], 0, today) == ["наличные в кассу · сегодня"]
    assert m.paid_via_label([src("2026-10-07T21:00:00", "TBC")], 0, today) == ["на счёт TBC · сегодня"], "день — по Тбилиси"
    assert m.paid_via_label([src("2026-10-06T10:00:00", "BOG")], 0, today) == ["на счёт BOG · 06.10"]
    assert m.paid_via_label([src("2026-10-06T10:00:00")], 0) == ["наличные в кассу"], "без today — как раньше"


def test_service_and_endpoint():
    s = _read("backend/app/services/balance_allocation.py")
    body = s[s.index("def paid_today("):]
    assert 'L.reason.in_(("topup", "topup_adjust"))' in body
    assert "datetime.combine(day, datetime.min.time()) - TZ" in body, "границы дня — по Тбилиси"
    assert "session.add(" not in body and "commit(" not in body, "только чтение"
    assert '"paidToday": paid_today' in s
    a = _read("backend/app/api/v1/balance_allocation.py")
    seg = a[a.index('"/balance-allocation/paid-today"'):]
    assert "Depends(require_clients_view)" in seg


def test_screen():
    s = _read("src/pages/admin/Bookings.tsx")
    assert "₾ Оплачено сегодня" in s and "data-paid-today-filter" in s
    assert "if (paidTodayOnly && paidTodayIds && !paidTodayIds.has(b.id)) return false;" in s
    assert "item.paidToday ? STATUS.ok.fg" in s
    assert "Полная сверка — «Касса → Итоги дня»." in s
    h = _read("src/hooks/useBalanceAllocation.ts")
    assert "export function usePaidToday(" in h


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except AssertionError as e:
                fails += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not fails else f"УПАЛО: {fails}")
    sys.exit(1 if fails else 0)
