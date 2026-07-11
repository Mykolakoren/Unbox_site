"""CLI: сохранить помесячный снимок owner-метрик за ПРОШЛЫЙ месяц.
Запускается cron 1-го числа ночью.

  cd /var/www/unbox/backend && venv/bin/python3 run_monthly_snapshot.py
"""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))

from sqlmodel import Session
from app.db.session import engine
from app.api.v1.analytics import save_monthly_snapshot

if __name__ == "__main__":
    today = datetime.utcnow().date()
    prev = today.replace(day=1) - timedelta(days=1)  # последний день прошлого месяца
    with Session(engine) as session:
        row = save_monthly_snapshot(session, prev.year, prev.month)
    print(f"[monthly-snapshot] {row.month}: revenue={row.revenue}₾ bookings={row.bookings} "
          f"hours={row.hours} occupancy={row.occupancy_pct}%")
