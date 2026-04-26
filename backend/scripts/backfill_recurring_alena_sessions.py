"""One-shot backfill for recurring cabinet bookings (group b4bf3982-...) that
were created BEFORE the auto-create-session fix landed. Each booking gets a
matching TherapySession (booked=true, linked via booking_id) plus a CRM
Google Calendar event so the chessboard renders the client name and the
specialist can quick-pay/edit from CRM views."""
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.models.booking import Booking
from app.services.crm_calendar import create_calendar_event


GROUP_ID = "b4bf3982-c712-4e07-8bcc-ab17f0ae479f"


def main() -> None:
    crm_session_group_id = str(uuid4())
    print(f"Will tag every spawned session with recurring_group_id={crm_session_group_id}")

    with Session(engine) as session:
        bookings = session.exec(
            select(Booking).where(Booking.recurring_group_id == GROUP_ID).order_by(Booking.date)
        ).all()
        print(f"Found {len(bookings)} bookings in series")
        if not bookings:
            return

        client_id = bookings[0].crm_client_id
        if not client_id:
            print("No crm_client_id on these bookings — nothing to do")
            return
        client = session.get(TherapistClient, client_id)
        if not client:
            print(f"Client {client_id} not found")
            return
        print(f"Client: {client.name!r} (alias={client.alias_code})")

        specialist = session.get(User, client.specialist_id)
        calendar_id = None
        if specialist and isinstance(specialist.crm_data, dict):
            calendar_id = specialist.crm_data.get("calendar_id")
        print(f"CRM calendar: {calendar_id!r}")

        created = 0
        skipped = 0
        for b in bookings:
            # Skip if a TherapySession already references this booking
            existing = session.exec(
                select(TherapySession).where(TherapySession.booking_id == str(b.id))
            ).first()
            if existing:
                skipped += 1
                continue

            try:
                h, m = map(int, b.start_time.split(":"))
                session_date = b.date.replace(hour=h, minute=m, second=0, microsecond=0)
            except Exception:
                session_date = b.date

            ts = TherapySession(
                client_id=str(client.id),
                specialist_id=str(client.specialist_id),
                date=session_date,
                duration_minutes=b.duration,
                status="PLANNED",
                price=client.base_price,
                currency=client.currency,
                account=client.default_account,
                is_booked=True,
                booking_id=str(b.id),
                recurring_group_id=crm_session_group_id,
            )
            if calendar_id:
                try:
                    ts.google_event_id = create_calendar_event(
                        calendar_id=calendar_id,
                        client_name=client.name,
                        alias_code=client.alias_code,
                        session_date=session_date,
                        duration_minutes=b.duration,
                    )
                except Exception as e:
                    print(f"  ! GCal push failed for {b.date}: {e}")
            session.add(ts)
            print(f"  + {session_date} → session created (gcal={ts.google_event_id or '—'})")
            created += 1

        session.commit()
        print(f"\nCreated {created} sessions, skipped {skipped} already-linked")


if __name__ == "__main__":
    main()
