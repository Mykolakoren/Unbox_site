import logging
from datetime import datetime, timedelta
from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select, Session
from app.api import deps
from app.models.waitlist import Waitlist, WaitlistCreate, WaitlistRead
from app.models.user import User
from app.models.resource import Resource
from app.models.location import Location
from app.core.permissions import ADMIN_ROLES
from app.services.telegram import telegram_service

logger = logging.getLogger(__name__)

router = APIRouter()


_TBILISI_OFFSET = timedelta(hours=4)


def _expire_past_for_user(session: Session, user_uuid) -> int:
    """Mark waitlist entries past today (Tbilisi) as cancelled.

    Lazy cleanup — runs whenever a user lists their waitlist. Cheap
    because each user has <20 active entries in practice. Returns the
    number of rows cancelled (mostly for logs).

    A waitlist entry is "past" iff its date is BEFORE today's midnight
    (Tbilisi). Same-day entries stay active until next calendar day, so
    last-minute slot openings can still trigger a TG match.
    """
    tb_now = datetime.utcnow() + _TBILISI_OFFSET
    tb_today_start = tb_now.replace(hour=0, minute=0, second=0, microsecond=0)
    # DB convention is UTC-naive (see backend/app/api/v1/crm/sessions.py:84-87)
    utc_today_start = tb_today_start - _TBILISI_OFFSET
    past = session.exec(
        select(Waitlist).where(
            Waitlist.user_uuid == user_uuid,
            Waitlist.status == "active",
            Waitlist.date < utc_today_start,
        )
    ).all()
    if not past:
        return 0
    for p in past:
        p.status = "cancelled"
        p.updated_at = datetime.now()
        session.add(p)
    session.commit()
    logger.info("[waitlist] auto-expired %d past entries for user %s", len(past), user_uuid)
    return len(past)


@router.get("/my", response_model=List[WaitlistRead])
def read_my_waitlist(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """
    Retrieve current user's *active* waitlist entries. Past entries are
    auto-cancelled on each call so the user never sees stale rows for
    dates that have already passed.
    """
    _expire_past_for_user(session, current_user.id)
    statement = (
        select(Waitlist)
        .where(Waitlist.user_uuid == current_user.id)
        .where(Waitlist.status == "active")
        .offset(skip)
        .limit(limit)
    )
    entries = session.exec(statement).all()
    return entries

@router.post("/", response_model=WaitlistRead)
def create_waitlist_entry(
    *,
    session: Session = Depends(deps.get_session),
    entry_in: WaitlistCreate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Add to waitlist.

    NB: avoid `Waitlist.from_orm(entry_in)` — under Pydantic v2 it triggers
    full table-model validation, which requires `user_id` (NOT NULL on the
    table) but `WaitlistCreate` doesn't carry one. Construct directly so we
    pass `user_id` / `user_uuid` from the auth context in the same step.
    """
    payload = entry_in.model_dump()

    # Dedup: refuse a second active subscription for the same user + slot.
    # Mobile users (and double-tappers) were creating 2-3 identical rows,
    # which then fired duplicate TG alerts when the slot eventually freed.
    # Compare on the canonical fields used for matching (resource + day +
    # window). Returns the existing row instead of erroring so retries are
    # idempotent from the client's perspective.
    target_date = payload.get("date")
    target_resource = payload.get("resource_id")
    target_start = payload.get("start_time")
    target_end = payload.get("end_time")
    existing = session.exec(
        select(Waitlist).where(
            Waitlist.user_uuid == current_user.id,
            Waitlist.resource_id == target_resource,
            Waitlist.date == target_date,
            Waitlist.start_time == target_start,
            Waitlist.end_time == target_end,
            Waitlist.status == "active",
        )
    ).first()
    if existing:
        return existing

    entry = Waitlist(
        **payload,
        user_id=current_user.email,
        user_uuid=current_user.id,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)

    # Confirmation TG message — fire-and-forget so a TG outage doesn't break
    # the subscription itself. Resource/location names looked up here so the
    # message reads "Кабинет 5 · Unbox UNI" instead of raw IDs.
    if current_user.telegram_id:
        try:
            resource = session.get(Resource, entry.resource_id)
            res_name = (resource.name if resource else entry.resource_id) or entry.resource_id
            location = session.get(Location, resource.location_id) if resource and resource.location_id else None
            loc_name = location.name if location else None
            telegram_service.send_waitlist_subscribed(
                chat_id=current_user.telegram_id,
                user_name=current_user.name,
                resource_name=res_name,
                location_name=loc_name,
                date=entry.date,
                start_time=entry.start_time,
                end_time=entry.end_time,
            )
        except Exception as e:
            logger.warning("[waitlist] subscribe-confirm TG failed: %r", e)

    return entry

@router.get("/admin/all", response_model=List[WaitlistRead])
def read_all_waitlist_admin(
    session: Session = Depends(deps.get_session),
    _admin: User = Depends(deps.require_admin),
    skip: int = 0,
    limit: int = 500,
) -> Any:
    """Admin: list every active waitlist entry across all users.

    Used by the admin waitlist page (both desktop and /m/admin/cabinets).
    Sorted by date ASC then start_time ASC so the next-fillable slot is
    on top.
    """
    statement = (
        select(Waitlist)
        .where(Waitlist.status == "active")
        .order_by(Waitlist.date.asc(), Waitlist.start_time.asc())  # type: ignore[attr-defined]
        .offset(skip)
        .limit(limit)
    )
    return session.exec(statement).all()


@router.post("/{entry_id}/notify")
def notify_waitlist_entry(
    entry_id: str,
    session: Session = Depends(deps.get_session),
    _admin: User = Depends(deps.require_admin),
) -> Any:
    """Admin: вручную пингануть клиента из листа ожидания о его слоте.
    Раньше кнопка «уведомить» была заглушкой. Шлёт то же TG-сообщение
    «слот доступен», что и авто-уведомление при освобождении. Запись
    НЕ помечается выполненной — админ просто напоминает; удалить запись
    можно отдельно."""
    from app.services.waitlist_notify import _resolve_user
    entry = session.get(Waitlist, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    user = _resolve_user(session, entry)
    if not user:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    if not user.telegram_id:
        raise HTTPException(status_code=400, detail="У клиента не привязан Telegram — уведомить нельзя")
    res = session.get(Resource, entry.resource_id)
    loc = session.get(Location, res.location_id) if res and res.location_id else None
    sent = telegram_service.send_slot_available(
        chat_id=user.telegram_id,
        user_name=user.name,
        resource_name=(res.name if res else entry.resource_id),
        location_name=(loc.name if loc else None),
        date=entry.date,
        start_time=entry.start_time,
        end_time=entry.end_time,
    )
    if not sent:
        raise HTTPException(status_code=502, detail="Не удалось отправить уведомление в Telegram")
    return {"ok": True, "notified": user.name}


@router.delete("/{entry_id}", response_model=WaitlistRead)
def delete_waitlist_entry(
    entry_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Delete from waitlist (Cancel).
    """
    entry = session.get(Waitlist, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
        
    if entry.user_uuid != current_user.id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    session.delete(entry)
    session.commit()
    
    return entry
