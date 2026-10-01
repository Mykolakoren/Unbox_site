"""CRM Sessions — therapy session CRUD + quick-pay."""
import logging
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Body
from sqlmodel import Session, select
from app.api import deps

logger = logging.getLogger(__name__)
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapy_session import (
    TherapySession, TherapySessionCreate, TherapySessionRead, TherapySessionUpdate,
    TherapySessionUpdateResult,
)
from app.models.therapist_payment import TherapistPayment
from app.services.finance_bridge import push_payment, retract_payment
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
        raise HTTPException(404, "Клиент не найден — возможно, его удалили или склеили с другим")

    # Frontend sends Tbilisi wall-clock as a naive ISO string (e.g.
    # "2026-05-22T11:00:00" = 11:00 Tbilisi). The DB convention is
    # UTC-naive (matches what GCal sync produces). Subtract 4h here so
    # every TherapySession.date row carries the same meaning, and
    # parseUTC + formatBatumi on the frontend renders correctly.
    create_data = data.model_dump(exclude={"push_to_calendar", "force"})
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
            res = None
            try:
                from app.services.crm_calendar import create_or_link_event
                # Use the already-normalised UTC-naive date (matches the
                # row we'll store) — _dt_to_rfc3339 will append "Z" and
                # GCal will render in the calendar's TZ correctly.
                # Этап 1 (27.08): пуш С ПОИСКОМ — если событие клиента на это
                # время уже стоит в календаре (поставлено руками), привязываемся
                # к нему; «почти совпало» → сигнал, второе не создаём.
                res = create_or_link_event(
                    calendar_id=calendar_id,
                    client_name=client.name,
                    alias_code=client.alias_code,
                    session_date=therapy_session.date,
                    duration_minutes=data.duration_minutes,
                    # Ревизия приватности 29.08: заметка сессии НЕ уходит в
                    # описание события Google. Ни один UI-путь не передаёт
                    # notes вместе с push_to_calendar, а держать лазейку на
                    # уровне API опасно: заметки терапевта шифруются в базе
                    # и не должны оказаться открытым текстом у Google.
                    notes=None,
                    session_id=str(therapy_session.id),
                )
                if res["action"] == "conflict" and data.force:
                    # Специалист подтвердил «всё равно создать»: это отдельная
                    # встреча, а не дубль — ставим своё событие рядом.
                    from app.services.crm_calendar import create_calendar_event
                    res = {
                        "event_id": create_calendar_event(
                            calendar_id, client.name, client.alias_code,
                            therapy_session.date, data.duration_minutes,
                            None, session_id=str(therapy_session.id),
                        ),
                        "action": "created",
                    }
            except Exception as e:
                res = None
                logger.warning(f"GCal push failed: {e}", exc_info=True)
                # Раньше провал записи был тихим: сессия создавалась, события
                # нет, специалист не узнавал (типично — доступ «только просмотр»).
                from app.models.notification import Notification as _Notif
                session.add(_Notif(
                    type="calendar_push_failed",
                    title="Сессия не попала в Google Календарь",
                    description=(
                        "Сессия сохранена в CRM, но событие в календаре не создано. "
                        "Чаще всего у CRM доступ к календарю только на просмотр — "
                        "проверьте в Настройках CRM кнопкой «Проверить подключение»."
                    ),
                    recipient_id=str(current_user.id),
                    icon="AlertTriangle",
                    link="/crm/settings",
                ))

            if res and res["action"] == "conflict":
                # 01.10: раньше здесь молча появлялась сессия БЕЗ события —
                # «вторая встреча» клиента, которую синк потом не мог ни
                # обновить, ни удалить. Теперь спрашиваем специалиста: фронт
                # предложит «Перенести существующую» или «Всё равно создать»
                # (повтор запроса с force=true). Ничего не сохраняем.
                logger.warning(f"[create_session] GCal near-conflict → 409: {res}")
                _existing_sid = None
                if res.get("conflict_event_id"):
                    _existing_sid = session.exec(
                        select(TherapySession.id).where(
                            TherapySession.google_event_id == res["conflict_event_id"],
                            TherapySession.specialist_id == str(current_user.id),
                        )
                    ).first()
                _when = "—"
                _when_iso = None
                try:
                    if res.get("conflict_start"):
                        _cs = datetime.fromisoformat(res["conflict_start"]) + timedelta(hours=4)
                        _when = _cs.strftime("%d.%m в %H:%M")
                        _when_iso = _cs.strftime("%Y-%m-%dT%H:%M:%S")
                except ValueError:
                    pass
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "calendar_near",
                        "message": (
                            f"У клиента уже есть встреча в календаре {_when} "
                            f"(«{res.get('summary') or client.name}»). Перенесите её "
                            f"или подтвердите, что это отдельная встреча."
                        ),
                        "conflict_start": _when_iso,
                        "event_summary": res.get("summary"),
                        "existing_session_id": _existing_sid,
                    },
                )

            if res and res.get("event_id"):
                gid = res["event_id"]
                # google_event_id уникален — не привязываем событие, у
                # которого уже есть сессия (это был бы дубль сессий).
                clash = session.exec(
                    select(TherapySession).where(TherapySession.google_event_id == gid)
                ).first()
                if clash is None:
                    therapy_session.google_event_id = gid
                logger.info(f"[create_session] GCal {res['action']}: {gid}")
        else:
            logger.warning(f"[create_session] push_to_calendar=True but calendar_id missing for user {current_user.id}")

    session.add(therapy_session)
    session.commit()
    session.refresh(therapy_session)
    return therapy_session


