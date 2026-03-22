"""CRM Calendar Sync — Google Calendar import with auto-client creation."""
import re
import random
import string
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.api import deps
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.api.v1.crm import get_crm_calendar_id

router = APIRouter()


def _clean_client_name(summary: str) -> str:
    """Extract clean client name from calendar event summary."""
    name = re.sub(r"#\d{4}", "", summary or "").strip()
    name = re.sub(r"\s*\(.*?\)\s*$", "", name).strip()
    name = " ".join(name.split())
    return name


def _generate_alias_code(existing_codes: set) -> str:
    """Generate a unique 4-digit alias code."""
    for _ in range(1000):
        code = "".join(random.choices(string.digits, k=4))
        if code not in existing_codes:
            return code
    raise RuntimeError("Cannot generate unique alias code")


def _normalize_name(name: str) -> str:
    """Normalize name for matching: lowercase, strip, collapse whitespace."""
    return " ".join(name.lower().strip().split())


@router.post("/sync/calendar")
def sync_from_calendar(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    dry_run: bool = Query(False, description="Preview without saving"),
    auto_create_clients: bool = Query(True, description="Auto-create clients from unmatched events"),
    months_back: int = Query(24),
    months_forward: int = Query(3),
):
    """
    Pull events from Google Calendar, match to CRM clients.
    If auto_create_clients=True, auto-creates new clients from unmatched event names.
    """
    from app.services.crm_calendar import sync_from_calendar as _sync, _extract_alias_code

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

    # ── Auto-create clients from unmatched events ─────────────────────────
    auto_created_clients = 0
    if auto_create_clients and not dry_run and result["unmatched"]:
        existing_codes = {c.alias_code for c in clients if c.alias_code}
        name_to_client: dict = {}
        for c in clients:
            name_to_client[_normalize_name(c.name)] = c

        # Group unmatched events by clean name
        name_events: dict = {}
        for ev in result["unmatched"]:
            clean = _clean_client_name(ev["summary"])
            if not clean or len(clean) < 2:
                continue
            norm = _normalize_name(clean)
            if norm not in name_events:
                name_events[norm] = []
            name_events[norm].append(ev)

        # Create clients for each unique name
        new_clients_map: dict = {}  # normalized_name -> client_id
        for norm_name, events in name_events.items():
            if norm_name in name_to_client:
                new_clients_map[norm_name] = name_to_client[norm_name].id
                continue

            # Try to extract alias from event summaries
            alias = None
            for ev in events:
                alias = _extract_alias_code(ev["summary"])
                if alias:
                    break
            if not alias:
                alias = _generate_alias_code(existing_codes)
            existing_codes.add(alias)

            display_name = _clean_client_name(events[0]["summary"])
            new_client = TherapistClient(
                specialist_id=uid,
                name=display_name,
                alias_code=alias,
                pipeline_status="ACTIVE",
                tags=["google-calendar"],
            )
            session.add(new_client)
            session.flush()

            name_to_client[norm_name] = new_client
            new_clients_map[norm_name] = new_client.id
            auto_created_clients += 1

        # Move unmatched -> matched with auto-created client IDs
        still_unmatched = []
        for ev in result["unmatched"]:
            clean = _clean_client_name(ev["summary"])
            norm = _normalize_name(clean) if clean else ""
            if norm in new_clients_map:
                ev["client_id"] = new_clients_map[norm]
                result["matched"].append(ev)
            else:
                still_unmatched.append(ev)
        result["unmatched"] = still_unmatched

    # ── Dry Run preview ───────────────────────────────────────────────────
    if dry_run:
        unique_names = set()
        for ev in result["unmatched"]:
            clean = _clean_client_name(ev["summary"])
            if clean and len(clean) >= 2:
                unique_names.add(_normalize_name(clean))
        return {
            "dry_run": True,
            "total_events": result["total"],
            "matched": len(result["matched"]),
            "unmatched": len(result["unmatched"]),
            "would_create_clients": len(unique_names),
            "unmatched_summaries": [e["summary"] for e in result["unmatched"][:20]],
        }

    # ── Save sessions ─────────────────────────────────────────────────────
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
        "auto_created_clients": auto_created_clients,
        "unmatched_summaries": [e["summary"] for e in result["unmatched"][:20]],
    }


@router.post("/clients/{client_id}/sync-history")
def sync_client_history(
    client_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    years_back: int = Query(5),
    months_back: int = Query(None, description="Override: months back from now"),
    months_forward: int = Query(3, description="Months forward from now"),
):
    """Import session history for a specific client from Google Calendar."""
    from app.services.crm_calendar import sync_client_history as _sync_client

    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")
    if not client.alias_code:
        raise HTTPException(400, "Client has no alias code — required for calendar matching.")

    calendar_id = get_crm_calendar_id(current_user)
    if not calendar_id:
        raise HTTPException(400, "Google Calendar not configured.")

    # Convert months_back to years_back if provided
    effective_years_back = years_back
    if months_back is not None:
        effective_years_back = max(1, months_back) / 12.0  # fractional years

    try:
        sessions_data = _sync_client(
            calendar_id=calendar_id,
            client_id=client_id,
            alias_code=client.alias_code,
            years_back=effective_years_back,
            months_forward=months_forward,
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
