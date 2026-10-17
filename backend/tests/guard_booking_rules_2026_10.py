"""СТОРОЖ: правила брони — одни на все пути (владелец 12.10: «чинить причины»).

Аудит путей 12.10: правило «срочная бронь — на подтверждение» жило только в
create_booking; корзина, серия, продление серии, перенос и перенос сессии в
CRM его обходили. Перенос не проверял новое время (в прошлое, в срочное окно),
CRM двигал прошедшую бронь на будущее (одна оплата — два занятия), бронь «на
подтверждении» не держала время, оплаченная бронь, уехавшая дальше суток,
оставалась оплаченной заранее (кейс Марии Кирдун).

«Сейчас» = пн 05.10.2026 10:00 по Тбилиси (guard_hours_pool_moves.frozen_time).

    python3 backend/tests/guard_booking_rules_2026_10.py
"""
import os
import sys
from datetime import datetime as _dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _src(rel):
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


class _NoTg:
    """Telegram в сторожах не шлём."""

    def __enter__(self):
        from app.services.telegram import telegram_service
        self.svc = telegram_service
        self.saved = {}
        for name in ("send_admin_event", "send_booking_pending_approval", "send_admin_alert"):
            self.saved[name] = getattr(telegram_service, name, None)
            setattr(telegram_service, name, lambda *a, **k: None)
        return self

    def __exit__(self, *exc):
        for name, fn in self.saved.items():
            if fn is not None:
                setattr(self.svc, name, fn)


def _create(s, actor, owner, *, day, start, minutes=60, room="room_1", method="balance"):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import Booking, BookingCreate
    bi = BookingCreate(resource_id=room, location_id="unbox_uni", date=H._day(day), start_time=start,
                       duration=minutes, format="individual", payment_method=method,
                       target_user_id=(str(owner.id) if actor.id != owner.id else None))
    out = H._call(routes.create_booking, session=s, booking_in=bi, current_user=actor,
                  background_tasks=BackgroundTasks())
    if isinstance(out, dict):
        s.rollback()
        return out
    s.commit()
    return s.get(Booking, out.id)


def _move(s, b, actor, *, day, start, room=None):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    out = H._call(routes.reschedule_booking, booking_id=str(b.id),
                  data=routes.RescheduleRequest(new_date=H._day(day).strftime("%Y-%m-%d"), new_start_time=start,
                                                new_resource_id=room),
                  background_tasks=BackgroundTasks(), session=s, current_user=actor)
    if isinstance(out, dict):
        s.rollback()
    else:
        s.commit()
    s.expire_all()
    return out


def _ledger(s, u):
    from sqlmodel import select
    from app.models.balance_ledger import BalanceLedger
    return s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(u.id))).all()


def _bal(s, u):
    from app.models.user import User
    s.expire_all()
    return round(float(s.get(User, u.id).balance or 0), 2)


# ── 2. «Срочная бронь — на подтверждение» в корзине и серии ──────────────

def test_cart_hot_slot_goes_to_approval():
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    with H.frozen_time(), _NoTg():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Спец")
        req = routes.MultiSlotRequest(slots=[
            routes.MultiSlotItem(resource_id="room_1", location_id="unbox_uni",
                                 date=H._day(0).strftime("%Y-%m-%d"), start_time="15:00"),   # через 5 ч
            routes.MultiSlotItem(resource_id="room_2", location_id="unbox_uni",
                                 date=H._day(3).strftime("%Y-%m-%d"), start_time="12:00"),   # через 3 дня
        ])
        out = routes.create_multi_slot_booking(session=s, data=req, current_user=u)
        s.expire_all()
        rows = sorted((s.get(Booking, b.id) for b in out["bookings"]), key=lambda b: b.date)
        hot, far = rows
        assert (hot.status, hot.payment_status, hot.charge_amount) == ("pending_approval", "pending", None), \
            (hot.status, hot.payment_status, hot.charge_amount)
        assert (far.status, far.payment_status) == ("confirmed", "pending")
        assert _bal(s, u) == 500.0, "срочный слот корзины списался до одобрения"


