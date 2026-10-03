"""СТОРОЖ «новая бронь снимает паузу абонемента» (решение владельца 03.10).

Владелец: «если стоит на паузе, а клиент делает бронь, то пауза снимается, но
дни неизрасходованной паузы остаются и могут быть использованы в рамках этого
абонемента».

Как работает (bookings/routes.py, блок «Пауза абонемента снимается новой бронью»):
  * перед расчётом цены новой брони — «примерка»: пауза снимается на КОПИИ
    пула (copy.deepcopy → subscription_perks.end_freeze), бронь считается тем же
    движком (calculate_price + _resolve_with_bonus без траты бонусов);
  * пошла бы часами абонемента → паузу снимаем по-настоящему обычным end_freeze
    (срок +min(факт, выдано), у старой паузы — +факт; остаток дней — в бюджете)
    под замком строки клиента с перепроверкой «пауза ещё стоит»; событие
    subscription_freeze / AutoUnfreezeOnBooking — тем же коммитом, что и бронь;
  * не пошла бы (бонус покрывает целиком, формат не в тарифе, часов мало, срок
    вышел даже с продлением, выбран другой способ) — пауза стоит, как раньше;
  * пути: одиночная бронь (сайт, бот, горячая), корзина, серия, продление серии;
    корзина и серия — одно снятие до цикла. Перенос, продление брони, «На
    абонемент», «Закрыть кабинет», отмену — НЕ трогаем;
  * клиенту — сообщение в Telegram после коммита (бот — в своём ответе);
  * экран (мастер на компьютере и телефоне) показывает абонемент на паузе как
    покрывающий и пишет, что после брони пауза снимется.

Без сети и боевой базы: SQLite в памяти, время заморожено (пн 05.10.2026,
10:00 по Тбилиси), Telegram подменён.

    python3 backend/tests/guard_pause_lift_on_booking_2026_10.py
"""
import copy
import functools
import os
import sys
from datetime import timedelta
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

from sqlmodel import select  # noqa: E402

import app.models  # noqa: E402,F401
from app.models.booking import Booking, BookingCreate  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import subscription_pool as P  # noqa: E402

import guard_hours_pool_moves as H  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")
ACTION = "AutoUnfreezeOnBooking"


def _read(rel: str) -> str:
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _body(src: str, start: str, end: str = "\n@router.") -> str:
    i = src.index(start)
    j = src.find(end, i + len(start))
    return src[i:j if j != -1 else len(src)]


def _scenario(fn):
    """Каждый сценарий — с замороженным временем и своей чистой базой."""
    @functools.wraps(fn)
    def wrapper():
        with H.frozen_time():
            return fn()
    return wrapper


# ─── Фикстуры ────────────────────────────────────────────────────────────

def _now():
    return H.FakeDatetime.utcnow()


def _paused_sub(plan="PRO_PLUS", *, built_days_ago=15, paused_days_ago=10, days=None, **over):
    """Абонемент, купленный built_days_ago назад и поставленный на паузу (НОВАЯ
    пауза по бюджету тарифа) paused_days_ago назад."""
    from app.services import subscription_perks as perks
    from app.services.subscription_sale import build_subscription
    sub = build_subscription(plan, _now() - timedelta(days=built_days_ago))
    if over:
        sub = P.update(sub, **over)
    return perks.start_freeze(sub, _now() - timedelta(days=paused_days_ago), days=days, override=days is not None)


def _legacy_paused_sub(plan="PRO_PLUS", *, built_days_ago=50, paused_days_ago=40):
    """СТАРАЯ пауза (до 01.10): без frozen_days_granted и полей бюджета."""
    from app.services.subscription_sale import build_subscription
    at = _now() - timedelta(days=paused_days_ago)
    sub = P.update(build_subscription(plan, _now() - timedelta(days=built_days_ago)),
                   is_frozen=True, freeze_count=1, frozen_at=at.isoformat(),
                   frozen_until=(at + timedelta(days=7)).isoformat())
    return {k: v for k, v in sub.items() if "freeze_days" not in k and "freezeDays" not in k}


def _client(s, sub, *, balance=500.0, tg=None, credit=0.0):
    u = H._user(s, sub=sub, balance=balance, name="Клиент")
    if tg or credit:
        u.telegram_id = tg
        u.credit_limit = credit
        s.add(u)
        s.commit()
        s.refresh(u)
    return u


def _admin(s):
    return H._user(s, role="owner", name="Админ", balance=0.0)


def _pool(s, u) -> dict:
    s.expire_all()
    return s.get(User, u.id).subscription


def _frozen(s, u) -> bool:
    return bool(P.get(_pool(s, u), "is_frozen", False))


def _events(s, u) -> list:
    from app.models.timeline import TimelineEvent
    rows = s.exec(select(TimelineEvent).where(TimelineEvent.target_id == str(u.id))).all()
    return [r for r in rows if (r.metadata_dump or {}).get("action") == ACTION]


