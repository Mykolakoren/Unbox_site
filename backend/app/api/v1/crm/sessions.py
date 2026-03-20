"""CRM Sessions — therapy session CRUD + quick-pay."""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.api import deps
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import (
    TherapySession, TherapySessionCreate, TherapySessionRead, TherapySessionUpdate,
)
from app.models.therapist_payment import TherapistPayment
from app.api.v1.crm import get_crm_calendar_id

router = APIRouter()


@router.get("/sessions", response_model=List[TherapySessionRead])
def list_sessions(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    client_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    uid = str(current_user.id)
    stmt = select(TherapySession).where(TherapySession.specialist_id == uid)
    if client_id:
        stmt = stmt.where(TherapySession.client_id == client_id)
    if date_from:
        stmt = stmt.where(TherapySession.date >= datetime.fromisoformat(date_from))
    if date_to:
        stmt = stmt.where(TherapySession.date <= datetime.fromisoformat(date_to + "T23:59:59"))
    if status:
        stmt = stmt.where(TherapySession.status == status)
    stmt = stmt.order_by(TherapySession.date.desc())
    return session.exec(stmt).all()


@router.post("/sessions/auto-complete")
def auto_complete_sessions(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Auto-mark PLANNED sessions in the past as COMPLETED."""
    uid = str(current_user.id)
    now = datetime.utcnow()
    stmt = select(TherapySession).where(
        TherapySession.specialist_id == uid,
        TherapySession.status == "PLANNED",
        TherapySession.date < now,
    )
    planned_past = session.exec(stmt).all()
    count = 0
    for ts in planned_past:
        ts.status = "COMPLETED"
        ts.updated_at = now
        session.add(ts)
        count += 1
    if count > 0:
        session.commit()
    return {"ok": True, "auto_completed": count}


@router.post("/sessions", response_model=TherapySessionRead)
def create_session(
    data: TherapySessionCreate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, data.client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    create_data = data.model_dump(exclude={"push_to_calendar"})
    therapy_session = TherapySession(
        **create_data,
        specialist_id=str(current_user.id),
    )

    if data.push_to_calendar:
        calendar_id = get_crm_calendar_id(current_user)
        if calendar_id:
            try:
                from app.services.crm_calendar import create_calendar_event
                gcal_id = create_calendar_event(
                    calendar_id=calendar_id,
                    client_name=client.name,
                    alias_code=client.alias_code,
                    session_date=data.date,
                    duration_minutes=data.duration_minutes,
                    notes=data.notes,
                )
                therapy_session.google_event_id = gcal_id
            except Exception as e:
                print(f"GCal push failed: {e}")

    session.add(therapy_session)
    session.commit()
    session.refresh(therapy_session)
    return therapy_session


@router.patch("/sessions/{session_id}", response_model=TherapySessionRead)
def update_session(
    session_id: str,
    data: TherapySessionUpdate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(ts, key, value)
    ts.updated_at = datetime.utcnow()

    session.add(ts)
    session.commit()
    session.refresh(ts)
    return ts


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")
    session.delete(ts)
    session.commit()
    return {"ok": True}


@router.post("/sessions/{session_id}/quick-pay")
def quick_pay_session(
    session_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Mark session as paid and create a payment record using client defaults."""
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")
    if ts.is_paid:
        raise HTTPException(400, "Session already paid")

    client = session.get(TherapistClient, ts.client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    price = ts.price if ts.price is not None else client.base_price

    payment = TherapistPayment(
        client_id=client.id,
        specialist_id=str(current_user.id),
        amount=price,
        currency=client.currency,
        account=client.default_account,
        date=ts.date,
        session_id=ts.id,
    )
    session.add(payment)

    ts.is_paid = True
    ts.updated_at = datetime.utcnow()
    session.add(ts)

    session.commit()
    return {"ok": True, "amount": price, "currency": client.currency}


@router.post("/sessions/{session_id}/unmark-paid")
def unmark_paid_session(
    session_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Unmark a session as paid and optionally remove the related payment."""
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")
    if not ts.is_paid:
        raise HTTPException(400, "Session is not paid")

    ts.is_paid = False
    ts.updated_at = datetime.utcnow()
    session.add(ts)

    # Remove related payment if exists
    payment = session.exec(
        select(TherapistPayment).where(
            TherapistPayment.session_id == session_id,
            TherapistPayment.specialist_id == str(current_user.id),
        )
    ).first()
    if payment:
        session.delete(payment)

    session.commit()
    return {"ok": True}


@router.post("/clients/{client_id}/mark-all-paid")
def mark_all_sessions_paid(
    client_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Mark all unpaid non-cancelled sessions as paid, creating payment records."""
    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    uid = str(current_user.id)
    unpaid = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.client_id == client_id,
            TherapySession.is_paid == False,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).all()

    count = 0
    for ts in unpaid:
        price = ts.price if ts.price is not None else client.base_price
        payment = TherapistPayment(
            client_id=client.id,
            specialist_id=uid,
            amount=price,
            currency=client.currency,
            account=client.default_account,
            date=ts.date,
            session_id=ts.id,
        )
        session.add(payment)
        ts.is_paid = True
        ts.updated_at = datetime.utcnow()
        session.add(ts)
        count += 1

    if count > 0:
        session.commit()
    return {"ok": True, "marked": count}
