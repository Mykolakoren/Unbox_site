"""Правила брони — в ОДНОМ месте (владелец 12.10: «чинить причины, а не симптомы»).

Раньше правило «срочная бронь — на подтверждение админа» жило только в
create_booking, и его обходили корзина, серия, продление серии, перенос и
перенос сессии в CRM (аудит 12.10). Здесь — само правило; пути бронирования и
переноса зовут его, а не держат свою копию.

  * is_hot_start — начало брони в «срочном» окне: меньше 12 ч до начала (в
    субботу и воскресенье — 24 ч) или бронь, сделанная после 21:00 на завтра
    с началом до 12:00 (владелец 06.10: админы должны успеть спланировать
    выход на работу утром).
  * HOT_MOVE_REFUSAL — ответ не-админу, который переносит бронь в это окно:
    перенос на ближайшие часы делает администратор.

Время — Тбилиси (UTC+4), брони хранят день и «HH:MM» по Тбилиси.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

TB = timedelta(hours=4)

HOT_MOVE_REFUSAL = (
    "Перенос на ближайшие часы (меньше 12 ч до начала, в выходные — 24 ч, или вечером "
    "после 21:00 на утро) подтверждает администратор. Напишите в Telegram @UnboxCenter — "
    "администратор перенесёт."
)


def hot_threshold_hours(start_tb: datetime) -> int:
    """12 ч в будни, 24 ч в субботу и воскресенье (спека 15.05)."""
    return 24 if start_tb.weekday() >= 5 else 12


def is_hot_start(start_tb: datetime, now_utc: Optional[datetime] = None) -> bool:
    """Начало брони (`start_tb` — Тбилиси, без пояса) попадает в «срочное» окно."""
    now = now_utc or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    if start_tb.tzinfo is None:
        start_utc = (start_tb - TB).replace(tzinfo=timezone.utc)
    else:
        start_utc = start_tb.astimezone(timezone.utc)
        start_tb = (start_utc + TB).replace(tzinfo=None)
    diff_hours = (start_utc - now).total_seconds() / 3600.0
    now_tb = (now + TB).replace(tzinfo=None)
    evening_next_morning = (
        now_tb.hour >= 21
        and start_tb.date() == (now_tb + timedelta(days=1)).date()
        and start_tb.hour < 12
    )
    return (0 < diff_hours <= hot_threshold_hours(start_tb)) or (diff_hours > 0 and evening_next_morning)


def start_tb_of(booking_date: datetime, start_time: str) -> datetime:
    """День брони (полночь по Тбилиси) + «HH:MM» → начало по Тбилиси."""
    hh, mm = (int(x) for x in str(start_time).split(":")[:2])
    return booking_date.replace(hour=hh, minute=mm, second=0, microsecond=0)
