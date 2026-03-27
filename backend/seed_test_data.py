"""
Comprehensive test data seeder for UnboxCRM.
Creates locations, resources, users with different roles, bookings, and CRM data.
Run: cd backend && source venv/bin/activate && python seed_test_data.py
"""
import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime, timedelta
from uuid import uuid4
from sqlmodel import Session, select
from app.db.session import engine, init_db
from app.models.location import Location
from app.models.resource import Resource
from app.models.user import User
from app.models.booking import Booking
from app.core.security import get_password_hash

# ─── 1. Locations ────────────────────────────────────────────────────────────

LOCATIONS = [
    {
        "id": "unbox_one",
        "name": "Unbox One",
        "address": "ул. Палиашвили, 4, Тбилиси",
        "features": ["24/7 доступ", "Кофе/Чай", "Wi-Fi", "Кондиционер"],
        "lat": 41.7118, "lng": 44.7770,
        "is_active": True,
    },
    {
        "id": "unbox_uni",
        "name": "Unbox Uni",
        "address": "ул. Тбел Абусеридзе, 38, Батуми",
        "features": ["24/7 доступ", "Кофе/Чай", "Wi-Fi", "Зона отдыха", "Кондиционер"],
        "lat": 41.6373, "lng": 41.6146,
        "is_active": True,
    },
    {
        "id": "neo_school",
        "name": "Neo School",
        "address": "ул. Александра Сулаберидзе, 80, Батуми",
        "features": ["Большие аудитории", "Мероприятия", "Проектор"],
        "lat": 41.6420, "lng": 41.6350,
        "is_active": True,
    },
]

# ─── 2. Resources ────────────────────────────────────────────────────────────

RESOURCES = [
    # Unbox One
    {"id": "unbox_one_room_1", "name": "Кабинет 1", "type": "cabinet", "hourly_rate": 20, "capacity": 4,
     "location_id": "unbox_one", "area": 9, "min_booking_hours": 1, "formats": ["individual"],
     "description": "Компактный кабинет для индивидуальной, детской и семейной терапии."},
    {"id": "unbox_one_room_2", "name": "Кабинет 2", "type": "cabinet", "hourly_rate": 20, "capacity": 10,
     "location_id": "unbox_one", "area": 12, "min_booking_hours": 1, "formats": ["individual", "group"],
     "description": "Универсальный кабинет для индивидуальной работы, семейных консультаций и малых групп."},
    # Unbox Uni
    {"id": "unbox_uni_room_5", "name": "Кабинет 5", "type": "cabinet", "hourly_rate": 20, "capacity": 4,
     "location_id": "unbox_uni", "area": 10, "min_booking_hours": 1, "formats": ["individual"],
     "description": "Кабинет для индивидуальной, детской и семейной терапии."},
    {"id": "unbox_uni_room_6", "name": "Кабинет 6", "type": "cabinet", "hourly_rate": 20, "capacity": 10,
     "location_id": "unbox_uni", "area": 16, "min_booking_hours": 1, "formats": ["individual", "group"],
     "description": "Кабинет для индивидуальной и групповой работы, детской терапии и семейных консультаций."},
    {"id": "unbox_uni_room_7", "name": "Кабинет 7", "type": "cabinet", "hourly_rate": 20, "capacity": 20,
     "location_id": "unbox_uni", "area": 25, "min_booking_hours": 1, "formats": ["individual", "group"],
     "description": "Большой кабинет для групповых встреч, тренингов, лекций и мероприятий."},
    {"id": "unbox_uni_room_8", "name": "Кабинет 8", "type": "cabinet", "hourly_rate": 20, "capacity": 20,
     "location_id": "unbox_uni", "area": 20, "min_booking_hours": 1, "formats": ["individual", "group"],
     "description": "Просторный кабинет для групповой и индивидуальной работы."},
    {"id": "unbox_uni_room_9", "name": "Кабинет 9", "type": "cabinet", "hourly_rate": 20, "capacity": 10,
     "location_id": "unbox_uni", "area": 16, "min_booking_hours": 1, "formats": ["individual", "group"],
     "description": "Уютный кабинет для индивидуальной и групповой работы."},
    {"id": "unbox_uni_capsule_1", "name": "Капсула 1", "type": "capsule", "hourly_rate": 10, "capacity": 1,
     "location_id": "unbox_uni", "area": 2, "min_booking_hours": 1, "formats": ["individual"],
     "description": "Индивидуальная капсула для онлайн-сессий и сосредоточенной работы."},
    {"id": "unbox_uni_capsule_2", "name": "Капсула 2", "type": "capsule", "hourly_rate": 10, "capacity": 1,
     "location_id": "unbox_uni", "area": 2, "min_booking_hours": 1, "formats": ["individual"],
     "description": "Индивидуальная капсула для онлайн-сессий и сосредоточенной работы."},
    # Neo School
    {"id": "neo_school_room_1", "name": "Аудитория 1", "type": "cabinet", "hourly_rate": 30, "capacity": 35,
     "location_id": "neo_school", "area": 40, "min_booking_hours": 2, "formats": ["group"],
     "description": "Большая аудитория для масштабных мероприятий, лекций и мастер-классов."},
]

