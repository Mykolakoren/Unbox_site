"""СТОРОЖ: обход мобильной версии 10.10 (владелец: «тщательно протестируй всё
в мобильной версии»). Что нашли и починили:

  * «Забронировать кабинет» из сессии CRM на телефоне: дата уходила объектом
    Date (отметка UTC с поясом) → сервер падал 500 на «start_dt − сейчас»; а
    привязка слала только bookingId — телефон смотрит на is_booked и снова
    показывал «Без кабинета» и «Забронировать кабинет» (вторая бронь);
  * «Перенести» бронь — с одного касания, без «было → станет»;
  * «Повторить» будущую бронь открывал оформление на тот же день;
  * карточка брони: «Клиент привязан» без имени, допуслуги не видны,
    срочная — «Спишем за сутки» вместо «после подтверждения»;
  * уведомления: имя значка текстом («CheckCircle Бронь подтверждена»);
  * «Права доступа»: подпись sr-only растягивала экран до 545 px;
  * клиенту без Psy-CRM — лишний /crm/clients (403); не админу — запросы
    «Заявок» (403) и navigate() во время отрисовки;
  * «Заявки»: число на вкладке не сбрасывалось после одобрения;
  * щель под кнопкой оформления; длительность 50 мин показывалась «30 мин»;
  * «+ Сессия» на другом дне предлагала «+1 нед» вместо открытого дня;
  * карточка клиента на телефоне: нет правки и паузы.

    python3 backend/tests/guard_mobile_sweep_2026_10.py
"""
import os
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent


