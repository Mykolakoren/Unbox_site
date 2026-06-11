"""One-shot: delete all CANCELLED_CLIENT / CANCELLED_THERAPIST sessions.

2026-05-14 spec change: CRM no longer uses CANCELLED_* status. The admin's
mental model is "если я отменяю в календаре, нужно чтобы она вообще
удалялась". This script removes all legacy cancelled rows so the new
sync path (which always deletes on cancel) doesn't have to coexist with
old data.

Payments and notes that referenced the deleted sessions get their
session_id nulled — financial / clinical records stay, just decoupled.

Dry-run by default. Pass --apply to commit.
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict

from sqlmodel import Session, select

sys.path.insert(0, "/var/www/unbox/backend")

from app.db.session import engine  # noqa: E402
from app.models.therapy_session import TherapySession  # noqa: E402
from app.models.therapist_client import TherapistClient  # noqa: E402
from app.models.therapist_payment import TherapistPayment  # noqa: E402
from app.models.therapist_note import TherapistNote  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("purge-cancelled")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    with Session(engine) as s:
        cancelled = s.exec(
            select(TherapySession).where(
                TherapySession.status.in_(("CANCELLED_CLIENT", "CANCELLED_THERAPIST"))  # type: ignore
            )
        ).all()
        log.info("Cancelled sessions found: %d", len(cancelled))

        by_client: dict[str, int] = defaultdict(int)
        for ts in cancelled:
            by_client[ts.client_id] += 1

        clients = {c.id: c.name for c in s.exec(select(TherapistClient)).all()}
        for cid, n in sorted(by_client.items(), key=lambda kv: -kv[1])[:30]:
            log.info("  %-30s  %3d sessions", clients.get(cid, "?"), n)
        if len(by_client) > 30:
            log.info("  ...and %d more clients", len(by_client) - 30)

        if not args.apply:
            log.info("DRY-RUN — pass --apply to commit")
            return 0

        re_pay = 0
        re_note = 0
        for ts in cancelled:
            for p in s.exec(
                select(TherapistPayment).where(TherapistPayment.session_id == ts.id)
            ).all():
                p.session_id = None
                s.add(p)
                re_pay += 1
            for n in s.exec(
                select(TherapistNote).where(TherapistNote.session_id == ts.id)
            ).all():
                n.session_id = None
                s.add(n)
                re_note += 1
            s.delete(ts)
        s.commit()
        log.info(
            "Deleted %d sessions; nulled session_id on %d payments + %d notes",
            len(cancelled), re_pay, re_note,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
