"""Read-only: dump Ольга Малыш's pricing-related fields to understand
why her cabinet rental shows 18 ₾ instead of the usual 20 ₾.

Owner asked 2026-05-25 — likely a personal_discount_percent set somewhere.
"""
import sys
sys.path.insert(0, "/var/www/unbox-beta/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User

with Session(engine) as s:
    candidates = s.exec(
        select(User).where(User.name.ilike("%Малыш%"))  # type: ignore
    ).all()
    if not candidates:
        candidates = s.exec(
            select(User).where(User.email.ilike("%malysh%"))  # type: ignore
        ).all()
    print(f"Found {len(candidates)} match(es):\n")
    for u in candidates:
        print(f"  id={u.id}")
        print(f"  name={u.name!r}")
        print(f"  email={u.email!r}")
        print(f"  role={u.role!r}")
        print(f"  pricing_system={getattr(u, 'pricing_system', None)!r}")
        print(f"  personal_discount_percent={getattr(u, 'personal_discount_percent', None)!r}")
        print(f"  manual_status={u.manual_status!r}")
        print(f"  balance={u.balance}")
        print()
