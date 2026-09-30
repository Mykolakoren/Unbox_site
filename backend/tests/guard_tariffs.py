"""СТОРОЖ «обещания тарифов → в систему» (владелец 01.10).

Шаг 1 — приветственный час без абонемента тратится сам и ЧАСТИЧНО:
бронь 2 ч при 1 ч бонуса = 1 ч бесплатно + 1 ч деньгами. При действующем
абонементе — как раньше: бонус только если покрывает бронь целиком, иначе
абонемент.

Что ловим:
  * частичный бонус снова не тратится сам (час сгорает неиспользованным);
  * частичный бонус лезет в бронь при действующем абонементе;
  * абонементная котировка уходит с ярлыком не-`subscription` (утечка 1630 ₾);
  * экран (paymentPriority.ts) обещает не то, что сделает сервер.

Без сети и без боевой базы (SQLite в памяти + вызовы функций):

    python3 backend/tests/guard_tariffs.py
"""
import os
import sys
from datetime import datetime, timedelta
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from sqlmodel import Session, SQLModel, create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401  — регистрирует все таблицы
from app.models.bonus import Bonus  # noqa: E402
from app.models.resource import Resource  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import subscription_pool  # noqa: E402

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_REPO = os.path.join(_BACKEND, "..")


def _read(rel: str) -> str:
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _db() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    s = Session(engine)
    s.add(Resource(id="room_1", name="Кабинет 1", type="cabinet", location_id="unbox_uni",
                   hourly_rate=20.0, capacity=4, area=10, formats=["individual"]))
    s.commit()
    return s


def _active_sub(plan_id: str = "REGULAR_PRACTITIONER", **over) -> dict:
    from app.services.subscription_sale import build_subscription
    sub = build_subscription(plan_id, datetime.utcnow())
    return subscription_pool.update(sub, **over) if over else sub


def _user(s: Session, sub=None, bonus_hours: float = 0.0, email=None) -> User:
    u = User(email=email or f"{uuid4().hex[:8]}@x.ge", name="Клиент", hashed_password="x",
             balance=100.0, subscription=sub)
    s.add(u)
    s.commit()
    if bonus_hours:
        s.add(Bonus(user_id=str(u.id), type="free_hour", quantity=bonus_hours, status="active",
                    expires_at=datetime.now() + timedelta(days=10)))
        s.commit()
    s.refresh(u)
    return u


def _book(s: Session, u: User, hours: float, requested="balance"):
    """Как create_booking: котировка → порядок оплаты → трата бонуса."""
    from app.api.v1.bookings.routes import _resolve_with_bonus
    from app.services.bonus_service import available_free_hours
    from app.services.pricing import PricingService
    ps = PricingService(s)
    start = (datetime.now() + timedelta(days=3)).replace(hour=12, minute=0, second=0, microsecond=0)
    minutes = int(hours * 60)
    quote = ps.calculate_price(user=u, resource_id="room_1", start_time=start,
                               duration_minutes=minutes, format_type="individual")
    full = float(quote.final_price)
    method, quote, covered = _resolve_with_bonus(
        s, ps, u, requested, quote, resource_id="room_1", start_dt=start,
        duration_minutes=minutes, format_type="individual",
        bonus_left=available_free_hours(s, u.id),
    )
    s.commit()
    return method, quote, covered, full


# ─────────────────────────────────────────────────────────────────────────
# Шаг 1. Приветственный час
# ─────────────────────────────────────────────────────────────────────────

def test_welcome_hour_partial_without_subscription():
    """Бронь 2 ч без абонемента, 1 ч бонуса → 1 ч бесплатно + 1 ч деньгами."""
    from app.services.bonus_service import available_free_hours
    s = _db()
    u = _user(s, bonus_hours=1.0)
    method, quote, covered, full = _book(s, u, 2.0)
    assert full > 0
    assert method == "bonus", f"частичный бонус не потратился сам: {method}"
    assert covered == 1.0, covered
    assert abs(quote.final_price - full / 2) < 0.01, (quote.final_price, full)
    assert quote.applied_rule != "SUBSCRIPTION" and float(quote.hours_deducted or 0) == 0
    assert available_free_hours(s, u.id) == 0.0, "бонус-час не списан"


