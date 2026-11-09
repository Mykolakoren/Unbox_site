"""СТОРОЖ: «Пересдать» — только меньше чем за сутки до начала брони (владелец 09.11).

Правило: пересдача нужна, когда отменить бесплатно уже нельзя (меньше 24 ч). Если до
начала сутки и больше — пересдачи нет: бронь отменяют сами, деньги возвращаются
полностью. Удерживать 50 % за «пересдачу» брони, которую можно бесплатно отменить,
нельзя.

Что ловим:
  * сервер выставляет на пересдачу бронь, до которой сутки и больше (и клиенту, и админу);
  * сервер не даёт снять с пересдачи (снятие — всегда);
  * пересдачу, выставленную ДО правила, забрали за сутки и больше до начала — владелец
    потерял деньги (должно быть 100 % возврата / ничего не списано);
  * флаг пересдачи принимается из тела запроса на создание брони (обход правила);
  * Telegram пишет «50 %», когда вернули 100 %;
  * экраны клиента снова показывают «Пересдать», когда до начала сутки и больше.

    python3 backend/tests/guard_rerent_24h_2026_11.py
"""
import os
import sys
from datetime import datetime as _dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402
from sqlmodel import select  # noqa: E402

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
TOO_EARLY = "До начала больше суток — пересдавать не нужно: отмените бронь, деньги вернутся полностью."


def _src(rel):
    with open(os.path.join(_ROOT, rel), encoding="utf-8") as f:
        return f.read()


def _stand():
    s = H._db()
    admin = H._user(s, role="owner", name="Админ", balance=0.0)
    alla = H._user(s, role="specialist", name="Алла", balance=500.0)
    yana = H._user(s, role="specialist", name="Яна", balance=500.0)
    return s, admin, alla, yana


def _toggle(s, booking, who):
    from app.api.v1.bookings import routes
    return routes.toggle_re_rent(booking_id=str(booking.id), session=s, current_user=who)


def _bal(s, who):
    from app.models.user import User
    s.expire_all()
    return float(s.get(User, who.id).balance)


def _rows(s, who):
    from app.models.booking import Booking
    s.expire_all()
    rows = s.exec(select(Booking).where(Booking.user_uuid == who.id)).all()
    return sorted(rows, key=lambda r: r.start_time)


def _ledger_sum(s, who):
    from app.models.balance_ledger import BalanceLedger
    s.expire_all()
    return sum(float(x.delta) for x in s.exec(
        select(BalanceLedger).where(BalanceLedger.user_id == str(who.id))).all())


# ── Сервер: выставление ─────────────────────────────────────────────────────

def test_listing_refused_24h_or_more_for_client_and_admin():
    from fastapi import HTTPException
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        b = H._create(s, admin, alla, days=2, start="14:00", minutes=60)   # 52 ч до начала
        assert b.status == "confirmed", "стенд: бронь заранее должна быть подтверждена"
        for who in (alla, admin):
            try:
                _toggle(s, b, who)
                raise AssertionError(f"бронь за 52 ч выставилась на пересдачу ({who.role})")
            except HTTPException as e:
                assert e.status_code == 400, e.status_code
                assert e.detail == TOO_EARLY, e.detail
            s.expire_all()
            assert not s.get(type(b), b.id).is_re_rent_listed


def test_listing_refused_at_exactly_24h_boundary():
    from fastapi import HTTPException
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        # Сейчас 05.10 10:00 Тбилиси; 06.10 10:30 — 24,5 ч; 06.10 09:30 — 23,5 ч.
        far = H._create(s, admin, alla, days=1, start="10:30", minutes=60)
        try:
            _toggle(s, far, alla)
            raise AssertionError("бронь за 24,5 ч выставилась на пересдачу")
        except HTTPException as e:
            assert e.status_code == 400 and e.detail == TOO_EARLY
        near = H._create(s, admin, alla, days=1, start="09:30", minutes=60)
        out = _toggle(s, near, alla)
        assert out.is_re_rent_listed, "бронь за 23,5 ч не выставилась на пересдачу"


def test_listing_allowed_under_24h():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        b = H._create(s, admin, alla, days=0, start="14:00", minutes=60)   # 4 ч до начала
        out = _toggle(s, b, alla)
        assert out.is_re_rent_listed, "бронь за 4 ч не выставилась на пересдачу"
        out = _toggle(s, b, alla)
        assert not out.is_re_rent_listed, "не снялась с пересдачи"


