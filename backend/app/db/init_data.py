from sqlmodel import Session, select
from app.models.user import User, UserCreate
from app.models.resource import Resource
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Static Resources Data (Mirrors frontend/src/utils/data.ts)
INITIAL_RESOURCES = [
    # Unbox One
    {
        "id": "unbox_one_room_1",
        "name": "Кабинет 1",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 4,
        "location_id": "unbox_one",
        "area": 9,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Компактный кабинет для индивидуальной, детской и семейной терапии."
    },
    {
        "id": "unbox_one_room_2",
        "name": "Кабинет 2",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 10,
        "location_id": "unbox_one",
        "area": 12,
        "min_booking_hours": 1,
        "formats": ["individual", "group"],
        "description": "Универсальный кабинет для индивидуальной работы, семейных консультаций и малых групп."
    },
    # Unbox Uni
    {
        "id": "unbox_uni_room_5",
        "name": "Кабинет 5",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 4,
        "location_id": "unbox_uni",
        "area": 10,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Кабинет для индивидуальной, детской и семейной терапии."
    },
    {
        "id": "unbox_uni_room_6",
        "name": "Кабинет 6",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 10,
        "location_id": "unbox_uni",
        "area": 16,
        "min_booking_hours": 1,
        "formats": ["individual", "group"],
        "description": "Кабинет подходит для индивидуальной и групповой работы, а также для работы с детьми и семейных консультаций."
    },
    {
        "id": "unbox_uni_room_7",
        "name": "Кабинет 7",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 20,
        "location_id": "unbox_uni",
        "area": 25,
        "min_booking_hours": 1,
        "formats": ["individual", "group"],
        "description": "Большой кабинет для групповых встреч, тренингов, лекций и мероприятий."
    },
    {
        "id": "unbox_uni_room_8",
        "name": "Кабинет 8",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 20,
        "location_id": "unbox_uni",
        "area": 20,
        "min_booking_hours": 1,
        "formats": ["individual", "group"],
        "description": "Просторный кабинет для групповой и индивидуальной работы."
    },
    {
        "id": "unbox_uni_capsule_1",
        "name": "Капсула 1",
        "type": "capsule",
        "hourly_rate": 10,
        "capacity": 1,
        "location_id": "unbox_uni",
        "area": 2,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Индивидуальная капсула для онлайн-сессий и сосредоточенной работы."
    },
    {
        "id": "unbox_uni_capsule_2",
        "name": "Капсула 2",
        "type": "capsule",
        "hourly_rate": 10,
        "capacity": 1,
        "location_id": "unbox_uni",
        "area": 2,
        "min_booking_hours": 1,
        "formats": ["individual"],
        "description": "Индивидуальная капсула для онлайн-сессий и сосредоточенной работы."
    },
    {
        "id": "unbox_uni_room_9",
        "name": "Кабинет 9",
        "type": "cabinet",
        "hourly_rate": 20,
        "capacity": 10,
        "location_id": "unbox_uni",
        "area": 16,
        "min_booking_hours": 1,
        "formats": ["individual", "group"],
        "description": "Уютный кабинет для индивидуальной и групповой работы."
    }
]

def init_resources(session: Session):
    existing = session.exec(select(Resource)).first()
    if not existing:
        logger.info("Initializing resources...")
        for res_data in INITIAL_RESOURCES:
            resource = Resource(**res_data)
            session.add(resource)
        session.commit()
        logger.info("Resources initialized.")
    else:
        logger.info("Resources already exist.")

def migrate_add_columns():
    """Add new columns to existing tables (safe to run multiple times)."""
    from sqlalchemy import text

    dialect = engine.dialect.name
    # Postgres requires quoted "user" (reserved keyword); SQLite does not
    user_table = '"user"' if dialect == 'postgresql' else 'user'

    # user table migrations
    user_columns = [
        ("manual_status",         "VARCHAR"),
        ("responsible_admin_id",  "VARCHAR"),
        ("attracted_by_admin_id", "VARCHAR"),
    ]

    for col_name, col_type in user_columns:
        # Each column gets its own connection so a failure doesn't poison the session
        with engine.connect() as conn:
            try:
                if dialect == 'postgresql':
                    # IF NOT EXISTS avoids aborting the transaction in Postgres
                    stmt = f'ALTER TABLE {user_table} ADD COLUMN IF NOT EXISTS {col_name} {col_type}'
                else:
                    stmt = f'ALTER TABLE {user_table} ADD COLUMN {col_name} {col_type}'
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                conn.rollback()  # reset transaction state before next iteration

    # resource table: services column (JSONB in Postgres, TEXT in SQLite)
    with engine.connect() as conn:
        try:
            if dialect == 'postgresql':
                # Add as JSONB if not exists
                conn.execute(text("ALTER TABLE resource ADD COLUMN IF NOT EXISTS services JSONB DEFAULT '[]'::jsonb"))
                conn.commit()
            else:
                conn.execute(text("ALTER TABLE resource ADD COLUMN services TEXT DEFAULT '[]'"))
                conn.commit()
        except Exception:
            conn.rollback()

    # resource table: convert services from TEXT to JSONB if needed (Postgres only)
    if dialect == 'postgresql':
        with engine.connect() as conn:
            try:
                result = conn.execute(text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'resource' AND column_name = 'services'"
                ))
                row = result.fetchone()
                if row and row[0] == 'text':
                    conn.execute(text("ALTER TABLE resource ALTER COLUMN services DROP DEFAULT"))
                    conn.execute(text("ALTER TABLE resource ALTER COLUMN services TYPE JSONB USING services::jsonb"))
                    conn.execute(text("ALTER TABLE resource ALTER COLUMN services SET DEFAULT '[]'::jsonb"))
                    conn.commit()
            except Exception:
                conn.rollback()


def init_data():
    migrate_add_columns()
    print("DEBUG: Entering init_data()")
    with Session(engine) as session:
        print("DEBUG: Session executed")
        
        # Init User
        user = session.exec(select(User).where(User.email == settings.FIRST_SUPERUSER)).first()
        if not user:
            logger.info(f"Creating first superuser: {settings.FIRST_SUPERUSER}")
            user_in = UserCreate(
                email=settings.FIRST_SUPERUSER,
                password=settings.FIRST_SUPERUSER_PASSWORD,
                name="Admin",
                phone="+995000000000",
                is_admin=True, 
                role="owner"
            )
            
            user_data = user_in.model_dump()
            del user_data["password"]
            user_data["hashed_password"] = get_password_hash(user_in.password)
            db_obj = User(**user_data)
            session.add(db_obj)
            session.commit()
            logger.info("First superuser created")
        else:
            logger.info("First superuser already exists")

        # Init Resources
        init_resources(session)
