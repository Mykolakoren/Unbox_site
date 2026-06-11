"""Find and remove same-day duplicate CRM sessions across ALL clients.

Same logic as dedup_cffd5_sessions but iterates every (specialist, client)
pair. Triggered by Константин (and earlier Анастасия) showing duplicate
rows on the same day — recurring-rule churn in Google Calendar leaves
two TherapySession rows pointing at one real meeting.

Dedup rule per (client, specialist, date):
  * Keep order: COMPLETED > PLANNED > CANCELLED_*
  * Prefer rows with `google_event_id` set
  * Tiebreak: OLDER updated_at wins (organic row from active rule;
    newer one is usually a stale restoration or recreated event)
  * Re-parent therapist_payments + therapist_notes onto the kept row
    BEFORE deleting the losers (FK preservation)

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
log = logging.getLogger("dedup-all")


def _status_rank(s: str) -> int:
    if s == "COMPLETED":
        return 0
    if s == "PLANNED":
        return 1
    return 2  # CANCELLED_*


def _is_recurring_instance_gcal(gid: str | None) -> bool:
    """Recurring instance IDs look like `base_20250618T140000Z` — the
    trailing _YYYYMMDDTHHMMSSZ marks them as a generated instance of a
    recurring rule, which is the canonical event we want to preserve."""
    if not gid:
        return False
    if "_" not in gid:
        return False
    tail = gid.rsplit("_", 1)[-1]
    # YYYYMMDDTHHMMSSZ is exactly 16 chars
    return len(tail) == 16 and tail[8] == "T" and tail[-1] == "Z"


def _sort_key(x: TherapySession) -> tuple:
    return (
        _status_rank(x.status or ""),
        0 if x.google_event_id else 1,
        0 if _is_recurring_instance_gcal(x.google_event_id) else 1,
        x.updated_at.timestamp() if x.updated_at else 0,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--whole-day", action="store_true", default=True,
        help="(default) Collapse to ONE row per (client, specialist, day). "
             "Users confirmed 'раз в неделю сессия' — multiple rows in one "
             "day are duplicates regardless of time-of-day gap.",
    )
    args = parser.parse_args()

    with Session(engine) as s:
        rows = s.exec(select(TherapySession)).all()
        log.info("Total sessions: %d", len(rows))

        # Group by (client, specialist, date)
        by_key: dict[tuple, list[TherapySession]] = defaultdict(list)
        for ts in rows:
            if not ts.date:
                continue
            day = ts.date.date().isoformat()
            by_key[(ts.client_id, ts.specialist_id, day)].append(ts)

        # Lookup names for nicer output
        clients = {c.id: c.name for c in s.exec(select(TherapistClient)).all()}

        all_drops: list[tuple[str, str]] = []  # (drop_id, keep_id)
        affected_clients: dict[str, int] = defaultdict(int)

        for (client_id, spec_id, day), items in sorted(by_key.items()):
            if len(items) < 2:
                continue
            cluster_sorted = sorted(items, key=_sort_key)
            keep = cluster_sorted[0]
            losers = cluster_sorted[1:]
            cname = clients.get(client_id, "?")
            log.info(
                "%s  spec=%s  client=%s (%s)  %d duplicates",
                day, spec_id[:8], (client_id or "")[:8], cname, len(items),
            )
            log.info(
                "  KEEP  %s  %s  status=%s  gcal=%s",
                keep.id, keep.date.strftime("%H:%M"), keep.status,
                (keep.google_event_id or "")[:60],
            )
            for x in losers:
                log.info(
                    "  DROP  %s  %s  status=%s  gcal=%s",
                    x.id, x.date.strftime("%H:%M"), x.status,
                    (x.google_event_id or "")[:60],
                )
                all_drops.append((x.id, keep.id))
                affected_clients[client_id] += 1

        log.info("=" * 70)
        log.info("Duplicates found: %d (across %d clients)",
                 len(all_drops), len(affected_clients))
        if affected_clients:
            top = sorted(affected_clients.items(), key=lambda kv: -kv[1])[:10]
            for cid, n in top:
                log.info("  %s (%s): %d duplicates", clients.get(cid, "?"), (cid or "")[:8], n)

        if not args.apply:
            log.info("DRY-RUN — pass --apply to commit")
            return 0
        if not all_drops:
            return 0

        # Re-parent FKs on losing rows.
        re_pay = 0
        re_note = 0
        for drop_id, keep_id in all_drops:
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
        log.info("Re-parented %d payments, %d notes", re_pay, re_note)

        # Delete losers.
        drop_ids = {d for d, _ in all_drops}
        deleted = 0
        for drop_id in drop_ids:
            ts = s.get(TherapySession, drop_id)
            if ts is not None:
                s.delete(ts)
                deleted += 1
        s.commit()
        log.info("Committed %d deletions across %d affected clients.",
                 deleted, len(affected_clients))
    return 0


if __name__ == "__main__":
    sys.exit(main())
