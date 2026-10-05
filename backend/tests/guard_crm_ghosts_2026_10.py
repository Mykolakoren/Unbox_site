"""СТОРОЖ «сессии без кабинета» в шахматке CRM (владелец 05.10, этапы 1–2).

Встречи из Google-календаря (CRM-сессии без аренды) видны полупрозрачно;
своя аренда без сессии — полупрозрачно «нет сессии». Действия: привязать
к своей аренде (обновить существующую сессию) или снять кабинет — и
привязать ЭТУ же сессию, а не создавать вторую. Деньги — только через
обычное окно брони.

    python3 backend/tests/guard_crm_ghosts_2026_10.py
"""
import pathlib, sys
ROOT = pathlib.Path(__file__).parent.parent.parent
SRC = (ROOT / "src/components/crm/CrmChessboardView.tsx").read_text(encoding="utf-8")


def test_ghosts_only_unbooked_live_sessions():
    i = SRC.index("const ghostSessions = useMemo")
    body = SRC[i:i + 900]
    assert "sess.bookingId" in body and "CANCELLED_CLIENT" in body and "CANCELLED_THERAPIST" in body
    assert "utcNaiveToTbilisi(sess.date)" in body, "время сессии — UTC-naive → по Тбилиси"


def test_book_cabinet_links_existing_session_not_new():
    i = SRC.index("const handleBooked = async")
    body = SRC[i:i + 900]
    assert "ghostLinkRef.current" in body and "updateSession(ghost.sessionId, { bookingId, isBooked: true })" in body
    assert body.index("updateSession(ghost.sessionId") < body.index("createSessionResolvingCalendar"), \
        "сначала привязка существующей сессии, новая — только без «призрака»"
    assert "useEffect(() => { if (!bookSlot) ghostLinkRef.current = null; }, [bookSlot]);" in SRC, \
        "закрыли окно брони — привязка сбрасывается, следующая бронь чужую сессию не заберёт"


def test_no_series_for_calendar_session():
    assert "{!presetClientId && <div>" in SRC, "у сессии из календаря нет выбора серии (задвоение первой встречи)"


def test_own_booking_without_session_marked():
    assert "const noSession = isMine && linkedSessions.length === 0;" in SRC
    assert "(noSession ? ' · нет сессии' : '')" in SRC


if __name__ == "__main__":
    f = 0
    for n, fn in sorted(globals().items()):
        if n.startswith("test_"):
            try: fn(); print(f"  ✓ {n}")
            except AssertionError as e: f += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not f else f"УПАЛО: {f}"); sys.exit(1 if f else 0)
