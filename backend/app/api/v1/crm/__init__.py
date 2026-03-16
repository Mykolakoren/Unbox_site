"""
Psy-CRM module — specialist's personal CRM.
All data is isolated by specialist_id (= current_user.id).
Sub-modules: clients, sessions, payments, notes, access, dashboard, sync.
"""
from typing import Optional
from fastapi import APIRouter
from app.models.user import User

router = APIRouter()


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
