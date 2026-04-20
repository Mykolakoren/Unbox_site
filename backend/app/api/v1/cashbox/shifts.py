"""Cashbox — shift reports + analytics."""
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func, col, desc
from app.db.session import get_session
from app.models.user import User
from app.models.expense_category import ExpenseCategory
from app.models.cashbox_transaction import CashboxTransaction
from app.models.shift_report import ShiftReport, ShiftReportCreate, ShiftReportRead
from app.models.shift_open_log import ShiftOpenLog, ShiftOpenLogCreate, ShiftOpenLogRead
from app.api.v1.cashbox import require_cashbox, require_reports

router = APIRouter()


@router.post("/shifts/open", response_model=ShiftOpenLogRead)
def open_shift(
    payload: ShiftOpenLogCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    """Mark the start of a shift for this admin (Excel #61, Иры).

    Doesn't change cash math — the close in `end_shift` still windows from the
    previous close. This is purely an audit + UX marker so admins have a clear
    "I started" action and we can later show "open since 09:12 by Ира".
    """
    log = ShiftOpenLog(
        branch=payload.branch,
        starting_balance=payload.starting_balance,
        notes=payload.notes,
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


@router.get("/shifts/preview")
def preview_close_shift(
    branch: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_reports),
):
    """Preview the shift-close math WITHOUT writing a ShiftReport (Excel #13).

    Admins reported phantom discrepancies even when totals looked right.
    This endpoint returns the exact same breakdown `end_shift` would use
    (starting_balance, cash_in, cash_out, expected, plus the window
    [shift_start, now]) so the admin can see WHERE the disagreement is
    before submitting — and we can diff against the frontend balance
    (which counts globally). If preview.expected != cashboxStore.balance.cash
    for the same branch, there's a backdated tx somewhere.
    """
    now = datetime.now()

    last_query = select(ShiftReport).order_by(desc(ShiftReport.shift_end)).limit(1)
    if branch:
        last_query = last_query.where(ShiftReport.branch == branch)
    else:
        last_query = last_query.where(ShiftReport.branch.is_(None))  # type: ignore
    last_shift = session.exec(last_query).first()

    shift_start = last_shift.shift_end if last_shift else datetime.min
    starting_balance = float(last_shift.actual_balance) if last_shift else 0.0

    cash_in_q = (
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "income")
        .where(CashboxTransaction.payment_method == "cash")
        .where(CashboxTransaction.date >= shift_start)
    )
    cash_out_q = (
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "expense")
        .where(CashboxTransaction.payment_method == "cash")
        .where(CashboxTransaction.date >= shift_start)
    )
    if branch:
        cash_in_q = cash_in_q.where(CashboxTransaction.branch == branch)
        cash_out_q = cash_out_q.where(CashboxTransaction.branch == branch)

    cash_in = float(session.exec(cash_in_q).one())
    cash_out = float(session.exec(cash_out_q).one())
    expected = round(starting_balance + cash_in - cash_out, 2)

    # Count of transactions that make up this window — gives the admin a
    # "did I expect this many?" sanity check.
    tx_count_q = (
        select(func.count(CashboxTransaction.id))  # type: ignore
        .where(CashboxTransaction.payment_method == "cash")
        .where(CashboxTransaction.date >= shift_start)
    )
    if branch:
        tx_count_q = tx_count_q.where(CashboxTransaction.branch == branch)
    tx_count = int(session.exec(tx_count_q).one())

    return {
        "starting_balance": round(starting_balance, 2),
        "cash_in": round(cash_in, 2),
        "cash_out": round(cash_out, 2),
        "expected": expected,
        "tx_count": tx_count,
        "shift_start": shift_start.isoformat() if shift_start != datetime.min else None,
        "now": now.isoformat(),
        "branch": branch,
        "prev_close_id": str(last_shift.id) if last_shift else None,
    }


