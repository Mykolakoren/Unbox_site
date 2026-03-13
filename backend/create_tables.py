from sqlmodel import SQLModel, Session, text
from app.db.session import engine
from app.models.user import User
from app.models.resource import Resource
from app.models.booking import Booking
from app.models.waitlist import Waitlist
from app.models.specialist import Specialist


def create_tables():
    print("Creating tables...")
    try:
        SQLModel.metadata.create_all(engine)
        print("Tables created.")
    except Exception as e:
        print(f"Warning during create_all (some tables may already exist): {e}")


def run_migrations():
    """Safely add new columns to existing tables (ALTER TABLE IF NOT EXISTS)."""
    migrations = [
        # Format: (table, column, type)
        ("booking", "crm_client_id", "VARCHAR"),
        ("booking", "gcal_event_id", "VARCHAR"),
        ("booking", "gcal_calendar_id", "VARCHAR"),
        # TherapistClient — new fields from psycrm alignment
        ("therapist_clients", "telegram", "VARCHAR"),
        ("therapist_clients", "pipeline_status", "VARCHAR DEFAULT 'ACTIVE'"),
        # TherapySession — notes field
        ("therapy_sessions", "notes", "TEXT"),
    ]
    with Session(engine) as session:
        for table, column, col_type in migrations:
            try:
                session.exec(text(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {col_type}"
                ))
                session.commit()
                print(f"  ✓ {table}.{column}")
            except Exception as e:
                session.rollback()
                print(f"  ✗ {table}.{column}: {e}")


if __name__ == "__main__":
    create_tables()
    print("Running migrations...")
    run_migrations()
    print("Done.")
