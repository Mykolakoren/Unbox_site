"""Telegram deep-link binding + webhook + client commands.

Flow:
1. User clicks "Подключить Telegram" in profile.
2. Frontend calls POST /telegram/link-token — backend generates a short-lived token,
   stores it on the user (telegram_link_token + expires_at), returns deep-link URL.
3. Frontend opens https://t.me/<BOT_USERNAME>?start=<token>.
4. Telegram delivers /start <token> to our webhook.
5. Webhook looks up user by token, sets user.telegram_id = chat_id, clears token,
   and replies in Telegram with a confirmation message.

All bot messages carry `reply_markup={"remove_keyboard": True}` so any stale
custom keyboards left over from a previous bot using this token get cleared.

Supported commands (for bound users):
  /start    — connect via deep-link, or see connection hint
  /book     — book a cabinet (location → format → date → cabinet → time → duration)
  /bookings — list upcoming bookings
  /waitlist — list watched slots (still active waitlist subscriptions)
  /balance  — show balance and subscription
  /locations — list our locations with addresses
  /specialists — site link
  /help     — contacts & site

Target audience: specialists/therapists who rent cabinets from Unbox. The /book
flow mirrors the website wizard in a simplified form — no extras, fixed start
at :00/:30, pricing computed server-side via PricingService (so peak hours,
discounts, subscription, and format-based rates all match the site).

Security:
- /telegram/link-token requires authenticated user.
- /telegram/webhook is public (Telegram calls it) but validates
  X-Telegram-Bot-Api-Secret-Token header against TELEGRAM_WEBHOOK_SECRET.
"""
import logging
import secrets
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Any, Optional
from uuid import UUID

import requests
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from sqlmodel import Session, select

from app.api import deps
from app.core.config import settings
from app.db.session import get_session
from app.models.booking import Booking, BookingCreate
from app.models.location import Location
from app.models.resource import Resource
from app.models.user import User
from app.models.waitlist import Waitlist
from app.services.telegram import telegram_service

logger = logging.getLogger(__name__)

router = APIRouter()

LINK_TOKEN_TTL = timedelta(minutes=30)
TG_API_BASE = "https://api.telegram.org"

FORMAT_LABELS = {
    "individual": "Индивид.",
    "group": "Группа",
    "intervision": "Интервизия",
}

# Short codes used in callback_data (must be short — Telegram limits callback_data to 64 bytes)
FORMAT_CODES = {
    "i": "individual",
    "g": "group",
    "v": "intervision",
}
FORMAT_CODES_REV = {v: k for k, v in FORMAT_CODES.items()}

MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
             "июля", "августа", "сентября", "октября", "ноября", "декабря"]
WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

MONTHS_RU_SHORT = ["янв", "фев", "мар", "апр", "май", "июн",
                   "июл", "авг", "сен", "окт", "ноя", "дек"]

# How far ahead the booking wizard offers dates
BOOK_WINDOW_DAYS = 14

# Slot granularity (matches the site): 30 min step, working window 09:00–22:00
SLOT_START_HOUR = 9
SLOT_END_HOUR = 22  # exclusive (last start: 21:30)
SLOT_STEP_MIN = 30

# Available durations (in minutes) — simplified vs the site
DURATION_OPTIONS = [60, 90, 120, 180]


# ── POST /telegram/send-reminders ──────────────────────────────────────────
# Called by cron every 10-15 minutes. Scans for bookings starting in ~2h that
# haven't been reminded yet and fires the Telegram reminder. Excel #58.
#
# Auth: pass `?secret=<TELEGRAM_REMINDER_SECRET>` matching the setting, so
# random HTTP probes can't trigger notifications. Same pattern as the
# webhook secret.

