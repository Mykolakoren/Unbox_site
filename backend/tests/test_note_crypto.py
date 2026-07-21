"""Шифрование заметок: круг «записал → в базе шифр → прочитал открытым».

Гоняется на временной SQLite в памяти, боевую базу не трогает.

  python3 tests/test_note_crypto.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cryptography.fernet import Fernet  # noqa: E402

# Ключ ставим ДО импорта моделей — сервис читает его лениво, но так честнее.
os.environ["NOTES_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

from sqlalchemy import text  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine, select  # noqa: E402

from app.services import note_crypto  # noqa: E402
from app.models.therapist_note import TherapistNote  # noqa: E402
from app.models.therapy_session import TherapySession  # noqa: E402

SECRET = "Клиент рассказал о панических атаках. Работаем с телесностью."


def _engine():
    eng = create_engine("sqlite://")
    SQLModel.metadata.create_all(eng, tables=[
        TherapistNote.__table__, TherapySession.__table__,
    ])
    return eng


def test_round_trip():
    """Читаем через ORM — открытый текст; смотрим сырую колонку — шифр."""
    eng = _engine()
    with Session(eng) as s:
        s.add(TherapistNote(client_id="c1", specialist_id="sp1", content=SECRET))
        s.commit()

    with Session(eng) as s:
        got = s.exec(select(TherapistNote)).first()
        assert got.content == SECRET, f"через ORM пришло не то: {got.content!r}"

    with eng.connect() as conn:
        raw = conn.execute(text("SELECT content FROM therapist_notes")).scalar()
    assert raw.startswith(note_crypto.PREFIX), "в базе лежит НЕ шифр!"
    assert SECRET not in raw, "открытый текст виден в базе!"
    assert "паническ" not in raw, "фрагмент текста виден в базе!"


def test_session_notes_encrypted():
    """Заметка внутри сессии шифруется так же."""
    from datetime import datetime
    eng = _engine()
    with Session(eng) as s:
        s.add(TherapySession(client_id="c1", specialist_id="sp1",
                             date=datetime(2026, 7, 1), notes=SECRET))
        s.commit()
    with Session(eng) as s:
        assert s.exec(select(TherapySession)).first().notes == SECRET
    with eng.connect() as conn:
        raw = conn.execute(text("SELECT notes FROM therapy_sessions")).scalar()
    assert raw.startswith(note_crypto.PREFIX) and SECRET not in raw


def test_old_plaintext_still_readable():
    """Записи, сделанные до шифрования, читаются как были."""
    eng = _engine()
    with eng.connect() as conn:
        conn.execute(text(
            "INSERT INTO therapist_notes (id, client_id, specialist_id, content, created_at, updated_at)"
            " VALUES ('n1','c1','sp1','старая открытая заметка','2026-01-01','2026-01-01')"))
        conn.commit()
    with Session(eng) as s:
        assert s.exec(select(TherapistNote)).first().content == "старая открытая заметка"


def test_double_encrypt_is_noop():
    """Повторное шифрование не портит значение."""
    once = note_crypto.encrypt(SECRET)
    assert note_crypto.encrypt(once) == once
    assert note_crypto.decrypt(once) == SECRET


def test_empty_and_none():
    for v in (None, ""):
        assert note_crypto.encrypt(v) == v
        assert note_crypto.decrypt(v) == v


def test_without_key_no_crash():
    """Без ключа: пишем открытым текстом, зашифрованное отдаём заглушкой."""
    saved_f, saved_w = note_crypto._fernet, note_crypto._warned
    encrypted = note_crypto.encrypt(SECRET)
    note_crypto._fernet, note_crypto._warned = None, True
    old_env = os.environ.pop("NOTES_ENCRYPTION_KEY", None)
    try:
        assert note_crypto.encrypt(SECRET) == SECRET          # не падаем
        assert note_crypto.decrypt(encrypted) == note_crypto._UNREADABLE
        assert note_crypto.decrypt("обычный текст") == "обычный текст"
    finally:
        if old_env:
            os.environ["NOTES_ENCRYPTION_KEY"] = old_env
        note_crypto._fernet, note_crypto._warned = saved_f, saved_w


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  ✗ {name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("OK" if not failures else f"FAILED ({failures})")
    sys.exit(1 if failures else 0)