@router.get("/shifts/open/current", response_model=Optional[ShiftOpenLogRead])
def get_current_open_shift(
    branch: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_reports),
):
    """Most recent open event since the last close.

    If `branch` is provided we scope to that branch. Otherwise we return the
    very last open event globally (used to show the "current shift" banner on
    the finance dashboard).

    Returns null if the most recent close happened after the most recent open
    (shift is fully closed) or if there's never been an open event.
    """
    open_q = select(ShiftOpenLog).order_by(desc(ShiftOpenLog.opened_at)).limit(1)
    close_q = select(ShiftReport).order_by(desc(ShiftReport.shift_end)).limit(1)
    if branch:
        open_q = open_q.where(ShiftOpenLog.branch == branch)
        close_q = close_q.where(ShiftReport.branch == branch)

    last_open = session.exec(open_q).first()
    if not last_open:
        return None

    last_close = session.exec(close_q).first()
    if last_close and last_close.shift_end >= last_open.opened_at:
        return None  # close is newer → shift is closed

    return last_open


@router.get("/shifts", response_model=List[ShiftReportRead])
def list_shifts(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_reports),
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
    current_user: User = Depends(require_cashbox),
):
    """End the shift (reconcile cash).

    Fixes Excel #13: previously branch-scoped close summed ALL history for
    that branch (→ huge discrepancy every time), and global close picked
    branch-scoped reports as its baseline (→ wrong starting_balance). Now
    branch closes isolate to their own history via shift_reports.branch,
    and global closes skip branch-scoped rows entirely.
    """
    now = datetime.now()
    branch = payload.branch

    # Find the last SAME-SCOPE close as our starting point. Branch close →
    # previous close of that same branch. Global close → previous global close.
    last_query = select(ShiftReport).order_by(desc(ShiftReport.shift_end)).limit(1)
    if branch:
        last_query = last_query.where(ShiftReport.branch == branch)
    else:
        last_query = last_query.where(ShiftReport.branch.is_(None))  # type: ignore
    last_shift = session.exec(last_query).first()

    shift_start = last_shift.shift_end if last_shift else datetime.min
    starting_balance = float(last_shift.actual_balance) if last_shift else 0.0

    # Sum cash movements for this shift window. For branch closes, also
    # filter by branch so we only count transactions for that location.
    cash_in_q = (
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "income")
        .where(CashboxTransaction.payment_method == "cash")
        .where(CashboxTransaction.date >= shift_start)
    )
    cash_out_q = (
        select(func.coalesce(func.sum(CashboxTransaction.amount), 0))
        .where(CashboxTransaction.type == "expense")
        .where(CashboxTransaction.payment_method == "cash")
        .where(CashboxTransaction.date >= shift_start)
    )
    if branch:
        cash_in_q = cash_in_q.where(CashboxTransaction.branch == branch)
        cash_out_q = cash_out_q.where(CashboxTransaction.branch == branch)

    cash_in = float(session.exec(cash_in_q).one())
    cash_out = float(session.exec(cash_out_q).one())

    expected = round(starting_balance + cash_in - cash_out, 2)
    discrepancy = round(payload.actual_balance - expected, 2)

    # Keep legacy [Branch] prefix in notes for UI back-compat with older clients
    # that expect it; the canonical source now is the `branch` column.
    notes = payload.notes
    if branch and not (notes or "").startswith(f"[{branch}]"):
        prefix = f"[{branch}]"
        notes = f"{prefix} {notes}" if notes else prefix

    report = ShiftReport(
        expected_balance=expected,
        actual_balance=payload.actual_balance,
        discrepancy=discrepancy,
        notes=notes,
        branch=branch,
        shift_start=shift_start,
        shift_end=now,
        admin_id=str(current_user.id),
        admin_name=current_user.name or "",
    )
    session.add(report)
    session.commit()
    session.refresh(report)
    return report


@router.get("/analytics")
def get_analytics(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_reports),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    now = datetime.now()
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
