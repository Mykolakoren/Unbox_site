"""CRM Clients — CRUD for specialist's therapy clients."""
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
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
):
    uid = str(current_user.id)
    stmt = select(TherapistClient).where(TherapistClient.specialist_id == uid)
    if active_only:
        stmt = stmt.where(TherapistClient.is_active == True)
    stmt = stmt.order_by(TherapistClient.name)
    return session.exec(stmt).all()


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
