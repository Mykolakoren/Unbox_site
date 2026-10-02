"""Касса — «Итоги дня» и «Недельные скидки» (решение владельца 02.10).

Админы ведут Excel и по понедельникам пересчитывают недельную скидку вручную.
Эти экраны дают те же цифры с сайта — ТОЛЬКО ЧТЕНИЕ, ничего не пишут.
Все числа считает services/day_summary.py (та же функция идёт в сводку Telegram).

Права — require_reports, как у выгрузки для сверки и отчётов по сменам: здесь
итоги по всем клиентам (должники) и смены, а не одно кассовое действие.
"""
from datetime import date as date_cls, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, col, select

from app.api.v1.cashbox import require_reports
from app.db.session import get_session
from app.models.user import User
from app.services import day_summary as ds

router = APIRouter()


def _parse_day(value: Optional[str], field: str) -> Optional[date_cls]:
    if not value:
        return None
    try:
        return date_cls.fromisoformat(value.strip()[:10])
    except ValueError:
        raise HTTPException(400, f"Неверная дата в {field}: {value} (нужно ГГГГ-ММ-ДД)")


@router.get("/day-summary")
def get_day_summary(
    day: Optional[str] = Query(None, alias="date", description="День по Тбилиси, ГГГГ-ММ-ДД; по умолчанию сегодня"),
    branch: Optional[str] = Query(None, description="Филиал кассы; пусто или 'all' — все"),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_reports),
):
    """Итоги дня: пришло (нал/TBC/BOG), ушло, списано с балансов за брони дня,
    смена — по филиалу; недельные скидки и должники на конец дня — общие."""
    d = _parse_day(day, "date") or ds.tbilisi_today()
    br = (branch or "").strip()
    return ds.compute_day_summary(session, d, None if br in ("", "all") else br)


@router.get("/weekly-rebates")
def get_weekly_rebates(
    week_start: Optional[str] = Query(None, description="Любой день недели броней; по умолчанию прошлая неделя"),
    session: Session = Depends(get_session),
    current_user: User = Depends(require_reports),
):
    """Недельные скидки за неделю: клиент, часы, процент, сумма, итог.
    По умолчанию — прошлая неделя (её скидки начислены в последний понедельник)."""
    d = _parse_day(week_start, "week_start")
    if d is None:
        d = ds.monday_of(ds.tbilisi_today()) - timedelta(days=7)
    return ds.weekly_rebate_report(session, d)


@router.get("/weekly-rebates/recent")
def get_recent_weekly_rebates(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_reports),
):
    """Скидки, начисленные с последнего понедельника (по Тбилиси), — из ленты
    баланса. Для метки в «Сегодня»: «скидка за неделю +9 ₾ уже учтена в «к оплате»»."""
    rows = ds.recent_weekly_rebates(session)
    since = ds.last_monday_start_utc()
    # Почта — второй ключ: в «Сегодня» брони бывают и по UUID, и по почте.
    ids = []
    for r in rows:
        try:
            ids.append(UUID(str(r.user_id)))
        except ValueError:
            continue
    emails: dict[str, str] = {}
    if ids:
        for uid, email in session.exec(select(User.id, User.email).where(col(User.id).in_(ids))).all():
            emails[str(uid)] = email
    return {
        "since": (since + ds.TZ).date().isoformat(),
        "items": [{
            "user_id": r.user_id,
            "email": emails.get(str(r.user_id)),
            "amount": round(float(r.delta or 0), 2),
            "credited_at": r.created_at.isoformat(),
        } for r in rows],
    }