@router.patch("/sessions/{session_id}", response_model=TherapySessionUpdateResult)
def update_session(
    session_id: str,
    data: TherapySessionUpdate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    ts = session.get(TherapySession, session_id)
    if not ts or ts.specialist_id != str(current_user.id):
        raise HTTPException(404, "Сессия не найдена — возможно, её удалили")

    update_data = data.model_dump(exclude_unset=True)
    # Same Tbilisi-naive → UTC-naive normalisation as create_session.
    if "date" in update_data and update_data["date"] is not None:
        from app.services.crm_calendar import tbilisi_naive_to_utc_naive
        update_data["date"] = tbilisi_naive_to_utc_naive(update_data["date"])

    # 02.09: переподвязка клиента — client_id менять можно, но только на
    # СВОЕГО клиента (изоляция Psy-CRM). Без этой проверки setattr ниже
    # принял бы id чужого клиента.
    if update_data.get("client_id"):
        _new_cl = session.get(TherapistClient, update_data["client_id"])
        if not _new_cl or _new_cl.specialist_id != str(current_user.id):
            raise HTTPException(404, "Клиент не найден")

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

    # 29.08 (ревизия денег): снятие «Оплачено» через форму редактирования шло
    # мимо unmark-paid — флаг падал, а запись оплаты оставалась жить сиротой.
    # Сирота ломала повторную оплату (500 на unique-констрейнте) и завышала
    # доход. Теперь PATCH с is_paid=False ведёт себя как unmark-paid: платежи
    # сессии удаляются вместе со снятием флага.
    if update_data.get("is_paid") is False and ts.is_paid:
        _orphans = session.exec(
            select(TherapistPayment).where(
                TherapistPayment.session_id == session_id,
                TherapistPayment.specialist_id == str(current_user.id),
            )
        ).all()
        for _p in _orphans:
            session.delete(_p)
        if _orphans:
            logger.info(
                "[update_session] is_paid→False: удалено платежей по сессии %s: %d",
                session_id, len(_orphans),
            )

    _old_date = ts.date
    _old_duration = ts.duration_minutes or 60
    _old_client_id = ts.client_id
    for key, value in update_data.items():
        setattr(ts, key, value)
    ts.updated_at = datetime.now()
    calendar_warning: Optional[str] = None

    # Этап 2 календарного плана (27.08): перенос/смена длительности сессии из
    # CRM двигает ТО ЖЕ событие в личном календаре (по ключу google_event_id).
    # Раньше двигалась только бронь кабинета, а событие в Google оставалось на
    # старом времени — расхождение, которое следующий синк «побеждал» обратно.
    _cal_keys = (
        "date" in update_data or "duration_minutes" in update_data
        # 02.09: смена клиента должна переименовать событие в Google —
        # иначе в календаре остаётся имя прежнего клиента.
        or "client_id" in update_data
    )
    _cal_id = get_crm_calendar_id(current_user) if _cal_keys else None
    if ts.google_event_id and _cal_id:
        try:
            from app.services.crm_calendar import update_calendar_event
            _cl = session.get(TherapistClient, ts.client_id)
            update_calendar_event(
                calendar_id=_cal_id,
                event_id=ts.google_event_id,
                client_name=_cl.name if _cl else "Сессия",
                alias_code=_cl.alias_code if _cl else None,
                session_date=ts.date,
                duration_minutes=ts.duration_minutes or 60,
                # notes не передаём — описание события в Google не трогаем
            )
            logger.info(f"[update_session] GCal event moved: {ts.google_event_id}")
        except Exception as e:
            # 01.10: ошибку больше не глотаем молча — иначе автосинк через
            # ≤20 мин увидит событие на старом времени и откатит перенос.
            logger.warning(f"[update_session] GCal move failed: {e}")
            calendar_warning = (
                "Сессия перенесена, но событие в Google Календаре не сдвинулось. "
                "Перенесите его вручную — иначе синхронизация вернёт старое время."
            )

    session.add(ts)
    session.commit()
    session.refresh(ts)

    # 01.10: у сессии НЕТ события в календаре (создана без пуша, из шахматки,
    # с сайта) — при переносе ищем её событие на СТАРОМ времени и двигаем его;
    # не нашли — создаём на новом. Раньше событие оставалось на старом месте,
    # и синк делал из него вторую сессию.
    _changed = (
        ts.date != _old_date
        or (ts.duration_minutes or 60) != _old_duration
        or ts.client_id != _old_client_id
    )
    if (
        not ts.google_event_id and _cal_id and _changed
        and ts.status not in ("CANCELLED_CLIENT", "CANCELLED_THERAPIST")
    ):
        try:
            from app.services.crm_calendar import move_or_attach_event
            _cl = session.get(TherapistClient, ts.client_id)
            _old_cl = (
                session.get(TherapistClient, _old_client_id)
                if _old_client_id != ts.client_id else _cl
            )
            _sid = ts.id

            def _taken(gid: str) -> bool:
                other = session.exec(
                    select(TherapySession.id).where(TherapySession.google_event_id == gid)
                ).first()
                return other is not None and other != _sid

            res = move_or_attach_event(
                _cal_id,
                event_id=None,
                client_name=_cl.name if _cl else "Сессия",
                alias_code=_cl.alias_code if _cl else None,
                new_date=ts.date,
                new_duration=ts.duration_minutes or 60,
                old_date=_old_date,
                old_duration=_old_duration,
                find_name=_old_cl.name if _old_cl else None,
                find_alias=_old_cl.alias_code if _old_cl else None,
                is_taken=_taken,
                session_id=str(ts.id),
                booking_id=ts.booking_id,
            )
            if res.get("action") == "conflict":
                calendar_warning = (
                    f"Сессия перенесена, но рядом в календаре уже стоит событие "
                    f"«{res.get('summary')}» — второе не создано. Проверьте Google Календарь."
                )
            elif res.get("event_id") and not _taken(res["event_id"]):
                ts.google_event_id = res["event_id"]
                session.add(ts)
                session.commit()
                session.refresh(ts)
            logger.info(f"[update_session] GCal {res.get('action')}: {res.get('event_id')}")
        except Exception as e:
            logger.warning(f"[update_session] GCal attach/move failed: {e}")
            session.rollback()
            session.refresh(ts)
            calendar_warning = (
                "Сессия перенесена, но в Google Календаре её событие не обновилось. "
                "Перенесите его вручную — иначе синхронизация может создать дубль."
            )

    out = TherapySessionUpdateResult.model_validate(ts)
    out.calendar_warning = calendar_warning
    return out


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
        raise HTTPException(404, "Сессия не найдена — возможно, её удалили")

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
        raise HTTPException(404, "Сессия не найдена — возможно, её удалили")

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
        raise HTTPException(404, "Бронь не найдена")

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
    background_tasks: BackgroundTasks,
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
        raise HTTPException(404, "Сессия не найдена — возможно, её удалили")
    if not ts.booking_id:
        raise HTTPException(400, "К этой сессии не привязана бронь кабинета")

    detached_booking_id = ts.booking_id
    booking_cancelled = False

    if cancel_booking:
        # Defer to the existing cancel flow so we get the same refund +
        # GCal cleanup + waitlist-notify behaviour. Import lazily to dodge
        # the circular import (bookings/routes.py imports CRM stuff too).
        from app.api.v1.bookings.routes import cancel_booking as _cancel_booking_fn
        try:
            # background_tasks обязателен у cancel_booking (с 13.07 через него
            # удаляется событие GCal). Без него вызов падал TypeError → 500:
            # «Отменить бронь кабинета» из CRM не срабатывала никогда.
            _cancel_booking_fn(
                booking_id=detached_booking_id,
                background_tasks=background_tasks,
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
        raise HTTPException(404, "Сессия не найдена — возможно, её удалили")
    if ts.is_paid:
        raise HTTPException(400, "Сессия уже отмечена оплаченной")

    # 29.08: у сессии может быть живая запись оплаты при is_paid=False —
    # легаси-рассинхрон (например, старый unmark-paid удалял только первый
    # платёж). Раньше повторный «Оплатить» падал 500 на unique-констрейнте
    # uq_therapist_payment_session. Теперь идемпотентно: оплата уже есть →
    # чиним только флаг и цену, второй платёж НЕ создаём.
    existing_payment = session.exec(
        select(TherapistPayment).where(
            TherapistPayment.session_id == session_id,
            TherapistPayment.specialist_id == str(current_user.id),
        )
    ).first()
    if existing_payment:
        # Частичная оплата (возможна только через POST /crm/payments, который
        # копит сумму в той же записи) этой кнопкой не закрывается — иначе
        # недоплата молча выпала бы из долга клиента.
        if ts.price is not None and float(existing_payment.amount or 0) + 0.01 < float(ts.price):
            raise HTTPException(
                409,
                f"По сессии уже внесено {existing_payment.amount} "
                f"{existing_payment.currency} из {ts.price} — доплату проведите через «Финансы»",
            )
        logger.warning(
            "[quick-pay] reconcile: у сессии %s был живой платёж при is_paid=False "
            "(рассинхрон) — чиню флаг, второй платёж не создаю", session_id,
        )
        ts.is_paid = True
        if ts.price is None:
            ts.price = existing_payment.amount
        if not ts.currency:
            ts.currency = existing_payment.currency
        if not ts.account:
            ts.account = existing_payment.account
        ts.updated_at = datetime.now()
        session.add(ts)
        session.commit()
        return {
            "ok": True,
            "amount": existing_payment.amount,
            "currency": existing_payment.currency,
            "account": existing_payment.account,
            "reconciled": True,
        }

    client = session.get(TherapistClient, ts.client_id)
    if not client:
        raise HTTPException(404, "Клиент не найден — возможно, его удалили или склеили с другим")

    price = ts.price if ts.price is not None else client.base_price or 0
    account = payload.get("account") or client.default_account

    # Update session price if it was NULL (use client's current base_price)
    if ts.price is None and client.base_price:
        ts.price = client.base_price
        price = client.base_price

    # Freeze currency & account on the session at payment time.
    # 09.09: если валюта/счёт УЖЕ проставлены на сессии (заморозка истории
    # или ручная правка) — они главнее текущих значений клиента: сессия в
    # USDT не должна оплатиться в гривнах после смены валюты клиента.
    ts.currency = ts.currency or client.currency
    ts.account = ts.account or account

    # Create payment record only if amount > 0
    if price and price > 0:
        payment = TherapistPayment(
            client_id=client.id,
            specialist_id=str(current_user.id),
            amount=price,
            currency=ts.currency or client.currency,
            account=ts.account or account,
            date=datetime.now(),  # payment date = today, not session date
            session_id=ts.id,
        )
        session.add(payment)

    ts.is_paid = True
    ts.updated_at = datetime.now()
    session.add(ts)

    session.commit()
    if price and price > 0:
        session.refresh(payment)
        push_payment(payment, client.name)
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
        raise HTTPException(404, "Сессия не найдена — возможно, её удалили")
    if not ts.is_paid:
        raise HTTPException(400, "Сессия ещё не оплачена")

    ts.is_paid = False
    ts.updated_at = datetime.now()
    session.add(ts)

    # Убираем ВСЕ платежи по сессии, а не первый попавшийся. Раньше здесь
    # стоял .first(): если по сессии почему-то оказалось два платежа (старая
    # гонка при двойном нажатии «Оплачено» или частичные оплаты), лишние
    # оставались навсегда и завышали доход.
    removed_ids = []
    for payment in session.exec(
        select(TherapistPayment).where(
            TherapistPayment.session_id == session_id,
            TherapistPayment.specialist_id == str(current_user.id),
        )
    ).all():
        removed_ids.append(payment.id)
        session.delete(payment)

    session.commit()
    # Снятая оплата уходит и из семейной книги — иначе доход там остаётся
    # от платежа, которого больше нет.
    for payment_id in removed_ids:
        retract_payment(payment_id, str(current_user.id))
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
        raise HTTPException(404, "Клиент не найден — возможно, его удалили или склеили с другим")

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
    created_payments = []
    for ts in unpaid:
        price = ts.price if ts.price is not None else client.base_price or 0
        # Fill session price from client base_price if NULL
        if ts.price is None and client.base_price:
            ts.price = client.base_price
            price = client.base_price
        # Freeze currency & account on the session at payment time.
        # 09.09: проставленные на сессии значения главнее клиентских (см. quick-pay).
        ts.currency = ts.currency or client.currency
        ts.account = ts.account or client.default_account
        # Create payment only if amount > 0
        if price and price > 0:
            payment = TherapistPayment(
                client_id=client.id,
                specialist_id=uid,
                amount=price,
                currency=ts.currency or client.currency,
                account=ts.account or client.default_account,
                # Дата платежа = ДЕНЬ ОПЛАТЫ (как в quick_pay_session), а НЕ дата
                # сессии. Иначе оплата старого долга задним числом меняла кассу
                # прошлого месяца, а «касса за месяц» переставала быть кэш-флоу.
                # «Заработано» считается по дате сессии и от этого не зависит.
                date=datetime.now(),
                session_id=ts.id,
            )
            session.add(payment)
            created_payments.append(payment)
        ts.is_paid = True
        ts.updated_at = datetime.now()
        session.add(ts)
        count += 1

    if count > 0:
        session.commit()
        # После commit: у платежей уже есть id, и падение моста не тронет CRM.
        for payment in created_payments:
            push_payment(payment, client.name)
    return {"ok": True, "marked": count}
