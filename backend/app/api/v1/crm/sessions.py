"""CRM Sessions — therapy session CRUD + quick-pay."""
import logging
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlmodel import Session, select
from app.api import deps

logger = logging.getLogger(__name__)
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
    now = datetime.now()
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

    # Diagnostic — confirm whether push_to_calendar is actually arriving and
    # whether the specialist has a calendar configured. Without this, a silent
    # False (e.g. axios interceptor not converting key) is invisible.
    logger.info(
        f"[create_session] specialist={current_user.id} client={client.name} "
        f"push_to_calendar={data.push_to_calendar} crm_data_keys="
        f"{list((current_user.crm_data or {}).keys())}"
    )

    if data.push_to_calendar:
        calendar_id = get_crm_calendar_id(current_user)
        logger.info(f"[create_session] calendar_id={calendar_id!r} alias_code={client.alias_code!r}")
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
                logger.info(f"[create_session] GCal event created: {gcal_id}")
            except Exception as e:
                logger.warning(f"GCal push failed: {e}", exc_info=True)
        else:
            logger.warning(f"[create_session] push_to_calendar=True but calendar_id missing for user {current_user.id}")

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
    ts.updated_at = datetime.now()

    session.add(ts)
    session.commit()
    session.refresh(ts)
    return ts


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    scope: str = Query("this", regex="^(this|future)$"),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Delete a single CRM session, optionally extending to "this and all
    future occurrences in the same recurring series" — same UX Google
    Calendar offers when you delete one event from a recurring rule.

    Always cleans up the GCal event(s) associated with the deleted rows so
    the specialist's personal calendar stays in sync.

    Args:
        scope: "this" (default) deletes only this row.
               "future" deletes this row and every later sibling sharing
                       the same recurring_group_id.
    """
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")

    # Build the list of session rows to delete.
    targets: list[TherapySession] = [ts]
    if scope == "future":
        if not ts.recurring_group_id:
            raise HTTPException(
                400,
                "Cannot delete future occurrences — this session is not part of a recurring series",
            )
        siblings = session.exec(
            select(TherapySession).where(
                TherapySession.specialist_id == str(current_user.id),
                TherapySession.recurring_group_id == ts.recurring_group_id,
                TherapySession.date >= ts.date,
                TherapySession.id != ts.id,
            )
        ).all()
        targets.extend(siblings)

    # Best-effort GCal cleanup. Don't let a calendar API hiccup block the DB
    # delete the user requested — log and continue.
    calendar_id = get_crm_calendar_id(current_user)
    deleted_gcal = 0
    if calendar_id:
        from app.services.crm_calendar import delete_calendar_event
        for t in targets:
            if not t.google_event_id:
                continue
            try:
                delete_calendar_event(calendar_id, t.google_event_id)
                deleted_gcal += 1
            except Exception as e:
                logger.warning(f"GCal delete failed for {t.google_event_id}: {e}")

    # Delete related payments first (foreign key constraint).
    target_ids = [t.id for t in targets]
    related_payments = session.exec(
        select(TherapistPayment).where(TherapistPayment.session_id.in_(target_ids))
    ).all()
    for payment in related_payments:
        session.delete(payment)

    for t in targets:
        session.delete(t)
    session.commit()
    return {"ok": True, "deleted": len(targets), "deleted_gcal": deleted_gcal, "scope": scope}


@router.post("/sessions/{session_id}/quick-pay")
def quick_pay_session(
    session_id: str,
    payload: dict = Body(default={}),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Mark session as paid and create a payment record. Optionally override account."""
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")
    if ts.is_paid:
        raise HTTPException(400, "Session already paid")

    client = session.get(TherapistClient, ts.client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    price = ts.price if ts.price is not None else client.base_price or 0
    account = payload.get("account") or client.default_account

    # Update session price if it was NULL (use client's current base_price)
    if ts.price is None and client.base_price:
        ts.price = client.base_price
        price = client.base_price

    # Freeze currency & account on the session at payment time
    ts.currency = client.currency
    ts.account = account

    # Create payment record only if amount > 0
    if price and price > 0:
        payment = TherapistPayment(
            client_id=client.id,
            specialist_id=str(current_user.id),
            amount=price,
            currency=client.currency,
            account=account,
            date=datetime.now(),  # payment date = today, not session date
            session_id=ts.id,
        )
        session.add(payment)

    ts.is_paid = True
    ts.updated_at = datetime.now()
    session.add(ts)

    session.commit()
    return {"ok": True, "amount": price, "currency": client.currency, "account": account}


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
    ts.updated_at = datetime.now()
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
    now = datetime.now()
    unpaid = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.client_id == client_id,
            TherapySession.is_paid == False,
            TherapySession.date <= now,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).all()

    count = 0
    for ts in unpaid:
        price = ts.price if ts.price is not None else client.base_price or 0
        # Fill session price from client base_price if NULL
        if ts.price is None and client.base_price:
            ts.price = client.base_price
            price = client.base_price
        # Freeze currency & account on the session at payment time
        ts.currency = client.currency
        ts.account = client.default_account
        # Create payment only if amount > 0
        if price and price > 0:
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
        ts.updated_at = datetime.now()
        session.add(ts)
        count += 1

    if count > 0:
        session.commit()
    return {"ok": True, "marked": count}
