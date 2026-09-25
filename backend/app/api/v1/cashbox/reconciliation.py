"""Выгрузка для сверки с таблицей админов «Аренда 2026 Unbox» (Excel).

Просьба Лизы 20.09 / владелец «делай» 24.09. Админы ведут свою Google-таблицу
(клиент → брони → нал/безнал → сальдо) и сверяют её с сайтом вручную. Эта
выгрузка даёт те же разрезы с сайта за месяц — только чтение, ничего не пишет:

  • «Сводка» — по каждому клиенту: баланс на начало месяца, внесено наличными
    / TBC / BOG, списано за брони, возвраты, допы, недельная скидка, прочее,
    баланс на конец месяца и сейчас; проверка «начало + движения = конец».
  • «Брони» — брони месяца в колонках, похожих на таблицу админов.
  • «Операции» — каждая операция по балансу (что, сколько, кто провёл).
  • «Как сверять» — короткая инструкция.

Время — Тбилиси (UTC+4): в базе created_at хранится в UTC.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text
from sqlmodel import Session, select

from app.api import deps
from app.api.v1.cashbox import require_reports
from app.models.balance_ledger import BalanceLedger
from app.models.booking import Booking
from app.models.cashbox_transaction import CashboxTransaction
from app.models.user import User
from app.services.xlsx_lite import build_xlsx

router = APIRouter()

TZ = timedelta(hours=4)  # Тбилиси, без перехода на летнее время

REASON_LABELS = {
    "topup": "Пополнение",
    "topup_reversal": "Отмена пополнения",
    "booking_charge": "Списание за бронь",
    "booking_charge_revert": "Отмена списания",
    "booking_refund": "Возврат за бронь",
    "reschedule_diff": "Перенос: разница в цене",
    "extras_charge": "Допы",
    "extend_charge": "Продление",
    "price_change": "Изменение цены брони",
    "weekly_rebate": "Недельная скидка (возврат)",
    "subscription_purchase": "Покупка абонемента",
    "booking_to_subscription": "Бронь переведена на абонемент",
    "consecutive_recompute": "Перерасчёт скидки за часы подряд",
    "correction": "Корректировка",
    "merge": "Склейка профилей",
}
METHOD_LABELS = {"cash": "наличные", "card_tbc": "TBC", "card_bog": "BOG", "adjustment": "корректировка"}
RULE_LABELS = {
    "PERSONAL_DISCOUNT": "Личная скидка",
    "WEEKLY_PROGRESSIVE": "Недельная (накопленные часы)",
    "CONSECUTIVE_HOURS": "За длительность брони",
    "MANUAL_OVERRIDE": "Ручная цена",
    "SUBSCRIPTION": "Абонемент",
    "SUBSCRIPTION_DISCOUNT": "Скидка по абонементу",
    "HOT_BOOKING": "Горячая бронь",
    "BONUS_HOUR": "Час в подарок",
    "COMP_ACCOUNT": "Служебная (бесплатно)",
}
PAY_METHOD = {"balance": "Баланс", "subscription": "Абонемент (часы)", "bonus": "Бонусный час"}
PAY_STATUS = {"pending": "спишется за сутки до начала", "paid": "списано", "waived": "штраф снят"}
WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]

# Колонки «Сводки» по типу операции.
BUCKETS = ["cash", "card_tbc", "card_bog", "topup_other", "charge", "refund", "extras",
           "rebate", "subscription", "other"]


def _bucket(reason: str, method: str | None) -> str:
    if reason in ("topup", "topup_reversal"):
        return method if method in ("cash", "card_tbc", "card_bog") else "topup_other"
    if reason in ("booking_charge", "booking_charge_revert", "reschedule_diff", "price_change",
                  "consecutive_recompute", "booking_to_subscription"):
        return "charge"
    if reason == "booking_refund":
        return "refund"
    if reason in ("extras_charge", "extend_charge"):
        return "extras"
    if reason == "weekly_rebate":
        return "rebate"
    if reason == "subscription_purchase":
        return "subscription"
    return "other"


@router.get("/reconciliation.xlsx")
def reconciliation_export(
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="Месяц YYYY-MM"),
    session: Session = Depends(deps.get_session),
    # Сводка по ВСЕМ клиентам — право отчётов, как у остальных финансовых
    # отчётов (require_reports), а не любое кассовое право.
    current_user: User = Depends(require_reports),
) -> Response:
    y, m = map(int, month.split("-"))
    local_start = datetime(y, m, 1)
    local_end = datetime(y + (m == 12), m % 12 + 1, 1)
    utc_start, utc_end = local_start - TZ, local_end - TZ

    users = session.exec(select(User)).all()
    by_id = {str(u.id): u for u in users}
    by_email = {u.email: u for u in users}

    ledger = session.exec(
        select(BalanceLedger)
        .where(BalanceLedger.created_at >= utc_start, BalanceLedger.created_at < utc_end)
        .order_by(BalanceLedger.created_at)
    ).all()

    # Способ оплаты пополнений — из кассовой проводки, на которую ссылается запись.
    tx_ids = [r.ref_id for r in ledger if r.ref_type == "cashbox_tx" and r.ref_id]
    tx_method = {}
    if tx_ids:
        for tx in session.exec(select(CashboxTransaction).where(CashboxTransaction.id.in_(tx_ids))).all():
            tx_method[tx.id] = tx.payment_method

    # Баланс на начало месяца = остаток после последней операции до месяца.
    start_bal = {
        row[0]: float(row[1])
        for row in session.execute(text(
            "SELECT DISTINCT ON (user_id) user_id, balance_after FROM balance_ledger "
            "WHERE created_at < :s ORDER BY user_id, created_at DESC"
        ), {"s": utc_start}).all()
    }

    bookings = session.exec(
        select(Booking)
        .where(Booking.date >= local_start, Booking.date < local_end, Booking.status == "confirmed")
        .order_by(Booking.date, Booking.start_time)
    ).all()

    res_names = {
        row[0]: row[1]
        for row in session.execute(text("SELECT id, name FROM resource")).all()
    }

    # ── Сводка ────────────────────────────────────────────────────────────
    sums: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    end_bal: dict[str, float] = {}
    for r in ledger:
        method = tx_method.get(r.ref_id) if r.ref_type == "cashbox_tx" else None
        sums[r.user_id][_bucket(r.reason, method)] += float(r.delta)
        end_bal[r.user_id] = float(r.balance_after)

    booked_hours: dict[str, float] = defaultdict(float)
    for b in bookings:
        u = by_id.get(str(b.user_uuid)) if b.user_uuid else None
        u = u or by_email.get(b.user_id)
        if u and (b.payment_method or "") != "service":
            booked_hours[str(u.id)] += (b.duration or 0) / 60.0

    client_ids = set(sums) | set(booked_hours)
    summary = [[
        "Клиент", "Email", "Часов за месяц", "На начало месяца, ₾", "Внесено наличными", "Внесено TBC",
        "Внесено BOG", "Прочие зачисления", "Списано за брони", "Возвраты за брони", "Допы и продления",
        "Недельная скидка", "Абонементы", "Прочее", "На конец месяца, ₾", "Баланс сейчас, ₾", "Проверка",
    ]]
    totals = defaultdict(float)
    rows = []
    for uid in client_ids:
        u = by_id.get(uid)
        if u is None or (u.email or "").startswith("admin@"):
            continue
        s0 = start_bal.get(uid, 0.0)
        mv = sums.get(uid, {})
        s1 = end_bal.get(uid, s0)
        moved = sum(mv.values())
        check = "ок" if abs(s0 + moved - s1) < 0.01 else f"расхождение {round(s0 + moved - s1, 2)}"
        row = [u.name or u.email, u.email, round(booked_hours.get(uid, 0.0), 1), s0] + \
              [mv.get(k, 0.0) for k in BUCKETS] + [s1, float(u.balance or 0.0), check]
        for k in BUCKETS:
            totals[k] += mv.get(k, 0.0)
        totals["h"] += booked_hours.get(uid, 0.0)
        rows.append(row)
    rows.sort(key=lambda r: (r[0] or "").lower())
    summary += rows
    summary.append(["ИТОГО", "", round(totals["h"], 1), ""] + [round(totals[k], 2) for k in BUCKETS] + ["", "", ""])

    # ── Брони ─────────────────────────────────────────────────────────────
    booking_rows = [[
        "Дата", "День", "Клиент", "Кабинет", "Начало", "Часы", "Цена без скидки, ₾", "Скидка, ₾",
        "Основание скидки", "Допы", "Итого, ₾", "Чем оплачено", "Оплата", "Кто создал",
    ]]
    for b in bookings:
        if (b.payment_method or "") == "service":
            continue
        u = by_id.get(str(b.user_uuid)) if b.user_uuid else None
        u = u or by_email.get(b.user_id)
        rule = b.applied_rule or ""
        booking_rows.append([
            b.date.strftime("%d.%m.%Y"), WEEKDAYS[b.date.weekday()],
            (u.name if u else b.user_id) or b.user_id,
            res_names.get(b.resource_id, b.resource_id), b.start_time, round((b.duration or 0) / 60.0, 2),
            float(b.base_price) if b.base_price is not None else float(b.final_price or 0.0),
            float(b.discount_amount or 0.0),
            RULE_LABELS.get(rule, "" if rule in ("", "NONE") else rule),
            ", ".join(b.extras or []),
            float(b.final_price or 0.0) if b.payment_method != "subscription" else 0.0,
            PAY_METHOD.get(b.payment_method or "", b.payment_method or ""),
            PAY_STATUS.get(b.payment_status or "", "списано" if b.payment_status is None else b.payment_status),
            b.created_by_name or "",
        ])

    # ── Операции ──────────────────────────────────────────────────────────
    ops = [["Дата и время (Тбилиси)", "Клиент", "Сумма, ₾", "Остаток после, ₾", "Операция",
            "Способ", "Описание", "Кто провёл"]]
    for r in ledger:
        u = by_id.get(r.user_id)
        if u is not None and (u.email or "").startswith("admin@"):
            continue
        method = tx_method.get(r.ref_id) if r.ref_type == "cashbox_tx" else None
        ops.append([
            (r.created_at + TZ).strftime("%d.%m.%Y %H:%M"),
            (u.name if u else r.user_id) or r.user_id,
            float(r.delta), float(r.balance_after),
            REASON_LABELS.get(r.reason, r.reason),
            METHOD_LABELS.get(method or "", method or ""),
            r.description or "", r.actor_name or ("система" if not r.actor_id else ""),
        ])

    howto = [
        ["Как сверять с таблицей «Аренда 2026 Unbox»"],
        [f"Месяц: {local_start.strftime('%m.%Y')}. Выгружено: {(datetime.utcnow() + TZ).strftime('%d.%m.%Y %H:%M')} (Тбилиси)."],
        ["1. Лист «Сводка»: одна строка на клиента. «На начало» + все движения = «На конец» — колонка «Проверка» должна быть «ок»."],
        ["2. Наличные / TBC / BOG — сколько клиент внёс через кассу в этом месяце. Сверяйте с колонками «Нал» и «Безнал» вашей таблицы."],
        ["3. «Списано за брони» — отрицательное число: сколько списано с баланса за брони (со всеми скидками в моменте)."],
        ["4. «Недельная скидка» — кредит, начисленный в понедельник за прошлую неделю. В вашей таблице он обычно стоит в «Скидке» конкретных строк."],
        ["5. Брони по абонементу оплачиваются часами — в «Итого» у них 0 ₾, деньги прошли при покупке абонемента."],
        ["6. Строки вашей таблицы вида «Кристина Ропель [название группы]» — это один клиент сайта «Кристина Ропель». То же для «Ольга Корень [группа]»."],
        ["7. Если не сходится — найдите клиента на листе «Операции»: там каждое движение с датой и тем, кто его провёл."],
    ]

    data = build_xlsx([
        ("Сводка", summary, [28, 28, 10, 14, 13, 12, 12, 13, 14, 13, 13, 13, 12, 10, 15, 14, 16]),
        ("Брони", booking_rows, [11, 5, 26, 16, 8, 7, 12, 10, 24, 18, 10, 16, 24, 14]),
        ("Операции", ops, [17, 26, 10, 12, 26, 12, 50, 18]),
        ("Как сверять", howto, [120]),
    ])
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="unbox-sverka-{month}.xlsx"'},
    )
