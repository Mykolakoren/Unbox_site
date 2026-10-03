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
Попутно (иначе правило «отмена возвращает ровно взятое» ломалось бы на соседних
правках): смена формата тоже сохраняет допы в цене; сокращение брони по
абонементу возвращает и денежную часть той же долей; перенос брони, ушедшей в
деньги, не возвращает снятый доп дважды.

Ревизия №2 (два ревизора, 03.10 вечер) — тесты test_r2_* / test_rA…E / сетка пика:
  r2_1 сокращение возвращает часы отдельно от денег (пик — точно по времени);
  r2_2 бронь по абонементу, ушедшая в деньги: сократить/вырезать/сменить
       формат/«Цена» — 409, отмена возвращает ровно charge_amount;
  r2_3 «Цена» у брони по абонементу двигает деньги (пик/допы), часы не трогает;
  r2_4 перенос (и серия «эту и следующие») пересчитывает денежную часть;
  r2_5 снятие штрафа после отмены возвращает только остаток;
  r2_6 вырезка и «На абонемент» сохраняют допы, продление серии их не копирует,
       продление waived-брони — 409, уведомление о пике — только при списании;
  A продление pending сверх часов — добавка деньгами; B бот пересчитывает «часы
  подряд»; C «Цена»/«Час в подарок» не съедают допы; E скидка 0–100 % в PATCH.

Без сети и боевой базы: SQLite в памяти, время заморожено (пн 05.10.2026,
10:00 по Тбилиси), Telegram и Google подменены.

    python3 backend/tests/guard_money_holes_2026_10.py
"""
import functools
import os
import sys
from datetime import date, datetime as _dt, timedelta

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
    from app.services import billing_defer
    ok, _ = billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    assert not ok and (_bal(s, u), _rem(s, u)) == (90.0, 9.0), "крон списал второй раз после одобрения в Telegram"
    _cancel(s, admin, s.get(Booking, b.id))
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
    # id — объектом UUID: на SQLite session.get(Booking, str) падает (на Postgres
    # строка адаптируется сама — так её шлёт FastAPI в бою).
    routes.cancel_recurring_bookings(group_id=out["recurring_group_id"], from_booking_id=rows[0].id,
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
def test_6_dropped_sandbox_on_money_subscription_row_not_refunded_twice():
    """Бронь по абонементу ушла в деньги при одобрении (пауза): 20 + песочница 5 =
    25 ₾. Перенос в кабинет без песочницы: +5 ₾ сейчас, charge_amount 20 →
    отмена +20 ₾. Итого клиент при своих — песочница не вернулась дважды."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, u, u, start="16:00", extras=["sandbox"])
    uu = s.get(User, u.id)
    uu.subscription = P.update(uu.subscription, is_frozen=True, frozen_at=H.FakeDatetime.utcnow().isoformat())
    s.add(uu)
    s.commit()
    b = _approve(s, admin, b)
    assert (_bal(s, u), round(float(b.charge_amount), 2)) == (75.0, 25.0)
    b = _reschedule(s, admin, b, start="16:00", resource="room_2")
    assert (b.extras, round(float(b.charge_amount), 2), _bal(s, u)) == ([], 20.0, 80.0), \
        (b.extras, b.charge_amount, _bal(s, u))
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), f"отмена: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _ledger_ok(s, u, 100.0)


@_scenario
def test_6_format_change_keeps_sandbox_in_price():
    """Смена формата (индивидуальный → групповой) не выкидывает допы из цены.
    Денежная бронь 20 + 5 = 25 ₾ → группа 35 + 5 = 40 ₾ (доплата 15, а не 10 с
    потерей песочницы). По абонементу Профи+: денежная часть 5 ₾ (песочница) снята
    при создании — после смены формата цена брони так и 5 ₾, и отмена их вернёт
    (раньше цена становилась 0 ₾, и клиент терял 5 ₾)."""
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", method="balance", extras=["sandbox"])
    routes.change_booking_format(booking_id=str(b.id), payload=routes.ChangeFormatRequest(new_format="group"),
                                 session=s, current_user=admin)
    s.commit()
    b = s.get(Booking, b.id)
    assert (float(b.final_price), _bal(s, u)) == (40.0, 60.0), (b.final_price, _bal(s, u))
    _cancel(s, admin, b)
    assert _bal(s, u) == 100.0

    v = _client(s, _sub("PRO_PLUS"))
    c = _book(s, admin, v, start="16:00", extras=["sandbox"])
    assert (_bal(s, v), _rem(s, v)) == (95.0, 41.0)
    routes.change_booking_format(booking_id=str(c.id), payload=routes.ChangeFormatRequest(new_format="group"),
                                 session=s, current_user=admin)
    s.commit()
    c = s.get(Booking, c.id)
    assert (float(c.final_price), _bal(s, v), _rem(s, v)) == (5.0, 95.0, 41.0), (c.final_price, _bal(s, v), _rem(s, v))
    _cancel(s, admin, c)
    assert (_bal(s, v), _rem(s, v)) == (100.0, 42.0), f"отмена: {_bal(s, v)} ₾ / {_rem(s, v)} ч"
    _ledger_ok(s, v, 100.0)


@_scenario
def test_shorten_subscription_peak_booking_returns_money_part():
    """По абонементу 20:00–22:00: −2 ч и −10 ₾ пика. Сокращение на 1 ч: +1 ч и
    +5 ₾ (цена брони 5 ₾); отмена — остальное. Было: при сокращении деньги не
    возвращались — клиент терял 5 ₾."""
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, start="20:00", minutes=120)
    assert (_bal(s, u), _rem(s, u), float(b.final_price)) == (90.0, 8.0, 10.0)
    routes.shorten_booking(booking_id=str(b.id), payload=routes.ShortenRequest(remove_minutes=60),
                           session=s, current_user=admin)
    s.commit()
    b = s.get(Booking, b.id)
    assert (float(b.final_price), _bal(s, u), _rem(s, u)) == (5.0, 95.0, 9.0), (b.final_price, _bal(s, u), _rem(s, u))
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


