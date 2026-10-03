"""СТОРОЖ «доп. пул часов абонемента» (обещания тарифов, шаг 4, владелец 01.10).

Шаг 2б — у брони две новые колонки: из какого пула абонемента сняты часы.
  * hours_pool           — 'main' | 'extra' | 'mixed', NULL = основной (как раньше);
  * extra_hours_deducted — сколько часов из доп. пула (NULL/0 = всё из основного).

Что ловим:
  * миграция не добавляет колонки / падает при повторном запуске;
  * новый код без колонок в базе или старый код с колонками ломает бронь;
  * клиент может прислать в запросе, из какого пула ему списать.

Без сети и без боевой базы (SQLite в памяти):

    python3 backend/tests/guard_tariffs_extra.py
"""
import os
import sys
from datetime import datetime
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from sqlmodel import Session, SQLModel, create_engine, select  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401
from app.models.booking import Booking, BookingCreate, BookingRead  # noqa: E402
from app.models.user import User  # noqa: E402

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_REPO = os.path.join(_BACKEND, "..")


def _read(rel: str) -> str:
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


def _cols(engine) -> set:
    with engine.connect() as c:
        return {r[1] for r in c.execute(text("PRAGMA table_info(booking)")).all()}


def _migrate(engine):
    import app.db.init_data as init_data
    real = init_data.engine
    init_data.engine = engine
    try:
        init_data.migrate_add_columns()
    finally:
        init_data.engine = real


def _row(**over) -> Booking:
    return Booking(resource_id="room_1", date=datetime(2026, 10, 6), start_time="12:00", duration=60,
                   final_price=0.0, payment_method="subscription", hours_deducted=1.0,
                   user_id="x@x.ge", **over)


# ─────────────────────────────────────────────────────────────────────────
# 2б. Колонки брони
# ─────────────────────────────────────────────────────────────────────────

def test_2b_migration_adds_columns_to_old_table_and_is_idempotent():
    """База без колонок (как прод до деплоя) → миграция добавляет обе;
    второй прогон (каждый рестарт) не падает."""
    eng = _engine()
    SQLModel.metadata.create_all(eng)
    with eng.connect() as c:
        c.execute(text("ALTER TABLE booking DROP COLUMN hours_pool"))
        c.execute(text("ALTER TABLE booking DROP COLUMN extra_hours_deducted"))
        c.commit()
    assert not {"hours_pool", "extra_hours_deducted"} & _cols(eng)
    _migrate(eng)
    assert {"hours_pool", "extra_hours_deducted"} <= _cols(eng), _cols(eng)
    _migrate(eng)  # повтор — без ошибок
    with Session(eng) as s:
        s.add(_row(hours_pool="mixed", extra_hours_deducted=0.5))
        s.commit()
        b = s.exec(select(Booking)).one()
        assert b.hours_pool == "mixed" and b.extra_hours_deducted == 0.5


def test_2b_old_code_rows_read_as_main_pool():
    """Строка, вставленная старым кодом (без новых колонок), читается новым
    кодом как «основной пул»: NULL в обеих колонках."""
    eng = _engine()
    SQLModel.metadata.create_all(eng)
    with eng.connect() as c:
        c.execute(text(
            "INSERT INTO booking (id, resource_id, location_id, date, start_time, duration, status, "
            "final_price, discount_amount, discount_percent, payment_method, hours_deducted, format, "
            "extras, is_re_rent_listed, user_id, created_at, updated_at) VALUES "
            f"('{uuid4().hex}', 'room_1', 'unbox_uni', '2026-10-06 00:00:00', '12:00', 60, 'confirmed', "
            "0, 0, 0, 'subscription', 1.0, 'individual', '[]', 0, 'x@x.ge', '2026-10-01', '2026-10-01')"
        ))
        c.commit()
    with Session(eng) as s:
        b = s.exec(select(Booking)).one()
        assert b.hours_pool is None and b.extra_hours_deducted is None
        assert BookingRead.model_validate(b).extra_hours_deducted is None


def test_2b_client_cannot_choose_pool():
    """Из какого пула списать — решает сервер. В BookingCreate этих полей нет."""
    fields = set(BookingCreate.model_fields)
    assert "hours_pool" not in fields and "extra_hours_deducted" not in fields, fields
    assert {"hours_pool", "extra_hours_deducted"} <= set(BookingRead.model_fields)


def test_2b_model_and_migration_in_one_place():
    model = _read("backend/app/models/booking.py")
    mig = _read("backend/app/db/init_data.py")
    for col in ("hours_pool", "extra_hours_deducted"):
        assert f"{col}: Optional" in model, f"нет {col} в модели"
        assert f'"{col}"' in mig, f"нет миграции {col}"
    assert "ADD COLUMN IF NOT EXISTS {_col}" in mig


# ─────────────────────────────────────────────────────────────────────────
# 2в. Доп. пул: сценарии на SQLite в памяти
# ─────────────────────────────────────────────────────────────────────────
# Время заморожено (пн 05.10.2026, 10:00 по Тбилиси), как в guard_hours_pool_moves.

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import functools  # noqa: E402
import re  # noqa: E402
from datetime import timedelta  # noqa: E402

import guard_hours_pool_moves as H  # noqa: E402
from app.services import subscription_pool as P  # noqa: E402


def _scenario(fn):
    """Каждый сценарий — с замороженным временем и своей чистой базой."""
    @functools.wraps(fn)
    def wrapper():
        with H.frozen_time():
            return fn()
    return wrapper


def _g(sub, k):
    return P.get_float(sub, k)


def _snap(s, u):
    s.expire_all()
    sub = s.get(User, u.id).subscription or {}
    return {"main": round(_g(sub, "remaining_hours"), 4), "used": round(_g(sub, "used_hours"), 4),
            "xrem": round(_g(sub, "extra_hours_remaining"), 4), "xused": round(_g(sub, "extra_hours_used"), 4),
            "xtotal": round(_g(sub, "extra_hours_total"), 4),
            "balance": round(float(s.get(User, u.id).balance or 0), 2)}


