"""СТОРОЖ: клиентская часть мобильного приложения, волна 1 (ревью 09.11.2026).

Что держит (по пункту ревью client-ux / admin-ux / crm-ux):
  №1  перенос: «Свободно» открывается на дне брони (?date= в ссылке и прыжок на
      день брони), срочные окна (is_hot_start) не-админу не показываем, в
      подтверждении — что изменится; фронтовое зеркало правила совпадает с сервером.
  №2  подпись «Пересдать» — по способу оплаты (часы абонемента / бонус / деньги),
      а не всегда «50 % на баланс».
  №3  остаток абонемента — одна функция (subscriptionOverview) в «Я», «Абонементе»
      и оплате; подпись «Свободно … · ещё … в ваших бронях · всего …».
  №4  «Продлить +30 минут» — цена на кнопке и подтверждение.
  №5  цена на чипе кабинета — calculatePrice (пик), залы «от … · группа …».
  №6  /users/me/balance-ledger: только свои строки, без имени сотрудника и без
      текста ручных корректировок; экран /m/balance; «Баланс» в «Я» ведёт туда.
  №7/№10  отменённая бронь — «Возвращено …»/«Без возврата», причина по-русски.
  №8  серия: «Считаем…» и неактивная кнопка, итог серии из расчёта сервера, 4 повтора.
  №9  пересдачу забрали → уведомление в приложении владельцу с тем, что вернули;
      карточка «Подключите Telegram» на «Сегодня» и после брони.
  №11 правила: мобильная шапка + 5 пунктов; ссылки из шторки и оформления.
  №12 длительности 2,5 и 4 ч и «Больше…» до 9 ч.
  №13–20 мелочи (слова, «Сообщить» выше, бонус простыми словами, свайп «Отменить»,
      «Ваш тариф», календарь :30 и прошлое, строка брони, «Выйти?»).
  admin №2/№20  «Для кого бронь» — поиск с балансом, обязательный в админ-брони;
      полоска «← В админку · Бронь для» вместо меню; после переноса чужой — в админку.
  crm №9  бронь под сессию CRM — шторка подтверждения, срочная → «Отправили админу».

Без сети и боевой базы: SQLite в памяти + проверки по исходникам.

    python3 backend/tests/guard_client_wave1_2026_11.py
"""
import os
import pathlib
import re
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


# ─── Фикстуры ────────────────────────────────────────────────────────────

def _db():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine
    import app.models.specialist  # noqa: F401  (relationship у User)
    from app.models.balance_ledger import BalanceLedger
    from app.models.booking import Booking
    from app.models.notification import Notification
    from app.models.resource import Resource
    from app.models.user import User

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[
        User.__table__, BalanceLedger.__table__, Booking.__table__, Notification.__table__, Resource.__table__,
    ])
    s = Session(eng)
    s.add(Resource(id="unbox_uni_room_6", name="Кабинет 6", type="cabinet", location_id="unbox_uni",
                   hourly_rate=20, capacity=4, area=16))
    s.commit()
    return s


def _user(s, email, balance=100.0):
    from app.models.user import User
    u = User(id=uuid4(), email=email, name=email.split("@")[0], role="specialist", balance=balance,
             hashed_password="x")
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _booking(s, owner, **kw):
    from app.models.booking import Booking
    b = Booking(
        id=uuid4(), user_id=owner.email, user_uuid=owner.id, location_id="unbox_uni",
        resource_id="unbox_uni_room_6", date=datetime(2026, 11, 20), start_time="12:00", duration=60,
        format="individual", status=kw.pop("status", "cancelled"), final_price=kw.pop("final_price", 20.0), **kw,
    )
    s.add(b)
    s.commit()
    s.refresh(b)
    return b


def _notif_text(s, owner):
    from sqlmodel import select
    from app.models.notification import Notification
    rows = s.exec(select(Notification).where(Notification.recipient_id == str(owner.id))).all()
    assert len(rows) == 1, f"ожидали одно уведомление, есть {len(rows)}"
    n = rows[0]
    assert n.type == "re_rent_taken" and n.link == "/dashboard/bookings"
    return n.title + " | " + n.description


# ─── №9: уведомление в приложении, когда пересдачу забрали ───────────────

