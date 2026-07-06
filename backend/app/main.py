from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from .db.session import init_db
from .db.init_data import init_data
from .core.config import settings
from .core.rate_limit import limiter
from .api.v1 import api_router

# ── Sentry (§5#5) — опт-ин трекинг ошибок бэкенда. Полный no-op, если пакет
# не установлен ИЛИ не задан SENTRY_DSN. Чтобы включить на проде:
#   venv/bin/pip install "sentry-sdk[fastapi]"  +  SENTRY_DSN=... в .env
import os as _os
_sentry_dsn = _os.getenv("SENTRY_DSN") or getattr(settings, "SENTRY_DSN", None)
if _sentry_dsn:
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=_sentry_dsn,
            environment=_os.getenv("ENVIRONMENT", "production"),
            traces_sample_rate=0.0,   # только ошибки, без перф-трейсов
            send_default_pii=False,
        )
    except Exception:  # пакет не установлен / кривой DSN — не роняем старт
        import logging as _logging
        _logging.getLogger(__name__).warning("Sentry init skipped", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_data()
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Backend API for Unbox Coworking Booking System",
    version="0.1.0",
    lifespan=lifespan,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Rate limiting — wire the shared limiter + default 429 handler. Individual
# endpoints opt-in via @limiter.limit("...") decorators in their router files.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

from fastapi.staticfiles import StaticFiles
import os

# Ensure uploads directory exists
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# CORS Middleware (Allow Frontend to connect)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

# Per-post SEO (root-level /news/{slug}, /articles/{slug}) — nginx проксирует
# только эти паттерны сюда, отдаём index.html с per-post og-мета (см. app/seo.py).
from app.seo import router as seo_router  # noqa: E402
app.include_router(seo_router)



@app.get("/")
def read_root():
    return {"message": "Welcome to Unbox Booking API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
