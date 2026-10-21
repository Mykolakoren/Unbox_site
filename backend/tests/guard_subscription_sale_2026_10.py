"""СТОРОЖ: продажа абонемента — частями и с переводом уже списанных броней (21.10).

Валерия Костенецкая 21.10: внесла за Профи+ 400 ₾, а продажа записала в кассу
650 (в ящике на 250 меньше). Брони на сегодня/завтра уже списались деньгами
(«абонемент исчерпан → с баланса») — новый абонемент их не забрал, админ
удалял и ставил заново.

    python3 backend/tests/guard_subscription_sale_2026_10.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402


def _bal(s, u):
    from app.models.user import User
    s.expire_all()
    return round(float(s.get(User, u.id).balance or 0), 2)


def test_partial_payment_leaves_debt():
    from sqlmodel import select
    from app.models.cashbox_transaction import CashboxTransaction
    from app.models.user import User
    from app.services import subscription_pool as P
    from app.services.subscription_sale import sell_subscription
    with H.frozen_time():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=0.0, name="Частями")
        r = sell_subscription(s, s.get(User, u.id), "PRO_PLUS", "cash", admin, branch="Unbox One", paid_now=400)
        s.commit()
        txs = s.exec(select(CashboxTransaction).where(CashboxTransaction.credited_user_id == str(u.id))).all()
        assert [float(t.amount) for t in txs] == [400.0], [t.amount for t in txs]
        assert (r["paid_now"], r["debt"], _bal(s, u)) == (400.0, 250.0, -250.0), (r["paid_now"], r["debt"], _bal(s, u))
        assert P.is_active(s.get(User, u.id).subscription, H.FakeDatetime.utcnow())
        # без paid_now — как раньше, целиком
        v = H._user(s, role="specialist", balance=0.0, name="Целиком")
        r = sell_subscription(s, s.get(User, v.id), "PRO_PLUS", "cash", admin, branch="Unbox One")
        s.commit()
        assert (r["debt"], _bal(s, v)) == (0.0, 0.0)


def test_sale_takes_money_charged_bookings():
    from app.models.booking import Booking
    from app.models.user import User
    from app.services import subscription_pool as P
    from app.services.subscription_sale import sell_subscription
    with H.frozen_time():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=100.0, name="Валерия")
        # сегодня 14:00 и завтра 12:00 — уже списаны деньгами (как «абонемент исчерпан»)
        a = H._create(s, admin, u, days=0, start="14:00", method="balance")
        b = H._create(s, admin, u, days=0, start="18:00", method="balance")
        s.commit()
        a = s.get(Booking, a.id); b = s.get(Booking, b.id)
        assert a.payment_status == "paid" and b.payment_status == "paid"
        a.payment_method = "subscription"; a.hours_deducted = 0.0; s.add(a)   # «абонемент исчерпан → с баланса»
        # подарок 0 ₾ — не трогаем
        g = H._create(s, admin, u, days=0, start="20:30", method="balance")
        s.commit()
        g = s.get(Booking, g.id); g.final_price = 0.0; g.charge_amount = 0.0; g.applied_rule = "MANUAL_OVERRIDE"; s.add(g); s.commit()
        bal0 = _bal(s, u)
        r = sell_subscription(s, s.get(User, u.id), "PRO_PLUS", "cash", admin, branch="Unbox Uni")
        s.commit()
        s.expire_all()
        a = s.get(Booking, a.id); b = s.get(Booking, b.id); g = s.get(Booking, g.id)
        assert (a.payment_method, float(a.hours_deducted)) == ("subscription", 1.0), (a.payment_method, a.hours_deducted)
        assert (b.payment_method, float(b.hours_deducted)) == ("subscription", 1.0), (b.payment_method, b.hours_deducted)
        assert g.payment_method == "balance" and float(g.final_price) == 0.0, "подарок перевели на часы"
        assert len(r["converted_bookings"]) == 2, r["converted_bookings"]
        # абонемент оплачен наличными целиком (650 пришло и ушло), деньги за две брони вернулись
        assert _bal(s, u) == round(bal0 + 40, 2), (_bal(s, u), bal0)
        sub = s.get(User, u.id).subscription
        assert P.get_float(sub, "used_hours") == 2.0, P.get_float(sub, "used_hours")



def test_paid_zero_nan_and_legacy_series_booking():
    """paid_now=0 — без кассовой записи, баланс −цена; NaN/больше цены — отказ;
    старая бронь серии (часы в charge_amount, hours_pool main) — не «денежная»."""
    from sqlmodel import select
    from app.models.booking import Booking
    from app.models.cashbox_transaction import CashboxTransaction
    from app.models.user import User
    from app.services.subscription_sale import sell_subscription, SaleError
    with H.frozen_time():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=0.0, name="Завтра")
        for bad in (float("nan"), 700.0, -1.0):
            try:
                sell_subscription(s, s.get(User, u.id), "PRO_PLUS", "cash", admin, branch="Unbox One", paid_now=bad)
                raise AssertionError(f"принят paid_now={bad}")
            except SaleError:
                s.rollback()
        r = sell_subscription(s, s.get(User, u.id), "PRO_PLUS", "cash", admin, branch="Unbox One", paid_now=0)
        s.commit()
        assert not s.exec(select(CashboxTransaction).where(CashboxTransaction.credited_user_id == str(u.id))).all()
        assert (r["debt"], _bal(s, u)) == (650.0, -650.0)
        # старая бронь серии: часы в charge_amount
        v = H._user(s, role="specialist", balance=100.0, name="Серия")
        b = H._create(s, admin, v, days=0, start="14:00", method="balance")
        s.commit()
        b = s.get(Booking, b.id)
        b.payment_method = "subscription"; b.hours_deducted = 0.0; b.charge_amount = 1.0; b.hours_pool = "main"; b.final_price = 0.0
        s.add(b); s.commit()
        bal0 = _bal(s, v)
        r = sell_subscription(s, s.get(User, v.id), "PRO_PLUS", "cash", admin, branch="Unbox Uni")
        s.commit()
        assert r["converted_bookings"] == [] and _bal(s, v) == bal0, (r["converted_bookings"], _bal(s, v), bal0)

if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:300]}")
                traceback.print_exc(limit=4)
    sys.exit(1 if fails else 0)
