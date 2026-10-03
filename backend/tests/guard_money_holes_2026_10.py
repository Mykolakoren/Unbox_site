"""СТОРОЖ «денежные дыры» (ревизия 03.10, владелец: «исправление по денежным дырам делай»).

Ревизоры нашли места, где часы абонемента или деньги уходят не туда. Каждый
сценарий ниже — с цифрами: баланс и часы ДО и ПОСЛЕ, лента balance_ledger, и
обязательно «отмена после исправленного пути возвращает ровно взятое».

ЕДИНОЕ ПРАВИЛО денег абонементной брони (см. billing_defer.subscription_money_taken):
  * бронь оплачена часами (hours_deducted > 0) → часы в пуле, а денежная часть
    (пиковая надбавка + допы + деньги за продление без часов) = final_price, и
    КАЖДЫЙ путь списания снимает её с баланса вместе с часами (создание ≤24 ч,
    крон T-24ч, одобрение горячей, корзина, серия, продление);
  * бронь ушла в деньги (часов не хватило / абонемент не действует) →
    hours_deducted = 0, charge_amount = реально снятые ₾;
  * отмена/waive возвращают: часы → hours_deducted, деньги → final_price
    (бронь с часами) или charge_amount (бронь деньгами). charge_amount у брони
    с часами для денег НЕ читается: там исторически два «диалекта» (крон пишет
    часы, немедленный путь — ₾), и старые брони так и остаются — возврат по ним
    не меняется.

Пункты ревизии:
  1. горячая бронь по абонементу в пик: одобрение не списывало пик → отмена
     «возвращала» 5 ₾ из воздуха;
  2. одобрение горячей брони не перепроверяло часы (остаток просто 0, бронь
     бесплатная) → теперь запасной путь крона: деньги по цене на момент
     одобрения, hours_deducted = 0, отмена возвращает деньги;
  3. немедленная бронь по абонементу с допами: списывался только пик;
  4. корзина и серия: немедленный слот по абонементу в пик — денег 0;
  5. продление брони по абонементу не снимало часы за добавку;
  6. допы выпадали из цены денежной брони при пересчёте «часов подряд» и
     переносе (25 ₾ с песочницей → 20 ₾);
  7. отклонение горячей брони из Telegram не возвращало бонусные часы;
  8. личную скидку / тип цен / личную ставку менял любой админ через PATCH /users;
  9. одобрение бонусной брони: «Деньги списаны с баланса» → «Оплачено бонусными часами».

Без сети и боевой базы: SQLite в памяти, время заморожено (пн 05.10.2026,
10:00 по Тбилиси), Telegram и Google подменены.

    python3 backend/tests/guard_money_holes_2026_10.py
"""
import contextlib
import functools
import os
import sys
from datetime import date, datetime as _dt, timedelta
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

from sqlmodel import select  # noqa: E402

import app.models  # noqa: E402,F401
from app.models.booking import Booking, BookingCreate  # noqa: E402
from app.models.balance_ledger import BalanceLedger  # noqa: E402
from app.models.resource import Resource  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import subscription_pool as P  # noqa: E402

import guard_hours_pool_moves as H  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _read(rel: str) -> str:
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _body(src: str, start: str, end: str = "\n@router.") -> str:
    i = src.index(start)
    j = src.find(end, i + len(start))
    return src[i:j if j != -1 else len(src)]


# ─── Подмены внешнего мира ──────────────────────────────────────────────

class _Offline:
    """Telegram (сервис и бот) и Google Calendar — без сети; клиентские
    сообщения складываем в .sent, чтобы проверить текст."""

    def __init__(self):
        self.sent = []
        self._saved = []

    def _patch(self, obj, name, value):
        self._saved.append((obj, name, getattr(obj, name)))
        setattr(obj, name, value)

    def __enter__(self):
        from app.services.telegram import telegram_service
        from app.services.google_calendar import gcal_service
        from app.api.v1 import telegram as tg

        def _capture(*a, **kw):
            self.sent.append((str(kw.get("chat_id")), kw.get("text") or ""))
            return True

        self._patch(telegram_service, "_send_message", _capture)
        self._patch(telegram_service, "send_message", lambda chat_id, text, parse_mode="HTML": _capture(chat_id=chat_id, text=text))
        for name in ("send_admin_alert", "send_admin_event", "send_hot_booking_dms", "send_booking_cancelled",
                     "send_booking_confirmation", "send_booking_pending_approval", "send_booking_rescheduled",
                     "send_rerent_taken"):
            if hasattr(telegram_service, name):
                self._patch(telegram_service, name, lambda *a, **kw: True)
        self._patch(gcal_service, "create_event", lambda *a, **kw: None)
        self._patch(gcal_service, "delete_event", lambda *a, **kw: None)
        self._patch(tg, "_send", lambda *a, **kw: None)
        self._patch(tg, "_answer_callback", lambda *a, **kw: None)
        self._patch(tg, "_edit_reply_markup", lambda *a, **kw: True)
        return self

    def __exit__(self, *exc):
        for obj, name, value in reversed(self._saved):
            setattr(obj, name, value)
        return False


def _scenario(fn):
    """Каждый сценарий — замороженное время, своя чистая база, без сети."""
    @functools.wraps(fn)
    def wrapper():
        import app.api.v1.telegram  # noqa: F401 — модуль бота тоже под замороженным временем
        with H.frozen_time(), _Offline():
            return fn()
    return wrapper


# ─── Фикстуры ───────────────────────────────────────────────────────────

def _db():
    """База стража часов + у кабинета 1 есть песочница/проектор/кушетка,
    у кабинета 2 — ничего (перенос туда снимает песочницу), у кабинета 3 —
    песочница (перенос туда её сохраняет)."""
    s = H._db()
    r1 = s.get(Resource, "room_1")
    r1.services = ["sandbox", "projector", "couch"]
    s.add(r1)
    s.add(Resource(id="room_3", name="Кабинет 3", type="cabinet", location_id="unbox_uni",
                   hourly_rate=20.0, capacity=4, area=10, formats=["individual", "group"],
                   services=["sandbox"]))
    s.commit()
    return s


def _admin(s, role="owner"):
    return H._user(s, role=role, name=f"Админ-{role}", balance=0.0)


