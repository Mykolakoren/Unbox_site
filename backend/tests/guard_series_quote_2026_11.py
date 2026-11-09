"""СТОРОЖ: примерка серии честно считает часы абонемента (09.11).

Было: «8 встреч — 8 ч с абонемента», хотя свободно 3 ч, а абонемент кончается
раньше части дат. Примерка брала живой остаток пула на каждую дату и срок на
сегодня. Теперь остаток «тратится» по датам (минус уже обещанные несписанные
брони), срок сверяется с датой встречи, непокрытые даты — деньгами и в
subscription_short_dates. Создание серии и крон T-24ч не менялись.

    python3 backend/tests/guard_series_quote_2026_11.py
"""
import os
import re

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def _src():
    return open(os.path.join(_ROOT, "backend/app/api/v1/bookings/routes.py"), encoding="utf-8").read()


def _func(src, name):
    m = re.search(rf"^def {name}\(.*?(?=^def |^@router|\Z)", src, re.S | re.M)
    assert m, f"нет функции {name}"
    return m.group(0)


def test_quote_tracks_pool_and_expiry_per_date():
    src = _src()
    helper = _func(src, "_series_quote_pool_left")
    assert 'Booking.payment_status == "pending"' in helper, "не вычитаются обещанные несписанные брони"
    assert "booking_extra" in helper, "доп. пул обещанных броней не учитывается"
    q = _func(src, "quote_recurring_booking")
    assert "_series_quote_pool_left(session, booking_owner)" in q
    assert "subscription_pool.is_expired(_sub, start_dt - timedelta(hours=4))" in q, \
        "срок абонемента не сверяется с датой встречи"
    assert "_sub_main_left = max(0.0, _sub_main_left - _m)" in q, "остаток не тратится по датам"
    assert "subscription_hours_cover=False" in q, "непокрытая дата не пересчитана деньгами"
    assert q.count("warnings.append(") >= 2, "непокрытые даты не попадают в subscription_short_dates"


if __name__ == "__main__":
    test_quote_tracks_pool_and_expiry_per_date()
    print("СТОРОЖ series_quote: OK")