def test_cart_by_admin_not_held():
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=500.0, name="Спец")
        req = routes.MultiSlotRequest(target_user_id=str(u.id), slots=[
            routes.MultiSlotItem(resource_id="room_1", location_id="unbox_uni",
                                 date=H._day(0).strftime("%Y-%m-%d"), start_time="15:00"),
            routes.MultiSlotItem(resource_id="room_1", location_id="unbox_uni",
                                 date=H._day(0).strftime("%Y-%m-%d"), start_time="17:00"),
        ])
        out = routes.create_multi_slot_booking(session=s, data=req, current_user=admin)
        s.expire_all()
        assert all(s.get(Booking, b.id).status == "confirmed" for b in out["bookings"])


def test_series_hot_first_date_goes_to_approval():
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    from uuid import UUID
    with H.frozen_time(), _NoTg():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Спец")
        req = routes.RecurringBookingRequest(resource_id="room_1", location_id="unbox_uni", start_time="15:00",
                                             first_date=H._day(0).strftime("%Y-%m-%d"), occurrences=2)
        out = routes.create_recurring_booking(background_tasks=BackgroundTasks(), session=s, data=req, current_user=u)
        s.expire_all()
        rows = sorted((s.get(Booking, UUID(i)) for i in out["booking_ids"]), key=lambda b: b.date)
        assert [r.status for r in rows] == ["pending_approval", "confirmed"], [r.status for r in rows]
        assert out["pending_approval"] == 1
        assert _bal(s, u) == 500.0


def test_pending_approval_holds_slot():
    """Бронь «на подтверждении» держит время: поверх неё другую не поставить."""
    with H.frozen_time(), _NoTg():
        s = H._db()
        a = H._user(s, role="specialist", balance=500.0, name="А")
        b = H._user(s, role="specialist", balance=500.0, name="Б")
        first = _create(s, a, a, day=0, start="15:00")
        assert first.status == "pending_approval", first.status
        second = _create(s, b, b, day=0, start="15:00")
        assert isinstance(second, dict) and second.get("http") == 400, second


# ── перенос: новое время по правилам новой брони ─────────────────────────

def test_reschedule_into_hot_window_refused_for_client():
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=500.0, name="Спец")
        b = _create(s, u, u, day=3, start="12:00")
        out = _move(s, b, u, day=0, start="15:00")
        assert isinstance(out, dict) and out.get("http") == 409, out
        out = _move(s, b, admin, day=0, start="15:00")
        assert not isinstance(out, dict), out


def test_reschedule_into_past_refused():
    with H.frozen_time(), _NoTg():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Спец")
        b = _create(s, u, u, day=3, start="12:00")
        out = _move(s, b, u, day=0, start="09:00")      # сегодня 09:00 — час назад
        assert isinstance(out, dict) and out.get("http") == 400, out


# ── 3. перенос оплаченной брони дальше суток — оплата возвращается ───────