def _book(s, actor, owner, *, days=2, start="12:00", minutes=60, resource="room_1", fmt="individual",
          method="balance", bt=None):
    """create_booking как с сайта: админ — за клиента, клиент — за себя."""
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    bi = BookingCreate(resource_id=resource, location_id="unbox_uni", date=H._day(days), start_time=start,
                       duration=minutes, format=fmt, payment_method=method,
                       target_user_id=(str(owner.id) if actor.id != owner.id else None))
    out = H._call(routes.create_booking, session=s, booking_in=bi, current_user=actor,
                  background_tasks=bt if bt is not None else BackgroundTasks())
    if isinstance(out, dict):
        s.rollback()  # как FastAPI: сессия закрывается без коммита
        return out
    s.commit()
    return s.get(Booking, out.id)


class _TgCapture:
    """Подмена отправки в Telegram (клиентские сообщения и алерты)."""

    def __init__(self):
        self.sent = []

    def __enter__(self):
        from app.services.telegram import telegram_service
        self._svc = telegram_service
        self._saved = {k: getattr(telegram_service, k) for k in
                       ("send_message", "send_admin_alert", "send_admin_event", "send_hot_booking_dms")}
        telegram_service.send_message = lambda chat_id, text, parse_mode="HTML": self.sent.append((str(chat_id), text)) or True
        telegram_service.send_admin_alert = lambda *a, **kw: True
        telegram_service.send_admin_event = lambda *a, **kw: True
        telegram_service.send_hot_booking_dms = lambda *a, **kw: 0
        return self

    def __exit__(self, *exc):
        for k, v in self._saved.items():
            setattr(self._svc, k, v)
        return False


def _run_pause_tasks(bt) -> int:
    """Выполнить из фоновых задач брони ТОЛЬКО сообщение о снятии паузы
    (остальные — Google Calendar и т.п. — ходят в сеть/боевую базу)."""
    from app.api.v1.bookings import routes
    n = 0
    for t in bt.tasks:
        if t.func is routes._send_pause_lift_tg:
            t.func(*t.args, **t.kwargs)
            n += 1
    return n


# ─────────────────────────────────────────────────────────────────────────
# (а) Примерка ничего не меняет
# ─────────────────────────────────────────────────────────────────────────

@_scenario
def test_end_freeze_on_copy_does_not_mutate_original():
    from app.services import subscription_perks as perks
    sub = _paused_sub()
    snap = copy.deepcopy(sub)
    trial, fact, ext = perks.end_freeze(copy.deepcopy(sub), _now())
    assert sub == snap and sub["isFrozen"] is True, "end_freeze на копии изменил оригинал"
    assert trial["isFrozen"] is False and (fact, ext) == (10.0, 10.0), (fact, ext)


@_scenario
def test_trial_leaves_owner_pool_and_db_untouched():
    """Примерка подставляет пул только на время расчёта: после неё у владельца
    тот же объект пула, изменений для записи нет, в базе пауза стоит."""
    from sqlalchemy import inspect
    from app.api.v1.bookings import routes
    from app.services.pricing import PricingService
    s = H._db()
    u = _client(s, _paused_sub())
    real = u.subscription
    snap = copy.deepcopy(real)
    hit = routes._pause_lift_trial(s, PricingService(s), u, "balance", [("room_1", H._day(2).replace(hour=12), 60, "individual")])
    assert hit is not None and hit[1] == 0 and hit[0]["isFrozen"] is False, hit
    assert u.subscription is real and real == snap, "примерка оставила подменённый пул"
    assert not inspect(u).attrs.subscription.history.has_changes(), "примерка готовит запись пула в базу"
    s.commit()
    assert _frozen(s, u) and not _events(s, u), "примерка сняла паузу в базе"


@_scenario
def test_trial_failure_keeps_pause_and_restores_pool():
    from app.api.v1.bookings import routes
    from app.services.pricing import PricingService
    s = H._db()
    u = _client(s, _paused_sub())
    real = u.subscription

    class Boom(PricingService):
        def calculate_price(self, *a, **kw):
            raise RuntimeError("сбой движка")
    assert routes._pause_lift_trial(s, Boom(s), u, "balance", [("room_1", H._day(2), 60, "individual")]) is None
    assert u.subscription is real and P.get(u.subscription, "is_frozen") is True


# ─────────────────────────────────────────────────────────────────────────
# Сценарии владельца
# ─────────────────────────────────────────────────────────────────────────

