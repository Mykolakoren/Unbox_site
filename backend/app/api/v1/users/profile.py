"""Users — self-service profile endpoints (GET /me, PATCH /me, discount-progress)."""
from typing import Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from app.api import deps
from app.db.session import get_session
from app.models.user import User, UserRead, UserUpdate, drop_echoed_avatar
from app.models.booking import Booking
from app.services.pricing import PricingService

router = APIRouter()


@router.get("/me", response_model=UserRead)
def read_user_me(
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Get current user."""
    return current_user


@router.get("/me/discount-progress")
def get_discount_progress(
    *,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Get weekly discount progress and total savings."""
    # 1. Total Saved (All Time). Скидка ниже нуля (ручная цена выше цены
    # движка: «Цена» 35 при базе 20 → discount −15) хранится ради равенства
    # «аренда = base − discount», но экономией не считается и сумму не уменьшает.
    stmt_saved = select(func.sum(Booking.discount_amount)).where(
        (Booking.user_uuid == current_user.id) | (Booking.user_id == current_user.email),
        Booking.status == 'confirmed',
        Booking.discount_amount > 0,
    )
    total_saved = session.exec(stmt_saved).one() or 0.0

    # 2. Weekly Accumulated Hours
    pricing = PricingService(session)
    now = datetime.now()
    accumulated_hours = pricing._get_weekly_accumulated_hours(current_user, now)

    # 3. Determine Tiers
    config = PricingService.PRICING_CONFIG["weekly_progressive"]
    current_discount = 0
    next_tier_hours = 5.0
    next_tier_discount = 10

    for tier in config:
        if tier["min"] <= accumulated_hours < tier["max"]:
            current_discount = tier["percent"]
            idx = config.index(tier)
            if idx + 1 < len(config):
                next_tier = config[idx + 1]
                next_tier_hours = next_tier["min"]
                next_tier_discount = next_tier["percent"]
            else:
                next_tier_hours = accumulated_hours
                next_tier_discount = current_discount
            break

    if accumulated_hours >= 16.0:
        progress_percent = 100
        next_tier_hours = 16.0
        next_tier_discount = 50
    else:
        progress_percent = (accumulated_hours / 16.0) * 100

    return {
        "accumulated_hours": round(accumulated_hours, 1),
        "total_saved": round(total_saved, 2),
        "current_discount": current_discount,
        "next_tier_hours": next_tier_hours,
        "next_tier_discount": next_tier_discount,
        "progress_percent": min(100, progress_percent),
        "tiers": config,
    }


# 09.11 (ревью клиентской части №6): «куда ушли мои деньги?» — у клиента не было
# истории баланса, лента была только у админа (/users/{id}/balance-ledger). Тот же
# источник (balance_ledger), только СВОИ строки, только чтение. Служебное наружу не
# отдаём: ни кто из сотрудников провёл операцию, ни текст ручных корректировок
# (там бывают внутренние заметки) — описание только у строк, где оно и есть смысл
# (недельная скидка, оплата абонемента). К строкам по брони — кабинет и время.
_CLIENT_LEDGER_DESCRIPTION_REASONS = {"weekly_rebate", "subscription_purchase"}


@router.get("/me/balance-ledger")
def read_my_balance_ledger(
    *,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
    limit: int = 200,
) -> Any:
    from uuid import UUID
    from app.models.balance_ledger import BalanceLedger
    from app.models.resource import Resource

    limit = max(1, min(int(limit or 200), 500))
    rows = session.exec(
        select(BalanceLedger)
        .where(BalanceLedger.user_id == str(current_user.id))
        .order_by(BalanceLedger.created_at.desc())  # type: ignore
        .limit(limit)
    ).all()

    # Брони, на которые ссылаются строки, — одним запросом, и только СВОИ
    # (строка ленты своя, но лишняя проверка владельца ничего не стоит).
    booking_ids = []
    for r in rows:
        if r.ref_type == "booking" and r.ref_id:
            try:
                booking_ids.append(UUID(str(r.ref_id)))
            except ValueError:
                pass
    bookings: dict[str, Booking] = {}
    if booking_ids:
        for b in session.exec(select(Booking).where(Booking.id.in_(booking_ids))).all():  # type: ignore[attr-defined]
            if b.user_uuid == current_user.id or (b.user_id and b.user_id == current_user.email):
                bookings[str(b.id)] = b
    res_names: dict[str, str] = {}
    res_ids = {b.resource_id for b in bookings.values() if b.resource_id}
    if res_ids:
        for res in session.exec(select(Resource).where(Resource.id.in_(list(res_ids)))).all():  # type: ignore[attr-defined]
            res_names[res.id] = res.name

    def _booking_info(ref_id: str | None) -> dict | None:
        b = bookings.get(str(ref_id)) if ref_id else None
        if not b:
            return None
        return {
            "date": b.date.strftime("%Y-%m-%d") if b.date else None,
            "startTime": b.start_time,
            "duration": b.duration,
            "resourceName": res_names.get(b.resource_id or "", b.resource_id),
        }

    return {
        "balance": round(float(current_user.balance or 0), 2),
        "truncated": len(rows) >= limit,
        "entries": [
            {
                "id": str(r.id),
                "date": r.created_at.isoformat() if r.created_at else None,
                "delta": round(float(r.delta or 0), 2),
                "balanceAfter": round(float(r.balance_after or 0), 2),
                "reason": r.reason,
                "description": (r.description or "") if r.reason in _CLIENT_LEDGER_DESCRIPTION_REASONS else "",
                "booking": _booking_info(r.ref_id) if r.ref_type == "booking" else None,
            }
            for r in rows
        ],
    }


@router.get("/{user_id}/avatar")
def read_user_avatar(user_id: str, session: Session = Depends(get_session)):
    """Фото профиля, сохранённое в базе текстом (data:image/…;base64,…), — как
    обычная картинка. Ссылку с ?v=<отпечаток> даёт UserRead; новое фото = новый
    отпечаток, поэтому кэшировать можно надолго."""
    import base64
    import re
    from uuid import UUID
    from fastapi.responses import Response
    try:
        user = session.get(User, UUID(user_id))
    except ValueError:
        user = None
    m = re.match(r"^data:(image/(?:jpeg|jpg|png|webp|gif));base64,(.+)$", (user.avatar_url or "") if user else "", re.S)
    if not m:
        raise HTTPException(status_code=404, detail="Фото нет")
    try:
        body = base64.b64decode(m.group(2))
    except Exception:
        raise HTTPException(status_code=404, detail="Фото нет")
    return Response(content=body, media_type=m.group(1).replace("jpg", "jpeg"), headers={
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    })


@router.patch("/me", response_model=UserRead)
def update_user_me(
    *,
    session: Session = Depends(get_session),
    user_in: UserUpdate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Update own profile."""
    user_data = drop_echoed_avatar(user_in.dict(exclude_unset=True))
    # G3-01 (аудит 29.09): стёртое в профиле имя уходило сюда как name="" и
    # сохранялось — клиент пропадал из поиска и шахматки. Имя обрезаем
    # и пустым не принимаем. Проверка до try: иначе 400 завернётся в str(e).
    if "name" in user_data:
        clean_name = (user_data["name"] or "").strip()
        if not clean_name:
            raise HTTPException(status_code=400, detail="Имя не может быть пустым")
        user_data["name"] = clean_name
    try:
        for key, value in user_data.items():
            setattr(current_user, key, value)

        session.add(current_user)
        session.commit()
        session.refresh(current_user)
        return current_user
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/me/vacation", response_model=UserRead)
def set_vacation(
    *,
    session: Session = Depends(get_session),
    payload: dict,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Set/clear the 'I'm on vacation until X' marker on own profile.

    Owner 2026-05-27: specialists going on holiday previously had to
    manually cancel each booking and ping every client. With this flag
    set, the mobile CRM banner + Today screen surface their absence so
    they don't accidentally take new sessions, and admins see who's out
    when triaging hot-bookings. Stored in `crm_data.vacation_until` as
    a YYYY-MM-DD ISO date or None.

    Payload: {"until": "YYYY-MM-DD"}  or  {"until": null} to clear.
    """
    raw = payload.get("until")
    crm_data = dict(current_user.crm_data or {})
    if raw in (None, "", False):
        crm_data.pop("vacation_until", None)
    else:
        # Validate format — reject garbage so the UI doesn't get bricked
        try:
            datetime.strptime(str(raw), "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="until must be YYYY-MM-DD")
        crm_data["vacation_until"] = str(raw)

    current_user.crm_data = crm_data
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(current_user, "crm_data")
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user
