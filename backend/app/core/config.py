import os
import secrets
import logging
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional

logger = logging.getLogger(__name__)

# backend/.env — по АБСОЛЮТНОМУ пути от этого файла, а не относительно CWD.
#
# Раньше здесь стоял просто ".env", т.е. поиск шёл от текущей директории. Любой
# запуск не из backend/ (разовый скрипт, миграция, cron без `cd`) не находил
# файл → DATABASE_URL пустой → приложение молча уезжало на SQLite. Хуже того,
# ENVIRONMENT читается из того же .env, поэтому fail-fast в db/session.py тоже
# не срабатывал: он ждёт ENVIRONMENT=production, а его тоже не было.
# config.py лежит в backend/app/core/ → три уровня вверх = backend/.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

class Settings(BaseSettings):
    PROJECT_NAME: str = "Unbox Booking API"
    API_V1_STR: str = "/api/v1"
    # "production" на дроплете, "development" локально. Раньше читалось только из
    # окружения процесса, хотя лежит в .env — из-за чего защиты, завязанные на
    # него (fail-fast против SQLite), молчали в скриптах и cron-задачах.
    ENVIRONMENT: str = "development"
    SECRET_KEY: str = "changethis-generate-secure-key-in-prod"
    ALGORITHM: str = "HS256"
    # 30 дней. Owner 2026-07-11: «не разлогинивай, если не пользовался». Токен
    # ещё и продлевается при каждом заходе (см. /auth/refresh + fetchCurrentUser),
    # поэтому при регулярном визите (хотя бы раз в месяц) сессия не истекает.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30  # 30 days

    # OAuth — set via environment variables
    GOOGLE_CLIENT_ID: Optional[str] = None
    TELEGRAM_BOT_TOKEN: Optional[str] = None
    TELEGRAM_BOT_USERNAME: str = "Unbox_Booking_G_Bot"  # without @, used for deep-link
    TELEGRAM_WEBHOOK_SECRET: Optional[str] = None       # validated against X-Telegram-Bot-Api-Secret-Token
    # Excel #58 — cron hits /telegram/send-reminders?secret=<TELEGRAM_REMINDER_SECRET>.
    # If unset, the endpoint falls back to TELEGRAM_BOT_TOKEN (bot token is a
    # secret anyway, so reusing it is safe). Set a dedicated value to rotate
    # without having to rotate the bot token itself.
    TELEGRAM_REMINDER_SECRET: Optional[str] = None

    # Private group where admin alerts land (new booking via bot, /help
    # requests from clients, fallback "bot didn't understand", daily
    # summary). Create the group, add @Unbox_Booking_G_Bot as admin,
    # /chatid in the group → paste the number here (e.g. -1001234567890).
    TELEGRAM_ADMIN_CHAT_ID: Optional[str] = None
    # Owner-only chat (Микола). Daily summary posts here instead of the
    # busy admin group so the founder gets the once-a-day money/hours
    # roll-up without the per-event noise. If unset, daily summary
    # falls back to TELEGRAM_ADMIN_CHAT_ID (legacy behaviour).
    TELEGRAM_OWNER_CHAT_ID: Optional[str] = None

    # First Superuser (for auto-creation on deploy) — MUST be overridden via
    # env vars in production. The literal "CHANGE_ME_ON_FIRST_DEPLOY" default
    # trips the guard in db.init_data so the seed is skipped if it leaks through.
    FIRST_SUPERUSER: str = "admin@unbox.com"
    FIRST_SUPERUSER_PASSWORD: str = "CHANGE_ME_ON_FIRST_DEPLOY"

    # Comma-separated list of emails that should always hold `role=owner`.
    # Evaluated at every app startup (init_data):
    #   - If a user with that email exists but has a lower role → promoted.
    #   - If no such user yet → skipped (they'll be created on first OAuth
    #     login with role=owner auto-applied).
    # Prevents the "Google OAuth silently creates a fresh user=role=user
    # when the owner wasn't yet linked" trap — if the real owner's personal
    # email is in this list, first login promotes automatically.
    OWNER_EMAILS: str = ""  # e.g. "koren.nikolas@gmail.com,co-founder@gmail.com"
    
    # Database — set via backend/.env on the Droplet (postgres on localhost).
    DATABASE_URL: Optional[str] = None
    
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

    # CORS — разрешённые домены. Прод — unbox.com.ge (DigitalOcean Droplet).
    # Локалка — Vite dev-сервер на 5173/5174/5175.
    # Дополнить можно через env BACKEND_CORS_ORIGINS='["..."]'.
    BACKEND_CORS_ORIGINS: List[str] = [
        "https://unbox.com.ge",
        "https://www.unbox.com.ge",
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

    # Ключ шифрования заметок терапевта (см. services/note_crypto).
    # ОБЯЗАТЕЛЬНО читать отсюда, а не из os.getenv: pydantic забирает .env
    # в этот объект, но в переменные окружения процесса ничего не кладёт, а
    # EnvironmentFile у systemd-юнита нет. Через os.getenv ключ не виден —
    # шифрование молча выключалось бы, а заметки писались открытым текстом.
    NOTES_ENCRYPTION_KEY: Optional[str] = None

    model_config = SettingsConfigDict(env_file=str(ENV_FILE), case_sensitive=True, extra='ignore')

settings = Settings()

# ENVIRONMENT живёт в том же .env, что и всё остальное. Пробрасываем его в
# os.environ, чтобы проверки ниже и fail-fast в db/session.py видели значение
# даже когда переменная не была экспортирована в окружение процесса (systemd
# передаёт .env через EnvironmentFile, а вот разовый скрипт — нет).
if settings.ENVIRONMENT and not os.getenv("ENVIRONMENT"):
    os.environ["ENVIRONMENT"] = settings.ENVIRONMENT

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