@_scenario
def test_pause_30_days_booking_after_10_lifts_and_keeps_20():
    """Пауза 30 дн. (Профи+), через 10 дн. клиент бронирует 1 ч → пауза снята,
    срок +10, осталось 20 дней паузы; бронь часами (заранее — спишет крон)."""
    from fastapi import BackgroundTasks
    from app.services import billing_defer
    s = H._db()
    u = _client(s, _paused_sub("PRO_PLUS", built_days_ago=15, paused_days_ago=10), tg="777")
    exp0 = P._parse_dt(u.subscription["expiry_date"])
    bt = BackgroundTasks()
    b = _book(s, u, u, days=3, start="12:00", bt=bt)  # чт 08.10 12:00 — дальше суток
    assert not isinstance(b, dict), b
    assert (b.payment_method, b.payment_status, b.hours_deducted, b.final_price) == \
        ("subscription", "pending", 1.0, 0.0), (b.payment_method, b.payment_status, b.hours_deducted, b.final_price)
    pool = _pool(s, u)
    assert pool["isFrozen"] is False and pool["frozenAt"] is None and pool["frozenDaysGranted"] is None
    assert P._parse_dt(pool["expiry_date"]) == exp0 + timedelta(days=10), "срок продлён не на 10 дней"
    assert pool["freezeDaysUsed"] == 10 and pool["freezeDaysLeft"] == 20 and pool["freeze_days_left"] == 20, pool
    assert P.get_float(pool, "remaining_hours") == 42.0, "часы списаны раньше крона"

    ev = _events(s, u)
    assert len(ev) == 1, ev
    e = ev[0]
    m = e.metadata_dump
    assert e.event_type == "subscription_freeze" and e.target_type == "user"
    assert (m["fact_days"], m["extended_days"], m["freeze_days_left"]) == (10.0, 10.0, 20.0), m
    assert (m["booking_date"], m["booking_time"], m["booking_resource"]) == ("2026-10-08", "12:00", "room_1"), m
    assert e.description == ("Пауза снята: клиент забронировал 08.10 12:00, Кабинет 1. "
                             "Срок +10 дн., осталось дней паузы 20"), e.description
    assert str(e.actor_id) == str(u.id) and e.actor_req_role == u.role, "актор — не тот, кто бронировал"

    # Крон T-24ч списывает часы как обычно.
    ok, _reason = billing_defer.settle_pending_charge(s, s.get(Booking, b.id))
    s.commit()
    assert ok
    pool = _pool(s, u)
    assert P.get_float(pool, "remaining_hours") == 41.0 and P.get_float(pool, "used_hours") == 1.0, pool

    # Клиенту — одно сообщение в Telegram, после коммита (фоновая задача).
    with _TgCapture() as tg:
        assert _run_pause_tasks(bt) == 1
    assert tg.sent == [("777", "Ваш абонемент снова активен: пауза снята, потому что вы забронировали "
                               "08.10 12:00. Неиспользованные дни паузы (20) сохранились — их можно "
                               "взять позже через администратора.")], tg.sent


@_scenario
def test_admin_booking_for_client_lifts_pause_with_admin_as_actor():
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub())
    b = _book(s, admin, u)
    assert b.payment_method == "subscription" and not _frozen(s, u)
    ev = _events(s, u)
    assert len(ev) == 1 and str(ev[0].actor_id) == str(admin.id) and ev[0].actor_req_role == "owner"


@_scenario
def test_bonus_covering_booking_keeps_pause():
    """Бонус покрывает бронь целиком → бонус, пауза стоит."""
    from app.models.bonus import Bonus
    from app.services.bonus_service import available_free_hours
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub())
    s.add(Bonus(user_id=str(u.id), type="free_hour", quantity=1.0, status="active",
                expires_at=H.FakeDatetime.now() + timedelta(days=10)))
    s.commit()
    b = _book(s, admin, u)
    assert b.payment_method == "bonus", b.payment_method
    assert _frozen(s, u) and not _events(s, u), "бонусная бронь сняла паузу"
    assert available_free_hours(s, u.id) == 0.0


@_scenario
def test_group_format_outside_plan_keeps_pause():
    """Регулярный — только индивидуальный: групповая бронь идёт деньгами, пауза стоит."""
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub("REGULAR_PRACTITIONER", built_days_ago=5, paused_days_ago=2))
    b = _book(s, admin, u, fmt="group")
    assert b.payment_method == "balance" and b.final_price > 0, (b.payment_method, b.final_price)
    assert _frozen(s, u) and not _events(s, u)


@_scenario
def test_half_hour_left_for_one_hour_booking_keeps_pause():
    """Часов 0,5 при брони 1 ч → бронь деньгами, пауза стоит."""
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub("PRO_PLUS", remaining_hours=0.5))
    b = _book(s, admin, u)
    assert b.payment_method == "balance" and b.final_price > 0, (b.payment_method, b.final_price)
    assert _frozen(s, u) and not _events(s, u)
    assert P.get_float(_pool(s, u), "remaining_hours") == 0.5