def _src(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


# ── сервер: дата брони с поясом ─────────────────────────────────────────

def test_create_booking_accepts_aware_date():
    """«2026-10-06T20:00:00Z» = полночь 07.10 по Тбилиси: бронь на 07.10, без 500."""
    import guard_hours_pool_moves as H
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import Booking, BookingCreate
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Спец")
        bi = BookingCreate(resource_id="room_1", location_id="unbox_uni",
                           date=datetime(2026, 10, 6, 20, 0, tzinfo=timezone.utc), start_time="12:00",
                           duration=60, format="individual", payment_method="balance")
        out = H._call(routes.create_booking, session=s, booking_in=bi, current_user=u,
                      background_tasks=BackgroundTasks())
        assert not isinstance(out, dict), out
        s.commit()
        b = s.get(Booking, out.id)
        assert b.date.tzinfo is None and b.date.strftime("%Y-%m-%d") == "2026-10-07", b.date


def test_create_booking_tz_normalization_in_code():
    r = _src("backend/app/api/v1/bookings/routes.py")
    i = r.index("def create_booking(")
    body = r[i:r.index("\n@router.", i)]
    assert "booking_in.date.tzinfo is not None" in body
    assert "astimezone(_tz_utc.utc) + _td_tb(hours=4)" in body


# ── «часы подряд» после переноса (чат админов 11.10, Дарья Ермашкевич) ──

def _mk(s, u, *, day, start, minutes, room):
    from fastapi import BackgroundTasks
    import guard_hours_pool_moves as H
    from app.api.v1.bookings import routes
    from app.models.booking import Booking, BookingCreate
    bi = BookingCreate(resource_id=room, location_id="unbox_uni", date=H._day(day), start_time=start,
                       duration=minutes, format="individual", payment_method="balance")
    out = H._call(routes.create_booking, session=s, booking_in=bi, current_user=u,
                  background_tasks=BackgroundTasks())
    assert not isinstance(out, dict), out
    s.commit()
    return s.get(Booking, out.id)


def _move(s, b, u, *, room, start):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    out = routes.reschedule_booking(
        booking_id=str(b.id),
        data=routes.RescheduleRequest(new_date=b.date.strftime("%Y-%m-%d"), new_start_time=start,
                                      new_resource_id=room),
        background_tasks=BackgroundTasks(), session=s, current_user=u)
    s.expire_all()
    return out


def test_reschedule_into_chain_discounts_neighbour():
    """12:00 переносят из 1-го кабинета во 2-й встык к своей 13:00–14:30:
    скидку «часы подряд» получают ОБЕ брони (раньше — только перенесённая)."""
    import guard_hours_pool_moves as H
    from app.models.booking import Booking
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Дарья")
        a = _mk(s, u, day=3, start="12:00", minutes=60, room="room_1")
        b = _mk(s, u, day=3, start="13:00", minutes=90, room="room_2")
        assert (a.final_price, b.final_price) == (20.0, 30.0), (a.final_price, b.final_price)
        _move(s, a, u, room="room_2", start="12:00")
        a, b = s.get(Booking, a.id), s.get(Booking, b.id)
        assert a.applied_rule == "CONSECUTIVE_HOURS" and b.applied_rule == "CONSECUTIVE_HOURS", (a.applied_rule, b.applied_rule)
        assert a.discount_percent == b.discount_percent > 0, (a.discount_percent, b.discount_percent)
        assert b.final_price < 30.0, b.final_price


def test_reschedule_out_of_chain_drops_neighbour_discount():
    """Обратный случай: из цепочки 12:00+13:00 во 2-м кабинете 12:00 уносят в 1-й —
    оставшаяся 13:00 теряет скидку за цепочку, которой больше нет."""
    import guard_hours_pool_moves as H
    from app.models.booking import Booking
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Дарья")
        a = _mk(s, u, day=3, start="12:00", minutes=60, room="room_2")
        b = _mk(s, u, day=3, start="13:00", minutes=90, room="room_2")
        b = s.get(Booking, b.id)
        assert b.applied_rule == "CONSECUTIVE_HOURS", b.applied_rule
        _move(s, s.get(Booking, a.id), u, room="room_1", start="12:00")
        b = s.get(Booking, b.id)
        assert b.applied_rule != "CONSECUTIVE_HOURS" and b.final_price == 30.0, (b.applied_rule, b.final_price)


def test_reschedule_into_chain_paid_settles_once():
    """Оплаченные брони (сегодня, бронь админа — списание сразу): разница по
    перенесённой — одной проводкой reschedule_diff, по соседу — одной
    consecutive_recompute; баланс = старт + лента, charge_amount = цена."""
    import guard_hours_pool_moves as H
    from fastapi import BackgroundTasks
    from sqlmodel import select
    from app.api.v1.bookings import routes
    from app.models.balance_ledger import BalanceLedger
    from app.models.booking import Booking, BookingCreate
    with H.frozen_time():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=500.0, name="Дарья")

        def mk(start, minutes, room):
            bi = BookingCreate(resource_id=room, location_id="unbox_uni", date=H._day(0), start_time=start,
                               duration=minutes, format="individual", payment_method="balance",
                               target_user_id=str(u.id))
            out = H._call(routes.create_booking, session=s, booking_in=bi, current_user=admin,
                          background_tasks=BackgroundTasks())
            assert not isinstance(out, dict), out
            s.commit()
            return s.get(Booking, out.id)

        a = mk("14:00", 60, "room_1")
        b = mk("15:00", 90, "room_2")
        assert a.payment_status == "paid" and b.payment_status == "paid", (a.payment_status, b.payment_status)
        start_bal = 500.0
        routes.reschedule_booking(
            booking_id=str(a.id),
            data=routes.RescheduleRequest(new_date=a.date.strftime("%Y-%m-%d"), new_start_time="14:00",
                                          new_resource_id="room_2"),
            background_tasks=BackgroundTasks(), session=s, current_user=admin)
        s.expire_all()
        a, b = s.get(Booking, a.id), s.get(Booking, b.id)
        assert a.applied_rule == b.applied_rule == "CONSECUTIVE_HOURS", (a.applied_rule, b.applied_rule)
        for x in (a, b):
            assert abs(float(x.charge_amount) - float(x.final_price)) < 0.005, (x.charge_amount, x.final_price)
        led = s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(u.id))).all()
        bal = float(s.get(type(u), u.id).balance)
        assert abs(start_bal + sum(float(r.delta) for r in led) - bal) < 0.005, (bal, [(r.reason, r.delta) for r in led])
        assert abs(bal - (start_bal - float(a.final_price) - float(b.final_price))) < 0.005, bal
        recomp = [r for r in led if r.reason == "consecutive_recompute"]
        assert len(recomp) == 1 and recomp[0].ref_id == str(b.id), [(r.reason, r.ref_id) for r in led]
        assert len([r for r in led if r.reason == "reschedule_diff" and r.ref_id == str(a.id)]) == 1


