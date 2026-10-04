"""СТОРОЖ «движение часов абонемента — только через subscription_pool» (шаг 4 / 2а).

Часы абонемента двигались в ~18 местах, и каждое писало пул руками:
`remaining_hours=max(0, rem - h), used_hours=used + h`. Перед тем как
добавлять второй пул (часы капсулы / «4 ч индивидуально»), все эти места
переведены на общие функции subscription_pool.debit_hours / credit_hours /
grant_hours — БЕЗ изменения поведения.

Что ловим:
  * кто-то снова пишет remaining_hours / remainingHours руками вне
    subscription_pool (статическая проверка всего backend/app);
  * поведение денег/часов на типовых сценариях разошлось с «отпечатком»,
    снятым ДО рефакторинга (бронь сейчас и заранее, крон T-24ч, отмена,
    перенос, сокращение, вырезка, разделение, смена формата и цены, серия,
    мульти-слот, горячая бронь + подтверждение/отклонение, перевод брони на
    абонемент, снятие штрафа, пополнение и продажа абонемента).

Отпечаток — только «деньги и часы»: остаток/израсходовано/всего/бонус пула
основного абонемента, баланс клиента, и у каждой брони способ оплаты,
статус оплаты, цена, списано, часы. Время заморожено (FakeDatetime), чтобы
окна 24 ч / 12 ч и пиковые часы не зависели от момента запуска.

    python3 backend/tests/guard_hours_pool_moves.py
    python3 backend/tests/guard_hours_pool_moves.py --print   # показать отпечаток
"""
import json
import os
import re
import sys
from datetime import datetime as _real_datetime, timedelta, timezone
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from sqlmodel import Session, SQLModel, create_engine, select  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401
from app.models.booking import Booking  # noqa: E402
from app.models.resource import Resource  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import subscription_pool  # noqa: E402

_BACKEND = os.path.join(os.path.dirname(__file__), "..")

# Пн 05.10.2026, 10:00 по Тбилиси (06:00 UTC). Сервер живёт в UTC.
FIXED_UTC = _real_datetime(2026, 10, 5, 6, 0, 0)


class FakeDatetime(_real_datetime):
    @classmethod
    def utcnow(cls):
        return cls.fromtimestamp(FIXED_UTC.replace(tzinfo=timezone.utc).timestamp(), timezone.utc).replace(tzinfo=None)

    @classmethod
    def now(cls, tz=None):
        base = FIXED_UTC.replace(tzinfo=timezone.utc)
        if tz is None:
            return cls.fromtimestamp(base.timestamp(), timezone.utc).replace(tzinfo=None)
        return cls.fromtimestamp(base.timestamp(), tz)


import contextlib  # noqa: E402


@contextlib.contextmanager
def frozen_time(at=None):
    """Заморозить время: подменить datetime во всех модулях app.* (они делают
    `from datetime import datetime`) и в sys.modules (импорты ВНУТРИ функций,
    напр. гейт горячей брони). На выходе всё возвращается — сторожа гоняются
    в одном процессе, остальным нужно настоящее время.

    `at` — другой замороженный момент (UTC, без зоны) вместо FIXED_UTC; на
    выходе прежний момент возвращается (вложенные заморозки не мешают)."""
    global FIXED_UTC
    _saved_at = FIXED_UTC
    if at is not None:
        FIXED_UTC = at
    import app.api.v1.bookings.routes  # noqa: F401
    import app.api.v1.billing  # noqa: F401
    import app.api.v1.users.admin  # noqa: F401
    import app.services.billing_defer  # noqa: F401
    import app.services.subscription_sale  # noqa: F401
    import app.services.bonus_service  # noqa: F401
    import app.services.subscription_perks  # noqa: F401
    import types
    patched = []
    for name, mod in list(sys.modules.items()):
        if name.startswith("app.") and getattr(mod, "datetime", None) is _real_datetime:
            setattr(mod, "datetime", FakeDatetime)
            patched.append(mod)
    real_mod = sys.modules["datetime"]
    shim = types.ModuleType("datetime")
    shim.__dict__.update(real_mod.__dict__)
    shim.datetime = FakeDatetime
    sys.modules["datetime"] = shim
    try:
        yield
    finally:
        sys.modules["datetime"] = real_mod
        for mod in patched:
            setattr(mod, "datetime", _real_datetime)
        FIXED_UTC = _saved_at


