"""Ревизор денег: считает инварианты и молчит, пока всё сходится.

ТОЛЬКО ЧТЕНИЕ. Ничего не пишет, ничего не чинит — только докладывает.

  cd /var/www/unbox/backend && venv/bin/python3 scripts/money_audit.py
  venv/bin/python3 scripts/money_audit.py --json     # для крона/алертов

Код возврата: 0 — всё сходится, 1 — есть расхождения.

Зачем. Денежные баги в Unbox приходят не по одному, а серией, и всегда одинаково:
правило чинят в одном файле и забывают в соседнем. `weekly_cashback` убрали, а
`weekly_rebate` остался без фильтра. Правило «деньги двигались» написали в
`consecutive_pricing`, а в недельный перерасчёт не перенесли. Списание часов
завязали на `payment_method`, а движок цен про этот ярлык не знает вовсе — и
три месяца кабинеты уходили бесплатно.

Разовая проверка такое не ловит: она устаревает на следующем коммите. Ловит —
инвариант, который считают каждый день.

Каждая проверка ниже — это баг, который УЖЕ случался.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Optional
from uuid import UUID

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.db.session import engine  # noqa: E402


class Check:
    """Одна проверка: заголовок, SQL и человеческое объяснение, что это значит.

    02.10: SQL может брать окна времени параметрами (:since_30d и др., см.
    audit_params) и строиться при запуске (sql — функция), а `post` — досчитать
    результат в Python, когда одного SQL мало (перепроверка недельной скидки
    зовёт тот же движок цен, что и начисление): post(session, rows, params).
    info=True — «для сведения»: сигнал бизнесу, а не расхождение; на код
    возврата и счётчик расхождений не влияет.
    """

    def __init__(self, key: str, title: str, sql: str | Callable[[], str], why: str,
                 post: Optional[Callable[..., list[dict[str, Any]]]] = None,
                 info: bool = False):
        self.key = key
        self.title = title
        self.sql = sql
        self.why = why
        self.post = post
        self.info = info


CHECKS: list[Check] = [
    Check(
        key="subscription_label_mismatch",
        title="Бронь оценена по абонементу, но помечена другим способом оплаты",
        why=(
            "Часы абонемента списываются ТОЛЬКО там, где payment_method='subscription'. "
            "Если движок покрыл слот абонементом (applied_rule='SUBSCRIPTION'), а ярлык "
            "остался 'balance', то кабинет уходит за 0 ₾ и часы не сгорают. "
            "Так утекло 84.5 ч / ~1630 ₾ с апреля по июль 2026."
        ),
        # Только НЕОПЛАЧЕННЫЕ (pending): их крон ЕЩЁ спишет по 0 ₾ и не сожжёт
        # часы — вот реальная будущая утечка. Уже оплаченные (paid) мислейблы
        # утекли в прошлом и закрыты сверкой пулов — по ним не алертим.
        sql="""
            SELECT b.id::text, u.email, b.date::date::text AS date, b.duration,
                   b.payment_method, b.final_price, b.base_price
            FROM booking b LEFT JOIN "user" u ON u.id = b.user_uuid
            WHERE b.status = 'confirmed'
              AND b.applied_rule = 'SUBSCRIPTION'
              AND b.payment_method <> 'subscription'
              AND b.payment_status = 'pending'
            ORDER BY b.date DESC
        """,
    ),
    Check(
        key="stale_pending",
        title="Бронь в статусе pending, а слот уже прошёл",
        why=(
            "Крон списания (charge-due, каждые 10 мин) обязан рассчитать бронь за 24 ч "
            "до старта. Если слот в прошлом, а деньги не списаны — крон отстал или упал, "
            "и клиент откатал бесплатно. Сторож крона должен был это поймать."
        ),
        sql="""
            SELECT b.id::text, u.email, b.date::date::text AS date, b.start_time,
                   b.payment_method, b.final_price
            FROM booking b LEFT JOIN "user" u ON u.id = b.user_uuid
            WHERE b.status = 'confirmed'
              AND b.payment_status = 'pending'
              AND (b.date + (split_part(b.start_time, ':', 1) || ' hours')::interval)
                  < (now() AT TIME ZONE 'UTC' + interval '4 hours')
            ORDER BY b.date
        """,
    ),
    Check(
        key="rebate_on_unpaid",
        title="Недельный кредит начислен за неоплаченные брони",
        why=(
            "Недельная скидка — это ВОЗВРАТ ПЕРЕПЛАТЫ. За прощённую (waived) или ещё не "
            "списанную (pending) бронь клиент не платил, значит и возвращать нечего. "
            "weekly_rebate.py не фильтрует по payment_status — при первой же прощённой "
            "броне у клиента с баланса начислит лишнего."
        ),
        sql="""
            SELECT wr.week_start::text, u.email, wr.tier_percent, wr.total_hours,
                   wr.amount AS credited,
                   count(*) FILTER (
                       WHERE coalesce(b.payment_status, 'paid') IN ('pending', 'waived')
                   ) AS unpaid_bookings
            FROM weekly_rebates wr
            JOIN "user" u ON u.id = wr.user_id
            JOIN booking b ON b.user_uuid = wr.user_id
                          AND b.status = 'confirmed'
                          AND b.date >= wr.week_start
                          AND b.date < wr.week_start + 7
            GROUP BY wr.week_start, u.email, wr.tier_percent, wr.total_hours, wr.amount
            HAVING count(*) FILTER (
                       WHERE coalesce(b.payment_status, 'paid') IN ('pending', 'waived')
                   ) > 0
            ORDER BY wr.week_start DESC
        """,
    ),
    Check(
        key="broken_subscription_pool",
        title="Пул абонемента не сходится сам с собой",
        why=(
            "remaining_hours + used_hours обязано равняться total_hours + bonus_hours "
            "(бонусные часы — часть пула, напр. Профи+ = 40+2). Пул пишется в двух "
            "диалектах (snake_case с бэкенда, camelCase из UI) — рассинхрон уже приводил "
            "к двойному списанию: админ пополнял camelCase, а крон читал snake."
        ),
        sql="""
            SELECT u.email,
                   coalesce(u.subscription->>'total_hours',     u.subscription->>'totalHours')     AS total,
                   coalesce(u.subscription->>'bonus_hours',     u.subscription->>'bonusHours', '0') AS bonus,
                   coalesce(u.subscription->>'used_hours',      u.subscription->>'usedHours')      AS used,
                   coalesce(u.subscription->>'remaining_hours', u.subscription->>'remainingHours') AS remaining
            FROM "user" u
            WHERE u.subscription IS NOT NULL
              AND u.subscription::text NOT IN ('null', '{}')
              -- завершённые абонементы не проверяем: они закрыты, часы неважны
              AND coalesce(u.subscription->>'status', u.subscription->>'status') IS DISTINCT FROM 'completed'
              AND coalesce(u.subscription->>'total_hours', u.subscription->>'totalHours') IS NOT NULL
              AND abs(
                    coalesce(u.subscription->>'remaining_hours', u.subscription->>'remainingHours')::float
                  + coalesce(u.subscription->>'used_hours',      u.subscription->>'usedHours', '0')::float
                  - coalesce(u.subscription->>'total_hours',     u.subscription->>'totalHours')::float
                  - coalesce(u.subscription->>'bonus_hours',     u.subscription->>'bonusHours', '0')::float
              ) > 0.01
            ORDER BY u.email
        """,
    ),
    Check(
        key="negative_pool",
        title="В абонементе отрицательный остаток часов",
        why="Списали больше, чем было. Значит гейт «хватает ли часов» где-то не сработал.",
        sql="""
            SELECT u.email,
                   coalesce(u.subscription->>'remaining_hours', u.subscription->>'remainingHours') AS remaining
            FROM "user" u
            WHERE u.subscription IS NOT NULL
              AND u.subscription::text NOT IN ('null', '{}')
              AND coalesce(u.subscription->>'remaining_hours', u.subscription->>'remainingHours', '0')::float < -0.01
        """,
    ),
    Check(
        key="broken_extra_pool",
        title="Доп. пул абонемента (часы капсулы / «индивидуально») не сходится",
        why=(
            "У абонемента есть второй пул: часы капсулы (Пробный 1, Тёплый 4, Регулярный 6, "
            "Профи+ 10) или «4 ч индивидуально» у Группового мастера. Инварианты: остаток "
            "+ израсходовано = всего; остаток не уходит в минус и не превышает «всего». "
            "Нарушение значит, что часы вернули не в тот пул или списали мимо subscription_pool."
        ),
        sql="""
            SELECT u.email,
                   coalesce(u.subscription->>'extra_kind', u.subscription->>'extraKind') AS kind,
                   coalesce(u.subscription->>'extra_hours_total',     u.subscription->>'extraHoursTotal')     AS total,
                   coalesce(u.subscription->>'extra_hours_used',      u.subscription->>'extraHoursUsed', '0') AS used,
                   coalesce(u.subscription->>'extra_hours_remaining', u.subscription->>'extraHoursRemaining') AS remaining
            FROM "user" u
            WHERE u.subscription IS NOT NULL
              AND u.subscription::text NOT IN ('null', '{}')
              AND coalesce(u.subscription->>'extra_hours_total', u.subscription->>'extraHoursTotal') IS NOT NULL
              AND coalesce(u.subscription->>'status', u.subscription->>'status') IS DISTINCT FROM 'completed'
              AND (
                    abs(
                        coalesce(u.subscription->>'extra_hours_remaining', u.subscription->>'extraHoursRemaining', '0')::float
                      + coalesce(u.subscription->>'extra_hours_used', u.subscription->>'extraHoursUsed', '0')::float
                      - coalesce(u.subscription->>'extra_hours_total', u.subscription->>'extraHoursTotal')::float
                    ) > 0.01
                 OR coalesce(u.subscription->>'extra_hours_remaining', u.subscription->>'extraHoursRemaining', '0')::float < -0.01
                 OR coalesce(u.subscription->>'extra_hours_remaining', u.subscription->>'extraHoursRemaining', '0')::float
                    > coalesce(u.subscription->>'extra_hours_total', u.subscription->>'extraHoursTotal')::float + 0.01
              )
            ORDER BY u.email
        """,
    ),
    Check(
        key="extra_booking_overdraw",
        title="В брони часов из доп. пула больше, чем часов абонемента (или не абонементная бронь)",
        why=(
            "У брони хранится hours_deducted (всего часов абонемента) и extra_hours_deducted "
            "(из них из доп. пула). Доп. часов не может быть больше всех, и они бывают только "
            "у абонементных броней. Иначе возврат при отмене положит в пул лишнее. "
            "(to_jsonb — чтобы ревизор не падал, пока колонку ещё не добавила миграция.)"
        ),
        sql="""
            SELECT b.id::text, u.email, b.date::date::text AS date, b.payment_method,
                   b.hours_deducted, (to_jsonb(b)->>'extra_hours_deducted') AS extra_hours_deducted
            FROM booking b LEFT JOIN "user" u ON u.id = b.user_uuid
            WHERE coalesce((to_jsonb(b)->>'extra_hours_deducted')::float, 0) > 0.0001
              AND (
                    b.payment_method <> 'subscription'
                 OR (to_jsonb(b)->>'extra_hours_deducted')::float > coalesce(b.hours_deducted, 0) + 0.01
              )
            ORDER BY b.date DESC
        """,
    ),
    Check(
        key="charge_amount_mismatch",
        title="Списанная сумма не совпадает с ценой брони",
        why=(
            "charge_amount — снимок того, что РЕАЛЬНО ушло с баланса. По нему считается "
            "возврат при отмене. Если он разошёлся с final_price (а пересчёт цепочек его "
            "не двигал) — возврат отдаст не ту сумму. "
            "ВАЖНО: у абонементных броней charge_amount хранит ЧАСЫ, а не лари — их не проверяем."
        ),
        sql="""
            SELECT b.id::text, u.email, b.date::date::text AS date,
                   b.final_price, b.charge_amount, b.payment_method
            FROM booking b LEFT JOIN "user" u ON u.id = b.user_uuid
            WHERE b.status = 'confirmed'
              AND b.payment_status = 'paid'
              AND b.payment_method = 'balance'
              AND b.charge_amount IS NOT NULL
              AND abs(b.charge_amount - b.final_price) > 0.01
              -- только свежие: 16 расхождений до 2026-07-15 — исторический осадок,
              -- закрытый июльскими фиксами, каждый день о них напоминать не нужно
              AND b.date >= DATE '2026-07-15'
            ORDER BY abs(b.charge_amount - b.final_price) DESC
        """,
    ),
    Check(
        key="balance_vs_ledger",
        title="Баланс клиента не сходится с лентой операций",
        why=(
            "Каждое изменение баланса обязано идти через кошелёк (wallet) и писать строку "
            "в balance_ledger. Если баланс ≠ сумме ленты — значит кто-то изменил баланс "
            "МИМО кошелька: прямой правкой в БД или новым кодом в обход. Это главный "
            "сторож против повторения истории с расползающимися балансами."
        ),
        sql="""
            SELECT u.email, u.name,
                   round(u.balance::numeric, 2) AS balance,
                   round(coalesce(sum(l.delta), 0)::numeric, 2) AS ledger_sum,
                   round((u.balance - coalesce(sum(l.delta), 0))::numeric, 2) AS diff
            FROM "user" u
            LEFT JOIN balance_ledger l ON l.user_id = u.id::text
            GROUP BY u.id, u.email, u.name, u.balance
            HAVING abs(u.balance - coalesce(sum(l.delta), 0)) > 0.01
            ORDER BY abs(u.balance - coalesce(sum(l.delta), 0)) DESC
        """,
    ),
    Check(
        key="over_credit_limit",
        title="Долг клиента превысил кредитный лимит",
        why=(
            "Не баг кода, а сигнал бизнесу: клиент ушёл в минус глубже разрешённого. "
            "Списание за 24 ч намеренно проводит бронь даже за лимитом (слот уже занят), "
            "но такие случаи обязаны быть видны."
        ),
        sql="""
            SELECT u.email, u.name, u.balance, u.credit_limit
            FROM "user" u
            WHERE u.balance < -abs(coalesce(u.credit_limit, 0)) - 0.01
            ORDER BY u.balance
        """,
    ),
]


# ═══ Контроль денег без Excel (решение владельца 02.10) ═════════════════════
# Владелец уходит от таблиц админов: то, что раньше сверяли глазами в Excel,
# теперь ловит ревизор. Окна времени — параметрами (audit_params), а не now()
# в SQL: так SQL этих проверок одинаково работает в Postgres и на SQLite,
# где их гоняет сторож (tests/guard_money_controls_2026_10.py).
#
# Новые проверки не имеют права уронить ревизора: всё, что им нужно сверх
# базы (движок цен, недельная скидка, порог из shift_alert), подгружается
# лениво, внутри самой проверки. Не загрузилось — эта проверка помечается
# «не выполнилась», а первые десять идут как всегда.

TBILISI = timedelta(hours=4)

# Порог расхождения смены — если services/shift_alert.py (где он живёт) ещё
# не выложен. Держать равным SHIFT_DISCREPANCY_ALERT_GEL.
SHIFT_ALERT_GEL_FALLBACK = 5.0

# Строка ленты «кредит недельной скидки» и строка журнала weekly_rebates
# пишутся одной транзакцией — между ними доли секунды. Ближе этого — пара.
_JOURNAL_MATCH_SEC = 120

# Описание перевода между счетами кассы: «Перевод: Карта BOG → Карта TBC».
_TRANSFER_PREFIX = "Перевод:"
# Допы к броне оплачены на месте — отдельный приход без защиты от дубля
# (bookings/routes.py, «Допы к броне (дозаказ): …»).
_EXTRAS_PREFIX = "Допы к броне"

_METHOD_RU = {"cash": "наличные", "card_tbc": "карта TBC", "card_bog": "карта BOG"}


def _shift_alert_gel() -> float:
    try:
        from app.services.shift_alert import SHIFT_DISCREPANCY_ALERT_GEL
        return float(SHIFT_DISCREPANCY_ALERT_GEL)
    except Exception:  # noqa: BLE001 — модуль ещё не выложен или переименован
        return SHIFT_ALERT_GEL_FALLBACK


def _last_completed_week_start(today: date) -> date:
    """Понедельник прошлой недели — функцией крона скидки (services/weekly_rebate.py);
    не загрузилась — та же арифметика здесь."""
    try:
        from app.services.weekly_rebate import last_completed_week_start
        return last_completed_week_start(today)
    except Exception:  # noqa: BLE001
        return today - timedelta(days=today.isoweekday() - 1) - timedelta(days=7)


def audit_params(now_utc: Optional[datetime] = None) -> dict[str, Any]:
    """Окна времени для проверок — naive UTC, как даты лежат в базе."""
    now = now_utc or datetime.now(timezone.utc).replace(tzinfo=None)
    today_tb = (now + TBILISI).date()
    since_24h = now - timedelta(hours=24)
    # Недельную скидку крон начисляет в пн 01:00 UTC. До 03:00 UTC понедельника
    # перепроверяем позапрошлую неделю — иначе тревога раньше самого начисления.
    rebate_week = _last_completed_week_start(now.date())
    if now.weekday() == 0 and now.hour < 3:
        rebate_week -= timedelta(days=7)
    # Начисление за неделю W делает крон в понедельник сразу после неё.
    credit_from = datetime.combine(rebate_week + timedelta(days=7), time.min)
    return {
        "since_30d": now - timedelta(days=30),
        # booking.date — календарная дата брони (полночь), сравниваем с датой.
        "book_since": datetime.combine(today_tb - timedelta(days=30), time.min),
        # Информационные проверки — «с прошлого запуска»: крон раз в сутки,
        # окно 24 ч, и каждое событие попадает ровно в один отчёт.
        "since_24h": since_24h,
        # Приходы с полуночи (по Тбилиси) того дня, где начинается окно: пара
        # «утром + вечером» найдётся, даже если первое внесение было до окна.
        "repeat_from": datetime.combine((since_24h + TBILISI).date(), time.min) - TBILISI,
        "shift_alert_gel": _shift_alert_gel(),
        "rebate_week": rebate_week,
        "rebate_week_start": datetime.combine(rebate_week, time.min),
        "rebate_credit_from": credit_from,
        "rebate_credit_to": credit_from + timedelta(days=7),
    }


def _as_dt(value: Any) -> datetime:
    """Postgres отдаёт datetime, SQLite через text() — строку."""
    return value if isinstance(value, datetime) else datetime.fromisoformat(str(value))


def _norm_id(value: Any) -> str:
    """UUID в одном виде: SQLite хранит его без дефисов, Postgres — с ними.
    Не-UUID (email, id клиента Psy-CRM) — как есть."""
    if value is None:
        return ""
    raw = str(value).strip()
    try:
        return str(UUID(raw))
    except ValueError:
        return raw


def _sql_list(values) -> str:
    return ", ".join("'" + str(v).replace("'", "''") + "'" for v in sorted(values))


def _without_card_transfers(session: Session, rows: list[dict], params: dict) -> list[dict]:
    """Приход без филиала минус внутренние переводы между картами.

    «Перевод: Карта BOG → Карта TBC» — это пара расход + приход: банковский счёт
    общий, выручки в нём нет. Такой приход не тревога, но только если у него есть
    СВОЙ расход-близнец: та же сумма и описание, тот же день по Тбилиси, и один
    расход прощает ровно один приход. Перевод в наличные остаётся в списке —
    эти деньги легли в ящик конкретного филиала."""
    cand = [r for r in rows if r.get("payment_method") in ("card_tbc", "card_bog")
            and str(r.get("description") or "").startswith(_TRANSFER_PREFIX)]
    excused: set = set()
    if cand:
        since = min(_as_dt(r["date"]) for r in cand) - timedelta(days=1)
        twins = session.exec(text(f"""
            SELECT x.id, x.date, x.amount, x.description
            FROM cashbox_transactions x
            WHERE x.type = 'expense'
              AND (x.branch IS NULL OR trim(x.branch) = '')
              AND substr(coalesce(x.description, ''), 1, {len(_TRANSFER_PREFIX)}) = '{_TRANSFER_PREFIX}'
              AND x.date >= :since
            ORDER BY x.date
        """), params={"since": since}).mappings().all()
        used: set = set()
        for r in sorted(cand, key=lambda r: _as_dt(r["date"])):
            day = (_as_dt(r["date"]) + TBILISI).date()
            for x in twins:
                if (x["id"] not in used and x["description"] == r["description"]
                        and abs(float(x["amount"]) - float(r["amount"])) < 0.005
                        and (_as_dt(x["date"]) + TBILISI).date() == day):
                    used.add(x["id"])
                    excused.add(r["id"])
                    break
    return [{**r, "date": _as_dt(r["date"]).strftime("%Y-%m-%d %H:%M")}
            for r in rows if r["id"] not in excused]


def _free_booking_sql() -> str:
    """SQL «брони за 0 ₾». Строится при запуске: список законно бесплатных берём
    из движка цен (PricingService.COMP_ACCOUNTS), и если он не загрузится, упадёт
    только эта проверка, а не весь ревизор."""
    from app.services.pricing import PricingService

    free_by_rule = _sql_list({e.lower() for e in PricingService.COMP_ACCOUNTS} | {"admin@unbox.com"})
    return f"""
            SELECT b.id AS booking_id, coalesce(u.email, ue.email, b.user_id) AS email,
                   coalesce(u.name, ue.name) AS name,
                   substr(CAST(b.date AS TEXT), 1, 10) AS date, b.start_time, b.duration,
                   b.resource_id, b.payment_method, b.payment_status, b.applied_rule,
                   b.hours_deducted, b.charge_amount, b.base_price, b.created_by_name
            FROM booking b
            LEFT JOIN "user" u ON u.id = b.user_uuid
            -- старые брони без uuid: клиент по email
            LEFT JOIN "user" ue ON b.user_uuid IS NULL AND lower(ue.email) = lower(b.user_id)
            WHERE b.status = 'confirmed'
              AND coalesce(b.final_price, 0) < 0.01
              AND b.date >= :book_since
              AND coalesce(b.payment_status, '') <> 'waived'
              AND (
                    -- бронь за 0 ₾ не по абонементу, не бонусом и не служебная;
                    -- «Час в подарок» (BONUS_HOUR) — это бесплатный час клиента, погашен
                    (coalesce(b.payment_method, '') NOT IN ('subscription', 'bonus', 'service')
                     AND coalesce(b.applied_rule, '') <> 'BONUS_HOUR')
                    -- скрытая утечка: «по абонементу», оплачена, но не списано ни часов,
                    -- ни денег. charge_amount — снимок списанного: часы (нашлись в пуле)
                    -- или лари (абонемент исчерпан → с баланса); 0 — не списано ничего
                 OR (b.payment_method = 'subscription' AND b.payment_status = 'paid'
                     AND coalesce(b.hours_deducted, 0) < 0.01
                     AND coalesce(b.charge_amount, 0) < 0.01)
              )
              -- законно бесплатные по правилу движка цен и служебная запись владельца
              AND lower(coalesce(u.email, ue.email, b.user_id, '')) NOT IN ({free_by_rule})
              -- личная скидка 100 % (договорённость владельца)
              AND NOT (coalesce(u.pricing_system, ue.pricing_system, '') = 'personal'
                       AND coalesce(u.personal_discount_percent, ue.personal_discount_percent, 0) >= 100)
            ORDER BY b.date DESC, b.start_time
        """


def _repeat_income_by_day(session: Session, rows: list[dict], params: dict) -> list[dict]:
    """Клиент + сумма + валюта + календарный день по Тбилиси. В отчёт — только
    группы, где последнее внесение попало в окно с прошлого запуска (24 ч):
    так каждый повтор сообщается один раз."""
    since = params["since_24h"]
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        who = (_norm_id(r.get("credited_user_id")) or _norm_id(r.get("email_user_id"))
               or _norm_id(r.get("client_id")))
        at = _as_dt(r["created_at"])
        key = (who, round(float(r["amount"] or 0.0), 2), r.get("currency") or "GEL", (at + TBILISI).date())
        groups.setdefault(key, []).append({**r, "_at": at})
    out = []
    for (who, amount, currency, day), items in groups.items():
        if len(items) < 2 or max(it["_at"] for it in items) < since:
            continue
        entries = "; ".join(
            f"{it['_at'] + TBILISI:%H:%M} {_METHOD_RU.get(it.get('payment_method'), it.get('payment_method'))}"
            f" · {it.get('branch') or 'без филиала'} · {it.get('admin_name') or '?'}"
            for it in items
        )
        client = next((it["client_name"] for it in items if it.get("client_name")), who)
        out.append({"day": day.isoformat(), "client": client, "amount": amount,
                    "currency": currency, "times": len(items), "entries": entries})
    out.sort(key=lambda x: (x["day"], str(x["client"])), reverse=True)
    return out


def _user_label(session: Session, uid: str) -> tuple:
    from app.models.user import User
    try:
        u = session.get(User, UUID(uid))
    except (ValueError, TypeError):
        u = None
    return (u.email, u.name, None, None) if u else (uid, None, None, None)


def _weekly_rebate_recheck(session: Session, rows: list[dict], params: dict) -> list[dict]:
    """Ожидаемая недельная скидка за прошлую неделю против начисленной.

    Формула — копия цикла run_weekly_rebates (services/weekly_rebate.py): чистой
    функции расчёта там нет (расчёт и начисление в одном цикле, а dry_run
    пропускает уже начисленных клиентов — сравнить не с чем). Сторож
    guard_money_controls_2026_10 сверяет цикл в обоих файлах построчно и
    сравнивает результат с настоящим начислением.
    """
    from sqlmodel import select
    from app.models.balance_ledger import BalanceLedger
    from app.models.booking import Booking
    from app.models.user import User
    from app.models.weekly_rebate import WeeklyRebate
    from app.services import subscription_pool
    from app.services.pricing import PricingService
    from app.services.weekly_rebate import MIN_REBATE_GEL

    week_start = params["rebate_week"]

    # Журнал начислений (строка на клиента и неделю) с начала проверяемой недели.
    journal_rows = session.exec(
        select(WeeklyRebate).where(WeeklyRebate.created_at >= params["rebate_week_start"])
    ).all()
    journal = {_norm_id(j.user_id): round(float(j.amount or 0.0), 2)
               for j in journal_rows if j.week_start == week_start}
    marks: dict[str, list] = {}
    for j in journal_rows:
        marks.setdefault(_norm_id(j.user_id), []).append((_as_dt(j.created_at), j.week_start))

    # Начислено за эту неделю — строки ленты weekly_rebate. Строка относится к
    # неделе своей строки журнала (они пишутся вместе), поэтому запоздалый или
    # ручной прогон — хоть за эту неделю, хоть за прошлую — не путает счёт. Строка
    # без пары в журнале — к неделе по окну: понедельник после неё — следующий.
    credited: dict[str, float] = {}
    for r in rows:
        uid = _norm_id(r["user_id"])
        at = _as_dt(r["created_at"])
        near = [(abs((jt - at).total_seconds()), wk) for jt, wk in marks.get(uid, [])
                if abs((jt - at).total_seconds()) <= _JOURNAL_MATCH_SEC]
        if near:
            if min(near)[1] != week_start:
                continue
        elif not (params["rebate_credit_from"] <= at < params["rebate_credit_to"]):
            continue
        credited[uid] = round(credited.get(uid, 0.0) + float(r["delta"] or 0.0), 2)

    # Пакет НА ЭТОЙ неделе — по записи ленты «Пакет 16 ч на неделю 21.09–27.09»
    # (крон пакетов, services/weekly_package.py). Нынешний абонемент не годится:
    # пакет могли оформить или снять уже после недели.
    label = f"на неделю {week_start:%d.%m}–{week_start + timedelta(days=6):%d.%m}"
    package_week = {_norm_id(u) for u in session.exec(
        select(BalanceLedger.user_id).where(
            BalanceLedger.reason == "subscription_purchase",
            BalanceLedger.description.contains(label),
        )
    ).all()}

    start_dt = datetime(week_start.year, week_start.month, week_start.day)
    end_dt = start_dt + timedelta(days=7)
    pricing = PricingService(session)
    bookings = session.exec(
        select(Booking).where(
            Booking.status == "confirmed",
            Booking.date >= start_dt,
            Booking.date < end_dt,
        )
    ).all()
    by_user: dict[str, list] = {}
    for b in bookings:
        key = str(b.user_uuid) if b.user_uuid else (b.user_id or "")
        if not key:
            continue
        by_user.setdefault(key, []).append(b)

    expected: dict[str, float] = {}
    who: dict[str, tuple] = {}
    for user_bookings in by_user.values():
        user = None
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
        uid = _norm_id(user.id)
        if uid in expected:
            continue  # брони того же клиента и под uuid, и под email — начислено один раз
        total_hours = sum(b.duration / 60.0 for b in user_bookings)
        tier = PricingService.weekly_tier_percent(total_hours)
        who.setdefault(uid, (user.email, user.name, round(total_hours, 1), tier))
        # Неделя была пакетной — скидки за объём нет.
        if uid in package_week:
            continue
        # Пакет сейчас, а на той неделе — нет: его могли оформить уже после
        # недели. Крон скидки смотрит на абонемент в момент начисления, поэтому
        # без начисления ждём 0, а начисленное сверяем с формулой.
        if subscription_pool.get(user.subscription, "weekly_package", False) and credited.get(uid, 0.0) < 0.01:
            continue
        if tier == 0:
            continue

        rebate = 0.0
        for b in user_bookings:
            if b.payment_method != "balance":
                continue
            if b.payment_status in ("pending", "waived"):
                continue
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
                continue
            base = breakdown.discountable_base or 0.0
            if base <= 0:
                continue
            duration_pct = int(breakdown.discount_percent or 0)
            weekly_extra = base * (max(0, tier - duration_pct) / 100.0)
            recomputed = float(breakdown.final_price or 0.0)
            correct_at_T = recomputed - weekly_extra
            stored = float(b.final_price or 0.0)
            rebate += max(0.0, stored - correct_at_T)

        rebate = round(rebate, 2)
        if rebate < MIN_REBATE_GEL:
            continue
        expected[uid] = rebate

    out = []
    for uid in sorted(set(expected) | set(credited) | set(journal)):
        exp = expected.get(uid, 0.0)
        got = credited.get(uid, 0.0)
        jr = journal.get(uid)
        if abs(exp - got) <= 0.01 and (jr is None or abs(exp - jr) <= 0.01):
            continue
        email, name, hours, tier = who.get(uid) or _user_label(session, uid)
        out.append({
            "week_start": week_start.isoformat(), "email": email, "name": name,
            "hours": hours, "tier_percent": tier,
            "expected": exp, "credited": got, "journal": jr if jr is not None else 0.0,
        })
    return out


CHECKS += [
    Check(
        key="income_without_branch",
        title="Приход денег без филиала",
        why=(
            "Остаток кассы (и сверка на закрытии смены) считается по филиалу — Unbox One "
            "или Unbox Uni. Приход без филиала не попадает в остаток НИ ОДНОЙ кассы: деньги "
            "в ящике есть, а на сайте их нет, на закрытии смены они всплывут «лишними» и "
            "уйдут в корректировку. Что делать: открыть операцию в Финансах и проставить "
            "филиал, где взяли деньги. Смотрим последние 30 дней; корректировки "
            "(adjustment, выравнивание кассы) не в счёт. Перевод между картами без филиала "
            "(«Перевод: Карта BOG → Карта TBC», пара расход+приход в один день) — тоже не в "
            "счёт: банковский счёт общий, выручки в нём нет. Перевод В НАЛИЧНЫЕ без филиала "
            "показываем — эти деньги легли в ящик конкретного филиала."
        ),
        sql="""
            SELECT t.id, t.date, t.amount, t.currency, t.payment_method, t.category_id,
                   t.client_name, t.admin_name, t.description
            FROM cashbox_transactions t
            WHERE t.type = 'income'
              AND t.payment_method <> 'adjustment'
              AND coalesce(t.category_id, '') <> 'cash_reconciliation'
              AND (t.branch IS NULL OR trim(t.branch) = '')
              AND (t.date >= :since_30d OR t.created_at >= :since_30d)
            ORDER BY t.date DESC
        """,
        post=_without_card_transfers,
    ),
    Check(
        key="cash_expense_without_branch",
        title="Расход наличных без филиала",
        why=(
            "Наличные лежат в ящике конкретного филиала. Расход наличными без филиала не "
            "вычитается из остатка НИ ОДНОЙ кассы: денег в ящике уже нет, а на сайте они "
            "есть — на закрытии смены это всплывёт недостачей и уйдёт в корректировку. Так "
            "выглядит и «Перевод: Наличные → Карта» без филиала. Что делать: открыть "
            "операцию в Финансах и проставить филиал, из чьего ящика взяли деньги. Смотрим "
            "последние 30 дней; выравнивание кассы (cash_reconciliation) не в счёт."
        ),
        sql="""
            SELECT t.id, substr(CAST(t.date AS TEXT), 1, 16) AS date, t.amount, t.currency,
                   t.category_id, t.admin_name, t.description
            FROM cashbox_transactions t
            WHERE t.type = 'expense'
              AND t.payment_method = 'cash'
              AND coalesce(t.category_id, '') <> 'cash_reconciliation'
              AND (t.branch IS NULL OR trim(t.branch) = '')
              AND (t.date >= :since_30d OR t.created_at >= :since_30d)
            ORDER BY t.date DESC
        """,
    ),
    Check(
        key="free_booking",
        title="Бронь за 0 ₾ — кабинет уходит бесплатно",
        why=(
            "Подтверждённая бронь (будущая или за последние 30 дней) стоит 0 ₾, хотя она "
            "не по абонементу, не бонусом, не служебная (уборка/обслуживание) и штраф по ней "
            "не прощали. Так выглядела утечка 1630 ₾ (ярлык «баланс» при цене абонемента), "
            "и так же выглядит ручная цена 0 ₾. Сюда же — бронь «по абонементу», уже "
            "оплаченная, с которой не списали ни часов, ни денег. Законно бесплатные не "
            "показываем: comp-аккаунты движка цен (владелец и сотрудники из его списка), "
            "служебная запись admin@unbox.com, клиенты с личной скидкой 100 % "
            "(договорённость владельца, в т.ч. служебный аккаунт центра) и «Час в подарок» "
            "(бесплатный час клиента погашен). Что делать: открыть бронь — если бесплатно "
            "по ошибке, поставить цену; если по договорённости — оформить её личной скидкой "
            "или бонусом, чтобы бронь ушла из списка."
        ),
        sql=_free_booking_sql,
    ),
    Check(
        key="weekly_rebate_recheck",
        title="Недельная скидка за прошлую неделю начислена не той суммой",
        why=(
            "Независимая перепроверка: ревизор заново считает скидку за прошлую неделю по "
            "правилам services/weekly_rebate.py (тот же движок цен) и сравнивает с тем, что "
            "реально пришло клиенту на баланс (лента balance_ledger, reason='weekly_rebate'; "
            "строка ленты относится к неделе своей строки журнала weekly_rebates, без "
            "журнала — к понедельнику после недели) и с журналом. Разница больше 0,01 ₾ — "
            "крон не прошёл, начислил дважды или не ту сумму; либо бронь недели отменили "
            "или переоценили уже после начисления. Неделя с недельным пакетом (запись "
            "ленты «Пакет … на неделю …») скидки не получает. Что делать: сверить брони "
            "клиента за неделю и ленту баланса; недостающее или лишнее поправить "
            "корректировкой баланса."
        ),
        sql="""
            SELECT l.user_id, l.delta, l.created_at
            FROM balance_ledger l
            WHERE l.reason = 'weekly_rebate'
              AND l.created_at >= :rebate_week_start
        """,
        post=_weekly_rebate_recheck,
    ),
    Check(
        key="repeat_income_same_day",
        title="Повторный приход за день: тому же клиенту та же сумма дважды",
        info=True,
        why=(
            "Не баг кода, а сигнал бизнесу: с 02.10 сайт при повторном приходе спрашивает "
            "«это второй платёж?», и админ может подтвердить. Здесь — такие пары за сутки "
            "с прошлого запуска (тот же клиент, та же сумма и валюта, тот же календарный "
            "день по Тбилиси), в том числе подтверждённые; каждая — один раз. Допы к броне "
            "(«Допы к броне», оплата на месте) не в счёт: два одинаковых дозаказа — не "
            "дубль. Что делать: если клиент платил один раз — удалить лишнюю запись в "
            "Финансах (зачисление на баланс откатится само)."
        ),
        sql=f"""
            SELECT t.id, t.created_at, t.amount, t.currency, t.payment_method, t.branch,
                   t.admin_name, t.client_name, t.client_id, t.credited_user_id,
                   u.id AS email_user_id
            FROM cashbox_transactions t
            LEFT JOIN "user" u ON u.email = t.client_id
            WHERE t.type = 'income'
              AND t.payment_method <> 'adjustment'
              AND coalesce(t.category_id, '') <> 'cash_reconciliation'
              AND substr(coalesce(t.description, ''), 1, {len(_EXTRAS_PREFIX)}) <> '{_EXTRAS_PREFIX}'
              AND coalesce(t.credited_user_id, t.client_id, '') <> ''
              AND t.created_at >= :repeat_from
            ORDER BY t.created_at
        """,
        post=_repeat_income_by_day,
    ),
    Check(
        key="shift_discrepancies_day",
        title="Расхождения кассы на закрытии смен за сутки (больше 5 ₾)",
        info=True,
        why=(
            "Не баг кода, а сигнал бизнесу: при закрытии смены пересчитанные деньги "
            "разошлись с остатком на сайте больше чем на 5 ₾ (порог владельца), и сайт "
            "выровнял кассу корректирующей операцией (cash_reconciliation). О каждом таком "
            "закрытии владелец сразу получает сообщение в Telegram; здесь — сводка за сутки "
            "с прошлого запуска, каждое закрытие один раз. Что делать: спросить админа "
            "смены, откуда разница (сдача, приход или расход без записи)."
        ),
        sql="""
            SELECT substr(CAST(sr.shift_end AS TEXT), 1, 16) AS shift_end_utc, sr.branch,
                   sr.admin_name, sr.expected_balance AS expected, sr.actual_balance AS actual,
                   sr.discrepancy, sr.notes
            FROM shift_reports sr
            WHERE sr.shift_end >= :since_24h
              AND abs(sr.discrepancy) > :shift_alert_gel
            ORDER BY sr.shift_end DESC
        """,
    ),
]


def _send_telegram_alert(violations: dict[str, list], titles: dict[str, str],
                         info: Optional[dict[str, list]] = None) -> None:
    """Шлём владельцу сводку расхождений. Тихо выходим, если бот не настроен.
    Информационные проверки — отдельной строкой «для сведения»."""
    try:
        from app.core.config import settings
        from app.services.telegram import telegram_service
        chat_id = settings.TELEGRAM_OWNER_CHAT_ID or settings.TELEGRAM_ADMIN_CHAT_ID
        if not chat_id:
            return
        head = "расхождения" if violations else "расхождений нет"
        lines = [f"🔎 <b>Ревизор кассы/денег — {head}</b>", ""]
        for key, rows in violations.items():
            if rows and "ошибка_проверки" in rows[0]:
                lines.append(f"• {titles.get(key, key)}: <b>проверка не выполнилась</b> — смотреть лог")
            else:
                lines.append(f"• {titles.get(key, key)}: <b>{len(rows)}</b>")
        if info:
            if violations:
                lines.append("")
            parts = "; ".join(f"{titles.get(k, k)} — {len(v)}" for k, v in info.items())
            lines.append(f"ℹ️ Для сведения: <b>{sum(len(v) for v in info.values())}</b> ({parts})")
        lines.append("")
        lines.append("Проверить: <code>money_audit.py</code> на сервере.")
        telegram_service.send_message(chat_id=str(chat_id), text="\n".join(lines))
    except Exception as exc:  # noqa: BLE001
        print(f"[money_audit] не смог отправить алерт: {exc}", file=sys.stderr)


def _needs_params(check: Check) -> bool:
    """Нужны ли проверке окна времени (у первых десяти их нет)."""
    return callable(check.sql) or check.post is not None or bool(text(check.sql).compile().params)


def run_check(session: Session, check: Check, params: dict[str, Any]) -> list[dict[str, Any]]:
    """Строки одной проверки. SQL получает только те параметры окна, которые в
    нём есть (у первых десяти проверок их нет вовсе)."""
    stmt = text(check.sql() if callable(check.sql) else check.sql)
    wanted = {k: v for k, v in params.items() if k in stmt.compile().params}
    rows = [dict(r) for r in session.exec(stmt, params=wanted).mappings().all()]
    if check.post is not None:
        rows = check.post(session, rows, params)
    return rows


def _failed(rows: list) -> bool:
    return bool(rows) and "ошибка_проверки" in rows[0]


def run(as_json: bool, alert: bool = False) -> int:
    results: dict[str, list[dict[str, Any]]] = {}

    # Окна новых проверок. Не посчитались — новые помечаются «не выполнилась»,
    # первые десять (им окна не нужны) идут как всегда.
    try:
        params: Optional[dict[str, Any]] = audit_params()
        params_error = ""
    except Exception as exc:  # noqa: BLE001
        params, params_error = None, f"{type(exc).__name__}: {exc}"

    with Session(engine) as session:
        # READ ONLY на уровне транзакции: ревизор физически не может ничего испортить.
        session.exec(text("SET TRANSACTION READ ONLY"))
        for check in CHECKS:
            if params is None and _needs_params(check):
                results[check.key] = [{"ошибка_проверки": f"окна времени не посчитались: {params_error}"[:300]}]
                continue
            # Каждая проверка — в своей точке сохранения: если одна упадёт (новые
            # досчитывают в Python), остальные всё равно выполнятся, а сбой будет
            # виден в отчёте и в Telegram как строка этой проверки.
            try:
                with session.begin_nested():
                    results[check.key] = run_check(session, check, params or {})
            except Exception as exc:  # noqa: BLE001
                results[check.key] = [{"ошибка_проверки": f"{type(exc).__name__}: {exc}"[:300]}]

    # Информационные — отдельно: не расхождения, на код возврата и счётчик не
    # влияют. Упавшая информационная проверка — уже не сведение, а сбой: в расхождения.
    main = [c for c in CHECKS if not c.info or _failed(results[c.key])]
    side = [c for c in CHECKS if c.info and not _failed(results[c.key])]
    violations = {c.key: results[c.key] for c in main if results[c.key]}
    info = {c.key: results[c.key] for c in side if results[c.key]}

    # Алерт в Телеграм — только когда есть что сказать (иначе тишина).
    if alert and (violations or info):
        _send_telegram_alert(violations, {c.key: c.title for c in CHECKS}, info)

    if as_json:
        print(json.dumps({
            "ok": not violations,
            "violations": {k: len(v) for k, v in violations.items()},
            "details": violations,
            "info": {k: len(v) for k, v in info.items()},
            "info_details": info,
        }, ensure_ascii=False, default=str, indent=2))
        return 1 if violations else 0

    print("═" * 72)
    print("РЕВИЗОР ДЕНЕГ — Unbox CRM")
    print("═" * 72)

    def _show(check: Check, rows: list) -> None:
        print(f"     {check.why}")
        print()
        for r in rows[:10]:
            print("     " + "  ".join(f"{k}={v}" for k, v in r.items()))
        if len(rows) > 10:
            print(f"     … и ещё {len(rows) - 10}")

    for check in main:
        rows = results[check.key]
        if not rows:
            print(f"\n  ✓  {check.title}")
            continue
        print(f"\n  ✗  {check.title.upper()}  —  строк: {len(rows)}")
        _show(check, rows)

    if side:
        print("\n" + "─" * 72)
        print("ДЛЯ СВЕДЕНИЯ — не расхождения, за сутки с прошлого запуска")
        print("─" * 72)
        for check in side:
            rows = results[check.key]
            if not rows:
                print(f"\n  ·  {check.title}: нет")
                continue
            print(f"\n  ·  {check.title}  —  {len(rows)}")
            _show(check, rows)

    print("\n" + "═" * 72)
    if violations:
        total = sum(len(v) for v in violations.values())
        print(f"РАСХОЖДЕНИЙ: {total} в {len(violations)} проверк(ах) из {len(main)}")
    else:
        print(f"ВСЁ СХОДИТСЯ — {len(main)} проверок пройдено")
    if info:
        print(f"Для сведения: {sum(len(v) for v in info.values())}")
    print("═" * 72)
    return 1 if violations else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Инварианты денег (только чтение)")
    ap.add_argument("--json", action="store_true", help="машиночитаемый вывод")
    ap.add_argument("--alert", action="store_true", help="слать сводку в Телеграм при расхождениях")
    args = ap.parse_args()
    sys.exit(run(args.json, alert=args.alert))
