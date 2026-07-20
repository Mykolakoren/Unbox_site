"""Wallet — единая точка изменения баланса клиента (Шаг 3).

Любое движение баланса должно идти ЧЕРЕЗ этот сервис: он меняет user.balance
и пишет строку в BalanceLedger (аудит). Прямые `user.balance = ...` по коду
постепенно заменяются на wallet.credit/debit/set_balance.

Поведение (значение баланса) не меняется — добавляется только лента. Поэтому
миграция мест вызова безопасна: та же сумма, то же направление, плюс аудит.

Caller коммитит сессию (как и раньше при прямом присваивании).
"""
from __future__ import annotations

from typing import Optional

from sqlmodel import Session

from app.models.user import User
from app.models.balance_ledger import BalanceLedger


def apply(
    session: Session,
    user: User,
    delta: float,
    reason: str,
    *,
    description: str = "",
    ref_type: Optional[str] = None,
    ref_id: Optional[str] = None,
    actor: Optional[User] = None,
    actor_id: Optional[str] = None,
    actor_name: Optional[str] = None,
) -> float:
    """Изменить баланс на `delta` (+/−) и записать строку в ленту.

    Возвращает новый баланс. delta==0 всё равно логируем (видно «нулевое»
    касание — редко, но для полноты аудита полезно). Округление — до копеек,
    как везде в денежной логике.
    """
    new_balance = round(float(user.balance or 0) + float(delta), 2)
    user.balance = new_balance
    session.add(user)

    a_id = actor_id if actor_id is not None else (str(actor.id) if actor else None)
    a_name = actor_name if actor_name is not None else (actor.name if actor else None)
    session.add(BalanceLedger(
        user_id=str(user.id),
        delta=round(float(delta), 2),
        balance_after=new_balance,
        reason=reason,
        description=description or "",
        ref_type=ref_type,
        ref_id=ref_id,
        actor_id=a_id,
        actor_name=a_name,
    ))
    return new_balance


def credit(session: Session, user: User, amount: float, reason: str, **kw) -> float:
    """Пополнить баланс на abs(amount)."""
    return apply(session, user, abs(float(amount)), reason, **kw)


def debit(session: Session, user: User, amount: float, reason: str, **kw) -> float:
    """Списать с баланса abs(amount)."""
    return apply(session, user, -abs(float(amount)), reason, **kw)


def set_balance(session: Session, user: User, new_balance: float, reason: str, **kw) -> float:
    """Установить абсолютный баланс (корректировка/сверка) — с записью дельты."""
    delta = round(float(new_balance) - float(user.balance or 0), 2)
    return apply(session, user, delta, reason, **kw)