def _db() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    s = Session(engine)
    s.add(Resource(id="room_1", name="Кабинет 1", type="cabinet", location_id="unbox_uni",
                   hourly_rate=20.0, capacity=4, area=10, formats=["individual", "group"]))
    s.add(Resource(id="room_2", name="Кабинет 2", type="cabinet", location_id="unbox_uni",
                   hourly_rate=20.0, capacity=4, area=10, formats=["individual", "group"]))
    s.add(Resource(id="cap_1", name="Капсула 1", type="capsule", location_id="unbox_uni",
                   hourly_rate=10.0, capacity=1, area=2, formats=["individual"]))
    s.commit()
    return s


def _user(s, role="specialist", sub=None, balance=500.0, name="Клиент"):
    u = User(email=f"{name}-{uuid4().hex[:6]}@x.ge", name=name, role=role, hashed_password="x",
             balance=balance, credit_limit=0.0, subscription=sub)
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _sub(plan="REGULAR_PRACTITIONER", **over):
    from app.services.subscription_sale import build_subscription
    sub = build_subscription(plan, FakeDatetime.utcnow())
    return subscription_pool.update(sub, **over) if over else sub


def _day(days: int) -> _real_datetime:
    """Полночь дня по Тбилиси (+days от «сегодня» 05.10)."""
    return FakeDatetime(2026, 10, 5) + timedelta(days=days)


def _create(s, actor, owner, *, days, start, minutes=60, resource="room_1", fmt="individual",
            method="balance"):
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.models.booking import BookingCreate
    bi = BookingCreate(resource_id=resource, location_id="unbox_uni", date=_day(days), start_time=start,
                       duration=minutes, format=fmt, payment_method=method,
                       target_user_id=(str(owner.id) if actor.id != owner.id else None))
    out = routes.create_booking(session=s, booking_in=bi, current_user=actor, background_tasks=BackgroundTasks())
    return s.get(Booking, out.id)


def _call(fn, *a, **kw):
    from fastapi import HTTPException
    try:
        return fn(*a, **kw)
    except HTTPException as e:
        return {"http": e.status_code}


def _fp_sub(sub):
    g = subscription_pool.get_float
    return {k: round(g(sub, k), 4) for k in ("remaining_hours", "used_hours", "total_hours", "bonus_hours")}


def _fp(s, users) -> dict:
    s.expire_all()
    out = {}
    for label, u in users.items():
        uu = s.get(User, u.id)
        rows = s.exec(select(Booking).where(Booking.user_uuid == u.id)
                      .order_by(Booking.date, Booking.start_time, Booking.duration)).all()
        out[label] = {
            "balance": round(float(uu.balance or 0), 2),
            "pool": _fp_sub(uu.subscription) if uu.subscription else None,
            "bookings": [
                [b.date.strftime("%m-%d"), b.start_time, b.duration, b.resource_id, b.status,
                 b.payment_method, b.payment_status, round(float(b.final_price or 0), 2),
                 None if b.charge_amount is None else round(float(b.charge_amount), 2),
                 None if b.hours_deducted is None else round(float(b.hours_deducted), 4)]
                for b in rows
            ],
        }
    return out


def run_scenarios() -> dict:
    with frozen_time():
        return _run_scenarios()


