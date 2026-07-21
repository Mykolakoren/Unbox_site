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
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.db.session import engine  # noqa: E402


class Check:
    """Одна проверка: заголовок, SQL и человеческое объяснение, что это значит."""

    def __init__(self, key: str, title: str, sql: str, why: str):
        self.key = key
        self.title = title
        self.sql = sql
        self.why = why


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
            "remaining_hours + used_hours обязано равняться total_hours. Пул пишется в "
            "двух диалектах (snake_case с бэкенда, camelCase из UI) — рассинхрон уже "
            "приводил к двойному списанию: админ пополнял camelCase, а крон читал snake "
            "и не видел часов."
        ),
        sql="""
            SELECT u.email,
                   coalesce(u.subscription->>'total_hours',     u.subscription->>'totalHours')     AS total,
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


def _send_telegram_alert(violations: dict[str, list], titles: dict[str, str]) -> None:
    """Шлём владельцу сводку расхождений. Тихо выходим, если бот не настроен."""
    try:
        from app.core.config import settings
        from app.services.telegram import telegram_service
        chat_id = settings.TELEGRAM_OWNER_CHAT_ID or settings.TELEGRAM_ADMIN_CHAT_ID
        if not chat_id:
            return
        lines = ["🔎 <b>Ревизор кассы/денег — расхождения</b>", ""]
        for key, rows in violations.items():
            lines.append(f"• {titles.get(key, key)}: <b>{len(rows)}</b>")
        lines.append("")
        lines.append("Проверить: <code>money_audit.py</code> на сервере.")
        telegram_service.send_message(chat_id=str(chat_id), text="\n".join(lines))
    except Exception as exc:  # noqa: BLE001
        print(f"[money_audit] не смог отправить алерт: {exc}", file=sys.stderr)


def run(as_json: bool, alert: bool = False) -> int:
    results: dict[str, list[dict[str, Any]]] = {}

    with Session(engine) as session:
        # READ ONLY на уровне транзакции: ревизор физически не может ничего испортить.
        session.exec(text("SET TRANSACTION READ ONLY"))
        for check in CHECKS:
            rows = session.exec(text(check.sql)).mappings().all()
            results[check.key] = [dict(r) for r in rows]

    violations = {k: v for k, v in results.items() if v}

    # Алерт в Телеграм — только когда есть что сказать (иначе тишина).
    if alert and violations:
        _send_telegram_alert(violations, {c.key: c.title for c in CHECKS})

    if as_json:
        print(json.dumps({
            "ok": not violations,
            "violations": {k: len(v) for k, v in violations.items()},
            "details": violations,
        }, ensure_ascii=False, default=str, indent=2))
        return 1 if violations else 0

    print("═" * 72)
    print("РЕВИЗОР ДЕНЕГ — Unbox CRM")
    print("═" * 72)

    for check in CHECKS:
        rows = results[check.key]
        if not rows:
            print(f"\n  ✓  {check.title}")
            continue
        print(f"\n  ✗  {check.title.upper()}  —  строк: {len(rows)}")
        print(f"     {check.why}")
        print()
        for r in rows[:10]:
            print("     " + "  ".join(f"{k}={v}" for k, v in r.items()))
        if len(rows) > 10:
            print(f"     … и ещё {len(rows) - 10}")

    print("\n" + "═" * 72)
    if violations:
        total = sum(len(v) for v in violations.values())
        print(f"РАСХОЖДЕНИЙ: {total} в {len(violations)} проверк(ах) из {len(CHECKS)}")
    else:
        print(f"ВСЁ СХОДИТСЯ — {len(CHECKS)} проверок пройдено")
    print("═" * 72)
    return 1 if violations else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Инварианты денег (только чтение)")
    ap.add_argument("--json", action="store_true", help="машиночитаемый вывод")
    ap.add_argument("--alert", action="store_true", help="слать сводку в Телеграм при расхождениях")
    args = ap.parse_args()
    sys.exit(run(args.json, alert=args.alert))
