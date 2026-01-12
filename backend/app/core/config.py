from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Unbox Booking API"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "changethis-generate-secure-key-in-prod" # TODO: usage: openssl rand -hex 32
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8 # 8 days
    
    # OAuth
    GOOGLE_CLIENT_ID: Optional[str] = "277953497231-ejqnao55sn2b8seegf3ckldg7704hdq3.apps.googleusercontent.com"
    TELEGRAM_BOT_TOKEN: Optional[str] = "7646959645:AAGnZh85gvYCCEMcgyTyj6sU_iJbql2k8cc"
    
    # First Superuser (for auto-creation on deploy)
    FIRST_SUPERUSER: str = "admin@unbox.com"
    FIRST_SUPERUSER_PASSWORD: str = "admin123"
    
    # Database
    DATABASE_URL: Optional[str] = None # Will be auto-populated by Vercel Postgres or manual env
    
    # CORS
    # Allow all origins for Vercel Preview deployments
    BACKEND_CORS_ORIGINS: List[str] = ["*"]

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

settings = Settings()
