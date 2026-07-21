"""
Недельный перерасчёт (weekly rebate).

Owner 2026-06-16: недельная скидка за объём применяется не в момент брони,
а кредитом в конце недели — на ВСЕ часы недели по итоговому тарифу. Часы,
забронированные раньше по полной цене, компенсируются кредитом на баланс.

Логика:
  1. Для каждого клиента с подтверждёнными бронями за неделю (пн–вс):
  2. total_hours = сумма всех подтверждённых часов недели → итоговый тариф T.
  3. Для броней, оплаченных С БАЛАНСА: пересчёт цены по тарифу T и добор
     разницы до уже применённой скидки за длительность:
        rebate_i = discountable_base_i × max(0, T − duration_pct_i) / 100
  4. Сумма по клиенту → кредит на баланс + проводка в кассу (аудит).
  5. Идемпотентность: одна запись WeeklyRebate на (user_id, week_start).

Исключения: personal-discount и comp-аккаунты (их брони дают
discountable_base=0 → вклад 0), брони по абонементу/бонусам (не balance),
а также брони, за которые деньги ещё не списаны (payment_status pending/waived).

Цена для добора считается с ignore_subscription=True: клиент платил за эти
брони деньгами, и абонемент, купленный позже в ту же неделю, не должен задним
числом обнулять заработанную скидку.
"""
from datetime import date, datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlmodel import Session, select

from app.models.booking import Booking
from app.models.user import User
from app.models.weekly_rebate import WeeklyRebate
from app.models.cashbox_transaction import CashboxTransaction
from app.services.pricing import PricingService

# Минимальный кредит — мелочь не начисляем (шум в кассе/балансе).
MIN_REBATE_GEL = 0.5

# Дата перехода на модель «скидка кредитом в конце недели» (owner 2026-06-29:
# «только вперёд»). Недели, начинающиеся РАНЬШЕ этого понедельника, не
# перерасчитываем — клиенты уже приняли те цены. Защищает от случайного
# ретро-начисления через кнопку или неверно сработавший cron.
REBATE_CUTOVER_WEEK = date(2026, 6, 29)


def _monday(d: date) -> date:
    return d - timedelta(days=d.isoweekday() - 1)


def last_completed_week_start(today: Optional[date] = None) -> date:
    """Понедельник ПРОШЛОЙ (завершившейся) недели."""
    if today is None:
        today = datetime.utcnow().date()
    this_monday = _monday(today)
    return this_monday - timedelta(days=7)


