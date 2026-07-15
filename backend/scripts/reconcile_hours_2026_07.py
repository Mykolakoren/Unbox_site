"""Разовая сверка абонементов по данным Егора (2026-07-15).

Выставляет АБСОЛЮТНЫЕ значения часов и особые условия. Через subscription_pool
(оба диалекта snake+camel), а не сырой SQL — чтобы не разъехались ключи.

  cd /var/www/unbox/backend && venv/bin/python3 scripts/reconcile_hours_2026_07.py --dry-run
  cd /var/www/unbox/backend && venv/bin/python3 scripts/reconcile_hours_2026_07.py        # запись

Идемпотентно: значения абсолютные, повторный запуск не накапливает.
"""
from __future__ import annotations

import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import subscription_pool as sp  # noqa: E402
from app.services.timeline import timeline_service  # noqa: E402

NOW = datetime.utcnow()

# email -> что выставить. None-поля не трогаем.
PLAN: dict[str, dict] = {
    # Валерия: Профи+, использовано 19 из 40, до 09.08 (данные Егора).
    "ironorchid88@gmail.com": {
        "total_hours": 40.0, "used_hours": 19.0, "remaining_hours": 21.0,
        "expiry_date": "2026-08-09T00:00:00", "status": "active",
    },
    # Марина: Профи+, использовано 32 из 40, до 20.07.
    "marusya7busina@gmail.com": {
        "total_hours": 40.0, "used_hours": 32.0, "remaining_hours": 8.0,
        "expiry_date": "2026-07-20T00:00:00", "status": "active",
    },
    # Светлана: Регулярный практик, 18 из 20, ОСОБЫЕ УСЛОВИЯ — гибкий срок.
    "svetarozova76@gmail.com": {
        "total_hours": 20.0, "used_hours": 18.0, "remaining_hours": 2.0,
        "flexible": True, "status": "active",
    },
    # Надежда: абонемент истёк 09.07 — завершаем.
    "456541508@telegram.unbox": {
        "status": "completed",
    },
    # Галина Белостоцкая: новый недельный абонемент 16 ч / 160 ₾, срок +7 дней.
    # Часы сгорают по броням; персональную скидку снимаем (абонемент — приоритет).
    "1693512@gmail.com": {
        "plan_id": "WEEKLY_16H",
        "total_hours": 16.0, "used_hours": 0.0, "remaining_hours": 16.0,
        "included_formats": ["individual", "group", "intervision"],
        "expiry_date": (NOW + timedelta(days=7)).isoformat(),
        "is_frozen": False, "freeze_count": 0, "status": "active",
    },
}

# Кому дополнительно сбросить персональную скидку (перешли на абонемент).
CLEAR_PERSONAL = {"1693512@gmail.com"}


def run(dry_run: bool) -> int:
    with Session(engine) as session:
        # Актор для журнала — владелец (log_event коэрсит не-UUID в null, а колонка
        # NOT NULL). Журнал вторичен: если владельца нет, просто не пишем аудит.
        owner = session.exec(
            select(User).where(User.email == "koren.nikolas@gmail.com")
        ).first()
        actor_id = owner.id if owner else None

        audit: list[tuple] = []  # копим для журнала ПОСЛЕ денежного commit
        for email, fields in PLAN.items():
            user = session.exec(select(User).where(User.email == email)).first()
            if not user:
                print(f"  ⚠ НЕ НАЙДЕН: {email} — пропускаю")
                continue

            before = dict(user.subscription or {})
            new_sub = sp.update(user.subscription or {}, **fields)

            b_used = sp.get_float(before, "used_hours")
            b_rem = sp.get_float(before, "remaining_hours")
            a_used = sp.get_float(new_sub, "used_hours")
            a_rem = sp.get_float(new_sub, "remaining_hours")
            print(f"\n  {user.name} ({email})")
            print(f"    было:  использовано {b_used}, осталось {b_rem}")
            print(f"    стало: использовано {a_used}, осталось {a_rem}"
                  + (f", flexible={fields['flexible']}" if "flexible" in fields else "")
                  + (f", status={fields['status']}" if fields.get("status") else ""))

            if not dry_run:
                user.subscription = new_sub
                if email in CLEAR_PERSONAL:
                    user.pricing_system = "standard"
                    user.personal_discount_percent = 0
                    print("    + персональная скидка снята (перешла на абонемент)")
                session.add(user)
                audit.append((user.id, b_used, b_rem, a_used, a_rem))

        if not dry_run:
            # 1. ДЕНЬГИ — атомарно, без журнала (журнал коммитит внутри и мог бы
            #    утащить эту запись в откат, как и случилось в первый раз).
            session.commit()
            print("\n  ✓ часы записаны")

            # 2. ЖУРНАЛ — мягко: сбой аудита уже не трогает деньги.
            if actor_id is not None:
                for uid, bu, br, au, ar in audit:
                    try:
                        timeline_service.log_event(
                            session=session, actor_id=actor_id, actor_role="system",
                            target_id=str(uid), target_type="user",
                            event_type="subscription_reconciled",
                            description=f"Сверка часов абонемента (Егор, {NOW.date().isoformat()})",
                            metadata={"before": {"used": bu, "remaining": br},
                                      "after": {"used": au, "remaining": ar}},
                        )
                    except Exception as exc:  # noqa: BLE001
                        print(f"  ⚠ аудит не записан для {uid}: {exc}")

    print(f"\n{'[dry-run] ничего не записано' if dry_run else 'ГОТОВО'}")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
