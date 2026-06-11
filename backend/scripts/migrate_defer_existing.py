"""One-shot migration: flip every confirmed FUTURE booking back to `pending`
and refund the corresponding balance / subscription hours, so the new
24h-defer cron can settle it from scratch.

Run on server:

    cd /var/www/unbox/backend
    sudo -u www-data .venv/bin/python -m scripts.migrate_defer_existing --dry-run
    sudo -u www-data .venv/bin/python -m scripts.migrate_defer_existing --apply

Future is defined as start_dt (Tbilisi) > now (Tbilisi). Past/today-already-
started bookings stay `paid` — refunding them would be backdated finance.

Idempotent: rows already `pending`/`waived`/`cancelled` are skipped, so
re-running the script doesn't double-refund.
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta
from typing import List, Tuple

from sqlmodel import Session, select

# Bootstrap path so the script can import `app.*` when invoked as
# `python -m scripts.migrate_defer_existing`.
sys.path.insert(0, "/var/www/unbox/backend")

from app.db.session import engine  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.models.user import User  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("migrate_defer")

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
    parser.add_argument("--apply", action="store_true",
                        help="Actually write changes (default: dry-run)")
    parser.add_argument("--limit", type=int, default=None,
                        help="Max bookings to process (debug)")
    args = parser.parse_args()
    apply_changes = args.apply

    log.info("Mode: %s", "APPLY (writes!)" if apply_changes else "DRY-RUN")

    now_tb = datetime.utcnow() + _TBS
    log.info("Tbilisi-now: %s", now_tb)

    with Session(engine) as session:
        # Pull every confirmed booking — filter future-ness in Python because
        # start_dt is composed from `date` + `start_time` string.
        rows: List[Booking] = session.exec(
            select(Booking).where(Booking.status == "confirmed")
        ).all()
        log.info("Loaded %d confirmed bookings", len(rows))

        # Group changes by user so each user's balance/subscription update
        # bundles cleanly in one row write per user.
        per_user_balance_credit: dict = {}      # user_id -> +amount
        per_user_subscription_hours: dict = {}  # user_id -> +hours

        targets: List[Tuple[Booking, float, float, str]] = []  # (b, refund_balance, refund_hours, method)
        skipped_pending = 0
        skipped_past = 0
        skipped_no_owner = 0

        for b in rows:
            if (b.payment_status or "").lower() in ("pending", "waived"):
                skipped_pending += 1
                continue
            start = _start_tb(b)
            if start is None:
                skipped_past += 1
                continue
            if start <= now_tb:
                skipped_past += 1
                continue
            if not b.user_uuid:
                skipped_no_owner += 1
                continue

            method = (b.payment_method or "balance").lower()
            refund_amount = 0.0
            refund_hours = 0.0
            if method == "subscription":
                refund_hours = float(b.hours_deducted or (b.duration or 0) / 60.0)
                per_user_subscription_hours[b.user_uuid] = (
                    per_user_subscription_hours.get(b.user_uuid, 0.0) + refund_hours
                )
            else:
                refund_amount = float(b.charge_amount if b.charge_amount is not None else (b.final_price or 0))
                per_user_balance_credit[b.user_uuid] = (
                    per_user_balance_credit.get(b.user_uuid, 0.0) + refund_amount
                )

            targets.append((b, refund_amount, refund_hours, method))

            if args.limit and len(targets) >= args.limit:
                break

        log.info(
            "Targets: %d future-confirmed bookings to flip → pending. "
            "Skipped: pending/waived=%d, past/no-time=%d, no-owner=%d",
            len(targets), skipped_pending, skipped_past, skipped_no_owner,
        )
        log.info(
            "Total refund: %.2f ₾ across %d users; %.2fh subscription across %d users",
            sum(per_user_balance_credit.values()), len(per_user_balance_credit),
            sum(per_user_subscription_hours.values()), len(per_user_subscription_hours),
        )

        # Sample first 10 for visibility
        for b, ra, rh, m in targets[:10]:
            log.info(
                "  · %s %s %s (%s, %s) → refund %s",
                b.id, b.date.date(), b.start_time, b.resource_id, m,
                f"{ra:.2f}₾" if m != "subscription" else f"{rh:.2f}h",
            )

        if not apply_changes:
            log.info("DRY-RUN — no DB writes. Run with --apply to commit.")
            return 0

        # ── Apply ─────────────────────────────────────────────────────────
        for b, ra, rh, m in targets:
            b.payment_status = "pending"
            b.charged_at = None
            b.charge_amount = None
            session.add(b)

        # Bulk update users
        affected_user_ids = set(per_user_balance_credit) | set(per_user_subscription_hours)
        for uid in affected_user_ids:
            user = session.get(User, uid)
            if not user:
                continue
            credit = per_user_balance_credit.get(uid, 0.0)
            hrs = per_user_subscription_hours.get(uid, 0.0)
            if credit:
                user.balance = round((user.balance or 0) + credit, 2)
            if hrs and user.subscription:
                new_sub = dict(user.subscription)
                rem = float(new_sub.get("remaining_hours") or new_sub.get("remainingHours") or 0)
                used = float(new_sub.get("used_hours") or new_sub.get("usedHours") or 0)
                new_sub["remaining_hours"] = rem + hrs
                new_sub["used_hours"] = max(0.0, used - hrs)
                if "remainingHours" in new_sub:
                    del new_sub["remainingHours"]
                if "usedHours" in new_sub:
                    del new_sub["usedHours"]
                user.subscription = new_sub
            session.add(user)

        session.commit()
        log.info(
            "APPLIED: %d bookings → pending; %d users credited (%.2f₾ + %.2fh).",
            len(targets), len(affected_user_ids),
            sum(per_user_balance_credit.values()), sum(per_user_subscription_hours.values()),
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
