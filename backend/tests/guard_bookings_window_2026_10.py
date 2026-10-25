"""СТОРОЖ: админка грузит брони окном дат, а не «5000 последних» (25.10).

Броней стало 9576, а список отдавал 5000 свежих по дате: шахматка за август и
раньше была пустой, графики аналитики за старые месяцы — заниженными, ссылка
на старую бронь из карточки клиента её не находила.

Теперь: окно по умолчанию 45 дней назад + 60 вперёд; шахматка, мобильный
список дня, мастер брони админа и аналитика догружают свои дни
(ensureBookingsRange); бронь по номеру — /bookings?booking_id= (ensureBookingLoaded).

    python3 backend/tests/guard_bookings_window_2026_10.py
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _src(rel):
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _ids(s, actor, **kw):
    from app.api.v1.bookings import routes
    args = {"skip": 0, "limit": 5000, "user_id": None, "date_from": None, "date_to": None, "booking_id": None,
            "recurring_group_id": None}
    args.update(kw)
    return [b.id for b in routes.read_bookings(session=s, current_user=actor, **args)]


def test_server_filters_by_dates_and_id():
    with H.frozen_time():
        s = H._db()
        a = H._user(s, role="owner", name="Админ", balance=0.0)
        c = H._user(s, role="specialist", name="Клиент", balance=500.0)
        near = H._create(s, a, c, days=2, start="10:00")      # 07.10
        far = H._create(s, a, c, days=20, start="11:00")      # 25.10
        assert set(_ids(s, a)) == {near.id, far.id}, "без параметров — как раньше"
        assert _ids(s, a, date_from=date(2026, 10, 6), date_to=date(2026, 10, 8)) == [near.id]
        assert _ids(s, a, date_from=date(2026, 10, 7), date_to=date(2026, 10, 7)) == [], "to — не включая"
        assert _ids(s, a, date_from=date(2026, 10, 25)) == [far.id], "from — включительно"
        assert _ids(s, a, booking_id=str(far.id)) == [far.id]
        assert _ids(s, a, booking_id="не-номер") == []
        far.recurring_group_id = "grp-1"; s.add(far); s.commit()
        assert _ids(s, a, recurring_group_id="grp-1") == [far.id]


def test_series_tail_from_server_not_window():
    """Серия дальше +60 дней: «эту и следующие» должно считать всю серию, как сервер."""
    for f in ("src/components/admin/AdminChessboardView.tsx", "src/pages/admin/Bookings.tsx"):
        src = _src(f)
        assert "bookingsApi.getSeriesBookings(" in src, f"{f}: хвост серии снова из окна дат"


def test_store_uses_window_not_latest_5000():
    st = _src("src/store/slices/createBookingSlice.ts")
    assert "bookingsApi.getBookingsWindow(w.from, w.to)" in st, "админский список снова «5000 последних»"
    assert "WINDOW_BACK_DAYS = 45" in st, "окно назад < 45 дней ломает «активен за 45 дней» в CRM"
    assert "ensureBookingsRange: async" in st and "ensureBookingLoaded: async" in st
    assert "windowLoaded = false" in st[st.index("fetchBookings: async"):st.index("fetchAllBookings: async")], \
        "«мои + публичные» не должны считаться загруженным админским окном"
    leftovers = [f for f in ("src/pages/mobile/MobileFind.tsx",) if "getAllBookings(" in _src(f)]
    assert not leftovers, f"ищут бронь среди «5000 последних»: {leftovers}"


def test_screens_load_their_own_days():
    assert "ensureBookingsRange(new Date(rangeFromMs), new Date(rangeToMs))" in _src("src/components/admin/AdminChessboardView.tsx")
    assert "void ensureBookingLoaded(highlightId)" in _src("src/components/admin/AdminChessboardView.tsx")
    assert "ensureBookingsRange(targetDate, addDays(targetDate, 1))" in _src("src/pages/mobile/admin/MobileAdminBookings.tsx")
    assert "ensureBookingsRange(period.from, to)" in _src("src/pages/admin/Finance.tsx")
    assert "ensureBookingsRange(new Date(dayMs)" in _src("src/components/Wizard/ChessboardStep.tsx")
    b = _src("src/pages/admin/Bookings.tsx")
    assert "<BookingsWindowBar />" in b and "void ensureBookingLoaded(id)" in b


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:500]}")
    sys.exit(1 if fails else 0)