def test_welcome_hour_not_partial_with_active_subscription():
    """С действующим абонементом бронь 2 ч при 1 ч бонуса → абонемент,
    бонус не трогаем (он для брони до 1 ч)."""
    from app.services.bonus_service import available_free_hours
    s = _db()
    u = _user(s, sub=_active_sub(), bonus_hours=1.0)
    method, quote, covered, _ = _book(s, u, 2.0)
    assert method == "subscription", method
    assert quote.applied_rule == "SUBSCRIPTION" and covered == 0.0
    assert available_free_hours(s, u.id) == 1.0, "бонус потрачен при абонементе"


def test_welcome_hour_not_partial_with_active_but_exhausted_subscription():
    """Абонемент действует, но часы кончились (SUBSCRIPTION_DISCOUNT) — бонус
    частично не идёт (владелец: при абонементе — только бронь до 1 ч)."""
    s = _db()
    u = _user(s, sub=_active_sub(remaining_hours=0.0), bonus_hours=1.0)
    method, quote, covered, _ = _book(s, u, 2.0)
    assert method == "balance" and covered == 0.0, (method, covered)
    assert not str(quote.applied_rule).startswith("SUBSCRIPTION") or method != "bonus"


def test_welcome_hour_covers_whole_booking():
    """Бонус покрывает бронь целиком → bonus, 0 ₾ — и с абонементом, и без."""
    for sub in (None, _active_sub()):
        s = _db()
        u = _user(s, sub=sub, bonus_hours=1.0)
        method, quote, covered, _ = _book(s, u, 1.0)
        assert method == "bonus" and covered == 1.0, (sub is not None, method, covered)
        assert quote.final_price == 0.0 and quote.applied_rule != "SUBSCRIPTION"


def test_frozen_subscription_counts_as_no_subscription():
    """Абонемент на паузе не действует → приветственный час частично."""
    s = _db()
    u = _user(s, sub=_active_sub(is_frozen=True), bonus_hours=1.0)
    method, _q, covered, _ = _book(s, u, 2.0)
    assert method == "bonus" and covered == 1.0, (method, covered)


def test_no_subscription_quote_ever_leaves_with_non_subscription_label():
    """Утечка 1630 ₾: абонементная котировка при ярлыке не-subscription.
    Перебираем способы и остатки бонусов — ни одной «нулёвки»."""
    from app.services.pricing import PriceBreakdown, resolve_payment_method
    for final in (0.0, 5.0):
        q = PriceBreakdown(base_price=40.0, hourly_rate=20.0, booked_hours=2.0,
                           applied_rule="SUBSCRIPTION", final_price=final, hours_deducted=2.0)
        for req in ("balance", None, "bonus"):
            for bonus in (0.0, 0.5, 1.0, 1.5):  # < 2 ч: бонус не на всю бронь
                for active in (None, True, False):
                    m = resolve_payment_method(req, q, bonus_hours_available=bonus,
                                               has_active_subscription=active)
                    assert m == "subscription", (req, bonus, active, m)


def test_frontend_plan_mirrors_server():
    """Экран: частичный бонус только без действующего абонемента, «N ч
    бонусом + M ₾», и баланс-кнопка закрыта (сервер всё равно возьмёт бонус)."""
    pp = _read("src/utils/paymentPriority.ts")
    assert "const bonusPartial = !opts.isSeries && !bonusCovers && !sub.active" in pp, \
        "частичный бонус на экране не завязан на отсутствие абонемента"
    assert "bonusCovers ? 'bonus' : subCovers ? 'subscription' : bonusPartial ? 'bonus' : 'balance'" in pp
    assert "if (method === 'bonus') return plan.bonusCovers || plan.bonusPartial;" in pp
    assert "!plan.bonusCovers && !plan.subCovers && !plan.bonusPartial" in pp
    for rel in ("src/components/Wizard/ConfirmationStep.tsx", "src/pages/mobile/MobileCheckout.tsx"):
        src = _read(rel)
        assert "бонусом + ${formatGel(plan.bonusMoney)}" in src or "бонусом + {formatGel(plan.bonusMoney)}" in src, \
            f"{rel}: нет подписи «N ч бонусом + M ₾»"
        assert "bonusMoneyDue(plan)" in src, f"{rel}: проверка баланса не учитывает остаток частичного бонуса"


def test_site_texts_explain_welcome_hour_rule():
    for rel in ("src/pages/SubscriptionsPage.tsx", "src/pages/BonusesInfoPage.tsx"):
        src = " ".join(_read(rel).split())
        assert "остальное оплачивается как обычно" in src, f"{rel}: нет «остальное оплачивается как обычно»"
        assert "При действующем абонементе приветственный час тратится на бронь до 1 часа" in src, \
            f"{rel}: нет правила про абонемент"


