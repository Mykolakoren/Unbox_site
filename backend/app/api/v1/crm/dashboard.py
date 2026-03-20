"""CRM Dashboard — stats + settings for specialist."""
from typing import Optional, List
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Body
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
):
    """Summary stats for the specialist's CRM dashboard."""
    uid = str(current_user.id)
    now = datetime.utcnow()

    active_clients = session.exec(
        select(func.count()).where(
            TherapistClient.specialist_id == uid,
            TherapistClient.is_active == True,
        )
    ).one()

    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    sessions_this_month = session.exec(
        select(func.count()).where(
            TherapySession.specialist_id == uid,
            TherapySession.date >= month_start,
            TherapySession.date <= now,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).one()

    unpaid_count = session.exec(
        select(func.count()).where(
            TherapySession.specialist_id == uid,
            TherapySession.is_paid == False,
            TherapySession.date <= now,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).one()

    month_payments = session.exec(
        select(TherapistPayment).where(
            TherapistPayment.specialist_id == uid,
            TherapistPayment.date >= month_start,
        )
    ).all()
    payments_this_month = sum(float(p.amount or 0) for p in month_payments)

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

    # Monthly stats (12 months)
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
        received = sum(float(p.amount or 0) for p in m_payments)

        m_sessions = session.exec(
            select(TherapySession).where(
                TherapySession.specialist_id == uid,
                TherapySession.date >= m_start,
                TherapySession.date < m_end,
                TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
            )
        ).all()

        expected = 0.0
        for ms in m_sessions:
            client = session.get(TherapistClient, ms.client_id)
            expected += ms.price if ms.price is not None else (client.base_price if client else 0)

        monthly_stats.append({
            "month": m_start.strftime("%Y-%m"),
            "received": round(float(received), 2),
            "expected": round(expected, 2),
            "session_count": len(m_sessions),
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
        price = us.price if us.price is not None else (client.base_price if client else 0)
        if cid not in debt_map:
            debt_map[cid] = {"client_id": cid, "client_name": client.name if client else "?", "total_debt": 0, "unpaid_sessions_count": 0}
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

    avg_check = round(total_payments_all / max(len(completed_sessions), 1), 2)
    total_hours = sum(s.duration_minutes or 60 for s in completed_sessions) / 60
    avg_hourly_rate = round(total_payments_all / max(total_hours, 1), 2)

    total_active_debt = sum(d["total_debt"] for d in debt_by_client)

    return {
        "active_clients": active_clients,
        "sessions_this_month": sessions_this_month,
        "unpaid_sessions": unpaid_count,
        "revenue_this_month": round(payments_this_month, 2),
        "upcoming_sessions": upcoming_list,
        # Extended
        "monthly_stats": monthly_stats,
        "clients_without_future_sessions": clients_no_future,
        "debt_by_client": debt_by_client,
        "avg_check": avg_check,
        "avg_hourly_rate": avg_hourly_rate,
        "total_active_debt": round(total_active_debt, 2),
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
    current_user.updated_at = datetime.utcnow()
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
