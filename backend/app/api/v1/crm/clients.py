"""CRM Clients — CRUD for specialist's therapy clients."""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
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


class MergeClientsRequest(BaseModel):
    target_id: str
    source_ids: List[str]
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    telegram: Optional[str] = None


@router.post("/clients/merge")
def merge_clients(
    data: MergeClientsRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Merge source clients into target client. Reassign all sessions, payments, notes."""
    uid = str(current_user.id)

    # Validate target
    target = session.get(TherapistClient, data.target_id)
    if not target or target.specialist_id != uid:
        raise HTTPException(404, "Target client not found")

    if not data.source_ids:
        raise HTTPException(400, "No source clients to merge")

    if data.target_id in data.source_ids:
        raise HTTPException(400, "Target cannot be in source list")

    # Validate all source clients
    sources = []
    for sid in data.source_ids:
        src = session.get(TherapistClient, sid)
        if not src or src.specialist_id != uid:
            raise HTTPException(404, f"Source client {sid} not found")
        sources.append(src)

    # Update target fields if provided
    if data.name:
        target.name = data.name
    if data.phone is not None:
        target.phone = data.phone or None
    if data.email is not None:
        target.email = data.email or None
    if data.telegram is not None:
        target.telegram = data.telegram or None

    # Merge tags from all sources
    all_tags = set(target.tags or [])
    for src in sources:
        all_tags.update(src.tags or [])
    target.tags = list(all_tags) if all_tags else []

    # Preserve alias codes from merged clients for sync
    merged_codes = set(target.merged_alias_codes or [])
    if target.alias_code:
        merged_codes.add(target.alias_code)
    for src in sources:
        if src.alias_code:
            merged_codes.add(src.alias_code)
    target.merged_alias_codes = list(merged_codes)

    target.updated_at = datetime.utcnow()
    session.add(target)

    # Reassign all related records from source clients to target
    reassigned = {"sessions": 0, "payments": 0, "notes": 0}
    for sid in data.source_ids:
        for s in session.exec(select(TherapySession).where(TherapySession.client_id == sid, TherapySession.specialist_id == uid)).all():
            s.client_id = data.target_id
            session.add(s)
            reassigned["sessions"] += 1

        for p in session.exec(select(TherapistPayment).where(TherapistPayment.client_id == sid, TherapistPayment.specialist_id == uid)).all():
            if p.amount and float(p.amount) > 0:
                p.client_id = data.target_id
                session.add(p)
                reassigned["payments"] += 1
            else:
                # Delete garbage 0-amount payments instead of merging them
                session.delete(p)

        for n in session.exec(select(TherapistNote).where(TherapistNote.client_id == sid, TherapistNote.specialist_id == uid)).all():
            n.client_id = data.target_id
            session.add(n)
            reassigned["notes"] += 1

    # Delete source clients
    for src in sources:
        session.delete(src)

    session.commit()
    session.refresh(target)

    return {
        "ok": True,
        "target_id": data.target_id,
        "merged_count": len(data.source_ids),
        "reassigned": reassigned,
    }


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

        # Last session date
        if sessions_all:
            last_date = max(s.date for s in sessions_all)
            c_dict["lastSessionDate"] = last_date.isoformat() if last_date else None
        else:
            c_dict["lastSessionDate"] = None

        # Unpaid sum — only COMPLETED sessions count as debt
        unpaid = [s for s in sessions_all if not s.is_paid and s.status == "COMPLETED"]
        c_dict["unpaidSum"] = sum((s.price if s.price is not None else base) for s in unpaid)

        # LTV = sum of completed+paid sessions (more reliable than payments table after merges)
        paid_sessions = [s for s in sessions_all if s.is_paid and s.status == "COMPLETED"]
        c_dict["totalPaid"] = sum((s.price if s.price is not None else base) for s in paid_sessions)

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

    # Unpaid COMPLETED sessions only (future PLANNED sessions are not debt)
    unpaid_sessions = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.client_id == client_id,
            TherapySession.is_paid == False,
            TherapySession.status == "COMPLETED",
        )
    ).all()

    debt = sum((s.price if s.price is not None else base) for s in unpaid_sessions)

    # LTV = sum of completed+paid sessions (price or base_price fallback)
    # This is more reliable than summing payments, especially after merges
    paid_sessions = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.client_id == str(client_id),
            TherapySession.status == "COMPLETED",
            TherapySession.is_paid == True,
        )
    ).all()
    total_paid = sum((s.price if s.price is not None else base) for s in paid_sessions)

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
