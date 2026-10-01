"""Service / maintenance blocks — admin tool to close a cabinet for a
period (cleaning, repairs, internal events).

Implemented as regular Booking rows with `payment_method="service"` and
`final_price=0`, so they participate in slot-availability checks the
same way client bookings do (no extra plumbing in chessboard,
calendar-export, recurring booking conflict detection, etc.). They are
filtered out of finance reports and pricing recompute scripts via the
payment_method marker.

Endpoints:
  POST   /maintenance-blocks         — create one or many (with recurring)
  GET    /maintenance-blocks         — list, optionally filtered by range
  DELETE /maintenance-blocks/{id}    — remove a single block
  DELETE /maintenance-blocks/group/{group_id} — remove a whole series
         (only payment_method="service" rows; client bookings untouched)

Волна 4, шаг 0 (решение владельца В1, 01.10): блок НЕЛЬЗЯ поставить поверх
брони клиента. Раньше «Закрыть кабинет» молча ставил блокировку поверх
подтверждённой брони (G8-03) — клиент приходил в закрытый кабинет. Теперь
перед созданием собираем пересечения по каждой дате; есть хоть одно — 409
со списком броней, ничего не создаём, не отменяем и не возвращаем. Брони
сначала переносят/отменяют обычными окнами.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api import deps
from app.db.session import get_session
from app.models.booking import Booking
from app.models.user import User
from app.services.booking import time_to_minutes

router = APIRouter()


# ── Payload schemas ────────────────────────────────────────────────────────
class MaintenanceCreate(BaseModel):
    resource_id: str
    location_id: str = "unbox_one"
    date_from: str = Field(description="YYYY-MM-DD")
    date_to: Optional[str] = Field(default=None, description="YYYY-MM-DD; inclusive. Defaults to date_from.")
    start_time: str = Field(description='"HH:MM"')
    duration: int = Field(ge=15, le=600, description="Minutes")
    reason: str = Field(default="", description="Visible on the block as waiver_reason")
    recurring_weekdays: Optional[List[int]] = Field(
        default=None,
        description="0=Mon..6=Sun. If provided, only create on these weekdays inside the range.",
    )


class MaintenanceRead(BaseModel):
    id: str
    resource_id: str
    location_id: str
    date: datetime
    start_time: str
    duration: int
    reason: str
    created_at: datetime
    # Серия (несколько дат одним запросом) — общий id; одиночный блок — None.
    recurring_group_id: Optional[str] = None


# Брони, поверх которых блок ставить нельзя (В1). completed в базе нет — это
# только подпись в ответе API (enrich_booking_status) для прошедших confirmed.
BLOCKING_STATUSES = ("confirmed", "pending_approval")


# ── Helpers ────────────────────────────────────────────────────────────────
def _to_maintenance_read(b: Booking) -> MaintenanceRead:
    return MaintenanceRead(
        id=str(b.id),
        resource_id=b.resource_id,
        location_id=b.location_id,
        date=b.date,
        start_time=b.start_time,
        duration=b.duration,
        reason=b.waiver_reason or "",
        created_at=b.created_at,
        recurring_group_id=b.recurring_group_id,
    )


def _client_of(session: Session, b: Booking, cache: dict) -> dict:
    """Имя и почта владельца брони (user_uuid → User, иначе user_id = email)."""
    key = str(b.user_uuid or b.user_id or "")
    if key in cache:
        return cache[key]
    user = session.get(User, b.user_uuid) if b.user_uuid else None
    if user is None and b.user_id:
        user = session.exec(select(User).where(User.email == b.user_id)).first()
    info = {
        "name": (user.name if user else None) or None,
        "email": (user.email if user else None) or (b.user_id if b.user_id and "@" in b.user_id else None),
    }
    cache[key] = info
    return info


def find_booking_conflicts(
    session: Session,
    resource_id: str,
    day: datetime,
    start_time: str,
    duration: int,
    client_cache: Optional[dict] = None,
) -> list[dict]:
    """Брони клиентов в этом кабинете, пересекающиеся с [start, start+duration)
    в этот день. Время сравниваем так же, как check_availability
    (services/booking.py): Booking.date — календарный день по Тбилиси, окно
    дня [00:00, +1 день), пересечение по минутам start_time + duration.
    Обслуживание (payment_method='service') и отменённые не считаются."""
    cache = client_cache if client_cache is not None else {}
    day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    rows = session.exec(
        select(Booking).where(
            Booking.resource_id == resource_id,
            Booking.status.in_(BLOCKING_STATUSES),  # type: ignore[attr-defined]
            Booking.date >= day_start,
            Booking.date < day_end,
        )
    ).all()
    new_start = time_to_minutes(start_time)
    new_end = new_start + duration
    out: list[dict] = []
    for b in rows:
        if (b.payment_method or "").lower() == "service":
            continue
        existing_start = time_to_minutes(b.start_time)
        if existing_start < 0:
            continue  # битая строка — как в check_availability
        existing_end = existing_start + (b.duration or 0)
        if new_start < existing_end and new_end > existing_start:
            client = _client_of(session, b, cache)
            who = client["name"] or client["email"] or "клиент"
            out.append({
                "booking_id": str(b.id),
                "resource_id": b.resource_id,
                "date": b.date.strftime("%Y-%m-%d"),
                "start_time": b.start_time,
                "duration": b.duration,
                "status": b.status,
                "client": client,
                "payment_status": b.payment_status,
                "final_price": b.final_price,
                # Для тоста по умолчанию (apiErrorMessage берёт date/start_time/reason).
                "reason": f"бронь: {who}",
            })
    out.sort(key=lambda c: (c["date"], time_to_minutes(c["start_time"])))
    return out


# Самый длинный период «Закрыть кабинет» за один запрос, дней (date_to - date_from).
MAX_BLOCK_RANGE_DAYS = 366


# ── Endpoints ──────────────────────────────────────────────────────────────
@router.post("/", response_model=List[MaintenanceRead])
def create_blocks(
    data: MaintenanceCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Create one or many service blocks. Returns the created rows."""
    try:
        date_from = datetime.strptime(data.date_from, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "date_from must be YYYY-MM-DD")
    date_to = date_from
    if data.date_to:
        try:
            date_to = datetime.strptime(data.date_to, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, "date_to must be YYYY-MM-DD")
    if date_to < date_from:
        raise HTTPException(400, "date_to is before date_from")
    # Волна 4 (доработка): потолок периода — год. Опечатка в годе («2062»)
    # раньше создавала десятки тысяч блоков одним запросом и вешала сервер.
    if (date_to - date_from).days > MAX_BLOCK_RANGE_DAYS:
        raise HTTPException(
            400,
            f"Слишком длинный период: не больше {MAX_BLOCK_RANGE_DAYS} дней за раз. "
            "Проверьте даты «с» и «по» или закройте кабинет несколькими частями.",
        )

    try:
        h, m = data.start_time.split(":")
        start_h, start_m = int(h), int(m)
    except Exception:
        raise HTTPException(400, "start_time must be HH:MM")

    if not (0 <= start_h <= 23 and 0 <= start_m <= 59):
        raise HTTPException(400, "start_time must be HH:MM")

    weekdays_filter = set(data.recurring_weekdays) if data.recurring_weekdays else None

    days: list[datetime] = []
    cursor = date_from
    while cursor <= date_to:
        if weekdays_filter is None or cursor.weekday() in weekdays_filter:
            days.append(cursor)
        cursor += timedelta(days=1)

    # В1: сначала все пересечения со всеми датами — есть хоть одно, ничего
    # не создаём (ни одной строки серии), отдаём список броней.
    conflicts: list[dict] = []
    client_cache: dict = {}
    for day in days:
        conflicts.extend(find_booking_conflicts(
            session, data.resource_id, day, data.start_time, data.duration, client_cache,
        ))
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "В это время есть брони — сначала перенесите или отмените их",
                "conflicts": conflicts,
            },
        )

    created: list[Booking] = []
    now = datetime.now()
    recurring_group_id = str(uuid4()) if date_to != date_from else None
    for cursor in days:
        slot_dt = cursor.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
        b = Booking(
            resource_id=data.resource_id,
            location_id=data.location_id,
            date=slot_dt,
            start_time=data.start_time,
            duration=data.duration,
            status="confirmed",
            final_price=0,
            payment_method="service",
            payment_status="waived",
            format="individual",
            user_id=current_user.email or str(current_user.id),
            user_uuid=current_user.id,
            waiver_reason=data.reason or "Закрыт на обслуживание",
            waived_by=current_user.id,
            waived_at=now,
            charge_amount=0,
            recurring_group_id=recurring_group_id,
        )
        session.add(b)
        created.append(b)

    session.commit()
    for b in created:
        session.refresh(b)

    return [_to_maintenance_read(b) for b in created]