def _client(s, sub=None, *, balance=100.0, tg=None):
    u = H._user(s, sub=sub, balance=balance, name="Клиент")
    if tg:
        u.telegram_id = tg
        s.add(u)
        s.commit()
        s.refresh(u)
    return u


def _sub(plan="WARM_START", **over):
    return H._sub(plan, **over)


def _book(s, actor, owner, *, days=0, start="14:00", minutes=60, resource="room_1", fmt="individual",
          method="subscription", extras=None):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    bi = BookingCreate(resource_id=resource, location_id="unbox_uni", date=H._day(days), start_time=start,
                       duration=minutes, format=fmt, payment_method=method, extras=list(extras or []),
                       target_user_id=(str(owner.id) if actor.id != owner.id else None))
    out = H._call(routes.create_booking, session=s, booking_in=bi, current_user=actor,
                  background_tasks=BackgroundTasks())
    assert not isinstance(out, dict), f"бронь не создана: {out}"
    s.commit()
    return s.get(Booking, out.id)


def _cancel(s, actor, b, refund_percent=1.0):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    out = H._call(routes.cancel_booking, booking_id=str(b.id), background_tasks=BackgroundTasks(),
                  session=s, current_user=actor, refund_percent=refund_percent)
    assert not (isinstance(out, dict) and "http" in out), out
    s.commit()


def _approve(s, admin, b):
    from app.api.v1.bookings import routes
    out = H._call(routes.approve_booking, booking_id=str(b.id), session=s, current_user=admin)
    assert not (isinstance(out, dict) and "http" in out), f"одобрение отказано: {out}"
    s.commit()
    return s.get(Booking, b.id)


def _bal(s, u) -> float:
    s.expire_all()
    return round(float(s.get(User, u.id).balance or 0), 2)


def _rem(s, u) -> float:
    s.expire_all()
    return round(P.get_float(s.get(User, u.id).subscription, "remaining_hours"), 4)


def _used(s, u) -> float:
    s.expire_all()
    return round(P.get_float(s.get(User, u.id).subscription, "used_hours"), 4)


def _ledger(s, u) -> list:
    s.expire_all()
    return s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(u.id))
                  .order_by(BalanceLedger.created_at)).all()


def _ledger_ok(s, u, start_balance):
    """Инвариант: стартовый баланс + сумма ленты == баланс."""
    total = round(sum(float(r.delta) for r in _ledger(s, u)), 2)
    assert round(start_balance + total, 2) == _bal(s, u), \
        f"лента не сходится с балансом: {start_balance} + {total} != {_bal(s, u)}"


def _booking_net(s, b) -> float:
    """Чистое движение денег по брони в ленте (ref_id = id брони)."""
    s.expire_all()
    rows = s.exec(select(BalanceLedger).where(BalanceLedger.ref_id == str(b.id))).all()
    return round(sum(float(r.delta) for r in rows), 2)


def _bonus(s, u, hours=1.0):
    from app.models.bonus import Bonus
    s.add(Bonus(user_id=str(u.id), type="free_hour", quantity=hours, status="active",
                expires_at=H.FakeDatetime.now() + timedelta(days=10)))
    s.commit()


def _free_hours(s, u) -> float:
    from app.services.bonus_service import available_free_hours
    s.expire_all()
    return available_free_hours(s, u.id)


# ═════════════════════════════════════════════════════════════════════════
# 1. Горячая бронь по абонементу в пик: одобрение снимает пик (и допы)
# ═════════════════════════════════════════════════════════════════════════

@_scenario
def test_1_hot_subscription_peak_charged_on_approve_and_refunded_exactly():
    """Клиент сам: сегодня 20:00–21:00 (пик, через 10 ч → горячая), по абонементу.
    Создание: часы и пик откатываются (бронь ждёт админа) — 100 ₾ / 10 ч.
    Одобрение: −1 ч и −5 ₾ пика → 95 ₾ / 9 ч. Отмена: ровно назад → 100 ₾ / 10 ч.
    Было: одобрение пик не брало (100 ₾), а отмена «возвращала» 5 ₾ → 105 ₾."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, u, u, start="20:00")
    assert (b.status, b.payment_status, float(b.final_price)) == ("pending_approval", "pending", 5.0), \
        (b.status, b.payment_status, b.final_price)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), "горячая бронь списала до одобрения"
    b = _approve(s, admin, b)
    assert (b.status, b.payment_status) == ("confirmed", "paid")
    assert (_bal(s, u), _rem(s, u)) == (95.0, 9.0), \
        f"одобрение: баланс {_bal(s, u)} (ждём 95 — пик 5 ₾), часы {_rem(s, u)} (ждём 9)"
    assert _booking_net(s, b) == -5.0, f"в ленте по брони {_booking_net(s, b)}, ждём −5"
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), \
        f"отмена вернула не ровно взятое: баланс {_bal(s, u)}, часы {_rem(s, u)}"
    assert _booking_net(s, b) == 0.0
    _ledger_ok(s, u, 100.0)


@_scenario
def test_1_hot_subscription_extras_and_peak_via_telegram_approve():
    """То же через кнопку «Подтвердить» в Telegram, бронь 20:00 с песочницей:
    денежная часть = пик 5 + песочница 5 = 10 ₾. Одобрение −10 ₾ −1 ч,
    отмена +10 ₾ +1 ч."""
    from app.api.v1 import telegram as tg
    s = _db()
    admin = _admin(s)
    admin.telegram_id = "555"
    s.add(admin)
    s.commit()
    u = _client(s, _sub("WARM_START"))
    b = _book(s, u, u, start="20:00", extras=["sandbox"])
    assert (b.status, float(b.final_price)) == ("pending_approval", 10.0), (b.status, b.final_price)
    assert _bal(s, u) == 100.0
    tg._handle_hot_booking_callback(s, "cb1", 1, 2, 555, f"ba:{b.id}")
    s.expire_all()
    b = s.get(Booking, b.id)
    assert (b.status, b.payment_status) == ("confirmed", "paid"), (b.status, b.payment_status)
    assert (_bal(s, u), _rem(s, u)) == (90.0, 9.0), f"TG-одобрение: {_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 90 / 9"
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), f"отмена: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _ledger_ok(s, u, 100.0)


@_scenario
def test_1_hot_subscription_without_peak_moves_no_money():
    """Без пика и допов денежная часть 0 — одобрение снимает только час."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, u, u, start="16:00")
    b = _approve(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 9.0)
    assert not _ledger(s, u), "нулевая денежная часть не должна писать строки в ленту"
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)