def _run_scenarios() -> dict:
    from fastapi import BackgroundTasks
    from app.api.v1.bookings import routes
    from app.services import billing_defer
    from app.services.subscription_sale import sell_subscription
    from app.api.v1.users import admin as users_admin

    s = _db()
    admin = _user(s, role="owner", name="Админ", balance=0.0)
    fp = {}

    # 1. Продажа абонемента с баланса (перенос остатка старого — 3 ч).
    a = _user(s, sub=_sub("TRIAL", remaining_hours=3.0, used_hours=1.0), balance=400.0, name="A")
    sell_subscription(s, a, "REGULAR_PRACTITIONER", "balance", admin)
    s.commit()
    fp["1_sale"] = _fp(s, {"A": a})

    # 2. Бронь сейчас (≤24 ч, сразу списано) и заранее (pending), + крон T-24ч.
    b_now = _create(s, admin, a, days=0, start="14:00", minutes=120, method="subscription")
    b_far = _create(s, admin, a, days=3, start="12:00", minutes=60, method="subscription")
    b_peak = _create(s, admin, a, days=4, start="20:00", minutes=60, method="subscription")
    s.commit()
    fp["2_create"] = _fp(s, {"A": a})
    billing_defer.settle_pending_charge(s, s.get(Booking, b_far.id))
    billing_defer.settle_pending_charge(s, s.get(Booking, b_peak.id))
    s.commit()
    fp["3_settle"] = _fp(s, {"A": a})

    # 3. Отмена оплаченной (админ, 100 % и 50 %), снятие штрафа.
    _call(routes.cancel_booking, booking_id=str(b_far.id), background_tasks=BackgroundTasks(),
          session=s, current_user=admin)
    _call(routes.cancel_booking, booking_id=str(b_peak.id), background_tasks=BackgroundTasks(),
          session=s, current_user=admin, refund_percent=0.5, reason="тест")
    s.commit()
    fp["4_cancel"] = _fp(s, {"A": a})
    from app.services.billing_defer import waive_charge
    waive_charge(s, s.get(Booking, b_now.id), reason="тест", by_user=admin)
    s.commit()
    fp["5_waive"] = _fp(s, {"A": a})

    # 4. Перенос, вырезка, сокращение, разделение, смена формата и цены.
    c = _create(s, admin, a, days=0, start="15:00", minutes=180, resource="room_2", method="subscription")
    s.commit()
    _call(routes.reschedule_booking, booking_id=str(c.id),
          data=routes.RescheduleRequest(new_date=_day(0).strftime("%Y-%m-%d"), new_start_time="16:00"),
          background_tasks=BackgroundTasks(), session=s, current_user=admin)
    s.commit()
    fp["6_reschedule"] = _fp(s, {"A": a})
    _call(routes.trim_booking, booking_id=str(c.id),
          data=routes.TrimRequest(remove_from="17:00", remove_to="17:30"),
          background_tasks=BackgroundTasks(), session=s, current_user=admin)
    s.commit()
    fp["7_trim"] = _fp(s, {"A": a})
    d = _create(s, admin, a, days=1, start="10:00", minutes=180, resource="room_1", method="subscription")
    s.commit()
    _call(routes.shorten_booking, booking_id=str(d.id), payload=routes.ShortenRequest(remove_minutes=60),
          session=s, current_user=admin)
    s.commit()
    fp["8_shorten"] = _fp(s, {"A": a})
    _call(routes.split_booking, booking_id=str(d.id), payload=routes.SplitRequest(parts=[60, 60]),
          session=s, current_user=admin)
    s.commit()
    fp["9_split"] = _fp(s, {"A": a})
    _call(routes.change_booking_format, booking_id=str(d.id),
          payload=routes.ChangeFormatRequest(new_format="group"), session=s, current_user=admin)
    s.commit()
    fp["10_format"] = _fp(s, {"A": a})
    _call(routes.set_booking_price, booking_id=str(d.id),
          payload=routes.SetPriceRequest(new_price=10.0, reason="тест"), session=s, current_user=admin)
    s.commit()
    fp["11_price"] = _fp(s, {"A": a})

    # 5. Серия и мульти-слот (часть дат сразу, часть — pending).
    B = _user(s, sub=_sub("PRO_PLUS"), balance=300.0, name="B")
    _call(routes.create_recurring_booking, background_tasks=BackgroundTasks(), session=s,
          data=routes.RecurringBookingRequest(resource_id="room_1", location_id="unbox_uni",
                                              start_time="18:00", duration=60, format="individual",
                                              payment_method="subscription",
                                              first_date=_day(0).strftime("%Y-%m-%d"), occurrences=3,
                                              target_user_id=str(B.id)),
          current_user=admin)
    s.commit()
    fp["12_series"] = _fp(s, {"B": B})
    _call(routes.create_multi_slot_booking, session=s,
          data=routes.MultiSlotRequest(slots=[
              routes.MultiSlotItem(resource_id="room_2", date=_day(0).strftime("%Y-%m-%d"),
                                   start_time="19:00", duration=60, format="individual"),
              routes.MultiSlotItem(resource_id="room_2", date=_day(5).strftime("%Y-%m-%d"),
                                   start_time="19:00", duration=90, format="individual"),
          ], payment_method="subscription", target_user_id=str(B.id)),
          current_user=admin)
    s.commit()
    fp["13_multi"] = _fp(s, {"B": B})

    # 6. Горячая бронь клиента (≤12 ч) → ждёт подтверждения; одна подтверждена,
    #    другая отклонена.
    C = _user(s, sub=_sub("WARM_START"), balance=100.0, name="C")
    h1 = _create(s, C, C, days=0, start="16:00", minutes=60, resource="room_1", method="subscription")
    h2 = _create(s, C, C, days=0, start="17:00", minutes=60, resource="room_1", method="subscription")
    s.commit()
    fp["14_hot"] = _fp(s, {"C": C})
    _call(routes.approve_booking, booking_id=str(h1.id), session=s, current_user=admin)
    _call(routes.reject_booking, booking_id=str(h2.id), payload=None, session=s, current_user=admin)
    s.commit()
    fp["15_approve_reject"] = _fp(s, {"C": C})

    # 7. Перевод денежной брони на абонемент (оплаченная и pending), пополнение.
    m1 = _create(s, admin, C, days=0, start="19:00", minutes=60, resource="room_1", method="balance")
    s.commit()
    # Денежная бронь при действующем абонементе ушла бы на часы — делаем её
    # денежной вручную, как старые брони.
    for bk in (m1,):
        bk = s.get(Booking, bk.id)
        if bk.payment_method != "balance":
            bk.payment_method = "balance"
            bk.final_price = 20.0
            bk.charge_amount = 20.0 if bk.payment_status == "paid" else None
            s.add(bk)
    s.commit()
    _call(routes.convert_booking_to_subscription, booking_id=str(m1.id), session=s, current_user=admin)
    s.commit()
    fp["16_convert"] = _fp(s, {"C": C})
    users_admin.topup_subscription(user_id=str(C.id), payload={"hours": 2.5, "amount": 0}, session=s,
                                   current_user=admin)
    fp["17_topup"] = _fp(s, {"C": C})
    return fp