# ═════════════════════════════════════════════════════════════════════════
# Ревизия денег №2 (ревизор, 03.10 вечер): соседние дыры
# ═════════════════════════════════════════════════════════════════════════

def _shorten(s, actor, b, minutes=60, side="end"):
    from app.api.v1.bookings import routes
    out = H._call(routes.shorten_booking, booking_id=str(b.id),
                  payload=routes.ShortenRequest(remove_minutes=minutes, side=side), session=s, current_user=actor)
    s.commit()
    return out


def _trim(s, actor, b, remove_from, remove_to):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    out = H._call(routes.trim_booking, booking_id=str(b.id),
                  data=routes.TrimRequest(remove_from=remove_from, remove_to=remove_to),
                  background_tasks=BackgroundTasks(), session=s, current_user=actor)
    s.commit()
    return out


def _money_row(s, admin, u, *, minutes=120, extras=None):
    """Бронь по абонементу, ушедшая в деньги: заранее (через 3 дня), а к кронy
    T-24ч часы съела другая бронь → крон списал деньги, hours_deducted = 0."""
    from app.services import billing_defer
    b = _book(s, admin, u, days=3, start="14:00", minutes=minutes, extras=extras)
    _book(s, admin, u, days=0, start="14:00", minutes=120, resource="room_2")
    ok, _ = billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    s.commit()
    assert ok
    b = s.get(Booking, b.id)
    assert (b.payment_method, b.payment_status, float(b.hours_deducted or 0)) == ("subscription", "paid", 0.0)
    return b


@_scenario
def test_r2_1_shorten_subscription_without_peak_returns_hours():
    """S2: Тёплый, бронь 2 ч без пика и допов (10 → 8 ч). Сокращение на 1 ч → 9 ч,
    отмена → 10 ч. Было: часы возвращались только вместе с деньгами — тут денег
    0, и час пропадал (8 → 8, после отмены 9)."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, start="14:00", minutes=120)
    assert _rem(s, u) == 8.0
    assert not isinstance(_shorten(s, admin, b), dict)
    b = s.get(Booking, b.id)
    assert (b.duration, float(b.hours_deducted), _rem(s, u), _bal(s, u)) == (60, 1.0, 9.0, 100.0), \
        (b.duration, b.hours_deducted, _rem(s, u), _bal(s, u))
    _cancel(s, admin, b)
    assert (_rem(s, u), _used(s, u), _bal(s, u)) == (10.0, 0.0, 100.0)


@_scenario
def test_r2_1_shorten_subscription_peak_exact_by_side():
    """19:00–21:00 по абонементу: пик 20–21 → денежная часть 5 ₾. Сокращение с
    конца отрезает пиковый час → назад 5 ₾ и 1 ч; с начала — непиковый 19–20 →
    денег назад 0, только час (пропорция давала по 2,5 ₾ в обе стороны)."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("PRO_PLUS"))
    a = _book(s, admin, u, start="19:00", minutes=120)
    b = _book(s, admin, u, start="19:00", minutes=120, resource="room_2")
    assert (_bal(s, u), _rem(s, u)) == (90.0, 38.0)
    _shorten(s, admin, a, side="end")
    _shorten(s, admin, b, side="start")
    a, b = s.get(Booking, a.id), s.get(Booking, b.id)
    assert (float(a.final_price), float(b.final_price), b.start_time) == (0.0, 5.0, "20:00"), \
        (a.final_price, b.final_price, b.start_time)
    assert (_bal(s, u), _rem(s, u)) == (95.0, 40.0), (_bal(s, u), _rem(s, u))
    _cancel(s, admin, a)
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 42.0)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_r2_1_shorten_balance_keeps_sandbox():
    """Денежная бронь 2 ч + песочница: 36 + 5 = 41 ₾. Сокращение на 1 ч: аренда
    пропорцией 36 → 18, песочница остаётся → 23 ₾, назад 18 ₾ (было 20,5)."""
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", minutes=120, method="balance", extras=["sandbox"])
    assert (float(b.final_price), _bal(s, u)) == (41.0, 59.0)
    _shorten(s, admin, b)
    b = s.get(Booking, b.id)
    assert (float(b.final_price), float(b.charge_amount), _bal(s, u)) == (23.0, 23.0, 77.0), \
        (b.final_price, b.charge_amount, _bal(s, u))
    _cancel(s, admin, b)
    assert _bal(s, u) == 100.0


@_scenario
def test_r2_2_money_row_cannot_be_resized_cancel_returns_all():
    """S10/S11: бронь по абонементу ушла в деньги (3 ч: 60 ₾ − 10 % тарифа = 54 +
    песочница 5 = 59 ₾). Сокращение, вырезка, смена формата — понятный 409
    (раньше: сокращение отдавало долю от final_price 5 ₾ и затирало
    charge_amount — клиент терял десятки ₾; вырезка дарила фантомный час).
    Отмена возвращает ровно 59 ₾."""
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=3.0, used_hours=7.0))
    b = _money_row(s, admin, u, minutes=180, extras=["sandbox"])
    taken = round(float(b.charge_amount), 2)
    assert taken == 59.0, taken
    bal0, rem0 = _bal(s, u), _rem(s, u)
    for out in (_shorten(s, admin, b),
                _trim(s, admin, b, "15:00", "16:00"),
                H._call(routes.change_booking_format, booking_id=str(b.id),
                        payload=routes.ChangeFormatRequest(new_format="group"), session=s, current_user=admin)):
        s.rollback()
        assert isinstance(out, dict) and out.get("http") == 409, out
    b = s.get(Booking, b.id)
    assert (b.duration, round(float(b.charge_amount), 2), _bal(s, u), _rem(s, u)) == (180, taken, bal0, rem0)
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (round(bal0 + taken, 2), rem0)


def _set_price(s, actor, b, price):
    from app.api.v1.bookings import routes
    out = H._call(routes.set_booking_price, booking_id=str(b.id),
                  payload=routes.SetPriceRequest(new_price=price, reason="тест"), session=s, current_user=actor)
    s.commit()
    return out


