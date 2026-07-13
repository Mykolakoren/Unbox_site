"""Bookings — all booking endpoints: list, create, cancel, reschedule, re-rent, link-client."""
import logging
from typing import Any, List, Optional
from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request
from app.core.rate_limit import limiter
from sqlmodel import select, Session
from pydantic import BaseModel as PydanticBaseModel
from app.api import deps
from app.models.booking import Booking, BookingCreate, BookingRead, BookingPublicRead
from app.models.user import User
from app.services.google_calendar import gcal_service
from app.services.timeline import timeline_service
from app.services.booking import check_availability, find_re_rent_conflicts
from app.services.email import email_service
from app.services.telegram import telegram_service
from app.core.permissions import ADMIN_ROLES

logger = logging.getLogger(__name__)
router = APIRouter()

# Маячок для админов: когда у одного клиента накапливается слишком много
# будущих броней (вкл. серии), деньги списываются только за 24ч до сессии —
# а значит долг "прорастает" незаметно. При пересечении этого порога шлём
# алерт в админ-чат с прогнозом суммы к списанию vs баланс+лимит.
FUTURE_BOOKING_ALERT_THRESHOLD = 20


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _booking_end_dt(booking: Booking):
    """Booking end datetime as Tbilisi-aware (UTC+4).

    `booking.date` is stored naive but represents the Tbilisi calendar day
    at 00:00; `booking.start_time` is "HH:MM" Tbilisi wall-clock. To get a
    real instant we tag the result with tzinfo=Asia/Tbilisi (UTC+4, no DST)
    so callers can compare against `datetime.now(timezone.utc)` correctly.
    """
    from datetime import timezone as _tz, timedelta as _td
    TZ_TB = _tz(_td(hours=4))
    try:
        h, m = map(int, booking.start_time.split(":"))
        end_tb = booking.date.replace(
            hour=h, minute=m, second=0, microsecond=0, tzinfo=TZ_TB
        ) + timedelta(minutes=booking.duration or 0)
        return end_tb
    except Exception:
        # Fallback: treat the naive date itself as Tbilisi-midnight aware.
        return booking.date.replace(tzinfo=TZ_TB) if booking.date.tzinfo is None else booking.date


def _booking_hours_until_start(booking: Booking) -> float:
    """Return hours from now to booking start, computed in correct TZ.

    `booking.date` is stored as a naive datetime that represents the Tbilisi
    calendar day at 00:00, and `booking.start_time` is "HH:MM" Tbilisi
    wall-clock. The server runs in UTC, so a naive comparison
    `(date.replace(hour=h) - datetime.now())` overstates the gap by 4 hours
    (UTC+4). That bug let clients cancel/reschedule at 20–24h before start
    while the server thought ≥24h remained.

    Build the start as Tbilisi-aware, compare against UTC-aware now, return
    the real wall-clock delta in hours.
    """
    from datetime import timezone as _tz, timedelta as _td
    TZ_TB = _tz(_td(hours=4))
    try:
        h, m = map(int, booking.start_time.split(":"))
        start_tb = booking.date.replace(
            hour=h, minute=m, second=0, microsecond=0, tzinfo=TZ_TB
        )
    except Exception:
        # Last-ditch: treat date as Tbilisi-aware midnight
        start_tb = booking.date.replace(tzinfo=TZ_TB) if booking.date.tzinfo is None else booking.date
    now_utc = datetime.now(_tz.utc)
    return (start_tb - now_utc).total_seconds() / 3600.0


def _sync_linked_session_to_booking(db_session: Session, booking: Booking) -> None:
    """Helper for booking↔session autosync (owner 2026-05-27).

    If `booking` has a CRM session attached via `session.booking_id`, move
    the session's `date` to match the booking's new wall-clock time so the
    two never drift apart after a reschedule. No GCal sync here — the
    session has its own `google_event_id` and a separate CRM-calendar job
    picks up the change. No commit either — the caller batches the write.
    Best-effort: a failure here must not break the user-visible booking
    move, so we log and swallow exceptions.
    """
    try:
        from app.models.therapy_session import TherapySession as _TS
        from app.services.crm_calendar import tbilisi_naive_to_utc_naive as _t2u
        linked = db_session.exec(
            select(_TS).where(_TS.booking_id == booking.id)
        ).first()
        if not linked:
            return
        if linked.status in ("CANCELLED_CLIENT", "CANCELLED_THERAPIST"):
            return
        try:
            h, m = map(int, (booking.start_time or "0:0").split(":")[:2])
        except Exception:
            return
        tb_dt = booking.date.replace(hour=h, minute=m, second=0, microsecond=0)
        new_utc = _t2u(tb_dt)
        if linked.date != new_utc:
            logger.info(
                "[autosync] booking %s → session %s moved %s → %s",
                booking.id, linked.id, linked.date, new_utc,
            )
            linked.date = new_utc
            linked.is_booked = True
            linked.updated_at = datetime.now()
            db_session.add(linked)
    except Exception:
        logger.exception("[autosync] failed to sync session for booking %s", booking.id)


def _gcal_recreate_in_background(booking_id: str, user_name: str, old_event_id: Optional[str], old_resource_id: Optional[str]) -> None:
    """Drop the old GCal event and recreate one for the (already-updated)
    booking. Used by reschedule / extend paths so the request returns
    fast — see ``_gcal_create_in_background`` for the same rationale."""
    from app.db.session import engine as _engine
    try:
        with Session(_engine) as bg_session:
            bk = bg_session.get(Booking, UUID(booking_id))
            if not bk:
                return
            if old_event_id and old_resource_id:
                try:
                    gcal_service.delete_event(old_event_id, old_resource_id)
                except Exception as e:
                    logger.warning(f"[GCal recreate bg] delete old failed for {booking_id}: {e}")
            ev = gcal_service.create_event(bk, user_name=user_name)
            if ev:
                bk.gcal_event_id = ev
                bg_session.add(bk)
                bg_session.commit()
                logger.info(f"[GCal recreate bg] event_id={ev} for booking {booking_id}")
    except Exception as e:
        logger.warning(f"[GCal recreate bg] Failed for {booking_id}: {e}")


def _gcal_create_in_background(booking_id: str, user_name: str) -> None:
    """Push a booking to Google Calendar from a FastAPI BackgroundTask.

    Re-fetches the booking in a fresh DB session because the request-scoped
    session is closed by the time this runs. The whole call is best-effort:
    on any failure we just log and leave ``gcal_event_id=None``. The user
    has already seen "бронь подтверждена" — they should never wait on a
    third-party API.

    This was added after Anna Borta hit a 30+ s ``read operation timed
    out`` from Google Calendar inside POST /bookings; the booking was
    written to the DB but the request hung past the frontend's axios
    timeout, so she saw "Превышено время ожидания" and kept retrying
    (creating duplicate rows).
    """
    from app.db.session import engine as _engine
    try:
        with Session(_engine) as bg_session:
            bk = bg_session.get(Booking, UUID(booking_id))
            if not bk or bk.gcal_event_id:
                return
            ev = gcal_service.create_event(bk, user_name=user_name)
            if ev:
                bk.gcal_event_id = ev
                bg_session.add(bk)
                bg_session.commit()
                logger.info(f"[GCal Sync bg] event_id={ev} for booking {booking_id}")
    except Exception as e:
        logger.warning(f"[GCal Sync bg] Failed for {booking_id}: {e}")


def _is_past(booking: Booking) -> bool:
    """True iff the booking's real end (Tbilisi wall-clock) is in the past.

    Compares a Tbilisi-aware end against UTC-aware now — a previous naive
    comparison made bookings appear "active" for 4 hours after their real
    end (Tbilisi+4 ≠ UTC). Affected cancel / reschedule / extend / re-rent
    gates plus the `confirmed → completed` UI enrichment.
    """
    from datetime import timezone as _tz
    end_dt = _booking_end_dt(booking)
    if end_dt.tzinfo is None:
        # Defensive: shouldn't happen after the change above.
        return end_dt < datetime.now()
    return end_dt < datetime.now(_tz.utc)


def enrich_booking_status(booking: Booking) -> Booking:
    """Mark past 'confirmed' bookings as 'completed' in the response (no DB mutation)."""
    if booking.status == "confirmed" and booking.start_time and _is_past(booking):
        booking.status = "completed"
    return booking


def _check_ownership(booking: Booking, user: User) -> bool:
    # Primary: check by UUID (reliable). Fallback: email (legacy bookings without UUID).
    if booking.user_uuid:
        return booking.user_uuid == user.id
    return booking.user_id == user.email


def _resolve_booking_owner(session: Session, booking: Booking) -> User | None:
    """Resolve the actual owner of a booking from user_uuid or user_id (email)."""
    if booking.user_uuid:
        owner = session.get(User, booking.user_uuid)
        if owner:
            return owner
    if booking.user_id:
        owner = session.exec(
            select(User).where(User.email == booking.user_id)
        ).first()
        if owner:
            return owner
    return None


def _refund_booking_to_owner(
    session: Session, booking: Booking, owner: User, refund_percent: float = 1.0
) -> dict:
    """
    Refund booking cost to owner. Returns metadata dict for audit logging.
    Handles both balance and subscription payment methods.

    refund_percent: 1.0 = full refund (cancellation), 0.5 = 50% (re-rent claim).
    The non-refunded portion is retained as Unbox income.

    Skips refund entirely for `pending` and `waived` bookings — there's
    nothing to give back. Without this guard a series-cancel right after
    creation would credit the user phantom money that was never deducted.
    """
    if booking.payment_status in ("pending", "waived"):
        return {
            "refunded_to": str(owner.id),
            "refunded_to_email": owner.email,
            "refund_percent": 0.0,
            "skipped_reason": booking.payment_status,
        }

    refund_meta = {
        "refunded_to": str(owner.id),
        "refunded_to_email": owner.email,
        "refund_percent": refund_percent,
    }

    if booking.payment_method == "subscription":
        if owner.subscription:
            new_sub = owner.subscription.copy()
            full_hours = (
                booking.hours_deducted
                if booking.hours_deducted is not None
                else (booking.duration / 60)
            )
            refund_hours = round(full_hours * refund_percent, 4)
            retained_hours = round(full_hours - refund_hours, 4)
            rem = new_sub.get("remaining_hours", new_sub.get("remainingHours", 0))
            new_sub["remaining_hours"] = float(rem) + refund_hours
            if "remainingHours" in new_sub:
                del new_sub["remainingHours"]
            # Mirror waive_charge in billing_defer.py: refunding hours back to
            # the pool must also decrement used_hours, or the pool drifts
            # (remaining + used no longer sums to the plan total).
            used = new_sub.get("used_hours", new_sub.get("usedHours", 0))
            new_sub["used_hours"] = max(0.0, float(used) - refund_hours)
            if "usedHours" in new_sub:
                del new_sub["usedHours"]
            owner.subscription = new_sub
            session.add(owner)
            refund_meta["refunded_hours"] = refund_hours
            refund_meta["retained_hours_unbox_income"] = retained_hours
        else:
            refund_meta["refunded_hours"] = 0
            refund_meta["warning"] = "Owner has no subscription to refund to"
    else:
        full_amount = booking.final_price if booking.final_price is not None else 0.0
        refund_amount = round(full_amount * refund_percent, 2)
        retained_amount = round(full_amount - refund_amount, 2)
        owner.balance += refund_amount
        session.add(owner)
        refund_meta["refunded_amount"] = refund_amount
        refund_meta["retained_amount_unbox_income"] = retained_amount

    return refund_meta


def _future_booking_load(session: Session, owner: User) -> tuple[int, float]:
    """Сколько у клиента предстоящих (не отменённых, сегодня-или-позже) броней
    и сколько ₾ по ним ещё предстоит списать в T-24ч. Считаются ВСЕ строки,
    поэтому серии и мульти-слот батчи тоже попадают в счёт. Абонементные и уже
    оплаченные брони в денежный прогноз не входят (часы ≠ деньги / долг уже снят)."""
    from datetime import timezone as _tz2, timedelta as _td2
    today_tb = (datetime.now(_tz2.utc) + _td2(hours=4)).date()
    today_midnight = datetime(today_tb.year, today_tb.month, today_tb.day)
    rows = session.exec(
        select(Booking)
        .where(Booking.status != "cancelled")
        .where(Booking.date >= today_midnight)
        .where((Booking.user_uuid == owner.id) | (Booking.user_id == owner.email))
    ).all()
    projected = 0.0
    for b in rows:
        if (b.payment_status or "paid") == "paid":
            continue  # legacy / уже списано — будущего долга нет
        if b.payment_method == "subscription":
            continue  # списываются часы, не деньги
        amt = b.charge_amount if b.charge_amount is not None else (b.final_price or 0)
        projected += amt or 0
    return len(rows), round(projected, 2)


def _maybe_alert_booking_overload(
    session: Session, owner: User, n_created: int, background_tasks: "BackgroundTasks | None" = None
) -> None:
    """Шлёт админ-маячок, только если ЭТА операция перешагнула порог снизу вверх
    (было ≤ порога, стало > порога). Так серия/батч даёт ровно один алерт, а
    каждая следующая бронь сверх порога не спамит чат. Никогда не бросает
    исключений — побочный эффект уведомления не должен ронять создание брони."""
    try:
        count, projected = _future_booking_load(session, owner)
        before = count - n_created
        if before > FUTURE_BOOKING_ALERT_THRESHOLD or count <= FUTURE_BOOKING_ALERT_THRESHOLD:
            return  # порог в этой операции не пересечён
        balance = owner.balance or 0
        limit = owner.credit_limit or 0
        debt = projected - balance - limit
        fields = {
            "Клиент":            owner.name or owner.email,
            "Будущих броней":    f"{count} (порог {FUTURE_BOOKING_ALERT_THRESHOLD}, вкл. серии)",
            "К списанию (T-24ч)": f"{projected:g} ₾" if projected else "по абонементу",
            "Баланс / лимит":    f"{balance:g} ₾ / {limit:g} ₾",
        }
        if debt > 0:
            fields["⚠️ Прогноз долга"] = f"{debt:g} ₾"
        if background_tasks is not None:
            background_tasks.add_task(
                telegram_service.send_admin_event,
                event="future_booking_overload",
                fields=fields,
            )
        else:
            telegram_service.send_admin_event(event="future_booking_overload", fields=fields)
    except Exception as e:
        logger.warning(f"[overload alert] non-blocking failure: {e}")


def _assert_start_not_past(booking_date: datetime, start_time: str, is_admin: bool) -> None:
    """Reject bookings whose start is already in the past.

    Non-admins: no past starts at all. Admins/senior/owner: up to 12h
    backdating (per owner policy). Previously this was enforced ONLY on the
    frontend — a direct API call could create a past booking, which also
    skipped the hot-approval gate (past => diff<=0 => not "hot" => confirmed).
    `booking_date` is Tbilisi-naive midnight; `start_time` is 'HH:MM' Tbilisi.
    """
    from datetime import timezone as _tz, timedelta as _td
    try:
        hh, mm = (int(x) for x in str(start_time).split(":")[:2])
    except (ValueError, AttributeError):
        return  # malformed time — handled by check_availability
    base = booking_date.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if base.tzinfo is None:
        start_utc = (base - _td(hours=4)).replace(tzinfo=_tz.utc)  # Tbilisi -> UTC
    else:
        start_utc = base.astimezone(_tz.utc)
    diff_h = (start_utc - datetime.now(_tz.utc)).total_seconds() / 3600.0
    if diff_h < 0:
        if not is_admin:
            raise HTTPException(status_code=400, detail="Нельзя бронировать на прошедшее время.")
        if diff_h < -12.0:
            raise HTTPException(
                status_code=400,
                detail="Задним числом можно бронировать не более чем на 12 часов назад.",
            )


# ─── GET endpoints ────────────────────────────────────────────────────────────

@router.get("/me", response_model=List[BookingRead])
def read_my_bookings(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
    skip: int = 0,
    limit: int = 2000,
) -> Any:
    """Retrieve current user's bookings.

    Default limit raised to 2000 + ORDER BY date DESC so heavy-CRM
    specialists (Mykola has 100+) still get their full booking history.
    Earlier we capped at 100 with no sort, which silently dropped the most
    recent rows — chessboard then treated the missing bookings as
    "anonymous public" and rendered them as "Занято" instead of the
    linked client name.

    Match on (user_uuid OR user_id-as-email OR any prior-email recorded in
    `comment_history` for an email_change event). The narrow
    `user_id == email` filter we used to have hid bookings whenever the
    same human had multiple accounts (Telegram-Login synthetic email +
    real Gmail), or when the admin renamed their email — old rows still
    carried the prior email and silently disappeared from "Мои брони".
    """
    # Mine prior emails out of the user's audit log, so a renamed account
    # still owns its historical bookings on the user side. Cheap because
    # `comment_history` lives on the User row and rarely exceeds dozens
    # of entries.
    prior_emails: set[str] = set()
    for entry in (current_user.comment_history or []):
        if isinstance(entry, dict) and entry.get("type") == "email_change":
            old = (entry.get("old_email") or "").strip().lower()
            if old:
                prior_emails.add(old)

    email_lc = (current_user.email or "").strip().lower()
    candidate_emails = list(prior_emails | {email_lc}) if email_lc else list(prior_emails)

    cond = (Booking.user_uuid == current_user.id)
    if candidate_emails:
        cond = cond | (Booking.user_id.in_(candidate_emails))  # type: ignore[union-attr]

    statement = (
        select(Booking)
        .where(cond)
        .order_by(Booking.date.desc())
        .offset(skip)
        .limit(limit)
    )
    bookings = session.exec(statement).all()
    return [enrich_booking_status(b) for b in bookings]