def test_rerent_notification_money():
    from app.api.v1.bookings.routes import _rr_add_taken_notification
    s = _db()
    owner = _user(s, "owner@x.test")
    b = _booking(s, owner, payment_method="balance", payment_status="paid", charge_amount=20.0)
    _rr_add_taken_notification(s, owner, b, {"refunded_amount": 10.0}, 0.5, [])
    t = _notif_text(s, owner)
    assert "забрали" in t and "Кабинет 6" in t and "20.11" in t and "12:00–13:00" in t, t
    assert "Вернули 50 %: 10 ₾ на баланс." in t, t


def test_rerent_notification_subscription_hours_and_peak():
    from app.api.v1.bookings.routes import _rr_add_taken_notification
    s = _db()
    owner = _user(s, "sub@x.test")
    b = _booking(s, owner, payment_method="subscription", payment_status="paid", hours_deducted=1.0, final_price=5.0)
    _rr_add_taken_notification(s, owner, b, {"refunded_hours": 0.5, "refunded_peak_gel": 2.5}, 0.5, [])
    t = _notif_text(s, owner)
    assert "0,5 ч в абонемент" in t and "2,5 ₾ на баланс" in t, t


def test_rerent_notification_bonus_and_pending_and_rest():
    from app.api.v1.bookings.routes import _rr_add_taken_notification
    s = _db()
    owner = _user(s, "bonus@x.test")
    b = _booking(s, owner, payment_method="bonus", payment_status="paid", hours_deducted=1.0, final_price=0.0)
    _rr_add_taken_notification(s, owner, b, {}, 0.5, [])
    assert "0,5 ч бонуса" in _notif_text(s, owner)

    owner2 = _user(s, "pending@x.test")
    b2 = _booking(s, owner2, payment_method="balance", payment_status="pending")
    rest = [SimpleNamespace(start_time="13:00", duration=60)]
    _rr_add_taken_notification(s, owner2, b2, {"skipped_reason": "pending"}, 0.5, rest)
    t = _notif_text(s, owner2)
    assert "ещё не была оплачена" in t and "ничего не спишем" in t, t
    assert "Остальное время осталось за вами" in t and "13:00 (60 мин)" in t, t


def test_rerent_notification_wired_in_takeover():
    src = _read("backend/app/api/v1/bookings/routes.py")
    i = src.index("def _take_over_re_rent_bookings")
    body = src[i:i + 9000]
    assert "_rr_add_taken_notification(session, re_rent_owner, re_rent_booking" in body, \
        "уведомление в приложении больше не создаётся при пересдаче"
    # без условия telegram_id — приходит и тем, у кого бот не подключён
    j = body.index("_rr_add_taken_notification(session")
    k = body.index("if re_rent_owner and re_rent_owner.telegram_id")
    assert j < k, "уведомление снова зависит от Telegram"
    assert "except Exception" in body[j:j + 400], "сбой уведомления может уронить бронь"


# ─── №6: своя лента баланса ──────────────────────────────────────────────