# ─── 3. Users ─────────────────────────────────────────────────────────────────

USERS = [
    # Owner (already created by init_data, but let's ensure)
    {
        "email": "admin@unbox.com", "name": "Николас Корен", "phone": "+995555100100",
        "role": "owner", "is_admin": True, "balance": 500.0,
        "password": "admin123",
    },
    # Senior Admin
    {
        "email": "anna@unbox.com", "name": "Анна Менеджер", "phone": "+995555200200",
        "role": "senior_admin", "is_admin": True, "balance": 200.0,
        "password": "test123",
    },
    # Admin
    {
        "email": "luka@unbox.com", "name": "Лука Админ", "phone": "+995555300300",
        "role": "admin", "is_admin": True, "balance": 100.0,
        "password": "test123",
    },
    # Specialist (psychologist)
    {
        "email": "marina@therapy.ge", "name": "Марина Психолог", "phone": "+995555400400",
        "role": "specialist", "is_admin": False, "balance": 80.0,
        "password": "test123",
        "permissions": ["psy_crm.access", "psy_crm.clients", "psy_crm.sessions", "psy_crm.finances"],
    },
    # Specialist 2
    {
        "email": "david@therapy.ge", "name": "Давид Терапевт", "phone": "+995555500500",
        "role": "specialist", "is_admin": False, "balance": 120.0,
        "password": "test123",
        "permissions": ["psy_crm.access", "psy_crm.clients", "psy_crm.sessions", "psy_crm.finances"],
    },
    # Regular user with subscription
    {
        "email": "nino@gmail.com", "name": "Нино Клиент", "phone": "+995555600600",
        "role": "user", "is_admin": False, "balance": 150.0,
        "password": "test123",
        "subscription": {
            "plan_id": "standard_10",
            "plan_name": "Стандарт 10",
            "remaining_hours": 7.0,
            "used_hours": 3.0,
            "total_hours": 10.0,
            "included_formats": ["individual"],
            "discount_percent": 10,
            "is_frozen": False,
            "activated_at": "2026-03-01T10:00:00",
            "expires_at": "2026-04-01T10:00:00",
        },
    },
    # Regular user without subscription
    {
        "email": "giorgi@gmail.com", "name": "Гиорги Пользователь", "phone": "+995555700700",
        "role": "user", "is_admin": False, "balance": 60.0,
        "password": "test123",
    },
    # User with personal discount
    {
        "email": "tamara@gmail.com", "name": "Тамара VIP", "phone": "+995555800800",
        "role": "user", "is_admin": False, "balance": 300.0,
        "password": "test123",
        "pricing_system": "personal",
        "personal_discount_percent": 25,
    },
    # User with low balance (edge case)
    {
        "email": "irakli@gmail.com", "name": "Ираклий Нулевой", "phone": "+995555900900",
        "role": "user", "is_admin": False, "balance": 5.0,
        "password": "test123",
    },
]

# ─── Seed function ───────────────────────────────────────────────────────────

