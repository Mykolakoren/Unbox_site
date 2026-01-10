from sqlmodel import Session, select
from app.models.user import User, UserCreate
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def init_data():
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == settings.FIRST_SUPERUSER)).first()
        if not user:
            logger.info(f"Creating first superuser: {settings.FIRST_SUPERUSER}")
            user_in = UserCreate(
                email=settings.FIRST_SUPERUSER,
                password=settings.FIRST_SUPERUSER_PASSWORD,
                name="Admin",
                phone="+995000000000",
                is_admin=True, 
                role="owner" # Using 'owner' based on recent RBAC changes
            )
            
            # Manual creation to set hashed password
            db_obj = User.model_validate(user_in, update={"password": get_password_hash(user_in.password)})
            session.add(db_obj)
            session.commit()
            logger.info("First superuser created")
        else:
            logger.info("First superuser already exists")
