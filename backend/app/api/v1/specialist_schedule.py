"""
Specialist schedule & appointment endpoints.
Mounted at /specialists/{specialist_id}/...
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import List, Optional
from uuid import UUID
from datetime import date, datetime, timedelta

from app.db.session import get_session
from app.models.specialist import Specialist
from app.models.specialist_schedule import (
    SpecialistSchedule, SpecialistScheduleRead, SpecialistScheduleCreate,
)
from app.models.specialist_appointment import (
    SpecialistAppointment, SpecialistAppointmentRead, SpecialistAppointmentCreate,
)
from app.models.therapy_session import TherapySession
from app.api.deps import get_current_user, require_admin
from app.models.user import User

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_specialist_or_404(session: Session, specialist_id: UUID) -> Specialist:
    specialist = session.get(Specialist, specialist_id)
    if not specialist:
        raise HTTPException(404, "Specialist not found")
    return specialist


def _is_owner_or_admin(user: User, specialist: Specialist) -> bool:
    return user.is_admin or str(user.id) == str(specialist.user_id)


def _time_to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _minutes_to_time(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


# ── Schedule CRUD ────────────────────────────────────────────────────────────

@router.get("/{specialist_id}/schedule", response_model=List[SpecialistScheduleRead])
def get_schedule(
    specialist_id: UUID,
    session: Session = Depends(get_session),
):
    """Public: get specialist's schedule (weekly template + date overrides)."""
    _get_specialist_or_404(session, specialist_id)
    stmt = select(SpecialistSchedule).where(
        SpecialistSchedule.specialist_id == specialist_id
    )
    return session.exec(stmt).all()


