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

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlmodel import Session, select

from app.api import deps
from app.core.config import settings
from app.db.session import get_session
from app.models.booking import Booking, BookingCreate
from app.models.location import Location
from app.models.resource import Resource
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

LINK_TOKEN_TTL = timedelta(minutes=10)
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


# ── POST /telegram/link-token ─────────────────────────────────────────────────

@router.post("/link-token")
def create_link_token(
    *,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
) -> dict[str, Any]:
    """Generate a one-time token for binding this user's Telegram account."""
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

    if not chat_id or not text:
        return {"ok": True}

    # Normalise — strip "/foo@BotName" suffix that Telegram adds in groups
    first_word = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""

    # ── /start [token] — deep-link binding ────────────────────────────────
    if first_word == "/start":
        return _handle_start(session, chat_id, text, username)

    # ── Other commands — require a bound user ─────────────────────────────
    user = session.exec(
        select(User).where(User.telegram_id == str(chat_id))
    ).first()

    if first_word == "/bookings":
        return _handle_bookings(session, chat_id, user)
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
              "/balance — баланс и подписка\n"
              "/locations — где мы находимся\n"
              "/help — связь с администратором")
    else:
        _send(chat_id,
              "Привет! Я бот уведомлений Unbox. "
              "Чтобы получать подтверждения и напоминания, "
              "подключите аккаунт в профиле: https://unbox.com.ge/profile")
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

    today = datetime.now()
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
        .where(Booking.date >= today.replace(hour=0, minute=0))
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
        "• Написать администратору: @unbox_admin\n\n"
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

    locations = session.exec(
        select(Location).order_by(Location.name)
    ).all()
    if not locations:
        _send(chat_id, "Локации временно недоступны. Попробуйте через сайт: https://unbox.com.ge")
        return {"ok": True}

    rows = []
    for loc in locations:
        rows.append([{
            "text": loc.name[:60],
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

    if not callback_id or not chat_id or not message_id:
        return {"ok": True}

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
              f"В локации <b>{escape(location.name)}</b> нет доступных кабинетов.",
              parse_mode="HTML")
        _answer_callback(callback_id, "")
        return {"ok": True}

    # Union of formats offered by at least one active resource
    offered = set()
    for r in resources:
        for f in (r.formats or []):
            offered.add(f)

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
        f"🏢 <b>{escape(location.name)}</b>\n\nВыберите формат:",
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
        f"🏢 <b>{escape(location.name)}</b> · {FORMAT_LABELS[fmt]}\n\nВыберите дату:",
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
              f"Нет кабинетов, подходящих под формат «{FORMAT_LABELS[fmt]}» в локации {escape(location.name)}.",
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
        f"🏢 <b>{escape(location.name)}</b> · {FORMAT_LABELS[fmt]}\n"
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

    # If booking today — cut off slots that already started
    now = datetime.now()
    min_start_min = 0
    if d_obj == now.date():
        min_start_min = now.hour * 60 + now.minute

    rows, row = [], []
    any_free = False
    for m in range(SLOT_START_HOUR * 60, SLOT_END_HOUR * 60, SLOT_STEP_MIN):
        if m < min_start_min:
            continue
        h, mm = divmod(m, 60)
        hhmm_label = f"{h:02d}:{mm:02d}"
        hhmm_code = f"{h:02d}{mm:02d}"
        if m in busy:
            # Show greyed-out button — callback goes nowhere useful but we add it
            # anyway so the layout stays even. Users mostly skip these.
            label = f"× {hhmm_label}"
            row.append({
                "text": label,
                "callback_data": "b_cancel",  # treat as no-op → cancels flow; better than fake
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
            f"🏢 <b>{escape(location.name)}</b> · {FORMAT_LABELS[fmt]}\n"
            f"📅 {day_label} · {escape(resource.name)}\n\n"
            "Свободного времени нет. Попробуйте другую дату или кабинет.",
            parse_mode="HTML",
            inline_keyboard=[[{"text": "← Назад", "callback_data": f"b_d:{loc}:{fmt_code}:{ymd}"}]],
        )
    else:
        _edit(
            chat_id, message_id,
            f"🏢 <b>{escape(location.name)}</b> · {FORMAT_LABELS[fmt]}\n"
            f"📅 {day_label} · {escape(resource.name)}\n\n"
            "Выберите время начала (× — занято):",
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
            f"🏢 <b>{escape(location.name)}</b> · {FORMAT_LABELS[fmt]}\n"
            f"📅 {day_label} · {escape(resource.name)} · {time_label}\n\n"
            "Ни одна длительность не помещается до 22:00 или пересекается с занятыми слотами.",
            parse_mode="HTML",
            inline_keyboard=[[{"text": "← Назад", "callback_data": f"b_r:{loc}:{fmt_code}:{ymd}:{res_idx}"}]],
        )
    else:
        _edit(
            chat_id, message_id,
            f"🏢 <b>{escape(location.name)}</b> · {FORMAT_LABELS[fmt]}\n"
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
        f"🏢 {escape(location.name)}",
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
        f"🏢 {escape(location.name)}\n"
        f"📍 {escape(resource.name)}\n"
        f"🎭 {FORMAT_LABELS[fmt]}\n"
        f"📅 {day_label}\n"
        f"⏰ {time_str}–{end_label}\n\n"
        f"{footer}\n\n"
        f"Управление: https://unbox.com.ge/bookings",
        parse_mode="HTML",
    )
    _answer_callback(callback_id, "Готово!")
    return {"ok": True}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _fmt_day_button(d: date) -> str:
    # "Вт 17 апр"
    return f"{WEEKDAYS_RU[d.weekday()]} {d.day} {MONTHS_RU_SHORT[d.month - 1]}"


def _fmt_full_day(d: date) -> str:
    # "Вт, 17 апреля"
    return f"{WEEKDAYS_RU[d.weekday()]}, {d.day} {MONTHS_RU[d.month - 1]}"


def _send(
    chat_id: int | str,
    text: str,
    parse_mode: Optional[str] = None,
    inline_keyboard: Optional[list] = None,
) -> None:
    """Fire-and-forget sendMessage. Always clears any stale reply-keyboard.

    If `inline_keyboard` is given, it overrides the default remove_keyboard
    (inline keyboards attach to the message and don't affect the reply-keyboard).
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
    if inline_keyboard is not None:
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
