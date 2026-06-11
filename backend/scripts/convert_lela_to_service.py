"""Convert УБОРКА ЛЕЛА's bookings into free service-blocks.

Lela is the cleaner; her "bookings" exist to hold the 09:00 daily slot
on the chessboard so clients don't book a cabinet during cleaning. They
are NOT paying revenue. Until now they were stored as regular `balance`
bookings with the standard 20-25 ₾ price — which polluted finance
reports and would have pushed +2660₾ of bogus charges via the peak-base
recompute fix.

This script converts each one to a "service" block:
  * payment_method = "service"
  * final_price    = 0
  * payment_status = "waived"
  * waiver_reason  = "cleaning — converted from client booking"
  * waived_at      = now (audit trail)
  * status         = unchanged (still confirmed → blocks the slot)

After this, the v3 pricing recompute skips them (payment_method != one
of the recharge-eligible methods). They also vanish from finance KPIs
(non-paid bookings are already excluded there).

Dry-run by default. Pass --apply to commit.

Run:
    cd /var/www/unbox/backend
    ./venv/bin/python3.12 -m scripts.convert_lela_to_service        # dry
    ./venv/bin/python3.12 -m scripts.convert_lela_to_service --apply
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime

from sqlmodel import Session, select

sys.path.insert(0, "/var/www/unbox/backend")

from app.db.session import engine  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.models.user import User  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("lela-service")

LELA_ID = "344e8d9c-77d8-4051-9949-2822a5a75d9a"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    with Session(engine) as s:
        lela = s.get(User, LELA_ID)
        if not lela:
            log.error("Lela user %s not found", LELA_ID)
            return 1

        bookings = s.exec(select(Booking).where(Booking.user_uuid == lela.id)).all()
        log.info("Lela has %d bookings total", len(bookings))

        # Filter: only touch the ones that look like cleaning blocks.
        # Already-converted (payment_method=service) and edge cases stay.
        targets = [b for b in bookings if (b.payment_method or "").lower() != "service"]
        log.info("To convert: %d (skipping %d already-converted)",
                 len(targets), len(bookings) - len(targets))

        # Restore her balance to what it was BEFORE any of these blocks
        # would have been charged. The bookings are mostly pending — they
        # were never actually deducted. For any that WERE marked paid, we
        # need to credit her balance back. We only do this for service
        # rows we now zero out.
        balance_credit = 0.0
        for b in targets:
            if b.payment_status == "paid":
                balance_credit += float(b.final_price or 0)

        log.info("Balance adjustment for Lela (refund paid blocks): +%.2f₾",
                 balance_credit)
        log.info("Lela current balance: %s₾", lela.balance)

        for b in targets:
            log.info(
                "  %s  %s  %s  resource=%s  price=%s → 0   pay=%s",
                b.id, b.date.date() if b.date else "?", b.start_time,
                b.resource_id, b.final_price, b.payment_status,
            )
            if args.apply:
                b.payment_method = "service"
                b.final_price = 0
                b.payment_status = "waived"
                b.waiver_reason = "cleaning — converted from client booking"
                b.waived_at = datetime.now()
                b.charge_amount = 0
                b.updated_at = datetime.now()
                s.add(b)

        if args.apply:
            if balance_credit > 0:
                lela.balance = round((lela.balance or 0) + balance_credit, 2)
                s.add(lela)
                log.info("Lela balance: → %s₾", lela.balance)
            s.commit()
            log.info("Committed %d conversions.", len(targets))
        else:
            log.info("DRY-RUN — pass --apply to commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