# ═════════════════════════════════════════════════════════════════════════
# 2. Одобрение перепроверяет часы: нет часов / абонемент не действует → деньги
# ═════════════════════════════════════════════════════════════════════════

@_scenario
def test_2_approve_without_hours_falls_back_to_money_like_cron():
    """Тёплый старт, остался 1 ч. Две горячие брони 16:00 и 17:00 (каждая при
    создании «покрыта» — часы откатываются до одобрения). Первое одобрение
    снимает последний час. Второе: часов нет → бронь деньгами по цене на момент
    одобрения: 20 ₾ − 10 % скидки тарифа = 18 ₾; hours_deducted = 0.
    Отмена второй: +18 ₾, часы не трогает. Было: второе одобрение «снимало» час
    из пустого пула (остаток 0), бронь бесплатная, а отмена клала в пул лишний час."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=1.0, used_hours=9.0))
    b1 = _book(s, u, u, start="16:00")
    b2 = _book(s, u, u, start="17:00")
    assert b1.status == b2.status == "pending_approval"
    _approve(s, admin, b1)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 0.0)
    b2 = _approve(s, admin, b2)
    assert (b2.payment_method, b2.payment_status) == ("subscription", "paid")
    assert float(b2.hours_deducted or 0) == 0.0, f"часы у брони без часов: {b2.hours_deducted}"
    assert round(float(b2.charge_amount), 2) == 18.0, f"списано {b2.charge_amount}, ждём 18 ₾"
    assert (_bal(s, u), _rem(s, u), _used(s, u)) == (82.0, 0.0, 10.0), \
        f"после второго одобрения: {_bal(s, u)} ₾ / остаток {_rem(s, u)} / израсходовано {_used(s, u)}"
    _cancel(s, admin, b2)
    assert (_bal(s, u), _rem(s, u), _used(s, u)) == (100.0, 0.0, 10.0), \
        f"отмена денежной брони: {_bal(s, u)} ₾ / {_rem(s, u)} ч — фантомный час в пуле?"
    _ledger_ok(s, u, 100.0)


@_scenario
def test_2_approve_with_paused_subscription_charges_money_with_extras():
    """После создания брони абонемент поставили на паузу. Одобрение: абонемент
    не действует → деньги: аренда 20 ₾ (без скидки тарифа — он не действует) +
    песочница 5 ₾ = 25 ₾, часы не трогаем. Отмена возвращает 25 ₾."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, u, u, start="16:00", extras=["sandbox"])
    assert b.status == "pending_approval" and float(b.final_price) == 5.0
    uu = s.get(User, u.id)
    uu.subscription = P.update(uu.subscription, is_frozen=True, frozen_at=H.FakeDatetime.utcnow().isoformat())
    s.add(uu)
    s.commit()
    b = _approve(s, admin, b)
    assert float(b.hours_deducted or 0) == 0.0 and round(float(b.charge_amount), 2) == 25.0, \
        (b.hours_deducted, b.charge_amount)
    assert (_bal(s, u), _rem(s, u)) == (75.0, 10.0), f"{_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    _ledger_ok(s, u, 100.0)


# ═════════════════════════════════════════════════════════════════════════
# 3. Немедленная бронь по абонементу с допами: снимается вся денежная часть
# ═════════════════════════════════════════════════════════════════════════

