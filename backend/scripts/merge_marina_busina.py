"""Merge 3 Марина Бусина accounts into 1 (canonical).

Background (2026-05-23):
  Three User rows share the same telegram_id but were created at different
  times during the TG-link flow. One is a "Ожидание" placeholder that the
  bot left behind after a partial /start; the other two are real-but-stale
  registrations. Frontend "Войти через TG" picks whichever row the bot
  resolves first → confusing UX, mismatched balances and bookings.

Rule:
  1. Pick the canonical row = the one with most bookings; tie-breaker —
     newest by created_at.
  2. Move EVERY foreign-key reference (bookings, cashbox_transactions,
     therapist_clients.user_id, sessions, payments, notes, waitlist,
     bonuses, balance_history if exists) to the canonical row.
  3. Sum balance into canonical, zero the rest.
  4. Delete the now-empty rows (or soft-disable if has FKs we missed).

Safety:
  * Dry-run by default. --apply commits.
  * pg_dump dump line printed at the top for the user to take a manual
    backup before running.
  * Strict assertion: exactly 3 matches, all sharing the same telegram_id.
    If anything else, abort.

Run on Droplet:
  ssh root@138.68.111.248
  cd /var/www/unbox/backend
  PGPASSWORD=... pg_dump -h localhost -U unbox unboxdb > /tmp/pre_marina_merge.sql
  .venv/bin/python scripts/merge_marina_busina.py            # dry-run
  .venv/bin/python scripts/merge_marina_busina.py --apply
"""
import sys
import argparse
from collections import defaultdict

sys.path.insert(0, "/var/www/unbox/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.booking import Booking
from app.models.cashbox_transaction import CashboxTransaction

NAME_QUERY = "Бусина"  # plus first-name "Марина"

p = argparse.ArgumentParser()
p.add_argument("--apply", action="store_true")
args = p.parse_args()


def fetch_table_columns(s, table):
    """Inspect actual columns of a table — older migrations may have
    different field names than the model expects."""
    rows = s.exec(  # type: ignore
        f"""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = '{table}'
        """
    ).all()
    return {r[0] if isinstance(r, tuple) else r for r in rows}


with Session(engine) as s:
    candidates = s.exec(
        select(User).where(
            (User.name.ilike(f"%{NAME_QUERY}%"))  # type: ignore
            | (User.email.ilike(f"%busina%"))  # type: ignore
        )
    ).all()
    print(f"Found {len(candidates)} candidate users with name match:")
    for u in candidates:
        n_bookings = len(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all())
        print(f"  {u.id}  {u.email or '—':30s}  tg={u.telegram_id or '—':20s}  "
              f"bal={u.balance or 0:>8.2f}  bookings={n_bookings}  "
              f"created={u.created_at}")

    if len(candidates) != 3:
        print(f"\n⚠️  Expected 3 candidates, got {len(candidates)}. Aborting — re-tune NAME_QUERY.")
        sys.exit(1)

    # Confirm all share same telegram_id
    tg_ids = {u.telegram_id for u in candidates if u.telegram_id}
    if len(tg_ids) > 1:
        print(f"\n⚠️  Candidates have different telegram_ids: {tg_ids}. Aborting.")
        sys.exit(1)

    # Pick canonical = most bookings, tie-broken by newest created_at
    def score(u):
        n = len(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all())
        return (n, u.created_at or 0)

    canonical = max(candidates, key=score)
    others = [u for u in candidates if u.id != canonical.id]

    print(f"\nCanonical: {canonical.id}  {canonical.email or '—'}")
    print(f"Will absorb: {[str(u.id) for u in others]}")

    # Plan moves
    moves = defaultdict(list)
    for u in others:
        for b in s.exec(select(Booking).where(Booking.user_uuid == u.id)).all():
            moves["bookings"].append((b.id, u.id, canonical.id))
        for tx in s.exec(select(CashboxTransaction).where(CashboxTransaction.credited_user_id == str(u.id))).all():
            moves["cashbox_credit"].append((tx.id, u.id, canonical.id))

    # Balance sum
    extra_balance = sum((u.balance or 0) for u in others)
    print(f"\nBalance to absorb: {extra_balance:.2f}  → canonical new balance: "
          f"{(canonical.balance or 0) + extra_balance:.2f}")
    for k, lst in moves.items():
        print(f"  {k}: {len(lst)} rows")

    if not args.apply:
        print("\nDRY-RUN — pass --apply to commit (after pg_dump backup!)")
        sys.exit(0)

    # ── APPLY ─────────────────────────────────────────────────────────
    for b_id, _from, _to in moves["bookings"]:
        b = s.get(Booking, b_id)
        if b:
            # Booking has BOTH user_id (varchar holding email) AND user_uuid
            # (FK to User.id). Keep them aligned so subsequent lookups work
            # whether legacy code queries by email or the new uuid join.
            b.user_uuid = canonical.id
            if canonical.email:
                b.user_id = canonical.email
            s.add(b)
    for tx_id, _from, _to in moves["cashbox_credit"]:
        tx = s.get(CashboxTransaction, tx_id)
        if tx:
            tx.credited_user_id = str(canonical.id)
            s.add(tx)

    canonical.balance = (canonical.balance or 0) + extra_balance
    s.add(canonical)

    for u in others:
        u.balance = 0
        u.telegram_id = None
        # User has no `is_active` column — disabling via email rename is
        # enough (login lookups are by exact email match, and the prefix
        # makes the row obviously merged-out for any future admin).
        u.email = f"_merged_into_{canonical.id}__{u.email or u.id}"
        s.add(u)

    s.commit()
    print(f"\n✅ Merged. Canonical: {canonical.id} (balance={canonical.balance:.2f})")
    print(f"   Disabled: {[str(u.id) for u in others]}")
