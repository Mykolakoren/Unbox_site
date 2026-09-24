"""CRM Calendar Sync — Google Calendar import with auto-client creation."""
import logging
from typing import Optional

logger = logging.getLogger(__name__)
import re
import random
import string
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.api import deps
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import TherapySession
from app.models.therapist_payment import TherapistPayment
from app.models.therapist_note import TherapistNote
from app.api.v1.crm import get_crm_calendar_id


def _try_move_linked_booking(
    session: Session,
    ts: TherapySession,
    old_date: datetime,
    new_date: datetime,
    new_duration: int,
    specialist_id: str,
) -> None:
    """Mirror a CRM session move onto its linked cabinet booking.

    Called from the sync update path when GCal reports a session at a new
    time. Three outcomes:
      A) Linked booking moves cleanly                            → booking updated
      B) Slot is occupied in the same cabinet → look for free
         alternatives at the new time across all resources       → notification with options
      C) Booking not found / not confirmed                       → no-op, log warning

    No GCal write-back here — the calendar already shows the new time
    (that's how we got here). We just keep the cabinet booking in sync.
    """
    from app.models.booking import Booking
    from app.models.notification import Notification
    from app.models.resource import Resource
    from app.services.booking import check_availability

    log = logging.getLogger(__name__)
    booking = session.get(Booking, ts.booking_id)
    if not booking or booking.status != "confirmed":
        log.info("[crm-sync] session %s moved but booking %s not confirmed; skipping",
                 ts.id, ts.booking_id)
        return

    # `new_date` is UTC-naive (from crm_calendar._parse_event_dt), but
    # Booking.date/start_time follow the Tbilisi-naive convention (midnight
    # date + Tbilisi wall-clock "HH:MM"). Lift UTC → Tbilisi (+4h) before
    # deriving start_time and the midnight booking.date, otherwise the moved
    # booking shifts 4h / wrong day.
    from datetime import timedelta as _td_tbs
    new_date_tbs = new_date + _td_tbs(hours=4)
    new_start_time = f"{new_date_tbs.hour:02d}:{new_date_tbs.minute:02d}"
    new_booking_date = new_date_tbs.replace(hour=0, minute=0, second=0, microsecond=0)

    # Same cabinet, new time — happiest path. Use exclude_booking_id so
    # the booking we're moving doesn't conflict with itself.
    is_available, reason = check_availability(
        session,
        resource_id=booking.resource_id,
        date=new_booking_date,
        start_time=new_start_time,
        duration=new_duration,
        exclude_booking_id=str(booking.id),
    )
    if is_available:
        booking.date = new_booking_date
        booking.start_time = new_start_time
        booking.duration = new_duration
        booking.updated_at = datetime.now()
        session.add(booking)
        log.info("[crm-sync] booking %s moved with session %s → %s %s",
                 booking.id, ts.id, new_booking_date.date(), new_start_time)
        return

    # Conflict — find alternative cabinets free at the new time. We check
    # every resource at the same location first (most likely substitute),
    # then resources at other locations as a fallback.
    resources = session.exec(select(Resource)).all()
    same_loc = [r for r in resources if r.location_id == booking.location_id and r.id != booking.resource_id]
    other_loc = [r for r in resources if r.location_id != booking.location_id]
    alternatives: list[str] = []
    for r in same_loc + other_loc:
        ok, _ = check_availability(
            session,
            resource_id=r.id,
            date=new_booking_date,
            start_time=new_start_time,
            duration=new_duration,
        )
        if ok:
            loc_label = ''
            if r.location_id != booking.location_id:
                loc_label = f" · {r.location_id}"
            alternatives.append(f"{r.name}{loc_label}")
        if len(alternatives) >= 5:
            break

    title = "Конфликт переноса брони"
    alt_line = (
        "Свободны: " + ", ".join(alternatives)
        if alternatives else "Все кабинеты заняты в это время."
    )
    desc = (
        f"Сессия перенесена в Google Calendar на {new_date_tbs.strftime('%d.%m %H:%M')} "
        f"(было {(old_date + _td_tbs(hours=4)).strftime('%d.%m %H:%M')}), но текущий кабинет "
        f"({booking.resource_id}) занят: {reason or 'нет деталей'}. "
        f"{alt_line}"
    )
    notif = Notification(
        recipient_id=specialist_id,
        type="booking_conflict",
        title=title,
        description=desc,
        icon="alert-triangle",
        link=f"/crm/clients/{ts.client_id}",
    )
    session.add(notif)
    log.warning("[crm-sync] booking %s conflict on move to %s %s — %d alts",
                booking.id, new_booking_date.date(), new_start_time, len(alternatives))


