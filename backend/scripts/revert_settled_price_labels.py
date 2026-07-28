"""Вернуть ценник оплаченных броней к фактически списанному (2026-07-28).

Пересчёт по варианту 2 (деньги не двигаем) поменял final_price у нескольких
УЖЕ ОПЛАЧЕННЫХ сегодняшних броней, и он разошёлся с charge_amount (сколько
реально ушло с баланса). Ревизор это поймал. По варианту 2 оплаченные брони
трогать нельзя — возвращаем ценник к charge_amount, деньги не двигаем.

  venv/bin/python3 scripts/revert_settled_price_labels.py --dry-run
  venv/bin/python3 scripts/revert_settled_price_labels.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.booking import Booking  # noqa: E402


def run(dry_run: bool) -> int:
    tag = "[холостой] " if dry_run else ""
    fixed = 0
    with Session(engine) as session:
        # ТОЛЬКО сегодняшние: их задел «сегодняшний» проход пересчёта.
        # Старые расхождения final≠charge (допуслуги, ручные цены) — не наши,
        # трогать нельзя. Ревизор флагает ровно этот сегодняшний срез.
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        rows = session.exec(select(Booking).where(
            Booking.payment_method == "balance",
            Booking.status == "confirmed",
            Booking.charge_amount.is_not(None),  # type: ignore[union-attr]
            Booking.date >= today,
        )).all()
        for b in rows:
            ca = round(float(b.charge_amount), 2)
            fp = round(float(b.final_price or 0), 2)
            if abs(ca - fp) < 0.01:
                continue
            fixed += 1
            print(f"{tag}  {b.id}  final {fp} → {ca} (факт списания)")
            if not dry_run:
                b.final_price = ca
                b.updated_at = datetime.now()
                session.add(b)
        if not dry_run:
            session.commit()
    print(f"{tag}выправлено ценников: {fixed}")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
