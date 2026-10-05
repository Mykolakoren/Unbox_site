"""СТОРОЖ «Клиенты дня» в «Итогах дня» (владелец 05.10): вечерняя сверка с таблицей.

Сервис отдаёт clients (кто был в день: подтверждённые/прошедшие брони без
обслуживания, филиал, часы, баланс на конец дня тем же способом, что «Должны»),
экран показывает блок «Клиенты дня — для сверки».

    python3 backend/tests/guard_day_clients_2026_10.py
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_service_returns_clients_of_day():
    s = _read("backend/app/services/day_summary.py")
    assert "def clients_of_day(" in s
    assert '"clients": clients_of_day(session, day, min(end, now_utc or datetime.utcnow()), branch)' in s
    body = s[s.index("def clients_of_day("):s.index("# ── Главная функция ──")]
    assert '"confirmed", "completed"' in body, "в список — только подтверждённые и прошедшие брони"
    assert "maintenance" in body, "обслуживание (закрытие кабинета) — не клиент"
    assert "BalanceLedger.created_at >= at_utc" in body, "баланс на конец дня — как у «Должны»"


def test_screen_shows_clients_card():
    s = _read("src/components/admin/cashbox/DaySummary.tsx")
    assert "function ClientsCard(" in s and "<ClientsCard data={shown}" in s
    assert "Клиенты дня — для сверки" in s
    assert "if (!clients || clients.count === 0) return null" in s, "старый бэк без поля — блока нет, без ошибок"
    t = _read("src/api/cashbox.ts")
    assert "clients?: {" in t


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
