"""Batch-merge 6 TG-placeholder duplicates into their real twin accounts.

Discovered 2026-05-25 via find_telegram_duplicates.py. Each pair has the
same `telegram_id`; the placeholder uses `<id>@telegram.unbox` and carries
0 bookings + 0 balance (audit confirmed). Merge consolidates onto the
real account so the canonical row holds the TG link, and the placeholder
becomes inert (telegram_id=None, email prefixed `_merged_into_...`).

Hardcoded pairs by telegram_id so we never accidentally pick up something
else if the audit later finds new cases. Re-run audit first to verify.

Dry-run by default. --apply commits.
"""
import argparse
import sys
from collections import defaultdict

sys.path.insert(0, "/var/www/unbox-beta/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.booking import Booking
from app.models.cashbox_transaction import CashboxTransaction


# Map telegram_id → canonical email. Placeholder is `<id>@telegram.unbox`
# in every case (see audit 2026-05-25). Pairs verified by the dups script
# right before this run.
PAIRS: list[tuple[str, str]] = [
    ("965897361", "shipa1674@mail.ru"),
    ("391506075", "evgenia0808@gmail.com"),
    ("3047611", "eraiskaya@gmail.com"),
    ("359213379", "yanapedan@ukr.net"),
    ("537084083", "mukhamadeevaliya@mail.com"),
    ("1135738006", "roshmirosh@yandex.ru"),
]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()

    total_merged = 0
    total_bookings_moved = 0
    total_balance_moved = 0.0

    with Session(engine) as s:
        for tg_id, canonical_email in PAIRS:
            placeholder_email = f"{tg_id}@telegram.unbox"
            canonical = s.exec(
                select(User).where(User.email == canonical_email)
            ).first()
            placeholder = s.exec(
                select(User).where(User.email == placeholder_email)
            ).first()

            print("─" * 70)
            print(f"TG {tg_id}: {canonical_email}")
            if not canonical:
                print(f"  ❌ canonical not found ({canonical_email!r}). Skipping.")
                continue
            if not placeholder:
                print(f"  ❌ placeholder not found ({placeholder_email!r}). Skipping.")
                continue
            if canonical.id == placeholder.id:
                print("  ❌ same row. Skipping.")
                continue

            bookings = s.exec(
                select(Booking).where(Booking.user_uuid == placeholder.id)
            ).all()
            credits = s.exec(
                select(CashboxTransaction).where(
                    CashboxTransaction.credited_user_id == str(placeholder.id)
                )
            ).all()
            bal = placeholder.balance or 0

            print(f"  canonical: {canonical.id}  bookings={len(s.exec(select(Booking).where(Booking.user_uuid == canonical.id)).all())}  bal={canonical.balance or 0}  tg={canonical.telegram_id}")
            print(f"  placeholder: {placeholder.id}  bookings={len(bookings)}  bal={bal}  credits={len(credits)}")

            if args.apply:
                for b in bookings:
                    b.user_uuid = canonical.id
                    if canonical.email:
                        b.user_id = canonical.email
                    s.add(b)
                for tx in credits:
                    tx.credited_user_id = str(canonical.id)
                    s.add(tx)
                canonical.balance = (canonical.balance or 0) + bal
                # Make sure canonical keeps the telegram_id (it likely
                # already has it, but defensive).
                if not canonical.telegram_id:
                    canonical.telegram_id = tg_id
                s.add(canonical)

                placeholder.telegram_id = None
                placeholder.balance = 0
                placeholder.email = (
                    f"_merged_into_{canonical.id}__{placeholder.email or placeholder.id}"
                )
                s.add(placeholder)

            total_merged += 1
            total_bookings_moved += len(bookings)
            total_balance_moved += bal

        print("─" * 70)
        if args.apply:
            s.commit()
            print(
                f"\n✅ COMMITTED. Merged {total_merged} pairs. "
                f"bookings moved: {total_bookings_moved}. balance moved: {total_balance_moved:.2f}"
            )
        else:
            print(
                f"\nDRY-RUN. Would merge {total_merged} pairs. "
                f"bookings to move: {total_bookings_moved}. balance to move: {total_balance_moved:.2f}"
            )
            print("Pass --apply to commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