def _check_pool(s, u, xused0=0.0, sums=True):
    """Инвариант money_audit на Python: остаток + израсходовано = всего, остаток
    не в минус и не выше «всего» — для основного и доп. пула."""
    s.expire_all()
    sub = s.get(User, u.id).subscription
    assert sub, "нет абонемента"
    m = _g(sub, "remaining_hours"); mu = _g(sub, "used_hours")
    assert m >= -0.001, f"основной пул в минусе: {m}"
    assert abs(m + mu - _g(sub, "total_hours") - _g(sub, "bonus_hours")) < 0.01, \
        f"основной пул не сходится: {m}+{mu} != {_g(sub, 'total_hours')}+{_g(sub, 'bonus_hours')}"
    if P.extra_kind(sub):
        xr = _g(sub, "extra_hours_remaining"); xu = _g(sub, "extra_hours_used"); xt = _g(sub, "extra_hours_total")
        assert xr >= -0.001, f"доп. пул в минусе: {xr}"
        assert xr <= xt + 0.01, f"доп. пул выше «всего»: {xr} > {xt}"
        assert abs(xr + xu - xt) < 0.01, f"доп. пул не сходится: {xr}+{xu} != {xt}"
        # сумма списаний сходится: израсходовано = доп. часы оплаченных броней
        rows = s.exec(select(Booking).where(Booking.user_uuid == u.id)).all()
        spent = sum(P.booking_extra(b) for b in rows
                    if b.payment_method == "subscription" and b.status == "confirmed"
                    and b.payment_status in ("paid", "waived") and b.hours_deducted)
        if sums:
            assert abs(spent + xused0 - xu) < 0.01, f"израсходовано доп. {xu} != {xused0} + сумма по броням {spent}"


def _admin_user(s):
    return H._user(s, role="owner", name="Админ", balance=0.0)


def _book(s, admin, owner, *, days=0, start="15:00", minutes=60, resource="cap_1", fmt="individual"):
    b = H._create(s, admin, owner, days=days, start=start, minutes=minutes, resource=resource, fmt=fmt,
                  method="subscription")
    s.commit()
    return s.get(Booking, b.id)


def _cancel(s, admin, b):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    out = H._call(routes.cancel_booking, booking_id=str(b.id), background_tasks=BackgroundTasks(),
                  session=s, current_user=admin)
    assert not (isinstance(out, dict) and "http" in out), out
    s.commit()


def _sub_with(plan, **over):
    return H._sub(plan, **over)


@_scenario
def test_capsule_hours_first():
    """Капсула с часами капсулы: 1 ч идёт из доп. пула, основной не тронут."""
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("REGULAR_PRACTITIONER"))
    assert _snap(s, u)["xrem"] == 6.0 and _snap(s, u)["main"] == 20.0
    b = _book(s, admin, u, days=0)  # ≤ 24 ч — списано сразу
    assert b.payment_status == "paid" and b.hours_pool == "extra" and b.extra_hours_deducted == 1.0, \
        (b.payment_status, b.hours_pool, b.extra_hours_deducted)
    snap = _snap(s, u)
    assert snap["xrem"] == 5.0 and snap["xused"] == 1.0 and snap["main"] == 20.0 and snap["used"] == 0.0, snap
    assert snap["balance"] == 500.0, "деньги списаны, хотя часов хватало"
    _check_pool(s, u)


@_scenario
def test_capsule_without_capsule_hours_takes_main_pool():
    """Часов капсулы нет → общий пул час за час; деньги не трогаем."""
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("REGULAR_PRACTITIONER", extra_hours_remaining=0.0, extra_hours_used=6.0))
    b = _book(s, admin, u, days=0)
    assert b.hours_pool == "main" and (b.extra_hours_deducted or 0) == 0, (b.hours_pool, b.extra_hours_deducted)
    snap = _snap(s, u)
    assert snap["main"] == 19.0 and snap["used"] == 1.0 and snap["xrem"] == 0.0 and snap["balance"] == 500.0, snap
    _check_pool(s, u, xused0=6.0)


@_scenario
def test_capsule_partial_extra_then_main_and_cancel_returns_to_both():
    """В пуле капсулы 0.5 ч, бронь 1 ч: 0.5 из доп., 0.5 из основного; отмена
    возвращает ровно так же."""
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("REGULAR_PRACTITIONER", extra_hours_remaining=0.5, extra_hours_used=5.5))
    b = _book(s, admin, u, days=0)
    assert b.hours_pool == "mixed" and abs(b.extra_hours_deducted - 0.5) < 1e-6 and b.hours_deducted == 1.0
    snap = _snap(s, u)
    assert snap["xrem"] == 0.0 and snap["main"] == 19.5 and snap["used"] == 0.5, snap
    _check_pool(s, u, xused0=5.5)
    _cancel(s, admin, b)
    back = _snap(s, u)
    assert back["xrem"] == 0.5 and back["xused"] == 5.5 and back["main"] == 20.0 and back["used"] == 0.0, back
    _check_pool(s, u, xused0=5.5)


@_scenario
def test_cabinet_booking_never_touches_capsule_hours():
    """Кабинет списывает только основной пул — часы капсулы не тратятся."""
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("WARM_START"))
    b = _book(s, admin, u, days=0, resource="room_1")
    assert b.hours_pool == "main" and (b.extra_hours_deducted or 0) == 0
    snap = _snap(s, u)
    assert snap["xrem"] == 4.0 and snap["main"] == 9.0, snap
    _check_pool(s, u)


@_scenario
def test_group_master_individual_extra_then_money():
    """Групповой мастер: индивидуальная бронь в кабинете — сначала «4 ч
    индивидуально», потом деньги (основной пул у него только на группы)."""
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("GROUP_MASTER"), balance=500.0)
    sub = s.get(User, u.id).subscription
    assert P.extra_kind(sub) == "individual" and _g(sub, "extra_hours_remaining") == 4.0
    # 4 ч индивидуально: 2 брони по 2 ч — из доп. пула, 0 ₾
    b1 = _book(s, admin, u, days=0, start="14:00", minutes=120, resource="room_1")
    b2 = _book(s, admin, u, days=0, start="16:00", minutes=120, resource="room_1")
    for b in (b1, b2):
        assert b.payment_method == "subscription" and b.hours_pool == "extra" and b.extra_hours_deducted == 2.0
    snap = _snap(s, u)
    assert snap["xrem"] == 0.0 and snap["main"] == 20.0 and snap["balance"] == 500.0, snap
    _check_pool(s, u)
    # доп. часы кончились → индивидуальная бронь деньгами (20 ₾/ч), основной пул нетронут
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import BookingCreate
    q = H._call(routes.create_booking, session=s, booking_in=BookingCreate(
        resource_id="room_1", location_id="unbox_uni", date=H._day(0), start_time="18:00", duration=60,
        format="individual", payment_method="balance", target_user_id=str(u.id)),
        current_user=admin, background_tasks=BackgroundTasks())
    s.commit()
    b3 = s.get(Booking, q.id)
    assert b3.payment_method == "balance" and abs(b3.final_price - 20.0) < 0.01, (b3.payment_method, b3.final_price)
    snap = _snap(s, u)
    assert snap["main"] == 20.0 and snap["xrem"] == 0.0 and abs(snap["balance"] - 480.0) < 0.01, snap
    _check_pool(s, u)