@router.post("/send-reminders")
def send_reminders_endpoint(
    secret: Optional[str] = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    expected = getattr(settings, "TELEGRAM_REMINDER_SECRET", None) or settings.TELEGRAM_BOT_TOKEN
    if not expected:
        raise HTTPException(status_code=503, detail="Telegram reminders not configured")
    if secret != expected:
        raise HTTPException(status_code=401, detail="Invalid secret")

    from app.services.telegram import telegram_service
    from datetime import datetime as _dt, timedelta as _td

    # Scan window: bookings starting in 2h ± 10 minutes that haven't been
    # reminded yet. Window half-width = 10m keeps us aligned with the
    # every-10-minute cron cadence (so a slot can't slip through two runs).
    #
    # Timezone: booking.date + start_time are stored naive as "Tbilisi wall
    # clock" (clients enter 10:00 meaning 10:00 local). The Droplet runs in
    # UTC, so datetime.now() returns naive UTC — comparing those two produces
    # a 4h skew (Asia/Tbilisi = UTC+4, no DST). Explicitly shift "now" into
    # Tbilisi wall-clock so both sides of the comparison are in the same
    # frame of reference.
    TBS_OFFSET = _td(hours=4)
    now = _dt.utcnow() + TBS_OFFSET
    target_lower = now + _td(hours=1, minutes=50)
    target_upper = now + _td(hours=2, minutes=10)

    # Broad date filter first (date column is indexed), then narrow by
    # start_time in Python — start_time is a "HH:MM" string, not a timestamp.
    day_start = target_lower.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = target_upper.replace(hour=23, minute=59, second=59, microsecond=0)
    candidates = session.exec(
        select(Booking)
        .where(Booking.status == "confirmed")
        .where(Booking.reminder_sent_at.is_(None))  # type: ignore
        .where(Booking.date >= day_start)
        .where(Booking.date <= day_end)
    ).all()

    scanned = 0
    sent = 0
    skipped_no_tg = 0
    skipped_wrong_window = 0
    for booking in candidates:
        scanned += 1
        try:
            h, m = map(int, booking.start_time.split(":")[:2])
            start_dt = booking.date.replace(hour=h, minute=m, second=0, microsecond=0)
        except Exception:
            continue
        if not (target_lower <= start_dt <= target_upper):
            skipped_wrong_window += 1
            continue

        # Resolve owner + resource/location labels
        owner: Optional[User] = None
        if booking.user_uuid:
            owner = session.get(User, booking.user_uuid)
        if not owner and booking.user_id:
            owner = session.exec(select(User).where(User.email == booking.user_id)).first()
        if not owner or not owner.telegram_id:
            skipped_no_tg += 1
            continue

        resource_name = booking.resource_id
        location_name: Optional[str] = None
        location_address: Optional[str] = None
        try:
            res_obj = session.get(Resource, booking.resource_id)
            if res_obj:
                resource_name = res_obj.name or booking.resource_id
                if res_obj.location_id:
                    loc_obj = session.get(Location, res_obj.location_id)
                    if loc_obj:
                        location_name = loc_obj.name
                        location_address = loc_obj.address
        except Exception:
            pass

        ok = telegram_service.send_booking_reminder(
            chat_id=str(owner.telegram_id),
            resource_name=resource_name,
            location_name=location_name,
            location_address=location_address,
            date=booking.date,
            start_time=booking.start_time,
            duration_minutes=booking.duration,
            booking_id=str(booking.id),
        )
        if ok:
            # Stored in Tbilisi wall-clock to match booking.date/start_time.
            booking.reminder_sent_at = now
            session.add(booking)
            sent += 1

    if sent:
        session.commit()

    # ── Series-end reminders ──────────────────────────────────────────
    # When a user's recurring series has only 3, 2, or 1 future bookings
    # left, ping them once per threshold so they can decide whether to
    # extend. Dedup is stored in user.crm_data['series_reminders'] as
    # `{group_id: max_threshold_notified}` — we re-notify only if the
    # current future_count is *lower* than the stored threshold.
    from collections import defaultdict
    series_groups: dict[str, list[Booking]] = defaultdict(list)
    series_bookings = session.exec(
        select(Booking)
        .where(Booking.recurring_group_id.is_not(None))  # type: ignore
        .where(Booking.status == "confirmed")
        .where(Booking.date >= now.replace(hour=0, minute=0))
    ).all()
    for b in series_bookings:
        series_groups[b.recurring_group_id].append(b)

    series_sent = 0
    for group_id, group_bookings in series_groups.items():
        future_count = len(group_bookings)
        if future_count > 3:
            continue
        # Pick a representative booking to resolve the owner.
        rep = group_bookings[0]
        owner: Optional[User] = None
        if rep.user_uuid:
            owner = session.get(User, rep.user_uuid)
        if not owner and rep.user_id:
            owner = session.exec(select(User).where(User.email == rep.user_id)).first()
        if not owner or not owner.telegram_id:
            continue
        # Dedup
        crm_data = owner.crm_data or {}
        marks = dict(crm_data.get("series_reminders") or {})
        last_threshold = marks.get(group_id)
        # Send only if we haven't notified at this threshold before. We
        # ratchet down: 3 → 2 → 1, and never re-fire for a higher count.
        if last_threshold is not None and future_count >= last_threshold:
            continue

        resource_name = rep.resource_id
        try:
            res_obj = session.get(Resource, rep.resource_id)
            if res_obj:
                resource_name = res_obj.name or rep.resource_id
        except Exception:
            pass

        # Detect pattern from interval between consecutive dates.
        dates_sorted = sorted([b.date for b in group_bookings])
        if len(dates_sorted) >= 2:
            delta_days = (dates_sorted[1] - dates_sorted[0]).days
        else:
            delta_days = 7
        pattern_label = "еженедельно" if delta_days <= 8 else ("раз в 2 нед." if delta_days <= 16 else "ежемесячно")

        next_date = dates_sorted[0]
        # Build a clean message with a deep-link to the specific series.
        # The frontend reads ?series=<group_id> on /dashboard/bookings and
        # mobile /m/bookings, scrolls to the next-upcoming booking of the
        # series, and surfaces a "Продлить / ОК завершится в срок" banner.
        text = (
            f"⭐ <b>Постоянная бронь подходит к концу</b>\n\n"
            f"{resource_name} · {pattern_label}\n"
            f"Осталось <b>{future_count}</b> "
            f"{'сессия' if future_count == 1 else ('сессии' if future_count < 5 else 'сессий')}\n"
            f"Ближайшая: {next_date.strftime('%d.%m.%Y')} в {rep.start_time}\n\n"
            f"Открыть серию → https://unbox.com.ge/dashboard/bookings?series={group_id}"
        )
        ok = telegram_service.send_message(str(owner.telegram_id), text)
        if ok:
            marks[group_id] = future_count
            new_crm_data = dict(crm_data)
            new_crm_data["series_reminders"] = marks
            owner.crm_data = new_crm_data
            session.add(owner)
            series_sent += 1

    if series_sent:
        session.commit()

    return {
        "scanned": scanned,
        "sent": sent,
        "series_reminders_sent": series_sent,
        "skipped_no_telegram": skipped_no_tg,
        "skipped_wrong_window": skipped_wrong_window,
        "window_from": target_lower.isoformat(),
        "window_to": target_upper.isoformat(),
    }


# ── POST /telegram/daily-summary ──────────────────────────────────────────────
# Runs once a day (cron at 09:00 Tbilisi = 05:00 UTC) to post the previous
# day's totals to the admin group:
#   • bookings: created / cancelled / by branch
#   • cashbox : income / expense / balances by payment method
# Same secret as /send-reminders so ops can cron it without new keys.

@router.post("/daily-summary")
def daily_summary_endpoint(
    secret: Optional[str] = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    expected = getattr(settings, "TELEGRAM_REMINDER_SECRET", None) or settings.TELEGRAM_BOT_TOKEN
    if not expected:
        raise HTTPException(status_code=503, detail="Telegram not configured")
    if secret != expected:
        raise HTTPException(status_code=401, detail="Invalid secret")

    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    from app.models.cashbox_transaction import CashboxTransaction

    # "Yesterday" is the full Tbilisi (UTC+4) calendar day ending at the most
    # recent midnight Tbilisi time. Convert that window back to naive UTC to
    # match what the DB stores.
    TBS = _td(hours=4)
    now_utc = _dt.utcnow()
    now_tbs = now_utc + TBS
    today_tbs_midnight_utc = (now_tbs.replace(hour=0, minute=0, second=0, microsecond=0) - TBS)
    yesterday_start = today_tbs_midnight_utc - _td(days=1)
    yesterday_end = today_tbs_midnight_utc
    date_label = (yesterday_start + TBS).strftime("%d.%m.%Y")

    # ── Bookings summary ──
    bookings = session.exec(
        select(Booking).where(
            Booking.created_at >= yesterday_start,
            Booking.created_at < yesterday_end,
        )
    ).all()
    total_bookings = len(bookings)
    cancelled = [b for b in bookings if b.status == "cancelled"]

    # Locations resolved once
    loc_names: dict = {}
    for loc in session.exec(select(Location)).all():
        loc_names[loc.id] = loc.name

    by_loc: dict = {}
    by_loc_revenue: dict = {}
    total_hours_booked = 0.0  # sum of duration of every active booking created yesterday
    for b in bookings:
        if b.status == "cancelled":
            continue
        name = loc_names.get(b.location_id, b.location_id or "—")
        by_loc[name] = by_loc.get(name, 0) + 1
        by_loc_revenue[name] = by_loc_revenue.get(name, 0.0) + float(b.final_price or 0)
        total_hours_booked += float(b.duration or 0) / 60.0

    # ── Cashbox summary ──
    txs = session.exec(
        select(CashboxTransaction).where(
            CashboxTransaction.date >= yesterday_start,
            CashboxTransaction.date < yesterday_end,
        )
    ).all()
    income_by_method: dict = {}
    expense_by_method: dict = {}
    income_by_branch: dict = {}
    for t in txs:
        amt = float(t.amount or 0)
        method = t.payment_method or "—"
        if t.type == "income":
            income_by_method[method] = income_by_method.get(method, 0.0) + amt
            br = t.branch or "—"
            income_by_branch[br] = income_by_branch.get(br, 0.0) + amt
        elif t.type == "expense":
            expense_by_method[method] = expense_by_method.get(method, 0.0) + amt

    total_income = sum(income_by_method.values())
    total_expense = sum(expense_by_method.values())

    # Running balance by method — all-time sum (income − expense) up to end of
    # yesterday. Gives the "состояние на утро" number admins actually care about.
    all_tx = session.exec(
        select(CashboxTransaction).where(CashboxTransaction.date < yesterday_end)
    ).all()
    balance_by_method: dict = {}
    for t in all_tx:
        method = t.payment_method or "—"
        amt = float(t.amount or 0)
        if t.type == "income":
            balance_by_method[method] = balance_by_method.get(method, 0.0) + amt
        elif t.type == "expense":
            balance_by_method[method] = balance_by_method.get(method, 0.0) - amt

    # ── Compose message ──
    method_label = {
        "cash": "наличные",
        "card_tbc": "TBC",
        "card_bog": "BOG",
        "bonus": "бонусы",
        "balance": "баланс клиента",
    }

    def _fmt_money_dict(d: dict) -> str:
        if not d:
            return "—"
        parts = [f"{method_label.get(k, k)}: <b>{v:g}</b> ₾" for k, v in sorted(d.items(), key=lambda x: -x[1])]
        return " · ".join(parts)

    def _fmt_count_dict(d: dict) -> str:
        if not d:
            return "—"
        return " · ".join(f"{k}: <b>{v}</b>" for k, v in sorted(d.items(), key=lambda x: -x[1]))

    lines = [
        f"📊 <b>Сводка за {date_label}</b>",
        "",
        "<b>Бронирования</b>",
        f"• Всего создано: <b>{total_bookings}</b> (из них отмен: <b>{len(cancelled)}</b>)",
        f"• Часов брони: <b>{total_hours_booked:g}</b> ч",
    ]
    if by_loc:
        lines.append(f"• По филиалам: {_fmt_count_dict(by_loc)}")
    if by_loc_revenue:
        loc_rev = " · ".join(f"{k}: <b>{v:g}</b> ₾" for k, v in sorted(by_loc_revenue.items(), key=lambda x: -x[1]))
        lines.append(f"• Выручка (по броням): {loc_rev}")

    lines.append("")
    lines.append("<b>Касса</b>")
    lines.append(f"• Приход: <b>{total_income:g}</b> ₾ — {_fmt_money_dict(income_by_method)}")
    lines.append(f"• Расход: <b>{total_expense:g}</b> ₾ — {_fmt_money_dict(expense_by_method)}")
    if income_by_branch:
        br_line = " · ".join(f"{k}: <b>{v:g}</b> ₾" for k, v in sorted(income_by_branch.items(), key=lambda x: -x[1]))
        lines.append(f"• Приход по филиалам: {br_line}")

    lines.append("")
    lines.append("<b>Остатки на утро</b>")
    lines.append(f"• {_fmt_money_dict({k: round(v, 2) for k, v in balance_by_method.items()})}")

    # Daily summary goes to the OWNER chat (Микола) instead of the busy
    # admin group. Falls back to admin chat if owner chat isn't set, so
    # legacy installs still work.
    sent = telegram_service.send_owner_summary("\n".join(lines))
    return {
        "sent": sent,
        "date": date_label,
        "bookings": total_bookings,
        "cancelled": len(cancelled),
        "income": total_income,
        "expense": total_expense,
    }


# ── POST /telegram/weekly-cashback ────────────────────────────────────────────
# Monday-morning settlement: for each user with confirmed balance-paid
# bookings during the previous Mon–Sun, find the weekly_progressive tier
# they fulfilled, refund the per-booking delta to their balance, and
# send them a Telegram digest of the past week. Cron from ops:
#   curl -X POST 'https://unbox.com.ge/api/v1/telegram/weekly-cashback?secret=<SECRET>'
# Optional `?user_id=<uuid>&dry_run=true` for ops-only test runs.

@router.post("/weekly-cashback")
def weekly_cashback_endpoint(
    secret: Optional[str] = None,
    user_id: Optional[str] = None,
    dry_run: bool = False,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    expected = getattr(settings, "TELEGRAM_REMINDER_SECRET", None) or settings.TELEGRAM_BOT_TOKEN
    if not expected:
        raise HTTPException(status_code=503, detail="Telegram not configured")
    if secret != expected:
        raise HTTPException(status_code=401, detail="Invalid secret")

    from app.services.weekly_cashback import (
        previous_tbilisi_week_bounds,
        compute_weekly_cashback_for_user,
        format_telegram_digest,
    )
    from app.services.telegram import telegram_service

    week_start, week_end = previous_tbilisi_week_bounds()

    # Pick users to process. Default: anyone with a confirmed booking in
    # the window. Caller can scope to a single user via ?user_id.
    if user_id:
        try:
            target = session.get(User, UUID(user_id))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid user_id")
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        users = [target]
    else:
        rows = session.exec(
            select(User).where(
                User.id.in_(  # type: ignore[attr-defined]
                    select(Booking.user_uuid).where(
                        Booking.status == "confirmed",
                        Booking.payment_method == "balance",
                        Booking.date >= week_start,
                        Booking.date < week_end,
                    )
                )
            )
        ).all()
        users = list(rows)

    processed = 0
    cashback_total = 0.0
    sent = 0
    samples = []
    for u in users:
        summary = compute_weekly_cashback_for_user(
            session=session,
            user=u,
            week_start=week_start,
            week_end=week_end,
            apply=not dry_run,
        )
        processed += 1
        cashback_total += summary["cashback"]
        if not dry_run and u.telegram_id:
            text = format_telegram_digest(u, summary)
            ok = telegram_service.send_message(chat_id=str(u.telegram_id), text=text)
            if ok:
                sent += 1
        if dry_run and len(samples) < 3:
            samples.append({"user": u.email, **summary})

    return {
        "ok": True,
        "dry_run": dry_run,
        "week_start": week_start.strftime("%Y-%m-%d"),
        "week_end": (week_end - timedelta(days=1)).strftime("%Y-%m-%d"),
        "users_processed": processed,
        "cashback_total": round(cashback_total, 2),
        "tg_sent": sent,
        "samples": samples,
    }


# ── POST /telegram/resolve-username ───────────────────────────────────────────
# Admin-only helper: turn `@username` into a numeric chat_id by hitting
# Telegram's getChat. Works only if the user has at some point started the
# bot OR shares a public group with it. If neither — Telegram returns
# "chat not found" and we tell the admin what to do (send the user a
# deep-link via the existing /telegram/link-token flow).

@router.post("/resolve-username")
def resolve_telegram_username(
    body: dict = Body(...),
    current_user: User = Depends(deps.require_admin),
) -> dict[str, Any]:
    """Resolve @username → numeric chat_id via Telegram getChat.

    Body: { "username": "@petrik" }   (with or without @)
    Returns: { "chat_id": "12345", "name": "Pavel" } on success,
             404 with a Russian message otherwise.
    """
    raw = (body.get("username") or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Укажите @username")
    # Numeric chat_id passed through as-is — no resolve needed.
    if raw.lstrip("-").isdigit():
        return {"chat_id": raw, "name": None}
    handle = raw if raw.startswith("@") else f"@{raw}"
    if not settings.TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Бот не сконфигурирован")
    try:
        r = requests.get(
            f"{TG_API_BASE}/bot{settings.TELEGRAM_BOT_TOKEN}/getChat",
            params={"chat_id": handle},
            timeout=10,
        )
    except requests.RequestException as e:
        logger.warning("[tg:resolve] network error: %r", e)
        raise HTTPException(status_code=502, detail="Не удалось связаться с Telegram")
    data = r.json() if r.content else {}
    if not data.get("ok"):
        # Distinguish "chat not found" from generic errors so the admin
        # gets actionable advice instead of a confusing 502.
        desc = data.get("description") or ""
        if "not found" in desc.lower() or r.status_code == 400:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Telegram-привязка не работает: владелец {handle} ещё ни разу не писал "
                    f"нашему боту. Попросите ЕГО (не себя) открыть @Unbox_Booking_G_Bot "
                    f"и нажать «Start», после чего попробуйте снова."
                ),
            )
        logger.warning("[tg:resolve] bot API error: %r", data)
        raise HTTPException(status_code=502, detail="Telegram вернул ошибку: см. логи")
    chat = data.get("result") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        raise HTTPException(status_code=502, detail="Telegram вернул пустой ответ")
    full_name = " ".join(filter(None, [chat.get("first_name"), chat.get("last_name")])) or None
    return {"chat_id": str(chat_id), "name": full_name, "username": chat.get("username")}


# ── POST /telegram/link-token ─────────────────────────────────────────────────

@router.post("/link-token")
def create_link_token(
    *,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
) -> dict[str, Any]:
    """Generate a one-time token for binding this user's Telegram account.

    2026-06-05 owner: reuse валидный токен если он ещё не истёк. Раньше
    каждый клик «Подключить» в профиле генерил новый токен и затирал
    старый. Если юзер успел открыть первую ссылку в Telegram, а потом
    нажал «Подключить» ещё раз — старая ссылка превращалась в
    «❌ Ссылка недействительна» при попытке /start. Теперь — стабильно.
    """
    # Если уже есть живой токен — возвращаем его, не создавая новый.
    existing_token = current_user.telegram_link_token
    existing_exp = current_user.telegram_link_token_expires_at
    if existing_token and existing_exp:
        exp_aware = existing_exp if existing_exp.tzinfo else existing_exp.replace(tzinfo=timezone.utc)
        if exp_aware > datetime.now(timezone.utc):
            url = f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start={existing_token}"
            return {
                "token": existing_token,
                "url": url,
                "expires_at": exp_aware.isoformat(),
            }

    # Нет валидного — генерим новый.
    token = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + LINK_TOKEN_TTL

    current_user.telegram_link_token = token
    current_user.telegram_link_token_expires_at = expires_at
    session.add(current_user)
    session.commit()

    url = f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start={token}"
    return {
        "token": token,
        "url": url,
        "expires_at": expires_at.isoformat(),
    }


# ── POST /telegram/webhook ────────────────────────────────────────────────────

@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    session: Session = Depends(get_session),
    x_telegram_bot_api_secret_token: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """Receive updates from Telegram."""
    expected = settings.TELEGRAM_WEBHOOK_SECRET
    if expected and x_telegram_bot_api_secret_token != expected:
        logger.warning("[tg:webhook] bad secret token — rejecting")
        raise HTTPException(status_code=403, detail="forbidden")

    try:
        update = await request.json()
    except Exception:
        logger.warning("[tg:webhook] invalid JSON body")
        return {"ok": True}

    # ── Inline-keyboard callbacks (cabinet booking flow) ──────────────────
    callback = update.get("callback_query")
    if callback:
        return _handle_callback(session, callback)

    message = update.get("message") or update.get("edited_message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    text = (message.get("text") or "").strip()
    from_user = message.get("from") or {}
    username = from_user.get("username")

    # 2026-06-05 owner: detailed logging для отладки binding-флоу
    # (Valentina не привязывается — нужно увидеть что именно шлёт TG).
    text_preview = (text[:60] + "…") if len(text) > 60 else text
    logger.info(
        "[tg:webhook] in: chat_id=%s username=%s text=%r",
        chat_id, username, text_preview,
    )

    if not chat_id or not text:
        return {"ok": True}

    # Hot-booking reject-reason capture — replies to bot's prompt in admin
    # chat. Must run BEFORE command parsing so that arbitrary text replies
    # are processed without falling into the unknown-command fallback.
    try:
        if _handle_reject_reason_reply(session, message):
            return {"ok": True}
    except Exception:
        logger.warning("[tg:reject-reason] handler error", exc_info=True)

    # Normalise — strip "/foo@BotName" suffix that Telegram adds in groups
    first_word = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""

    # ── /start [token] — deep-link binding ────────────────────────────────
    if first_word == "/start":
        return _handle_start(session, chat_id, text, username)

    # ── /chatid — debug helper, replies with the chat's numeric id.
    # Works in DMs, groups, and supergroups. Used when setting up the
    # admin alert channel (we paste this id into TELEGRAM_ADMIN_CHAT_ID).
    if first_word in ("/chatid", "/getid", "/id"):
        chat_type = chat.get("type", "?")
        chat_title = chat.get("title") or chat.get("first_name") or ""
        body = (
            f"<b>Chat ID:</b> <code>{chat_id}</code>\n"
            f"type: <code>{chat_type}</code>"
        )
        if chat_title:
            body += f"\ntitle: <code>{escape(str(chat_title))}</code>"
        _send(chat_id, body, parse_mode="HTML")
        return {"ok": True}

    # ── Other commands — require a bound user ─────────────────────────────
    user = session.exec(
        select(User).where(User.telegram_id == str(chat_id))
    ).first()

    if first_word == "/bookings":
        return _handle_bookings(session, chat_id, user)
    if first_word in ("/waitlist", "/watch"):
        return _handle_waitlist(session, chat_id, user)
    if first_word == "/balance":
        return _handle_balance(chat_id, user)
    if first_word == "/locations":
        return _handle_locations(session, chat_id)
    if first_word == "/specialists":
        _send(chat_id,
              "<b>Наши специалисты</b>\n\n"
              "Полный список с описанием и записью:\n"
              "https://unbox.com.ge/specialists",
              parse_mode="HTML")
        return {"ok": True}
    if first_word == "/book":
        return _handle_book_start(session, chat_id, user)
    if first_word == "/help":
        return _handle_help(chat_id, user)

    # Fallback for plain text / unknown command
    if user:
        _send(chat_id,
              "Я понимаю команды из меню ниже:\n"
              "/book — забронировать кабинет\n"
              "/bookings — мои брони\n"
              "/waitlist — отслеживаемые слоты\n"
              "/balance — баланс и подписка\n"
              "/locations — где мы находимся\n"
              "/help — связь с администратором")
    else:
        _send(chat_id,
              "Привет! Я бот уведомлений Unbox. "
              "Чтобы получать подтверждения и напоминания, "
              "подключите аккаунт в профиле: https://unbox.com.ge/profile")

    # Admin visibility: unknown input is a signal that either the client
    # is confused, or they actually want something our bot doesn't do yet.
    # Useful for discovering what to automate next.
    try:
        who = escape(user.name or user.email) if user else "anonymous"
        preview = escape(text[:200] + ("…" if len(text) > 200 else ""))
        telegram_service.send_admin_alert(
            f"⚠️ Бот не понял сообщение\n\n"
            f"👤 {who} (tg chat_id: <code>{chat_id}</code>)\n"
            f"💬 <i>{preview}</i>"
        )
    except Exception as _e:
        logger.warning("[tg:admin-alert] fallback alert failed: %r", _e)

    return {"ok": True}


# ── Command handlers ──────────────────────────────────────────────────────────

def _handle_start(session: Session, chat_id: int, text: str, username: Optional[str]) -> dict:
    parts = text.split(maxsplit=1)
    payload = parts[1].strip() if len(parts) > 1 else ""

    if not payload:
        # Plain /start — if already bound, greet; else instruct
        bound = session.exec(select(User).where(User.telegram_id == str(chat_id))).first()
        if bound:
            _send(chat_id,
                  f"Привет, {escape(bound.name or 'друг')}! Вы подключены. "
                  "Нажмите кнопку меню внизу слева, чтобы посмотреть команды.")
        else:
            _send(chat_id,
                  "Привет! Чтобы подключить уведомления, откройте профиль на сайте "
                  "и нажмите «Подключить Telegram»:\n\n"
                  "https://unbox.com.ge/profile")
        return {"ok": True}

    # Find user by one-time token
    user = session.exec(select(User).where(User.telegram_link_token == payload)).first()
    if not user:
        _send(chat_id, "❌ Ссылка недействительна. Попробуйте снова из профиля на сайте.")
        return {"ok": True}

    exp = user.telegram_link_token_expires_at
    if exp is not None:
        exp_aware = exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)
        if exp_aware < datetime.now(timezone.utc):
            user.telegram_link_token = None
            user.telegram_link_token_expires_at = None
            session.add(user); session.commit()
            _send(chat_id, "⏰ Ссылка истекла. Сгенерируйте новую в профиле.")
            return {"ok": True}

    # Auto-merge: if another user already has this chat_id (typically a
    # placeholder created by the Telegram Login Widget — `<chat_id>@telegram.unbox`)
    # — consolidate them onto the real account we're binding to.
    merged_note = ""
    existing = session.exec(
        select(User).where(User.telegram_id == str(chat_id), User.id != user.id)
    ).first()
    if existing:
        try:
            _merge_into(session, absorb=existing, keep=user)
            merged_note = f"\n\nДанные предыдущего Telegram-аккаунта объединены."
            logger.info("[tg:webhook] auto-merged user=%s into=%s (chat_id=%s)",
                        existing.id, user.id, chat_id)
        except Exception as e:
            logger.error("[tg:webhook] auto-merge failed: %r", e)
            # Fall through — still bind the token so the link works.

    user.telegram_id = str(chat_id)
    user.telegram_link_token = None
    user.telegram_link_token_expires_at = None
    session.add(user); session.commit()

    name = escape(user.name or "друг")
    handle = f" (@{escape(username)})" if username else ""
    _send(
        chat_id,
        f"✅ Готово, <b>{name}</b>{handle}! Telegram подключён.{escape(merged_note)}\n\n"
        f"Вы будете получать подтверждения и напоминания о бронях сюда. "
        f"Команды — в кнопке меню снизу слева.",
        parse_mode="HTML",
    )
    logger.info("[tg:webhook] bound user=%s chat_id=%s", user.id, chat_id)
    return {"ok": True}


def _merge_into(session: Session, *, absorb: User, keep: User) -> None:
    """Move every FK from `absorb` onto `keep`, sum balances, delete `absorb`.
    Trimmed version of /users/merge — no audit trail, for auto-merge only.
    Runs inside the caller's transaction; the caller commits."""
    from sqlalchemy import text as _text

    params_uuid = {"s": absorb.id, "t": keep.id}
    params_sstr = {"s_str": str(absorb.id), "t_str": str(keep.id)}
    params_email = {"s_email": absorb.email, "t_email": keep.email}

    for sql, p in [
        ('UPDATE booking SET user_uuid = :t WHERE user_uuid = :s', params_uuid),
        ('UPDATE booking SET user_id = :t_email WHERE user_id = :s_email', params_email),
        ('UPDATE booking SET cancelled_by = :t_email WHERE cancelled_by = :s_email', params_email),
        ('UPDATE waitlist SET user_uuid = :t WHERE user_uuid = :s', params_uuid),
        ('UPDATE waitlist SET user_id = :t_email WHERE user_id = :s_email', params_email),
        ('UPDATE cashbox_transactions SET client_id = :t_email WHERE client_id = :s_email', params_email),
        ('UPDATE cashbox_transactions SET client_id = :t_str WHERE client_id = :s_str', params_sstr),
        ('UPDATE cashbox_transactions SET credited_user_id = :t_str WHERE credited_user_id = :s_str', params_sstr),
        ('UPDATE notifications SET recipient_id = :t_str WHERE recipient_id = :s_str', params_sstr),
    ]:
        session.execute(_text(sql), p)

    # Carry over scalar fields where the keeper is empty
    for attr in ("name", "phone", "avatar_url", "google_id"):
        if not getattr(keep, attr, None) and getattr(absorb, attr, None):
            setattr(keep, attr, getattr(absorb, attr))
    keep.balance = float(keep.balance or 0) + float(absorb.balance or 0)
    keep.credit_limit = max(float(keep.credit_limit or 0), float(absorb.credit_limit or 0))
    if not keep.subscription and absorb.subscription:
        keep.subscription = absorb.subscription

    # Drop telegram_id + poison-email the absorbee, then delete.
    absorb.telegram_id = None
    absorb.email = f"merged-into-{keep.id}-{absorb.id}@deleted.unbox"
    session.add(absorb)
    session.flush()
    session.delete(absorb)


def _handle_bookings(session: Session, chat_id: int, user: Optional[User]) -> dict:
    if not user:
        _send(chat_id,
              "Чтобы видеть свои брони, подключите аккаунт в профиле:\n"
              "https://unbox.com.ge/profile")
        return {"ok": True}

    # Today's start in Tbilisi calendar (server runs UTC; Booking.date is
    # stored as Tbilisi-calendar-day midnight, naive). At UTC 22:00 the
    # naive datetime.now() still says Friday while in Tbilisi it's already
    # Saturday — user expects to see Saturday's bookings. Shift to Tbilisi
    # local first, drop time, then drop tzinfo to compare with the naive
    # column.
    _TBS = timedelta(hours=4)
    today_start = (datetime.utcnow() + _TBS).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    # Match bookings either by email (legacy soft FK) OR by UUID (primary FK
    # on modern rows). Fixes the case where a user booked via the site and
    # later linked Telegram — the bookings live on the same user row, but the
    # `user_id` column may be stale (e.g. after an email change), while
    # `user_uuid` is always stable.
    bookings = session.exec(
        select(Booking)
        .where(
            (Booking.user_uuid == user.id) | (Booking.user_id == user.email)
        )
        .where(Booking.status == "confirmed")
        .where(Booking.date >= today_start)
        .order_by(Booking.date, Booking.start_time)
    ).all()

    if not bookings:
        _send(chat_id,
              "📅 Предстоящих броней нет.\n\n"
              "Забронировать: /book или https://unbox.com.ge")
        return {"ok": True}

    # Cap at 10 to keep message short
    bookings = bookings[:10]

    # Preload resource & location names
    res_ids = {b.resource_id for b in bookings}
    resources = {r.id: r for r in session.exec(select(Resource).where(Resource.id.in_(res_ids))).all()}  # type: ignore
    loc_ids = {r.location_id for r in resources.values() if r.location_id}
    locations = {l.id: l for l in session.exec(select(Location).where(Location.id.in_(loc_ids))).all()} if loc_ids else {}  # type: ignore

    lines = ["📅 <b>Предстоящие брони</b>\n"]
    for b in bookings:
        res = resources.get(b.resource_id)
        loc = locations.get(res.location_id) if res and res.location_id else None
        date_str = _fmt_date_short(b.date)
        end_time = _compute_end_time(b.start_time, b.duration)
        res_name = escape(res.name if res else b.resource_id)
        loc_name = f" · {escape(loc.name)}" if loc else ""
        lines.append(
            f"\n<b>{date_str}</b>, {escape(b.start_time)}–{end_time}\n"
            f"📍 {res_name}{loc_name}"
        )

    lines.append("\n\nУправление: https://unbox.com.ge/bookings")
    _send(chat_id, "\n".join(lines), parse_mode="HTML")
    return {"ok": True}


def _handle_waitlist(session: Session, chat_id: int, user: Optional[User]) -> dict:
    """List the user's still-active waitlist subscriptions.

    Mirrors `_handle_bookings` shape: bound-user check, today-cutoff so
    yesterday's expired subscriptions don't pollute the view, location
    name lookup, capped to 10. We intentionally show entries from today
    onward (not just future): if someone subscribed for tonight 19:00 and
    runs /waitlist at 18:50, that entry is still meaningful.
    """
    if not user:
        _send(chat_id,
              "Чтобы видеть отслеживаемые слоты, подключите аккаунт в профиле:\n"
              "https://unbox.com.ge/profile")
        return {"ok": True}

    # Tbilisi-day cutoff — same logic as /bookings. Entries from earlier
    # in today still show (they may yet fire), but yesterday's are dropped.
    _TBS = timedelta(hours=4)
    today_start = (datetime.utcnow() + _TBS).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    entries = session.exec(
        select(Waitlist)
        .where(
            (Waitlist.user_uuid == user.id) | (Waitlist.user_id == user.email)
        )
        .where(Waitlist.status == "active")
        .where(Waitlist.date >= today_start)
        .order_by(Waitlist.date, Waitlist.start_time)
    ).all()

    if not entries:
        _send(chat_id,
              "👀 <b>Отслеживаемых слотов нет.</b>\n\n"
              "Когда нужный слот занят, нажмите «Сообщить, когда освободится» "
              "в шахматке — и я буду следить за ним за вас.\n\n"
              "Шахматка: https://unbox.com.ge/booking",
              parse_mode="HTML")
        return {"ok": True}

    entries = entries[:10]

    res_ids = {e.resource_id for e in entries}
    resources = {r.id: r for r in session.exec(select(Resource).where(Resource.id.in_(res_ids))).all()}  # type: ignore
    loc_ids = {r.location_id for r in resources.values() if r.location_id}
    locations = {l.id: l for l in session.exec(select(Location).where(Location.id.in_(loc_ids))).all()} if loc_ids else {}  # type: ignore

    lines = ["👀 <b>Отслеживаемые слоты</b>\n"]
    for e in entries:
        res = resources.get(e.resource_id)
        loc = locations.get(res.location_id) if res and res.location_id else None
        date_str = _fmt_date_short(e.date)
        res_name = escape(res.name if res else e.resource_id)
        loc_name = f" · {escape(loc.name)}" if loc else ""
        lines.append(
            f"\n<b>{date_str}</b>, {escape(e.start_time)}–{escape(e.end_time)}\n"
            f"📍 {res_name}{loc_name}"
        )

    lines.append(
        "\n\nКак только в этом центре освободится любой кабинет на это время — пришлю уведомление сюда.\n"
        "Управление: https://unbox.com.ge/dashboard/waitlist"
    )
    _send(chat_id, "\n".join(lines), parse_mode="HTML")
    return {"ok": True}


def _handle_balance(chat_id: int, user: Optional[User]) -> dict:
    if not user:
        _send(chat_id,
              "Чтобы видеть баланс, подключите аккаунт:\n"
              "https://unbox.com.ge/profile")
        return {"ok": True}

    balance = user.balance or 0
    lines = [f"💰 <b>Баланс:</b> {balance:g} ₾"]

    sub = user.subscription or {}
    if sub and sub.get("plan"):
        plan = sub.get("plan", "—")
        hrs = sub.get("remaining_hours", 0)
        lines.append(f"🎫 <b>Абонемент:</b> {escape(str(plan))} · осталось {hrs:g} ч")
    else:
        lines.append("🎫 Абонемент не активен")

    if user.personal_discount_percent:
        lines.append(f"🏷 Персональная скидка: {user.personal_discount_percent}%")

    lines.append("\n👉 https://unbox.com.ge/profile")
    _send(chat_id, "\n".join(lines), parse_mode="HTML")
    return {"ok": True}


def _handle_locations(session: Session, chat_id: int) -> dict:
    locations = session.exec(select(Location)).all()
    if not locations:
        _send(chat_id, "Список локаций временно недоступен.")
        return {"ok": True}

    lines = ["📍 <b>Наши локации</b>\n"]
    for loc in locations:
        lines.append(f"\n<b>{escape(loc.name)}</b>\n{escape(loc.address)}")

    lines.append("\n\nВсе кабинеты: https://unbox.com.ge")
    _send(chat_id, "\n".join(lines), parse_mode="HTML")
    return {"ok": True}


def _handle_help(chat_id: int, user: Optional[User]) -> dict:
    body = (
        "<b>Нужна помощь?</b>\n\n"
        "• Сайт: https://unbox.com.ge\n"
        "• Мои брони: https://unbox.com.ge/bookings\n"
        "• Написать администратору: @UnboxCenter\n\n"
    )
    if user:
        body += (
            "Команды:\n"
            "/book — забронировать кабинет\n"
            "/bookings — мои брони\n"
            "/balance — баланс и подписка\n"
            "/locations — где мы находимся\n"
        )
    else:
        body += "Чтобы получать уведомления и пользоваться командами, подключитесь в профиле: https://unbox.com.ge/profile"
    _send(chat_id, body, parse_mode="HTML")

    # Escalate to admin group so someone can proactively reach out.
    try:
        who = escape(user.name or user.email) if user else "anonymous"
        telegram_service.send_admin_alert(
            f"🆘 /help от клиента\n\n"
            f"👤 {who} (tg chat_id: <code>{chat_id}</code>)\n"
            f"→ клиент нажал /help или попросил администратора"
        )
    except Exception as _e:
        logger.warning("[tg:admin-alert] /help alert failed: %r", _e)

    return {"ok": True}


# ── /book — multi-step cabinet booking via inline keyboard ────────────────────
#
# Callback data schema (kept short — Telegram limits callback_data to 64 bytes).
# All steps carry the full selection state so the flow is stateless server-side.
#
#   b_l:{loc}                              — location picked
#   b_f:{loc}:{fmt}                        — format picked (i|g|v)
#   b_d:{loc}:{fmt}:{YYYYMMDD}             — date picked
#   b_r:{loc}:{fmt}:{YYYYMMDD}:{res_idx}   — resource picked (index into session-specific list)
#   b_t:{loc}:{fmt}:{YYYYMMDD}:{res_idx}:{HHMM}       — time picked
#   b_dur:{loc}:{fmt}:{YYYYMMDD}:{res_idx}:{HHMM}:{min}  — duration picked (confirm screen)
#   b_ok:{loc}:{fmt}:{YYYYMMDD}:{res_idx}:{HHMM}:{min}   — final confirm
#   b_back:{step}:...                      — back-navigation (re-renders previous step)
#   b_cancel                               — cancel whole flow
#
# "res_idx" is the position of the resource within the filtered list for the
# chosen (location, format). Using an index instead of resource_id keeps
# callback_data well under 64 bytes even for long resource IDs.

def _handle_book_start(session: Session, chat_id: int, user: Optional[User]) -> dict:
    """Entry point: /book — show list of locations."""
    if not user:
        _send(chat_id,
              "Чтобы бронировать через бот, подключите аккаунт в профиле:\n"
              "https://unbox.com.ge/profile\n\n"
              "Или забронируйте через сайт: https://unbox.com.ge")
        return {"ok": True}

    # Explicit ordering: Unbox One → Unbox Uni → Neo School. Falls back to
    # alphabetical for any new locations that show up later.
    LOCATION_ORDER = ["unbox_one", "unbox_uni", "neo_school"]
    raw_locations = session.exec(select(Location)).all()
    def _loc_key(loc):
        try:
            return (LOCATION_ORDER.index(loc.id), loc.name)
        except ValueError:
            return (len(LOCATION_ORDER), loc.name)
    locations = sorted(raw_locations, key=_loc_key)
    if not locations:
        _send(chat_id, "Локации временно недоступны. Попробуйте через сайт: https://unbox.com.ge")
        return {"ok": True}

    rows = []
    for loc in locations:
        rows.append([{
            "text": _loc_label(loc)[:60],
            "callback_data": f"b_l:{loc.id}",
        }])
    rows.append([{"text": "← Отмена", "callback_data": "b_cancel"}])

    _send(
        chat_id,
        "🏢 <b>Бронирование кабинета</b>\n\nВыберите локацию:",
        parse_mode="HTML",
        inline_keyboard=rows,
    )
    return {"ok": True}


def _handle_callback(session: Session, callback: dict) -> dict:
    """Route inline-keyboard button clicks to the right booking step."""
    callback_id = callback.get("id")
    data = callback.get("data") or ""
    message = callback.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    message_id = message.get("message_id")
    from_user = callback.get("from") or {}
    from_user_id = from_user.get("id")

    if not callback_id or not chat_id or not message_id:
        return {"ok": True}

    # ── Admin hot-booking approve/reject (group chat callbacks) ──────────
    # `ba:` / `br:` callbacks live in the admin-group chat, so the chat_id
    # is a group, not a user. Auth by `callback.from.id` matched to a User
    # with admin role. Booking-flow callbacks below still use chat_id-bound
    # personal-chat lookup.
    if data.startswith("ba:") or data.startswith("br:"):
        return _handle_hot_booking_callback(session, callback_id, chat_id, message_id, from_user_id, data)

    # Require bound user for all booking callbacks
    user = session.exec(
        select(User).where(User.telegram_id == str(chat_id))
    ).first()
    if not user:
        _answer_callback(callback_id, "Сначала подключите аккаунт в профиле", show_alert=True)
        return {"ok": True}

    try:
        if data == "b_cancel":
            _edit(chat_id, message_id, "Отменено. /book — чтобы начать заново.")
            _answer_callback(callback_id, "")
            return {"ok": True}

        # Busy-slot tap on the time picker. Earlier this used `b_cancel` as
        # a fake "no-op", which actually killed the whole booking flow with
        # "Отменено" — admins reported this exact symptom. Now it's a real
        # no-op that pops a tooltip but keeps the keyboard intact.
        if data.startswith("b_busy:"):
            _answer_callback(callback_id, "Этот слот занят — выберите свободное время", show_alert=True)
            return {"ok": True}

        if data.startswith("b_l:"):
            loc = data[4:]
            return _book_step_format(session, callback_id, chat_id, message_id, loc)

        if data.startswith("b_f:"):
            _, loc, fmt = data.split(":", 2)
            return _book_step_date(session, callback_id, chat_id, message_id, loc, fmt)

        if data.startswith("b_d:"):
            _, loc, fmt, ymd = data.split(":", 3)
            return _book_step_resource(session, callback_id, chat_id, message_id, loc, fmt, ymd)

        if data.startswith("b_r:"):
            _, loc, fmt, ymd, idx = data.split(":", 4)
            return _book_step_time(session, callback_id, chat_id, message_id, loc, fmt, ymd, int(idx))

        if data.startswith("b_t:"):
            _, loc, fmt, ymd, idx, hhmm = data.split(":", 5)
            return _book_step_duration(session, callback_id, chat_id, message_id, loc, fmt, ymd, int(idx), hhmm)

        if data.startswith("b_dur:"):
            _, loc, fmt, ymd, idx, hhmm, mins = data.split(":", 6)
            return _book_step_confirm(session, callback_id, chat_id, message_id, user,
                                      loc, fmt, ymd, int(idx), hhmm, int(mins))

        if data.startswith("b_ok:"):
            _, loc, fmt, ymd, idx, hhmm, mins = data.split(":", 6)
            return _book_do_confirm(session, callback_id, chat_id, message_id, user,
                                    loc, fmt, ymd, int(idx), hhmm, int(mins))
    except Exception as e:
        logger.error("[tg:book] callback error: %r data=%s", e, data, exc_info=True)
        _answer_callback(callback_id, "Что-то пошло не так", show_alert=True)
        return {"ok": True}

    _answer_callback(callback_id, "")
    return {"ok": True}


# ── Step 1 already in _handle_book_start: pick location ─────────────────────

def _book_step_format(session: Session, callback_id: str, chat_id: int, message_id: int, loc: str) -> dict:
    """Step 2: pick format (individual/group/intervision).

    We show only formats that at least one active resource in this location supports.
    """
    location = session.get(Location, loc)
    if not location:
        _answer_callback(callback_id, "Локация не найдена", show_alert=True)
        return {"ok": True}

    resources = session.exec(
        select(Resource)
        .where(Resource.location_id == loc, Resource.is_active == True)  # noqa: E712
    ).all()
    if not resources:
        _edit(chat_id, message_id,
              f"В локации <b>{escape(_loc_label(location))}</b> нет доступных кабинетов.",
              parse_mode="HTML")
        _answer_callback(callback_id, "")
        return {"ok": True}

    # Union of formats offered by at least one active resource
    offered = set()
    for r in resources:
        for f in (r.formats or []):
            offered.add(f)

    # Hard-rule: Neo School is rented to us as group/event space only —
    # never expose individual/intervision options for it even if a resource
    # is mistagged in the DB.
    if loc == "neo_school":
        offered &= {"group"}

    order = ["individual", "group", "intervision"]
    rows, row = [], []
    for fmt in order:
        if fmt not in offered:
            continue
        code = FORMAT_CODES_REV[fmt]
        row.append({
            "text": FORMAT_LABELS[fmt],
            "callback_data": f"b_f:{loc}:{code}",
        })
        if len(row) == 3:
            rows.append(row); row = []
    if row:
        rows.append(row)
    rows.append([{"text": "← Отмена", "callback_data": "b_cancel"}])

    _edit(
        chat_id, message_id,
        f"🏢 <b>{escape(_loc_label(location))}</b>\n\nВыберите формат:",
        parse_mode="HTML",
        inline_keyboard=rows,
    )
    _answer_callback(callback_id, "")
    return {"ok": True}


def _book_step_date(session: Session, callback_id: str, chat_id: int, message_id: int, loc: str, fmt_code: str) -> dict:
    """Step 3: pick a date within the booking window."""
    location = session.get(Location, loc)
    fmt = FORMAT_CODES.get(fmt_code, "individual")
    if not location:
        _answer_callback(callback_id, "Локация не найдена", show_alert=True)
        return {"ok": True}

    today = date.today()
    rows, row = [], []
    for i in range(BOOK_WINDOW_DAYS):
        d = today + timedelta(days=i)
        ymd = d.strftime("%Y%m%d")
        row.append({
            "text": _fmt_day_button(d),
            "callback_data": f"b_d:{loc}:{fmt_code}:{ymd}",
        })
        if len(row) == 2:
            rows.append(row); row = []
    if row:
        rows.append(row)
    rows.append([{"text": "← Назад", "callback_data": f"b_l:{loc}"}])

    _edit(
        chat_id, message_id,
        f"🏢 <b>{escape(_loc_label(location))}</b> · {FORMAT_LABELS[fmt]}\n\nВыберите дату:",
        parse_mode="HTML",
        inline_keyboard=rows,
    )
    _answer_callback(callback_id, "")
    return {"ok": True}


def _list_resources_for_selection(session: Session, loc: str, fmt: str) -> list[Resource]:
    """Active resources in the location that support the chosen format,
    stable-sorted so that the index embedded in callback_data stays valid
    across re-renders within the same request."""
    resources = session.exec(
        select(Resource)
        .where(Resource.location_id == loc, Resource.is_active == True)  # noqa: E712
    ).all()
    filtered = [r for r in resources if fmt in (r.formats or [])]
    filtered.sort(key=lambda r: (r.sort_order, r.name, r.id))
    return filtered


def _book_step_resource(session: Session, callback_id: str, chat_id: int, message_id: int, loc: str, fmt_code: str, ymd: str) -> dict:
    """Step 4: pick a cabinet (resource)."""
    location = session.get(Location, loc)
    fmt = FORMAT_CODES.get(fmt_code, "individual")
    if not location:
        _answer_callback(callback_id, "Локация не найдена", show_alert=True)
        return {"ok": True}

    try:
        d_obj = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:8]))
    except (ValueError, IndexError):
        _answer_callback(callback_id, "Некорректная дата", show_alert=True)
        return {"ok": True}

    resources = _list_resources_for_selection(session, loc, fmt)
    if not resources:
        _edit(chat_id, message_id,
              f"Нет кабинетов, подходящих под формат «{FORMAT_LABELS[fmt]}» в локации {escape(_loc_label(location))}.",
              parse_mode="HTML")
        _answer_callback(callback_id, "")
        return {"ok": True}

    rows = []
    for idx, r in enumerate(resources):
        rows.append([{
            "text": f"{r.name}"[:60],
            "callback_data": f"b_r:{loc}:{fmt_code}:{ymd}:{idx}",
        }])
    rows.append([{"text": "← Назад", "callback_data": f"b_f:{loc}:{fmt_code}"}])

    day_label = _fmt_full_day(d_obj)
    _edit(
        chat_id, message_id,
        f"🏢 <b>{escape(_loc_label(location))}</b> · {FORMAT_LABELS[fmt]}\n"
        f"📅 {day_label}\n\nВыберите кабинет:",
        parse_mode="HTML",
        inline_keyboard=rows,
    )
    _answer_callback(callback_id, "")
    return {"ok": True}


