"""v4 — Full recompute of all future bookings under CURRENT pricing rules.

Admin 2026-05-20: "пересчитай все будущие аренды независимо от того когда
была сделана бронь". After two earlier targeted fixes (v3 peak-base bug,
v3.5 tier-boundary change), some bookings still carry stale prices from
when the rules were different. v4 replays PricingService.calculate_price
on every future confirmed/pending_approval booking and updates final_price
to match current rules.

Mechanics:
  * For each future booking, call PricingService.calculate_price with
    the booking's slot/format/payment_method + the user's current state.
    This applies the CURRENT peak window (20-22 after 2026-05-20 revert),
    CURRENT tier table (10/15/20% at 2/3.5/5.5h), CURRENT weekly
    progressive thresholds, and CURRENT personal discount on the user.
  * For paid rows: adjust balance by (new − old). User keeps the slot
    but their balance moves to reflect the corrected price.
  * For pending rows: just stamp new final_price; the T-24h cron will
    debit the right amount.
  * Skip: past, subscription, bonus, service (УБОРКА ЛЕЛА), no-owner,
    MANUAL_OVERRIDE (admin's deliberate price stays).

Dry-run by default. --apply commits.
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
log = logging.getLogger("v4-recompute")

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
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--report", type=str, default=None)
    args = parser.parse_args()

    log.info("Mode: %s", "APPLY (writes!)" if args.apply else "DRY-RUN")

    now_tb = datetime.utcnow() + _TBS
    log.info("Tbilisi-now: %s", now_tb)

    with Session(engine) as session:
        rows: List[Booking] = session.exec(
            select(Booking).where(
                Booking.status.in_(["confirmed", "pending_approval"]),  # type: ignore
            )
        ).all()
        log.info("Loaded %d confirmed/pending_approval bookings", len(rows))

        pricing = PricingService(session)
        # (booking, owner, old_price, new_price, old_rule, new_rule)
        targets: list[tuple[Booking, User, float, float, str, str]] = []
        skipped = defaultdict(int)
        unchanged = 0

        for b in rows:
            start = _start_tb(b)
            if start is None or start <= now_tb:
                skipped["past"] += 1
                continue
            method = (b.payment_method or "").lower()
            if method == "subscription":
                skipped["subscription"] += 1
                continue
            if method == "bonus":
                skipped["bonus"] += 1
                continue
            if method == "service":
                skipped["service"] += 1
                continue
            if not b.user_uuid:
                skipped["no-owner"] += 1
                continue
            if (b.applied_rule or "") == "MANUAL_OVERRIDE":
                # Admin deliberately set this price — never touch.
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
                    # Skip self in weekly accumulator — otherwise this booking
                    # counts itself once via the existing-row sum AND again via
                    # the `+ booked_hours` term, pushing users into a wrong tier.
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

            # Safety bound — never let the script 5x a price in either
            # direction. If we see something that extreme, leave it alone
            # and surface it for manual review.
            if old_price > 0:
                ratio = new_price / old_price
                if (ratio > 5.0 or ratio < 0.2) and abs(new_price - old_price) > 200:
                    log.info("[skip-large-delta] %s: %.2f → %.2f (%.2fx)",
                             b.id, old_price, new_price, ratio)
                    skipped["large-delta"] += 1
                    continue
            if old_price <= 0:
                # 0-priced row (legacy promo / admin freebie) — leave alone.
                skipped["zero-price"] += 1
                continue

            targets.append((b, owner, old_price, new_price,
                            b.applied_rule or "?", quote.applied_rule or "?"))
            if args.limit and len(targets) >= args.limit:
                break

        # Aggregate per user
        by_user: dict[str, dict] = defaultdict(lambda: {
            "owner": None, "items": [],
            "paid_delta": 0.0, "pending_delta": 0.0,
        })
        for b, owner, old, new, old_rule, new_rule in targets:
            uid = str(owner.id)
            by_user[uid]["owner"] = owner
            by_user[uid]["items"].append((b, old, new, old_rule, new_rule))
            delta = round(new - old, 2)
            if b.payment_status == "paid":
                by_user[uid]["paid_delta"] += delta
            else:
                by_user[uid]["pending_delta"] += delta

        log.info("=" * 80)
        log.info("TOTALS: %d bookings to change across %d users.",
                 len(targets), len(by_user))
        log.info("  Skipped: %s", dict(skipped))
        log.info("  Unchanged (already correct): %d", unchanged)
        paid_up = sum(u["paid_delta"] for u in by_user.values() if u["paid_delta"] > 0)
        paid_dn = sum(-u["paid_delta"] for u in by_user.values() if u["paid_delta"] < 0)
        pend_up = sum(u["pending_delta"] for u in by_user.values() if u["pending_delta"] > 0)
        pend_dn = sum(-u["pending_delta"] for u in by_user.values() if u["pending_delta"] < 0)
        log.info("PAID rows (balance moves now): +%.2f₾ extra charge, %.2f₾ refund",
                 paid_up, paid_dn)
        log.info("PENDING rows (just future-charge update): +%.2f₾ more, %.2f₾ less",
                 pend_up, pend_dn)

        lines: list[str] = []
        lines.append(f"# Перерасчёт цен v4 — 2026-05-20")
        lines.append("")
        lines.append("Применяет ТЕКУЩИЕ правила (peak 20-22, tier 10/15/20% на 2/3.5/5.5ч,")
        lines.append("weekly 10/25/50% на 5/11/16ч) ко всем будущим броням.")
        lines.append("")
        lines.append(f"Затронуто: **{len(targets)}** бронь у **{len(by_user)}** клиентов.")
        lines.append("")
        lines.append("---")
        sorted_users = sorted(
            by_user.values(),
            key=lambda u: abs(u["paid_delta"] + u["pending_delta"]),
            reverse=True,
        )
        for u in sorted_users:
            owner = u["owner"]
            name = owner.name or owner.email or str(owner.id)
            n = len(u["items"])
            paid = u["paid_delta"]
            pend = u["pending_delta"]
            tot = round(paid + pend, 2)
            lines.append(f"\n### {name}  ({n} бронь, дельта {tot:+.2f}₾)")
            if paid != 0:
                lines.append(f"- _Paid_: списать с баланса {paid:+.2f}₾")
            if pend != 0:
                lines.append(f"- _Pending_: будущее списание {pend:+.2f}₾")
            for b, old, new, old_rule, new_rule in u["items"][:25]:
                d_str = b.date.date() if b.date else "?"
                tag = "[paid]" if b.payment_status == "paid" else "[pend]"
                rule_note = f"{old_rule} → {new_rule}" if old_rule != new_rule else old_rule
                lines.append(
                    f"  - {d_str} {b.start_time} {b.resource_id} ({(b.duration or 0)/60:.1f}ч) {tag}: "
                    f"{old:.2f} → {new:.2f}₾  ({rule_note})"
                )
            if len(u["items"]) > 25:
                lines.append(f"  - ...и ещё {len(u['items']) - 25}")

        report = "\n".join(lines)
        if args.report:
            with open(args.report, "w", encoding="utf-8") as f:
                f.write(report)
            log.info("Report written to %s", args.report)
        else:
            print(report)

        if not args.apply:
            log.info("DRY-RUN — pass --apply to commit")
            return 0

        adjusted_balances = 0
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
            if b.payment_status == "paid":
                delta = round(new - old, 2)
                if delta != 0:
                    owner.balance = round((owner.balance or 0) - delta, 2)
                    session.add(owner)
                    adjusted_balances += 1
                b.charge_amount = new
            session.add(b)
        session.commit()
        log.info("APPLIED: %d bookings recomputed; balance touches %d paid rows",
                 len(targets), adjusted_balances)
    return 0


if __name__ == "__main__":
    sys.exit(main())
