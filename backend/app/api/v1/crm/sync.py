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
                existing.updated_at = datetime.now()
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
                existing.updated_at = datetime.now()
                session.add(existing)
                updated += 1
            continue

        # Also check by client_id + date to prevent duplicates.
        # Edge case: a recurring series instance was cancelled (status=
        # CANCELLED_CLIENT), then the user recreated a one-off event at the
        # same slot. The old cancelled row would block the new one here —
        # instead, adopt the new Google event onto the cancelled row and
        # flip the status.
        existing_by_date = session.exec(
            select(TherapySession).where(
                TherapySession.client_id == entry["client_id"],
                TherapySession.specialist_id == uid,
                TherapySession.date == entry["date"],
            )
        ).first()
        if existing_by_date:
            if existing_by_date.status in ("CANCELLED_CLIENT", "CANCELLED_THERAPIST") \
               and existing_by_date.google_event_id != entry["google_event_id"]:
                existing_by_date.google_event_id = entry["google_event_id"]
                existing_by_date.status = entry["status"]
                existing_by_date.duration_minutes = entry["duration_minutes"]
                existing_by_date.updated_at = datetime.now()
                session.add(existing_by_date)
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

    # ── Backfill alias codes into Google Calendar summaries ──────────────
    # For every matched event that doesn't yet carry a `#XXXX` code AND has
    # a single, confident client match — patch the event summary in place.
    # Next time the calendar is synced, the alias path matches instantly,
    # so a client rename or a new namesake no longer breaks anything.
    # Recurring events are skipped to avoid altering a whole series from one
    # instance.
    codes_backfilled = 0
    backfill_errors = 0
    if not dry_run:
        from app.services.crm_calendar import patch_event_summary
        import logging
        _log = logging.getLogger(__name__)
        for entry in result["matched"]:
            if entry.get("has_alias_code"):
                continue
            if entry.get("is_recurring"):
                continue
            # Google rejects PATCH on cancelled/declined events — and even if
            # it didn't, rewriting the summary of a cancelled slot is
            # meaningless noise. Skip.
            if entry.get("is_cancelled"):
                continue
            new_summary = entry.get("suggested_summary")
            if not new_summary:
                continue
            try:
                patch_event_summary(calendar_id, entry["google_event_id"], new_summary)
                codes_backfilled += 1
            except Exception as e:
                _log.warning(
                    f"[GCal backfill] failed to patch {entry['google_event_id']}: {e}"
                )
                backfill_errors += 1

    return {
        "total_events": result["total"],
        "matched": len(result["matched"]),
        "unmatched": len(result["unmatched"]),
        "ambiguous": len(result.get("ambiguous", [])),
        "created": created,
        "updated": updated,
        "auto_created_clients": auto_created_clients,
        "codes_backfilled": codes_backfilled,
        "backfill_errors": backfill_errors,
        "unmatched_summaries": [e["summary"] for e in result["unmatched"][:20]],
        "ambiguous_summaries": [
            {
                "summary": e["summary"],
                "date": e["date"].isoformat() if e.get("date") else None,
                "candidates": e.get("ambiguous_candidates", []),
            }
            for e in result.get("ambiguous", [])[:20]
        ],
    }


@router.post("/sync/backfill-alias-codes")
def backfill_alias_codes(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    months_back: int = Query(24, description="How far back to walk the calendar"),
    months_forward: int = Query(3),
    dry_run: bool = Query(False, description="Preview what would be patched without touching Calendar"),
):
    """
    One-shot housekeeping: walk the calendar, and for every event whose
    summary maps unambiguously to a CRM client, rewrite the summary to
    "Name #alias_code" so future syncs never have to guess. Leaves ambiguous
    and unmatched events alone — the report lists them for manual review.
    """
    from app.services.crm_calendar import sync_from_calendar as _sync, patch_event_summary

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

    would_patch = []
    already_coded = 0
    recurring_skipped = 0

    cancelled_skipped = 0
    for entry in result["matched"]:
        if entry.get("has_alias_code"):
            already_coded += 1
            continue
        if entry.get("is_recurring"):
            recurring_skipped += 1
            continue
        if entry.get("is_cancelled"):
            cancelled_skipped += 1
            continue
        if not entry.get("suggested_summary"):
            continue
        would_patch.append({
            "event_id": entry["google_event_id"],
            "date": entry["date"].isoformat() if entry.get("date") else None,
            "from": entry["summary"],
            "to": entry["suggested_summary"],
        })

    patched = 0
    failed = []
    if not dry_run:
        import logging
        _log = logging.getLogger(__name__)
        for item in would_patch:
            try:
                patch_event_summary(calendar_id, item["event_id"], item["to"])
                patched += 1
            except Exception as e:
                _log.warning(f"[backfill] {item['event_id']}: {e}")
                failed.append({**item, "error": str(e)})

    return {
        "dry_run": dry_run,
        "total_events": result["total"],
        "already_had_codes": already_coded,
        "recurring_skipped": recurring_skipped,
        "cancelled_skipped": cancelled_skipped,
        "would_patch": len(would_patch),
        "patched": patched,
        "failed": len(failed),
        "sample_to_patch": would_patch[:20],
        "failures": failed[:20],
        "ambiguous_count": len(result.get("ambiguous", [])),
        "ambiguous_sample": [
            {
                "summary": e["summary"],
                "date": e["date"].isoformat() if e.get("date") else None,
                "candidates": e.get("ambiguous_candidates", []),
            }
            for e in result.get("ambiguous", [])[:20]
        ],
        "unmatched_count": len(result["unmatched"]),
        "unmatched_sample": [e["summary"] for e in result["unmatched"][:20]],
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
            alias_code=client.alias_code or "",
            years_back=effective_years_back,
            months_forward=months_forward,
            extra_alias_codes=getattr(client, 'merged_alias_codes', None) or [],
            client_name=client.name,
        )
    except Exception as e:
        raise HTTPException(500, f"Google Calendar error: {e}")

    uid = str(current_user.id)
    created = 0
    for entry in sessions_data:
        # Check by google_event_id
        existing = session.exec(
            select(TherapySession).where(
                TherapySession.google_event_id == entry["google_event_id"],
                TherapySession.specialist_id == uid,
            )
        ).first()
        if existing:
            continue
        # Also check by client_id + date to prevent duplicates from name matching
        existing_by_date = session.exec(
            select(TherapySession).where(
                TherapySession.client_id == entry["client_id"],
                TherapySession.specialist_id == uid,
                TherapySession.date == entry["date"],
            )
        ).first()
        if existing_by_date:
            continue
        ts = TherapySession(**entry, specialist_id=uid)
        session.add(ts)
        created += 1

    session.commit()
    return {"total_found": len(sessions_data), "created": created}