# ─────────────────────────────────────────────────────────────────────────
# Шаг 2. Перенос позже суток — N раз за абонемент
# ─────────────────────────────────────────────────────────────────────────

def test_plans_free_reschedules_match_owner_decision_and_site():
    from app.services.subscription_sale import PLANS, build_subscription
    want = {"TRIAL": 0, "WARM_START": 1, "REGULAR_PRACTITIONER": 2, "PRO_PLUS": 3, "GROUP_MASTER": 0}
    assert {k: v["free_reschedules"] for k, v in PLANS.items()} == want
    import re
    data = _read("src/utils/data.ts")
    block = data[data.index("export let SUBSCRIPTION_PLANS"):data.index("\n];", data.index("export let SUBSCRIPTION_PLANS"))]
    front = {m.group(1): int(m.group(2)) for m in re.finditer(r"id:\s*'(\w+)'.*?freeReschedules:\s*(\d+)", block, re.S)}
    assert front == want, f"переносы на сайте ≠ сервер: {front}"
    sub = build_subscription("PRO_PLUS", datetime.utcnow())
    assert sub["free_reschedules"] == sub["freeReschedules"] == 3
    assert sub["free_reschedules_used"] == sub["freeReschedulesUsed"] == 0


def test_late_reschedule_rules():
    from app.services.subscription_perks import late_reschedule_refusal as refuse
    now = datetime.utcnow()
    soon = now + timedelta(days=2)
    sub = _active_sub("REGULAR_PRACTITIONER")
    assert refuse(sub, hours_until=10, new_start_utc=soon, now=now) is None
    assert refuse(None, hours_until=10, new_start_utc=soon, now=now).startswith("Перенос невозможен менее чем за 24")
    assert "3 часа" in refuse(sub, hours_until=2.5, new_start_utc=soon, now=now)
    assert refuse(_active_sub("TRIAL"), hours_until=10, new_start_utc=soon, now=now), "Пробный: переносов нет"
    spent = subscription_pool.update(sub, free_reschedules=0, free_reschedules_used=2)
    assert "закончились" in refuse(spent, hours_until=10, new_start_utc=soon, now=now)
    frozen = subscription_pool.update(sub, is_frozen=True)
    assert refuse(frozen, hours_until=10, new_start_utc=soon, now=now), "на паузе переносить нельзя"
    expired = subscription_pool.update(sub, expiry_date=(now - timedelta(days=1)).isoformat())
    assert refuse(expired, hours_until=10, new_start_utc=soon, now=now), "истёкший абонемент дал перенос"
    short = subscription_pool.update(sub, expiry_date=(now + timedelta(days=1)).isoformat())
    assert "срока" in refuse(short, hours_until=10, new_start_utc=soon, now=now), "новая дата за сроком абонемента"
    flex = subscription_pool.update(short, flexible=True)
    assert refuse(flex, hours_until=10, new_start_utc=soon, now=now) is None


def _tb_slot(hours_ahead: float):
    """(date, 'HH:MM') брони через hours_ahead ч по Тбилиси (UTC+4), кратно 30 мин."""
    start = datetime.utcnow() + timedelta(hours=4 + hours_ahead)
    start = start.replace(second=0, microsecond=0) + timedelta(minutes=(30 - start.minute % 30) % 30)
    return start.replace(hour=0, minute=0), start.strftime("%H:%M")


def _booking(s: Session, u: User, hours_ahead: float, **over):
    from app.models.booking import Booking
    d, t = _tb_slot(hours_ahead)
    b = Booking(resource_id="room_1", location_id="unbox_uni", date=d, start_time=t, duration=60,
                status="confirmed", final_price=20.0, payment_method="balance", payment_status="paid",
                charge_amount=20.0, user_id=u.email, user_uuid=u.id, **over)
    s.add(b)
    s.commit()
    s.refresh(b)
    return b


def _staff(s: Session, role="admin") -> User:
    a = User(email=f"{role}-{uuid4().hex[:6]}@x.ge", name="Админ", role=role, hashed_password="x")
    s.add(a)
    s.commit()
    s.refresh(a)
    return a


