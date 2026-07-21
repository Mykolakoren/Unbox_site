"""Разовая фиксация стартовых остатков в ленте баланса (Шаг 3).

У клиентов баланс накопился ДО появления balance_ledger, поэтому сумма ленты
меньше баланса. Пишем каждому одну строку «стартовый остаток» на недостающую
разницу — после этого инвариант «баланс == сумма ленты» верен для всех, и
ревизор сможет ловить любое изменение баланса мимо кошелька.

  cd /var/www/unbox/backend && venv/bin/python3 scripts/ledger_baseline.py --dry-run
  cd /var/www/unbox/backend && venv/bin/python3 scripts/ledger_baseline.py

Идемпотентно: повторный запуск допишет 0 строк (разницы уже нет).
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select, func  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.balance_ledger import BalanceLedger  # noqa: E402


def run(dry_run: bool) -> int:
    written = 0
    total_delta = 0.0
    with Session(engine) as session:
        users = session.exec(select(User)).all()
        for u in users:
            bal = round(float(u.balance or 0), 2)
            existing = session.exec(
                select(func.coalesce(func.sum(BalanceLedger.delta), 0))
                .where(BalanceLedger.user_id == str(u.id))
            ).one()
            existing = round(float(existing), 2)
            delta = round(bal - existing, 2)
            if abs(delta) < 0.01:
                continue
            written += 1
            total_delta += delta
            if not dry_run:
                session.add(BalanceLedger(
                    user_id=str(u.id),
                    delta=delta,
                    balance_after=bal,
                    reason="baseline",
                    description="Стартовый остаток на момент ввода ленты операций",
                    actor_id="system",
                    actor_name="Система",
                ))
        if not dry_run:
            session.commit()

    tag = "[dry-run] " if dry_run else ""
    print(f"{tag}клиентов со стартовой строкой: {written}, суммарно {round(total_delta, 2)} ₾")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