@_scenario
def test_expired_even_after_pause_extension_keeps_pause():
    """Срок вышел и с продлением на паузу (+7 дн.) → абонемент не платит, пауза стоит."""
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub("REGULAR_PRACTITIONER", built_days_ago=60, paused_days_ago=20))
    b = _book(s, admin, u)
    assert b.payment_method == "balance", b.payment_method
    assert _frozen(s, u) and not _events(s, u)


@_scenario
def test_explicit_other_method_keeps_pause():
    """Явно выбранный не-клиентский способ (наличные от админа) — пауза стоит."""
    from app.api.v1.bookings import routes
    from app.services.pricing import PricingService
    s = H._db()
    u = _client(s, _paused_sub())
    assert routes._pause_lift_trial(s, PricingService(s), u, "cash",
                                   [("room_1", H._day(2).replace(hour=12), 60, "individual")]) is None


@_scenario
def test_legacy_pause_extends_by_full_fact():
    """Старая пауза (до 01.10, без frozen_days_granted): как end_freeze — срок
    продлевается на полный факт паузы (40 дн.)."""
    s = H._db()
    admin = _admin(s)
    u = _client(s, _legacy_paused_sub(built_days_ago=50, paused_days_ago=40))
    exp0 = P._parse_dt(u.subscription["expiry_date"])
    b = _book(s, admin, u)
    assert b.payment_method == "subscription", b.payment_method
    pool = _pool(s, u)
    assert pool["isFrozen"] is False and P._parse_dt(pool["expiry_date"]) == exp0 + timedelta(days=40), pool
    ev = _events(s, u)
    assert len(ev) == 1 and ev[0].metadata_dump["extended_days"] == 40.0, [e.metadata_dump for e in ev]


@_scenario
def test_cart_two_slots_lifts_once():
    from app.api.v1.bookings import routes
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub())
    day = H._day(2).strftime("%Y-%m-%d")
    out = routes.create_multi_slot_booking(session=s, current_user=admin, data=routes.MultiSlotRequest(
        slots=[routes.MultiSlotItem(resource_id="room_1", location_id="unbox_uni", date=day, start_time="12:00"),
               routes.MultiSlotItem(resource_id="room_2", location_id="unbox_uni", date=day, start_time="14:00")],
        payment_method="balance", target_user_id=str(u.id)))
    s.commit()
    assert out["pause_lifted"] is True
    assert [b.payment_method for b in out["bookings"]] == ["subscription", "subscription"]
    assert not _frozen(s, u)
    ev = _events(s, u)
    assert len(ev) == 1 and ev[0].metadata_dump["slots"] == 2, "корзина сняла паузу не один раз"


@_scenario
def test_series_quote_shows_hours_and_create_lifts_once():
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub())
    req = routes.RecurringBookingRequest(
        resource_id="room_1", location_id="unbox_uni", start_time="12:00", duration=60, format="individual",
        payment_method="balance", first_date=H._day(2).strftime("%Y-%m-%d"), occurrences=3,
        target_user_id=str(u.id))
    q = routes.quote_recurring_booking(session=s, data=req, current_user=admin)
    assert q["pause_lift"] is True and q["total_hours"] == 3.0 and q["total_money"] == 0.0, q
    assert [i["method"] for i in q["items"]] == ["subscription"] * 3
    s.commit()
    assert _frozen(s, u) and not _events(s, u), "примерка серии сняла паузу"

    out = routes.create_recurring_booking(background_tasks=BackgroundTasks(), session=s, data=req,
                                          current_user=admin)
    s.commit()
    assert out["created"] == 3 and out["pause_lifted"] is True, out
    rows = s.exec(select(Booking).where(Booking.user_uuid == u.id)).all()
    assert sorted(r.payment_method for r in rows) == ["subscription"] * 3
    assert not _frozen(s, u) and len(_events(s, u)) == 1, "серия сняла паузу не один раз"


@_scenario
def test_extend_series_lifts_pause():
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.services import subscription_perks as perks
    s = H._db()
    admin = _admin(s)
    from app.services.subscription_sale import build_subscription
    u = _client(s, build_subscription("PRO_PLUS", _now() - timedelta(days=5)))
    out = routes.create_recurring_booking(
        background_tasks=BackgroundTasks(), session=s, current_user=admin,
        data=routes.RecurringBookingRequest(
            resource_id="room_1", location_id="unbox_uni", start_time="12:00", duration=60,
            format="individual", payment_method="balance", first_date=H._day(2).strftime("%Y-%m-%d"),
            occurrences=2, target_user_id=str(u.id)))
    s.commit()
    gid = out["recurring_group_id"]
    uu = s.get(User, u.id)
    uu.subscription = perks.start_freeze(uu.subscription, _now() - timedelta(days=3))
    s.add(uu)
    s.commit()
    assert _frozen(s, u)
    ext = routes.extend_recurring_series(group_id=gid, payload={"add_occurrences": 2}, session=s,
                                         current_user=admin)
    s.commit()
    assert ext["created"] == 2 and ext["pause_lifted"] is True, ext
    rows = s.exec(select(Booking).where(Booking.recurring_group_id == gid)).all()
    assert [r.payment_method for r in rows] == ["subscription"] * 4
    assert not _frozen(s, u) and len(_events(s, u)) == 1


