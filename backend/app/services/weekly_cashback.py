"""Weekly tier-cashback engine.

End-of-week settlement: at the start of each Monday (Tbilisi time) we look
back at the user's confirmed bookings for the previous Mon–Sun, sum up
their balance-paid hours, find the discount tier they actually
fulfilled, and refund the difference between what they paid per-booking
and what they would have paid if every booking on that week had been
priced at the final tier.

Design notes
============
* No live mid-week recalc. Per-booking quote remains "frozen at create
  time" so the user can plan; the weekly cashback closes the gap once
  Sunday is over.
* Cashback applies only to ``payment_method='balance'`` bookings —
  subscription bookings are settled in hours, not GEL.
* Cancellations during the week are ignored: only the *final* confirmed
  state on Sunday night counts. If the user cancels enough to drop below
  the 5h tier, the tier becomes 0 and no cashback is owed.
* Bookings already at a higher discount (PERSONAL, SUBSCRIPTION) are
  skipped — we don't undo a richer discount.
* Idempotent: a credit is recorded in the ``weekly_rebates`` journal — one row
  per (user, week) — and a second run for the same week skips the user.

  This docstring used to promise a ``cashback_applied_at`` marker that was never
  implemented anywhere: re-running the endpoint (a retry, a second tab, a manual
  curl) simply credited every active client's balance a second time, with nothing
  in the schema to notice.

  ⚠️ The journal is shared with ``weekly_rebate`` on purpose. Both services credit
  the balance for the SAME thing — the weekly volume discount — and only
  ``weekly_rebate`` runs from cron (Mon 01:00). Sharing the journal makes them
  mutually exclusive, so a week can never be paid out twice. Worth deciding which
  of the two is the real mechanism and retiring the other.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone, date as Date
from typing import Optional, List

from sqlmodel import Session, select

from app.models.booking import Booking
from app.models.user import User
from app.services.pricing import PricingService
from app.services.timeline import timeline_service

logger = logging.getLogger(__name__)

TZ_TBILISI = timezone(timedelta(hours=4))


def previous_tbilisi_week_bounds(now_utc: Optional[datetime] = None) -> tuple[datetime, datetime]:
    """Return (mon_00_00_TB_naive, next_mon_00_00_TB_naive) for the
    Tbilisi calendar week that just ended. Used as inclusive-exclusive
    range against ``Booking.date`` (which is stored as Tbilisi calendar
    day, naive)."""
    now_utc = now_utc or datetime.now(timezone.utc)
    now_tb = now_utc.astimezone(TZ_TBILISI)
    today_tb = now_tb.date()
    days_since_monday = today_tb.weekday()  # Mon=0..Sun=6
    this_monday = today_tb - timedelta(days=days_since_monday)
    last_monday = this_monday - timedelta(days=7)
    return (
        datetime.combine(last_monday, datetime.min.time()),
        datetime.combine(this_monday, datetime.min.time()),
    )


def _confirmed_balance_bookings_in_week(
    session: Session,
    user: User,
    week_start: datetime,
    week_end: datetime,
) -> List[Booking]:
    return session.exec(
        select(Booking).where(
            Booking.user_uuid == user.id,
            Booking.status == "confirmed",
            Booking.payment_method == "balance",
            Booking.date >= week_start,
            Booking.date < week_end,
        ).order_by(Booking.date, Booking.start_time)
    ).all()


def _find_tier_pct(total_hours: float) -> int:
    """Apply weekly_progressive ladder from PricingService config.
    Returns integer percent (0/10/25/50)."""
    for tier in PricingService.PRICING_CONFIG["weekly_progressive"]:
        if tier["min"] <= total_hours < tier["max"]:
            return int(tier["percent"])
    return 0


def compute_weekly_cashback_for_user(
    session: Session,
    user: User,
    week_start: datetime,
    week_end: datetime,
    apply: bool = False,
) -> dict:
    """Compute the GEL cashback owed to ``user`` for the past week.

    Returns a structured summary used both by the Telegram digest and by
    the audit timeline event. When ``apply=True`` the balance is credited, a
    ``weekly_cashback`` timeline row is logged, and the week is recorded in the
    ``weekly_rebates`` journal so it can never be paid out twice.
    """
    bookings = _confirmed_balance_bookings_in_week(session, user, week_start, week_end)
    total_minutes = sum(int(b.duration or 0) for b in bookings)
    total_hours = total_minutes / 60.0
    total_paid = round(sum(float(b.final_price or 0.0) for b in bookings), 2)

    tier_pct = _find_tier_pct(total_hours)

    cashback = 0.0
    affected: list[dict] = []

    if tier_pct > 0:
        for b in bookings:
            base = float(b.base_price or b.final_price or 0.0)
            # Skip rows that already have a richer discount than the
            # tier we'd apply: PERSONAL_DISCOUNT, SUBSCRIPTION rows are
            # priced separately; CONSECUTIVE_HOURS may be 10/15/20%, so
            # only redirect to weekly tier if it's better.
            cur_pct = int(b.discount_percent or 0)
            if cur_pct >= tier_pct:
                continue
            target_final = round(base * (1 - tier_pct / 100.0), 2)
            actual = float(b.final_price or 0.0)
            delta = round(actual - target_final, 2)
            if delta <= 0:
                continue
            cashback += delta
            affected.append({
                "booking_id": str(b.id),
                "date": b.date.strftime("%Y-%m-%d"),
                "start_time": b.start_time,
                "old_final": round(actual, 2),
                "new_final": target_final,
                "delta": delta,
            })

    cashback = round(cashback, 2)

    summary = {
        "user_id": str(user.id),
        "user_name": user.name,
        "week_start": week_start.strftime("%Y-%m-%d"),
        "week_end": (week_end - timedelta(days=1)).strftime("%Y-%m-%d"),
        "total_bookings": len(bookings),
        "total_hours": round(total_hours, 2),
        "total_paid": total_paid,
        "tier_pct": tier_pct,
        "cashback": cashback,
        "affected": affected,
    }

    if apply and cashback > 0:
        # Idempotency gate. The journal is keyed (user_id, week_start) and shared
        # with weekly_rebate — see the module docstring. Without it, a retry or a
        # second manual run credited every client all over again.
        from app.models.weekly_rebate import WeeklyRebate

        week_start_date = week_start.date() if isinstance(week_start, datetime) else week_start
        already = session.exec(
            select(WeeklyRebate).where(
                WeeklyRebate.user_id == user.id,
                WeeklyRebate.week_start == week_start_date,
            )
        ).first()
        if already:
            logger.info(
                "[weekly_cashback] skip %s: week %s already credited (%.2f₾)",
                user.email, week_start_date, float(already.amount or 0),
            )
            summary["skipped"] = "already_credited"
            summary["cashback"] = 0.0
            return summary

        session.add(WeeklyRebate(
            user_id=user.id,
            week_start=week_start_date,
            total_hours=round(total_hours, 1),
            tier_percent=tier_pct,
            amount=cashback,
        ))

        # Credit balance, log timeline. We do NOT mutate booking rows —
        # the audit row holds the per-booking deltas. This keeps the
        # original booking history intact ("paid X at the time", "later
        # got Y back") which is cleaner than rewriting final_price.
        user.balance = round((user.balance or 0.0) + cashback, 2)
        session.add(user)
        try:
            timeline_service.log_event(
                session=session,
                actor_id=str(user.id),
                actor_role="system",
                target_id=str(user.id),
                target_type="user",
                event_type="weekly_cashback",
                description=(
                    f"Кэшбэк за объём недели {summary['week_start']}—{summary['week_end']}: "
                    f"{summary['total_hours']:.1f} ч, тир −{tier_pct}% → +{cashback:.2f} ₾ на баланс"
                ),
                metadata=summary,
            )
        except Exception:
            logger.exception("[weekly_cashback] timeline log failed")

    return summary


def format_telegram_digest(user: User, summary: dict) -> str:
    """Compose the Monday-morning HTML message sent via Telegram bot.

    Sections (per Микола spec):
      • week label
      • bookings count + hours total
      • amount spent (GEL)
      • cashback for tier (the saved-via-discount line)
      • current balance: deposit (+) or credit (−), with credit_limit
    """
    from html import escape as h

    week = f"{_fmt_date(summary['week_start'])} – {_fmt_date(summary['week_end'])}"
    bookings_n = summary["total_bookings"]
    hours = summary["total_hours"]
    paid = summary["total_paid"]
    cashback = summary["cashback"]
    tier = summary["tier_pct"]

    bal = float(user.balance or 0.0)
    credit_limit = float(user.credit_limit or 0.0)

    if bal >= 0:
        balance_line = f"💰 На счёте: <b>+{bal:.2f} ₾</b>"
    else:
        balance_line = (
            f"📉 Баланс: <b>{bal:.2f} ₾</b>"
            f" (кредитный лимит {credit_limit:.0f} ₾)"
        )

    # Tier scale text — same numbers as PRICING_CONFIG.weekly_progressive,
    # rendered once and reused as a footer reference so the user always
    # sees how the cashback was derived.
    tier_scale = "ℹ️ Шкала: 5–11 ч → −10% · 11–16 ч → −25% · 16+ ч → −50%"

    if bookings_n == 0:
        return (
            f"<b>🗓 Итоги недели {h(week)}</b>\n\n"
            f"На прошлой неделе у тебя не было броней.\n\n"
            f"{balance_line}"
        )

    # Tier line — explain WHICH tier hit and WHY ("17 ч → попало в 16+ ч → -50%")
    if tier == 0:
        need_to_5 = max(0.0, 5.0 - hours)
        tier_line = (
            f"📊 Накоплено <b>{hours:.1f} ч</b> — до тира −10% не хватило "
            f"<b>{need_to_5:.1f} ч</b>"
        )
    else:
        tier_band = "5–11 ч" if tier == 10 else "11–16 ч" if tier == 25 else "16+ ч"
        tier_line = (
            f"📊 Накоплено <b>{hours:.1f} ч</b> → тир <b>{tier_band}</b> → "
            f"скидка <b>−{tier}%</b> применена к каждой брони недели"
        )

    if cashback > 0:
        cashback_line = f"🎁 Бонус за объём: <b>+{cashback:.2f} ₾</b> зачислено на баланс"
    else:
        cashback_line = "🎁 Бонус за объём: уже учтён в цене каждой брони"

    body = (
        f"<b>🗓 Итоги недели {h(week)}</b>\n\n"
        f"📋 Броней: <b>{bookings_n}</b> · <b>{hours:.1f} ч</b>\n"
        f"💸 Потрачено: <b>{paid:.2f} ₾</b>\n\n"
        f"{tier_line}\n"
        f"{cashback_line}\n\n"
        f"{balance_line}\n\n"
        f"<i>{tier_scale}</i>"
    )
    return body


def _fmt_date(yyyy_mm_dd: str) -> str:
    """'2026-04-28' → '28 апр'."""
    months = ["янв", "фев", "мар", "апр", "май", "июн",
              "июл", "авг", "сен", "окт", "ноя", "дек"]
    try:
        y, m, d = yyyy_mm_dd.split("-")
        return f"{int(d)} {months[int(m) - 1]}"
    except Exception:
        return yyyy_mm_dd
