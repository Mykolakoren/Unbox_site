"""Заморозка по тарифу — выставить бюджет дней уже купленным абонементам (01.10).

Решение владельца 01.10 («как на сайте»): бюджет дней паузы на абонемент —
Пробный 0, Тёплый старт 0, Регулярный практик 7, Профи+ 30, Групповой 0;
бюджет делится на несколько пауз, пауза по сроку снимается сама.
До этого любой тариф получал одну паузу на 7 дней.

Что делает скрипт (только действующие и замороженные, истёкшие не трогает):
  * freeze_days_total — по тарифу (plan_id); тариф не из каталога → 0;
  * пауза уже была (freeze_count ≥ 1) и сейчас не идёт → freeze_days_used = 7;
  * freeze_days_left — для экрана;
  * идущие сейчас паузы НЕ трогает (ревью 01.10) — только показывает в отчёте:
    это старые паузы, их снимает администратор, и срок продлевается по-старому
    на полный факт паузы (subscription_perks.end_freeze).

  cd /var/www/unbox/backend && venv/bin/python3 scripts/tariffs_freeze_2026_10.py --dry-run
  cd /var/www/unbox/backend && venv/bin/python3 scripts/tariffs_freeze_2026_10.py --apply

Без --apply ничего не пишет (dry-run). Пишет только через subscription_pool
(оба диалекта полей). Идемпотентно. Деньги и часы не трогает.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import subscription_perks as perks  # noqa: E402
from app.services import subscription_pool  # noqa: E402


def plan_changes(sub: dict | None, now: datetime) -> tuple[dict, str] | None:
    """(поля для записи, пояснение) или None — не трогаем."""
    if not sub or subscription_pool.is_expired(sub, now):
        return None
    total = perks._days(perks.plan_of(sub).get("freeze_days", 0))
    stored_used = subscription_pool.get(sub, "freeze_days_used")
    frozen = bool(subscription_pool.get(sub, "is_frozen", False))
    if stored_used is not None:
        used = perks._days(stored_used)
    elif int(subscription_pool.get_float(sub, "freeze_count")) >= 1 and not frozen:
        used = perks.LEGACY_FREEZE_DAYS
    else:
        used = 0.0
    left = perks._days(total - used)
    fields: dict = {"freeze_days_total": total, "freeze_days_used": used, "freeze_days_left": left}
    note = f"бюджет {total:g} дн., израсходовано {used:g}, осталось {left:g}"

    if frozen:
        # Идущую паузу не трогаем — только в отчёт (пустые поля = не писать).
        at = subscription_pool._parse_dt(subscription_pool.get(sub, "frozen_at"))
        until = subscription_pool._parse_dt(subscription_pool.get(sub, "frozen_until"))
        kind = "новая (по бюджету)" if perks.is_budget_pause(sub) else "старая (до 01.10)"
        return {}, (f"НА ПАУЗЕ, не трогаем: {kind}, с {at:%d.%m} " if at else f"НА ПАУЗЕ, не трогаем: {kind} ") + \
            (f"до {until:%d.%m}" if until else "без срока") + f"; бюджет тарифа {total:g} дн."

    same = all(
        (subscription_pool.get(sub, k) == v) if not isinstance(v, float)
        else (subscription_pool.get(sub, k) is not None and abs(float(subscription_pool.get(sub, k)) - v) < 0.005)
        for k, v in fields.items()
    )
    return None if same else (fields, note)


def run(apply: bool) -> int:
    now = datetime.utcnow()
    rows = []
    with Session(engine) as session:
        for u in session.exec(select(User)).all():
            ch = plan_changes(u.subscription, now)
            if ch is None:
                continue
            rows.append((u.email, subscription_pool.get(u.subscription, "plan_id") or "—", ch[1]))
            if apply and ch[0]:
                locked = session.exec(
                    select(User).where(User.id == u.id).with_for_update()
                    .execution_options(populate_existing=True)
                ).one()
                ch = plan_changes(locked.subscription, now)
                if ch is None or not ch[0]:
                    continue
                locked.subscription = subscription_pool.update(locked.subscription, **ch[0])
                session.add(locked)
        if apply:
            session.commit()

    tag = "" if apply else "[dry-run] "
    print(f"{tag}абонементов к обновлению: {len(rows)}")
    for email, plan, note in rows:
        print(f"  {email:40s} {plan:22s} {note}")
    if not apply:
        print("Ничего не записано. Чтобы применить — запустить с --apply (после согласия владельца).")
    return 0


if __name__ == "__main__":
    sys.exit(run("--apply" in sys.argv and "--dry-run" not in sys.argv))