# ─────────────────────────────────────────────────────────────────────────
# Откат: бронь не создалась — пауза стоит
# ─────────────────────────────────────────────────────────────────────────

@_scenario
def test_failed_cart_rolls_back_pause_lift():
    """Корзина: первый слот пошёл бы часами (пауза снята в памяти), второй —
    деньгами, а денег нет → 400 → всё откатывается, пауза стоит."""
    from app.api.v1.bookings import routes
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub("REGULAR_PRACTITIONER", built_days_ago=5, paused_days_ago=2), balance=0.0)
    day = H._day(0).strftime("%Y-%m-%d")
    out = H._call(routes.create_multi_slot_booking, session=s, current_user=admin, data=routes.MultiSlotRequest(
        slots=[routes.MultiSlotItem(resource_id="room_1", location_id="unbox_uni", date=day, start_time="15:00"),
               routes.MultiSlotItem(resource_id="room_1", location_id="unbox_uni", date=day, start_time="17:00",
                                    format="group")],
        payment_method="balance", target_user_id=str(u.id)))
    assert out == {"http": 400}, out
    s.rollback()
    assert _frozen(s, u) and not _events(s, u), "пауза снялась без брони"
    assert not s.exec(select(Booking).where(Booking.user_uuid == u.id)).all()
    assert P.get_float(_pool(s, u), "remaining_hours") == 20.0


@_scenario
def test_failed_single_booking_rolls_back_pause_lift():
    """Сбой одиночной брони уже после снятия паузы (500) → пауза стоит."""
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub())
    saved = P.stamp_booking

    def boom(*a, **kw):
        raise RuntimeError("сбой после снятия паузы")
    P.stamp_booking = boom
    try:
        out = _book(s, admin, u)
    finally:
        P.stamp_booking = saved
    assert out == {"http": 500}, out
    assert _frozen(s, u) and not _events(s, u), "пауза снялась без брони"


# ─────────────────────────────────────────────────────────────────────────
# (д) Гонка: паузу уже сняли (крон / администратор) — второй раз не снимаем
# ─────────────────────────────────────────────────────────────────────────

@_scenario
def test_recheck_after_lock_sees_pause_already_lifted():
    """В кэше сессии пауза ещё стоит, а в базе её уже снял крон: замок
    перечитывает строку — снимать нечего, события нет, бронь часами."""
    from sqlalchemy import update
    from app.services import subscription_perks as perks
    s = H._db()
    admin = _admin(s)
    u = _client(s, _paused_sub())
    exp0 = P._parse_dt(u.subscription["expiry_date"])
    lifted, _f, _e = perks.end_freeze(copy.deepcopy(u.subscription), _now())
    s.execute(update(User).where(User.id == u.id).values(subscription=lifted)
              .execution_options(synchronize_session=False))
    assert P.get(u.subscription, "is_frozen") is True  # кэш устарел
    b = _book(s, admin, u)
    assert b.payment_method == "subscription", b.payment_method
    assert not _events(s, u), "сняли паузу второй раз"
    assert P._parse_dt(_pool(s, u)["expiry_date"]) == exp0 + timedelta(days=10), "срок продлён дважды"


# ─────────────────────────────────────────────────────────────────────────
# Telegram-бот: показ цены и ответ после брони
# ─────────────────────────────────────────────────────────────────────────

@_scenario
def test_bot_preview_and_confirm_mention_pause():
    from app.api.v1 import telegram as tgmod
    from app.models.location import Location
    s = H._db()
    s.add(Location(id="unbox_uni", name="Unbox Uni", address="Абусеридзе 38"))
    s.commit()
    u = _client(s, _paused_sub(), tg="4242")
    edits = []
    saved = (tgmod._edit, tgmod._answer_callback)
    tgmod._edit = lambda chat_id, message_id, text, **kw: edits.append(text) or True
    tgmod._answer_callback = lambda *a, **kw: None
    try:
        with _TgCapture() as tg:
            tgmod._book_step_confirm(s, "cb", 4242, 1, u, "unbox_uni", "i", "20261007", 0, "1200", 60)
            assert "Абонемент: списание 1 ч" in edits[-1], edits[-1]
            assert "Абонемент на паузе — после брони пауза снимется" in edits[-1], edits[-1]
            s.commit()
            assert _frozen(s, u), "показ цены в боте снял паузу"
            tgmod._book_do_confirm(s, "cb", 4242, 1, s.get(User, u.id), "unbox_uni", "i", "20261007", 0, "1200", 60)
    finally:
        tgmod._edit, tgmod._answer_callback = saved
    assert "Бронь подтверждена" in edits[-1] and "Списано с абонемента." in edits[-1], edits[-1]
    assert ("Ваш абонемент снова активен: пауза снята, потому что вы забронировали 07.10 12:00. "
            "Неиспользованные дни паузы (20) сохранились") in edits[-1], edits[-1]
    assert not _frozen(s, u) and len(_events(s, u)) == 1
    assert not tg.sent, "бот отправил второе сообщение вместо ответа в чате"


