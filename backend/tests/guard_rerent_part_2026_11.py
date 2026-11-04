"""СТОРОЖ: пересдача части брони (04.11).

Кейс: бронь 11:00–12:30 за 30 ₾ на пересдаче, Яна заняла только 12:00–13:00. Вернулось
15 ₾ (половина всей брони), бронь отменилась целиком. На длинной брони с маленьким
занятым кусочком центр уходил бы в минус. Правило владельца: возврат — половина цены
ЗАНЯТОГО куска; остальное остаётся за владельцем и на пересдаче.

    python3 backend/tests/guard_rerent_part_2026_11.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402
from sqlmodel import select  # noqa: E402


def _stand():
    s = H._db()
    admin = H._user(s, role="owner", name="Админ", balance=0.0)
    alla = H._user(s, role="specialist", name="Алла", balance=500.0)
    yana = H._user(s, role="specialist", name="Яна", balance=500.0)
    return s, admin, alla, yana


def _list(s, admin, who, start, minutes):
    b = H._create(s, admin, who, days=0, start=start, minutes=minutes)
    s.refresh(b)
    assert b.payment_status == "paid", "стенд: бронь на сегодня должна быть оплачена"
    b.is_re_rent_listed = True
    s.add(b)
    s.commit()
    return b


def _rows(s, who):
    from app.models.booking import Booking
    s.expire_all()
    rows = s.exec(select(Booking).where(Booking.user_uuid == who.id)).all()
    return sorted(rows, key=lambda r: r.start_time)


def _bal(s, who):
    from app.models.user import User
    s.expire_all()
    return float(s.get(User, who.id).balance)


def _shape(rows):
    return [(r.start_time, r.duration, r.status) for r in rows]


def _ledger_ok(s, who):
    from app.models.balance_ledger import BalanceLedger
    s.expire_all()
    total = sum(float(x.delta) for x in s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(who.id))).all())
    return total


def test_tail_taken_refunds_half_of_piece_only():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = _list(s, admin, alla, "14:00", 90)
        paid, before = float(a.charge_amount), _bal(s, alla)
        H._create(s, admin, yana, days=0, start="15:00", minutes=60)
        rows = _rows(s, alla)
        assert _shape(rows) == [("14:00", 60, "confirmed"), ("15:00", 30, "cancelled")], _shape(rows)
        assert rows[0].id == a.id, "остаток должен остаться прежней бронью"
        assert rows[0].is_re_rent_listed, "остаток снялся с пересдачи"
        piece = float(rows[1].final_price)
        assert abs(piece + float(rows[0].final_price) - paid) < 0.01, "сумма частей разошлась с ценой брони"
        assert abs(_bal(s, alla) - before - piece * 0.5) < 0.01, "вернулось не 50 % занятого куска"
        assert _bal(s, alla) - before < paid * 0.5, "вернулась половина всей брони"


def test_head_and_middle_taken():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = _list(s, admin, alla, "14:00", 90)
        before = _bal(s, alla)
        H._create(s, admin, yana, days=0, start="13:00", minutes=90)
        rows = _rows(s, alla)
        assert _shape(rows) == [("14:00", 30, "cancelled"), ("14:30", 60, "confirmed")]
        assert rows[0].id == a.id
        # Занято начало: кусок — прежняя бронь. Возврат не уменьшается второй раз.
        assert abs(_bal(s, alla) - before - float(rows[0].final_price) * 0.5) < 0.01, "вернулось не 50 % занятого куска"
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = _list(s, admin, alla, "14:00", 180)
        paid, before = float(a.charge_amount), _bal(s, alla)
        H._create(s, admin, yana, days=0, start="15:00", minutes=60)
        rows = _rows(s, alla)
        assert _shape(rows) == [("14:00", 60, "confirmed"), ("15:00", 60, "cancelled"), ("16:00", 60, "confirmed")]
        assert rows[0].is_re_rent_listed and rows[2].is_re_rent_listed
        assert abs(_bal(s, alla) - before - float(rows[1].final_price) * 0.5) < 0.01
        assert abs(sum(float(r.final_price) for r in rows) - paid) < 0.01


def test_whole_taken_as_before():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = _list(s, admin, alla, "14:00", 60)
        paid, before = float(a.charge_amount), _bal(s, alla)
        H._create(s, admin, yana, days=0, start="13:30", minutes=120)
        assert _shape(_rows(s, alla)) == [("14:00", 60, "cancelled")]
        assert abs(_bal(s, alla) - before - paid * 0.5) < 0.01


def test_rest_can_be_taken_later_total_is_half():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = _list(s, admin, alla, "14:00", 90)
        paid, before = float(a.charge_amount), _bal(s, alla)
        H._create(s, admin, yana, days=0, start="15:00", minutes=60)
        third = H._user(s, role="specialist", name="Третья", balance=500.0)
        H._create(s, admin, third, days=0, start="14:00", minutes=60)
        assert [r.status for r in _rows(s, alla)] == ["cancelled", "cancelled"]
        assert abs(_bal(s, alla) - before - paid * 0.5) < 0.01, "сумма возвратов за куски ≠ половине брони"


def test_off_grid_falls_back_to_share_of_time():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = _list(s, admin, alla, "14:00", 60)
        a.start_time = "14:15"; s.add(a); s.commit()      # старая бронь не по сетке
        paid, before = float(a.charge_amount), _bal(s, alla)
        H._create(s, admin, yana, days=0, start="15:00", minutes=60)
        assert _shape(_rows(s, alla)) == [("14:15", 60, "cancelled")]
        assert abs(_bal(s, alla) - before - paid * 0.5 * 15 / 60) < 0.01, "вернулось не за долю занятого времени"


def test_subscription_hours_by_piece():
    from app.models.user import User
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        alla.subscription = H._sub(); s.add(alla); s.commit()
        rem0 = float(s.get(User, alla.id).subscription["remaining_hours"])
        a = H._create(s, admin, alla, days=0, start="14:00", minutes=120)
        s.refresh(a)
        assert (a.payment_method or "") == "subscription" and float(a.hours_deducted) == 2.0, "стенд: бронь по абонементу"
        a.is_re_rent_listed = True; s.add(a); s.commit()
        H._create(s, admin, yana, days=0, start="15:00", minutes=60)
        rows = _rows(s, alla)
        assert _shape(rows) == [("14:00", 60, "confirmed"), ("15:00", 60, "cancelled")]
        assert float(rows[0].hours_deducted) == 1.0
        s.expire_all()
        rem = float(s.get(User, alla.id).subscription["remaining_hours"])
        assert abs(rem - (rem0 - 2.0 + 0.5)) < 0.001, f"часов вернулось неверно: было {rem0}, стало {rem}"


def test_balance_matches_ledger():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        _list(s, admin, alla, "14:00", 180)
        H._create(s, admin, yana, days=0, start="15:00", minutes=60)
        assert abs(_ledger_ok(s, alla) - (_bal(s, alla) - 500.0)) < 0.01, "баланс разошёлся с лентой"


def test_cannot_land_on_ordinary_booking_next_to_listed():
    from fastapi import HTTPException
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        other = H._user(s, role="specialist", name="Обычный", balance=500.0)
        _list(s, admin, alla, "14:00", 60)
        H._create(s, admin, other, days=0, start="15:00", minutes=60)
        before = _bal(s, alla)
        try:
            H._create(s, admin, yana, days=0, start="14:30", minutes=60)
            raise AssertionError("новая бронь легла поверх чужой обычной")
        except HTTPException as e:
            assert e.status_code == 400
        s.rollback()
        assert _shape(_rows(s, alla)) == [("14:00", 60, "confirmed")], "пересдача сработала, хотя брони не будет"
        assert _bal(s, alla) == before, "владельцу вернули деньги за несостоявшуюся пересдачу"
        assert _rows(s, yana) == []


def test_side_effects_only_after_commit():
    from fastapi import HTTPException
    from app.api.v1.bookings import routes
    from app.services.telegram import telegram_service
    calls = []
    real = (telegram_service.send_rerent_taken, routes.gcal_service.delete_event, routes.gcal_service.create_event)
    telegram_service.send_rerent_taken = lambda **k: calls.append(("tg", k))
    routes.gcal_service.delete_event = lambda *a, **k: calls.append(("del", a))
    routes.gcal_service.create_event = lambda *a, **k: None
    try:
        with H.frozen_time():
            s, admin, alla, yana = _stand()
            alla.telegram_id = "123"; s.add(alla); s.commit()
            a = _list(s, admin, alla, "14:00", 90)
            a.gcal_event_id = "ev1"; s.add(a); s.commit()
            yana.balance = -1000.0; yana.credit_limit = 0.0; s.add(yana); s.commit()
            calls.clear()
            refused = False
            try:
                H._create(s, yana, yana, days=0, start="15:00", minutes=60)
            except HTTPException:
                refused = True
            s.rollback()
            assert refused, "стенд: бронь без денег должна получить отказ"
            assert calls == [], f"бронь не создана, а владельцу уже ушло: {calls}"
            assert _shape(_rows(s, alla)) == [("14:00", 90, "confirmed")]
            yana.balance = 500.0; s.add(yana); s.commit()
            calls.clear()
            H._create(s, admin, yana, days=0, start="15:00", minutes=60)
            kinds = [c[0] for c in calls]
            assert "tg" in kinds and "del" in kinds, kinds
            tg = [c[1] for c in calls if c[0] == "tg"][0]
            assert tg["start_time"] == "15:00" and tg["duration"] == 30 and tg["remaining"] == "14:00 (60 мин)", tg
    finally:
        telegram_service.send_rerent_taken, routes.gcal_service.delete_event, routes.gcal_service.create_event = real


def test_session_detached_from_cancelled_piece_and_rest_keeps_series():
    from app.models.therapy_session import TherapySession as T
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = _list(s, admin, alla, "14:00", 90)
        a.recurring_group_id = "g1"; a.crm_client_id = "c1"; s.add(a)
        s.add(T(id="ts1", client_id="c1", specialist_id=str(alla.id), date=a.date, booking_id=str(a.id), is_booked=True))
        s.commit()
        H._create(s, admin, yana, days=0, start="13:00", minutes=90)
        rows = _rows(s, alla)
        assert _shape(rows) == [("14:00", 30, "cancelled"), ("14:30", 60, "confirmed")]
        assert rows[1].recurring_group_id == "g1", "остаток выпал из серии"
        assert rows[1].crm_client_id == "c1", "у остатка потерялся клиент"
        ts = s.get(T, "ts1")
        assert ts.booking_id is None and not ts.is_booked, "сессия держится за отменённый кусок"


def test_subscription_peak_goes_to_peak_part_even_if_pool_empty():
    from app.models.user import User
    from app.services import subscription_pool
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        alla.subscription = H._sub(); s.add(alla); s.commit()
        a = H._create(s, admin, alla, days=0, start="19:00", minutes=120)
        s.refresh(a)
        assert a.payment_method == "subscription" and float(a.final_price) == 5.0, "стенд: 19–21 по абонементу, пик 5 ₾"
        a.is_re_rent_listed = True; s.add(a)
        alla = s.get(User, alla.id)
        alla.subscription = subscription_pool.update(alla.subscription, remaining_hours=0.0); s.add(alla); s.commit()
        rule, before = a.applied_rule, _bal(s, alla)
        H._create(s, admin, yana, days=0, start="20:00", minutes=60)
        rows = _rows(s, alla)
        assert _shape(rows) == [("19:00", 60, "confirmed"), ("20:00", 60, "cancelled")]
        assert float(rows[0].final_price) == 0.0 and float(rows[1].final_price) == 5.0, [r.final_price for r in rows]
        assert rows[0].applied_rule == rule, "ярлык части разошёлся со способом оплаты"
        assert abs(_bal(s, alla) - before - 2.5) < 0.01, "пик за занятый час вернулся неверно"


def test_preview_does_not_promise_slot_over_ordinary_booking():
    src = open(os.path.join(os.path.dirname(__file__), "..", "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.index('"re_rent_available": True')
    assert "ignore_re_rent=True" in src[i - 500:i], "предпросмотр снова обещает слот поверх обычной брони"


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
                traceback.print_exc(limit=3)
    sys.exit(1 if fails else 0)