def test_paid_moved_far_is_deferred_again():
    """Мария Кирдун: бронь сегодня 14:00 оплачена (20 ₾), админ переносит на
    четверг — оплата вернулась (+20 booking_charge_revert), бронь pending;
    крон за сутки спишет снова."""
    from app.models.booking import Booking
    from app.services.billing_defer import settle_pending_charge
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=500.0, name="Клиент")
        b = _create(s, admin, u, day=0, start="14:00")
        assert (b.payment_status, _bal(s, u)) == ("paid", 480.0)
        _move(s, b, admin, day=3, start="14:00")
        b = s.get(Booking, b.id)
        assert (b.payment_status, b.charge_amount, b.charged_at) == ("pending", None, None)
        assert _bal(s, u) == 500.0
        reasons = [r.reason for r in _ledger(s, u)]
        assert reasons.count("booking_charge_revert") == 1 and "reschedule_diff" not in reasons, reasons
        assert sum(float(r.delta) for r in _ledger(s, u)) + 500.0 == _bal(s, u)
        # крон: пока далеко — «не пора» (гонка после выборки)
        ok, why = settle_pending_charge(s, b, respect_window=True)
        assert (ok, why) == (False, "not_due"), (ok, why)
        assert "settle_pending_charge(session, b, respect_window=True)" in _src("backend/app/api/v1/billing.py")
        s.rollback()
    with H.frozen_time(at=_dt(2026, 10, 7, 12, 0)):    # ср 16:00 — до четверга 14:00 меньше суток
        b = s.get(Booking, b.id)
        ok, why = settle_pending_charge(s, b)
        s.commit()
        assert ok, why
        assert _bal(s, u) == 480.0


def test_paid_subscription_moved_far_returns_hours():
    from app.models.booking import Booking
    from app.models.user import User
    from app.services import subscription_pool as P
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", sub=H._sub("REGULAR_PRACTITIONER"), balance=100.0, name="Абонемент")
        rem0 = P.get_float(s.get(User, u.id).subscription, "remaining_hours")
        b = _create(s, admin, u, day=0, start="14:00", method="subscription")
        s.expire_all()
        assert b.payment_status == "paid" and P.get_float(s.get(User, u.id).subscription, "remaining_hours") == rem0 - 1
        _move(s, b, admin, day=4, start="14:00")
        b = s.get(Booking, b.id)
        sub = s.get(User, u.id).subscription
        assert b.payment_status == "pending"
        assert P.get_float(sub, "remaining_hours") == rem0, "часы не вернулись в пул"


def test_undo_skips_weekly_package_and_never_touches_bonus():
    src = _src("backend/app/services/billing_defer.py")
    body = src[src.index("def undo_early_charge("):src.index("def settle_pending_charge(")]
    assert "hours_return_allowed(sub, b.date)" in body and '"pool_expired"' in body and '"pool_mismatch"' in body
    assert "refund_free_hours" not in body and "_refund_booking_to_owner" not in body, "бонус вернулся бы дважды"
    assert 'reason="booking_charge_revert"' in body
    r = _src("backend/app/api/v1/bookings/routes.py")
    one = r[r.index("def reschedule_booking("):r.index("def _move_funds_check(")]
    assert one.index("undo_early_charge(") < one.index("_reprice_for_move("), "возврат должен быть до пересчёта цены"
    ser = r[r.index("def reschedule_booking_series("):]
    assert ser.index("undo_early_charge(") < ser.index("_sib_price = _reprice_for_move(")
    c = _src("backend/app/api/v1/crm/sessions.py")
    assert c.index("undo_early_charge(") < c.index("_reprice(\n")


# ── CRM: бронь едет за сессией по тем же правилам ────────────────────────

def _crm_session(s, me, b, utc_hour):
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession
    c = TherapistClient(specialist_id=str(me.id), name="К", alias_code="4321", base_price=100)
    s.add(c); s.commit(); s.refresh(c)
    ts = TherapySession(client_id=c.id, specialist_id=str(me.id), date=b.date.replace(hour=utc_hour),
                        duration_minutes=60, booking_id=str(b.id), is_booked=True)
    s.add(ts); s.commit(); s.refresh(ts)
    return ts


def test_crm_future_booking_not_into_past_or_hot():
    from fastapi import HTTPException
    from app.api.v1.crm import sessions as crm_sessions
    from app.models.therapy_session import TherapySessionUpdate
    with H.frozen_time(), _NoTg():
        s = H._db()
        me = H._user(s, role="specialist", balance=500.0, name="Я")
        b = _create(s, me, me, day=3, start="12:00")
        ts = _crm_session(s, me, b, 8)
        for target, why in ((H._day(0).replace(hour=8), "в прошлое"), (H._day(0).replace(hour=15), "в срочное окно")):
            try:
                crm_sessions.update_session(session_id=ts.id, data=TherapySessionUpdate(date=target),
                                            session=s, current_user=me)
                raise AssertionError(f"CRM перенёс бронь {why}")
            except HTTPException as e:
                s.rollback()
                assert e.status_code == 409, (why, e.status_code)