def test_unlisting_legacy_listing_always_allowed():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        b = H._create(s, admin, alla, days=3, start="14:00", minutes=60)
        b.is_re_rent_listed = True                     # выставили до правила 09.11
        s.add(b); s.commit()
        out = _toggle(s, b, alla)
        assert not out.is_re_rent_listed, "старую пересдачу за 3 дня нельзя снять"


def test_create_ignores_listed_flag_from_body():
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import Booking, BookingCreate
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        bi = BookingCreate(resource_id="room_1", location_id="unbox_uni", date=H._day(3), start_time="14:00",
                           duration=60, format="individual", payment_method="balance", is_re_rent_listed=True)
        out = routes.create_booking(session=s, booking_in=bi, current_user=alla, background_tasks=BackgroundTasks())
        assert not s.get(Booking, out.id).is_re_rent_listed, "флаг пересдачи принят из тела создания брони"


# ── Сервер: забрали старую пересдачу за сутки и больше ─────────────────────

def test_legacy_pending_listing_taken_early_charges_nothing():
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = H._create(s, admin, alla, days=2, start="14:00", minutes=60)
        s.refresh(a)
        assert a.payment_status == "pending", "стенд: бронь заранее ещё не списана"
        a.is_re_rent_listed = True; s.add(a); s.commit()
        before, ledger_before = _bal(s, alla), _ledger_sum(s, alla)
        H._create(s, admin, yana, days=2, start="14:00", minutes=60)
        rows = _rows(s, alla)
        assert [(r.start_time, r.status) for r in rows] == [("14:00", "cancelled")]
        assert _bal(s, alla) == before, "владельцу начислили деньги за неоплаченную бронь"
        assert _ledger_sum(s, alla) == ledger_before
        assert "100%" in (rows[0].cancellation_reason or ""), rows[0].cancellation_reason


def _paid_listing(s, admin, who, start, minutes):
    """Бронь на 07.10, оплаченная (создана, когда до неё было меньше суток) и
    выставленная на пересдачу. Потом время возвращается на 05.10 — до неё 52 ч."""
    with H.frozen_time(at=_dt(2026, 10, 7, 6, 0, 0)):          # 07.10 10:00 Тбилиси
        b = H._create(s, admin, who, days=2, start=start, minutes=minutes)
        s.refresh(b)
        assert b.payment_status == "paid", "стенд: бронь за 4 ч должна быть списана"
        b.is_re_rent_listed = True; s.add(b); s.commit()
        return b


def test_legacy_paid_listing_taken_early_refunds_100():
    s, admin, alla, yana = _stand()
    a = _paid_listing(s, admin, alla, "14:00", 60)
    paid = float(a.charge_amount)
    assert paid > 0
    with H.frozen_time():
        before = _bal(s, alla)
        H._create(s, admin, yana, days=2, start="14:00", minutes=60)
        rows = _rows(s, alla)
        assert [(r.start_time, r.status) for r in rows] == [("14:00", "cancelled")]
        assert abs(_bal(s, alla) - before - paid) < 0.01, \
            f"за сутки и больше вернулось не 100 %: {_bal(s, alla) - before} из {paid}"
        assert abs(_ledger_sum(s, alla) - (_bal(s, alla) - 500.0)) < 0.01, "баланс разошёлся с лентой"


def test_legacy_paid_listing_part_taken_early_refunds_piece_100():
    s, admin, alla, yana = _stand()
    a = _paid_listing(s, admin, alla, "14:00", 90)
    paid = float(a.charge_amount)
    with H.frozen_time():
        before = _bal(s, alla)
        H._create(s, admin, yana, days=2, start="15:00", minutes=60)
        rows = _rows(s, alla)
        assert [(r.start_time, r.duration, r.status) for r in rows] == \
            [("14:00", 60, "confirmed"), ("15:00", 30, "cancelled")], rows
        piece = float(rows[1].final_price)
        assert abs(_bal(s, alla) - before - piece) < 0.01, "за занятый кусок вернулось не 100 %"
        assert _bal(s, alla) - before < paid, "вернулась вся бронь, хотя остаток за владельцем"


def test_under_24h_take_still_half():
    """Деньги пути «забрали» меньше чем за сутки не меняются: 50 %."""
    with H.frozen_time():
        s, admin, alla, yana = _stand()
        a = H._create(s, admin, alla, days=0, start="14:00", minutes=60)
        s.refresh(a)
        paid = float(a.charge_amount)
        _toggle(s, a, alla)
        before = _bal(s, alla)
        H._create(s, admin, yana, days=0, start="14:00", minutes=60)
        assert abs(_bal(s, alla) - before - paid * 0.5) < 0.01


