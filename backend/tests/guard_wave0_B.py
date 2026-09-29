"""СТОРОЖ wave0-B — порядок оплаты брони: бонус → абонемент → баланс.

Решение владельца 29.09: 1) бонусные часы идут первыми, если их хватает на
ВСЮ бронь; 2) иначе абонемент, если он покрывает; 3) иначе баланс. Клиент
может сам переключиться, и сервер обязан уважать явный выбор бонуса (раньше
он молча менял его на абонемент — G4-client-mobile-M3).

Что ловим:
  * сервер снова ставит абонемент впереди бонуса или молча переписывает
    явный бонус;
  * частичный бонус открывает старую утечку (абонементная цена 0 ₾ при
    ярлыке не-`subscription` — 1630 ₾ в июле);
  * десктопный мастер снова шлёт «Бонусные часы» как 'balance' и списывает
    деньги (G3-03);
  * проверка баланса снова блокирует бронь, за которую деньги не берутся
    (владелец абонемента с малым балансом, новичок с бонус-часом — G4-01).

Без сети и без боевой базы (SQLite в памяти + чтение исходников):

    python3 backend/tests/guard_wave0_B.py
"""
import os
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from app.services.pricing import PriceBreakdown, resolve_payment_method  # noqa: E402

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_REPO = os.path.join(_BACKEND, "..")


def _read(rel: str, base: str = _REPO) -> str:
    return open(os.path.join(base, rel), encoding="utf-8").read()


def _quote(rule: str, final: float, hours: float = 1.0) -> PriceBreakdown:
    return PriceBreakdown(
        base_price=20.0 * hours, hourly_rate=20.0, booked_hours=hours,
        applied_rule=rule, final_price=final,
        hours_deducted=(hours if rule == "SUBSCRIPTION" else 0.0),
    )


def _body(src: str, start: str, end: str = "\n@router.") -> str:
    i = src.find(start)
    assert i != -1, f"не нашли {start!r}"
    j = src.find(end, i + len(start))
    return src[i:j if j != -1 else len(src)]


# ─────────────────────────────────────────────────────────────────────────
# Сервер: resolve_payment_method
# ─────────────────────────────────────────────────────────────────────────

def test_bonus_goes_first_when_it_covers_whole_booking():
    """«Реши сам» (balance — так шлют и сайт, и TG-бот): бонус, которого
    хватает на всю бронь, идёт раньше абонемента и раньше денег."""
    assert resolve_payment_method("balance", _quote("SUBSCRIPTION", 0), bonus_hours_available=1.0) == "bonus"
    assert resolve_payment_method("balance", _quote("NONE", 20), bonus_hours_available=2.0) == "bonus"
    assert resolve_payment_method(None, _quote("NONE", 20), bonus_hours_available=1.0) == "bonus"


def test_partial_bonus_never_preempts_subscription():
    """Бонус не на всю бронь → абонемент. Даже явный 'bonus' при абонементной
    котировке обязан стать 'subscription' — иначе остаток уйдёт по цене 0 ₾
    и часы не сгорят (утечка 1630 ₾)."""
    q = _quote("SUBSCRIPTION", 0, hours=2.0)
    assert resolve_payment_method("balance", q, bonus_hours_available=1.0) == "subscription"
    assert resolve_payment_method("bonus", q, bonus_hours_available=1.0) == "subscription"
    assert resolve_payment_method("bonus", q) == "subscription"
    # Без абонемента и без бонуса ярлык денежный.
    assert resolve_payment_method("balance", _quote("NONE", 40, hours=2.0), bonus_hours_available=1.0) == "balance"


def test_explicit_bonus_is_respected_over_subscription():
    """G4-client-mobile-M3: клиент явно выбрал бонус при действующем
    абонементе — тратим бонус, а не оплаченные часы абонемента."""
    assert resolve_payment_method("bonus", _quote("SUBSCRIPTION", 0), bonus_hours_available=1.0) == "bonus"


def test_explicit_subscription_and_service_labels_untouched():
    """Клиент переключился на абонемент — уважаем; служебные ярлыки
    (cash/service от админа) порядок оплаты не трогает."""
    assert resolve_payment_method("subscription", _quote("SUBSCRIPTION", 0), bonus_hours_available=5.0) == "subscription"
    for m in ("cash", "service"):
        assert resolve_payment_method(m, _quote("SUBSCRIPTION", 0), bonus_hours_available=5.0) == m
        assert resolve_payment_method(m, _quote("NONE", 20), bonus_hours_available=5.0) == m


def test_bonus_not_burned_on_free_booking():
    """Comp-аккаунт / персональные 100 %: бронь и так 0 ₾ — бонус-час не
    сжигаем, даже если экран прислал 'bonus'."""
    for rule in ("COMP_ACCOUNT", "PERSONAL_DISCOUNT"):
        q = _quote(rule, 0)
        assert resolve_payment_method("balance", q, bonus_hours_available=3.0) == "balance"
        assert resolve_payment_method("bonus", q, bonus_hours_available=3.0) == "balance"


