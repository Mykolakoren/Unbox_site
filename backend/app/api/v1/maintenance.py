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
    )


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

    try:
        h, m = data.start_time.split(":")
        start_h, start_m = int(h), int(m)
    except Exception:
        raise HTTPException(400, "start_time must be HH:MM")

    weekdays_filter = set(data.recurring_weekdays) if data.recurring_weekdays else None

    created: list[Booking] = []
    cursor = date_from
    now = datetime.now()
    recurring_group_id = str(uuid4()) if date_to != date_from else None
    while cursor <= date_to:
        if weekdays_filter is None or cursor.weekday() in weekdays_filter:
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
        cursor += timedelta(days=1)

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
