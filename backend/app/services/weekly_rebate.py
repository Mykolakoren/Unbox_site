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
from app.services.pricing import PricingService, MANUAL_PRICE_RULES
from app.services import subscription_pool

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
        # Недельный пакет (фикс. цена за N часов в неделю, 29.09) уже со скидкой —
        # скидка за объём к нему не применяется, в т.ч. к часам сверх пакета.
        if subscription_pool.get(user.subscription, "weekly_package", False):
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
            # Ручная цена («Цена», «Час в подарок» и его части) — договорная, в
            # возврат не входит: иначе цена выше движка (35 при 20) «возвращала»
            # клиенту наценку (решение владельца 09.10). Часы брони при этом
            # считаются в объём недели (total_hours выше).
            if (b.applied_rule or "") in MANUAL_PRICE_RULES:
                continue
            try:
                # Время старта — из date + start_time, КАК в create_booking.
                # Раньше передавали b.date (полночь) → движок не видел час пик,
                # база скидки считалась неверно, и недельный кредит выходил
                # завышенным у клиентов с бронями в пик (утро 9-10, вечер 20-22).
                try:
                    _h, _m = map(int, (b.start_time or "0:0").split(":"))
                    _start = b.date.replace(hour=_h, minute=_m, second=0, microsecond=0)
                except Exception:
                    _start = b.date
                breakdown = pricing.calculate_price(
                    user=user,
                    resource_id=b.resource_id,
                    start_time=_start,
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
            # Допы (кофе, песочница, проектор, кушетка) — не аренда: движок цены
            # их не знает, и без вычета скидка «возвращала» клиенту цену допов
            # (владелец 02.10: исправить дальше, прошлые начисления не трогать).
            # Вычитаем, как при делении брони (bookings/routes.py, split): цена
            # допов из реестра, не больше уплаченного.
            extras_price = round(float(PricingService.calculate_extras_price(list(b.extras or []))), 2)
            extras_price = min(extras_price, max(0.0, round(stored, 2)))
            stored = stored - extras_price
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


def estimate_booking_rebate(session: Session, booking: Booking) -> dict:
    """Ориентир для попапа брони (просьба Егора 21.09): сколько недельного
    кредита придёт в понедельник за ЭТУ бронь и за всю неделю клиента.

    ТОЛЬКО ЧТЕНИЕ — ничего не пишет. Формула добора — та же, что в
    run_weekly_rebates (держать синхронно; сторож сверяет ключевые строки).
    Отличие одно: pending-брони тоже считаются — к понедельнику их спишут
    (списание за 24 ч до начала), а это прогноз, не начисление.
    """
    d = booking.date.date() if isinstance(booking.date, datetime) else booking.date
    week_start = _monday(d)
    start_dt = datetime(week_start.year, week_start.month, week_start.day)
    end_dt = start_dt + timedelta(days=7)

    user: Optional[User] = None
    if booking.user_uuid:
        try:
            user = session.get(User, booking.user_uuid if isinstance(booking.user_uuid, UUID) else UUID(str(booking.user_uuid)))
        except (ValueError, TypeError):
            user = None
    if user is None and booking.user_id:
        user = session.exec(select(User).where(User.email == booking.user_id)).first()

    tiers = PricingService.PRICING_CONFIG["weekly_progressive"]
    empty = {
        "week_start": week_start.isoformat(), "applies": False, "total_hours": 0.0,
        "tier_percent": 0, "next_tier_percent": None, "hours_to_next_tier": None,
        "booking_rebate": 0.0, "booking_net_estimate": float(booking.final_price or 0.0),
        "week_rebate": 0.0,
    }
    if user is None or subscription_pool.get(user.subscription, "weekly_package", False):
        return empty

    conds = [Booking.status == "confirmed", Booking.date >= start_dt, Booking.date < end_dt]
    week = session.exec(select(Booking).where(*conds, Booking.user_uuid == user.id)).all()
    if not week:
        week = session.exec(select(Booking).where(*conds, Booking.user_id == user.email)).all()
    total_hours = sum(b.duration / 60.0 for b in week)
    tier = PricingService.weekly_tier_percent(total_hours)
    nxt = next((t for t in tiers if t["min"] > total_hours and int(t["percent"]) > tier), None)

    pricing = PricingService(session)

    def _rebate_for(b: Booking) -> float:
        if b.payment_method != "balance" or b.payment_status == "waived" or tier == 0:
            return 0.0
        # Ручная цена — в возврат не входит (как в run_weekly_rebates, 09.10).
        if (b.applied_rule or "") in MANUAL_PRICE_RULES:
            return 0.0
        try:
            try:
                _h, _m = map(int, (b.start_time or "0:0").split(":"))
                _start = b.date.replace(hour=_h, minute=_m, second=0, microsecond=0)
            except Exception:
                _start = b.date
            breakdown = pricing.calculate_price(
                user=user,
                resource_id=b.resource_id,
                start_time=_start,
                duration_minutes=b.duration,
                format_type=b.format or "individual",
                exclude_booking_id=b.id,
                ignore_subscription=True,
            )
        except Exception:
            return 0.0
        base = breakdown.discountable_base or 0.0
        if base <= 0:
            return 0.0
        duration_pct = int(breakdown.discount_percent or 0)
        weekly_extra = base * (max(0, tier - duration_pct) / 100.0)
        recomputed = float(breakdown.final_price or 0.0)
        correct_at_T = recomputed - weekly_extra
        stored = float(b.final_price or 0.0)
        # Допы — не аренда: вычитаем, как в run_weekly_rebates (держать синхронно).
        extras_price = round(float(PricingService.calculate_extras_price(list(b.extras or []))), 2)
        extras_price = min(extras_price, max(0.0, round(stored, 2)))
        stored = stored - extras_price
        return max(0.0, stored - correct_at_T)

    this_rebate = round(_rebate_for(booking), 2)
    week_rebate = round(sum(_rebate_for(b) for b in week), 2)

    # Недельная скидка, начисленная с последнего понедельника по Тбилиси, — чтобы
    # попап брони сказал «скидка за неделю +9 ₾ уже учтена в «к оплате»». Правило
    # одно с меткой в «Сегодня» (02.10): day_summary.recent_weekly_rebates. Раньше
    # тут было «за 8 дней» — в понедельник попап ещё показывал прошлую скидку,
    # когда новой у клиента не было, а «Сегодня» — уже нет.
    from app.services.day_summary import recent_weekly_rebates
    recent = recent_weekly_rebates(session, user_id=str(user.id))
    last_rebate = (
        {
            "amount": round(sum(float(r.delta or 0) for r in recent), 2),
            "date": (recent[0].created_at + timedelta(hours=4)).strftime("%d.%m"),
        }
        if recent else None
    )
    if week_rebate < MIN_REBATE_GEL:
        week_rebate, this_rebate = 0.0, 0.0
    applies = booking.payment_method == "balance" and booking.payment_status != "waived"
    return {
        "week_start": week_start.isoformat(),
        "applies": applies,
        "total_hours": round(total_hours, 1),
        "tier_percent": tier,
        "next_tier_percent": int(nxt["percent"]) if nxt else None,
        "hours_to_next_tier": round(nxt["min"] - total_hours, 1) if nxt else None,
        "booking_rebate": this_rebate,
        "booking_net_estimate": round(float(booking.final_price or 0.0) - this_rebate, 2),
        "week_rebate": week_rebate,
        "last_rebate": last_rebate,
    }
