"""Недельный пакет часов: фиксированная плата в неделю за N часов, остаток сгорает.

Кейс Галины Белостоцкой (владелец 29.09): она платит 160 ₾ в неделю за 16 часов.
Админы принимали эти 160 ₾ как пополнение баланса, а часы брались из общего
пула абонемента — деньги копились на балансе (+663 ₾), хотя это была оплата пакета.

Пакет — это обычный абонемент с доп. полями:
  weekly_package = True, weekly_hours = 16, weekly_price = 160,
  package_week   = ISO-дата понедельника недели, за которую пул сейчас выдан.

Раз в неделю (вс 00:00 по Тбилиси, крон run_weekly_packages.py) roll_weekly_packages:
  • списывает weekly_price с баланса (subscription_purchase). Админы, как и раньше,
    принимают оплату и пополняют баланс — при еженедельной оплате баланс ≈ 0,
    а если клиент не заплатил, сразу виден долг;
  • выдаёт пул на новую неделю: total = remaining = weekly_hours, used = 0,
    срок — конец недели. Неиспользованные часы прошлой недели сгорают.

Почему вс 00:00: часы списываются за 24 ч до брони, значит брони недели W
(пн 00:00 – вс 24:00) списываются с вс 00:00 перед W до вс 00:00 в конце W —
ровно окно, пока действует пул W. Часы сверх пакета — деньгами по обычной цене.

Идемпотентно по package_week. Пакет на паузе пропускается (оплата не списывается).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlmodel import Session, select

from app.models.user import User
from app.services import subscription_pool, wallet

TZ = timedelta(hours=4)  # Тбилиси


def is_weekly_package(sub: Optional[dict]) -> bool:
    return bool(subscription_pool.get(sub, "weekly_package", False))


def target_week_start(now_utc: datetime) -> date:
    """Понедельник недели, на которую надо выдать пул. Запуск в вс 00:00 → завтрашний пн;
    опоздавший запуск в пн/вт → тот же пн (догоняем текущую неделю)."""
    ahead = (now_utc + TZ + timedelta(days=1)).date()
    return ahead - timedelta(days=ahead.weekday())


def package_fields(week_start: date, hours: float, used: float = 0.0) -> dict:
    """Поля пула на неделю week_start. Срок — вс 23:59:59 по Тбилиси (в UTC):
    новая неделя выдаётся раньше, в вс 00:00, так что это сутки запаса на случай,
    если крон опоздает."""
    week_end_local = datetime.combine(week_start + timedelta(days=6), time(23, 59, 59))
    return {
        "total_hours": float(hours),
        "bonus_hours": 0.0,  # иначе remaining+used ≠ total+bonus (бонус старого плана)
        "remaining_hours": max(0.0, float(hours) - float(used)),
        "used_hours": float(used),
        "expiry_date": (week_end_local - TZ).isoformat(),
        "package_week": week_start.isoformat(),
        "status": "active",
    }


def roll_weekly_packages(session: Session, now_utc: Optional[datetime] = None, dry_run: bool = True) -> list[dict]:
    """Выдать пакеты на неделю. Каждый клиент — под блокировкой строки и со своим
    commit: два запуска внахлёст (повтор руками, задвоенный крон) не спишут
    оплату дважды — второй увидит уже записанный package_week и пропустит."""
    now_utc = now_utc or datetime.utcnow()
    wk = target_week_start(now_utc)
    out: list[dict] = []
    ids = [u.id for u in session.exec(select(User)).all() if u.subscription and is_weekly_package(u.subscription)]
    for uid in ids:
        u = session.exec(select(User).where(User.id == uid).with_for_update()).one()
        sub = u.subscription
        row = {"email": u.email, "name": u.name, "week": wk.isoformat()}
        if not is_weekly_package(sub):
            session.rollback()
            continue
        if subscription_pool.get(sub, "is_frozen", False):
            session.rollback()
            out.append({**row, "action": "skip_frozen"})
            continue
        if subscription_pool.get(sub, "package_week") == wk.isoformat():
            session.rollback()
            out.append({**row, "action": "already"})
            continue
        hours = subscription_pool.get_float(sub, "weekly_hours")
        price = subscription_pool.get_float(sub, "weekly_price")
        row.update(action="rolled", hours=hours, price=price,
                   burned_hours=subscription_pool.get_float(sub, "remaining_hours"),
                   balance_before=float(u.balance or 0.0))
        if dry_run:
            row["balance_after"] = round(float(u.balance or 0.0) - price, 2)
            session.rollback()
        else:
            if price > 0:
                wallet.debit(
                    session, u, price, reason="subscription_purchase",
                    description=f"Пакет {hours:g} ч на неделю {wk:%d.%m}–{wk + timedelta(days=6):%d.%m}",
                    ref_type="user", ref_id=str(u.id), actor_name="Недельный пакет",
                )
            u.subscription = subscription_pool.update(sub, **package_fields(wk, hours))
            session.add(u)
            session.commit()
            row["balance_after"] = float(u.balance or 0.0)
        out.append(row)
    return out
