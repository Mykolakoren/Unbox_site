"""Seed/sync 21 specialists from unbox.center catalogue (snapshot 2026-05-23).

Source: https://www.unbox.center/specialists — list scraped 2026-05-23.
Each row holds the canonical name, role/title, category, year they started
practicing, and a starter specialization list. No photos/bios/prices in
this seed — those stay admin-editable.

Matching rule:
  * Look up an existing Specialist by (first_name, last_name) — case-
    insensitive, trimmed. If found: update ONLY `specializations` and
    `tagline` to keep the catalogue text current; never overwrite
    photo_url / bio / base_price_gel / payment_accounts — those are
    admin-tended fields and the admin's edits must survive a re-run.
  * If not found: create a new Specialist with sensible defaults
    (is_verified=False, application_status="legacy" so it skips the
    "pending review" inbox), so the catalogue grows in but admins still
    have to flip the verified flag for it to surface publicly.

Idempotent: re-running just refreshes specializations/tagline; safe.

Run on Droplet:
  cd /var/www/unbox/backend
  .venv/bin/python scripts/seed_specialists_from_unbox_center.py            # dry
  .venv/bin/python scripts/seed_specialists_from_unbox_center.py --apply
"""
import argparse
import sys
from typing import Optional

sys.path.insert(0, "/var/www/unbox/backend")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.specialist import Specialist


# Each entry: (first_name, last_name, role/tagline, category, started_year,
#              specializations)
# Per owner 2026-05-24: Яна Педан и Юлия Рожек НЕ показываются в публичном
# каталоге специалистов (они в команде Unbox, но клиентов через сайт не
# принимают). Микола Корень — это владелец, его карточка уже есть в БД
# с personal_discount=100% — не пересоздавать. Список снизу — только те,
# кто реально доступен для записи через каталог.
SPECIALISTS: list[tuple[str, str, str, str, Optional[int], list[str]]] = [
    ("Галина", "Иващенко", "Сертифицированный гештальт-терапевт", "psychology", 2020,
     ["gestalt"]),
    ("Елена", "Райская", "Психолог", "psychology", 2021,
     ["general_psychology"]),
    ("Ольга", "Малыш", "КПТ-психолог · сексолог", "psychology", 2022,
     ["cbt", "sexology"]),
    ("Галина", "Баженова", "Клинический и кризисный психолог", "psychology", 2015,
     ["clinical_psychology", "crisis_intervention"]),
    ("Евгения", "Трофименко", "Психосексолог · психодрама-терапевт", "psychology", 2021,
     ["sexotherapy", "psychodrama"]),
    ("Екатерина", "Слобода", "Психотерапевт · психоаналитик", "psychology", 2019,
     ["psychoanalysis"]),
    ("Марина", "Бусина", "Детский и подростковый клинический психолог, арт-терапевт",
     "psychology", 2018,
     ["child_adolescent", "neuropsychology", "art_therapy"]),
    ("Алина", "Ларионова", "Психолог", "psychology", 2023,
     ["general_psychology"]),
    ("Катерина", "Кариманидзе", "Психолог-консультант · НЛП-тренер", "psychology", 2022,
     ["nlp", "general_psychology"]),
    ("Ирина", "Кастрыкина", "Психолог · психотерапевт", "psychology", 2020,
     ["general_psychotherapy"]),
    ("Анна", "Неменова", "Психолог", "psychology", 2004,
     ["general_psychology"]),
    ("Алексей", "Давыдыч", "Психолог", "psychology", 2023,
     ["general_psychology"]),
    ("Софья", "Дегтярева", "Психолог-консультант", "psychology", 2023,
     ["consulting_psychology"]),
    ("Тамрико", "Габаидзе", "Психолог", "psychology", 2023,
     ["general_psychology"]),
    ("Светлана", "Розова", "Практический психолог · травма-терапевт", "psychology", 2008,
     ["trauma_therapy", "ergotherapy"]),
    ("Мария", "Булатова", "Гештальт-коуч", "coaching", 2023,
     ["gestalt", "coaching"]),
    ("Мария", "Августовских", "Невролог", "psychiatry", 2017,
     ["neurology"]),
    ("Валерия", "Костенецкая", "Психиатр", "psychiatry", 2013,
     ["psychiatry"]),
]


def normalize(s: str) -> str:
    return (s or "").strip().lower()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--no-create", action="store_true",
                        help="Only update existing rows; never create new "
                             "Specialist rows. Use when name spellings might "
                             "differ (Корень/Корен, Софья/София).")
    args = parser.parse_args()

    created = 0
    updated = 0
    unchanged = 0

    with Session(engine) as session:
        existing = session.exec(select(Specialist)).all()
        # Build lookup by (first, last) lowercased
        by_name = {(normalize(s.first_name), normalize(s.last_name)): s for s in existing}

        print(f"DB now has {len(existing)} Specialist rows. Sync plan:\n")

        for first, last, role, category, year, specs in SPECIALISTS:
            key = (normalize(first), normalize(last))
            row = by_name.get(key)
            tagline = role
            if year:
                tagline = f"{role} · в профессии с {year}"
            if row is None:
                if args.no_create:
                    print(f"  [{'skipped (no-create)':30s}] {first} {last}  ({category}, {year or '—'})")
                    continue
                action = "CREATE"
                if args.apply:
                    sp = Specialist(
                        first_name=first,
                        last_name=last,
                        tagline=tagline,
                        bio="",
                        photo_url=None,
                        specializations=specs,
                        formats=["ONLINE", "OFFLINE"],
                        base_price_gel=0,
                        category=category,
                        is_verified=False,
                        application_status="legacy",
                    )
                    session.add(sp)
                created += 1
            else:
                # Update specializations + tagline (admin-safe fields).
                changed_fields = []
                new_specs = list(set(list(row.specializations or []) + specs))
                if sorted(new_specs) != sorted(row.specializations or []):
                    changed_fields.append("specializations")
                    if args.apply:
                        row.specializations = new_specs
                if (row.tagline or "") != tagline:
                    changed_fields.append("tagline")
                    if args.apply:
                        row.tagline = tagline
                if (row.category or "") != category:
                    changed_fields.append("category")
                    if args.apply:
                        row.category = category
                if changed_fields:
                    action = "UPDATE " + ",".join(changed_fields)
                    if args.apply:
                        session.add(row)
                    updated += 1
                else:
                    action = "unchanged"
                    unchanged += 1

            print(f"  [{action:30s}] {first} {last}  ({category}, {year or '—'})")

        if args.apply:
            session.commit()
            print(f"\n✅ Committed: created={created}, updated={updated}, unchanged={unchanged}")
        else:
            print(f"\nDRY-RUN: would create={created}, update={updated}, unchanged={unchanged}")
            print("        pass --apply to commit")

    return 0


if __name__ == "__main__":
    sys.exit(main())