def test_telegram_text_shows_real_percent():
    from app.services.telegram import telegram_service
    sent = []
    real = telegram_service._send_message
    telegram_service._send_message = lambda **k: sent.append(k["text"]) or True
    try:
        kw = dict(chat_id="1", resource_name="Кабинет 1", location_name=None, date=_dt(2026, 10, 7),
                  start_time="14:00", new_balance=10.0, duration=60)
        telegram_service.send_rerent_taken(refund_amount=20.0, refund_percent=1.0, **kw)
        telegram_service.send_rerent_taken(refund_amount=10.0, **kw)
        telegram_service.send_rerent_taken(refund_amount=0.0, refund_percent=1.0, not_charged=True, **kw)
    finally:
        telegram_service._send_message = real
    assert "100%" in sent[0] and "50%" not in sent[0], sent[0]
    assert "50%" in sent[1], sent[1]
    assert "ничего не спишем" in sent[2] and "+0.00" not in sent[2], sent[2]


def test_take_path_branch_is_in_place():
    src = _src("backend/app/api/v1/bookings/routes.py")
    i = src.index("def _take_over_re_rent_bookings(")
    body = src[i:i + 9000]
    assert "legacy_early = _booking_hours_until_start(listed_booking) >= RE_RENT_MAX_HOURS_BEFORE_START" in body
    assert "refund_percent = 1.0" in body
    j = src.index("def toggle_re_rent(")
    tb = src[j:j + 4500]
    assert "RE_RENT_TOO_EARLY_DETAIL" in tb and "if not booking.is_re_rent_listed:" in tb


# ── Экраны клиента ─────────────────────────────────────────────────────────

def test_mobile_sheet_hides_rerent_24h_or_more():
    sheet = _src("src/pages/mobile/BookingDetailSheet.tsx")
    assert "const reRentWindow = hoursUntilBookingStart(booking) < 24;" in sheet
    assert "const canReRent = isLive && booking.status === 'confirmed' && (reRentWindow || !!booking.isReRentListed);" in sheet, \
        "«Пересдать» в шторке снова не зависит от суток до начала"
    assert "{RE_RENT_TOO_EARLY_HINT}" in sheet, "нет подсказки «отмените бронь» вместо «Пересдать»"
    hint = _src("src/pages/mobile/refundText.ts")
    assert "Больше суток до начала — отмените бронь, деньги вернутся полностью" in hint


def test_mobile_swipe_rerent_only_within_24h():
    src = _src("src/pages/mobile/MobileMyBookings.tsx")
    assert "const hoursToStart = hoursUntilBookingStart(b);" in src
    i = src.index("const primary = within24h")
    seg = src[i:i + 900]
    assert seg.index("label: 'Пересдать'") < seg.index("label: 'Отменить'"), "свайп «Пересдать» не под within24h"


def test_desktop_my_bookings_no_rerent_when_cancel_allowed():
    src = _src("src/pages/MyBookingsPage.tsx")
    # Узкая шторка шахматки: при canModify (больше суток) «Пересдать» нет, есть подсказка.
    i = src.index("{canModify(activeBooking) ? (")
    j = src.index(") : activeBooking.status === 'confirmed' && !(() => {", i)
    seg = src[i:j]
    assert "'Пересдать'" not in seg and "Пересдать<" not in seg, "в окне «больше суток» снова «Пересдать»"
    assert "{RE_RENT_TOO_EARLY_HINT}" in seg
    # Карточка: при canMod — только «Перенести» и «Отменить».
    k = src.index("{isConfirmedUpcoming && !booking.isReRentListed && (")
    card = src[k:k + 1500]
    can = card[card.index("{canMod ? ("):card.index(") : (")]
    assert "Пересдать" not in can, "карточка: «Пересдать» при больше суток"


def test_rules_text_matches():
    src = _src("src/pages/BookingRulesPage.tsx")
    assert "Если до начала брони осталось менее 24 часов" in src, "оферта: нет условия «меньше суток»"
    assert "пересдача не предусмотрена" in src
    assert "«Пересдать» — если до начала меньше суток" in src, "«Коротко о главном» не совпадает с правилом"


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                import traceback
                traceback.print_exc()
                print(f"FAIL {name}: {e}")
    print("ГОТОВО" if not failed else f"УПАЛО: {failed}")
    sys.exit(1 if failed else 0)