def test_my_balance_ledger_only_own_rows_and_no_internal_text():
    from app.api.v1.users.profile import read_my_balance_ledger
    from app.models.balance_ledger import BalanceLedger
    s = _db()
    me = _user(s, "me@x.test", balance=30.0)
    other = _user(s, "other@x.test", balance=999.0)
    mine = _booking(s, me, status="confirmed", payment_method="balance", payment_status="paid")
    theirs = _booking(s, other, status="confirmed", payment_method="balance", payment_status="paid")
    now = datetime.utcnow()
    s.add(BalanceLedger(user_id=str(me.id), delta=50, balance_after=50, reason="topup",
                        description="Пополнение через кассу (cash)", actor_name="Ирина", created_at=now - timedelta(hours=3)))
    s.add(BalanceLedger(user_id=str(me.id), delta=-20, balance_after=30, reason="booking_charge",
                        ref_type="booking", ref_id=str(mine.id), created_at=now - timedelta(hours=2)))
    s.add(BalanceLedger(user_id=str(me.id), delta=0, balance_after=30, reason="correction",
                        description="Ручная корректировка: внутренняя заметка", created_at=now - timedelta(hours=1)))
    # строка «моя», но ссылается на чужую бронь — подробности брони не отдаём
    s.add(BalanceLedger(user_id=str(me.id), delta=0, balance_after=30, reason="booking_refund",
                        ref_type="booking", ref_id=str(theirs.id), created_at=now))
    s.add(BalanceLedger(user_id=str(other.id), delta=999, balance_after=999, reason="topup"))
    s.commit()
    out = read_my_balance_ledger(session=s, current_user=me, limit=200)
    assert out["balance"] == 30.0
    rows = out["entries"]
    assert len(rows) == 4, f"ожидали 4 свои строки, пришло {len(rows)}"
    assert all("actorName" not in r for r in rows), "наружу ушло имя сотрудника"
    by_reason = {r["reason"]: r for r in rows}
    assert by_reason["correction"]["description"] == "", "текст ручной корректировки ушёл клиенту"
    assert by_reason["topup"]["description"] == "", "служебный код способа оплаты ушёл клиенту"
    b = by_reason["booking_charge"]["booking"]
    assert b and b["resourceName"] == "Кабинет 6" and b["startTime"] == "12:00", b
    assert by_reason["booking_refund"]["booking"] is None, "подробности чужой брони ушли клиенту"
    assert rows[0]["date"] >= rows[-1]["date"], "лента не от новых к старым"


def test_my_balance_ledger_route_before_admin_route():
    init = _read("backend/app/api/v1/users/__init__.py")
    assert init.index("profile.router") < init.index("admin.router"), \
        "/me/balance-ledger перехватит админский /{user_id}/balance-ledger"
    p = _read("backend/app/api/v1/users/profile.py")
    assert '@router.get("/me/balance-ledger")' in p and "deps.get_current_user" in p
    assert "BalanceLedger.user_id == str(current_user.id)" in p, "лента не ограничена текущим человеком"


def test_balance_screen_and_profile_link():
    app = _code("src/App.tsx")
    assert 'path="balance" element={<MobileBalance />}' in app
    prof = _code("src/pages/mobile/MobileProfile.tsx")
    assert "navigate('/m/balance')" in prof, "«Баланс» в «Я» снова открывает только подсказку"
    bal = _code("src/pages/mobile/MobileBalance.tsx")
    assert "getMyBalanceLedger" in bal and "Как пополнить" in bal and "balanceAfter" in bal
    api = _code("src/api/users.ts")
    assert "'/users/me/balance-ledger'" in api


# ─── №1: перенос ─────────────────────────────────────────────────────────

def test_hot_rule_mirror_matches_server_constants():
    ts = _code("src/utils/bookingPolicy.ts")
    py = _read("backend/app/services/booking_policy.py")
    assert "return 24 if start_tb.weekday() >= 5 else 12" in py
    assert "dow === 0 || dow === 6 ? 24 : 12" in ts, "фронт: выходные 24 ч / будни 12 ч"
    assert "now.h >= 21" in ts and "startMin < 12 * 60" in ts, "фронт: правило «после 21:00 на утро»"
    assert "4 * 3600_000" in ts, "фронт: Тбилиси UTC+4"


def test_reschedule_opens_on_booking_day_and_hides_hot():
    sheet = _code("src/pages/mobile/BookingDetailSheet.tsx")
    assert "&date=${fmtDate(dt, 'yyyy-MM-dd')}" in sheet, "перенос снова открывается на «Сегодня»"
    find = _code("src/pages/mobile/MobileFind.tsx")
    assert "jumpToDate(new Date(ymd + 'T00:00:00'))" in find, "без ?date= (из админки) — не прыгаем на день брони"
    assert "if (!initialCustomDate) return 0;" in find, "?date= без ?day= снова игнорируется"
    assert "isHotStart(targetYmd, x.startMin)" in find and "restrictHot" in find
    assert "!isHotStart(ymd, h * 60 + m)" in find, "старое срочное время (сервер разрешает) тоже режется"
    assert "делает только администратор" in find
    assert "отменить бронь потом будет нельзя" in find and "Цена станет" in find, "подтверждение не говорит, что изменится"


# ─── №2, №7, №10: подписи возврата ───────────────────────────────────────