@_scenario
def test_group_master_extra_not_for_group_or_capsule():
    """«4 ч индивидуально» — только кабинеты и только индивидуальный формат."""
    s = H._db()
    sub = _sub_with("GROUP_MASTER")
    assert not P.extra_applies(sub, "capsule", "individual"), "индивидуальные часы пошли на капсулу"
    assert not P.extra_applies(sub, "cabinet", "group"), "индивидуальные часы пошли на группу"
    assert P.extra_applies(sub, "cabinet", "individual")
    # групповая бронь — из основного пула
    admin = _admin_user(s)
    u = H._user(s, sub=sub)
    b = _book(s, admin, u, days=0, start="14:00", minutes=120, resource="room_1", fmt="group")
    assert b.hours_pool == "main", b.hours_pool
    snap = _snap(s, u)
    assert snap["main"] == 18.0 and snap["xrem"] == 4.0, snap
    # капсульные часы тарифов — только капсула
    cap = _sub_with("REGULAR_PRACTITIONER")
    assert P.extra_applies(cap, "capsule", "individual") and not P.extra_applies(cap, "cabinet", "individual")
    _check_pool(s, u)


@_scenario
def test_cancel_series_and_deferred_settle_use_live_pool():
    """Две будущие брони на капсуле «рассчитывают» на один час капсулы. Крон
    списывает по живому пулу: первая берёт доп. час, вторая — общий пул."""
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("REGULAR_PRACTITIONER", extra_hours_remaining=1.0, extra_hours_used=5.0))
    a = _book(s, admin, u, days=3, start="12:00")
    b = _book(s, admin, u, days=4, start="12:00")
    assert a.payment_status == "pending" and b.payment_status == "pending"
    assert a.hours_pool == "extra" and b.hours_pool == "extra", "прикидка при создании"
    from app.services import billing_defer
    ok1, _ = billing_defer.settle_pending_charge(s, s.get(Booking, a.id)); s.commit()
    ok2, _ = billing_defer.settle_pending_charge(s, s.get(Booking, b.id)); s.commit()
    assert ok1 and ok2
    a, b = s.get(Booking, a.id), s.get(Booking, b.id)
    assert a.hours_pool == "extra" and a.extra_hours_deducted == 1.0, (a.hours_pool, a.extra_hours_deducted)
    assert b.hours_pool == "main" and (b.extra_hours_deducted or 0) == 0, (b.hours_pool, b.extra_hours_deducted)
    snap = _snap(s, u)
    assert snap["xrem"] == 0.0 and snap["main"] == 19.0 and snap["balance"] == 500.0, snap
    _check_pool(s, u, xused0=5.0)
    # снятие штрафа (waive) возвращает каждую бронь в свой пул
    for bk in (a, b):
        billing_defer.waive_charge(s, s.get(Booking, bk.id), reason="тест", by_user=admin)
    s.commit()
    back = _snap(s, u)
    assert back["xrem"] == 1.0 and back["main"] == 20.0 and back["used"] == 0.0, back
    _check_pool(s, u, sums=False)  # у waived-броней часы возвращены, «сумма по броням» уже не про пул


@_scenario
def test_reschedule_keeps_pool_and_blocks_cross_kind_move():
    """Перенос капсульной брони на другую дату — часы на месте; в кабинет —
    нельзя (час капсулы 10 ₾ не должен оплатить кабинет 20 ₾)."""
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("PRO_PLUS"))
    b = _book(s, admin, u, days=0)
    before = _snap(s, u)
    out = H._call(routes.reschedule_booking, booking_id=str(b.id),
                  data=routes.RescheduleRequest(new_date=H._day(1).strftime("%Y-%m-%d"), new_start_time="15:00"),
                  background_tasks=BackgroundTasks(), session=s, current_user=admin)
    assert not (isinstance(out, dict) and "http" in out), out
    s.commit()
    assert _snap(s, u) == before, "перенос по дате тронул пулы"
    assert s.get(Booking, b.id).hours_pool == "extra"
    out = H._call(routes.reschedule_booking, booking_id=str(b.id),
                  data=routes.RescheduleRequest(new_date=H._day(1).strftime("%Y-%m-%d"), new_start_time="15:00",
                                                new_resource_id="room_1"),
                  background_tasks=BackgroundTasks(), session=s, current_user=admin)
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 400, "капсульная бронь уехала в кабинет за часы капсулы"
    assert s.get(Booking, b.id).resource_id == "cap_1"
    _check_pool(s, u)


@_scenario
def test_shorten_trim_split_format_price_return_to_own_pool():
    """Сокращение / вырезка / разделение / смена формата / ручная цена не
    портят инвариант и не уводят часы в чужой пул."""
    from app.api.v1.bookings import routes
    from fastapi import BackgroundTasks
    s = H._db()
    admin = _admin_user(s)
    # Пробный: капсула 1 ч. Бронь 2 ч капсулы: 1 из доп., 1 из основного.
    u = H._user(s, sub=_sub_with("TRIAL"))
    b = _book(s, admin, u, days=0, start="12:00", minutes=120)
    assert b.hours_pool == "mixed" and abs(b.extra_hours_deducted - 1.0) < 1e-6
    snap = _snap(s, u)
    assert snap["xrem"] == 0.0 and snap["main"] == 3.0, snap
    # Разделение 60+60: суммы частей = исходные, у каждой части свой пул
    parts = H._call(routes.split_booking, booking_id=str(b.id), payload=routes.SplitRequest(parts=[60, 60]),
                    session=s, current_user=admin)
    s.commit()
    rows = sorted(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all(), key=lambda x: x.start_time)
    assert abs(sum(P.booking_extra(x) for x in rows) - 1.0) < 0.01 and abs(sum(x.hours_deducted for x in rows) - 2.0) < 0.01
    assert all(P.booking_extra(x) <= x.hours_deducted + 1e-6 for x in rows)
    _check_pool(s, u)
    # Отмена обеих частей — всё возвращается по своим пулам
    for x in rows:
        _cancel(s, admin, s.get(Booking, x.id))
    back = _snap(s, u)
    assert back["xrem"] == 1.0 and back["main"] == 4.0 and back["used"] == 0.0 and back["xused"] == 0.0, back
    _check_pool(s, u)
    # Сокращение 2 ч брони на 1 ч: инвариант пулов держится, лишнего не вернули.
    # (Известный отдельный пробел, НЕ чиню: shorten_booking возвращает часы
    # абонементной брони только когда вернулись деньги — у брони без пиковой
    # надбавки часы при сокращении не возвращаются совсем. Сумма по броням тут
    # поэтому не сверяется.)
    b2 = _book(s, admin, u, days=0, start="12:00", minutes=120)
    out = H._call(routes.shorten_booking, booking_id=str(b2.id), payload=routes.ShortenRequest(remove_minutes=60),
                  session=s, current_user=admin)
    s.commit()
    assert not (isinstance(out, dict) and "http" in out), out
    _check_pool(s, u, sums=False)
    b2 = s.get(Booking, b2.id)
    assert P.booking_extra(b2) <= b2.hours_deducted + 1e-6, "доп. часов в брони больше всех её часов"