@_scenario
def test_3_immediate_subscription_booking_with_extras_charges_money_part():
    """Админ за клиента, сегодня 14:00 (≤24 ч → сразу), по абонементу + песочница.
    Цена брони 5 ₾ (допы), час — из абонемента. Было: снят только пик (0 ₾),
    а отмена «возвращала» 5 ₾. Стало: −5 ₾ −1 ч; отмена +5 ₾ +1 ч.
    Вторая бронь 20:00 + песочница: пик 5 + песочница 5 = 10 ₾."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, start="14:00", extras=["sandbox"])
    assert (b.payment_method, b.payment_status, float(b.final_price)) == ("subscription", "paid", 5.0)
    assert (_bal(s, u), _rem(s, u)) == (95.0, 9.0), f"{_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 95 / 9"
    assert _booking_net(s, b) == -5.0
    p = _book(s, admin, u, start="20:00", extras=["sandbox"])
    assert float(p.final_price) == 10.0
    assert (_bal(s, u), _rem(s, u)) == (85.0, 8.0), f"{_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 85 / 8"
    _cancel(s, admin, b)
    _cancel(s, admin, p)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), f"отмена: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _ledger_ok(s, u, 100.0)


@_scenario
def test_3_deferred_subscription_booking_with_extras_cron_takes_the_same():
    """Та же бронь заранее (через 3 дня): при создании ничего не снято, крон
    T-24ч снимает 1 ч и 5 ₾ (допы) — как немедленный путь. Отмена — назад."""
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, days=3, start="14:00", extras=["sandbox"])
    assert (b.payment_status, float(b.final_price)) == ("pending", 5.0)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    ok, _ = billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    s.commit()
    assert ok and (_bal(s, u), _rem(s, u)) == (95.0, 9.0), f"крон: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _cancel(s, admin, s.get(Booking, b.id))
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    _ledger_ok(s, u, 100.0)


# ═════════════════════════════════════════════════════════════════════════
# 4. Корзина и серия: немедленный слот по абонементу в пик снимает пик
# ═════════════════════════════════════════════════════════════════════════

@_scenario
def test_4_cart_immediate_peak_slot_charges_peak():
    """Корзина: сегодня 20:00 (сразу) и через 5 дней 20:00 (заранее), Профи+.
    Было: немедленный слот снимал час, но не пик (0 ₾), отмена «возвращала» 5 ₾.
    Стало: −5 ₾ сразу; второй — крон −5 ₾; отмена каждой — ровно назад."""
    from app.api.v1.bookings import routes
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("PRO_PLUS"), balance=300.0)
    out = routes.create_multi_slot_booking(session=s, current_user=admin, data=routes.MultiSlotRequest(
        slots=[routes.MultiSlotItem(resource_id="room_1", location_id="unbox_uni",
                                    date=H._day(0).strftime("%Y-%m-%d"), start_time="20:00"),
               routes.MultiSlotItem(resource_id="room_2", location_id="unbox_uni",
                                    date=H._day(5).strftime("%Y-%m-%d"), start_time="20:00")],
        payment_method="subscription", target_user_id=str(u.id)))
    s.commit()
    now_b, far_b = [s.get(Booking, b.id) for b in out["bookings"]]
    assert (now_b.payment_status, far_b.payment_status) == ("paid", "pending")
    assert (_bal(s, u), _rem(s, u)) == (295.0, 41.0), f"корзина: {_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 295 / 41"
    assert _booking_net(s, now_b) == -5.0
    billing_defer.settle_pending_charge(s, far_b)
    s.commit()
    assert (_bal(s, u), _rem(s, u)) == (290.0, 40.0)
    _cancel(s, admin, now_b)
    _cancel(s, admin, s.get(Booking, far_b.id))
    assert (_bal(s, u), _rem(s, u)) == (300.0, 42.0), f"отмена корзины: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _ledger_ok(s, u, 300.0)


@_scenario
def test_4_series_immediate_peak_occurrence_charges_peak():
    """Серия по понедельникам 20:00 ×3, первая — сегодня (сразу). Было: первая
    снимала час без пика. Стало: −5 ₾ −1 ч сразу, остальные ждут крона. Отмена
    серии (админ, 100 %) — ровно назад."""
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("PRO_PLUS"), balance=300.0)
    out = routes.create_recurring_booking(
        background_tasks=BackgroundTasks(), session=s, current_user=admin,
        data=routes.RecurringBookingRequest(
            resource_id="room_1", location_id="unbox_uni", start_time="20:00", duration=60, format="individual",
            payment_method="subscription", first_date=H._day(0).strftime("%Y-%m-%d"), occurrences=3,
            target_user_id=str(u.id)))
    s.commit()
    rows = s.exec(select(Booking).where(Booking.user_uuid == u.id).order_by(Booking.date)).all()
    assert [b.payment_status for b in rows] == ["paid", "pending", "pending"]
    assert (_bal(s, u), _rem(s, u)) == (295.0, 41.0), f"серия: {_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 295 / 41"
    routes.cancel_recurring_bookings(group_id=out["recurring_group_id"], from_booking_id=str(rows[0].id),
                                     refund_percent=1.0, reason=None, session=s, current_user=admin)
    s.commit()
    assert (_bal(s, u), _rem(s, u)) == (300.0, 42.0), f"отмена серии: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _ledger_ok(s, u, 300.0)


# ═════════════════════════════════════════════════════════════════════════
# 5. Продление брони по абонементу снимает часы за добавку
# ═════════════════════════════════════════════════════════════════════════

def _extend(s, actor, b, minutes=30):
    from app.api.v1.bookings import routes
    out = H._call(routes.extend_booking, booking_id=str(b.id),
                  payload=routes.ExtendRequest(extra_minutes=minutes), session=s, current_user=actor)
    assert not (isinstance(out, dict) and "http" in out), out
    s.commit()
    return s.get(Booking, b.id)


@_scenario
def test_5_extend_paid_subscription_booking_takes_hours():
    """14:00–15:00 по абонементу (списано сразу), +30 мин. Было: часы за
    добавку не снимались (9 ч), отмена возвращала 1 ч. Стало: 8,5 ч,
    hours_deducted 1,5; отмена → 10 ч."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, start="14:00")
    b = _extend(s, admin, b, 30)
    assert (b.duration, float(b.hours_deducted)) == (90, 1.5), (b.duration, b.hours_deducted)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 8.5), f"после +30 мин: {_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 100 / 8.5"
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), f"отмена: {_bal(s, u)} ₾ / {_rem(s, u)} ч"


@_scenario
def test_5_extend_into_peak_takes_hours_and_peak_money():
    """19:00–20:00, +1 ч (20:00–21:00 — пик): −1 ч и −5 ₾ пика; цена брони 5 ₾.
    Было: доплата считалась пропорцией от цены 0 ₾ → 0, часы не снимались."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, start="19:00")
    b = _extend(s, admin, b, 60)
    assert (b.duration, float(b.hours_deducted), float(b.final_price)) == (120, 2.0, 5.0), \
        (b.duration, b.hours_deducted, b.final_price)
    assert (_bal(s, u), _rem(s, u)) == (95.0, 8.0), f"{_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 95 / 8"
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_5_extend_without_hours_charges_money_like_cron():
    """Остался 1 ч: бронь 14:00–15:00 его забирает, +30 мин часов нет → добавка
    деньгами по движку: 30 мин × 20 ₾/ч − 10 % тарифа = 9 ₾; часы брони 1 ч.
    Отмена: +1 ч и +9 ₾."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=1.0, used_hours=9.0))
    b = _book(s, admin, u, start="14:00")
    assert _rem(s, u) == 0.0
    b = _extend(s, admin, b, 30)
    assert (float(b.hours_deducted), float(b.final_price)) == (1.0, 9.0), (b.hours_deducted, b.final_price)
    assert (_bal(s, u), _rem(s, u)) == (91.0, 0.0), f"{_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 91 / 0"
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 1.0), f"отмена: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _ledger_ok(s, u, 100.0)


@_scenario
def test_5_extend_pending_subscription_booking_hours_once_by_cron():
    """Бронь заранее (через 3 дня, pending) +30 мин: сейчас ничего не снято,
    hours_deducted 1,5; крон снимает 1,5 ч ОДИН раз. Отмена — назад."""
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, days=3, start="14:00")
    b = _extend(s, admin, b, 30)
    assert (b.payment_status, float(b.hours_deducted)) == ("pending", 1.5)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), "продление pending-брони списало сразу"
    billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    s.commit()
    assert (_bal(s, u), _rem(s, u)) == (100.0, 8.5), f"крон: {_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 8.5 ч"
    ok, _ = billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    assert not ok, "крон списал второй раз"
    _cancel(s, admin, s.get(Booking, b.id))
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)


