"""Merge Ольга Малыш's two User rows into one.

Background (2026-05-25):
  Olga has two specialist rows under the same name. One has email
  `flemin21.09.1984@gmail.com` (active, 231.5 ₾), the other has email
  `merged-into-...@deleted.unbox` (left over from an earlier
  incomplete merge — 129.5 ₾ balance still attached).

Rule:
  1. Canonical = the active row (non-deleted email, highest bookings).
  2. Move every booking + cashbox credit from the other row to canonical.
  3. Sum balance into canonical.
  4. Rename the merged-out row's email to a clearly inactive marker
     (`_merged_into_<id>__<orig>`) so it can never be picked up by
     a future TG bind / login.

Dry-run by default. --apply commits. Backup with pg_dump beforehand.
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

NAME_QUERY = "Малыш"

p = argparse.ArgumentParser()
p.add_argument("--apply", action="store_true")
args = p.parse_args()

with Session(engine) as s:
    rows = s.exec(select(User).where(User.name.ilike(f"%{NAME_QUERY}%"))).all()  # type: ignore
    print(f"Found {len(rows)} candidate users:")
    for u in rows:
        n = len(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all())
        print(f"  {u.id}  {u.email or '—':60s}  bal={u.balance or 0:>8.2f}  bookings={n}")

    if len(rows) != 2:
        print(f"\n⚠️  Expected 2 candidates, got {len(rows)}. Aborting.")
        sys.exit(1)

    # Canonical = the one whose email is NOT prefixed with `merged-into-` / `_merged_into_`.
    actives = [u for u in rows if not (u.email or '').startswith(('merged-into-', '_merged_into_'))]
    deleted = [u for u in rows if (u.email or '').startswith(('merged-into-', '_merged_into_'))]
    if len(actives) != 1 or len(deleted) != 1:
        print(f"\n⚠️  Could not unambiguously pick canonical. actives={len(actives)} deleted={len(deleted)}")
        sys.exit(1)

    canonical = actives[0]
    other = deleted[0]
    print(f"\nCanonical: {canonical.id}  {canonical.email}")
    print(f"Absorb:    {other.id}  {other.email}")

    moves = defaultdict(list)
    for b in s.exec(select(Booking).where(Booking.user_uuid == other.id)).all():
        moves["bookings"].append(b.id)
    for tx in s.exec(select(CashboxTransaction).where(CashboxTransaction.credited_user_id == str(other.id))).all():
        moves["cashbox_credit"].append(tx.id)

    extra_balance = other.balance or 0
    print(f"\nBalance to absorb: {extra_balance:.2f}  → canonical new balance: {(canonical.balance or 0) + extra_balance:.2f}")
    for k, lst in moves.items():
        print(f"  move {k}: {len(lst)} rows")

    if not args.apply:
        print("\nDRY-RUN — pass --apply to commit (after pg_dump backup)")
        sys.exit(0)

    for b_id in moves["bookings"]:
        b = s.get(Booking, b_id)
        if b:
            b.user_uuid = canonical.id
            if canonical.email:
                b.user_id = canonical.email
            s.add(b)
    for tx_id in moves["cashbox_credit"]:
        tx = s.get(CashboxTransaction, tx_id)
        if tx:
            tx.credited_user_id = str(canonical.id)
            s.add(tx)

    canonical.balance = (canonical.balance or 0) + extra_balance
    s.add(canonical)

    other.balance = 0
    other.telegram_id = None
    other.email = f"_merged_into_{canonical.id}__{other.email or other.id}"
    s.add(other)

    s.commit()
    print(f"\n✅ Merged. Canonical: {canonical.id} (bal={canonical.balance:.2f})")
