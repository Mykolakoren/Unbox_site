"""
Cashbox API — управление кассой: транзакции, категории, смены.
"""
from typing import List, Optional
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func, col, desc
from app.api import deps
from app.db.session import get_session
from app.models.user import User
from app.models.expense_category import (
    ExpenseCategory, ExpenseCategoryCreate, ExpenseCategoryRead,
)
from app.models.cashbox_transaction import (
    CashboxTransaction, CashboxTransactionCreate, CashboxTransactionRead,
)
from app.models.shift_report import (
    ShiftReport, ShiftReportCreate, ShiftReportRead,
)

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _require_cashbox(current_user: User = Depends(deps.require_admin)) -> User:
    """Require finance.manage_cashbox permission."""
    if not deps.has_permission(current_user, "finance.manage_cashbox"):
        raise HTTPException(403, "Нет права finance.manage_cashbox")
    return current_user


def _require_reports(current_user: User = Depends(deps.require_admin)) -> User:
    """Require finance.view_reports permission."""
    if not deps.has_permission(current_user, "finance.view_reports"):
        raise HTTPException(403, "Нет права finance.view_reports")
    return current_user


def _require_category_manage(current_user: User = Depends(_require_cashbox)) -> User:
    """Categories can only be created/edited by senior_admin or owner."""
    if current_user.role not in ("senior_admin", "owner"):
        raise HTTPException(403, "Управление категориями доступно только старшему админу или владельцу")
    return current_user


def _build_category_tree(categories: List[ExpenseCategory]) -> List[dict]:
    """Build nested category tree from flat list."""
    by_id = {}
    roots = []
    for cat in categories:
        node = {
            "id": cat.id,
            "name": cat.name,
            "parent_id": cat.parent_id,
            "icon": cat.icon,
            "is_active": cat.is_active,
            "created_at": cat.created_at,
            "children": [],
        }
        by_id[cat.id] = node

    for cat in categories:
        node = by_id[cat.id]
        if cat.parent_id and cat.parent_id in by_id:
            by_id[cat.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


# ── Balance ───────────────────────────────────────────────────────────────────

@router.get("/balance")
def get_balance(
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_cashbox),
):
    """Текущий баланс кассы (только наличные)."""
    cash_in = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "income")
        .where(CashboxTransaction.payment_method == "cash")
    ).one()
    cash_out = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "expense")
        .where(CashboxTransaction.payment_method == "cash")
    ).one()
    return {"balance": round(float(cash_in) - float(cash_out), 2)}


# ── Transactions ──────────────────────────────────────────────────────────────

@router.get("/transactions", response_model=List[CashboxTransactionRead])
def list_transactions(
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_cashbox),
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
    current_user: User = Depends(_require_cashbox),
):
    if payload.type not in ("income", "expense"):
        raise HTTPException(400, "type должен быть 'income' или 'expense'")
    if payload.amount <= 0:
        raise HTTPException(400, "amount должен быть больше 0")

    # Validate category exists if provided
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
    current_user: User = Depends(_require_cashbox),
):
    tx = session.get(CashboxTransaction, transaction_id)
    if not tx:
        raise HTTPException(404, "Транзакция не найдена")

    # Only allow deletion of same-day transactions
    today = date.today()
    tx_date = tx.date.date() if isinstance(tx.date, datetime) else tx.date
    if tx_date != today:
        raise HTTPException(403, "Можно удалять только сегодняшние транзакции")

    session.delete(tx)
    session.commit()
    return {"ok": True}


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories")
def list_categories(
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_cashbox),
):
    cats = session.exec(
        select(ExpenseCategory).order_by(ExpenseCategory.name)
    ).all()
    return _build_category_tree(cats)


@router.post("/categories", response_model=ExpenseCategoryRead)
def create_category(
    payload: ExpenseCategoryCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_category_manage),
):
    if payload.parent_id:
        parent = session.get(ExpenseCategory, payload.parent_id)
        if not parent:
            raise HTTPException(404, "Родительская категория не найдена")
        # Only one nesting level
        if parent.parent_id:
            raise HTTPException(400, "Допускается только один уровень вложенности")

    cat = ExpenseCategory(
        name=payload.name,
        parent_id=payload.parent_id,
        icon=payload.icon,
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return ExpenseCategoryRead.model_validate(cat)


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_category_manage),
):
    cat = session.get(ExpenseCategory, category_id)
    if not cat:
        raise HTTPException(404, "Категория не найдена")

    children = session.exec(
        select(ExpenseCategory).where(ExpenseCategory.parent_id == category_id)
    ).all()
    if children:
        raise HTTPException(400, "Сначала удалите подкатегории")

    session.delete(cat)
    session.commit()
    return {"ok": True}