@_scenario
def test_5_extend_money_row_charges_money():
    """Бронь, ушедшая в деньги (часов не хватило при одобрении, hours_deducted=0):
    продление — тоже деньгами, charge_amount растёт → отмена вернёт всё."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=0.0, used_hours=10.0))
    b = Booking(resource_id="room_1", location_id="unbox_uni", date=H._day(0), start_time="14:00", duration=60,
                final_price=0.0, payment_method="subscription", payment_status="paid", status="confirmed",
                hours_deducted=0.0, charge_amount=18.0, user_id=u.email, user_uuid=u.id, format="individual")
    s.add(b)
    s.commit()
    b = _extend(s, admin, b, 30)
    assert round(float(b.charge_amount), 2) == 27.0, f"charge_amount {b.charge_amount}, ждём 18 + 9"
    assert _bal(s, u) == 91.0
    _cancel(s, admin, b)
    assert _bal(s, u) == 118.0, f"отмена вернула {_bal(s, u) - 91.0}, ждём 27 (18 взяли до теста + 9)"


@_scenario
def test_5_series_extension_dates_charged_once_by_cron():
    """Продление серии по абонементу: новые даты — pending, крон снимает часы и
    пик ровно один раз, отмена возвращает ровно взятое."""
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("PRO_PLUS"), balance=300.0)
    out = routes.create_recurring_booking(
        background_tasks=BackgroundTasks(), session=s, current_user=admin,
        data=routes.RecurringBookingRequest(
            resource_id="room_1", location_id="unbox_uni", start_time="20:00", duration=60, format="individual",
            payment_method="subscription", first_date=H._day(2).strftime("%Y-%m-%d"), occurrences=2,
            target_user_id=str(u.id)))
    s.commit()
    gid = out["recurring_group_id"]
    routes.extend_recurring_series(group_id=gid, payload={"add_occurrences": 1}, session=s, current_user=admin)
    s.commit()
    rows = s.exec(select(Booking).where(Booking.recurring_group_id == gid).order_by(Booking.date)).all()
    assert [b.payment_status for b in rows] == ["pending"] * 3
    assert (_bal(s, u), _rem(s, u)) == (300.0, 42.0)
    new = rows[-1]
    assert (float(new.final_price), float(new.hours_deducted)) == (5.0, 1.0)
    billing_defer.settle_pending_charge(s, s.get(Booking, new.id))
    s.commit()
    assert (_bal(s, u), _rem(s, u)) == (295.0, 41.0)
    _cancel(s, admin, s.get(Booking, new.id))
    assert (_bal(s, u), _rem(s, u)) == (300.0, 42.0)


# ═════════════════════════════════════════════════════════════════════════
# 6. Допы остаются в цене денежной брони при «часах подряд» и переносе
# ═════════════════════════════════════════════════════════════════════════

@_scenario
def test_6_balance_booking_with_sandbox_stays_25_after_create():
    """Денежная бронь 14:00 + песочница: 20 + 5 = 25 ₾. Было: пересчёт «часов
    подряд» сразу после создания делал 20 ₾ и возвращал 5 ₾ (песочница бесплатно).
    Стало: 25 ₾, в ленте одно списание −25."""
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", method="balance", extras=["sandbox"])
    assert float(b.final_price) == 25.0, f"цена {b.final_price}, ждём 25"
    assert _bal(s, u) == 75.0, f"баланс {_bal(s, u)}, ждём 75"
    far = _book(s, admin, u, days=3, start="14:00", method="balance", extras=["sandbox"])
    assert (far.payment_status, float(far.final_price)) == ("pending", 25.0), (far.payment_status, far.final_price)
    _cancel(s, admin, b)
    assert _bal(s, u) == 100.0
    _ledger_ok(s, u, 100.0)


@_scenario
def test_6_chain_of_two_hours_keeps_sandbox_on_top_of_discount():
    """Два денежных часа подряд 14:00 (+песочница) и 15:00: цепочка 2 ч → −10 %
    на аренду: 18 + 5 = 23 ₾ и 18 ₾, итого 41 ₾ (было 36 ₾ — песочница пропадала)."""
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    a = _book(s, admin, u, start="14:00", method="balance", extras=["sandbox"])
    b = _book(s, admin, u, start="15:00", method="balance")
    s.expire_all()
    a, b = s.get(Booking, a.id), s.get(Booking, b.id)
    assert (float(a.final_price), float(b.final_price)) == (23.0, 18.0), (a.final_price, b.final_price)
    assert _bal(s, u) == 59.0, f"баланс {_bal(s, u)}, ждём 100 − 41 = 59"
    _cancel(s, admin, b)
    s.expire_all()
    assert float(s.get(Booking, a.id).final_price) == 25.0, "цепочка распалась — 20 + 5"
    assert _bal(s, u) == 75.0, f"после отмены второго часа {_bal(s, u)}, ждём 75"
    _ledger_ok(s, u, 100.0)


def _reschedule(s, actor, b, *, start, resource=None, days=0):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    out = H._call(routes.reschedule_booking, booking_id=str(b.id),
                  data=routes.RescheduleRequest(new_date=H._day(days).strftime("%Y-%m-%d"), new_start_time=start,
                                                new_resource_id=resource),
                  background_tasks=BackgroundTasks(), session=s, current_user=actor)
    assert not (isinstance(out, dict) and "http" in out), out
    s.commit()
    return s.get(Booking, b.id)


@_scenario
def test_6_reschedule_keeps_sandbox_in_price():
    """Перенос 14:00 → 15:00 в том же кабинете: цена 25 ₾, денег не двигаем.
    Было: 20 ₾ и возврат 5 ₾."""
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", method="balance", extras=["sandbox"])
    b = _reschedule(s, admin, b, start="15:00")
    assert (float(b.final_price), b.extras) == (25.0, ["sandbox"]), (b.final_price, b.extras)
    assert _bal(s, u) == 75.0
    b = _reschedule(s, admin, b, start="16:00", resource="room_3")  # в кабинете 3 песочница есть
    assert (float(b.final_price), b.extras) == (25.0, ["sandbox"]), (b.final_price, b.extras)
    assert _bal(s, u) == 75.0
    _cancel(s, admin, b)
    assert _bal(s, u) == 100.0
    _ledger_ok(s, u, 100.0)


@_scenario
def test_6_reschedule_to_room_without_sandbox_refunds_it_once():
    """Перенос в кабинет без песочницы: доп снимается и возвращается ОДИН раз:
    цена 20 ₾, возврат 5 ₾. Было: 15 ₾ и возврат 10 ₾ (дважды)."""
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", method="balance", extras=["sandbox"])
    b = _reschedule(s, admin, b, start="14:00", resource="room_2")
    assert (float(b.final_price), b.extras) == (20.0, []), (b.final_price, b.extras)
    assert _bal(s, u) == 80.0, f"баланс {_bal(s, u)}, ждём 80 (возврат 5 один раз)"
    _cancel(s, admin, b)
    assert _bal(s, u) == 100.0
    _ledger_ok(s, u, 100.0)


@_scenario
def test_6_reschedule_subscription_booking_dropping_sandbox_refunds_money_part():
    """Бронь по абонементу 14:00 + песочница (денежная часть 5 ₾ снята сразу) →
    перенос в кабинет без песочницы: доп снят, 5 ₾ назад, цена 0 ₾; отмена
    возвращает только час."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, start="14:00", extras=["sandbox"])
    assert _bal(s, u) == 95.0
    b = _reschedule(s, admin, b, start="14:00", resource="room_2")
    assert (float(b.final_price), b.extras) == (0.0, []), (b.final_price, b.extras)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 9.0)
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_6_cash_paid_extras_are_not_charged_by_recompute():
    """Допы, оплаченные наличными (/add-extras cash), записаны в брони, но в цену
    не входят — пересчёт «часов подряд» не должен списать их ещё раз с баланса."""
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    a = _book(s, admin, u, start="14:00", method="balance")
    routes.add_booking_extras(booking_id=str(a.id), payload=routes.AddExtrasRequest(extras=["coffee_meama"],
                              payment_method="cash"), session=s, current_user=admin)
    s.commit()
    b = _book(s, admin, u, start="15:00", method="balance")
    s.expire_all()
    a, b = s.get(Booking, a.id), s.get(Booking, b.id)
    assert (float(a.final_price), float(b.final_price)) == (18.0, 18.0), (a.final_price, b.final_price)
    assert _bal(s, u) == 64.0
    _ledger_ok(s, u, 100.0)