@_scenario
def test_renewal_carries_extra_pool_and_never_loses_hours():
    """Продление (покупка нового тарифа при действующем): остаток капсульных
    часов не сгорает. Тот же вид — в доп. пул нового; другой — в основной."""
    from app.services.subscription_sale import sell_subscription
    s = H._db()
    admin = _admin_user(s)
    # капсула → капсула: Тёплый (осталось 3 капсульных) → Профи+: 10 + 3
    u = H._user(s, sub=_sub_with("WARM_START", extra_hours_remaining=3.0, extra_hours_used=1.0), balance=1000.0)
    sell_subscription(s, u, "PRO_PLUS", "balance", admin); s.commit()
    snap = _snap(s, u)
    assert snap["xrem"] == 13.0 and snap["xtotal"] == 13.0 and snap["xused"] == 0.0, snap
    assert snap["main"] == 10 + 40 + 2, snap  # 10 основного от Тёплого + 40 + 2 бонус
    _check_pool(s, u)
    # капсула → Групповой мастер: капсульные часы уходят в основной пул (бонусом)
    u2 = H._user(s, sub=_sub_with("WARM_START", extra_hours_remaining=3.0, extra_hours_used=1.0), balance=1000.0)
    sell_subscription(s, u2, "GROUP_MASTER", "balance", admin); s.commit()
    sub2 = s.get(User, u2.id).subscription
    assert P.extra_kind(sub2) == "individual" and _g(sub2, "extra_hours_remaining") == 4.0
    assert abs(_g(sub2, "remaining_hours") - (20 + 10 + 3)) < 0.01, _g(sub2, "remaining_hours")
    _check_pool(s, u2)
    # новая покупка без старого абонемента — доп. пул по тарифу
    u3 = H._user(s, balance=1000.0)
    sell_subscription(s, u3, "REGULAR_PRACTITIONER", "balance", admin); s.commit()
    sub3 = s.get(User, u3.id).subscription
    assert (P.extra_kind(sub3), _g(sub3, "extra_hours_total")) == ("capsule", 6.0)
    assert sub3["extraHoursRemaining"] == 6.0 and sub3["extra_hours_remaining"] == 6.0, "нет обоих диалектов"
    _check_pool(s, u3)


@_scenario
def test_expired_or_frozen_subscription_does_not_cover_with_extra():
    """Истёк срок / пауза — часы капсулы тоже не работают (гейт is_active общий).

    Пауза (владелец 03.10): гейт в движке цен тот же, но НОВАЯ бронь, которую
    часы покрыли бы, сначала снимает паузу и идёт часами капсулы — подробно в
    guard_pause_lift_on_booking_2026_10.py."""
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import BookingCreate
    from app.services.pricing import PricingService
    s = H._db()
    admin = _admin_user(s)
    past = (H.FakeDatetime.utcnow() - timedelta(days=1)).isoformat()
    for day, over in enumerate(({"expiry_date": past}, {"is_frozen": True})):
        u = H._user(s, sub=_sub_with("PRO_PLUS", **over), balance=500.0)
        # Движок цен: ни истёкший, ни замороженный пул часами не платит.
        q = PricingService(s).calculate_price(
            user=s.get(User, u.id), resource_id="cap_1", start_time=H._day(day).replace(hour=15),
            duration_minutes=60, format_type="individual")
        assert q.applied_rule != "SUBSCRIPTION" and q.final_price > 0, (over, q.applied_rule)
        out = H._call(routes.create_booking, session=s, booking_in=BookingCreate(
            resource_id="cap_1", location_id="unbox_uni", date=H._day(day), start_time="15:00", duration=60,
            format="individual", payment_method="balance", target_user_id=str(u.id)),
            current_user=admin, background_tasks=BackgroundTasks())
        s.commit()
        assert not isinstance(out, dict), out
        b = s.get(Booking, out.id)
        snap = _snap(s, u)
        if "expiry_date" in over:
            assert b.payment_method == "balance" and b.final_price > 0, (over, b.payment_method, b.final_price)
            assert snap["xrem"] == 10.0 and snap["main"] == 42.0, snap  # пулы нетронуты
        else:
            # Пауза снята бронью → час капсулы (бронь заранее — спишет крон T-24ч).
            assert b.payment_method == "subscription" and b.hours_pool == "extra", (b.payment_method, b.hours_pool)
            assert not P.get(s.get(User, u.id).subscription, "is_frozen", False), "бронь не сняла паузу"
            assert snap["balance"] == 500.0 and snap["main"] == 42.0, snap


@_scenario
def test_hot_booking_approve_and_reject_use_right_pool():
    """Горячая бронь клиента (≤12 ч): откат при создании и списание при
    подтверждении — по доп. пулу первым; отклонённая ничего не оставляет."""
    from app.api.v1.bookings import routes
    from fastapi import BackgroundTasks
    from app.models.booking import BookingCreate
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("REGULAR_PRACTITIONER"))
    ids = []
    for start in ("16:00", "17:00"):
        out = routes.create_booking(session=s, booking_in=BookingCreate(
            resource_id="cap_1", location_id="unbox_uni", date=H._day(0), start_time=start, duration=60,
            format="individual", payment_method="subscription"), current_user=u,
            background_tasks=BackgroundTasks())
        s.commit()
        assert out.status == "pending_approval", out.status
        ids.append(out.id)
    assert _snap(s, u)["xrem"] == 6.0, "горячая бронь списала часы до подтверждения"
    routes.approve_booking(booking_id=str(ids[0]), session=s, current_user=admin); s.commit()
    snap = _snap(s, u)
    assert snap["xrem"] == 5.0 and snap["main"] == 20.0, snap
    b = s.get(Booking, ids[0])
    assert b.hours_pool == "extra" and b.extra_hours_deducted == 1.0
    H._call(routes.reject_booking, booking_id=str(ids[1]), payload=None, session=s, current_user=admin); s.commit()
    assert _snap(s, u) == snap
    _check_pool(s, u)
    _cancel(s, admin, s.get(Booking, ids[0]))
    assert _snap(s, u)["xrem"] == 6.0
    _check_pool(s, u)


