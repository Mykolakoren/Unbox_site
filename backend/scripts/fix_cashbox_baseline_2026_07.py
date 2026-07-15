"""Разовое выправление касс к физическому пересчёту (2026-07-15).

Бухгалтерский итог кассы (сумма всех приход−расход с начала времён) уполз от
реального остатка в ящике, потому что авто-поправка при закрытии смены равнялась
на внутреннюю оконную цифру, а не на лайфтайм-сумму. Владелец подтвердил реальные
остатки на утро: UNI 150.30 ₾, ONE 212.20 ₾ (совпадает с чистым закрытием 14.07).

Вставляем ОДНУ корректировочную проводку на кассу, датой последнего закрытия —
чтобы сегодняшние движения легли сверху правильно, а лайфтайм-остаток сошёлся
с физическим. Категория cash_reconciliation (как штатные поправки) — она
исключена из оконного расчёта смен, поэтому математику закрытия не трогает.

  cd /var/www/unbox/backend && venv/bin/python3 scripts/fix_cashbox_baseline_2026_07.py --dry-run
  cd /var/www/unbox/backend && venv/bin/python3 scripts/fix_cashbox_baseline_2026_07.py

Идемпотентно: помечает проводки MARKER и повторно не вставляет.
"""
from __future__ import annotations

import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import case, func  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.cashbox_transaction import CashboxTransaction  # noqa: E402
from app.models.shift_report import ShiftReport  # noqa: E402
from app.models.user import User  # noqa: E402

MARKER = "[BASELINE-FIX 2026-07-15]"
RECON_CAT = "cash_reconciliation"

# Филиал -> реальный остаток нал на утро (подтверждено владельцем).
TARGETS = {
    "Unbox Uni": 150.30,
    "Unbox One": 212.20,
}


def run(dry_run: bool) -> int:
    with Session(engine) as session:
        owner = session.exec(
            select(User).where(User.email == "koren.nikolas@gmail.com")
        ).first()
        admin_id = str(owner.id) if owner else "system"
        admin_name = "Выправление касс (owner)"

        for branch, target in TARGETS.items():
            # Уже правили? — не дублируем.
            already = session.exec(
                select(func.count(CashboxTransaction.id))
                .where(CashboxTransaction.branch == branch)
                .where(CashboxTransaction.description.like(f"%{MARKER}%"))
            ).one()
            if int(already) > 0:
                print(f"  {branch}: уже выправлено ранее — пропускаю")
                continue

            # Момент последнего закрытия — сюда ставим дату проводки.
            last_close = session.exec(
                select(ShiftReport).where(ShiftReport.branch == branch)
                .order_by(ShiftReport.shift_end.desc()).limit(1)
            ).first()
            if not last_close:
                print(f"  {branch}: нет закрытий — пропускаю")
                continue
            close_dt = last_close.shift_end

            # Лайфтайм нал по кассе ДО (и на момент) закрытия.
            cur = session.exec(
                select(func.coalesce(func.sum(
                    case((CashboxTransaction.type == "income", CashboxTransaction.amount),
                         else_=-CashboxTransaction.amount)), 0))
                .where(CashboxTransaction.payment_method == "cash")
                .where(CashboxTransaction.branch == branch)
                .where(CashboxTransaction.date <= close_dt)
            ).one()
            cur = round(float(cur), 2)
            delta = round(target - cur, 2)

            print(f"\n  {branch}")
            print(f"    накоплено к закрытию: {cur:.2f} ₾")
            print(f"    надо (факт):          {target:.2f} ₾")
            print(f"    поправка:             {delta:+.2f} ₾")

            if abs(delta) < 0.01:
                print("    уже сходится — проводка не нужна")
                continue

            if not dry_run:
                tx = CashboxTransaction(
                    type="income" if delta > 0 else "expense",
                    amount=abs(delta),
                    currency="GEL",
                    payment_method="cash",
                    category_id=RECON_CAT,
                    description=(
                        f"{MARKER} Выправление остатка кассы к физическому пересчёту. "
                        f"Было по учёту {cur:.2f} ₾, факт на утро {target:.2f} ₾."
                    ),
                    branch=branch,
                    date=close_dt,
                    admin_id=admin_id,
                    admin_name=admin_name,
                )
                session.add(tx)

        if not dry_run:
            session.commit()

    print(f"\n{'[dry-run] ничего не записано' if dry_run else 'ГОТОВО'}")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