def run_weekly_rebates(
    session: Session,
    week_start: date,
    dry_run: bool = True,
) -> dict:
    """Начисляет недельные кредиты за неделю [week_start, +7).
    dry_run=True — только считает и возвращает суммы, ничего не пишет.
    """
    # «Только вперёд» — недели до перехода не трогаем (кроме явного dry_run
    # для проверки сумм). Реальное начисление за прошлое заблокировано.
    if week_start < REBATE_CUTOVER_WEEK and not dry_run:
        return {
            "week_start": week_start.isoformat(),
            "dry_run": dry_run,
            "users_credited": 0,
            "total_credited": 0.0,
            "skipped_already_done": 0,
            "skipped_before_cutover": True,
            "details": [],
        }

    start_dt = datetime(week_start.year, week_start.month, week_start.day)
    end_dt = start_dt + timedelta(days=7)

    pricing = PricingService(session)

    # Все подтверждённые брони недели.
    bookings = session.exec(
        select(Booking).where(
            Booking.status == "confirmed",
            Booking.date >= start_dt,
            Booking.date < end_dt,
        )
    ).all()

    # Группируем по пользователю (резолвим User один раз).
    by_user: dict[str, list[Booking]] = {}
    for b in bookings:
        key = str(b.user_uuid) if b.user_uuid else (b.user_id or "")
        if not key:
            continue
        by_user.setdefault(key, []).append(b)

    results: list[dict] = []
    total_credited = 0.0
    skipped_already = 0

    for key, user_bookings in by_user.items():
        # Резолвим пользователя.
        user: Optional[User] = None
        first = user_bookings[0]
        if first.user_uuid:
            try:
                user = session.get(User, first.user_uuid if isinstance(first.user_uuid, UUID) else UUID(str(first.user_uuid)))
            except (ValueError, TypeError):
                user = None
        if user is None and first.user_id:
            user = session.exec(select(User).where(User.email == first.user_id)).first()
        if user is None:
            continue

        # Итоговый тариф недели — по ВСЕМ подтверждённым часам (любой способ оплаты).
        total_hours = sum(b.duration / 60.0 for b in user_bookings)
        tier = PricingService.weekly_tier_percent(total_hours)
        if tier == 0:
            continue

        # Считаем добор только по броням, оплаченным с баланса.
        # CUTOVER-SAFE формула: сравниваем фактически уплаченное (b.final_price)
        # с КОРРЕКТНОЙ ценой по итоговому тарифу T. Это защищает от двойного
        # начисления в переходную неделю: брони, уже получившие живую недельную
        # скидку до отключения, имеют низкий final_price → их добор ≈ 0.
        #   recomputed   = цена брони БЕЗ недельной (только длительность+пик)
        #   correct_at_T = recomputed − discountable_base × max(0, T−dur%)/100
        #   rebate_i     = max(0, факт_уплачено − correct_at_T)
        rebate = 0.0
        for b in user_bookings:
            if b.payment_method != "balance":
                continue
            # Скидка — это ВОЗВРАТ переплаты. Возвращать можно только то, что
            # реально списано. Бронь со статусом pending (деньги ещё не сняты,
            # снимутся за 24 ч) или waived (списание прощено) ничего не
            # оплатила — кредит за неё был бы подарком из воздуха, а если её
            # потом отменят, деньги останутся у клиента насовсем.
            # None — старые брони до отложенного списания, они оплачены сразу.
            if b.payment_status in ("pending", "waived"):
                continue
            try:
                breakdown = pricing.calculate_price(
                    user=user,
                    resource_id=b.resource_id,
                    start_time=b.date,
                    duration_minutes=b.duration,
                    format_type=b.format or "individual",
                    exclude_booking_id=b.id,
                    # Считаем как обычную платную бронь: клиент заплатил за неё
                    # деньгами с баланса. Абонемент, купленный позже, не должен
                    # задним числом обнулять уже заработанную скидку.
                    ignore_subscription=True,
                )
            except Exception:
                continue
            base = breakdown.discountable_base or 0.0
            if base <= 0:
                continue  # subscription/personal/comp — без денежного добора
            duration_pct = int(breakdown.discount_percent or 0)
            weekly_extra = base * (max(0, tier - duration_pct) / 100.0)
            recomputed = float(breakdown.final_price or 0.0)  # без недельной (pricing.py)
            correct_at_T = recomputed - weekly_extra
            stored = float(b.final_price or 0.0)
            rebate += max(0.0, stored - correct_at_T)

        rebate = round(rebate, 2)
        if rebate < MIN_REBATE_GEL:
            continue

        # Идемпотентность.
        existing = session.exec(
            select(WeeklyRebate).where(
                WeeklyRebate.user_id == user.id,
                WeeklyRebate.week_start == week_start,
            )
        ).first()
        if existing:
            skipped_already += 1
            continue

        row = {
            "user_id": str(user.id),
            "user_email": user.email,
            "user_name": user.name,
            "total_hours": round(total_hours, 1),
            "tier_percent": tier,
            "rebate": rebate,
        }
        results.append(row)
        total_credited += rebate

        if not dry_run:
            # 1. Кредит на баланс.
            from app.services import wallet
            wallet.credit(session, user, rebate, reason="weekly_rebate",
                          description=f"Недельная скидка за объём ({tier}%, {round(total_hours,1)} ч)",
                          ref_type="weekly_rebate", ref_id=str(user.id))
            # 2. Проводка в кассу — ТОЛЬКО для аудита. Скидка уходит клиенту
            #    кредитом на баланс, из денежного ящика ничего не вынимают,
            #    поэтому payment_method='adjustment': такие проводки видны в
            #    ленте, но не входят в остатки кассы (get_balance считает лишь
            #    cash/card_tbc/card_bog). Раньше стояло 'cash' — и каждая
            #    скидка занижала наличные в общем итоге (набежало 463.50 ₾).
            tx = CashboxTransaction(
                type="expense",
                amount=rebate,
                currency="GEL",
                payment_method="adjustment",
                description=f"Недельная скидка за объём ({tier}%, {round(total_hours,1)} ч) — неделя с {week_start.isoformat()}",
                date=datetime.utcnow(),
                client_name=user.name,
                admin_id="system",
                admin_name="Недельный перерасчёт",
                credited_user_id=str(user.id),
            )
            session.add(tx)
            session.flush()
            # 3. Лог идемпотентности.
            session.add(WeeklyRebate(
                user_id=user.id,
                week_start=week_start,
                total_hours=round(total_hours, 1),
                tier_percent=tier,
                amount=rebate,
                cashbox_tx_id=tx.id,
            ))

    if not dry_run:
        session.commit()

    return {
        "week_start": week_start.isoformat(),
        "dry_run": dry_run,
        "users_credited": len(results),
        "total_credited": round(total_credited, 2),
        "skipped_already_done": skipped_already,
        "details": results,
    }
