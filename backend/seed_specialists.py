"""
Seed script: populate the specialists table with real Unbox specialists.
Run on the server: cd /var/www/unbox/backend && python seed_specialists.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from sqlmodel import Session, select
from app.db.session import engine
from app.models.specialist import Specialist
from app.models.user import User

SPECIALISTS = [
    {
        "first_name": "Яна", "last_name": "Педан",
        "photo_url": "/img/specialists/yana_pedan_c.webp",
        "tagline": "Клинический психолог, гештальт-терапевт",
        "specializations": ["Тревожные расстройства", "Депрессия", "Личностные кризисы", "Работа с детьми"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 80,
        "category": "psychology",
    },
    {
        "first_name": "Николай", "last_name": "Корень",
        "photo_url": "/img/specialists/nikolaj_koren_2.webp",
        "tagline": "Психолог, гештальт-терапевт, основатель Unbox",
        "specializations": ["Гештальт-терапия", "Экзистенциальная терапия", "Кризисы идентичности", "Отношения"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 100,
        "category": "psychology",
    },
    {
        "first_name": "Галина", "last_name": "Иващенко",
        "photo_url": "/img/specialists/galina_ivaschenka.webp",
        "tagline": "Психолог, семейный терапевт",
        "specializations": ["Семейная терапия", "Детская психология", "Отношения в паре"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Елена", "last_name": "Райская",
        "photo_url": "/img/specialists/rayskaya.webp",
        "tagline": "Психолог, арт-терапевт",
        "specializations": ["Арт-терапия", "Эмоциональное выгорание", "Самооценка", "Тревога"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Ольга", "last_name": "Малыш",
        "photo_url": "/img/specialists/olga_malysh.webp",
        "tagline": "Психолог, когнитивно-поведенческая терапия",
        "specializations": ["КПТ", "Панические атаки", "Фобии", "Стресс"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Галина", "last_name": "Баженова",
        "photo_url": "/img/specialists/bazhenova.webp",
        "tagline": "Психолог, телесно-ориентированная терапия",
        "specializations": ["Телесная терапия", "Психосоматика", "Травма", "Стресс"],
        "formats": ["OFFLINE_ROOM"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Евгения", "last_name": "Трофименко",
        "photo_url": "/img/specialists/trofimenko.webp",
        "tagline": "Психолог, системная семейная терапия",
        "specializations": ["Системная терапия", "Семейные конфликты", "Родительство", "Горевание"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Екатерина", "last_name": "Слобода",
        "photo_url": "/img/specialists/sloboda.webp",
        "tagline": "Психолог, гештальт-терапевт",
        "specializations": ["Гештальт-терапия", "Самоидентификация", "Тревога", "Отношения"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Марина", "last_name": "Бусина",
        "photo_url": "/img/specialists/busina.webp",
        "tagline": "Психолог, работа с детьми и подростками",
        "specializations": ["Детская психология", "Подростковый возраст", "СДВГ", "Школьные трудности"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Алина", "last_name": "Ларионова",
        "photo_url": "/img/specialists/larionova.webp",
        "tagline": "Психолог, экзистенциальная терапия",
        "specializations": ["Экзистенциальная терапия", "Смысл жизни", "Потеря", "Одиночество"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Катерина", "last_name": "Кариманидзе",
        "photo_url": "/img/specialists/karimanidze.webp",
        "tagline": "Психолог, клинический психолог",
        "specializations": ["Клиническая психология", "Расстройства пищевого поведения", "Самоповреждение", "Депрессия"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "София", "last_name": "Дегтярёва",
        "photo_url": "/img/specialists/sofia_degtyareva.webp",
        "tagline": "Психолог, детский психолог",
        "specializations": ["Детская психология", "Игровая терапия", "Развитие", "Адаптация"],
        "formats": ["OFFLINE_ROOM"],
        "base_price_gel": 60,
        "category": "psychology",
    },
    {
        "first_name": "Тамарико", "last_name": "Габаидзе",
        "photo_url": "/img/specialists/tamariko.webp",
        "tagline": "Психолог, интегративный подход",
        "specializations": ["Интегративная терапия", "Тревога", "Депрессия", "Отношения"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 70,
        "category": "psychology",
    },
    {
        "first_name": "Светлана", "last_name": "Розова",
        "photo_url": "/img/specialists/svetlana_rozova_c.webp",
        "tagline": "Психолог, психоаналитическая терапия",
        "specializations": ["Психоанализ", "Глубинная терапия", "Сны", "Бессознательное"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 80,
        "category": "psychology",
    },
    {
        "first_name": "Юлия", "last_name": "Рожек",
        "photo_url": "/img/specialists/rozhek2.webp",
        "tagline": "ICF коуч, сооснователь Unbox",
        "specializations": ["Коучинг", "Карьера", "Лидерство", "Цели и мотивация"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 100,
        "category": "coaching",
    },
    {
        "first_name": "Мария", "last_name": "Августовских",
        "photo_url": "/img/specialists/maria_avgustovskih_c.webp",
        "tagline": "Невролог",
        "specializations": ["Неврология", "Головные боли", "Нарушения сна", "Консультации"],
        "formats": ["OFFLINE_ROOM"],
        "base_price_gel": 100,
        "category": "psychology",
    },
    {
        "first_name": "Валерия", "last_name": "Костенецкая",
        "photo_url": "/img/specialists/kosteneckaya.webp",
        "tagline": "Психиатр",
        "specializations": ["Психиатрия", "Медикаментозная терапия", "Диагностика", "Консультации"],
        "formats": ["OFFLINE_ROOM", "ONLINE"],
        "base_price_gel": 120,
        "category": "psychiatry",
    },
]


def seed():
    with Session(engine) as session:
        existing = session.exec(select(Specialist)).all()
        existing_names = {(s.first_name, s.last_name) for s in existing}

        added = 0
        for spec_data in SPECIALISTS:
            name_key = (spec_data["first_name"], spec_data["last_name"])
            if name_key in existing_names:
                print(f"  skip: {name_key[0]} {name_key[1]} (already exists)")
                continue

            # Find or create a placeholder user for this specialist
            email = f"{spec_data['last_name'].lower()}@unbox.center"
            user = session.exec(select(User).where(User.email == email)).first()
            if not user:
                user = User(
                    email=email,
                    name=f"{spec_data['first_name']} {spec_data['last_name']}",
                    hashed_password="placeholder",
                    phone="",
                    is_admin=False,
                    role="specialist",
                )
                session.add(user)
                session.flush()

            specialist = Specialist(
                user_id=user.id,
                is_verified=True,
                **spec_data,
            )
            session.add(specialist)
            added += 1
            print(f"  + {spec_data['first_name']} {spec_data['last_name']}")

        session.commit()
        print(f"\nDone: {added} specialists added, {len(existing_names)} already existed.")


if __name__ == "__main__":
    seed()