@router.put("/{specialist_id}/schedule")
def update_schedule(
    specialist_id: UUID,
    slots: List[SpecialistScheduleCreate],
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Specialist/Admin: replace entire schedule with new slots."""
    specialist = _get_specialist_or_404(session, specialist_id)
    if not _is_owner_or_admin(current_user, specialist):
        raise HTTPException(403, "Not authorized")

    # Delete existing schedule for this specialist
    existing = session.exec(
        select(SpecialistSchedule).where(SpecialistSchedule.specialist_id == specialist_id)
    ).all()
    for e in existing:
        session.delete(e)

    # Create new schedule entries
    created = []
    for slot in slots:
        entry = SpecialistSchedule(
            specialist_id=specialist_id,
            **slot.model_dump(),
        )
        session.add(entry)
        created.append(entry)

    session.commit()
    return {"ok": True, "count": len(created)}


# ── Available Slots ──────────────────────────────────────────────────────────

@router.get("/{specialist_id}/available-slots")
def get_available_slots(
    specialist_id: UUID,
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
    location_id: Optional[str] = Query(None),
    session: Session = Depends(get_session),
):
    """
    Public: get available 60-min slots for a specialist in a date range.
    Returns list of { date, start_time, end_time, location_id }.
    """
    specialist = _get_specialist_or_404(session, specialist_id)

    d_from = date.fromisoformat(date_from)
    d_to = date.fromisoformat(date_to)
    if d_to < d_from or (d_to - d_from).days > 30:
        raise HTTPException(400, "Invalid date range (max 30 days)")

    # Load schedule
    schedule_entries = session.exec(
        select(SpecialistSchedule).where(SpecialistSchedule.specialist_id == specialist_id)
    ).all()

    weekly = [s for s in schedule_entries if s.specific_date is None]
    overrides = {s.specific_date: s for s in schedule_entries if s.specific_date is not None}

    # Load existing appointments (confirmed)
    appointments = session.exec(
        select(SpecialistAppointment).where(
            SpecialistAppointment.specialist_id == specialist_id,
            SpecialistAppointment.status == "confirmed",
            SpecialistAppointment.date >= d_from,
            SpecialistAppointment.date <= d_to,
        )
    ).all()

    # Load CRM therapy sessions (PLANNED)
    therapy_sessions = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == str(specialist.user_id),
            TherapySession.status == "PLANNED",
        )
    ).all()
    # Filter to date range in python (date field is datetime in model)
    therapy_sessions = [
        ts for ts in therapy_sessions
        if d_from <= ts.date.date() <= d_to
    ]

    # Build busy times per date
    busy: dict[date, list[tuple[int, int]]] = {}
    for appt in appointments:
        start_m = _time_to_minutes(appt.start_time)
        end_m = start_m + appt.duration
        busy.setdefault(appt.date, []).append((start_m, end_m))

    for ts in therapy_sessions:
        ts_date = ts.date.date()
        # TherapySession stores time in the date datetime field
        start_m = ts.date.hour * 60 + ts.date.minute
        if start_m == 0:
            continue  # No time info
        end_m = start_m + (ts.duration_minutes or 60)
        busy.setdefault(ts_date, []).append((start_m, end_m))

    # Generate available slots
    result = []
    current = d_from
    today = date.today()
    now_minutes = datetime.now().hour * 60 + datetime.now().minute

    while current <= d_to:
        dow = current.weekday()  # 0=Mon

        # Check for date override first
        if current in overrides:
            sched = overrides[current]
            if not sched.is_available:
                current += timedelta(days=1)
                continue
            work_slots = [sched]
        else:
            work_slots = [w for w in weekly if w.day_of_week == dow and w.is_available]

        for ws in work_slots:
            # Filter by location if requested
            if location_id is not None and ws.location_id != location_id:
                continue

            slot_start = _time_to_minutes(ws.start_time)
            slot_end = _time_to_minutes(ws.end_time)
            slot_duration = 60  # 1-hour appointment slots

            t = slot_start
            while t + slot_duration <= slot_end:
                # Skip past slots
                if current == today and t < now_minutes + 60:
                    t += 30
                    continue

                # Skip past dates
                if current < today:
                    t += 30
                    continue

                # Check conflicts with busy times
                is_busy = False
                for b_start, b_end in busy.get(current, []):
                    if t < b_end and (t + slot_duration) > b_start:
                        is_busy = True
                        break

                if not is_busy:
                    result.append({
                        "date": current.isoformat(),
                        "start_time": _minutes_to_time(t),
                        "end_time": _minutes_to_time(t + slot_duration),
                        "location_id": ws.location_id,
                    })

                t += 30  # 30-min step

        current += timedelta(days=1)

    return result


# ── Appointments ─────────────────────────────────────────────────────────────

@router.get("/{specialist_id}/appointments", response_model=List[SpecialistAppointmentRead])
def list_appointments(
    specialist_id: UUID,
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Specialist/Admin: list appointments."""
    specialist = _get_specialist_or_404(session, specialist_id)
    if not _is_owner_or_admin(current_user, specialist):
        raise HTTPException(403, "Not authorized")

    stmt = select(SpecialistAppointment).where(
        SpecialistAppointment.specialist_id == specialist_id,
    )
    if date_from:
        stmt = stmt.where(SpecialistAppointment.date >= date.fromisoformat(date_from))
    if date_to:
        stmt = stmt.where(SpecialistAppointment.date <= date.fromisoformat(date_to))

    return session.exec(stmt.order_by(SpecialistAppointment.date, SpecialistAppointment.start_time)).all()


@router.post("/{specialist_id}/appointments", response_model=SpecialistAppointmentRead)
def create_appointment(
    specialist_id: UUID,
    data: SpecialistAppointmentCreate,
    session: Session = Depends(get_session),
):
    """Public: book an appointment with a specialist (no auth required)."""
    specialist = _get_specialist_or_404(session, specialist_id)
    if not specialist.is_verified:
        raise HTTPException(404, "Specialist not found")

    # Validate: slot must be in specialist's schedule
    # (simplified: just check no conflicts)
    existing = session.exec(
        select(SpecialistAppointment).where(
            SpecialistAppointment.specialist_id == specialist_id,
            SpecialistAppointment.date == data.date,
            SpecialistAppointment.status == "confirmed",
        )
    ).all()

    new_start = _time_to_minutes(data.start_time)
    new_end = new_start + data.duration

    for appt in existing:
        a_start = _time_to_minutes(appt.start_time)
        a_end = a_start + appt.duration
        if new_start < a_end and new_end > a_start:
            raise HTTPException(409, "This time slot is already booked")

    appointment = SpecialistAppointment(
        specialist_id=specialist_id,
        **data.model_dump(),
    )
    session.add(appointment)
    session.commit()
    session.refresh(appointment)
    return appointment


@router.delete("/{specialist_id}/appointments/{appointment_id}")
def cancel_appointment(
    specialist_id: UUID,
    appointment_id: UUID,
    session: Session = Depends(get_session),
):
    """Cancel an appointment (public — by appointment ID)."""
    appt = session.get(SpecialistAppointment, appointment_id)
    if not appt or appt.specialist_id != specialist_id:
        raise HTTPException(404, "Appointment not found")

    appt.status = "cancelled"
    session.add(appt)
    session.commit()
    return {"ok": True}
