from sqlmodel import SQLModel, create_engine, Session

from app.core.config import settings

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

import os

# Prod: Postgres on the DigitalOcean Droplet (localhost:5432/unboxdb).
# Dev : fall back to a local SQLite file if no DATABASE_URL is set.
connection_url = settings.DATABASE_URL or os.environ.get("POSTGRES_URL") or sqlite_url

# A missing DATABASE_URL in production used to silently fall back to the SQLite
# file sitting next to the code: the app looked healthy while serving an empty
# database and writing bookings/payments into a file the next deploy overwrites.
# Refuse to start instead.
if os.getenv("ENVIRONMENT", "development") == "production" and "sqlite" in connection_url:
    raise RuntimeError(
        "DATABASE_URL is not set in production — refusing to start on the SQLite "
        "fallback. Set DATABASE_URL in /var/www/unbox/backend/.env"
    )

# Some Postgres providers emit the old "postgres://" scheme; SQLAlchemy 2.x
# wants the canonical "postgresql://" form. Normalise it.
if connection_url and connection_url.startswith("postgres://"):
    connection_url = connection_url.replace("postgres://", "postgresql://", 1)

is_sqlite = "sqlite" in connection_url
connect_args = {"check_same_thread": False} if is_sqlite else {}

# Almost every endpoint is a plain `def`, so FastAPI runs it in the threadpool
# (40 threads by default) and each thread holds a connection. SQLAlchemy's
# default pool is 5 + 10 overflow, so from the 16th concurrent request onwards
# requests queued on the pool for up to 30s. Postgres allows 100 connections.
pool_kwargs = {} if is_sqlite else {
    "pool_size": 20,
    "max_overflow": 10,
    "pool_timeout": 10,
}

engine = create_engine(
    connection_url,
    echo=False,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_recycle=300,
    **pool_kwargs,
)

def init_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