def test_personal_discount_beats_smaller_plan_discount():
    """Владелец 11.10 (Светлана Розова): личная скидка 25 % больше скидки тарифа
    15 % — денежная бронь по личной (2 ч: 40 → 30 ₾, не 34). Личная меньше
    тарифной — как было, скидка тарифа. Часы абонемента — по-прежнему часами."""
    import guard_hours_pool_moves as H
    from app.services.pricing import PricingService
    with H.frozen_time():
        s = H._db()
        sub = H._sub("REGULAR_PRACTITIONER")

        def quote(pdp, cover):
            u = H._user(s, role="specialist", sub=sub, balance=0.0, name=f"П{pdp}")
            u.pricing_system, u.personal_discount_percent = "personal", pdp
            s.add(u); s.commit(); s.refresh(u)
            return PricingService(s).calculate_price(
                user=u, resource_id="room_1", start_time=H._day(2).replace(hour=14), duration_minutes=120,
                format_type="individual", subscription_hours_cover=cover)
        q = quote(25, False)
        assert (q.applied_rule, round(q.final_price, 2)) == ("PERSONAL_DISCOUNT", 30.0), (q.applied_rule, q.final_price)
        q = quote(5, False)
        assert q.applied_rule == "SUBSCRIPTION_DISCOUNT", q.applied_rule
        q = quote(25, True)
        assert q.applied_rule == "SUBSCRIPTION" and q.final_price == 0.0, (q.applied_rule, q.final_price)


def test_extend_into_neighbour_discounts_both():
    """12.10, тот же класс, что у Дарьи: 12:00–13:00 продлили до 13:30 встык к
    своей 13:30–15:00 — скидку «часы подряд» получают обе брони."""
    import guard_hours_pool_moves as H
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Клиент")
        a = _mk(s, u, day=3, start="12:00", minutes=60, room="room_1")
        b = _mk(s, u, day=3, start="13:30", minutes=90, room="room_1")
        assert b.applied_rule != "CONSECUTIVE_HOURS"
        routes.extend_booking(booking_id=str(a.id), payload=routes.ExtendRequest(extra_minutes=30),
                              session=s, current_user=u)
        s.expire_all()
        a, b = s.get(Booking, a.id), s.get(Booking, b.id)
        assert a.duration == 90 and a.applied_rule == b.applied_rule == "CONSECUTIVE_HOURS", (a.duration, a.applied_rule, b.applied_rule)
        assert a.discount_percent == b.discount_percent > 0


def test_shorten_breaks_chain_drops_neighbour_discount():
    """Сократили 12:00–13:00 с конца до… нельзя меньше часа — берём 12:00–14:00
    (2 ч) + 14:00–15:30: сократили первую на час с конца → разрыв, у 14:00 скидки нет."""
    import guard_hours_pool_moves as H
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Клиент")
        a = _mk(s, u, day=3, start="12:00", minutes=120, room="room_1")
        b = _mk(s, u, day=3, start="14:00", minutes=90, room="room_1")
        b = s.get(Booking, b.id)
        assert b.applied_rule == "CONSECUTIVE_HOURS", b.applied_rule
        routes.shorten_booking(booking_id=str(a.id), payload=routes.ShortenRequest(remove_minutes=60, side="end"),
                               session=s, current_user=u)
        s.expire_all()
        b = s.get(Booking, b.id)
        assert b.applied_rule != "CONSECUTIVE_HOURS" and b.final_price == 30.0, (b.applied_rule, b.final_price)


