"""
Specialist schedule & appointment endpoints.
Mounted at /specialists/{specialist_id}/...
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import List, Optional
from uuid import UUID
from datetime import date, datetime, time, timedelta

from app.db.session import get_session
from app.models.specialist import Specialist
from app.models.specialist_schedule import (
    SpecialistSchedule, SpecialistScheduleRead, SpecialistScheduleCreate,
)
from app.models.specialist_appointment import (
    SpecialistAppointment, SpecialistAppointmentRead, SpecialistAppointmentCreate,
)
from app.models.therapy_session import TherapySession
from app.models.therapist_client import TherapistClient
from app.models.location import Location
from app.api.deps import get_current_user, require_admin
from app.models.user import User
from app.services.telegram import telegram_service

import logging
logger = logging.getLogger(__name__)

router = APIRouter()


def _appointment_location_name(session: Session, location_id: Optional[str]) -> Optional[str]:
    if not location_id:
        return None
    loc = session.get(Location, location_id)
    return loc.name if loc else None


def _notify_specialist_appointment_created(session: Session, appt: SpecialistAppointment, specialist: Specialist) -> None:
    """Fire-and-forget: notify the specialist (via their linked User.telegram_id) about a new appointment."""
    try:
        if not specialist.user_id:
            return
        specialist_user = session.get(User, specialist.user_id)
        if not specialist_user or not specialist_user.telegram_id:
            return
        loc_name = _appointment_location_name(session, appt.location_id)
        specialist_name = f"{specialist.first_name} {specialist.last_name}".strip()
        telegram_service.send_specialist_appointment_new(
            chat_id=specialist_user.telegram_id,
            specialist_name=specialist_name,
            client_name=appt.client_name,
            client_phone=appt.client_phone,
            client_email=appt.client_email,
            date=datetime.combine(appt.date, datetime.min.time()),
            start_time=appt.start_time,
            duration_minutes=appt.duration,
            location_name=loc_name,
            notes=appt.notes,
            appointment_id=str(appt.id),
        )
    except Exception as e:
        logger.warning("[tg:appt-created] notify failed: %r", e)


def _notify_appointment_cancelled(session: Session, appt: SpecialistAppointment, specialist: Specialist) -> None:
    """Fire-and-forget: notify both sides of a cancelled appointment."""
    try:
        loc_name = _appointment_location_name(session, appt.location_id)
        specialist_name = f"{specialist.first_name} {specialist.last_name}".strip()
        appt_dt = datetime.combine(appt.date, datetime.min.time())

        # Specialist notification
        if specialist.user_id:
            specialist_user = session.get(User, specialist.user_id)
            if specialist_user and specialist_user.telegram_id:
                telegram_service.send_specialist_appointment_cancelled(
                    chat_id=specialist_user.telegram_id,
                    audience="specialist",
                    specialist_name=specialist_name,
                    client_name=appt.client_name,
                    date=appt_dt,
                    start_time=appt.start_time,
                    duration_minutes=appt.duration,
                    location_name=loc_name,
                )

        # Client notification (if they had an account)
        if appt.client_user_id:
            client = session.get(User, appt.client_user_id)
            if client and client.telegram_id:
                telegram_service.send_specialist_appointment_cancelled(
                    chat_id=client.telegram_id,
                    audience="client",
                    specialist_name=specialist_name,
                    client_name=appt.client_name,
                    date=appt_dt,
                    start_time=appt.start_time,
                    duration_minutes=appt.duration,
                    location_name=loc_name,
                )
    except Exception as e:
        logger.warning("[tg:appt-cancelled] notify failed: %r", e)


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

    # Build busy times per date.
    # `start_time` on appointments and `start_time/end_time` on the schedule
    # template are Tbilisi wall-clock strings ("HH:MM"). TherapySession.date
    # is a naive UTC timestamp by convention (see crm_calendar.py /
    # tbilisi_naive_to_utc_naive). Mixing the two raw caused the bug where
    # a 13:30 Tbilisi session (stored as 09:30 UTC) blocked the 10:00 slot
    # of Mykola's Saturday template — the busy interval was read as
    # 09:30–10:30 instead of 13:30–14:30.
    from datetime import timezone as _tz, timedelta as _td
    _TBILISI_OFFSET_MIN = 4 * 60  # Asia/Tbilisi is UTC+04, no DST.

    busy: dict[date, list[tuple[int, int]]] = {}
    for appt in appointments:
        start_m = _time_to_minutes(appt.start_time)
        end_m = start_m + appt.duration
        busy.setdefault(appt.date, []).append((start_m, end_m))

    for ts in therapy_sessions:
        # Promote UTC-naive → Tbilisi wall-clock minute offset, and bucket
        # against the resulting Tbilisi calendar day (a 21:00 UTC session
        # rolls over into the next day's morning Tbilisi-side).
        utc_minutes = ts.date.hour * 60 + ts.date.minute
        if utc_minutes == 0:
            continue  # No time info
        tb_total = utc_minutes + _TBILISI_OFFSET_MIN
        day_offset, start_m = divmod(tb_total, 24 * 60)
        ts_date = ts.date.date() + _td(days=day_offset)
        end_m = start_m + (ts.duration_minutes or 60)
        # If a session straddles midnight Tbilisi-side, clamp to the day
        # so the busy interval doesn't bleed into the next day from here.
        end_m = min(end_m, 24 * 60)
        busy.setdefault(ts_date, []).append((start_m, end_m))

    # Generate available slots
    result = []
    current = d_from
    # Use Tbilisi-now so "today" / "past slot" matches what the user sees
    # on the chessboard. Without this, a 10:00 Tbilisi slot would still
    # be hidden until ~14:00 Tbilisi (10:00 UTC) on the day-of.
    _now_tb = datetime.now(_tz.utc) + _td(hours=4)
    today = _now_tb.date()
    now_minutes = _now_tb.hour * 60 + _now_tb.minute

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

    # Notify specialist via Telegram if linked
    _notify_specialist_appointment_created(session, appointment, specialist)

    # 2026-06-06 owner b/b/a: после appointment сразу создаём CRM-клиента
    # и плановую сессию у специалиста. Кабинет НЕ бронируется
    # автоматически (b), оплата НЕ списывается (b), но клиент попадает
    # в CRM-карточки спеца и видит будущую сессию (a). Это даёт
    # специалисту единое место для работы — раньше appointment жил
    # отдельно от CRM, спец должен был руками заводить клиента+сессию.
    #
    # Tolerant: если спец без user_id (анкета без аккаунта) или любой
    # этап CRM упадёт — appointment всё равно сохранён, заявка не
    # теряется. Сессия — best effort.
    if specialist.user_id:
        try:
            _link_appointment_to_crm(session, appointment, specialist)
        except Exception as e:
            logger.warning(
                "[specialist:appt] Не удалось создать CRM-связку для appointment %s: %s",
                appointment.id, e,
            )

    return appointment


def _link_appointment_to_crm(
    session: Session,
    appointment: SpecialistAppointment,
    specialist: Specialist,
) -> None:
    """Создать CRM-клиента (если не существует по phone/email)
    и плановую TherapySession у спеца, привязанную к этому
    appointment'у по дате+времени.
    """
    user_id_str = str(specialist.user_id)

    # Find-or-create клиента в CRM спеца. Матчинг по phone first
    # (более устойчивый идентификатор), fallback на email.
    client: Optional[TherapistClient] = None
    if appointment.client_phone:
        client = session.exec(
            select(TherapistClient).where(
                TherapistClient.specialist_id == user_id_str,
                TherapistClient.phone == appointment.client_phone,
                TherapistClient.is_active == True,  # noqa: E712
            )
        ).first()
    if client is None and appointment.client_email:
        client = session.exec(
            select(TherapistClient).where(
                TherapistClient.specialist_id == user_id_str,
                TherapistClient.email == appointment.client_email,
                TherapistClient.is_active == True,  # noqa: E712
            )
        ).first()

    if client is None:
        client = TherapistClient(
            specialist_id=user_id_str,
            name=appointment.client_name,
            phone=appointment.client_phone,
            email=appointment.client_email,
            pipeline_status="LEAD",  # новый лид с публичного сайта
            notes_text="Записался через публичную страницу /specialists",
        )
        session.add(client)
        session.commit()
        session.refresh(client)

    # Создаём плановую сессию в CRM. is_booked=False — спец сам потом
    # забронирует кабинет (если нужен). is_paid=False — оплата вне сайта.
    h, m = appointment.start_time.split(":")
    session_dt = datetime.combine(appointment.date, time(int(h), int(m)))

    therapy = TherapySession(
        specialist_id=user_id_str,
        client_id=client.id,
        date=session_dt,
        duration_minutes=appointment.duration,
        status="PLANNED",
        is_booked=False,
        is_paid=False,
        notes="Заявка через публичный сайт. Кабинет и оплата — отдельно.",
    )
    session.add(therapy)
    session.commit()


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

    # Notify both sides via Telegram if linked
    specialist = session.get(Specialist, specialist_id)
    if specialist:
        _notify_appointment_cancelled(session, appt, specialist)

    return {"ok": True}