@_scenario
def test_r2_3_price_on_subscription_moves_money_not_hours():
    """S5: «Цена» у брони по абонементу 0 → 20 ₾. Было: деньги не двигались, а
    отмена возвращала 20 ₾ из воздуха (баланс 120). Стало: часы не трогаем,
    разница деньгами: −20 ₾ сейчас, отмена +20 ₾ и +1 ч. Снижение 5 → 0 ₾ —
    +5 ₾ сразу."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    a = _book(s, admin, u, start="14:00")
    assert not isinstance(_set_price(s, admin, a, 20.0), dict)
    a = s.get(Booking, a.id)
    assert (float(a.final_price), float(a.hours_deducted), _bal(s, u), _rem(s, u)) == (20.0, 1.0, 80.0, 9.0), \
        (a.final_price, a.hours_deducted, _bal(s, u), _rem(s, u))
    _cancel(s, admin, a)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), f"отмена: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    p = _book(s, admin, u, start="20:00")
    assert _bal(s, u) == 95.0
    _set_price(s, admin, p, 0.0)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 9.0)
    _cancel(s, admin, p)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_r2_3_price_on_pending_subscription_cron_takes_it():
    """Бронь по абонементу заранее: «Цена» 0 → 10 ₾ — сейчас без денег, крон
    T-24ч снимает 1 ч и 10 ₾, отмена возвращает ровно это."""
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, days=3, start="14:00")
    _set_price(s, admin, b, 10.0)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    s.commit()
    assert (_bal(s, u), _rem(s, u)) == (90.0, 9.0)
    _cancel(s, admin, s.get(Booking, b.id))
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)


@_scenario
def test_r2_3_price_on_money_row_refused():
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=2.0, used_hours=8.0))
    b = _money_row(s, admin, u, minutes=120)
    out = _set_price(s, admin, b, 1.0)
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 409, out


def test_r2_3_price_modal_tells_truth():
    modal = _read("src/components/admin/BookingPriceModal.tsx")
    assert "пересчитаются по новой цене" not in modal, "окно «Цена» снова обещает пересчёт часов"
    assert "Часы абонемента не меняются" in modal and "оплачена деньгами" in modal


@_scenario
def test_r2_4_reschedule_subscription_into_and_out_of_peak():
    """S1: по абонементу 18:00 (денежная часть 0) → перенос на 20:00 (пик):
    −5 ₾ сразу, цена 5 ₾. Обратно 21:00 → 15:00: +5 ₾, цена 0 ₾. Было: цена
    не менялась — в пик бесплатно, из пика отмена возвращала 5 ₾ за слот без пика."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    a = _book(s, admin, u, start="18:00")
    a = _reschedule(s, admin, a, start="20:00")
    assert (float(a.final_price), _bal(s, u), _rem(s, u)) == (5.0, 95.0, 9.0), (a.final_price, _bal(s, u))
    b = _book(s, admin, u, start="21:00", resource="room_2")
    assert _bal(s, u) == 90.0
    b = _reschedule(s, admin, b, start="15:00", resource="room_2")
    assert (float(b.final_price), _bal(s, u)) == (0.0, 95.0), (b.final_price, _bal(s, u))
    _cancel(s, admin, a)
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_r2_4_reschedule_pending_subscription_changes_price_only():
    """Заранее (pending) 18:00 → 20:00: сейчас денег не двигаем, цена 5 ₾ —
    крон снимет 1 ч и 5 ₾ один раз."""
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, days=3, start="18:00")
    b = _reschedule(s, admin, b, start="20:00", days=3)
    assert (b.payment_status, float(b.final_price), _bal(s, u), _rem(s, u)) == ("pending", 5.0, 100.0, 10.0)
    billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    s.commit()
    assert (_bal(s, u), _rem(s, u)) == (95.0, 9.0)
    _cancel(s, admin, s.get(Booking, b.id))
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)


def _series(s, admin, u, *, method, start="18:00", days=3, occurrences=3):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    out = routes.create_recurring_booking(
        background_tasks=BackgroundTasks(), session=s, current_user=admin,
        data=routes.RecurringBookingRequest(
            resource_id="room_1", location_id="unbox_uni", start_time=start, duration=60, format="individual",
            payment_method=method, first_date=H._day(days).strftime("%Y-%m-%d"), occurrences=occurrences,
            target_user_id=str(u.id)))
    s.commit()
    return s.exec(select(Booking).where(Booking.recurring_group_id == out["recurring_group_id"])
                  .order_by(Booking.date)).all()


@_scenario
def test_r2_4_series_reschedule_reprices_every_meeting():
    """S15: серия ×3 по 18:00, «эту и следующие» на 20:00 (пик). Денежная: у
    всех 25 ₾ (было: якорь 25, остальные 20). По абонементу: у всех 5 ₾ (было
    0). Крон и отмена — ровно взятое."""
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.services import billing_defer
    for method, sub, price in (("balance", None, 25.0), ("subscription", _sub("PRO_PLUS"), 5.0)):
        s = _db()
        admin = _admin(s)
        u = _client(s, sub, balance=300.0)
        rows = _series(s, admin, u, method=method)
        out = routes.reschedule_booking_series(
            booking_id=str(rows[0].id),
            data=routes.RescheduleRequest(new_date=rows[0].date.strftime("%Y-%m-%d"), new_start_time="20:00"),
            background_tasks=BackgroundTasks(), session=s, current_user=admin)
        s.commit()
        assert out["propagated"] == 2 and not out["skipped"], out
        s.expire_all()
        rows = [s.get(Booking, r.id) for r in rows]
        assert [(r.start_time, float(r.final_price)) for r in rows] == [("20:00", price)] * 3, \
            (method, [(r.start_time, r.final_price) for r in rows])
        assert _bal(s, u) == 300.0, "pending-встречи не должны двигать деньги при переносе"
        for r in rows:
            billing_defer.settle_pending_charge(s, s.get(Booking, r.id))
            s.commit()
        assert _bal(s, u) == round(300.0 - 3 * price, 2), (method, _bal(s, u))
        for r in rows:
            _cancel(s, admin, s.get(Booking, r.id))
        assert _bal(s, u) == 300.0, (method, _bal(s, u))
        _ledger_ok(s, u, 300.0)


