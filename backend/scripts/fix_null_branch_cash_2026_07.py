"""Чистка «ничейных» наличных — операций кассы без филиала (2026-07-21).

ЗАЧЕМ. Итог наличных, который виден в Финансах, не сходился с суммой двух
филиалов:

    Unbox One  593.20  (сходится с физпересчётом, смены закрываются в 0)
    Unbox Uni  162.65  (то же)
    ─────────────────
    физически  755.85
    показано   565.50   ← расхождение −190.35

Расхождение целиком сидит в проводках БЕЗ филиала, и оно двух сортов:

  1. −463.50 — 15 проводок «Недельная скидка за объём» (06.07–20.07).
     Скидка уходит клиенту КРЕДИТОМ НА БАЛАНС, из ящика ничего не вынимают,
     а записывалось как расход наличных. Это не деньги. Код уже исправлен
     (weekly_rebate.py → payment_method='adjustment'), здесь чиним прошлое.

  2. +273.15 — исторический хвост: старая глобальная корректировка смены
     от 01.05 (+222.15) и три наличных прихода без филиала (+51.00:
     09.06 — 20, 22.06 — 11, 15.07 — 20). Все они старше или ровесники
     физбаланса от 15.07, которым оба филиала были выставлены по факту
     пересчёта. То есть эти деньги УЖЕ посчитаны внутри филиальных остатков,
     а здесь лежат вторым экземпляром. Все закрытия смен после 15.07 прошли
     с нулевым расхождением — это подтверждает, что филиальные числа верны,
     а «ничейный» хвост лишний.

ЧТО ДЕЛАЕТ. Обе части приводит к нулю, после чего
    итог наличных == Unbox One + Unbox Uni == физическому пересчёту.
Ничего не удаляет: проводки скидок остаются в ленте (меняется только
пометка счёта), хвост гасится одной явной проводкой со ссылкой на этот файл.

    venv/bin/python3 scripts/fix_null_branch_cash_2026_07.py --dry-run
    venv/bin/python3 scripts/fix_null_branch_cash_2026_07.py

Идемпотентно: повторный запуск не найдёт что чинить и ничего не запишет.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.cashbox_transaction import CashboxTransaction  # noqa: E402

REBATE_ADMIN = "Недельный перерасчёт"
MARK = "[ЧИСТКА 2026-07-21]"


def _null_cash_total(session: Session) -> float:
    """Итог наличных по проводкам без филиала."""
    rows = session.exec(
        select(CashboxTransaction)
        .where(CashboxTransaction.branch.is_(None))  # type: ignore[union-attr]
        .where(CashboxTransaction.payment_method == "cash")
    ).all()
    return round(sum(r.amount if r.type == "income" else -r.amount for r in rows), 2)


def run(dry_run: bool) -> int:
    tag = "[холостой] " if dry_run else ""
    with Session(engine) as session:
        before = _null_cash_total(session)
        print(f"{tag}«ничейные» наличные до чистки: {before:+.2f} ₾")

        # --- 1. Скидки: 'cash' → 'adjustment' (это не деньги из ящика) ---
        rebates = session.exec(
            select(CashboxTransaction)
            .where(CashboxTransaction.payment_method == "cash")
            .where(CashboxTransaction.admin_name == REBATE_ADMIN)
        ).all()
        rebate_sum = round(sum(r.amount for r in rebates), 2)
        print(f"{tag}  1) скидок к перепометке: {len(rebates)} шт на {rebate_sum:.2f} ₾")
        if not dry_run:
            for r in rebates:
                r.payment_method = "adjustment"
                session.add(r)
            session.flush()

        # --- 2. Остаток хвоста гасим одной проводкой ---
        tail = _null_cash_total(session) if not dry_run else round(before + rebate_sum, 2)
        print(f"{tag}  2) остаток хвоста к погашению: {tail:+.2f} ₾")

        if abs(tail) >= 0.01:
            if not dry_run:
                session.add(CashboxTransaction(
                    type="expense" if tail > 0 else "income",
                    amount=abs(tail),
                    currency="GEL",
                    payment_method="cash",
                    category_id="cash_reconciliation",
                    branch=None,
                    date=datetime.utcnow(),
                    description=(
                        f"{MARK} Гашение исторического остатка наличных без филиала "
                        f"({tail:+.2f} ₾). Эти деньги уже учтены в физбалансах Unbox One "
                        f"и Unbox Uni от 15.07 — здесь лежала их копия. "
                        f"См. scripts/fix_null_branch_cash_2026_07.py"
                    ),
                    admin_id="system",
                    admin_name="Чистка кассы",
                ))
                session.flush()

        after = _null_cash_total(session) if not dry_run else 0.0
        if not dry_run:
            session.commit()
        print(f"{tag}«ничейные» наличные после чистки: {after:+.2f} ₾")
        print(f"{tag}итог наличных станет = Unbox One + Unbox Uni (физпересчёт)")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