def test_crm_finished_booking_not_reused():
    from fastapi import HTTPException
    from app.api.v1.crm import sessions as crm_sessions
    from app.models.booking import Booking
    from app.models.therapy_session import TherapySessionUpdate
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        me = H._user(s, role="specialist", balance=500.0, name="Я")
        b = _create(s, admin, me, day=0, start="12:00")
        ts = _crm_session(s, me, b, 8)
        bid, tsid = b.id, ts.id
    with H.frozen_time(at=_dt(2026, 10, 5, 12, 0)):       # 16:00 — бронь 12–13 прошла
        try:
            crm_sessions.update_session(session_id=tsid, data=TherapySessionUpdate(date=_dt(2026, 10, 8, 20, 0)),
                                        session=s, current_user=me)
            raise AssertionError("прошедшую бронь перенесли на будущее")
        except HTTPException as e:
            s.rollback()
            assert e.status_code == 409, e.status_code
        assert s.get(Booking, bid).start_time == "12:00"


# ── продление серии ──────────────────────────────────────────────────────

def test_series_extension_not_into_past():
    from datetime import timedelta
    from fastapi import HTTPException
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    with H.frozen_time(), _NoTg():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Спец")
        gid = "old-series-1"
        for k in (4, 3):     # серия кончилась 3 недели назад
            s.add(Booking(resource_id="room_1", location_id="unbox_uni", date=H._day(-7 * k), start_time="12:00",
                          duration=60, status="confirmed", final_price=20.0, base_price=20.0, payment_method="balance",
                          payment_status="paid", user_id=u.email, user_uuid=u.id, recurring_group_id=gid))
        s.commit()
        try:
            routes.extend_recurring_series(group_id=gid, payload={"add_occurrences": 2}, session=s, current_user=u)
            raise AssertionError("серию продлили в прошлое")
        except HTTPException as e:
            s.rollback()
            assert e.status_code == 400 and "прошедшее" in str(e.detail), (e.status_code, e.detail)
        assert len([b for b in s.exec(__import__("sqlmodel").select(Booking)).all()
                    if b.recurring_group_id == gid]) == 2
        _ = timedelta


def test_one_rule_everywhere_in_code():
    r = _src("backend/app/api/v1/bookings/routes.py")
    assert r.count("is_hot_start(") >= 3, "срочное окно должно проверяться общим правилом во всех путях"
    assert "_evening_next_morning" not in r, "копия правила снова в routes.py"
    b = _src("backend/app/services/booking.py")
    assert 'Booking.status.in_(("confirmed", "pending_approval"))' in b
    m = _src("src/pages/mobile/MobileCheckout.tsx")
    assert "const expectApproval = isHotBooking && !isBookingAdmin(currentUser);" in m
    assert "setDone({ pending: !!batch && batch.pendingApproval > 0, waiting: batch?.pendingApproval ?? 0, total: newBookings.length });" in m
    # Срочность — по Тбилиси (UTC+4), не по часам браузера (ревизор фронта 12.10).
    assert "item.start.getHours() - 4, item.start.getMinutes());" in m


