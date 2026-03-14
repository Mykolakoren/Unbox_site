"""Seed 12 test specialists across all 5 categories. Run: python3 seed_specialists.py"""
from sqlmodel import Session, select
from app.db.session import engine
from app.models.user import User
from app.models.specialist import Specialist
import uuid

SPECIALISTS_DATA = [
    # psychology ──────────────────────────────────────────────────────
    {"first_name":"Анна","last_name":"Иванова","photo_url":"https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=600&auto=format&fit=crop","tagline":"Клинический психолог, КПТ-терапевт","bio":"Помогаю справиться с тревожностью, паническими атаками и выгоранием.","specializations":["Тревожность","Депрессия","Выгорание","Панические атаки"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":150,"category":"psychology"},
    {"first_name":"Михаил","last_name":"Петров","photo_url":"https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=600&auto=format&fit=crop","tagline":"Гештальт-терапевт, семейный психолог","bio":"Работаю с парами и индивидуально. Помогаю прожить кризисы в отношениях.","specializations":["Отношения","Личные границы","Кризисы","Самооценка"],"formats":["ONLINE","OFFLINE_CAPSULE"],"base_price_gel":180,"category":"psychology"},
    {"first_name":"Елена","last_name":"Смирнова","photo_url":"https://images.unsplash.com/photo-1551836022-d5d88e9218df?q=80&w=600&auto=format&fit=crop","tagline":"EMDR-терапевт, работа с травмой","bio":"Специализируюсь на ПТСР и психологических травмах.","specializations":["ПТСР","Травмы","Стресс","Тревожность"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":200,"category":"psychology"},
    # psychiatry ──────────────────────────────────────────────────────
    {"first_name":"Дмитрий","last_name":"Захаров","photo_url":"https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?q=80&w=600&auto=format&fit=crop","tagline":"Психиатр, психофармаколог","bio":"15 лет практики в клинической психиатрии. Подбор медикаментозной терапии.","specializations":["Биполярное расстройство","Депрессия","ОКР","Психофармакология"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":250,"category":"psychiatry"},
    {"first_name":"Ольга","last_name":"Белова","photo_url":"https://images.unsplash.com/photo-1594824476967-48c8b964273f?q=80&w=600&auto=format&fit=crop","tagline":"Психиатр, детский и подростковый","bio":"Работаю с детьми, подростками и взрослыми. СДВГ и тревожные расстройства.","specializations":["СДВГ","Тревожные расстройства","Расстройства сна","Подростки"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":230,"category":"psychiatry"},
    # narcology ───────────────────────────────────────────────────────
    {"first_name":"Артём","last_name":"Волков","photo_url":"https://images.unsplash.com/photo-1622253692010-333f2da6031d?q=80&w=600&auto=format&fit=crop","tagline":"Нарколог, специалист по зависимостям","bio":"Помогаю выйти из зависимостей и вернуться к полноценной жизни.","specializations":["Алкогольная зависимость","Игровая зависимость","Пищевые расстройства"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":220,"category":"narcology"},
    {"first_name":"Наталья","last_name":"Крылова","photo_url":"https://images.unsplash.com/photo-1559839734-2b71ea197ec2?q=80&w=600&auto=format&fit=crop","tagline":"Невролог, специалист по психосоматике","bio":"Работаю на стыке неврологии и психологии — бессонница, головные боли, психосоматика.","specializations":["Психосоматика","Бессонница","Головные боли","Хронический стресс"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":240,"category":"narcology"},
    # coaching ────────────────────────────────────────────────────────
    {"first_name":"Сергей","last_name":"Морозов","photo_url":"https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=600&auto=format&fit=crop","tagline":"ICF-коуч, карьерный консультант","bio":"Помогаю найти призвание, выстроить карьеру и достичь баланса.","specializations":["Карьера","Личная эффективность","Целеполагание","Work-life balance"],"formats":["ONLINE","OFFLINE_CAPSULE"],"base_price_gel":160,"category":"coaching"},
    {"first_name":"Виктория","last_name":"Соколова","photo_url":"https://images.unsplash.com/photo-1580489944761-15a19d654956?q=80&w=600&auto=format&fit=crop","tagline":"Бизнес-коуч, фасилитатор","bio":"Работаю с предпринимателями и командами. Выход из операционного хаоса.","specializations":["Бизнес","Команды","Стратегия","Лидерство"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":200,"category":"coaching"},
    # education ───────────────────────────────────────────────────────
    {"first_name":"Алина","last_name":"Кузнецова","photo_url":"https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=600&auto=format&fit=crop","tagline":"Игропрактик, детский психолог","bio":"Через игру помогаю детям 4–12 лет развить эмоциональный интеллект.","specializations":["Дети","Игротерапия","Страхи","Социальная адаптация"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":140,"category":"education"},
    {"first_name":"Павел","last_name":"Лебедев","photo_url":"https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=600&auto=format&fit=crop","tagline":"Педагог-психолог, тренинги","bio":"Групповые и индивидуальные занятия для взрослых — коммуникация, конфликты, стресс.","specializations":["Коммуникация","Конфликты","Тренинги","Групповая работа"],"formats":["ONLINE","OFFLINE_ROOM"],"base_price_gel":120,"category":"education"},
    {"first_name":"Марина","last_name":"Фёдорова","photo_url":"https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?q=80&w=600&auto=format&fit=crop","tagline":"Нейропедагог, обучение взрослых","bio":"Помогаю взрослым освоить новые навыки и улучшить память через нейрообразование.","specializations":["Нейрообразование","Память","Внимание","Обучение взрослых"],"formats":["ONLINE","OFFLINE_CAPSULE"],"base_price_gel":130,"category":"education"},
]


def seed():
    with Session(engine) as session:
        existing = session.exec(select(Specialist)).all()
        for s in existing:
            session.delete(s)
        session.commit()
        print(f"Удалено {len(existing)} старых специалистов")

        created = 0
        for i, data in enumerate(SPECIALISTS_DATA):
            uid = uuid.uuid4()
            user = User(
                email=f"seed_spec_{i}_{uid.hex[:6]}@unbox.test",
                name=f"{data['first_name']} {data['last_name']}",
                telegram_id=str(uid.int)[:12],
            )
            session.add(user)
            session.flush()

            spec = Specialist(
                first_name=data["first_name"],
                last_name=data["last_name"],
                photo_url=data.get("photo_url"),
                tagline=data["tagline"],
                bio=data["bio"],
                specializations=data["specializations"],
                formats=data["formats"],
                base_price_gel=data["base_price_gel"],
                category=data.get("category"),
                is_verified=True,
                user_id=user.id,
            )
            session.add(spec)
            created += 1

        session.commit()
        print(f"✓ Создано {created} специалистов:")
        for d in SPECIALISTS_DATA:
            print(f"  [{d['category']}] {d['first_name']} {d['last_name']}")


if __name__ == "__main__":
    seed()
