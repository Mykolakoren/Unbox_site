"""Cashbox — transactions: balance, list, create, delete."""
from typing import List, Optional, Union
from datetime import datetime, date, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func, col, desc
from app.db.session import get_session
from app.models.user import User
from app.models.expense_category import ExpenseCategory
from app.models.cashbox_transaction import (
    CashboxTransaction, CashboxTransactionCreate, CashboxTransactionRead,
)
from app.api.v1.cashbox import require_cashbox

router = APIRouter()


# ── TZ normalisation for cashbox transaction dates ────────────────────
# The DB column stores naive UTC. Frontend sends Tbilisi wall-clock as a
# naive ISO string ("YYYY-MM-DDTHH:MM"). Without conversion we get a
# split-personality column where some rows are UTC (defaulted to now())
# and others are Tbilisi (admin-typed) — they render with a 4h shift
# relative to each other. This helper is the single normalisation point:
# whatever input shape we get, the result is always naive UTC.
_TZ_TBILISI = timezone(timedelta(hours=4))


def _normalise_tx_date(value: Union[str, datetime, None]) -> datetime:
    """Convert any incoming date representation to naive UTC datetime.

    - None       → utcnow() (naive UTC).
    - aware dt   → astimezone(UTC).replace(tzinfo=None).
    - naive dt   → treat as Tbilisi wall-clock, subtract 4h → UTC-naive.
    - string     → datetime.fromisoformat then recurse.
    """
    if value is None:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except Exception:
            return datetime.now(timezone.utc).replace(tzinfo=None)
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        # Naive: treat as Tbilisi wall-clock per frontend convention.
        return value.replace(tzinfo=_TZ_TBILISI).astimezone(timezone.utc).replace(tzinfo=None)
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("/balance")
def get_balance(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
    branch: Optional[str] = Query(None),
):
    """Балансы кассы по каждому счёту (опционально по филиалу)."""
    methods = ["cash", "card_tbc", "card_bog"]
    balances = {}
    total = 0.0
    for method in methods:
        inc_q = (
            select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
            .where(CashboxTransaction.type == "income")
            .where(CashboxTransaction.payment_method == method)
        )
        exp_q = (
            select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
            .where(CashboxTransaction.type == "expense")
            .where(CashboxTransaction.payment_method == method)
        )
        if branch:
            inc_q = inc_q.where(CashboxTransaction.branch == branch)
            exp_q = exp_q.where(CashboxTransaction.branch == branch)
        inc = session.exec(inc_q).one()
        exp = session.exec(exp_q).one()
        bal = round(float(inc) - float(exp), 2)
        balances[method] = bal
        total += bal
    return {
        "balance": round(total, 2),
        "cash": balances["cash"],
        "card_tbc": balances["card_tbc"],
        "card_bog": balances["card_bog"],
    }


@router.get("/client-total-paid/{user_id}")
def client_total_paid(
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    """«Общая сумма оплат» клиента — из РЕАЛЬНЫХ кассовых приходов, привязанных
    к нему (credited_user_id). Раньше это число считалось из фронтового стора,
    который пустой на перезагрузке — отсюда «не работает через Финансы».
    Теперь единый бэкенд-источник: и «Пополнить», и «Новая операция» пишут
    привязанный приход → оба видны здесь.
    """
    # user_id может прийти как UUID или email — приводим к user.id.
    from uuid import UUID as _UUID
    target = None
    try:
        target = session.get(User, _UUID(str(user_id)))
    except (ValueError, TypeError):
        target = None
    if target is None:
        target = session.exec(select(User).where(User.email == user_id)).first()
    if target is None:
        return {"total_paid": 0.0}

    total = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "income")
        .where(CashboxTransaction.credited_user_id == str(target.id))
    ).one()
    return {"total_paid": round(float(total), 2)}


@router.get("/transactions", response_model=List[CashboxTransactionRead])
def list_transactions(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
):
    stmt = select(CashboxTransaction).order_by(desc(CashboxTransaction.date))

    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from)
            stmt = stmt.where(CashboxTransaction.date >= dt_from)
        except ValueError:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to)
            stmt = stmt.where(CashboxTransaction.date <= dt_to)
        except ValueError:
            pass
    if type and type in ("income", "expense"):
        stmt = stmt.where(CashboxTransaction.type == type)
    if category_id:
        stmt = stmt.where(CashboxTransaction.category_id == category_id)
    if payment_method:
        stmt = stmt.where(CashboxTransaction.payment_method == payment_method)

    stmt = stmt.offset(skip).limit(limit)
    transactions = session.exec(stmt).all()

    # Enrich with category_name
    category_ids = {t.category_id for t in transactions if t.category_id}
    cat_names = {}
    if category_ids:
        cats = session.exec(
            select(ExpenseCategory).where(col(ExpenseCategory.id).in_(category_ids))
        ).all()
        cat_names = {c.id: c.name for c in cats}

    result = []
    for t in transactions:
        data = CashboxTransactionRead.model_validate(t)
        data.category_name = cat_names.get(t.category_id) if t.category_id else None
        result.append(data)
    return result


