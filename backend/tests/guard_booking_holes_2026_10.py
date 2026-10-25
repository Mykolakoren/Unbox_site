"""СТОРОЖ: мелкие дыры в бронях (25.10).

1. Бронь через Telegram-бота не попадала в Google-календарь кабинета: бот звал
   create_booking с BackgroundTasks, которые никто не запускал.
2. Клиент мог сократить бронь за минуты до начала и получить возврат за
   остальное — в обход «отменить меньше чем за сутки нельзя».
3. С телефона админ ставил бронь задним числом только на сегодня.
4. Публичная занятость кабинетов (/bookings/external-events) отдавала заголовки
   событий Google (бывают имена) кому угодно и за любой период.
5. Загруженные файлы — без X-Content-Type-Options: nosniff.

    python3 backend/tests/guard_booking_holes_2026_10.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _src(rel):
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def test_bot_booking_goes_to_google_calendar():
    tg = _src("backend/app/api/v1/telegram.py")
    i = tg.index("result = create_booking(")
    assert "background_tasks=_bg," in tg[i:i + 300], "бот снова отдаёт create_booking выброшенные фоновые задачи"
    assert "if _t.func is _gcal_create_in_background:" in tg, "бронь из бота не уходит в Google-календарь"


def _shorten(s, actor, b):
    from app.api.v1.bookings import routes
    return routes.shorten_booking(booking_id=str(b.id), payload=routes.ShortenRequest(remove_minutes=60, side="end"),
                                  session=s, current_user=actor)


def test_client_cannot_shorten_within_24h_admin_can():
    with H.frozen_time():   # пн 05.10 10:00
        s = H._db()
        owner = H._user(s, role="owner", name="Админ", balance=0.0)
        c = H._user(s, role="specialist", name="Клиент", balance=500.0)
        soon = H._create(s, owner, c, days=0, start="18:00", minutes=120)   # через 8 ч
        try:
            _shorten(s, c, soon)
            raise AssertionError("клиент сократил бронь за 8 ч до начала")
        except HTTPException as e:
            assert e.status_code == 400 and "24 часа" in str(e.detail)
        _shorten(s, owner, soon)                                           # админ — может
        far = H._create(s, c, c, days=3, start="12:00", minutes=120)
        _shorten(s, c, far)                                                # заранее — как раньше


def test_mobile_backdate_past_days():
    mf = _src("src/pages/mobile/MobileFind.tsx")
    assert "const pastDayOptions = useMemo(" in mf and "'Вчера'" in mf
    assert "ensureBookingsRange(targetDate, addDays(targetDate, 1))" in mf, "занятость прошлого дня не догружается"
    assert "daysBack > 0 ? Math.max(0, tbilisiNow().totalMins - backMin + daysBack * 1440)" in mf, \
        "прошлый день без границы права «задним числом»"


def test_external_events_hide_titles_from_public():
    r = _src("backend/app/api/v1/bookings/routes.py")
    i = r.index("def read_external_events(")
    body = r[i:i + 3500]
    assert "viewer: Optional[User] = Depends(deps.get_optional_current_user)" in body
    assert '"title": "Занято"' in body and "viewer.role in ADMIN_ROLES" in body, "заголовки событий снова видны всем"
    assert "timedelta(days=62)" in body, "окно событий без ограничения"


def test_uploads_nosniff():
    m = _src("backend/app/main.py")
    assert 'response.headers["X-Content-Type-Options"] = "nosniff"' in m and 'startswith("/uploads/")' in m


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:500]}")
                traceback.print_exc(limit=4)
    sys.exit(1 if fails else 0)
