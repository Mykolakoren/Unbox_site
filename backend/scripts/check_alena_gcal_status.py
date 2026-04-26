"""Check status (confirmed/cancelled) of Alena's GCal events to detect duplicates
between the old synced recurring rule (14:00 UTC slot) and the freshly-created
chessboard recurring sessions (18:00 naive Tbilisi)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, select
from app.db.session import engine
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.services.crm_calendar import _get_calendar_service


def main() -> None:
    calendar_id = "koren.nikolas@gmail.com"
    service = _get_calendar_service()

    with Session(engine) as session:
        alena = session.exec(
            select(TherapistClient).where(TherapistClient.name == "Алена грум")
        ).first()
        sessions = session.exec(
            select(TherapySession).where(
                TherapySession.client_id == str(alena.id),
                TherapySession.date >= "2026-05-01",
                TherapySession.google_event_id.is_not(None),
            ).order_by(TherapySession.date)
        ).all()

        for ts in sessions:
            try:
                ev = service.events().get(
                    calendarId=calendar_id,
                    eventId=ts.google_event_id,
                ).execute()
                start = ev.get("start", {})
                start_str = start.get("dateTime", start.get("date", "?"))
                status = ev.get("status", "?")
                summary = ev.get("summary", "?")
                print(f"  {ts.date} → {status:10} {start_str} | {summary}")
            except Exception as e:
                print(f"  {ts.date} → ERROR {e!s}"[:120])


if __name__ == "__main__":
    main()