def test_reject_detaches_crm_session():
    """Отклонённая срочная бронь отвязывается от CRM-сессии, как отмена (12.10:
    серия из CRM привязывает сессию к первой встрече, а она бывает срочной).
    Общий помощник release_rejected_hot_booking — и сайт, и Telegram."""
    from app.api.v1.bookings import routes
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        me = H._user(s, role="specialist", balance=500.0, name="Спец")
        b = _create(s, me, me, day=0, start="15:00")
        assert b.status == "pending_approval", b.status
        c = TherapistClient(specialist_id=str(me.id), name="К", alias_code="4321", base_price=100)
        s.add(c); s.commit(); s.refresh(c)
        ts = TherapySession(client_id=c.id, specialist_id=str(me.id), date=_dt(2026, 10, 5, 11, 0),
                            duration_minutes=60, booking_id=str(b.id), is_booked=True)
        s.add(ts); s.commit(); s.refresh(ts)
        tsid = ts.id
        routes.reject_booking(booking_id=str(b.id), payload=routes.RejectBookingPayload(reason="тест"),
                              session=s, current_user=admin)
        s.expire_all()
        ts = s.get(TherapySession, tsid)
        assert (ts.booking_id, ts.is_booked) == (None, False), (ts.booking_id, ts.is_booked)
    tg = _src("backend/app/api/v1/telegram.py")
    assert "release_rejected_hot_booking(session, booking)" in tg, "бот отклоняет мимо общего помощника"



# ── ревизия 12.10 (деньги + регрессии): дыры вокруг заявок и возврата ──────

def test_hot_cart_and_series_check_funds():
    """Срочный слот корзины/серии спишется одобрением, но средства проверяем
    сразу — как одиночная срочная бронь (иначе одобрение уводит в минус)."""
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    with H.frozen_time(), _NoTg():
        s = H._db()
        u = H._user(s, role="specialist", balance=0.0, name="БезДенег")
        req = routes.MultiSlotRequest(slots=[routes.MultiSlotItem(
            resource_id="room_1", location_id="unbox_uni", date=H._day(0).strftime("%Y-%m-%d"), start_time="15:00")])
        out = H._call(routes.create_multi_slot_booking, session=s, data=req, current_user=u)
        s.rollback()
        assert isinstance(out, dict) and out.get("http") == 400, out
        req = routes.RecurringBookingRequest(resource_id="room_1", location_id="unbox_uni", start_time="15:00",
                                             first_date=H._day(0).strftime("%Y-%m-%d"), occurrences=2)
        out = H._call(routes.create_recurring_booking, background_tasks=BackgroundTasks(), session=s, data=req, current_user=u)
        s.rollback()
        assert isinstance(out, dict) and out.get("http") == 400, out
        # два срочных слота: денег хватает только на один — отказ всей корзине
        v = H._user(s, role="specialist", balance=25.0, name="НаОдин")
        req = routes.MultiSlotRequest(slots=[
            routes.MultiSlotItem(resource_id="room_1", location_id="unbox_uni", date=H._day(0).strftime("%Y-%m-%d"), start_time="15:00"),
            routes.MultiSlotItem(resource_id="room_2", location_id="unbox_uni", date=H._day(0).strftime("%Y-%m-%d"), start_time="15:00"),
        ])
        out = H._call(routes.create_multi_slot_booking, session=s, data=req, current_user=v)
        s.rollback()
        assert isinstance(out, dict) and out.get("http") == 400, out


def test_series_cancel_takes_pending_request():
    """Отмена серии снимает и срочную встречу «на подтверждении» — иначе
    одобрение потом списало бы деньги за встречу отменённой серии."""
    from fastapi import BackgroundTasks
    from uuid import UUID
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    with H.frozen_time(), _NoTg():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Серия")
        req = routes.RecurringBookingRequest(resource_id="room_1", location_id="unbox_uni", start_time="15:00",
                                             first_date=H._day(0).strftime("%Y-%m-%d"), occurrences=2)
        out = routes.create_recurring_booking(background_tasks=BackgroundTasks(), session=s, data=req, current_user=u)
        ids = [UUID(i) for i in out["booking_ids"]]
        gid = s.get(Booking, ids[0]).recurring_group_id
        routes.cancel_recurring_bookings(group_id=gid, from_booking_id=None, refund_percent=1.0, reason=None,
                                         session=s, current_user=u)
        s.expire_all()
        assert [s.get(Booking, i).status for i in ids] == ["cancelled", "cancelled"], [s.get(Booking, i).status for i in ids]
        assert _bal(s, u) == 500.0


