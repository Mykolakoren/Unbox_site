"""СТОРОЖ «Один календарь» Psy-CRM — неделя (этапы 4.1–4.4, владелец 10.10).

Неделя: сессии + свои аренды на одной сетке; новая встреча по клику (сессия +
событие в Google + по желанию аренда); перенос перетаскиванием — ТОЛЬКО через
готовые запросы (перенос брони двигает и сессию, и событие на сервере), своих
денежных формул нет. Время — по Тбилиси (никакого toISOString).
Телефон: полка «Аренда без сессии» в «Сегодня».

    python3 backend/tests/guard_crm_week_2026_10.py
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_week_grid_uses_existing_requests_only():
    s = _read("src/components/crm/CrmWeekGrid.tsx")
    assert "toISOString" not in s, "время сессии ушло бы на сервер по UTC — сдвиг на 4 часа"
    assert "toTbilisiNaive(" in s and "utcNaiveToTbilisi(" in s
    move = s[s.index("const moveItem = async"):s.index("// ── Рисунок")]
    assert "bookingsApi.rescheduleBooking(" in move, "сессия с арендой переносится переносом брони"
    assert "crmApi.updateSession(" in move, "сессия без кабинета — переносом сессии"
    assert "await confirm(" in move, "перенос — только после подтверждения"
    assert "wallet" not in s.lower() or "Wallet" in s, "своих денежных операций нет"
    assert not re.search(r"final_price\s*[-+*/]=|charge_amount", s), "денежных формул в неделе быть не должно"
    nm = s[s.index("function NewMeetingSheet("):s.index("// ── Плитка: подробности")]
    assert "createSessionResolvingCalendar(" in nm and "pushToCalendar: true" in nm
    assert "createRental(" in nm and "disabled={past}" in nm, "кабинет в прошлом не снимаем"
    assert "Math.max(60, Math.ceil(sessionMin / SLOT) * SLOT)" in s, "аренда под сессию — полчасами, не меньше часа"


def test_keyboard_and_tablet():
    s = _read("src/components/crm/CrmWeekGrid.tsx")
    assert "data-week-add" in s and "aria-label={`Новая встреча, ${formatDateLabel(d)}`}" in s, "создать встречу без мыши"
    assert "data-move-form" in s and "onMove(moveDay, toMin(moveTime))" in s, "перенести без мыши"
    assert "window.scrollBy(0, 14)" in s, "автопрокрутка у края при перетаскивании"
    assert "pointercancel" in s and "justDragged" in s


def test_wired_into_sessions_and_phone():
    p = _read("src/pages/crm/CrmSessions.tsx")
    assert "p.view === 'week' && !ghNarrow && p.onNewSession ?" in p and "<CrmWeekGrid onChanged={p.onReload} />" in p
    m = _read("src/pages/mobile/crm/MobileCrmToday.tsx")
    assert "data-rentals-shelf" in m and "rentalsWithoutSession(" in m and "<RentalSessionSheet" in m


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