def test_refund_captions_by_payment_method():
    rt = _code("src/pages/mobile/refundText.ts")
    for s in ("бонуса", "в абонемент", "на баланс", "ничего не спишем", "Без возврата",
              "Вы отменили бронь", "Время пересдали другому специалисту", "Отменена вместе с серией"):
        assert s in rt, f"refundText.ts: нет «{s}»"
    assert "/^[\\x20-\\x7E]+$/" in rt, "сырой английский текст сервера снова уйдёт на экран"
    sheet = _code("src/pages/mobile/BookingDetailSheet.tsx")
    assert "Если её займут — вернём 50% на баланс" not in sheet, "старая неверная подпись «Пересдать»"
    assert "reRentCaption(booking)" in sheet and "cancelledRefund(booking)" in sheet
    assert "cancellationReasonText(booking)" in sheet
    assert "{booking.cancellationReason}" not in sheet, "причина отмены снова сырым текстом"
    assert "status={refund.badge}" in sheet, "отменённая бронь снова «Оплачено»"
    mb = _code("src/pages/mobile/MobileMyBookings.tsx")
    assert "reRentConfirmBody(b)" in mb and "Если его заберут — вернём 50% стоимости." not in mb


# ─── №3: одно число абонемента ───────────────────────────────────────────

def test_one_subscription_number():
    pp = _code("src/utils/paymentPriority.ts")
    assert "export function subscriptionOverview" in pp
    assert "ещё ${fmtHours(s.reserved)} в ваших бронях · всего ${fmtHours(s.total)}" in pp
    prof = _code("src/pages/mobile/MobileProfile.tsx")
    assert "subscriptionOverview(sub, bookings" in prof and "свободно</span>" in prof
    assert "fmtHours(sub.remainingHours)} из" not in prof, "в «Я» снова «7 из 10» вместо свободных"
    sub = _code("src/pages/mobile/MobileSubscription.tsx")
    assert "subscriptionHours(sub, {" in sub and "h.ok ? h.total" in sub and "h.ok ? h.free" in sub, \
        "«Абонемент» считает остаток не той функцией, что «Я» и оплата"
    assert 'label="Осталось по абонементу"' not in sub


# ─── №4, №5, №8, №12: цены, серия, длительности ─────────────────────────

def test_extend_has_price_and_confirm():
    sheet = _code("src/pages/mobile/BookingDetailSheet.tsx")
    assert "onClick={() => { void askExtend(); }}" in sheet, "продление снова одним нажатием"
    assert "Продлить на 30 минут${extendQuote" in sheet
    assert "Продлить бронь на 30 минут?" in sheet


def test_chip_price_and_series_quote():
    find = _code("src/pages/mobile/MobileFind.tsx")
    assert "chipPrice(s.startMin, rid)" in find and "группа ${" in find
    assert "Пиковые часы 09–10 и 20–22" not in find
    co = _code("src/pages/mobile/MobileCheckout.tsx")
    assert "useState(4)" in co, "число повторов по умолчанию снова не 4"
    assert "quoteLoading ? 'Считаем…'" in co and "(quoteLoading && forChosen && !needsApplication)" in co
    assert "Итого за серию" in co and "За серию: ${seriesPayText}" in co
    assert "setSeriesQuoteFailed(true)" in co, "сбой расчёта серии навсегда блокирует кнопку"


def test_durations():
    find = _code("src/pages/mobile/MobileFind.tsx")
    assert "[60, 90, 120, 150, 180, 240]" in find and "MAX_DURATION = 9 * 60" in find and "'Больше…'" in find
    co = _code("src/pages/mobile/MobileCheckout.tsx")
    assert "[60, 90, 120, 150, 180, 240].map" in co and "length: 17" in co


# ─── №9, №11, №13–20 ─────────────────────────────────────────────────────

def test_telegram_card_and_rules():
    today = _code("src/pages/mobile/MobileToday.tsx")
    assert "<TelegramConnectCard user={currentUser} />" in today
    co = _code("src/pages/mobile/MobileCheckout.tsx")
    assert "<TelegramConnectCard" in co
    app = _code("src/App.tsx")
    assert '<BookingRulesPage mobile />' in app
    rules = _code("src/pages/BookingRulesPage.tsx")
    assert "MobilePageHeader" in rules and "Коротко о главном" in rules and "SUMMARY.map" in rules
    assert rules.count("title: '") >= 5
    assert "Правила отмены и переноса" in _code("src/pages/mobile/BookingDetailSheet.tsx")
    assert "Правила отмены и переноса" in co