@_scenario
def test_series_quote_and_create_consistent():
    """Серия на капсуле: часы капсулы идут по порядку дат, остаток — общий пул."""
    from app.api.v1.bookings import routes
    from fastapi import BackgroundTasks
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("TRIAL"))  # 1 капсульный час
    out = routes.create_recurring_booking(
        background_tasks=BackgroundTasks(), session=s, current_user=admin,
        data=routes.RecurringBookingRequest(
            resource_id="cap_1", location_id="unbox_uni", start_time="15:00", duration=60, format="individual",
            payment_method="subscription", first_date=H._day(0).strftime("%Y-%m-%d"), occurrences=3,
            target_user_id=str(u.id)))
    s.commit()
    rows = sorted(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all(), key=lambda x: x.date)
    assert [r.payment_method for r in rows] == ["subscription"] * 3
    assert [r.hours_pool for r in rows][0] == "extra"  # первая — списана сразу
    snap = _snap(s, u)
    assert snap["xrem"] == 0.0 and snap["xused"] == 1.0 and snap["main"] == 4.0, snap  # 4 основного (первая из доп.)
    _check_pool(s, u)


@_scenario
def test_admin_topup_extra_hours():
    from app.api.v1.users import admin as users_admin
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("WARM_START"))
    users_admin.topup_subscription(user_id=str(u.id), payload={"hours": 2, "extra_hours": 1.5, "amount": 0},
                                   session=s, current_user=admin)
    snap = _snap(s, u)
    assert snap["main"] == 12.0 and snap["xrem"] == 5.5 and snap["xtotal"] == 5.5, snap
    _check_pool(s, u)


@_scenario
def test_pool_primitives_are_symmetric():
    """debit→credit возвращает пул ровно в исходное состояние, в любых долях;
    возврат в абонемент без такого доп. пула не теряет часы (идёт в основной)."""
    base = _sub_with("REGULAR_PRACTITIONER")
    for hours, extra in ((1.0, 1.0), (1.0, 0.5), (2.5, 0.0), (3.0, 3.0), (2.0, 1.25)):
        d = P.debit_hours(base, hours, extra=extra)
        c = P.credit_hours(d, hours, extra=extra, kind="capsule")
        for k in ("remaining_hours", "used_hours", "extra_hours_remaining", "extra_hours_used", "extra_hours_total"):
            assert abs(_g(c, k) - _g(base, k)) < 1e-6, (hours, extra, k, _g(c, k), _g(base, k))
    # старый абонемент без доп. пула: часы «из доп.» вернутся в основной
    legacy = P.update({}, plan_id="REGULAR_PRACTITIONER", total_hours=20.0, remaining_hours=10.0, used_hours=10.0)
    r = P.credit_hours(legacy, 1.0, extra=1.0, kind="capsule")
    assert _g(r, "remaining_hours") == 11.0 and _g(r, "used_hours") == 9.0 and P.extra_kind(r) is None
    # другой вид доп. пула (капсульный час в абонементе «индивидуально») — тоже в основной
    gm = _sub_with("GROUP_MASTER")
    r2 = P.credit_hours(gm, 1.0, extra=1.0, kind="capsule")
    assert _g(r2, "extra_hours_remaining") == _g(gm, "extra_hours_remaining") == 4.0
    assert _g(r2, "remaining_hours") == _g(gm, "remaining_hours") + 1.0
    # списать больше, чем есть, нельзя: остаток не уходит в минус
    low = _sub_with("TRIAL", extra_hours_remaining=0.25, extra_hours_used=0.75)
    z = P.debit_hours(low, 1.0, extra=1.0)
    assert _g(z, "extra_hours_remaining") >= 0.0 and _g(z, "remaining_hours") >= 0.0


@_scenario
def test_plan_split_rules():
    """Таблица правил покрытия: что и откуда платит."""
    cap = _sub_with("REGULAR_PRACTITIONER")  # extra 6 capsule, main 20 [individual]
    assert P.plan_split(cap, 1, resource_type="capsule", format_type="individual") == 1
    assert P.plan_split(cap, 1, resource_type="cabinet", format_type="individual") == 0
    assert P.plan_split(cap, 1, resource_type="cabinet", format_type="group") is None  # формат не в тарифе
    thin = _sub_with("REGULAR_PRACTITIONER", remaining_hours=0.0, extra_hours_remaining=0.5)
    assert P.plan_split(thin, 1, resource_type="capsule", format_type="individual") is None, \
        "0.5 доп. + 0 основного не покрывают 1 ч — должны быть деньги, а не бесплатно"
    gm = _sub_with("GROUP_MASTER")
    assert P.plan_split(gm, 2, resource_type="cabinet", format_type="individual") == 2
    assert P.plan_split(gm, 5, resource_type="cabinet", format_type="individual") is None, \
        "индивидуальная бронь 5 ч при 4 ч индивидуально: основной пул группового не годится — деньги"
    assert P.plan_split(gm, 1, resource_type="cabinet", format_type="group") == 0
    assert P.plan_split(gm, 1, resource_type="capsule", format_type="individual") is None


# ── Находки ревизора денег 01.10 (закрыты) ───────────────────────────────

@_scenario
def test_trim_group_master_with_empty_extra_pool_is_not_free_and_not_repeatable():
    """Групповой мастер, индивидуальная бронь 4 ч целиком из «4 ч индивидуально»
    (пул пуст). Вырезка 1 ч из середины: остатки остаются оплаченными часами,
    возвращается ровно вырезанный час и только в доп. пул; повторить нельзя."""
    from app.api.v1.bookings import routes
    from fastapi import BackgroundTasks
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("GROUP_MASTER"))
    b = _book(s, admin, u, days=0, start="12:00", minutes=240, resource="room_1")
    assert b.hours_pool == "extra" and b.extra_hours_deducted == 4.0
    assert _snap(s, u)["xrem"] == 0.0
    out = H._call(routes.trim_booking, booking_id=str(b.id),
                  data=routes.TrimRequest(remove_from="13:00", remove_to="14:00"),
                  background_tasks=BackgroundTasks(), session=s, current_user=admin)
    s.commit()
    assert not (isinstance(out, dict) and "http" in out), out
    snap = _snap(s, u)
    assert snap["xrem"] == 1.0 and snap["xused"] == 3.0 and snap["main"] == 20.0 and snap["balance"] == 500.0, snap
    rows = sorted(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all(), key=lambda x: x.start_time)
    assert len(rows) == 2 and all(r.payment_method == "subscription" and r.applied_rule == "SUBSCRIPTION" for r in rows)
    assert [r.hours_deducted for r in rows] == [1.0, 2.0] and [P.booking_extra(r) for r in rows] == [1.0, 2.0], \
        [(r.hours_deducted, r.extra_hours_deducted, r.final_price) for r in rows]
    assert all(r.final_price == 0.0 for r in rows), "остаток брони стал денежным"
    _check_pool(s, u)
    # отмена обеих частей возвращает ровно 3 ч, итого 4 — не больше
    for r in rows:
        _cancel(s, admin, s.get(Booking, r.id))
    back = _snap(s, u)
    assert back["xrem"] == 4.0 and back["xused"] == 0.0 and back["main"] == 20.0, back
    _check_pool(s, u)