def test_crm_session_move_reprices_linked_booking():
    """12.10: перенос сессии в CRM двигает её бронь — и цену тоже: 12:00 → 20:00
    (пик 20–22, +5 ₾/ч) — 20 → 25 ₾. Раньше бронь ехала по старой цене."""
    import guard_hours_pool_moves as H
    from datetime import datetime, timedelta
    from app.api.v1.crm import sessions as crm_sessions
    from app.models.booking import Booking
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession, TherapySessionUpdate
    with H.frozen_time():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Спец")
        b = _mk(s, u, day=3, start="12:00", minutes=60, room="room_1")
        assert b.final_price == 20.0, b.final_price
        c = TherapistClient(specialist_id=str(u.id), name="Клиент", alias_code="1234", base_price=100)
        s.add(c); s.commit(); s.refresh(c)
        ts = TherapySession(client_id=c.id, specialist_id=str(u.id), date=b.date.replace(hour=8),  # 12:00 Тбилиси
                            duration_minutes=60, booking_id=str(b.id), is_booked=True)
        s.add(ts); s.commit(); s.refresh(ts)
        new_local = b.date.replace(hour=20, minute=0)
        crm_sessions.update_session(session_id=ts.id, data=TherapySessionUpdate(date=new_local),
                                    session=s, current_user=u)
        s.expire_all()
        b = s.get(Booking, b.id)
        assert (b.start_time, round(b.final_price, 2)) == ("20:00", 25.0), (b.start_time, b.final_price)


def test_reschedule_keeps_plan_discount():
    """Ревизия денег 12.10: у клиента с абонементом без часов денежная бронь со
    скидкой тарифа (15 %, 17 ₾) после переноса остаётся 17 ₾ (было: 20 ₾)."""
    import guard_hours_pool_moves as H
    from app.models.booking import Booking
    from app.services import subscription_pool as P
    with H.frozen_time():
        s = H._db()
        sub = P.update(H._sub("REGULAR_PRACTITIONER"), remaining_hours=0.0, used_hours=20.0)
        u = H._user(s, role="specialist", sub=sub, balance=300.0, name="Абонемент")
        a = _mk(s, u, day=3, start="14:00", minutes=60, room="room_1")
        assert (a.applied_rule, a.final_price) == ("SUBSCRIPTION_DISCOUNT", 17.0), (a.applied_rule, a.final_price)
        _move(s, a, u, room="room_1", start="16:00")
        a = s.get(Booking, a.id)
        assert (a.start_time, a.final_price) == ("16:00", 17.0), (a.start_time, a.final_price, a.applied_rule)


def _crm_pair(s, owner_user, specialist, *, day, start):
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession
    b = _mk(s, owner_user, day=day, start=start, minutes=60, room="room_1")
    c = TherapistClient(specialist_id=str(specialist.id), name="Клиент", alias_code="1234", base_price=100)
    s.add(c); s.commit(); s.refresh(c)
    h = int(start[:2])
    ts = TherapySession(client_id=c.id, specialist_id=str(specialist.id), date=b.date.replace(hour=h - 4),
                        duration_minutes=60, booking_id=str(b.id), is_booked=True)
    s.add(ts); s.commit(); s.refresh(ts)
    return b, ts


