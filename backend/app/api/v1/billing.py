"""Billing endpoints — cron `charge-due` + admin `waive`.

Cron auth: same pattern as /telegram/send-reminders — `?secret=…` query
param matching `TELEGRAM_REMINDER_SECRET` (we reuse it instead of adding
yet another env var; both are owner-only cron triggers).
"""
from __future__ import annotations

import logging
from typing import Any, Optional
from uuid import UUID

from contextlib import contextmanager

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlmodel import Session

from app.api import deps
from app.core.config import settings
from app.core.permissions import ADMIN_ROLES
from app.db.session import engine, get_session
from app.models.booking import Booking
from app.models.location import Location
from app.models.resource import Resource
from app.models.therapist_client import TherapistClient
from app.models.user import User
from app.services.billing_defer import (
    booking_start_dt_tbilisi,
    find_due_pending,
    settle_pending_charge,
    waive_charge,
)
from app.services.telegram import telegram_service
from app.services.timeline import timeline_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Arbitrary but stable key for the charge-due advisory lock. Any Postgres
# session asking for the same key gets refused while the sweep holds it.
_CHARGE_DUE_LOCK_KEY = 481516_2342


@contextmanager
def _charge_due_lock():
    """Hold a Postgres advisory lock for the whole charge-due sweep.

    Two overlapping sweeps could each SELECT the same still-`pending` booking
    and settle it twice — the cron fires every 10 min while a sweep with slow
    Telegram calls can run longer than that, and a manual curl can land on top
    of a running cron. `find_due_pending` takes no row locks, so nothing else
    stops that.

    The lock lives on its OWN connection: the sweep commits after every booking,
    which hands the request's connection back to the pool — a session-level lock
    taken on it would be lost (or worse, ride a pooled connection). Closing this
    connection releases the lock even if the sweep dies mid-way.

    Yields True when the lock was acquired, False when another sweep holds it.
    On SQLite (dev) there is nothing to guard — always yields True.
    """
    if engine.dialect.name != "postgresql":
        yield True
        return

    conn = engine.connect()
    acquired = False
    try:
        acquired = bool(
            conn.exec_driver_sql(
                "SELECT pg_try_advisory_lock(%s)", (_CHARGE_DUE_LOCK_KEY,)
            ).scalar()
        )
        yield acquired
    finally:
        if acquired:
            try:
                conn.exec_driver_sql(
                    "SELECT pg_advisory_unlock(%s)", (_CHARGE_DUE_LOCK_KEY,)
                )
            except Exception:
                logger.warning("[billing] advisory unlock failed", exc_info=True)
        conn.close()


