"""СТОРОЖ приватности каталога специалистов (30.09, решение владельца).

Публичные GET /specialists/ и GET /specialists/{id} открыты без входа. Раньше
они отдавали `documents` — ссылки на сканы дипломов/сертификатов из анкеты
(файлы доступны по ссылке без авторизации) — и `payment_accounts` (счета для
оплаты из Psy-CRM). Их должны видеть только админ (/admin/all) и сам
специалист (/me).

Что ловим: публичная ручка снова отдаёт документы или счета; админ или сам
специалист перестаёт их видеть.

Без сети и без боевой базы (SQLite в памяти):

    python3 backend/tests/guard_privacy_specialists.py
"""
import os
import sys
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from sqlmodel import Session, SQLModel, create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401  — регистрирует все таблицы
from app.models.specialist import Specialist  # noqa: E402
from app.api.v1 import specialists as sp  # noqa: E402

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")
DOC = "/uploads/tasks/diploma-secret.jpg"
ACC = [{"id": "iban", "label": "GE00TB0000000000000000"}]


def _session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    s = Session(engine)
    s.add(Specialist(id=uuid4(), first_name="Анна", last_name="К.", bio="Био", photo_url="/p.jpg",
                     is_verified=True, is_public=True, documents=[DOC], payment_accounts=ACC))
    s.commit()
    return s


def test_public_list_hides_documents_and_accounts():
    s = _session()
    out = sp.get_specialists(session=s, format=None, specialization=None, max_price=None, category=None)
    assert out, "публичный список пуст — фикстура не сработала"
    for r in out:
        assert r.documents == [], "GET /specialists/ снова отдаёт сканы документов"
        assert r.payment_accounts == [], "GET /specialists/ снова отдаёт счета из CRM"


def test_public_profile_hides_documents_and_accounts():
    s = _session()
    spec = s.exec(sp.select(Specialist)).first()
    r = sp.get_specialist(specialist_id=spec.id, session=s)
    assert r.documents == [], "GET /specialists/{id} снова отдаёт сканы документов"
    assert r.payment_accounts == [], "GET /specialists/{id} снова отдаёт счета из CRM"
    assert r.first_name == "Анна" and r.bio == "Био", "публичный профиль потерял обычные поля"


def test_admin_and_owner_still_see_documents():
    s = _session()
    rows = sp.get_all_specialists_admin(session=s, _admin=None)
    assert rows and rows[0].documents == [DOC], "админ перестал видеть документы анкеты"
    src = open(os.path.join(_REPO, "backend/app/api/v1/specialists.py"), encoding="utf-8").read()
    me = src[src.index("def get_my_specialist_profile"):src.index("@router.patch(\"/me\"")]
    assert "_public_view" not in me, "/me не должен прятать документы от самого специалиста"


if __name__ == "__main__":
    import traceback
    failed = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"  ✓ {name}")
        except Exception:
            failed += 1
            print(f"  ✗ {name}")
            traceback.print_exc()
    print("OK" if not failed else f"FAILED: {failed}")
    sys.exit(1 if failed else 0)
