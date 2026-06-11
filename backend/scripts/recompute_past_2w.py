"""Recompute prices for PAST bookings (last 14 days) that may be wrong
due to old pricing bugs (double-count weekly accumulator, peak window,
MAX-personal override). Same engine as v4 but date-window includes recent
past so already-held sessions get the price label fixed and balance
adjusted to match the corrected rule.

Mirror of v4 but with `past_window_days` filter instead of "only future".
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
log = logging.getLogger("v4-past")

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
    parser.add_argument("--report", type=str, default=None)
    args = parser.parse_args()

    log.info("Mode: %s (window: last %d days)",
             "APPLY" if args.apply else "DRY-RUN", args.days_back)

    now_tb = datetime.utcnow() + _TBS
    window_start = now_tb - timedelta(days=args.days_back)

    with Session(engine) as session:
        rows: List[Booking] = session.exec(
            select(Booking).where(
                Booking.status == "confirmed",  # only completed/held ones
            )
        ).all()
        log.info("Loaded %d confirmed bookings; filtering to last %d days...",
                 len(rows), args.days_back)

        pricing = PricingService(session)
        targets: list[tuple[Booking, User, float, float, str, str]] = []
        skipped = defaultdict(int)
        unchanged = 0

        for b in rows:
            start = _start_tb(b)
            if start is None or start > now_tb:
                skipped["future"] += 1
                continue
            if start < window_start:
                skipped["too-old"] += 1
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
            owner = session.get(User, b.user_uuid)
            if not owner:
                skipped["no-owner"] += 1
                continue

            try:
                quote = pricing.calculate_price(
                    user=owner,
                    resource_id=b.resource_id,
                    start_time=start,
                    duration_minutes=b.duration or 60,
                    format_type=b.format or "individual",
                    exclude_booking_id=str(b.id),
                )
            except Exception as e:
                log.warning("[skip] %s pricing failed: %r", b.id, e)
                skipped["pricing-error"] += 1
                continue

            old_price = float(b.final_price or 0)
            new_price = round(float(quote.final_price or 0), 2)
            if abs(new_price - old_price) < 0.01:
                unchanged += 1
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
        log.info("Found %d past bookings to correct across %d users.",
                 len(targets), len(by_user))
        log.info("  Skipped: %s", dict(skipped))
        log.info("  Unchanged: %d", unchanged)
        total_delta = round(sum(u["delta"] for u in by_user.values()), 2)
        log.info("  Net delta: %+.2f ₾ %s",
                 total_delta,
                 "(charge users — they paid less than they should have)" if total_delta > 0
                 else "(refund — they paid more)")

        lines = [f"# Past-2w price audit  (window: {window_start.date()} → {now_tb.date()})\n"]
        for u in sorted(by_user.values(), key=lambda x: -abs(x["delta"])):
            owner = u["owner"]
            name = owner.name or owner.email
            lines.append(f"\n### {name}  ({len(u['items'])} бронь, {u['delta']:+.2f}₾)")
            for b, old, new, old_rule, new_rule in u["items"]:
                d = b.date.date() if b.date else "?"
                lines.append(
                    f"  - {d} {b.start_time} {b.resource_id} "
                    f"({(b.duration or 0)/60:.1f}ч): "
                    f"{old:.2f} → {new:.2f}₾  ({old_rule} → {new_rule})"
                )
        report = "\n".join(lines)
        if args.report:
            with open(args.report, "w", encoding="utf-8") as f:
                f.write(report)
            log.info("Report → %s", args.report)
        else:
            print(report)

        if not args.apply:
            log.info("DRY-RUN — pass --apply to commit")
            return 0

        adjusted_balances = 0
        for b, owner, old, new, _or, _nr in targets:
            b.final_price = new
            # Recompute rule/discount tags via the quote we got above? No,
            # we only have old/new prices stored. Re-query the quote here
            # to also fix rule + discount_percent + discount_amount.
            start = _start_tb(b)
            quote = pricing.calculate_price(
                user=owner, resource_id=b.resource_id,
                start_time=start, duration_minutes=b.duration or 60,
                format_type=b.format or "individual",
                exclude_booking_id=str(b.id),
            )
            b.applied_rule = quote.applied_rule or "NONE"
            b.discount_percent = int(round(quote.discount_percent or 0))
            b.discount_amount = float(quote.discount_amount or 0)
            delta = round(new - old, 2)
            if delta != 0:
                # Past + confirmed = the session already happened. Adjust
                # balance so the user ends up paying the correct amount in
                # net. If new > old → owner.balance -= delta (they owe more).
                owner.balance = round((owner.balance or 0) - delta, 2)
                session.add(owner)
                adjusted_balances += 1
            b.charge_amount = new
            session.add(b)
        session.commit()
        log.info("APPLIED: %d bookings corrected, balance touches: %d",
                 len(targets), adjusted_balances)
    return 0


if __name__ == "__main__":
    sys.exit(main())