def test_crm_session_cannot_move_foreign_booking():
    """Ревизия денег 12.10: сессия с чужой бронью (booking_id вписан руками) —
    перенос сессии 403, чужая бронь не двигается; booking_id чужой брони — 404."""
    import guard_hours_pool_moves as H
    from fastapi import HTTPException
    from app.api.v1.crm import sessions as crm_sessions
    from app.models.booking import Booking
    from app.models.therapy_session import TherapySessionUpdate
    with H.frozen_time():
        s = H._db()
        victim = H._user(s, role="specialist", balance=500.0, name="Чужой")
        me = H._user(s, role="specialist", balance=500.0, name="Я")
        b, ts = _crm_pair(s, victim, me, day=3, start="12:00")
        try:
            crm_sessions.update_session(session_id=ts.id, data=TherapySessionUpdate(date=b.date.replace(hour=20)),
                                        session=s, current_user=me)
            raise AssertionError("чужая бронь сдвинулась")
        except HTTPException as e:
            s.rollback()
            assert e.status_code == 403, e.status_code
        assert s.get(Booking, b.id).start_time == "12:00"
        try:
            crm_sessions.update_session(session_id=ts.id, data=TherapySessionUpdate(booking_id=str(b.id)),
                                        session=s, current_user=me)
            raise AssertionError("привязали чужую бронь")
        except HTTPException as e:
            s.rollback()
            assert e.status_code == 404, e.status_code


def test_crm_session_move_past_booking_not_repriced():
    """Ревизия денег 12.10: прошедшую бронь перенос сессии двигает, но цену
    задним числом не меняет (20 ₾ остаётся и в «пик» 20:00)."""
    import guard_hours_pool_moves as H
    from app.api.v1.crm import sessions as crm_sessions
    from app.models.booking import Booking
    from app.models.therapy_session import TherapySessionUpdate
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import BookingCreate
    with H.frozen_time():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        me = H._user(s, role="specialist", balance=500.0, name="Я")
        # бронь сегодня 09:00 по Тбилиси (сейчас 10:00) — уже идёт/прошла
        bi = BookingCreate(resource_id="room_1", location_id="unbox_uni", date=H._day(0), start_time="09:00",
                           duration=60, format="individual", payment_method="balance", target_user_id=str(me.id))
        out = H._call(routes.create_booking, session=s, booking_in=bi, current_user=admin,
                      background_tasks=BackgroundTasks())
        assert not isinstance(out, dict), out
        s.commit()
        b = s.get(Booking, out.id)
        price0 = float(b.final_price)
        from app.models.therapist_client import TherapistClient
        from app.models.therapy_session import TherapySession
        c = TherapistClient(specialist_id=str(me.id), name="К", alias_code="4321", base_price=100)
        s.add(c); s.commit(); s.refresh(c)
        ts = TherapySession(client_id=c.id, specialist_id=str(me.id), date=b.date.replace(hour=5),
                            duration_minutes=60, booking_id=str(b.id), is_booked=True)
        s.add(ts); s.commit(); s.refresh(ts)
        crm_sessions.update_session(session_id=ts.id, data=TherapySessionUpdate(date=b.date.replace(hour=8)),
                                    session=s, current_user=me)
        s.expire_all()
        b = s.get(Booking, b.id)
        assert b.start_time == "08:00" and float(b.final_price) == price0, (b.start_time, b.final_price, price0)