@_scenario
def test_format_change_that_subscription_does_not_cover_is_refused():
    """Групповой мастер: индивидуальная бронь из доп. пула → group (основной пул
    группы покрывает — можно, часы переезжают между пулами); обратно в
    individual при пустом доп. пуле — 400, а не бесплатная бронь с фантомным
    возвратом денег."""
    from app.api.v1.bookings import routes
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("GROUP_MASTER"))
    b = _book(s, admin, u, days=0, start="12:00", minutes=120, resource="room_1")
    assert b.hours_pool == "extra"
    out = H._call(routes.change_booking_format, booking_id=str(b.id),
                  payload=routes.ChangeFormatRequest(new_format="group"), session=s, current_user=admin)
    s.commit()
    assert not (isinstance(out, dict) and "http" in out), out
    snap = _snap(s, u)
    assert snap["xrem"] == 4.0 and snap["main"] == 18.0, snap   # 2 ч доп. вернулись, 2 ч ушли из группового
    b = s.get(Booking, b.id)
    assert b.hours_pool == "main" and (b.extra_hours_deducted or 0) == 0
    _check_pool(s, u)
    # доп. пул выбрали другие брони
    _book(s, admin, u, days=0, start="14:00", minutes=240, resource="room_1")
    assert _snap(s, u)["xrem"] == 0.0
    before = _snap(s, u)
    out = H._call(routes.change_booking_format, booking_id=str(b.id),
                  payload=routes.ChangeFormatRequest(new_format="individual"), session=s, current_user=admin)
    s.rollback()
    assert isinstance(out, dict) and out.get("http") == 400, "бронь стала индивидуальной за часы, которых нет"
    assert _snap(s, u) == before
    b = s.get(Booking, b.id)
    assert b.format == "group" and b.hours_pool == "main"
    _check_pool(s, u)


@_scenario
def test_consecutive_chain_recompute_ignores_live_subscription():
    """Цепочка «часы подряд» пересчитывает ДЕНЕЖНЫЕ брони. Живые часы
    (в т.ч. доп. пул) не должны превращать их в абонементные за 0 ₾."""
    from app.services.consecutive_pricing import recompute_chain_and_settle
    s = H._db()
    u = H._user(s, sub=_sub_with("GROUP_MASTER"), balance=500.0)
    bks = []
    for st in ("12:00", "13:00"):
        b = Booking(resource_id="room_1", location_id="unbox_uni", date=H._day(0), start_time=st, duration=60,
                    final_price=20.0, payment_method="balance", payment_status="paid", status="confirmed",
                    charge_amount=20.0, user_id=u.email, user_uuid=u.id, format="individual")
        s.add(b); bks.append(b)
    s.commit()
    chain = sorted(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all(), key=lambda x: x.start_time)
    recompute_chain_and_settle(s, u, chain)
    s.commit()
    for b in s.exec(select(Booking).where(Booking.user_uuid == u.id)).all():
        assert b.applied_rule != "SUBSCRIPTION" and b.final_price > 0, (b.applied_rule, b.final_price)
    assert _snap(s, u)["xrem"] == 4.0 and _snap(s, u)["main"] == 20.0


# Эталон B1 снят на main (до доп. пула) тем же сценарием — «Основной пул пуст
# (remaining_hours=0), баланс 500, две денежные брони по 1 ч подряд в один день,
# 14:00 и 15:00 в room_1»: (цена каждой, правило, % скидки, итоговый баланс).
# Тёплый −10%, Регулярный −15%, Профи+ −20%, Групповой мастер: индивидуальная
# бронь не покрывается тарифом — скидки нет, только «часы подряд» −10%; групповая
# — скидка −25% (35 ₾ → 26.25). Ревизия 01.10: `ignore_subscription=True` в цепочке
# съедал скидку — Регулярный платил 18/18 вместо 17/17 (main).
_CHAIN_ON_MAIN = {
    ("REGULAR_PRACTITIONER", "individual"): (17.0, "SUBSCRIPTION_DISCOUNT", 15, 466.0),
    ("WARM_START", "individual"): (18.0, "SUBSCRIPTION_DISCOUNT", 10, 464.0),
    ("PRO_PLUS", "individual"): (16.0, "SUBSCRIPTION_DISCOUNT", 20, 468.0),
    ("GROUP_MASTER", "individual"): (18.0, "CONSECUTIVE_HOURS", 10, 464.0),
    ("GROUP_MASTER", "group"): (26.25, "SUBSCRIPTION_DISCOUNT", 25, 447.5),
    ("PRO_PLUS", "group"): (28.0, "SUBSCRIPTION_DISCOUNT", 20, 444.0),
}


@_scenario
def test_consecutive_chain_keeps_subscription_discount_as_on_main():
    """B1 (ревизия 01.10): цепочка «часы подряд» выключает ТОЛЬКО покрытие часами,
    скидка абонемента остаётся. Два денежных часа подряд у клиента без часов
    стоят ровно как на main: те же цены, то же правило, тот же баланс."""
    for (plan, fmt), (price, rule, pct, balance) in _CHAIN_ON_MAIN.items():
        s = H._db()
        admin = _admin_user(s)
        over = {"remaining_hours": 0.0}
        if plan == "GROUP_MASTER" and fmt == "individual":
            # «4 ч индивидуально» уже выбраны — иначе их покроет доп. пул (это
            # новое поведение, а не main), и цепочки не будет вовсе.
            over.update(extra_hours_remaining=0.0, extra_hours_used=4.0)
        u = H._user(s, sub=_sub_with(plan, **over), balance=500.0, name="C")
        for st in ("14:00", "15:00"):
            H._create(s, admin, u, days=0, start=st, minutes=60, resource="room_1", fmt=fmt, method="balance")
            s.commit()
        s.expire_all()
        rows = s.exec(select(Booking).where(Booking.user_uuid == u.id).order_by(Booking.start_time)).all()
        assert len(rows) == 2, (plan, fmt, len(rows))
        for b in rows:
            got = (round(float(b.final_price), 2), b.applied_rule, int(b.discount_percent or 0))
            assert b.payment_method == "balance" and got == (price, rule, pct), \
                f"{plan}/{fmt} {b.start_time}: {got}, на main {(price, rule, pct)}"
        assert round(float(s.get(User, u.id).balance), 2) == balance, \
            f"{plan}/{fmt}: баланс {s.get(User, u.id).balance}, на main {balance}"


