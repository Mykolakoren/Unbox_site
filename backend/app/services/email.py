"""Email dispatch service — SMTP-based, plaintext + HTML."""
import logging
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# ─── Resource/location labels for email rendering ─────────────────────────────
# Kept as fallbacks; the caller is expected to pass proper names when possible.
FORMAT_LABELS = {
    "individual": "Индивидуальная сессия",
    "group": "Групповая сессия",
    "intervision": "Интервизия",
}


class EmailService:
    """SMTP-based email dispatcher. Gracefully degrades to logging if unconfigured."""

    def __init__(self) -> None:
        self.enabled = bool(
            settings.EMAILS_ENABLED
            and settings.SMTP_HOST
            and settings.SMTP_FROM
        )
        if not self.enabled:
            logger.info(
                "EmailService: disabled (EMAILS_ENABLED=%s, SMTP_HOST=%s, SMTP_FROM=%s)",
                settings.EMAILS_ENABLED, bool(settings.SMTP_HOST), bool(settings.SMTP_FROM),
            )

    # ─── Public API ───────────────────────────────────────────────────────────

    def send_booking_confirmation(
        self,
        *,
        to_email: str,
        to_name: Optional[str],
        resource_name: str,
        location_name: str,
        location_address: Optional[str],
        date: datetime,
        start_time: str,  # "HH:MM"
        duration_minutes: int,
        format_type: str,
        final_price: float,
        payment_method: str,
        booking_id: str,
    ) -> bool:
        """Send booking confirmation. Returns True if sent (or logged in disabled mode)."""
        subject = f"Бронь подтверждена — {self._fmt_date(date)} {start_time}"

        ctx = {
            "user_name": to_name or "",
            "resource_name": resource_name,
            "location_name": location_name,
            "location_address": location_address or "",
            "date_label": self._fmt_date(date),
            "start_time": start_time,
            "end_time": self._compute_end(start_time, duration_minutes),
            "duration_label": self._fmt_duration(duration_minutes),
            "format_label": FORMAT_LABELS.get(format_type, format_type),
            "final_price": int(round(final_price)) if final_price == int(final_price) else final_price,
            "payment_label": "Абонемент" if payment_method == "subscription" else "Баланс",
            "booking_id_short": booking_id[:8],
        }

        html_body = self._render_confirmation_html(ctx)
        text_body = self._render_confirmation_text(ctx)

        return self._send(to_email=to_email, to_name=to_name, subject=subject,
                          html_body=html_body, text_body=text_body)

    # ─── Rendering ────────────────────────────────────────────────────────────

    def _render_confirmation_html(self, ctx: dict) -> str:
        greeting = f"Здравствуйте, {escape(ctx['user_name'])}!" if ctx["user_name"] else "Здравствуйте!"
        address_line = (
            f'<div style="color:#6b7280;font-size:14px;margin-top:2px;">{escape(ctx["location_address"])}</div>'
            if ctx["location_address"] else ""
        )
        return f"""<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:28px 32px 16px 32px;background:#476D6B;color:#ffffff;">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.01em;">Unbox</div>
          <div style="font-size:14px;opacity:0.85;margin-top:4px;">Бронирование подтверждено</div>
        </td></tr>
        <tr><td style="padding:24px 32px 8px 32px;">
          <div style="font-size:16px;margin-bottom:16px;">{greeting}</div>
          <div style="font-size:14px;color:#374151;line-height:1.6;">Ваше бронирование подтверждено. Детали ниже:</div>
        </td></tr>
        <tr><td style="padding:8px 32px 24px 32px;">
          <table cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;">
            <tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;">
              <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Дата и время</div>
              <div style="font-size:16px;font-weight:600;margin-top:4px;">{escape(ctx['date_label'])}, {escape(ctx['start_time'])} — {escape(ctx['end_time'])}</div>
              <div style="color:#6b7280;font-size:13px;margin-top:2px;">{escape(ctx['duration_label'])}</div>
            </td></tr>
            <tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;">
              <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Место</div>
              <div style="font-size:16px;font-weight:600;margin-top:4px;">{escape(ctx['resource_name'])} — {escape(ctx['location_name'])}</div>
              {address_line}
            </td></tr>
            <tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;">
              <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Формат</div>
              <div style="font-size:16px;font-weight:600;margin-top:4px;">{escape(ctx['format_label'])}</div>
            </td></tr>
            <tr><td style="padding:14px 18px;">
              <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">Оплата</div>
              <div style="font-size:16px;font-weight:600;margin-top:4px;">{escape(str(ctx['final_price']))} ₾ — {escape(ctx['payment_label'])}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 32px 24px 32px;font-size:13px;color:#6b7280;line-height:1.6;">
          Отменить или перенести бронь можно в личном кабинете: <a href="https://unbox.com.ge/bookings" style="color:#476D6B;text-decoration:underline;">unbox.com.ge/bookings</a>.<br>
          Поздние отмены (менее 24 часов) требуют указания причины.
        </td></tr>
        <tr><td style="padding:16px 32px 24px 32px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">
          Код брони: {escape(ctx['booking_id_short'])} • Unbox Batumi • <a href="https://unbox.com.ge" style="color:#9ca3af;">unbox.com.ge</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    def _render_confirmation_text(self, ctx: dict) -> str:
        greeting = f"Здравствуйте, {ctx['user_name']}!" if ctx["user_name"] else "Здравствуйте!"
        address = f"\n   {ctx['location_address']}" if ctx["location_address"] else ""
        return (
            f"{greeting}\n\n"
            f"Ваше бронирование подтверждено.\n\n"
            f"Дата и время: {ctx['date_label']}, {ctx['start_time']} — {ctx['end_time']} "
            f"({ctx['duration_label']})\n"
            f"Место: {ctx['resource_name']} — {ctx['location_name']}{address}\n"
            f"Формат: {ctx['format_label']}\n"
            f"Оплата: {ctx['final_price']} ₾ — {ctx['payment_label']}\n\n"
            f"Отмена/перенос — в личном кабинете: https://unbox.com.ge/bookings\n"
            f"Код брони: {ctx['booking_id_short']}\n"
            f"— Unbox Batumi"
        )

    # ─── Transport ────────────────────────────────────────────────────────────

    def _send(
        self, *, to_email: str, to_name: Optional[str],
        subject: str, html_body: str, text_body: str,
    ) -> bool:
        if not self.enabled:
            logger.info("[email:disabled] to=%s subject=%r (body skipped)", to_email, subject)
            return True

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM  # expected "Name <addr@host>"
        msg["To"] = formataddr((to_name or "", to_email))
        msg.set_content(text_body)
        msg.add_alternative(html_body, subtype="html")

        try:
            if settings.SMTP_USE_TLS and settings.SMTP_PORT == 465:
                ctx = ssl.create_default_context()
                with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=ctx, timeout=10) as s:
                    if settings.SMTP_USER:
                        s.login(settings.SMTP_USER, settings.SMTP_PASSWORD or "")
                    s.send_message(msg)
            else:
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as s:
                    s.ehlo()
                    if settings.SMTP_USE_TLS:
                        s.starttls(context=ssl.create_default_context())
                        s.ehlo()
                    if settings.SMTP_USER:
                        s.login(settings.SMTP_USER, settings.SMTP_PASSWORD or "")
                    s.send_message(msg)
            logger.info("[email:sent] to=%s subject=%r", to_email, subject)
            return True
        except Exception as e:
            # Never raise into background task — just log
            logger.error("[email:error] to=%s subject=%r err=%r", to_email, subject, e)
            return False

    # ─── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _fmt_date(d: datetime) -> str:
        months = ["января", "февраля", "марта", "апреля", "мая", "июня",
                  "июля", "августа", "сентября", "октября", "ноября", "декабря"]
        return f"{d.day} {months[d.month - 1]} {d.year}"

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


email_service = EmailService()
