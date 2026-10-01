"""Продажа абонемента одной операцией (владелец 29.09, «касса — делай»).

Раньше абонемент продавали в два шага, и второй терялся:
  • касса с категорией «Абонементы» только зачисляла деньги на баланс, сам
    абонемент не включался (Надежда Мирошина, Марина Бусина 12.09);
  • кнопка «Назначить абонемент» в карточке при оплате наличными/картой
    писала только абонемент — в кассу и в историю баланса ничего не попадало.

sell_subscription делает всё сразу, в одной транзакции:
  1. наличные/карта → приход в кассу (категория «Абонементы») + зачисление на
     баланс (topup) — как обычное пополнение через кассу;
     с баланса → проверка, что денег хватает;
  2. списание за абонемент (subscription_purchase);
  3. новый пул часов по тарифу. Остаток ещё действующего абонемента не
     сгорает — переносится в новый (бонусными часами);
  4. будущие брони клиента, ещё не списанные (pending) и оплачиваемые
     деньгами, переводятся на часы, если тариф их покрывает.

Каталог тарифов — копия src/utils/data.ts SUBSCRIPTION_PLANS (цены сверены
владельцем 24.07). Сторож test_subscription_sale следит, чтобы они совпадали.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional
from uuid import uuid4

from sqlmodel import Session, select

from app.models.booking import Booking
from app.models.cashbox_transaction import CashboxTransaction
from app.models.user import User
from app.services import subscription_pool, wallet

# free_reschedules — бесплатные переносы позже суток (не позже чем за 3 ч),
# решение владельца 01.10: Тёплый 1, Регулярный 2, Профи+ 3, Пробный и
# Групповой 0. Тратит reschedule_booking (services/subscription_perks.py).
# freeze_days — бюджет дней заморозки «как на сайте» (владелец 01.10):
# Регулярный 7, Профи+ 30, остальные 0. Бюджет делится на несколько пауз.
# extra_hours / extra_kind — доп. пул (владелец 01.10, шаг 4): часы капсулы
# Пробный 1, Тёплый 4, Регулярный 6, Профи+ 10; у Группового мастера
# «4 ч индивидуально» — только кабинеты, индивидуальный формат. Порядок
# списания — services/subscription_pool.plan_split.
PLANS: dict[str, dict] = {
    "TRIAL": dict(name="Пробный", hours=4, bonus_hours=0, price=70, duration_days=14,
                  discount_percent=0, formats=["individual"], free_reschedules=0, freeze_days=0,
                  extra_hours=1, extra_kind="capsule"),
    "WARM_START": dict(name="Тёплый старт", hours=10, bonus_hours=0, price=180, duration_days=30,
                       discount_percent=10, formats=["individual"], free_reschedules=1, freeze_days=0,
                       extra_hours=4, extra_kind="capsule"),
    "REGULAR_PRACTITIONER": dict(name="Регулярный практик", hours=20, bonus_hours=0, price=350,
                                 duration_days=30, discount_percent=15, formats=["individual"],
                                 free_reschedules=2, freeze_days=7, extra_hours=6, extra_kind="capsule"),
    "PRO_PLUS": dict(name="Профи+", hours=40, bonus_hours=2, price=650, duration_days=45,
                     discount_percent=20, formats=["individual", "group", "intervision"],
                     free_reschedules=3, freeze_days=30, extra_hours=10, extra_kind="capsule"),
    "GROUP_MASTER": dict(name="Групповой мастер", hours=20, bonus_hours=0, price=450, duration_days=45,
                         discount_percent=25, formats=["group"], free_reschedules=0, freeze_days=0,
                         extra_hours=4, extra_kind="individual"),
}

CASH_METHODS = {"cash": "наличные", "card_tbc": "карта TBC", "card_bog": "карта BOG"}
SUBSCRIPTION_CATEGORY_ID = "cat-subscription"


class SaleError(ValueError):
    """Продать нельзя — текст для админа."""


def _subscription_category(session: Session, requested: Optional[str]) -> Optional[str]:
    """id категории кассы «Абонементы»: выбранная в кассе → cat-subscription →
    поиск по имени → без категории. category_id — внешний ключ, несуществующий
    id уронил бы всю продажу."""
    from app.models.expense_category import ExpenseCategory
    for cid in (requested, SUBSCRIPTION_CATEGORY_ID):
        if cid and session.get(ExpenseCategory, cid):
            return cid
    cat = session.exec(select(ExpenseCategory).where(ExpenseCategory.name.ilike("%абонемент%"))).first()
    return cat.id if cat else None


def build_subscription(plan_id: str, now: datetime, carry_hours: float = 0.0,
                       carry_extra_hours: float = 0.0) -> dict:
    """Новый пул по тарифу. carry_hours — остаток основного пула старого
    абонемента (бонусными часами), carry_extra_hours — остаток доп. пула того
    же вида (капсула → капсула), прибавляется к доп. пулу тарифа."""
    p = PLANS[plan_id]
    bonus = float(p["bonus_hours"]) + float(carry_hours)
    total = float(p["hours"])
    extra_total = float(p.get("extra_hours", 0)) + max(0.0, float(carry_extra_hours or 0))
    return subscription_pool.update({}, **{
        "id": str(uuid4()), "plan_id": plan_id, "name": p["name"],
        **subscription_pool.pool_fields(total, round(bonus, 2)),
        **subscription_pool.extra_fields(p.get("extra_kind"), extra_total),
        "free_reschedules": p["free_reschedules"], "free_reschedules_used": 0,
        "expiry_date": (now + timedelta(days=p["duration_days"])).isoformat(),
        "is_frozen": False, "freeze_count": 0, "discount_percent": p["discount_percent"],
        "freeze_days_total": float(p["freeze_days"]), "freeze_days_used": 0.0,
        "freeze_days_left": float(p["freeze_days"]),
        "included_formats": list(p["formats"]), "status": "active",
    })


def sell_subscription(
    session: Session,
    user: User,
    plan_id: str,
    method: str,
    actor: User,
    amount: Optional[float] = None,
    branch: Optional[str] = None,
    category_id: Optional[str] = None,
) -> dict:
    """Продать абонемент. Не коммитит — это делает вызывающий (одна транзакция)."""
    if plan_id not in PLANS:
        raise SaleError("Неизвестный тариф")
    p = PLANS[plan_id]
    price = round(float(amount if amount is not None else p["price"]), 2)
    if price <= 0:
        raise SaleError("Сумма должна быть больше 0")
    if method not in CASH_METHODS and method != "balance":
        raise SaleError("Способ оплаты: наличные, карта TBC, карта BOG или с баланса")
    if method == "balance" and float(user.balance or 0) < price:
        raise SaleError(f"Недостаточно средств на балансе: {float(user.balance or 0):g} ₾, нужно {price:g} ₾")

    now = datetime.utcnow()
    tx_id = None
    if method in CASH_METHODS:
        tx = CashboxTransaction(
            type="income", amount=price, currency="GEL", payment_method=method,
            category_id=_subscription_category(session, category_id), description=f'Абонемент "{p["name"]}"',
            branch=branch, date=now, admin_id=str(actor.id), admin_name=actor.name or "",
            client_id=str(user.id), client_name=user.name, credited_user_id=str(user.id),
        )
        session.add(tx)
        session.flush()
        tx_id = tx.id
        wallet.credit(session, user, price, reason="topup",
                      description=f"Пополнение через кассу ({method}) — оплата абонемента «{p['name']}»",
                      ref_type="cashbox_tx", ref_id=str(tx.id), actor=actor)

    note = "" if price == float(p["price"]) else f" — цена {price:g} ₾ (по прайсу {p['price']} ₾)"
    wallet.debit(session, user, price, reason="subscription_purchase",
                 description=f"Оплата абонемента «{p['name']}»{note}",
                 ref_type="user", ref_id=str(user.id), actor=actor)

    old = user.subscription
    carry = 0.0
    carry_extra = 0.0
    if (old and not subscription_pool.get(old, "weekly_package", False)
            and not subscription_pool.is_expired(old, now)):
        carry = max(0.0, subscription_pool.get_float(old, "remaining_hours"))
        # Доп. пул старого абонемента тоже не сгорает: того же вида (капсула →
        # капсула) — в доп. пул нового; другого вида или у нового тарифа его
        # нет — в основной (бонусными часами), как и остаток основного.
        old_extra = subscription_pool.extra_remaining(old)
        if old_extra > 0:
            if subscription_pool.extra_kind(old) == p.get("extra_kind"):
                carry_extra = old_extra
            else:
                carry += old_extra
    user.subscription = build_subscription(plan_id, now, carry, carry_extra)
    session.add(user)
    session.flush()

    # Будущие ещё не списанные брони деньгами → на часы (денег не двигает:
    # pending ещё ничего не списал). Не покрытые тарифом — остаются как есть.
    from app.api.v1.bookings.routes import _convert_booking_to_subscription
    converted = []
    pending = session.exec(select(Booking).where(
        Booking.user_uuid == user.id, Booking.status == "confirmed",
        Booking.payment_method == "balance", Booking.payment_status == "pending",
        Booking.date >= datetime(now.year, now.month, now.day),
    ).order_by(Booking.date, Booking.start_time)).all()
    for b in pending:
        try:
            r = _convert_booking_to_subscription(session, b, actor)
            converted.append({"date": b.date.date().isoformat(), "start_time": b.start_time,
                              "hours": r["hours_deducted"]})
        except ValueError:
            continue

    return {
        "plan": p["name"], "price": price, "method": method, "cashbox_tx_id": tx_id,
        "carried_hours": round(carry + carry_extra, 2), "converted_bookings": converted,
        "carried_extra_hours": round(carry_extra, 2),
        "extra_hours": subscription_pool.extra_remaining(user.subscription),
        "extra_kind": subscription_pool.extra_kind(user.subscription),
        "remaining_hours": subscription_pool.get_float(user.subscription, "remaining_hours"),
        "expiry_date": subscription_pool.get(user.subscription, "expiry_date"),
        "balance": float(user.balance or 0),
    }