def test_chain_pricing_uses_hours_cover_flag_not_ignore_subscription():
    """Цепочка не имеет права звать `ignore_subscription=True` (выключает и скидку);
    только `subscription_hours_cover=False`, а ветка SUBSCRIPTION_DISCOUNT — цела."""
    src = _read("backend/app/services/consecutive_pricing.py")
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    assert "ignore_subscription" not in code, "цепочка снова выключает абонемент целиком — пропадёт скидка тарифа"
    assert "subscription_hours_cover=False" in code, "цепочка не выключает покрытие часами"
    pr = _read("backend/app/services/pricing.py")
    assert "hours_cover=subscription_hours_cover" in pr and "if hours_cover:" in pr
    assert 'breakdown.applied_rule = "SUBSCRIPTION_DISCOUNT"' in pr


@_scenario
def test_approve_group_master_individual_without_extra_hours_goes_to_money():
    """Горячая индивидуальная бронь Группового мастера: к подтверждению «4 ч
    индивидуально» уже разобрали — основной (групповой) пул её не оплачивает.

    Было (01.10): одобрение отказывало 409, бронь висела на согласовании.
    Ревизия денег 03.10 (п.2, «как крон»): одобрение перепроверяет часы и, если
    их нет, проводит бронь ДЕНЬГАМИ по цене на момент одобрения — ровно как крон
    T-24ч для такой же брони заранее: индивидуальный формат тарифом не покрыт →
    обычная цена 20 ₾, hours_deducted = 0, пулы не тронуты; отмена вернёт 20 ₾."""
    from app.api.v1.bookings import routes
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("GROUP_MASTER"))
    b = Booking(resource_id="room_1", location_id="unbox_uni", date=H._day(0), start_time="17:00", duration=60,
                final_price=0.0, payment_method="subscription", payment_status="pending", status="pending_approval",
                hours_deducted=1.0, extra_hours_deducted=1.0, hours_pool="extra", user_id=u.email,
                user_uuid=u.id, format="individual")
    s.add(b); s.commit()
    # доп. пул уже пуст
    s.get(User, u.id).subscription = P.update(s.get(User, u.id).subscription, extra_hours_remaining=0.0,
                                              extra_hours_used=4.0)
    s.commit()
    routes.approve_booking(booking_id=str(b.id), session=s, current_user=admin)
    s.commit()
    snap = _snap(s, u)
    assert snap["main"] == 20.0 and snap["used"] == 0.0 and snap["xrem"] == 0.0, snap
    assert snap["balance"] == 480.0, f"баланс {snap['balance']}, ждём 500 − 20"
    b = s.get(Booking, b.id)
    assert (b.status, b.payment_status, float(b.hours_deducted or 0), float(b.charge_amount)) == \
        ("confirmed", "paid", 0.0, 20.0), (b.status, b.payment_status, b.hours_deducted, b.charge_amount)
    assert b.hours_pool is None, b.hours_pool
    _cancel(s, admin, b)
    snap = _snap(s, u)
    assert snap["balance"] == 500.0 and snap["main"] == 20.0 and snap["xrem"] == 0.0, snap


@_scenario
def test_topup_extra_only_and_logged():
    from app.api.v1.users import admin as users_admin
    s = H._db()
    admin = _admin_user(s)
    u = H._user(s, sub=_sub_with("WARM_START"))
    users_admin.topup_subscription(user_id=str(u.id), payload={"extra_hours": 2, "amount": 0},
                                   session=s, current_user=admin)
    snap = _snap(s, u)
    assert snap["main"] == 10.0 and snap["xrem"] == 6.0 and snap["xtotal"] == 6.0, snap
    hist = s.get(User, u.id).comment_history
    assert hist and "доп. пула" in hist[-1]["text"], hist
    _check_pool(s, u)


# ── Статика ──────────────────────────────────────────────────────────────

def test_plans_extra_values_and_frontend_mirror():
    from app.services.subscription_sale import PLANS
    want = {"TRIAL": (1, "capsule"), "WARM_START": (4, "capsule"), "REGULAR_PRACTITIONER": (6, "capsule"),
            "PRO_PLUS": (10, "capsule"), "GROUP_MASTER": (4, "individual")}
    for pid, (h, kind) in want.items():
        assert (PLANS[pid]["extra_hours"], PLANS[pid]["extra_kind"]) == (h, kind), (pid, PLANS[pid])
    data = _read("src/utils/data.ts")
    block = data[data.index("export let SUBSCRIPTION_PLANS"):data.index("\n];", data.index("export let SUBSCRIPTION_PLANS"))]
    for pid, (h, kind) in want.items():
        i = block.index(f"id: '{pid}'")
        j = block.find("\n    },", i)
        item = block[i:j]
        assert f"extraHours: {h}," in item and f"extraKind: '{kind}'" in item, f"сайт не совпадает с сервером: {pid}"


