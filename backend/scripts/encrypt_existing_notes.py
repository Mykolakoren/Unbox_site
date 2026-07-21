"""Разовое зашифровывание заметок, записанных до включения шифрования.

Новые заметки шифруются сами (колонка EncryptedText). Старые лежат
открытым текстом и читаются как есть — этот скрипт перезаписывает их,
чтобы в базе не осталось открытого текста.

Хитрость: через ORM старое значение читается как открытый текст, и простое
присваивание того же значения SQLAlchemy сочтёт «ничего не изменилось».
Поэтому помечаем поле изменённым руками (flag_modified).

  cd /var/www/unbox/backend && venv/bin/python3 scripts/encrypt_existing_notes.py --dry-run
  cd /var/www/unbox/backend && venv/bin/python3 scripts/encrypt_existing_notes.py

Идемпотентно: уже зашифрованные пропускаются.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm.attributes import flag_modified  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.services import note_crypto  # noqa: E402
from app.models.therapist_note import TherapistNote  # noqa: E402
from app.models.therapy_session import TherapySession  # noqa: E402

TARGETS = [
    ("therapist_notes", "content", TherapistNote, "content"),
    ("therapy_sessions", "notes", TherapySession, "notes"),
]


def run(dry_run: bool) -> int:
    tag = "[холостой] " if dry_run else ""
    if not note_crypto.is_enabled():
        print("ОСТАНОВ: NOTES_ENCRYPTION_KEY не задан — шифровать нечем.")
        return 1

    with Session(engine) as session:
        for table, column, model, attr in TARGETS:
            # Сырым запросом находим строки, которые ЕЩЁ не зашифрованы.
            rows = session.exec(
                text(f"SELECT id FROM {table} WHERE {column} IS NOT NULL "
                     f"AND {column} <> '' AND {column} NOT LIKE :pref")
                .bindparams(pref=note_crypto.PREFIX + "%")
            ).all()
            ids = [r[0] for r in rows]
            print(f"{tag}{table}.{column}: открытым текстом {len(ids)} шт")
            if dry_run or not ids:
                continue
            for obj in session.exec(select(model).where(model.id.in_(ids))).all():  # type: ignore[attr-defined]
                value = getattr(obj, attr)
                setattr(obj, attr, value)
                flag_modified(obj, attr)   # заставляем перезаписать
                session.add(obj)
            session.commit()
            print(f"  зашифровано: {len(ids)}")

        # Контроль: не осталось ли открытого текста.
        print(f"\n{tag}проверка после:")
        for table, column, _, _ in TARGETS:
            left = session.exec(
                text(f"SELECT count(*) FROM {table} WHERE {column} IS NOT NULL "
                     f"AND {column} <> '' AND {column} NOT LIKE :pref")
                .bindparams(pref=note_crypto.PREFIX + "%")
            ).one()[0]
            print(f"  {table}.{column}: открытым текстом осталось {left}")
    return 0


if __name__ == "__main__":
    sys.exit(run("--dry-run" in sys.argv))
