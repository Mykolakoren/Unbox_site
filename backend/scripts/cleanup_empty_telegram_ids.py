"""Replace empty-string telegram_id with NULL across User table.

Background (2026-05-23):
  Some users (e.g. Ольга Кузуб) ended up with telegram_id='' instead of
  NULL. Empty string is treated as a real value by the TG-link uniqueness
  check, so the next user who tries to link their account hits a 409
  conflict against the placeholder. NULL is the correct "unlinked" marker.

Source of the bug: an older /users/{id}/unlink-telegram path that did
`user.telegram_id = ''` instead of `= None`. Already fixed at the route
level — this cleanup catches the residue.

Run on Droplet:
  cd /var/www/unbox/backend
  .venv/bin/python scripts/cleanup_empty_telegram_ids.py           # dry
  .venv/bin/python scripts/cleanup_empty_telegram_ids.py --apply
"""
import sys
import argparse

sys.path.insert(0, "/var/www/unbox/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User

p = argparse.ArgumentParser()
p.add_argument("--apply", action="store_true")
args = p.parse_args()

with Session(engine) as s:
    affected = s.exec(
        select(User).where(User.telegram_id == "")  # type: ignore
    ).all()
    print(f"Found {len(affected)} users with telegram_id='':")
    for u in affected:
        print(f"  {u.id}  {u.email or '—':30s}  {u.name or '—'}")

    if not args.apply:
        print("\nDRY-RUN — pass --apply to commit")
        sys.exit(0)

    for u in affected:
        u.telegram_id = None
        s.add(u)
    s.commit()
    print(f"\n✅ Cleared {len(affected)} empty telegram_ids.")