@router.get("/", response_model=List[BookingRead])
def read_bookings(
    session: Session = Depends(deps.get_session),
    skip: int = 0,
    limit: int = Query(5000, le=20000),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Retrieve all bookings (Admin only).

    Returns rows ordered by date DESC so the admin chessboard sees the
    NEWEST bookings first when the result is truncated. Without explicit
    ORDER BY postgres returned the table in insertion order, which meant
    the most recently-added recurring bookings (the ones admins had just
    placed) silently fell off the end past the 1000-row limit and didn't
    render on the chessboard. Limit raised to 5000 to give breathing room
    on top of the sort, and capped at 20k just in case.
    """
    bookings = session.exec(
        select(Booking)
        .order_by(Booking.date.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return [enrich_booking_status(b) for b in bookings]


@router.get("/public", response_model=List[BookingPublicRead])
@limiter.limit("60/minute")
def read_public_bookings(
    request: Request,
    session: Session = Depends(deps.get_session),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Any:
    """Retrieve confirmed bookings for availability display (Public).
    Returns BookingPublicRead — no user PII (email/uuid) exposed.

    * A `start_date` is enforced (default: today) so the endpoint never
      streams the full booking history to the internet.
    * Window is capped to 60 days ahead — more than any real chessboard
      needs, but prevents `start_date=2020-01-01` style pulls.
    * Result is capped to 1000 rows defensively.
    """
    # Default start_date = today. This is the big one — without it the query
    # used to return every booking ever created.
    try:
        s_date = datetime.strptime(start_date, "%Y-%m-%d") if start_date else datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    except ValueError:
        s_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # end_date defaults to start + 60 days; any `end_date` further is clamped.
    max_window_days = 60
    default_end = s_date + timedelta(days=max_window_days)
    try:
        e_date = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59) if end_date else default_end
    except ValueError:
        e_date = default_end
    if (e_date - s_date).days > max_window_days:
        e_date = s_date + timedelta(days=max_window_days)

    query = (
        select(Booking)
        .where(Booking.status == "confirmed")
        .where(Booking.date >= s_date)
        .where(Booking.date <= e_date)
        .limit(1000)
    )

    bookings = session.exec(query).all()
    return [enrich_booking_status(b) for b in bookings]


# ─── External events from Google Calendar (Excel #15, #32, #38) ──────────────
# Pull-side of the two-way GCal sync. The push side already runs: every
# confirmed booking creates an event in the cabinet's Google Calendar.
# This endpoint returns manual events a cleaner/phone-booking admin added
# straight in GCal so the chessboard can render them as "busy".

@router.get("/external-events")
# 30/min was tight: the chessboard fires one call per cabinet (≥9) per
# week navigation, mobile Safari users hit the cap by just paging the
# week selector twice. 120/min keeps the cap meaningful (hard floor on
# the underlying Google quota) without normal admin scrolling tripping
# it. The downstream service still has its own retry/timeout discipline.
@limiter.limit("120/minute")
def read_external_events(
    request: Request,
    resource_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    session: Session = Depends(deps.get_session),
) -> Any:
    """Return Google Calendar events for a specific resource in a time window.
    Public — no auth required so the checkout chessboard can see them."""
    from datetime import timezone as _tz

    # Default window: now → now + 14 days
    try:
        t_min = datetime.fromisoformat(date_from) if date_from else datetime.now()
    except ValueError:
        t_min = datetime.now()
    try:
        t_max = datetime.fromisoformat(date_to) if date_to else (t_min + timedelta(days=14))
    except ValueError:
        t_max = t_min + timedelta(days=14)

    # RFC3339 for the Google API — pin to UTC if naive
    def _rfc3339(d: datetime) -> str:
        if d.tzinfo is None:
            d = d.replace(tzinfo=_tz.utc)
        return d.isoformat()

    # Skip events that we created ourselves — those are Bookings, already
    # sourced by /bookings/public. Keeping them would double-render slots.
    our_event_ids = {
        b.gcal_event_id for b in session.exec(
            select(Booking)
            .where(Booking.resource_id == resource_id)
            .where(Booking.status == "confirmed")
            .where(Booking.gcal_event_id.is_not(None))  # type: ignore
        ).all() if b.gcal_event_id
    }

    events = gcal_service.list_events(
        resource_id=resource_id,
        time_min=_rfc3339(t_min),
        time_max=_rfc3339(t_max),
    )
    return [e for e in events if e.get('id') not in our_event_ids]


# ─── Availability check ──────────────────────────────────────────────────────

class SlotCheckItem(PydanticBaseModel):
    resource_id: str
    date: str  # "YYYY-MM-DD"
    start_time: str  # "HH:MM"
    duration: int  # minutes


@router.post("/check-availability")
def check_slots_availability(
    *,
    session: Session = Depends(deps.get_session),
    slots: List[SlotCheckItem],
) -> Any:
    """Pre-check slot availability (no auth required)."""
    results = []
    for slot in slots:
        try:
            date = datetime.strptime(slot.date, "%Y-%m-%d")
        except ValueError:
            results.append({"available": False, "conflict": "Некорректная дата"})
            continue

        available, conflict = check_availability(
            session=session,
            resource_id=slot.resource_id,
            date=date,
            start_time=slot.start_time,
            duration=slot.duration,
        )

        if not available:
            # Check if conflict is with a re-rent-listed booking
            re_rent = find_re_rent_conflicts(
                session=session,
                resource_id=slot.resource_id,
                date=date,
                start_time=slot.start_time,
                duration=slot.duration,
            )
            if re_rent:
                results.append({
                    "available": False,
                    "conflict": conflict,
                    "re_rent_available": True,
                    "re_rent_booking_ids": [str(b.id) for b in re_rent],
                })
                continue

        results.append({"available": available, "conflict": conflict})
    return results


# ─── Create booking ──────────────────────────────────────────────────────────

@router.post("/", response_model=BookingRead)
def create_booking(
    *,
    session: Session = Depends(deps.get_session),
    booking_in: BookingCreate,
    current_user: User = Depends(deps.get_current_user),
    background_tasks: BackgroundTasks,
) -> Any:
    """Create new booking."""
    # Booking is specialist-only — clients without an approved specialist
    # profile can't rent cabinets. Admins can still book on behalf of others
    # (see `target_user_id` flow below).
    deps.require_can_book(current_user)
    try:
        # Minimum booking duration: 60 minutes (Unbox policy)
        MIN_BOOKING_DURATION = 60
        if booking_in.duration < MIN_BOOKING_DURATION:
            raise HTTPException(
                status_code=400,
                detail=f"Минимальная длительность бронирования — {MIN_BOOKING_DURATION} минут (1 час).",
            )

        # Normalize date — strip time component to avoid timezone shift issues
        if booking_in.date:
            booking_in.date = booking_in.date.replace(
                hour=0, minute=0, second=0, microsecond=0
            )

        # Determine booking owner upfront so check_availability can produce
        # a "у вас уже есть бронь" reason when the conflict is the same
        # user's own slot. Used to live below the availability call (which
        # caused UnboundLocalError when I wired the friendly message).
        booking_owner = current_user
        if current_user.role in ADMIN_ROLES and booking_in.target_user_id:
            target = None
            try:
                target = session.get(User, UUID(booking_in.target_user_id))
            except ValueError:
                pass
            if not target:
                target = session.exec(
                    select(User).where(User.email == booking_in.target_user_id)
                ).first()
            if target:
                booking_owner = target

        # Reject past-dated starts (non-admin: none; admin: up to 12h back).
        _assert_start_not_past(
            booking_in.date, booking_in.start_time,
            is_admin=current_user.role in ADMIN_ROLES,
        )

        is_available, reason = check_availability(
            session=session,
            resource_id=booking_in.resource_id,
            date=booking_in.date,
            start_time=booking_in.start_time,
            duration=booking_in.duration,
            lock_rows=True,  # SELECT FOR UPDATE: prevents race condition on double booking
            requester_user_uuid=booking_owner.id,
        )

        # Privilege-escalation guard: spec A must not be able to attach
        # a booking to spec B's CRM client. Without this check the booking's
        # `crm_client_id` would silently link any client_id passed by the
        # client. Admins booking on behalf of a spec (target_user_id flow)
        # set `booking_owner` to that spec, so the comparison is uniform —
        # the linked CRM client must belong to whoever the booking is for.
        if booking_in.crm_client_id:
            from app.models.therapist_client import TherapistClient as _TC
            _client = session.get(_TC, booking_in.crm_client_id)
            if not _client:
                raise HTTPException(status_code=404, detail="CRM client not found")
            if _client.specialist_id != str(booking_owner.id):
                raise HTTPException(
                    status_code=403,
                    detail="Этот клиент принадлежит другому специалисту",
                )

        if not is_available:
            # Check if conflict is with re-rent-listed booking(s)
            re_rent_conflicts = find_re_rent_conflicts(
                session=session,
                resource_id=booking_in.resource_id,
                date=booking_in.date,
                start_time=booking_in.start_time,
                duration=booking_in.duration,
            )

            if not re_rent_conflicts:
                # Genuine conflict with non-re-rent booking
                raise HTTPException(
                    status_code=400, detail=f"Time slot is already booked: {reason}"
                )

            # Auto-cancel all conflicting re-rent bookings with 50% refund.
            # Re-rent policy: original owner gets 50%, remaining 50% = Unbox income.
            RE_RENT_REFUND_PERCENT = 0.5

            for re_rent_booking in re_rent_conflicts:
                re_rent_owner = _resolve_booking_owner(session, re_rent_booking)
                refund_meta = {}
                refund_amount = 0.0

                if re_rent_owner:
                    refund_meta = _refund_booking_to_owner(
                        session, re_rent_booking, re_rent_owner,
                        refund_percent=RE_RENT_REFUND_PERCENT,
                    )
                    refund_amount = float(refund_meta.get("refunded_amount", 0.0)) if isinstance(refund_meta, dict) else 0.0

                # Cancel the re-rent booking + remember refund details on
                # the row itself so the UI can render a "Возвращено 50%
                # (X ₾)" badge without joining timeline events.
                re_rent_booking.status = "cancelled"
                re_rent_booking.cancellation_reason = (
                    f"Auto-cancelled: slot re-rented to another user (50% refund · "
                    f"{refund_amount:.2f}GEL)"
                )
                re_rent_booking.cancelled_by = "system:re-rent"
                re_rent_booking.is_re_rent_listed = False
                re_rent_booking.updated_at = datetime.now()
                session.add(re_rent_booking)

                # Notify the original owner via Telegram (best-effort —
                # never blocks the new booking creation).
                try:
                    if re_rent_owner and re_rent_owner.telegram_id:
                        from app.models.resource import Resource as ResModel
                        from app.models.location import Location as LocModel
                        rb_res = session.get(ResModel, re_rent_booking.resource_id)
                        rb_loc = (
                            session.get(LocModel, rb_res.location_id)
                            if rb_res and rb_res.location_id else None
                        )
                        telegram_service.send_rerent_taken(
                            chat_id=str(re_rent_owner.telegram_id),
                            resource_name=(rb_res.name if rb_res else re_rent_booking.resource_id),
                            location_name=(rb_loc.name if rb_loc else None),
                            date=re_rent_booking.date,
                            start_time=re_rent_booking.start_time,
                            refund_amount=refund_amount,
                            new_balance=float(re_rent_owner.balance or 0.0),
                            booking_id=str(re_rent_booking.id),
                        )
                except Exception as e:
                    logger.warning(f"[TG re-rent owner alert] failed: {e}")

                # GCal cleanup
                if re_rent_booking.gcal_event_id:
                    try:
                        gcal_service.delete_event(
                            re_rent_booking.gcal_event_id,
                            re_rent_booking.resource_id,
                        )
                    except Exception as e:
                        logger.warning(
                            f"[GCal Auto-cancel re-rent] delete_event failed for "
                            f"booking={re_rent_booking.id} event={re_rent_booking.gcal_event_id}: {e}"
                        )
                    re_rent_booking.gcal_event_id = None

                # Audit log for auto-cancel with 50% refund details
                timeline_service.log_event(
                    session=session,
                    actor_id=current_user.id,
                    actor_role=current_user.role,
                    target_id=str(re_rent_booking.id),
                    target_type="booking",
                    event_type="booking_auto_cancelled_re_rent",
                    description=(
                        f"Booking auto-cancelled due to re-rent claim by {current_user.name}. "
                        f"Owner refunded {int(RE_RENT_REFUND_PERCENT * 100)}%, rest → Unbox income."
                    ),
                    metadata={
                        "refund_percent": RE_RENT_REFUND_PERCENT,
                        "new_booking_user": current_user.email,
                        **refund_meta,
                    },
                )
            # Slot is now free — proceed with creating the new booking

        # (booking_owner already resolved above, before check_availability)

        # Pricing & Payment
        from app.services.pricing import PricingService

        try:
            h, m = map(int, booking_in.start_time.split(":"))
            start_dt = booking_in.date.replace(
                hour=h, minute=m, second=0, microsecond=0
            )
        except Exception:
            start_dt = booking_in.date

        pricing_service = PricingService(session)
        quote = pricing_service.calculate_price(
            user=booking_owner,
            resource_id=booking_in.resource_id,
            start_time=start_dt,
            duration_minutes=booking_in.duration,
            format_type=booking_in.format,
        )

        # Add extras (sandbox / projector / couch / coffee) on top of the
        # room price. Server-side `calculate_price` only handles the room
        # rate; extras come as IDs in `booking_in.extras` and are priced
        # via PricingService.EXTRAS_PRICES (same registry the client uses).
        # Without this the server was overwriting the client-sent price
        # back to room-only, silently dropping the cost of add-ons.
        extras_ids = list(booking_in.extras or [])
        unknown_extras = PricingService.validate_extras(extras_ids)
        if unknown_extras:
            raise HTTPException(
                status_code=400,
                detail=f"Неизвестные допуслуги: {', '.join(unknown_extras)}",
            )
        extras_price = PricingService.calculate_extras_price(extras_ids)
        # `quote` is a dataclass-like object; we can mutate its final_price
        # so all downstream code (balance check, deduction, charge_amount)
        # uses the room+extras total.
        quote.final_price = round(float(quote.final_price or 0) + extras_price, 2)

        # ── Deferred billing gate ──────────────────────────────────────────
        # >24h to start → create as `pending`, cron settles at T-24h.
        # ≤24h → legacy charge-now path (slot is too imminent to defer).
        # Subscription-plan validation still runs upfront either way so
        # users with a depleted plan see the error immediately rather
        # than silently failing 24h later.
        from datetime import timedelta as _td_single
        _now_tb_single = datetime.utcnow() + _td_single(hours=4)
        defer_charge_single = (start_dt - _now_tb_single).total_seconds() > 24 * 3600

        if booking_in.payment_method == "subscription":
            if quote.applied_rule != "SUBSCRIPTION":
                raise HTTPException(
                    status_code=400,
                    detail="Insufficient subscription hours or invalid format for plan",
                )
            if not defer_charge_single and booking_owner.subscription:
                new_sub = booking_owner.subscription.copy()
                rem = new_sub.get(
                    "remaining_hours", new_sub.get("remainingHours", 0)
                )
                used = new_sub.get("used_hours", new_sub.get("usedHours", 0))
                new_sub["remaining_hours"] = max(
                    0, float(rem) - quote.hours_deducted
                )
                new_sub["used_hours"] = float(used) + quote.hours_deducted
                if "remainingHours" in new_sub:
                    del new_sub["remainingHours"]
                if "usedHours" in new_sub:
                    del new_sub["usedHours"]
                booking_owner.subscription = new_sub
        else:
            if not defer_charge_single:
                available_funds = booking_owner.balance + booking_owner.credit_limit
                if available_funds < quote.final_price:
                    user_name = booking_owner.name or booking_owner.email
                    raise HTTPException(
                        status_code=400,
                        detail=f"Недостаточно средств у пользователя {user_name}. "
                        f"Необходимо: {quote.final_price}₾, доступно: {available_funds}₾ "
                        f"(баланс: {booking_owner.balance}₾, кредит: {booking_owner.credit_limit}₾). "
                        f"Пополните баланс перед бронированием.",
                    )
                # round(..., 2) — float arithmetic accumulates fractional cents
                # over thousands of bookings; without rounding the displayed
                # balance and audit total drift apart.
                booking_owner.balance = round((booking_owner.balance or 0) - quote.final_price, 2)

        booking_in.final_price = quote.final_price
        booking_in.base_price = quote.base_price
        booking_in.applied_rule = quote.applied_rule
        booking_in.discount_amount = quote.discount_amount
        booking_in.discount_percent = quote.discount_percent
        booking_in.hours_deducted = quote.hours_deducted
        # Stamp payment_status here on the pydantic input — the actual
        # Booking row is built from booking_in down below.
        booking_in.payment_status = "pending" if defer_charge_single else "paid"
        if not defer_charge_single:
            booking_in.charged_at = datetime.utcnow()
            booking_in.charge_amount = quote.final_price

        # Peak hours subscription debt: deduct from balance (goes negative = debt)
        # Only applies to legacy charge-now path; deferred path leaves it
        # for the cron to handle alongside the main charge.
        peak_debt = quote.subscription_peak_debt
        if not defer_charge_single and peak_debt > 0 and booking_in.payment_method == "subscription":
            booking_owner.balance = round((booking_owner.balance or 0) - peak_debt, 2)

        # ── Hot Booking Approval Gate ──
        # Approval threshold depends on the WEEKDAY of the booking start:
        #   * Mon-Fri Tbilisi → 12h (regular flow)
        #   * Sat-Sun Tbilisi → 24h (weekend admin coverage is patchier,
        #     so the lead-time admins want for outside-of-day bookings is
        #     longer per 2026-05-15 spec).
        # No discount for hot bookings — only admin approval required.
        is_admin_or_above = current_user.role in ("admin", "senior_admin", "owner")
        # `start_dt` is a NAIVE datetime built from `Booking.date` (naive UTC
        # midnight of the Tbilisi calendar day) + `start_time` "HH:MM" in
        # Tbilisi local. The previous version slapped tzinfo=UTC on it, which
        # was wrong by 4h: a booking at 09:00 Tbilisi was treated as 09:00
        # UTC → diff vs real UTC now was 4h too big, and bookings that *were*
        # within 12 hours got classified as not-hot, never went to
        # `pending_approval`, and admins got no TG alert.
        # Convert correctly: Tbilisi local → UTC = subtract 4h.
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td
        _TB_OFFSET = _td(hours=4)
        _now = _dt.now(_tz.utc)
        _start_utc = (start_dt - _TB_OFFSET).replace(tzinfo=_tz.utc) if start_dt.tzinfo is None else start_dt.astimezone(_tz.utc)
        _diff_hours = (_start_utc - _now).total_seconds() / 3600.0
        # weekday() on Tbilisi-local start_dt: 5=Sat, 6=Sun
        _is_weekend = start_dt.weekday() >= 5
        HOT_BOOKING_THRESHOLD_HOURS = 24 if _is_weekend else 12
        is_hot = 0 < _diff_hours <= HOT_BOOKING_THRESHOLD_HOURS

        if is_hot and not is_admin_or_above:
            # Don't deduct balance — set status to pending_approval
            # Revert balance deduction that happened above
            if booking_in.payment_method != "subscription":
                # undo deduction (rounded — see comment above)
                booking_owner.balance = round((booking_owner.balance or 0) + quote.final_price, 2)
            else:
                # Undo subscription deduction
                if booking_owner.subscription:
                    new_sub = booking_owner.subscription.copy()
                    rem = new_sub.get("remaining_hours", 0)
                    used = new_sub.get("used_hours", 0)
                    new_sub["remaining_hours"] = float(rem) + quote.hours_deducted
                    new_sub["used_hours"] = max(0, float(used) - quote.hours_deducted)
                    booking_owner.subscription = new_sub

            booking_in.status = "pending_approval"

        session.add(booking_owner)

        booking_data = booking_in.dict()
        booking_data["user_uuid"] = booking_owner.id
        booking_data["user_id"] = booking_owner.email
        if "target_user_id" in booking_data:
            del booking_data["target_user_id"]
        # Кто оформил (owner-аналитика по админам).
        booking_data["created_by_id"] = str(current_user.id)
        booking_data["created_by_name"] = current_user.name or ""

        booking = Booking(**booking_data)

        session.add(booking)
        session.commit()
        session.refresh(booking)

        # Consecutive-hours discount: if this booking joins or forms a
        # 0-gap chain on the same (user, resource, day), recompute every
        # member's price at the chain-tier discount and settle balance.
        # Skip for subscription (no money), pending_approval (not yet
        # paid) and intervision/group? — actually format-agnostic; tier
        # is purely about hours.
        if booking.payment_method == "balance" and booking.status == "confirmed":
            try:
                from app.services.consecutive_pricing import recompute_user_chains_for_day
                recompute_user_chains_for_day(
                    session,
                    booking_owner,
                    booking.resource_id,
                    booking.date,
                    actor_id=str(current_user.id),
                    actor_role=current_user.role,
                    reason="create_booking",
                )
                session.refresh(booking)  # may have been re-priced
            except Exception:
                logger.exception("[consecutive] recompute on create failed")

        # Peak hours subscription debt notification
        if peak_debt > 0 and booking_in.payment_method == "subscription":
            try:
                from app.models.notification import Notification
                resource_name = booking_in.resource_id
                try:
                    from app.models.resource import Resource as ResModel
                    res_obj = session.get(ResModel, booking_in.resource_id)
                    if res_obj:
                        resource_name = res_obj.name or booking_in.resource_id
                except Exception:
                    pass
                peak_hours_count = quote.peak_slot_count / 2.0
                notif = Notification(
                    type="peak_hours_debt",
                    title="Доплата за пиковые часы",
                    description=(
                        f"Абонемент покрывает стандартные часы. "
                        f"Бронь {resource_name} {booking.date.strftime('%d.%m')} {booking.start_time} включает "
                        f"{peak_hours_count:.0f} ч. пиковых часов (9–10, 20–22) — "
                        f"доплата {peak_debt:.0f} ₾ (5 ₾/ч) списана со счёта."
                    ),
                    recipient_id=str(booking_owner.id),
                    icon="Clock",
                    link="/bookings",
                )
                session.add(notif)
                session.commit()
            except Exception as e:
                logger.warning(f"[Peak debt notification] Error: {e}")

        # Google Calendar Sync — push in a BackgroundTask so the response
        # returns instantly. Synchronous push used to block 30+ s on a
        # slow Google API and trip the frontend axios timeout, making
        # users think the booking failed and retry (creating duplicates).
        background_tasks.add_task(
            _gcal_create_in_background,
            str(booking.id),
            booking_owner.name,
        )

        # ── Booking notifications (fire-and-forget) ──
        # Two paths:
        #   confirmed         → standard "Бронь подтверждена" TG + email
        #   pending_approval  → "Заявка отправлена" TG (Марина Бусина
        #                       2026-05-17: clients had radio silence
        #                       until admin pressed approve)
        if booking.status in ("confirmed", "pending_approval"):
            try:
                from app.models.resource import Resource as ResModel
                from app.models.location import Location as LocModel

                res_obj = session.get(ResModel, booking.resource_id)
                loc_obj = session.get(LocModel, booking.location_id)
                resource_name = res_obj.name if res_obj else booking.resource_id
                location_name = loc_obj.name if loc_obj else booking.location_id

                if booking.status == "pending_approval":
                    if booking_owner.telegram_id:
                        background_tasks.add_task(
                            telegram_service.send_booking_pending_approval,
                            chat_id=str(booking_owner.telegram_id),
                            user_name=booking_owner.name,
                            resource_name=resource_name,
                            location_name=location_name,
                            date=booking.date,
                            start_time=booking.start_time,
                            duration_minutes=booking.duration,
                            final_price=booking.final_price,
                            booking_id=str(booking.id),
                        )
                    # In-app notification — visible in NotificationBell even
                    # for clients without a linked TG account.
                    try:
                        from app.models.notification import Notification
                        date_label = booking.date.strftime("%d.%m.%Y")
                        notif = Notification(
                            type="booking_pending_approval",
                            title="Заявка на бронь отправлена админу",
                            description=(
                                f"{resource_name} · {location_name} · "
                                f"{date_label} {booking.start_time}. "
                                f"Срочная бронь — ждите подтверждения админа."
                            ),
                            recipient_id=str(booking_owner.id),
                            icon="Clock",
                            link="/dashboard/bookings",
                        )
                        session.add(notif)
                        session.commit()
                    except Exception as e:
                        logger.warning(f"[Pending-approval in-app notif] {e}")
                else:
                    common_ctx = dict(
                        user_name=booking_owner.name,
                        resource_name=resource_name,
                        location_name=location_name,
                        location_address=(loc_obj.address if loc_obj else None),
                        date=booking.date,
                        start_time=booking.start_time,
                        duration_minutes=booking.duration,
                        format_type=booking.format,
                        final_price=booking.final_price,
                        payment_method=booking.payment_method,
                        booking_id=str(booking.id),
                        # Itemise extras in TG/email so user sees what the
                        # +N ₾ in total stands for (owner 2026-05-29).
                        extras=list(booking.extras or []),
                    )

                    # Telegram (primary channel for our audience)
                    if booking_owner.telegram_id:
                        background_tasks.add_task(
                            telegram_service.send_booking_confirmation,
                            chat_id=str(booking_owner.telegram_id),
                            **common_ctx,
                        )

                    # Email (fallback / secondary — disabled by default on prod).
                    # Drop user_name + extras (email signature doesn't accept them).
                    if booking_owner.email and not booking_owner.email.endswith("@telegram.unbox"):
                        background_tasks.add_task(
                            email_service.send_booking_confirmation,
                            to_email=booking_owner.email,
                            to_name=booking_owner.name,
                            **{k: v for k, v in common_ctx.items()
                               if k not in ("user_name", "extras")},
                        )
            except Exception as e:
                # Never block the booking flow on notification errors
                logger.warning(f"[Booking notification] Non-blocking failure: {e}")

        # ── Admin chat alert (real-time visibility for the team) ──
        try:
            from app.models.resource import Resource as ResModel
            from app.models.location import Location as LocModel
            res_obj = session.get(ResModel, booking.resource_id)
            loc_obj = session.get(LocModel, booking.location_id)
            res_name = res_obj.name if res_obj else booking.resource_id
            loc_name = loc_obj.name if loc_obj else booking.location_id
            date_label = booking.date.strftime("%d.%m.%Y")
            end_h = (int(booking.start_time[:2]) * 60 + int(booking.start_time[3:5]) + booking.duration) // 60
            end_m = (int(booking.start_time[:2]) * 60 + int(booking.start_time[3:5]) + booking.duration) % 60
            time_label = f"{booking.start_time}–{end_h:02d}:{end_m:02d}"
            event_type = "booking_pending_approval" if booking.status == "pending_approval" else "booking_created"

            # Human-readable extras for the alert. EXTRAS_PRICES keys map to
            # short Russian labels so the admin chat shows "Песочница, Кушетка"
            # instead of "sandbox, couch". Falls back to raw id for unknowns.
            extras_labels_map = {
                "sandbox": "Песочница с игрушками",
                "projector": "Проектор",
                "couch": "Кушетка",
                "coffee_meama": "Кофе Меама",
                "sandbox_toys": "Игрушки для песочной",
                "flipchart": "Флипчарт",
            }
            extras_ids_for_alert = list(booking.extras or [])
            extras_pretty = ", ".join(extras_labels_map.get(e, e) for e in extras_ids_for_alert) if extras_ids_for_alert else None

            fields_dict = {
                "Арендатор": booking_owner.name or booking_owner.email,
                "Когда":     f"{date_label} · {time_label}",
                "Кабинет":   f"{res_name} · {loc_name}",
                "Сумма":     f"{booking.final_price:g} ₾" if booking.final_price else "по абонементу",
            }
            if extras_pretty:
                # Inline note on the main alert AND a separate focused alert
                # below, so admins can either skim the main feed or filter
                # for "what needs preparing today".
                fields_dict["Допуслуги"] = extras_pretty

            # Inline-кнопки только для pending_approval — на confirmed
            # они избыточны (бронь уже сама себя обработала). Callback_data
            # формат "ba:<id>" / "br:<id>" — короткий, чтобы влезть в
            # 64 байта TG-лимита даже с длинными UUID.
            tg_markup: Optional[dict] = None
            if booking.status == "pending_approval":
                tg_markup = {
                    "inline_keyboard": [[
                        {"text": "✅ Подтвердить", "callback_data": f"ba:{booking.id}"},
                        {"text": "❌ Отклонить",   "callback_data": f"br:{booking.id}"},
                    ]]
                }
            background_tasks.add_task(
                telegram_service.send_admin_event,
                event=event_type,
                fields=fields_dict,
                reply_markup=tg_markup,
            )

            # Separate, prep-focused alert when extras are present. The
            # full booking event is still sent above; this one is purely
            # a prep cue ("в кабинете 5 завтра 16:00 нужен проектор и
            # кушетка") so admins don't have to scroll a busy chat to
            # find which bookings need set-up.
            if extras_pretty:
                background_tasks.add_task(
                    telegram_service.send_admin_event,
                    event="booking_with_extras",
                    fields={
                        "Когда":      f"{date_label} · {time_label}",
                        "Кабинет":    f"{res_name} · {loc_name}",
                        "Подготовить": extras_pretty,
                        "Арендатор":  booking_owner.name or booking_owner.email,
                    },
                )
        except Exception as e:
            logger.warning(f"[Admin TG alert] Non-blocking failure: {e}")

        _maybe_alert_booking_overload(session, booking_owner, 1, background_tasks)
        return booking

    except HTTPException:
        raise
    except ValueError as e:
        # §5#7: известные валидации кидают ValueError с человекочитаемым
        # текстом (напр. «refund_percent must be between 0 and 1») → 400.
        logger.warning(f"Booking creation validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        # Непредвиденная ошибка — 500 (всплывёт в мониторинге, а не молча
        # маскируется под «плохой запрос»). Клиенту — generic без деталей.
        logger.exception("Booking creation failed unexpectedly")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка при создании брони. Попробуйте ещё раз.")


# ─── Multi-slot (same-day split-periods in one resource) ────────────────────
# IMPORTANT: This must be registered BEFORE /{booking_id} routes so FastAPI
# matches "/multi-slot" exactly instead of treating it as a booking_id.

class MultiSlotItem(PydanticBaseModel):
    resource_id: str
    location_id: str = "unbox_one"
    date: str          # "YYYY-MM-DD"
    start_time: str    # "HH:MM"
    duration: int = 60
    format: str = "individual"


class MultiSlotRequest(PydanticBaseModel):
    slots: List[MultiSlotItem]
    payment_method: str = "balance"
    target_user_id: Optional[str] = None
    crm_client_id: Optional[str] = None


@router.post("/multi-slot")
def create_multi_slot_booking(
    *,
    session: Session = Depends(deps.get_session),
    data: MultiSlotRequest,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Excel #24 — book multiple non-contiguous periods in the same (or
    different) cabinets in one operation. All slots share one
    `recurring_group_id` so the admin can later cancel the whole series
    with a single click.

    Booking is specialist-only — see require_can_book.

    Pricing: each slot is priced independently (duration discount applies
    per slot, not across the whole series).

    Atomicity: availability is checked for ALL slots first; if any clashes,
    nothing is created. If pricing fails mid-way through the loop, any
    already-created bookings are rolled back via the session.
    """
    deps.require_can_book(current_user)

    from app.services.pricing import PricingService
    from uuid import uuid4 as gen_uuid4

    if not data.slots:
        raise HTTPException(400, "At least one slot required")
    if len(data.slots) > 20:
        raise HTTPException(400, "Too many slots in one batch (max 20)")

    # Resolve owner (admin can book for another user)
    booking_owner = current_user
    if current_user.role in ADMIN_ROLES and data.target_user_id:
        target = None
        try:
            target = session.get(User, UUID(data.target_user_id))
        except ValueError:
            pass
        if not target:
            target = session.exec(
                select(User).where(User.email == data.target_user_id)
            ).first()
        if target:
            booking_owner = target

    # Same CRM client ownership guard as in single+recurring create paths.
    if data.crm_client_id:
        from app.models.therapist_client import TherapistClient as _TC
        _client = session.get(_TC, data.crm_client_id)
        if not _client:
            raise HTTPException(status_code=404, detail="CRM client not found")
        if _client.specialist_id != str(booking_owner.id):
            raise HTTPException(
                status_code=403,
                detail="Этот клиент принадлежит другому специалисту",
            )

    # Parse + validate dates
    parsed_slots: List[tuple[MultiSlotItem, datetime]] = []
    for s in data.slots:
        try:
            d = datetime.strptime(s.date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, f"Invalid date format for slot: {s.date}")
        parsed_slots.append((s, d))

    # Availability check for ALL slots before creating any.
    # lock_rows=True takes a SELECT FOR UPDATE on overlapping rows so two
    # concurrent multi-slot batches can't both pass the availability check
    # and end up with conflicting bookings (audit found this race).
    conflicts = []
    _is_admin_ms = current_user.role in ADMIN_ROLES
    for s, d in parsed_slots:
        _assert_start_not_past(d, s.start_time, is_admin=_is_admin_ms)
        available, reason = check_availability(
            session=session,
            resource_id=s.resource_id,
            date=d,
            start_time=s.start_time,
            duration=s.duration,
            lock_rows=True,
            requester_user_uuid=booking_owner.id,
        )
        if not available:
            conflicts.append({
                "resource_id": s.resource_id,
                "date": s.date,
                "start_time": s.start_time,
                "reason": reason,
            })
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"{len(conflicts)} of {len(parsed_slots)} slots not available",
                "conflicts": conflicts,
            },
        )

    # All available — create bookings under a single group id
    group_id = str(gen_uuid4())
    created_bookings = []
    total_cost = 0.0
    pricing_service = PricingService(session)

    for s, d in parsed_slots:
        try:
            h, m = map(int, s.start_time.split(":"))
            start_dt = d.replace(hour=h, minute=m, second=0, microsecond=0)
        except Exception:
            start_dt = d

        quote = pricing_service.calculate_price(
            user=booking_owner,
            resource_id=s.resource_id,
            start_time=start_dt,
            duration_minutes=s.duration,
            format_type=s.format,
        )

        # ── Deferred billing per slot ──────────────────────────────────────
        from datetime import timedelta as _td_multi
        _now_tb_multi = datetime.utcnow() + _td_multi(hours=4)
        defer_charge_multi = (start_dt - _now_tb_multi).total_seconds() > 24 * 3600

        if data.payment_method == "subscription":
            if quote.applied_rule != "SUBSCRIPTION":
                raise HTTPException(
                    400,
                    f"Subscription insufficient for slot {s.date} {s.start_time}",
                )
            if not defer_charge_multi and booking_owner.subscription:
                new_sub = booking_owner.subscription.copy()
                # Read BOTH keys (snake + camel) — the pool may be stored in
                # either convention; reading only camelCase wrongly rejects
                # or never decrements a snake_case pool. Mirror the
                # single/recurring paths and normalize to snake on write.
                remaining = new_sub.get(
                    "remaining_hours", new_sub.get("remainingHours", 0)
                ) or 0
                used = new_sub.get("used_hours", new_sub.get("usedHours", 0)) or 0
                hours_deducted = quote.hours_deducted or 0
                if float(remaining) < hours_deducted:
                    raise HTTPException(
                        400,
                        f"Not enough subscription hours for slot {s.date} {s.start_time}",
                    )
                new_sub["remaining_hours"] = max(0, float(remaining) - hours_deducted)
                new_sub["used_hours"] = float(used) + hours_deducted
                if "remainingHours" in new_sub:
                    del new_sub["remainingHours"]
                if "usedHours" in new_sub:
                    del new_sub["usedHours"]
                booking_owner.subscription = new_sub
        else:  # balance
            if not defer_charge_multi:
                available_funds = (booking_owner.balance or 0) + (booking_owner.credit_limit or 0)
                if available_funds < quote.final_price:
                    raise HTTPException(
                        400,
                        f"Insufficient balance for slot {s.date} {s.start_time}. "
                        f"Need {quote.final_price}₾, have {available_funds}₾.",
                    )
                booking_owner.balance = round((booking_owner.balance or 0) - quote.final_price, 2)

        total_cost += quote.final_price

        booking = Booking(
            resource_id=s.resource_id,
            location_id=s.location_id,
            date=d,
            start_time=s.start_time,
            duration=s.duration,
            status="confirmed",
            final_price=quote.final_price,
            base_price=quote.base_price,
            applied_rule=quote.applied_rule,
            discount_amount=quote.discount_amount,
            discount_percent=quote.discount_percent,
            payment_method=data.payment_method,
            payment_source=(
                "subscription" if data.payment_method == "subscription" else "deposit"
            ),
            hours_deducted=quote.hours_deducted,
            format=s.format,
            user_id=booking_owner.email,
            user_uuid=booking_owner.id,
            # Multi-slot is a BATCH, not a recurring series — leaving
            # recurring_group_id NULL so each cell renders as an independent
            # booking (no ⭐, no "Постоянная бронь · N", no
            # "удалить серию"). Batch-id stays only as `group_id` in the
            # response payload + audit timeline event.
            crm_client_id=data.crm_client_id,
            payment_status=("pending" if defer_charge_multi else "paid"),
            charged_at=(None if defer_charge_multi else datetime.utcnow()),
            charge_amount=(None if defer_charge_multi else quote.final_price),
            created_by_id=str(current_user.id),
            created_by_name=current_user.name or "",
        )
        session.add(booking)
        created_bookings.append(booking)

    session.add(booking_owner)
    session.commit()
    for b in created_bookings:
        session.refresh(b)

    # Excel #24 + R33 — Google Calendar sync for the whole batch.
    # Same try/except policy as single-booking create: a GCal failure must
    # NOT roll back the bookings — the source of truth is the DB. We log a
    # warning per failed slot so admin can later use the resync tool.
    gcal_synced = 0
    gcal_failed = 0
    for b in created_bookings:
        try:
            event_id = gcal_service.create_event(b, user_name=booking_owner.name)
            if event_id:
                b.gcal_event_id = event_id
                session.add(b)
                gcal_synced += 1
            else:
                gcal_failed += 1
                logger.warning(
                    f"[GCal Multi-slot] Booking {b.id} created without event_id (no error, just no id returned)"
                )
        except Exception as e:
            gcal_failed += 1
            logger.warning(f"[GCal Multi-slot] Sync failed for booking {b.id}: {e}")
    if gcal_synced > 0:
        session.commit()
    logger.info(
        f"[GCal Multi-slot] Synced {gcal_synced}/{len(created_bookings)} slots in group {group_id}"
    )

    # Consecutive-hours discount: multi-slot is the primary place this
    # rule actually fires, since the user typically picks 2+ adjacent
    # cells in one drag. Recompute every distinct (resource, day) the
    # batch touched — covers chains formed inside the batch as well as
    # chains that join existing bookings.
    if data.payment_method == "balance":
        try:
            from app.services.consecutive_pricing import recompute_user_chains_for_day
            seen: set = set()
            for b in created_bookings:
                key = (b.resource_id, b.date.date() if hasattr(b.date, "date") else b.date)
                if key in seen:
                    continue
                seen.add(key)
                recompute_user_chains_for_day(
                    session,
                    booking_owner,
                    b.resource_id,
                    b.date,
                    actor_id=str(current_user.id),
                    actor_role=current_user.role,
                    reason="create_multi_slot",
                )
            for b in created_bookings:
                session.refresh(b)
        except Exception:
            logger.exception("[consecutive] recompute on multi-slot failed")

    # Audit log
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=group_id,
        target_type="booking_series",
        event_type="multi_slot_booking_created",
        description=(
            f"{len(created_bookings)} slots booked in one operation "
            f"by {current_user.name} for {booking_owner.email}. Total: {total_cost}₾"
        ),
        metadata={
            "group_id": group_id,
            "slot_count": len(created_bookings),
            "total_cost": total_cost,
            "gcal_synced": gcal_synced,
            "gcal_failed": gcal_failed,
        },
    )

    # ── Admin chat alert (multi-slot was previously silent — admins
    # weren't seeing drag-and-drop bookings in their TG feed). One
    # consolidated message per batch with all slot times listed. ──
    try:
        from app.models.resource import Resource as ResModel
        from app.models.location import Location as LocModel
        # Group slots by resource for a compact summary like:
        #   Кабинет 1 · 15:00, 16:30, 19:00
        per_res: dict[str, list[Booking]] = {}
        for b in created_bookings:
            per_res.setdefault(b.resource_id, []).append(b)
        slot_lines = []
        for rid, bs in per_res.items():
            res_obj = session.get(ResModel, rid)
            res_name = res_obj.name if res_obj else rid
            times = ", ".join(sorted(b.start_time for b in bs))
            slot_lines.append(f"{res_name}: {times}")
        # Single date for the batch (multi-slot is same-day per UI flow)
        first_date = created_bookings[0].date if created_bookings else None
        date_label = first_date.strftime("%d.%m.%Y") if first_date else "—"
        loc_obj = session.get(LocModel, created_bookings[0].location_id) if created_bookings else None
        loc_name = loc_obj.name if loc_obj else "—"
        telegram_service.send_admin_event(
            event="booking_created",
            fields={
                "Арендатор": booking_owner.name or booking_owner.email,
                "Когда":     date_label,
                "Слоты":     "\n".join(slot_lines),
                "Кабинет":   loc_name,
                "Сумма":     f"{round(total_cost, 2):g} ₾" if total_cost else "по абонементу",
            },
        )
    except Exception as e:
        logger.warning(f"[Admin TG alert / multi-slot] Non-blocking failure: {e}")

    _maybe_alert_booking_overload(session, booking_owner, len(created_bookings))
    return {
        "ok": True,
        "group_id": group_id,
        "bookings": [enrich_booking_status(b) for b in created_bookings],
        "total_cost": total_cost,
        "gcal_synced": gcal_synced,
        "gcal_failed": gcal_failed,
    }