def _get_busy_slots(session: Session, resource_id: str, d_obj: date) -> set[int]:
    """Return set of minutes-since-midnight that are occupied by confirmed bookings
    for this resource on this date."""
    start_of_day = datetime.combine(d_obj, datetime.min.time())
    end_of_day = start_of_day + timedelta(days=1)
    bookings = session.exec(
        select(Booking).where(
            Booking.resource_id == resource_id,
            Booking.status == "confirmed",
            Booking.date >= start_of_day,
            Booking.date < end_of_day,
        )
    ).all()
    busy: set[int] = set()
    for b in bookings:
        try:
            h, m = map(int, b.start_time.split(":"))
        except Exception:
            continue
        start_m = h * 60 + m
        for t in range(start_m, start_m + b.duration, SLOT_STEP_MIN):
            busy.add(t)
    return busy


def _book_step_time(session: Session, callback_id: str, chat_id: int, message_id: int, loc: str, fmt_code: str, ymd: str, res_idx: int) -> dict:
    """Step 5: pick start time."""
    location = session.get(Location, loc)
    fmt = FORMAT_CODES.get(fmt_code, "individual")
    if not location:
        _answer_callback(callback_id, "Локация не найдена", show_alert=True)
        return {"ok": True}

    try:
        d_obj = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:8]))
    except (ValueError, IndexError):
        _answer_callback(callback_id, "Некорректная дата", show_alert=True)
        return {"ok": True}

    resources = _list_resources_for_selection(session, loc, fmt)
    if res_idx < 0 or res_idx >= len(resources):
        _answer_callback(callback_id, "Кабинет не найден, попробуйте /book", show_alert=True)
        return {"ok": True}
    resource = resources[res_idx]

    busy = _get_busy_slots(session, resource.id, d_obj)

    # If booking today — cut off slots that already started.
    # `d_obj` is the Tbilisi calendar date the user picked; server runs UTC,
    # so plain datetime.now() won't match user's "today" near midnight.
    # Shift to Tbilisi wall-clock first.
    _TBS = timedelta(hours=4)
    now_tb = datetime.utcnow() + _TBS
    min_start_min = 0
    if d_obj == now_tb.date():
        min_start_min = now_tb.hour * 60 + now_tb.minute

    rows, row = [], []
    any_free = False
    for m in range(SLOT_START_HOUR * 60, SLOT_END_HOUR * 60, SLOT_STEP_MIN):
        if m < min_start_min:
            continue
        h, mm = divmod(m, 60)
        hhmm_label = f"{h:02d}:{mm:02d}"
        hhmm_code = f"{h:02d}{mm:02d}"
        if m in busy:
            # Telegram doesn't tint inline buttons, so we lean on a 🔒 emoji
            # prefix — reads as "blocked" at a glance. The earlier middle-dot
            # wrapper (`·14:00·`) was too subtle, admins missed it. Tap is a
            # no-op (`b_busy:HHMM`); the booking flow keeps going.
            label = f"🔒 {hhmm_label}"
            row.append({
                "text": label,
                "callback_data": f"b_busy:{hhmm_code}",
            })
        else:
            any_free = True
            row.append({
                "text": hhmm_label,
                "callback_data": f"b_t:{loc}:{fmt_code}:{ymd}:{res_idx}:{hhmm_code}",
            })
        if len(row) == 4:
            rows.append(row); row = []
    if row:
        rows.append(row)
    rows.append([{"text": "← Назад", "callback_data": f"b_d:{loc}:{fmt_code}:{ymd}"}])

    day_label = _fmt_full_day(d_obj)
    if not any_free:
        _edit(
            chat_id, message_id,
            f"🏢 <b>{escape(_loc_label(location))}</b> · {FORMAT_LABELS[fmt]}\n"
            f"📅 {day_label} · {escape(resource.name)}\n\n"
            "Свободного времени нет. Попробуйте другую дату или кабинет.",
            parse_mode="HTML",
            inline_keyboard=[[{"text": "← Назад", "callback_data": f"b_d:{loc}:{fmt_code}:{ymd}"}]],
        )
    else:
        _edit(
            chat_id, message_id,
            f"🏢 <b>{escape(_loc_label(location))}</b> · {FORMAT_LABELS[fmt]}\n"
            f"📅 {day_label} · {escape(resource.name)}\n\n"
            "Выберите время начала (🔒 — уже занято):",
            parse_mode="HTML",
            inline_keyboard=rows,
        )
    _answer_callback(callback_id, "")
    return {"ok": True}