# ─────────────────────────────────────────────────────────────────────────
# Сервер: _resolve_with_bonus (перекотировка + FIFO-списание бонуса)
# ─────────────────────────────────────────────────────────────────────────

class _FakePricing:
    """Движок цены без БД: считает 20 ₾/ч и запоминает, просили ли его
    игнорировать абонемент."""

    def __init__(self):
        self.calls = []

    def calculate_price(self, **kw):
        self.calls.append(kw)
        hrs = kw["duration_minutes"] / 60.0
        return PriceBreakdown(base_price=20.0 * hrs, hourly_rate=20.0, booked_hours=hrs,
                              applied_rule="NONE", final_price=20.0 * hrs)


def _bonus_db(hours_list):
    from sqlmodel import Session, create_engine
    from app.models.bonus import Bonus
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Bonus.__table__.create(engine)
    uid = str(uuid4())
    s = Session(engine)
    for i, h in enumerate(hours_list):
        s.add(Bonus(user_id=uid, type="free_hour", quantity=h, status="active",
                    expires_at=datetime.now() + timedelta(days=10 + i)))
    s.commit()
    return s, uid


def _resolve(session, uid, requested, quote, bonus_left, consume=True, extras=0.0):
    from app.api.v1.bookings.routes import _resolve_with_bonus
    pricing = _FakePricing()
    out = _resolve_with_bonus(
        session, pricing, SimpleNamespace(id=uid), requested, quote,
        resource_id="room_1", start_dt=datetime(2026, 10, 1, 12, 0),
        duration_minutes=int(quote.booked_hours * 60), format_type="individual",
        bonus_left=bonus_left, extras_price=extras, consume=consume,
    )
    return out, pricing


def test_bonus_booking_requoted_without_subscription_and_spent():
    """Бонусная бронь не должна остаться с абонементной котировкой: её
    перекотировывают с ignore_subscription, бонус тратится FIFO, цена 0."""
    from app.services.bonus_service import available_free_hours
    s, uid = _bonus_db([1.0])
    (method, quote, covered), pricing = _resolve(
        s, uid, "balance", _quote("SUBSCRIPTION", 0), available_free_hours(s, uid), extras=5.0)
    s.commit()
    assert method == "bonus", method
    assert pricing.calls and pricing.calls[0].get("ignore_subscription") is True, \
        "бонусную бронь не перекотировали без абонемента"
    assert quote.applied_rule != "SUBSCRIPTION" and float(quote.hours_deducted or 0) == 0
    assert covered == 1.0 and quote.final_price == 0.0, (covered, quote.final_price)
    assert available_free_hours(s, uid) == 0.0, "бонус-час не потрачен"


def test_partial_bonus_leaves_subscription_and_bonus_intact():
    """Бонуса 0.5 ч на часовую бронь при абонементе: берём абонемент, бонус
    не трогаем, котировку не меняем."""
    from app.services.bonus_service import available_free_hours
    s, uid = _bonus_db([0.5])
    q = _quote("SUBSCRIPTION", 0)
    (method, quote, covered), pricing = _resolve(s, uid, "balance", q, 0.5)
    s.commit()
    assert method == "subscription" and covered == 0.0
    assert not pricing.calls and quote.applied_rule == "SUBSCRIPTION"
    assert available_free_hours(s, uid) == 0.5


def test_explicit_partial_bonus_without_subscription_keeps_old_rule():
    """Старое правило 20.07 цело: явный бонус без абонемента — бонус-часы
    бесплатно, остаток по обычной цене."""
    s, uid = _bonus_db([1.0])
    (method, quote, covered), _ = _resolve(s, uid, "bonus", _quote("NONE", 30, hours=1.5), 1.0)
    s.commit()
    assert method == "bonus" and covered == 1.0
    assert abs(quote.final_price - 10.0) < 0.01, quote.final_price


def test_series_tryon_does_not_spend_bonus():
    """«Примерка» серии считает бонус, но ничего не списывает."""
    from app.services.bonus_service import available_free_hours
    s, uid = _bonus_db([1.0])
    (method, _q, covered), _ = _resolve(s, uid, "balance", _quote("NONE", 20), 1.0, consume=False)
    assert method == "bonus" and covered == 1.0
    assert available_free_hours(s, uid) == 1.0, "примерка потратила бонус"
    src = _read("app/api/v1/bookings/routes.py", _BACKEND)
    body = _body(src, "def quote_recurring_booking", "def create_recurring_booking")
    assert "consume=False" in body, "примерка серии списывает бонусы"


def test_every_create_path_uses_bonus_first_resolver():
    """Порядок оплаты одинаков везде, где рождается бронь: разовая, пачка,
    серия, продление серии (и примерка серии)."""
    src = _read("app/api/v1/bookings/routes.py", _BACKEND)
    for fn in ("def create_booking", "def create_multi_slot_booking", "def quote_recurring_booking",
               "def create_recurring_booking", "def extend_recurring_series"):
        assert "_resolve_with_bonus(" in _body(src, fn), f"{fn}: порядок оплаты не через _resolve_with_bonus"
    helper = _body(src, "def _resolve_with_bonus", "\n# ─── Create booking")
    assert "ignore_subscription=True" in helper, "бонусная бронь снова остаётся с абонементной котировкой"