def test_minor_items():
    find = _code("src/pages/mobile/MobileFind.tsx")
    assert "вариантов'" in find and "Найдено: ${" not in find, "№13: снова «Найдено: N»"
    assert "m-find-waitlist" in find, "№13: «Сообщить» не поднят над списком"
    co = _code("src/pages/mobile/MobileCheckout.tsx")
    assert "с баланса ничего не спишем" in co and "из бонусов — с баланса {formatGel(0)}" not in co, "№14"
    mb = _code("src/pages/mobile/MobileMyBookings.tsx")
    assert "open(b, 'confirmCancel')" in mb and "initialMode={openMode}" in mb, "№15"
    sp = _code("src/pages/SubscriptionsPage.tsx")
    assert "Ваш тариф" in sp and "Оформить в Telegram" in sp, "№16"
    cal = _code("src/pages/mobile/MobileCalendar.tsx")
    assert "disabled={past}" in cal and "j * 30" in cal, "№17"
    assert "только на бронь, которую покрывает целиком" not in _code("src/pages/mobile/MobileBonuses.tsx"), "№18"
    # 09.11 фаза 3: строка брони по образцу ListRow — сумма справа коротко
    # (priceTrail: «Абонемент» / сумма, доплата второй строкой), а не длинным priceLabel.
    # 09.11 фаза 3 (общие файлы): строка — ListRow, сумма в trail/trailSub.
    assert "const price = priceTrail(booking);" in mb and "trailSub=" in mb, "№19"
    prof = _code("src/pages/mobile/MobileProfile.tsx")
    assert "Выйти из аккаунта?" in prof, "№20"


# ─── Админ-бронь (admin-ux №2, №20) и CRM №9 ────────────────────────────

def test_admin_booking_flow():
    co = _code("src/pages/mobile/MobileCheckout.tsx")
    assert "<ClientPickerSheet" in co and "За себя (" not in co, "снова выпадающий список «За себя» по умолчанию"
    assert "'Сначала выберите, для кого бронь'" in co
    picker = _code("src/pages/mobile/ClientPickerSheet.tsx")
    assert "u.phone" in picker and "formatGel(balance" in picker and "replace(/\\D/g, '')" in picker
    lay = _code("src/pages/mobile/MobileLayout.tsx")
    assert "<AdminFlowStrip" in lay and "В админку" in lay and "Бронь для: " in lay
    find = _code("src/pages/mobile/MobileFind.tsx")
    assert "'/m/admin/bookings' : '/m/bookings'" in find, "после переноса чужой брони — не в админку"
    assert "navigate(afterRescheduleTo, { replace: true })" in find
    assert "бронь: ${rescheduleOwnerName}" in find, "в плашке переноса нет имени клиента"
    assert "bookingForUser: keepFor" in find, "выбранный в админке клиент теряется на выборе слота"


def test_crm_link_session_confirm():
    find = _code("src/pages/mobile/MobileFind.tsx")
    assert "if (linkSessionMeta) { setLinkPick({ startMin, resourceId }); return; }" in find, \
        "бронь под сессию снова создаётся одним тапом"
    assert "Забронировать и привязать" in find and "Отправили админу на подтверждение" in find
    assert "status === 'pending_approval'" in find


if __name__ == "__main__":
    fails = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for n, f in tests:
        try:
            f()
            print(f"  ✓ {n}")
        except AssertionError as exc:
            fails += 1
            print(f"  ✗ {n}: {exc}")
        except Exception as exc:  # noqa: BLE001
            fails += 1
            print(f"  ✗ {n}: {exc!r}")
    print(f"проверок: {len(tests)}")
    print("СТОРОЖ КЛИЕНТА (ВОЛНА 1): OK" if not fails else f"СТОРОЖ КЛИЕНТА (ВОЛНА 1) УПАЛ ({fails})")
    sys.exit(1 if fails else 0)
