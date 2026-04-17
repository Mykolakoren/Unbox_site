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
from typing import Optional

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
    ) -> bool:
        """Send confirmation message to user's Telegram.

        Returns True if delivered, False otherwise (user hasn't /started, bot blocked, etc.).
        Never raises — errors are logged.
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

        text = (
            f"{greeting}\n"
            f"\n"
            f"✅ <b>Бронь подтверждена</b>\n"
            f"\n"
            f"📅 <b>{escape(date_label)}</b>, {escape(start_time)} — {escape(end_time)} ({escape(duration_label)})\n"
            f"📍 {escape(resource_name)} — {escape(location_name)}{address_line}\n"
            f"👥 {escape(format_label)}\n"
            f"💰 {price_label} ₾ — {escape(payment_label)}\n"
            f"\n"
            f"Отменить или перенести: https://unbox.com.ge/bookings\n"
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

    def _send_message(
        self, *, chat_id: str, text: str, parse_mode: Optional[str] = None,
        disable_web_page_preview: bool = True,
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