def _book_step_duration(session: Session, callback_id: str, chat_id: int, message_id: int, loc: str, fmt_code: str, ymd: str, res_idx: int, hhmm: str) -> dict:
    """Step 6: pick duration."""
    location = session.get(Location, loc)
    fmt = FORMAT_CODES.get(fmt_code, "individual")
    if not location:
        _answer_callback(callback_id, "Локация не найдена", show_alert=True)
        return {"ok": True}

    try:
        d_obj = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:8]))
    except (ValueError, IndexError):
        _answer_callback(callback_id, "Некорректная дата", show_alert=True)
        return {"ok": True}

    resources = _list_resources_for_selection(session, loc, fmt)
    if res_idx < 0 or res_idx >= len(resources):
        _answer_callback(callback_id, "Кабинет не найден, попробуйте /book", show_alert=True)
        return {"ok": True}
    resource = resources[res_idx]

    try:
        start_h = int(hhmm[:2]); start_m = int(hhmm[2:])
    except ValueError:
        _answer_callback(callback_id, "Некорректное время", show_alert=True)
        return {"ok": True}
    start_total = start_h * 60 + start_m

    busy = _get_busy_slots(session, resource.id, d_obj)

    # Filter durations that fit before SLOT_END_HOUR AND don't overlap a busy slot
    rows, row = [], []
    any_ok = False
    for mins in DURATION_OPTIONS:
        end_total = start_total + mins
        if end_total > SLOT_END_HOUR * 60:
            continue
        # Check every 30-min slot in the range
        clash = False
        for t in range(start_total, end_total, SLOT_STEP_MIN):
            if t in busy:
                clash = True
                break
        if clash:
            continue
        any_ok = True
        label = f"{mins // 60}ч" if mins % 60 == 0 else f"{mins // 60}ч {mins % 60}м"
        row.append({
            "text": label,
            "callback_data": f"b_dur:{loc}:{fmt_code}:{ymd}:{res_idx}:{hhmm}:{mins}",
        })
        if len(row) == 4:
            rows.append(row); row = []
    if row:
        rows.append(row)

    rows.append([{"text": "← Назад", "callback_data": f"b_r:{loc}:{fmt_code}:{ymd}:{res_idx}"}])

    day_label = _fmt_full_day(d_obj)
    time_label = f"{hhmm[:2]}:{hhmm[2:]}"

    if not any_ok:
        _edit(
            chat_id, message_id,
            f"🏢 <b>{escape(_loc_label(location))}</b> · {FORMAT_LABELS[fmt]}\n"
            f"📅 {day_label} · {escape(resource.name)} · {time_label}\n\n"
            "Ни одна длительность не помещается до 22:00 или пересекается с занятыми слотами.",
            parse_mode="HTML",
            inline_keyboard=[[{"text": "← Назад", "callback_data": f"b_r:{loc}:{fmt_code}:{ymd}:{res_idx}"}]],
        )
    else:
        _edit(
            chat_id, message_id,
            f"🏢 <b>{escape(_loc_label(location))}</b> · {FORMAT_LABELS[fmt]}\n"
            f"📅 {day_label} · {escape(resource.name)} · {time_label}\n\n"
            "Выберите длительность:",
            parse_mode="HTML",
            inline_keyboard=rows,
        )
    _answer_callback(callback_id, "")
    return {"ok": True}