def _cancel_booking_behind_session(session: Session, ts: TherapySession, reason: str) -> bool:
    """Cancel the cabinet booking behind a session that vanished from Google Calendar.

    Sync used to just flip the booking to `cancelled` — no refund, no cleanup:
    a booking the client had already PAID for was cancelled with the money kept,
    and its cabinet event stayed in Google (slot free in the chessboard, busy in
    the calendar). Now it goes through the same refund path as a manual cancel,
    and the cabinet's own GCal event is removed.

    Returns True when a booking was actually cancelled.
    """
    if not ts.booking_id:
        return False

    # Imported lazily: bookings.routes is a router module, and importing it at
    # module scope risks an import cycle.
    from app.models.booking import Booking
    from app.api.v1.bookings.routes import (
        _refund_booking_to_owner,
        _resolve_booking_owner,
    )
    from app.services.google_calendar import gcal_service

    log = logging.getLogger(__name__)
    try:
        # TherapySession.booking_id is a str, Booking.id is a UUID — hand
        # session.get() a real UUID or the lookup blows up inside the driver
        # (the old code swallowed that in a broad except and cancelled nothing).
        from uuid import UUID as _UUID
        bid = ts.booking_id
        if isinstance(bid, str):
            try:
                bid = _UUID(bid)
            except ValueError:
                log.warning("[crm-sync] booking_id %r is not a UUID", ts.booking_id)
                return False

        b = session.get(Booking, bid)
        if not b or b.status != "confirmed":
            return False

        owner = _resolve_booking_owner(session, b)
        if owner:
            # Skips `pending`/`waived` internally — nothing was charged there.
            _refund_booking_to_owner(session, b, owner, refund_percent=1.0)
        else:
            log.warning("[crm-sync] booking %s cancelled without refund: owner not found", b.id)

        if b.gcal_event_id:
            try:
                gcal_service.delete_event(b.gcal_event_id, b.resource_id)
            except Exception as e:
                log.warning("[crm-sync] cabinet GCal delete failed for booking %s: %r", b.id, e)
            b.gcal_event_id = None

        b.status = "cancelled"
        b.cancellation_reason = reason
        b.cancelled_by = "auto-sync"
        b.updated_at = datetime.now()
        session.add(b)
        return True
    except Exception as e:
        log.warning("[crm-sync] failed to cancel linked booking %s: %r", ts.booking_id, e)
        return False


def _delete_session_safely(session: Session, ts: TherapySession) -> None:
    """Hard-delete a CRM session, nulling FK refs on payments/notes first.

    Background: the admin's mental model is "if I cancel it in Google
    Calendar, it should disappear from CRM" (2026-05-14 spec). We used
    to flip status → CANCELLED_*, but that left ghost rows polluting the
    client page. Now sync deletes outright.
    Payments and notes that referenced the session lose their session_id
    (FK becomes NULL) but stay in their tables — financial / clinical
    history isn't destroyed, just decoupled.
    """
    for p in session.exec(
        select(TherapistPayment).where(TherapistPayment.session_id == ts.id)
    ).all():
        p.session_id = None
        session.add(p)
    for n in session.exec(
        select(TherapistNote).where(TherapistNote.session_id == ts.id)
    ).all():
        n.session_id = None
        session.add(n)
    session.delete(ts)

router = APIRouter()

# Service account address shown to admins when permissions are wrong. Kept
# in one place so a future credential rotation only needs to be edited
# here, not in every error message.
GCAL_SERVICE_ACCOUNT = "psycrm-bot@psycrm-calendar.iam.gserviceaccount.com"


def _gcal_error_to_message(exc: Exception, calendar_id: str) -> str:
    """Translate a raw Google API error into a sentence the admin can act on.

    The default `HTTPException(500, f"Google Calendar error: {e}")` dump
    exposed the full request URL + error JSON which read like a stack
    trace and gave admins nothing actionable. This helper detects the
    common cases and returns Russian guidance pointing at the actual fix
    (sharing the calendar with the service account, fixing the
    `calendar_id`, etc.). Falls back to a generic message for genuinely
    unexpected errors.
    """
    try:
        from googleapiclient.errors import HttpError as _HttpError
    except Exception:  # pragma: no cover — googleapiclient always present at runtime
        _HttpError = None  # type: ignore

    if _HttpError is not None and isinstance(exc, _HttpError):
        status = getattr(exc.resp, "status", None)
        if status == 404:
            return (
                f"Календарь {calendar_id} недоступен сервисному аккаунту. "
                f"Откройте в Google Calendar настройки этого календаря → "
                f"«Поделиться с конкретными пользователями» → добавьте "
                f"{GCAL_SERVICE_ACCOUNT} с доступом «Видеть все события» "
                f"(а для записи — «Внесение изменений в события»). "
                f"Также проверьте, что в /crm/settings указан правильный calendar_id."
            )
        if status == 403:
            return (
                f"Сервисному аккаунту запрещён доступ к календарю {calendar_id}. "
                f"Проверьте уровень доступа в настройках календаря: должен быть как минимум "
                f"«Видеть все события» для {GCAL_SERVICE_ACCOUNT}."
            )
        if status == 401:
            return (
                "Авторизация сервисного аккаунта истекла или невалидна. "
                "Сообщите разработчику — нужно обновить ключ psycrm-calendar.json."
            )
        # Other Google errors — keep the status code but skip the URL noise.
        return f"Google Calendar API вернул ошибку {status}. Повторите попытку через минуту; если не пройдёт — сообщите разработчику."

    # Non-Google exceptions (network, etc.)
    return f"Не удалось обратиться к Google Calendar: {exc!s}"


