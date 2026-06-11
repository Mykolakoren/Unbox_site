"""Restore wrongly-cancelled CRM sessions for client cffd5c45.

Анастасия Черепанова (client cffd5c45-ee2a-4617-8aed-e7c380f4aa9d) has 5
sessions that were batch-cancelled at 2026-04-16 19:16:36 — the dates,
specialist, and exact ms-spaced timestamps say "automation", but the
client confirms they did NOT cancel. The sessions have google_event_id=
NULL so they don't tie to GCal events either way — restoring them to
PLANNED is safe; if they really shouldn't exist, the next sync run will
not touch them (no GCal id, no cancel signal).

Dry-run by default. Pass --apply to commit.

Run:
    cd /var/www/unbox/backend
    ./venv/bin/python3.12 -m scripts.restore_cffd5_sessions          # dry
    ./venv/bin/python3.12 -m scripts.restore_cffd5_sessions --apply
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

from sqlmodel import Session, select

sys.path.insert(0, "/var/www/unbox/backend")

from app.db.session import engine  # noqa: E402
from app.models.therapy_session import TherapySession  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("restore-cffd5")

CFFD5 = "cffd5c45-ee2a-4617-8aed-e7c380f4aa9d"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    with Session(engine) as s:
        cancelled = s.exec(
            select(TherapySession).where(
                TherapySession.client_id == CFFD5,
                TherapySession.status == "CANCELLED_CLIENT",
            )
        ).all()
        log.info("Found %d CANCELLED_CLIENT sessions for cffd5c45", len(cancelled))

        for ts in cancelled:
            past = ts.date < datetime.utcnow()
            new_status = "COMPLETED" if past else "PLANNED"
            log.info(
                "  %s  date=%s  gcal=%s  → %s%s",
                ts.id, ts.date, ts.google_event_id, new_status,
                "  (past)" if past else "",
            )
            if args.apply:
                ts.status = new_status
                ts.updated_at = datetime.now()
                s.add(ts)

        if args.apply:
            s.commit()
            log.info("Committed %d restorations.", len(cancelled))
        else:
            log.info("DRY-RUN — pass --apply to commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
