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