@_scenario
def test_6_weekly_rebate_does_not_double_subtract_extras():
    """Недельная скидка вычитает допы из уплаченного. Если пересчёт «часов
    подряд» снимал допы из цены, они вычитались дважды и клиент недополучал
    скидку. 5 денежных часов прошлой недели (по одному в день, один с
    песочницей 25 ₾) → тир 10 %: по 2 ₾ с часа = 10 ₾, песочница не мешает."""
    from app.services.consecutive_pricing import recompute_user_chains_for_day
    from app.services.weekly_rebate import run_weekly_rebates
    s = _db()
    u = _client(s, None)
    monday = H._day(-7)  # пн 28.09
    for i in range(5):
        price = 25.0 if i == 0 else 20.0
        s.add(Booking(resource_id="room_1", location_id="unbox_uni", date=monday + timedelta(days=i),
                      start_time="14:00", duration=60, final_price=price, base_price=20.0, discount_amount=0.0,
                      applied_rule="NONE", payment_method="balance", payment_status="paid", status="confirmed",
                      charge_amount=price, extras=(["sandbox"] if i == 0 else []), user_id=u.email,
                      user_uuid=u.id, format="individual"))
    s.commit()
    recompute_user_chains_for_day(s, s.get(User, u.id), "room_1", monday, reason="test")
    s.commit()
    first = s.exec(select(Booking).where(Booking.user_uuid == u.id).order_by(Booking.date)).first()
    assert float(first.final_price) == 25.0, f"пересчёт снял песочницу: {first.final_price}"
    res = run_weekly_rebates(s, date(2026, 9, 28), dry_run=True)
    got = round(sum(float(d["rebate"]) for d in res["details"] if d["user_id"] == str(u.id)), 2)
    assert got == 10.0, f"недельная скидка {got} ₾, ждём 10 ₾ (5 ч × 2 ₾)"


# ═════════════════════════════════════════════════════════════════════════
# 7. Отклонение горячей брони — одно поведение на сайте и в Telegram
# ═════════════════════════════════════════════════════════════════════════

def _tg_reject(s, b, reason="Занято"):
    from app.api.v1 import telegram as tg
    msg = {
        "text": reason,
        "from": {"id": 555},
        "chat": {"id": 1},
        "reply_to_message": {
            "text": f"❌ Отклонение брони {b.id}\n{tg.REJECT_PROMPT_MARKER}:{b.id}",
            "from": {"is_bot": True},
            "date": int(H.FakeDatetime.utcnow().replace(tzinfo=None).timestamp()),
        },
    }
    assert tg._handle_reject_reason_reply(s, msg) is True
    s.commit()


@_scenario
def test_7_telegram_reject_returns_bonus_hour():
    """Бонусная горячая бронь (бонус 1 ч тратится при создании). Отклонение в
    Telegram: бронь отменена, бонусный час вернулся. Было: час пропадал."""
    s = _db()
    admin = _admin(s)
    admin.telegram_id = "555"
    s.add(admin)
    s.commit()
    u = _client(s, None)
    _bonus(s, u, 1.0)
    b = _book(s, u, u, start="16:00", method="balance")
    assert (b.status, b.payment_method) == ("pending_approval", "bonus"), (b.status, b.payment_method)
    assert _free_hours(s, u) == 0.0
    _tg_reject(s, b)
    s.expire_all()
    assert s.get(Booking, b.id).status == "cancelled"
    assert _free_hours(s, u) == 1.0, f"бонусный час не вернулся: {_free_hours(s, u)}"
    assert _bal(s, u) == 100.0


@_scenario
def test_7_site_reject_same_behavior():
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    _bonus(s, u, 1.0)
    b = _book(s, u, u, start="16:00", method="balance")
    routes.reject_booking(booking_id=str(b.id), payload=None, session=s, current_user=admin)
    s.commit()
    assert _free_hours(s, u) == 1.0 and _bal(s, u) == 100.0


