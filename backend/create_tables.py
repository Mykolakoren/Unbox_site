from sqlmodel import SQLModel
from app.db.session import engine
from app.models.user import User
from app.models.resource import Resource # Ensure Resource is registered
# Import other models if needed, e.g. Booking, Waitlist...
from app.models.booking import Booking
from app.models.waitlist import Waitlist

def create_tables():
    print("Creating tables...")
    SQLModel.metadata.create_all(engine)
    print("Tables created.")

if __name__ == "__main__":
    create_tables()
