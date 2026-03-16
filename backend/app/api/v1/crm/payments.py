"""CRM Payments — payment CRUD for specialist's clients."""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.api import deps
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.models.therapist_payment import (
    TherapistPayment, TherapistPaymentCreate, TherapistPaymentRead,
)

router = APIRouter()


@router.get("/payments", response_model=List[TherapistPaymentRead])
def list_payments(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    client_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    uid = str(current_user.id)
    stmt = select(TherapistPayment).where(TherapistPayment.specialist_id == uid)
    if client_id:
        stmt = stmt.where(TherapistPayment.client_id == client_id)
    if date_from:
        stmt = stmt.where(TherapistPayment.date >= datetime.fromisoformat(date_from))
    if date_to:
        stmt = stmt.where(TherapistPayment.date <= datetime.fromisoformat(date_to + "T23:59:59"))
    stmt = stmt.order_by(TherapistPayment.date.desc())
    return session.exec(stmt).all()


@router.post("/payments", response_model=TherapistPaymentRead)
def create_payment(
    data: TherapistPaymentCreate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, data.client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    payment = TherapistPayment(
        **data.model_dump(),
        specialist_id=str(current_user.id),
    )

    if data.session_id:
        ts = session.get(TherapySession, data.session_id)
        if ts and ts.specialist_id == str(current_user.id):
            ts.is_paid = True
            ts.updated_at = datetime.utcnow()
            session.add(ts)

    session.add(payment)
    session.commit()
    session.refresh(payment)
    return payment
