"""СТОРОЖ: допы в корзине (25.10).

Корзина (несколько слотов сразу, /bookings/multi-slot) не передавала и не
принимала допуслуги: клиент выбирал кофе, а брони создавались без него и без
его цены — персонал не готовил, Unbox не получал денег.

Теперь допы слота сохраняются в брони и цена слота = кабинет + допы, ровно как
у одиночной брони того же слота.

    python3 backend/tests/guard_cart_extras_2026_10.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _cart(s, u, slots, method="balance"):
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    req = routes.MultiSlotRequest(slots=[routes.MultiSlotItem(**x) for x in slots], payment_method=method)
    out = routes.create_multi_slot_booking(session=s, data=req, current_user=u)
    return [s.get(Booking, b["id"] if isinstance(b, dict) else b.id) for b in out["bookings"]]


def test_cart_keeps_extras_and_charges_them_like_single():
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Корзина")
        day = H._day(3).strftime("%Y-%m-%d")
        rows = _cart(s, u, [
            dict(resource_id="room_1", location_id="unbox_uni", date=day, start_time="10:00", duration=60,
                 extras=["coffee_meama", "sandbox"]),
            dict(resource_id="room_2", location_id="unbox_uni", date=day, start_time="12:00", duration=60),
        ])
        with_extras = next(b for b in rows if b.resource_id == "room_1")
        plain = next(b for b in rows if b.resource_id == "room_2")
        assert sorted(with_extras.extras or []) == ["coffee_meama", "sandbox"], "доп слота потерялся"
        assert not plain.extras
        assert abs(float(with_extras.final_price) - float(plain.final_price) - 8.0) < 0.005, \
            f"кофе 3 + песочница 5 = 8 ₾ сверх кабинета, а вышло {with_extras.final_price} vs {plain.final_price}"
        # Та же бронь одиночной — та же цена.
        single = H._create(s, u, u, days=4, start="10:00", resource="room_1")
        single_extras_price = float(with_extras.final_price) - float(plain.final_price)
        assert abs(single_extras_price - 8.0) < 0.005 and float(single.final_price) == float(plain.final_price)


def test_cart_rejects_unknown_extra():
    from fastapi import HTTPException
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Корзина")
        day = H._day(3).strftime("%Y-%m-%d")
        try:
            _cart(s, u, [dict(resource_id="room_1", location_id="unbox_uni", date=day, start_time="10:00",
                              duration=60, extras=["шампанское"]),
                         dict(resource_id="room_2", location_id="unbox_uni", date=day, start_time="12:00", duration=60)])
            raise AssertionError("неизвестный доп прошёл")
        except HTTPException as e:
            assert e.status_code == 400


def test_cart_subscription_slot_takes_extras_as_money_and_cancel_returns_them():
    from fastapi import BackgroundTasks
    from sqlmodel import select
    from app.api.v1.bookings import routes
    from app.models.balance_ledger import BalanceLedger
    from app.models.user import User
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", sub=H._sub(), balance=100.0, name="Абонемент")
        # Завтра 09:30 — через 23,5 ч: не срочно и не «за сутки», списание сразу.
        day = H._day(1).strftime("%Y-%m-%d")
        rows = _cart(s, u, [
            dict(resource_id="room_1", location_id="unbox_uni", date=day, start_time="09:30", duration=60,
                 extras=["sandbox"]),
            dict(resource_id="room_2", location_id="unbox_uni", date=day, start_time="09:30", duration=60),
        ], method="subscription")
        s.expire_all()
        ext = next(b for b in rows if b.resource_id == "room_1")
        plain = next(b for b in rows if b.resource_id == "room_2")
        assert ext.status == "confirmed" and ext.payment_status == "paid", (ext.status, ext.payment_status)
        assert ext.payment_method == "subscription" and sorted(ext.extras) == ["sandbox"]
        taken = lambda b: -sum(r.delta for r in s.exec(select(BalanceLedger).where(  # noqa: E731
            BalanceLedger.ref_id == str(b.id))).all())
        assert abs(taken(ext) - taken(plain) - 5.0) < 0.005, \
            f"песочница 5 ₾ деньгами сверх часов: с допом {taken(ext)}, без {taken(plain)}"
        before = float(s.get(User, u.id).balance)
        routes.cancel_booking(booking_id=str(ext.id), background_tasks=BackgroundTasks(), session=s,
                              current_user=H._user(s, role="owner", name="О", balance=0))
        s.expire_all()
        assert abs(float(s.get(User, u.id).balance) - before - taken(plain) - 5.0) < 0.01 or \
            abs(float(s.get(User, u.id).balance) - (before + (taken(plain) + 5.0))) < 0.01, \
            "отмена не вернула деньги брони с допом"
        led = s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(u.id))).all()
        # Стартовые 100 ₾ стенд кладёт без строки ленты.
        assert abs(100.0 + sum(r.delta for r in led) - float(s.get(User, u.id).balance)) < 0.005


def test_cart_hot_slot_with_extra_charges_on_approval_only():
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.user import User
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=100.0, name="Срочно")
        day = H._day(0).strftime("%Y-%m-%d")       # через 1–2 ч — срочно (≤12 ч)
        rows = _cart(s, u, [
            dict(resource_id="room_1", location_id="unbox_uni", date=day, start_time="11:00", duration=60,
                 extras=["coffee_meama"]),
            dict(resource_id="room_2", location_id="unbox_uni", date=day, start_time="11:00", duration=60),
        ])
        hot = next(b for b in rows if b.resource_id == "room_1")
        assert hot.status == "pending_approval", hot.status
        s.expire_all()
        assert abs(float(s.get(User, u.id).balance) - 100.0) < 0.005, "заявка до одобрения не списывает"
        price = float(hot.final_price)
        owner = H._user(s, role="owner", name="Админ", balance=0.0)
        routes.approve_booking(booking_id=str(hot.id), session=s, current_user=owner)
        s.expire_all()
        assert abs(100.0 - float(s.get(User, u.id).balance) - price) < 0.005, "одобрение списало не цену с допом"


def test_frontend_sends_extras():
    st = open(os.path.join(_REPO, "src/store/slices/createBookingSlice.ts"), encoding="utf-8").read()
    i = st.index("createMultiSlotBooking({")
    assert "extras: Array.isArray(b.extras) ? b.extras : []" in st[i:i + 900], "корзина снова шлёт слоты без допов"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:400]}")
                traceback.print_exc(limit=4)
    sys.exit(1 if fails else 0)
