import os
import sys

# Add backend directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlmodel import Session, select
from app.db.session import engine
from app.models import Location, Resource

locs = [
    {"id": "unbox_one", "name": "Unbox One", "address": "Палиашвили, 4", "features": ["24/7 доступ", "Кофе/Чай", "Wi-Fi"], "lat": 41.7118, "lng": 44.7770},
    {"id": "unbox_uni", "name": "Unbox Uni", "address": "Тбел Абусеридзе, 38", "features": ["24/7 доступ", "Кофе/Чай", "Wi-Fi", "Зона отдыха"], "lat": 41.6373, "lng": 41.6146},
    {"id": "neo_school", "name": "Neo School", "address": "Алесандра Сулаберидзе, 80", "features": ["Большие аудитории", "Мероприятия"], "lat": 41.6420, "lng": 41.6350}
]

res = [
    {
        "id": "unbox_one_room_1", "name": "Кабинет 1", "type": "cabinet", "hourly_rate": 20, "capacity": 4,
        "location_id": "unbox_one", "area": 9, "min_booking_hours": 1, "formats": ["individual"],
        "description": "Компактный кабинет для индивидуальной, детской и семейной терапии."
    },
    {
        "id": "unbox_one_room_2", "name": "Кабинет 2", "type": "cabinet", "hourly_rate": 20, "capacity": 10,
        "location_id": "unbox_one", "area": 12, "min_booking_hours": 1, "formats": ["individual", "group"],
        "description": "Универсальный кабинет для индивидуальной работы, семейных консультаций и малых групп."
    },
    {
        "id": "unbox_uni_room_5", "name": "Кабинет 5", "type": "cabinet", "hourly_rate": 20, "capacity": 4,
        "location_id": "unbox_uni", "area": 10, "min_booking_hours": 1, "formats": ["individual"],
        "description": "Кабинет для индивидуальной, детской и семейной терапии."
    },
    {
        "id": "unbox_uni_room_6", "name": "Кабинет 6", "type": "cabinet", "hourly_rate": 20, "capacity": 10,
        "location_id": "unbox_uni", "area": 16, "min_booking_hours": 1, "formats": ["individual", "group"],
        "description": "Кабинет подходит для индивидуальной и групповой работы, а также для работы с детьми и семейных консультаций."
    },
    {
        "id": "unbox_uni_room_7", "name": "Кабинет 7", "type": "cabinet", "hourly_rate": 20, "capacity": 20,
        "location_id": "unbox_uni", "area": 25, "min_booking_hours": 1, "formats": ["individual", "group"],
        "description": "Большой кабинет для групповых встреч, тренингов, лекций и мероприятий."
    },
    {
        "id": "unbox_uni_room_8", "name": "Кабинет 8", "type": "cabinet", "hourly_rate": 20, "capacity": 20,
        "location_id": "unbox_uni", "area": 20, "min_booking_hours": 1, "formats": ["individual", "group"],
        "description": "Просторный кабинет для групповой и индивидуальной работы."
    },
    {
        "id": "unbox_uni_capsule_1", "name": "Капсула 1", "type": "capsule", "hourly_rate": 10, "capacity": 1,
        "location_id": "unbox_uni", "area": 2, "min_booking_hours": 1, "formats": ["individual"],
        "description": "Индивидуальная капсула для онлайн-сессий и сосредоточенной работы."
    },
    {
        "id": "unbox_uni_capsule_2", "name": "Капсула 2", "type": "capsule", "hourly_rate": 10, "capacity": 1,
        "location_id": "unbox_uni", "area": 2, "min_booking_hours": 1, "formats": ["individual"],
        "description": "Индивидуальная капсула для онлайн-сессий и сосредоточенной работы."
    },
    {
        "id": "unbox_uni_room_9", "name": "Кабинет 9", "type": "cabinet", "hourly_rate": 20, "capacity": 4,
        "location_id": "unbox_uni", "area": 10, "min_booking_hours": 1, "formats": ["individual"],
        "description": "Кабинет для индивидуальной, детской и семейной терапии."
    },
    {
        "id": "neo_school_room_1", "name": "Аудитория 1", "type": "cabinet", "hourly_rate": 30, "capacity": 35,
        "location_id": "neo_school", "area": 40, "min_booking_hours": 2, "formats": ["group"],
        "description": "Большая аудитория для масштабных мероприятий, лекций и мастер-классов."
    }
]

def seed():
    with Session(engine) as session:
        print("Seeding Locations...")
        for l in locs:
            if not session.exec(select(Location).where(Location.id == l["id"])).first():
                session.add(Location(**l))
        
        print("Seeding Resources...")
        for r in res:
            if not session.exec(select(Resource).where(Resource.id == r["id"])).first():
                session.add(Resource(**r))
                
        session.commit()
        print("Done!")

if __name__ == "__main__":
    seed()