# Отпечаток снят на коде ДО перевода на debit_hours/credit_hours (main 0257c69) и
# совпадал с ним по всем 17 сценариям на шаге 2а. ОДИН раз обновлён осознанно в
# шаге 2в (ревизия денег 01.10): сценарии 10_format и 11_price. Смена формата
# абонементной брони на формат, которого абонемент не покрывает (Регулярный:
# индивидуальный → групповой), раньше делала бронь бесплатной (часы 0, цена 31.5 ₾
# без списания, все часы возвращены в пул, при отмене — возврат денег, которых никто
# не брал). Теперь это 400, бронь не меняется. Остальные 15 сценариев — без изменений.
#
# Второй раз обновлён осознанно — ревизия денег 03.10 (guard_money_holes_2026_10):
#   8_shorten: бронь по абонементу 10:00–13:00 без пика и допов сократили на 1 ч.
#     Раньше возврат часов стоял внутри «если вернулись деньги», денег 0 — и час
#     пропадал (остаток 17, израсходовано 6). Теперь отрезанный час возвращается:
#     остаток 18, израсходовано 5. Брони — без изменений (у сокращённой 2 ч).
#   9_split, 10_format: тот же +1 ч пула, перенесённый из 8_shorten; сами
#     разделение и смена формата часов не двигают — других отличий нет.
#   11_price: плюс тот же +1 ч, и «Цена» 0 → 10 ₾ у оплаченной брони по
#     абонементу теперь снимает 10 ₾ с баланса (47,5 → 37,5), часы не трогает.
#     Раньше деньги не двигались, а отмена этой брони вернула бы 10 ₾ из воздуха.
EXPECTED_PATH = os.path.join(os.path.dirname(__file__), "guard_hours_pool_moves.expected.json")


def test_fingerprint_unchanged():
    got = run_scenarios()
    want = json.load(open(EXPECTED_PATH, encoding="utf-8"))
    got = json.loads(json.dumps(got))
    diffs = [k for k in sorted(set(want) | set(got)) if want.get(k) != got.get(k)]
    assert not diffs, "поведение часов/денег изменилось: " + ", ".join(
        f"{k}: было {json.dumps(want.get(k), ensure_ascii=False)} стало {json.dumps(got.get(k), ensure_ascii=False)}"
        for k in diffs[:3])


# ── Статика: прямые записи пула только в subscription_pool ───────────────

_DIRECT_WRITE = re.compile(
    r"""(\b(remaining_hours|used_hours)\s*=(?!=))"""
    r"""|(["'](remaining_hours|remainingHours|used_hours|usedHours)["']\s*[:\]])"""
)


