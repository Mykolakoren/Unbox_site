import asyncio
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.specialist import Specialist
import uuid
import random

async def seed_specialists():
    with Session(engine) as session:
        # Check if we have users, if not, create dummy ones
        users = session.exec(select(User).limit(5)).all()
        if len(users) < 3:
            print("Creating dummy users first...")
            for i in range(3):
                u = User(
                    email=f"dummy_{i}@example.com", 
                    name=f"Dummy User {i}", 
                    hashed_password="hashed_pwd"
                )
                session.add(u)
            session.commit()
            users = session.exec(select(User).limit(5)).all()

        print(f"Found {len(users)} users. Generating specialists...")

        # Clear existing specialists just in case
        existing = session.exec(select(Specialist)).all()
        for s in existing:
            session.delete(s)
        session.commit()

        # Dummy data
        mock_data = [
            {
                "first_name": "Анна",
                "last_name": "Иванова",
                "photo_url": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=600&auto=format&fit=crop",
                "tagline": "Клинический психолог, КПТ-терапевт",
                "bio": "Помогаю справиться с тревожностью, паническими атаками и выгоранием. Работаю в научно-доказательном подходе (КПТ). Моя главная цель — дать вам инструменты для самопомощи.",
                "specializations": ["Тревожность", "Депрессия", "Выгорание", "Панические атаки"],
                "formats": ["ONLINE", "OFFLINE_ROOM"],
                "base_price_gel": 150,
            },
            {
                "first_name": "Михаил",
                "last_name": "Петров",
                "photo_url": "https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=600&auto=format&fit=crop",
                "tagline": "Гештальт-терапевт, семейный психолог",
                "bio": "Работаю с парами и индивидуально. Помогаю прожить кризисы в отношениях, найти опору в себе и научиться выстраивать здоровые границы.",
                "specializations": ["Отношения", "Личные границы", "Кризисы", "Самооценка"],
                "formats": ["ONLINE", "OFFLINE_CAPSULE"],
                "base_price_gel": 180,
            },
             {
                "first_name": "Елена",
                "last_name": "Смирнова",
                "photo_url": "https://images.unsplash.com/photo-1551836022-d5d88e9218df?q=80&w=600&auto=format&fit=crop",
                "tagline": "EMDR-терапевт, работа с травмой",
                "bio": "Специализируюсь на последствиях психологических травм и ПТСР. Бережно и безопасно помогаю переработать тяжелый опыт.",
                "specializations": ["ПТСР", "Травмы", "Стресс", "Тревожность"],
                "formats": ["ONLINE", "OFFLINE_ROOM"],
                "base_price_gel": 200,
            }
        ]

        for i, data in enumerate(mock_data):
            if i < len(users):
                spec = Specialist(
                    **data,
                    user_id=users[i].id,
                    is_verified=True
                )
                session.add(spec)
        
        session.commit()
        print("Successfully seeded 3 verified specialists!")

if __name__ == "__main__":
    asyncio.run(seed_specialists())
