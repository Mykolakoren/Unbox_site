"""CRM Dashboard — stats + settings for specialist."""
from typing import Optional, List
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Body, Query
from sqlmodel import Session, select, func
from app.api import deps
from app.models.user import User
from app.models.specialist import Specialist
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.models.therapist_payment import TherapistPayment

router = APIRouter()


@router.get("/dashboard")
def crm_dashboard(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    month: Optional[str] = Query(None, description="Month in YYYY-MM format"),
):
    """Summary stats for the specialist's CRM dashboard."""
    uid = str(current_user.id)
    now = datetime.now()

    # Parse month parameter or use current month
    if month:
        try:
            month_start = datetime.strptime(month, "%Y-%m").replace(hour=0, minute=0, second=0, microsecond=0)
        except ValueError:
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)

    active_clients = session.exec(
        select(func.count()).where(
            TherapistClient.specialist_id == uid,
            TherapistClient.is_active == True,
        )
    ).one()

    sessions_this_month = session.exec(
        select(func.count()).where(
            TherapySession.specialist_id == uid,
            TherapySession.date >= month_start,
            TherapySession.date < month_end,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).one()

    # Unpaid count — only for active clients, only COMPLETED sessions
    unpaid_all = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.is_paid == False,
            TherapySession.status == "COMPLETED",
        )
    ).all()
    unpaid_count = 0
    for us in unpaid_all:
        client = session.get(TherapistClient, us.client_id)
        if client and client.is_active:
            unpaid_count += 1

    month_payments = session.exec(
        select(TherapistPayment).where(
            TherapistPayment.specialist_id == uid,
            TherapistPayment.date >= month_start,
            TherapistPayment.date < month_end,
        )
    ).all()
    payments_this_month = sum(float(p.amount or 0) for p in month_payments)

    # Revenue grouped by currency
    rev_by_currency: dict = {}
    for p in month_payments:
        cur = p.currency or "GEL"
        rev_by_currency[cur] = rev_by_currency.get(cur, 0) + float(p.amount or 0)
    rev_by_currency = {k: round(v, 2) for k, v in rev_by_currency.items() if v > 0}

    upcoming = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.date >= now,
            TherapySession.date <= now + timedelta(days=7),
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        ).order_by(TherapySession.date)
    ).all()

    upcoming_list = []
    for s in upcoming:
        client = session.get(TherapistClient, s.client_id)
        upcoming_list.append({
            "id": s.id,
            "date": s.date.isoformat(),
            "client_name": client.name if client else "Unknown",
            "client_id": s.client_id,
            "status": s.status,
            "is_booked": s.is_booked,
        })

    # --- Extended stats ---

    # Monthly stats (12 months) — convert to GEL equivalent
    GEL_RATES = {"GEL": 1, "USD": 2.7, "EUR": 2.95, "RUB": 0.03}

    monthly_stats = []
    for i in range(11, -1, -1):
        m_start = (now.replace(day=1) - timedelta(days=30 * i)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if m_start.month == 12:
            m_end = m_start.replace(year=m_start.year + 1, month=1)
        else:
            m_end = m_start.replace(month=m_start.month + 1)

        m_payments = session.exec(
            select(TherapistPayment).where(
                TherapistPayment.specialist_id == uid,
                TherapistPayment.date >= m_start,
                TherapistPayment.date < m_end,
            )
        ).all()

        # Received: convert each payment to GEL
        received_gel = 0.0
        received_by_cur: dict[str, float] = {}
        for p in m_payments:
            amt = float(p.amount or 0)
            cur = (p.currency or "GEL").upper()
            received_by_cur[cur] = received_by_cur.get(cur, 0) + amt
            received_gel += amt * GEL_RATES.get(cur, 1)

        m_sessions = session.exec(
            select(TherapySession).where(
                TherapySession.specialist_id == uid,
                TherapySession.date >= m_start,
                TherapySession.date < m_end,
                TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
            )
        ).all()

        # Expected: convert each session price to GEL
        expected_gel = 0.0
        expected_by_cur: dict[str, float] = {}
        for ms in m_sessions:
            client = session.get(TherapistClient, ms.client_id)
            price = ms.price if ms.price is not None else (client.base_price if client else 0)
            cur = (client.currency if client else "GEL") or "GEL"
            cur = cur.upper()
            expected_by_cur[cur] = expected_by_cur.get(cur, 0) + price
            expected_gel += price * GEL_RATES.get(cur, 1)

        monthly_stats.append({
            "month": m_start.strftime("%Y-%m"),
            "received": round(received_gel, 2),
            "expected": round(expected_gel, 2),
            "session_count": len(m_sessions),
            "received_by_currency": received_by_cur,
            "expected_by_currency": expected_by_cur,
        })

    # Clients without future sessions
    active_client_list = session.exec(
        select(TherapistClient).where(
            TherapistClient.specialist_id == uid,
            TherapistClient.is_active == True,
        )
    ).all()

    clients_no_future = []
    for c in active_client_list:
        future = session.exec(
            select(func.count()).where(
                TherapySession.specialist_id == uid,
                TherapySession.client_id == c.id,
                TherapySession.date >= now,
                TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
            )
        ).one()
        if future == 0:
            last_session = session.exec(
                select(TherapySession.date).where(
                    TherapySession.specialist_id == uid,
                    TherapySession.client_id == c.id,
                ).order_by(TherapySession.date.desc())
            ).first()
            clients_no_future.append({
                "id": c.id,
                "name": c.name,
                "last_session_date": last_session.isoformat() if last_session else None,
            })

    # Debt by client — only COMPLETED unpaid sessions (future PLANNED are not debt)
    unpaid_sessions_all = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.is_paid == False,
            TherapySession.status == "COMPLETED",
        )
    ).all()

    debt_map: dict = {}
    for us in unpaid_sessions_all:
        cid = us.client_id
        client = session.get(TherapistClient, cid)
        # Skip inactive clients — their debt doesn't count in dashboard totals
        if client and not client.is_active:
            continue
        price = us.price if us.price is not None else (client.base_price if client else 0)
        currency = client.currency if client else "GEL"
        if cid not in debt_map:
            debt_map[cid] = {"client_id": cid, "client_name": client.name if client else "?", "total_debt": 0, "unpaid_sessions_count": 0, "currency": currency}
        debt_map[cid]["total_debt"] += price
        debt_map[cid]["unpaid_sessions_count"] += 1

    debt_by_client = sorted(debt_map.values(), key=lambda x: x["total_debt"], reverse=True)
    for d in debt_by_client:
        d["total_debt"] = round(d["total_debt"], 2)

    # Avg check & hourly rate
    all_payments = session.exec(
        select(TherapistPayment).where(
            TherapistPayment.specialist_id == uid,
        )
    ).all()
    total_payments_all = sum(float(p.amount or 0) for p in all_payments)

    completed_sessions = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.status == "COMPLETED",
            TherapySession.is_paid == True,
        )
    ).all()

    total_hours = sum(s.duration_minutes or 60 for s in completed_sessions) / 60
    avg_hourly_rate = round(total_payments_all / max(total_hours, 1), 2)

    # Min/Max rates from client base prices (active clients only), converted to GEL
    active_clients_all = session.exec(
        select(TherapistClient).where(
            TherapistClient.specialist_id == uid,
            TherapistClient.is_active == True,
        )
    ).all()
    client_rates_gel = []
    for c in active_clients_all:
        if c.base_price and c.base_price > 0:
            cur = (c.currency or "GEL").upper()
            rate_gel = c.base_price * GEL_RATES.get(cur, 1)
            client_rates_gel.append(round(rate_gel, 0))
    min_rate = min(client_rates_gel) if client_rates_gel else 0
    max_rate = max(client_rates_gel) if client_rates_gel else 0

    # Group debt by currency
    debt_by_currency: dict = {}
    for d in debt_by_client:
        cur = d.get("currency", "GEL")
        debt_by_currency[cur] = debt_by_currency.get(cur, 0) + d["total_debt"]
    debt_by_currency = {k: round(v, 2) for k, v in debt_by_currency.items() if v > 0}

    total_active_debt = sum(d["total_debt"] for d in debt_by_client)

    return {
        "active_clients": active_clients,
        "sessions_this_month": sessions_this_month,
        "unpaid_sessions": unpaid_count,
        "revenue_this_month": round(payments_this_month, 2),
        "revenue_by_currency": rev_by_currency,
        "upcoming_sessions": upcoming_list,
        # Extended
        "monthly_stats": monthly_stats,
        "clients_without_future_sessions": clients_no_future,
        "debt_by_client": debt_by_client,
        "avg_hourly_rate": avg_hourly_rate,
        "min_rate": min_rate,
        "max_rate": max_rate,
        "total_active_debt": round(total_active_debt, 2),
        "debt_by_currency": debt_by_currency,
    }


