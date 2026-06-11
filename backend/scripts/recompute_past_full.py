"""Past-window recompute: both underpayments AND refunds.

Safer than v4 because it filters out two risky drift sources:
  * Old applied_rule was SUBSCRIPTION → don't change (rare; sub money flow)
  * Personal discount appeared retroactively that wasn't there before —
    only applied if user.pricing_system=personal AND that was already true

Otherwise: replays calculate_price with current rules + aggregation, adjusts
balance for paid rows by delta.

Default window: 14 days back. --apply commits.
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
log = logging.getLogger("past-full")

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
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--days-back", type=int, default=14)
    parser.add_argument(
        "--user-email",
        type=str,
        default=None,
        help="Restrict to a single user by email (case-insensitive). "
             "Use this for case-by-case past-window recomputes (e.g. "
             "Гривцов, after a clarifying chat).",
    )
    parser.add_argument(
        "--min-days-back",
        type=int,
        default=0,
        help="Floor for the window — start AT LEAST this many days ago. "
             "Use with --days-back to target >30d past: "
             "--days-back 365 --min-days-back 30",
    )
    args = parser.parse_args()

    log.info("Mode: %s (window: %d–%d days back, BOTH directions)",
             "APPLY" if args.apply else "DRY-RUN",
             args.min_days_back, args.days_back)
    now_tb = datetime.utcnow() + _TBS
    window_start = now_tb - timedelta(days=args.days_back)
    window_end = now_tb - timedelta(days=args.min_days_back)

    with Session(engine) as session:
        rows: List[Booking] = session.exec(
            select(Booking).where(Booking.status == "confirmed")
        ).all()

        target_user_id = None
        if args.user_email:
            user = session.exec(
                select(User).where(User.email.ilike(args.user_email))  # type: ignore
            ).first()
            if not user:
                log.error("User with email %r not found", args.user_email)
                return 1
            target_user_id = user.id
            log.info("Restricting to user_id=%s (%s)", user.id, user.email)

        pricing = PricingService(session)
        targets: list[tuple[Booking, User, float, float, str, str]] = []
        skipped = defaultdict(int)

        for b in rows:
            start = _start_tb(b)
            if start is None or start > window_end:
                # Either future, or within the "exclusion floor" (e.g. last
                # 30d when caller wants ONLY older drift).
                skipped["future-or-recent"] += 1
                continue
            if start < window_start:
                skipped["too-old"] += 1
                continue
            if target_user_id is not None and b.user_uuid != target_user_id:
                skipped["other-user"] += 1
                continue
            method = (b.payment_method or "").lower()
            if method in ("subscription", "bonus", "service"):
                skipped[method] += 1
                continue
            if not b.user_uuid:
                skipped["no-owner"] += 1
                continue
            if (b.applied_rule or "") == "MANUAL_OVERRIDE":
                skipped["manual-override"] += 1
                continue
            if (b.applied_rule or "") == "SUBSCRIPTION":
                # Don't retroactively un-subscription a past booking.
                skipped["was-subscription"] += 1
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

            old_price = float(b.final_price or 0)
            new_price = round(float(quote.final_price or 0), 2)
            if abs(new_price - old_price) < 0.01:
                continue
            if old_price <= 0:
                skipped["zero-price"] += 1
                continue

            targets.append((b, owner, old_price, new_price,
                            b.applied_rule or "?", quote.applied_rule or "?"))

        by_user: dict[str, dict] = defaultdict(lambda: {
            "owner": None, "items": [], "delta": 0.0,
        })
        for b, owner, old, new, old_rule, new_rule in targets:
            uid = str(owner.id)
            by_user[uid]["owner"] = owner
            by_user[uid]["items"].append((b, old, new, old_rule, new_rule))
            by_user[uid]["delta"] += round(new - old, 2)

        log.info("=" * 70)
        log.info("Cases: %d bookings across %d users",
                 len(targets), len(by_user))
        log.info("  Skipped: %s", dict(skipped))
        total = round(sum(u["delta"] for u in by_user.values()), 2)
        log.info("  Net delta: %+.2f ₾  (positive = charge, negative = refund)", total)

        for u in sorted(by_user.values(), key=lambda x: -abs(x["delta"])):
            owner = u["owner"]
            name = owner.name or owner.email
            sign = "+" if u["delta"] > 0 else ""
            print(f"\n### {name}  ({sign}{u['delta']:.2f}₾)")
            for b, old, new, old_rule, new_rule in u["items"]:
                d = b.date.date() if b.date else "?"
                print(f"  {d} {b.start_time} {b.resource_id} ({(b.duration or 0)/60:.1f}ч): "
                      f"{old:.2f} → {new:.2f}₾  ({old_rule} → {new_rule})")

        if not args.apply:
            print("\nDRY-RUN — pass --apply to commit")
            return 0

        adjusted = 0
        for b, owner, old, new, _or, _nr in targets:
            start = _start_tb(b)
            quote = pricing.calculate_price(
                user=owner, resource_id=b.resource_id,
                start_time=start, duration_minutes=b.duration or 60,
                format_type=b.format or "individual",
                exclude_booking_id=str(b.id),
            )
            b.final_price = new
            b.applied_rule = quote.applied_rule or "NONE"
            b.discount_percent = int(round(quote.discount_percent or 0))
            b.discount_amount = float(quote.discount_amount or 0)
            b.base_price = float(quote.base_price or new)
            b.charge_amount = new
            delta = round(new - old, 2)
            owner.balance = round((owner.balance or 0) - delta, 2)
            session.add(owner)
            session.add(b)
            adjusted += 1
        session.commit()
        log.info("APPLIED: %d corrections, %d balances adjusted",
                 len(targets), adjusted)
    return 0


if __name__ == "__main__":
    sys.exit(main())
