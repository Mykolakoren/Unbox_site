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

    ts = None
    if data.session_id:
        ts = session.get(TherapySession, data.session_id)
        if ts and ts.specialist_id != str(current_user.id):
            ts = None

    # На сессию разрешён РОВНО ОДИН платёж — это защита в самой базе
    # (uq_therapist_payment_session), поставленная после чистки 74 дублей.
    # Поэтому доплата не создаёт вторую строку, а прибавляется к существующей.
    existing = None
    if ts is not None:
        existing = session.exec(
            select(TherapistPayment).where(
                TherapistPayment.session_id == ts.id,
                TherapistPayment.specialist_id == str(current_user.id),
            )
        ).first()

    if existing is not None:
        existing.amount = round(float(existing.amount or 0) + float(data.amount or 0), 2)
        if data.account:
            existing.account = data.account
        payment = existing
    else:
        payment = TherapistPayment(
            **data.model_dump(),
            specialist_id=str(current_user.id),
        )
    session.add(payment)

    if ts is not None:
        # Сессию закрываем ТОЛЬКО когда собрана вся её стоимость. Раньше любая
        # сумма ставила галочку «оплачено»: клиент вносит 50 из 100 — сессия
        # считается закрытой, а оставшиеся 50 молча исчезают из долга.
        price = ts.price if ts.price is not None else (client.base_price or 0)
        collected = float(payment.amount or 0)
        # price <= 0 — бесплатная сессия, закрываем сразу.
        fully_paid = price <= 0 or collected + 0.01 >= price
        if ts.is_paid != fully_paid:
            ts.is_paid = fully_paid
            ts.updated_at = datetime.now()
            session.add(ts)

    session.commit()
    session.refresh(payment)
    return payment


@router.delete("/payments/{payment_id}")
def delete_payment(
    payment_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Удалить платёж.

    Раньше такой возможности не было вообще: ошибся в сумме — запись
    оставалась навсегда и завышала доход. Если платёж был привязан к сессии,
    снимаем с неё «оплачено» — но только когда других платежей по ней не
    осталось (частичные оплаты не должны открывать сессию заново).
    """
    payment = session.get(TherapistPayment, payment_id)
    if not payment or payment.specialist_id != str(current_user.id):
        raise HTTPException(404, "Payment not found")

    session_id = payment.session_id
    session.delete(payment)
    session.flush()

    if session_id:
        ts = session.get(TherapySession, session_id)
        if ts and ts.specialist_id == str(current_user.id):
            remaining = session.exec(
                select(TherapistPayment).where(
                    TherapistPayment.session_id == session_id,
                    TherapistPayment.specialist_id == str(current_user.id),
                )
            ).first()
            if remaining is None and ts.is_paid:
                ts.is_paid = False
                ts.updated_at = datetime.now()
                session.add(ts)

    session.commit()
    return {"ok": True}
