"""Refresh Микола Корень's Specialist profile (tagline + bio + specializations).

Built 2026-05-24 after reviewing Mykola's public catalogue card against
peers and agreeing the founder positioning + unique focuses (business
therapy, masculinity work) were underrepresented. The earlier card had
13 generic specialization tags and no mention of founder role / sub-niches
he leads.

Matches by specialist.id (hard-coded) so we never accidentally touch the
wrong row even if names get reformatted in the DB later. Dry-run by
default; --apply commits.
"""
import argparse
import sys

sys.path.insert(0, "/var/www/unbox-beta/backend")
from sqlmodel import Session
from app.db.session import engine
from app.models.specialist import Specialist


SPECIALIST_ID = "b02f8326-f2cf-4c2f-be81-ec432a887d31"

NEW_TAGLINE = "Психолог · гештальт-терапевт · сексолог · в профессии с 2016"

NEW_BIO = """Основатель Unbox — в 2020 году создал бренд и центр, в основе которого идея «распаковки» человека. Принимаю клиентов лично с 2016 года.

## Метод и подход
Работаю в гештальт-подходе, интегрируя телесную осознанность, психодраму и феноменологический взгляд. Контакт с клиентом строю на честности и открытости.

## С кем работаю
Взрослые, подростки 14+, пары (семейные, партнёрские, квир и др.). Отдельные направления — работа с предпринимателями и мужские проекты.

## Ключевые направления
Бизнес-терапия. Работа с предпринимателями: выгорание в проекте, конфликты с партнёрами, поиск опоры и смысла в результате. Опираюсь на собственный предпринимательский опыт.

Мужественность, предназначение, взросление. Мужские группы и индивидуальная работа, посвящённая переходу к зрелости.

Работа с темами сексуальности и сексология. Самостоятельное направление практики.

## Философия
В человеке уже есть всё, что ему нужно. Роль терапевта скромная — помочь это увидеть и распаковать. Из этой идеи вырос Unbox.

## Образование
Киевский Гештальт университет, Киевский институт Гештальта и Психодрамы, Национальная академия педагогических наук Украины (магистр психологии).

## Длительность
50 минут.

## Языки
Русский, украинский.

_В профессии с 2016 года._"""

NEW_SPECIALIZATIONS = [
    "Бизнес-терапия",
    "Мужественность / предназначение",
    "Сексуальность",
    "Возрастные кризисы",
    "Семейные конфликты",
    "Отношения",
    "Самооценка",
    "Кризисные состояния",
]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()

    with Session(engine) as s:
        sp = s.get(Specialist, SPECIALIST_ID)
        if not sp:
            print(f"❌ Specialist {SPECIALIST_ID} not found")
            return 1

        print(f"Target: {sp.first_name} {sp.last_name}  (id={sp.id})")
        print(f"  current tagline:  {sp.tagline!r}")
        print(f"  current bio len:  {len(sp.bio or '')} chars")
        print(f"  current specs:    {len(sp.specializations or [])} tags")
        print()
        print(f"New tagline:        {NEW_TAGLINE!r}")
        print(f"New bio len:        {len(NEW_BIO)} chars")
        print(f"New specs:          {len(NEW_SPECIALIZATIONS)} tags")
        print(f"  {NEW_SPECIALIZATIONS}")

        if not args.apply:
            print("\nDRY-RUN — pass --apply to commit")
            return 0

        sp.tagline = NEW_TAGLINE
        sp.bio = NEW_BIO
        sp.specializations = NEW_SPECIALIZATIONS
        s.add(sp)
        s.commit()
        print("\n✅ Updated. View at https://unbox.com.ge/specialists")
    return 0


if __name__ == "__main__":
    sys.exit(main())