@_scenario
def test_r2_4_money_row_reschedule_reprices_cash():
    """Бронь по абонементу, ушедшая в деньги (3 ч с 14:00: 54 + песочница 5 =
    59 ₾), переносится на 19:00 (20–22 пик): цена деньгами на новый слот
    (20 + 25·2 = 70 − 10 % = 63) + 5 = 68 ₾ — доплата 9 ₾; отмена → +68."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=3.0, used_hours=7.0))
    b = _money_row(s, admin, u, minutes=180, extras=["sandbox"])
    bal0 = _bal(s, u)
    b = _reschedule(s, admin, b, start="19:00", days=3)
    assert (round(float(b.charge_amount), 2), _bal(s, u)) == (68.0, round(bal0 - 9.0, 2)), \
        (b.charge_amount, _bal(s, u), bal0)
    _cancel(s, admin, b)
    assert _bal(s, u) == round(bal0 + 59.0, 2)
    _ledger_ok(s, u, 100.0)


def _waive(s, admin, b):
    from app.services.billing_defer import waive_charge
    res: dict = {}
    ok, status = waive_charge(s, s.get(Booking, b.id), reason="тест", by_user=admin, result=res)
    s.commit()
    assert ok, status
    return {"money": res["money"], "hours": res["hours"]}


@_scenario
def test_r2_5_waive_after_full_cancel_returns_nothing():
    """S16/S18: отмена со 100 % уже всё вернула — снятие штрафа после неё не
    возвращает второй раз. Было: по абонементу 20:00 + песочница (10 ₾ + 1 ч):
    после отмены 100 ₾ / 10 ч, после waive 110 ₾ / 11 ч; денежная 20 ₾: 120 ₾."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, start="20:00", extras=["sandbox"])
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    assert _waive(s, admin, b) == {"money": 0.0, "hours": 0.0}
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), f"waive после отмены: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    v = _client(s, None)
    c = _book(s, admin, v, start="14:00", method="balance")
    _cancel(s, admin, c)
    _waive(s, admin, c)
    assert _bal(s, v) == 100.0, f"денежная: {_bal(s, v)}"
    _ledger_ok(s, u, 100.0)
    _ledger_ok(s, v, 100.0)


@_scenario
def test_r2_5_waive_after_penalty_cancel_forgives_rest():
    """Задуманный путь «простить штраф»: отмена с 0 % (денежная 20 ₾: 80 ₾), потом
    waive → 100 ₾ (S9). По абонементу без денег (только час), отмена 0 % → waive
    возвращает час (доля — из события отмены). Отмена 50 % брони 20:00 + песочница
    (10 ₾ + 1 ч): 5 ₾ и 0,5 ч сразу, waive — остальные 5 ₾ и 0,5 ч."""
    s = _db()
    admin = _admin(s)
    v = _client(s, None)
    c = _book(s, admin, v, start="14:00", method="balance")
    _cancel(s, admin, c, refund_percent=0.0)
    assert _bal(s, v) == 80.0
    assert _waive(s, admin, c)["money"] == 20.0 and _bal(s, v) == 100.0

    u = _client(s, _sub("WARM_START"))
    h = _book(s, admin, u, start="14:00")
    _cancel(s, admin, h, refund_percent=0.0)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 9.0)
    assert _waive(s, admin, h) == {"money": 0.0, "hours": 1.0}
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)

    p = _book(s, admin, u, start="20:00", extras=["sandbox"])
    _cancel(s, admin, p, refund_percent=0.5)
    assert (_bal(s, u), _rem(s, u)) == (95.0, 9.5)
    assert _waive(s, admin, p) == {"money": 5.0, "hours": 0.5}
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_r2_5_series_cancel_logs_share_for_waive():
    """Отмена серии со штрафом 0 % пишет событие по каждой брони — waive потом
    возвращает часы встречи, у которой нет денег (раньше доля была неизвестна)."""
    from app.api.v1.bookings import routes
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("PRO_PLUS"), balance=300.0)
    rows = _series(s, admin, u, method="subscription", start="14:00", days=0, occurrences=2)
    assert [r.payment_status for r in rows] == ["paid", "pending"]
    routes.cancel_recurring_bookings(group_id=rows[0].recurring_group_id, from_booking_id=rows[0].id,
                                     refund_percent=0.0, reason="штраф", session=s, current_user=admin)
    s.commit()
    assert _rem(s, u) == 41.0, "штраф 0 %: час первой встречи удержан"
    assert _waive(s, admin, rows[0]) == {"money": 0.0, "hours": 1.0}
    assert _rem(s, u) == 42.0
    ok, status = billing_defer.waive_charge(s, s.get(Booking, rows[1].id), reason="тест", by_user=admin)
    assert ok and status == "waived_pending"


@_scenario
def test_r2_6_trim_keeps_sandbox_in_first_remnant():
    """S12: денежная 12:00–15:00 + песочница = 51 + 5 = 56 ₾. Вырезали 13–14:
    остатки 20 + 5 (песочница — у первого) и 20 ₾, назад 11 ₾ (было 16 ₾ —
    песочница уезжала в возврат, а сама оставалась в брони). S3: по абонементу
    14:00–17:00 + песочница (5 ₾ снято): вырезка 16–17 → цена 5 ₾ остаётся, назад
    только час."""
    s = _db()
    admin = _admin(s)
    u = _client(s, None, balance=200.0)
    b = _book(s, admin, u, start="12:00", minutes=180, method="balance", extras=["sandbox"])
    assert (float(b.final_price), _bal(s, u)) == (56.0, 144.0)
    _trim(s, admin, b, "13:00", "14:00")
    rows = sorted(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all(), key=lambda r: r.start_time)
    assert [(r.start_time, float(r.final_price), r.extras) for r in rows] == \
        [("12:00", 25.0, ["sandbox"]), ("14:00", 20.0, [])], [(r.start_time, r.final_price, r.extras) for r in rows]
    assert _bal(s, u) == 155.0, _bal(s, u)
    for r in rows:
        _cancel(s, admin, r)
    assert _bal(s, u) == 200.0
    _ledger_ok(s, u, 200.0)

    v = _client(s, _sub("WARM_START"))
    c = _book(s, admin, v, start="14:00", minutes=180, extras=["sandbox"])
    assert (_bal(s, v), _rem(s, v)) == (95.0, 7.0)
    _trim(s, admin, c, "16:00", "17:00")
    c = s.get(Booking, c.id)
    assert (float(c.final_price), _bal(s, v), _rem(s, v)) == (5.0, 95.0, 8.0), (c.final_price, _bal(s, v), _rem(s, v))
    _cancel(s, admin, c)
    assert (_bal(s, v), _rem(s, v)) == (100.0, 10.0)


