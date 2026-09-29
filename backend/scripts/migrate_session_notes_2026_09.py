"""Разовый перенос старых «заметок в сессии» в общие Заметки (29.09).

До 29.09 шторка сессии на телефоне и окно привязки брони на десктопе писали
текст в поле therapy_sessions.notes. Это поле не показывает ни вкладка
«Заметки», ни история клиента, ни десктопная карточка — они читают только
therapist_notes. Специалист писал заметку и потом не находил её.

Скрипт копирует каждый такой текст в therapist_notes, привязывая к той же
сессии и клиенту. Ничего не удаляет: therapy_sessions.notes остаётся как
было (шторка прячет старый текст сама, когда видит его копию в Заметках).

Пропускает:
  - служебную пометку «Заявка через публичный сайт…» (её ставит бэкенд,
    это не заметка специалиста);
  - сессии, у которых такая же заметка уже есть (повторный запуск безопасен);
  - сессии, чей клиент удалён или принадлежит другому специалисту.

  cd /var/www/unbox/backend && venv/bin/python3 scripts/migrate_session_notes_2026_09.py           # холостой
  cd /var/www/unbox/backend && venv/bin/python3 scripts/migrate_session_notes_2026_09.py --apply   # записать

Текст шифруется так же, как у новых заметок (колонка EncryptedText),
поэтому запускать с тем же .env, что и API (NOTES_ENCRYPTION_KEY).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlmodel import Session, select  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.models.therapist_client import TherapistClient  # noqa: E402
from app.models.therapist_note import TherapistNote  # noqa: E402
from app.models.therapy_session import TherapySession  # noqa: E402

SITE_REQUEST_MARK = "Заявка через публичный сайт"


def run(apply: bool) -> int:
    tag = "" if apply else "[холостой] "
    created = skipped_mark = skipped_dup = skipped_client = 0
    with Session(engine) as session:
        rows = session.exec(
            select(TherapySession).where(TherapySession.notes.is_not(None))  # type: ignore[union-attr]
        ).all()
        rows = [ts for ts in rows if (ts.notes or "").strip()]
        print(f"{tag}сессий с текстом в notes: {len(rows)}")
        if not rows:
            return 0

        ids = [ts.id for ts in rows]
        existing: dict[str, set[str]] = {}
        for n in session.exec(select(TherapistNote).where(TherapistNote.session_id.in_(ids))).all():  # type: ignore[union-attr]
            existing.setdefault(n.session_id or "", set()).add((n.content or "").strip())

        for ts in rows:
            text = (ts.notes or "").strip()
            if text.startswith(SITE_REQUEST_MARK):
                skipped_mark += 1
                continue
            if text in existing.get(ts.id, set()):
                skipped_dup += 1
                continue
            client = session.get(TherapistClient, ts.client_id)
            if not client or client.specialist_id != ts.specialist_id:
                skipped_client += 1
                continue
            created += 1
            if apply:
                session.add(TherapistNote(
                    client_id=ts.client_id,
                    session_id=ts.id,
                    specialist_id=ts.specialist_id,
                    content=text,
                    created_at=ts.updated_at or ts.created_at or datetime.now(),
                    updated_at=datetime.now(),
                ))
                existing.setdefault(ts.id, set()).add(text)
        if apply and created:
            session.commit()

    print(f"{tag}перенесено в Заметки: {created}")
    print(f"  пропущено — служебная пометка с сайта: {skipped_mark}")
    print(f"  пропущено — такая заметка уже есть: {skipped_dup}")
    print(f"  пропущено — клиента нет / чужой: {skipped_client}")
    if not apply:
        print("\nЭто холостой прогон. Чтобы записать: --apply")
    return 0


if __name__ == "__main__":
    sys.exit(run("--apply" in sys.argv))
