"""Read-only audit: detect User-row duplicates caused by Telegram auth
auto-create + similar account-creation paths.

Two classes of duplicates we look for (2026-05-25):

1. **Shared telegram_id** — multiple rows with the same `telegram_id`.
   Means a placeholder (`<id>@telegram.unbox`) was created when the
   real user logged in via Google/email later, but the OAuth callback
   didn't merge them.

2. **Placeholder TG-only emails** — rows whose email matches
   `^\\d+@telegram\\.unbox$`. Each such row indicates the legacy
   auto-create path fired. If the same person ALSO has a real account
   (Google or email), the placeholder is a ghost candidate for merge.
   Cross-reference by `telegram_id` to find the real one.

3. **(Bonus) Empty hashed_password + placeholder email** — same as #2
   but catches even legacy rows missing the @telegram.unbox suffix.

Nothing is written. Output is a plain printable list grouped by case.
"""
import sys
from collections import defaultdict

sys.path.insert(0, "/var/www/unbox-beta/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.booking import Booking


with Session(engine) as s:
    users = s.exec(select(User)).all()
    print(f"Scanning {len(users)} users for TG-related duplicates...\n")

    # ── 1. Same telegram_id on multiple rows ──────────────────────────
    by_tg: dict = defaultdict(list)
    for u in users:
        if u.telegram_id:
            by_tg[u.telegram_id].append(u)
    multi_tg = {tg: rows for tg, rows in by_tg.items() if len(rows) > 1}
    print("─" * 70)
    print(f"CASE 1 — same telegram_id on multiple users: {len(multi_tg)} groups\n")
    for tg, rows in multi_tg.items():
        print(f"  telegram_id={tg}")
        for u in rows:
            n_b = len(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all())
            ghost = '👻' if (u.email or '').startswith(('merged-into-', '_merged_into_')) else '  '
            tg_only = '📨' if (u.email or '').endswith('@telegram.unbox') else '  '
            print(f"    {ghost}{tg_only} {u.id}  {(u.email or '—'):55s}  bookings={n_b}  bal={u.balance or 0}")
        print()

    # ── 2. Placeholder TG-only emails ─────────────────────────────────
    tg_placeholders = [u for u in users
                       if (u.email or '').endswith('@telegram.unbox')]
    # Annotate which ones have a "real" sibling (same telegram_id, different email)
    print("─" * 70)
    print(f"CASE 2 — TG-only placeholder emails: {len(tg_placeholders)} rows\n")
    for u in tg_placeholders:
        siblings = [
            x for x in users
            if x.id != u.id
            and x.telegram_id == u.telegram_id
            and not (x.email or '').endswith('@telegram.unbox')
        ] if u.telegram_id else []
        n_b = len(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all())
        sibling_emails = ', '.join(sorted({x.email or x.id for x in siblings}))
        tag = '⚠️ DUP' if siblings else '   solo'
        print(f"  {tag}  {u.id}  {u.email:45s}  tg={u.telegram_id}  bookings={n_b}  bal={u.balance or 0}")
        if siblings:
            print(f"          → real twin: {sibling_emails}")

    # ── 3. Already-merged ghosts that still have residual balance/bookings ──
    print("\n" + "─" * 70)
    print("CASE 3 — merged-out ghosts with non-zero balance or active bookings:\n")
    ghosts = [u for u in users
              if (u.email or '').startswith(('merged-into-', '_merged_into_'))]
    for u in ghosts:
        n_b = len(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all())
        if (u.balance or 0) != 0 or n_b > 0:
            print(f"  ⚠️  {u.id}  {u.email}  bal={u.balance}  bookings={n_b}")
    print(f"\n{len(ghosts)} ghost row(s) total ({sum(1 for u in ghosts if (u.balance or 0) != 0 or len(s.exec(select(Booking).where(Booking.user_uuid == u.id)).all()) > 0)} with residual data).")
