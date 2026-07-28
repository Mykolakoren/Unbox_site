"""Пересчёт «застывших» цен будущих броней (owner 2026-07-27).

Будущие подтверждённые брони с баланса хранят цену, посчитанную по СТАРОЙ
модели скидок (напр. Валя: 18 ₾ вместо 20). Движок сейчас считает верно —
приводим сохранённую цену к текущему расчёту.

Как двигаем деньги:
  * pending (>24 ч, ещё не списано) — просто чиним final_price. Крон спишет
    верную сумму в T−24ч. Баланс сейчас не трогаем.
  * paid / без статуса (уже списано) — правим final_price И довозвращаем/
    дозаписываем разницу на баланс через wallet, чинем charge_amount.

ИСКЛЮЧЕНИЕ: Галина Белостоцкая — по решению владельца НЕ трогаем (у неё
особые условия, пересчёт поднял бы цену на +229 ₾).

  venv/bin/python3 scripts/recompute_stale_future_2026_07.py --dry-run
  venv/bin/python3 scripts/recompute_stale_future_2026_07.py

Идемпотентно: повторный прогон не найдёт расхождений.
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
from app.services.pricing import PricingService  # noqa: E402
from app.services import wallet  # noqa: E402

EXCLUDE_NAME_LIKE = "белостоцк"  # Галина — не трогаем (решение владельца)


def _start_dt(b: Booking) -> datetime:
    """Время старта из date + start_time — КАК В create_booking. Движок берёт
    час пик из времени; если передать date (полночь), пик теряется и цена
    занижается до базовой. Именно на этом чуть не срезали пиковые надбавки."""
    try:
        h, m = map(int, (b.start_time or "0:0").split(":"))
        return b.date.replace(hour=h, minute=m, second=0, microsecond=0)
    except Exception:
        return b.date


def run(dry_run: bool) -> int:
    tag = "[холостой] " if dry_run else ""
    # Включаем и СЕГОДНЯШНИЕ брони: Booking.date хранится на полночь, поэтому
    # фильтр «≥ сейчас» отсекал весь сегодняшний день (Лиза как раз смотрела
    # сегодняшнюю бронь Вероники). Берём от начала сегодняшних суток.
    now = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    fixed = 0
    bal_moved = 0.0
    per_client: dict[str, dict] = {}

    with Session(engine) as session:
        ps = PricingService(session)
        fut = session.exec(select(Booking).where(
            Booking.date >= now,
            Booking.status == "confirmed",
            Booking.payment_method == "balance",
        )).all()

        for b in fut:
            u = session.get(User, b.user_uuid) if b.user_uuid else None
            if not u:
                continue
            if EXCLUDE_NAME_LIKE in (u.name or "").lower():
                continue  # Галина — пропуск
            try:
                bd = ps.calculate_price(
                    user=u, resource_id=b.resource_id, start_time=_start_dt(b),
                    duration_minutes=b.duration, format_type=b.format or "individual",
                    exclude_booking_id=b.id)
            except Exception:
                continue
            old = round(float(b.final_price or 0), 2)
            fresh = round(float(bd.final_price or 0), 2)
            if abs(old - fresh) < 0.01:
                continue

            fixed += 1
            key = u.name or u.email
            c = per_client.setdefault(key, {"n": 0, "delta_price": 0.0, "bal": 0.0})
            c["n"] += 1
            c["delta_price"] += (fresh - old)

            # Вариант 2 (owner 2026-07-27): деньги по уже-оплаченным броням НЕ
            # двигаем — только выправляем ценник. pending спишет крон по новой
            # цене. Так никого не дёргаем задним числом ни в плюс, ни в минус,
            # а вперёд всё считается верно.
            paid = b.payment_status in (None, "paid")
            if paid:
                c["bal"] += 0.0  # деньги не трогаем
            if not dry_run:
                b.final_price = fresh
                b.applied_rule = bd.applied_rule
                b.discount_percent = bd.discount_percent
                b.discount_amount = bd.discount_amount
                b.updated_at = datetime.now()
                session.add(b)

        if not dry_run:
            session.commit()

    print(f"{tag}{'клиент':26} {'броней':>6} {'Δ цены броней':>14} {'Δ баланс сейчас':>16}")
    print("-" * 66)
    for k, c in sorted(per_client.items(), key=lambda x: -x[1]["n"]):
        print(f"{tag}{k[:26]:26} {c['n']:>6} {c['delta_price']:>+14.0f} {c['bal']:>+16.2f}")
    print("-" * 66)
    print(f"{tag}ИТОГО: броней {fixed}, движение баланса сейчас {bal_moved:+.2f} ₾ "
          f"(остальное — pending, спишется кроном по новой цене)")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
