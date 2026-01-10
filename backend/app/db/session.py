from sqlmodel import SQLModel, create_engine, Session

from app.core.config import settings

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

# Use DATABASE_URL if set (Production), otherwise SQLite (Local)
# Vercel Postgres usually sets POSTGRES_URL or DATABASE_URL
connection_url = settings.DATABASE_URL or sqlite_url

# Fix for Vercel/Neon: "postgres://" -> "postgresql://"
if connection_url and connection_url.startswith("postgres://"):
    connection_url = connection_url.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if "sqlite" in connection_url else {}
engine = create_engine(connection_url, echo=True, connect_args=connect_args)

def init_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
