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
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "psycrm-calendar.json")
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
    """Convert datetime → RFC3339 string for Google Calendar.

    Naive datetimes coming from CRM endpoints (frontend sends
    "YYYY-MM-DDTHH:MM:SS" without a TZ suffix) represent Tbilisi local
    wall-clock time — that's the convention the rest of the CRM follows
    (chessboard, session list, reminders). Treat them as Asia/Tbilisi
    (UTC+4) and serialise with the offset so Google Calendar lands the
    event at the right wall-clock time. The previous behaviour (assume
    naive=UTC) buried events 4 hours late."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone(timedelta(hours=4)))
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


def patch_event_summary(calendar_id: str, event_id: str, new_summary: str) -> None:
    """Update only the summary of an event — used for appending `#alias` codes
    to historical events without touching start/end/description. Minimal
    patch keeps the event stable for recurring series and third-party sync."""
    service = _get_calendar_service()
    service.events().patch(
        calendarId=calendar_id,
        eventId=event_id,
        body={"summary": new_summary},
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
    # Use explicit UTC so naive datetimes are consistent with _parse_event_dt
    TZ_TBILISI = timezone(timedelta(hours=4))
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC

    if months_back == 0:
        # "current month only" → from 1st of this month in Tbilisi time
        now_tb = datetime.now(TZ_TBILISI)
        month_start_tb = now_tb.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        time_min = month_start_tb.astimezone(timezone.utc).replace(tzinfo=None)
    else:
        time_min = now_utc - timedelta(days=months_back * 30)
    time_max = now_utc + timedelta(days=months_forward * 30)

    events = _get_events(calendar_id, time_min, time_max, show_deleted=True)

    # Build alias → client lookup (carries full client object so we can pull
    # alias_code / canonical name when building suggested summaries).
    alias_map = {c.alias_code: c for c in clients if c.alias_code}

    # Build name → list of clients (1:many). If the same normalized name is
    # shared by several clients ("Александр" x 2), name-based matching is
    # ambiguous — we refuse to guess, caller must use an alias code.
    name_map: dict = {}
    for c in clients:
        norm = " ".join(c.name.lower().strip().split())
        name_map.setdefault(norm, []).append(c)

    matched = []
    unmatched = []
    ambiguous = []  # events whose name matches 2+ clients — human must disambiguate

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

        matched_client = None          # the resolved TherapistClient, or None
        ambiguous_candidates: list = []  # when name maps to 2+ clients

        # 1) Alias code match — highest confidence, never ambiguous.
        alias = _extract_alias_code(summary)
        if alias and alias in alias_map:
            matched_client = alias_map[alias]

        # 2) Fallback: strict name match (full name only, no partial fuzzy).
        if not matched_client:
            clean_name = " ".join(re.sub(r"#\d{4}", "", summary).strip().lower().split())

            # 2a. Exact full-name hit.
            candidates = name_map.get(clean_name, [])
            if len(candidates) == 1:
                matched_client = candidates[0]
            elif len(candidates) >= 2:
                ambiguous_candidates = candidates

            # 2b. Word-set match — tolerates one extra word in the event
            # relative to the client (so "Name Surname" in CRM still matches
            # "Name Surname #old-tag" in GCal). Same ambiguity rules.
            if not matched_client and not ambiguous_candidates:
                clean_words = set(clean_name.split())
                word_set_hits = []
                for name_key, cs in name_map.items():
                    name_words = set(name_key.split())
                    if len(name_words) < 2:
                        continue
                    if name_words == clean_words or (
                        name_words.issubset(clean_words)
                        and len(clean_words) <= len(name_words) + 1
                    ):
                        word_set_hits.extend(cs)
                if len(word_set_hits) == 1:
                    matched_client = word_set_hits[0]
                elif len(word_set_hits) >= 2:
                    ambiguous_candidates = word_set_hits

        # Session status in UTC (start_dt is naive UTC, now_utc same).
        session_status = "CANCELLED_CLIENT" if event_status == "cancelled" else (
            "COMPLETED" if start_dt < now_utc else "PLANNED"
        )

        entry = {
            "google_event_id": ev["id"],
            "summary": summary,
            "date": start_dt,
            "duration_minutes": duration,
            "status": session_status,
            "is_cancelled": event_status == "cancelled",
            # True when GCal summary already carries a #XXXX code — no patch needed.
            "has_alias_code": bool(alias),
            # Set when we have a confident single-client match AND the event
            # lacks an alias code — callers can patch summary to "Name #code"
            # in Google Calendar to prevent future ambiguity.
            "suggested_summary": None,
            "is_recurring": bool(ev.get("recurringEventId")),
        }

        if matched_client:
            entry["client_id"] = matched_client.id
            if not alias and matched_client.alias_code:
                # Offer the canonical summary for backfill: "Client Name #CODE".
                entry["suggested_summary"] = f"{matched_client.name} #{matched_client.alias_code}"
            matched.append(entry)
        elif ambiguous_candidates:
            entry["ambiguous_candidates"] = [
                {"id": c.id, "name": c.name, "alias_code": c.alias_code}
                for c in ambiguous_candidates
            ]
            ambiguous.append(entry)
        else:
            unmatched.append(entry)

    return {
        "total": len(events),
        "matched": matched,
        "unmatched": unmatched,
        "ambiguous": ambiguous,
    }


def sync_client_history(
    calendar_id: str,
    client_id: str,
    alias_code: str,
    years_back: float = 5,
    months_forward: int = 3,
    extra_alias_codes: list = None,
    client_name: str = None,
) -> list:
    """
    Fetch events for a specific client by alias codes and/or name.
    Supports merged clients with multiple alias codes.
    """
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC
    time_min = now_utc - timedelta(days=int(years_back * 365))
    time_max = now_utc + timedelta(days=months_forward * 30)

    events = _get_events(calendar_id, time_min, time_max, show_deleted=True)

    # Build set of all alias codes to match
    all_codes = set()
    if alias_code:
        all_codes.add(alias_code)
    if extra_alias_codes:
        all_codes.update(extra_alias_codes)

    # Normalize client name for fuzzy matching
    name_lower = client_name.strip().lower() if client_name else None
    # Remove @ prefix for matching
    if name_lower and name_lower.startswith('@'):
        name_lower = name_lower[1:]

    sessions = []
    for ev in events:
        summary = ev.get("summary", "")
        event_code = _extract_alias_code(summary)

        # Match by alias code first
        matched = event_code in all_codes if event_code and all_codes else False

        # If no alias match and we have a name, try name matching
        if not matched and name_lower and summary:
            clean = re.sub(r"#\d{4}", "", summary).strip().lower()
            # Only match if the summary looks like a client name (not a meeting/event)
            # Skip entries with common non-client keywords
            skip_keywords = ['встреча', 'созвон', 'стрижка', 'ремонт', 'партнер', 'neo school',
                             'cancelled', 'online session', 'telemed', 'бип', 'актёрск',
                             'стратсессия', 'информация', 'супервизия', 'отвезти', 'заполнить',
                             'нова подія', 'rust', 'http']
            if not any(kw in clean for kw in skip_keywords):
                # Strict match: full name must match, or event name must be full name
                # Avoid partial matches like "Александр" matching "Александр Петров"
                clean_words = set(clean.split())
                name_words = set(name_lower.split())
                # Match only if ALL words from the shorter name are in the longer name
                # AND the shorter name has at least 2 words (to avoid single-word collisions)
                if len(clean_words) >= 2 and clean_words.issubset(name_words):
                    matched = True
                elif len(name_words) >= 2 and name_words.issubset(clean_words):
                    matched = True
                elif clean == name_lower:
                    matched = True

        if not matched:
            continue

        start_dt = _parse_event_dt(ev.get("start", {}))
        if not start_dt:
            continue

        end_dt = _parse_event_dt(ev.get("end", {}))
        duration = 60
        if end_dt:
            duration = max(30, int((end_dt - start_dt).total_seconds() / 60))

        event_status = ev.get("status", "confirmed")
        # Compare in UTC: start_dt is naive UTC
        session_status = "CANCELLED_CLIENT" if event_status == "cancelled" else (
            "COMPLETED" if start_dt < now_utc else "PLANNED"
        )

        sessions.append({
            "google_event_id": ev["id"],
            "client_id": client_id,
            "date": start_dt,
            "duration_minutes": duration,
            "status": session_status,
        })

    return sessions
