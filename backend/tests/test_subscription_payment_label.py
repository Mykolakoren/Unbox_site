"""Ярлык оплаты обязан следовать за котировкой.

Баг, который это ловит (найден 2026-07-14, утекло ~1630 ₾ за 3 месяца):

  PricingService._apply_subscription — приоритет №1. Он покрывает слот
  абонементом всякий раз, когда план это позволяет, и НЕ смотрит, что клиент
  выбрал в интерфейсе. А списывают часы только там, где
  `payment_method == "subscription"` — таких мест шесть, и все они одинаково
  завязаны на ярлык.

  Клиент с абонементом выбирал «оплатить с баланса»:
    цена   -> 0 ₾ (абонемент покрыл комнату)
    списание -> ушло в ветку баланса и сняло эти самые 0 ₾
    часы   -> не сгорели, потому что ярлык не `subscription`
  Итог: кабинет бесплатно, абонемент цел. Telegram-бот подставлял `balance`
  жёстко, поэтому через него текло у каждого владельца абонемента.

Тест — чистая логика, без БД и сети.

    python3 backend/tests/test_subscription_payment_label.py
    pytest backend/tests/test_subscription_payment_label.py

NB: НЕ запускать голый `pytest` внутри backend/ — легаси-скрипты backend/test_*.py
при импорте исполняются против DATABASE_URL.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.pricing import PriceBreakdown, resolve_payment_method  # noqa: E402


def _quote(applied_rule: str, final_price: float = 0.0, hours: float = 1.0) -> PriceBreakdown:
    return PriceBreakdown(
        base_price=20.0,
        hourly_rate=20.0,
        booked_hours=1.0,
        applied_rule=applied_rule,
        final_price=final_price,
        hours_deducted=hours,
    )


def test_subscription_priced_booking_is_relabelled():
    """Клиент выбрал «с баланса», но абонемент покрыл слот — ярлык обязан стать
    `subscription`, иначе часы не спишет никто и кабинет уйдёт за 0 ₾."""
    assert resolve_payment_method("balance", _quote("SUBSCRIPTION")) == "subscription"


def test_telegram_hardcoded_balance_is_relabelled():
    """Бот шлёт payment_method="balance" жёстко (telegram.py) — через него текло
    у КАЖДОГО владельца абонемента. Нормализация обязана поймать и этот путь."""
    assert resolve_payment_method("balance", _quote("SUBSCRIPTION")) == "subscription"


def test_bonus_payer_with_subscription_is_relabelled():
    """Бонусная ветка списания тоже снимает `final_price` (=0) и пул не трогает —
    та же дыра, тот же фикс."""
    assert resolve_payment_method("bonus", _quote("SUBSCRIPTION")) == "subscription"


def test_plain_balance_booking_is_untouched():
    """Регрессия: у клиента без абонемента ничего не меняется — он платит деньги."""
    assert resolve_payment_method("balance", _quote("NONE", final_price=20.0, hours=0.0)) == "balance"


def test_consecutive_discount_stays_on_balance():
    """Регрессия: скидка за часы подряд — это НЕ абонемент, ярлык не трогаем."""
    quote = _quote("CONSECUTIVE_HOURS", final_price=18.0, hours=0.0)
    assert resolve_payment_method("balance", quote) == "balance"


def test_exhausted_subscription_stays_on_balance():
    """Часы кончились -> SUBSCRIPTION_DISCOUNT: комната НЕ покрыта, деньги реально
    списываются с баланса. Перевесить ярлык на `subscription` здесь означало бы
    списать часы, которых нет."""
    quote = _quote("SUBSCRIPTION_DISCOUNT", final_price=15.0, hours=0.0)
    assert resolve_payment_method("balance", quote) == "balance"


def test_service_bookings_are_never_relabelled():
    """Служебные брони (уборка, техработы) идут мимо клиентских денег — их ярлык
    не трогаем даже если у аккаунта есть абонемент."""
    assert resolve_payment_method("service", _quote("SUBSCRIPTION")) == "service"


def test_explicit_subscription_choice_is_preserved():
    assert resolve_payment_method("subscription", _quote("SUBSCRIPTION")) == "subscription"


def test_missing_method_defaults_to_balance():
    assert resolve_payment_method(None, _quote("NONE", final_price=20.0, hours=0.0)) == "balance"


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
    print("OK" if not failures else f"FAILED ({failures})")
    sys.exit(1 if failures else 0)