def test_client_withdraws_own_request_within_24h():
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    with H.frozen_time(), _NoTg():
        s = H._db()
        u = H._user(s, role="specialist", balance=500.0, name="Заявка")
        b = _create(s, u, u, day=0, start="15:00")
        assert b.status == "pending_approval"
        routes.cancel_booking(booking_id=str(b.id), background_tasks=BackgroundTasks(), session=s, current_user=u)
        s.expire_all()
        assert s.get(Booking, b.id).status == "cancelled" and _bal(s, u) == 500.0


def test_undo_only_explicitly_paid_and_matching_ledger():
    """Ревизия денег 12.10: NULL-статус (старые строки — «не знаем, брали ли»)
    и бронь, чьи деньги не сходятся с лентой, перенос не «возвращает»."""
    from sqlmodel import select
    from app.models.balance_ledger import BalanceLedger
    from app.models.booking import Booking
    from app.services.billing_defer import undo_early_charge
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=500.0, name="Старая")
        b = _create(s, admin, u, day=0, start="14:00")
        b.payment_status = None
        s.add(b); s.commit()
        _move(s, b, admin, day=3, start="14:00")
        b = s.get(Booking, b.id)
        assert b.payment_status is None and _bal(s, u) == 480.0, (b.payment_status, _bal(s, u))
        c = _create(s, admin, u, day=0, start="16:00")
        for r in s.exec(select(BalanceLedger).where(BalanceLedger.ref_id == str(c.id))).all():
            s.delete(r)
        s.commit()
        res = undo_early_charge(s, s.get(Booking, c.id), s.get(type(u), u.id), admin,
                                new_date=H._day(3), new_start_time="16:00")
        s.rollback()
        assert res["reason"] == "ledger_mismatch" and not res["undone"], res


def test_undo_keeps_hours_if_plan_ends_before_new_date():
    """Абонемент кончится раньше нового времени: час не возвращаем (крон взял
    бы уже деньги — 20 ₾ вместо 1 ч), бронь остаётся оплаченной часами."""
    from app.models.booking import Booking
    from app.models.user import User
    from app.services import subscription_pool as P
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        sub = P.update(H._sub("REGULAR_PRACTITIONER"), expiry_date=_dt(2026, 10, 7, 12, 0).isoformat())
        u = H._user(s, role="specialist", sub=sub, balance=100.0, name="Кончается")
        b = _create(s, admin, u, day=0, start="14:00", method="subscription")
        s.expire_all()
        rem = P.get_float(s.get(User, u.id).subscription, "remaining_hours")
        _move(s, b, admin, day=4, start="14:00")
        b = s.get(Booking, b.id)
        assert b.payment_status == "paid", b.payment_status
        assert P.get_float(s.get(User, u.id).subscription, "remaining_hours") == rem
        assert _bal(s, u) == 100.0


def test_cron_skips_request_cancelled_after_pick():
    from app.models.booking import Booking
    from app.services.billing_defer import settle_pending_charge
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=500.0, name="Гонка")
        b = _create(s, admin, u, day=3, start="14:00")
        assert b.payment_status == "pending"
        b.status = "cancelled"
        s.add(b); s.commit()
    with H.frozen_time(at=_dt(2026, 10, 7, 12, 0)):
        ok, why = settle_pending_charge(s, s.get(Booking, b.id), respect_window=True)
        s.rollback()
        assert (ok, why) == (False, "not_due") and _bal(s, u) == 500.0, (ok, why)