def test_crm_session_move_finished_booking_to_future_not_repriced():
    """Ветка «бронь уже прошла, сессию двигают в будущий пик»: бронь едет за
    сессией, цена прежняя (правка задним числом не переоценивает)."""
    import guard_hours_pool_moves as H
    from datetime import datetime as _dt, timedelta
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.api.v1.crm import sessions as crm_sessions
    from app.models.booking import Booking, BookingCreate
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession, TherapySessionUpdate
    with H.frozen_time():  # пн 05.10, 10:00 по Тбилиси
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        me = H._user(s, role="specialist", balance=500.0, name="Я")
        # бронь от админа (у специалиста за 2 ч до начала она ушла бы на одобрение)
        bi = BookingCreate(resource_id="room_1", location_id="unbox_uni", date=H._day(0), start_time="12:00",
                           duration=60, format="individual", payment_method="balance", target_user_id=str(me.id))
        out = H._call(routes.create_booking, session=s, booking_in=bi, current_user=admin,
                      background_tasks=BackgroundTasks())
        assert not isinstance(out, dict), out
        s.commit()
        bid = out.id
        price0 = float(s.get(Booking, bid).final_price)
        c = TherapistClient(specialist_id=str(me.id), name="К", alias_code="4321", base_price=100)
        s.add(c); s.commit(); s.refresh(c)
        ts = TherapySession(client_id=c.id, specialist_id=str(me.id), date=_dt(2026, 10, 5, 8, 0),
                            duration_minutes=60, booking_id=str(bid), is_booked=True)
        s.add(ts); s.commit(); s.refresh(ts)
        tsid = ts.id
    with H.frozen_time(at=_dt(2026, 10, 5, 12, 0)):  # 16:00 по Тбилиси — бронь 12:00–13:00 прошла
        assert routes._is_past(s.get(Booking, bid))
        crm_sessions.update_session(session_id=tsid, data=TherapySessionUpdate(date=_dt(2026, 10, 7, 20, 0)),
                                    session=s, current_user=me)
        s.expire_all()
        b = s.get(Booking, bid)
        assert (b.date.day, b.start_time, float(b.final_price)) == (7, "20:00", price0), (b.date, b.start_time, b.final_price, price0)


def test_series_reschedule_recomputes_chains_in_code():
    r = _src("backend/app/api/v1/bookings/routes.py")
    one = r[r.index("def reschedule_booking("):r.index("def _move_funds_check(")]
    assert "_recompute_chains_after_move(\n            session, booking_owner, [(new_resource, new_date), (old_resource, old_date)], current_user,\n        )" in one
    ser = r[r.index("def reschedule_booking_series("):]
    assert '_recompute_chains_after_move(session, _owner_obj, _places, current_user, reason="reschedule_series")' in ser
    for fn, nxt, tail in (("def extend_booking(", "def add_booking_extras(", 'reason="extend_booking")'),
                          ("def shorten_booking(", "def split_booking(", 'skip_ids={str(booking.id)}, reason="shorten_booking")')):
        body = r[r.index(fn):r.index(nxt)]
        assert "_recompute_chains_after_move(session, _chain_owner, [(booking.resource_id, booking.date)], current_user," in body, fn
        assert tail in body, fn
    # ревизия денег 12.10: skip_ids — ТОЛЬКО у «Сократить»; перенос/продление/CRM
    # пересчитываются целиком (иначе терялась скидка тарифа абонемента)
    assert r.count("skip_ids={str(booking.id)}") == 1
    h = r[r.index("def _recompute_chains_after_move("):r.index("def _move_funds_check(")]
    assert ".with_for_update()" in h and "populate_existing=True" in h, "нет замка на строке клиента"
    rp = r[r.index("def _reprice_for_move("):r.index("def _recompute_chains_after_move(")]
    assert "ignore_subscription=True" not in rp, "перенос снова снимает скидку тарифа"


# ── чат админов 12.10: касса и бронь задним числом ─────────────────────

def test_open_shift_prefill_is_per_branch():
    """«Открыть смену» для филиала подставляла наличные ВСЕХ филиалов (Uni:
    1018,40 вместо 193,35) — теперь preview закрытия по выбранному филиалу."""
    m = _src("src/components/admin/cashbox/OpenShiftModal.tsx")
    assert "cashboxApi.previewCloseShift(selectedBranch)" in m
    assert "setStartingBalance(Number(p.expected ?? 0).toFixed(2))" in m
    assert "setTouched(true); setStartingBalance(e.target.value)" in m, "подсказка затирает вписанную сумму"


def test_chessboard_select_allows_12h_back():
    """Клетка 30 мин назад не серая, а выделить нельзя было: isSlotOccupied
    считал любое прошедшее время занятым. Окно — 12 ч, как у клеток и сервера."""
    c = _src("src/components/admin/AdminChessboardView.tsx")
    i = c.index("const isSlotOccupied = useCallback(")
    body = c[i:c.index("}, [selectedDate, slotMap]);", i)]
    assert "if (hoursAgo > 12) return true;" in body
    assert "timeToMin(time) < now.totalMins" not in body
    r = _src("backend/app/api/v1/bookings/routes.py")
    assert "if diff_h < -12.0:" in r


