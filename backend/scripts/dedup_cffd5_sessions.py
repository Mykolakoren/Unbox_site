"""Find and remove same-day duplicate sessions for client cffd5c45.

Client confirms they have ONE session per week. The earlier restore step
brought 5 cancelled rows back as COMPLETED, but if duplicates already
existed for those same Tuesdays (e.g. recurring-booking duplicates from
previous syncs), the client page now shows two rows for the same day.

Dedup rule:
  * Group sessions by date (UTC date component, since CRM stores naive
    UTC) — one group per day.
  * Within a group, prefer the row that:
      1) is currently COMPLETED over PLANNED over CANCELLED_*
      2) has a `google_event_id` (canonical link to GCal)
      3) has the more recent `updated_at` as a tiebreaker
  * Delete the other rows (NOT cancel — the client said cancellations
    are wrong; we're not adding more).

Dry-run by default. Pass --apply to commit.
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from datetime import datetime

from sqlmodel import Session, select

sys.path.insert(0, "/var/www/unbox/backend")

from app.db.session import engine  # noqa: E402
from app.models.therapy_session import TherapySession  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dedup-cffd5")

CFFD5 = "cffd5c45-ee2a-4617-8aed-e7c380f4aa9d"


def _status_rank(s: str) -> int:
    if s == "COMPLETED":
        return 0
    if s == "PLANNED":
        return 1
    return 2  # CANCELLED_*


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    with Session(engine) as s:
        rows = s.exec(
            select(TherapySession).where(TherapySession.client_id == CFFD5)
        ).all()

        by_day: dict[str, list[TherapySession]] = defaultdict(list)
        for ts in rows:
            key = ts.date.date().isoformat() if ts.date else "?"
            by_day[key].append(ts)

        to_delete: list[TherapySession] = []
        for day, items in sorted(by_day.items()):
            if len(items) < 2:
                continue
            # Rank: prefer COMPLETED, then with gcal_id, then OLDER updated_at.
            # The older row is the organic one from the active recurring rule;
            # the newer one is from the dead rule that I just restored.
            # Keeping the organic row preserves the live GCal link.
            items_sorted = sorted(
                items,
                key=lambda x: (
                    _status_rank(x.status or ""),
                    0 if x.google_event_id else 1,
                    x.updated_at.timestamp() if x.updated_at else 0,
                ),
            )
            keep = items_sorted[0]
            losers = items_sorted[1:]
            log.info("--- %s : %d sessions ---", day, len(items))
            log.info("  KEEP  %s  status=%s  gcal=%s  upd=%s",
                     keep.id, keep.status, keep.google_event_id, keep.updated_at)
            for x in losers:
                log.info("  DROP  %s  status=%s  gcal=%s  upd=%s",
                         x.id, x.status, x.google_event_id, x.updated_at)
                to_delete.append(x)

        log.info("=" * 60)
        log.info("Total duplicates to delete: %d", len(to_delete))

        if args.apply and to_delete:
            # Re-parent any FK references (payments, notes) from the
            # to-be-deleted rows onto their kept sibling. This preserves
            # financial / clinical history while collapsing duplicates.
            from app.models.therapist_payment import TherapistPayment
            from app.models.therapist_note import TherapistNote

            # Build drop -> keep id mapping per day.
            drop_to_keep: dict[str, str] = {}
            for day, items in by_day.items():
                if len(items) < 2:
                    continue
                items_sorted = sorted(
                    items,
                    key=lambda x: (
                        _status_rank(x.status or ""),
                        0 if x.google_event_id else 1,
                        x.updated_at.timestamp() if x.updated_at else 0,
                    ),
                )
                keep_id = items_sorted[0].id
                for x in items_sorted[1:]:
                    drop_to_keep[x.id] = keep_id

            re_pay = 0
            re_note = 0
            for drop_id, keep_id in drop_to_keep.items():
                pays = s.exec(
                    select(TherapistPayment).where(TherapistPayment.session_id == drop_id)
                ).all()
                for p in pays:
                    p.session_id = keep_id
                    s.add(p)
                    re_pay += 1
                notes = s.exec(
                    select(TherapistNote).where(TherapistNote.session_id == drop_id)
                ).all()
                for n in notes:
                    n.session_id = keep_id
                    s.add(n)
                    re_note += 1
            log.info("Re-parented: %d payments, %d notes", re_pay, re_note)

            for ts in to_delete:
                s.delete(ts)
            s.commit()
            log.info("Committed %d deletions.", len(to_delete))
        elif not args.apply:
            log.info("DRY-RUN — pass --apply to commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