# ─── Recurring bookings ──────────────────────────────────────────────────────
# IMPORTANT: These must be registered BEFORE /{booking_id} routes so FastAPI
# matches "/recurring" and "/recurring-groups" exactly instead of treating
# them as a booking_id path parameter.

class RecurringBookingRequest(PydanticBaseModel):
    resource_id: str
    location_id: str = "unbox_one"
    start_time: str          # "HH:MM"
    duration: int = 60       # minutes
    format: str = "individual"
    payment_method: str = "balance"
    first_date: str          # "YYYY-MM-DD"
    weeks: int = 12          # kept for backward compat; use occurrences instead
    occurrences: Optional[int] = None   # number of repetitions (overrides weeks if set)
    pattern: str = "weekly"  # "weekly" | "biweekly" | "monthly"
    target_user_id: Optional[str] = None
    crm_client_id: Optional[str] = None


@router.post("/recurring")
def create_recurring_booking(
    *,
    background_tasks: BackgroundTasks,
    session: Session = Depends(deps.get_session),
    data: RecurringBookingRequest,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Create recurring bookings (weekly/biweekly/monthly). Admin can book for another user.
    Booking is specialist-only — see require_can_book.
    """
    deps.require_can_book(current_user)

    from app.services.pricing import PricingService
    from uuid import uuid4 as gen_uuid4

    # Determine booking owner
    booking_owner = current_user
    if current_user.role in ADMIN_ROLES and data.target_user_id:
        target = None
        try:
            target = session.get(User, UUID(data.target_user_id))
        except ValueError:
            pass
        if not target:
            target = session.exec(select(User).where(User.email == data.target_user_id)).first()
        if target:
            booking_owner = target

    # Generate dates
    try:
        first = datetime.strptime(data.first_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")

    n = data.occurrences if data.occurrences is not None else data.weeks

    pattern = data.pattern.lower()
    if pattern == "biweekly":
        dates = [first + timedelta(weeks=i * 2) for i in range(n)]
    elif pattern == "monthly":
        try:
            from dateutil.relativedelta import relativedelta as rdelta
            dates = [first + rdelta(months=i) for i in range(n)]
        except ImportError:
            dates = [first + timedelta(weeks=i * 4) for i in range(n)]
    else:  # weekly (default)
        dates = [first + timedelta(weeks=i) for i in range(n)]

    # ── Anchor adoption ──
    # The CRM "Повторить бронь × N (включая текущую)" flow opens the popup
    # ON an existing booking and asks for N future copies starting from the
    # same date. If we naïvely create N bookings beginning at first_date,
    # the first one collides with the anchor. Detect that case and
    # ABSORB the existing booking into the new series instead — its row
    # gets `recurring_group_id` stamped after creation, and we skip
    # creating a duplicate on the first date.
    anchor_booking = None
    if dates:
        first_d = dates[0]
        day_start = first_d.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        anchor_booking = session.exec(
            select(Booking).where(
                Booking.user_uuid == booking_owner.id,
                Booking.resource_id == data.resource_id,
                Booking.start_time == data.start_time,
                Booking.duration == data.duration,
                Booking.status == "confirmed",
                Booking.date >= day_start,
                Booking.date < day_end,
            )
        ).first()

    # Check availability — skip the first date if we found an anchor (it's
    # legitimately ours and will be adopted, not duplicated).
    # `lock_rows=True` takes a Postgres advisory lock per (resource, day) so
    # parallel "Повторить × N" submits can't both pass the availability
    # check and double-create a series. Without this we accumulated 43
    # historical collisions on prod (3× series clicks landed 3 series in
    # the same slots on unbox_one_room_2 Saturdays).
    conflicts = []
    create_dates = dates[1:] if anchor_booking else dates
    _is_admin_rec = current_user.role in ADMIN_ROLES
    for d in create_dates:
        _assert_start_not_past(d, data.start_time, is_admin=_is_admin_rec)
        available, reason = check_availability(
            session=session,
            resource_id=data.resource_id,
            date=d,
            start_time=data.start_time,
            duration=data.duration,
            requester_user_uuid=booking_owner.id,
            lock_rows=True,
        )
        if not available:
            conflicts.append({
                "date": d.strftime("%Y-%m-%d"),
                "day": d.strftime("%A"),
                "reason": reason,
            })

    if conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Конфликт в {len(conflicts)} из {len(dates)} дат",
                "conflicts": conflicts,
            },
        )

    # All slots available — create bookings
    recurring_group_id = str(gen_uuid4())
    created_bookings = []
    total_cost = 0.0
    # If the booking is linked to a CRM client, every cabinet booking we
    # spawn here gets a matching TherapySession too. Without this the
    # chessboard renders the slot as "✓ Моё" / "Занято" because the
    # client-name lookup goes through TherapySession.booking_id, and the
    # specialist can't quick-pay or open the session from the CRM views.
    # All sessions in the series share one recurring_group_id (separate
    # from the booking series id) so the new "delete future" UX works.
    crm_session_group_id = str(gen_uuid4()) if data.crm_client_id else None
    crm_calendar_id = None
    if data.crm_client_id:
        # Resolve the specialist's personal CRM calendar once — used to push
        # each session into Google Calendar alongside the cabinet event.
        from app.api.v1.crm import get_crm_calendar_id as _get_crm_cal
        crm_calendar_id = _get_crm_cal(booking_owner)
    crm_client_obj = None
    if data.crm_client_id:
        from app.models.therapist_client import TherapistClient
        crm_client_obj = session.get(TherapistClient, data.crm_client_id)
        # Privilege-escalation guard: per-spec CRM is isolated by
        # specialist_id; without this check spec A could attach a series
        # to spec B's client, which would surface B's session/finance data
        # in A's chess view. Admins legitimately book on behalf of any
        # spec, so target_user_id resolution upstream sets booking_owner;
        # we compare to that, not to current_user.
        if crm_client_obj and crm_client_obj.specialist_id != str(booking_owner.id):
            raise HTTPException(
                status_code=403,
                detail="Этот клиент принадлежит другому специалисту",
            )

    # Adopt the anchor into the new series (idempotent UPDATE — no extra
    # booking, no duplicate balance debit, no GCal duplicate).
    if anchor_booking is not None:
        anchor_booking.recurring_group_id = recurring_group_id
        anchor_booking.updated_at = datetime.now()
        session.add(anchor_booking)
        created_bookings.append(str(anchor_booking.id))

    # Iterate over only the dates we actually need to create.
    for d in create_dates:
        try:
            h, m = map(int, data.start_time.split(":"))
            start_dt = d.replace(hour=h, minute=m, second=0, microsecond=0)
        except Exception:
            start_dt = d

        pricing_service = PricingService(session)
        quote = pricing_service.calculate_price(
            user=booking_owner,
            resource_id=data.resource_id,
            start_time=start_dt,
            duration_minutes=data.duration,
            format_type=data.format,
        )

        # ── Deferred billing for recurring series ──────────────────────────
        # Each occurrence ≥24h away is held as `pending` and charged by the
        # cron at T-24h. The first occurrence may already be inside the
        # window — it gets the legacy charge-now path so the slot is paid
        # before it starts. Subscription validation still happens upfront
        # to fail fast on a depleted plan.
        from datetime import timedelta as _td_recur
        _start_tb = d.replace(hour=int(data.start_time.split(":")[0]), minute=int(data.start_time.split(":")[1]))
        _now_tb = datetime.utcnow() + _td_recur(hours=4)
        defer_charge = (_start_tb - _now_tb).total_seconds() > 24 * 3600

        if data.payment_method == "subscription":
            if quote.applied_rule != "SUBSCRIPTION":
                raise HTTPException(
                    400, f"Subscription insufficient for {d.strftime('%Y-%m-%d')}"
                )
            if not defer_charge and booking_owner.subscription:
                new_sub = booking_owner.subscription.copy()
                rem = new_sub.get("remaining_hours", new_sub.get("remainingHours", 0))
                new_sub["remaining_hours"] = max(0, float(rem) - quote.hours_deducted)
                used = new_sub.get("used_hours", new_sub.get("usedHours", 0))
                new_sub["used_hours"] = float(used) + quote.hours_deducted
                if "remainingHours" in new_sub:
                    del new_sub["remainingHours"]
                if "usedHours" in new_sub:
                    del new_sub["usedHours"]
                booking_owner.subscription = new_sub
        else:
            if not defer_charge:
                available_funds = booking_owner.balance + booking_owner.credit_limit
                if available_funds < quote.final_price:
                    raise HTTPException(
                        400,
                        f"Insufficient funds for {d.strftime('%Y-%m-%d')}. Required: {quote.final_price}, Available: {available_funds}",
                    )
                booking_owner.balance = round((booking_owner.balance or 0) - quote.final_price, 2)

        session.add(booking_owner)

        booking = Booking(
            resource_id=data.resource_id,
            location_id=data.location_id,
            date=d,
            start_time=data.start_time,
            duration=data.duration,
            status="confirmed",
            final_price=quote.final_price,
            base_price=quote.base_price,
            applied_rule=quote.applied_rule,
            discount_amount=quote.discount_amount,
            discount_percent=quote.discount_percent,
            hours_deducted=quote.hours_deducted if data.payment_method == "subscription" else None,
            payment_method=data.payment_method,
            format=data.format,
            extras=[],
            user_id=booking_owner.email,
            user_uuid=booking_owner.id,
            crm_client_id=data.crm_client_id,
            recurring_group_id=recurring_group_id,
            payment_status=("pending" if defer_charge else "paid"),
            charged_at=(None if defer_charge else datetime.utcnow()),
            charge_amount=(None if defer_charge else quote.final_price),
            created_by_id=str(current_user.id),
            created_by_name=current_user.name or "",
        )
        session.add(booking)
        session.flush()

        # GCal sync (cabinet calendar) — §5#2 (2026-07-10): вынесено из цикла
        # в background_tasks ПОСЛЕ коммита. Раньше N синхронных вызовов Google
        # в одном запросе (12+ для серии) блокировали и, при обрыве до коммита,
        # оставляли «призрачные» события для уже обработанных дат (роллбэк БД их
        # не удалял). Теперь события создаются только для реально закоммиченных
        # броней — см. цикл планирования после session.commit() ниже.

        # Auto-create the matching CRM TherapySession if the booking is
        # linked to a client. Mirrors what the CRM chessboard does on a
        # one-off click — without this the recurring series shows up as
        # "Занято" tiles with no client name and no edit handle.
        #
        # IMPORTANT: re-use an existing session on this date if one is
        # already there (e.g. the client has a session synced from their
        # historical Google Calendar recurring rule, or the specialist
        # created one manually earlier). Without the lookup we'd insert a
        # second session at the same wall-clock time and the chessboard
        # would render two rows — one with "+КАБ" and one with the actual
        # cabinet, which is exactly what Maxim/Nurlana hit.
        if crm_client_obj and crm_session_group_id:
            from app.models.therapy_session import TherapySession as _TS
            from app.services.crm_calendar import tbilisi_naive_to_utc_naive
            try:
                h, m = map(int, data.start_time.split(":"))
                # `d` is a Tbilisi calendar date; `start_time` is a
                # Tbilisi wall-clock. Build the Tbilisi-naive datetime
                # then normalise to UTC-naive — that's the column
                # convention.
                tb_dt = d.replace(hour=h, minute=m, second=0, microsecond=0)
                session_date = tbilisi_naive_to_utc_naive(tb_dt)
            except Exception:
                session_date = d

            # Same-day match. We compare on UTC-naive throughout. Note
            # that "this calendar day" means the Tbilisi calendar day
            # the user picked, so the day-window we look at in the
            # database must be the corresponding UTC-naive window —
            # 4h shifted.
            from datetime import timedelta as _td
            tb_day_start = d.replace(hour=0, minute=0, second=0, microsecond=0)
            day_start = tbilisi_naive_to_utc_naive(tb_day_start)
            day_end = day_start + _td(days=1)
            same_day_existing = session.exec(
                select(_TS)
                .where(_TS.client_id == str(crm_client_obj.id))
                .where(_TS.specialist_id == str(booking_owner.id))
                .where(_TS.date >= day_start)
                .where(_TS.date < day_end)
                .where(_TS.status.not_in(("CANCELLED_CLIENT", "CANCELLED_THERAPIST")))  # type: ignore
            ).all()

            # We're now consistently UTC-naive in DB. Match on the
            # UTC-equivalent of the Tbilisi wall-clock the user picked.
            target_h = (session_date.hour, session_date.minute)

            existing = None
            for cand in same_day_existing:
                if (cand.date.hour, cand.date.minute) == target_h:
                    existing = cand
                    break

            if existing:
                # Re-use the existing row instead of duplicating. Link it
                # to the new booking and stamp the recurring group so it
                # behaves like the rest of the series.
                existing.booking_id = str(booking.id)
                existing.is_booked = True
                if existing.recurring_group_id is None:
                    existing.recurring_group_id = crm_session_group_id
                existing.updated_at = datetime.now()
                # If price was unset (legacy NULL), seed it from client
                # so revenue reports stop counting these as "free".
                if existing.price is None:
                    existing.price = crm_client_obj.base_price
                if existing.currency is None:
                    existing.currency = crm_client_obj.currency
                if existing.account is None:
                    existing.account = crm_client_obj.default_account
                session.add(existing)
            else:
                ts = _TS(
                    client_id=str(crm_client_obj.id),
                    specialist_id=str(booking_owner.id),
                    date=session_date,
                    duration_minutes=data.duration,
                    status="PLANNED",
                    price=crm_client_obj.base_price,
                    currency=crm_client_obj.currency,
                    account=crm_client_obj.default_account,
                    is_booked=True,
                    booking_id=str(booking.id),
                    recurring_group_id=crm_session_group_id,
                )
                # Mirror the cabinet GCal event into the specialist's personal
                # CRM calendar too, so a session shows up under the client's
                # name (not just "Кабинет 8 — Микола") in their day view.
                if crm_calendar_id:
                    try:
                        from app.services.crm_calendar import create_calendar_event as _crm_create_ev
                        ts.google_event_id = _crm_create_ev(
                            calendar_id=crm_calendar_id,
                            client_name=crm_client_obj.name,
                            alias_code=crm_client_obj.alias_code,
                            session_date=session_date,
                            duration_minutes=data.duration,
                        )
                    except Exception as e:
                        logger.warning(f"CRM GCal push failed for recurring {d}: {e}")
                session.add(ts)

        total_cost += quote.final_price
        created_bookings.append(str(booking.id))

    session.commit()

    # §5#2: кабинет-GCal создаём в фоне ПОСЛЕ коммита — только для реально
    # сохранённых броней. Идемпотентно (_gcal_create_in_background пропускает
    # брони с уже проставленным gcal_event_id), не блокирует ответ, не плодит
    # призраков при обрыве.
    for _bid in created_bookings:
        background_tasks.add_task(_gcal_create_in_background, _bid, booking_owner.name)

    # ── Admin chat alert: new series ──
    try:
        from app.models.resource import Resource as ResModel
        from app.models.location import Location as LocModel
        res_obj = session.get(ResModel, data.resource_id)
        loc_obj = session.get(LocModel, data.location_id)
        res_name = res_obj.name if res_obj else data.resource_id
        loc_name = loc_obj.name if loc_obj else data.location_id
        first_label = dates[0].strftime("%d.%m.%Y") if dates else "—"
        last_label = dates[-1].strftime("%d.%m.%Y") if dates else "—"
        telegram_service.send_admin_event(
            event="booking_series_created",
            fields={
                "Арендатор": booking_owner.name or booking_owner.email,
                "С / По":    f"{first_label} → {last_label}",
                "Время":     f"{data.start_time} · {data.duration} мин",
                "Кабинет":   f"{res_name} · {loc_name}",
                "Встреч":    f"{len(created_bookings)} ({data.pattern})",
                "Сумма":     f"{round(total_cost, 2):g} ₾",
            },
        )
    except Exception as e:
        logger.warning(f"[Admin TG alert / series] Non-blocking failure: {e}")

    _maybe_alert_booking_overload(session, booking_owner, len(created_bookings))
    return {
        "ok": True,
        "recurring_group_id": recurring_group_id,
        "created": len(created_bookings),
        "total_cost": round(total_cost, 2),
        "booking_ids": created_bookings,
        "dates": [d.strftime("%Y-%m-%d") for d in dates],
    }


@router.get("/recurring-groups")
def get_recurring_groups(
    scope: str | None = Query(None, description="`mine` forces user scope even for admins (used by /crm/bookings)"),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Return a summary of recurring series for the current user (or all if admin).

    Pass `?scope=mine` to always restrict to the caller's own series — needed
    by /crm/bookings, which is a per-specialist personal view; without that
    flag an admin caller would see everyone's series and leak other clients'
    schedules.
    """
    from collections import defaultdict

    force_mine = (scope or "").strip().lower() == "mine"
    query = select(Booking).where(
        Booking.recurring_group_id.is_not(None),
        Booking.status == "confirmed",
    )
    if force_mine or current_user.role not in ADMIN_ROLES:
        # `mine` for a CRM page means "my practice" — series tied to clients
        # I work with as a therapist (TherapistClient.specialist_id == me),
        # NOT just bookings I personally clicked. Owners/admins often place
        # bookings on behalf of other specialists, which would otherwise leak
        # those series in here. Personal series without a client (cabinet
        # for myself, supervision, etc.) stay visible via the user_uuid leg.
        from app.models.therapist_client import TherapistClient

        # TherapistClient.specialist_id и Booking.crm_client_id — VARCHAR, а
        # current_user.id — UUID. Сравнение varchar=uuid роняет запрос в
        # Postgres (500 → фронт глотал ошибку → «Серий нет»). Кастуем в str.
        my_client_ids = [str(cid) for cid in session.exec(
            select(TherapistClient.id).where(TherapistClient.specialist_id == str(current_user.id))
        ).all()]

        prior_emails: set[str] = set()
        for entry in (current_user.comment_history or []):
            if isinstance(entry, dict) and entry.get("type") == "email_change":
                old = (entry.get("old_email") or "").strip().lower()
                if old:
                    prior_emails.add(old)
        email_lc = (current_user.email or "").strip().lower()
        candidate_emails = list(prior_emails | {email_lc}) if email_lc else list(prior_emails)

        # Personal-series leg: I'm the booker AND there's no CRM client.
        # Without the IS NULL guard an admin's bookings-on-behalf-of-others
        # would all match again, defeating the whole point.
        own_personal = (Booking.user_uuid == current_user.id) & (Booking.crm_client_id.is_(None))  # type: ignore[union-attr]
        if candidate_emails:
            own_personal = own_personal | (
                Booking.user_id.in_(candidate_emails) & Booking.crm_client_id.is_(None)  # type: ignore[union-attr]
            )

        if my_client_ids:
            cond = Booking.crm_client_id.in_(my_client_ids) | own_personal  # type: ignore[union-attr]
        else:
            cond = own_personal
        query = query.where(cond)
    bookings = session.exec(query.order_by(Booking.date)).all()

    now = datetime.now()
    groups: dict[str, dict] = {}
    group_dates: dict[str, list[datetime]] = defaultdict(list)

    for b in bookings:
        gid = b.recurring_group_id
        group_dates[gid].append(b.date)
        if gid not in groups:
            groups[gid] = {
                "recurring_group_id": gid,
                "resource_id": b.resource_id,
                "location_id": b.location_id,
                "start_time": b.start_time,
                "duration": b.duration,
                "crm_client_id": b.crm_client_id,
                "payment_method": b.payment_method,
                "future_count": 0,
                "total_count": 0,
                "next_date": None,
                "last_date": None,  # date of the LAST upcoming booking — used by client UI to show "до 30 июня".
                "pattern": "weekly",
            }
        groups[gid]["total_count"] += 1
        if b.date >= now:
            groups[gid]["future_count"] += 1
            if groups[gid]["next_date"] is None or b.date < groups[gid]["next_date"]:
                groups[gid]["next_date"] = b.date
            if groups[gid]["last_date"] is None or b.date > groups[gid]["last_date"]:
                groups[gid]["last_date"] = b.date

    # Detect pattern from intervals between consecutive dates
    for gid, g in groups.items():
        dates_sorted = sorted(group_dates[gid])
        if len(dates_sorted) >= 2:
            # МИНИМАЛЬНЫЙ интервал между соседними датами, а не первый попавшийся:
            # если между двумя датами пропуск (отменённая/пропущенная сессия),
            # интервал = кратное базовому (14→28), и «раз в 2 недели» ошибочно
            # определялось как «ежемес». Минимум даёт базовую периодичность.
            deltas = [(dates_sorted[i + 1] - dates_sorted[i]).days for i in range(len(dates_sorted) - 1)]
            deltas = [d for d in deltas if d > 0]
            delta = min(deltas) if deltas else 7
            if delta <= 8:
                g["pattern"] = "weekly"
            elif delta <= 20:
                g["pattern"] = "biweekly"
            else:
                g["pattern"] = "monthly"
        if g["next_date"]:
            g["next_date"] = g["next_date"].strftime("%Y-%m-%d")
        if g["last_date"]:
            g["last_date"] = g["last_date"].strftime("%Y-%m-%d")

    result = [g for g in groups.values() if g["future_count"] > 0]
    result.sort(key=lambda g: g["next_date"] or "")
    return result


@router.post("/recurring/{group_id}/extend")
def extend_recurring_series(
    group_id: str,
    payload: dict = Body(...),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Add N more occurrences after the last booking in a recurring series.

    Used by the "Продлить серию" button on the booking-detail popup and
    in Telegram reminder messages that fire as a series approaches its
    final occurrences. We re-detect the original pattern from the last
    two booking dates' interval (same logic as `recurring-groups`),
    then walk forward N steps from the latest date and create the new
    bookings under the SAME recurring_group_id.
    """
    # Расширение серии: по КОЛИЧЕСТВУ (add_occurrences) ЛИБО по ДИАПАЗОНУ
    # (until_date — добавлять сессии до указанной даты включительно).
    # pattern (опц.) — задать/сменить периодичность новых сессий
    # (weekly/biweekly/monthly); без него — авто-детект из хвоста серии.
    add_occurrences = int(payload.get("add_occurrences") or 0)
    until_date_str = (payload.get("until_date") or "").strip()
    pattern_override = (payload.get("pattern") or "").strip().lower()
    if not until_date_str and (add_occurrences < 1 or add_occurrences > 52):
        raise HTTPException(400, "Укажите число сессий (1–52) или дату «до»")

    existing = session.exec(
        select(Booking)
        .where(Booking.recurring_group_id == group_id)
        .order_by(Booking.date)
    ).all()
    if not existing:
        raise HTTPException(404, "Серия не найдена")

    # Ownership check — same rule as cancel
    first = existing[0]
    is_owner = (first.user_uuid and first.user_uuid == current_user.id) or (
        first.user_id == current_user.email
    )
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Not authorized")

    dates_sorted = sorted([b.date for b in existing])
    # Шаг: из явного pattern, иначе авто-детект из последнего интервала
    # (хвост — источник правды, если серию вручную переносили).
    if pattern_override == "weekly":
        step_days = 7
    elif pattern_override == "biweekly":
        step_days = 14
    elif pattern_override == "monthly":
        step_days = 30
    else:
        delta_days = (dates_sorted[-1] - dates_sorted[-2]).days if len(dates_sorted) >= 2 else 7
        step_days = 7 if delta_days <= 8 else (14 if delta_days <= 16 else 30)

    # Build new dates после последней существующей — по дате «до» или по числу.
    last_date = dates_sorted[-1]
    new_dates: list[datetime] = []
    cur = last_date
    if until_date_str:
        try:
            until_dt = datetime.fromisoformat(until_date_str)
        except ValueError:
            raise HTTPException(400, "until_date должен быть YYYY-MM-DD")
        until_day = until_dt.date()
        while len(new_dates) < 52:
            cur = cur + timedelta(days=step_days)
            if cur.date() > until_day:
                break
            new_dates.append(cur)
    else:
        for _ in range(add_occurrences):
            cur = cur + timedelta(days=step_days)
            new_dates.append(cur)

    if not new_dates:
        raise HTTPException(400, "Нечего добавить — проверьте дату «до» или периодичность")

    # Reuse the most recent confirmed booking as the template (price,
    # extras, format, payment method etc).
    template = next((b for b in reversed(existing) if b.status == "confirmed"), existing[-1])
    booking_owner = _resolve_booking_owner(session, template)

    # Conflict check first — atomic create.
    conflicts: list[dict] = []
    for d in new_dates:
        available, reason = check_availability(
            session=session,
            resource_id=template.resource_id,
            date=d,
            start_time=template.start_time,
            duration=template.duration,
            requester_user_uuid=template.user_uuid,
        )
        if not available:
            conflicts.append({
                "date": d.strftime("%Y-%m-%d"),
                "day": d.strftime("%A"),
                "reason": reason,
            })
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Конфликт в {len(conflicts)} из {len(new_dates)} дат",
                "conflicts": conflicts,
            },
        )

    # If the series is CRM-linked, resolve the client once + a session
    # recurring-group id, so each extension booking also gets its
    # TherapySession linked. Without this the extended weeks render as
    # "без кабинета" in the CRM session list even though the booking
    # exists (2026-05-22 — Анастасия Черепанова bug).
    ext_crm_client = None
    ext_session_group_id = None
    if template.crm_client_id:
        from app.models.therapist_client import TherapistClient as _TC
        ext_crm_client = session.get(_TC, template.crm_client_id)
        if ext_crm_client and booking_owner and ext_crm_client.specialist_id == str(booking_owner.id):
            # Reuse the session-group of an existing linked session if there
            # is one, else mint a fresh group id.
            from app.models.therapy_session import TherapySession as _TS0
            _linked = session.exec(
                select(_TS0)
                .where(_TS0.client_id == str(ext_crm_client.id))
                .where(_TS0.recurring_group_id.is_not(None))  # type: ignore
                .limit(1)
            ).first()
            ext_session_group_id = (_linked.recurring_group_id if _linked
                                    else str(gen_uuid4()))
        else:
            ext_crm_client = None  # other specialist's client — don't touch

    # Create
    created = 0
    total_cost = 0.0
    for d in new_dates:
        new_booking = Booking(
            resource_id=template.resource_id,
            location_id=template.location_id,
            date=d,
            start_time=template.start_time,
            duration=template.duration,
            status="confirmed",
            final_price=template.final_price,
            base_price=template.base_price,
            applied_rule=template.applied_rule,
            discount_amount=template.discount_amount,
            discount_percent=template.discount_percent,
            hours_deducted=template.hours_deducted if template.payment_method == "subscription" else None,
            payment_method=template.payment_method,
            format=template.format,
            extras=template.extras or [],
            user_id=template.user_id,
            user_uuid=template.user_uuid,
            crm_client_id=template.crm_client_id,
            recurring_group_id=group_id,
        )
        session.add(new_booking)
        session.flush()
        try:
            ev = gcal_service.create_event(new_booking, user_name=booking_owner.name if booking_owner else "")
            if ev:
                new_booking.gcal_event_id = ev
                session.add(new_booking)
        except Exception as e:
            logger.warning(f"GCal sync failed for extend {d}: {e}")

        # CRM session find-or-create + link (mirrors the recurring-create path)
        if ext_crm_client and ext_session_group_id:
            try:
                from app.models.therapy_session import TherapySession as _TS
                from app.services.crm_calendar import tbilisi_naive_to_utc_naive
                from datetime import timedelta as _td_ext
                h, m = map(int, template.start_time.split(":"))
                tb_dt = d.replace(hour=h, minute=m, second=0, microsecond=0)
                session_date = tbilisi_naive_to_utc_naive(tb_dt)
                day_start = tbilisi_naive_to_utc_naive(
                    d.replace(hour=0, minute=0, second=0, microsecond=0))
                day_end = day_start + _td_ext(days=1)
                same_day = session.exec(
                    select(_TS)
                    .where(_TS.client_id == str(ext_crm_client.id))
                    .where(_TS.specialist_id == str(booking_owner.id))
                    .where(_TS.date >= day_start)
                    .where(_TS.date < day_end)
                    .where(_TS.status.not_in(("CANCELLED_CLIENT", "CANCELLED_THERAPIST")))  # type: ignore
                ).all()
                target_h = (session_date.hour, session_date.minute)
                existing_ts = next(
                    (c for c in same_day if (c.date.hour, c.date.minute) == target_h),
                    None,
                )
                if existing_ts:
                    existing_ts.booking_id = str(new_booking.id)
                    existing_ts.is_booked = True
                    if existing_ts.recurring_group_id is None:
                        existing_ts.recurring_group_id = ext_session_group_id
                    existing_ts.updated_at = datetime.now()
                    session.add(existing_ts)
                else:
                    session.add(_TS(
                        client_id=str(ext_crm_client.id),
                        specialist_id=str(booking_owner.id),
                        date=session_date,
                        duration_minutes=template.duration,
                        status="PLANNED",
                        price=ext_crm_client.base_price,
                        currency=ext_crm_client.currency,
                        account=ext_crm_client.default_account,
                        is_booked=True,
                        booking_id=str(new_booking.id),
                        recurring_group_id=ext_session_group_id,
                    ))
            except Exception as e:
                logger.warning(f"[extend] CRM session link failed for {d}: {e}")

        created += 1
        total_cost += new_booking.final_price

    session.commit()

    return {
        "ok": True,
        "created": created,
        "total_cost": round(total_cost, 2),
        "recurring_group_id": group_id,
    }


@router.post("/recurring/{group_id}/dismiss-end-reminder")
def dismiss_series_end_reminder(
    group_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Acknowledge the "series ending soon" reminder so we stop pinging.

    The series-end Telegram reminder fires at thresholds 3/2/1 future
    bookings. The dedup marker lives in user.crm_data['series_reminders']
    as {group_id: last_notified_count}. We mark the user's intent to let
    the series end naturally by setting the marker to 1 — the cron's
    guard `future_count >= last_threshold` then suppresses all further
    pings (any future_count ≥ 1 stops the ping).
    """
    existing = session.exec(
        select(Booking)
        .where(Booking.recurring_group_id == group_id)
        .limit(1)
    ).first()
    if not existing:
        raise HTTPException(404, "Серия не найдена")
    is_owner = (existing.user_uuid and existing.user_uuid == current_user.id) or (
        existing.user_id == current_user.email
    )
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Not authorized")

    owner = _resolve_booking_owner(session, existing)
    if not owner:
        raise HTTPException(404, "Владелец серии не найден")

    crm_data = dict(owner.crm_data or {})
    marks = dict(crm_data.get("series_reminders") or {})
    marks[group_id] = 1
    crm_data["series_reminders"] = marks
    owner.crm_data = crm_data
    session.add(owner)
    session.commit()
    return {"ok": True, "recurring_group_id": group_id}


@router.delete("/recurring/{group_id}")
def cancel_recurring_bookings(
    group_id: str,
    from_booking_id: Optional[str] = Query(
        None,
        description=(
            "Anchor booking ID. When set, cancels this booking and every "
            "still-confirmed sibling in the group on or after its date — "
            "matches Google Calendar's 'this and following' behaviour. "
            "Earlier siblings (incl. ones in the past) are left alone. "
            "When omitted, falls back to the legacy 'every future booking' "
            "scope (date >= now)."
        ),
    ),
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Cancel a recurring group of bookings.

    Two modes:
    - ``from_booking_id`` provided → "this and following" (preferred): cancel
      the anchor booking + every confirmed sibling on the same calendar
      day or later. Egoriy hit the previous behaviour: he clicked
      "delete series" while looking at a mid-series occurrence and
      every earlier (still-future-of-today) sibling got cancelled too,
      which from his POV looked like "the past got deleted".
    - omitted → "every future booking" (legacy fallback for old clients).
    """
    if from_booking_id:
        anchor = session.get(Booking, from_booking_id)
        if not anchor or anchor.recurring_group_id != group_id:
            raise HTTPException(404, "Anchor booking not found in this group")
        # `Booking.date` is a midnight timestamp on the booked calendar
        # day. Cancelling >= anchor.date catches the anchor itself plus
        # every later occurrence, while preserving everything earlier in
        # the series (whether already past or still upcoming).
        cutoff = anchor.date
    else:
        cutoff = datetime.now()

    bookings = session.exec(
        select(Booking).where(
            Booking.recurring_group_id == group_id,
            Booking.status == "confirmed",
            Booking.date >= cutoff,
        )
    ).all()

    if not bookings:
        raise HTTPException(404, "No future bookings found in this group")

    # Verify ownership or admin
    first = bookings[0]
    is_owner = (first.user_uuid and first.user_uuid == current_user.id) or (
        first.user_id == current_user.email
    )
    is_admin = current_user.role in ADMIN_ROLES
    if not is_owner and not is_admin:
        raise HTTPException(403, "Not authorized")

    # ── 24h policy gate (mirror single-cancel) ──
    # Single-cancel blocks non-admin clients from cancelling a still-upcoming
    # booking less than 24h before start. The series path used to refund every
    # occurrence at 100% with no time check, letting a client bypass the policy
    # in bulk. Pre-flight the whole batch: if ANY occurrence violates the gate
    # for a non-admin, reject the entire series-cancel (admins override, exactly
    # like single-cancel).
    if not is_admin:
        for b in bookings:
            hours_until = _booking_hours_until_start(b)
            if hours_until < 24 and not _is_past(b):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Отмена серии невозможна: бронь {b.date.strftime('%d.%m')} "
                        f"{b.start_time} начинается менее чем через 24 часа "
                        f"(осталось {hours_until:.1f} ч). "
                        f"Отмените её отдельно через переаренду или администратора."
                    ),
                )

    from app.models.therapy_session import TherapySession as _TS
    from app.services.consecutive_pricing import recompute_user_chains_for_day

    cancelled = 0
    # Collect (owner, resource, day) tuples to recompute consecutive chains
    # once per group after the loop — same effect as single-cancel's per-row
    # recompute, but de-duplicated so a series in one room/day runs it once.
    recompute_targets: dict = {}
    for b in bookings:
        # Refund via shared helper (handles balance + subscription)
        booking_owner = _resolve_booking_owner(session, b)
        if booking_owner:
            _refund_booking_to_owner(session, b, booking_owner)

        # GCal delete
        if b.gcal_event_id:
            try:
                gcal_service.delete_event(b.gcal_event_id, b.resource_id)
            except Exception as e:
                logger.warning(
                    f"[GCal Series cancel] delete_event failed for "
                    f"booking={b.id} event={b.gcal_event_id}: {e}"
                )

        b.status = "cancelled"
        b.cancellation_reason = "Series cancelled"
        b.cancelled_by = current_user.email
        session.add(b)

        # Detach any CRM session relying on this cabinet booking — otherwise
        # the session keeps a stale "КАБ" badge + is_booked flag pointing at a
        # cancelled booking, and its GCal event is never cleaned up. Mirrors
        # the single-cancel detach.
        linked_sessions = session.exec(
            select(_TS).where(_TS.booking_id == str(b.id))
        ).all()
        for ts in linked_sessions:
            ts.booking_id = None
            ts.is_booked = False
            ts.updated_at = datetime.now()
            session.add(ts)

        # Stage a consecutive-chain recompute for balance bookings (subscription
        # bookings don't earn the consecutive-hours discount).
        if booking_owner and b.payment_method == "balance":
            recompute_targets[(str(booking_owner.id), b.resource_id, b.date)] = (
                booking_owner,
                b.resource_id,
                b.date,
            )

        cancelled += 1

    # Recompute consecutive-hours chains once per (owner, resource, day) — the
    # cancelled occurrences may have broken chains, dropping tier discounts.
    for owner_obj, resource_id, day in recompute_targets.values():
        try:
            recompute_user_chains_for_day(
                session,
                owner_obj,
                resource_id,
                day,
                actor_id=str(current_user.id),
                actor_role=current_user.role,
                reason="cancel_series",
            )
        except Exception:
            logger.exception("[consecutive] recompute on series-cancel failed")

    session.commit()

    return {"ok": True, "cancelled": cancelled, "group_id": group_id}


# ─── Cancel booking ──────────────────────────────────────────────────────────

@router.delete("/{booking_id}", response_model=BookingRead)
def cancel_booking(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
    # Excel #66 — admin-only cancellation policy override.
    # refund_percent: 1.0 (default, full refund), 0.5 (50% penalty), 0.0 (full penalty).
    # reason: free-text audit trail for anything other than default.
    # Non-admins ignore these params; they always get the time-based policy.
    refund_percent: float = 1.0,
    reason: str | None = None,
) -> Any:
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    is_admin = current_user.role in ADMIN_ROLES
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status == "cancelled":
        return booking

    # Sanitize admin-provided refund_percent; clients never get this power.
    if is_admin:
        if refund_percent < 0 or refund_percent > 1:
            raise HTTPException(status_code=400, detail="refund_percent must be between 0 and 1")
        applied_refund = refund_percent
    else:
        applied_refund = 1.0  # client cancellation = always 100% refund when allowed

    # ── Past booking protection ──
    if _is_past(booking):
        if current_user.role not in ("senior_admin", "owner"):
            raise HTTPException(
                status_code=403,
                detail="Past bookings cannot be modified. Only senior admin or owner can delete them.",
            )

    # ── Time-based cancellation policy (>24h check) ──
    # Use Tbilisi-aware start vs UTC-aware now — booking.start_time is
    # Tbilisi wall-clock, server is UTC. A naive comparison would let the
    # client cancel up to 20h before start while believing 24h remain.
    hours_until_start = _booking_hours_until_start(booking)
    is_late_cancellation = hours_until_start < 24

    if is_late_cancellation and not _is_past(booking) and not is_admin:
        # Russian + actionable. Frontend matches on "24" + "переаренд" /
        # "админист" to surface a "Написать админу" sonner button (link
        # to t.me/UnboxCenter).
        raise HTTPException(
            status_code=400,
            detail=(
                f"Отмена брони невозможна менее чем за 24 часа до начала "
                f"(до сессии осталось {hours_until_start:.1f} ч). "
                f"Можно поставить бронь на переаренду или связаться с администратором."
            ),
        )

    # ── Google Calendar Sync (Delete) ──
    if booking.gcal_event_id:
        try:
            gcal_service.delete_event(booking.gcal_event_id, booking.resource_id)
        except Exception as e:
            logger.warning(
                f"[GCal Cancel] delete_event failed for "
                f"booking={booking.id} event={booking.gcal_event_id}: {e}"
            )
        booking.gcal_event_id = None

    # ── Refund to booking OWNER (not current_user!) ──
    booking_owner = _resolve_booking_owner(session, booking)
    refund_meta = {}
    if not booking_owner:
        logger.warning(f"Cannot refund: booking owner not found for booking {booking.id}")
        refund_meta = {"warning": "Booking owner not found, no refund issued"}
    elif applied_refund > 0:
        refund_meta = _refund_booking_to_owner(session, booking, booking_owner, refund_percent=applied_refund)
    else:
        refund_meta = {"refund_percent": 0.0, "note": "Admin cancelled with no refund (full penalty)"}

    # Build a cancellation reason that captures the admin's policy choice so it
    # shows up in the audit trail and in the user-facing booking history.
    if is_admin and (applied_refund != 1.0 or reason):
        refund_label = f"{int(applied_refund * 100)}% возврат"
        base_reason = reason.strip() if reason else "Отменено администратором"
        booking.cancellation_reason = f"{base_reason} ({refund_label})"
    else:
        booking.cancellation_reason = reason.strip() if reason else "User cancelled"

    booking.status = "cancelled"
    booking.cancelled_by = current_user.email

    # ── Detach any CRM session that was relying on this cabinet booking ──
    # Otherwise the session list keeps the "КАБ" badge and an `is_booked`
    # flag pointing at a cancelled booking — invisible footgun the user
    # spotted ("сейчас бронь который я открыл я удалил, но у неё по-прежнему
    # показывает что есть кабинет привязаны, а это неверно").
    from app.models.therapy_session import TherapySession as _TS
    linked_sessions = session.exec(
        select(_TS).where(_TS.booking_id == str(booking.id))
    ).all()
    for ts in linked_sessions:
        ts.booking_id = None
        ts.is_booked = False
        ts.updated_at = datetime.now()
        session.add(ts)

    session.add(booking)
    session.commit()
    session.refresh(booking)

    # Consecutive-hours: cancelled booking may have broken a chain.
    # Recompute every chain the OWNER has on this (resource, day) — sub-
    # chains around the gap will lose their tier discount and the owner's
    # balance is debited the difference (with audit row).
    if booking_owner and booking.payment_method == "balance":
        try:
            from app.services.consecutive_pricing import recompute_user_chains_for_day
            recompute_user_chains_for_day(
                session,
                booking_owner,
                booking.resource_id,
                booking.date,
                actor_id=str(current_user.id),
                actor_role=current_user.role,
                reason="cancel_booking",
            )
        except Exception:
            logger.exception("[consecutive] recompute on cancel failed")

    # ── Waitlist: notify anyone waiting on this freed slot ──
    try:
        from app.services.waitlist_notify import notify_waitlist_for_freed_slot
        notify_waitlist_for_freed_slot(session, booking)
    except Exception:
        logger.exception("Failed to notify waitlist on cancellation")

    # ── Audit logging ──
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(booking.id),
        target_type="booking",
        event_type="booking_cancelled",
        description=f"Booking cancelled by {current_user.name} ({current_user.role}). Refund: {int(applied_refund * 100)}%. Time to start: {hours_until_start:.1f}h",
        metadata={
            "is_late_cancellation": is_late_cancellation,
            "hours_until_start": hours_until_start,
            "refund_percent": applied_refund,
            "admin_reason": reason,
            **refund_meta,
        },
    )

    # ── Telegram notification to the booking owner (Excel #58) ──
    # Non-blocking — failure here must never break the cancel flow.
    try:
        if booking_owner and booking_owner.telegram_id:
            resource_name = booking.resource_id
            location_name: Optional[str] = None
            try:
                from app.models.resource import Resource as ResModel
                from app.models.location import Location as LocModel
                res_obj = session.get(ResModel, booking.resource_id)
                if res_obj:
                    resource_name = res_obj.name or booking.resource_id
                    if res_obj.location_id:
                        loc_obj = session.get(LocModel, res_obj.location_id)
                        if loc_obj:
                            location_name = loc_obj.name
            except Exception:
                pass
            telegram_service.send_booking_cancelled(
                chat_id=str(booking_owner.telegram_id),
                resource_name=resource_name,
                location_name=location_name,
                date=booking.date,
                start_time=booking.start_time,
                refund_percent=applied_refund,
                reason=reason,
                booking_id=str(booking.id),
            )
    except Exception as e:
        logger.warning(f"[Booking cancelled] Telegram notification failed: {e}")

    # ── Admin chat alert ──
    try:
        from app.models.resource import Resource as ResModel
        from app.models.location import Location as LocModel
        res_obj = session.get(ResModel, booking.resource_id)
        loc_obj = session.get(LocModel, booking.location_id)
        res_name = res_obj.name if res_obj else booking.resource_id
        loc_name = loc_obj.name if loc_obj else booking.location_id
        date_label = booking.date.strftime("%d.%m.%Y")
        refund_pct = int(round(applied_refund * 100))
        # Surface WHO cancelled — admin team needs to tell apart "client
        # cancelled" from "admin cancelled" at a glance. The 24h policy is
        # enforced server-side (clients can't self-cancel < 24h), but the
        # alert was previously silent on the actor, which made admins
        # double-check every late-cancellation in the DB.
        is_self_cancel = (
            booking_owner is not None
            and current_user.id == booking_owner.id
        )
        if is_self_cancel:
            who = f"клиент сам ({current_user.name or current_user.email})"
        elif current_user.role in ADMIN_ROLES:
            who = f"админ ({current_user.name or current_user.email})"
        else:
            who = current_user.name or current_user.email
        telegram_service.send_admin_event(
            event="booking_cancelled",
            fields={
                "Арендатор":   (booking_owner.name or booking_owner.email) if booking_owner else (booking.user_id or "—"),
                "Кто отменил": who,
                "Когда":       f"{date_label} · {booking.start_time}",
                "Кабинет":     f"{res_name} · {loc_name}",
                "Возврат":     f"{refund_pct}%",
                "Причина":     (reason.strip() if reason else None),
            },
        )
    except Exception as e:
        logger.warning(f"[Admin TG alert / cancel] Non-blocking failure: {e}")

    return booking


# ─── Reschedule booking (drag-to-move) ────────────────────────────────────────

class RescheduleRequest(PydanticBaseModel):
    new_date: str  # "YYYY-MM-DD"
    new_start_time: str  # "HH:MM"
    new_resource_id: Optional[str] = None  # If moving to a different room
    # 2026-06-02 owner: при reschedule с /m/find можно выбрать другую
    # длительность (например было 1ч → стало 1.5ч). Если не передано —
    # сохраняется текущая duration брони. В минутах, кратно 30.
    new_duration: Optional[int] = None


@router.patch("/{booking_id}/reschedule", response_model=BookingRead)
def reschedule_booking(
    booking_id: str,
    data: RescheduleRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Reschedule a booking to a new date/time/resource."""
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status != "confirmed":
        raise HTTPException(
            status_code=400, detail="Only confirmed bookings can be rescheduled"
        )

    if _is_past(booking):
        raise HTTPException(
            status_code=400, detail="Cannot reschedule a past booking"
        )

    # 24h policy — Tbilisi-aware (see _booking_hours_until_start docstring).
    hours_until = _booking_hours_until_start(booking)
    if hours_until < 24 and not current_user.role in ADMIN_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reschedule less than 24h before start ({hours_until:.1f}h remaining)",
        )

    try:
        new_date = datetime.strptime(data.new_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Invalid date format. Use YYYY-MM-DD"
        )

    new_resource = data.new_resource_id or booking.resource_id
    # Use new_duration when client passes it (mobile reschedule UI), else
    # keep the original duration. Sanity-check: must be >=30 and divisible
    # by 30 to match slot granularity.
    if data.new_duration is not None:
        if data.new_duration < 30 or data.new_duration % 30 != 0:
            raise HTTPException(
                status_code=400,
                detail="new_duration must be a positive multiple of 30",
            )
        new_duration = int(data.new_duration)
    else:
        new_duration = booking.duration

    available, conflict = check_availability(
        session=session,
        resource_id=new_resource,
        date=new_date,
        start_time=data.new_start_time,
        duration=new_duration,
        exclude_booking_id=str(booking.id),
        requester_user_uuid=booking.user_uuid,
        lock_rows=True,  # serialize concurrent reschedules into the same slot
    )
    if not available:
        raise HTTPException(
            status_code=400, detail=f"New slot is not available: {conflict}"
        )

    old_date = booking.date
    old_time = booking.start_time
    old_resource = booking.resource_id

    # ── Price recalculation when room OR duration changes ──
    room_changed = new_resource != booking.resource_id
    duration_changed = new_duration != booking.duration
    old_price = booking.final_price or 0.0
    new_price = old_price
    price_diff = 0.0
    booking_owner = None

    if room_changed or duration_changed:
        # Block room/duration change for subscription bookings (complex hour recalc)
        if booking.payment_method == "subscription":
            what = "комнату" if room_changed else "длительность"
            raise HTTPException(
                status_code=400,
                detail=f"Нельзя менять {what} для бронирований по абонементу. "
                "Отмените текущее и создайте новое.",
            )

        booking_owner = _resolve_booking_owner(session, booking)
        if not booking_owner:
            raise HTTPException(
                status_code=400,
                detail="Не удалось определить владельца бронирования для перерасчёта",
            )

        from app.services.pricing import PricingService

        try:
            h, m = map(int, data.new_start_time.split(":"))
            new_start_dt = new_date.replace(hour=h, minute=m, second=0, microsecond=0)
        except Exception:
            new_start_dt = new_date

        pricing_service = PricingService(session)
        new_quote = pricing_service.calculate_price(
            user=booking_owner,
            resource_id=new_resource,
            start_time=new_start_dt,
            duration_minutes=new_duration,
            format_type=booking.format,
        )

        new_price = new_quote.final_price
        price_diff = new_price - old_price

        # `pending` bookings haven't been charged yet — the T-24h cron will
        # capture the (new) final_price in full. Touching the balance here
        # would double-charge on a price increase (or hand a phantom refund
        # on a decrease). For pending we just update final_price below and let
        # the cron settle. All other statuses (paid, NULL=legacy-paid) keep the
        # original immediate diff-settlement behavior.
        if booking.payment_status != "pending":
            if price_diff > 0:
                # Price increased — check funds and charge
                available_funds = booking_owner.balance + booking_owner.credit_limit
                if available_funds < price_diff:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Недостаточно средств для перерасчёта. "
                        f"Доплата: {price_diff}₾, доступно: {available_funds}₾.",
                    )
                booking_owner.balance = round((booking_owner.balance or 0) - price_diff, 2)
                session.add(booking_owner)
            elif price_diff < 0:
                # Price decreased — refund the difference
                booking_owner.balance = round((booking_owner.balance or 0) + abs(price_diff), 2)
                session.add(booking_owner)

        # Update booking price fields
        booking.final_price = new_quote.final_price
        booking.base_price = new_quote.base_price
        booking.applied_rule = new_quote.applied_rule
        booking.discount_amount = new_quote.discount_amount
        booking.discount_percent = new_quote.discount_percent

    # Drop extras the NEW room can't host — e.g. couch when moving from a
    # cabinet to a capsule, sandbox when moving to a room without one.
    # Refund the dropped extras price by re-adjusting balance, so the
    # booking's stored final_price stays consistent. Owner 2026-05-29.
    dropped_extras: list[str] = []
    if booking.extras and room_changed:
        try:
            from app.models.resource import Resource as _ResModel
            new_res_obj = session.get(_ResModel, new_resource)
            kept: list[str] = []
            for eid in (booking.extras or []):
                ok = True
                if new_res_obj:
                    if new_res_obj.type == "capsule" and eid != "coffee_meama":
                        ok = False
                    elif eid in ("sandbox", "projector", "couch") and eid not in (new_res_obj.services or []):
                        ok = False
                (kept if ok else dropped_extras).append(eid)
            if dropped_extras:
                refund = PricingService.calculate_extras_price(dropped_extras)
                booking.extras = kept
                # Adjust price: subtract dropped-extras cost from final_price
                booking.final_price = round(float(booking.final_price or 0) - refund, 2)
                # Refund the same amount to user's balance if booking was paid
                if booking.payment_status == "paid" and refund > 0 and booking_owner:
                    booking_owner.balance = round((booking_owner.balance or 0) + refund, 2)
                    session.add(booking_owner)
        except Exception as e:
            logger.warning(f"[Reschedule] extras-filter failed: {e}")

    booking.date = new_date
    booking.start_time = data.new_start_time
    booking.resource_id = new_resource
    booking.duration = new_duration
    booking.updated_at = datetime.now()

    # GCal recreate runs in a BackgroundTask. Same reasoning as POST
    # /bookings — a slow Google response used to block the whole request
    # past axios's 30 s timeout, so the user saw "не удалось перенести"
    # while the booking had already moved server-side. We snapshot the
    # old event ID + old resource here so the bg task can drop the old
    # event before creating the new one (the row's gcal_event_id is
    # cleared in advance, the bg task will repopulate on success).
    old_gcal_event = booking.gcal_event_id
    if booking.gcal_event_id:
        booking.gcal_event_id = None

    session.add(booking)
    session.commit()
    session.refresh(booking)

    # Auto-sync linked CRM session — keep its time in lock-step with the
    # booking it's attached to. See `_sync_linked_session_to_booking`.
    _sync_linked_session_to_booking(session, booking)
    session.commit()

    if old_gcal_event:
        background_tasks.add_task(
            _gcal_recreate_in_background,
            str(booking.id),
            current_user.name or "",
            old_gcal_event,
            old_resource,
        )

    # ── Waitlist: notify anyone waiting on the OLD (now freed) slot ──
    # Skip if the slot didn't really move (same day + time + resource edge case).
    slot_moved = (old_resource != new_resource) or (old_date != new_date) or (old_time != data.new_start_time)
    if slot_moved:
        try:
            from app.services.waitlist_notify import notify_waitlist_for_freed_slot
            # Build a proxy booking representing the old (freed) slot
            from copy import copy as _copy
            freed = _copy(booking)
            freed.resource_id = old_resource
            freed.date = old_date
            freed.start_time = old_time
            notify_waitlist_for_freed_slot(session, freed)
        except Exception:
            logger.exception("Failed to notify waitlist on reschedule")

    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(booking.id),
        target_type="booking",
        event_type="booking_rescheduled",
        description=f"Booking rescheduled by {current_user.name}: {old_time} → {data.new_start_time}",
        metadata={
            "old_date": old_date.isoformat(),
            "old_time": old_time,
            "old_resource": old_resource,
            "new_date": data.new_date,
            "new_time": data.new_start_time,
            "new_resource": new_resource,
            "room_changed": room_changed,
            "old_price": old_price if room_changed else None,
            "new_price": new_price if room_changed else None,
            "price_diff": price_diff if room_changed else None,
        },
    )

    # Reset reminder_sent_at so the T-2h reminder fires for the new slot
    # if it's still ≥2h away.
    booking.reminder_sent_at = None
    session.add(booking)
    session.commit()

    # ── Telegram notification on reschedule (owner + admin 2026-05-29).
    # Previously this code lived but was unreachable in the series
    # endpoint; the single-reschedule path never had it at all.
    try:
        notify_owner = _resolve_booking_owner(session, booking)
        if notify_owner and notify_owner.telegram_id:
            resource_name = booking.resource_id
            try:
                res_obj = session.get(Resource, booking.resource_id)
                if res_obj:
                    resource_name = res_obj.name or booking.resource_id
            except Exception:
                pass
            telegram_service.send_booking_rescheduled(
                chat_id=str(notify_owner.telegram_id),
                resource_name=resource_name,
                old_date=old_date,
                old_start_time=old_time,
                new_date=booking.date,
                new_start_time=booking.start_time,
                duration_minutes=booking.duration,
                booking_id=str(booking.id),
            )
    except Exception as e:
        logger.warning(f"[Booking reschedule] TG notification failed: {e}")

    if dropped_extras:
        logger.info(
            f"[Reschedule] Dropped {len(dropped_extras)} extras incompatible "
            f"with new room {new_resource}: {dropped_extras}. Refunded user balance."
        )
    return booking