# ─────────────────────────────────────────────────────────────────────────
# Фронт: десктоп шлёт 'bonus', экран = сервер, проверка баланса только за деньги
# ─────────────────────────────────────────────────────────────────────────

def test_desktop_wizard_sends_bonus():
    """G3-03: finalMethod в ConfirmationStep был типа 'subscription' | 'balance'
    — «Бонусные часы — бесплатно» уходили как 'balance' и списывали деньги."""
    src = _read("src/components/Wizard/ConfirmationStep.tsx")
    assert "'subscription' | 'balance' =" not in src, "finalMethod снова без 'bonus'"
    assert "const finalMethod: PayMethod = resolveFinalMethod(" in src
    assert "paymentMethod: finalMethod" in src
    pp = _read("src/utils/paymentPriority.ts")
    assert "export type PayMethod = 'balance' | 'subscription' | 'bonus'" in pp


def test_bonus_filter_moved_but_still_accepts_free_hour():
    """Фильтр бонус-часов переехал из ConfirmationStep в paymentPriority
    (общий для десктопа и телефона). Он обязан принимать 'free_hour' —
    иначе подарочный час снова станет невидимым (кейс Оксаны)."""
    pp = _read("src/utils/paymentPriority.ts")
    i = pp.find("export function activeBonusHours")
    assert i != -1, "activeBonusHours пропал"
    assert "'free_hour'" in pp[i:i + 800], "фильтр бонусов не принимает 'free_hour'"
    for rel in ("src/components/Wizard/ConfirmationStep.tsx", "src/pages/mobile/MobileCheckout.tsx"):
        assert "useActiveBonusHours(" in _read(rel), f"{rel}: бонус-часы считаются мимо общего фильтра"


def test_frontend_default_follows_server_priority():
    """Экран выбирает по умолчанию то же, что сервер: бонус → абонемент → баланс
    (раньше по умолчанию стоял «Баланс», а сервер брал часы — G4-01)."""
    pp = _read("src/utils/paymentPriority.ts")
    assert "bonusCovers ? 'bonus' : subCovers ? 'subscription' : 'balance'" in pp, \
        "порядок по умолчанию на фронте разошёлся с сервером"
    for rel in ("src/components/Wizard/ConfirmationStep.tsx", "src/pages/mobile/MobileCheckout.tsx"):
        assert "plan.auto" in _read(rel), f"{rel}: способ по умолчанию не следует порядку оплаты"


def test_balance_precheck_only_when_money_is_charged():
    """G4-01: проверка «Не хватает N ₾» — только когда реально платим
    деньгами. Бонус и абонемент сервер спишет часами."""
    mob = _read("src/pages/mobile/MobileCheckout.tsx")
    i = mob.find("Не хватает ${shortfall")
    assert i != -1, "мобильная проверка баланса пропала/переехала — обнови сторожа"
    k = mob.rfind("if (finalMethod", 0, i)
    assert k != -1 and i - k < 1500, "мобильная проверка баланса не завязана на способ оплаты"
    gate = mob[k:mob.find("\n", k)]
    assert "finalMethod === 'balance'" in gate, "мобильная проверка баланса бьёт и по бонусу/абонементу"
    desk = _read("src/components/Wizard/ConfirmationStep.tsx")
    j = desk.find("Недостаточно средств для бронирования")
    assert j != -1, "десктопная проверка баланса пропала/переехала — обнови сторожа"
    head = desk[:j]
    gate = head[head.rfind("if (effectiveUser"):]
    assert "chargesMoney" in gate.split("\n")[0], "десктопная проверка баланса не смотрит на способ оплаты"
    assert ": finalMethod === 'balance';" in head, "chargesMoney не завязан на оплату деньгами"


def test_summary_has_no_second_payment_switch():
    """G3-03: в правой колонке был второй переключатель «Абонемент | Депозит»
    без бонусов. Выбор — в одном месте (ConfirmationStep)."""
    src = _read("src/components/Summary.tsx")
    assert "setPaymentMethod(" not in src, "в Summary снова свой переключатель оплаты"
    assert ">Депозит<" not in src, "в Summary снова кнопка «Депозит»"


def test_cron_message_says_money_on_subscription_fallback():
    """M1: абонемент исчерпан → крон списал деньги (hours_deducted=0), а
    TG писал «N ч абонемента» — списание денег было замаскировано."""
    src = _read("app/api/v1/billing.py", _BACKEND)
    assert '_pm == "subscription" and (b.hours_deducted or 0) > 0' in src


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
    print("СТОРОЖ wave0-B: OK" if not failures else f"СТОРОЖ wave0-B УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