def test_7_both_rejects_use_one_helper():
    routes = _read("backend/app/api/v1/bookings/routes.py")
    tg = _read("backend/app/api/v1/telegram.py")
    assert "def release_rejected_hot_booking(" in routes, "нет общего помощника отклонения"
    assert "release_rejected_hot_booking(" in _body(routes, "def reject_booking(")
    assert "release_rejected_hot_booking(" in _body(tg, "def _handle_reject_reason_reply(", "\ndef ")


# ═════════════════════════════════════════════════════════════════════════
# 8. Личная скидка / тип цен / личная ставка — только с правом set_discount
# ═════════════════════════════════════════════════════════════════════════

def _patch_user(s, actor, target, **fields):
    from fastapi import HTTPException
    from app.api.v1.users import admin as users_admin
    from app.models.user import UserUpdateAdmin
    try:
        users_admin.update_user(user_id=str(target.id), session=s, user_in=UserUpdateAdmin(**fields),
                                current_user=actor)
        s.commit()
        return 200
    except HTTPException as e:
        s.rollback()
        return e.status_code, e.detail


@_scenario
def test_8_plain_admin_cannot_change_discount_type_or_rate():
    s = _db()
    admin = _admin(s, role="admin")
    u = _client(s, None)
    u.crm_data = {"note": "x", "personal_hourly_rate": 20}
    s.add(u)
    s.commit()
    for fields in ({"personal_discount_percent": 25}, {"pricing_system": "personal"},
                   {"crm_data": {"note": "x", "personal_hourly_rate": 15}},
                   {"crm_data": {"note": "x"}}):
        res = _patch_user(s, admin, u, **fields)
        assert isinstance(res, tuple) and res[0] == 403, f"{fields}: обычный админ прошёл ({res})"
        assert "старш" in str(res[1]).lower() or "владел" in str(res[1]).lower(), res
    s.expire_all()
    uu = s.get(User, u.id)
    assert (uu.personal_discount_percent, uu.pricing_system, uu.crm_data.get("personal_hourly_rate")) == \
        (0, "standard", 20)
    # Без изменения цен — можно (теги, та же ставка, те же значения).
    assert _patch_user(s, admin, u, tags=["vip"]) == 200
    assert _patch_user(s, admin, u, crm_data={"note": "y", "personal_hourly_rate": 20}) == 200
    assert _patch_user(s, admin, u, personal_discount_percent=0, pricing_system="standard") == 200


@_scenario
def test_8_senior_changes_discount_with_history():
    s = _db()
    senior = _admin(s, role="senior_admin")
    u = _client(s, None)
    assert _patch_user(s, senior, u, pricing_system="personal", personal_discount_percent=25) == 200
    s.expire_all()
    uu = s.get(User, u.id)
    assert (uu.pricing_system, uu.personal_discount_percent) == ("personal", 25)
    hist = uu.discount_history or []
    assert hist and (hist[0]["oldValue"], hist[0]["newValue"]) == (0, 25), hist
    assert hist[0]["adminName"] == senior.name and hist[0].get("reason"), hist[0]
    from app.models.timeline import TimelineEvent
    ev = s.exec(select(TimelineEvent).where(TimelineEvent.target_id == str(u.id),
                                            TimelineEvent.event_type == "discount_change")).all()
    assert ev, "нет события discount_change"
    assert _patch_user(s, senior, u, crm_data={"personal_hourly_rate": 15}) == 200
    s.expire_all()
    assert len(s.get(User, u.id).discount_history) == 2, "смена личной ставки не попала в историю"


def test_8_frontend_hides_discount_fields_without_right():
    users = _read("src/pages/admin/Users.tsx")
    body = users[users.index("function UserEditModal("):]
    assert "hasPermission(currentUser, 'subscriptions.set_discount')" in body, "модалка не проверяет право"
    assert "canSetDiscount &&" in body or "disabled={!canSetDiscount}" in body, "поля скидки активны без права"
    assert "if (canSetDiscount" in body, "без права модалка всё равно шлёт скидку/тип цен"
    card = _read("src/components/admin/UserLoyaltyCard.tsx")
    assert "hasPermission(currentUser, 'subscriptions.set_discount')" in card, "карандаш скидки в карточке без права"


# ═════════════════════════════════════════════════════════════════════════
# 9. Текст клиенту при одобрении бонусной брони
# ═════════════════════════════════════════════════════════════════════════

@_scenario
def test_9_bonus_approval_message():
    """Бонус покрывает бронь целиком → «Оплачено бонусными часами.»; бонус 1 ч
    на бронь 2 ч (без абонемента) → «…, остаток списан с баланса»."""
    s = _db()
    admin = _admin(s)
    u = _client(s, None, tg="777")
    _bonus(s, u, 1.0)
    full = _book(s, u, u, start="16:00", method="balance")
    assert full.payment_method == "bonus" and float(full.final_price) == 0.0
    _approve(s, admin, full)
    assert _bal(s, u) == 100.0 and _free_hours(s, u) == 0.0
    _bonus(s, u, 1.0)
    part = _book(s, u, u, start="18:00", minutes=120, method="balance")
    assert part.payment_method == "bonus" and float(part.final_price) > 0, (part.payment_method, part.final_price)
    _approve(s, admin, part)
    assert _bal(s, u) == round(100.0 - float(part.final_price), 2)


