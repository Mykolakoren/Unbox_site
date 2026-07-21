"""Разнесение «ничейных» операций кассы по филиалам (решение владельца 21.07.2026).

Владелец расписал 14 операций без филиала:
    Unbox Uni  — строки 1, 2, 3, 8, 11, 12, 13, 14
    Unbox One  — строки 6, 9, 10
    общее по проекту (филиал не ставим) — 4, 5, 7 (расходы на разработку портала)

ТРИ ЧАСТИ:

1. Карты (TBC/BOG) — просто проставляем филиал. Карточные счета руками не
   пересчитывают, поэтому общий итог не меняется, деньги лишь попадают в
   нужный раздел.

2. Наличные — тоже проставляем филиал, НО гасим влияние на остаток. Ящики
   обоих филиалов выставлены по физическому пересчёту (BASELINE-FIX 14.07)
   и с тех пор смены закрываются в ноль — этим числам можно верить. Если
   просто добавить туда исторические приходы, система покажет больше, чем
   лежит в ящике, и на ближайшем закрытии всплывёт фантомная недостача
   (One −233.15, Uni −40). Поэтому на каждый филиал пишем одну гасящую
   проводку с объяснением.

3. Недельные скидки (15 шт, 463.50) — филиал им не нужен: это вообще не
   деньги, а скидки, ушедшие клиентам на баланс. Снимаем с них пометку
   «наличные» → 'adjustment'. Код-причина уже исправлена (weekly_rebate.py).

После прогона: итог наличных == Unbox One + Unbox Uni == физическому
пересчёту, «ничейных» наличных не остаётся.

    venv/bin/python3 scripts/assign_null_branch_2026_07.py --dry-run
    venv/bin/python3 scripts/assign_null_branch_2026_07.py

Идемпотентно: повторный запуск не найдёт что менять.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.cashbox_transaction import CashboxTransaction  # noqa: E402

ONE = "Unbox One"
UNI = "Unbox Uni"
REBATE_ADMIN = "Недельный перерасчёт"
MARK = "[РАЗНЕСЕНИЕ 2026-07-21]"

# (дата, счёт, сумма, филиал) — по списку, утверждённому владельцем.
# Дата+счёт+сумма однозначно определяют строку среди операций без филиала.
ASSIGN = [
    ("2026-03-10", "card_bog", 350.0, UNI),   # 1  Марина Бусина, абонемент
    ("2026-03-10", "card_tbc", 36.0, UNI),    # 2  Михаил Стефанович
    ("2026-03-21", "card_tbc", 30.0, UNI),    # 3  Алексей Ивлев
    ("2026-05-01", "cash", 222.15, ONE),      # 6  правка смены Валентины
    ("2026-06-09", "cash", 20.0, UNI),        # 8  Анна Зараковская
    ("2026-06-22", "cash", 11.0, ONE),        # 9  без клиента
    ("2026-06-23", "card_tbc", 20.0, ONE),    # 10 Сергей Малюков
    ("2026-07-08", "card_tbc", 160.0, UNI),   # 11 Кристина Ропель
    ("2026-07-15", "cash", 20.0, UNI),        # 12 Тамрико Габаидзе
    ("2026-07-19", "card_bog", 20.0, UNI),    # 13 пополнение Зараковской
    ("2026-07-20", "card_bog", 20.0, UNI),    # 14 пополнение Стефановича
]


def _cash_total(session: Session, branch) -> float:
    q = select(CashboxTransaction).where(CashboxTransaction.payment_method == "cash")
    q = q.where(CashboxTransaction.branch == branch) if branch else \
        q.where(CashboxTransaction.branch.is_(None))  # type: ignore[union-attr]
    rows = session.exec(q).all()
    return round(sum(r.amount if r.type == "income" else -r.amount for r in rows), 2)


def run(dry_run: bool) -> int:
    tag = "[холостой] " if dry_run else ""
    with Session(engine) as session:
        print(f"{tag}наличные ДО:  One={_cash_total(session, ONE):>9.2f}  "
              f"Uni={_cash_total(session, UNI):>8.2f}  без филиала={_cash_total(session, None):>8.2f}")

        # --- 1+2. Проставляем филиал ---
        moved_cash = {ONE: 0.0, UNI: 0.0}
        assigned = 0
        for day, method, amount, branch in ASSIGN:
            row = session.exec(
                select(CashboxTransaction)
                .where(CashboxTransaction.branch.is_(None))  # type: ignore[union-attr]
                .where(CashboxTransaction.payment_method == method)
                .where(CashboxTransaction.amount == amount)
                .where(CashboxTransaction.date >= datetime.fromisoformat(day))
                .where(CashboxTransaction.date < datetime.fromisoformat(day + "T23:59:59"))
            ).first()
            if row is None:
                print(f"{tag}  ⚠ не найдена: {day} {method} {amount} → пропускаю")
                continue
            assigned += 1
            if method == "cash":
                moved_cash[branch] += row.amount if row.type == "income" else -row.amount
            if not dry_run:
                row.branch = branch
                session.add(row)
        print(f"{tag}  1) проставлен филиал: {assigned} из {len(ASSIGN)}")
        print(f"{tag}     из них наличными: One {moved_cash[ONE]:+.2f}, Uni {moved_cash[UNI]:+.2f}")

        # --- 2b. Гасим влияние наличных на остаток филиала ---
        for branch in (ONE, UNI):
            delta = round(moved_cash[branch], 2)
            if abs(delta) < 0.01:
                continue
            print(f"{tag}  2) гашение по {branch}: {-delta:+.2f} ₾")
            if not dry_run:
                session.add(CashboxTransaction(
                    type="expense" if delta > 0 else "income",
                    amount=abs(delta),
                    currency="GEL",
                    payment_method="cash",
                    category_id="cash_reconciliation",
                    branch=branch,
                    date=datetime.utcnow(),
                    description=(
                        f"{MARK} Гашение исторических наличных, разнесённых по филиалам "
                        f"({delta:+.2f} ₾). Остаток ящика выставлен по физпересчёту 14.07 и с тех пор "
                        f"смены закрываются в ноль — эти деньги уже в нём учтены. Проводка нужна, "
                        f"чтобы разнесение не создало фантомную недостачу при закрытии смены."
                    ),
                    admin_id="system",
                    admin_name="Разнесение кассы",
                ))

        # --- 3. Недельные скидки: это не наличные ---
        rebates = session.exec(
            select(CashboxTransaction)
            .where(CashboxTransaction.payment_method == "cash")
            .where(CashboxTransaction.admin_name == REBATE_ADMIN)
        ).all()
        print(f"{tag}  3) скидок перепомечено: {len(rebates)} шт "
              f"на {round(sum(r.amount for r in rebates), 2):.2f} ₾")
        if not dry_run:
            for r in rebates:
                r.payment_method = "adjustment"
                session.add(r)
            session.commit()

        if dry_run:
            one = _cash_total(session, ONE)
            uni = _cash_total(session, UNI)
            nul = _cash_total(session, None) - moved_cash[ONE] - moved_cash[UNI] \
                + round(sum(r.amount for r in rebates), 2)
            print(f"{tag}наличные ПОСЛЕ: One={one:>9.2f}  Uni={uni:>8.2f}  без филиала={nul:>8.2f}")
        else:
            print(f"наличные ПОСЛЕ: One={_cash_total(session, ONE):>9.2f}  "
                  f"Uni={_cash_total(session, UNI):>8.2f}  "
                  f"без филиала={_cash_total(session, None):>8.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
