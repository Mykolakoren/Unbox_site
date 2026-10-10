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