@router.post("/charge-due")
def charge_due_bookings(
    secret: Optional[str] = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Cron: settle every confirmed `pending` booking inside the T-24h window.

    Idempotent — bookings flip to `paid` once and the next run skips them, and
    an advisory lock keeps two overlapping sweeps from charging the same booking
    twice. Failures (e.g., a single user row gone) are isolated per-booking so
    one bad row can't stall the whole sweep.
    """
    # Only a dedicated TELEGRAM_REMINDER_SECRET is accepted — no bot-token
    # fallback (this endpoint mutates balances, so the gate must be a real
    # secret). Fail closed if it's unset.
    # TODO: move the secret to an Authorization header (kept as `?secret=`
    # for now to avoid breaking existing cron jobs; it leaks via access logs).
    expected = getattr(settings, "TELEGRAM_REMINDER_SECRET", None)
    if not expected:
        raise HTTPException(status_code=503, detail="Cron secret not configured")
    if secret != expected:
        raise HTTPException(status_code=401, detail="Invalid secret")

    with _charge_due_lock() as acquired:
        if not acquired:
            # Another sweep is still running (slow TG calls outlast the 10-min
            # cron interval). Skipping is the whole point — money moves here.
            logger.warning("[billing] charge-due already in progress — skipping this run")
            return {"ok": True, "skipped": "already_running", "candidates": 0,
                    "settled": 0, "failures": []}
        return _sweep_due_bookings(session)


def _auto_unfreeze_step(session: Session) -> list[dict]:
    """Снять паузы абонементов, чей срок вышел (владелец 01.10: «автоснятие
    по сроку», срок абонемента продлевается ровно на выданные дни).

    Отдельный шаг со своими коммитами и в try/except: сбой здесь НЕ должен
    ломать списание за брони ниже."""
    from datetime import datetime as _dt
    try:
        from app.services.subscription_perks import auto_unfreeze_expired
        done = auto_unfreeze_expired(session, _dt.utcnow())
        session.commit()
        if done:
            logger.info("[billing] auto-unfreeze: %s", [d["email"] for d in done])
        return done
    except Exception:
        session.rollback()
        logger.exception("[billing] auto-unfreeze failed — списание продолжается")
        return []


def _sweep_due_bookings(session: Session) -> dict[str, Any]:
    """The actual sweep. Only ever called while the advisory lock is held."""
    # Сначала снимаем истёкшие паузы: бронь, списываемая следом, должна видеть
    # уже действующий абонемент.
    unfrozen = _auto_unfreeze_step(session)
    due = find_due_pending(session, lookahead_hours=24.0)
    settled = 0
    failures: list[dict] = []

    for b in due:
        try:
            ok, reason = settle_pending_charge(session, b)
            if ok:
                session.commit()
                settled += 1
                # Best-effort TG ping to user about the charge — never block on it.
                # Includes cabinet/location/client so the user can recognise WHICH
                # booking is being settled (multiple pending series at once was
                # the original confusion: "what was that 27₾ for?").
                try:
                    user = session.get(User, b.user_uuid) if b.user_uuid else None
                    if user and user.telegram_id:
                        start = booking_start_dt_tbilisi(b)
                        when = start.strftime("%d.%m %H:%M") if start else "—"
                        amount = float(b.charge_amount or 0)
                        _pm = (b.payment_method or "").lower()
                        # Абонемент исчерпан → settle списал ДЕНЬГИ и обнулил
                        # hours_deducted: тогда это ₾, а не «ч абонемента» —
                        # иначе списание денег было замаскировано (M1).
                        method_label = (
                            "ч абонемента" if _pm == "subscription" and (b.hours_deducted or 0) > 0
                            else "₾"
                        )
                        # Бронь целиком оплачена бонусными часами (они потрачены
                        # при создании) — «💸 0 ₾» только путает.
                        amount_line = (
                            "🎁 Оплачено бонусными часами" if _pm == "bonus" and amount <= 0
                            else f"💸 {amount:g} {method_label}"
                        )

                        # Resource + location names — fall back to the raw id
                        # so a missing row never breaks the message body.
                        res = session.get(Resource, b.resource_id) if b.resource_id else None
                        res_name = (res.name if res else b.resource_id) or b.resource_id or "—"
                        loc = session.get(Location, res.location_id) if res and res.location_id else None
                        loc_line = f" · {loc.name}" if loc else ""

                        # Optional CRM client (specialist bookings)
                        client_line = ""
                        if b.crm_client_id:
                            client = session.get(TherapistClient, b.crm_client_id)
                            if client and client.name:
                                client_line = f"\n👤 {client.name}"

                        # Series tag — helps when a user has 10 weekly slots
                        # being charged one-by-one through the week.
                        series_line = "\n🔁 Из серии" if b.recurring_group_id else ""

                        # Credit-line warnings — appended only when settle
                        # tagged the row as utilisation>=80% or over-limit.
                        # The numbers come from the freshly-updated user
                        # row (balance is already decremented at this
                        # point, so `debt = max(0, -balance)`).
                        credit_warn = ""
                        if reason in ("ok_topup_warn", "ok_over_limit"):
                            credit = float(user.credit_limit or 0)
                            debt = max(0.0, -(user.balance or 0))
                            if reason == "ok_over_limit":
                                credit_warn = (
                                    f"\n\n⚠️ <b>Превышен кредитный лимит</b>\n"
                                    f"Долг: {debt:g}₾, лимит: {credit:g}₾.\n"
                                    f"Срочно пополните баланс — иначе следующие брони могут быть заблокированы."
                                )
                            else:
                                credit_warn = (
                                    f"\n\n⚠️ <b>Использовано {round((debt/credit)*100) if credit else 100}% кредитного лимита</b>\n"
                                    f"Долг: {debt:g}₾ из {credit:g}₾.\n"
                                    f"Пополните баланс, чтобы продолжать бронировать без перебоев."
                                )

                        text = (
                            f"💳 <b>Списание за бронь</b>\n\n"
                            f"📅 {when} (Батуми)\n"
                            f"📍 {res_name}{loc_line}"
                            f"{client_line}"
                            f"{series_line}\n"
                            f"{amount_line}\n\n"
                            f"После 24 часов до начала бронь нельзя отменить с возвратом — "
                            f"если случилось что-то непредвиденное, напишите администратору."
                            f"{credit_warn}"
                        )
                        telegram_service._send_message(  # type: ignore[attr-defined]
                            chat_id=user.telegram_id, text=text, parse_mode="HTML"
                        )

                    # Admin alert for over-limit cases — fires even if user
                    # has no Telegram. The owner needs to know somebody's
                    # blowing past their credit ceiling so we can intervene
                    # (chase payment, freeze new bookings, etc.) before the
                    # situation snowballs.
                    if reason == "ok_over_limit" and user is not None:
                        try:
                            credit = float(user.credit_limit or 0)
                            debt = max(0.0, -(user.balance or 0))
                            telegram_service.send_admin_event(
                                event="credit_limit_exceeded",
                                fields={
                                    "Клиент": user.email or user.name or str(user.id),
                                    "Долг": f"{debt:g}₾",
                                    "Лимит": f"{credit:g}₾",
                                    "Бронь": str(b.id),
                                    "За бронь": f"{float(b.charge_amount or 0):g}₾",
                                },
                            )
                        except Exception:
                            logger.warning("[billing] over-limit admin alert failed", exc_info=True)
                except Exception as e:
                    logger.warning("[billing] TG charge-notice failed for %s: %r", b.id, e)
            else:
                session.rollback()
                failures.append({"booking_id": str(b.id), "reason": reason})
        except Exception as e:
            session.rollback()
            logger.exception("[billing] charge failed for %s", b.id)
            failures.append({"booking_id": str(b.id), "reason": f"exception: {e!s}"})

    # §5#6: если денежный крон что-то не смог списать — не молчим, пингуем
    # админа в TG. Раньше failures просто уезжали в ответ, который никто не
    # читает. Non-blocking. (Полноценный dead-man's-switch на «крон вообще не
    # запустился» — внешний, healthchecks.io — остаётся отдельной задачей.)
    if failures:
        try:
            telegram_service.send_admin_event(
                event="billing_charge_failures",
                fields={
                    "Не списано": f"{len(failures)} из {len(due)}",
                    "Успешно": str(settled),
                    "Примеры": "; ".join(
                        f"{f['booking_id'][:8]}·{str(f['reason'])[:40]}" for f in failures[:5]
                    ) or "—",
                },
            )
        except Exception:
            logger.warning("[billing] charge-failures admin alert failed", exc_info=True)

    return {
        "ok": True,
        "candidates": len(due),
        "settled": settled,
        "failures": failures[:20],  # cap to keep response small
        "unfrozen": len(unfrozen),
    }


@router.post("/bookings/{booking_id}/waive")
def waive_booking_charge(
    booking_id: UUID,
    payload: dict = Body(..., description='{"reason": "..."}'),
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
) -> dict[str, Any]:
    """Admin: cancel the charge on a booking with a reason.

    Visible in:
      - Booking row (`waiver_reason`, `waived_at`, `waived_by`)
      - Timeline entry (TODO Phase 4 — needs Timeline model wiring)
      - Admin TG chat (event = `booking_charge_waived`)

    Use cases: client got sick within 24h and admin wants to forgive the
    charge; double-booking we created and they shouldn't pay; etc.
    """
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin only")

    # Под замком строки — как отмена, вырезка и одобрение (ревизия 03.10):
    # двойной клик «Снять штраф» иначе вернул бы деньги/часы дважды — второй
    # запрос ждёт коммита первого и видит уже 'waived'.
    from sqlmodel import select as _select
    booking = session.exec(
        _select(Booking).where(Booking.id == booking_id).with_for_update()
        .execution_options(populate_existing=True)
    ).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    reason = (payload or {}).get("reason", "")
    # Сколько реально вернули (ревизия 03.10: после отмены — только остаток).
    _returned: dict = {}
    ok, status = waive_charge(session, booking, reason=reason, by_user=current_user, result=_returned)
    if not ok:
        if status == "reason_required":
            raise HTTPException(status_code=400, detail="Укажите причину снятия штрафа")
        if status == "already_waived":
            raise HTTPException(status_code=409, detail="Штраф уже снят ранее")
        if status == "rejected":
            raise HTTPException(
                status_code=409,
                detail="Бронь отклонена — за неё ничего не списывалось, снимать нечего.",
            )
        if status == "pending_approval":
            raise HTTPException(
                status_code=409,
                detail=("Бронь ещё ждёт подтверждения — за неё ничего не списано. Подтвердите её "
                        "(штраф можно снять после подтверждения) или отклоните."),
            )
        raise HTTPException(status_code=500, detail=f"Не удалось снять штраф: {status}")

    session.commit()
    session.refresh(booking)

    # Timeline entry for the booking — visible to the owner and admins in
    # the booking-detail event feed. Mirrors what we send to TG so the UI
    # is no longer behind the chat.
    _money_back = round(float(_returned.get("money", 0) or 0), 2)
    _hours_back = round(float(_returned.get("hours", 0) or 0), 4)
    _bonus_back = round(float(_returned.get("bonus_hours", 0) or 0), 4)
    try:
        amount = float(booking.charge_amount or booking.final_price or 0)
        timeline_service.log_event(
            session=session,
            actor_id=current_user.id,
            actor_role=current_user.role or "admin",
            target_id=str(booking.id),
            target_type="booking",
            event_type="booking_charge_waived",
            description=f"Штраф снят: {reason.strip()}",
            metadata={
                "scenario": status,
                "amount": amount,
                "returned_money": _money_back,
                "returned_hours": _hours_back,
                "returned_bonus_hours": _bonus_back,
                "payment_method": booking.payment_method,
                "previous_status": ("paid" if status == "waived_paid_refunded" else "pending"),
            },
        )
    except Exception:
        logger.warning("[billing] timeline log failed", exc_info=True)

    # Admin TG alert + best-effort user notification.
    try:
        # Что реально вернули (₾ и/или ч): после отмены брони — только остаток.
        _parts = []
        if _money_back >= 0.01:
            _parts.append(f"{_money_back:g} ₾")
        if _hours_back > 0:
            _parts.append(f"{_hours_back:g} ч абонемента")
        if _bonus_back > 0:
            _parts.append(f"{_bonus_back:g} бонусн. ч")
        _after_cancel = bool(_returned.get("cancelled"))
        returned_label = " и ".join(_parts) if _parts else "ничего (всё уже вернула отмена)"
        # Текст клиенту (ревизия 03.10): после отмены — «вернули ещё …» или
        # «уже вернули при отмене», а не «вернули: ничего».
        if status != "waived_paid_refunded":
            client_line = "Оплата за бронь не будет списана."
            if _bonus_back > 0:
                # бронь заранее с бонус-часами: их сняли при создании (ревизия 04.10)
                client_line += f" Бонусные часы вернули: {_bonus_back:g} ч."
        elif _parts:
            client_line = ("Вернули ещё " if _after_cancel else "Вернули: ") + " и ".join(_parts) + "."
        else:
            client_line = "Деньги и часы по этой брони вам уже вернули при отмене."
        owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
        owner_label = (owner.email or owner.name) if owner else "—"
        telegram_service.send_admin_event(
            event="booking_charge_waived",
            fields={
                "Бронь": str(booking.id),
                "Клиент": owner_label,
                "Вернули": (returned_label if status == "waived_paid_refunded"
                            else ("не списывалось" + (f"; бонус-часы: {_bonus_back:g} ч" if _bonus_back > 0 else ""))),
                "Причина": reason.strip(),
                "Кто снял": current_user.email or current_user.name or "admin",
                "Сценарий": status,  # waived_pending or waived_paid_refunded
            },
        )
        if owner and owner.telegram_id:
            telegram_service._send_message(  # type: ignore[attr-defined]
                chat_id=owner.telegram_id,
                text=(
                    f"✅ <b>Штраф за бронь снят</b>\n\n"
                    + f"{client_line}\n\n"
                    + f"Причина: {reason.strip()}"
                ),
                parse_mode="HTML",
            )
    except Exception as e:
        logger.warning("[billing] waive notify failed: %r", e)

    return {
        "ok": True,
        "booking_id": str(booking.id),
        "scenario": status,
        "payment_status": booking.payment_status,
    }
