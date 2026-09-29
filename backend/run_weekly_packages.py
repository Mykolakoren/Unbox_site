"""
CLI: выдать недельные пакеты часов на новую неделю (см. app/services/weekly_package.py).
Запускается системным cron в вс 00:00 по Тбилиси (сб 20:00 UTC).

  cd /var/www/unbox/backend && venv/bin/python3 run_weekly_packages.py [--dry-run]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlmodel import Session  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.services.weekly_package import roll_weekly_packages  # noqa: E402

if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    with Session(engine) as session:
        rows = roll_weekly_packages(session, dry_run=dry)
    print(f"[weekly-packages] dry_run={dry} rows={len(rows)}")
    for r in rows:
        print("  " + ", ".join(f"{k}={v}" for k, v in r.items()))
