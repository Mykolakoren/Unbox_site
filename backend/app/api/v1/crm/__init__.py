"""
Psy-CRM module — specialist's personal CRM.
All data is isolated by specialist_id (= current_user.id).
Sub-modules: clients, sessions, payments, notes, access, dashboard, sync.
"""
from typing import Optional
from fastapi import APIRouter
from app.models.user import User

router = APIRouter()


# Статусы сессии (TherapySession.status). 09.11 (решение владельца 6): третий
# вариант отмены «Не пришёл / поздняя отмена — оплачивается» = NO_SHOW. Такая
# сессия, как проведённая, остаётся в долге и в «Заработано»; отменённые — нет.
CANCELLED_STATUSES = ("CANCELLED_CLIENT", "CANCELLED_THERAPIST")
BILLABLE_STATUSES = ("COMPLETED", "NO_SHOW")
SESSION_STATUSES = ("PLANNED",) + BILLABLE_STATUSES + CANCELLED_STATUSES


def profile_base_price(db, user_id) -> float:
    """«Базовая цена сессии» из анкеты специалиста (Specialist.base_price_gel, в лари).
    Нет анкеты или цены — 0. Это ставка по умолчанию для НОВЫХ клиентов CRM
    (решение владельца 2, 09.11); существующих клиентов не трогает."""
    from sqlmodel import select
    from app.models.specialist import Specialist
    from uuid import UUID
    try:
        uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    except (ValueError, TypeError):
        return 0.0
    spec = db.exec(select(Specialist).where(Specialist.user_id == uid)).first()
    return float(getattr(spec, "base_price_gel", 0) or 0) if spec else 0.0


def get_crm_calendar_id(user: User) -> Optional[str]:
    """Get specialist's personal calendar ID from crm_data."""
    if user.crm_data and isinstance(user.crm_data, dict):
        return user.crm_data.get("calendar_id")
    return None


# ── Sub-routers (no extra prefix — endpoints define their own paths) ─────────
from app.api.v1.crm import clients, sessions, payments, notes, access, dashboard, sync  # noqa: E402

router.include_router(clients.router)
router.include_router(sessions.router)
router.include_router(payments.router)
router.include_router(notes.router)
router.include_router(access.router)
router.include_router(dashboard.router)
router.include_router(sync.router)
