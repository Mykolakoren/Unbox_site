"""Wipe both of Alena's recurring attempts so the specialist can recreate
the series cleanly. Removes:

  • TherapySession group 45aaf325  (chessboard "Повторение" without cabinet)
  • TherapySession group 3a83cd49  (auto-backfilled mirror of cabinet series)
  • Booking series b4bf3982         (cabinet recurring with crm_client_id)

Also cleans up every Google Calendar event we created — both the per-session
events on the specialist's personal CRM calendar and the cabinet calendar
events on Unbox calendars.

Leaves untouched:
  • The 8 "14:00 UTC = 18:00 Tbilisi" rows that came from the original
    GCal recurring rule sync — those represent the source-of-truth events
    in Alena's existing Google Calendar series.
  • The single confirmed booking ba411ea1 on 2026-04-24 (a real past
    session, not part of either failed attempt).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.models.therapist_payment import TherapistPayment
from app.models.booking import Booking
from app.services.crm_calendar import delete_calendar_event as crm_delete_event


CRM_GROUPS_TO_KILL = [
    "45aaf325-3434-4d17-8b21-3bc691fc631f",  # chessboard "Повторение" without cabinet
    "3a83cd49-8f39-42a9-a157-281c02286aaf",  # auto-backfill mirror
]
BOOKING_GROUP_TO_KILL = "b4bf3982-c712-4e07-8bcc-ab17f0ae479f"


def main() -> None:
    with Session(engine) as session:
        # Resolve specialist + their CRM calendar id once.
        client = session.exec(
            select(TherapistClient).where(TherapistClient.name == "Алена грум")
        ).first()
        if not client:
            print("Алена грум not found")
            return
        specialist = session.get(User, client.specialist_id)
        crm_calendar_id = (
            specialist.crm_data.get("calendar_id")
            if specialist and isinstance(specialist.crm_data, dict)
            else None
        )

        # ── 1. Kill the two CRM TherapySession series ────────────────────
        crm_killed = 0
        crm_gcal_killed = 0
        for group_id in CRM_GROUPS_TO_KILL:
            sessions = session.exec(
                select(TherapySession).where(TherapySession.recurring_group_id == group_id)
            ).all()
            print(f"\nGroup {group_id}: {len(sessions)} sessions")
            for ts in sessions:
                # Drop the GCal event off the specialist's personal calendar
                if ts.google_event_id and crm_calendar_id:
                    try:
                        crm_delete_event(crm_calendar_id, ts.google_event_id)
                        crm_gcal_killed += 1
                    except Exception as e:
                        print(f"  ! GCal delete {ts.google_event_id}: {e}")

                # Detach related payments first (FK)
                payments = session.exec(
                    select(TherapistPayment).where(TherapistPayment.session_id == ts.id)
                ).all()
                for p in payments:
                    session.delete(p)
                session.delete(ts)
                crm_killed += 1
                print(f"  - {ts.date} (gcal={ts.google_event_id or '—'})")

        # ── 2. Cancel + soft-clean the cabinet booking series ────────────
        bookings = session.exec(
            select(Booking).where(Booking.recurring_group_id == BOOKING_GROUP_TO_KILL)
        ).all()
        print(f"\nBooking series {BOOKING_GROUP_TO_KILL}: {len(bookings)} bookings")
        cabinet_gcal_killed = 0
        booking_killed = 0
        for b in bookings:
            # Cabinet GCal cleanup. Each cabinet has its own calendar; the
            # service maps resource_id → calendar internally, so we just
            # hand it the booking's gcal_event_id + resource_id.
            if b.gcal_event_id:
                try:
                    from app.services.google_calendar import gcal_service
                    gcal_service.delete_event(b.gcal_event_id, b.resource_id)
                    cabinet_gcal_killed += 1
                except Exception as e:
                    print(f"  ! Cabinet GCal delete {b.gcal_event_id}: {e}")

            # Refund balance (mirror cancel_booking semantics)
            if b.status == "confirmed" and b.user_uuid:
                owner = session.get(User, b.user_uuid)
                if owner and b.payment_method != "subscription":
                    owner.balance = round((owner.balance or 0) + b.final_price, 2)
                    session.add(owner)

            # Hard delete the booking row (we want it GONE so the series can
            # be recreated cleanly without "ghost" cancelled rows blocking
            # availability checks or polluting reports).
            session.delete(b)
            booking_killed += 1
            print(f"  - {b.date} {b.start_time} ({b.status})")

        session.commit()

        print("\n=== summary ===")
        print(f"CRM sessions deleted:     {crm_killed}")
        print(f"CRM GCal events deleted:  {crm_gcal_killed}")
        print(f"Cabinet bookings deleted: {booking_killed}")
        print(f"Cabinet GCal deleted:     {cabinet_gcal_killed}")


if __name__ == "__main__":
    main()
