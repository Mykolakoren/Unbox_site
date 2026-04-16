import os
import secrets
import logging
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional

logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    PROJECT_NAME: str = "Unbox Booking API"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "changethis-generate-secure-key-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 3  # 3 days (reduced from 8)

    # OAuth — set via environment variables
    GOOGLE_CLIENT_ID: Optional[str] = None
    TELEGRAM_BOT_TOKEN: Optional[str] = None
    TELEGRAM_BOT_USERNAME: str = "Unbox_Booking_G_Bot"  # without @, used for deep-link
    TELEGRAM_WEBHOOK_SECRET: Optional[str] = None       # validated against X-Telegram-Bot-Api-Secret-Token

    # First Superuser (for auto-creation on deploy)
    FIRST_SUPERUSER: str = "admin@unbox.com"
    FIRST_SUPERUSER_PASSWORD: str = "admin123"
    
    # Database
    DATABASE_URL: Optional[str] = None # Will be auto-populated by Vercel Postgres or manual env
    
    # Google Calendar
    GOOGLE_SERVICE_ACCOUNT_FILE: Optional[str] = None
    GOOGLE_SERVICE_ACCOUNT_JSON: Optional[str] = None  # JSON content as env var
    CALENDAR_ID_CABINET_1: Optional[str] = None
    CALENDAR_ID_CABINET_2: Optional[str] = None
    CALENDAR_ID_CABINET_5: Optional[str] = None
    CALENDAR_ID_CABINET_6: Optional[str] = None
    CALENDAR_ID_CABINET_7: Optional[str] = None
    CALENDAR_ID_CABINET_8: Optional[str] = None
    CALENDAR_ID_CABINET_9: Optional[str] = None
    CALENDAR_ID_CAPSULE_1: Optional[str] = None
    CALENDAR_ID_CAPSULE_2: Optional[str] = None

    # CORS — разрешённые домены (добавьте через env BACKEND_CORS_ORIGINS='["..."]')
    BACKEND_CORS_ORIGINS: List[str] = [
        "https://unbox.com.ge",
        "https://www.unbox.com.ge",
        "https://unboxcrm.vercel.app",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
    ]

    # Email (SMTP) — set via environment variables
    EMAILS_ENABLED: bool = False  # Master switch; when False, emails are logged but not sent
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: Optional[str] = None  # e.g. "Unbox <noreply@unbox.com.ge>"
    SMTP_USE_TLS: bool = True

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra='ignore')

settings = Settings()

# Runtime safety check: warn if using default SECRET_KEY
if settings.SECRET_KEY == "changethis-generate-secure-key-in-prod":
    if os.getenv("ENVIRONMENT", "development") == "production":
        logger.critical(
            "SECURITY: Using default SECRET_KEY in production! "
            "Set SECRET_KEY env var immediately. Generating temporary random key."
        )
        settings.SECRET_KEY = secrets.token_urlsafe(64)
    else:
        logger.warning("Using default SECRET_KEY — acceptable for development only.")
