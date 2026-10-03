"""Bookings — all booking endpoints: list, create, cancel, reschedule, re-rent, link-client."""
import contextlib
import copy
import logging
from typing import Any, List, Optional
from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request
from app.core.rate_limit import limiter
from sqlalchemy import or_
from sqlmodel import select, Session
from pydantic import BaseModel as PydanticBaseModel
from app.api import deps
from app.models.booking import Booking, BookingCreate, BookingRead, BookingPublicRead
from app.models.user import User
from app.services.google_calendar import gcal_service
from app.services.timeline import timeline_service
from app.services import subscription_pool
from app.services import wallet
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


def _sync_linked_session_to_booking(
    db_session: Session,
    booking: Booking,
    old_booking_duration: Optional[int] = None,
) -> Optional[dict]:
    """Helper for booking↔session autosync (owner 2026-05-27).

    If `booking` has a CRM session attached via `session.booking_id`, move
    the session's `date` to match the booking's new wall-clock time so the
    two never drift apart after a reschedule. No commit — the caller batches
    the write. Best-effort: a failure here must not break the user-visible
    booking move, so we log and swallow exceptions.

    01.10: длительность тоже переносится (если сессия совпадала с прежней
    длительностью брони), а событие в личном календаре специалиста двигает
    вызывающий ПОСЛЕ commit — через _push_session_moves_to_gcal(...) по
    возвращённому описанию переноса. Раньше событие оставалось на старом
    времени, и автосинк через ≤20 мин откатывал сессию и бронь назад
    (или, у сессии без id, рождал дубль).

    Возвращает {"session_id", "old_date", "old_duration"} при переносе, иначе None.
    """
    try:
        from app.models.therapy_session import TherapySession as _TS
        from app.services.crm_calendar import tbilisi_naive_to_utc_naive as _t2u
        # booking_id — varchar-колонка, booking.id — UUID. Без str() Postgres
        # падает (varchar = uuid), ошибка аварийно закрывает транзакцию, и
        # следующий commit в reschedule рискует уронить перенос в 500. Плюс из-за
        # этого автосинк CRM-сессии не работал ни разу.
        linked = db_session.exec(
            select(_TS).where(_TS.booking_id == str(booking.id))
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
        old_date = linked.date
        old_duration = linked.duration_minutes or 60
        new_duration = old_duration
        if (
            old_booking_duration
            and booking.duration
            and booking.duration != old_booking_duration
            and old_duration == old_booking_duration
        ):
            new_duration = int(booking.duration)
        if linked.date != new_utc or new_duration != old_duration:
            logger.info(
                "[autosync] booking %s → session %s moved %s → %s (%s → %s мин)",
                booking.id, linked.id, linked.date, new_utc, old_duration, new_duration,
            )
            linked.date = new_utc
            linked.duration_minutes = new_duration
            linked.is_booked = True
            linked.updated_at = datetime.now()
            db_session.add(linked)
            return {
                "session_id": str(linked.id),
                "old_date": old_date,
                "old_duration": old_duration,
            }
        return None
    except Exception:
        logger.exception("[autosync] failed to sync session for booking %s", booking.id)
        # Сбрасываем возможно-сломанную транзакцию, чтобы следующий commit
        # переноса не упал вслед за нашей ошибкой (перенос уже закоммичен выше).
        try:
            db_session.rollback()
        except Exception:
            logger.exception("[autosync] rollback after sync failure also failed")
        return None


def _push_session_moves_to_gcal(db_session: Session, moves: list) -> None:
    """Двигает события личного календаря специалиста вслед за перенесёнными
    сессиями (01.10). Зовётся ПОСЛЕ commit переноса брони.

    • у сессии есть google_event_id → patch события;
    • id нет → ищем событие клиента на СТАРОМ времени (минута в минуту),
      привязываем (если оно ничьё) и двигаем; не нашли → create_or_link_event
      на новом времени.
    Best-effort: ошибка Google не ломает перенос брони — логируем и шлём
    специалисту уведомление, иначе автосинк молча вернёт старое время.
    """
    if not moves:
        return
    from app.models.therapy_session import TherapySession as _TS
    from app.models.therapist_client import TherapistClient as _TC
    from app.models.notification import Notification as _Notif
    from app.api.v1.crm import get_crm_calendar_id as _get_cal
    from app.services.crm_calendar import move_or_attach_event as _move_ev

    for mv in moves:
        if not mv:
            continue
        ts = None
        try:
            ts = db_session.get(_TS, mv["session_id"])
            if not ts or ts.status in ("CANCELLED_CLIENT", "CANCELLED_THERAPIST"):
                continue
            try:
                owner = db_session.get(User, UUID(str(ts.specialist_id)))
            except (ValueError, TypeError):
                owner = None
            cal_id = _get_cal(owner) if owner else None
            if not cal_id:
                continue
            cl = db_session.get(_TC, ts.client_id)
            sid = str(ts.id)

            def _taken(gid: str, _sid=sid) -> bool:
                other = db_session.exec(
                    select(_TS.id).where(_TS.google_event_id == gid)
                ).first()
                return other is not None and str(other) != _sid

            res = _move_ev(
                cal_id,
                event_id=ts.google_event_id,
                client_name=cl.name if cl else "Сессия",
                alias_code=cl.alias_code if cl else None,
                new_date=ts.date,
                new_duration=ts.duration_minutes or 60,
                old_date=mv.get("old_date"),
                old_duration=mv.get("old_duration") or 60,
                is_taken=_taken,
                session_id=sid,
                booking_id=ts.booking_id,
            )
            gid = res.get("event_id")
            if gid and not ts.google_event_id and not _taken(gid):
                ts.google_event_id = gid
                db_session.add(ts)
                db_session.commit()
            if res.get("action") == "conflict":
                db_session.add(_Notif(
                    recipient_id=str(ts.specialist_id),
                    type="calendar_conflict",
                    title="Календарь: возможный дубль при переносе",
                    description=(
                        f"Бронь перенесена, но рядом с новым временем уже стоит событие "
                        f"«{res.get('summary')}» ({res.get('conflict_start') or '—'}). "
                        "Второе событие НЕ создано — проверьте Google Календарь."
                    ),
                    icon="AlertTriangle",
                    link="/crm/sessions",
                ))
                db_session.commit()
            logger.info("[autosync] session %s → GCal %s (%s)", sid, gid, res.get("action"))
        except Exception as e:  # noqa: BLE001 — календарь не ломает перенос
            logger.warning("[autosync] GCal move failed for session %s: %r", mv.get("session_id"), e)
            try:
                db_session.rollback()
                if ts is not None:
                    db_session.add(_Notif(
                        recipient_id=str(ts.specialist_id),
                        type="calendar_push_failed",
                        title="Перенос не попал в Google Календарь",
                        description=(
                            "Бронь и сессия перенесены, но событие в Google Календаре "
                            "осталось на старом времени. Перенесите его вручную — иначе "
                            "синхронизация вернёт сессию на прежнее время."
                        ),
                        icon="AlertTriangle",
                        link="/crm/sessions",
                    ))
                    db_session.commit()
            except Exception:
                logger.exception("[autosync] failed to record GCal move failure")


def _push_session_moves_to_gcal_bg(moves: list) -> None:
    """Фоновая обёртка: своя сессия БД, чтобы медленный Google не держал запрос."""
    from app.db.session import engine as _engine
    try:
        with Session(_engine) as bg_session:
            _push_session_moves_to_gcal(bg_session, moves)
    except Exception:
        logger.exception("[autosync] background GCal move crashed")


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


def _gcal_delete_in_background(event_id: str, resource_id: Optional[str]) -> None:
    """Drop a GCal event after the cancellation has already been committed.

    Cancellation holds a row lock on the booking (against double-refunds), and
    a synchronous delete_event kept that lock — plus a pooled DB connection and
    a threadpool slot — open for the whole round-trip to Google. Nothing in the
    cancellation depends on the result, so it goes to a BackgroundTask instead.
    """
    try:
        gcal_service.delete_event(event_id, resource_id)
    except Exception as e:
        logger.warning(f"[GCal cancel bg] delete_event failed for event={event_id}: {e}")


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


def _res_type(session: Session, resource_id: Optional[str]) -> Optional[str]:
    """Тип помещения ('capsule' | 'cabinet') — от него зависит доп. пул абонемента."""
    from app.services.billing_defer import _resource_type
    return _resource_type(session, resource_id)


def _pool_kind(session: Session, booking: Booking) -> str:
    """Вид доп. пула, из которого могла платить бронь: капсула / кабинет."""
    return subscription_pool.kind_for_resource(_res_type(session, booking.resource_id))


def _check_extra_pool_move(session: Session, booking: Booking, new_resource_id: Optional[str]) -> None:
    """Перенос абонементной брони не пересчитывает часы — бронь едет со своими
    часами. Часы капсулы годятся только для капсулы, «4 ч индивидуально» —
    только для кабинета: бронь, оплаченную часами доп. пула, в помещение
    другого вида не переносим (иначе час капсулы 10 ₾ оплатил бы кабинет)."""
    if (booking.payment_method or "").lower() != "subscription":
        return
    # Бронь заранее (pending) часов ещё не тратила — крон T-24ч разложит их
    # по пулам уже для нового помещения. Касается только списанных.
    if (booking.payment_status or "paid") != "paid":
        return
    if not new_resource_id or new_resource_id == booking.resource_id:
        return
    if subscription_pool.booking_extra(booking) <= 0:
        return
    old_kind = subscription_pool.kind_for_resource(_res_type(session, booking.resource_id))
    new_kind = subscription_pool.kind_for_resource(_res_type(session, new_resource_id))
    if old_kind != new_kind:
        what = "часами капсулы — перенести её можно только в капсулу" if old_kind == "capsule" \
            else "часами «индивидуально» — перенести её можно только в кабинет"
        raise HTTPException(
            status_code=400,
            detail=f"Бронь оплачена {what}. Отмените её (часы вернутся) и создайте новую.",
        )


def charge_hot_booking_on_approval(
    session: Session, booking: Booking, owner: Optional[User], actor: Optional[User] = None,
    via: str = "сайт",
) -> dict:
    """Одобрение горячей брони (сайт /approve и кнопка в Telegram) — ОДНО правило
    списания для обоих каналов, как у крона T-24ч (billing_defer.settle_pending_charge).

    Горячая бронь при создании ничего не держит: часы и деньги откатываются, пока
    бронь ждёт админа. Здесь снимаем всё по живому состоянию клиента:
      • по абонементу, абонемент действует и часы покрывают бронь (доп. пул
        первым, раскладка по живому пулу) → часы + денежная часть брони (пик +
        допы = final_price, единое правило billing_defer.subscription_money_due);
      • по абонементу, но часов не хватает / формат не в основном пуле / абонемент
        не действует (пауза, срок) → как запасной путь крона: бронь целиком
        деньгами по цене на момент одобрения (+ допы), hours_deducted = 0, отмена
        вернёт деньги (ревизия 03.10: раньше остаток просто обнулялся и бронь
        выходила бесплатной, а Групповому мастеру без «4 ч индивидуально» — 409);
      • баланс / бонус → final_price с баланса (у бонусной это остаток сверх
        бонусных часов — сами часы потрачены при создании).
    Кредитный лимит не проверяем — как и раньше при одобрении (слот уже обещан).
    Ставит confirmed + paid + charged_at + charge_amount. Не коммитит.
    Возвращает {"method", "hours", "money", "fallback"} — для текста клиенту.
    Без владельца (старые брони) — как раньше: ничего не списываем."""
    from app.services.billing_defer import subscription_cash_price, subscription_money_due
    method = (booking.payment_method or "balance").lower()
    info = {"method": method, "hours": 0.0, "money": 0.0, "fallback": False}
    ref = str(booking.id)
    charge_snapshot = float(booking.final_price or 0)
    if owner is not None:
        if method == "subscription":
            hrs = float(booking.hours_deducted or (booking.duration or 0) / 60.0)
            split = None
            if hrs > 0 and subscription_pool.is_active(owner.subscription, datetime.utcnow()):
                split = subscription_pool.plan_split(
                    owner.subscription, hrs,
                    resource_type=_res_type(session, booking.resource_id), format_type=booking.format,
                )
            if split is not None:
                owner.subscription = subscription_pool.debit_hours(owner.subscription, hrs, extra=split)
                booking.hours_deducted = hrs
                subscription_pool.stamp_booking(booking, hrs, split)
                money = subscription_money_due(booking.final_price)
                if money >= 0.01:
                    wallet.debit(session, owner, money, reason="booking_charge",
                                 description=f"Пиковая надбавка/допы брони по абонементу — подтверждение срочной брони ({via})",
                                 ref_type="booking", ref_id=ref, actor=actor)
                info.update(hours=hrs, money=money)
            else:
                try:
                    cash = subscription_cash_price(session, owner, booking)
                except Exception as e:  # noqa: BLE001 — честный отказ, а не бесплатная бронь
                    logger.error("[approve] booking %s: цена деньгами не посчиталась: %r", booking.id, e)
                    raise HTTPException(
                        status_code=409,
                        detail="Часов абонемента не хватает, а цену деньгами посчитать не удалось. "
                               "Отклоните бронь или попробуйте позже.",
                    )
                wallet.debit(session, owner, cash, reason="booking_charge",
                             description=f"Часов абонемента не хватило → бронь деньгами — подтверждение срочной брони ({via})",
                             ref_type="booking", ref_id=ref, actor=actor)
                booking.hours_deducted = 0
                subscription_pool.stamp_booking(booking, 0, 0)
                charge_snapshot = cash
                info.update(money=cash, fallback=True)
        else:
            money = round(float(booking.final_price or 0), 2)
            wallet.debit(session, owner, money, reason="booking_charge",
                         description=f"Списание при подтверждении срочной брони ({via})",
                         ref_type="booking", ref_id=ref, actor=actor)
            info.update(money=money, hours=float(booking.hours_deducted or 0) if method == "bonus" else 0.0)
        session.add(owner)
    booking.status = "confirmed"
    # Деньги/часы только что сняты — помечаем бронь оплаченной. Без этого крон
    # T-24ч видел бы confirmed+pending (горячая бронь по определению внутри окна
    # 24 ч) и списывал ВТОРОЙ раз (Алёна Ловиц 13.08: бот 20 ₾ + крон 20 ₾).
    booking.payment_status = "paid"
    booking.charged_at = datetime.utcnow()
    booking.charge_amount = round(charge_snapshot, 2)
    booking.updated_at = datetime.now()
    session.add(booking)
    return info


def _gel(x: float) -> str:
    """5.0 → «5», 2.5 → «2,5» — для текстов клиенту."""
    return f"{round(float(x or 0), 2):g}".replace(".", ",")


def hot_approval_paid_line(booking: Booking, info: Optional[dict] = None) -> str:
    """Строка «чем оплачено» в сообщении клиенту об одобрении срочной брони
    (сайт и Telegram — одна функция). Ревизия 03.10: бронь по абонементу
    оплачена часами, бонусная — бонусными часами, а не «деньгами с баланса»."""
    info = info or {}
    method = (booking.payment_method or "").lower()
    money = float(info.get("money", booking.final_price or 0) or 0)
    if info.get("fallback"):
        return f"Часов абонемента не хватило — бронь оплачена с баланса: {_gel(money)} ₾."
    base = ("Списаны часы абонемента." if (booking.payment_method or "").lower() == "subscription"
            else "Оплачено бонусными часами." if method == "bonus"
            else "Деньги списаны с баланса.")
    if money >= 0.01 and method == "subscription":
        return f"Списаны часы абонемента, доплата {_gel(money)} ₾ (пик/допы) — с баланса."
    if money >= 0.01 and method == "bonus":
        return "Оплачено бонусными часами, остаток списан с баланса."
    return base


def hot_approval_client_text(booking: Booking, res_name: str, loc_name: Optional[str],
                             info: Optional[dict] = None) -> str:
    """Сообщение клиенту «Срочная бронь подтверждена» — общее для сайта и бота."""
    date_str = booking.date.strftime("%d.%m") if booking.date else "—"
    loc_line = f" · {loc_name}" if loc_name else ""
    return (
        f"✅ <b>Срочная бронь подтверждена</b>\n\n"
        f"📅 {date_str} · {booking.start_time}\n"
        f"📍 {res_name}{loc_line}\n\n"
        + hot_approval_paid_line(booking, info)
    )


def release_rejected_hot_booking(session: Session, booking: Booking) -> dict:
    """Отклонение горячей брони (сайт /reject и ответ с причиной в Telegram) —
    одно поведение. Деньги и часы абонемента гейт откатил ещё при создании, а
    бонусные часы тратятся при СОЗДАНИИ и гейтом не откатываются — их надо
    вернуть. _refund_booking_to_owner при payment_status='pending' вернёт только
    бонус (денег не брали). Раньше бот этого не делал — бонусный час клиента
    пропадал (ревизия 03.10). Статус и причину ставит вызывающий. Не коммитит."""
    owner = _resolve_booking_owner(session, booking)
    if owner is None:
        return {}
    return _refund_booking_to_owner(session, booking, owner, 1.0)


def _extension_cash_price(session: Session, booking: Booking, owner: User, start_dt: datetime,
                          old_minutes: int, extra_minutes: int) -> float:
    """Цена добавки к брони ДЕНЬГАМИ: котировка новой длительности минус старой,
    движком (скидка тарифа остаётся, покрытие часами выключено — как запасной
    путь крона billing_defer.subscription_cash_price)."""
    from app.services.pricing import PricingService
    ps = PricingService(session)
    args = dict(user=owner, resource_id=booking.resource_id, start_time=start_dt,
                format_type=booking.format or "individual", exclude_booking_id=str(booking.id),
                subscription_hours_cover=False)
    old_q = ps.calculate_price(duration_minutes=old_minutes, **args)
    new_q = ps.calculate_price(duration_minutes=old_minutes + extra_minutes, **args)
    return round(max(0.0, float(new_q.final_price or 0) - float(old_q.final_price or 0)), 2)


def _extend_subscription_booking(session: Session, booking: Booking, owner: User, extra_minutes: int,
                                 actor: Optional[User] = None) -> dict:
    """Продление брони ПО АБОНЕМЕНТУ (+30 мин и т.п.) — ревизия 03.10.

    Раньше часы за добавленное время не снимались вовсе («известный пробел»), а
    доплата считалась пропорцией от цены брони. Теперь — по тем же правилам,
    что и сама бронь (единое правило денег — billing_defer):
      • pending (заранее, ещё ничего не списано): только hours_deducted и
        денежная часть за пиковые слоты добавки — крон T-24ч снимет всё ОДИН раз;
      • paid, бронь оплачена часами: часы за добавку снимаются сразу (доп. пул
        первым, как при создании) + пиковая надбавка добавки; часов нет /
        абонемент не действует → добавка деньгами по движку (как запасной путь
        крона), часы брони не трогаем;
      • paid, бронь уже ушла в деньги (hours_deducted = 0): добавка деньгами,
        charge_amount растёт — отмена вернёт всё;
      • waived (штраф снят): ничего не списываем — бронь целиком прощена.
    Всё снятое ложится в final_price (часы — в hours_deducted), поэтому отмена
    возвращает ровно взятое. Длительность брони ставит вызывающий. Не коммитит."""
    from app.services.pricing import PricingService
    old_minutes = int(booking.duration or 0)
    add_h = round(extra_minutes / 60.0, 4)
    try:
        _h, _m = map(int, (booking.start_time or "0:0").split(":"))
        start_dt = booking.date.replace(hour=_h, minute=_m, second=0, microsecond=0)
    except Exception:
        start_dt = booking.date
    peak_add = PricingService.subscription_peak_money(start_dt + timedelta(minutes=old_minutes), extra_minutes)
    hrs_old = float(booking.hours_deducted or 0)
    old_extra = subscription_pool.booking_extra(booking)
    status = booking.payment_status or "paid"
    info = {"mode": "", "hours": 0.0, "money": 0.0}

    if status == "waived":
        info["mode"] = "waived"
        return info
    if status == "pending":
        new_h = round((hrs_old if hrs_old > 0 else old_minutes / 60.0) + add_h, 4)
        booking.hours_deducted = new_h
        subscription_pool.stamp_booking(booking, new_h, old_extra)  # прикидка; крон разложит по живому пулу
        booking.final_price = round(float(booking.final_price or 0) + peak_add, 2)
        info.update(mode="deferred", hours=add_h)
        return info

    ref = str(booking.id)
    if hrs_old > 0:
        split = None
        if subscription_pool.is_active(owner.subscription, datetime.utcnow()):
            split = subscription_pool.plan_split(
                owner.subscription, add_h,
                resource_type=_res_type(session, booking.resource_id), format_type=booking.format,
            )
        if split is not None:
            owner.subscription = subscription_pool.debit_hours(owner.subscription, add_h, extra=split)
            new_h = round(hrs_old + add_h, 4)
            booking.hours_deducted = new_h
            subscription_pool.stamp_booking(booking, new_h, round(old_extra + split, 4))
            money = peak_add
            info.update(mode="hours", hours=add_h)
            desc = "Продление брони по абонементу: пиковая надбавка за добавленное время"
        else:
            money = _extension_cash_price(session, booking, owner, start_dt, old_minutes, extra_minutes)
            info["mode"] = "money"
            desc = "Продление брони по абонементу: часов нет → добавленное время деньгами"
    else:
        money = _extension_cash_price(session, booking, owner, start_dt, old_minutes, extra_minutes)
        info["mode"] = "money"
        desc = "Продление брони (оплачена деньгами): добавленное время"
        booking.charge_amount = round(float(booking.charge_amount or 0) + money, 2)
    if money >= 0.01:
        wallet.debit(session, owner, money, reason="extend_charge", description=desc,
                     ref_type="booking", ref_id=ref, actor=actor)
    booking.final_price = round(float(booking.final_price or 0) + money, 2)
    info["money"] = money
    session.add(owner)
    return info


_MONEY_ROW_DETAIL = (
    "Бронь по абонементу ушла в деньги (часов абонемента не хватило) — {what}. "
    "Отмените её (деньги вернутся полностью) и создайте новую."
)


def _subscription_money_row(booking: Booking) -> bool:
    """Бронь по абонементу, оплаченная ДЕНЬГАМИ: часов не хватило в кроне T-24ч
    или при одобрении (hours_deducted = 0, в charge_amount — снятые ₾).

    Ревизия 03.10: её цену нельзя «резать долей». Деньги за неё — одна цена
    движка за весь слот (скидка тарифа, пик, допы), а final_price у неё —
    прежняя денежная часть абонемента. Сокращение, вырезка, смена формата и
    «Цена» считали от final_price и затирали charge_amount: клиент терял до 36 ₾
    (S10), а вырезка дарила фантомный час (S11). Такие брони редки (часов не
    хватило за сутки до начала) — честный отказ надёжнее пересчёта долями:
    отмена вернёт ровно charge_amount, новая бронь посчитается заново."""
    return ((booking.payment_method or "").lower() == "subscription"
            and (booking.payment_status or "paid") == "paid"
            and float(booking.hours_deducted or 0) <= 0)


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
    # Бонусные часы тратятся при СОЗДАНИИ брони (не при списании), поэтому
    # возвращаем их при любой отмене — включая pending: деньги там не списаны,
    # но бесплатный час уже потрачен, и его надо вернуть клиенту.
    if booking.payment_method == "bonus" and (booking.hours_deducted or 0) > 0:
        from app.services.bonus_service import refund_free_hours
        _refund_bonus_h = round(float(booking.hours_deducted) * refund_percent, 2)
        if _refund_bonus_h > 0:
            refund_free_hours(session, owner.id, _refund_bonus_h)

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

    # §5#12 (зеркало waive_charge): возвращаем то, что РЕАЛЬНО списали. Если у
    # абонементной брони часы фактически списаны (hours_deducted>0) → возврат
    # часов. А если абонемент был исчерпан и бронь ушла в баланс-долг (settle
    # пометил hours_deducted=0, payment_method остался 'subscription') → это
    # ДЕНЬГИ, и возвращать надо деньги (ветка else ниже по charge_amount), иначе
    # клиенту не вернётся ничего (баг: full_hours=0 → 0 часов, а денежная ветка
    # при method=='subscription' недостижима).
    if booking.payment_method == "subscription" and (booking.hours_deducted or 0) > 0:
        if owner.subscription:
            new_sub = owner.subscription.copy()
            full_hours = (
                booking.hours_deducted
                if booking.hours_deducted is not None
                else (booking.duration / 60)
            )
            refund_hours = round(full_hours * refund_percent, 4)
            retained_hours = round(full_hours - refund_hours, 4)
            # Доп. пул (часы капсулы / «4 ч индивидуально») возвращается в
            # свой пул той же долей, что и вся бронь.
            refund_extra = round(subscription_pool.booking_extra(booking) * refund_percent, 4)
            if not subscription_pool.hours_return_allowed(new_sub, booking.date):
                # Бронь из прошлой недели недельного пакета — её часы сгорели
                # вместе с неделей; в пул новой недели не возвращаем.
                refund_hours = 0.0
                refund_extra = 0.0
            # Mirror waive_charge in billing_defer.py: refunding hours back to
            # the pool must also decrement used_hours, or the pool drifts
            # (remaining + used no longer sums to the plan total).
            owner.subscription = new_sub = subscription_pool.credit_hours(
                new_sub, refund_hours, extra=refund_extra, kind=_pool_kind(session, booking))
            if refund_extra > 0:
                refund_meta["refunded_extra_hours"] = refund_extra
            session.add(owner)
            refund_meta["refunded_hours"] = refund_hours
            refund_meta["retained_hours_unbox_income"] = retained_hours
        else:
            refund_meta["refunded_hours"] = 0
            refund_meta["warning"] = "Owner has no subscription to refund to"
        # Аудит 2026-08-27: пиковая надбавка абонемента — реальные ДЕНЬГИ
        # (у абонементной брони final_price == subscription_peak_debt), списанные
        # при создании или кроном T-24ч. Возврат часов её не покрывал — клиент
        # терял 5₾/ч при любой отмене пиковой абонементной брони.
        # Единое правило (billing_defer): деньги брони с часами = final_price,
        # их снял тот же путь, что и часы.
        from app.services.billing_defer import subscription_money_taken
        _peak = round(subscription_money_taken(booking) * refund_percent, 2)
        if _peak >= 0.01:
            wallet.credit(session, owner, _peak, reason="booking_refund",
                          description="Возврат пиковой надбавки абонемента",
                          ref_type="booking", ref_id=str(booking.id))
            refund_meta["refunded_peak_gel"] = _peak
    else:
        # Возвращаем ФАКТИЧЕСКИ списанное (charge_amount), а не final_price:
        # у абонемент→баланс брони final_price ≈0 (стоимость была в часах), а
        # реальные деньги сидят в charge_amount. Для обычной balance-брони
        # charge_amount == final_price, так что поведение не меняется.
        full_amount = (
            booking.charge_amount if booking.charge_amount is not None
            else (booking.final_price or 0.0)
        )
        refund_amount = round(full_amount * refund_percent, 2)
        retained_amount = round(full_amount - refund_amount, 2)
        if abs(refund_amount) >= 0.01:
            wallet.credit(session, owner, refund_amount, reason="booking_refund",
                          description="Возврат при отмене брони",
                          ref_type="booking", ref_id=str(booking.id))
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
    user_id: Optional[str] = Query(
        None,
        description="Только брони этого клиента (email или UUID). "
                    "Карточка клиента обязана фильтровать здесь, а не в браузере.",
    ),
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

    `user_id` (2026-07-22): карточка клиента раньше тянула ВЕСЬ список и
    фильтровала его в браузере. Броней стало 6115 при потолке 5000 — хвост
    молча отбрасывался, и у клиента показывалось «0 часов / 0 бронирований»
    или заниженные цифры. Фильтр по клиенту в SQL снимает потолок как
    проблему: у одного человека броней десятки, а не тысячи.
    """
    stmt = select(Booking)
    if user_id:
        cond = [Booking.user_id == user_id]
        try:
            cond.append(Booking.user_uuid == UUID(str(user_id)))
        except (ValueError, TypeError):
            pass
        stmt = stmt.where(or_(*cond))
    bookings = session.exec(
        stmt.order_by(Booking.date.desc()).offset(skip).limit(limit)
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


# ─── Порядок оплаты: бонус → абонемент → баланс ──────────────────────────────

def _resolve_with_bonus(
    session: Session,
    pricing_service,
    owner: User,
    requested: Optional[str],
    quote,
    *,
    resource_id: str,
    start_dt: datetime,
    duration_minutes: int,
    format_type: str,
    bonus_left: float,
    extras_price: float = 0.0,
    consume: bool = True,
):
    """Выбрать способ оплаты брони и, если это бонус, потратить бонусные часы.

    Порядок (владелец 29.09): 1) бонусные часы, если их хватает на ВСЮ бронь;
    2) абонемент, если покрывает; 3) баланс. Явный выбор бонуса уважаем —
    раньше сервер молча менял его на абонемент (см. resolve_payment_method).
    Без действующего абонемента (владелец 01.10) бонус тратится и частично:
    бонус-часы бесплатно, остаток — деньгами по обычной цене.

    Бонусную бронь перекотируем БЕЗ абонемента: иначе непокрытый остаток
    посчитался бы по абонементной цене 0 ₾ (утечка 1630 ₾), а в брони остались
    бы правило SUBSCRIPTION и часы абонемента. Бонус покрывает всю цену брони
    вместе с пиком и допуслугами — как и раньше («выданное бонусом бесплатно»).

    Возвращает (method, quote, bonus_covered). consume=False — «примерка»
    без записи: покрытие считается из `bonus_left`, пул бонусов не трогаем.
    """
    from app.services.pricing import resolve_payment_method
    # Владелец 01.10: без действующего абонемента приветственный час тратится
    # сам и частично (остаток — деньгами, ниже); с абонементом — только целиком.
    sub_active = subscription_pool.is_active(getattr(owner, "subscription", None), datetime.utcnow())
    method = resolve_payment_method(requested, quote, bonus_hours_available=bonus_left,
                                    has_active_subscription=sub_active)
    if method != "bonus":
        return method, quote, 0.0
    if quote.applied_rule == "SUBSCRIPTION":
        quote = pricing_service.calculate_price(
            user=owner,
            resource_id=resource_id,
            start_time=start_dt,
            duration_minutes=duration_minutes,
            format_type=format_type,
            ignore_subscription=True,
        )
        quote.final_price = round(float(quote.final_price or 0) + float(extras_price or 0), 2)
    hrs = (duration_minutes or 0) / 60.0
    if consume:
        from app.services.bonus_service import consume_free_hours
        covered = consume_free_hours(session, owner.id, hrs)
    else:
        covered = round(min(max(float(bonus_left or 0), 0.0), hrs), 2)
    if hrs > 0 and covered > 0:
        _uncovered = max(0.0, hrs - covered)
        quote.final_price = round(float(quote.final_price or 0) * (_uncovered / hrs), 2)
    return method, quote, covered


def _bonus_hours_on(booking: Booking) -> float:
    """Сколько бонусных часов потрачено на бронь при создании (их вернёт отмена).

    Бонус тратится при СОЗДАНИИ, а в брони остаётся payment_method='bonus',
    hours_deducted=потраченные часы и final_price — только НЕпокрытая часть
    (обычно 0 ₾). Правки брони, которые пересчитывают цену «как для денежной»,
    обязаны это учитывать — иначе клиент платит полную цену за слот, уже
    оплаченный бонус-часом, а сам час пропадает.
    """
    if (booking.payment_method or "").lower() != "bonus":
        return 0.0
    return max(0.0, float(booking.hours_deducted or 0))


def _bonus_uncovered_price(booking: Booking, price: float, duration_minutes: int) -> float:
    """Цена брони за вычетом доли, покрытой её бонусными часами.

    Та же формула, что при создании (_resolve_with_bonus): бонус покрывает
    covered/hrs брони, деньгами — остальное. Длительность не меняется, значит
    потраченные бонус-часы по-прежнему покрывают ту же долю — пул бонусов не
    трогаем. Не бонусная бронь — цена как есть.
    """
    hrs = (duration_minutes or 0) / 60.0
    covered = min(_bonus_hours_on(booking), hrs)
    if hrs <= 0 or covered <= 0:
        return price
    return round(float(price or 0) * (hrs - covered) / hrs, 2)


# Правки, меняющие длительность бонусной брони, требуют вернуть/дотратить
# бонус-часы — пока этого нет, честно отказываем (как у абонемента).
_BONUS_RESIZE_DETAIL = (
    "Бронь оплачена бонусными часами — {what}. Можно отменить её "
    "(бонусные часы вернутся) и забронировать заново."
)


# ─── Пауза абонемента снимается новой бронью (владелец 03.10) ────────────────
# «Если стоит на паузе, а клиент делает бронь, то пауза снимается, но дни
# неизрасходованной паузы остаются и могут быть использованы в рамках этого
# абонемента». Снимаем, ТОЛЬКО если бронь при снятой паузе пошла бы часами
# абонемента — по тем же правилам, что всегда (бонус → абонемент → баланс).
# Пауза остаётся, если бронь всё равно оплатил бы бонус целиком, формат не
# входит в тариф, часов не хватает на всю бронь, срок вышел или выбран другой
# способ. Снятие — обычное subscription_perks.end_freeze (как кнопка «Снять
# паузу»): срок +min(факт, выдано на паузу), у старой паузы (до 01.10) — +факт;
# неизрасходованные дни остаются в бюджете паузы.
#
# Зовут: одиночная бронь (сайт, Telegram-бот, горячая), корзина, серия,
# продление серии. НЕ зовут: перенос, продление брони (+30 мин), «На абонемент»,
# «Закрыть кабинет», отмена. Сторож — guard_pause_lift_on_booking_2026_10.py.

# Слот брони для примерки: (кабинет, начало по Тбилиси, минуты, формат).
_PauseSlot = tuple

# Ключ в session.info: сведения о снятии паузы последней созданной бронью —
# Telegram-бот (он зовёт create_booking напрямую) говорит о снятии в своём ответе.
PAUSE_LIFT_INFO_KEY = "pause_lift_on_booking"


def _slot_start(day: datetime, hhmm: Optional[str]) -> datetime:
    """Начало слота: день брони (полночь по Тбилиси) + «ЧЧ:ММ»."""
    try:
        h, m = map(int, (hhmm or "").split(":"))
        return day.replace(hour=h, minute=m, second=0, microsecond=0)
    except Exception:
        return day


@contextlib.contextmanager
def _pool_swapped(session: Session, owner: User, sub: dict):
    """Подставить владельцу пул ТОЛЬКО на время расчёта цены («примерка»).

    Движок цен читает owner.subscription, поэтому примерку считаем на нём же.
    Без autoflush — подменённый пул не уйдёт в базу даже при запросах внутри;
    настоящий пул возвращаем в finally (он равен прежнему — UPDATE не будет)."""
    real = owner.subscription
    with session.no_autoflush:
        owner.subscription = sub
        try:
            yield
        finally:
            owner.subscription = real


def _pause_lift_trial(
    session: Session,
    pricing_service,
    owner: User,
    requested: Optional[str],
    slots: List[_PauseSlot],
    *,
    bonus_left: Optional[float] = None,
    extras_price: float = 0.0,
    now: Optional[datetime] = None,
) -> Optional[tuple]:
    """«Примерка»: пошла бы бронь часами абонемента, если снять паузу сейчас?

    Возвращает (пул после снятия паузы, номер первого слота, который ушёл бы в
    часы) или None — пауза остаётся. Ничего не пишет: паузу снимаем на КОПИИ
    пула (copy.deepcopy → end_freeze) и считаем тем же движком, что и создание
    брони (calculate_price + _resolve_with_bonus без траты бонусов). Бонус
    «тратим» по слотам локально — как цикл корзины и серии."""
    sub = getattr(owner, "subscription", None)
    if not slots or not sub or not subscription_pool.get(sub, "is_frozen", False):
        return None
    from app.services import subscription_perks
    now = now or datetime.utcnow()
    try:
        trial, _fact, _ext = subscription_perks.end_freeze(copy.deepcopy(sub), now)
    except subscription_perks.FreezeError:
        return None
    # Срок вышел и с продлением на паузу — абонемент всё равно не платит.
    if not subscription_pool.is_active(trial, now):
        return None
    try:
        if bonus_left is None:
            from app.services.bonus_service import available_free_hours
            bonus_left = available_free_hours(session, owner.id)
        left = max(0.0, float(bonus_left or 0))
        with _pool_swapped(session, owner, trial):
            for i, (resource_id, start_dt, minutes, fmt) in enumerate(slots):
                quote = pricing_service.calculate_price(
                    user=owner, resource_id=resource_id, start_time=start_dt,
                    duration_minutes=minutes, format_type=fmt,
                )
                quote.final_price = round(float(quote.final_price or 0) + float(extras_price or 0), 2)
                method, quote, covered = _resolve_with_bonus(
                    session, pricing_service, owner, requested, quote,
                    resource_id=resource_id, start_dt=start_dt, duration_minutes=minutes,
                    format_type=fmt, bonus_left=left, extras_price=extras_price, consume=False,
                )
                left = max(0.0, left - covered)
                if method == "subscription" and quote.applied_rule == "SUBSCRIPTION":
                    return trial, i
    except Exception:
        # Примерка не должна ронять бронь: при сбое пауза просто остаётся.
        logger.warning("[pause-lift] примерка не удалась — пауза остаётся", exc_info=True)
    return None


def _days_label(value: Any) -> str:
    """Дни паузы для текста: 10 → «10», 2.5 → «2,5» (как fmtFreezeDays на сайте)."""
    try:
        return f"{round(max(0.0, float(value or 0)), 1):g}".replace(".", ",")
    except (TypeError, ValueError):
        return "0"


def _lift_pause_for_booking(
    session: Session,
    pricing_service,
    owner: Optional[User],
    actor: Optional[User],
    requested: Optional[str],
    slots: List[_PauseSlot],
    *,
    bonus_left: Optional[float] = None,
    extras_price: float = 0.0,
) -> Optional[dict]:
    """Новая бронь снимает паузу абонемента, если сама пойдёт часами
    (владелец 03.10). Звать ДО расчёта цены брони и один раз на запрос
    (корзина и серия — до цикла). Возвращает сведения о снятии или None.

    Не коммитит: пул и событие уходят в базу ОДНИМ коммитом с бронью — любой
    отказ ниже (слот занят, не хватает денег) откатит и снятие, пауза
    останется."""
    if owner is None or not slots:
        return None
    if not subscription_pool.get(getattr(owner, "subscription", None), "is_frozen", False):
        return None
    from app.services import subscription_perks
    # Строка клиента под замком: не столкнуться с кроном (снятие паузы по сроку)
    # и с администратором («Снять паузу») в ту же секунду. populate_existing —
    # пул перечитываем из базы, а не из кэша сессии.
    locked = session.exec(
        select(User).where(User.id == owner.id).with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    if not subscription_pool.get(locked.subscription, "is_frozen", False):
        return None  # паузу уже сняли (крон / администратор) — дальше обычный расчёт
    now = datetime.utcnow()
    hit = _pause_lift_trial(session, pricing_service, locked, requested, slots,
                            bonus_left=bonus_left, extras_price=extras_price, now=now)
    if hit is None:
        return None
    new_sub, fact, extend = subscription_perks.end_freeze(locked.subscription, now)
    locked.subscription = new_sub
    session.add(locked)

    resource_id, start_dt = slots[hit[1]][0], slots[hit[1]][1]
    from app.models.resource import Resource as _PauseRes
    _res = session.get(_PauseRes, resource_id)
    resource_name = (_res.name if _res else None) or resource_id
    when = start_dt.strftime("%d.%m %H:%M")
    days_left = subscription_pool.get(new_sub, "freeze_days_left")
    info = {
        "user_id": str(locked.id),
        "fact_days": fact,
        "extended_days": extend,
        "freeze_days_left": days_left,
        "expiry_date": subscription_pool.get(new_sub, "expiry_date"),
        "booking_date": start_dt.strftime("%Y-%m-%d"),
        "booking_time": start_dt.strftime("%H:%M"),
        "booking_when": when,
        "booking_resource": resource_id,
        "booking_resource_name": resource_name,
        "slots": len(slots),
    }
    timeline_service.log_event(
        session=session,
        actor_id=(actor.id if actor is not None else None),
        actor_role=(getattr(actor, "role", None) or "system"),
        target_id=str(locked.id),
        target_type="user",
        event_type="subscription_freeze",
        description=(f"Пауза снята новой бронью: {when}, {resource_name}. "
                     f"Срок +{_days_label(extend)} дн., осталось дней паузы {_days_label(days_left)}"),
        metadata={"action": "AutoUnfreezeOnBooking", **info},
        commit=False,
    )
    logger.info("[pause-lift] пауза снята бронью: user=%s %s срок +%s дн.", locked.id, when, extend)
    return info


def pause_lift_client_text(info: dict) -> str:
    """Сообщение клиенту о снятии паузы (Telegram)."""
    text = (f"Ваш абонемент снова активен: пауза снята, потому что на вас забронировано "
            f"{info.get('booking_when') or ''}.")
    try:
        left = float(info.get("freeze_days_left") or 0)
    except (TypeError, ValueError):
        left = 0.0
    if left >= 0.05:
        text += (f" Неиспользованные дни паузы ({_days_label(left)}) сохранились — "
                 f"их можно взять позже через администратора.")
    return text


def _send_pause_lift_tg(chat_id: str, text: str) -> None:
    """Сбой Telegram не должен ломать бронь."""
    try:
        telegram_service.send_message(chat_id, text)
    except Exception:
        logger.warning("[pause-lift] сообщение клиенту не ушло", exc_info=True)


def _notify_pause_lifted(owner: Optional[User], info: Optional[dict],
                         background_tasks: Optional[BackgroundTasks] = None) -> None:
    """Сказать клиенту в Telegram, что пауза снята. Звать ПОСЛЕ коммита брони.
    Есть фоновые задачи — отправка после ответа; нет — сразу (без исключений)."""
    if not info or owner is None:
        return
    try:
        chat_id = getattr(owner, "telegram_id", None)
    except Exception:
        chat_id = None
    if not chat_id:
        return
    text = pause_lift_client_text(info)
    if background_tasks is not None:
        background_tasks.add_task(_send_pause_lift_tg, str(chat_id), text)
    else:
        _send_pause_lift_tg(str(chat_id), text)


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
                raise HTTPException(status_code=404, detail="Клиент CRM не найден")
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
                    status_code=400, detail=f"Это время уже занято: {reason}"
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
        from app.services.pricing import PricingService, resolve_payment_method

        try:
            h, m = map(int, booking_in.start_time.split(":"))
            start_dt = booking_in.date.replace(
                hour=h, minute=m, second=0, microsecond=0
            )
        except Exception:
            start_dt = booking_in.date

        pricing_service = PricingService(session)
        # Пауза абонемента (владелец 03.10): если эта бронь при снятой паузе
        # пошла бы часами — сначала снимаем паузу (под замком, без коммита),
        # дальше цена и способ оплаты считаются как обычно.
        _pause_lift = _lift_pause_for_booking(
            session, pricing_service, booking_owner, current_user, booking_in.payment_method,
            [(booking_in.resource_id, start_dt, booking_in.duration, booking_in.format)],
            extras_price=PricingService.calculate_extras_price(list(booking_in.extras or [])),
        )
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

        # Ярлык оплаты обязан следовать за котировкой: если движок покрыл слот
        # абонементом, а бронь осталась помечена `balance`, часы не спишет никто
        # (списание везде завязано на payment_method) — кабинет уйдёт за 0 ₾.
        # Делать это НАДО до гейтов ниже: от ярлыка зависят и списание часов,
        # и проверка средств, и пиковая надбавка.
        #
        # Порядок (владелец 29.09): бонус, если хватает на всю бронь → абонемент
        # → баланс; явный выбор бонуса уважаем.
        #
        # ── Бонусные часы (owner 2026-07-20): выданное бонусом — бесплатно, всё
        # сверх — по обычной цене. Тратим бесплатные часы клиента (FIFO), а цену
        # оставляем только за НЕпокрытую часть — она уйдёт с баланса ниже. Раньше
        # «бонус» списывал полную цену с баланса, а сам бонус не трогал (клиент −20).
        from app.services.bonus_service import available_free_hours
        booking_in.payment_method, quote, bonus_covered = _resolve_with_bonus(
            session, pricing_service, booking_owner, booking_in.payment_method, quote,
            resource_id=booking_in.resource_id,
            start_dt=start_dt,
            duration_minutes=booking_in.duration,
            format_type=booking_in.format,
            bonus_left=available_free_hours(session, booking_owner.id),
            extras_price=extras_price,
        )

        # id брони заранее: строки ленты баланса ссылаются на неё (ref_id) —
        # по ним сторож и сверка видят, сколько взяли и вернули за ЭТУ бронь.
        from uuid import uuid4 as _uuid4
        _new_booking_id = _uuid4()

        if booking_in.payment_method == "subscription":
            if quote.applied_rule != "SUBSCRIPTION":
                raise HTTPException(
                    status_code=400,
                    detail="Абонемент не покрывает эту бронь: не хватает часов или этот формат кабинета не входит в тариф",
                )
            if not defer_charge_single and booking_owner.subscription:
                booking_owner.subscription = subscription_pool.debit_hours(
                    booking_owner.subscription, quote.hours_deducted, extra=quote.extra_hours_deducted)
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
                wallet.debit(session, booking_owner, quote.final_price, reason="booking_charge",
                             description="Оплата брони с баланса (при создании)", ref_type="booking",
                             ref_id=str(_new_booking_id))

        booking_in.final_price = quote.final_price
        booking_in.base_price = quote.base_price
        booking_in.applied_rule = quote.applied_rule
        booking_in.discount_amount = quote.discount_amount
        booking_in.discount_percent = quote.discount_percent
        booking_in.hours_deducted = quote.hours_deducted
        # Бонусная бронь: запомним, сколько бесплатных часов потрачено — чтобы
        # вернуть их при отмене (payment_method='bonus' + hours_deducted).
        if booking_in.payment_method == "bonus" and bonus_covered > 0:
            booking_in.hours_deducted = bonus_covered
        # Stamp payment_status here on the pydantic input — the actual
        # Booking row is built from booking_in down below.
        booking_in.payment_status = "pending" if defer_charge_single else "paid"
        if not defer_charge_single:
            booking_in.charged_at = datetime.utcnow()
            booking_in.charge_amount = quote.final_price

        # Денежная часть брони по абонементу: пиковая надбавка + допы (= final_price,
        # единое правило billing_defer.subscription_money_due). Снимаем с баланса
        # (в минус = долг) ВМЕСТЕ с часами — только на немедленном пути; бронь
        # заранее снимет крон T-24ч. Ревизия 03.10: раньше здесь снимался только
        # пик (peak_debt), а допы оставались в цене — отмена «возвращала» их из
        # воздуха (песочница 5 ₾ по абонементу: взяли 0, вернули 5).
        peak_debt = quote.subscription_peak_debt
        from app.services.billing_defer import subscription_money_due
        sub_money = (subscription_money_due(quote.final_price)
                     if booking_in.payment_method == "subscription" else 0.0)
        if not defer_charge_single and sub_money >= 0.01:
            wallet.debit(session, booking_owner, sub_money, reason="booking_charge",
                         description="Пиковая надбавка абонемента (при создании)" if sub_money <= peak_debt
                         else "Пиковая надбавка/допы брони по абонементу (при создании)",
                         ref_type="booking", ref_id=str(_new_booking_id))

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
                wallet.credit(session, booking_owner, quote.final_price, reason="booking_charge_revert",
                              description="Откат списания — бронь ушла на подтверждение (hot)", ref_type="booking",
                              ref_id=str(_new_booking_id))
            else:
                # Undo subscription deduction
                if booking_owner.subscription:
                    booking_owner.subscription = subscription_pool.credit_hours(
                        booking_owner.subscription, quote.hours_deducted,
                        extra=quote.extra_hours_deducted,
                        kind=subscription_pool.kind_for_resource(_res_type(session, booking_in.resource_id)))
                # Аудит 2026-08-27: пиковая надбавка (и допы) — реальные ДЕНЬГИ,
                # списанные выше (sub_money на не-отложенном пути; hot всегда
                # не-отложенный). Часы откатили — откатываем и деньги, иначе
                # «Отклонить» съедал 5₾/ч безвозвратно. Одобрение снимет их
                # заново (charge_hot_booking_on_approval).
                if sub_money >= 0.01:
                    wallet.credit(session, booking_owner, sub_money, reason="booking_charge_revert",
                                  description="Откат пиковой надбавки — бронь ушла на подтверждение (hot)",
                                  ref_type="booking", ref_id=str(_new_booking_id))

            # The money was just handed back, so the row must stop claiming it
            # was paid. It used to keep payment_status="paid" + charge_amount
            # from the block above: cancelling a pending_approval booking then
            # took that at face value and refunded a charge that never happened
            # (book → cancel → +final_price on the balance, repeatable).
            # `approve` re-charges and re-stamps these on the way to confirmed.
            booking_in.payment_status = "pending"
            booking_in.charged_at = None
            booking_in.charge_amount = None
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

        booking_data["id"] = _new_booking_id
        booking = Booking(**booking_data)
        # Из какого пула абонемента часы (доп. / основной). Для брони заранее
        # (pending) — прикидка; точную раскладку пишет крон T-24ч.
        if booking.payment_method == "subscription":
            subscription_pool.stamp_booking(booking, quote.hours_deducted, quote.extra_hours_deducted)

        session.add(booking)
        session.commit()
        session.refresh(booking)

        # Пауза снята этой бронью — сказать клиенту (после коммита, в фоне).
        # Боту (он зовёт create_booking напрямую) — через session.info.
        if _pause_lift:
            session.info[PAUSE_LIFT_INFO_KEY] = _pause_lift
            _notify_pause_lifted(booking_owner, _pause_lift, background_tasks)

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
                "Сумма":     (f"{booking.final_price:g} ₾" if booking.final_price
                              else "бонусные часы" if booking.payment_method == "bonus"
                              else "по абонементу"),
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
                tg_markup = telegram_service.hot_booking_markup(booking.id)
            background_tasks.add_task(
                telegram_service.send_admin_event,
                event=event_type,
                fields=fields_dict,
                reply_markup=tg_markup,
                # Срочную бронь дублируем в личку админам (не теряется в ленте).
                dm_copy=(booking.status == "pending_approval"),
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

    from app.services.pricing import PricingService, resolve_payment_method
    from app.services.billing_defer import subscription_money_due
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
            raise HTTPException(status_code=404, detail="Клиент CRM не найден")
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
    # Бонусные часы клиента: тратятся по слотам, пока хватает на слот целиком
    # (порядок оплаты владельца 29.09: бонус → абонемент → баланс).
    from app.services.bonus_service import available_free_hours
    _bonus_left = available_free_hours(session, booking_owner.id)

    # Пауза абонемента (владелец 03.10): один раз до цикла — если хотя бы один
    # слот при снятой паузе пошёл бы часами. Дальше обычный расчёт по слотам.
    _pause_lift = _lift_pause_for_booking(
        session, pricing_service, booking_owner, current_user, data.payment_method,
        [(s.resource_id, _slot_start(d, s.start_time), s.duration, s.format) for s, d in parsed_slots],
        bonus_left=_bonus_left,
    )

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

        # Ярлык решается ПО СЛОТУ, а не на всю пачку: часы абонемента могут
        # кончиться на середине, и тогда следующие слоты честно уйдут на баланс.
        # `data.payment_method` не трогаем — он общий на весь запрос.
        slot_method, quote, slot_bonus_hours = _resolve_with_bonus(
            session, pricing_service, booking_owner, data.payment_method, quote,
            resource_id=s.resource_id,
            start_dt=start_dt,
            duration_minutes=s.duration,
            format_type=s.format,
            bonus_left=_bonus_left,
        )
        _bonus_left = max(0.0, _bonus_left - slot_bonus_hours)
        _slot_id = gen_uuid4()  # заранее — для ref_id строк ленты

        if slot_method == "subscription":
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
                remaining = subscription_pool.get_float(new_sub, "remaining_hours")
                hours_deducted = quote.hours_deducted or 0
                # Из основного пула — только то, что не покрыл доп. (капсула).
                if remaining < hours_deducted - (quote.extra_hours_deducted or 0):
                    raise HTTPException(
                        400,
                        f"Not enough subscription hours for slot {s.date} {s.start_time}",
                    )
                booking_owner.subscription = new_sub = subscription_pool.debit_hours(
                    new_sub, hours_deducted, extra=quote.extra_hours_deducted)
                # Денежная часть слота по абонементу (пиковая надбавка) — вместе
                # с часами, как одиночная бронь (единое правило billing_defer).
                # Ревизия 03.10: раньше немедленный слот корзины пик не снимал, а
                # отмена его «возвращала».
                _slot_money = subscription_money_due(quote.final_price)
                if _slot_money >= 0.01:
                    wallet.debit(session, booking_owner, _slot_money, reason="booking_charge",
                                 description=f"Пиковая надбавка абонемента (корзина {s.date} {s.start_time})",
                                 ref_type="booking", ref_id=str(_slot_id))
        else:  # balance (и bonus — остаток сверх бонусных часов)
            if not defer_charge_multi:
                available_funds = (booking_owner.balance or 0) + (booking_owner.credit_limit or 0)
                if available_funds < quote.final_price:
                    raise HTTPException(
                        400,
                        f"Insufficient balance for slot {s.date} {s.start_time}. "
                        f"Need {quote.final_price}₾, have {available_funds}₾.",
                    )
                wallet.debit(session, booking_owner, quote.final_price, reason="booking_charge",
                             description=f"Оплата брони с баланса (мульти-слот {s.date} {s.start_time})",
                             ref_type="booking", ref_id=str(_slot_id))

        total_cost += quote.final_price

        booking = Booking(
            id=_slot_id,
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
            payment_method=slot_method,
            payment_source=(
                "subscription" if slot_method == "subscription" else "deposit"
            ),
            # Бонусная бронь хранит потраченные бонус-часы — их вернёт отмена.
            hours_deducted=(slot_bonus_hours if slot_method == "bonus" else quote.hours_deducted),
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
        if slot_method == "subscription":
            subscription_pool.stamp_booking(booking, quote.hours_deducted, quote.extra_hours_deducted)
        session.add(booking)
        created_bookings.append(booking)

    session.add(booking_owner)
    session.commit()
    for b in created_bookings:
        session.refresh(b)
    # Пауза снята этой корзиной — сказать клиенту (после коммита; сбой TG не страшен).
    _notify_pause_lifted(booking_owner, _pause_lift)

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
        # Пауза абонемента снята этой корзиной (владелец 03.10).
        "pause_lifted": bool(_pause_lift),
    }


# ─── Recurring bookings ──────────────────────────────────────────────────────
# IMPORTANT: These must be registered BEFORE /{booking_id} routes so FastAPI
# matches "/recurring" and "/recurring-groups" exactly instead of treating
# them as a booking_id path parameter.

# Жёсткий потолок длины серии (аудит 2026-08-27): create не имел границы вовсе,
# а extend капал 52 ЗА ВЫЗОВ, но суммарно — бесконечно. Так у одного клиента
# выросла серия из 501 брони до мая 2027 (и размножила испорченный шаблон).
# 104 = два года еженедельных встреч — за глаза для любого реального сценария.
SERIES_MAX_OCCURRENCES = 104


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
    # Пропустить занятые даты и создать остальные. По умолчанию False — серия
    # атомарна (как раньше). Клиент сначала получает 409 со списком конфликтов,
    # показывает их человеку и повторяет запрос с skip_conflicts=True по кнопке
    # «Создать остальные» — чтобы пропуск был осознанным, а не молчаливым.
    skip_conflicts: bool = False
    target_user_id: Optional[str] = None
    crm_client_id: Optional[str] = None


@router.post("/recurring/quote")
def quote_recurring_booking(
    *,
    session: Session = Depends(deps.get_session),
    data: RecurringBookingRequest,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """«Примерка» серии (аудит 30.08): ТА ЖЕ математика, что у создания —
    PricingService по каждой дате + resolve_payment_method — но без единой
    записи: ни броней, ни списаний, ни блокировок. Мобильный мастер
    показывает точную сумму ДО кнопки «Забронировать» вместо «цена × N»
    (недельная скидка и пиковая надбавка зависят от конкретной даты).
    Доступность дат тут не проверяется — конфликты как и раньше решает 409
    самого создания."""
    deps.require_can_book(current_user)
    from app.services.pricing import PricingService, resolve_payment_method

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

    try:
        first = datetime.strptime(data.first_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")
    n = data.occurrences if data.occurrences is not None else data.weeks
    if n < 1 or n > SERIES_MAX_OCCURRENCES:
        raise HTTPException(
            400,
            f"Число повторений должно быть от 1 до {SERIES_MAX_OCCURRENCES} (запрошено {n}).",
        )
    step = {"weekly": 1, "biweekly": 2, "monthly": 4}.get(data.pattern.lower(), 1)
    dates = [first + timedelta(weeks=i * step) for i in range(n)]

    pricing_service = PricingService(session)
    items = []
    total_money = 0.0
    total_hours = 0.0
    total_bonus_hours = 0.0
    warnings = []
    # Бонусные часы — только ЧИТАЕМ остаток и «тратим» его локально по датам,
    # как это сделает создание серии (бонус → абонемент → баланс).
    from app.services.bonus_service import available_free_hours
    _bonus_left = available_free_hours(session, booking_owner.id)
    # Пауза абонемента (владелец 03.10): создание серии снимет паузу, если
    # хотя бы одна дата пошла бы часами — примерка показывает ровно это
    # (пул после снятия подставлен только на время расчёта, ничего не пишем).
    _pause_trial = _pause_lift_trial(
        session, pricing_service, booking_owner, data.payment_method,
        [(data.resource_id, _slot_start(d, data.start_time), data.duration, data.format) for d in dates],
        bonus_left=_bonus_left,
    )
    with (_pool_swapped(session, booking_owner, _pause_trial[0]) if _pause_trial
          else contextlib.nullcontext()):
        for d in dates:
            try:
                h, m = map(int, data.start_time.split(":"))
                start_dt = d.replace(hour=h, minute=m, second=0, microsecond=0)
            except Exception:
                start_dt = d
            quote = pricing_service.calculate_price(
                user=booking_owner,
                resource_id=data.resource_id,
                start_time=start_dt,
                duration_minutes=data.duration,
                format_type=data.format,
            )
            occ_method, quote, occ_bonus = _resolve_with_bonus(
                session, pricing_service, booking_owner, data.payment_method, quote,
                resource_id=data.resource_id,
                start_dt=start_dt,
                duration_minutes=data.duration,
                format_type=data.format,
                bonus_left=_bonus_left,
                consume=False,
            )
            _bonus_left = max(0.0, _bonus_left - occ_bonus)
            total_bonus_hours += occ_bonus
            if occ_method == "subscription" and quote.applied_rule != "SUBSCRIPTION":
                # Создание на такой дате упало бы 400 — честно помечаем и считаем
                # деньгами (так поведёт себя клиент, переключив способ оплаты).
                warnings.append(d.strftime("%Y-%m-%d"))
                occ_method = "balance"
            if occ_method == "subscription":
                # Часы — с абонемента; final_price у SUBSCRIPTION-котировки — это
                # ДЕНЬГИ пиковой надбавки (может быть 0), их тоже показываем.
                hours = float(quote.hours_deducted or 0)
                amount = float(quote.final_price or 0)
            else:
                hours = 0.0
                amount = float(quote.final_price or 0)
            total_hours += hours
            total_money += amount
            items.append({
                "date": d.strftime("%Y-%m-%d"),
                "method": occ_method,
                "amount": round(amount, 2),
                "hours": hours,
                # Из hours — часы доп. пула (капсула / «индивидуально»), прикидка.
                "extra_hours": float(quote.extra_hours_deducted or 0) if occ_method == "subscription" else 0.0,
                "bonus_hours": occ_bonus,
            })

    return {
        "ok": True,
        "occurrences": n,
        "items": items,
        "total_money": round(total_money, 2),
        "total_hours": round(total_hours, 2),
        "total_bonus_hours": round(total_bonus_hours, 2),
        "subscription_short_dates": warnings,
        # Абонемент на паузе, и серия снимет паузу (владелец 03.10).
        "pause_lift": bool(_pause_trial),
    }


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

    from app.services.pricing import PricingService, resolve_payment_method
    from app.services.billing_defer import subscription_money_due
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
    if n < 1 or n > SERIES_MAX_OCCURRENCES:
        raise HTTPException(
            400,
            f"Число повторений должно быть от 1 до {SERIES_MAX_OCCURRENCES} "
            f"(запрошено {n}). Для более длинной регулярности продлевайте серию позже.",
        )

    pattern = data.pattern.lower()
    if pattern == "biweekly":
        dates = [first + timedelta(weeks=i * 2) for i in range(n)]
    elif pattern == "monthly":
        # «Раз в 4 недели» (ровно 28 дней) — день недели фиксируется.
        # Календарный месяц (relativedelta) сдвигал бы день недели, а владельцу
        # нужно, чтобы серия всегда попадала на тот же день недели/час.
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

    skipped_dates: list[dict] = []
    if conflicts:
        if not data.skip_conflicts:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"Конфликт в {len(conflicts)} из {len(dates)} дат",
                    "conflicts": conflicts,
                },
            )
        # Пропускаем занятые даты и создаём остальные (клиент подтвердил кнопкой).
        _busy = {c["date"] for c in conflicts}
        create_dates = [d for d in create_dates if d.strftime("%Y-%m-%d") not in _busy]
        skipped_dates = conflicts
        if not create_dates and not anchor_booking:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Все даты серии заняты — создавать нечего",
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
    # Даты, где пуш в личный календарь нашёл «почти совпадающее» событие и
    # НЕ стал создавать второе (Этап 1: сигнал вместо тихого дубля).
    _gcal_mirror_conflicts: list[str] = []
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

    # ── Этап 2 календарного плана (27.08): серия = ОДНО повторяющееся событие ──
    # Вместо N одиночных событий создаём один Google-recurring (RRULE) и заранее
    # знаем instance-id каждой даты. Только для «чистой» серии: равный шаг
    # (weekly/biweekly/monthly), без пропущенных конфликтов и якоря, и первая
    # дата не пересекается с ручным событием специалиста (probe). Иначе —
    # прежний по-датный пуш с дедупом (Этап 1).
    _series_instance_ids: dict = {}
    if crm_calendar_id and crm_client_obj and not skipped_dates and not anchor_booking and len(dates) >= 2:
        _iw = {"weekly": 1, "biweekly": 2, "monthly": 4}.get(pattern)
        if _iw:
            try:
                from app.services.crm_calendar import (
                    find_matching_event as _fme,
                    create_recurring_event as _cre,
                    tbilisi_naive_to_utc_naive as _tb2utc,
                )
                _h0, _m0 = map(int, data.start_time.split(":"))
                _first_utc = _tb2utc(dates[0].replace(hour=_h0, minute=_m0, second=0, microsecond=0))
                _ev0, _st0 = _fme(
                    crm_calendar_id, crm_client_obj.name, crm_client_obj.alias_code,
                    _first_utc, data.duration,
                )
                if _st0 is None:
                    _master_id, _inst_ids = _cre(
                        calendar_id=crm_calendar_id,
                        client_name=crm_client_obj.name,
                        alias_code=crm_client_obj.alias_code,
                        first_date=_first_utc,
                        duration_minutes=data.duration,
                        count=len(dates),
                        interval_weeks=_iw,
                        booking_group_id=recurring_group_id,
                    )
                    _series_instance_ids = {
                        dts.strftime("%Y-%m-%d"): iid for dts, iid in zip(dates, _inst_ids)
                    }
                    logger.info(
                        "[recurring gcal] серия одним recurring-событием %s (%d дат)",
                        _master_id, len(dates),
                    )
                # exact/near на первой дате → по-датный путь Этапа 1 разберётся
            except Exception:
                logger.warning("[recurring gcal] recurring master не создан — по-датный путь", exc_info=True)

    # Adopt the anchor into the new series (idempotent UPDATE — no extra
    # booking, no duplicate balance debit, no GCal duplicate).
    if anchor_booking is not None:
        anchor_booking.recurring_group_id = recurring_group_id
        anchor_booking.updated_at = datetime.now()
        session.add(anchor_booking)
        created_bookings.append(str(anchor_booking.id))

    # Бонусные часы клиента тратятся по датам серии, пока хватает на встречу
    # целиком (порядок оплаты владельца 29.09: бонус → абонемент → баланс).
    from app.services.bonus_service import available_free_hours
    _bonus_left = available_free_hours(session, booking_owner.id)

    # Пауза абонемента (владелец 03.10): один раз до цикла — если хотя бы одна
    # дата серии при снятой паузе пошла бы часами. Дальше обычный расчёт.
    _pause_lift = _lift_pause_for_booking(
        session, PricingService(session), booking_owner, current_user, data.payment_method,
        [(data.resource_id, _slot_start(d, data.start_time), data.duration, data.format) for d in create_dates],
        bonus_left=_bonus_left,
    )

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

        # Ярлык — по каждому вхождению серии: часы абонемента могут кончиться
        # в середине, и остаток серии честно уйдёт на баланс.
        occ_method, quote, occ_bonus_hours = _resolve_with_bonus(
            session, pricing_service, booking_owner, data.payment_method, quote,
            resource_id=data.resource_id,
            start_dt=start_dt,
            duration_minutes=data.duration,
            format_type=data.format,
            bonus_left=_bonus_left,
        )
        _bonus_left = max(0.0, _bonus_left - occ_bonus_hours)
        _occ_id = gen_uuid4()  # заранее — для ref_id строк ленты

        if occ_method == "subscription":
            if quote.applied_rule != "SUBSCRIPTION":
                raise HTTPException(
                    400, f"Subscription insufficient for {d.strftime('%Y-%m-%d')}"
                )
            if not defer_charge and booking_owner.subscription:
                booking_owner.subscription = subscription_pool.debit_hours(
                    booking_owner.subscription, quote.hours_deducted, extra=quote.extra_hours_deducted)
                # Денежная часть встречи по абонементу (пиковая надбавка) — вместе
                # с часами, как одиночная бронь (единое правило billing_defer).
                # Ревизия 03.10: раньше первая (немедленная) встреча серии пик не
                # снимала, а отмена его «возвращала».
                _occ_money = subscription_money_due(quote.final_price)
                if _occ_money >= 0.01:
                    wallet.debit(session, booking_owner, _occ_money, reason="booking_charge",
                                 description=f"Пиковая надбавка абонемента (серия {d.strftime('%Y-%m-%d')})",
                                 ref_type="booking", ref_id=str(_occ_id))
        else:
            if not defer_charge:
                available_funds = booking_owner.balance + booking_owner.credit_limit
                if available_funds < quote.final_price:
                    raise HTTPException(
                        400,
                        f"Insufficient funds for {d.strftime('%Y-%m-%d')}. Required: {quote.final_price}, Available: {available_funds}",
                    )
                wallet.debit(session, booking_owner, quote.final_price, reason="booking_charge",
                             description=f"Оплата брони с баланса (серия {d.strftime('%Y-%m-%d')})",
                             ref_type="booking", ref_id=str(_occ_id))

        session.add(booking_owner)

        booking = Booking(
            id=_occ_id,
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
            # Бонусная встреча хранит потраченные бонус-часы — их вернёт отмена.
            hours_deducted=(
                quote.hours_deducted if occ_method == "subscription"
                else (occ_bonus_hours or None) if occ_method == "bonus"
                else None
            ),
            payment_method=occ_method,
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
        if occ_method == "subscription":
            subscription_pool.stamp_booking(booking, quote.hours_deducted, quote.extra_hours_deducted)
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
                # Счёт НЕ копируем (01.10): у неоплаченной сессии пустой счёт
                # = «взять счёт клиента по умолчанию в момент оплаты». Копия
                # при создании «замораживала» старый счёт после его смены
                # (кейс «Андрей и Надежда»: платёж ушёл на Cash вместо TBC).
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
                    # account не заполняем: пусто = счёт клиента по умолчанию
                    # на момент оплаты (см. комментарий выше).
                    is_booked=True,
                    booking_id=str(booking.id),
                    recurring_group_id=crm_session_group_id,
                )
                # Mirror the cabinet GCal event into the specialist's personal
                # CRM calendar too, so a session shows up under the client's
                # name (not just "Кабинет 8 — Микола") in their day view.
                if crm_calendar_id and _series_instance_ids:
                    # Этап 2: серия уже создана одним recurring-событием —
                    # сессия получает заранее известный instance-id.
                    _iid = _series_instance_ids.get(d.strftime("%Y-%m-%d"))
                    if _iid:
                        _clash = session.exec(
                            select(_TS).where(_TS.google_event_id == _iid)
                        ).first()
                        if _clash is None:
                            ts.google_event_id = _iid
                elif crm_calendar_id:
                    try:
                        # Этап 1 (27.08): пуш С ПОИСКОМ. Если специалист уже
                        # держит в Google свою (в т.ч. повторяющуюся) встречу
                        # на этот слот — привязываемся к ней, а не ставим
                        # рядом вторую (так рождались дубли «Алёна грум»).
                        from app.services.crm_calendar import create_or_link_event as _crm_push
                        _res = _crm_push(
                            calendar_id=crm_calendar_id,
                            client_name=crm_client_obj.name,
                            alias_code=crm_client_obj.alias_code,
                            session_date=session_date,
                            duration_minutes=data.duration,
                            session_id=str(ts.id) if ts.id else None,
                            booking_id=str(booking.id),
                        )
                        if _res["action"] == "conflict":
                            _gcal_mirror_conflicts.append(d.strftime("%d.%m"))
                        else:
                            _gid = _res["event_id"]
                            _clash = session.exec(
                                select(_TS).where(_TS.google_event_id == _gid)
                            ).first() if _gid else None
                            if _clash is None and _gid:
                                ts.google_event_id = _gid
                    except Exception as e:
                        logger.warning(f"CRM GCal push failed for recurring {d}: {e}")
                session.add(ts)

        total_cost += quote.final_price
        created_bookings.append(str(booking.id))

    session.commit()
    # Пауза снята этой серией — сказать клиенту (после коммита, в фоне).
    _notify_pause_lifted(booking_owner, _pause_lift, background_tasks)

    # Сигнал специалисту о датах, где пуш в календарь встретил «почти дубль»
    # и не стал создавать второе событие (Этап 1 календарного плана).
    if _gcal_mirror_conflicts and booking_owner is not None:
        try:
            from app.models.notification import Notification as _NotifGC
            session.add(_NotifGC(
                type="calendar_conflict",
                title="Календарь: возможные дубли в серии",
                description=(
                    f"Даты: {', '.join(_gcal_mirror_conflicts[:8])}"
                    f"{'…' if len(_gcal_mirror_conflicts) > 8 else ''}. "
                    "Рядом уже стояли события в Google — вторые НЕ созданы. "
                    "Проверьте время в календаре и в CRM."
                ),
                recipient_id=str(booking_owner.id),
                icon="AlertTriangle",
                link="/crm/sessions",
            ))
            session.commit()
        except Exception:
            logger.warning("[recurring] conflict notification failed", exc_info=True)

    # Скидка за смежные часы для СЕРИИ. Одиночная бронь и мульти-слот уже
    # пересчитывают цепочку (recompute_user_chains_for_day), а серия — нет:
    # новая бронь получала скидку от calculate_price, а её сосед по времени
    # (созданный раньше) оставался по полной цене. Реальный случай: Наталья
    # Ященко 12.08 — 11:00 за 18₾ (−10%), смежная 12:00 за 20₾ → админ внесла
    # 36₾ за «два часа со скидкой», а списалось 38₾ и возник минус.
    # Пересчитываем цепочки по каждому затронутому дню.
    if data.payment_method == "balance":
        try:
            from app.services.consecutive_pricing import recompute_user_chains_for_day
            for _d in create_dates:
                recompute_user_chains_for_day(
                    session,
                    booking_owner,
                    data.resource_id,
                    _d,
                    actor_id=str(current_user.id),
                    actor_role=current_user.role,
                    reason="create_recurring",
                )
            session.commit()
        except Exception:
            logger.exception("[consecutive] recompute on recurring create failed")

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
                "Встреч":    f"{len(created_bookings)} ({ {'weekly': 'еженедельно', 'biweekly': 'раз в 2 нед.', 'monthly': 'раз в 4 нед.'}.get(pattern, pattern) })",
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
        # Даты, которые пропустили как занятые (только при skip_conflicts=True) —
        # клиент показывает их человеку, чтобы он знал, чего в серии нет.
        "skipped": skipped_dates,
        # Пауза абонемента снята этой серией (владелец 03.10).
        "pause_lifted": bool(_pause_lift),
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
        step_days = 28  # «раз в 4 недели» — день недели фиксирован (см. create_recurring_booking)
    else:
        delta_days = (dates_sorted[-1] - dates_sorted[-2]).days if len(dates_sorted) >= 2 else 7
        step_days = 7 if delta_days <= 8 else (14 if delta_days <= 16 else 28)

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

    # Суммарный потолок серии (аудит 2026-08-27): повторные продления по 52
    # складывались без ограничения — так выросла серия из 501 брони.
    if len(existing) + len(new_dates) > SERIES_MAX_OCCURRENCES:
        raise HTTPException(
            400,
            f"Серия не может превышать {SERIES_MAX_OCCURRENCES} встреч: сейчас "
            f"{len(existing)}, добавить можно ещё максимум "
            f"{max(0, SERIES_MAX_OCCURRENCES - len(existing))}.",
        )

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
    ext_crm_calendar_id = None
    _ext_gcal_conflicts: list[str] = []
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
            from app.api.v1.crm import get_crm_calendar_id as _get_crm_cal_ext
            ext_crm_calendar_id = _get_crm_cal_ext(booking_owner)
        else:
            ext_crm_client = None  # other specialist's client — don't touch

    # Create
    # Аудит 2026-08-27: цена/метод каждой новой даты считаются ЖИВЫМ движком,
    # как в create_recurring_booking. Раньше поля копировались из template
    # байт-в-байт — одна испорченная запись (balance + final_price=0 +
    # rule=SUBSCRIPTION из старых пересчётов) размножалась каждым продлением:
    # так выросла серия из 501 нулевой брони до 2027 года. Шаблон остаётся
    # fallback'ом только если движок недоступен (owner не найден/ресурс удалён).
    from app.services.pricing import PricingService as _PS
    _ext_ps = _PS(session)
    created = 0
    total_cost = 0.0
    skipped: list[str] = []
    # Порядок оплаты (владелец 29.09): бонус → абонемент → баланс. Бонусный
    # ярлык шаблона — это результат авто-выбора, а не выбор клиента, поэтому
    # новые даты решаем заново («реши сам» = balance).
    _ext_requested = template.payment_method or "balance"
    if _ext_requested == "bonus":
        _ext_requested = "balance"
    _ext_bonus_left = 0.0
    if booking_owner is not None:
        from app.services.bonus_service import available_free_hours
        _ext_bonus_left = available_free_hours(session, booking_owner.id)
    # Пауза абонемента (владелец 03.10): продление серии — это новые брони.
    # Один раз до цикла: если хотя бы одна новая дата при снятой паузе пошла
    # бы часами — снимаем паузу; дальше обычный пересчёт по датам.
    _pause_lift = _lift_pause_for_booking(
        session, _ext_ps, booking_owner, current_user, _ext_requested,
        [(template.resource_id, _slot_start(d, template.start_time), template.duration,
          template.format or "individual") for d in new_dates],
        bonus_left=_ext_bonus_left,
    )
    for d in new_dates:
        _q = None
        if booking_owner is not None:
            try:
                _h, _m = map(int, (template.start_time or "0:0").split(":"))
                _q = _ext_ps.calculate_price(
                    user=booking_owner,
                    resource_id=template.resource_id,
                    start_time=d.replace(hour=_h, minute=_m, second=0, microsecond=0),
                    duration_minutes=template.duration,
                    format_type=template.format or "individual",
                )
            except Exception:
                logger.exception("[extend-series] пересчёт %s не удался — берём шаблон", d)
        if _q is not None:
            _method, _q, _ext_bonus = _resolve_with_bonus(
                session, _ext_ps, booking_owner, _ext_requested, _q,
                resource_id=template.resource_id,
                start_dt=d.replace(hour=_h, minute=_m, second=0, microsecond=0),
                duration_minutes=template.duration,
                format_type=template.format or "individual",
                bonus_left=_ext_bonus_left,
            )
            _ext_bonus_left = max(0.0, _ext_bonus_left - _ext_bonus)
            _final, _base = _q.final_price, _q.base_price
            _rule = _q.applied_rule
            _damt, _dpct = _q.discount_amount, _q.discount_percent
            _hrs = (
                _q.hours_deducted if _method == "subscription"
                else (_ext_bonus or None) if _method == "bonus"
                else None
            )
            _xhrs = _q.extra_hours_deducted if _method == "subscription" else 0.0
        else:
            # Бонусный шаблон нельзя копировать без движка: вышла бы бронь за
            # 0 ₾ с payment_method='bonus', а бонусный час не списан — комната
            # бесплатно. Такую дату пропускаем, админ добавит её вручную.
            if template.payment_method == "bonus":
                logger.warning("[extend-series] %s пропущена: бонусный шаблон без пересчёта цены", d)
                skipped.append(d.strftime("%d.%m"))
                continue
            _method = template.payment_method
            _final, _base = template.final_price, template.base_price
            _rule = template.applied_rule
            _damt, _dpct = template.discount_amount, template.discount_percent
            _hrs = template.hours_deducted if template.payment_method == "subscription" else None
            _xhrs = subscription_pool.booking_extra(template) if template.payment_method == "subscription" else 0.0
        new_booking = Booking(
            resource_id=template.resource_id,
            location_id=template.location_id,
            date=d,
            start_time=template.start_time,
            duration=template.duration,
            status="confirmed",
            final_price=_final,
            base_price=_base,
            applied_rule=_rule,
            discount_amount=_damt,
            discount_percent=_dpct,
            hours_deducted=_hrs,
            payment_method=_method,
            # Без payment_status бронь остаётся NULL, а крон списания ищет
            # строго 'pending' — такие брони не списываются НИКОГДА (Валентина
            # Ястребова: серия по понедельникам, 5 прошедших занятий на 98 ₾
            # прошли бесплатно, и вся будущая серия ушла бы так же).
            payment_status="pending",
            charged_at=None,
            charge_amount=None,
            format=template.format,
            extras=template.extras or [],
            user_id=template.user_id,
            user_uuid=template.user_uuid,
            crm_client_id=template.crm_client_id,
            recurring_group_id=group_id,
        )
        # Прикидка пула (крон T-24ч пересчитает по живому пулу).
        if _method == "subscription":
            subscription_pool.stamp_booking(new_booking, _hrs, _xhrs)
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
                    _ext_ts = _TS(
                        client_id=str(ext_crm_client.id),
                        specialist_id=str(booking_owner.id),
                        date=session_date,
                        duration_minutes=template.duration,
                        status="PLANNED",
                        price=ext_crm_client.base_price,
                        currency=ext_crm_client.currency,
                        # account не заполняем: пусто = счёт клиента по
                        # умолчанию на момент оплаты.
                        is_booked=True,
                        booking_id=str(new_booking.id),
                        recurring_group_id=ext_session_group_id,
                    )
                    # 01.10: продлённые даты тоже уходят в личный календарь
                    # специалиста (как при создании серии) — пуш С ПОИСКОМ,
                    # «почти совпало» → сигнал, второе событие не создаём.
                    if ext_crm_calendar_id:
                        try:
                            from app.services.crm_calendar import create_or_link_event as _crm_push_ext
                            _res = _crm_push_ext(
                                calendar_id=ext_crm_calendar_id,
                                client_name=ext_crm_client.name,
                                alias_code=ext_crm_client.alias_code,
                                session_date=session_date,
                                duration_minutes=template.duration,
                                session_id=str(_ext_ts.id),
                                booking_id=str(new_booking.id),
                            )
                            if _res["action"] == "conflict":
                                _ext_gcal_conflicts.append(d.strftime("%d.%m"))
                            elif _res.get("event_id"):
                                _clash = session.exec(
                                    select(_TS).where(_TS.google_event_id == _res["event_id"])
                                ).first()
                                if _clash is None:
                                    _ext_ts.google_event_id = _res["event_id"]
                        except Exception as e:
                            logger.warning(f"[extend] CRM GCal push failed for {d}: {e}")
                    session.add(_ext_ts)
            except Exception as e:
                logger.warning(f"[extend] CRM session link failed for {d}: {e}")

        created += 1
        total_cost += new_booking.final_price

    if _ext_gcal_conflicts and booking_owner is not None:
        from app.models.notification import Notification as _NotifExt
        session.add(_NotifExt(
            type="calendar_conflict",
            title="Календарь: возможные дубли в продлении серии",
            description=(
                f"Даты: {', '.join(_ext_gcal_conflicts[:8])}"
                f"{'…' if len(_ext_gcal_conflicts) > 8 else ''}. "
                "Рядом уже стояли события в Google — вторые НЕ созданы. "
                "Проверьте время в календаре и в CRM."
            ),
            recipient_id=str(booking_owner.id),
            icon="AlertTriangle",
            link="/crm/sessions",
        ))

    session.commit()
    # Пауза снята продлением — сказать клиенту (после коммита; сбой TG не страшен).
    _notify_pause_lifted(booking_owner, _pause_lift)

    return {
        "ok": True,
        "created": created,
        "total_cost": round(total_cost, 2),
        "recurring_group_id": group_id,
        "skipped": skipped,
        # Пауза абонемента снята продлением (владелец 03.10).
        "pause_lifted": bool(_pause_lift),
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
    # Аудит 29.09 (G7-admin-core-M1): политика возврата админа — как у одиночной
    # отмены (DELETE /bookings/{id}). Раньше серия всегда возвращалась на 100%,
    # а выбранный в окне отмены штраф 50% / 0% молча терялся. Применяется к
    # каждой отменённой брони; не-админам игнорируется (всегда 100%).
    refund_percent: float = Query(1.0),
    reason: Optional[str] = Query(None),
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

    # Штраф — только админу, как в cancel_booking. Клиент всегда получает 100%.
    if is_admin:
        if refund_percent < 0 or refund_percent > 1:
            raise HTTPException(400, "refund_percent must be between 0 and 1")
        applied_refund = refund_percent
    else:
        applied_refund = 1.0
    admin_reason = (reason or "").strip()
    if is_admin and (applied_refund != 1.0 or admin_reason):
        series_reason = (
            f"{admin_reason or 'Series cancelled'} ({int(applied_refund * 100)}% возврат)"
        )
    else:
        series_reason = "Series cancelled"

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
        # Refund via shared helper (handles balance + subscription). При штрафе
        # 0% — как в одиночной отмене — ничего не возвращаем.
        booking_owner = _resolve_booking_owner(session, b)
        if booking_owner and applied_refund > 0:
            _refund_booking_to_owner(session, b, booking_owner, refund_percent=applied_refund)

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
        b.cancellation_reason = series_reason
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

    return {
        "ok": True,
        "cancelled": cancelled,
        "group_id": group_id,
        "refund_percent": applied_refund,
    }


# ─── Cancel booking ──────────────────────────────────────────────────────────

@router.delete("/{booking_id}", response_model=BookingRead)
def cancel_booking(
    booking_id: str,
    background_tasks: BackgroundTasks,
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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    # SELECT … FOR UPDATE, same as `trim` and `approve`. A plain read let a
    # double-click (or a client retry after a timeout) run two cancellations at
    # once: both saw `confirmed`, both spent seconds inside gcal delete_event,
    # and both then refunded — the second one re-reading the already-credited
    # balance and adding the refund on top. The row lock makes the second
    # request wait, and the `cancelled` short-circuit below then returns cleanly.
    booking = session.exec(
        select(Booking).where(Booking.id == b_uuid).with_for_update()
    ).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    is_owner = _check_ownership(booking, current_user)
    is_admin = current_user.role in ADMIN_ROLES
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

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
                detail="Прошедшую бронь менять нельзя — удалить её может только старший администратор или владелец",
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
    # Scheduled, not awaited: we hold a row lock on the booking here (see the
    # FOR UPDATE above), and a synchronous Google round-trip would keep it —
    # along with a DB connection and a threadpool slot — for seconds.
    if booking.gcal_event_id:
        background_tasks.add_task(
            _gcal_delete_in_background, booking.gcal_event_id, booking.resource_id
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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

    if booking.status != "confirmed":
        raise HTTPException(
            status_code=400, detail="Перенести можно только подтверждённую бронь"
        )

    if _is_past(booking):
        raise HTTPException(
            status_code=400, detail="Нельзя перенести бронь, которая уже прошла"
        )

    # 24h policy — Tbilisi-aware (see _booking_hours_until_start docstring).
    # Клиент переносит сам не позже чем за сутки. Позже — только бесплатным
    # переносом абонемента (владелец 01.10: Тёплый 1, Регулярный 2, Профи+ 3;
    # не позже чем за 3 ч, одиночная бронь, новая дата в сроке абонемента).
    # Администратор переносит всегда и счётчик клиента не тратит.
    hours_until = _booking_hours_until_start(booking)
    late_for_client = hours_until < 24 and not current_user.role in ADMIN_ROLES

    try:
        new_date = datetime.strptime(data.new_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Некорректная дата — нужен формат ГГГГ-ММ-ДД"
        )

    free_reschedule_used = False
    free_reschedules_left_after: Optional[int] = None
    # Слот фактически не меняется (та же дата, время, кабинет) — бесплатный
    # перенос НЕ тратим (ревью 01.10). Проверка — до траты счётчика.
    _late_same_slot = late_for_client and (
        new_date.date() == booking.date.date()
        and data.new_start_time == booking.start_time
        and (data.new_resource_id or booking.resource_id) == booking.resource_id
    )
    if _late_same_slot:
        _late_new_dur = int(data.new_duration) if data.new_duration is not None else booking.duration
        if _late_new_dur != booking.duration:
            # Длительность позже суток клиент не меняет — прежнее правило 24 ч.
            raise HTTPException(
                status_code=400,
                detail=(f"Перенос невозможен менее чем за 24 часа до начала (осталось {hours_until:.1f} ч). "
                        f"Можно выставить бронь на переаренду или написать администратору."),
            )
    if late_for_client and not _late_same_slot:
        from app.services import subscription_perks
        try:
            _nh, _nm = map(int, data.new_start_time.split(":"))
            # Booking.date — полночь дня по Тбилиси, время — по Тбилиси; в UTC −4 ч.
            _new_start_utc = new_date.replace(hour=_nh, minute=_nm) - timedelta(hours=4)
        except Exception:
            _new_start_utc = None
        # Строка владельца брони под замком (как при продаже абонемента):
        # два переноса одновременно не потратят один бесплатный перенос дважды.
        # populate_existing — перечитать пул из БД, а не из кэша сессии.
        _late_owner = None
        if booking.user_uuid:
            _late_owner = session.exec(
                select(User).where(User.id == booking.user_uuid)
                .with_for_update().execution_options(populate_existing=True)
            ).first()
        if _late_owner is None:
            _late_owner = _resolve_booking_owner(session, booking)
        _refusal = subscription_perks.late_reschedule_refusal(
            getattr(_late_owner, "subscription", None),
            hours_until=hours_until, new_start_utc=_new_start_utc, now=datetime.utcnow(),
        )
        if _refusal:
            raise HTTPException(status_code=400, detail=_refusal)
        # Тратим в памяти — в БД уйдёт одним коммитом вместе с переносом;
        # любой отказ ниже (слот занят, не хватает денег) откатит и счётчик.
        _late_owner.subscription = subscription_perks.spend_free_reschedule(_late_owner.subscription)
        session.add(_late_owner)
        free_reschedule_used = True
        free_reschedules_left_after = subscription_perks.free_reschedules_left(_late_owner.subscription)

    new_resource = data.new_resource_id or booking.resource_id
    # Use new_duration when client passes it (mobile reschedule UI), else
    # keep the original duration. Sanity-check: must be >=30 and divisible
    # by 30 to match slot granularity.
    if data.new_duration is not None:
        if data.new_duration < 30 or data.new_duration % 30 != 0:
            raise HTTPException(
                status_code=400,
                detail="Длительность должна быть кратна 30 минутам",
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
            status_code=400, detail=f"Новое время недоступно: {conflict}"
        )

    old_date = booking.date
    old_time = booking.start_time
    old_resource = booking.resource_id
    old_duration = booking.duration

    # ── Price recalculation when room, duration, TIME or DATE changes ──
    # 17.09 (кейс Алёны Ловиц): перенос 18:00 → 19:00 при той же длительности
    # оставлял старую цену 30₾, хотя полчаса уехали в пик 20:00-22:00 (+2.5₾).
    # Пересчёт запускался только при смене кабинета/длительности, а цена
    # зависит ещё и от времени (пиковые окна) и от даты (недельные скидки).
    room_changed = new_resource != booking.resource_id
    duration_changed = new_duration != booking.duration
    time_changed = (data.new_start_time or booking.start_time) != booking.start_time
    date_changed = new_date.date() != booking.date.date()
    old_price = booking.final_price or 0.0
    new_price = old_price
    price_diff = 0.0
    booking_owner = None
    price_recalculated = False

    dropped_extras: list[str] = []

    if room_changed or duration_changed or time_changed or date_changed:
        # Бронь со снятым штрафом: деньги по ней уже улажены (возвращены или
        # не списывались), а final_price остался снимком «до waive». Пересчёт
        # двигал бы деньги от стухшей цены — тот же гейт, что в «Цена»,
        # «Сменить формат», «Сократить», «Разделить» (ревизия денег 17.09).
        if booking.payment_status == "waived":
            raise HTTPException(
                status_code=409,
                detail="У этой брони снят штраф — перенос поменял бы цену. "
                       "Снимите waiver или создайте новую бронь.",
            )
        # Абонемент: смену ДЛИТЕЛЬНОСТИ блокируем — нужен пересчёт часов пула.
        # А перенос в другой КАБИНЕТ/время при той же длительности разрешаем:
        # абонемент уже покрыл этот слот, часы списаны при создании, релокация
        # coverage не меняет. Цену для абонемента НЕ пересчитываем: при
        # исчерпанном пуле calculate_price увидел бы «часов нет» (они уже вычтены
        # этой же бронью) и ошибочно вернул бы полную цену — списал бы деньги.
        if booking.payment_method == "subscription" and duration_changed:
            raise HTTPException(
                status_code=400,
                detail="Нельзя менять длительность для бронирований по абонементу. "
                "Отмените текущее и создайте новое.",
            )
        _check_extra_pool_move(session, booking, new_resource)
        # Бонусная бронь: бонус-часы потрачены при создании под ЭТУ длительность.
        # Другая длительность — надо вернуть/дотратить бонус, а этого пока нет.
        if duration_changed and _bonus_hours_on(booking) > 0:
            raise HTTPException(
                status_code=400,
                detail=_BONUS_RESIZE_DETAIL.format(what="длительность при переносе не меняется"),
            )

        booking_owner = _resolve_booking_owner(session, booking)
        if not booking_owner:
            # Служебные брони (уборка, техработы) владельца не имеют. Раньше в
            # этот блок заходили только смены кабинета/длительности и падали
            # 400; теперь сюда попадает и обычный перенос времени, поэтому для
            # него просто пропускаем пересчёт вместо ошибки.
            if room_changed or duration_changed:
                raise HTTPException(
                    status_code=400,
                    detail="Не удалось определить владельца бронирования для перерасчёта",
                )
            logger.info(
                "[reschedule] booking %s без владельца (служебная) — перенос без пересчёта цены",
                booking.id,
            )

        # Пересчёт цены под новый слот — общим помощником (тот же зовёт перенос
        # серии «эту и следующие»): денежная бронь — движком, бронь по абонементу
        # — разница пиковой надбавки, ушедшая в деньги — ценой деньгами; допы,
        # которые новый кабинет не принимает, снимаются и возвращаются один раз.
        if booking_owner:
            _move = _reprice_for_move(
                session, booking, booking_owner, new_resource=new_resource, new_date=new_date,
                new_start_time=data.new_start_time, new_duration=new_duration, actor=current_user,
            )
            new_price = _move["new_price"]
            price_diff = _move["price_diff"]
            dropped_extras = _move["dropped_extras"]
            price_recalculated = True

    booking.date = new_date
    booking.start_time = data.new_start_time
    booking.resource_id = new_resource
    # Синхронизируем локацию с новым кабинетом — межлокационный перенос (UNI↔ONE,
    # напр. drag) иначе оставлял старый location_id: бронь пропадала из фильтра
    # по филиалу, календарь и уведомления показывали не ту локацию.
    if room_changed:
        from app.models.resource import Resource as _ResLoc
        _nr = session.get(_ResLoc, new_resource)
        if _nr and _nr.location_id:
            booking.location_id = _nr.location_id
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
    _session_move = _sync_linked_session_to_booking(
        session, booking, old_booking_duration=old_duration,
    )
    session.commit()
    if _session_move:
        # 01.10: событие в личном календаре специалиста — вслед за сессией.
        background_tasks.add_task(_push_session_moves_to_gcal_bg, [_session_move])

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
            # Освободившийся (старый) слот — простым объектом, НЕ копией брони.
            # copy.copy() ORM-объекта делит с ним состояние SQLAlchemy: после
            # коммита бронь «протухшая», и запись полей в копию ломала flush
            # сессии (KeyError 'resource_id') — дальше падало событие переноса
            # (500 уже после переезда брони). Найдено сторожем тарифов 01.10.
            from types import SimpleNamespace as _NS
            freed = _NS(id=booking.id, resource_id=old_resource, date=old_date,
                        start_time=old_time, duration=old_duration)
            notify_waitlist_for_freed_slot(session, freed)
        except Exception:
            logger.exception("Failed to notify waitlist on reschedule")

    # ── Уведомить КЛИЕНТА о переносе (Telegram) ──
    # owner 2026-07-17 (admin Лиза): бот молчал при переносе. Метод
    # send_booking_rescheduled уже существовал — его просто не вызывали отсюда.
    if slot_moved:
        try:
            _notify_user = booking_owner or _resolve_booking_owner(session, booking)
            if _notify_user and _notify_user.telegram_id:
                from app.models.resource import Resource as _ResN
                _new_res = session.get(_ResN, new_resource)
                background_tasks.add_task(
                    telegram_service.send_booking_rescheduled,
                    chat_id=str(_notify_user.telegram_id),
                    resource_name=(_new_res.name if _new_res else new_resource),
                    old_date=old_date,
                    old_start_time=old_time,
                    new_date=new_date,
                    new_start_time=data.new_start_time,
                    duration_minutes=booking.duration,
                    booking_id=str(booking.id),
                )
        except Exception:
            logger.warning("[reschedule notify] non-blocking failure", exc_info=True)

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
            # Ревизия 17.09: цену писали только при смене кабинета — при
            # переносе времени (самый частый случай) аудит был слепым.
            "old_price": old_price if price_recalculated else None,
            "new_price": new_price if price_recalculated else None,
            "price_diff": price_diff if price_recalculated else None,
            # Владелец 01.10: перенос позже суток за счёт абонемента.
            "free_reschedule_used": free_reschedule_used,
            "free_reschedules_left": free_reschedules_left_after,
        },
    )
    if free_reschedule_used:
        logger.info("[reschedule] booking %s: бесплатный перенос абонемента (позже 24 ч), осталось %s",
                    booking.id, free_reschedules_left_after)

    # Reset reminder_sent_at so the T-2h reminder fires for the new slot
    # if it's still ≥2h away.
    booking.reminder_sent_at = None
    session.add(booking)
    session.commit()

    # Клиенту о переносе пишет ОДНО сообщение — фоновое, выше (slot_moved).
    # Здесь раньше стояла вторая, синхронная отправка того же текста —
    # клиент получал «Бронь перенесена» дважды (план тарифов 01.10).

    if dropped_extras:
        logger.info(
            f"[Reschedule] Dropped {len(dropped_extras)} extras incompatible "
            f"with new room {new_resource}: {dropped_extras}. Refunded user balance."
        )
    return booking


def _move_funds_check(owner: User, extra: float) -> None:
    """Доплата при переносе денежной брони — только если хватает баланса и лимита."""
    available_funds = float(owner.balance or 0) + float(owner.credit_limit or 0)
    if available_funds < extra:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно средств для перерасчёта. "
            f"Доплата: {extra}₾, доступно: {available_funds}₾.",
        )


def _reprice_for_move(
    session: Session, booking: Booking, owner: Optional[User], *, new_resource: str, new_date: datetime,
    new_start_time: str, new_duration: int, actor: Optional[User] = None,
) -> dict:
    """Цена брони под новый слот: перенос одной брони и «эту и следующие» в серии.

    Ревизия 03.10: перенос не пересчитывал денежную часть брони по абонементу
    (перенос 18:00 → 20:00 оставлял пик 0 ₾, обратный — 5 ₾), а перенос серии
    двигал следующие встречи вообще без пересчёта (якорь 25 ₾ в пик, остальные
    20 ₾). Теперь одно правило:
      • денежная бронь (balance/bonus): движок на новый слот (без абонемента —
        бронь денежная), бонусная — непокрытая доля, + допы, что едут с бронью;
      • по абонементу с часами: часы едут как есть, денежная часть меняется на
        разницу пиковой надбавки (старый слот → новый), минус снятые допы;
      • по абонементу, ушедшая в деньги (hours_deducted = 0): цена деньгами на
        новый слот, как запасной путь крона, по charge_amount;
      • допы, которые новый кабинет не принимает, снимаются с брони и уходят
        из цены ровно один раз (раньше — дважды: 25 ₾ → 15 ₾ и +10 ₾).
    Оплаченная бронь: разница — через wallet с ref_id брони (у денежной — с
    проверкой средств, 400 до любых движений). Не списанная (pending): только
    цена, крон возьмёт новую. Waived и запреты переноса проверяет вызывающий.
    Без владельца (служебная бронь) — только снятые допы. Не коммитит."""
    from app.services.pricing import PricingService, booking_extras_money
    old_price = round(float(booking.final_price or 0), 2)
    method = (booking.payment_method or "balance").lower()
    paid = (booking.payment_status or "paid") == "paid"
    ref = str(booking.id)

    extras_money = booking_extras_money(booking)
    kept_extras: list = list(booking.extras or [])
    dropped_extras: list = []
    if booking.extras and new_resource != booking.resource_id:
        from app.models.resource import Resource as _ResModel
        new_res_obj = session.get(_ResModel, new_resource)
        kept_extras = []
        for eid in (booking.extras or []):
            ok = True
            if new_res_obj:
                if new_res_obj.type == "capsule" and eid != "coffee_meama":
                    ok = False
                elif eid in ("sandbox", "projector", "couch") and eid not in (new_res_obj.services or []):
                    ok = False
            (kept_extras if ok else dropped_extras).append(eid)
    dropped_money = round(min(PricingService.calculate_extras_price(dropped_extras), extras_money), 2)
    kept_extras_money = round(extras_money - dropped_money, 2)

    try:
        _h, _m = map(int, new_start_time.split(":"))
        new_start_dt = new_date.replace(hour=_h, minute=_m, second=0, microsecond=0)
    except Exception:
        new_start_dt = new_date
    try:
        _oh, _om = map(int, (booking.start_time or "0:0").split(":"))
        old_start_dt = booking.date.replace(hour=_oh, minute=_om, second=0, microsecond=0)
    except Exception:
        old_start_dt = booking.date
    peak_delta = round(PricingService.subscription_peak_money(new_start_dt, new_duration)
                       - PricingService.subscription_peak_money(old_start_dt, int(booking.duration or 0)), 2)

    price_diff = 0.0
    if owner is None:
        new_price = round(max(0.0, old_price - dropped_money), 2)
    elif method == "subscription" and not _subscription_money_row(booking):
        new_price = round(max(0.0, old_price + peak_delta - dropped_money), 2)
        price_diff = round(new_price - old_price, 2)
        if paid and abs(price_diff) >= 0.01:
            wallet.apply(session, owner, -price_diff, reason="move_peak_diff",
                         description=("Перенос брони по абонементу: разница пиковой надбавки"
                                      + (" и снятые допы" if dropped_money >= 0.01 else "")),
                         ref_type="booking", ref_id=ref, actor=actor)
    elif method == "subscription":
        quote = PricingService(session).calculate_price(
            user=owner, resource_id=new_resource, start_time=new_start_dt, duration_minutes=new_duration,
            format_type=booking.format or "individual", exclude_booking_id=str(booking.id),
            subscription_hours_cover=False,
        )
        new_cash = round(float(quote.final_price or 0) + kept_extras_money, 2)
        old_cash = round(float(booking.charge_amount if booking.charge_amount is not None else old_price), 2)
        price_diff = round(new_cash - old_cash, 2)
        if price_diff > 0:
            _move_funds_check(owner, price_diff)
        if abs(price_diff) >= 0.01:
            wallet.apply(session, owner, -price_diff, reason="move_cash_diff",
                         description="Перенос брони по абонементу, оплаченной деньгами: разница цены",
                         ref_type="booking", ref_id=ref, actor=actor)
        booking.charge_amount = new_cash
        new_price = round(max(0.0, old_price + peak_delta - dropped_money), 2)
    else:
        new_quote = PricingService(session).calculate_price(
            user=owner,
            resource_id=new_resource,
            start_time=new_start_dt,
            duration_minutes=new_duration,
            format_type=booking.format,
            # Ревизия 17.09: без exclude сама переносимая бронь попадала в
            # «соседей» по СТАРОМУ времени — перенос 18:00→19:00 в том же
            # кабинете стыковался встык со своим старым слотом и дарил
            # скидку за 2 часа подряд. Как в trim/extend/split.
            exclude_booking_id=str(booking.id),
            # Аудит 2026-08-27: бронь ДЕНЕЖНАЯ. Без ignore движок при
            # свежекупленном абонементе вернул бы SUBSCRIPTION/0₾ — и родилась бы
            # «нулёвка» balance+0 (сигнатура утечки 1630₾). Перевод на абонемент —
            # только явной кнопкой.
            ignore_subscription=True,
        )
        # Бонусная бронь: её бонус-часы едут вместе с ней и покрывают ту же долю
        # — деньгами считаем только непокрытое (как при создании). Допы, что
        # едут с бронью, остаются в цене (снятые уходят — их возврат в разнице).
        new_price = round(_bonus_uncovered_price(booking, new_quote.final_price, new_duration)
                          + kept_extras_money, 2)
        price_diff = round(new_price - old_price, 2)
        # `pending` bookings haven't been charged yet — the T-24h cron will
        # capture the (new) final_price in full. Touching the balance here would
        # double-charge on a price increase (or hand a phantom refund on a
        # decrease). Paid (and NULL=legacy-paid) settle the diff immediately.
        if paid:
            if price_diff > 0:
                _move_funds_check(owner, price_diff)
                wallet.debit(session, owner, price_diff, reason="reschedule_diff",
                             description="Доплата при переносе (цена выросла)",
                             ref_type="booking", ref_id=ref, actor=actor)
            elif price_diff < 0:
                wallet.credit(session, owner, abs(price_diff), reason="reschedule_diff",
                              description="Возврат при переносе (цена упала)",
                              ref_type="booking", ref_id=ref, actor=actor)
            # charge_amount — реально списанное — двигаем на дельту (как в
            # /extend, /trim, /format). Раньше здесь не обновлялось → он
            # расходился с final_price навсегда и портил будущие возвраты
            # (waive, перевод на абонемент) и дашборд. Для pending не трогаем:
            # там charge_amount ещё None, крон проставит полную новую цену.
            booking.charge_amount = round(
                float(booking.charge_amount if booking.charge_amount is not None else old_price)
                + price_diff, 2
            )
        # Update booking price fields
        booking.base_price = new_quote.base_price
        booking.applied_rule = new_quote.applied_rule
        booking.discount_amount = new_quote.discount_amount
        booking.discount_percent = new_quote.discount_percent

    booking.final_price = new_price
    if dropped_extras:
        booking.extras = kept_extras
    return {"old_price": old_price, "new_price": new_price, "price_diff": price_diff,
            "dropped_extras": dropped_extras}


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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    # Lock the row (SELECT FOR UPDATE) so two concurrent trims/cancels on the
    # same booking serialize — otherwise both read the original duration and
    # produce inconsistent remnants / a double refund.
    booking = session.exec(
        select(Booking).where(Booking.id == b_uuid).with_for_update()
    ).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    is_owner = _check_ownership(booking, current_user)
    is_admin = current_user.role in ADMIN_ROLES
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

    if booking.status == "cancelled":
        raise HTTPException(status_code=400, detail="Бронь уже отменена")

    if booking.status == "pending_approval":
        raise HTTPException(
            status_code=400,
            detail="Нельзя редактировать бронь, ожидающую подтверждения",
        )

    # Бонусная бронь: ни денежная, ни абонементная ветка ниже её не знают —
    # остатки получили бы полную цену (крон списал бы её), а вырезанные
    # бонус-часы не вернулись бы клиенту.
    if _bonus_hours_on(booking) > 0:
        raise HTTPException(
            status_code=400,
            detail=_BONUS_RESIZE_DETAIL.format(what="часть времени из неё не вырезать"),
        )
    if _subscription_money_row(booking):
        raise HTTPException(status_code=409, detail=_MONEY_ROW_DETAIL.format(what="вырезать из неё часть нельзя"))

    # ── Past booking protection (same message as cancel) ──
    if _is_past(booking) and current_user.role not in ("senior_admin", "owner"):
        raise HTTPException(
            status_code=403,
            detail="Прошедшую бронь менять нельзя — удалить её может только старший администратор или владелец",
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
            # Аудит 2026-08-27: для ДЕНЕЖНОЙ брони остаток должен котироваться
            # деньгами, даже если у клиента к этому моменту появился абонемент —
            # иначе остаток получает final_price=0 при payment_method=balance
            # («нулёвка», крон спишет 0). Абонементная бронь котируется как есть.
            ignore_subscription=(booking.payment_method or "").lower() != "subscription",
        )

    leftQuote = _quote_for(bStart, left) if left > 0 else None
    rightQuote = _quote_for(cTo, right) if right > 0 else None

    # Абонементная бронь: часы остатка — от ЧАСОВ ИСХОДНОЙ брони, а не от живого
    # пула. Котировка идёт по пулу, из которого часы этой брони уже списаны, и
    # при пустом пуле (а у Группового мастера индивидуальная бронь основной пул
    # не покрывает НИКОГДА) вернула бы «не абонемент»: остаток превращался в
    # бесплатный (часы 0, цена деньгами без списания), а все часы возвращались
    # в пул — трюк повторяем (ревизия доп. пула 01.10). Пропорциональная доля и
    # пропорциональная пиковая надбавка — как в сокращении (shorten_booking).
    if (booking.payment_method or "").lower() == "subscription":
        _orig_h = float(booking.hours_deducted if booking.hours_deducted is not None else (booking.duration / 60))
        for _q, _dur in ((leftQuote, left), (rightQuote, right)):
            if _q is not None and _dur > 0 and _q.applied_rule != "SUBSCRIPTION":
                _ratio = _dur / booking.duration
                _q.applied_rule = "SUBSCRIPTION"
                _q.hours_deducted = round(_orig_h * _ratio, 4)
                _q.extra_hours_deducted = 0.0
                _q.final_price = round(float(booking.final_price or 0) * _ratio, 2)
                _q.discount_amount = 0.0
                _q.discount_percent = 0

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
            wallet.credit(session, owner, removed_value, reason="trim_refund",
                          description="Возврат за отрезанное время брони",
                          ref_type="booking", ref_id=str(booking.id), actor=current_user)
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
        # Доп. пул (часы капсулы / «индивидуально»): при создании он тратился
        # ПЕРВЫМ, значит отрезанные часы — это сначала часы основного пула,
        # и только когда их не хватает — доп. («последним пришёл — первым
        # ушёл»). Оставшимся частям — остаток доп. часов по порядку.
        orig_extra = subscription_pool.booking_extra(booking)
        removed_extra = 0.0
        if removed_hours > 0:
            removed_extra = round(min(orig_extra, max(0.0, removed_hours - (float(orig_hours) - orig_extra))), 4)
        trim_extra_left = round(orig_extra - removed_extra, 4)
        # Refund the removed hours to the pool: bump remaining_hours, drop
        # used_hours (floored at 0) — subscription_pool keeps both dialects.
        if (not pending and removed_hours > 0 and owner and owner.subscription
                and subscription_pool.hours_return_allowed(owner.subscription, booking.date)):
            owner.subscription = subscription_pool.credit_hours(
                owner.subscription, removed_hours, extra=removed_extra, kind=_pool_kind(session, booking))
            session.add(owner)
        # Peak-hour surcharge on a subscription booking is charged to BALANCE at
        # creation (final_price = subscription_peak_debt). If the trimmed slice
        # included peak hours, that money must be refunded too — hours alone
        # would silently keep the peak surcharge.
        removed_peak_money = round((booking.final_price or 0) - new_total_price, 2)
        if not pending and removed_peak_money > 0 and owner:
            wallet.credit(session, owner, removed_peak_money, reason="trim_refund",
                          description="Возврат пиковой надбавки за отрезанное время",
                          ref_type="booking", ref_id=str(booking.id), actor=current_user)

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
    _kept_extra = 0.0
    if booking.payment_method == "subscription":
        booking.hours_deducted = kept_quote.hours_deducted
        _kept_extra = round(min(trim_extra_left, float(kept_quote.hours_deducted or 0)), 4)
        subscription_pool.stamp_booking(booking, booking.hours_deducted, _kept_extra)
    # charge_amount = what this row is actually holding of the client's money.
    # It used to be re-stamped only for `pending` rows, so a PAID booking kept
    # the pre-trim figure: trim 12:00-18:00 (charged 120₾) down to 13:00-15:00,
    # get 40₾ back — and a later waive still refunded the full 120₾, gifting the
    # client the 40₾ twice. Subscription rows are left alone: there charge_amount
    # carries the hours snapshot and the refund path keys off hours_deducted.
    if pending or booking.payment_method == "balance":
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
            # Same reasoning as the kept remnant above: for a paid balance row
            # this half is holding rightQuote.final_price of the client's money,
            # so say so instead of leaving it None (a None sends refunds back to
            # the stale final_price fallback).
            charge_amount=(
                rightQuote.final_price
                if (pending or booking.payment_method == "balance")
                else None
            ),
            charged_at=(None if pending else booking.charged_at),
            crm_client_id=None,  # keep the CRM link only on the original
            recurring_group_id=None,
            gcal_event_id=None,
        )
        if booking.payment_method == "subscription":
            subscription_pool.stamp_booking(
                new_remnant, new_remnant.hours_deducted,
                min(round(trim_extra_left - _kept_extra, 4), float(new_remnant.hours_deducted or 0)))
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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")
    if not booking.recurring_group_id:
        raise HTTPException(
            status_code=400,
            detail="Эта бронь не входит в серию — переносите её как одиночную",
        )

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

    # Серию «эту и следующие» клиент позже суток не переносит: бесплатный
    # перенос абонемента (владелец 01.10) — только для одной брони. Без этой
    # проверки вызов reschedule_booking ниже потратил бы его на всю серию.
    if current_user.role not in ADMIN_ROLES:
        _anchor_hours = _booking_hours_until_start(booking)
        if _anchor_hours < 24:
            raise HTTPException(
                status_code=400,
                detail=(f"Серию нельзя перенести менее чем за 24 часа до начала (осталось {_anchor_hours:.1f} ч). "
                        f"Перенесите эту бронь отдельно или напишите администратору."),
            )

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
    _series_session_moves: list = []
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
        # Встреча со снятым штрафом: перенос поменял бы её цену, а деньги по ней
        # уже улажены — как одиночный перенос (409), пропускаем.
        if sib.payment_status == "waived":
            skipped.append({"id": str(sib.id), "date": sib.date.isoformat(),
                            "reason": "у брони снят штраф — перенесите её отдельно"})
            continue
        # Встреча, оплаченная часами капсулы / «индивидуально», в помещение
        # другого вида не едет (см. _check_extra_pool_move) — пропускаем её.
        try:
            _check_extra_pool_move(session, sib, new_resource)
        except HTTPException as _xe:
            skipped.append({"id": str(sib.id), "date": sib.date.isoformat(), "reason": _xe.detail})
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

        # Цена встречи под новый слот — тем же помощником, что у якоря (ревизия
        # 03.10: раньше следующие встречи ехали без пересчёта — якорь в пике
        # 25 ₾, остальные 20 ₾; у абонементной — пик 0 ₾ на всех). Не хватает
        # денег на доплату — встречу пропускаем, админ решит вручную.
        try:
            _sib_price = _reprice_for_move(
                session, sib, _resolve_booking_owner(session, sib), new_resource=new_resource,
                new_date=sib.date, new_start_time=data.new_start_time, new_duration=int(sib.duration or 0),
                actor=current_user,
            )
        except HTTPException as _pe:
            skipped.append({"id": str(sib.id), "date": sib.date.isoformat(), "reason": _pe.detail})
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
                "old_price": _sib_price["old_price"],
                "new_price": _sib_price["new_price"],
                "price_diff": _sib_price["price_diff"],
            },
        )

        session.add(sib)
        # Sync sibling's linked CRM session (if any) onto the new time.
        # Helper is no-commit; we batch with the single commit below.
        _sib_move = _sync_linked_session_to_booking(session, sib)
        if _sib_move:
            _series_session_moves.append(_sib_move)
        propagated += 1

    session.commit()
    if _series_session_moves:
        background_tasks.add_task(_push_session_moves_to_gcal_bg, _series_session_moves)

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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

    if data.crm_client_id:
        from app.models.therapist_client import TherapistClient

        client = session.get(TherapistClient, data.crm_client_id)
        if not client:
            raise HTTPException(status_code=404, detail="Клиент CRM не найден")
        if client.specialist_id != str(current_user.id):
            raise HTTPException(
                status_code=403, detail="Этот клиент CRM принадлежит другому специалисту"
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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

    if booking.status != "confirmed":
        raise HTTPException(
            status_code=400,
            detail="На переаренду можно выставить только подтверждённую бронь",
        )

    if _is_past(booking):
        raise HTTPException(
            status_code=400, detail="Нельзя выставить на переаренду бронь, которая уже прошла"
        )

    # 04.09 (лента админов): бронь на 14:00 выставляли на переаренду в 14:47 —
    # слот уже ИДЁТ, переарендовать его некому. _is_past смотрит на конец
    # брони, поэтому пропускал такое. Выставление гейтим по СТАРТУ; снятие
    # с переаренды (обратный переключатель) разрешено всегда.
    if not booking.is_re_rent_listed:
        from datetime import timezone as _tz_rr, timedelta as _td_rr
        _start_dt = _booking_end_dt(booking) - _td_rr(minutes=booking.duration or 60)
        _now_rr = datetime.now(_tz_rr.utc) if _start_dt.tzinfo else datetime.now()
        if _start_dt < _now_rr:
            raise HTTPException(
                status_code=400,
                detail=f"Слот уже начался ({booking.start_time}) — выставить на переаренду можно только до начала брони",
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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    new_format = (payload.new_format or "").strip().lower()
    if new_format not in ("individual", "group"):
        raise HTTPException(status_code=400, detail="new_format must be 'individual' or 'group'")

    if new_format == (booking.format or "").lower():
        raise HTTPException(status_code=400, detail="Бронь уже в этом формате")

    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Сменить формат можно только у подтверждённой брони")

    if booking.payment_status == "waived":
        raise HTTPException(
            status_code=409,
            detail="Бронь со снятым штрафом нельзя переформатировать — отмените снятие или создайте новую бронь",
        )
    if _subscription_money_row(booking):
        raise HTTPException(status_code=409, detail=_MONEY_ROW_DETAIL.format(what="сменить формат нельзя"))

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

    booking_owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
    if not booking_owner:
        raise HTTPException(status_code=404, detail="Не найден владелец брони")

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
        # Аудит 2026-08-27: денежная бронь при смене формата остаётся денежной —
        # свежекупленный абонемент не должен тихо занулять цену (balance+0₾).
        ignore_subscription=(booking.payment_method or "").lower() != "subscription",
    )
    # Бонусная бронь: длительность та же, её бонус-часы покрывают ту же долю —
    # деньгами только непокрытое. Иначе old_price=0, а новая цена полная, и
    # клиент доплачивал весь слот, уже оплаченный бонус-часом.
    quote.final_price = _bonus_uncovered_price(booking, quote.final_price, booking.duration)
    # Допы брони (песочница, кофе…) остаются в цене — движок про них не знает
    # (ревизия 03.10, как «часы подряд» и перенос). Без этого смена формата
    # выкидывала их из цены: у денежной брони клиенту возвращались деньги за доп,
    # который остаётся в брони, а у абонементной, где допы уже сняты с баланса,
    # отмена потом не возвращала их вовсе.
    from app.services.pricing import booking_extras_money as _extras_money
    quote.final_price = round(float(quote.final_price or 0) + _extras_money(booking), 2)

    # Абонементная бронь остаётся абонементной только если часы покрывают её и в
    # новом формате. Иначе (формат не входит в тариф, нет часов нужного пула —
    # у Группового мастера индивидуальная бронь платится ТОЛЬКО «4 ч
    # индивидуально») котировка вернула бы деньги: часы вернулись бы в пул,
    # бронь стала бесплатной, а при отмене вернулись бы деньги, которых никто
    # не брал (ревизия доп. пула 01.10). Честно отказываем.
    if (booking.payment_method or "").lower() == "subscription" and quote.applied_rule != "SUBSCRIPTION":
        raise HTTPException(
            status_code=400,
            detail="Абонемент не покрывает эту бронь в новом формате (формат не входит в тариф "
                   "или не хватает часов нужного пула). Отмените бронь и создайте новую.",
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
            # Знаковая разница ПО КАЖДОМУ пулу: >0 — дописать часы, <0 — вернуть.
            # Основной и доп. (капсула / «индивидуально» — у Группового мастера
            # смена индивидуальный ↔ групповой переносит часы между пулами).
            old_extra = subscription_pool.booking_extra(booking)
            new_extra = float(quote.extra_hours_deducted or 0) if new_hours > 0 else 0.0
            delta_extra = round(new_extra - old_extra, 4)
            delta_main = round(delta_hours - delta_extra, 4)
            if delta_main > 0:
                booking_owner.subscription = subscription_pool.debit_hours(
                    booking_owner.subscription, delta_main)
            else:
                booking_owner.subscription = subscription_pool.credit_hours(
                    booking_owner.subscription, -delta_main)
            if delta_extra > 0:
                booking_owner.subscription = subscription_pool.debit_hours(
                    booking_owner.subscription, delta_extra, extra=delta_extra)
            elif delta_extra < 0:
                booking_owner.subscription = subscription_pool.credit_hours(
                    booking_owner.subscription, -delta_extra, extra=-delta_extra,
                    kind=_pool_kind(session, booking))
        else:
            # delta_price знаковая: >0 — доплата, <0 — возврат.
            wallet.apply(session, booking_owner, -delta_price, reason="format_change",
                         description="Пересчёт при смене формата брони",
                         ref_type="booking", ref_id=str(booking.id), actor=current_user)
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
        subscription_pool.stamp_booking(booking, quote.hours_deducted, quote.extra_hours_deducted)

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

    Бронь по абонементу (ревизия 03.10): часы не трогаем — «цена» такой брони
    это её денежная часть (пик + допы, единое правило billing_defer), и у
    оплаченной разница идёт деньгами, как у денежной брони. Раньше часы
    масштабировались «по цене», а деньги не двигались: «Цена» 0 → 20 ₾ и
    отмена возвращала 20 ₾ из воздуха. Бронь по абонементу, ушедшая в деньги
    (hours_deducted = 0), — 409: её деньги в charge_amount, а не в final_price.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

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

    if _subscription_money_row(booking):
        raise HTTPException(status_code=409, detail=_MONEY_ROW_DETAIL.format(what="цену у неё не поменять"))

    old_price = float(booking.final_price or 0)
    if abs(new_price - old_price) < 0.005:
        raise HTTPException(status_code=400, detail="Новая цена совпадает со старой")

    booking_owner = session.get(User, booking.user_uuid) if booking.user_uuid else None

    delta = round(old_price - new_price, 2)  # positive = refund, negative = debit
    method = (booking.payment_method or "balance").lower()

    settled_now = False
    if booking.payment_status == "paid" and booking_owner:
        # delta знаковая: >0 — возврат клиенту, <0 — доплата. И у денежной брони,
        # и у брони по абонементу (там это деньги пика/допов, часы не меняются).
        wallet.apply(session, booking_owner, delta, reason="price_change",
                     description=("Ручное изменение цены брони по абонементу (пик/допы, часы не меняются)"
                                  if method == "subscription" else "Ручное изменение цены брони админом"),
                     ref_type="booking", ref_id=str(booking.id), actor=current_user)
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
        # Цена брони — всегда деньги (у брони по абонементу — пик/допы).
        method_label = "₾"
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


@router.patch("/{booking_id}/bonus-hour", response_model=BookingRead)
def apply_bonus_hour(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """«Час в подарок» одной кнопкой (15.09, просьба Валентины).

    Раньше админ считал вручную: 36 − 18 (час со скидкой) и менял цену через
    «Цена», а бонус клиента оставался непогашенным — подарок мог задвоиться.
    Теперь: проверяем активный бесплатный час клиента, гасим его (FIFO,
    consume_free_hours) и снижаем цену брони на стоимость ОДНОГО часа в
    текущей цене (со всеми скидками) через тот же механизм, что «Цена»
    (set_booking_price): pending — крон спишет меньше, paid — разница
    вернётся на баланс. Всё в одной транзакции: сорвался пересчёт цены —
    бонус не погашен.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Некорректный номер брони")
    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")
    if booking.status != "confirmed":
        raise HTTPException(400, "Бонус-час применяется только к подтверждённой брони")
    # Ревизия денег 15.09: повторное нажатие на ту же бронь компаундило бы
    # скидку (18 → 9 → 4.5…) и сжигало бонусы клиента почти без эффекта.
    if (booking.applied_rule or "") == "BONUS_HOUR":
        raise HTTPException(409, "«Час в подарок» уже применён к этой брони")
    method = (booking.payment_method or "balance").lower()
    # Только balance: у cash/service деньги в кассе, возврат на баланс
    # раздвоил бы учёт; абонемент/бонус — свои механики.
    if method != "balance":
        raise HTTPException(
            409, "«Час в подарок» применяется только к броням с оплатой балансом",
        )
    if not booking.user_uuid:
        raise HTTPException(
            409, "У этой старой брони не указан владелец — примените скидку через «Цена»",
        )
    duration = int(booking.duration or 0)
    if duration < 60:
        raise HTTPException(400, "Бронь короче часа — дарить нечего")
    old_price = float(booking.final_price or 0)
    if old_price <= 0:
        raise HTTPException(400, "Цена брони уже 0 — скидывать нечего")

    booking_owner = _resolve_booking_owner(session, booking)
    if not booking_owner:
        raise HTTPException(404, "Владелец брони не найден")

    # Целый бесплатный час должен быть у клиента ДО списания.
    from app.models.bonus import Bonus as _Bonus
    _now = datetime.now()
    _active = session.exec(
        select(_Bonus).where(
            _Bonus.user_id == str(booking_owner.id),
            _Bonus.type == "free_hour",
            _Bonus.status == "active",
        )
    ).all()
    _avail = sum(float(b.quantity or 0) for b in _active
                 if not (b.expires_at and b.expires_at < _now))
    if _avail < 0.999:
        raise HTTPException(
            409, f"У клиента нет целого бесплатного часа (доступно: {_avail:g} ч)",
        )

    # Стоимость одного часа в ТЕКУЩЕЙ цене (со скидками): 36₾/2ч → 18₾.
    hour_cost = round(old_price * 60.0 / duration, 2)
    new_price = round(old_price - hour_cost, 2)

    from app.services.bonus_service import consume_free_hours
    covered = consume_free_hours(session, booking_owner.id, 1.0)
    if covered < 0.999:
        raise HTTPException(409, "Не удалось погасить бонус — попробуйте ещё раз")

    # Тот же путь, что кнопка «Цена»: набивает audit, шлёт TG, двигает деньги
    # при paid и коммитит всю транзакцию (вместе с погашенным бонусом).
    set_booking_price(
        booking_id=booking_id,
        payload=SetPriceRequest(
            new_price=new_price,
            reason=f"🎁 Час в подарок: −{hour_cost:g}₾ (бонус клиента погашен)",
        ),
        session=session,
        current_user=current_user,
    )
    # Метка идемпотентности — ПОСЛЕ успешного расчёта (set_booking_price
    # перетирает applied_rule в MANUAL_OVERRIDE, поэтому штампуем поверх).
    booking.applied_rule = "BONUS_HOUR"
    session.add(booking)
    session.commit()
    session.refresh(booking)
    return booking


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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and not current_user.role in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Продлить можно только подтверждённую бронь")

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
            raise HTTPException(status_code=400, detail="Нельзя продлить бронь, которая уже прошла")

    extra = payload.extra_minutes
    if extra < 30 or extra % 30 != 0:
        raise HTTPException(status_code=400, detail="Продлевать можно только шагом 30 минут")

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

    # ── Доплата за добавленное время ────────────────────────────────────────
    # Считаем прайс-движком: цена(новая длительность) − цена(старая), а НЕ
    # пропорцией «цена за минуту × добавленные минуты».
    #
    # Баг (Лиза, 2026-08-18): пропорция не проходит через тарифную сетку, и
    # продление сбивало скидку за длительность. Бронь 1 ч (20 ₾) + 1 ч давала
    # 40 ₾ вместо 36 ₾ — тир «2 часа подряд = −10%» пропадал ровно в момент
    # продления (Екатерина Жук, Кабинет 7, 14:00). Тот же промах в другую
    # сторону на пиковых часах: 19:00 + 1 ч заезжает в пик 20:00 — должно быть
    # 41 ₾, пропорция давала 40 ₾ (Unbox недополучал надбавку).
    #
    # Берём именно РАЗНИЦУ котировок, а не новую цену целиком: в final_price
    # уже могут сидеть допы (кофе и т.п. из /add-extras) и покрытие бонусными
    # часами — движок про них не знает и затёр бы их.
    from app.services.pricing import PricingService
    pricing = PricingService(session)
    target_user = _resolve_booking_owner(session, booking)

    try:
        _h, _m = map(int, (booking.start_time or "0:0").split(":"))
        _start_dt = booking.date.replace(hour=_h, minute=_m, second=0, microsecond=0)
    except Exception:
        _start_dt = booking.date

    # Абонементные брони через денежный движок НЕ гоняем (котировка соскочила бы
    # с абонемента на деньги и списала полную стоимость брони). Ревизия 03.10:
    # «известный пробел» закрыт — часы за добавку снимает
    # _extend_subscription_booking (pending — только hours_deducted, крон снимет
    # один раз; нет часов — добавка деньгами, как запасной путь крона).
    _is_subscription = (booking.payment_method or "").lower() == "subscription"

    new_quote = None
    sub_extension = None
    if target_user is not None and _is_subscription:
        sub_extension = _extend_subscription_booking(session, booking, target_user, extra, actor=current_user)
        extra_price = 0.0  # часы/деньги уже разнесены помощником (и final_price тоже)
        logger.info("[extend] subscription booking %s +%s мин: %s", booking.id, extra, sub_extension)
    elif target_user is not None and not _is_subscription:
        _quote_args = dict(
            user=target_user,
            resource_id=booking.resource_id,
            start_time=_start_dt,
            format_type=booking.format or "individual",
            # Бронь уже лежит в БД со СТАРОЙ длительностью. Без exclude движок
            # посчитал бы её соседом самой себе и задвоил часы в цепочке.
            exclude_booking_id=str(booking.id),
            # Аудит 2026-08-27: ветка только для денежных броней (гейт
            # not _is_subscription выше) — абонемент не должен занулять доплату.
            ignore_subscription=True,
        )
        old_quote = pricing.calculate_price(duration_minutes=booking.duration, **_quote_args)
        new_quote = pricing.calculate_price(duration_minutes=new_duration, **_quote_args)
        extra_price = round(
            float(new_quote.final_price or 0) - float(old_quote.final_price or 0), 2
        )
        # Отрицательной разницы при текущих тирах быть не может (база растёт
        # быстрее, чем процент скидки). Если появится — не возвращаем деньги
        # молча из ветки продления, а просто не доплачиваем.
        if extra_price < 0:
            logger.warning(
                "[extend] отрицательная доплата %.2f для брони %s — цену не трогаем",
                extra_price, booking.id,
            )
            extra_price = 0.0
    elif booking.final_price and booking.duration > 0:
        # Бронь без найденного владельца (служебная/старая) — прежняя пропорция.
        extra_price = round(booking.final_price / booking.duration * extra, 2)
    else:
        extra_price = 0

    booking.duration = new_duration
    booking.final_price = round((booking.final_price or 0) + extra_price, 2)
    # Тариф брони после продления берём из новой котировки — иначе карточка,
    # аудит и недельный перерасчёт видят старый процент скидки.
    if new_quote is not None:
        booking.base_price = float(new_quote.base_price)
        booking.applied_rule = new_quote.applied_rule
        booking.discount_amount = float(new_quote.discount_amount)
        booking.discount_percent = int(new_quote.discount_percent)
    booking.updated_at = datetime.now()

    # Charge the extra time to the booking's OWNER — always, whoever clicked.
    #
    # Four things were wrong here:
    #  1. Extra time added by an ADMIN was free: the deduction was guarded by
    #     `not current_user.role in ADMIN_ROLES`, i.e. charged only when the
    #     client extended it themselves. But the main use of this button is an
    #     admin adding time after the fact (see the past-booking branch above:
    #     "клиент часто занимается дольше заказанного") — the client used the
    #     room, so the client pays. 2026-07-14 owner: «админ продлевает бронь
    #     за счёт клиента, а не бесплатно».
    #  2. `UUID(booking.user_uuid)` — user_uuid is already a UUID, so this raised
    #     and every non-admin extension died with a 500. The feature simply did
    #     not work for regular users.
    #  3. A `pending` booking (>24h out, not charged yet) had the extra deducted
    #     immediately, and then the charge-due cron settled the *new* final_price
    #     — which already includes the extension. The extra was paid twice.
    #  4. On a `paid` booking, charge_amount stayed at the pre-extension figure,
    #     so a later waive/refund gave back less than was actually taken.
    if extra_price > 0:
        if target_user and booking.payment_status == "pending":
            # Nothing has been charged yet — the cron will take the new total.
            pass
        elif target_user:
            wallet.debit(session, target_user, extra_price, reason="extend_charge",
                         description="Доплата за продление брони",
                         ref_type="booking", ref_id=str(booking.id), actor=current_user)
            booking.charge_amount = round(
                float(booking.charge_amount if booking.charge_amount is not None
                      else (booking.final_price - extra_price)) + extra_price, 2
            )

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


