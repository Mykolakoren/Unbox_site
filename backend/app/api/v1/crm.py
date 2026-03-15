"""
CRM API для специалистов — управление клиентами, сессиями, платежами, заметками.
Все данные изолированы по specialist_id (= user.id текущего пользователя).
"""
from typing import Any, List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlmodel import Session, select, func, col
from app.api import deps
from app.models.user import User, UserUpdateAdmin
from app.models.therapist_client import (
    TherapistClient, TherapistClientCreate, TherapistClientRead, TherapistClientUpdate,
)
from app.models.therapy_session import (
    TherapySession, TherapySessionCreate, TherapySessionRead, TherapySessionUpdate,
)
from app.models.therapist_payment import (
    TherapistPayment, TherapistPaymentCreate, TherapistPaymentRead,
)
from app.models.therapist_note import (
    TherapistNote, TherapistNoteCreate, TherapistNoteRead,
)

router = APIRouter()


def _get_crm_calendar_id(user: User) -> Optional[str]:
    """Get specialist's personal calendar ID from crm_data."""
    if user.crm_data and isinstance(user.crm_data, dict):
        return user.crm_data.get("calendar_id")
    return None


# ── Clients ───────────────────────────────────────────────────────────────────

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
    # Only return client if it belongs to this specialist — no admin bypass
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

    # Permanent delete — only for owner/senior_admin
    if permanent:
        if current_user.role not in ("owner", "senior_admin"):
            raise HTTPException(403, "Only owner or senior admin can permanently delete clients")

        # Delete related sessions, payments, notes
        sessions_to_del = session.exec(
            select(TherapySession).where(TherapySession.client_id == client_id)
        ).all()
        for s in sessions_to_del:
            session.delete(s)

        payments_to_del = session.exec(
            select(TherapistPayment).where(TherapistPayment.client_id == client_id)
        ).all()
        for p in payments_to_del:
            session.delete(p)

        notes_to_del = session.exec(
            select(TherapistNote).where(TherapistNote.client_id == client_id)
        ).all()
        for n in notes_to_del:
            session.delete(n)

        session.delete(client)
        session.commit()
        return {"ok": True, "permanent": True}

    # Soft delete — mark as inactive
    client.is_active = False
    client.updated_at = datetime.utcnow()
    session.add(client)
    session.commit()
    return {"ok": True}


# ── Sessions ──────────────────────────────────────────────────────────────────

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


