"""
CRM Google Calendar Service — синхронизация личного календаря специалиста.

Использует сервис-аккаунт psycrm (psycrm-bot@psycrm-calendar.iam.gserviceaccount.com),
у которого уже есть доступ к личному календарю специалиста.

Формат события: "ИмяКлиента #AliasCode" (совместимо с psycrm).
"""
import os
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ─── Credentials ──────────────────────────────────────────────────────────────

_CRM_SA_FILE = os.environ.get(
    "CRM_GOOGLE_SERVICE_ACCOUNT_FILE",
    "/Users/mykola/Downloads/psycrm-calendar-2a1f3b4eceee.json"
)
_SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _get_calendar_service():
    if not os.path.exists(_CRM_SA_FILE):
        raise RuntimeError(
            f"CRM service account file not found: {_CRM_SA_FILE}. "
            "Set CRM_GOOGLE_SERVICE_ACCOUNT_FILE env var."
        )
    creds = service_account.Credentials.from_service_account_file(
        _CRM_SA_FILE, scopes=_SCOPES
    )
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


# ─── Core helpers ─────────────────────────────────────────────────────────────

def _dt_to_rfc3339(dt: datetime) -> str:
    """Convert naive UTC datetime → RFC3339 string."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _parse_event_dt(event_dt: dict) -> Optional[datetime]:
    """Parse Google Calendar event dateTime or date → naive UTC datetime."""
    if "dateTime" in event_dt:
        s = event_dt["dateTime"]
        try:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo:
                dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except Exception:
            return None
    elif "date" in event_dt:
        try:
            return datetime.strptime(event_dt["date"], "%Y-%m-%d")
        except Exception:
            return None
    return None


def _extract_alias_code(summary: str) -> Optional[str]:
    """Extract 4-digit alias code from event summary (e.g. 'Name #1234' → '1234')."""
    match = re.search(r"#(\d{4})", summary or "")
    return match.group(1) if match else None


def _get_events(
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
    show_deleted: bool = False,
) -> list:
    """Fetch all events in date range with pagination."""
    service = _get_calendar_service()
    all_items = []
    page_token = None

    while True:
        resp = service.events().list(
            calendarId=calendar_id,
            timeMin=_dt_to_rfc3339(time_min),
            timeMax=_dt_to_rfc3339(time_max),
            maxResults=2500,
            singleEvents=True,
            orderBy="startTime",
            showDeleted=show_deleted,
            pageToken=page_token,
        ).execute()

        all_items.extend(resp.get("items", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return all_items


# ─── Public API ───────────────────────────────────────────────────────────────

def create_calendar_event(
    calendar_id: str,
    client_name: str,
    alias_code: Optional[str],
    session_date: datetime,
    duration_minutes: int = 60,
    notes: Optional[str] = None,
) -> str:
    """
    Create a Google Calendar event for a therapy session.
    Returns the Google event ID.
    """
    service = _get_calendar_service()
    summary = f"{client_name} #{alias_code}" if alias_code else client_name
    start = session_date
    end = session_date + timedelta(minutes=duration_minutes)

    event = service.events().insert(
        calendarId=calendar_id,
        body={
            "summary": summary,
            "description": notes or "",
            "start": {"dateTime": _dt_to_rfc3339(start)},
            "end": {"dateTime": _dt_to_rfc3339(end)},
        },
    ).execute()

    return event["id"]


def update_calendar_event(
    calendar_id: str,
    event_id: str,
    client_name: str,
    alias_code: Optional[str],
    session_date: datetime,
    duration_minutes: int = 60,
    notes: Optional[str] = None,
) -> None:
    """Update an existing Google Calendar event."""
    service = _get_calendar_service()
    summary = f"{client_name} #{alias_code}" if alias_code else client_name
    start = session_date
    end = session_date + timedelta(minutes=duration_minutes)

    service.events().patch(
        calendarId=calendar_id,
        eventId=event_id,
        body={
            "summary": summary,
            "description": notes or "",
            "start": {"dateTime": _dt_to_rfc3339(start)},
            "end": {"dateTime": _dt_to_rfc3339(end)},
        },
    ).execute()


def delete_calendar_event(calendar_id: str, event_id: str) -> None:
    """Delete a Google Calendar event (marks session as cancelled)."""
    service = _get_calendar_service()
    try:
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
    except HttpError as e:
        if e.resp.status == 410:
            pass  # Already deleted
        else:
            raise


def sync_from_calendar(
    calendar_id: str,
    clients: list,  # list of TherapistClient objects
    months_back: int = 24,
    months_forward: int = 3,
) -> dict:
    """
    Pull events from Google Calendar and return sync data.
    Matches events to clients via alias code (#XXXX) or name fuzzy match.

    Returns:
        {
            "events": [...],  # raw GCal events
            "matched": [...],  # list of {event, client_id, date, status}
            "unmatched": [...],  # events that couldn't be matched
        }
    """
    now = datetime.now(timezone.utc)
    time_min = now - timedelta(days=months_back * 30)
    time_max = now + timedelta(days=months_forward * 30)

    events = _get_events(calendar_id, time_min, time_max, show_deleted=True)

    # Build alias → client_id lookup
    alias_map = {c.alias_code: c.id for c in clients if c.alias_code}
    # Build name → client_id lookup (lowercase, first word)
    name_map = {c.name.lower().split()[0]: c.id for c in clients}

    matched = []
    unmatched = []

    for ev in events:
        summary = ev.get("summary", "")
        event_status = ev.get("status", "confirmed")  # "cancelled" for deleted
        start_dt = _parse_event_dt(ev.get("start", {}))
        if not start_dt:
            continue

        end_dt = _parse_event_dt(ev.get("end", {}))
        duration = 60
        if start_dt and end_dt:
            duration = max(30, int((end_dt - start_dt).total_seconds() / 60))

        # Try alias code match
        alias = _extract_alias_code(summary)
        client_id = alias_map.get(alias) if alias else None

        # Fallback: name match
        if not client_id:
            # Strip alias from summary for name matching
            clean_name = re.sub(r"#\d{4}", "", summary).strip().lower()
            for name_key, cid in name_map.items():
                if name_key in clean_name:
                    client_id = cid
                    break

        session_status = "CANCELLED_CLIENT" if event_status == "cancelled" else (
            "COMPLETED" if start_dt < datetime.utcnow() else "PLANNED"
        )

        entry = {
            "google_event_id": ev["id"],
            "summary": summary,
            "date": start_dt,
            "duration_minutes": duration,
            "status": session_status,
            "is_cancelled": event_status == "cancelled",
        }

        if client_id:
            entry["client_id"] = client_id
            matched.append(entry)
        else:
            unmatched.append(entry)

    return {
        "total": len(events),
        "matched": matched,
        "unmatched": unmatched,
    }


def sync_client_history(
    calendar_id: str,
    client_id: str,
    alias_code: str,
    years_back: int = 5,
) -> list:
    """
    Fetch all events for a specific client by alias code.
    Returns list of session dicts ready for DB insert.
    """
    now = datetime.now(timezone.utc)
    time_min = now - timedelta(days=years_back * 365)
    time_max = now + timedelta(days=365)

    events = _get_events(calendar_id, time_min, time_max, show_deleted=True)

    sessions = []
    for ev in events:
        summary = ev.get("summary", "")
        if _extract_alias_code(summary) != alias_code:
            continue

        start_dt = _parse_event_dt(ev.get("start", {}))
        if not start_dt:
            continue

        end_dt = _parse_event_dt(ev.get("end", {}))
        duration = 60
        if end_dt:
            duration = max(30, int((end_dt - start_dt).total_seconds() / 60))

        event_status = ev.get("status", "confirmed")
        session_status = "CANCELLED_CLIENT" if event_status == "cancelled" else (
            "COMPLETED" if start_dt < datetime.utcnow() else "PLANNED"
        )

        sessions.append({
            "google_event_id": ev["id"],
            "client_id": client_id,
            "date": start_dt,
            "duration_minutes": duration,
            "status": session_status,
        })

    return sessions