def _book_step_confirm(
    session: Session,
    callback_id: str,
    chat_id: int,
    message_id: int,
    user: User,
    loc: str,
    fmt_code: str,
    ymd: str,
    res_idx: int,
    hhmm: str,
    mins: int,
) -> dict:
    """Step 7: show confirmation screen with price preview."""
    location = session.get(Location, loc)
    fmt = FORMAT_CODES.get(fmt_code, "individual")
    if not location:
        _answer_callback(callback_id, "Локация не найдена", show_alert=True)
        return {"ok": True}

    try:
        d_obj = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:8]))
    except (ValueError, IndexError):
        _answer_callback(callback_id, "Некорректная дата", show_alert=True)
        return {"ok": True}

    resources = _list_resources_for_selection(session, loc, fmt)
    if res_idx < 0 or res_idx >= len(resources):
        _answer_callback(callback_id, "Кабинет не найден", show_alert=True)
        return {"ok": True}
    resource = resources[res_idx]

    try:
        start_h = int(hhmm[:2]); start_m = int(hhmm[2:])
    except ValueError:
        _answer_callback(callback_id, "Некорректное время", show_alert=True)
        return {"ok": True}
    start_dt = datetime.combine(d_obj, datetime.min.time()).replace(hour=start_h, minute=start_m)

    # Compute price preview via PricingService — same as the site
    try:
        from app.services.pricing import PricingService
        pricing = PricingService(session)
        quote = pricing.calculate_price(
            user=user,
            resource_id=resource.id,
            start_time=start_dt,
            duration_minutes=mins,
            format_type=fmt,
        )
    except Exception as e:
        logger.error("[tg:book] price calc failed: %r", e, exc_info=True)
        _answer_callback(callback_id, "Не удалось посчитать цену", show_alert=True)
        return {"ok": True}

    # Re-check availability defensively
    from app.services.booking import check_availability
    ok, reason = check_availability(
        session=session,
        resource_id=resource.id,
        date=datetime.combine(d_obj, datetime.min.time()),
        start_time=f"{start_h:02d}:{start_m:02d}",
        duration=mins,
    )
    if not ok:
        _edit(chat_id, message_id,
              "⚠️ Этот слот уже занят. /book — чтобы выбрать другой.")
        _answer_callback(callback_id, "Слот занят", show_alert=True)
        return {"ok": True}

    day_label = _fmt_full_day(d_obj)
    time_label = f"{start_h:02d}:{start_m:02d}"
    end_label = _compute_end_time(time_label, mins)
    dur_label = f"{mins // 60}ч" if mins % 60 == 0 else f"{mins // 60}ч {mins % 60}м"

    # Build price breakdown lines
    lines = [
        "🧾 <b>Подтвердите бронирование</b>\n",
        f"🏢 {escape(_loc_label(location))}",
        f"📍 {escape(resource.name)}",
        f"🎭 Формат: {FORMAT_LABELS[fmt]}",
        f"📅 {day_label}",
        f"⏰ {time_label}–{end_label} ({dur_label})",
        "",
    ]

    # Price section
    if quote.applied_rule == "SUBSCRIPTION":
        lines.append(f"🎫 Абонемент: списание {quote.hours_deducted:g} ч")
        if quote.subscription_peak_debt > 0:
            lines.append(f"⚡ Доплата за пик-часы: {quote.subscription_peak_debt:g} ₾")
        pay_method = "subscription"
    else:
        lines.append(f"💰 К оплате: <b>{quote.final_price:g} ₾</b>")
        if quote.base_price != quote.final_price:
            lines.append(f"  (базовая: {quote.base_price:g} ₾)")
        if quote.discount_percent > 0:
            rule_label = {
                "HOT_BOOKING": "Hot Booking",
                "WEEKLY_PROGRESSIVE": "Прогрессивная скидка",
                "CONSECUTIVE_HOURS": "Скидка за длительность",
                "PERSONAL_DISCOUNT": "Персональная скидка",
            }.get(quote.applied_rule, quote.applied_rule)
            lines.append(f"  −{quote.discount_percent}% ({rule_label})")
        if quote.peak_surcharge > 0:
            lines.append(f"  +{quote.peak_surcharge:g} ₾ пик-часы ({quote.peak_slot_count} слот(а))")
        pay_method = "balance"

    # Payment source hint
    if pay_method == "balance":
        lines.append("")
        lines.append(f"Баланс: {user.balance:g} ₾")
        if user.balance < quote.final_price:
            lines.append("⚠️ Недостаточно средств — пополните на сайте.")

    rows = [
        [
            {"text": "✅ Забронировать", "callback_data":
                f"b_ok:{loc}:{fmt_code}:{ymd}:{res_idx}:{hhmm}:{mins}"},
        ],
        [{"text": "← Назад", "callback_data": f"b_t:{loc}:{fmt_code}:{ymd}:{res_idx}:{hhmm}"}],
        [{"text": "Отмена", "callback_data": "b_cancel"}],
    ]

    _edit(
        chat_id, message_id,
        "\n".join(lines),
        parse_mode="HTML",
        inline_keyboard=rows,
    )
    _answer_callback(callback_id, "")
    return {"ok": True}


