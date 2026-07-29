"""Точечные правки Марины и Нади (owner 2026-07-29).

МАРИНА: баланс должен быть 0. Пополнение 650 ₾ (23.07) было ЗА абонемент
Профи+, но скрипт назначения его не списал — 650 зависли на балансе. Плюс
двойное списание 22.5 за бот-бронь 22.07. Списываем 650 (оплата абонемента) и
доводим до 0 (это гасит и лишние 22.5).

НАДЯ: бронь 23.07 на самом деле 1.5 ч, записана как 1 ч (админ не смог добавить
полчаса через шахматку). Продлеваем до 1.5 ч → с абонемента спишется ещё 0.5 ч,
использовано станет 4.0.

  venv/bin/python3 scripts/fix_marina_nadia_2026_07_29.py --dry-run
  venv/bin/python3 scripts/fix_marina_nadia_2026_07_29.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.services import subscription_pool, wallet  # noqa: E402

PRO_PLUS_PRICE = 650.0


def run(dry_run: bool) -> int:
    tag = "[холостой] " if dry_run else ""
    with Session(engine) as s:
        # ── МАРИНА ──
        m = s.exec(select(User).where(User.email == "marusya7busina@gmail.com")).first()
        print(f"{tag}Марина: баланс {m.balance:.2f}")
        wallet.debit(s, m, PRO_PLUS_PRICE, reason="subscription_purchase",
                     description="Оплата абонемента Профи+ (пополнение 650 ₾ от 23.07)")
        s.flush()
        # довести до ровного 0: гасит остаточное двойное списание брони 22.07
        resid = round(float(m.balance), 2)   # ожидаем -22.5
        if abs(resid) >= 0.01:
            wallet.credit(s, m, -resid, reason="correction",
                          description="Выравнивание к 0 (двойное списание брони 22.07)")
        s.flush()
        print(f"{tag}Марина: баланс стал {m.balance:.2f}")

        # ── НАДЯ: бронь 23.07 60→90 мин, +0.5 ч с абонемента ──
        n = s.exec(select(User).where(User.email.like("456541508%"))).first()
        bk = s.exec(select(Booking).where(
            Booking.user_uuid == n.id,
            Booking.date >= datetime.fromisoformat("2026-07-23"),
            Booking.date < datetime.fromisoformat("2026-07-24"),
        )).first()
        print(f"{tag}Надя 23.07: {bk.duration} мин, способ {bk.payment_method}, "
              f"спис.часов {bk.hours_deducted}")
        add_h = 0.5
        if bk.duration == 60 and bk.payment_method == "subscription":
            rem = subscription_pool.get_float(n.subscription, "remaining_hours")
            used = subscription_pool.get_float(n.subscription, "used_hours")
            if not dry_run:
                bk.duration = 90
                bk.hours_deducted = float(bk.hours_deducted or 1) + add_h
                bk.updated_at = datetime.now()
                s.add(bk)
                n.subscription = subscription_pool.update(
                    n.subscription,
                    remaining_hours=max(0.0, rem - add_h),
                    used_hours=used + add_h)
                s.add(n)
                s.flush()
            print(f"{tag}Надя: 23.07 → 90 мин, использовано "
                  f"{subscription_pool.get_float(n.subscription,'used_hours'):.1f}, "
                  f"остаток {subscription_pool.get_float(n.subscription,'remaining_hours'):.1f}")
        else:
            print(f"{tag}Надя 23.07: не 60-мин subscription — пропуск")

        if dry_run:
            s.rollback(); print(f"\n{tag}откат")
        else:
            s.commit(); print("\n✓ записано")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