def _move(s: Session, b, actor: User, days: int = 1, series: bool = False):
    """Перенос на +days дней в то же время (как клиент/админ через эндпоинт)."""
    from fastapi import BackgroundTasks, HTTPException
    from app.api.v1.bookings import routes
    data = routes.RescheduleRequest(new_date=(b.date + timedelta(days=days)).strftime("%Y-%m-%d"),
                                    new_start_time=b.start_time)
    fn = routes.reschedule_booking_series if series else routes.reschedule_booking
    try:
        return fn(booking_id=str(b.id), data=data, background_tasks=BackgroundTasks(),
                  session=s, current_user=actor)
    except HTTPException as exc:
        s.rollback()
        return exc


def _pool(s: Session, u: User) -> dict:
    s.expire_all()
    return s.get(User, u.id).subscription


def test_client_late_reschedule_spends_one_free_reschedule():
    s = _db()
    u = _user(s, sub=_active_sub("REGULAR_PRACTITIONER"))
    b = _booking(s, u, hours_ahead=10)
    old_date = b.date
    out = _move(s, b, u)
    assert not hasattr(out, "status_code"), getattr(out, "detail", out)
    pool = _pool(s, u)
    assert subscription_pool.get_float(pool, "free_reschedules") == 1, pool
    assert pool["freeReschedules"] == 1 and pool["freeReschedulesUsed"] == 1, "счётчик не в обоих диалектах"
    assert s.get(type(b), b.id).date == old_date + timedelta(days=1)
    # Событие переноса дописано (раньше после переезда брони падал flush из-за
    # копии ORM-объекта для листа ожидания — 500 уже после переноса).
    from app.models.timeline import TimelineEvent
    from sqlmodel import select
    ev = [e for e in s.exec(select(TimelineEvent)).all() if e.event_type == "booking_rescheduled"]
    assert ev and ev[-1].metadata_dump.get("free_reschedule_used") is True, "нет события с free_reschedule_used"
    src = _read("backend/app/api/v1/bookings/routes.py")
    body = src[src.index("def reschedule_booking("):src.index("def reschedule_booking_series")]
    assert "_copy(booking)" not in body, "лист ожидания снова получает копию ORM-брони"


def test_client_late_reschedule_refusals_keep_counter():
    # Без абонемента — прежнее правило 24 ч.
    s = _db()
    u = _user(s)
    b = _booking(s, u, hours_ahead=10)
    out = _move(s, b, u)
    assert getattr(out, "status_code", None) == 400 and "24 часа" in out.detail
    # Меньше 3 ч — нельзя даже с абонементом.
    s = _db()
    u = _user(s, sub=_active_sub("PRO_PLUS"))
    b = _booking(s, u, hours_ahead=2)
    out = _move(s, b, u)
    assert getattr(out, "status_code", None) == 400 and "3 часа" in out.detail, out
    assert subscription_pool.get_float(_pool(s, u), "free_reschedules") == 3
    # Слот занят — отказ после траты в памяти: счётчик не должен уехать в БД.
    s = _db()
    u = _user(s, sub=_active_sub("WARM_START"))
    b = _booking(s, u, hours_ahead=10)
    other = _user(s)
    from app.models.booking import Booking
    s.add(Booking(resource_id="room_1", location_id="unbox_uni", date=b.date + timedelta(days=1),
                  start_time=b.start_time, duration=60, status="confirmed", final_price=20.0,
                  payment_method="balance", user_id=other.email, user_uuid=other.id))
    s.commit()
    out = _move(s, b, u)
    assert getattr(out, "status_code", None) == 400, out
    assert subscription_pool.get_float(_pool(s, u), "free_reschedules") == 1, "отказ съел бесплатный перенос"
    # Переносы закончились.
    s = _db()
    u = _user(s, sub=_active_sub("WARM_START", free_reschedules=0, free_reschedules_used=1))
    b = _booking(s, u, hours_ahead=10)
    out = _move(s, b, u)
    assert getattr(out, "status_code", None) == 400 and "закончились" in out.detail


def test_admin_late_reschedule_does_not_spend_counter():
    s = _db()
    u = _user(s, sub=_active_sub("REGULAR_PRACTITIONER"))
    b = _booking(s, u, hours_ahead=10)
    out = _move(s, b, _staff(s))
    assert not hasattr(out, "status_code"), getattr(out, "detail", out)
    pool = _pool(s, u)
    assert subscription_pool.get_float(pool, "free_reschedules") == 2
    assert subscription_pool.get_float(pool, "free_reschedules_used") == 0