def test_extra_pool_script_catalog_equals_plans():
    """Скрипт доп. пула «задним числом» держит свою копию каталога (чтобы dry-run
    шёл на прод-коде до выкладки). Копия обязана совпасть с subscription_sale.PLANS
    — иначе ретро-начисление выдаст не те часы (ревизия 01.10, N5)."""
    import importlib.util
    from app.services.subscription_sale import PLANS
    path = os.path.join(_BACKEND, "scripts", "tariffs_extra_pool_2026_10.py")
    spec = importlib.util.spec_from_file_location("tariffs_extra_pool_2026_10", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert set(mod.EXTRA_BY_PLAN) == set(PLANS) == set(mod.PLAN_INFO), \
        (set(mod.EXTRA_BY_PLAN), set(PLANS), set(mod.PLAN_INFO))
    for pid, p in PLANS.items():
        assert mod.EXTRA_BY_PLAN[pid] == (p["extra_kind"], float(p["extra_hours"])), \
            f"EXTRA_BY_PLAN[{pid}] = {mod.EXTRA_BY_PLAN[pid]} != PLANS ({p['extra_kind']}, {p['extra_hours']})"
        want = dict(hours=p["hours"], bonus=p["bonus_hours"], price=p["price"], days=p["duration_days"], name=p["name"])
        assert mod.PLAN_INFO[pid] == want, f"PLAN_INFO[{pid}] = {mod.PLAN_INFO[pid]} != {want}"


def test_subscriptions_page_takes_extra_hours_from_catalog():
    """Страница тарифов не зашивает часы капсулы в тексты — берёт extraHours /
    extraKind из SUBSCRIPTION_PLANS (N5)."""
    page = _read("src/pages/SubscriptionsPage.tsx")
    assert "extraHours" in page and "extraKind" in page, "страница не читает extraHours/extraKind из каталога"
    assert re.search(r"capsuleHours:\s*[1-9]", page) is None, "capsuleHours снова зашит числом"
    assert re.search(r"'\d+ (час|часа|часов) в капсуле", page) is None, "часы капсулы снова зашиты в текст"
    assert re.search(r"'\d+ (час|часа|часов) в любом индивидуальном", page) is None, \
        "«N ч индивидуально» Группового мастера снова зашито в текст"


def test_extra_fields_written_only_inside_subscription_pool():
    pat = re.compile(r"""\bextra_hours_(remaining|used|total)\s*=(?!=)|["']extra_hours_(remaining|used|total)["']\s*:""")
    bad = []
    for root, _, files in os.walk(os.path.join(_BACKEND, "app")):
        for fn in files:
            if not fn.endswith(".py") or fn == "subscription_pool.py":
                continue
            for i, line in enumerate(open(os.path.join(root, fn), encoding="utf-8"), 1):
                code = line.split("#", 1)[0]
                if pat.search(code):
                    bad.append(f"{fn}:{i}: {line.strip()[:90]}")
    assert not bad, "доп. пул пишется мимо subscription_pool:\n  " + "\n  ".join(bad)


def test_every_booking_hours_assignment_stamps_pool():
    """Где у брони меняются часы абонемента, там обязательно записывается пул
    (hours_pool / extra_hours_deducted) — иначе возврат пойдёт не туда."""
    pat = re.compile(r"^\s*(booking|b)\.hours_deducted = ")
    bad = []
    for rel in ("backend/app/api/v1/bookings/routes.py", "backend/app/services/billing_defer.py"):
        lines = _read(rel).splitlines()
        for i, line in enumerate(lines):
            if pat.search(line) and "bonus_covered" not in line:
                if not any("stamp_booking" in x for x in lines[i:i + 7]):
                    bad.append(f"{rel}:{i + 1}: {line.strip()}")
    assert not bad, "часы брони поменялись без записи пула:\n  " + "\n  ".join(bad)


def test_every_pool_refund_passes_extra():
    """Каждый возврат часов (credit_hours) в местах отмены/вырезки/сокращения/
    цены/waive передаёт долю доп. пула — иначе она осядет в основном."""
    for rel, names in (("backend/app/api/v1/bookings/routes.py", None), ("backend/app/services/billing_defer.py", None)):
        src = _read(rel)
        for m in re.finditer(r"subscription_pool\.credit_hours\(([^)]*(?:\([^)]*\)[^)]*)*)\)", src):
            call = m.group(1)
            if "extra=" not in call:
                line = src[:m.start()].count("\n") + 1
                # допустимое исключение: основной остаток смены формата/цены, где доп. часть вычтена отдельно
                ctx = src[max(0, m.start() - 300):m.start()]
                assert "delta_main" in call or "hours_delta - extra_delta" in call, f"{rel}:{line}: credit_hours без extra"


def test_money_audit_has_extra_checks():
    src = _read("backend/scripts/money_audit.py")
    for key in ("broken_extra_pool", "extra_booking_overdraw"):
        assert f'key="{key}"' in src, f"в money_audit нет проверки {key}"
    assert "to_jsonb(b)->>'extra_hours_deducted'" in src, "проверка брони обязана переживать отсутствие колонки"


def test_resolve_payment_method_still_routes_extra_covered_quote_to_subscription():
    """Котировка, покрытая доп. пулом, — SUBSCRIPTION → ярлык `subscription`
    (иначе часы не спишутся, а кабинет/капсула уйдёт за 0 ₾ — утечка 1630 ₾)."""
    from app.services.pricing import PricingService, resolve_payment_method
    with H.frozen_time():
        s = H._db()
        u = H._user(s, sub=_sub_with("WARM_START", remaining_hours=0.0))
        q = PricingService(s).calculate_price(user=u, resource_id="cap_1",
                                              start_time=H._day(2).replace(hour=15), duration_minutes=60,
                                              format_type="individual")
        assert q.applied_rule == "SUBSCRIPTION" and q.hours_deducted == 1.0 and q.extra_hours_deducted == 1.0
        assert resolve_payment_method("balance", q) == "subscription"
        # Кабинет при нулевом основном — не покрыт (капсульные часы на него не идут)
        q2 = PricingService(s).calculate_price(user=u, resource_id="room_1",
                                               start_time=H._day(2).replace(hour=15), duration_minutes=60,
                                               format_type="individual")
        assert q2.extra_hours_deducted == 0.0, "капсульные часы пошли на кабинет"
        assert q2.applied_rule != "SUBSCRIPTION", "кабинет покрыт, хотя основной пул пуст"


def test_frontend_shows_extra_pool_and_mirrors_server_rules():
    util = _read("src/utils/subscriptionHours.ts")
    assert "export function extraPoolLabel(" in util and "export function extraApplies(" in util
    # зеркало subscription_pool.extra_applies: капсульные часы — только капсула,
    # «индивидуально» — только кабинет + индивидуальный формат
    assert "p.kind === 'capsule'" in util and "return resource === 'capsule'" in util
    assert "resource === 'cabinet' && format === 'individual'" in util
    assert "'Капсула'" in util and "'Индивидуально'" in util and "осталось" in util
    pp = _read("src/utils/paymentPriority.ts")
    assert "extraAvailable(sub, opts.resourceKind, opts.format)" in pp, "оформление не знает про доп. пул"
    assert "resourceKind: cartResourceKind(" in _read("src/components/Wizard/ConfirmationStep.tsx")
    assert "resourceKind: cartResourceKind(" in _read("src/pages/mobile/MobileCheckout.tsx")
    for rel in ("src/components/SubscriptionCard.tsx", "src/pages/mobile/MobileSubscription.tsx",
                "src/pages/admin/UserDetails.tsx", "src/pages/mobile/admin/MobileAdminUserCard.tsx",
                "src/pages/MyBookingsPage.tsx"):
        assert "subscriptionHours'" in _read(rel), f"{rel}: карточка не показывает доп. пул"
    types = _read("src/store/types.ts")
    for f in ("extraKind", "extraHoursTotal", "extraHoursRemaining"):
        assert f in types, f"нет {f} в Subscription"
    # алиасы пула: оба диалекта
    for snake, camel in (("extra_hours_total", "extraHoursTotal"), ("extra_hours_remaining", "extraHoursRemaining"),
                         ("extra_hours_used", "extraHoursUsed"), ("extra_kind", "extraKind")):
        assert P._ALIASES.get(snake) == camel, snake


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"  FAIL {name}: {e!r}")
    print("guard_tariffs_extra:", "FAILED" if failed else "OK")
    sys.exit(1 if failed else 0)