@router.patch("/categories/{category_id}", response_model=ExpenseCategoryRead)
def update_category(
    category_id: str,
    payload: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_category_manage),
):
    cat = session.get(ExpenseCategory, category_id)
    if not cat:
        raise HTTPException(404, "Категория не найдена")

    for field in ("name", "icon", "is_active"):
        if field in payload:
            setattr(cat, field, payload[field])

    session.add(cat)
    session.commit()
    session.refresh(cat)
    return ExpenseCategoryRead.model_validate(cat)


# ── Shift Reports ─────────────────────────────────────────────────────────────

@router.get("/shifts", response_model=List[ShiftReportRead])
def list_shifts(
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_reports),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    stmt = (
        select(ShiftReport)
        .order_by(desc(ShiftReport.shift_end))
        .offset(skip)
        .limit(limit)
    )
    return session.exec(stmt).all()


@router.post("/shifts", response_model=ShiftReportRead)
def end_shift(
    payload: ShiftReportCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_cashbox),
):
    now = datetime.utcnow()

    # Find last shift
    last_shift = session.exec(
        select(ShiftReport).order_by(desc(ShiftReport.shift_end)).limit(1)
    ).first()

    shift_start = last_shift.shift_end if last_shift else datetime.min
    starting_balance = last_shift.actual_balance if last_shift else 0.0

    # Calculate expected balance from cash transactions since last shift
    cash_in = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "income")
        .where(CashboxTransaction.payment_method == "cash")
        .where(CashboxTransaction.date >= shift_start)
    ).one()

    cash_out = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "expense")
        .where(CashboxTransaction.payment_method == "cash")
        .where(CashboxTransaction.date >= shift_start)
    ).one()

    expected = round(starting_balance + float(cash_in) - float(cash_out), 2)
    discrepancy = round(payload.actual_balance - expected, 2)

    report = ShiftReport(
        expected_balance=expected,
        actual_balance=payload.actual_balance,
        discrepancy=discrepancy,
        notes=payload.notes,
        shift_start=shift_start,
        shift_end=now,
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
    )
    session.add(report)
    session.commit()
    session.refresh(report)
    return report


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics")
def get_analytics(
    session: Session = Depends(get_session),
    current_user: User = Depends(_require_reports),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    now = datetime.utcnow()
    try:
        dt_from = datetime.fromisoformat(date_from) if date_from else now - timedelta(days=30)
    except ValueError:
        dt_from = now - timedelta(days=30)
    try:
        dt_to = datetime.fromisoformat(date_to) if date_to else now
    except ValueError:
        dt_to = now

    # All transactions in range
    txs = session.exec(
        select(CashboxTransaction)
        .where(CashboxTransaction.date >= dt_from)
        .where(CashboxTransaction.date <= dt_to)
        .order_by(CashboxTransaction.date)
    ).all()

    # Daily aggregation
    daily: dict[str, dict] = {}
    cat_totals: dict[str, float] = {}
    total_income = 0.0
    total_expense = 0.0

    for tx in txs:
        day_key = tx.date.strftime("%Y-%m-%d") if isinstance(tx.date, datetime) else str(tx.date)
        if day_key not in daily:
            daily[day_key] = {"date": day_key, "income": 0.0, "expense": 0.0}

        if tx.type == "income":
            daily[day_key]["income"] += tx.amount
            total_income += tx.amount
        else:
            daily[day_key]["expense"] += tx.amount
            total_expense += tx.amount
            # Category breakdown (expenses only)
            cat_key = tx.category_id or "__uncategorized__"
            cat_totals[cat_key] = cat_totals.get(cat_key, 0.0) + tx.amount

    # Resolve category names
    cat_ids = [k for k in cat_totals if k != "__uncategorized__"]
    cat_names_map = {}
    if cat_ids:
        cats = session.exec(
            select(ExpenseCategory).where(col(ExpenseCategory.id).in_(cat_ids))
        ).all()
        cat_names_map = {c.id: c.name for c in cats}

    category_breakdown = []
    for cat_id, total in sorted(cat_totals.items(), key=lambda x: -x[1]):
        name = cat_names_map.get(cat_id, "Без категории")
        pct = round(total / total_expense * 100, 1) if total_expense > 0 else 0
        category_breakdown.append({
            "category_name": name,
            "total": round(total, 2),
            "percentage": pct,
        })

    # Current cash balance
    cash_in = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "income")
        .where(CashboxTransaction.payment_method == "cash")
    ).one()
    cash_out = session.exec(
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "expense")
        .where(CashboxTransaction.payment_method == "cash")
    ).one()

    daily_data = [daily[k] for k in sorted(daily.keys())]
    # Round values
    for d in daily_data:
        d["income"] = round(d["income"], 2)
        d["expense"] = round(d["expense"], 2)

    return {
        "daily_data": daily_data,
        "category_breakdown": category_breakdown,
        "total_income": round(total_income, 2),
        "total_expense": round(total_expense, 2),
        "current_balance": round(float(cash_in) - float(cash_out), 2),
    }
