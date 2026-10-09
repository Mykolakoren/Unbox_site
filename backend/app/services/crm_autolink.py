"""Psy-CRM: сессия ↔ аренда кабинета в одно и то же время (этап 3 «одного
календаря», владелец 09.10).

Сессия хранит время по Гринвичу (UTC-naive), бронь — день и «HH:MM» по
Тбилиси. Раньше подсказка «Совпадения по времени» сравнивала их напрямую и
искала пары со сдвигом на 4 часа (на проде 09.10: 3 ложные пары вместо 41
настоящей).

find_pairs — пары «сессия без кабинета ↔ своя аренда без сессии» с одинаковым
началом по Тбилиси (окно: 30 дней назад и всё будущее).
auto_link  — привязывает ТОЛЬКО однозначные пары: на это время ровно одна
свободная аренда и ровно одна сессия, а у аренды не записан другой клиент.
Остальные остаются подсказкой «Совпадения по времени» — решает специалист.
Деньги не двигаются: привязка = session.booking_id + is_booked (как кнопка
«Объединить» и «Привязать к вашей аренде»).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import or_
from sqlmodel import Session, select

from app.models.booking import Booking
from app.models.therapy_session import TherapySession

TZ = timedelta(hours=4)  # Тбилиси
LOOKBACK_DAYS = 30
CANCELLED = ("CANCELLED_CLIENT", "CANCELLED_THERAPIST")


def _key_session(ts: TherapySession) -> Optional[tuple[str, str]]:
    try:
        t = ts.date + TZ
        return (t.strftime("%Y-%m-%d"), t.strftime("%H:%M"))
    except Exception:  # noqa: BLE001
        return None


def _key_booking(b: Booking) -> Optional[tuple[str, str]]:
    try:
        return (b.date.strftime("%Y-%m-%d"), b.start_time)
    except Exception:  # noqa: BLE001
        return None


def find_pairs(session: Session, user, now: Optional[datetime] = None) -> list[dict]:
    """Все пары с одинаковым началом. Поле unique — пару можно связать сама."""
    now = now or datetime.utcnow()
    since = now - timedelta(days=LOOKBACK_DAYS)
    uid = str(user.id)
    sessions = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.booking_id.is_(None),  # type: ignore[union-attr]
            TherapySession.status.not_in(CANCELLED),  # type: ignore[attr-defined]
            TherapySession.date >= since,
        )
    ).all()
    if not sessions:
        return []
    linked = {
        x for x in session.exec(
            select(TherapySession.booking_id).where(TherapySession.booking_id.is_not(None))  # type: ignore[union-attr]
        ).all() if x
    }
    conds = []
    try:
        from uuid import UUID
        uid_val = user.id if isinstance(user.id, UUID) else UUID(str(user.id))
        conds.append(Booking.user_uuid == uid_val)
    except (ValueError, TypeError, AttributeError):
        pass
    if getattr(user, "email", None):
        conds.append(Booking.user_id == user.email)
    if not conds:
        return []
    bookings = session.exec(
        select(Booking).where(
            or_(*conds),
            Booking.status == "confirmed",
            Booking.date >= since - timedelta(days=1),
        )
    ).all()
    free: dict[tuple[str, str], list[Booking]] = {}
    for b in bookings:
        if str(b.id) in linked:
            continue
        k = _key_booking(b)
        if k:
            free.setdefault(k, []).append(b)
    by_key: dict[tuple[str, str], list[TherapySession]] = {}
    for ts in sessions:
        k = _key_session(ts)
        if k and k in free:
            by_key.setdefault(k, []).append(ts)
    pairs = []
    for k, sess in by_key.items():
        cands = free[k]
        unique = len(cands) == 1 and len(sess) == 1
        for ts in sess:
            for b in cands:
                pairs.append({
                    "session": ts, "booking": b,
                    "unique": unique and (not b.crm_client_id or b.crm_client_id == ts.client_id),
                })
    return pairs


def link(session: Session, ts: TherapySession, b: Booking) -> None:
    ts.booking_id = str(b.id)
    ts.is_booked = True
    ts.updated_at = datetime.now()
    if not b.crm_client_id and ts.client_id:
        b.crm_client_id = ts.client_id
    session.add(ts)
    session.add(b)


def auto_link(session: Session, user, now: Optional[datetime] = None) -> int:
    """Связать однозначные пары. Не коммитит. Возвращает число связанных."""
    n = 0
    for p in find_pairs(session, user, now):
        if p["unique"]:
            link(session, p["session"], p["booking"])
            n += 1
    return n