# Чистое чтение пула для ответа API: весь элемент словаря — один вызов
# subscription_pool.get/get_float и больше ничего (`"remaining_hours":
# subscription_pool.get_float(sub, "remaining_hours"),`). Любая арифметика после
# вызова или присваивание `remaining_hours=...` — запись, даже если в строке
# есть subscription_pool.get (`remaining_hours=subscription_pool.get_float(...)+h`).
_PURE_READ = re.compile(
    r"""^\s*["'](remaining_hours|remainingHours|used_hours|usedHours)["']\s*:\s*"""
    r"""subscription_pool\.get(?:_float)?\([^()]*\)\s*[,})]*\s*$"""
)

# Разовые скрипты июля 2026 — ДО появления subscription_pool, уже выполнены и
# больше не запускаются. Новые скрипты сюда не добавлять: двигать часы через
# subscription_pool.debit_hours / credit_hours / grant_hours.
_LEGACY_ONE_OFF_SCRIPTS = frozenset({
    "fix_marina_nadia_2026_07_29.py",
    "reconcile_hours_2026_07.py",
    "assign_subs_2026_07.py",
    "migrate_defer_existing.py",
})


def _is_direct_pool_write(line: str) -> bool:
    code = line.split("#", 1)[0]
    if not _DIRECT_WRITE.search(code):
        return False
    return not _PURE_READ.match(code)


def test_direct_write_detector_catches_writes_and_spares_reads():
    """Сам детектор: запись с subscription_pool.get внутри ловится, чистое чтение — нет."""
    writes = [
        'remaining_hours=subscription_pool.get_float(sub, "remaining_hours") + h,',
        "used_hours=subscription_pool.get_float(sub, 'used_hours') - h)",
        'sub["remaining_hours"] = subscription_pool.get_float(sub, "remaining_hours") + h',
        '"remaining_hours": subscription_pool.get_float(sub, "remaining_hours") + h,',
        'remaining_hours=max(0.0, rem - h),',
    ]
    reads = [
        '"remaining_hours": subscription_pool.get_float(user.subscription, "remaining_hours"),',
        '            "used_hours": subscription_pool.get_float(sub, "used_hours")',
        'rem = subscription_pool.get_float(sub, "remaining_hours")',
        'x = 1  # remaining_hours = 5',
    ]
    for l in writes:
        assert _is_direct_pool_write(l), f"запись не поймана: {l}"
    for l in reads:
        assert not _is_direct_pool_write(l), f"чтение принято за запись: {l}"


def test_no_direct_pool_writes_outside_subscription_pool():
    """Смотрим backend/app И backend/scripts (скрипты правят живые деньги не
    реже кода). Исключения — сам subscription_pool и разовые скрипты июля."""
    bad = []
    for sub_dir in ("app", "scripts"):
        for root, _, files in os.walk(os.path.join(_BACKEND, sub_dir)):
            for fn in files:
                if not fn.endswith(".py"):
                    continue
                path = os.path.join(root, fn)
                rel = os.path.relpath(path, _BACKEND)
                if rel == os.path.join("app", "services", "subscription_pool.py"):
                    continue
                if sub_dir == "scripts" and fn in _LEGACY_ONE_OFF_SCRIPTS:
                    continue
                for i, line in enumerate(open(path, encoding="utf-8"), 1):
                    if _is_direct_pool_write(line):
                        bad.append(f"{rel}:{i}: {line.strip()[:100]}")
    assert not bad, "часы абонемента пишутся мимо subscription_pool:\n  " + "\n  ".join(bad)


def test_pool_helpers_exist():
    for fn in ("debit_hours", "credit_hours", "grant_hours", "pool_fields"):
        assert callable(getattr(subscription_pool, fn, None)), f"нет subscription_pool.{fn}"


if __name__ == "__main__":
    if "--print" in sys.argv:
        print(json.dumps(run_scenarios(), ensure_ascii=False, indent=1))
        sys.exit(0)
    if "--write-expected" in sys.argv:
        json.dump(run_scenarios(), open(EXPECTED_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("written", EXPECTED_PATH)
        sys.exit(0)
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"  FAIL {name}: {e}")
    print("guard_hours_pool_moves:", "FAILED" if failed else "OK")
    sys.exit(1 if failed else 0)
