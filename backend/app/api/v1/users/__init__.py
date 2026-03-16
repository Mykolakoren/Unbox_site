"""
Users module — profile (self-service) + admin management.
Sub-modules: profile, admin.

CRITICAL: profile router MUST be included BEFORE admin router
so that /me routes are matched before /{user_id} catch-all.
"""
from fastapi import APIRouter

router = APIRouter()

# ── Sub-routers (order matters!) ──────────────────────────────────────────────
from app.api.v1.users import profile, admin  # noqa: E402

router.include_router(profile.router)   # /me first!
router.include_router(admin.router)     # /{user_id} second
