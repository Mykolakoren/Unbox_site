"""Касса Unbox One — корректировка баланса на -186 ₾ (вариант A).

Создаёт одну expense-транзакцию с описанием "Корректировка баланса (тех.
расхождение)". Это закроет +186 ₾ дисбаланс, обнаруженный после сверки
истории операций. Источник дисбаланса не отслежен (вариант B — drill-down
по истории — отклонён владельцем 2026-05-23).

Запуск:
  ssh root@138.68.111.248
  cd /var/www/unbox/backend && .venv/bin/python scripts/fix_cashbox_one_186.py --apply
"""
import sys
import argparse
from datetime import datetime

sys.path.insert(0, "/var/www/unbox/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.cashbox_transaction import CashboxTransaction
from app.models.user import User

AMOUNT = 186.0
CURRENCY = "GEL"
BRANCH = "Unbox One"  # display-name as stored in CashboxTransaction.branch
DESCRIPTION = "Корректировка баланса (тех. расхождение, 2026-05-23)"
PAYMENT_METHOD = "cash"  # касса наличные

p = argparse.ArgumentParser()
p.add_argument("--apply", action="store_true")
args = p.parse_args()

with Session(engine) as s:
    # Найти owner-аккаунт для admin_id (Mykola)
    owner = s.exec(select(User).where(User.role == "owner")).first()
    if not owner:
        print("ERROR: owner user not found")
        sys.exit(1)
    print(f"Admin: {owner.email} ({owner.id})")
    print(f"Branch: {BRANCH!r}  Method: {PAYMENT_METHOD}  Amount: -{AMOUNT} {CURRENCY}")
    print(f"Description: {DESCRIPTION}")

    if not args.apply:
        print("\nDRY-RUN — pass --apply to commit")
        sys.exit(0)

    tx = CashboxTransaction(
        type="expense",
        amount=AMOUNT,
        currency=CURRENCY,
        payment_method=PAYMENT_METHOD,
        branch=BRANCH,
        description=DESCRIPTION,
        date=datetime.now(),
        admin_id=str(owner.id),
        admin_name=(owner.name or owner.email or "owner"),
    )
    s.add(tx)
    s.commit()
    s.refresh(tx)
    print(f"\nCommitted: tx_id={tx.id}")
