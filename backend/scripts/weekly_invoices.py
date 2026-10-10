"""Счёт за прошлую неделю — в ленту админов (просьба Вали 06.10, решение владельца 09.10).

Кому: клиенты с меткой «счёт за неделю» в карточке (админы ставят сами) и
почты из WEEKLY_INVOICE_EMAILS (.env, через запятую). Неделя — пн–вс по
Тбилиси. В счёт идут денежные брони недели (не отменённые): дата, филиал,
часы, цена (с допами). Итог и баланс на сайте сейчас. Сообщение — в
«Unbox · Бот · Лента» (TELEGRAM_ADMIN_CHAT_ID); админ пересылает клиенту.
Только чтение БД.

Крон: пн 05:00 UTC (09:00 Тбилиси).
    cd /var/www/unbox/backend && venv/bin/python3 scripts/weekly_invoices.py [--dry-run] [--week 2026-10-05]
"""
import argparse
import sys
from datetime import date, datetime, timedelta
from html import escape

from sqlalchemy import or_
from sqlmodel import Session, select

from app.core.config import settings
from app.db.session import engine
from app.models.booking import Booking
from app.models.user import User

TZ = timedelta(hours=4)
TAGS = {"счёт за неделю", "счет за неделю"}
BRANCH = {"unbox_one": "Палиашвили", "unbox_uni": "Абусеридзе", "neo_school": "Neo School"}
MONEY_METHODS = ("balance", "", None)


def _num(x: float) -> str:
    s = f"{x:.2f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def _hours(minutes: int) -> str:
    return _num((minutes or 0) / 60) + " ч"


def week_bounds(today: date, week: str | None) -> tuple[date, date]:
    if week:
        start = date.fromisoformat(week)
        start -= timedelta(days=start.weekday())
    else:
        start = today - timedelta(days=today.weekday() + 7)
    return start, start + timedelta(days=6)


def clients(session: Session) -> list:
    emails = {e.strip().lower() for e in (getattr(settings, "WEEKLY_INVOICE_EMAILS", None) or "").split(",") if e.strip()}
    out = []
    for u in session.exec(select(User).where(User.archived_at.is_(None))).all():  # type: ignore[union-attr]
        tags = {str(t).strip().lower() for t in (u.tags or [])}
        if tags & TAGS or (u.email or "").lower() in emails:
            out.append(u)
    return out


def invoice(session: Session, u, start: date, end: date) -> str | None:
    rows = session.exec(
        select(Booking).where(
            or_(Booking.user_uuid == u.id, Booking.user_id == u.email),
            Booking.date >= datetime.combine(start, datetime.min.time()),
            Booking.date < datetime.combine(end + timedelta(days=1), datetime.min.time()),
            Booking.status.in_(("confirmed", "completed")),
        )
    ).all()
    rows = [b for b in rows if (b.payment_method or "") in MONEY_METHODS and float(b.final_price or 0) > 0]
    if not rows:
        return None
    rows.sort(key=lambda b: (b.date, b.start_time or ""))
    # Сколько по каждой брони ещё должны — по раскладке ленты баланса (та же, что
    # «к оплате» на сайте): оплаченное (пополнения, скидка за неделю) вычтено
    # (просьба Вали 09.10: «вычти то, что она уже оплатила»).
    from app.services.balance_allocation import client_allocation
    debt_by_id: dict[str, float] = {}
    try:
        alloc = client_allocation(session, u)
        if alloc.get("consistent"):
            for m in alloc.get("bookings") or []:
                debt_by_id[str(m["bookingId"])] = float(m.get("debt") or 0)
    except Exception:  # noqa: BLE001 — без раскладки счёт всё равно уходит, но без «к оплате»
        alloc = None
    lines = []
    total = due = 0.0
    for b in rows:
        price = round(float(b.final_price or 0), 2)
        total += price
        branch = BRANCH.get(b.location_id or "", "")
        owe = round(debt_by_id.get(str(b.id), 0.0), 2) if alloc else None
        if owe is not None and b.payment_status == "pending":
            owe = price                                   # ещё не списана — вся к оплате
        mark = "" if owe is None else (" ✓ оплачено" if owe <= 0.004 else f" — к оплате {_num(owe)} ₾" if owe < price - 0.004 else "")
        if owe is not None:
            due += owe
        lines.append(f"{b.date:%d.%m} {b.start_time} — {_hours(b.duration)}, {branch} — {_num(price)} ₾{mark}")
    bal = round(float(u.balance or 0), 2)
    paid = round(total - due, 2)
    summary = (f"\n\n<b>Итого за неделю: {_num(round(total, 2))} ₾</b>"
               + (f"\nУже оплачено: {_num(paid)} ₾\n<b>К оплате: {_num(round(due, 2))} ₾</b>" if alloc else ""))
    return (
        f"🧾 <b>Счёт за неделю {start:%d.%m}–{end:%d.%m}</b> — {escape(u.name or u.email or '')}\n\n"
        + "\n".join(escape(x) for x in lines)
        + summary
        + f"\nБаланс на сайте сейчас: {_num(bal)} ₾ (с бронями, уже списанными на следующие дни)"
        + "\n\nМожно переслать клиенту."
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--week", default=None, help="любой день нужной недели, YYYY-MM-DD")
    a = ap.parse_args()
    today = (datetime.utcnow() + TZ).date()
    start, end = week_bounds(today, a.week)
    sent = 0
    with Session(engine) as s:
        for u in clients(s):
            text = invoice(s, u, start, end)
            if not text:
                continue
            if a.dry_run:
                print(text, "\n" + "-" * 40)
            else:
                from app.services.telegram import telegram_service
                telegram_service.send_admin_alert(text, parse_mode="HTML")
            sent += 1
    print(f"[weekly-invoices] {start}–{end}: счетов {sent}{' (dry-run)' if a.dry_run else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
