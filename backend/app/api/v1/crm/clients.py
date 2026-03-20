"""CRM Clients — CRUD for specialist's therapy clients."""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func
from app.api import deps
from app.models.user import User
from app.models.therapist_client import (
    TherapistClient, TherapistClientCreate, TherapistClientRead, TherapistClientUpdate,
)
from app.models.therapy_session import TherapySession
from app.models.therapist_payment import TherapistPayment
from app.models.therapist_note import TherapistNote

router = APIRouter()


@router.get("/clients", response_model=List[TherapistClientRead])
def list_clients(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    active_only: bool = Query(False),
    with_stats: bool = Query(False),
):
    uid = str(current_user.id)
    stmt = select(TherapistClient).where(TherapistClient.specialist_id == uid)
    if active_only:
        stmt = stmt.where(TherapistClient.is_active == True)
    stmt = stmt.order_by(TherapistClient.name)
    clients = session.exec(stmt).all()

    if not with_stats:
        return clients

    # Enrich with stats: sessionCount, totalPaid, unpaidSum
    result = []
    for c in clients:
        c_dict = TherapistClientRead.model_validate(c).model_dump()
        base = c.base_price or 0

        # Session count (non-cancelled)
        sessions_all = session.exec(
            select(TherapySession).where(
                TherapySession.specialist_id == uid,
                TherapySession.client_id == str(c.id),
                TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
            )
        ).all()
        c_dict["sessionCount"] = len(sessions_all)
        c_dict["totalCost"] = sum((s.price if s.price is not None else base) for s in sessions_all)

        # Unpaid sum
        unpaid = [s for s in sessions_all if not s.is_paid]
        c_dict["unpaidSum"] = sum((s.price if s.price is not None else base) for s in unpaid)

        # Total paid (from payments table)
        total_paid_row = session.exec(
            select(func.coalesce(func.sum(TherapistPayment.amount), 0)).where(
                TherapistPayment.specialist_id == uid,
                TherapistPayment.client_id == str(c.id),
            )
        ).one()
        c_dict["totalPaid"] = float(total_paid_row)

        result.append(c_dict)

    return result


@router.get("/clients/{client_id}", response_model=TherapistClientRead)
def get_client(
    client_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")
    return client


@router.get("/clients/{client_id}/balance")
def get_client_balance(
    client_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Calculate client's financial balance: debt, prepayment, totals."""
    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    uid = str(current_user.id)
    base = client.base_price or 0

    # Unpaid non-cancelled sessions
    unpaid_sessions = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.client_id == client_id,
            TherapySession.is_paid == False,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).all()

    debt = sum((s.price if s.price is not None else base) for s in unpaid_sessions)

    # Total paid
    total_paid_row = session.exec(
        select(func.coalesce(func.sum(TherapistPayment.amount), 0)).where(
            TherapistPayment.specialist_id == uid,
            TherapistPayment.client_id == client_id,
        )
    ).one()
    total_paid = float(total_paid_row)

    # Total expected (all non-cancelled sessions)
    all_sessions = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.client_id == client_id,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).all()
    total_expected = sum((s.price if s.price is not None else base) for s in all_sessions)

    return {
        "total_paid": round(total_paid, 2),
        "total_expected": round(total_expected, 2),
        "debt": round(debt, 2),
        "prepayment": round(max(0, total_paid - total_expected), 2),
        "unpaid_sessions_count": len(unpaid_sessions),
    }


@router.post("/clients", response_model=TherapistClientRead)
def create_client(
    data: TherapistClientCreate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = TherapistClient(
        **data.model_dump(),
        specialist_id=str(current_user.id),
    )
    session.add(client)
    session.commit()
    session.refresh(client)
    return client


@router.patch("/clients/{client_id}", response_model=TherapistClientRead)
def update_client(
    client_id: str,
    data: TherapistClientUpdate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(client, key, value)
    client.updated_at = datetime.utcnow()

    session.add(client)
    session.commit()
    session.refresh(client)
    return client


@router.delete("/clients/{client_id}")
def delete_client(
    client_id: str,
    permanent: bool = Query(False),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    if permanent:
        if current_user.role not in ("owner", "senior_admin"):
            raise HTTPException(403, "Only owner or senior admin can permanently delete clients")

        for model in (TherapySession, TherapistPayment, TherapistNote):
            rows = session.exec(select(model).where(model.client_id == client_id)).all()
            for r in rows:
                session.delete(r)

        session.delete(client)
        session.commit()
        return {"ok": True, "permanent": True}

    client.is_active = False
    client.updated_at = datetime.utcnow()
    session.add(client)
    session.commit()
    return {"ok": True}
