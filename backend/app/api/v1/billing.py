"""Billing endpoints — cron `charge-due` + admin `waive`.

Cron auth: same pattern as /telegram/send-reminders — `?secret=…` query
param matching `TELEGRAM_REMINDER_SECRET` (we reuse it instead of adding
yet another env var; both are owner-only cron triggers).
"""
from __future__ import annotations

import logging
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlmodel import Session

from app.api import deps
from app.core.config import settings
from app.core.permissions import ADMIN_ROLES
from app.db.session import get_session
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


@router.post("/charge-due")
def charge_due_bookings(
    secret: Optional[str] = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Cron: settle every confirmed `pending` booking inside the T-24h window.

    Idempotent — bookings flip to `paid` once and the next run skips them.
    Failures (e.g., a single user row gone) are isolated per-booking so one
    bad row can't stall the whole sweep.
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
                        method_label = (
                            "ч абонемента" if (b.payment_method or "").lower() == "subscription"
                            else "₾"
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
                            f"📅 {when} (Тбилиси)\n"
                            f"📍 {res_name}{loc_line}"
                            f"{client_line}"
                            f"{series_line}\n"
                            f"💸 {amount:g} {method_label}\n\n"
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

    booking = session.get(Booking, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    reason = (payload or {}).get("reason", "")
    ok, status = waive_charge(session, booking, reason=reason, by_user=current_user)
    if not ok:
        if status == "reason_required":
            raise HTTPException(status_code=400, detail="Укажите причину снятия штрафа")
        if status == "already_waived":
            raise HTTPException(status_code=409, detail="Штраф уже снят ранее")
        raise HTTPException(status_code=500, detail=f"Не удалось снять штраф: {status}")

    session.commit()
    session.refresh(booking)

    # Timeline entry for the booking — visible to the owner and admins in
    # the booking-detail event feed. Mirrors what we send to TG so the UI
    # is no longer behind the chat.
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
                "payment_method": booking.payment_method,
                "previous_status": ("paid" if status == "waived_paid_refunded" else "pending"),
            },
        )
    except Exception:
        logger.warning("[billing] timeline log failed", exc_info=True)

    # Admin TG alert + best-effort user notification.
    try:
        amount = float(booking.charge_amount or booking.final_price or 0)
        method_label = (
            "ч абонемента" if (booking.payment_method or "").lower() == "subscription"
            else "₾"
        )
        owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
        owner_label = (owner.email or owner.name) if owner else "—"
        telegram_service.send_admin_event(
            event="booking_charge_waived",
            fields={
                "Бронь": str(booking.id),
                "Клиент": owner_label,
                "Сумма": f"{amount:g} {method_label}",
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
                    f"Сумма {amount:g} {method_label} "
                    f"{'возвращена на баланс' if status == 'waived_paid_refunded' else 'не будет списана'}.\n\n"
                    f"Причина: {reason.strip()}"
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