# ─── Partial cancellation ("trim") — cut a sub-range out of a booking ─────────

class TrimRequest(PydanticBaseModel):
    remove_from: str   # "HH:MM" inclusive start of the part to REMOVE
    remove_to: str     # "HH:MM" exclusive end of the part to REMOVE


@router.post("/{booking_id}/trim")
def trim_booking(
    booking_id: str,
    data: TrimRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Remove a middle (or edge) sub-range from a booking, leaving 1–2
    remnants (each ≥60 min), repricing each and refunding the removed
    portion.

    A booking is one row (start_time "HH:MM" + duration minutes). Trimming
    13:00–15:00 out of a 12:00–18:00 booking yields a left remnant 12–13
    (kept on the original row) and a right remnant 15–18 (new row).
    Trimming an edge (e.g. 12:00–13:00 off the front) leaves a single
    remnant, which the original row becomes — no new row is created.

    Guards mirror cancel_booking exactly (ownership, past-protection, 24h
    late gate). Money is refunded to the booking OWNER, not current_user.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    # Lock the row (SELECT FOR UPDATE) so two concurrent trims/cancels on the
    # same booking serialize — otherwise both read the original duration and
    # produce inconsistent remnants / a double refund.
    booking = session.exec(
        select(Booking).where(Booking.id == b_uuid).with_for_update()
    ).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    is_admin = current_user.role in ADMIN_ROLES
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status == "cancelled":
        raise HTTPException(status_code=400, detail="Booking is already cancelled")

    if booking.status == "pending_approval":
        raise HTTPException(
            status_code=400,
            detail="Нельзя редактировать бронь, ожидающую подтверждения",
        )

    # ── Past booking protection (same message as cancel) ──
    if _is_past(booking) and current_user.role not in ("senior_admin", "owner"):
        raise HTTPException(
            status_code=403,
            detail="Past bookings cannot be modified. Only senior admin or owner can delete them.",
        )

    # ── 24h late gate (same message as cancel_booking) ──
    hours_until = _booking_hours_until_start(booking)
    if hours_until < 24 and not _is_past(booking) and not is_admin:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Отмена брони невозможна менее чем за 24 часа до начала "
                f"(до сессии осталось {hours_until:.1f} ч). "
                f"Можно поставить бронь на переаренду или связаться с администратором."
            ),
        )

    # ── Parse minutes ──
    def _tm(t: str) -> int:
        h, m = str(t).split(":")[:2]
        return int(h) * 60 + int(m)

    def _mt(mn: int) -> str:
        return f"{mn // 60:02d}:{mn % 60:02d}"

    try:
        bStart = _tm(booking.start_time)
        cFrom = _tm(data.remove_from)
        cTo = _tm(data.remove_to)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Некорректный диапазон")
    bEnd = bStart + booking.duration

    if cFrom >= cTo:
        raise HTTPException(status_code=400, detail="Некорректный диапазон")
    if cFrom < bStart or cTo > bEnd:
        raise HTTPException(status_code=400, detail="Диапазон вне брони")

    left = cFrom - bStart
    right = bEnd - cTo

    # ── ≥1h rule on each remaining remnant ──
    if (0 < left < 60) or (0 < right < 60):
        raise HTTPException(
            status_code=400,
            detail="Каждая оставшаяся часть брони должна быть не короче 1 часа",
        )
    if left == 0 and right == 0:
        raise HTTPException(
            status_code=400,
            detail="Вырезается вся бронь — используйте полную отмену",
        )

    owner = _resolve_booking_owner(session, booking)

    # ── Re-price each remnant ──
    from app.services.pricing import PricingService
    pricing_service = PricingService(session)

    def _quote_for(start_min: int, dur: int):
        start_dt = booking.date.replace(
            hour=start_min // 60, minute=start_min % 60, second=0, microsecond=0
        )
        return pricing_service.calculate_price(
            user=owner,
            resource_id=booking.resource_id,
            start_time=start_dt,
            duration_minutes=dur,
            format_type=booking.format,
            exclude_booking_id=str(booking.id),
        )

    leftQuote = _quote_for(bStart, left) if left > 0 else None
    rightQuote = _quote_for(cTo, right) if right > 0 else None

    # ── Money ──
    pending = booking.payment_status == "pending"
    new_total_price = (
        (leftQuote.final_price if left > 0 else 0)
        + (rightQuote.final_price if right > 0 else 0)
    )

    removed_value = 0.0
    removed_hours = 0.0

    if booking.payment_method == "balance":
        # Baseline = what was ACTUALLY charged. For a paid booking that's
        # charge_amount (final_price may have drifted via consecutive-recompute);
        # for pending nothing was charged yet.
        charged_baseline = (
            booking.charge_amount
            if (not pending and booking.charge_amount is not None)
            else (booking.final_price or 0)
        )
        removed_value = round(charged_baseline - new_total_price, 2)
        # pending bookings haven't been charged — the T-24h cron will capture
        # the (new, smaller) final_price. Touching the balance here would hand
        # a phantom refund. Only settle when already charged.
        if not pending and removed_value > 0 and owner:
            owner.balance = round((owner.balance or 0) + removed_value, 2)
            session.add(owner)
    elif booking.payment_method == "subscription":
        orig_hours = (
            booking.hours_deducted
            if booking.hours_deducted is not None
            else (booking.duration / 60)
        )
        new_hours = (
            ((leftQuote.hours_deducted or 0) if left > 0 else 0)
            + ((rightQuote.hours_deducted or 0) if right > 0 else 0)
        )
        removed_hours = round(orig_hours - new_hours, 4)
        # Refund the removed hours to the pool using the SAME dual-key
        # (snake+camel) pattern as _refund_booking_to_owner: bump
        # remaining_hours, drop used_hours (floored at 0), delete camel keys.
        if not pending and removed_hours > 0 and owner and owner.subscription:
            new_sub = owner.subscription.copy()
            rem = new_sub.get("remaining_hours", new_sub.get("remainingHours", 0))
            new_sub["remaining_hours"] = float(rem) + removed_hours
            if "remainingHours" in new_sub:
                del new_sub["remainingHours"]
            used = new_sub.get("used_hours", new_sub.get("usedHours", 0))
            new_sub["used_hours"] = max(0.0, float(used) - removed_hours)
            if "usedHours" in new_sub:
                del new_sub["usedHours"]
            owner.subscription = new_sub
            session.add(owner)
        # Peak-hour surcharge on a subscription booking is charged to BALANCE at
        # creation (final_price = subscription_peak_debt). If the trimmed slice
        # included peak hours, that money must be refunded too — hours alone
        # would silently keep the peak surcharge.
        removed_peak_money = round((booking.final_price or 0) - new_total_price, 2)
        if not pending and removed_peak_money > 0 and owner:
            owner.balance = round((owner.balance or 0) + removed_peak_money, 2)
            session.add(owner)

    # ── Apply the split ──
    # The original row becomes the LEFT remnant when left>0, else it becomes
    # the RIGHT remnant (front-trim). A separate NEW row is created only when
    # BOTH remnants survive.
    new_remnant_id = None

    if left > 0:
        kept_start, kept_dur, kept_quote = bStart, left, leftQuote
    else:
        # Front-trim: original becomes the right remnant, no new row.
        kept_start, kept_dur, kept_quote = cTo, right, rightQuote

    booking.start_time = _mt(kept_start)
    booking.duration = kept_dur
    booking.final_price = kept_quote.final_price
    booking.base_price = kept_quote.base_price
    booking.discount_amount = kept_quote.discount_amount
    booking.discount_percent = kept_quote.discount_percent
    booking.applied_rule = kept_quote.applied_rule
    if booking.payment_method == "subscription":
        booking.hours_deducted = kept_quote.hours_deducted
    if pending:
        booking.charge_amount = kept_quote.final_price
    booking.updated_at = datetime.now()

    # NEW remnant row only when BOTH left>0 and right>0 (middle trim).
    new_remnant = None
    if left > 0 and right > 0:
        new_remnant = Booking(
            user_id=booking.user_id,
            user_uuid=booking.user_uuid,
            resource_id=booking.resource_id,
            location_id=booking.location_id,
            date=booking.date,
            start_time=_mt(cTo),
            duration=right,
            status=booking.status,
            format=booking.format,
            payment_method=booking.payment_method,
            payment_source=booking.payment_source,
            payment_status=booking.payment_status,
            final_price=rightQuote.final_price,
            base_price=rightQuote.base_price,
            discount_amount=rightQuote.discount_amount,
            discount_percent=rightQuote.discount_percent,
            applied_rule=rightQuote.applied_rule,
            hours_deducted=(
                rightQuote.hours_deducted
                if booking.payment_method == "subscription"
                else None
            ),
            charge_amount=(rightQuote.final_price if pending else None),
            charged_at=None,
            crm_client_id=None,  # keep the CRM link only on the original
            recurring_group_id=None,
            gcal_event_id=None,
        )
        session.add(new_remnant)

    # ── Detach any CRM session linked to this booking ──
    # After a trim the booking's time/duration changed, so the automatic
    # session↔cabinet link is no longer reliable. Mirror cancel_booking: detach
    # so no session keeps a stale "КАБ" badge pointing at a now-different slot.
    # (Trim only shows for duration>=120, so single-session cabinet bookings
    # aren't affected.) The specialist can re-link via "Забронировать кабинет".
    from app.models.therapy_session import TherapySession as _TS
    linked_sessions = session.exec(
        select(_TS).where(_TS.booking_id == str(booking.id))
    ).all()
    for ts in linked_sessions:
        ts.booking_id = None
        ts.is_booked = False
        ts.updated_at = datetime.now()
        session.add(ts)

    # ── Google Calendar ── Clear the old event ref BEFORE commit so the DB is
    # consistent even if the external call later fails; do the delete+recreate
    # in the BACKGROUND after commit so a slow/timing-out Google API can never
    # block the request or leave a half-written state (regression the earlier
    # synchronous version had).
    old_gcal_event_id = booking.gcal_event_id
    old_gcal_resource = booking.resource_id
    booking.gcal_event_id = None

    session.add(booking)
    session.commit()
    session.refresh(booking)
    if new_remnant is not None:
        session.refresh(new_remnant)
        new_remnant_id = str(new_remnant.id)

    # GCal delete-old + recreate for both remnant rows, fully post-commit.
    if owner:
        owner_label = owner.name or owner.email
        background_tasks.add_task(
            _gcal_recreate_in_background, str(booking.id), owner_label,
            old_gcal_event_id, old_gcal_resource,
        )
        if new_remnant is not None:
            background_tasks.add_task(
                _gcal_create_in_background, new_remnant_id, owner_label
            )

    # ── Consecutive-hours: trimming a row may have broken a chain ──
    if owner and booking.payment_method == "balance":
        try:
            from app.services.consecutive_pricing import recompute_user_chains_for_day
            recompute_user_chains_for_day(
                session,
                owner,
                booking.resource_id,
                booking.date,
                actor_id=str(current_user.id),
                actor_role=current_user.role,
                reason="trim_booking",
            )
        except Exception:
            logger.exception("[consecutive] recompute on trim failed")

    # ── Audit logging ──
    is_balance = booking.payment_method == "balance"
    remnants = [{"start": booking.start_time, "duration": booking.duration}]
    if new_remnant is not None:
        remnants.append({"start": new_remnant.start_time, "duration": new_remnant.duration})

    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(booking.id),
        target_type="booking",
        event_type="booking_trimmed",
        description=(
            f"Trimmed {data.remove_from}-{data.remove_to} from "
            f"{_mt(bStart)}-{_mt(bEnd)}. "
            f"Refund: {removed_value if is_balance else removed_hours}"
            f"{' ₾' if is_balance else ' ч'}"
        ),
        metadata={
            "remove_from": data.remove_from,
            "remove_to": data.remove_to,
            "orig_start": _mt(bStart),
            "orig_end": _mt(bEnd),
            "refunded_amount": removed_value if is_balance else None,
            "refunded_hours": removed_hours if not is_balance else None,
            "new_remnant_id": new_remnant_id,
            "remnants": remnants,
        },
    )

    return {
        "ok": True,
        "booking_id": str(booking.id),
        "new_remnant_id": new_remnant_id,
        "refunded_amount": removed_value if is_balance else None,
        "refunded_hours": removed_hours if not is_balance else None,
        "remnants": remnants,
    }


