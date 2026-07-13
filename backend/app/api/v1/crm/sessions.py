"""CRM Sessions — therapy session CRUD + quick-pay."""
import logging
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlmodel import Session, select
from app.api import deps

logger = logging.getLogger(__name__)
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import (
    TherapySession, TherapySessionCreate, TherapySessionRead, TherapySessionUpdate,
)
from app.models.therapist_payment import TherapistPayment
from app.api.v1.crm import get_crm_calendar_id

router = APIRouter()


@router.get("/sessions", response_model=List[TherapySessionRead])
def list_sessions(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    client_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    uid = str(current_user.id)
    stmt = select(TherapySession).where(TherapySession.specialist_id == uid)
    if client_id:
        stmt = stmt.where(TherapySession.client_id == client_id)
    if date_from:
        stmt = stmt.where(TherapySession.date >= datetime.fromisoformat(date_from))
    if date_to:
        stmt = stmt.where(TherapySession.date <= datetime.fromisoformat(date_to + "T23:59:59"))
    if status:
        stmt = stmt.where(TherapySession.status == status)
    stmt = stmt.order_by(TherapySession.date.desc())
    return session.exec(stmt).all()


@router.post("/sessions/auto-complete")
def auto_complete_sessions(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Auto-mark PLANNED sessions in the past as COMPLETED."""
    uid = str(current_user.id)
    # TherapySession.date is UTC-naive; compare against utcnow(), not the
    # server-local now(), or the "past" filter is off by the UTC offset.
    now = datetime.utcnow()
    stmt = select(TherapySession).where(
        TherapySession.specialist_id == uid,
        TherapySession.status == "PLANNED",
        TherapySession.date < now,
    )
    planned_past = session.exec(stmt).all()
    count = 0
    for ts in planned_past:
        ts.status = "COMPLETED"
        ts.updated_at = now
        session.add(ts)
        count += 1
    if count > 0:
        session.commit()
    return {"ok": True, "auto_completed": count}


@router.post("/sessions", response_model=TherapySessionRead)
def create_session(
    data: TherapySessionCreate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, data.client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    # Frontend sends Tbilisi wall-clock as a naive ISO string (e.g.
    # "2026-05-22T11:00:00" = 11:00 Tbilisi). The DB convention is
    # UTC-naive (matches what GCal sync produces). Subtract 4h here so
    # every TherapySession.date row carries the same meaning, and
    # parseUTC + formatBatumi on the frontend renders correctly.
    create_data = data.model_dump(exclude={"push_to_calendar"})
    if "date" in create_data and create_data["date"] is not None:
        from app.services.crm_calendar import tbilisi_naive_to_utc_naive
        create_data["date"] = tbilisi_naive_to_utc_naive(create_data["date"])

    # ── Dedup check ────────────────────────────────────────────────────
    # Mirrors the recurring-booking fix from 885ca64: if a session for this
    # client+specialist already exists on the same UTC day at the exact
    # same hour:minute and is not cancelled — REUSE it instead of inserting
    # a duplicate. This catches the common case where:
    #   1) sync_from_calendar already imported the session from GCal
    #   2) specialist then books a cabinet via CRM chessboard with the
    #      client linked → handleBooked calls POST /crm/sessions
    # Without this, both rows survive (Марат / Александр scenario).
    target_dt = create_data.get("date")
    if target_dt is not None:
        from datetime import timedelta as _td
        day_start = target_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + _td(days=1)
        same_day = session.exec(
            select(TherapySession)
            .where(TherapySession.client_id == data.client_id)
            .where(TherapySession.specialist_id == str(current_user.id))
            .where(TherapySession.date >= day_start)
            .where(TherapySession.date < day_end)
            .where(TherapySession.status.not_in(("CANCELLED_CLIENT", "CANCELLED_THERAPIST")))  # type: ignore
        ).all()
        target_h = (target_dt.hour, target_dt.minute)
        existing_match = next(
            (s for s in same_day if (s.date.hour, s.date.minute) == target_h),
            None,
        )
        if existing_match is not None:
            # Adopt incoming fields onto the existing row where they add
            # info (booking_id, price, notes etc.) — same shape as the
            # recurring path. Don't blindly overwrite — only fill nulls.
            ex = existing_match
            if create_data.get("booking_id") and not ex.booking_id:
                ex.booking_id = create_data["booking_id"]
                ex.is_booked = True
            elif create_data.get("is_booked") and not ex.is_booked:
                ex.is_booked = True
            if create_data.get("price") is not None and ex.price is None:
                ex.price = create_data["price"]
            if create_data.get("notes") and not ex.notes:
                ex.notes = create_data["notes"]
            if create_data.get("duration_minutes") and ex.duration_minutes != create_data["duration_minutes"]:
                # Trust the incoming duration if it differs (specialist explicitly
                # picked it in the booking modal).
                ex.duration_minutes = create_data["duration_minutes"]
            if create_data.get("recurring_group_id") and not ex.recurring_group_id:
                ex.recurring_group_id = create_data["recurring_group_id"]
            ex.updated_at = datetime.now()
            session.add(ex)
            session.commit()
            session.refresh(ex)
            logger.info(
                f"[create_session] dedup: reused existing session {ex.id} for "
                f"client={data.client_id} at {target_dt.isoformat()} "
                f"(adopted booking_id/price/notes from incoming payload)"
            )
            return ex

    therapy_session = TherapySession(
        **create_data,
        specialist_id=str(current_user.id),
    )

    # Diagnostic — confirm whether push_to_calendar is actually arriving and
    # whether the specialist has a calendar configured. Without this, a silent
    # False (e.g. axios interceptor not converting key) is invisible.
    logger.info(
        f"[create_session] specialist={current_user.id} client={client.name} "
        f"push_to_calendar={data.push_to_calendar} crm_data_keys="
        f"{list((current_user.crm_data or {}).keys())}"
    )

    if data.push_to_calendar:
        calendar_id = get_crm_calendar_id(current_user)
        logger.info(f"[create_session] calendar_id={calendar_id!r} alias_code={client.alias_code!r}")
        if calendar_id:
            try:
                from app.services.crm_calendar import create_calendar_event
                # Use the already-normalised UTC-naive date (matches the
                # row we'll store) — _dt_to_rfc3339 will append "Z" and
                # GCal will render in the calendar's TZ correctly.
                gcal_id = create_calendar_event(
                    calendar_id=calendar_id,
                    client_name=client.name,
                    alias_code=client.alias_code,
                    session_date=therapy_session.date,
                    duration_minutes=data.duration_minutes,
                    notes=data.notes,
                )
                therapy_session.google_event_id = gcal_id
                logger.info(f"[create_session] GCal event created: {gcal_id}")
            except Exception as e:
                logger.warning(f"GCal push failed: {e}", exc_info=True)
        else:
            logger.warning(f"[create_session] push_to_calendar=True but calendar_id missing for user {current_user.id}")

    session.add(therapy_session)
    session.commit()
    session.refresh(therapy_session)
    return therapy_session


@router.patch("/sessions/{session_id}", response_model=TherapySessionRead)
def update_session(
    session_id: str,
    data: TherapySessionUpdate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")

    update_data = data.model_dump(exclude_unset=True)
    # Same Tbilisi-naive → UTC-naive normalisation as create_session.
    if "date" in update_data and update_data["date"] is not None:
        from app.services.crm_calendar import tbilisi_naive_to_utc_naive
        update_data["date"] = tbilisi_naive_to_utc_naive(update_data["date"])

    # ── Auto-sync linked cabinet booking ─────────────────────────────────
    # Owner asked 2026-05-27: when a session is moved in CRM, the
    # attached cabinet booking must follow so they stay in lock-step.
    # CRITICAL: we check availability for the new slot BEFORE committing
    # the session change — if the cabinet is busy at the new time, we
    # raise an HTTPException and roll back. Better to fail loudly than
    # leave the user with a session that points at an old booking time.
    booking_date_changed = (
        ts.booking_id
        and "date" in update_data
        and update_data["date"] is not None
        and update_data["date"] != ts.date
    )
    if booking_date_changed:
        from app.models.booking import Booking as _Booking
        from app.api.v1.bookings.routes import check_availability as _check_avail

        bk = session.get(_Booking, ts.booking_id)
        if bk and bk.status == "confirmed":
            # Convert new UTC-naive session time → Tbilisi wall-clock for booking
            new_session_utc = update_data["date"]
            new_session_tb = new_session_utc + timedelta(hours=4)
            new_booking_date = new_session_tb.replace(
                hour=0, minute=0, second=0, microsecond=0,
            )
            new_start_time = new_session_tb.strftime("%H:%M")

            same_slot = (
                bk.date.date() == new_booking_date.date()
                and bk.start_time == new_start_time
            )
            if not same_slot:
                # Check availability — must NOT count this booking itself.
                available, conflict_msg = _check_avail(
                    session=session,
                    resource_id=bk.resource_id,
                    date=new_booking_date,
                    start_time=new_start_time,
                    duration=bk.duration,
                    exclude_booking_id=str(bk.id),
                    requester_user_uuid=bk.user_uuid,
                    lock_rows=True,
                )
                if not available:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Не могу перенести сессию на {new_start_time}: "
                            f"в это время кабинет {bk.resource_id} занят. "
                            f"Освободите слот или отвяжите бронь от сессии. "
                            f"({conflict_msg})"
                        ),
                    )
                logger.info(
                    "[autosync] session %s moved → booking %s %s %s → %s %s",
                    ts.id, bk.id, bk.date, bk.start_time,
                    new_booking_date, new_start_time,
                )
                bk.date = new_booking_date
                bk.start_time = new_start_time
                # Clearing gcal_event_id forces the next CRM-calendar /
                # gcal sync pass to regenerate the event at the new time
                # instead of leaving a stale event on the cabinet calendar.
                bk.gcal_event_id = None
                bk.updated_at = datetime.now()
                session.add(bk)

    for key, value in update_data.items():
        setattr(ts, key, value)
    ts.updated_at = datetime.now()

    session.add(ts)
    session.commit()
    session.refresh(ts)
    return ts


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    scope: str = Query("this", regex="^(this|future)$"),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Delete a single CRM session, optionally extending to "this and all
    future occurrences in the same recurring series" — same UX Google
    Calendar offers when you delete one event from a recurring rule.

    Always cleans up the GCal event(s) associated with the deleted rows so
    the specialist's personal calendar stays in sync.

    Args:
        scope: "this" (default) deletes only this row.
               "future" deletes this row and every later sibling sharing
                       the same recurring_group_id.
    """
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")

    # Build the list of session rows to delete.
    targets: list[TherapySession] = [ts]
    if scope == "future":
        if not ts.recurring_group_id:
            raise HTTPException(
                400,
                "Cannot delete future occurrences — this session is not part of a recurring series",
            )
        siblings = session.exec(
            select(TherapySession).where(
                TherapySession.specialist_id == str(current_user.id),
                TherapySession.recurring_group_id == ts.recurring_group_id,
                TherapySession.date >= ts.date,
                TherapySession.id != ts.id,
            )
        ).all()
        targets.extend(siblings)

    # Best-effort GCal cleanup. Don't let a calendar API hiccup block the DB
    # delete the user requested — log and continue.
    calendar_id = get_crm_calendar_id(current_user)
    deleted_gcal = 0
    if calendar_id:
        from app.services.crm_calendar import delete_calendar_event
        for t in targets:
            if not t.google_event_id:
                continue
            try:
                delete_calendar_event(calendar_id, t.google_event_id)
                deleted_gcal += 1
            except Exception as e:
                logger.warning(f"GCal delete failed for {t.google_event_id}: {e}")

    # Delete related payments first (foreign key constraint).
    target_ids = [t.id for t in targets]
    related_payments = session.exec(
        select(TherapistPayment).where(TherapistPayment.session_id.in_(target_ids))
    ).all()
    for payment in related_payments:
        session.delete(payment)

    for t in targets:
        session.delete(t)
    session.commit()
    return {"ok": True, "deleted": len(targets), "deleted_gcal": deleted_gcal, "scope": scope}


@router.get("/merge-suggestions")
def list_merge_suggestions(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Find unlinked (CRM-session, cabinet-booking) pairs that occupy the
    same date+time and could be merged into one event.

    Specialists asked: "когда в календаре брони есть бронь, которая
    совпадает по времени с моей сессией с конкретным клиентом — пусть
    сервис меня спрашивает, нужно ли объединить эти события". This
    endpoint surfaces every such pair so the UI can show a "Найдено N
    пар, объединить?" banner.

    Match criteria:
      • Session.specialist_id == current user
      • Session.booking_id IS NULL (no link yet)
      • Session.status not cancelled
      • Booking.user_id == current user's email
      • Booking.status == "confirmed"
      • Booking.date's day-of-month matches Session.date's day-of-month
      • Booking.start_time matches Session.date's HH:MM
    """
    from app.models.booking import Booking
    uid = str(current_user.id)
    user_email = current_user.email

    # Pull unlinked future-or-recent sessions for this specialist
    sessions = session.exec(
        select(TherapySession)
        .where(TherapySession.specialist_id == uid)
        .where(TherapySession.booking_id.is_(None))  # type: ignore
        .where(TherapySession.status.not_in(("CANCELLED_CLIENT", "CANCELLED_THERAPIST")))  # type: ignore
        .order_by(TherapySession.date.desc())
        .limit(500)
    ).all()
    if not sessions:
        return {"pairs": []}

    # All confirmed bookings for this user (no time pre-filter needed —
    # booking volume per specialist is small).
    bookings = session.exec(
        select(Booking)
        .where(Booking.user_id == user_email)
        .where(Booking.status == "confirmed")
    ).all()

    # Index bookings by (yyyy-mm-dd, hh:mm) for O(1) lookup per session.
    book_idx: dict[tuple[str, str], list[Booking]] = {}
    for b in bookings:
        try:
            key = (b.date.strftime("%Y-%m-%d"), b.start_time)
        except Exception:
            continue
        book_idx.setdefault(key, []).append(b)

    clients_cache: dict[str, TherapistClient] = {}
    pairs: list[dict] = []
    for ts in sessions:
        try:
            sess_key = (ts.date.strftime("%Y-%m-%d"), ts.date.strftime("%H:%M"))
        except Exception:
            continue
        candidates = book_idx.get(sess_key, [])
        for b in candidates:
            if str(b.id) == ts.booking_id:
                continue
            cli = clients_cache.get(ts.client_id)
            if cli is None:
                cli = session.get(TherapistClient, ts.client_id)
                if cli:
                    clients_cache[ts.client_id] = cli
            pairs.append({
                "session_id": ts.id,
                "session_date": ts.date.isoformat(),
                "session_duration": ts.duration_minutes,
                "client_id": ts.client_id,
                "client_name": cli.name if cli else None,
                "booking_id": str(b.id),
                "booking_resource_id": b.resource_id,
                "booking_start_time": b.start_time,
                "booking_duration": b.duration,
            })

    return {"pairs": pairs}


@router.post("/merge-suggestions/accept")
def accept_merge_suggestion(
    payload: dict = Body(...),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Apply a single merge: link a session to a booking.

    Sets session.booking_id + is_booked, and back-fills booking.crm_client_id
    if it wasn't set. Both objects must belong to the current specialist —
    refused otherwise.
    """
    from app.models.booking import Booking
    sid = payload.get("session_id")
    bid = payload.get("booking_id")
    if not sid or not bid:
        raise HTTPException(400, "session_id и booking_id обязательны")

    ts = session.get(TherapySession, sid)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")

    try:
        from uuid import UUID as _UUID
        b = session.get(Booking, _UUID(bid))
    except Exception:
        b = None
    # Ownership: совпадает email ИЛИ user_uuid — без uuid-варианта спец
    # с переименованной почтой получал бы 404 на свои же брони.
    if not b or (
        b.user_id != current_user.email
        and b.user_uuid != current_user.id
    ):
        raise HTTPException(404, "Booking not found")

    ts.booking_id = str(b.id)
    ts.is_booked = True
    ts.updated_at = datetime.now()
    if not b.crm_client_id and ts.client_id:
        b.crm_client_id = ts.client_id

    session.add(ts)
    session.add(b)
    session.commit()
    return {"ok": True, "session_id": ts.id, "booking_id": str(b.id)}


@router.post("/sessions/{session_id}/detach-cabinet")
def detach_session_cabinet(
    session_id: str,
    cancel_booking: bool = Query(False, description="Also cancel the linked cabinet booking (refunds owner)"),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Remove the cabinet-booking link from a CRM session.

    The session itself stays intact (date, client, price). Only the
    `booking_id` / `is_booked` fields are cleared so the chessboard stops
    rendering the КАБ badge and the session list shows "+Каб" again.

    With `cancel_booking=true` we also cancel the underlying Booking row
    (refunds the owner, frees the cabinet for others). With the default
    `false`, only the link is broken — the cabinet booking stays as-is and
    can be re-attached to a different session later.
    """
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")
    if not ts.booking_id:
        raise HTTPException(400, "Session has no cabinet booking attached")

    detached_booking_id = ts.booking_id
    booking_cancelled = False

    if cancel_booking:
        # Defer to the existing cancel flow so we get the same refund +
        # GCal cleanup + waitlist-notify behaviour. Import lazily to dodge
        # the circular import (bookings/routes.py imports CRM stuff too).
        from app.api.v1.bookings.routes import cancel_booking as _cancel_booking_fn
        try:
            _cancel_booking_fn(
                booking_id=detached_booking_id,
                session=session,
                current_user=current_user,
            )
            booking_cancelled = True
            # cancel_booking already nulled booking_id on this session via the
            # cleanup loop we added — refresh and return.
            session.refresh(ts)
        except HTTPException:
            # Bubble booking-side errors (>24h, past booking, etc.) up so the
            # specialist sees the actual reason rather than a silent no-op.
            raise

    if not booking_cancelled:
        # Soft detach only — keep the booking, just unlink it.
        ts.booking_id = None
        ts.is_booked = False
        ts.updated_at = datetime.now()
        session.add(ts)
        session.commit()
        session.refresh(ts)

    return {
        "ok": True,
        "session_id": ts.id,
        "detached_booking_id": detached_booking_id,
        "booking_cancelled": booking_cancelled,
    }


@router.post("/sessions/{session_id}/quick-pay")
def quick_pay_session(
    session_id: str,
    payload: dict = Body(default={}),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Mark session as paid and create a payment record. Optionally override account."""
    # SELECT … FOR UPDATE: a double-tap on «Оплачено» (common on mobile when the
    # first tap lags) used to let both requests read is_paid=False before either
    # committed, so both inserted a TherapistPayment — the client's income was
    # counted twice and their debt went negative. unmark-paid only deletes the
    # first payment it finds, so the duplicate stayed forever.
    ts = session.exec(
        select(TherapySession).where(TherapySession.id == session_id).with_for_update()
    ).first()
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")
    if ts.is_paid:
        raise HTTPException(400, "Session already paid")

    client = session.get(TherapistClient, ts.client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    price = ts.price if ts.price is not None else client.base_price or 0
    account = payload.get("account") or client.default_account

    # Update session price if it was NULL (use client's current base_price)
    if ts.price is None and client.base_price:
        ts.price = client.base_price
        price = client.base_price

    # Freeze currency & account on the session at payment time
    ts.currency = client.currency
    ts.account = account

    # Create payment record only if amount > 0
    if price and price > 0:
        payment = TherapistPayment(
            client_id=client.id,
            specialist_id=str(current_user.id),
            amount=price,
            currency=client.currency,
            account=account,
            date=datetime.now(),  # payment date = today, not session date
            session_id=ts.id,
        )
        session.add(payment)

    ts.is_paid = True
    ts.updated_at = datetime.now()
    session.add(ts)

    session.commit()
    return {"ok": True, "amount": price, "currency": client.currency, "account": account}


@router.post("/sessions/{session_id}/unmark-paid")
def unmark_paid_session(
    session_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Unmark a session as paid and optionally remove the related payment."""
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Session not found")
    if not ts.is_paid:
        raise HTTPException(400, "Session is not paid")

    ts.is_paid = False
    ts.updated_at = datetime.now()
    session.add(ts)

    # Remove related payment if exists
    payment = session.exec(
        select(TherapistPayment).where(
            TherapistPayment.session_id == session_id,
            TherapistPayment.specialist_id == str(current_user.id),
        )
    ).first()
    if payment:
        session.delete(payment)

    session.commit()
    return {"ok": True}


@router.post("/clients/{client_id}/mark-all-paid")
def mark_all_sessions_paid(
    client_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """Mark all unpaid non-cancelled sessions as paid, creating payment records."""
    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    uid = str(current_user.id)
    # TherapySession.date is UTC-naive; the "don't touch future sessions"
    # guard must compare against utcnow(), not the server-local now().
    now = datetime.utcnow()
    unpaid = session.exec(
        select(TherapySession).where(
            TherapySession.specialist_id == uid,
            TherapySession.client_id == client_id,
            TherapySession.is_paid == False,
            TherapySession.date <= now,
            TherapySession.status.notin_(["CANCELLED_CLIENT", "CANCELLED_THERAPIST"]),
        )
    ).all()

    count = 0
    for ts in unpaid:
        price = ts.price if ts.price is not None else client.base_price or 0
        # Fill session price from client base_price if NULL
        if ts.price is None and client.base_price:
            ts.price = client.base_price
            price = client.base_price
        # Freeze currency & account on the session at payment time
        ts.currency = client.currency
        ts.account = client.default_account
        # Create payment only if amount > 0
        if price and price > 0:
            payment = TherapistPayment(
                client_id=client.id,
                specialist_id=uid,
                amount=price,
                currency=client.currency,
                account=client.default_account,
                date=ts.date,
                session_id=ts.id,
            )
            session.add(payment)
        ts.is_paid = True
        ts.updated_at = datetime.now()
        session.add(ts)
        count += 1

    if count > 0:
        session.commit()
    return {"ok": True, "marked": count}