def test_9_approval_text_helper():
    from app.api.v1.bookings import routes
    B = Booking
    sub = B(resource_id="room_1", date=_dt(2026, 10, 5), start_time="20:00", duration=60, final_price=5.0,
            payment_method="subscription", hours_deducted=1.0)
    assert routes.hot_approval_paid_line(sub, {"money": 5.0}) == \
        "Списаны часы абонемента, доплата 5 ₾ (пик/допы) — с баланса."
    sub0 = B(resource_id="room_1", date=_dt(2026, 10, 5), start_time="16:00", duration=60, final_price=0.0,
             payment_method="subscription", hours_deducted=1.0)
    assert routes.hot_approval_paid_line(sub0, {"money": 0.0}) == "Списаны часы абонемента."
    assert routes.hot_approval_paid_line(sub0, {"money": 18.0, "fallback": True}) == \
        "Часов абонемента не хватило — бронь оплачена с баланса: 18 ₾."
    bon = B(resource_id="room_1", date=_dt(2026, 10, 5), start_time="16:00", duration=60, final_price=0.0,
            payment_method="bonus", hours_deducted=1.0)
    assert routes.hot_approval_paid_line(bon, {"money": 0.0}) == "Оплачено бонусными часами."
    bon2 = B(resource_id="room_1", date=_dt(2026, 10, 5), start_time="16:00", duration=120, final_price=20.0,
             payment_method="bonus", hours_deducted=1.0)
    assert routes.hot_approval_paid_line(bon2, {"money": 20.0}) == \
        "Оплачено бонусными часами, остаток списан с баланса."
    bal = B(resource_id="room_1", date=_dt(2026, 10, 5), start_time="16:00", duration=60, final_price=20.0,
            payment_method="balance")
    assert routes.hot_approval_paid_line(bal, {"money": 20.0}) == "Деньги списаны с баланса."


@_scenario
def test_9_client_gets_bonus_text_on_site_and_telegram_approve():
    from app.api.v1 import telegram as tg
    s = _db()
    admin = _admin(s)
    admin.telegram_id = "555"
    s.add(admin)
    s.commit()
    u = _client(s, None, tg="777")
    with _Offline() as off:
        _bonus(s, u, 2.0)
        a = _book(s, u, u, start="16:00", method="balance")
        b = _book(s, u, u, start="18:00", method="balance")
        _approve(s, admin, a)
        tg._handle_hot_booking_callback(s, "cb", 1, 2, 555, f"ba:{b.id}")
        s.commit()
        texts = [t for chat, t in off.sent if chat == "777" and "подтверждена" in t]
    assert len(texts) == 2, off.sent
    for t in texts:
        assert "Оплачено бонусными часами." in t and "Деньги списаны с баланса" not in t, t


# ═════════════════════════════════════════════════════════════════════════
# Единое правило денег и старые брони
# ═════════════════════════════════════════════════════════════════════════

def _legacy(s, u, **over):
    row = dict(resource_id="room_1", location_id="unbox_uni", date=H._day(3), start_time="20:00", duration=120,
               final_price=5.0, payment_method="subscription", payment_status="paid", status="confirmed",
               hours_deducted=2.0, user_id=u.email, user_uuid=u.id, format="individual")
    row.update(over)
    b = Booking(**row)
    s.add(b)
    s.commit()
    return b


@_scenario
def test_rule_legacy_rows_refund_unchanged():
    """Старые брони не меняют возврат: у брони с часами деньги = final_price,
    charge_amount (часы от крона или ₾ от старого немедленного пути) для денег не
    читается — ни 2 «часа» не превращаются в 2 ₾, ни наоборот. У брони, ушедшей
    в деньги (hours_deducted=0), возврат = charge_amount."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("PRO_PLUS"), balance=0.0)
    cron_row = _legacy(s, u, charge_amount=2.0)          # крон: в charge_amount часы
    old_now_row = _legacy(s, u, charge_amount=5.0)       # старый немедленный путь: ₾
    money_row = _legacy(s, u, hours_deducted=0.0, charge_amount=20.0, final_price=5.0)
    rem0 = _rem(s, u)
    _cancel(s, admin, cron_row)
    assert (_bal(s, u), _rem(s, u)) == (5.0, rem0 + 2.0), (_bal(s, u), _rem(s, u))
    _cancel(s, admin, old_now_row)
    assert (_bal(s, u), _rem(s, u)) == (10.0, rem0 + 4.0)
    _cancel(s, admin, money_row)
    assert (_bal(s, u), _rem(s, u)) == (30.0, rem0 + 4.0), "бронь деньгами вернула не charge_amount"


@_scenario
def test_rule_waive_and_rerent_follow_same_rule():
    """Снятие штрафа и 50 % при переаренде — тем же правилом: часы + final_price."""
    from app.services.billing_defer import waive_charge
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("PRO_PLUS"), balance=0.0)
    b = _legacy(s, u, charge_amount=2.0, final_price=10.0)
    rem0 = _rem(s, u)
    ok, status = waive_charge(s, s.get(Booking, b.id), reason="тест", by_user=admin)
    s.commit()
    assert ok and (_bal(s, u), _rem(s, u)) == (10.0, rem0 + 2.0), (status, _bal(s, u), _rem(s, u))


def test_rule_helper_documented_and_used():
    bd = _read("backend/app/services/billing_defer.py")
    assert "def subscription_money_taken(" in bd and "def subscription_cash_price(" in bd
    routes = _read("backend/app/api/v1/bookings/routes.py")
    refund = _body(routes, "def _refund_booking_to_owner(", "\ndef ")
    assert "subscription_money_taken(" in refund, "возврат считает деньги мимо единого правила"
    waive = _body(bd, "def waive_charge(", "\ndef ")
    assert "subscription_money_taken(" in waive, "waive считает деньги мимо единого правила"
    settle = _body(bd, "def settle_pending_charge(", "\ndef ")
    assert "subscription_cash_price(" in settle, "крон считает запасной путь мимо общей функции"
    core = _body(routes, "def charge_hot_booking_on_approval(", "\ndef ")
    assert "subscription_cash_price(" in core and "subscription_pool.is_active(" in core \
        and "subscription_pool.plan_split(" in core, "одобрение не перепроверяет часы как крон"
    assert "charge_hot_booking_on_approval(" in _body(routes, "def approve_booking(")
    tg = _read("backend/app/api/v1/telegram.py")
    assert "charge_hot_booking_on_approval(" in _body(tg, "def _handle_hot_booking_callback(", "\ndef "), \
        "Telegram-одобрение списывает своей логикой"
    for fn in ("def create_booking(", "def create_multi_slot_booking(", "def create_recurring_booking("):
        assert "subscription_money_due(" in _body(routes, fn), f"{fn}: денежная часть брони по абонементу не списывается"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  ✗ {name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("OK" if not failures else f"УПАЛО: {failures}")
    sys.exit(1 if failures else 0)
