"""СТОРОЖ: бронь задним числом в закрытую неделю доначисляет недельную скидку (25.10).

Скидка за объём начисляется кроном в пн 01:00 за прошлую неделю, один раз на
клиента. Старший админ/владелец ставит брони до 72 ч назад — в пн–ср это
попадает в уже посчитанную неделю, часов у клиента больше, а скидка оставалась
старой. Теперь: пересчёт этой недели для этого клиента и доначисление РАЗНИЦЫ;
меньше — не забираем; повтор — без двойного начисления.

    python3 backend/tests/guard_rebate_topup_2026_10.py
"""
import os
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402

WEEK = date(2026, 9, 28)  # пн; «сейчас» в стенде — пн 05.10 10:00


def _paid_booking(s, u, day, start, minutes):
    from app.models.booking import Booking
    from app.services.pricing import PricingService
    h, m = map(int, start.split(":"))
    dt = datetime(day.year, day.month, day.day)
    q = PricingService(s).calculate_price(user=u, resource_id="room_1", start_time=dt.replace(hour=h, minute=m),
                                          duration_minutes=minutes, format_type="individual", ignore_subscription=True)
    b = Booking(resource_id="room_1", location_id="unbox_uni", date=dt, start_time=start, duration=minutes,
                status="confirmed", final_price=q.final_price, base_price=q.base_price, applied_rule=q.applied_rule,
                payment_method="balance", payment_status="paid", format="individual",
                user_id=u.email, user_uuid=u.id, charge_amount=q.final_price)
    s.add(b); s.commit()
    return b


def test_backdated_booking_tops_up_closed_week_once():
    from sqlmodel import select
    from app.models.balance_ledger import BalanceLedger
    from app.models.weekly_rebate import WeeklyRebate
    from app.services import weekly_rebate as wr
    from app.api.v1.bookings import routes
    with H.frozen_time():
        s = H._db()
        owner = H._user(s, role="owner", name="Владелец", balance=0.0)
        c = H._user(s, role="specialist", name="Клиент", balance=1000.0)
        # 10 часовых броней (не подряд — без скидки за длительность) → тариф 10 %.
        for i in range(5):
            _paid_booking(s, c, WEEK + timedelta(days=i), "11:00", 60)
            _paid_booking(s, c, WEEK + timedelta(days=i), "15:00", 60)
        first = wr.run_weekly_rebates(s, WEEK, dry_run=False)
        assert first["users_credited"] == 1, first
        row = s.exec(select(WeeklyRebate).where(WeeklyRebate.user_id == c.id)).one()
        old_amount, old_tier = float(row.amount), row.tier_percent
        assert old_tier == 10

        # Владелец ставит бронь задним числом: вс 04.10 18:00, 1 ч → 11 ч → тариф 25 %.
        H._create(s, owner, c, days=-1, start="18:00", minutes=60)
        s.expire_all()
        row = s.exec(select(WeeklyRebate).where(WeeklyRebate.user_id == c.id)).one()
        assert row.tier_percent == 25 and float(row.amount) > old_amount, \
            f"скидка не доначислена: {old_amount} → {row.amount}, тариф {row.tier_percent}"
        topups = s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(c.id),
                                                    BalanceLedger.reason == "weekly_rebate")).all()
        assert len(topups) == 2, "ждали: начисление крона + одно доначисление"
        assert abs(sum(t.delta for t in topups) - float(row.amount)) < 0.005, "лента ≠ итог начисления за неделю"

        # Повтор пересчёта — без второго доначисления.
        b = s.exec(select(routes.Booking).where(routes.Booking.user_uuid == c.id).order_by(routes.Booking.date.desc())).first()
        routes._topup_weekly_rebate_if_closed_week(s, b, c)
        s.expire_all()
        assert len(s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(c.id),
                                                      BalanceLedger.reason == "weekly_rebate")).all()) == 2


def test_current_week_is_left_to_cron():
    from sqlmodel import select
    from app.models.weekly_rebate import WeeklyRebate
    with H.frozen_time():
        s = H._db()
        owner = H._user(s, role="owner", name="Владелец", balance=0.0)
        c = H._user(s, role="specialist", name="Клиент", balance=1000.0)
        H._create(s, owner, c, days=0, start="08:00", minutes=120)   # сегодня, неделя ещё идёт
        assert not s.exec(select(WeeklyRebate)).all(), "текущую неделю считает крон, а не бронь"


def test_never_claws_back():
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "services", "weekly_rebate.py"), encoding="utf-8").read()
    i = src.index("if existing and topup:")
    body = src[i:i + 600]
    assert "if delta < MIN_REBATE_GEL:" in body and "wallet.debit" not in body, "доначисление не должно забирать"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:500]}")
                traceback.print_exc(limit=5)
    sys.exit(1 if fails else 0)
