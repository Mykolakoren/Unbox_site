"""Куда ушли деньги клиента — ручки распределения баланса (03.10).

Только чтение: раскладка ленты баланса «какие деньги за что заплатили»
(services/balance_allocation.py). Отдельный файл роутера: денежные ручки
броней и клиентов (bookings/routes.py, users/admin.py) не трогаем.

  GET /users/{user_id}/balance-allocation — карточка клиента и попап брони:
      по каждой строке ленты «ушло на / из / в долг», партии на балансе,
      долги по броням, покрытие ещё не списанных броней.
      Право — как у ленты баланса (/users/{id}/balance-ledger): любой админ.

  GET /balance-allocation/summary — значки «к оплате» в шахматке, списке
      броней, «Сегодня» (компьютер и телефон): по каждому клиенту с ненулевым
      балансом — партии (плюс) или долги по броням (минус), ВКЛЮЧАЯ брони вне
      окна админки (последние 5000 броней).
      Право — админ + crm.view_clients: это данные о клиентах (баланс и долг
      по их броням), которые и так видит любой админ в списке клиентов и в
      шахматке. finance.view_reports — про кассу и отчёты; если бы значки
      зависели от него, админ без отчётов видел бы «к оплате» не на тех бронях.
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api import deps
from app.db.session import get_session
from app.models.user import User
from app.services import balance_allocation

router = APIRouter()


def _resolve_user(session: Session, user_id: str) -> User:
    user = None
    try:
        user = session.get(User, UUID(user_id))
    except ValueError:
        pass
    if not user:
        user = session.exec(select(User).where(User.email == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"User not found (ID: {user_id})")
    return user


def require_clients_view(current_user: User = Depends(deps.require_admin)) -> User:
    if not deps.has_permission(current_user, "crm.view_clients"):
        raise HTTPException(status_code=403, detail="Нет права crm.view_clients")
    return current_user


@router.get("/users/{user_id}/balance-allocation")
def get_user_balance_allocation(
    *,
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    user = _resolve_user(session, user_id)
    return balance_allocation.client_allocation(session, user)


@router.get("/balance-allocation/summary")
def get_balance_allocation_summary(
    *,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_clients_view),
) -> Any:
    return balance_allocation.summary(session)