# ─────────────────────────────────────────────────────────────────────────
# Исходники: кто зовёт помощника, а кто — нет
# ─────────────────────────────────────────────────────────────────────────

ROUTES = "backend/app/api/v1/bookings/routes.py"


def test_every_create_path_calls_lift_helper():
    """(в) Одиночная бронь, корзина, серия, продление серии — через общий
    помощник; примерка серии и бот — через примерку без записи."""
    src = _read(ROUTES)
    for fn in ("def create_booking(", "def create_multi_slot_booking(", "def create_recurring_booking(",
               "def extend_recurring_series("):
        body = _body(src, fn)
        assert body.count("_lift_pause_for_booking(") == 1, f"{fn}: нет (или не один) вызов снятия паузы"
        i = body.index("_lift_pause_for_booking(")
        assert i < body.index("calculate_price("), f"{fn}: паузу снимают после расчёта цены"
        assert "_notify_pause_lifted(" in body and body.index("session.commit()", i) < body.index("_notify_pause_lifted("), \
            f"{fn}: сообщение клиенту не после коммита"
    one = _body(src, "def create_booking(")
    assert "session.info[PAUSE_LIFT_INFO_KEY] = _pause_lift" in one
    assert one.index("session.commit()") < one.index("session.info[PAUSE_LIFT_INFO_KEY]")
    quote = _body(src, "def quote_recurring_booking(", "def create_recurring_booking(")
    assert "_pause_lift_trial(" in quote and "_pool_swapped(" in quote
    assert "_lift_pause_for_booking(" not in quote, "примерка серии снимает паузу"
    tg = _read("backend/app/api/v1/telegram.py")
    prev = _body(tg, "def _book_step_confirm(", "\ndef ")
    assert "_pause_lift_trial(" in prev and "_lift_pause_for_booking(" not in prev
    conf = _body(tg, "def _book_do_confirm(", "\ndef ")
    assert "create_booking(" in conf and "session.info.pop(PAUSE_LIFT_INFO_KEY, None)" in conf
    assert conf.count("session.rollback()") >= 2, "бот не откатывает сессию после отказа брони"


def test_modification_paths_never_lift_pause():
    """(г) Перенос, продление брони, «На абонемент», отмена, правки брони и
    «Закрыть кабинет» паузу не снимают."""
    src = _read(ROUTES)
    for fn in ("def reschedule_booking(", "def reschedule_booking_series(", "def extend_booking(",
               "def _convert_booking_to_subscription(", "def convert_booking_to_subscription(",
               "def cancel_booking(", "def cancel_recurring_bookings(", "def trim_booking(",
               "def shorten_booking(", "def split_booking(", "def change_booking_format(",
               "def set_booking_price(", "def add_booking_extras(", "def apply_bonus_hour(",
               "def approve_booking(", "def reject_booking("):
        body = _body(src, fn, "\ndef ")
        for bad in ("_lift_pause_for_booking", "_pause_lift_trial", "end_freeze"):
            assert bad not in body, f"{fn}: {bad} — эта правка не должна снимать паузу"
    maint = _read("backend/app/api/v1/maintenance.py")
    assert "_lift_pause_for_booking" not in maint and "end_freeze" not in maint
    assert src.count("_lift_pause_for_booking(") == 5, "лишний/пропавший вызов снятия паузы (4 пути + определение)"


def test_lift_under_row_lock_with_recheck():
    """(д) Снятие — под замком строки клиента, с перечитыванием из базы и
    перепроверкой «пауза ещё стоит»; без коммита (коммитит создание брони)."""
    src = _read(ROUTES)
    h = _body(src, "def _lift_pause_for_booking(", "\ndef ")
    lock = h.index(".with_for_update()")
    pop = h.index("populate_existing=True")
    recheck = h.index('if not subscription_pool.get(locked.subscription, "is_frozen", False)')
    trial = h.index("_pause_lift_trial(")
    lift = h.index("subscription_perks.end_freeze(locked.subscription, now)")
    assert lock < pop < recheck < trial < lift, "порядок: замок → перепроверка → примерка → снятие"
    assert "commit()" not in h.replace("commit=False", ""), "помощник коммитит раньше брони"