@router.get("/", response_model=List[MaintenanceRead])
def list_blocks(
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    resource_id: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """List all service blocks, optionally narrowed by date range / cabinet."""
    q = select(Booking).where(Booking.payment_method == "service")
    if resource_id:
        q = q.where(Booking.resource_id == resource_id)
    if date_from:
        try:
            d = datetime.strptime(date_from, "%Y-%m-%d")
            q = q.where(Booking.date >= d)
        except ValueError:
            raise HTTPException(400, "date_from must be YYYY-MM-DD")
    if date_to:
        try:
            d = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
            q = q.where(Booking.date < d)
        except ValueError:
            raise HTTPException(400, "date_to must be YYYY-MM-DD")
    q = q.order_by(Booking.date)  # type: ignore[attr-defined]
    rows = session.exec(q).all()
    return [_to_maintenance_read(b) for b in rows]


@router.delete("/group/{group_id}")
def delete_block_group(
    group_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Снять всю серию блокировок (G8-12). Удаляет ТОЛЬКО строки
    payment_method='service' этой группы — брони клиентов не трогает,
    даже если у них по ошибке тот же recurring_group_id."""
    rows = session.exec(
        select(Booking).where(
            Booking.recurring_group_id == group_id,
            Booking.payment_method == "service",
        )
    ).all()
    if not rows:
        raise HTTPException(404, "Series not found")
    for b in rows:
        session.delete(b)
    session.commit()
    return {"ok": True, "group_id": group_id, "deleted": len(rows)}


@router.delete("/{block_id}")
def delete_block(
    block_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Remove a single service block. Use this if maintenance finishes
    early or the slot needs to be freed up for a real booking."""
    b = session.get(Booking, block_id)
    if not b:
        raise HTTPException(404, "Block not found")
    if (b.payment_method or "").lower() != "service":
        raise HTTPException(400, "Not a service block")
    session.delete(b)
    session.commit()
    return {"ok": True, "deleted": block_id}
