"""Telegram notification service — sends booking notifications via Bot API.

Uses `requests` (already in requirements.txt) to call the Telegram Bot API directly —
no heavy bot framework needed for one-way notifications.

Key constraint: Telegram does NOT allow bots to message users who haven't initiated
a chat with /start. If a user signed in via Telegram Login Widget but never messaged
the bot, sendMessage will return 403 "Forbidden: bot can't initiate conversation
with a user". This is expected — we log and return False without raising.
"""
import logging
from datetime import datetime, timedelta
from html import escape
from typing import Optional, List

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)

FORMAT_LABELS = {
    "individual": "Индивидуальная сессия",
    "group": "Групповая сессия",
    "intervision": "Интервизия",
}

# Telegram error codes we specifically handle
BOT_BLOCKED_ERRORS = {
    "Forbidden: bot was blocked by the user",
    "Forbidden: user is deactivated",
    "Forbidden: bot can't initiate conversation with a user",
}


class TelegramService:
    """Sends booking notifications to users via Telegram Bot API.

    Gracefully degrades if TELEGRAM_BOT_TOKEN is unset or user hasn't started the bot.
    """

    API_BASE = "https://api.telegram.org"
    TIMEOUT = 5  # seconds per HTTP call

    def __init__(self) -> None:
        self.token = settings.TELEGRAM_BOT_TOKEN
        self.enabled = bool(self.token)
        if not self.enabled:
            logger.info("TelegramService: disabled (TELEGRAM_BOT_TOKEN unset)")

    # ─── Public API ───────────────────────────────────────────────────────────

    def send_booking_confirmation(
        self,
        *,
        chat_id: str,
        user_name: Optional[str],
        resource_name: str,
        location_name: str,
        location_address: Optional[str],
        date: datetime,
        start_time: str,
        duration_minutes: int,
        format_type: str,
        final_price: float,
        payment_method: str,
        booking_id: str,
        extras: Optional[List[str]] = None,
    ) -> bool:
        """Send confirmation message to user's Telegram.

        Returns True if delivered, False otherwise (user hasn't /started, bot blocked, etc.).
        Never raises — errors are logged.

        Owner 2026-05-29: `extras` is now itemised below the total so the
        user sees what the +N ₾ paid for (e.g. кофе +3 ₾, песочница +5 ₾).
        Previously the total already included extras but they were invisible
        in the message, which made admins suspect a pricing bug.
        """
        if not chat_id:
            return False

        greeting = (
            f"Здравствуйте, <b>{escape(user_name)}</b>!" if user_name
            else "Здравствуйте!"
        )
        end_time = self._compute_end(start_time, duration_minutes)
        date_label = self._fmt_date(date)
        duration_label = self._fmt_duration(duration_minutes)
        format_label = FORMAT_LABELS.get(format_type, format_type)
        price_label = (
            f"{int(final_price)}" if final_price == int(final_price) else f"{final_price:.2f}"
        )
        payment_label = "Абонемент" if payment_method == "subscription" else "Баланс"
        address_line = f"\n   <i>{escape(location_address)}</i>" if location_address else ""

        # ── Extras line (only shown when present) ──
        extras_line = ""
        if extras:
            from app.services.pricing import PricingService
            extra_names = {
                "sandbox": "песочница",
                "projector": "проектор",
                "couch": "кушетка",
                "coffee_meama": "кофе Меама",
                "flipchart_free": "флипчарт",
                "table_free": "столик",
            }
            paid_parts = []
            free_parts = []
            for eid in extras:
                price = PricingService.EXTRAS_PRICES.get(eid, 0.0)
                name = extra_names.get(eid, eid)
                if price > 0:
                    paid_parts.append(f"{escape(name)} +{int(price)} ₾")
                else:
                    free_parts.append(escape(name))
            chunks = []
            if paid_parts:
                chunks.append(", ".join(paid_parts))
            if free_parts:
                # 2026-06-02 owner: бесплатные опции (flipchart_free /
                # table_free) тоже видны персоналу, без «+0 ₾».
                chunks.append(", ".join(free_parts))
            if chunks:
                extras_line = f"\n➕ {' · '.join(chunks)}"

        text = (
            f"{greeting}\n"
            f"\n"
            f"✅ <b>Бронь подтверждена</b>\n"
            f"\n"
            f"📅 <b>{escape(date_label)}</b>, {escape(start_time)} — {escape(end_time)} ({escape(duration_label)})\n"
            f"📍 {escape(resource_name)} — {escape(location_name)}{address_line}\n"
            f"👥 {escape(format_label)}"
            f"{extras_line}\n"
            f"💰 {price_label} ₾ — {escape(payment_label)}\n"
            f"\n"
            f"Отменить или перенести: https://unbox.com.ge/bookings\n"
            f"<code>#{booking_id[:8]}</code>"
        )

        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    def send_booking_pending_approval(
        self,
        *,
        chat_id: str,
        user_name: Optional[str],
        resource_name: str,
        location_name: str,
        date: datetime,
        start_time: str,
        duration_minutes: int,
        final_price: float,
        booking_id: str,
    ) -> bool:
        """Notify the client that their hot booking is awaiting admin approval.

        Triggered when a booking is created within the approval window
        (12h weekday / 24h weekend) and the user isn't an admin. Without
        this message clients see "Заявка отправлена" toast on the website
        and then radio silence — Марина Бусина reported 2026-05-17 not
        knowing whether the booking was actually being processed.
        """
        if not chat_id:
            return False
        greeting = (
            f"Здравствуйте, <b>{escape(user_name)}</b>!" if user_name
            else "Здравствуйте!"
        )
        end_time = self._compute_end(start_time, duration_minutes)
        date_label = self._fmt_date(date)
        duration_label = self._fmt_duration(duration_minutes)
        price_label = (
            f"{int(final_price)}" if final_price == int(final_price) else f"{final_price:.2f}"
        )
        text = (
            f"{greeting}\n\n"
            f"⏳ <b>Заявка на бронь отправлена администратору</b>\n\n"
            f"📅 <b>{escape(date_label)}</b>, {escape(start_time)} — {escape(end_time)} ({escape(duration_label)})\n"
            f"📍 {escape(resource_name)} — {escape(location_name)}\n"
            f"💰 {price_label} ₾\n\n"
            f"Это срочное бронирование (менее 12ч в будни / 24ч в выходные до начала). "
            f"Слот закрепится за вами только после подтверждения админа — обычно в течение часа. "
            f"Если админ откажет, деньги/часы не спишутся.\n\n"
            f"Проверить статус: https://unbox.com.ge/bookings\n"
            f"<code>#{booking_id[:8]}</code>"
        )
        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    def send_specialist_appointment_new(
        self,
        *,
        chat_id: str,
        specialist_name: str,
        client_name: Optional[str],
        client_phone: Optional[str],
        client_email: Optional[str],
        date: datetime,
        start_time: str,
        duration_minutes: int,
        location_name: Optional[str],
        notes: Optional[str],
        appointment_id: str,
    ) -> bool:
        """Notify a specialist that a client just booked an appointment with them.

        `chat_id` is the specialist's telegram_id (linked to their user account).
        Returns False if specialist hasn't linked Telegram or blocked the bot.
        """
        if not chat_id:
            return False

        end_time = self._compute_end(start_time, duration_minutes)
        date_label = self._fmt_date(date)
        duration_label = self._fmt_duration(duration_minutes)
        client_label = escape(client_name) if client_name else "без имени"

        contact_lines = []
        if client_phone:
            contact_lines.append(f"📞 {escape(client_phone)}")
        if client_email:
            contact_lines.append(f"✉️ {escape(client_email)}")
        contact_block = "\n".join(contact_lines)
        if contact_block:
            contact_block = "\n" + contact_block

        loc_line = f"\n📍 {escape(location_name)}" if location_name else "\n💻 Онлайн"
        notes_line = f"\n📝 {escape(notes)}" if notes else ""

        text = (
            f"🆕 <b>Новая запись от клиента</b>\n\n"
            f"👤 {client_label}{contact_block}\n"
            f"\n"
            f"📅 <b>{escape(date_label)}</b>, {escape(start_time)} — {escape(end_time)} "
            f"({escape(duration_label)}){loc_line}{notes_line}\n"
            f"\n"
            f"Управление: https://unbox.com.ge/crm/sessions\n"
            f"<code>#{appointment_id[:8]}</code>"
        )
        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    def send_slot_available(
        self,
        *,
        chat_id: str,
        user_name: Optional[str],
        resource_name: str,
        location_name: Optional[str],
        date: datetime,
        start_time: str,
        end_time: str,
    ) -> bool:
        """Notify a user on their waitlist that a slot they requested has freed up.

        `chat_id` is the user's telegram_id. Returns False silently if the user
        hasn't linked Telegram or has blocked the bot — the caller should still
        proceed to mark the waitlist entry as fulfilled so we don't spam.
        """
        if not chat_id:
            return False

        greeting = (
            f"Здравствуйте, <b>{escape(user_name)}</b>!" if user_name
            else "Здравствуйте!"
        )
        date_label = self._fmt_date(date)
        loc_line = f" · {escape(location_name)}" if location_name else ""

        text = (
            f"{greeting}\n"
            f"\n"
            f"🔔 <b>Слот из вашего листа ожидания освободился!</b>\n"
            f"\n"
            f"📅 <b>{escape(date_label)}</b>, {escape(start_time)} — {escape(end_time)}\n"
            f"📍 {escape(resource_name)}{loc_line}\n"
            f"\n"
            f"Успейте забронировать до того, как его займут:\n"
            f"https://unbox.com.ge/booking"
        )

        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    def send_waitlist_subscribed(
        self,
        *,
        chat_id: str,
        user_name: Optional[str],
        resource_name: str,
        location_name: Optional[str],
        date: datetime,
        start_time: str,
        end_time: str,
    ) -> bool:
        """Confirm to the user that their waitlist subscription is active.

        Shipped together with `send_slot_available`: subscribe-confirmation +
        slot-freed-alert form a closed loop so the user never wonders "did
        the bot register me?". Mirrors the `send_slot_available` formatting
        on purpose — same fields, same place, just a different verb at the
        top so it scans identically in the chat history.
        """
        if not chat_id:
            return False

        greeting = (
            f"Здравствуйте, <b>{escape(user_name)}</b>!" if user_name
            else "Здравствуйте!"
        )
        date_label = self._fmt_date(date)
        loc_line = f" · {escape(location_name)}" if location_name else ""

        text = (
            f"{greeting}\n"
            f"\n"
            f"👀 <b>Вы отслеживаете слот</b>\n"
            f"\n"
            f"📅 <b>{escape(date_label)}</b>, {escape(start_time)} — {escape(end_time)}\n"
            f"📍 {escape(resource_name)}{loc_line}\n"
            f"\n"
            f"Как только в этом центре освободится любой кабинет на это время — пришлю уведомление сюда же.\n"
            f"\n"
            f"Отписаться от слота: https://unbox.com.ge/dashboard/waitlist"
        )

        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    def send_specialist_appointment_cancelled(
        self,
        *,
        chat_id: str,
        audience: str,  # "specialist" | "client"
        specialist_name: str,
        client_name: Optional[str],
        date: datetime,
        start_time: str,
        duration_minutes: int,
        location_name: Optional[str],
    ) -> bool:
        """Notify either the specialist or the client that an appointment was cancelled."""
        if not chat_id:
            return False

        end_time = self._compute_end(start_time, duration_minutes)
        date_label = self._fmt_date(date)
        loc_line = f"\n📍 {escape(location_name)}" if location_name else "\n💻 Онлайн"

        if audience == "specialist":
            header = "❌ <b>Запись отменена</b>"
            body = f"Клиент: <b>{escape(client_name or 'без имени')}</b>"
        else:
            header = "❌ <b>Ваша запись отменена</b>"
            body = f"Специалист: <b>{escape(specialist_name)}</b>"

        text = (
            f"{header}\n\n"
            f"{body}\n"
            f"📅 {escape(date_label)}, {escape(start_time)} — {escape(end_time)}{loc_line}"
        )
        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    # ─── Transport ────────────────────────────────────────────────────────────

    def send_message(self, chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
        """Generic public sender for ad-hoc Telegram messages — used by
        callers that don't fit one of the booking-specific helpers (e.g.
        series-end reminders). Same retry / blocked-bot handling as the
        private helper."""
        return self._send_message(chat_id=str(chat_id), text=text, parse_mode=parse_mode)

    def _send_message(
        self, *, chat_id: str, text: str, parse_mode: Optional[str] = None,
        disable_web_page_preview: bool = True,
        reply_markup: Optional[dict] = None,
    ) -> bool:
        if not self.enabled:
            logger.info("[tg:disabled] chat_id=%s text_len=%d", chat_id, len(text))
            return False

        url = f"{self.API_BASE}/bot{self.token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": disable_web_page_preview,
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup

        try:
            r = requests.post(url, json=payload, timeout=self.TIMEOUT)
            data = r.json() if r.content else {}
            if data.get("ok"):
                logger.info("[tg:sent] chat_id=%s", chat_id)
                return True

            description = data.get("description", "")
            if any(err in description for err in BOT_BLOCKED_ERRORS):
                # Expected — user hasn't /started or blocked the bot. Not an error.
                logger.info("[tg:skip] chat_id=%s reason=%r", chat_id, description)
            else:
                logger.warning("[tg:error] chat_id=%s status=%d resp=%r",
                               chat_id, r.status_code, data)
            return False
        except requests.RequestException as e:
            logger.error("[tg:network-error] chat_id=%s err=%r", chat_id, e)
            return False

    # ─── Admin alerts (TELEGRAM_ADMIN_CHAT_ID group) ─────────────────────────

    def send_admin_alert(self, text: str, parse_mode: str = "HTML") -> bool:
        """Post to the private admin group (TELEGRAM_ADMIN_CHAT_ID).

        Used for: new bookings via bot, /help escalations, bot fallbacks,
        daily summaries. Silently no-ops if the chat id is unset so dev
        environments don't crash — only prod should have it configured.
        """
        chat_id = settings.TELEGRAM_ADMIN_CHAT_ID
        if not chat_id:
            logger.debug("[tg:admin-alert] TELEGRAM_ADMIN_CHAT_ID unset, skipping")
            return False
        return self._send_message(chat_id=str(chat_id), text=text, parse_mode=parse_mode)

    def send_owner_summary(self, text: str, parse_mode: str = "HTML") -> bool:
        """Post to the owner-only chat (TELEGRAM_OWNER_CHAT_ID).

        Used for the daily money/hours rollup that goes to the founder
        instead of every admin. Falls back to the admin group when the
        owner chat isn't configured — that preserves the legacy
        behaviour for environments that haven't set it yet.
        """
        chat_id = settings.TELEGRAM_OWNER_CHAT_ID or settings.TELEGRAM_ADMIN_CHAT_ID
        if not chat_id:
            logger.debug("[tg:owner-summary] no chat id configured, skipping")
            return False
        return self._send_message(chat_id=str(chat_id), text=text, parse_mode=parse_mode)

    # ── Structured per-event admin notifications ─────────────────────────────
    #
    # Single entry point so callers don't have to format markup themselves —
    # they pass the event type and a dict of fields, we compose the message.
    # All times are stamped Tbilisi (UTC+4) so admins see what their phone
    # would naturally show.
    EVENT_TITLES = {
        "booking_created":           ("🆕", "Новая бронь"),
        "booking_series_created":    ("🔁", "Новая серия броней"),
        "booking_pending_approval":  ("⏳", "Бронь &lt;12 ч — нужно подтвердить"),
        "booking_cancelled":         ("✖",  "Отмена брони"),
        "booking_rescheduled":       ("↻",  "Перенос брони"),
        "booking_re_rent_listed":    ("🔄", "Выставлена на переаренду"),
        "booking_re_rent_taken":     ("✓",  "Переаренда состоялась"),
        "crm_access_request":        ("🔑", "Заявка на доступ к CRM"),
        "specialist_application":    ("👤", "Заявка специалиста в каталог"),
        "booking_charge_waived":     ("🩹", "Штраф за бронь снят"),
        "booking_format_changed":    ("🔄", "Изменён формат брони"),
        "credit_limit_exceeded":     ("🚨", "Превышен кредитный лимит"),
        "future_booking_overload":   ("📊", "Много будущих броней у клиента"),
        "waitlist_user_no_tg":       ("📞", "Слот освободился — клиент без TG"),
        "booking_price_changed":     ("💰", "Изменена цена брони"),
        "booking_with_extras":       ("🧰", "Бронь с допуслугами — нужно подготовить"),
    }

    def send_admin_event(self, *, event: str, fields: dict, reply_markup: Optional[dict] = None) -> bool:
        """Structured admin alert. `fields` is rendered as `key: value` lines
        in insertion order. Falsy values are skipped so optional keys can be
        passed unconditionally without producing empty rows.

        `reply_markup` (optional) — inline keyboard JSON dict, e.g. for
        approve/reject buttons on hot-bookings. Forwarded as-is to TG API.
        """
        chat_id = settings.TELEGRAM_ADMIN_CHAT_ID
        if not chat_id:
            return False
        emoji, title = self.EVENT_TITLES.get(event, ("🔔", event))
        lines = [f"{emoji} <b>{title}</b>", ""]
        for key, val in fields.items():
            if val is None or val == "":
                continue
            lines.append(f"<b>{escape(str(key))}:</b> {val}")
        # Footer: when the event happened, in Tbilisi local — admins always
        # operate in this tz and don't care about UTC.
        from datetime import timezone as _tz, timedelta as _td
        tb_now = datetime.now(_tz.utc) + _td(hours=4)
        lines.append("")
        lines.append(f"<i>{tb_now.strftime('%H:%M · %d.%m.%Y')} (Тбилиси)</i>")
        return self._send_message(
            chat_id=str(chat_id),
            text="\n".join(lines),
            parse_mode="HTML",
            reply_markup=reply_markup,
        )

    # ─── Excel #58 — cancel / reschedule / reminder ──────────────────────────

    def send_booking_cancelled(
        self,
        *,
        chat_id: str,
        resource_name: str,
        location_name: Optional[str],
        date: datetime,
        start_time: str,
        refund_percent: float = 1.0,
        reason: Optional[str] = None,
        booking_id: Optional[str] = None,
    ) -> bool:
        """Notify the booking owner that their booking was cancelled.

        refund_percent: 1.0 = full refund, 0.5 = 50% penalty, 0.0 = no refund.
        reason: optional human-readable note (shown verbatim to the user).
        """
        if not chat_id:
            return False

        date_label = self._fmt_date(date)
        refund_label = (
            "полный возврат" if refund_percent >= 0.99
            else f"возврат {int(refund_percent * 100)}%" if refund_percent > 0
            else "без возврата"
        )
        loc_line = f" · {escape(location_name)}" if location_name else ""
        reason_line = f"\n\n<i>Причина: {escape(reason)}</i>" if reason else ""
        id_line = f"\n<code>#{booking_id[:8]}</code>" if booking_id else ""

        text = (
            f"✖ <b>Бронь отменена</b>\n\n"
            f"📅 {escape(date_label)}, {escape(start_time)}\n"
            f"📍 {escape(resource_name)}{loc_line}\n"
            f"💰 {refund_label}{reason_line}{id_line}"
        )
        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    def send_rerent_taken(
        self,
        *,
        chat_id: str,
        resource_name: str,
        location_name: Optional[str],
        date: datetime,
        start_time: str,
        refund_amount: float,
        new_balance: float,
        booking_id: Optional[str] = None,
    ) -> bool:
        """Notify the original owner that their re-rent-listed slot was
        taken by someone else. They get the refund (50% by policy) and a
        balance update line."""
        if not chat_id:
            return False
        date_label = self._fmt_date(date)
        loc_line = f" · {escape(location_name)}" if location_name else ""
        bal_line = (
            f"💰 Возвращено: <b>+{refund_amount:.2f} ₾</b> (50%)\n"
            f"💼 Баланс: <b>{new_balance:+.2f} ₾</b>"
        )
        id_line = f"\n<code>#{booking_id[:8]}</code>" if booking_id else ""
        text = (
            f"♻️ <b>Слот переарендован</b>\n\n"
            f"📅 {escape(date_label)}, {escape(start_time)}\n"
            f"📍 {escape(resource_name)}{loc_line}\n\n"
            f"{bal_line}"
            f"{id_line}"
        )
        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    def send_booking_rescheduled(
        self,
        *,
        chat_id: str,
        resource_name: str,
        old_date: datetime,
        old_start_time: str,
        new_date: datetime,
        new_start_time: str,
        duration_minutes: int,
        booking_id: Optional[str] = None,
    ) -> bool:
        """Notify the booking owner that their booking moved to a new slot."""
        if not chat_id:
            return False

        old_label = f"{self._fmt_date(old_date)}, {old_start_time}"
        new_end = self._compute_end(new_start_time, duration_minutes)
        new_label = f"{self._fmt_date(new_date)}, {new_start_time}–{new_end}"
        id_line = f"\n<code>#{booking_id[:8]}</code>" if booking_id else ""

        text = (
            f"↻ <b>Бронь перенесена</b>\n\n"
            f"📍 {escape(resource_name)}\n"
            f"\n"
            f"Было: <s>{escape(old_label)}</s>\n"
            f"Стало: <b>{escape(new_label)}</b>{id_line}"
        )
        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    def send_booking_reminder(
        self,
        *,
        chat_id: str,
        resource_name: str,
        location_name: Optional[str],
        location_address: Optional[str],
        date: datetime,
        start_time: str,
        duration_minutes: int,
        booking_id: Optional[str] = None,
    ) -> bool:
        """Send a T-minus-2h reminder. Caller should stamp reminder_sent_at on
        the booking when this returns True so we never double-notify."""
        if not chat_id:
            return False

        date_label = self._fmt_date(date)
        end_time = self._compute_end(start_time, duration_minutes)
        loc_line = f" · {escape(location_name)}" if location_name else ""
        address_line = f"\n<i>{escape(location_address)}</i>" if location_address else ""
        id_line = f"\n<code>#{booking_id[:8]}</code>" if booking_id else ""

        text = (
            f"⏰ <b>Напоминание</b>\n"
            f"\n"
            f"Через 2 часа — ваша бронь:\n"
            f"\n"
            f"📅 {escape(date_label)}, <b>{escape(start_time)} — {escape(end_time)}</b>\n"
            f"📍 {escape(resource_name)}{loc_line}{address_line}{id_line}"
        )
        return self._send_message(chat_id=chat_id, text=text, parse_mode="HTML")

    # ─── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _fmt_date(d: datetime) -> str:
        months = ["января", "февраля", "марта", "апреля", "мая", "июня",
                  "июля", "августа", "сентября", "октября", "ноября", "декабря"]
        weekdays = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
        return f"{weekdays[d.weekday()].capitalize()}, {d.day} {months[d.month - 1]}"

    @staticmethod
    def _compute_end(start_time: str, duration_minutes: int) -> str:
        try:
            h, m = map(int, start_time.split(":"))
            dt = datetime(2000, 1, 1, h, m) + timedelta(minutes=duration_minutes)
            return dt.strftime("%H:%M")
        except Exception:
            return "??:??"

    @staticmethod
    def _fmt_duration(minutes: int) -> str:
        hours = minutes / 60
        if hours == int(hours):
            return f"{int(hours)} ч."
        return f"{hours:.1f} ч."


telegram_service = TelegramService()