def _book_do_confirm(
    session: Session,
    callback_id: str,
    chat_id: int,
    message_id: int,
    user: User,
    loc: str,
    fmt_code: str,
    ymd: str,
    res_idx: int,
    hhmm: str,
    mins: int,
) -> dict:
    """Step 8: actually create the booking via the HTTP endpoint's handler."""
    location = session.get(Location, loc)
    fmt = FORMAT_CODES.get(fmt_code, "individual")
    if not location:
        _answer_callback(callback_id, "Локация не найдена", show_alert=True)
        return {"ok": True}

    try:
        d_obj = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:8]))
    except (ValueError, IndexError):
        _answer_callback(callback_id, "Некорректная дата", show_alert=True)
        return {"ok": True}

    resources = _list_resources_for_selection(session, loc, fmt)
    if res_idx < 0 or res_idx >= len(resources):
        _answer_callback(callback_id, "Кабинет не найден", show_alert=True)
        return {"ok": True}
    resource = resources[res_idx]

    try:
        start_h = int(hhmm[:2]); start_m = int(hhmm[2:])
    except ValueError:
        _answer_callback(callback_id, "Некорректное время", show_alert=True)
        return {"ok": True}

    time_str = f"{start_h:02d}:{start_m:02d}"

    # Call the existing create_booking logic by invoking the router function
    # directly as a Python call — bypasses HTTP but reuses all business rules
    # (pricing, race-safe locking, gcal sync, notifications, hot-booking gate, etc.).
    from fastapi import BackgroundTasks
    from app.api.v1.bookings.routes import create_booking

    booking_in = BookingCreate(
        resource_id=resource.id,
        location_id=loc,
        date=datetime.combine(d_obj, datetime.min.time()),
        start_time=time_str,
        duration=mins,
        format=fmt,
        extras=[],
        payment_method="balance",
        final_price=0.0,  # server computes
    )

    try:
        result = create_booking(
            session=session,
            booking_in=booking_in,
            current_user=user,
            background_tasks=BackgroundTasks(),
        )
    except HTTPException as e:
        logger.info("[tg:book] create_booking rejected: %s", e.detail)
        _edit(chat_id, message_id,
              f"❌ Не удалось создать бронь:\n\n{escape(str(e.detail))}\n\n/book — попробовать ещё раз.")
        _answer_callback(callback_id, "")
        return {"ok": True}
    except Exception as e:
        logger.error("[tg:book] create_booking crashed: %r", e, exc_info=True)
        _edit(chat_id, message_id,
              "❌ Системная ошибка при создании брони. Попробуйте через сайт: https://unbox.com.ge")
        _answer_callback(callback_id, "", show_alert=False)
        return {"ok": True}

    # Success
    final_price = getattr(result, "final_price", None)
    applied_rule = getattr(result, "applied_rule", None)
    status = getattr(result, "status", "confirmed")

    day_label = _fmt_full_day(d_obj)
    end_label = _compute_end_time(time_str, mins)

    if status == "pending_approval":
        header = "⏳ <b>Заявка отправлена на согласование</b>"
        footer = "Админ одобрит её в ближайшее время — мы пришлём сообщение."
    else:
        header = "✅ <b>Бронь подтверждена!</b>"
        if applied_rule == "SUBSCRIPTION":
            footer = "Списано с абонемента."
        else:
            footer = f"Списано с баланса: {final_price:g} ₾" if final_price is not None else ""

    _edit(
        chat_id, message_id,
        f"{header}\n\n"
        f"🏢 {escape(_loc_label(location))}\n"
        f"📍 {escape(resource.name)}\n"
        f"🎭 {FORMAT_LABELS[fmt]}\n"
        f"📅 {day_label}\n"
        f"⏰ {time_str}–{end_label}\n\n"
        f"{footer}\n\n"
        f"Управление: https://unbox.com.ge/bookings",
        parse_mode="HTML",
    )
    _answer_callback(callback_id, "Готово!")

    # ── Admin alert: new booking through bot ──
    try:
        who = escape(user.name or user.email or "—")
        badge = "⏳ На согласовании" if status == "pending_approval" else "🆕 Новая бронь"
        price_line = (
            f"\n💸 {final_price:g} ₾" if final_price is not None and applied_rule != "SUBSCRIPTION"
            else "\n🎫 Абонемент" if applied_rule == "SUBSCRIPTION" else ""
        )
        telegram_service.send_admin_alert(
            f"{badge} — через TG-бот\n\n"
            f"👤 {who}\n"
            f"🏢 {escape(_loc_label(location))} · {escape(resource.name)}\n"
            f"📅 {day_label}  ⏰ {time_str}–{end_label}"
            f"{price_line}"
        )
    except Exception as _e:
        logger.warning("[tg:admin-alert] booking alert failed: %r", _e)

    return {"ok": True}


