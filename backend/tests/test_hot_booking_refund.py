"""E2E guard for the phantom refund on hot (pending_approval) bookings.

A booking made inside the approval window (12h on weekdays, 24h on weekends)
by a non-admin is charged and then immediately un-charged: the money goes back
and the row parks in `pending_approval` until an admin approves it. The row used
to keep `payment_status="paid"` + `charge_amount` from the charge that was
rolled back, so cancelling it refunded money nobody ever paid:

    booking 20₾ → balance 100₾ (charge reverted) → admin cancels → balance 120₾

Runs against a throwaway SQLite DB, no network:

    python3 backend/tests/test_hot_booking_refund.py
"""

import os
import sys
import tempfile
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_TMP_DB = os.path.join(tempfile.mkdtemp(), "hot_booking_test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DB}"

from fastapi import Depends  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.api import deps  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.resource import Resource  # noqa: E402
from app.models.user import User  # noqa: E402

_ACTOR: dict = {}


def _fake_current_user(session: Session = Depends(deps.get_session)):
    # Must come from the request's own session, or the endpoint hits
    # "Object is already attached to session" when it re-adds the user.
    return session.get(User, _ACTOR["id"])


def test_cancelling_a_hot_booking_refunds_nothing():
    with TestClient(app) as client:  # the context manager runs the lifespan (init_db)
        with Session(engine) as session:
            resource = session.exec(select(Resource)).first()
            booker = User(
                email="hot@test.local", name="Booker", role="specialist",
                balance=100.0, hashed_password="x",
            )
            admin = User(
                email="admin@test.local", name="Admin", role="senior_admin",
                balance=0.0, hashed_password="x",
            )
            session.add(booker)
            session.add(admin)
            session.commit()
            session.refresh(booker)
            session.refresh(admin)
            booker_id, admin_id = booker.id, admin.id
            resource_id, location_id = resource.id, resource.location_id

        app.dependency_overrides[deps.get_current_user] = _fake_current_user

        def balance() -> float:
            with Session(engine) as session:
                return session.get(User, booker_id).balance

        # The booker creates a booking 3h out — inside the 12h approval window.
        _ACTOR["id"] = booker_id
        start = datetime.now() + timedelta(hours=3)
        response = client.post("/api/v1/bookings/", json={
            "resource_id": resource_id,
            "location_id": location_id,
            "date": start.strftime("%Y-%m-%dT00:00:00"),
            "start_time": start.strftime("%H:00"),
            "duration": 60,
            "payment_method": "balance",
            "format": "individual",
        })
        assert response.status_code == 200, response.text
        booking = response.json()

        assert booking["status"] == "pending_approval"
        # The charge was rolled back, so the row must not claim it was paid.
        assert booking["payment_status"] == "pending"
        assert booking["charge_amount"] is None
        assert balance() == 100.0

        # An admin rejects it. Nothing was ever charged → nothing to refund.
        _ACTOR["id"] = admin_id
        response = client.delete(f"/api/v1/bookings/{booking['id']}?reason=не одобрено")
        assert response.status_code == 200, response.text
        assert balance() == 100.0, "phantom refund: money appeared out of thin air"

        app.dependency_overrides.clear()


if __name__ == "__main__":
    try:
        test_cancelling_a_hot_booking_refunds_nothing()
        print("  ✓ test_cancelling_a_hot_booking_refunds_nothing")
        print("OK")
    except AssertionError as exc:
        print(f"  ✗ {exc}")
        sys.exit(1)