# ─── Add extras to an existing booking ───────────────────────────────────────
# Клиент в моменте дозаказывает кофе / песочницу и т.п., чего не указывал при
# брони. Админ добавляет доп к СЕГОДНЯШНЕЙ броне. Оплата на выбор:
#   cash/card → приход в кассу отдельной проводкой, цену брони НЕ трогаем
#               (иначе крон при balance-броне спишет доп ещё и с депозита —
#               двойная оплата);
#   balance   → доп идёт в цену брони и списывается с депозита владельца,
#               как /extend.
_LOCATION_TO_BRANCH = {"unbox_one": "Unbox One", "unbox_uni": "Unbox Uni", "neo_school": "Neo School"}


class AddExtrasRequest(PydanticBaseModel):
    extras: List[str]                 # id-шники допов (coffee_meama, sandbox, ...)
    payment_method: str = "cash"      # cash | card_tbc | card_bog | balance


@router.patch("/{booking_id}/add-extras", response_model=BookingRead)
def add_booking_extras(
    booking_id: str,
    payload: AddExtrasRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Добавить допы (кофе и т.п.) к брони в моменте. Только админ."""
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Только администратор может добавлять допы")

    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Некорректный номер брони")
    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")
    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Допы можно добавить только к подтверждённой броне")

    from app.services.pricing import PricingService

    ids = [e for e in (payload.extras or []) if e]
    if not ids:
        raise HTTPException(status_code=400, detail="Не переданы допы")
    unknown = PricingService.validate_extras(ids)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Неизвестные допы: {', '.join(unknown)}")

    price = round(float(PricingService.calculate_extras_price(ids)), 2)
    method = (payload.payment_method or "cash").lower()

    # Допы всегда фиксируем в составе брони — для персонала (подготовить кабинет)
    # и для TG/чека. Это НЕ влияет на пересчёт цены (extras прибавляются к
    # котировке только при создании; recompute/rebate их не трогают).
    booking.extras = list(booking.extras or []) + ids
    booking.updated_at = datetime.now()

    if price > 0:
        if method == "balance":
            booking.final_price = round((booking.final_price or 0) + price, 2)
            owner = _resolve_booking_owner(session, booking)
            if owner and booking.payment_status != "pending":
                wallet.debit(session, owner, price, reason="extras_charge",
                             description="Дозаказ допов с баланса",
                             ref_type="booking", ref_id=str(booking.id), actor=current_user)
                booking.charge_amount = round(
                    float(booking.charge_amount if booking.charge_amount is not None
                          else (booking.final_price - price)) + price, 2
                )
            # pending (>24ч) → крон спишет новый итог с учётом допа
        else:
            # cash / card — оплата на месте, отдельным приходом в кассу.
            from app.models.cashbox_transaction import CashboxTransaction
            owner = _resolve_booking_owner(session, booking)
            branch = _LOCATION_TO_BRANCH.get(booking.location_id)
            session.add(CashboxTransaction(
                type="income",
                amount=price,
                currency="GEL",
                payment_method=method,
                category_id="cat-other",
                description=f"Допы к броне (дозаказ): {', '.join(ids)}",
                branch=branch,
                date=datetime.now(),
                admin_id=str(current_user.id),
                admin_name=current_user.name or "",
                client_id=str(owner.id) if owner else None,
                client_name=(owner.name if owner else None),
            ))

    session.add(booking)
    session.commit()
    session.refresh(booking)
    return enrich_booking_status(booking)


# ─── Перевод брони на абонемент ──────────────────────────────────────────────
# Клиент оплатил бронь с баланса, а потом выяснилось, что у него есть активный
# абонемент (или админ провёл бронь балансом по ошибке). Эта функция переводит
# уже созданную бронь на списание с абонемента: возвращает деньги на баланс,
# списывает часы с абонемента, перекрашивает способ оплаты.
#
# Ядро вынесено в helper — им пользуется и эндпоинт (кнопка «На абонемент»),
# и разовый скрипт правки исторических броней (fix_*_to_subscription).
def _convert_booking_to_subscription(session: Session, booking: Booking, actor: User | None):
    """Перевести бронь balance→subscription. Возвращает dict с итогом.

    Бросает ValueError с человекочитаемой причиной, если перевести нельзя
    (уже на абонементе / нет активного абонемента / не хватает часов / формат
    не входит в тариф / истёк срок).
    """
    from app.services.pricing import PricingService

    if booking.payment_method == "subscription":
        raise ValueError("Бронь уже списана с абонемента")
    # Бонусная бронь: денег к возврату нет (0 ₾), а перекраска стёрла бы запись
    # о потраченном бонус-часе — клиент потерял бы его И часы абонемента за тот
    # же слот.
    if booking.payment_method == "bonus":
        raise ValueError(
            "Бронь оплачена бонусными часами — на абонемент её не перевести. "
            "Можно отменить её (бонусные часы вернутся) и создать новую."
        )

    owner = _resolve_booking_owner(session, booking)
    if owner is None:
        raise ValueError("Не найден владелец брони")

    if not subscription_pool.is_active(owner.subscription, datetime.utcnow()):
        raise ValueError("У клиента нет активного абонемента")

    # Движок сам применит абонемент, раз он активен. Если applied_rule вышел
    # SUBSCRIPTION — тариф покрывает эту бронь (часы есть, формат подходит,
    # срок не вышел). Иначе честно говорим, почему нельзя.
    # Время старта из date + start_time — движок берёт час пик отсюда.
    # Передавать booking.date (полночь) НЕЛЬЗЯ: пиковая надбавка потеряется,
    # и peak_left выйдет 0 даже для брони в час пик → перевозврат.
    try:
        _h, _m = map(int, (booking.start_time or "0:0").split(":"))
        _start_dt = booking.date.replace(hour=_h, minute=_m, second=0, microsecond=0)
    except Exception:
        _start_dt = booking.date
    ps = PricingService(session)
    quote = ps.calculate_price(
        user=owner,
        resource_id=booking.resource_id,
        start_time=_start_dt,
        duration_minutes=booking.duration,
        format_type=booking.format or "individual",
        exclude_booking_id=booking.id,
    )
    if quote.applied_rule != "SUBSCRIPTION":
        raise ValueError(
            "Абонемент не покрывает эту бронь — не хватает часов, "
            "не тот формат или вышел срок"
        )

    hours = round(float(quote.hours_deducted or (booking.duration / 60.0)), 4)
    extra_hours = float(quote.extra_hours_deducted or 0)

    # 1. Возврат денег на баланс. Возвращаем ровно то, что было списано, за
    #    вычетом остатка, который абонемент не покрыл (пиковая надбавка).
    #    Для pending/waived денег не списывали — возвращать нечего.
    old_charge = float(
        booking.charge_amount if booking.charge_amount is not None
        else (booking.final_price or 0)
    )
    peak_left = round(float(quote.final_price or 0), 2)  # обычно 0, иногда пик
    refund = round(old_charge - peak_left, 2)
    refunded = 0.0
    if booking.payment_status not in ("pending", "waived") and refund > 0:
        wallet.credit(
            session, owner, refund, reason="booking_to_subscription",
            description="Возврат: бронь переведена на абонемент",
            ref_type="booking", ref_id=str(booking.id), actor=actor,
        )
        refunded = refund

    # 2. Списание часов с абонемента — ТОЛЬКО для уже списанной брони.
    #    Бронь в ожидании (pending, дальше 24 ч) часы ещё не тратила: их снимет
    #    крон за 24 ч до начала (billing_defer.settle_pending_charge берёт
    #    hours_deducted). Раньше часы снимались и здесь, и в кроне — двойное
    #    списание (Валерия Костенецкая 29.09: 6 ч).
    is_pending = booking.payment_status == "pending"
    if not is_pending:
        owner.subscription = subscription_pool.debit_hours(owner.subscription, hours, extra=extra_hours)
        session.add(owner)

    # 3. Перекраска брони.
    booking.payment_method = "subscription"
    booking.applied_rule = "SUBSCRIPTION"
    booking.hours_deducted = hours
    subscription_pool.stamp_booking(booking, hours, extra_hours)
    booking.final_price = peak_left
    # Для pending снимок «сколько списано» ставит крон; до него — пусто, как
    # у обычной отложенной абонементной брони.
    booking.charge_amount = None if is_pending else peak_left
    booking.updated_at = datetime.now()
    session.add(booking)

    return {
        "booking_id": str(booking.id),
        "client": owner.name or owner.email,
        "hours_deducted": hours,
        "refunded_to_balance": refunded,
        "remaining_hours_after": subscription_pool.get_float(owner.subscription, "remaining_hours"),
    }


@router.patch("/{booking_id}/to-subscription", response_model=BookingRead)
def convert_booking_to_subscription(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Перевести оплату брони с баланса на абонемент. Только админ."""
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Только администратор")
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Некорректный номер брони")
    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")
    if booking.status not in ("confirmed",):
        raise HTTPException(status_code=400, detail="Перевести можно только подтверждённую бронь")

    try:
        result = _convert_booking_to_subscription(session, booking, current_user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    session.commit()
    session.refresh(booking)
    logger.info("[to-subscription] %s", result)
    # Синхронизируем связанную CRM-сессию, если есть (цена стала 0/пик).
    try:
        _sync_linked_session_to_booking(session, booking)
    except Exception:
        session.rollback()
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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")

    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Сократить можно только подтверждённую бронь")

    if _is_past(booking):
        raise HTTPException(status_code=400, detail="Нельзя сократить бронь, которая уже прошла")

    if booking.payment_status == "waived":
        raise HTTPException(
            status_code=409,
            detail="У брони снят штраф — сначала восстановите оплату или создайте новую бронь",
        )

    # Бонусная бронь: пропорция ниже вернула бы деньги (которых нет), а
    # освободившиеся бонус-часы так и остались бы потраченными.
    if _bonus_hours_on(booking) > 0:
        raise HTTPException(
            status_code=400,
            detail=_BONUS_RESIZE_DETAIL.format(what="сократить её не получится"),
        )
    if _subscription_money_row(booking):
        raise HTTPException(status_code=409, detail=_MONEY_ROW_DETAIL.format(what="сократить её нельзя"))

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

    # Денежная бронь: пропорциональный возврат части цены аренды. PricingService
    # умеет считать точную цену для нового слота, но это перезапустит
    # discount/peak логику и в краевых случаях даст странный результат
    # (например, при сокращении с конца «потеряется» peak-час и base уменьшится
    # больше чем на пропорциональную долю). Простая пропорция стабильнее.
    # Ревизия 03.10: допы (песочница, кофе) в пропорцию не входят — они остаются
    # у брони целиком (как при «часах подряд», переносе и разделении).
    # Бронь по абонементу: её деньги — пиковая надбавка (+ допы), считаем точно:
    # минус пик отрезанного времени, допы остаются.
    from app.services.pricing import PricingService, booking_extras_money
    _is_sub = (booking.payment_method or "").lower() == "subscription"
    if _is_sub:
        try:
            _oh, _om = map(int, (booking.start_time or "0:0").split(":"))
            _old_start = booking.date.replace(hour=_oh, minute=_om, second=0, microsecond=0)
            _nh, _nm = map(int, (new_start_time or "0:0").split(":"))
            _new_start = booking.date.replace(hour=_nh, minute=_nm, second=0, microsecond=0)
            new_price = round(max(0.0, old_price
                                  - PricingService.subscription_peak_money(_old_start, old_duration)
                                  + PricingService.subscription_peak_money(_new_start, new_duration)), 2)
        except Exception:
            new_price = old_price
    elif old_duration > 0:
        _extras_money = booking_extras_money(booking)
        new_price = round(max(0.0, old_price - _extras_money) * (new_duration / old_duration) + _extras_money, 2)
    else:
        new_price = old_price
    refund_price = round(old_price - new_price, 2)

    # Возврат subscription-часов аналогично.
    old_hours = float(booking.hours_deducted or 0) if (booking.payment_method or "").lower() == "subscription" else 0.0
    new_hours = round(old_hours * (new_duration / old_duration), 4) if old_duration > 0 else old_hours
    refund_hours = round(old_hours - new_hours, 4)
    # Доп. пул — той же долей (пропорциональное сокращение), возврат в свой пул.
    old_extra = subscription_pool.booking_extra(booking) if old_hours > 0 else 0.0
    new_extra = round(old_extra * (new_hours / old_hours), 4) if old_hours > 0 else 0.0
    refund_extra = round(old_extra - new_extra, 4)

    # Применяем возврат только если деньги уже списаны. Для pending —
    # cron возьмёт правильную сумму при T-24h.
    settled_now = booking.payment_status == "paid"
    if settled_now and (refund_price >= 0.01 or refund_hours > 0):
        target_user = session.get(User, booking.user_uuid) if booking.user_uuid else None
        if not target_user and booking.user_id:
            target_user = session.exec(select(User).where(User.email == booking.user_id)).first()
        if target_user:
            # Часы — отдельно от денег (ревизия 03.10): раньше возврат часов
            # стоял внутри «если вернулись деньги», и бронь без пика и допов при
            # сокращении часы не возвращала вовсе (Тёплый 2 ч → 1 ч: остаток 8
            # вместо 9, после отмены 9 вместо 10).
            if _is_sub and refund_hours > 0 and \
                    subscription_pool.hours_return_allowed(target_user.subscription, booking.date):
                target_user.subscription = subscription_pool.credit_hours(
                    target_user.subscription, refund_hours, extra=refund_extra,
                    kind=_pool_kind(session, booking))
            # Деньги: у брони по абонементу — пиковая надбавка отрезанного
            # времени (снята с баланса вместе с часами, единое правило
            # billing_defer), у денежной — доля цены аренды.
            if refund_price >= 0.01:
                wallet.credit(session, target_user, refund_price, reason="shorten_refund",
                              description=("Возврат пиковой надбавки за сокращённое время брони по абонементу"
                                           if _is_sub else "Возврат за сокращённое время брони"),
                              ref_type="booking", ref_id=str(booking.id), actor=current_user)
            session.add(target_user)

    booking.duration = new_duration
    booking.start_time = new_start_time
    booking.final_price = new_price
    if (booking.payment_method or "").lower() == "subscription":
        booking.hours_deducted = new_hours
        subscription_pool.stamp_booking(booking, new_hours, new_extra)
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


# ─── Split booking ───────────────────────────────────────────────────────────
# Владелец 2026-08-26: «двухчасовой слот — это две сессии по часу, нужно уметь
# разбить бронь и привязать к каждой части своего клиента».
#
# Почему делим саму бронь, а не вешаем две CRM-сессии на одну: вся система
# устроена как «одна бронь = один слот = одна сессия». Автопривязка ищет сессию
# ПО ВРЕМЕНИ НАЧАЛА брони, автосинк при переносе двигает одну сессию, в шахматке
# на блок помещается одно имя. Делить бронь — одна аккуратная операция с
# деньгами; вешать две сессии — правки в календаре, шахматке и синхронизации.
#
# Деньги при делении НЕ двигаются: сумма частей всегда равна исходной цене.
# Это безопасно потому, что смежные часы движок и так считает одной цепочкой —
# бронь 2 ч за 36 ₾ и две смежные по часу за 18 ₾ стоят одинаково.
class SplitRequest(PydanticBaseModel):
    """Длительности частей в минутах, по порядку. Сумма обязана совпадать с
    длительностью брони: 120 → [60, 60]; 180 → [60, 60, 60] или [60, 120]."""
    parts: List[int]


@router.patch("/{booking_id}/split", response_model=List[BookingRead])
def split_booking(
    booking_id: str,
    payload: SplitRequest,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Разделить бронь на несколько подряд идущих частей.

    Первой частью остаётся ИСХОДНАЯ бронь (тот же id) — чтобы не отвалились
    привязанная CRM-сессия, событие календаря и ссылки на неё. Остальные части
    создаются новыми бронями сразу за ней.
    """
    try:
        b_uuid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    booking = session.get(Booking, b_uuid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")

    is_owner = _check_ownership(booking, current_user)
    if not is_owner and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")
    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Делить можно только подтверждённую бронь")
    if booking.payment_status == "waived":
        raise HTTPException(
            status_code=409,
            detail="У брони снят штраф — сначала восстановите оплату",
        )

    parts = [int(p) for p in (payload.parts or [])]
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="Нужно минимум две части")
    if any(p < 30 or p % 30 != 0 for p in parts):
        raise HTTPException(status_code=400, detail="Каждая часть — не меньше 30 минут и кратна 30")
    if sum(parts) != int(booking.duration or 0):
        raise HTTPException(
            status_code=400,
            detail=f"Сумма частей {sum(parts)} мин не совпадает с длительностью брони "
                   f"{booking.duration} мин",
        )

    # Котируем каждую часть с подсказкой «это одна цепочка» — тогда тир за
    # длительность у всех частей общий, как было у целой брони.
    from app.services.pricing import PricingService
    pricing = PricingService(session)
    owner = _resolve_booking_owner(session, booking)
    try:
        _h, _m = map(int, (booking.start_time or "0:0").split(":"))
        start_min0 = _h * 60 + _m
    except Exception:
        raise HTTPException(status_code=400, detail="Не удалось разобрать время начала брони")

    total_hours = float(booking.duration or 0) / 60.0
    quotes, offset = [], 0
    for p in parts:
        st_min = start_min0 + offset
        st_dt = booking.date.replace(hour=st_min // 60, minute=st_min % 60,
                                     second=0, microsecond=0)
        q = None
        if owner is not None:
            try:
                q = pricing.calculate_price(
                    user=owner, resource_id=booking.resource_id, start_time=st_dt,
                    duration_minutes=p, format_type=booking.format or "individual",
                    consecutive_total_hours=total_hours,
                    exclude_booking_id=str(booking.id),
                    # Аудит 2026-08-27: части денежной брони котируются деньгами —
                    # иначе часть получает final_price=0 при methode=balance
                    # (точная сигнатура «нулёвок» серии Галины).
                    ignore_subscription=(booking.payment_method or "").lower() != "subscription",
                )
            except Exception:
                logger.exception("[split] не удалось оценить часть %s мин", p)
        quotes.append(q)
        offset += p

    # Деньги делим ДОЛЯМИ от уже списанной суммы — так итог совпадает с исходным
    # до копейки при любом округлении. Пересчитывать «как новые» нельзя: цена
    # могла содержать допы, бонусные часы или ручную правку.
    extras_price = round(float(PricingService.calculate_extras_price(list(booking.extras or []))), 2)
    # У бонусной брони допы покрыты бонусом вместе с часами (final_price=0) —
    # без потолка комната ушла бы в минус, и части получили бы отрицательные
    # цены (крон «списал» бы их с баланса).
    extras_price = min(extras_price, max(0.0, round(float(booking.final_price or 0), 2)))
    room_total = round(float(booking.final_price or 0) - extras_price, 2)

    weights = [float(q.final_price) if q is not None else float(p)
               for q, p in zip(quotes, parts)]
    if sum(weights) <= 0:
        weights = [float(p) for p in parts]
    wsum = sum(weights)

    def _split_amount(total: float) -> list:
        """Разложить сумму по долям так, чтобы части дали ровно total."""
        out = [round(total * w / wsum, 2) for w in weights]
        out[0] = round(total - sum(out[1:]), 2)      # остаток округления — в первую
        return out

    room_prices = _split_amount(room_total)
    charged_total = float(booking.charge_amount) if booking.charge_amount is not None else None
    charges = _split_amount(charged_total) if charged_total is not None else None
    hours_total = float(booking.hours_deducted or 0)
    hours = _split_amount(hours_total) if hours_total > 0 else None
    # Доп. пул делим теми же долями; каждая часть берёт не больше своих часов,
    # а сумма частей остаётся равной исходной (остаток — в первую часть).
    extra_total = subscription_pool.booking_extra(booking) if hours is not None else 0.0
    extras_split = None
    if hours is not None and extra_total > 0:
        extras_split = _split_amount(extra_total)
        extras_split = [min(max(0.0, e), h) for e, h in zip(extras_split, hours)]
        _rest = round(extra_total - sum(extras_split), 2)
        for _i in range(len(extras_split)):
            if _rest <= 0:
                break
            _room = round(hours[_i] - extras_split[_i], 2)
            _add = min(_room, _rest)
            extras_split[_i] = round(extras_split[_i] + _add, 2)
            _rest = round(_rest - _add, 2)

    old_event_id = booking.gcal_event_id
    created: list = []
    offset = 0
    for idx, p in enumerate(parts):
        st_min = start_min0 + offset
        st_str = f"{st_min // 60:02d}:{st_min % 60:02d}"
        price = room_prices[idx] + (extras_price if idx == 0 else 0.0)
        q = quotes[idx]

        if idx == 0:
            booking.duration = p
            booking.final_price = round(price, 2)
            if charges is not None:
                booking.charge_amount = charges[0]
            if hours is not None:
                booking.hours_deducted = hours[0]
                if (booking.payment_method or "").lower() == "subscription":
                    subscription_pool.stamp_booking(
                        booking, hours[0], extras_split[0] if extras_split else 0.0)
            if q is not None:
                booking.base_price = float(q.base_price)
                booking.applied_rule = q.applied_rule
                booking.discount_amount = float(q.discount_amount)
                booking.discount_percent = int(q.discount_percent)
            booking.gcal_event_id = None
            booking.updated_at = datetime.now()
            session.add(booking)
            created.append(booking)
        else:
            nb = Booking(
                resource_id=booking.resource_id,
                location_id=booking.location_id,
                date=booking.date,
                start_time=st_str,
                duration=p,
                status="confirmed",
                format=booking.format,
                payment_method=booking.payment_method,
                payment_status=booking.payment_status,
                charged_at=booking.charged_at,
                charge_amount=(charges[idx] if charges is not None else None),
                hours_deducted=(hours[idx] if hours is not None else None),
                final_price=round(price, 2),
                base_price=float(q.base_price) if q is not None else None,
                applied_rule=q.applied_rule if q is not None else booking.applied_rule,
                discount_amount=float(q.discount_amount) if q is not None else 0.0,
                discount_percent=int(q.discount_percent) if q is not None else 0,
                extras=[],
                user_id=booking.user_id,
                user_uuid=booking.user_uuid,
                # Клиента CRM намеренно НЕ копируем: смысл деления в том, что у
                # каждой части свой клиент — админ назначает его кликом.
                crm_client_id=None,
                created_by_id=str(current_user.id),
                created_by_name=current_user.name or "",
            )
            if hours is not None and (nb.payment_method or "").lower() == "subscription":
                subscription_pool.stamp_booking(nb, hours[idx], extras_split[idx] if extras_split else 0.0)
            session.add(nb)
            created.append(nb)
        offset += p

    session.commit()
    for b in created:
        session.refresh(b)

    # Google Calendar: старое событие описывало весь слот — убираем и заводим
    # по событию на часть. Ошибки не валят операцию: БД — источник истины.
    if old_event_id:
        try:
            gcal_service.delete_event(old_event_id, booking.resource_id)
        except Exception as e:
            logger.warning("[GCal Split] delete_event failed for %s: %s", old_event_id, e)
    for b in created:
        try:
            ev = gcal_service.create_event(b, user_name=(owner.name if owner else b.user_id))
            if ev:
                b.gcal_event_id = ev
                session.add(b)
        except Exception as e:
            logger.warning("[GCal Split] create_event failed for %s: %s", b.id, e)
    session.commit()

    logger.info("[split] бронь %s разделена на %s: %s",
                booking_id, parts, [float(b.final_price or 0) for b in created])
    return [enrich_booking_status(b) for b in created]


# ─── Credit-limit forecast (раннее предупреждение о должниках) ────────────────

@router.get("/{booking_id}/weekly-estimate")
def booking_weekly_estimate(
    booking_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Ориентир недельной скидки для попапа брони в шахматке (только чтение).

    Недельная скидка за объём приходит кредитом в понедельник за прошлую
    неделю — в цене брони её нет. Админы (Егор 21.09) хотят видеть, сколько
    примерно клиент заплатит с её учётом. Считает weekly_rebate
    .estimate_booking_rebate — той же формулой, что понедельничное начисление.
    """
    from app.services.weekly_rebate import estimate_booking_rebate
    try:
        uid = UUID(booking_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Некорректный номер брони")
    booking = session.get(Booking, uid)
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")
    return estimate_booking_rebate(session, booking)


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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

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
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")
    if booking.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Эта бронь не ждёт подтверждения")

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
        raise HTTPException(status_code=400, detail=f"Слот уже занят: {reason}")

    # Списание — общим помощником (то же делает кнопка в Telegram): часы и
    # денежная часть брони по абонементу, при нехватке часов — деньгами как
    # крон; статус confirmed + paid ставит он же (иначе крон спишет второй раз).
    b_owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
    _paid_info = charge_hot_booking_on_approval(session, booking, b_owner, actor=current_user, via="сайт")
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
                # Текст — общий с Telegram-одобрением (ревизия 03.10: часы /
                # бонусные часы / деньги — что реально списано).
                telegram_service._send_message(  # type: ignore[attr-defined]
                    chat_id=b_owner.telegram_id,
                    text=hot_approval_client_text(booking, _res_name, _loc_name, _paid_info),
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

    # Пересчёт цепочки смежных часов ПОСЛЕ подтверждения (Лиза, 2026-08-26).
    # Срочная бронь создаётся как `pending_approval`, а `_compute_block_hours`
    # считает только `confirmed` — поэтому соседние часы друг друга не видят и
    # каждый получает свой тир. Александр Беляев: 5 часов подряд в капсуле двумя
    # бронями дали 15% и 10% вместо общих 20%. Подтверждение переводит бронь в
    # `confirmed`, и вот тут цепочку надо собрать заново.
    if booking.payment_method == "balance" and booking.status == "confirmed":
        try:
            from app.services.consecutive_pricing import recompute_user_chains_for_day
            _owner = _resolve_booking_owner(session, booking)
            if _owner:
                recompute_user_chains_for_day(
                    session, _owner, booking.resource_id, booking.date,
                    actor_id=str(current_user.id), actor_role=current_user.role,
                    reason="approve_booking",
                )
                session.commit()
                session.refresh(booking)
        except Exception:
            session.rollback()
            logger.exception("[consecutive] recompute on approve failed")

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
        raise HTTPException(status_code=404, detail="Некорректный номер брони")

    # Под замком строки, как approve: два «Отклонить» подряд (сайт + Telegram)
    # иначе оба вернули бы бонусные часы.
    booking = session.exec(
        select(Booking).where(Booking.id == b_uuid).with_for_update()
    ).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Бронь не найдена — возможно, её уже удалили")
    if booking.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Эта бронь не ждёт подтверждения")

    admin_reason = (payload.reason if payload and payload.reason else "").strip()

    # Вернуть бонусный час, если бронь оплачивалась бонусом (hot-gate откатывает
    # деньги/часы абонемента, но не бонус). Общий помощник с Telegram-отклонением
    # (ревизия 03.10: бот раньше бонус не возвращал).
    release_rejected_hot_booking(session, booking)

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