@_scenario
def test_r2_6_convert_to_subscription_keeps_sandbox_money():
    """S4: денежная 14:00 + песочница = 25 ₾, клиент купил абонемент, «На
    абонемент»: −1 ч, назад 20 ₾ (аренда), цена брони 5 ₾ (песочница). Было:
    назад 25 ₾, цена 0 ₾ — песочница бесплатно. Отмена: +5 ₾ и +1 ч."""
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", method="balance", extras=["sandbox"])
    uu = s.get(User, u.id)
    uu.subscription = _sub("WARM_START")
    s.add(uu)
    s.commit()
    routes.convert_booking_to_subscription(booking_id=str(b.id), session=s, current_user=admin)
    s.commit()
    b = s.get(Booking, b.id)
    assert (b.payment_method, float(b.final_price), _bal(s, u), _rem(s, u)) == ("subscription", 5.0, 95.0, 9.0), \
        (b.payment_method, b.final_price, _bal(s, u), _rem(s, u))
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_r2_6_series_extension_does_not_copy_extras():
    """S7: у шаблона серии песочница — продление серии её не копирует (цена новых
    дат без допов: песочница ехала бы бесплатно каждую неделю)."""
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    rows = _series(s, admin, u, method="subscription", start="20:00", days=3, occurrences=2)
    for r in rows:
        r.extras = ["sandbox"]
        s.add(r)
    s.commit()
    routes.extend_recurring_series(group_id=rows[0].recurring_group_id, payload={"add_occurrences": 2},
                                   session=s, current_user=admin)
    s.commit()
    new = s.exec(select(Booking).where(Booking.recurring_group_id == rows[0].recurring_group_id)
                 .order_by(Booking.date)).all()[2:]
    assert [(r.extras, float(r.final_price)) for r in new] == [([], 5.0), ([], 5.0)], \
        [(r.extras, r.final_price) for r in new]


@_scenario
def test_r2_6_extend_waived_refused():
    """Продление брони со снятым штрафом: 409 (раньше денежная списывала доплату,
    а отмена waived-брони её не возвращала)."""
    from app.services.billing_defer import waive_charge
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", method="balance")
    waive_charge(s, s.get(Booking, b.id), reason="тест", by_user=admin)
    s.commit()
    assert _bal(s, u) == 100.0
    from app.api.v1.bookings import routes
    out = H._call(routes.extend_booking, booking_id=str(b.id), payload=routes.ExtendRequest(extra_minutes=30),
                  session=s, current_user=admin)
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 409, out
    assert _bal(s, u) == 100.0


@_scenario
def test_r2_6_peak_notice_only_when_charged():
    """Уведомление «Доплата за пиковые часы … списана со счёта» — только если
    доплату сняли сейчас: у горячей (ждёт админа) и у брони заранее — нет."""
    from app.models.notification import Notification
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))

    def notices():
        s.expire_all()
        return len(s.exec(select(Notification).where(Notification.recipient_id == str(u.id),
                                                     Notification.type == "peak_hours_debt")).all())
    _book(s, u, u, start="20:00")                 # горячая — ждёт одобрения
    _book(s, admin, u, days=3, start="20:00")     # заранее — спишет крон
    assert notices() == 0, "уведомление о списании, которого не было"
    _book(s, admin, u, start="21:00", resource="room_2")  # сейчас и сразу списано
    assert notices() == 1