def test_trial_rules_and_event_shape():
    """(б) Снимаем только если «пошла бы часами» по тем же правилам; (е)
    событие subscription_freeze / AutoUnfreezeOnBooking тем же коммитом."""
    src = _read(ROUTES)
    t = _body(src, "def _pause_lift_trial(", "\ndef ")
    assert "copy.deepcopy(sub)" in t and "subscription_perks.end_freeze(" in t, "примерка не на копии пула"
    assert "subscription_pool.is_active(trial, now)" in t, "нет проверки срока после продления"
    assert "calculate_price(" in t and "_resolve_with_bonus(" in t and "consume=False" in t
    assert 'method == "subscription" and quote.applied_rule == "SUBSCRIPTION"' in t
    sw = _body(src, "def _pool_swapped(", "\ndef ")
    assert "session.no_autoflush" in sw and "finally:" in sw and "owner.subscription = real" in sw
    h = _body(src, "def _lift_pause_for_booking(", "\ndef ")
    assert '"action": "AutoUnfreezeOnBooking"' in h and 'event_type="subscription_freeze"' in h
    assert "commit=False" in h and "actor_id=(actor.id" in h
    for k in ("fact_days", "extended_days", "freeze_days_left", "booking_date", "booking_time", "booking_resource"):
        assert f'"{k}"' in h, f"в событии нет {k}"
    tl = _read("backend/app/services/timeline.py")
    assert "commit: bool = True" in tl and "if not commit:" in tl


def test_tg_message_text_and_no_crash():
    """Текст клиенту — как у владельца; сбой Telegram бронь не ломает."""
    from app.api.v1.bookings import routes
    info = {"booking_when": "05.10 14:00", "freeze_days_left": 6.0}
    assert routes.pause_lift_client_text(info) == (
        "Ваш абонемент снова активен: пауза снята, потому что вы забронировали 05.10 14:00. "
        "Неиспользованные дни паузы (6) сохранились — их можно взять позже через администратора.")
    assert routes.pause_lift_client_text({"booking_when": "05.10 14:00", "freeze_days_left": 0}) == \
        "Ваш абонемент снова активен: пауза снята, потому что вы забронировали 05.10 14:00."
    from app.services.telegram import telegram_service
    saved = telegram_service.send_message

    def boom(*a, **kw):
        raise RuntimeError("Telegram лежит")
    telegram_service.send_message = boom
    try:
        routes._send_pause_lift_tg("1", "x")  # не бросает
    finally:
        telegram_service.send_message = saved


# ─────────────────────────────────────────────────────────────────────────
# Экран: мастер брони (компьютер, телефон) показывает абонемент на паузе
# покрывающим и пишет, что пауза снимется
# ─────────────────────────────────────────────────────────────────────────

NOTE = "Абонемент на паузе — после брони пауза снимется, неиспользованные дни паузы сохранятся"


def test_frontend_wizards_lift_pause_and_show_note():
    pp = _read("src/utils/paymentPriority.ts")
    assert f"export const PAUSE_LIFT_NOTE = '{NOTE}';" in pp
    assert "const paused = life === 'frozen' && !!opts.liftPause;" in pp
    assert "if (paused && pauseLiftExpired(sub, opts.now))" in pp, "экран не проверяет срок после снятия паузы"
    assert "const sub = opts.sub.paused ? { ...opts.sub, active: subCovers && !bonusCovers } : opts.sub;" in pp
    assert "export function pauseLiftNote(" in pp
    sub = _read("src/utils/subscription.ts")
    assert "export function expiryAfterPauseLift(" in sub and "Math.min(factDays, granted)" in sub, \
        "срок после снятия паузы на экране не как у end_freeze"
    desk = _read("src/components/Wizard/ConfirmationStep.tsx")
    assert "liftPause: !isRescheduling," in desk, "десктоп: перенос не должен обещать снятие паузы"
    assert "const pauseNote = pauseLiftNote(plan, payMethod, isSeries);" in desk and "{pauseNote && (" in desk
    mob = _read("src/pages/mobile/MobileCheckout.tsx")
    assert "liftPause: true," in mob
    assert "const pauseNote = pauseLiftNote(plan, payMethod, isSeries);" in mob and "{pauseNote && (" in mob
    crm = _read("src/pages/MyBookingsPage.tsx")
    assert "liftPause: true," in crm and "{PAUSE_LIFT_NOTE}" in crm
    chess = _read("src/components/admin/AdminChessboardView.tsx")
    assert "liftPause: true" in chess and "{pauseHint && (" in chess, "шахматка: нет подсказки админу"


def test_frontend_texts_no_longer_promise_balance_while_paused():
    """Раньше: «Пока абонемент на паузе, брони оплачиваются с баланса» — теперь
    это неправда (бронь часами снимает паузу)."""
    card = _read("src/components/SubscriptionCard.tsx")
    assert "брони оплачиваются с баланса" not in card
    assert "пауза снимется сама — неиспользованные дни паузы сохранятся" in card
    admin = _read("src/pages/admin/UserDetails.tsx")
    assert "брони идут с баланса" not in admin and "бронь часами абонемента снимет" in admin
    assert "пауза снимется сама — неиспользованные дни паузы сохранятся" in _read("src/pages/mobile/MobileSubscription.tsx")


