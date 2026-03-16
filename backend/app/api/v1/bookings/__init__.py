"""
Bookings module — бронирования кабинетов.
Sub-modules: routes (endpoints).
"""
from fastapi import APIRouter

router = APIRouter()

# ── Sub-routers ──────────────────────────────────────────────────────────────
from app.api.v1.bookings import routes  # noqa: E402

router.include_router(routes.router)