@router.get("/settings")
def get_crm_settings(
    current_user: User = Depends(deps.require_specialist),
):
    """Get specialist's CRM settings (calendar_id, etc.)."""
    crm_data = current_user.crm_data or {}
    return {
        "calendar_id": crm_data.get("calendar_id"),
        "calendar_sync_enabled": bool(crm_data.get("calendar_id")),
    }


@router.patch("/settings")
def update_crm_settings(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    calendar_id: Optional[str] = Body(None, embed=True),
):
    """Update specialist's CRM settings."""
    crm_data = dict(current_user.crm_data or {})
    if calendar_id is not None:
        if calendar_id == "":
            crm_data.pop("calendar_id", None)
        else:
            crm_data["calendar_id"] = calendar_id
    current_user.crm_data = crm_data
    current_user.updated_at = datetime.now()
    session.add(current_user)
    session.commit()
    return {"ok": True, "calendar_id": crm_data.get("calendar_id")}


# ── Payment Accounts ─────────────────────────────────────────────

DEFAULT_ACCOUNTS = [
    {"id": "cash", "label": "Наличные"},
    {"id": "tbc", "label": "TBC"},
    {"id": "bog", "label": "BOG"},
]


@router.get("/payment-accounts")
def get_payment_accounts(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Get specialist's payment accounts list."""
    spec = session.exec(
        select(Specialist).where(Specialist.user_id == current_user.id)
    ).first()
    if spec and spec.payment_accounts:
        return spec.payment_accounts
    return DEFAULT_ACCOUNTS


@router.put("/payment-accounts")
def update_payment_accounts(
    accounts: List[dict] = Body(...),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Replace specialist's payment accounts list."""
    spec = session.exec(
        select(Specialist).where(Specialist.user_id == current_user.id)
    ).first()
    if not spec:
        from uuid import uuid4
        spec = Specialist(
            id=uuid4(),
            user_id=current_user.id,
            first_name=current_user.name.split()[0] if current_user.name else "",
            last_name=" ".join(current_user.name.split()[1:]) if current_user.name else "",
            payment_accounts=accounts,
        )
        session.add(spec)
    else:
        spec.payment_accounts = accounts
        session.add(spec)
    session.commit()
    session.refresh(spec)
    return spec.payment_accounts
