"""Read-only investigation script for two issues:

  1. Find the "УБОРКА ЛЕЛА" user record (so we can convert her bookings
     to service holds rather than charging peak surcharge).
  2. Inspect client cffd5c45-ee2a-4617-8aed-e7c380f4aa9d — show all their
     CRM sessions and which are marked cancelled. Compare against GCal
     event IDs that the sync layer remembers, so we can spot stale
     auto-cancels that the client didn't actually request.

Pure read-only — no writes, no commits.

Run:
    cd /var/www/unbox/backend
    ./venv/bin/python3.12 -m scripts.investigate_lela_and_cffd5
"""
from __future__ import annotations

import sys

from sqlmodel import Session, select

sys.path.insert(0, "/var/www/unbox/backend")

from app.db.session import engine  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.models.user import User  # noqa: E402

CFFD5 = "cffd5c45-ee2a-4617-8aed-e7c380f4aa9d"


def main() -> int:
    with Session(engine) as s:
        print("=" * 80)
        print("1) УБОРКА ЛЕЛА user lookup")
        print("=" * 80)
        users = s.exec(select(User)).all()
        for u in users:
            name = (u.name or "").lower()
            if "убор" in name or "лел" in name or "clean" in (u.email or "").lower():
                print(f"  id={u.id}")
                print(f"  name={u.name!r}  email={u.email!r}  role={u.role}")
                print(f"  balance={u.balance}  is_admin={getattr(u, 'isAdmin', None)}")
                bookings = s.exec(
                    select(Booking).where(Booking.user_uuid == u.id)
                ).all()
                future = [b for b in bookings if b.date and b.date.isoformat() >= "2026-05-14"]
                print(f"  bookings total={len(bookings)}, future={len(future)}")
                if future[:3]:
                    print(f"  sample future:")
                    for b in future[:3]:
                        print(f"    {b.date.date() if b.date else '?'} {b.start_time} {b.resource_id} "
                              f"price={b.final_price} status={b.status} pay={b.payment_status} method={b.payment_method}")

        print()
        print("=" * 80)
        print(f"2) CRM client {CFFD5}")
        print("=" * 80)

        from app.models.therapist_client import TherapistClient  # noqa: E402
        from app.models.therapy_session import TherapySession  # noqa: E402

        client = s.get(TherapistClient, CFFD5)
        if not client:
            print(f"  Client {CFFD5} NOT FOUND")
            return 0

        name = getattr(client, "name", None) or getattr(client, "full_name", None) or "?"
        spec_id = getattr(client, "specialist_id", None) or getattr(client, "therapist_id", None)
        print(f"  name={name!r}  specialist={spec_id}")

        sessions = s.exec(
            select(TherapySession).where(TherapySession.client_id == CFFD5)  # type: ignore
        ).all()
        print(f"  total sessions: {len(sessions)}")

        by_status: dict[str, int] = {}
        for ses in sessions:
            st = getattr(ses, "status", "?")
            by_status[st] = by_status.get(st, 0) + 1
        print(f"  by status: {by_status}")

        cancelled_client = [
            ses for ses in sessions
            if getattr(ses, "status", "") in (
                "CANCELLED_CLIENT", "cancelled_client", "cancelled_by_client",
            )
        ]
        print(f"\n  CANCELLED_CLIENT sessions: {len(cancelled_client)}")
        for ses in cancelled_client[:50]:
            sid = getattr(ses, "id", "?")
            d = getattr(ses, "date", None) or getattr(ses, "scheduledAt", None)
            t = getattr(ses, "start_time", None) or getattr(ses, "time", None)
            gcal_id = getattr(ses, "gcal_event_id", None) or getattr(ses, "gcalEventId", None)
            updated = getattr(ses, "updated_at", None) or getattr(ses, "updatedAt", None)
            print(f"    id={sid}  date={d}  time={t}  gcal={gcal_id}  updated={updated}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
