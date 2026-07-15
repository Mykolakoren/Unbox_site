"""Перевод истёкших абонементов в статус «завершён».

Раз в сутки ставит status='completed' на пулы, чей срок вышел (с учётом пауз и
особых условий flexible). ДЕНЬГИ этим скриптом не двигаются: реальный гейт —
subscription_pool.is_active() в движке цен, он и так не даёт истёкшему абонементу
покрыть бронь. Этот стамп нужен для отображения («Завершён» вместо «Активен») и
чтобы истёкшие пулы не мозолили глаза как активные.

  cd /var/www/unbox/backend && venv/bin/python3 scripts/expire_subscriptions.py [--dry-run]

Идемпотентно: уже помеченные пропускаются. Остаток часов НЕ обнуляется —
хранится для истории и для гибкого добора (flexible такой скрипт не трогает).
"""
from __future__ import annotations

import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import subscription_pool  # noqa: E402
from app.services.timeline import timeline_service  # noqa: E402


def run(dry_run: bool) -> int:
    now = datetime.utcnow()
    completed: list[tuple[str, str]] = []

    with Session(engine) as session:
        users = session.exec(select(User)).all()
        for u in users:
            sub = u.subscription
            if not sub or str(sub) in ("null", "{}"):
                continue
            # Уже завершён — пропускаем (идемпотентность).
            if subscription_pool.get(sub, "status") == "completed":
                continue
            # Реальный критерий из единого источника правды.
            if not subscription_pool.is_expired(sub, now):
                continue

            completed.append((u.email, subscription_pool.get(sub, "plan_id") or "—"))
            if not dry_run:
                u.subscription = subscription_pool.update(sub, status="completed")
                session.add(u)
                timeline_service.log_event(
                    session=session,
                    actor_id="system",
                    actor_role="system",
                    target_id=str(u.id),
                    target_type="user",
                    event_type="subscription_completed",
                    description=(
                        f"Абонемент завершён (срок истёк): "
                        f"{subscription_pool.get(sub, 'plan_id') or '—'}"
                    ),
                    metadata={"expiry_date": subscription_pool.get(sub, "expiry_date")},
                )
        if not dry_run:
            session.commit()

    tag = "[dry-run] " if dry_run else ""
    print(f"{tag}завершено абонементов: {len(completed)}")
    for email, plan in completed:
        print(f"  {email}  ({plan})")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