@router.post("/sessions", response_model=TherapySessionRead)
def create_session(
    data: TherapySessionCreate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    # Verify client belongs to this specialist
    client = session.get(TherapistClient, data.client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    create_data = data.model_dump(exclude={"push_to_calendar"})
    therapy_session = TherapySession(
        **create_data,
        specialist_id=str(current_user.id),
    )

    # Optionally push to Google Calendar
    if data.push_to_calendar:
        calendar_id = _get_crm_calendar_id(current_user)
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
                # Don't fail the whole request if GCal fails
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


# ── Payments ──────────────────────────────────────────────────────────────────

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

    # If session_id provided, mark session as paid
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


# ── Notes ─────────────────────────────────────────────────────────────────────

@router.get("/notes", response_model=List[TherapistNoteRead])
def list_notes(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    client_id: Optional[str] = Query(None),
):
    uid = str(current_user.id)
    stmt = select(TherapistNote).where(TherapistNote.specialist_id == uid)
    if client_id:
        stmt = stmt.where(TherapistNote.client_id == client_id)
    stmt = stmt.order_by(TherapistNote.created_at.desc())
    return session.exec(stmt).all()


@router.post("/notes", response_model=TherapistNoteRead)
def create_note(
    data: TherapistNoteCreate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, data.client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    note = TherapistNote(
        **data.model_dump(),
        specialist_id=str(current_user.id),
    )
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


@router.delete("/notes/{note_id}")
def delete_note(
    note_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    note = session.get(TherapistNote, note_id)
    if not note or note.specialist_id != str(current_user.id):
        raise HTTPException(404, "Note not found")
    session.delete(note)
    session.commit()
    return {"ok": True}


# ── Dashboard / Analytics ─────────────────────────────────────────────────────

@router.get("/dashboard")
def crm_dashboard(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Summary stats for the specialist's CRM dashboard."""
    uid = str(current_user.id)
    now = datetime.utcnow()

    # Active clients count
    active_clients = session.exec(
        select(func.count()).where(
            TherapistClient.specialist_id == uid,
            TherapistClient.is_active == True,
        )
    ).one()

    # Sessions this month
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    sessions_this_month = session.exec(
        select(func.count()).where(
            TherapySession.specialist_id == uid,
            TherapySession.date >= month_start,
            TherapySession.date <= now,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).one()

    # Unpaid sessions
    unpaid_count = session.exec(
        select(func.count()).where(
            TherapySession.specialist_id == uid,
            TherapySession.is_paid == False,
            TherapySession.date <= now,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).one()

    # Payments this month
    payments_this_month = session.exec(
        select(func.coalesce(func.sum(TherapistPayment.amount), 0)).where(
            TherapistPayment.specialist_id == uid,
            TherapistPayment.date >= month_start,
        )
    ).one()

    # Upcoming sessions (next 7 days)
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


# ── CRM Access Application & Subscription ─────────────────────────────────────

@router.post("/apply")
def apply_for_crm_access(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_active_user),
    profession: Optional[str] = Body(None, embed=True),
    message: Optional[str] = Body(None, embed=True),
):
    """Any authenticated user can apply for psy_crm.access (monthly subscription).
    Blocks duplicate pending requests."""
    crm_data = dict(current_user.crm_data or {})
    current_status = crm_data.get("access_status", "none")

    # Block duplicate pending applications
    if current_status == "pending":
        raise HTTPException(400, "Запрос уже на рассмотрении")

    crm_data["access_status"] = "pending"
    crm_data["access_application"] = {
        "profession": profession or "",
        "message": message or "",
        "submitted_at": datetime.utcnow().isoformat(),
    }
    if profession:
        current_user.profession = profession
    current_user.crm_data = crm_data
    current_user.updated_at = datetime.utcnow()
    session.add(current_user)
    session.commit()
    return {"ok": True, "status": "pending"}


@router.get("/my-access")
def get_my_crm_access(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Returns the current user's CRM access status, checking expiry."""
    # Permanent access for specialists and owners
    if current_user.role in ("specialist", "owner"):
        return {
            "access_status": "active",
            "permanent": True,
            "expires_at": None,
            "days_remaining": None,
        }

    crm_data = dict(current_user.crm_data or {})
    access_status = crm_data.get("access_status", "none")

    # Check expiry for active access
    if access_status == "active":
        expires_at = crm_data.get("access_expires_at")
        if expires_at:
            try:
                expiry_dt = datetime.fromisoformat(expires_at)
                if datetime.utcnow() > expiry_dt:
                    # Access expired — update status in DB
                    crm_data["access_status"] = "expired"
                    current_user.crm_data = crm_data
                    current_user.updated_at = datetime.utcnow()
                    # Remove psy_crm.access permission
                    perms = list(current_user.permissions or [])
                    if "psy_crm.access" in perms:
                        perms.remove("psy_crm.access")
                        current_user.permissions = perms
                    session.add(current_user)
                    session.commit()
                    return {
                        "access_status": "expired",
                        "permanent": False,
                        "expires_at": expires_at,
                        "days_remaining": 0,
                    }
                days_remaining = (expiry_dt - datetime.utcnow()).days
                return {
                    "access_status": "active",
                    "permanent": False,
                    "expires_at": expires_at,
                    "days_remaining": max(0, days_remaining),
                }
            except (ValueError, TypeError):
                pass

    return {
        "access_status": access_status,
        "permanent": False,
        "expires_at": crm_data.get("access_expires_at"),
        "days_remaining": None,
    }


@router.get("/access-requests")
def list_crm_access_requests(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Admin endpoint: list all users with pending CRM access requests."""
    if not deps.has_permission(current_user, "admin.accept_requests"):
        raise HTTPException(403, "Недостаточно прав для просмотра запросов")

    # Scan all users where crm_data.access_status == 'pending'
    all_users = session.exec(select(User)).all()
    pending = []
    for user in all_users:
        crm_data = user.crm_data or {}
        if crm_data.get("access_status") == "pending":
            app_data = crm_data.get("access_application", {})
            pending.append({
                "user_id": str(user.id),
                "name": user.name,
                "email": user.email,
                "phone": user.phone,
                "profession": app_data.get("profession", ""),
                "message": app_data.get("message", ""),
                "submitted_at": app_data.get("submitted_at", ""),
                "avatar_url": user.avatar_url,
            })

    # Sort by submission date, newest first
    pending.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)
    return pending


@router.post("/access-requests/{user_id}/approve")
def approve_crm_access(
    user_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
    days: int = Body(30, embed=True),
):
    """Admin: approve CRM access for a user. Grants 30-day access by default."""
    if not deps.has_permission(current_user, "admin.accept_requests"):
        raise HTTPException(403, "Недостаточно прав для одобрения запросов")

    from uuid import UUID as _UUID
    try:
        target_user = session.get(User, _UUID(user_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "User not found")

    if not target_user:
        raise HTTPException(404, "User not found")

    now = datetime.utcnow()
    expires_at = now + timedelta(days=days)

    crm_data = dict(target_user.crm_data or {})
    crm_data["access_status"] = "active"
    crm_data["access_expires_at"] = expires_at.isoformat()
    crm_data["access_granted_by"] = str(current_user.id)
    crm_data["access_granted_at"] = now.isoformat()

    target_user.crm_data = crm_data

    # Add psy_crm.access to permissions
    perms = list(target_user.permissions or [])
    if "psy_crm.access" not in perms:
        perms.append("psy_crm.access")
        target_user.permissions = perms

    target_user.updated_at = now
    session.add(target_user)
    session.commit()

    return {
        "ok": True,
        "access_status": "active",
        "expires_at": expires_at.isoformat(),
        "days": days,
    }


@router.post("/access-requests/{user_id}/reject")
def reject_crm_access(
    user_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
    reason: Optional[str] = Body(None, embed=True),
):
    """Admin: reject CRM access request."""
    if not deps.has_permission(current_user, "admin.accept_requests"):
        raise HTTPException(403, "Недостаточно прав для отклонения запросов")

    from uuid import UUID as _UUID
    try:
        target_user = session.get(User, _UUID(user_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "User not found")

    if not target_user:
        raise HTTPException(404, "User not found")

    crm_data = dict(target_user.crm_data or {})
    crm_data["access_status"] = "rejected"
    crm_data["rejected_by"] = str(current_user.id)
    crm_data["rejected_at"] = datetime.utcnow().isoformat()
    if reason:
        crm_data["rejection_reason"] = reason

    target_user.crm_data = crm_data
    target_user.updated_at = datetime.utcnow()
    session.add(target_user)
    session.commit()

    return {"ok": True, "access_status": "rejected"}


# /specialists endpoint removed — CRM data is fully isolated from admins


# ── CRM Settings (Calendar ID etc.) ───────────────────────────────────────────

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


# ── Google Calendar Sync ───────────────────────────────────────────────────────

@router.post("/sync/calendar")
def sync_from_calendar(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    dry_run: bool = Query(False, description="Preview without saving"),
    months_back: int = Query(24),
    months_forward: int = Query(3),
):
    """
    Bidirectional sync: pull events from Google Calendar, match to CRM clients,
    create missing sessions.
    """
    from app.services.crm_calendar import sync_from_calendar as _sync

    calendar_id = _get_crm_calendar_id(current_user)
    if not calendar_id:
        raise HTTPException(400, "Google Calendar not configured. Set calendar_id in /crm/settings.")

    uid = str(current_user.id)
    clients = session.exec(
        select(TherapistClient).where(TherapistClient.specialist_id == uid)
    ).all()

    try:
        result = _sync(
            calendar_id=calendar_id,
            clients=clients,
            months_back=months_back,
            months_forward=months_forward,
        )
    except Exception as e:
        raise HTTPException(500, f"Google Calendar error: {e}")

    if dry_run:
        return {
            "dry_run": True,
            "total_events": result["total"],
            "matched": len(result["matched"]),
            "unmatched": len(result["unmatched"]),
            "unmatched_summaries": [e["summary"] for e in result["unmatched"][:20]],
        }

    # Write matched sessions to DB (skip existing google_event_id)
    created = 0
    updated = 0
    for entry in result["matched"]:
        if entry.get("is_cancelled"):
            # Update existing session to cancelled
            existing = session.exec(
                select(TherapySession).where(
                    TherapySession.google_event_id == entry["google_event_id"],
                    TherapySession.specialist_id == uid,
                )
            ).first()
            if existing and existing.status not in ("CANCELLED_CLIENT", "CANCELLED_THERAPIST"):
                existing.status = "CANCELLED_CLIENT"
                existing.updated_at = datetime.utcnow()
                session.add(existing)
                updated += 1
            continue

        # Check if session already exists by google_event_id
        existing = session.exec(
            select(TherapySession).where(
                TherapySession.google_event_id == entry["google_event_id"],
                TherapySession.specialist_id == uid,
            )
        ).first()
        if existing:
            # Update date if rescheduled
            if abs((existing.date - entry["date"]).total_seconds()) > 60:
                existing.date = entry["date"]
                existing.duration_minutes = entry["duration_minutes"]
                existing.updated_at = datetime.utcnow()
                session.add(existing)
                updated += 1
            continue

        ts = TherapySession(
            client_id=entry["client_id"],
            specialist_id=uid,
            date=entry["date"],
            duration_minutes=entry["duration_minutes"],
            status=entry["status"],
            google_event_id=entry["google_event_id"],
        )
        session.add(ts)
        created += 1

    session.commit()

    return {
        "total_events": result["total"],
        "matched": len(result["matched"]),
        "unmatched": len(result["unmatched"]),
        "created": created,
        "updated": updated,
        "unmatched_summaries": [e["summary"] for e in result["unmatched"][:20]],
    }


@router.post("/clients/{client_id}/sync-history")
def sync_client_history(
    client_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    years_back: int = Query(5),
):
    """
    Import full session history for a specific client from Google Calendar
    (matches by alias code #XXXX in event summary).
    """
    from app.services.crm_calendar import sync_client_history as _sync_client

    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")
    if not client.alias_code:
        raise HTTPException(400, "Client has no alias code — required for calendar matching.")

    calendar_id = _get_crm_calendar_id(current_user)
    if not calendar_id:
        raise HTTPException(400, "Google Calendar not configured.")

    try:
        sessions_data = _sync_client(
            calendar_id=calendar_id,
            client_id=client_id,
            alias_code=client.alias_code,
            years_back=years_back,
        )
    except Exception as e:
        raise HTTPException(500, f"Google Calendar error: {e}")

    uid = str(current_user.id)
    created = 0
    for entry in sessions_data:
        existing = session.exec(
            select(TherapySession).where(
                TherapySession.google_event_id == entry["google_event_id"],
                TherapySession.specialist_id == uid,
            )
        ).first()
        if existing:
            continue
        ts = TherapySession(**entry, specialist_id=uid)
        session.add(ts)
        created += 1

    session.commit()
    return {"total_found": len(sessions_data), "created": created}
