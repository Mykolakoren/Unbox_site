"""Переносы позже суток по абонементу — выставить счётчик уже купленным (01.10).

Решение владельца 01.10: бесплатных переносов позже суток (не позже чем за
3 ч) по абонементу — Тёплый старт 1, Регулярный практик 2, Профи+ 3.
До этого счётчик free_reschedules только показывался и НИКОГДА не тратился
(стоял Тёплый 0, Регулярный 1, Профи+ 0). Скрипт выставляет действующим
абонементам этих тарифов число по новому правилу минус уже потраченное
(free_reschedules_used — после выката его тратит reschedule_booking).

  cd /var/www/unbox/backend && venv/bin/python3 scripts/tariffs_reschedules_2026_10.py --dry-run
  cd /var/www/unbox/backend && venv/bin/python3 scripts/tariffs_reschedules_2026_10.py --apply

Без --apply ничего не пишет (dry-run). Пишет только через subscription_pool
(оба диалекта полей). Идемпотентно: повторный запуск ничего не меняет.
Деньги и часы не трогает.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import subscription_pool  # noqa: E402
from app.services.subscription_sale import PLANS  # noqa: E402

TARGET_PLANS = ("WARM_START", "REGULAR_PRACTITIONER", "PRO_PLUS")


def plan_changes(sub: dict | None, now: datetime) -> dict | None:
    """Какие поля пула поменять (или None — не трогаем)."""
    if not sub or not subscription_pool.is_active(sub, now):
        return None
    plan_id = str(subscription_pool.get(sub, "plan_id") or "")
    if plan_id not in TARGET_PLANS:
        return None
    used = int(subscription_pool.get_float(sub, "free_reschedules_used"))
    want = max(0, int(PLANS[plan_id]["free_reschedules"]) - used)
    have = subscription_pool.get(sub, "free_reschedules")
    have_used = subscription_pool.get(sub, "free_reschedules_used")
    if have is not None and int(float(have)) == want and have_used is not None:
        return None
    return {"free_reschedules": want, "free_reschedules_used": used}


def run(apply: bool) -> int:
    now = datetime.utcnow()
    rows = []
    with Session(engine) as session:
        for u in session.exec(select(User)).all():
            fields = plan_changes(u.subscription, now)
            if fields is None:
                continue
            before = subscription_pool.get(u.subscription, "free_reschedules")
            rows.append((u.email, subscription_pool.get(u.subscription, "plan_id"), before, fields["free_reschedules"]))
            if apply:
                # Строка под замком: одновременный перенос не потеряет трату.
                locked = session.exec(
                    select(User).where(User.id == u.id).with_for_update()
                    .execution_options(populate_existing=True)
                ).one()
                fields = plan_changes(locked.subscription, now)
                if fields is None:
                    continue
                locked.subscription = subscription_pool.update(locked.subscription, **fields)
                session.add(locked)
        if apply:
            session.commit()

    tag = "" if apply else "[dry-run] "
    print(f"{tag}абонементов к обновлению: {len(rows)}")
    for email, plan, before, after in rows:
        print(f"  {email:40s} {plan:22s} переносов позже суток: {before!s:>4} → {after}")
    if not apply:
        print("Ничего не записано. Чтобы применить — запустить с --apply (после согласия владельца).")
    return 0


if __name__ == "__main__":
    sys.exit(run("--apply" in sys.argv and "--dry-run" not in sys.argv))