@_scenario
def test_rA_extend_pending_beyond_hours_goes_to_money():
    """Второй ревизор, A: в пуле 1 ч, бронь заранее 1 ч + песочница (5 ₾),
    «+30 мин» дважды. Было: часы брони росли до 2 ч, крон «всё или ничего» видел
    нехватку и уводил в деньги ВСЮ бронь (41 ₾), час оставался в пуле. Стало:
    добавка — деньгами в цене (2 × 9 ₾ по цене тарифа −10 %), часы брони 1 ч;
    крон снимает 1 ч и 23 ₾ (5 + 18). Отмена — ровно назад."""
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=1.0, used_hours=9.0))
    b = _book(s, admin, u, days=3, start="14:00", extras=["sandbox"])
    b = _extend(s, admin, b, 30)
    b = _extend(s, admin, b, 30)
    assert (b.duration, float(b.hours_deducted), float(b.final_price), b.payment_status) == \
        (120, 1.0, 23.0, "pending"), (b.duration, b.hours_deducted, b.final_price, b.payment_status)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 1.0)
    ok, _ = billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    s.commit()
    b = s.get(Booking, b.id)
    assert ok and float(b.hours_deducted) == 1.0, (ok, b.hours_deducted)
    assert (_bal(s, u), _rem(s, u)) == (77.0, 0.0), f"крон: {_bal(s, u)} ₾ / {_rem(s, u)} ч, ждём 77 / 0"
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 1.0)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_rB_telegram_approve_recomputes_chain_like_site():
    """Второй ревизор, B: две соседние горячие денежные брони по 20 ₾ (16:00 и
    17:00) одобрены в Telegram — цепочка 2 ч, по 18 ₾, баланс 64 (как на сайте).
    Было: бот не пересчитывал — 2 × 20 ₾."""
    from app.api.v1 import telegram as tg
    s = _db()
    admin = _admin(s)
    admin.telegram_id = "555"
    s.add(admin)
    s.commit()
    u = _client(s, None)
    b1 = _book(s, u, u, start="16:00", method="balance")
    b2 = _book(s, u, u, start="17:00", method="balance")
    for b in (b1, b2):
        tg._handle_hot_booking_callback(s, "cb", 1, 2, 555, f"ba:{b.id}")
        s.commit()
    s.expire_all()
    assert [float(s.get(Booking, b.id).final_price) for b in (b1, b2)] == [18.0, 18.0]
    assert _bal(s, u) == 64.0, _bal(s, u)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_rC_price_and_gift_hour_keep_extras():
    """Второй ревизор, C: «Цена» ниже стоимости допов — 400 (допы остаются в цене,
    пока они в брони); выше — ок, допы по-прежнему отделимы. «Час в подарок» на
    2 ч + песочница (36 + 5 = 41 ₾): минус час АРЕНДЫ 18 ₾ → 23 ₾ (было: минус
    20,5 ₾ — «час» откусывал и половину песочницы)."""
    from app.models.bonus import Bonus
    from app.services.pricing import booking_extras_money
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", method="balance", extras=["sandbox"])
    out = _set_price(s, admin, b, 3.0)
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 400, out
    assert not isinstance(_set_price(s, admin, b, 20.0), dict)
    b = s.get(Booking, b.id)
    assert (float(b.final_price), booking_extras_money(b), _bal(s, u)) == (20.0, 5.0, 80.0)
    v = _client(s, _sub("WARM_START"))
    c = _book(s, admin, v, start="14:00", resource="room_3", extras=["sandbox"])
    out = _set_price(s, admin, c, 0.0)
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 400, out

    w = _client(s, None)
    g = _book(s, admin, w, start="16:00", minutes=120, method="balance", extras=["sandbox"])
    assert (float(g.final_price), _bal(s, w)) == (41.0, 59.0)
    s.add(Bonus(user_id=str(w.id), type="free_hour", quantity=1.0, status="active",
                expires_at=H.FakeDatetime.now() + timedelta(days=10)))
    s.commit()
    routes.apply_bonus_hour(booking_id=str(g.id), session=s, current_user=admin)
    s.commit()
    g = s.get(Booking, g.id)
    assert (float(g.final_price), _bal(s, w)) == (23.0, 77.0), (g.final_price, _bal(s, w))
    _ledger_ok(s, w, 100.0)


@_scenario
def test_rE_patch_user_discount_range():
    """Второй ревизор, E: PATCH /users — скидка только 0–100 %, тип цен — из двух
    (как в /users/{id}/discount)."""
    s = _db()
    senior = _admin(s, role="senior_admin")
    u = _client(s, None)
    for fields in ({"personal_discount_percent": 150}, {"personal_discount_percent": -5},
                   {"pricing_system": "vip"}):
        res = _patch_user(s, senior, u, **fields)
        assert isinstance(res, tuple) and res[0] == 400, (fields, res)
    assert _patch_user(s, senior, u, personal_discount_percent=100, pricing_system="personal") == 200


def test_peak_money_grid_matches_engine():
    """subscription_peak_money (продление, перенос, сокращение, вырезка) обязана
    совпадать с пиковой надбавкой движка цен (subscription_peak_debt) на всей
    сетке: старт каждые 15 мин, длительность каждые 30 мин (второй ревизор сверил
    2304 комбинации)."""
    from datetime import datetime as _real, timedelta as _td
    from app.services.pricing import PricingService
    with H.frozen_time():
        s = H._db()
        u = H._user(s, sub=H._sub("PRO_PLUS", remaining_hours=500.0, total_hours=500.0), balance=0.0)
        ps = PricingService(s)
        day = _real(2026, 10, 7)
        checked = bad = 0
        for start_min in range(0, 24 * 60, 15):
            for dur in range(30, 24 * 60 - start_min + 1, 30):
                st = day + _td(minutes=start_min)
                q = ps.calculate_price(user=u, resource_id="room_1", start_time=st, duration_minutes=dur,
                                       format_type="individual")
                if q.applied_rule != "SUBSCRIPTION":
                    continue
                checked += 1
                if abs(round(float(q.subscription_peak_debt), 2) - PricingService.subscription_peak_money(st, dur)) > 0.001:
                    bad += 1
    assert checked >= 2000 and bad == 0, f"сверено {checked}, расхождений {bad}"


@_scenario
def test_r2_waived_booking_edits_refused():
    """Фаззер ревизии 03.10: у брони со снятым штрафом вырезка возвращала часы и
    пик второй раз (+1 ч и +5 ₾ из воздуха), доп «с баланса» и «На абонемент»
    снимали деньги/часы, которые отмена waived-брони уже не вернёт. Теперь —
    409 / понятный отказ; доп за наличные — можно."""
    from app.api.v1.bookings import routes
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, start="19:00", minutes=180)
    assert (_bal(s, u), _rem(s, u)) == (90.0, 7.0)
    _waive(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)
    out = _trim(s, admin, b, "20:00", "21:00")
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 409, out
    out = H._call(routes.add_booking_extras, booking_id=str(b.id),
                  payload=routes.AddExtrasRequest(extras=["coffee_meama"], payment_method="balance"),
                  session=s, current_user=admin)
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 409, out
    assert not isinstance(H._call(routes.add_booking_extras, booking_id=str(b.id),
                                  payload=routes.AddExtrasRequest(extras=["coffee_meama"], payment_method="cash"),
                                  session=s, current_user=admin), dict)
    s.commit()
    v = _client(s, None)
    c = _book(s, admin, v, start="14:00", method="balance", resource="room_2")
    _waive(s, admin, c)
    uu = s.get(User, v.id)
    uu.subscription = _sub("WARM_START")
    s.add(uu)
    s.commit()
    out = H._call(routes.convert_booking_to_subscription, booking_id=str(c.id), session=s, current_user=admin)
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 400, out
    assert (_bal(s, u), _rem(s, u), _bal(s, v), _rem(s, v)) == (100.0, 10.0, 100.0, 10.0)
    _cancel(s, admin, b)
    _cancel(s, admin, c)
    assert (_bal(s, u), _rem(s, u), _bal(s, v), _rem(s, v)) == (100.0, 10.0, 100.0, 10.0)