def test_series_late_reschedule_is_admin_only():
    s = _db()
    u = _user(s, sub=_active_sub("PRO_PLUS"))
    b = _booking(s, u, hours_ahead=10, recurring_group_id="grp-1")
    out = _move(s, b, u, series=True)
    assert getattr(out, "status_code", None) == 400 and "Серию" in out.detail, out
    assert subscription_pool.get_float(_pool(s, u), "free_reschedules") == 3, "серия потратила бесплатный перенос"


def _script(name: str):
    import importlib.util
    path = os.path.join(_BACKEND, "scripts", name)
    spec = importlib.util.spec_from_file_location(name[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_reschedules_migration_script():
    """Скрипт для уже купленных: число по новому правилу минус потраченное,
    только действующим Тёплый/Регулярный/Профи+, идемпотентно, dry-run по умолчанию."""
    mod = _script("tariffs_reschedules_2026_10.py")
    now = datetime.utcnow()
    old = subscription_pool.update(_active_sub("REGULAR_PRACTITIONER"), free_reschedules=1)
    old.pop("free_reschedules_used"); old.pop("freeReschedulesUsed")
    assert mod.plan_changes(old, now) == {"free_reschedules": 2, "free_reschedules_used": 0}
    spent = _active_sub("WARM_START", free_reschedules=0, free_reschedules_used=1)
    assert mod.plan_changes(spent, now) is None, "повтор/после траты не должен ничего менять"
    assert mod.plan_changes(_active_sub("TRIAL"), now) is None
    assert mod.plan_changes(_active_sub("PRO_PLUS", expiry_date=(now - timedelta(days=1)).isoformat()), now) is None
    fixed = subscription_pool.update(old, **mod.plan_changes(old, now))
    assert mod.plan_changes(fixed, now) is None, "скрипт не идемпотентен"
    src = _read("backend/scripts/tariffs_reschedules_2026_10.py")
    assert 'run("--apply" in sys.argv and "--dry-run" not in sys.argv)' in src
    assert "subscription_pool.update(" in src and "with_for_update()" in src


def test_late_cancel_still_refused():
    """Отмена позже суток по-прежнему 400 — абонемент её не открывает."""
    src = _read("backend/app/api/v1/bookings/routes.py")
    body = src[src.index("def cancel_booking"):src.index("\n@router.", src.index("def cancel_booking"))]
    assert "is_late_cancellation and not _is_past(booking) and not is_admin" in body
    assert "subscription_perks" not in body, "отмену позже суток открыли абонементом"


def test_reschedule_event_and_single_tg_message():
    src = _read("backend/app/api/v1/bookings/routes.py")
    body = src[src.index("def reschedule_booking("):src.index("def reschedule_booking_series")]
    assert body.count("telegram_service.send_booking_rescheduled") == 1, "клиенту снова уходит два сообщения о переносе"
    assert '"free_reschedule_used": free_reschedule_used' in body, "в событии нет free_reschedule_used"
    assert ".with_for_update()" in body and "populate_existing=True" in body, "счётчик тратится без блокировки"


def test_frontend_offers_late_reschedule_like_server():
    util = _read("src/utils/subscription.ts")
    assert "export const LATE_RESCHEDULE_MIN_HOURS = 3;" in util
    assert "if (hoursUntil >= 24 || hoursUntil < LATE_RESCHEDULE_MIN_HOURS) return 0;" in util
    assert "subscriptionLifecycle(sub, now) !== 'active'" in util
    for rel in ("src/pages/MyBookingsPage.tsx", "src/pages/mobile/BookingDetailSheet.tsx"):
        src = _read(rel)
        assert "lateRescheduleLeft(" in src and "lateRescheduleLabel(" in src, f"{rel}: нет «Перенести (осталось N)»"
    sheet = _read("src/pages/mobile/BookingDetailSheet.tsx")
    late = sheet[sheet.index("isLive && !isActive && lateForClient && ("):sheet.index("isLive && !isActive && !lateForClient && (")]
    assert "{lateLeft > 0 && (" in late, "в ветке «меньше суток» перенос не завязан на бесплатные переносы"
    for rel in ("src/components/SubscriptionCard.tsx", "src/pages/mobile/MobileSubscription.tsx"):
        assert "Переносов позже суток" in _read(rel), f"{rel}: нет «Переносов позже суток: осталось N»"


if __name__ == "__main__":
    import traceback
    failed = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"  ✓ {name}")
        except Exception:
            failed += 1
            print(f"  ✗ {name}")
            traceback.print_exc()
    print("СТОРОЖ tariffs: OK" if not failed else f"СТОРОЖ tariffs УПАЛ: {failed}")
    sys.exit(1 if failed else 0)
