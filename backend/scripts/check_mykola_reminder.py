"""Read-only: inspect Mykola's bookings today + recent reminder timestamps
to debug 2026-05-25 report 'TG reminder fired too early — bot said in 2h,
actual booking is 19:30'.
"""
import sys
from datetime import datetime, timedelta, timezone as tz_

sys.path.insert(0, "/var/www/unbox-beta/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.booking import Booking

TBS = timedelta(hours=4)
now_utc = datetime.utcnow()
now_tb = now_utc + TBS
print(f"NOW utc:     {now_utc:%Y-%m-%d %H:%M:%S}")
print(f"NOW tbilisi: {now_tb:%Y-%m-%d %H:%M:%S}")
print()

with Session(engine) as s:
    me = s.exec(select(User).where(User.email == "koren.nikolas@gmail.com")).first()
    if not me:
        print("owner user not found")
        sys.exit(1)
    print(f"User: {me.email} id={me.id} tg={me.telegram_id}\n")

    today_lo = now_tb.replace(hour=0, minute=0, second=0, microsecond=0)
    today_hi = today_lo + timedelta(days=1)
    bookings = s.exec(
        select(Booking)
        .where(Booking.user_uuid == me.id)
        .where(Booking.date >= today_lo)
        .where(Booking.date < today_hi)
    ).all()
    print(f"Bookings today ({len(bookings)}):")
    for b in sorted(bookings, key=lambda x: x.start_time):
        start_tb = b.date.replace(
            hour=int(b.start_time.split(':')[0]),
            minute=int(b.start_time.split(':')[1]),
            second=0, microsecond=0
        )
        hours_until = (start_tb - now_tb).total_seconds() / 3600
        print(f"  id={str(b.id)[:8]}  date={b.date:%Y-%m-%d %H:%M}  start={b.start_time}  "
              f"resource={b.resource_id}  status={b.status}")
        print(f"    computed start_tb={start_tb:%Y-%m-%d %H:%M}  hours from now (Tbilisi): {hours_until:.2f}")
        print(f"    reminder_sent_at: {b.reminder_sent_at}")