# ── Hot-booking inline approve/reject (admin chat) ─────────────────────────
# Two-stage flow:
#   1. Admin clicks "✅ Подтвердить" or "❌ Отклонить" on the alert message
#      → callback `ba:<UUID>` / `br:<UUID>`.
#   2. Approve runs immediately. Reject opens a ForceReply prompt asking for
#      a reason; the admin replies with text, webhook detects the reply and
#      calls /reject with the supplied reason.
# State for stage 2 lives in TG itself (the reply_to_message ID), so a
# server restart between stages doesn't break the flow.

REJECT_PROMPT_MARKER = "[UNBOX-REJECT]"  # стабильный маркер чтобы парсить reply-to

def _handle_hot_booking_callback(
    session: Session,
    callback_id: str,
    chat_id: int,
    message_id: int,
    from_user_id: Optional[int],
    data: str,
) -> dict:
    """Handle ✅/❌ tap on a hot-booking admin alert."""
    from app.models.booking import Booking as _Booking
    from app.core.permissions import ADMIN_ROLES

    # Auth — only admins (matched by their personal TG id) can approve/reject.
    if from_user_id is None:
        _answer_callback(callback_id, "Не определён пользователь", show_alert=True)
        return {"ok": True}
    actor = session.exec(
        select(User).where(User.telegram_id == str(from_user_id))
    ).first()
    if not actor or actor.role not in ADMIN_ROLES:
        _answer_callback(callback_id, "Недостаточно прав", show_alert=True)
        return {"ok": True}

    try:
        action, raw_id = data.split(":", 1)
    except ValueError:
        _answer_callback(callback_id, "Bad data", show_alert=True)
        return {"ok": True}

    try:
        b_uuid = UUID(raw_id)
    except (ValueError, TypeError):
        _answer_callback(callback_id, "Неверный ID брони", show_alert=True)
        return {"ok": True}

    # Row lock — два админа double-tap «Подтвердить» подряд раньше
    # успевали оба пройти status-check и оба списать баланс. SELECT FOR
    # UPDATE сериализует — второй увидит уже status='confirmed' и
    # короткое сообщение «уже обработана».
    booking = session.exec(
        select(_Booking).where(_Booking.id == b_uuid).with_for_update()
    ).first()
    if not booking:
        _answer_callback(callback_id, "Бронь не найдена", show_alert=True)
        return {"ok": True}
    if booking.status != "pending_approval":
        _answer_callback(callback_id, f"Бронь уже {booking.status} — ничего не делаем", show_alert=True)
        # Снимаем кнопки с устаревшего сообщения чтобы не плодить нажатия
        try:
            _edit_reply_markup(chat_id, message_id, None)
        except Exception:
            pass
        return {"ok": True}

    if action == "ba":
        # Approve — повторяем бизнес-логику /approve без HTTP-перевызова
        # (нет admin-токена в TG-контексте). Списываем баланс, ставим
        # confirmed, синхронизируем GCal, шлём уведомления клиенту.
        from app.api.v1.bookings.routes import (
            check_availability as _check_avail,
        )
        from app.services.google_calendar import gcal_service as _gcal

        is_avail, reason = _check_avail(
            session=session,
            resource_id=booking.resource_id,
            date=booking.date,
            start_time=booking.start_time,
            duration=booking.duration,
            exclude_booking_id=str(booking.id),
            requester_user_uuid=booking.user_uuid,
        )
        if not is_avail:
            _answer_callback(callback_id, f"Слот занят: {reason}", show_alert=True)
            return {"ok": True}

        owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
        if owner:
            if (booking.payment_method or "").lower() == "subscription":
                if owner.subscription:
                    sub = dict(owner.subscription)
                    rem = float(sub.get("remaining_hours") or 0)
                    used = float(sub.get("used_hours") or 0)
                    sub["remaining_hours"] = max(0.0, rem - float(booking.hours_deducted or 0))
                    sub["used_hours"] = used + float(booking.hours_deducted or 0)
                    owner.subscription = sub
            else:
                owner.balance = round((owner.balance or 0) - float(booking.final_price or 0), 2)
            session.add(owner)

        booking.status = "confirmed"
        booking.updated_at = datetime.utcnow()
        session.add(booking)
        session.commit()
        session.refresh(booking)

        try:
            ev_id = _gcal.create_event(booking, user_name=actor.name or "")
            if ev_id:
                booking.gcal_event_id = ev_id
                session.add(booking)
                session.commit()
        except Exception:
            logger.warning("[hot-booking tg-approve] gcal sync failed", exc_info=True)

        # Notify client
        try:
            from app.models.resource import Resource as _Res
            from app.models.location import Location as _Loc
            from app.models.notification import Notification as _Notif
            res = session.get(_Res, booking.resource_id) if booking.resource_id else None
            loc = session.get(_Loc, res.location_id) if res and res.location_id else None
            if owner and owner.telegram_id:
                try:
                    telegram_service._send_message(
                        chat_id=owner.telegram_id,
                        text=(
                            f"✅ <b>Срочная бронь подтверждена</b>\n\n"
                            f"📅 {booking.date.strftime('%d.%m')} · {booking.start_time}\n"
                            f"📍 {(res.name if res else booking.resource_id)}"
                            f"{(' · ' + loc.name) if loc else ''}\n\n"
                            f"Деньги списаны с баланса."
                        ),
                        parse_mode="HTML",
                    )
                except Exception:
                    pass
            if owner:
                try:
                    n = _Notif(
                        type="hot_booking_approved",
                        title="Бронь подтверждена",
                        description=f"{(res.name if res else booking.resource_id)}{(' · ' + loc.name) if loc else ''} · {booking.date.strftime('%d.%m')} {booking.start_time}",
                        recipient_id=str(owner.id),
                        icon="CheckCircle",
                        link="/dashboard/bookings",
                    )
                    session.add(n)
                    session.commit()
                except Exception:
                    session.rollback()
        except Exception:
            logger.warning("[hot-booking tg-approve] client notify failed", exc_info=True)

        # Edit the original alert: show decision, remove buttons
        try:
            _edit_reply_markup(chat_id, message_id, None)
            stamp = (datetime.utcnow() + timedelta(hours=4)).strftime("%H:%M")
            _send(chat_id, f"✅ Подтверждено @ {actor.name or actor.email} · {stamp}", parse_mode="HTML")
        except Exception:
            pass
        _answer_callback(callback_id, "✓ Подтверждено")
        return {"ok": True}

    if action == "br":
        # Reject — ask for reason via ForceReply, encode booking_id in prompt
        prompt_text = (
            f"❌ Отклонение брони <code>{booking.id}</code>\n"
            f"Введите причину для клиента (ответьте этим сообщением):\n"
            f"<i>{REJECT_PROMPT_MARKER}:{booking.id}</i>"
        )
        try:
            _send(chat_id, prompt_text, parse_mode="HTML", force_reply=True)
        except Exception:
            logger.warning("[hot-booking tg-reject] prompt send failed", exc_info=True)
            _answer_callback(callback_id, "Не удалось отправить запрос причины", show_alert=True)
            return {"ok": True}
        _answer_callback(callback_id, "Введите причину в ответ на следующее сообщение")
        return {"ok": True}

    _answer_callback(callback_id, "Неизвестное действие", show_alert=True)
    return {"ok": True}