def _tools():
    """node ≥ 22.6 и esbuild из node_modules — или None (тогда проверка в node пропускается)."""
    import shutil
    import subprocess
    node = shutil.which("node")
    esb = os.path.join(_REPO, "node_modules", ".bin", "esbuild")
    if not node or not os.path.exists(esb):
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    return (node, esb) if (major, minor) >= (22, 6) else None


def test_frontend_payment_plan_in_node():
    """Логика экрана на живых примерах (paymentPriority.ts, собранный esbuild)."""
    import json
    import subprocess
    import tempfile
    tools = _tools()
    if not tools:
        return  # нет node/esbuild — проверки исходников выше всё равно идут
    node, esb = tools
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "pp.mjs")
        r = subprocess.run([esb, os.path.join(_REPO, "src/utils/paymentPriority.ts"), "--bundle", "--format=esm",
                            "--platform=node", f"--outfile={out}", "--log-level=error"],
                           capture_output=True, text=True, timeout=120)
        assert r.returncode == 0, f"esbuild упал: {r.stderr[:600]}"
        script = """
const m = await import(process.argv[1]);
const now = new Date('2026-10-05T06:00:00Z');
const D = 86400000;
const iso = (t) => new Date(t).toISOString().replace('Z', '');
const base = { planId: 'PRO_PLUS', name: 'Профи+', totalHours: 40, bonusHours: 2, remainingHours: 42,
  includedFormats: ['individual', 'group', 'intervision'], expiryDate: iso(now.getTime() + 30 * D),
  isFrozen: true, frozenAt: iso(now.getTime() - 10 * D), frozenDaysGranted: 30, freezeCount: 1,
  extraKind: 'capsule', extraHoursTotal: 10, extraHoursRemaining: 10 };
const hrs = (sub, extra = {}) => m.subscriptionHours(sub, { format: 'individual', bookingDate: now, bookings: [],
  now, resourceKind: 'cabinet', liftPause: true, ...extra });
const plan = (h, bonus = 0, extra = {}) => m.paymentPlan({ hours: 1, bonusHours: bonus, sub: h, moneyPrice: 20, ...extra });
const h = hrs(base);
const p = plan(h);
const pb = plan(h, 1);
const half = plan(hrs({ ...base, remainingHours: 0.5 }), 0.5);
const exp = hrs({ ...base, expiryDate: iso(now.getTime() - 30 * D), frozenAt: iso(now.getTime() - 20 * D), frozenDaysGranted: 7 });
const legacy = hrs({ ...base, expiryDate: iso(now.getTime() - 5 * D), frozenAt: iso(now.getTime() - 40 * D), frozenDaysGranted: undefined });
const grp = hrs({ ...base, includedFormats: ['individual'] }, { format: 'group' });
const series = plan(h, 0, { isSeries: true });
console.log(JSON.stringify({
  cover: [h.ok, h.paused, p.subCovers, p.auto, p.sub.active, m.pauseLiftNote(p, 'subscription')],
  noLift: (({ ok, reason }) => [ok, reason])(m.subscriptionHours(base, { format: 'individual', bookingDate: now, bookings: [], now })),
  bonus: [pb.auto, pb.sub.active, m.pauseLiftNote(pb, 'bonus'), m.pauseLiftNote(pb, 'subscription')],
  half: [half.subCovers, half.sub.active, half.bonusPartial, half.auto, m.pauseLiftNote(half, half.auto)],
  expired: [exp.ok, exp.reason],
  legacy: [legacy.ok, legacy.paused],
  group: [grp.ok, grp.reason, m.pauseLiftNote(plan(grp), 'balance')],
  series: m.pauseLiftNote(series, 'balance', true),
  note: m.PAUSE_LIFT_NOTE,
}));
"""
        r = subprocess.run([node, "--input-type=module", "-e", script, out], capture_output=True, text=True,
                           timeout=60)
        assert r.returncode == 0, f"node упал: {r.stderr[:600]}"
        res = json.loads(r.stdout.strip().splitlines()[-1])
    assert res["note"] == NOTE
    assert res["cover"] == [True, True, True, "subscription", True, NOTE], res["cover"]
    assert res["noLift"] == [False, "Абонемент заморожен"], "без liftPause (перенос, карточки) — как раньше"
    assert res["bonus"] == ["bonus", False, None, NOTE], res["bonus"]
    assert res["half"] == [False, False, True, "bonus", None], res["half"]
    assert res["expired"] == [False, "Абонемент на паузе, а срок действия уже закончился"], res["expired"]
    assert res["legacy"] == [True, True], "старая пауза: срок продлевается на весь факт"
    assert res["group"] == [False, "Абонемент только для индивидуальной работы", None], res["group"]
    assert res["series"] == NOTE


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
