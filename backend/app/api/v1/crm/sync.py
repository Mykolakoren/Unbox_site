"""CRM Calendar Sync — Google Calendar bidirectional sync."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.api import deps
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.api.v1.crm import get_crm_calendar_id

router = APIRouter()


@router.post("/sync/calendar")
def sync_from_calendar(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    dry_run: bool = Query(False, description="Preview without saving"),
    months_back: int = Query(24),
    months_forward: int = Query(3),
):
    """Bidirectional sync: pull events from Google Calendar, match to CRM clients."""
    from app.services.crm_calendar import sync_from_calendar as _sync

    calendar_id = get_crm_calendar_id(current_user)
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

    created = 0
    updated = 0
    for entry in result["matched"]:
        if entry.get("is_cancelled"):
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

        existing = session.exec(
            select(TherapySession).where(
                TherapySession.google_event_id == entry["google_event_id"],
                TherapySession.specialist_id == uid,
            )
        ).first()
        if existing:
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
    """Import full session history for a specific client from Google Calendar."""
    from app.services.crm_calendar import sync_client_history as _sync_client

    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")
    if not client.alias_code:
        raise HTTPException(400, "Client has no alias code — required for calendar matching.")

    calendar_id = get_crm_calendar_id(current_user)
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