def seed():
    init_db()

    with Session(engine) as session:
        # --- Locations ---
        print("📍 Seeding locations...")
        for loc_data in LOCATIONS:
            existing = session.exec(select(Location).where(Location.id == loc_data["id"])).first()
            if existing:
                for k, v in loc_data.items():
                    setattr(existing, k, v)
                session.add(existing)
                print(f"   ↻ Updated: {loc_data['name']}")
            else:
                session.add(Location(**loc_data))
                print(f"   + Created: {loc_data['name']}")
        session.commit()

        # --- Resources ---
        print("\n🏠 Seeding resources...")
        for res_data in RESOURCES:
            existing = session.exec(select(Resource).where(Resource.id == res_data["id"])).first()
            if existing:
                for k, v in res_data.items():
                    setattr(existing, k, v)
                session.add(existing)
                print(f"   ↻ Updated: {res_data['name']} ({res_data['location_id']})")
            else:
                session.add(Resource(**res_data))
                print(f"   + Created: {res_data['name']} ({res_data['location_id']})")
        session.commit()

        # --- Users ---
        print("\n👥 Seeding users...")
        user_map = {}  # email -> User object
        for user_data in USERS:
            existing = session.exec(select(User).where(User.email == user_data["email"])).first()
            password = user_data.pop("password")

            if existing:
                # Update fields but don't overwrite balance if it was already set
                for k, v in user_data.items():
                    if k not in ("balance",):  # preserve balance
                        setattr(existing, k, v)
                session.add(existing)
                user_map[user_data["email"]] = existing
                print(f"   ↻ Updated: {user_data['name']} ({user_data['role']})")
            else:
                hashed = get_password_hash(password)
                db_user = User(**user_data, hashed_password=hashed)
                session.add(db_user)
                session.flush()  # get ID
                user_map[user_data["email"]] = db_user
                print(f"   + Created: {user_data['name']} ({user_data['role']}) pass={password}")
        session.commit()

        # Refresh user_map after commit
        for email in user_map:
            user_map[email] = session.exec(select(User).where(User.email == email)).first()

        # --- Bookings ---
        print("\n📅 Seeding bookings...")
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        bookings_data = [
            # Past bookings (confirmed -> will show as completed)
            {
                "resource_id": "unbox_one_room_1", "location_id": "unbox_one",
                "date": today - timedelta(days=3), "start_time": "10:00", "duration": 60,
                "status": "confirmed", "final_price": 20.0, "base_price": 20.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "marina@therapy.ge",
                "applied_rule": "NONE", "discount_amount": 0, "discount_percent": 0,
            },
            {
                "resource_id": "unbox_one_room_2", "location_id": "unbox_one",
                "date": today - timedelta(days=2), "start_time": "14:00", "duration": 120,
                "status": "confirmed", "final_price": 36.0, "base_price": 40.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "nino@gmail.com",
                "applied_rule": "CONSECUTIVE_HOURS", "discount_amount": 4.0, "discount_percent": 10,
            },
            {
                "resource_id": "unbox_uni_room_6", "location_id": "unbox_uni",
                "date": today - timedelta(days=1), "start_time": "09:00", "duration": 60,
                "status": "cancelled", "final_price": 0.0, "base_price": 20.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "giorgi@gmail.com",
                "cancellation_reason": "User cancelled", "cancelled_by": "giorgi@gmail.com",
                "applied_rule": "NONE", "discount_amount": 0, "discount_percent": 0,
            },
            # Today bookings
            {
                "resource_id": "unbox_one_room_1", "location_id": "unbox_one",
                "date": today, "start_time": "09:00", "duration": 120,
                "status": "confirmed", "final_price": 36.0, "base_price": 40.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "marina@therapy.ge",
                "applied_rule": "CONSECUTIVE_HOURS", "discount_amount": 4.0, "discount_percent": 10,
            },
            {
                "resource_id": "unbox_one_room_2", "location_id": "unbox_one",
                "date": today, "start_time": "11:00", "duration": 60,
                "status": "confirmed", "final_price": 0.0, "base_price": 20.0,
                "payment_method": "subscription", "format": "individual",
                "user_email": "nino@gmail.com",
                "applied_rule": "SUBSCRIPTION", "hours_deducted": 1.0,
                "discount_amount": 0, "discount_percent": 0,
            },
            {
                "resource_id": "unbox_uni_room_5", "location_id": "unbox_uni",
                "date": today, "start_time": "15:00", "duration": 60,
                "status": "confirmed", "final_price": 20.0, "base_price": 20.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "david@therapy.ge",
                "applied_rule": "NONE", "discount_amount": 0, "discount_percent": 0,
            },
            # Future bookings (tomorrow, day after)
            {
                "resource_id": "unbox_one_room_1", "location_id": "unbox_one",
                "date": today + timedelta(days=1), "start_time": "10:00", "duration": 60,
                "status": "confirmed", "final_price": 20.0, "base_price": 20.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "marina@therapy.ge",
                "applied_rule": "NONE", "discount_amount": 0, "discount_percent": 0,
            },
            {
                "resource_id": "unbox_one_room_1", "location_id": "unbox_one",
                "date": today + timedelta(days=1), "start_time": "12:00", "duration": 120,
                "status": "confirmed", "final_price": 36.0, "base_price": 40.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "david@therapy.ge",
                "applied_rule": "CONSECUTIVE_HOURS", "discount_amount": 4.0, "discount_percent": 10,
            },
            {
                "resource_id": "unbox_one_room_2", "location_id": "unbox_one",
                "date": today + timedelta(days=1), "start_time": "09:00", "duration": 180,
                "status": "confirmed", "final_price": 15.0, "base_price": 20.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "tamara@gmail.com",
                "applied_rule": "PERSONAL_DISCOUNT", "discount_amount": 5.0, "discount_percent": 25,
            },
            {
                "resource_id": "unbox_uni_room_7", "location_id": "unbox_uni",
                "date": today + timedelta(days=2), "start_time": "10:00", "duration": 180,
                "status": "confirmed", "final_price": 51.0, "base_price": 60.0,
                "payment_method": "balance", "format": "group",
                "user_email": "david@therapy.ge",
                "applied_rule": "CONSECUTIVE_HOURS", "discount_amount": 9.0, "discount_percent": 15,
            },
            {
                "resource_id": "unbox_uni_capsule_1", "location_id": "unbox_uni",
                "date": today + timedelta(days=2), "start_time": "14:00", "duration": 60,
                "status": "confirmed", "final_price": 10.0, "base_price": 10.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "giorgi@gmail.com",
                "applied_rule": "NONE", "discount_amount": 0, "discount_percent": 0,
            },
            # Re-rent listed booking
            {
                "resource_id": "unbox_one_room_2", "location_id": "unbox_one",
                "date": today + timedelta(days=3), "start_time": "10:00", "duration": 120,
                "status": "confirmed", "final_price": 36.0, "base_price": 40.0,
                "payment_method": "balance", "format": "individual",
                "user_email": "nino@gmail.com",
                "is_re_rent_listed": True,
                "applied_rule": "CONSECUTIVE_HOURS", "discount_amount": 4.0, "discount_percent": 10,
            },
        ]

        # Clear existing bookings for clean state
        existing_bookings = session.exec(select(Booking)).all()
        if existing_bookings:
            print(f"   🗑 Clearing {len(existing_bookings)} existing bookings...")
            for b in existing_bookings:
                session.delete(b)
            session.commit()

        for bd in bookings_data:
            user_email = bd.pop("user_email")
            user = user_map.get(user_email)
            if not user:
                print(f"   ⚠ User {user_email} not found, skipping booking")
                continue

            booking = Booking(
                **bd,
                user_id=user.email,
                user_uuid=user.id,
                extras=[],
            )
            session.add(booking)
            day_label = "вчера" if bd["date"] < today else ("сегодня" if bd["date"] == today else f"+{(bd['date'] - today).days}д")
            print(f"   + {bd['resource_id'][-6:]} | {day_label} {bd['start_time']} | {bd['duration']}мин | {user.name} | {bd['status']}")

        session.commit()

        # --- Summary ---
        loc_count = len(session.exec(select(Location)).all())
        res_count = len(session.exec(select(Resource)).all())
        usr_count = len(session.exec(select(User)).all())
        bk_count = len(session.exec(select(Booking)).all())

        print(f"\n{'='*50}")
        print(f"✅ Seed complete!")
        print(f"   📍 Locations: {loc_count}")
        print(f"   🏠 Resources: {res_count}")
        print(f"   👥 Users:     {usr_count}")
        print(f"   📅 Bookings:  {bk_count}")
        print(f"{'='*50}")
        print(f"\n🔑 Test accounts (password for all non-admin: test123):")
        print(f"   Owner:       admin@unbox.com / admin123")
        print(f"   Sr. Admin:   anna@unbox.com / test123")
        print(f"   Admin:       luka@unbox.com / test123")
        print(f"   Specialist:  marina@therapy.ge / test123")
        print(f"   Specialist:  david@therapy.ge / test123")
        print(f"   User (sub):  nino@gmail.com / test123")
        print(f"   User:        giorgi@gmail.com / test123")
        print(f"   User (VIP):  tamara@gmail.com / test123")
        print(f"   User (low):  irakli@gmail.com / test123")


if __name__ == "__main__":
    seed()