# ─── Reschedule "this and following" in a recurring series ───────────────────

@router.patch("/{booking_id}/reschedule-series")
def reschedule_booking_series(
    booking_id: str,
    data: RescheduleRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Reschedule a booking AND every later sibling in its recurring group.

    Mirrors Google Calendar's "this and following" semantics for moves:
    the anchor takes the full date/time/resource change the user picked;
    every sibling on a strictly later calendar day in the same series
    keeps its own date but adopts the new start_time and (if changed)
    new resource. Earlier siblings are left alone.

    The endpoint is best-effort per sibling — if a sibling's new slot is
    occupied (other booking, room conflict), it's skipped and reported
    back in ``skipped`` so the admin can resolve manually. The anchor
    itself MUST succeed; if it can't be rescheduled, the whole call
    aborts before any sibling is touched.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if not booking.recurring_group_id:
        raise HTTPException(
            status_code=400,
            detail="Booking is not part of a recurring series — use /reschedule instead",
        )

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Snapshot the anchor's pre-move date so we can find "later" siblings
    # AFTER the anchor is updated (its own date may have moved).
    old_anchor_date = booking.date
    old_anchor_resource = booking.resource_id

    # 1) Reschedule the anchor itself by reusing the per-booking endpoint
    #    logic. Easiest way without splitting the endpoint into a helper
    #    today: call the underlying function directly. It commits, and
    #    its GCal recreate already runs as a background task — same
    #    background_tasks instance is shared with our siblings below.
    anchor_after = reschedule_booking(  # type: ignore[misc]
        booking_id=booking_id,
        data=data,
        background_tasks=background_tasks,
        session=session,
        current_user=current_user,
    )

    # 2) Propagate to later siblings.
    siblings = session.exec(
        select(Booking).where(
            Booking.recurring_group_id == booking.recurring_group_id,
            Booking.status == "confirmed",
            Booking.id != booking.id,
            Booking.date > old_anchor_date,
        )
    ).all()

    new_resource = data.new_resource_id or old_anchor_resource

    propagated = 0
    skipped: list[dict] = []
    for sib in siblings:
        # Skip rows already in the past — moving them isn't meaningful and
        # the per-row 24h policy already blocks it on /reschedule anyway.
        if _is_past(sib):
            skipped.append({
                "id": str(sib.id),
                "date": sib.date.isoformat(),
                "reason": "уже прошла",
            })
            continue

        available, conflict = check_availability(
            session=session,
            resource_id=new_resource,
            date=sib.date,
            start_time=data.new_start_time,
            duration=sib.duration,
            exclude_booking_id=str(sib.id),
            requester_user_uuid=sib.user_uuid,
        )
        if not available:
            skipped.append({
                "id": str(sib.id),
                "date": sib.date.isoformat(),
                "reason": str(conflict) if conflict else "слот занят",
            })
            continue

        old_sib_resource = sib.resource_id
        old_sib_time = sib.start_time
        old_sib_event = sib.gcal_event_id
        sib.start_time = data.new_start_time
        sib.resource_id = new_resource
        sib.updated_at = datetime.now()
        # Defer GCal recreate to a background task — same as anchor.
        # Clearing the column up-front avoids a pre-bg-task observer
        # seeing a stale event id pointed at the old slot.
        if sib.gcal_event_id:
            sib.gcal_event_id = None
        if old_sib_event:
            background_tasks.add_task(
                _gcal_recreate_in_background,
                str(sib.id),
                current_user.name or "",
                old_sib_event,
                old_sib_resource,
            )

        timeline_service.log_event(
            session=session,
            actor_id=current_user.id,
            actor_role=current_user.role,
            target_id=str(sib.id),
            target_type="booking",
            event_type="booking_rescheduled",
            description=(
                f"Series propagation: {old_sib_time} → {data.new_start_time}"
                + (f" (room {old_sib_resource} → {new_resource})" if old_sib_resource != new_resource else "")
            ),
            metadata={
                "anchor_id": str(booking.id),
                "old_time": old_sib_time,
                "new_time": data.new_start_time,
                "old_resource": old_sib_resource,
                "new_resource": new_resource,
                "via": "reschedule-series",
            },
        )

        session.add(sib)
        # Sync sibling's linked CRM session (if any) onto the new time.
        # Helper is no-commit; we batch with the single commit below.
        _sync_linked_session_to_booking(session, sib)
        propagated += 1

    session.commit()

    # Re-fetch to get the final state of the anchor after both writes.
    session.refresh(booking)

    # ── Telegram notification on series reschedule (owner 2026-05-29).
    # Previously this code was a no-op (placed after the early `return`).
    # Now moved BEFORE the return so it actually fires.
    try:
        notify_owner = _resolve_booking_owner(session, booking)
        if notify_owner and notify_owner.telegram_id:
            resource_name = booking.resource_id
            try:
                res_obj = session.get(Resource, booking.resource_id)
                if res_obj:
                    resource_name = res_obj.name or booking.resource_id
            except Exception:
                pass
            telegram_service.send_booking_rescheduled(
                chat_id=str(notify_owner.telegram_id),
                resource_name=resource_name,
                old_date=old_anchor_date,
                old_start_time=booking.start_time,  # NB: anchor has already moved
                new_date=booking.date,
                new_start_time=booking.start_time,
                duration_minutes=booking.duration,
                booking_id=str(booking.id),
            )
    except Exception as e:
        logger.warning(f"[Series reschedule] TG notification failed: {e}")

    return {
        "ok": True,
        "anchor": BookingRead.model_validate(booking, from_attributes=True),
        "propagated": propagated,
        "skipped": skipped,
    }


# ─── Link CRM client to booking ──────────────────────────────────────────────

class LinkClientRequest(PydanticBaseModel):
    crm_client_id: Optional[str] = None  # None to unlink


@router.patch("/{booking_id}/link-client", response_model=BookingRead)
def link_crm_client(
    booking_id: str,
    data: LinkClientRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Link or unlink a CRM client to a booking."""
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    if data.crm_client_id:
        from app.models.therapist_client import TherapistClient

        client = session.get(TherapistClient, data.crm_client_id)
        if not client:
            raise HTTPException(status_code=404, detail="CRM client not found")
        if client.specialist_id != str(current_user.id):
            raise HTTPException(
                status_code=403, detail="CRM client does not belong to you"
            )

    booking.crm_client_id = data.crm_client_id
    booking.updated_at = datetime.now()

    session.add(booking)
    session.commit()
    session.refresh(booking)

    return enrich_booking_status(booking)


# ─── Toggle re-rent ───────────────────────────────────────────────────────────

@router.patch("/{booking_id}/re-rent", response_model=BookingRead)
def toggle_re_rent(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Toggle re-rent listing for a booking."""
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status != "confirmed":
        raise HTTPException(
            status_code=400,
            detail="Only confirmed bookings can be listed for re-rent",
        )

    if _is_past(booking):
        raise HTTPException(
            status_code=400, detail="Cannot re-rent a past booking"
        )

    was_listed_before = booking.is_re_rent_listed
    booking.is_re_rent_listed = not booking.is_re_rent_listed
    booking.updated_at = datetime.now()

    session.add(booking)
    session.commit()
    session.refresh(booking)

    # If the booking just became re-rentable, the slot is effectively free
    # for other users — notify anyone on the waitlist for this slot.
    if not was_listed_before and booking.is_re_rent_listed:
        try:
            from app.services.waitlist_notify import notify_waitlist_for_freed_slot
            notify_waitlist_for_freed_slot(session, booking)
        except Exception:
            logger.exception("Failed to notify waitlist on re-rent listing")

    # ── Admin chat alert (only on listing, not on un-listing) ──
    if not was_listed_before and booking.is_re_rent_listed:
        try:
            from app.models.resource import Resource as ResModel
            from app.models.location import Location as LocModel
            res_obj = session.get(ResModel, booking.resource_id)
            loc_obj = session.get(LocModel, booking.location_id)
            res_name = res_obj.name if res_obj else booking.resource_id
            loc_name = loc_obj.name if loc_obj else booking.location_id
            booking_owner = _resolve_booking_owner(session, booking)
            telegram_service.send_admin_event(
                event="booking_re_rent_listed",
                fields={
                    "Арендатор": (booking_owner.name or booking_owner.email) if booking_owner else (booking.user_id or "—"),
                    "Когда":     f"{booking.date.strftime('%d.%m.%Y')} · {booking.start_time}",
                    "Кабинет":   f"{res_name} · {loc_name}",
                    "Сумма":     f"{booking.final_price:g} ₾" if booking.final_price else "по абонементу",
                },
            )
        except Exception as e:
            logger.warning(f"[Admin TG alert / re-rent] Non-blocking failure: {e}")

    return enrich_booking_status(booking)


# ─── Extend Booking ──────────────────────────────────────────────────────────

class ChangeFormatRequest(PydanticBaseModel):
    new_format: str  # "individual" | "group"


@router.patch("/{booking_id}/format", response_model=BookingRead)
def change_booking_format(
    booking_id: str,
    payload: ChangeFormatRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Switch a booking between individual and group format and re-quote.

    Why: clients sometimes pick the wrong format at checkout (group vs.
    individual = different per-hour rate on cabinets 7/8). Without this
    endpoint the only fix was cancel + recreate, which loses the slot
    behind a race and dirties the audit trail.

    Behaviour by `payment_status`:
      - `pending`: just re-quote, update `final_price`/`base_price`/etc;
        no money moved (cron will charge the new amount at T-24h).
      - `paid`   : compute delta = new_price − old_price; debit/credit it
        from the user's balance (subscription path: adjust hours_deducted).
        `charge_amount` updated to reflect what was *finally* paid.
      - `waived` : refuse — re-quoting a waived booking would re-introduce
        a charge the admin explicitly cancelled. Admin should waive again
        after the format change instead.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    new_format = (payload.new_format or "").strip().lower()
    if new_format not in ("individual", "group"):
        raise HTTPException(status_code=400, detail="new_format must be 'individual' or 'group'")

    if new_format == (booking.format or "").lower():
        raise HTTPException(status_code=400, detail="Booking is already in that format")

    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed bookings can be re-formatted")

    if booking.payment_status == "waived":
        raise HTTPException(
            status_code=409,
            detail="Бронь со снятым штрафом нельзя переформатировать — отмените снятие или создайте новую бронь",
        )

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    booking_owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
    if not booking_owner:
        raise HTTPException(status_code=404, detail="Booking owner missing")

    # Re-quote with the new format
    from app.services.pricing import PricingService
    try:
        h, m = map(int, (booking.start_time or "00:00").split(":"))
        start_dt = booking.date.replace(hour=h, minute=m, second=0, microsecond=0)
    except Exception:
        start_dt = booking.date

    quote = PricingService(session).calculate_price(
        user=booking_owner,
        resource_id=booking.resource_id,
        start_time=start_dt,
        duration_minutes=booking.duration,
        format_type=new_format,
    )

    old_price = float(booking.final_price or 0)
    old_hours = float(booking.hours_deducted or 0) if (booking.payment_method or "").lower() == "subscription" else 0.0
    new_price = float(quote.final_price)
    new_hours = float(quote.hours_deducted or 0) if (booking.payment_method or "").lower() == "subscription" else 0.0
    delta_price = round(new_price - old_price, 2)
    delta_hours = round(new_hours - old_hours, 4)

    # Settle the difference only if the row was already paid. `pending`
    # bookings get the new price stamped and the cron will charge the
    # right amount when T-24h hits.
    settled_now = False
    if booking.payment_status == "paid":
        if (booking.payment_method or "").lower() == "subscription":
            sub = dict(booking_owner.subscription or {})
            rem = float(sub.get("remaining_hours") or sub.get("remainingHours") or 0)
            used = float(sub.get("used_hours") or sub.get("usedHours") or 0)
            sub["remaining_hours"] = max(0.0, rem - delta_hours)
            sub["used_hours"] = max(0.0, used + delta_hours)
            if "remainingHours" in sub:
                del sub["remainingHours"]
            if "usedHours" in sub:
                del sub["usedHours"]
            booking_owner.subscription = sub
        else:
            booking_owner.balance = round((booking_owner.balance or 0) - delta_price, 2)
        booking.charge_amount = new_price
        settled_now = True

    booking.format = new_format
    booking.final_price = quote.final_price
    booking.base_price = quote.base_price
    booking.applied_rule = quote.applied_rule
    booking.discount_amount = quote.discount_amount
    booking.discount_percent = quote.discount_percent
    if (booking.payment_method or "").lower() == "subscription":
        booking.hours_deducted = quote.hours_deducted

    session.add(booking_owner)
    session.add(booking)
    session.commit()
    session.refresh(booking)

    # Timeline event so the change shows up in the booking's UI feed,
    # not just the TG chat. metadata captures both the price/hours delta
    # and the source/target format for audit replays.
    try:
        from app.services.timeline import timeline_service
        method_label_for_log = "subscription_hours" if (booking.payment_method or "").lower() == "subscription" else "balance_gel"
        timeline_service.log_event(
            session=session,
            actor_id=current_user.id,
            actor_role=current_user.role or "user",
            target_id=str(booking.id),
            target_type="booking",
            event_type="booking_format_changed",
            description=f"Формат изменён → {new_format}; цена {old_price:g}→{new_price:g}",
            metadata={
                "old_format": (booking.format if False else None),  # current row already updated; we keep delta below
                "new_format": new_format,
                "old_price": old_price,
                "new_price": new_price,
                "delta_price": delta_price,
                "delta_hours": delta_hours,
                "settled_now": settled_now,
                "delta_unit": method_label_for_log,
            },
        )
    except Exception:
        logger.warning("[booking-format] timeline log failed", exc_info=True)

    # Best-effort TG notification — both audiences (admin chat for audit,
    # owner so they see why their balance moved).
    try:
        method_label = "ч абонемента" if (booking.payment_method or "").lower() == "subscription" else "₾"
        delta_value = delta_hours if (booking.payment_method or "").lower() == "subscription" else delta_price
        delta_sign = "+" if delta_value > 0 else ""
        from app.services.telegram import telegram_service
        telegram_service.send_admin_event(
            event="booking_format_changed",
            fields={
                "Бронь": str(booking.id),
                "Кто": current_user.email or current_user.name or "—",
                "Формат": f"{(booking.format or '').lower()} ← was other",
                "Новая цена": f"{new_price:g} {method_label}",
                "Δ": f"{delta_sign}{delta_value:g} {method_label}",
                "Статус": booking.payment_status or "(legacy paid)",
            },
        )
        if settled_now and booking_owner.telegram_id:
            telegram_service._send_message(  # type: ignore[attr-defined]
                chat_id=booking_owner.telegram_id,
                text=(
                    f"🔄 <b>Изменён формат брони</b>\n\n"
                    f"Новая цена: {new_price:g} {method_label}\n"
                    f"С баланса {'списано' if delta_value > 0 else 'возвращено'}: {abs(delta_value):g} {method_label}"
                ),
                parse_mode="HTML",
            )
    except Exception:
        logger.warning("[booking-format] notify failed", exc_info=True)

    return booking


class SetPriceRequest(PydanticBaseModel):
    new_price: float
    reason: Optional[str] = None


@router.patch("/{booking_id}/price", response_model=BookingRead)
def set_booking_price(
    booking_id: str,
    payload: SetPriceRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Admin: override the price on a booking.

    Replaces the half-implemented client-only `setManualPrice` flow that
    silently dropped the change on page reload. Behaviour by `payment_status`:

      - `pending` → just stamp `final_price`/`charge_amount=None`/
        `applied_rule="MANUAL_OVERRIDE"`. The cron picks up the new amount
        when it settles at T-24h. No balance movement now.
      - `paid`    → settle the delta immediately. `delta = old - new`:
        positive → refund to balance (or hours back to subscription),
        negative → debit the difference. Updates `charge_amount` to the new
        actual cost. Subscription path adjusts `hours_deducted` proportionally.
      - `waived`  → 409. Cancelling the price-change makes more sense than
        re-introducing a charge after admin already waived it.

    Subscription bookings can also be re-priced — we shift `hours_deducted`
    by `new_price / base_hourly` proxy when the original was a sub row.
    Practical: most admin price overrides are on cash bookings; subscription
    overrides are rare and we keep them best-effort.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    new_price = float(payload.new_price)
    if new_price < 0:
        raise HTTPException(status_code=400, detail="Цена не может быть отрицательной")
    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Цена меняется только у подтверждённых броней")
    if booking.payment_status == "waived":
        raise HTTPException(
            status_code=409,
            detail="У этой брони снят штраф — цену менять нельзя. Снимите waiver или создайте новую бронь.",
        )

    old_price = float(booking.final_price or 0)
    if abs(new_price - old_price) < 0.005:
        raise HTTPException(status_code=400, detail="Новая цена совпадает со старой")

    booking_owner = session.get(User, booking.user_uuid) if booking.user_uuid else None

    delta = round(old_price - new_price, 2)  # positive = refund, negative = debit
    method = (booking.payment_method or "balance").lower()

    settled_now = False
    if booking.payment_status == "paid" and booking_owner:
        if method == "subscription":
            # Subscription pricing — proxy via the resource's standard rate.
            # If hours_deducted was set, scale it by the price ratio.
            old_hours = float(booking.hours_deducted or (booking.duration or 0) / 60.0)
            new_hours = old_hours * (new_price / old_price) if old_price > 0 else old_hours
            hours_delta = round(old_hours - new_hours, 4)
            sub = dict(booking_owner.subscription or {})
            rem = float(sub.get("remaining_hours") or sub.get("remainingHours") or 0)
            used = float(sub.get("used_hours") or sub.get("usedHours") or 0)
            sub["remaining_hours"] = rem + hours_delta
            sub["used_hours"] = max(0.0, used - hours_delta)
            if "remainingHours" in sub:
                del sub["remainingHours"]
            if "usedHours" in sub:
                del sub["usedHours"]
            booking_owner.subscription = sub
            booking.hours_deducted = round(new_hours, 4)
        else:
            booking_owner.balance = round((booking_owner.balance or 0) + delta, 2)
        booking.charge_amount = new_price
        settled_now = True

    booking.final_price = new_price
    booking.applied_rule = "MANUAL_OVERRIDE"

    if booking_owner:
        session.add(booking_owner)
    session.add(booking)
    session.commit()
    session.refresh(booking)

    # Timeline + TG (non-blocking).
    try:
        from app.services.timeline import timeline_service
        timeline_service.log_event(
            session=session,
            actor_id=current_user.id,
            actor_role=current_user.role or "admin",
            target_id=str(booking.id),
            target_type="booking",
            event_type="booking_price_changed",
            description=f"Цена изменена {old_price:g}→{new_price:g}{' · ' + (payload.reason or '') if payload.reason else ''}",
            metadata={
                "old_price": old_price,
                "new_price": new_price,
                "delta": delta,
                "settled_now": settled_now,
                "payment_method": method,
                "reason": payload.reason or None,
            },
        )
    except Exception:
        logger.warning("[booking-price] timeline log failed", exc_info=True)

    try:
        from app.services.telegram import telegram_service
        method_label = "ч абонемента" if method == "subscription" else "₾"
        delta_sign = "+" if delta > 0 else ""
        owner_label = (booking_owner.email or booking_owner.name) if booking_owner else "—"
        telegram_service.send_admin_event(
            event="booking_price_changed",
            fields={
                "Бронь": str(booking.id),
                "Клиент": owner_label,
                "Было": f"{old_price:g} {method_label}",
                "Стало": f"{new_price:g} {method_label}",
                "Δ": f"{delta_sign}{delta:g} {method_label} ({'возврат' if delta > 0 else 'доплата'})" if delta else "—",
                "Кто": current_user.email or current_user.name or "admin",
                "Причина": payload.reason or "—",
                "Сценарий": "settled_now" if settled_now else "pending_will_charge_later",
            },
        )
        if settled_now and booking_owner and booking_owner.telegram_id:
            verb = "возвращено" if delta > 0 else "списано"
            telegram_service._send_message(  # type: ignore[attr-defined]
                chat_id=booking_owner.telegram_id,
                text=(
                    f"💰 <b>Цена брони изменена</b>\n\n"
                    f"Было: {old_price:g} {method_label}\n"
                    f"Стало: {new_price:g} {method_label}\n"
                    f"С баланса {verb}: {abs(delta):g} {method_label}"
                ),
                parse_mode="HTML",
            )
    except Exception:
        logger.warning("[booking-price] notify failed", exc_info=True)

    return booking


class ExtendRequest(PydanticBaseModel):
    extra_minutes: int = 30  # default 30 min extension


@router.patch("/{booking_id}/extend", response_model=BookingRead)
def extend_booking(
    booking_id: str,
    payload: ExtendRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Extend a booking by adding extra minutes (30 min increments)."""
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed bookings can be extended")

    if _is_past(booking):
        # 2026-06-30 owner: клиент часто занимается дольше заказанного. Админ
        # может добить время по ФАКТУ на СЕГОДНЯШНЕЙ броне, даже если её слот
        # уже закончился. Прошлые дни и обычные пользователи — по-прежнему блок
        # (нельзя задним числом растягивать чужую завершённую аренду).
        from datetime import timezone as _tz_ext
        tbilisi_today = (datetime.now(_tz_ext.utc) + timedelta(hours=4)).date()
        booking_day = booking.date.date() if hasattr(booking.date, "date") else booking.date
        is_admin = current_user.role in ADMIN_ROLES
        if not (is_admin and booking_day == tbilisi_today):
            raise HTTPException(status_code=400, detail="Cannot extend a past booking")

    extra = payload.extra_minutes
    if extra < 30 or extra % 30 != 0:
        raise HTTPException(status_code=400, detail="Extension must be in 30-minute increments")

    new_duration = booking.duration + extra

    # Check if the extended time is available
    new_end_h, new_end_m = divmod(
        int(booking.start_time.split(":")[0]) * 60
        + int(booking.start_time.split(":")[1])
        + new_duration,
        60
    )
    new_end_time = f"{new_end_h:02d}:{new_end_m:02d}"

    # Check for conflicts in the extended slot
    all_bookings = session.exec(
        select(Booking).where(
            Booking.resource_id == booking.resource_id,
            Booking.date == booking.date,
            Booking.status.in_(["confirmed", "pending_approval"]),
            Booking.id != b_uuid,
        )
    ).all()

    old_end_h = int(booking.start_time.split(":")[0]) * 60 + int(booking.start_time.split(":")[1]) + booking.duration
    new_end_total = int(booking.start_time.split(":")[0]) * 60 + int(booking.start_time.split(":")[1]) + new_duration

    for other in all_bookings:
        other_start = int(other.start_time.split(":")[0]) * 60 + int(other.start_time.split(":")[1])
        other_end = other_start + other.duration
        # Check if the extended portion overlaps
        if other_start < new_end_total and other_end > old_end_h:
            raise HTTPException(
                status_code=409,
                detail=f"Конфликт с бронью {other.start_time} ({other.duration} мин). Слот занят."
            )

    # Calculate additional price
    from app.services.pricing import PricingService
    pricing = PricingService(session)
    # Simple proportional pricing: (extra_minutes / original_duration) * original_price
    if booking.final_price and booking.duration > 0:
        price_per_min = booking.final_price / booking.duration
        extra_price = round(price_per_min * extra, 2)
    else:
        extra_price = 0

    booking.duration = new_duration
    booking.final_price = round((booking.final_price or 0) + extra_price, 2)
    booking.updated_at = datetime.now()

    # Deduct from balance if applicable
    if extra_price > 0 and not current_user.role in ADMIN_ROLES:
        target_user = session.get(User, UUID(booking.user_uuid)) if booking.user_uuid else None
        if not target_user:
            target_user = session.exec(
                select(User).where(User.email == booking.user_id)
            ).first()
        if target_user:
            target_user.balance = round((target_user.balance or 0) - extra_price, 2)
            session.add(target_user)

    session.add(booking)
    session.commit()
    session.refresh(booking)

    # R33 fix — extend changes the booking duration so the Google Calendar
    # event needs its endTime updated. We don't have an `update_event`
    # method; cheapest correct path is delete-old + create-new. If either
    # step fails, log and move on — the DB is the source of truth and an
    # admin can use the resync tool to fix the GCal event later.
    if booking.gcal_event_id:
        old_event_id = booking.gcal_event_id
        try:
            gcal_service.delete_event(old_event_id, booking.resource_id)
        except Exception as e:
            logger.warning(f"[GCal Extend] delete_event failed for {old_event_id}: {e}")
        booking.gcal_event_id = None
    try:
        # Resolve owner name for the new event title
        owner_for_event = (
            session.get(User, booking.user_uuid) if booking.user_uuid else None
        )
        if not owner_for_event and booking.user_id:
            owner_for_event = session.exec(
                select(User).where(User.email == booking.user_id)
            ).first()
        new_event_id = gcal_service.create_event(
            booking,
            user_name=(owner_for_event.name if owner_for_event else booking.user_id),
        )
        if new_event_id:
            booking.gcal_event_id = new_event_id
            session.add(booking)
            session.commit()
    except Exception as e:
        logger.warning(f"[GCal Extend] create_event failed for booking {booking.id}: {e}")

    return enrich_booking_status(booking)


# ─── Shorten booking ─────────────────────────────────────────────────────────
# Дополнение к /extend. Юзер забронировал 2 часа, потом хочет освободить
# один — раньше приходилось отменять всю бронь и заново ставить, теперь
# можно сократить с конца или с начала, пропорционально вернув деньги.
class ShortenRequest(PydanticBaseModel):
    remove_minutes: int = 60          # Минут вычесть, кратно 30
    side: str = "end"                 # "end" (сократить с конца) | "start" (с начала)


@router.patch("/{booking_id}/shorten", response_model=BookingRead)
def shorten_booking(
    booking_id: str,
    payload: ShortenRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Сократить бронь, освобождая лишний час с начала или с конца.

    Минимальная итоговая длительность — 60 мин (политика Unbox: меньше часа
    бронировать нельзя). Цена пересчитывается пропорционально, разница
    возвращается на баланс / в часы абонемента. Если бронь была в статусе
    `pending` (deferred billing) — деньги ещё не списаны, просто
    обновляется итоговая сумма для cron'а.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed bookings can be shortened")

    if _is_past(booking):
        raise HTTPException(status_code=400, detail="Cannot shorten a past booking")

    if booking.payment_status == "waived":
        raise HTTPException(
            status_code=409,
            detail="У брони снят штраф — сначала восстановите оплату или создайте новую бронь",
        )

    remove = int(payload.remove_minutes or 0)
    if remove < 30 or remove % 30 != 0:
        raise HTTPException(status_code=400, detail="remove_minutes должно быть кратно 30")

    side = (payload.side or "end").lower()
    if side not in ("end", "start"):
        raise HTTPException(status_code=400, detail="side должно быть 'end' или 'start'")

    new_duration = (booking.duration or 0) - remove
    if new_duration < 60:
        raise HTTPException(
            status_code=400,
            detail=f"Минимальная длительность брони — 60 мин. Сейчас {booking.duration}, нельзя убрать {remove}.",
        )

    old_price = float(booking.final_price or 0)
    old_duration = int(booking.duration or 0)
    new_start_time = booking.start_time

    if side == "start":
        # Сдвигаем начало на `remove` минут вперёд.
        try:
            sh, sm = booking.start_time.split(":")
            start_min = int(sh) * 60 + int(sm) + remove
            nh, nm = divmod(start_min, 60)
            new_start_time = f"{nh:02d}:{nm:02d}"
        except Exception:
            raise HTTPException(status_code=400, detail="Не удалось пересчитать время начала")

    # Пропорциональный возврат части цены. PricingService умеет считать
    # точную цену для нового слота, но это перезапустит discount/peak
    # логику и в краевых случаях даст странный результат (например, при
    # сокращении с конца «потеряется» peak-час и base уменьшится больше
    # чем на пропорциональную долю). Простая пропорция стабильнее.
    if old_duration > 0:
        new_price = round(old_price * (new_duration / old_duration), 2)
    else:
        new_price = old_price
    refund_price = round(old_price - new_price, 2)

    # Возврат subscription-часов аналогично.
    old_hours = float(booking.hours_deducted or 0) if (booking.payment_method or "").lower() == "subscription" else 0.0
    new_hours = round(old_hours * (new_duration / old_duration), 4) if old_duration > 0 else old_hours
    refund_hours = round(old_hours - new_hours, 4)

    # Применяем возврат только если деньги уже списаны. Для pending —
    # cron возьмёт правильную сумму при T-24h.
    settled_now = booking.payment_status == "paid"
    if settled_now and refund_price > 0:
        target_user = session.get(User, booking.user_uuid) if booking.user_uuid else None
        if not target_user and booking.user_id:
            target_user = session.exec(select(User).where(User.email == booking.user_id)).first()
        if target_user:
            if (booking.payment_method or "").lower() == "subscription" and refund_hours > 0:
                sub = dict(target_user.subscription or {})
                rem = float(sub.get("remaining_hours") or 0)
                used = float(sub.get("used_hours") or 0)
                sub["remaining_hours"] = rem + refund_hours
                sub["used_hours"] = max(0.0, used - refund_hours)
                target_user.subscription = sub
            else:
                target_user.balance = round((target_user.balance or 0) + refund_price, 2)
            session.add(target_user)

    booking.duration = new_duration
    booking.start_time = new_start_time
    booking.final_price = new_price
    if (booking.payment_method or "").lower() == "subscription":
        booking.hours_deducted = new_hours
    if settled_now:
        booking.charge_amount = new_price
    booking.updated_at = datetime.now()

    session.add(booking)
    session.commit()
    session.refresh(booking)

    # GCal: тот же паттерн что в extend — delete + create заново.
    if booking.gcal_event_id:
        old_event_id = booking.gcal_event_id
        try:
            gcal_service.delete_event(old_event_id, booking.resource_id)
        except Exception as e:
            logger.warning(f"[GCal Shorten] delete_event failed for {old_event_id}: {e}")
        booking.gcal_event_id = None
    try:
        owner_for_event = session.get(User, booking.user_uuid) if booking.user_uuid else None
        if not owner_for_event and booking.user_id:
            owner_for_event = session.exec(select(User).where(User.email == booking.user_id)).first()
        new_event_id = gcal_service.create_event(
            booking,
            user_name=(owner_for_event.name if owner_for_event else booking.user_id),
        )
        if new_event_id:
            booking.gcal_event_id = new_event_id
            session.add(booking)
            session.commit()
    except Exception as e:
        logger.warning(f"[GCal Shorten] create_event failed for booking {booking.id}: {e}")

    return enrich_booking_status(booking)


# ─── Credit-limit forecast (раннее предупреждение о должниках) ────────────────

@router.get("/limit-forecast")
def credit_limit_forecast(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Клиенты, у кого будущие (pending) списания за 24 ч уведут баланс за
    кредитный лимит — или кто уже за лимитом.

    Списание отложенное: брони дальше 24 ч висят `pending` (деньги ещё не
    сняты) и лимит при создании не проверяется. Этот отчёт заранее считает,
    к чему приведёт весь конвейер pending-списаний, чтобы админ видел риск
    до того, как клиент уйдёт в долг за лимит.
    """
    pend = session.exec(
        select(Booking).where(
            Booking.status == "confirmed",
            Booking.payment_status == "pending",
        )
    ).all()

    by_user: dict[str, list[Booking]] = {}
    for b in pend:
        key = str(b.user_uuid) if b.user_uuid else (b.user_id or "")
        if key:
            by_user.setdefault(key, []).append(b)

    rows: list[dict] = []
    for key, bks in by_user.items():
        u: Optional[User] = None
        f = bks[0]
        if f.user_uuid:
            try:
                u = session.get(User, f.user_uuid if isinstance(f.user_uuid, UUID) else UUID(str(f.user_uuid)))
            except (ValueError, TypeError):
                u = None
        if u is None and f.user_id:
            u = session.exec(select(User).where(User.email == f.user_id)).first()
        if u is None:
            continue

        pending_total = 0.0
        pending_count = 0
        soonest = None
        for b in bks:
            # только явные списания с баланса (subscription/bonus считаем
            # отдельным пулом — на кредитный лимит напрямую не давят)
            if (b.payment_method or "balance").lower() != "balance":
                continue
            pending_total += float(b.charge_amount or b.final_price or 0)
            pending_count += 1
            if soonest is None or b.date < soonest:
                soonest = b.date
        if pending_count == 0:
            continue

        balance = round(float(u.balance or 0), 2)
        limit = round(float(u.credit_limit or 0), 2)
        projected = round(balance - pending_total, 2)
        over_limit_by = round(max(0.0, -projected - limit), 2)
        already_over_by = round(max(0.0, -balance - limit), 2)
        if over_limit_by <= 0 and already_over_by <= 0:
            continue

        rows.append({
            "user_id": str(u.id),
            "name": u.name,
            "email": u.email,
            "balance": balance,
            "credit_limit": limit,
            "pending_total": round(pending_total, 2),
            "pending_count": pending_count,
            "projected_balance": projected,
            "over_limit_by": over_limit_by,
            "already_over_by": already_over_by,
            "next_charge_date": soonest.isoformat() if soonest else None,
        })

    rows.sort(key=lambda r: (r["over_limit_by"], r["already_over_by"]), reverse=True)
    return {"count": len(rows), "clients": rows}


# ─── Hot Booking Approval ────────────────────────────────────────────────────

@router.get("/pending-approval", response_model=List[BookingRead])
def list_pending_approvals(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """List all bookings pending admin approval (hot bookings)."""
    pending = session.exec(
        select(Booking).where(Booking.status == "pending_approval")
        .order_by(Booking.created_at.desc())
    ).all()
    return [enrich_booking_status(b) for b in pending]


@router.post("/{booking_id}/approve", response_model=BookingRead)
def approve_booking(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Admin approves a pending hot booking — deduct payment and confirm."""
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    # Row-level lock to serialize concurrent approvals: without it two
    # admins double-clicking «Подтвердить» (or one in /admin/bookings while
    # another from TG) both pass the status-check, both deduct balance,
    # both create GCal events. SELECT … FOR UPDATE blocks the second
    # transaction until the first commits — by then status flipped to
    # 'confirmed' and the re-check below short-circuits cleanly.
    booking = session.exec(
        select(Booking).where(Booking.id == b_uuid).with_for_update()
    ).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Booking is not pending approval")

    # Check availability again
    is_available, reason = check_availability(
        session=session,
        resource_id=booking.resource_id,
        date=booking.date,
        start_time=booking.start_time,
        duration=booking.duration,
        exclude_booking_id=str(booking.id),
        requester_user_uuid=booking.user_uuid,
    )
    if not is_available:
        raise HTTPException(status_code=400, detail=f"Slot no longer available: {reason}")

    # Deduct payment now
    b_owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
    if b_owner:
        if booking.payment_method == "subscription":
            if b_owner.subscription:
                new_sub = b_owner.subscription.copy()
                rem = new_sub.get("remaining_hours", 0)
                used = new_sub.get("used_hours", 0)
                new_sub["remaining_hours"] = max(0, float(rem) - (booking.hours_deducted or 0))
                new_sub["used_hours"] = float(used) + (booking.hours_deducted or 0)
                b_owner.subscription = new_sub
        else:
            b_owner.balance -= booking.final_price
        session.add(b_owner)

    booking.status = "confirmed"
    booking.updated_at = datetime.now()
    session.add(booking)
    session.commit()
    session.refresh(booking)

    # GCal sync
    try:
        event_id = gcal_service.create_event(booking, user_name=current_user.name)
        if event_id:
            booking.gcal_event_id = event_id
            session.add(booking)
            session.commit()
            session.refresh(booking)
    except Exception as e:
        logger.warning(f"[GCal Sync] Re-rent accept sync failed: {e}")

    # Notify the client — TG + in-app. Best-effort, никогда не блокирует
    # сам approve. Без этого у клиента осталась бы только висящая «Ожидает»
    # карточка без сигнала что админ её одобрил.
    try:
        from app.models.resource import Resource as _Res
        from app.models.location import Location as _Loc
        from app.models.notification import Notification as _Notif
        _res = session.get(_Res, booking.resource_id) if booking.resource_id else None
        _loc = session.get(_Loc, _res.location_id) if _res and _res.location_id else None
        _res_name = (_res.name if _res else booking.resource_id) or booking.resource_id or "—"
        _loc_name = _loc.name if _loc else None
        _date_str = booking.date.strftime("%d.%m") if booking.date else "—"

        if b_owner and b_owner.telegram_id:
            try:
                _loc_line = f" · {_loc_name}" if _loc_name else ""
                telegram_service._send_message(  # type: ignore[attr-defined]
                    chat_id=b_owner.telegram_id,
                    text=(
                        f"✅ <b>Срочная бронь подтверждена</b>\n\n"
                        f"📅 {_date_str} · {booking.start_time}\n"
                        f"📍 {_res_name}{_loc_line}\n\n"
                        f"Деньги списаны с баланса."
                    ),
                    parse_mode="HTML",
                )
            except Exception:
                pass

        if b_owner:
            try:
                notif = _Notif(
                    type="hot_booking_approved",
                    title="Бронь подтверждена",
                    description=(
                        f"{_res_name}{(' · ' + _loc_name) if _loc_name else ''} · "
                        f"{_date_str} {booking.start_time}"
                    ),
                    recipient_id=str(b_owner.id),
                    icon="CheckCircle",
                    link="/dashboard/bookings",
                )
                session.add(notif)
                session.commit()
            except Exception:
                session.rollback()
    except Exception:
        logger.warning("[hot-booking approve] client notify failed", exc_info=True)

    return enrich_booking_status(booking)


class RejectBookingPayload(PydanticBaseModel):
    """Optional admin-supplied reason that will be sent to the client.
    If empty/missing, default «Слот недоступен» is used."""
    reason: Optional[str] = None


@router.post("/{booking_id}/reject", response_model=BookingRead)
def reject_booking(
    booking_id: str,
    payload: Optional[RejectBookingPayload] = None,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Admin rejects a pending hot booking.

    Accepts optional `reason` in body — that text is shown to the client
    in their TG/in-app notification, so the admin can briefly explain why
    the slot can't be honoured.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid Booking ID")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Booking is not pending approval")

    admin_reason = (payload.reason if payload and payload.reason else "").strip()
    booking.status = "cancelled"
    booking.cancellation_reason = (
        f"Отклонено админом ({current_user.name}): {admin_reason}"
        if admin_reason else
        f"Отклонено админом ({current_user.name})"
    )
    booking.cancelled_by = f"admin:{current_user.email}"
    booking.updated_at = datetime.now()

    session.add(booking)
    session.commit()
    session.refresh(booking)

    # Notify the client — TG + in-app. Best-effort.
    try:
        from app.models.resource import Resource as _Res
        from app.models.location import Location as _Loc
        from app.models.notification import Notification as _Notif
        b_owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
        _res = session.get(_Res, booking.resource_id) if booking.resource_id else None
        _loc = session.get(_Loc, _res.location_id) if _res and _res.location_id else None
        _res_name = (_res.name if _res else booking.resource_id) or booking.resource_id or "—"
        _loc_name = _loc.name if _loc else None
        _date_str = booking.date.strftime("%d.%m") if booking.date else "—"
        _reason_label = admin_reason or "Слот недоступен"

        if b_owner and b_owner.telegram_id:
            try:
                _loc_line = f" · {_loc_name}" if _loc_name else ""
                telegram_service._send_message(  # type: ignore[attr-defined]
                    chat_id=b_owner.telegram_id,
                    text=(
                        f"❌ <b>Срочная бронь отклонена</b>\n\n"
                        f"📅 {_date_str} · {booking.start_time}\n"
                        f"📍 {_res_name}{_loc_line}\n\n"
                        f"Причина: {_reason_label}\n\n"
                        f"Деньги не списаны. Можете выбрать другое время."
                    ),
                    parse_mode="HTML",
                )
            except Exception:
                pass

        if b_owner:
            try:
                notif = _Notif(
                    type="hot_booking_rejected",
                    title="Бронь отклонена",
                    description=(
                        f"{_res_name}{(' · ' + _loc_name) if _loc_name else ''} · "
                        f"{_date_str} {booking.start_time} · {_reason_label}"
                    ),
                    recipient_id=str(b_owner.id),
                    icon="XCircle",
                    link="/dashboard/bookings",
                )
                session.add(notif)
                session.commit()
            except Exception:
                session.rollback()
    except Exception:
        logger.warning("[hot-booking reject] client notify failed", exc_info=True)

    return enrich_booking_status(booking)
