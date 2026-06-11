"""Read-only: is Mykola's 2026-05-25 15:30 booking part of a recurring
Monday series? If yes, list all future siblings so we can cancel the
series in one go.
"""
import sys
from datetime import datetime, timedelta

sys.path.insert(0, "/var/www/unbox-beta/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.booking import Booking
from uuid import UUID

with Session(engine) as s:
    me = s.exec(select(User).where(User.email == "koren.nikolas@gmail.com")).first()
    if not me:
        print("owner not found")
        sys.exit(1)

    anchor = s.get(Booking, UUID("ad61e384" + "0" * 24))  # not a valid UUID, fallback
    # Just look up by attributes instead
    today = datetime(2026, 5, 25)
    candidates = s.exec(
        select(Booking)
        .where(Booking.user_uuid == me.id)
        .where(Booking.start_time == "15:30")
        .where(Booking.resource_id == "unbox_one_room_2")
    ).all()

    print(f"Found {len(candidates)} bookings (15:30, room 2, owner):")
    for b in sorted(candidates, key=lambda x: x.date):
        wd = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][b.date.weekday()]
        print(f"  {b.date:%Y-%m-%d %H:%M} ({wd})  status={b.status}  "
              f"rec_group={b.recurring_group_id}  id={str(b.id)[:8]}")

    # Find series via recurring_group_id from the today booking
    today_b = [c for c in candidates
               if c.date.date() == today.date() and c.status == 'confirmed']
    if today_b and today_b[0].recurring_group_id:
        gid = today_b[0].recurring_group_id
        print(f"\nFull series (group_id={gid}):")
        series = s.exec(
            select(Booking).where(Booking.recurring_group_id == gid)
        ).all()
        for b in sorted(series, key=lambda x: x.date):
            wd = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][b.date.weekday()]
            future = '⏳' if b.date >= today else '🕓'
            print(f"  {future} {b.date:%Y-%m-%d %H:%M} ({wd})  status={b.status}  res={b.resource_id}  start={b.start_time}")
