"""Завести абонементы Марине и Наде + перевести их брони на абонемент.

Owner 2026-07-28:
  * Марина Бусина — Профи+ (PRO_PLUS), старт 22.07, израсходовано 3 ч.
    Её балансовые брони с 22.07: 22.07, 27.07, 03.08 (по 1 ч) = 3 ч → перевод.
  * Надежда Мирошина — Регулярный практик, старт 21.07, ~4 ч.
    Прошедшие балансовые: 21.07 (1.5 ч) + 23.07 (1 ч) + 24.07 (1 ч) = 3.5 ч.
    Две БУДУЩИЕ по 4 ч (31.07, 07.08) — по флагу --nadia-future.

Логика: назначаем абонемент с ПОЛНЫМ остатком (used=0), затем переводим
указанные брони через _convert_booking_to_subscription (возврат денег на
баланс за оплаченные + списание часов). used получится = сумма переведённых.

  venv/bin/python3 scripts/assign_subs_2026_07.py --dry-run
  venv/bin/python3 scripts/assign_subs_2026_07.py --marina
  venv/bin/python3 scripts/assign_subs_2026_07.py --nadia [--nadia-future]
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from uuid import uuid4  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.services import subscription_pool  # noqa: E402
from app.api.v1.bookings.routes import _convert_booking_to_subscription  # noqa: E402

PLANS = {
    "PRO_PLUS": dict(name="Профи+", total_hours=40, bonus_hours=2, duration_days=45,
                     discount_percent=20, formats=["individual", "group", "intervision"],
                     free_reschedules=0),
    "REGULAR_PRACTITIONER": dict(name="Регулярный практик", total_hours=20, bonus_hours=0,
                                 duration_days=30, discount_percent=15,
                                 formats=["individual"], free_reschedules=1),
}


def make_sub(plan_id: str, start: datetime) -> dict:
    p = PLANS[plan_id]
    total = p["total_hours"] + p["bonus_hours"]
    expiry = start + timedelta(days=p["duration_days"])
    return subscription_pool.update({}, **{
        "id": str(uuid4()), "plan_id": plan_id, "name": p["name"],
        "total_hours": float(p["total_hours"]), "bonus_hours": p["bonus_hours"],
        "remaining_hours": float(total), "used_hours": 0.0,
        "free_reschedules": p["free_reschedules"], "expiry_date": expiry.isoformat(),
        "is_frozen": False, "freeze_count": 0, "discount_percent": p["discount_percent"],
        "included_formats": p["formats"], "status": "active",
    })


def assign(session, email, plan_id, start_iso, convert_dates, dry_run, owner):
    u = session.exec(select(User).where(User.email == email)).first()
    if not u:
        print(f"  ⚠ не найден: {email}"); return
    start = datetime.fromisoformat(start_iso)
    print(f"\n{u.name}: {PLANS[plan_id]['name']}, старт {start.date()}, "
          f"срок до {(start + timedelta(days=PLANS[plan_id]['duration_days'])).date()}")
    print(f"  баланс до: {u.balance:.2f}")
    u.subscription = make_sub(plan_id, start)
    session.add(u)
    session.flush()  # чтобы конвертация видела активный абонемент

    total_ref = 0.0
    for d in convert_dates:
        rows = session.exec(select(Booking).where(
            Booking.user_uuid == u.id, Booking.status == "confirmed",
            Booking.payment_method == "balance",
            Booking.date >= datetime.fromisoformat(d),
            Booking.date < datetime.fromisoformat(d) + timedelta(days=1),
        )).all()
        for b in rows:
            try:
                r = _convert_booking_to_subscription(session, b, owner)
                total_ref += r["refunded_to_balance"]
                print(f"  {b.date.date()} {b.start_time} {b.duration//60}ч → "
                      f"возврат {r['refunded_to_balance']:.1f}, остаток часов {r['remaining_hours_after']:.1f}")
            except ValueError as e:
                print(f"  ⚠ {b.date.date()} {b.start_time}: {e}")

    session.flush()  # НЕ refresh: refresh сбросил бы непроведённые правки
    print(f"  ИТОГ: часов использовано {subscription_pool.get_float(u.subscription,'used_hours'):.1f}, "
          f"остаток {subscription_pool.get_float(u.subscription,'remaining_hours'):.1f}, "
          f"баланс {u.balance:.2f} (возвращено {total_ref:.1f})")


def run(argv) -> int:
    dry = "--dry-run" in argv
    do_marina = "--marina" in argv or dry
    do_nadia = "--nadia" in argv or dry
    nadia_future = "--nadia-future" in argv
    with Session(engine) as s:
        owner = s.exec(select(User).where(User.email == "koren.nikolas@gmail.com")).first()
        sp = s.begin_nested() if dry else None
        if do_marina:
            assign(s, "marusya7busina@gmail.com", "PRO_PLUS", "2026-07-22",
                   ["2026-07-22", "2026-07-27", "2026-08-03"], dry, owner)
        if do_nadia:
            dates = ["2026-07-21", "2026-07-23", "2026-07-24"]
            if nadia_future:
                dates += ["2026-07-31", "2026-08-07"]
            assign(s, "456541508@telegram.unbox", "REGULAR_PRACTITIONER", "2026-07-21",
                   dates, dry, owner)
        if dry:
            sp.rollback(); print("\n[холостой] откат — ничего не записано")
        else:
            s.commit(); print("\n✓ записано")
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv))