def test_mobile_find_admin_backdate():
    """Админ с телефона: «Показать прошедшее время (до 12 ч назад)» на сегодня —
    окна с now−12 ч (сервер то же пускает). Не админу и в переносе/привязке — нет."""
    f = _src("src/pages/mobile/MobileFind.tsx")
    assert "const BACKDATE_MIN = 12 * 60;" in f
    assert "const canBackdate = isBookingAdmin(currentUser) && !rescheduleId && !linkSessionId;" in f
    assert "Math.max(0, tbilisiNow().totalMins - backMin)" in f
    assert "canBackdate && showPast ? BACKDATE_MIN : 0" in f


# ── телефон: бронь кабинета из сессии CRM ───────────────────────────────

def test_link_session_booking():
    f = _src("src/pages/mobile/MobileFind.tsx")
    i = f.index("if (linkSessionMeta) {")
    body = f[i:f.index("// Reschedule path", i)]
    assert "date: fmtDate(targetDate, 'yyyy-MM-dd')" in body, "дата снова уходит объектом Date"
    assert "crmApi.acceptMergeSuggestion(linkSessionMeta.id, created.id)" in body
    assert "updateSession(linkSessionMeta.id, { bookingId" not in body, "привязка без is_booked"
    assert "const [linkSessionDate] = useState(() => searchParams.get('date') || '')" in f


def test_reschedule_asks_before_moving():
    f = _src("src/pages/mobile/MobileFind.tsx")
    i = f.index("if (rescheduleBooking) {")
    body = f[i:f.index("await bookingsApi.rescheduleBooking(", i)]
    assert "await askConfirm({" in body and "title: 'Перенести бронь?'" in body
    assert "if (!ok) { inFlightRef.current = false; return; }" in body


def test_repeat_goes_after_source_day():
    r = _src("src/pages/mobile/repeatBooking.ts")
    assert "export function repeatTargetDate(" in r and "afterSource > pick" in r
    s = _src("src/pages/mobile/BookingDetailSheet.tsx")
    assert "repeatDayLabel(repeatTargetDate(booking))" in s
    assert "nextWeekdayPhrase" not in s


# ── карточка брони на телефоне ──────────────────────────────────────────

def test_booking_sheet_details():
    s = _src("src/pages/mobile/BookingDetailSheet.tsx")
    assert "showCrm && (mode === 'pickClient' || booking.crmClientId) && crmClients.length === 0" in s
    assert "в т.ч. допуслуги: {extrasNames}" in s
    assert "'Спишем, когда администратор подтвердит бронь'" in s


def test_checkout_cta_has_skirt():
    c = _src("src/pages/mobile/MobileCheckout.tsx")
    i = c.index("{/* Закреплённая кнопка над нижним меню.")
    assert "boxShadow: `0 24px 0 0 ${COLOR.card}`" in c[i:i + 1200]


def test_proxy_booking_done_screen():
    c = _src("src/pages/mobile/MobileCheckout.tsx")
    assert c.count("setDoneFor(proxyName);") == 2 and "Бронь создана: ${forName}" in c
    assert "doneFor ? '/m/admin/bookings' : '/m/bookings'" in c


# ── уведомления, права, лишние запросы ──────────────────────────────────

def test_notification_icons_are_icons():
    m = _src("src/pages/mobile/NotificationsBell.tsx")
    assert "${n.icon} " not in m, "имя значка снова печатается текстом"
    assert "notificationIcon(n.icon)" in m
    d = _src("src/components/admin/NotificationBell.tsx")
    assert "notificationIcon(n.icon)" in d
    u = _src("src/utils/notificationIcon.ts")
    for k in ("checkcircle", "xcircle", "clock", "alerttriangle", "calendarx"):
        assert f"{k}:" in u, k


