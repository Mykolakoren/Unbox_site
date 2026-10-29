"""СТОРОЖ: продление поверх пересдачи и перенос целиком (29.10).

1. Продление брони Богдана Барановского упёрлось в бронь Аллы Коноплицкой,
   выставленную на пересдачу, — «слот занят». Пересдача для того и есть, чтобы
   время забрали: как при новой брони — её бронь отменяется, ей 50 % назад.
2. Егор перенёс 4-часовую бронь с телефона — получился 1 час: длительности
   4 ч не было среди кнопок, и подставлялся 1 час. Перенос двигает бронь целиком.

    python3 backend/tests/guard_extend_rerent_reschedule_2026_10.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402
from fastapi import HTTPException  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _extend(s, actor, b, minutes=30):
    from app.api.v1.bookings import routes
    return routes.extend_booking(booking_id=str(b.id), payload=routes.ExtendRequest(extra_minutes=minutes),
                                 session=s, current_user=actor)


def test_extend_takes_over_re_rent_and_refunds_half():
    from app.models.booking import Booking
    from app.models.user import User
    with H.frozen_time():
        s = H._db()
        admin = H._user(s, role="owner", name="Админ", balance=0.0)
        bogdan = H._user(s, role="specialist", name="Богдан", balance=500.0)
        alla = H._user(s, role="specialist", name="Алла", balance=500.0)
        b = H._create(s, admin, bogdan, days=0, start="14:00", minutes=60)
        a = H._create(s, admin, alla, days=0, start="15:00", minutes=60)
        s.refresh(a)
        assert a.payment_status == "paid", "стенд: бронь Аллы должна быть оплачена (сегодня)"
        alla_paid = float(a.charge_amount or 0)
        alla_before = float(s.get(User, alla.id).balance)
        a.is_re_rent_listed = True; s.add(a); s.commit()
        _extend(s, admin, b, 30)                      # раньше: 409 «Слот занят»
        s.expire_all()
        assert s.get(Booking, b.id).duration == 90
        aa = s.get(Booking, a.id)
        assert aa.status == "cancelled" and not aa.is_re_rent_listed, "пересдача не забрана"
        got_back = float(s.get(User, alla.id).balance) - alla_before
        assert abs(got_back - alla_paid * 0.5) < 0.01, f"Алле ждали 50 % ({alla_paid * 0.5}), вернулось {got_back}"


def test_extend_still_blocked_by_normal_booking():
    with H.frozen_time():
        s = H._db()
        admin = H._user(s, role="owner", name="Админ", balance=0.0)
        c1 = H._user(s, role="specialist", name="Первый", balance=500.0)
        c2 = H._user(s, role="specialist", name="Второй", balance=500.0)
        b = H._create(s, admin, c1, days=0, start="14:00", minutes=60)
        H._create(s, admin, c2, days=0, start="15:00", minutes=60)
        try:
            _extend(s, admin, b, 30)
            raise AssertionError("продление залезло на чужую обычную бронь")
        except HTTPException as e:
            assert e.status_code == 409


def test_mobile_reschedule_moves_whole_booking():
    mf = open(os.path.join(_REPO, "src/pages/mobile/MobileFind.tsx"), encoding="utf-8").read()
    assert "setDuration(rescheduleBooking.duration ?? 60);" in mf, "длительность переноса снова подгоняется под кнопки"
    assert "newDuration: rescheduleBooking.duration ?? duration," in mf
    assert "{formatBookingDuration(duration)} — как в брони" in mf, "при переносе снова предлагаются 1/2/3 ч"


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
