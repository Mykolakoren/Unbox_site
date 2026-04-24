from sqlmodel import SQLModel, create_engine, Session

from app.core.config import settings

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

import os

# Prod: Postgres on the DigitalOcean Droplet (localhost:5432/unboxdb).
# Dev : fall back to a local SQLite file if no DATABASE_URL is set.
connection_url = settings.DATABASE_URL or os.environ.get("POSTGRES_URL") or sqlite_url

# Some Postgres providers emit the old "postgres://" scheme; SQLAlchemy 2.x
# wants the canonical "postgresql://" form. Normalise it.
if connection_url and connection_url.startswith("postgres://"):
    connection_url = connection_url.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if "sqlite" in connection_url else {}
engine = create_engine(
    connection_url,
    echo=False,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_recycle=300
)

def init_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
