"""Cashbox — transactions: balance, list, create, delete."""
from typing import List, Optional
from datetime import datetime, date
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

    tx = CashboxTransaction(
        type=payload.type,
        amount=payload.amount,
        currency=payload.currency,
        payment_method=payload.payment_method,
        category_id=payload.category_id,
        description=payload.description,
        branch=payload.branch,
        date=payload.date or datetime.now(),  # local server time (Tbilisi UTC+4)
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
        client_id=payload.client_id,
        client_name=client_name,
    )
    session.add(tx)
    session.commit()
    session.refresh(tx)

    result = CashboxTransactionRead.model_validate(tx)
    result.category_name = cat_name
    return result


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

    session.delete(tx)
    session.commit()
    return {"ok": True}


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

    if new_balance is None:
        raise HTTPException(400, "new_balance обязателен")

    # Calculate current balance for this payment method
    income = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0)).where(
            CashboxTransaction.type == "income",
            CashboxTransaction.payment_method == payment_method,
        )
    ).one()
    expense = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0)).where(
            CashboxTransaction.type == "expense",
            CashboxTransaction.payment_method == payment_method,
        )
    ).one()
    current_balance = float(income) - float(expense)
    diff = float(new_balance) - current_balance

    if abs(diff) < 0.01:
        return {"ok": True, "message": "Баланс уже соответствует", "diff": 0}

    # Create correction transaction
    tx = CashboxTransaction(
        type="income" if diff > 0 else "expense",
        amount=abs(diff),
        currency="GEL",
        payment_method=payment_method,
        description=f"[КОРРЕКЦИЯ] {reason} (было: {current_balance:.2f}, стало: {new_balance:.2f})",
        date=datetime.now(),
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