def _clean_client_name(summary: str) -> str:
    """Extract clean client name from calendar event summary."""
    name = re.sub(r"#\d{4}", "", summary or "").strip()
    name = re.sub(r"\s*\(.*?\)\s*$", "", name).strip()
    name = " ".join(name.split())
    return name


def _generate_alias_code(existing_codes: set) -> str:
    """Generate a unique 4-digit alias code."""
    for _ in range(1000):
        code = "".join(random.choices(string.digits, k=4))
        if code not in existing_codes:
            return code
    raise RuntimeError("Cannot generate unique alias code")


def _normalize_name(name: str) -> str:
    """Normalize name for matching: lowercase, strip, collapse whitespace."""
    return " ".join(name.lower().strip().split())


@router.get("/sync/test-connection")
def test_calendar_connection(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    """One-shot health check for the specialist's Google Calendar config.

    Useful right after a specialist edits `calendar_id` in /crm/settings —
    pings the calendar with a 1-event `events.list` call so the UI can
    say "ok, this works" or "the service account can't see this calendar,
    here's how to fix it" before they ever try to sync sessions. Returns
    a normalised `{ok, calendar_id, service_account, message?}` shape so
    the frontend can show a green/red state without parsing exception text.
    """
    calendar_id = get_crm_calendar_id(current_user)
    if not calendar_id:
        return {
            "ok": False,
            "calendar_id": None,
            "service_account": GCAL_SERVICE_ACCOUNT,
            "message": "Calendar ID не задан. Введите адрес календаря и сохраните.",
        }

    try:
        # Tiny request — list 1 event in a 1-day window. If credentials and
        # sharing are correct, this returns near-instantly even on calendars
        # with thousands of events.
        from app.services.crm_calendar import _get_calendar_service
        service = _get_calendar_service()
        from datetime import timedelta, timezone
        now = datetime.now(timezone.utc)
        service.events().list(
            calendarId=calendar_id,
            timeMin=now.isoformat(),
            timeMax=(now + timedelta(days=1)).isoformat(),
            maxResults=1,
            singleEvents=True,
        ).execute()
    except Exception as e:
        return {
            "ok": False,
            "calendar_id": calendar_id,
            "service_account": GCAL_SERVICE_ACCOUNT,
            "message": _gcal_error_to_message(e, calendar_id),
        }

    # Проверка ЗАПИСИ (аудит 24.09). Список событий работает и при доступе
    # «только просмотр», а CRM нужно создавать события — раньше специалист
    # видел «работает», а сессии молча не появлялись в календаре. Ставим
    # служебное событие в далёкое прошлое и сразу удаляем его.
    try:
        probe = service.events().insert(
            calendarId=calendar_id,
            body={
                "summary": "Unbox CRM — проверка подключения",
                "start": {"date": "2000-01-01"},
                "end": {"date": "2000-01-02"},
                "transparency": "transparent",
                "visibility": "private",
            },
            sendUpdates="none",
        ).execute()
    except Exception as e:
        logger.info(f"[test-connection] write probe failed for {calendar_id}: {e}")
        return {
            "ok": False,
            "calendar_id": calendar_id,
            "service_account": GCAL_SERVICE_ACCOUNT,
            "message": (
                "Календарь виден, но CRM не может добавлять в него события — "
                "доступ открыт только на просмотр. В Google Календаре: настройки "
                "календаря → «Доступ для отдельных пользователей» → для "
                f"{GCAL_SERVICE_ACCOUNT} выберите «Внесение изменений в мероприятия»."
            ),
        }
    try:
        service.events().delete(calendarId=calendar_id, eventId=probe["id"], sendUpdates="none").execute()
    except Exception as e:  # событие в 2000 году никому не мешает — только лог
        logger.warning(f"[test-connection] probe event cleanup failed for {calendar_id}: {e}")

    return {
        "ok": True,
        "calendar_id": calendar_id,
        "service_account": GCAL_SERVICE_ACCOUNT,
        "message": f"Подключение к {calendar_id} работает: CRM видит календарь и может добавлять события.",
    }


@router.post("/sync/calendar")
def sync_from_calendar(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    dry_run: bool = Query(False, description="Preview without saving"),
    auto_create_clients: bool = Query(True, description="Auto-create clients from unmatched events"),
    months_back: int = Query(24),
    months_forward: int = Query(3),
    past_days: int = Query(45, description="How many days back to pull events for add/update"),
):
    """
    Pull events from Google Calendar, match to CRM clients.
    If auto_create_clients=True, auto-creates new clients from unmatched event names.
    """
    from app.services.crm_calendar import sync_from_calendar as _sync, _extract_alias_code

    calendar_id = get_crm_calendar_id(current_user)
    if not calendar_id:
        raise HTTPException(400, "Google Календарь не подключён — укажите его в Настройках CRM")

    uid = str(current_user.id)
    clients = session.exec(
        select(TherapistClient).where(TherapistClient.specialist_id == uid)
    ).all()

    try:
        result = _sync(
            calendar_id=calendar_id,
            clients=clients,
            months_back=months_back,
            months_forward=months_forward,
            past_days=past_days,
        )
    except Exception as e:
        raise HTTPException(502, _gcal_error_to_message(e, calendar_id))

    # ── Auto-create clients from unmatched events ─────────────────────────
    auto_created_clients = 0
    if auto_create_clients and not dry_run and result["unmatched"]:
        existing_codes = {c.alias_code for c in clients if c.alias_code}
        name_to_client: dict = {}
        for c in clients:
            name_to_client[_normalize_name(c.name)] = c

        # Group unmatched events by clean name
        name_events: dict = {}
        for ev in result["unmatched"]:
            clean = _clean_client_name(ev["summary"])
            if not clean or len(clean) < 2:
                continue
            norm = _normalize_name(clean)
            if norm not in name_events:
                name_events[norm] = []
            name_events[norm].append(ev)

        # Create clients for each unique name
        new_clients_map: dict = {}  # normalized_name -> client_id
        for norm_name, events in name_events.items():
            if norm_name in name_to_client:
                new_clients_map[norm_name] = name_to_client[norm_name].id
                continue

            # Try to extract alias from event summaries
            alias = None
            for ev in events:
                alias = _extract_alias_code(ev["summary"])
                if alias:
                    break
            if not alias:
                alias = _generate_alias_code(existing_codes)
            existing_codes.add(alias)

            display_name = _clean_client_name(events[0]["summary"])
            new_client = TherapistClient(
                specialist_id=uid,
                name=display_name,
                alias_code=alias,
                pipeline_status="ACTIVE",
                tags=["google-calendar"],
            )
            session.add(new_client)
            session.flush()

            name_to_client[norm_name] = new_client
            new_clients_map[norm_name] = new_client.id
            auto_created_clients += 1

        # Move unmatched -> matched with auto-created client IDs
        still_unmatched = []
        for ev in result["unmatched"]:
            clean = _clean_client_name(ev["summary"])
            norm = _normalize_name(clean) if clean else ""
            if norm in new_clients_map:
                ev["client_id"] = new_clients_map[norm]
                result["matched"].append(ev)
            else:
                still_unmatched.append(ev)
        result["unmatched"] = still_unmatched

    # Этап 1 (27.08): дубли В КАЛЕНДАРЕ — два+ события одного клиента на одно
    # время. Это источник дублей сессий; показываем специалисту явно, чтобы он
    # удалил лишнее событие в Google (мы чужие ручные события не трогаем).
    _dup_groups: dict = {}
    for _e in result["matched"]:
        _k = (str(_e.get("client_id")), _e.get("date"))
        _dup_groups.setdefault(_k, []).append(_e)
    calendar_duplicates = [
        {
            "summary": _evs[0]["summary"],
            "date": _k[1].isoformat() if _k[1] else None,
            "count": len(_evs),
        }
        for _k, _evs in _dup_groups.items() if len(_evs) > 1
    ]
    calendar_duplicates.sort(key=lambda x: x["date"] or "")

    # ── Dry Run preview ───────────────────────────────────────────────────
    if dry_run:
        unique_names = set()
        for ev in result["unmatched"]:
            clean = _clean_client_name(ev["summary"])
            if clean and len(clean) >= 2:
                unique_names.add(_normalize_name(clean))
        return {
            "dry_run": True,
            "total_events": result["total"],
            "matched": len(result["matched"]),
            "unmatched": len(result["unmatched"]),
            "would_create_clients": len(unique_names),
            "calendar_duplicates": calendar_duplicates[:15],
            "calendar_duplicates_count": len(calendar_duplicates),
            "unmatched_summaries": [e["summary"] for e in result["unmatched"][:20]],
        }

    # ── Save sessions ─────────────────────────────────────────────────────
    created = 0
    updated = 0
    # Track every Google event id we saw in this sync window — used below to
    # detect "orphaned" CRM sessions whose GCal events disappeared (deleted
    # outright, or moved out of the window after a recurrence-rule change).
    # Includes unmatched and ambiguous events too — those still exist in GCal,
    # they just couldn't be linked to a client; don't cancel sessions for them.
    seen_gcal_ids: set[str] = set()
    for bucket in ("matched", "unmatched", "ambiguous"):
        for entry in result.get(bucket, []):
            gid = entry.get("google_event_id")
            if gid:
                seen_gcal_ids.add(gid)
    # 48h past-window guard — mirrors the orphan-cancel sweep below and the
    # GCal query window. Without this, deleting a recurring rule in Google
    # Calendar would retroactively delete every CRM session that ever
    # belonged to it, even ones that actually took place — exactly what
    # happened to client cffd5c45 (Анастасия Черепанова) on 2026-04-16.
    from datetime import timedelta as _td_cancel_guard
    _now = datetime.utcnow()
    # 2026-07-13 owner: «убрал из календаря → удали и прошедшее, но в рамках
    # недели; старше — удалю вручную». Окно удаления расширено 48ч → 7 дней.
    # Старше недели recurring-прошлое и брони по-прежнему защищены.
    _recent_guard = _now - _td_cancel_guard(days=7)
    _cancel_window_start = _now - _td_cancel_guard(days=max(7, past_days))
    deleted_on_cancel = 0
    # ── Защитный режим (31.08, решение владельца) ──────────────────────────
    # По умолчанию календарь НЕ управляет удалением: пока специалист сам не
    # включил «Google Calendar — источник правды» в настройках CRM, удаление
    # события в Google НЕ удаляет сессию и НЕ снимает бронь (автосинк каждые
    # 20 минут делал это без участия человека — слишком опасно). Вместо этого
    # копим список и шлём одно уведомление. Переносы применяются в обоих
    # режимах — они обратимы.
    gcal_master = bool((current_user.crm_data or {}).get("gcal_source_of_truth", False))
    deletions_held: list[str] = []
    for entry in result["matched"]:
        if entry.get("is_cancelled"):
            existing = session.exec(
                select(TherapySession).where(
                    TherapySession.google_event_id == entry["google_event_id"],
                    TherapySession.specialist_id == uid,
                )
            ).first()
            if existing:
                # Удаление в GCal распространяем в CRM, но историю бережём.
                # 1) Повторяющиеся события старше 48 ч НЕ удаляем — смена
                #    recurrence-rule (нед→2нед) помечает прошлые инстансы
                #    cancelled, а они реально состоялись (Анастасия
                #    Черепанова 2026-04-16).
                if entry.get("is_recurring") and existing.date < _recent_guard:
                    continue
                # 2) Старая (>48 ч) сессия с привязанной бронью — вероятно
                #    реально прошедшая (и, возможно, оплаченная). Чистка
                #    календаря не должна стирать финансовую историю.
                if existing.date < _recent_guard and existing.booking_id:
                    continue
                # 3) За пределами окна синка вообще не трогаем.
                if existing.date < _cancel_window_start:
                    continue
                # Защитный режим: удаление в Google НЕ трогает CRM.
                if not gcal_master:
                    deletions_held.append(existing.date.strftime("%d.%m %H:%M"))
                    continue
                # 2026-05-14: spec says cancellation in GCal = removal from
                # CRM (no CANCELLED_* status). Detach any linked cabinet
                # booking first so the slot frees up automatically — same
                # behaviour as the admin pressing "Отменить" in the sheet.
                _cancel_booking_behind_session(
                    session, existing, "Сессия отменена в Google Calendar"
                )
                _delete_session_safely(session, existing)
                deleted_on_cancel += 1
            continue

        existing = session.exec(
            select(TherapySession).where(
                TherapySession.google_event_id == entry["google_event_id"],
                TherapySession.specialist_id == uid,
            )
        ).first()
        if existing:
            if abs((existing.date - entry["date"]).total_seconds()) > 60:
                old_date = existing.date
                existing.date = entry["date"]
                existing.duration_minutes = entry["duration_minutes"]
                # Reset COMPLETED → PLANNED when session moves into the
                # future. Bug 2026-05-17 (Игорь Юрченко): user runs
                # auto-complete-past while session still has old past date,
                # then GCal reschedule moves it to a future date — status
                # would stay stuck on COMPLETED, looking like a passed
                # session in the new slot. A future-dated session simply
                # cannot be COMPLETED, by definition.
                if existing.status == "COMPLETED" and entry["date"] > datetime.utcnow():
                    existing.status = "PLANNED"
                existing.updated_at = datetime.now()
                session.add(existing)
                updated += 1

                # If this session is tied to a cabinet booking, try to move
                # the booking too (admin moved the GCal event → CRM and the
                # cabinet should follow). If the new slot conflicts with
                # another booking, fall back to a CRM notification with
                # alternative cabinets the specialist can rebook to.
                if existing.booking_id:
                    _try_move_linked_booking(
                        session, existing, old_date,
                        new_date=entry["date"],
                        new_duration=entry["duration_minutes"],
                        specialist_id=uid,
                    )
            continue

        # Same-day duplicate check — if there's already a session for this
        # client at this exact moment, don't insert a second one. Past
        # behaviour adopted the incoming GCal id onto a CANCELLED row, but
        # cancelled rows no longer exist (2026-05-14 spec change — sync
        # deletes on cancel instead of flipping status).
        existing_by_date = session.exec(
            select(TherapySession).where(
                TherapySession.client_id == entry["client_id"],
                TherapySession.specialist_id == uid,
                TherapySession.date == entry["date"],
            )
        ).first()
        if existing_by_date:
            # 05.09 (кейс Максима): отменённая в CRM сессия «застолбила» это
            # время и блокировала восстановление из календаря — специалист
            # заводил НОВОЕ событие в Google, а синк молча пропускал его.
            # Правило: событие с ДРУГИМ id на времени отменённой сессии =
            # явное намерение вернуть сессию → воскрешаем. Если id тот же,
            # что был у отменённой, — отмену уважаем (специалист отменил
            # сессию, а событие просто забыл удалить).
            if (
                existing_by_date.status in ("CANCELLED_CLIENT", "CANCELLED_THERAPIST")
                and entry["google_event_id"] != existing_by_date.google_event_id
            ):
                _gid_clash = session.exec(
                    select(TherapySession).where(
                        TherapySession.google_event_id == entry["google_event_id"]
                    )
                ).first()
                if _gid_clash is None:
                    existing_by_date.google_event_id = entry["google_event_id"]
                    existing_by_date.status = entry["status"]
                    existing_by_date.duration_minutes = entry["duration_minutes"]
                    existing_by_date.updated_at = datetime.now()
                    session.add(existing_by_date)
                    updated += 1
                    logging.getLogger(__name__).info(
                        "[crm-sync] воскресил отменённую сессию %s по новому "
                        "событию %s", existing_by_date.id, entry["google_event_id"],
                    )
            continue

        ts = TherapySession(
            client_id=entry["client_id"],
            specialist_id=uid,
            date=entry["date"],
            duration_minutes=entry["duration_minutes"],
            status=entry["status"],
            google_event_id=entry["google_event_id"],
        )
        session.add(ts)
        created += 1

    # ── Orphaned sessions: GCal event vanished ─────────────────────────────
    # Sessions with a google_event_id that did NOT come back from this sync
    # window mean the underlying calendar event was deleted (or moved out of
    # the window after a recurrence-rule change like "weekly → biweekly").
    # The desktop UX silently kept them as PLANNED, so admins saw ghost
    # sessions that no longer existed in GCal. Mark them cancelled.
    #
    # Scoping: we ONLY look at sessions whose date is inside the same window
    # we queried GCal for. A session outside the window may have been omitted
    # by Google simply because we didn't ask for it; we mustn't cancel those.
    # Window matches the service's GCal query (2026-05-12: hard 48h past
    # limit). Anything older is "historical" — never touched. months_back is
    # accepted but ignored, for backwards compat with old callers.
    from datetime import timedelta as _td
    now_utc = datetime.utcnow()
    # 2026-07-13 owner: удаляем «осиротевшие» (исчезнувшие из календаря) сессии
    # в пределах недели, включая прошедшие. Старше недели — не трогаем.
    win_start = now_utc - _td(days=7)
    win_end = now_utc + _td(days=months_forward * 30)

    orphan_q = select(TherapySession).where(
        TherapySession.specialist_id == uid,
        TherapySession.google_event_id.is_not(None),  # type: ignore
        TherapySession.date >= win_start,
        TherapySession.date <= win_end,
    )
    orphans_in_window = session.exec(orphan_q).all()
    orphans_cancelled = 0

    # Kill-switch: an empty `seen_gcal_ids` means Google listed NO events at all.
    # In practice that is never "the specialist deleted their whole week" — it is
    # a lost service-account grant, a changed calendar_id, or an API hiccup, all
    # of which return 200 with an empty list. Sweeping on that signal would wipe
    # every session in the window and cancel every cabinet booking behind them.
    # Do nothing and say so loudly.
    if orphans_in_window and not seen_gcal_ids:
        logging.getLogger(__name__).error(
            "[crm-sync] ABORTING orphan sweep for specialist %s: Google returned 0 events "
            "while %d sessions exist in the window. Refusing to delete them — check the "
            "service-account access and calendar_id.",
            uid, len(orphans_in_window),
        )
        orphans_in_window = []

    for ts in orphans_in_window:
        if ts.google_event_id in seen_gcal_ids:
            continue
        # Защитный режим: исчезнувшее из календаря событие НЕ удаляет сессию.
        if not gcal_master:
            deletions_held.append(ts.date.strftime("%d.%m %H:%M"))
            continue
        # Same "GCal-cancel = delete" rule applies to orphan rows whose
        # GCal event vanished from the sync window. Refunds the client and
        # clears the cabinet's own GCal event — see _cancel_booking_behind_session.
        _cancel_booking_behind_session(session, ts, "Сессия удалена из Google Calendar")
        _delete_session_safely(session, ts)
        orphans_cancelled += 1

    # Одно уведомление о задержанных удалениях. Автосинк ходит каждые 20 минут
    # и будет находить те же удалённые события снова — дедуп по типу за сутки,
    # чтобы не заспамить колокольчик.
    if deletions_held and not dry_run:
        from app.models.notification import Notification as _HeldNotif
        _day_ago = datetime.now() - _td(hours=24)
        _already = session.exec(
            select(_HeldNotif).where(
                _HeldNotif.recipient_id == uid,
                _HeldNotif.type == "calendar_deletions_held",
                _HeldNotif.created_at >= _day_ago,
            )
        ).first()
        if not _already:
            _sample = ", ".join(sorted(set(deletions_held))[:8])
            _more = len(set(deletions_held)) - 8
            session.add(_HeldNotif(
                recipient_id=uid,
                type="calendar_deletions_held",
                title=f"Календарь: удалено событий — {len(set(deletions_held))}, сессии сохранены",
                description=(
                    f"В Google удалены события: {_sample}"
                    + (f" и ещё {_more}" if _more > 0 else "")
                    + ". Сессии и брони в CRM не тронуты (защитный режим). "
                    "Отмените их вручную, если они действительно не состоятся, "
                    "или включите «Google Calendar — источник правды» в Настройках."
                ),
                icon="calendar-x",
                link="/crm/sessions",
            ))

    if orphans_cancelled > 0 or deleted_on_cancel > 0:
        logging.getLogger(__name__).info(
            "[crm-sync] hard-deleted %d (cancel-matched) + %d (orphan) sessions "
            "(window %s → %s, seen %d gcal ids)",
            deleted_on_cancel, orphans_cancelled, win_start.isoformat(),
            win_end.isoformat(), len(seen_gcal_ids),
        )

    session.commit()

    # ── Backfill alias codes into Google Calendar summaries ──────────────
    # For every matched event that doesn't yet carry a `#XXXX` code AND has
    # a single, confident client match — patch the event summary in place.
    # Next time the calendar is synced, the alias path matches instantly,
    # so a client rename or a new namesake no longer breaks anything.
    # Recurring events are skipped to avoid altering a whole series from one
    # instance.
    codes_backfilled = 0
    backfill_errors = 0
    if not dry_run:
        from app.services.crm_calendar import patch_event_summary
        _log = logging.getLogger(__name__)
        for entry in result["matched"]:
            if entry.get("has_alias_code"):
                continue
            if entry.get("is_recurring"):
                continue
            # Google rejects PATCH on cancelled/declined events — and even if
            # it didn't, rewriting the summary of a cancelled slot is
            # meaningless noise. Skip.
            if entry.get("is_cancelled"):
                continue
            new_summary = entry.get("suggested_summary")
            if not new_summary:
                continue
            try:
                patch_event_summary(calendar_id, entry["google_event_id"], new_summary)
                codes_backfilled += 1
            except Exception as e:
                _log.warning(
                    f"[GCal backfill] failed to patch {entry['google_event_id']}: {e}"
                )
                backfill_errors += 1

    # calendar_duplicates посчитан ВЫШЕ, до dry-run ветки — 05.09 предпросмотр
    # синка падал UnboundLocalError, потому что поля дублей добавили в
    # dry-run ответ (Этап 1), а сама переменная считалась только здесь.

    return {
        "total_events": result["total"],
        "matched": len(result["matched"]),
        "unmatched": len(result["unmatched"]),
        "ambiguous": len(result.get("ambiguous", [])),
        "created": created,
        # `updated` is the running total: status flips for cancelled-in-GCal,
        # date moves on existing rows, AND the orphan-cancel sweep below.
        # Frontend just shows "Обновлено: N" and we want orphans to be in there
        # so admins notice when a ghost session is purged.
        "updated": updated + orphans_cancelled,
        "orphans_cancelled": orphans_cancelled,
        # Защитный режим: сколько удалений из Google задержано (сессии целы).
        "deletions_held": len(set(deletions_held)),
        "auto_created_clients": auto_created_clients,
        "codes_backfilled": codes_backfilled,
        "backfill_errors": backfill_errors,
        "unmatched_summaries": [e["summary"] for e in result["unmatched"][:20]],
        "ambiguous_summaries": [
            {
                "summary": e["summary"],
                "date": e["date"].isoformat() if e.get("date") else None,
                "candidates": e.get("ambiguous_candidates", []),
            }
            for e in result.get("ambiguous", [])[:20]
        ],
    }


@router.post("/sync/backfill-alias-codes")
def backfill_alias_codes(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    months_back: int = Query(24, description="How far back to walk the calendar"),
    months_forward: int = Query(3),
    dry_run: bool = Query(False, description="Preview what would be patched without touching Calendar"),
):
    """
    One-shot housekeeping: walk the calendar, and for every event whose
    summary maps unambiguously to a CRM client, rewrite the summary to
    "Name #alias_code" so future syncs never have to guess. Leaves ambiguous
    and unmatched events alone — the report lists them for manual review.
    """
    from app.services.crm_calendar import sync_from_calendar as _sync, patch_event_summary

    calendar_id = get_crm_calendar_id(current_user)
    if not calendar_id:
        raise HTTPException(400, "Google Календарь не подключён — укажите его в Настройках CRM")

    uid = str(current_user.id)
    clients = session.exec(
        select(TherapistClient).where(TherapistClient.specialist_id == uid)
    ).all()

    try:
        result = _sync(
            calendar_id=calendar_id,
            clients=clients,
            months_back=months_back,
            months_forward=months_forward,
        )
    except Exception as e:
        raise HTTPException(502, _gcal_error_to_message(e, calendar_id))

    would_patch = []
    already_coded = 0
    recurring_skipped = 0

    cancelled_skipped = 0
    for entry in result["matched"]:
        if entry.get("has_alias_code"):
            already_coded += 1
            continue
        if entry.get("is_recurring"):
            recurring_skipped += 1
            continue
        if entry.get("is_cancelled"):
            cancelled_skipped += 1
            continue
        if not entry.get("suggested_summary"):
            continue
        would_patch.append({
            "event_id": entry["google_event_id"],
            "date": entry["date"].isoformat() if entry.get("date") else None,
            "from": entry["summary"],
            "to": entry["suggested_summary"],
        })

    patched = 0
    failed = []
    if not dry_run:
        _log = logging.getLogger(__name__)
        for item in would_patch:
            try:
                patch_event_summary(calendar_id, item["event_id"], item["to"])
                patched += 1
            except Exception as e:
                _log.warning(f"[backfill] {item['event_id']}: {e}")
                failed.append({**item, "error": str(e)})

    return {
        "dry_run": dry_run,
        "total_events": result["total"],
        "already_had_codes": already_coded,
        "recurring_skipped": recurring_skipped,
        "cancelled_skipped": cancelled_skipped,
        "would_patch": len(would_patch),
        "patched": patched,
        "failed": len(failed),
        "sample_to_patch": would_patch[:20],
        "failures": failed[:20],
        "ambiguous_count": len(result.get("ambiguous", [])),
        "ambiguous_sample": [
            {
                "summary": e["summary"],
                "date": e["date"].isoformat() if e.get("date") else None,
                "candidates": e.get("ambiguous_candidates", []),
            }
            for e in result.get("ambiguous", [])[:20]
        ],
        "unmatched_count": len(result["unmatched"]),
        "unmatched_sample": [e["summary"] for e in result["unmatched"][:20]],
    }


@router.post("/clients/{client_id}/sync-history")
def sync_client_history(
    client_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    years_back: int = Query(5),
    months_back: int = Query(None, description="Override: months back from now"),
    months_forward: int = Query(3, description="Months forward from now"),
):
    """Import session history for a specific client from Google Calendar."""
    from app.services.crm_calendar import sync_client_history as _sync_client

    client = session.get(TherapistClient, client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Клиент не найден — возможно, его удалили или склеили с другим")
    if not client.alias_code:
        raise HTTPException(400, "У клиента нет метки #код — без неё календарь не найдёт его события")

    calendar_id = get_crm_calendar_id(current_user)
    if not calendar_id:
        raise HTTPException(400, "Google Календарь не подключён — укажите его в Настройках CRM")

    # Convert months_back to years_back if provided
    effective_years_back = years_back
    if months_back is not None:
        effective_years_back = max(1, months_back) / 12.0  # fractional years

    try:
        sessions_data = _sync_client(
            calendar_id=calendar_id,
            client_id=client_id,
            alias_code=client.alias_code or "",
            years_back=effective_years_back,
            months_forward=months_forward,
            extra_alias_codes=getattr(client, 'merged_alias_codes', None) or [],
            client_name=client.name,
        )
    except Exception as e:
        raise HTTPException(502, _gcal_error_to_message(e, calendar_id))

    uid = str(current_user.id)
    created = 0
    for entry in sessions_data:
        # Check by google_event_id
        existing = session.exec(
            select(TherapySession).where(
                TherapySession.google_event_id == entry["google_event_id"],
                TherapySession.specialist_id == uid,
            )
        ).first()
        if existing:
            continue
        # Also check by client_id + date to prevent duplicates from name matching
        existing_by_date = session.exec(
            select(TherapySession).where(
                TherapySession.client_id == entry["client_id"],
                TherapySession.specialist_id == uid,
                TherapySession.date == entry["date"],
            )
        ).first()
        if existing_by_date:
            continue
        ts = TherapySession(**entry, specialist_id=uid)
        session.add(ts)
        created += 1

    session.commit()
    return {"total_found": len(sessions_data), "created": created}


@router.post("/sync/auto")
def auto_sync_all_calendars(
    secret: Optional[str] = Query(None),
    session: Session = Depends(deps.get_session),
):
    """Этап 3 календарного плана (28.08): автосинк по крону — без кнопки.

    Гейт тем же секретом, что и денежный крон (TELEGRAM_REMINDER_SECRET,
    паттерн billing/charge-due). Пробегает всех специалистов с подключённым
    личным календарём (сейчас 1, задел на раскатку) и прогоняет для каждого
    ШТАТНЫЙ sync_from_calendar — роут-функция вызывается напрямую, Depends
    в сигнатуре — просто дефолты. Ошибки одного специалиста не роняют
    остальных.
    """
    from app.core.config import settings as _settings

    expected = getattr(_settings, "TELEGRAM_REMINDER_SECRET", None)
    if not expected:
        raise HTTPException(status_code=503, detail="Cron secret not configured")
    if secret != expected:
        raise HTTPException(status_code=401, detail="Invalid secret")

    # Не только role=specialist: владелец (owner) тоже ведёт Psy-CRM со своим
    # календарём — фильтр по роли пропускал его (смок 28.08: synced=0).
    # Критерий один: подключён личный календарь и профиль не в архиве.
    specialists = session.exec(
        select(User).where(User.archived_at.is_(None))  # type: ignore
    ).all()
    results, errors = [], []
    for u in specialists:
        if not get_crm_calendar_id(u):
            continue
        try:
            r = sync_from_calendar(
                session=session,
                current_user=u,
                dry_run=False,
                auto_create_clients=True,
                months_back=0,
                months_forward=3,
                past_days=45,
            )
            results.append({
                "specialist": u.email,
                "created": r.get("created"),
                "updated": r.get("updated"),
                "deleted": r.get("deleted"),
                "duplicates": len(r.get("calendar_duplicates") or []),
            })
        except Exception as e:  # noqa: BLE001 — один упал, остальные синкаются
            logger.warning("[auto-sync] %s failed: %r", u.email, e)
            errors.append({"specialist": u.email, "error": str(e)})
    return {"ok": True, "synced": len(results), "results": results, "errors": errors}