def _format(s, actor, b, new_format):
    from app.api.v1.bookings import routes
    out = H._call(routes.change_booking_format, booking_id=str(b.id),
                  payload=routes.ChangeFormatRequest(new_format=new_format), session=s, current_user=actor)
    s.commit()
    return out


@_scenario
def test_r3_1_format_change_keeps_paid_money_of_subscription_booking():
    """S24a (Профи+): по абонементу 1 ч, «Цена» 0 → 30 ₾ (100 → 70), формат →
    группа. Было: цена пересчитывалась движком в 0 — отмена возвращала 70 вместо
    100. Стало: цена 30 ₾ остаётся (деньги брони от формата не зависят), часы на
    месте; отмена → 100 ₾ / 42 ч."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("PRO_PLUS"))
    b = _book(s, admin, u, start="14:00")
    _set_price(s, admin, b, 30.0)
    assert (_bal(s, u), _rem(s, u)) == (70.0, 41.0)
    assert not isinstance(_format(s, admin, b, "group"), dict)
    b = s.get(Booking, b.id)
    assert (b.format, float(b.final_price), float(b.hours_deducted), _bal(s, u), _rem(s, u)) == \
        ("group", 30.0, 1.0, 70.0, 41.0), (b.format, b.final_price, b.hours_deducted, _bal(s, u), _rem(s, u))
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 42.0), f"отмена: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _ledger_ok(s, u, 100.0)


@_scenario
def test_r3_1_format_change_group_master_moves_hours_not_money():
    """S27 (Групповой мастер): индивидуальная 1 ч из «4 ч индивидуально» (осталось
    0,25), продление +30 мин — часов нет, деньгами 10 ₾. Формат → группа: тот же
    1 ч переезжает в основной пул (доп. 0,25 → 1,25, основной 20 → 19), добавка
    остаётся деньгами. Было: часы пересчитывались на 1,5 ч — добавка оплачивалась
    второй раз часами, отмена давала 90 ₾ вместо 100."""
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("GROUP_MASTER", extra_hours_remaining=1.25, extra_hours_used=2.75))
    b = _book(s, admin, u, start="14:00", fmt="individual")
    b = _extend(s, admin, b, 30)
    assert (float(b.final_price), _bal(s, u)) == (10.0, 90.0), (b.final_price, _bal(s, u))
    assert not isinstance(_format(s, admin, b, "group"), dict)
    b = s.get(Booking, b.id)
    s.expire_all()
    sub = s.get(User, u.id).subscription
    assert (float(b.hours_deducted), float(b.final_price), _bal(s, u)) == (1.0, 10.0, 90.0)
    assert (P.get_float(sub, "remaining_hours"), P.get_float(sub, "extra_hours_remaining")) == (19.0, 1.25)
    _cancel(s, admin, b)
    s.expire_all()
    sub = s.get(User, u.id).subscription
    assert (_bal(s, u), P.get_float(sub, "remaining_hours"), P.get_float(sub, "extra_hours_remaining")) == \
        (100.0, 20.0, 1.25)
    _ledger_ok(s, u, 100.0)


@_scenario
def test_r3_10_cron_writes_taken_hours_into_booking():
    """Прод b894240e: старая бронь серии без hours_deducted — крон снимал час
    (часы брал из длительности), ставил пул, но hours_deducted оставлял 0/None.
    Теперь крон пишет снятые часы в бронь: hours_deducted 1.0, отмена → +1 ч."""
    from app.services import billing_defer
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"))
    b = _book(s, admin, u, days=3, start="14:00")
    b.hours_deducted = None
    s.add(b)
    s.commit()
    ok, _ = billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    s.commit()
    b = s.get(Booking, b.id)
    assert ok and float(b.hours_deducted) == 1.0 and b.hours_pool == "main", (b.hours_deducted, b.hours_pool)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 9.0)
    _cancel(s, admin, b)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0)


@_scenario
def test_r3_11_legacy_hours_row_is_hours_not_money():
    """Старая «часовая» бронь: hours_deducted = 0, но пул помечен 'main', в
    charge_amount — снимок часов (1.0). Это оплата ЧАСАМИ: не «ушла в деньги»
    (правки не 409), отмена возвращает 1 ч, а не 1 ₾. Настоящая «в деньгах»
    (пул пустой, charge_amount 18 ₾) — по-прежнему деньгами."""
    from app.api.v1.bookings import routes
    assert P.pool_label(0, 0) is None
    assert (P.pool_label(1, 0), P.pool_label(1, 1), P.pool_label(2, 1)) == ("main", "extra", "mixed")
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=9.0, used_hours=1.0))
    legacy = Booking(resource_id="room_1", location_id="unbox_uni", date=H._day(3), start_time="14:00", duration=60,
                     final_price=0.0, payment_method="subscription", payment_status="paid", status="confirmed",
                     hours_deducted=0.0, hours_pool="main", charge_amount=1.0, applied_rule="SUBSCRIPTION",
                     user_id=u.email, user_uuid=u.id, format="individual")
    money = Booking(resource_id="room_2", location_id="unbox_uni", date=H._day(3), start_time="14:00", duration=60,
                    final_price=0.0, payment_method="subscription", payment_status="paid", status="confirmed",
                    hours_deducted=0.0, hours_pool=None, charge_amount=18.0, applied_rule="SUBSCRIPTION",
                    user_id=u.email, user_uuid=u.id, format="individual")
    s.add(legacy)
    s.add(money)
    s.commit()
    assert not routes._subscription_money_row(legacy) and routes._subscription_money_row(money)
    _cancel(s, admin, legacy)
    assert (_bal(s, u), _rem(s, u)) == (100.0, 10.0), f"старая часовая: {_bal(s, u)} ₾ / {_rem(s, u)} ч"
    _cancel(s, admin, money)
    assert (_bal(s, u), _rem(s, u)) == (118.0, 10.0), f"в деньгах: {_bal(s, u)} ₾ / {_rem(s, u)} ч"


@_scenario
def test_r3_2_waive_returns_bonus_hours():
    """Бонусная бронь, отмена 100 / 50 / 0 %, потом «Снять штраф» — бонусный
    час у клиента целиком (1 ч). Было: waive бонус-часы не возвращал (после
    отмены 0 % — 0, после 50 % — 0,5). Неотменённая бонусная: waive вернул час,
    и последующая отмена второй раз его не вернёт."""
    from app.services.billing_defer import waive_charge
    for pct in (1.0, 0.5, 0.0):
        s = _db()
        admin = _admin(s)
        u = _client(s, None)
        _bonus(s, u, 1.0)
        b = _book(s, admin, u, start="14:00", method="balance")
        assert b.payment_method == "bonus" and _free_hours(s, u) == 0.0
        _cancel(s, admin, b, refund_percent=pct)
        ok, _ = waive_charge(s, s.get(Booking, b.id), reason="прощаем", by_user=admin)
        s.commit()
        assert ok and _free_hours(s, u) == 1.0, f"отмена {pct}: бонус-часов {_free_hours(s, u)}"
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    _bonus(s, u, 1.0)
    b = _book(s, admin, u, start="14:00", method="balance")
    waive_charge(s, s.get(Booking, b.id), reason="прощаем", by_user=admin)
    s.commit()
    assert _free_hours(s, u) == 1.0
    _cancel(s, admin, s.get(Booking, b.id))
    assert _free_hours(s, u) == 1.0, "отмена waived-брони вернула бонус второй раз"


@_scenario
def test_r3_3_waive_endpoint_locks_and_second_click_is_refused():
    """«Снять штраф» под замком строки (как отмена/вырезка/одобрение): второй
    клик ждёт первого и получает 409 «уже снят», денег второй раз не будет."""
    from fastapi import HTTPException
    from app.api.v1 import billing
    src = _read("backend/app/api/v1/billing.py")
    body = src[src.index("def waive_booking_charge("):]
    body = body[:body.index("\n@router.") if "\n@router." in body else len(body)]
    assert ".with_for_update()" in body and "session.get(Booking, booking_id)" not in body
    s = _db()
    admin = _admin(s)
    u = _client(s, None)
    b = _book(s, admin, u, start="14:00", method="balance")
    billing.waive_booking_charge(booking_id=b.id, payload={"reason": "тест"}, session=s, current_user=admin)
    assert _bal(s, u) == 100.0
    try:
        billing.waive_booking_charge(booking_id=b.id, payload={"reason": "тест"}, session=s, current_user=admin)
        raise AssertionError("второй клик прошёл")
    except HTTPException as e:
        assert e.status_code == 409, e.status_code
    assert _bal(s, u) == 100.0


@_scenario
def test_r3_8_waive_client_text_after_cancel():
    """Текст клиенту: после полной отмены — «Деньги и часы по этой брони вам уже
    вернули при отмене» (было «Вернули: ничего (всё уже вернула отмена)»); после
    частичной — «Вернули ещё …»."""
    from app.api.v1 import billing
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START"), tg="777")
    with _Offline() as off:
        a = _book(s, admin, u, start="20:00", extras=["sandbox"])
        _cancel(s, admin, a)
        billing.waive_booking_charge(booking_id=a.id, payload={"reason": "тест"}, session=s, current_user=admin)
        b = _book(s, admin, u, start="20:00", resource="room_2", extras=[])
        _cancel(s, admin, b, refund_percent=0.5)
        billing.waive_booking_charge(booking_id=b.id, payload={"reason": "тест"}, session=s, current_user=admin)
        texts = [t for chat, t in off.sent if chat == "777" and "Штраф за бронь снят" in t]
    assert len(texts) == 2, off.sent
    assert "уже вернули при отмене" in texts[0] and "ничего" not in texts[0], texts[0]
    assert "Вернули ещё" in texts[1], texts[1]


@_scenario
def test_r3_4_refusal_texts_point_to_real_actions():
    """Тексты отказов ведут на существующее действие: админу — «Отмените её
    (деньги вернутся полностью) и создайте новую»; клиенту меньше чем за сутки (сам
    он бронь не отменит) — «Напишите администратору». Никаких «снимите waiver»."""
    from app.api.v1.bookings import routes
    src = _read("backend/app/api/v1/bookings/routes.py")
    for bad in ("Снимите waiver", "восстановите оплату", "отмените снятие", "_MONEY_ROW_DETAIL"):
        assert bad not in src, f"в отказах снова «{bad}»"
    s = _db()
    admin = _admin(s)
    u = _client(s, _sub("WARM_START", remaining_hours=2.0, used_hours=8.0))
    b1 = _book(s, u, u, start="16:00", minutes=60)
    b2 = _book(s, u, u, start="17:00", minutes=90)
    _approve(s, admin, b1)
    b2 = _approve(s, admin, b2)  # часов нет → в деньги, сегодня (< 24 ч)
    assert routes._subscription_money_row(b2)
    out_admin = _shorten(s, admin, b2, 30)
    s.rollback()
    out_client = _shorten(s, s.get(User, u.id), b2, 30)
    s.rollback()
    assert out_admin.get("http") == out_client.get("http") == 409, (out_admin, out_client)
    from fastapi import HTTPException

    def _detail(actor):
        try:
            routes.shorten_booking(booking_id=str(b2.id), payload=routes.ShortenRequest(remove_minutes=30),
                                   session=s, current_user=actor)
        except HTTPException as e:
            s.rollback()
            return e.detail
        raise AssertionError("сокращение брони в деньгах прошло")
    assert "Отмените её (деньги вернутся полностью) и создайте новую." in _detail(admin)
    assert _detail(s.get(User, u.id)).endswith("Напишите администратору.")


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
