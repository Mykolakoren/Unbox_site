"""
CLI: начислить недельные кредиты за ПРОШЛУЮ завершившуюся неделю.
Запускается системным cron в воскресенье ночью (после закрытия недели).

  cd /var/www/unbox/backend && venv/bin/python3 run_weekly_rebate.py [--dry-run]

Без флага — реально начисляет (кредит на баланс + проводка в кассу).
С --dry-run — только печатает что бы начислил.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from sqlmodel import Session
from app.db.session import engine
from app.services.weekly_rebate import run_weekly_rebates, last_completed_week_start

if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    ws = last_completed_week_start()
    with Session(engine) as session:
        result = run_weekly_rebates(session, ws, dry_run=dry)
    print(f"[weekly-rebate] week={result['week_start']} dry_run={result['dry_run']} "
          f"users={result['users_credited']} total={result['total_credited']}₾ "
          f"skipped_done={result['skipped_already_done']}")
    for d in result.get("details", []):
        print(f"  {d['user_name']} ({d['user_email']}): {d['rebate']}₾ "
              f"[{d['tier_percent']}%, {d['total_hours']}ч]")