def test_access_rights_table_contained():
    a = _src("src/pages/admin/AccessRights.tsx")
    assert "overflowX: 'auto', position: 'relative' }}>" in a


def test_no_crm_clients_for_non_crm():
    c = _src("src/pages/mobile/MobileCheckout.tsx")
    assert "if (canUsePsyCrm(currentUser)) fetchCrmClients(true, false)" in c
    w = _src("src/components/Wizard/ConfirmationStep.tsx")
    assert "if (canUsePsyCrm(currentUser)) {\n            fetchCrmClients(true, false, targetSpecialistUuid)" in w


def test_layout_gates_without_render_navigate():
    a = _src("src/pages/mobile/admin/MobileAdminLayout.tsx")
    assert "if (!isAdmin) return <Navigate to=\"/m\" replace />;" in a
    assert "if (!currentUser || !isAdmin) return;\n        if (Date.now() - requestsAt.current" in a
    assert "navigate('/m', { replace: true });\n        return null;" not in a
    c = _src("src/pages/mobile/crm/MobileCrmLayout.tsx")
    assert "return <Navigate to={isBookingAdmin(currentUser) ? '/m/admin' : '/m'} replace />;" in c


def test_requests_badge_refresh():
    lay = _src("src/pages/mobile/admin/MobileAdminLayout.tsx")
    assert "window.addEventListener(ADMIN_REQUESTS_CHANGED, onChanged)" in lay
    inbox = _src("src/pages/mobile/admin/MobileAdminInbox.tsx")
    assert inbox.count("window.dispatchEvent(new Event(ADMIN_REQUESTS_CHANGED))") == 2
    spec = _src("src/pages/mobile/admin/MobileAdminSpecialists.tsx")
    assert "window.dispatchEvent(new Event(ADMIN_REQUESTS_CHANGED))" in spec


def test_tour_not_mid_task():
    m = _src("src/pages/mobile/MobileLayout.tsx")
    assert "sp.has('linkSession') || sp.has('reschedule') || location.pathname.startsWith('/m/checkout')" in m
    assert "if (!midTask && !hasCompletedTour(currentUser.id))" in m


# ── Psy-CRM на телефоне ─────────────────────────────────────────────────

def test_session_duration_options_keep_value():
    s = _src("src/pages/mobile/crm/SessionActionSheet.tsx")
    assert "new Set([30, 45, 50, 60, 75, 90, 120, dur])" in s


def test_new_session_presets_viewed_day():
    n = _src("src/components/crm/NewSessionSheet.tsx")
    assert "presetDate?: string;" in n and "setDate(preset ?? suggestion.w1.date)" in n
    f = _src("src/pages/mobile/crm/crmFlows.tsx")
    assert "presetDate={state?.presetDate}" in f
    t = _src("src/pages/mobile/crm/MobileCrmToday.tsx")
    assert t.count("bookNext.open(undefined, undefined, isToday ? undefined : dateStr)") == 2


def test_client_card_edit_and_pause():
    c = _src("src/pages/mobile/crm/MobileCrmClient.tsx")
    assert 'aria-label="Изменить клиента"' in c and "<ClientEditSheet" in c
    assert "Вернуть в работу" in c and "Поставить на паузу" in c
    assert "await crmApi.deleteClient(client.id); // без permanent — только пауза" in c
    e = _src("src/pages/mobile/crm/ClientEditSheet.tsx")
    # ставка/валюта/счёт — только если поменяли (заморозка прошлых сессий на сервере)
    assert "if (String(price) !== String(client.basePrice || 0)) patch.basePrice = price;" in e
    assert "aliasCode" not in e, "код клиента с телефона не меняем"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except AssertionError as e:
                fails += 1; print(f"  ✗ {n}: {e}")
    sys.exit(1 if fails else 0)