@router.post("/transactions", response_model=CashboxTransactionRead)
def create_transaction(
    payload: CashboxTransactionCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    if payload.type not in ("income", "expense"):
        raise HTTPException(400, "type должен быть 'income' или 'expense'")
    if payload.amount <= 0:
        raise HTTPException(400, "amount должен быть больше 0")

    cat_name = None
    if payload.category_id:
        cat = session.get(ExpenseCategory, payload.category_id)
        if not cat:
            raise HTTPException(404, "Категория не найдена")
        cat_name = cat.name

    # Resolve client name if client_id provided
    client_name = payload.client_name
    if payload.client_id and not client_name:
        from app.models.therapist_client import TherapistClient
        client = session.get(TherapistClient, payload.client_id)
        if client:
            client_name = client.name

    # ── Optionally credit user balance (Excel #43) ──
    # Only for income transactions with a client selected. We try to resolve
    # the client_id as either a User UUID or an email and top up User.balance.
    credited_user_id: Optional[str] = None
    target_user: Optional[User] = None
    if payload.credit_user_balance and payload.type == "income" and payload.client_id:
        target_user = _resolve_user_from_client_id(session, payload.client_id)
        if not target_user:
            raise HTTPException(
                400,
                "Клиент не найден среди пользователей — нельзя зачислить на баланс. "
                "Выберите клиента из списка зарегистрированных пользователей.",
            )
        credited_user_id = str(target_user.id)
        # Prefer the user's canonical name for the cash-box record
        if not client_name and target_user.name:
            client_name = target_user.name

    # ── Normalise the operation date to UTC-naive ──
    # Frontend sends Tbilisi wall-clock as a naive ISO string
    # ("YYYY-MM-DDTHH:MM"). The DB column is stored UTC-naive (server is
    # UTC). Without conversion the same column carried two different
    # meanings — frontend's naive went in as-is, defaulted-to-now() rows
    # went in as UTC. Display always treats as UTC → entries with
    # explicit date appeared shifted +4h ("кенгуру" admins reported).
    # Always go through `_normalise_tx_date` so the column has one
    # interpretation forever.
    tx = CashboxTransaction(
        type=payload.type,
        amount=payload.amount,
        currency=payload.currency,
        payment_method=payload.payment_method,
        category_id=payload.category_id,
        description=payload.description,
        branch=payload.branch,
        date=_normalise_tx_date(payload.date),
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
        client_id=payload.client_id,
        client_name=client_name,
        credited_user_id=credited_user_id,
    )
    session.add(tx)

    if target_user is not None:
        target_user.balance = float(target_user.balance or 0) + float(payload.amount)
        session.add(target_user)

    session.commit()
    session.refresh(tx)

    result = CashboxTransactionRead.model_validate(tx)
    result.category_name = cat_name
    return result


def _resolve_user_from_client_id(session: Session, client_id: str) -> Optional[User]:
    """Treat client_id as either a User.id (UUID) or a User.email and fetch."""
    if not client_id:
        return None
    # Try UUID path first
    try:
        from uuid import UUID as _UUID
        u = session.get(User, _UUID(client_id))
        if u:
            return u
    except (ValueError, AttributeError):
        pass
    # Fallback: email
    return session.exec(select(User).where(User.email == client_id)).first()


@router.delete("/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    tx = session.get(CashboxTransaction, transaction_id)
    if not tx:
        raise HTTPException(404, "Транзакция не найдена")

    # Senior_admin/owner can delete any transaction immediately
    # Admin can only delete today's transactions; older ones need senior approval
    tx_date = tx.date.date() if isinstance(tx.date, datetime) else tx.date
    is_today = tx_date == date.today()

    if current_user.role not in ("owner", "senior_admin") and not is_today:
        raise HTTPException(403, "Удаление прошлых транзакций требует подтверждения старшего администратора")

    # If this transaction credited a user balance, reverse the credit.
    if tx.credited_user_id:
        try:
            from uuid import UUID as _UUID
            target = session.get(User, _UUID(tx.credited_user_id))
        except (ValueError, AttributeError):
            target = None
        if target:
            target.balance = float(target.balance or 0) - float(tx.amount)
            session.add(target)

    session.delete(tx)
    session.commit()
    return {"ok": True}


@router.patch("/transactions/{transaction_id}", response_model=CashboxTransactionRead)
def update_transaction(
    transaction_id: str,
    payload: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    """Edit an existing transaction. Permission rules mirror delete:
    owner/senior_admin — any transaction; admin — today and yesterday only."""
    tx = session.get(CashboxTransaction, transaction_id)
    if not tx:
        raise HTTPException(404, "Транзакция не найдена")

    # 2026-06-28 owner: РЕДАКТИРОВАТЬ транзакции может только владелец.
    if current_user.role != "owner":
        raise HTTPException(403, "Редактировать транзакции может только владелец")

    # Allowed fields
    allowed = {"type", "amount", "currency", "payment_method", "category_id",
               "description", "branch", "date", "client_id", "client_name"}

    # Snapshot pre-change state to rebalance a credited user afterwards.
    old_amount = float(tx.amount or 0)
    old_type = tx.type
    old_credited_user_id = tx.credited_user_id

    for key, value in payload.items():
        if key in allowed:
            if key == "date" and value:
                value = _normalise_tx_date(value)
            if key == "type" and value not in ("income", "expense"):
                raise HTTPException(400, "type должен быть 'income' или 'expense'")
            if key == "amount" and (value is None or float(value) <= 0):
                raise HTTPException(400, "amount должен быть больше 0")
            setattr(tx, key, value)

    # Resolve client name from client_id if not provided
    if "client_id" in payload and payload["client_id"] and "client_name" not in payload:
        from app.models.therapist_client import TherapistClient
        client = session.get(TherapistClient, payload["client_id"])
        if client:
            tx.client_name = client.name

    # If this transaction previously credited a user, and the amount/type has
    # changed, compensate the user balance accordingly. We don't support moving
    # a credit between users via edit — changing client_id on a credited tx
    # keeps the original credit pinned to the original user; admins should
    # delete + recreate to reassign.
    if old_credited_user_id:
        try:
            from uuid import UUID as _UUID
            target = session.get(User, _UUID(old_credited_user_id))
        except (ValueError, AttributeError):
            target = None
        if target:
            # If the type flipped off income, reverse the old credit entirely.
            # Otherwise apply the delta (new_amount − old_amount).
            if tx.type != "income":
                delta = -old_amount
                tx.credited_user_id = None  # credit no longer applies
            else:
                delta = float(tx.amount or 0) - old_amount
            if delta != 0:
                target.balance = float(target.balance or 0) + delta
                session.add(target)

    # Resolve category name for response
    cat_name = None
    if tx.category_id:
        cat = session.get(ExpenseCategory, tx.category_id)
        if cat:
            cat_name = cat.name

    session.add(tx)
    session.commit()
    session.refresh(tx)

    result = CashboxTransactionRead.model_validate(tx)
    result.category_name = cat_name
    return result


@router.post("/balance-correction")
def create_balance_correction(
    payload: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    """Create a balance correction (start balance or adjustment). Owner/senior_admin only."""
    from app.api import deps
    if not deps.has_permission(current_user, "finance.balance_correction"):
        raise HTTPException(403, "Нет права на корректировку остатков")

    payment_method = payload.get("payment_method", "cash")
    new_balance = payload.get("new_balance")
    reason = payload.get("reason", "Корректировка остатков")
    branch = payload.get("branch")  # optional branch filter

    if new_balance is None:
        raise HTTPException(400, "new_balance обязателен")

    # Calculate current balance for this payment method (optionally filtered by branch)
    inc_q = select(func.coalesce(func.sum(CashboxTransaction.amount), 0)).where(
        CashboxTransaction.type == "income",
        CashboxTransaction.payment_method == payment_method,
    )
    exp_q = select(func.coalesce(func.sum(CashboxTransaction.amount), 0)).where(
        CashboxTransaction.type == "expense",
        CashboxTransaction.payment_method == payment_method,
    )
    if branch:
        inc_q = inc_q.where(CashboxTransaction.branch == branch)
        exp_q = exp_q.where(CashboxTransaction.branch == branch)

    income = session.exec(inc_q).one()
    expense = session.exec(exp_q).one()
    current_balance = float(income) - float(expense)
    diff = float(new_balance) - current_balance

    if abs(diff) < 0.01:
        return {"ok": True, "message": "Баланс уже соответствует", "diff": 0}

    # Create correction transaction (with branch if specified)
    tx = CashboxTransaction(
        type="income" if diff > 0 else "expense",
        amount=abs(diff),
        currency="GEL",
        payment_method=payment_method,
        branch=branch or None,
        description=f"[КОРРЕКЦИЯ{' · ' + branch if branch else ''}] {reason} (было: {current_balance:.2f}, стало: {new_balance:.2f})",
        date=_normalise_tx_date(None),
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
    )
    session.add(tx)
    session.commit()

    return {
        "ok": True,
        "previous_balance": round(current_balance, 2),
        "new_balance": round(float(new_balance), 2),
        "diff": round(diff, 2),
        "transaction_id": tx.id,
    }
