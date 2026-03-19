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
    limit: int = Query(50, ge=1, le=200),
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

    tx = CashboxTransaction(
        type=payload.type,
        amount=payload.amount,
        currency=payload.currency,
        payment_method=payload.payment_method,
        category_id=payload.category_id,
        description=payload.description,
        branch=payload.branch,
        date=payload.date or datetime.utcnow(),
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
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

    today = date.today()
    tx_date = tx.date.date() if isinstance(tx.date, datetime) else tx.date
    if tx_date != today:
        raise HTTPException(403, "Можно удалять только сегодняшние транзакции")

    session.delete(tx)
    session.commit()
    return {"ok": True}
