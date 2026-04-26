"""One-shot: push the 8 Алена грум recurring sessions (created during the
stale-bundle window when push_to_calendar wasn't being sent) into the
specialist's personal Google Calendar."""
import sys
from pathlib import Path

# Ensure backend root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.services.crm_calendar import create_calendar_event


def main() -> None:
    with Session(engine) as session:
        # Find Alena грум specifically (there's also @Алена Шилович in the same workspace)
        alena = session.exec(
            select(TherapistClient).where(TherapistClient.name == "Алена грум")
        ).first()
        if not alena:
            print("Alena грум not found")
            return
        print(f"Alena: id={alena.id} name={alena.name!r} alias={alena.alias_code}")

        specialist = session.get(User, alena.specialist_id)
        if not specialist or not isinstance(specialist.crm_data, dict):
            print(f"Specialist {alena.specialist_id} has no crm_data")
            return
        calendar_id = specialist.crm_data.get("calendar_id")
        if not calendar_id:
            print(f"Specialist {specialist.id} has no calendar_id")
            return
        print(f"Specialist: {specialist.id} calendar_id={calendar_id}")

        # Find sessions with empty google_event_id, created during the stale-bundle window
        sessions = session.exec(
            select(TherapySession).where(
                TherapySession.client_id == str(alena.id),
                TherapySession.google_event_id.is_(None),
            ).order_by(TherapySession.date)
        ).all()
        print(f"Found {len(sessions)} sessions without GCal event")

        fixed = 0
        for ts in sessions:
            try:
                gcal_id = create_calendar_event(
                    calendar_id=calendar_id,
                    client_name=alena.name,
                    alias_code=alena.alias_code,
                    session_date=ts.date,
                    duration_minutes=ts.duration_minutes or 60,
                    notes=ts.notes,
                )
                ts.google_event_id = gcal_id
                session.add(ts)
                print(f"  ✓ {ts.date} → {gcal_id}")
                fixed += 1
            except Exception as e:
                print(f"  ✗ {ts.date} failed: {e}")

        if fixed:
            session.commit()
            print(f"\nCommitted {fixed} updates")


if __name__ == "__main__":
    main()
