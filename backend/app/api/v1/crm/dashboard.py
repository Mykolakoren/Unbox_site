"""CRM Dashboard — stats + settings for specialist."""
from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Body
from sqlmodel import Session, select, func
from app.api import deps
from app.models.user import User
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

    payments_this_month = session.exec(
        select(func.coalesce(func.sum(TherapistPayment.amount), 0)).where(
            TherapistPayment.specialist_id == uid,
            TherapistPayment.date >= month_start,
        )
    ).one()

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

    return {
        "active_clients": active_clients,
        "sessions_this_month": sessions_this_month,
        "unpaid_sessions": unpaid_count,
        "revenue_this_month": round(payments_this_month, 2),
        "upcoming_sessions": upcoming_list,
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