def test_request_lifecycle_wiring():
    """Заявка держит время везде, где на это смотрят: бот (/book), «наши» события
    календаря; отклонение — как отмена (лист ожидания, событие Google);
    одобрение не создаёт второе событие."""
    t = _src("backend/app/api/v1/telegram.py")
    busy = t[t.index("def _get_busy_slots("):t.index("def _get_busy_slots(") + 900]
    assert 'Booking.status.in_(("confirmed", "pending_approval"))' in busy
    assert "after_rejected_hot_booking(session, booking)" in t
    assert "None if booking.gcal_event_id else _gcal.create_event(" in t
    r = _src("backend/app/api/v1/bookings/routes.py")
    rej = r[r.index("def reject_booking("):r.index("def reject_booking(") + 3000]
    assert "after_rejected_hot_booking(session, booking)" in rej
    helper = r[r.index("def after_rejected_hot_booking("):r.index("def after_rejected_hot_booking(") + 1500]
    assert "notify_waitlist_for_freed_slot" in helper and "_gcal_delete_in_background" in helper
    assert "None if booking.gcal_event_id else gcal_service.create_event(" in r
    assert 'Booking.status.in_(("confirmed", "pending_approval")))  # 12.10: заявка тоже наша' in r


def test_crm_past_booking_moved_within_past_keeps_price():
    """Прошедшую бронь (08:00–09:00, сейчас 10:00) сессия двигает в другое
    прошедшее время (07:00): бронь едет, цену задним числом не меняем."""
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.api.v1.crm import sessions as crm_sessions
    from app.models.booking import Booking
    from app.models.therapy_session import TherapySessionUpdate
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        me = H._user(s, role="specialist", balance=500.0, name="Я")
        b = _create(s, admin, me, day=0, start="08:00")
        assert routes._is_past(b), "бронь 08:00–09:00 при «сейчас» 10:00 должна быть прошедшей"
        price0 = float(b.final_price)
        ts = _crm_session(s, me, b, 8)   # даты сессий — по Тбилиси
        crm_sessions.update_session(session_id=ts.id, data=TherapySessionUpdate(date=b.date.replace(hour=7)),
                                    session=s, current_user=me, background_tasks=BackgroundTasks())
        s.expire_all()
        b = s.get(Booking, b.id)
        assert (b.start_time, float(b.final_price)) == ("07:00", price0), (b.start_time, b.final_price, price0)


def test_extend_bonus_booking_pays_its_share():
    """17.10 (Максим Кочерженко): 1 ч приветственным часом, потом «Продлить» на
    1 ч. 2 ч стоят 40 − 10 % = 36 ₾; подарок покрывает половину брони — доплата
    18 ₾ (как при создании 2-часовой брони с бонусом), а не 36 − 20 = 16."""
    from datetime import timedelta
    from app.api.v1.bookings import routes
    from app.models.booking import Booking
    from app.models.bonus import Bonus
    with H.frozen_time(), _NoTg():
        s = H._db()
        admin = H._user(s, role="owner", balance=0.0, name="Админ")
        u = H._user(s, role="specialist", balance=0.0, name="Новый")
        s.add(Bonus(user_id=str(u.id), type="free_hour", quantity=1.0, status="active", description="Добро пожаловать",
                    granted_by_id="system", granted_by_name="Система", expires_at=H._day(10) + timedelta(days=1)))
        s.commit()
        b = _create(s, admin, u, day=0, start="14:00", minutes=60, method="bonus")
        assert (b.payment_method, float(b.final_price or 0)) == ("bonus", 0.0), (b.payment_method, b.final_price)
        out = H._call(routes.extend_booking, booking_id=str(b.id), payload=routes.ExtendRequest(extra_minutes=60),
                      session=s, current_user=admin)
        assert not (isinstance(out, dict) and "http" in out), out
        s.expire_all()
        b = s.get(Booking, b.id)
        assert (b.duration, float(b.final_price)) == (120, 18.0), (b.duration, b.final_price)
        assert _bal(s, u) == -18.0, _bal(s, u)

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
                traceback.print_exc(limit=3)
    sys.exit(1 if fails else 0)
