"""Audit refund-only past cases (skipped during v4 / past-full runs).

Background (2026-05-21..23):
  During the v4 + past-full recompute waves, ~26 past bookings were
  *intentionally skipped* because applying current rules would have
  produced a refund-only delta (new_price < old_price). The owner asked
  not to surprise users with one-off "оп, держи назад X ₾" credits.

This audit script does NOT change anything. It:
  1. Replays calculate_price on every PAST confirmed booking (or a
     restricted window).
  2. Lists rows where the recomputed price is LOWER than the stored
     final_price (= a refund would apply).
  3. Groups by user, shows total refund amount per person + per-booking
     detail.

Output is plain text → easy to copy to the owner for case-by-case
confirmation. Once approved, run recompute_past_full.py --user-email
<email> --apply on the chosen subset.

Run:
  cd /var/www/unbox/backend
  .venv/bin/python scripts/review_refund_only_cases.py
  .venv/bin/python scripts/review_refund_only_cases.py --days-back 60
  .venv/bin/python scripts/review_refund_only_cases.py > /tmp/refunds.md
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from typing import List

from sqlmodel import Session, select

sys.path.insert(0, "/var/www/unbox/backend")

from app.db.session import engine  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.pricing import PricingService  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("refund-audit")

_TBS = timedelta(hours=4)


def _start_tb(b: Booking) -> datetime | None:
    if not b.date or not b.start_time:
        return None
    try:
        h, m = b.start_time.split(":")
        return b.date.replace(hour=int(h), minute=int(m), second=0, microsecond=0)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days-back", type=int, default=90,
                        help="How far back to look. Default 90.")
    parser.add_argument("--min-delta", type=float, default=1.0,
                        help="Skip refunds smaller than this (₾). Default 1.")
    args = parser.parse_args()

    now_tb = datetime.utcnow() + _TBS
    window_start = now_tb - timedelta(days=args.days_back)

    with Session(engine) as session:
        rows: List[Booking] = session.exec(
            select(Booking).where(Booking.status == "confirmed")
        ).all()

        pricing = PricingService(session)
        # user_id → list[(b, old, new, delta)]
        by_user: dict = defaultdict(list)
        skipped = defaultdict(int)

        for b in rows:
            start = _start_tb(b)
            if start is None or start > now_tb or start < window_start:
                skipped["out-of-window"] += 1
                continue
            method = (b.payment_method or "").lower()
            if method in ("subscription", "bonus", "service"):
                skipped[method] += 1
                continue
            if (b.applied_rule or "") in ("MANUAL_OVERRIDE", "SUBSCRIPTION"):
                skipped["manual-or-sub"] += 1
                continue
            if not b.user_uuid:
                skipped["no-owner"] += 1
                continue
            owner = session.get(User, b.user_uuid)
            if not owner:
                skipped["no-owner"] += 1
                continue

            try:
                quote = pricing.calculate_price(
                    user=owner, resource_id=b.resource_id,
                    start_time=start, duration_minutes=b.duration or 60,
                    format_type=b.format or "individual",
                    exclude_booking_id=str(b.id),
                )
            except Exception:
                skipped["pricing-error"] += 1
                continue

            old = float(b.final_price or 0)
            new = round(float(quote.final_price or 0), 2)
            delta = new - old
            if delta < -args.min_delta:
                by_user[owner.id].append((b, owner, old, new, delta))

        print(f"# Refund-only candidates ({args.days_back}d window)")
        print()
        print(f"Found **{sum(len(v) for v in by_user.values())}** bookings "
              f"across **{len(by_user)}** users where current pricing would "
              f"produce a refund.")
        print()
        sorted_users = sorted(
            by_user.values(),
            key=lambda items: sum(d for _, _, _, _, d in items),
        )
        for items in sorted_users:
            owner = items[0][1]
            total = sum(d for _, _, _, _, d in items)
            print(f"## {owner.name or owner.email}  "
                  f"({owner.email or owner.id})  — total refund: {total:.2f} ₾")
            for b, _, old, new, delta in sorted(items, key=lambda r: r[0].date):
                start = _start_tb(b)
                d_str = start.strftime("%Y-%m-%d %H:%M") if start else "?"
                print(f"  - {d_str}  {b.resource_id}  "
                      f"{old:.2f} → {new:.2f}  ({delta:+.2f})  "
                      f"rule={b.applied_rule or '?'}")
            print()

        print()
        print("---")
        print(f"Skipped (out of window / wrong category): {dict(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