def _edit_reply_markup(chat_id: int, message_id: int, reply_markup: Optional[dict]) -> bool:
    """Strip or update inline keyboard on an existing message."""
    if not settings.TELEGRAM_BOT_TOKEN:
        return False
    try:
        url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup"
        payload = {"chat_id": chat_id, "message_id": message_id}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        else:
            payload["reply_markup"] = {"inline_keyboard": []}
        r = requests.post(url, json=payload, timeout=10)
        return bool(r.ok)
    except Exception:
        return False


def _handle_reject_reason_reply(session: Session, message: dict) -> bool:
    """If `message` is a reply to our REJECT_PROMPT, parse out booking id
    and run the reject. Returns True if handled (caller should stop).
    Used from the webhook plain-text branch.

    Spoofing guards (added 2026-05-07): the marker check alone wasn't enough
    — a stale bot message (or anything quoting our prompt text) could be
    replied-to and trigger a wrong reject. We now require:
      1) reply target was sent by **a bot** (`reply_to_message.from.is_bot`)
      2) and that bot is **our** bot (username matches TELEGRAM_BOT_USERNAME)
      3) prompt was sent recently (TG provides reply_to.date — refuse if
         older than 1h, since real reject prompts get replied-to within
         seconds)
    """
    reply_to = message.get("reply_to_message") or {}
    prompt_text = (reply_to.get("text") or "")
    if REJECT_PROMPT_MARKER not in prompt_text:
        return False

    # Guard 1+2: reply target must be from our bot. Without this an admin
    # could reply to ANY message containing the marker (e.g., screenshot,
    # forwarded text from another chat) and trigger a reject.
    reply_from = reply_to.get("from") or {}
    if not reply_from.get("is_bot"):
        return False
    bot_username = settings.TELEGRAM_BOT_USERNAME or ""
    reply_username = (reply_from.get("username") or "").lstrip("@")
    if bot_username and reply_username and reply_username.lower() != bot_username.lstrip("@").lower():
        return False

    # Guard 3: prompt must be recent. Old bot messages quoting the marker
    # (debug logs, stale notifications) shouldn't be hijackable. 1h is
    # generous — real flow is seconds, but we leave room for slow admins.
    try:
        prompt_ts = int(reply_to.get("date") or 0)
        if prompt_ts > 0 and (datetime.utcnow().timestamp() - prompt_ts) > 3600:
            return False
    except Exception:
        pass

    # Parse booking_id after marker
    try:
        idx = prompt_text.index(REJECT_PROMPT_MARKER)
        tail = prompt_text[idx + len(REJECT_PROMPT_MARKER) + 1:]  # skip ":"
        # tail is "UUID..." potentially followed by extra whitespace/newline
        token = tail.split()[0].strip()
        b_uuid = UUID(token)
    except Exception:
        return False

    from app.models.booking import Booking as _Booking
    from app.core.permissions import ADMIN_ROLES

    from_user = message.get("from") or {}
    from_user_id = from_user.get("id")
    chat = message.get("chat") or {}
    chat_id = chat.get("id")

    actor = session.exec(
        select(User).where(User.telegram_id == str(from_user_id))
    ).first() if from_user_id else None
    if not actor or actor.role not in ADMIN_ROLES:
        # Reply from non-admin to bot's prompt — silently ignore.
        return True

    booking = session.get(_Booking, b_uuid)
    if not booking or booking.status != "pending_approval":
        if chat_id:
            _send(chat_id, "Бронь уже обработана.", parse_mode="HTML")
        return True

    reason = (message.get("text") or "").strip() or "Слот недоступен"
    booking.status = "cancelled"
    booking.cancellation_reason = (
        f"Отклонено админом ({actor.name or actor.email}): {reason}"
    )
    booking.cancelled_by = f"admin:{actor.email}"
    booking.updated_at = datetime.utcnow()
    session.add(booking)
    session.commit()
    session.refresh(booking)

    # Notify client
    try:
        from app.models.resource import Resource as _Res
        from app.models.location import Location as _Loc
        from app.models.notification import Notification as _Notif
        owner = session.get(User, booking.user_uuid) if booking.user_uuid else None
        res = session.get(_Res, booking.resource_id) if booking.resource_id else None
        loc = session.get(_Loc, res.location_id) if res and res.location_id else None
        if owner and owner.telegram_id:
            try:
                telegram_service._send_message(
                    chat_id=owner.telegram_id,
                    text=(
                        f"❌ <b>Срочная бронь отклонена</b>\n\n"
                        f"📅 {booking.date.strftime('%d.%m')} · {booking.start_time}\n"
                        f"📍 {(res.name if res else booking.resource_id)}"
                        f"{(' · ' + loc.name) if loc else ''}\n\n"
                        f"Причина: {reason}\n\n"
                        f"Деньги не списаны. Можете выбрать другое время."
                    ),
                    parse_mode="HTML",
                )
            except Exception:
                pass
        if owner:
            try:
                n = _Notif(
                    type="hot_booking_rejected",
                    title="Бронь отклонена",
                    description=f"{(res.name if res else booking.resource_id)}{(' · ' + loc.name) if loc else ''} · {booking.date.strftime('%d.%m')} {booking.start_time} · {reason}",
                    recipient_id=str(owner.id),
                    icon="XCircle",
                    link="/dashboard/bookings",
                )
                session.add(n)
                session.commit()
            except Exception:
                session.rollback()
    except Exception:
        logger.warning("[hot-booking tg-reject] client notify failed", exc_info=True)

    # Echo to admin chat
    if chat_id:
        stamp = (datetime.utcnow() + timedelta(hours=4)).strftime("%H:%M")
        _send(chat_id, f"❌ Отклонено @ {actor.name or actor.email} · {stamp} · «{reason}»", parse_mode="HTML")
    return True


# ── Internal helpers ──────────────────────────────────────────────────────────

def _fmt_day_button(d: date) -> str:
    # "Вт 17 апр"
    return f"{WEEKDAYS_RU[d.weekday()]} {d.day} {MONTHS_RU_SHORT[d.month - 1]}"


def _fmt_full_day(d: date) -> str:
    # "Вт, 17 апреля"
    return f"{WEEKDAYS_RU[d.weekday()]}, {d.day} {MONTHS_RU[d.month - 1]}"


def _loc_label(loc) -> str:
    """`Unbox One (Палиашвили, 4)` — name with address in parens.

    Address is optional in the schema; when missing we fall back to name only.
    Used in every step of the /book flow so users always see where they're
    booking, not just the brand label.
    """
    name = (loc.name or "").strip()
    addr = (getattr(loc, "address", None) or "").strip()
    return f"{name} ({addr})" if addr else name


def _send(
    chat_id: int | str,
    text: str,
    parse_mode: Optional[str] = None,
    inline_keyboard: Optional[list] = None,
    force_reply: bool = False,
) -> None:
    """Fire-and-forget sendMessage. Always clears any stale reply-keyboard.

    If `inline_keyboard` is given, it overrides the default remove_keyboard
    (inline keyboards attach to the message and don't affect the reply-keyboard).
    If `force_reply=True`, sends a ForceReply markup so the next reply in
    the chat is automatically threaded to this message — used for the
    hot-booking reject-reason capture flow.
    Errors are logged, never raised.
    """
    if not settings.TELEGRAM_BOT_TOKEN:
        logger.info("[tg:send-disabled] chat_id=%s", chat_id)
        return
    url = f"{TG_API_BASE}/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }
    if force_reply:
        # `selective: true` ограничивает требование reply теми, к кому
        # прямо обращается prompt — в группе только админ, нажавший
        # «Отклонить», увидит request, остальные не получат принудительный
        # ввод.
        payload["reply_markup"] = {"force_reply": True, "selective": True}
    elif inline_keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": inline_keyboard}
    else:
        # Clears any stale ReplyKeyboardMarkup left over from a prior bot
        payload["reply_markup"] = {"remove_keyboard": True}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    try:
        r = requests.post(url, json=payload, timeout=5)
        if not r.ok:
            logger.warning("[tg:send] status=%d body=%s", r.status_code, r.text[:200])
    except requests.RequestException as e:
        logger.error("[tg:send] network error: %r", e)


def _edit(
    chat_id: int | str,
    message_id: int,
    text: str,
    parse_mode: Optional[str] = None,
    inline_keyboard: Optional[list] = None,
) -> None:
    """Edit an existing bot message (used for multi-step inline flows)."""
    if not settings.TELEGRAM_BOT_TOKEN:
        return
    url = f"{TG_API_BASE}/bot{settings.TELEGRAM_BOT_TOKEN}/editMessageText"
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "disable_web_page_preview": True,
    }
    if inline_keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": inline_keyboard}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    try:
        r = requests.post(url, json=payload, timeout=5)
        if not r.ok:
            logger.warning("[tg:edit] status=%d body=%s", r.status_code, r.text[:200])
    except requests.RequestException as e:
        logger.error("[tg:edit] network error: %r", e)


def _answer_callback(callback_id: str, text: str = "", show_alert: bool = False) -> None:
    """Acknowledge an inline-keyboard callback so Telegram stops showing the spinner."""
    if not settings.TELEGRAM_BOT_TOKEN or not callback_id:
        return
    url = f"{TG_API_BASE}/bot{settings.TELEGRAM_BOT_TOKEN}/answerCallbackQuery"
    payload: dict[str, Any] = {"callback_query_id": callback_id}
    if text:
        payload["text"] = text
    if show_alert:
        payload["show_alert"] = True
    try:
        r = requests.post(url, json=payload, timeout=5)
        if not r.ok:
            logger.warning("[tg:answer] status=%d body=%s", r.status_code, r.text[:200])
    except requests.RequestException as e:
        logger.error("[tg:answer] network error: %r", e)


def _fmt_date_short(d: datetime) -> str:
    return f"{WEEKDAYS_RU[d.weekday()]}, {d.day} {MONTHS_RU[d.month - 1]}"


def _compute_end_time(start_time: str, duration_minutes: int) -> str:
    try:
        h, m = map(int, start_time.split(":"))
        dt = datetime(2000, 1, 1, h, m) + timedelta(minutes=duration_minutes)
        return dt.strftime("%H:%M")
    except Exception:
        return "??:??"
