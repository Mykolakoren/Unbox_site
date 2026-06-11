"""One-shot: expire all past `active` waitlist entries across all users.

The runtime path (`GET /waitlist/my`) now auto-expires past entries
lazily per-user, but for a clean baseline we sweep everyone once.

Run:
    cd /var/www/unbox/backend
    ./venv/bin/python3.12 -m scripts.expire_past_waitlist          # dry
    ./venv/bin/python3.12 -m scripts.expire_past_waitlist --apply
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta

from sqlmodel import Session, select

sys.path.insert(0, "/var/www/unbox/backend")

from app.db.session import engine  # noqa: E402
from app.models.waitlist import Waitlist  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("expire-wl")

_TBS = timedelta(hours=4)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    tb_now = datetime.utcnow() + _TBS
    tb_today_start = tb_now.replace(hour=0, minute=0, second=0, microsecond=0)
    utc_today_start = tb_today_start - _TBS
    log.info("Cutoff: anything with date < %s UTC (Tbilisi today start)", utc_today_start)

    with Session(engine) as s:
        past = s.exec(
            select(Waitlist)
            .where(Waitlist.status == "active")
            .where(Waitlist.date < utc_today_start)
        ).all()
        log.info("Found %d past 'active' entries to expire", len(past))
        for w in past:
            log.info("  %s  resource=%s  date=%s  %s-%s  user=%s",
                     w.id, w.resource_id, w.date, w.start_time, w.end_time, w.user_id)
            if args.apply:
                w.status = "cancelled"
                w.updated_at = datetime.now()
                s.add(w)
        if args.apply:
            s.commit()
            log.info("Committed %d expirations.", len(past))
        else:
            log.info("DRY-RUN — pass --apply to commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
