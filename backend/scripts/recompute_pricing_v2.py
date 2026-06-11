"""One-shot migration: recompute every future confirmed booking with the
2026-05-07 pricing rules:
  * Peak hours flat +5 GEL/h (was 25%-of-base surcharge)
  * Peak range вечером 21-22 (was 20-22)
  * Discount tiers 2/3/5h (was 2/3/4h)
  * Discount applies only to non-peak portion
  * Tier lookup based on non-peak hours

Behaviour:
  * `pending` bookings: just bump final_price. Cron at T-24h will charge the
    new amount. No money moves now — the slot wasn't billed yet.
  * `paid` bookings (rare, hot booking ≤24h): adjust user balance by the
    delta and update charge_amount so the audit trail matches reality.
  * Subscription bookings: SKIPPED — recomputing those needs careful hours
    adjustment (delta on remaining_hours / used_hours / subscription_surcharge_gel
    debt) which is brittle on legacy plan formats.

Dry-run by default. Pass --apply to commit. Outputs a per-user report.

Run on server:
    cd /var/www/unbox/backend
    ./venv/bin/python3.12 -m scripts.recompute_pricing_v2          # dry-run
    ./venv/bin/python3.12 -m scripts.recompute_pricing_v2 --apply  # commit
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
log = logging.getLogger("recompute")

_TBS = timedelta(hours=4)


def _start_tb(b: Booking) -> datetime | None:
    if not b.date or not b.start_time:
        return None
    try:
        h, m = b.start_time.split(":")
        return b.date.replace(hour=int(h), minute=int(m), second=0, microsecond=0)
    except Exception:
        return None


def _classify_reason(b: Booking, start: datetime, duration_minutes: int) -> str:
    """Best-effort label for *why* the price changed.

    Heuristic — looks at start/end times to flag which rule(s) likely
    moved this booking. Pure presentation: not used in computation.
    Updated 2026-05-13 for the peak-base bug fix + tier boundary shift.
    """
    reasons = []
    start_total = start.hour * 60 + start.minute
    end_total = start_total + duration_minutes
    has_morning_peak = start_total < 600 and end_total > 540   # 09-10
    has_evening_peak = start_total < 1320 and end_total > 1260  # 21-22

    if has_morning_peak or has_evening_peak:
        reasons.append("peak часы теперь включают base_rate × часы + 5 ₾/час (раньше только +5)")

    hours = duration_minutes / 60.0
    # Tier boundary changes 2026-05-13:
    #   старое 2-2.99→10, 3-4.99→15, 5+→20 (3.0h = 15%, 5.0h = 20%)
    #   новое  2.0-3.0→10, 3.5-5.0→15, 5.5+→20 (3.0h = 10%, 5.0h = 15%)
    if abs(hours - 3.0) < 0.01:
        reasons.append("3ч теперь 10% (раньше 15%)")
    elif abs(hours - 5.0) < 0.01:
        reasons.append("5ч теперь 15% (раньше 20%)")

    return "; ".join(reasons) if reasons else "формула обновлена"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Commit changes")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--report", type=str, default=None,
        help="Write per-user report to this file (default: stdout only)",
    )
    args = parser.parse_args()
    apply_changes = args.apply

    log.info("Mode: %s", "APPLY (writes!)" if apply_changes else "DRY-RUN")

    now_tb = datetime.utcnow() + _TBS
    log.info("Tbilisi-now: %s", now_tb)

    with Session(engine) as session:
        rows: List[Booking] = session.exec(
            select(Booking).where(
                Booking.status.in_(["confirmed", "pending_approval"]),  # type: ignore
            )
        ).all()
        log.info("Loaded %d confirmed/pending_approval bookings", len(rows))

        # (booking, owner, old_price, new_price, reason)
        targets: list[tuple[Booking, User, float, float, str]] = []
        skipped_past = 0
        skipped_sub = 0
        skipped_no_owner = 0
        skipped_zero = 0
        skipped_large_delta = 0
        unchanged = 0

        pricing = PricingService(session)

        for b in rows:
            start = _start_tb(b)
            if start is None or start <= now_tb:
                skipped_past += 1
                continue
            if (b.payment_method or "").lower() == "subscription":
                skipped_sub += 1
                continue
            if not b.user_uuid:
                skipped_no_owner += 1
                continue
            owner = session.get(User, b.user_uuid)
            if not owner:
                skipped_no_owner += 1
                continue

            try:
                # Pass real user so duration/weekly/personal discounts apply.
                quote = pricing.calculate_price(
                    user=owner,
                    resource_id=b.resource_id,
                    start_time=start,
                    duration_minutes=b.duration or 60,
                    format_type=b.format or "individual",
                )
            except Exception as e:
                log.warning("[skip] booking %s pricing failed: %r", b.id, e)
                continue

            old_price = float(b.final_price or 0)
            new_price = round(float(quote.final_price or 0), 2)
            if abs(new_price - old_price) < 0.01:
                unchanged += 1
                continue

            # Skip 0-priced rows (bonus/promo/admin freebies — not ours to touch)
            if old_price <= 0:
                skipped_zero += 1
                continue
            # Sanity bound: only catch genuinely insane swings. The 2026-05-13
            # peak-base fix can legitimately push a 1h peak booking from 5 ₾
            # to 25 ₾ (ratio 5x) — that's the whole point. We only skip if
            # the delta is enormous AND the absolute difference is large too,
            # to filter out data corruption rather than legitimate fixes.
            ratio = new_price / old_price
            abs_delta = abs(new_price - old_price)
            if (ratio > 10.0 or ratio < 0.1) and abs_delta > 500:
                log.info(
                    "[skip-large-delta] %s: %.2f → %.2f (ratio %.2fx, delta %.2f) — manual review",
                    b.id, old_price, new_price, ratio, abs_delta,
                )
                skipped_large_delta += 1
                continue

            reason = _classify_reason(b, start, b.duration or 60)
            targets.append((b, owner, old_price, new_price, reason))

            if args.limit and len(targets) >= args.limit:
                break

        # Group by user
        by_user: dict[str, dict] = defaultdict(lambda: {
            "owner": None, "items": [], "sum_old": 0.0, "sum_new": 0.0,
            "pending_delta": 0.0, "paid_delta": 0.0,
        })
        for b, owner, old, new, reason in targets:
            uid = str(owner.id)
            by_user[uid]["owner"] = owner
            by_user[uid]["items"].append((b, old, new, reason))
            by_user[uid]["sum_old"] += old
            by_user[uid]["sum_new"] += new
            delta = round(old - new, 2)  # +ve = refund/credit, -ve = additional charge
            if b.payment_status == "paid":
                by_user[uid]["paid_delta"] += delta
            else:
                # pending / NULL / pending_approval — no money moved yet
                by_user[uid]["pending_delta"] += delta

        log.info("=" * 80)
        log.info(
            "TOTALS: %d bookings will change across %d users.",
            len(targets), len(by_user),
        )
        log.info(
            "  Skipped: past=%d, subscription=%d, no-owner=%d, zero-price=%d, "
            "large-delta=%d, unchanged=%d",
            skipped_past, skipped_sub, skipped_no_owner, skipped_zero,
            skipped_large_delta, unchanged,
        )
        total_paid_refund = sum(u["paid_delta"] for u in by_user.values() if u["paid_delta"] > 0)
        total_paid_extra = sum(-u["paid_delta"] for u in by_user.values() if u["paid_delta"] < 0)
        total_pending_down = sum(u["pending_delta"] for u in by_user.values() if u["pending_delta"] > 0)
        total_pending_up = sum(-u["pending_delta"] for u in by_user.values() if u["pending_delta"] < 0)
        log.info(
            "PAID rows (balance moves now): +%.2f₾ refund, -%.2f₾ extra charge",
            total_paid_refund, total_paid_extra,
        )
        log.info(
            "PENDING rows (just future-charge update, no money moves): "
            "%.2f₾ less to charge, %.2f₾ more to charge",
            total_pending_down, total_pending_up,
        )

        # Build per-user report
        lines: list[str] = []
        lines.append("# Перерасчёт цен — 2026-05-07")
        lines.append("")
        lines.append(f"Затронуто бронь: **{len(targets)}**, клиентов: **{len(by_user)}**.")
        lines.append("")
        lines.append("Новая формула:")
        lines.append("- Peak hours = плоские +5₾/час (было 25% от тарифа)")
        lines.append("- Вечерний peak = 21-22 (было 20-22)")
        lines.append("- Скидка по часам: 2/3/5+ → 10/15/20% (было 2/3/4 → 10/15/20%)")
        lines.append("- Скидка применяется только к non-peak часам")
        lines.append("")
        lines.append("Pending брони — деньги не списаны (списываются за 24ч). Просто обновим сумму.")
        lines.append("Paid брони — корректируем баланс на дельту.")
        lines.append("")
        lines.append("---")
        lines.append("")

        sorted_users = sorted(
            by_user.values(),
            key=lambda u: abs(u["sum_old"] - u["sum_new"]),
            reverse=True,
        )
        for u in sorted_users:
            owner = u["owner"]
            name = owner.name or owner.email or str(owner.id)
            n = len(u["items"])
            d = round(u["sum_old"] - u["sum_new"], 2)
            sign = "+" if d > 0 else ""
            lines.append(f"### {name}  ({n} бронь, дельта {sign}{d:+.2f}₾)")
            if u["paid_delta"] != 0:
                pd = u["paid_delta"]
                action = f"возврат на баланс {pd:.2f}₾" if pd > 0 else f"доп.списание {-pd:.2f}₾"
                lines.append(f"- _Paid_: {action}")
            if u["pending_delta"] != 0:
                pd = u["pending_delta"]
                tag = "снизим" if pd > 0 else "повысим"
                lines.append(f"- _Pending_: {tag} будущее списание на {abs(pd):.2f}₾")
            lines.append("")
            for b, old, new, reason in u["items"]:
                date_str = b.date.date() if b.date else "?"
                status_tag = "[paid]" if b.payment_status == "paid" else "[pending]"
                lines.append(
                    f"  - {date_str} {b.start_time} {b.resource_id} ({b.format}, "
                    f"{(b.duration or 0)/60:.1f}h) {status_tag}: "
                    f"{old:.2f} → {new:.2f}₾ ({old - new:+.2f}₾) — {reason}"
                )
            lines.append("")

        report = "\n".join(lines)
        if args.report:
            with open(args.report, "w", encoding="utf-8") as f:
                f.write(report)
            log.info("Report written to %s", args.report)
        else:
            print(report)

        if not apply_changes:
            log.info("DRY-RUN — no DB writes. Run with --apply to commit.")
            return 0

        # Apply changes
        balance_adjusted_users = 0
        for b, owner, old, new, _reason in targets:
            b.final_price = new
            if b.payment_status == "paid":
                # Already charged — adjust balance + audit-trail charge_amount.
                delta = round(old - new, 2)
                if delta != 0:
                    owner.balance = round((owner.balance or 0) + delta, 2)
                    session.add(owner)
                    balance_adjusted_users += 1
                b.charge_amount = new
            # pending / NULL / pending_approval: just update final_price.
            # The cron at T-24h will charge the new amount.
            session.add(b)

        session.commit()
        log.info(
            "APPLIED: %d bookings recomputed; balance touches on %d paid rows.",
            len(targets), balance_adjusted_users,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
