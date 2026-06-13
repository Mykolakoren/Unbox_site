"""
API v1 router aggregation with fault-tolerant module loading.

Critical modules (auth, health) fail hard — without them the system is useless.
All other modules load via safe_include() — if one fails, the rest still work.
"""
import importlib
import logging

from fastapi import APIRouter

logger = logging.getLogger("unbox.modules")

api_router = APIRouter()


def safe_include(router: APIRouter, module_path: str, prefix: str, tags: list[str]):
    """Import a module and register its router. Log and skip on failure."""
    try:
        mod = importlib.import_module(module_path)
        router.include_router(mod.router, prefix=prefix, tags=tags)
        logger.info(f"✅ Module loaded: {prefix}")
    except Exception as e:
        logger.error(f"❌ Module FAILED: {prefix} — {e}", exc_info=True)


# ── Critical modules (hard import — app won't start without these) ───────────
from app.api.v1 import auth, health  # noqa: E402
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(health.router, prefix="/health", tags=["health"])

# ── Isolated business modules (graceful degradation) ─────────────────────────
safe_include(api_router, "app.api.v1.bookings", "/bookings", ["bookings"])
safe_include(api_router, "app.api.v1.users", "/users", ["users"])
safe_include(api_router, "app.api.v1.crm", "/crm", ["crm"])
safe_include(api_router, "app.api.v1.cashbox", "/cashbox", ["cashbox"])
safe_include(api_router, "app.api.v1.resources", "/resources", ["resources"])
safe_include(api_router, "app.api.v1.locations", "/locations", ["locations"])
safe_include(api_router, "app.api.v1.specialists", "/specialists", ["specialists"])
safe_include(api_router, "app.api.v1.specialist_schedule", "/specialists", ["specialist-schedule"])
safe_include(api_router, "app.api.v1.notifications", "/notifications", ["notifications"])
safe_include(api_router, "app.api.v1.timeline", "/timeline", ["timeline"])
safe_include(api_router, "app.api.v1.waitlist", "/waitlist", ["waitlist"])
safe_include(api_router, "app.api.v1.team", "/team", ["team"])
safe_include(api_router, "app.api.v1.upload", "/upload", ["upload"])
safe_include(api_router, "app.api.v1.pricing", "/pricing", ["pricing"])
safe_include(api_router, "app.api.v1.bonuses", "/bonuses", ["bonuses"])
safe_include(api_router, "app.api.v1.admin_tasks", "/admin/tasks", ["admin-tasks"])
safe_include(api_router, "app.api.v1.telegram", "/telegram", ["telegram"])
safe_include(api_router, "app.api.v1.settings", "/settings", ["settings"])
safe_include(api_router, "app.api.v1.billing", "/billing", ["billing"])
safe_include(api_router, "app.api.v1.maintenance", "/maintenance-blocks", ["maintenance"])
safe_include(api_router, "app.api.v1.posts", "/posts", ["posts"])
