"""СТОРОЖ «доп. пул часов абонемента» (обещания тарифов, шаг 4, владелец 01.10).

Шаг 2б — у брони две новые колонки: из какого пула абонемента сняты часы.
  * hours_pool           — 'main' | 'extra' | 'mixed', NULL = основной (как раньше);
  * extra_hours_deducted — сколько часов из доп. пула (NULL/0 = всё из основного).

Что ловим:
  * миграция не добавляет колонки / падает при повторном запуске;
  * новый код без колонок в базе или старый код с колонками ломает бронь;
  * клиент может прислать в запросе, из какого пула ему списать.

Без сети и без боевой базы (SQLite в памяти):

    python3 backend/tests/guard_tariffs_extra.py
"""
import os
import sys
from datetime import datetime
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from sqlmodel import Session, SQLModel, create_engine, select  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401
from app.models.booking import Booking, BookingCreate, BookingRead  # noqa: E402

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_REPO = os.path.join(_BACKEND, "..")


def _read(rel: str) -> str:
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


def _cols(engine) -> set:
    with engine.connect() as c:
        return {r[1] for r in c.execute(text("PRAGMA table_info(booking)")).all()}


def _migrate(engine):
    import app.db.init_data as init_data
    real = init_data.engine
    init_data.engine = engine
    try:
        init_data.migrate_add_columns()
    finally:
        init_data.engine = real


def _row(**over) -> Booking:
    return Booking(resource_id="room_1", date=datetime(2026, 10, 6), start_time="12:00", duration=60,
                   final_price=0.0, payment_method="subscription", hours_deducted=1.0,
                   user_id="x@x.ge", **over)


# ─────────────────────────────────────────────────────────────────────────
# 2б. Колонки брони
# ─────────────────────────────────────────────────────────────────────────

def test_2b_migration_adds_columns_to_old_table_and_is_idempotent():
    """База без колонок (как прод до деплоя) → миграция добавляет обе;
    второй прогон (каждый рестарт) не падает."""
    eng = _engine()
    SQLModel.metadata.create_all(eng)
    with eng.connect() as c:
        c.execute(text("ALTER TABLE booking DROP COLUMN hours_pool"))
        c.execute(text("ALTER TABLE booking DROP COLUMN extra_hours_deducted"))
        c.commit()
    assert not {"hours_pool", "extra_hours_deducted"} & _cols(eng)
    _migrate(eng)
    assert {"hours_pool", "extra_hours_deducted"} <= _cols(eng), _cols(eng)
    _migrate(eng)  # повтор — без ошибок
    with Session(eng) as s:
        s.add(_row(hours_pool="mixed", extra_hours_deducted=0.5))
        s.commit()
        b = s.exec(select(Booking)).one()
        assert b.hours_pool == "mixed" and b.extra_hours_deducted == 0.5


def test_2b_old_code_rows_read_as_main_pool():
    """Строка, вставленная старым кодом (без новых колонок), читается новым
    кодом как «основной пул»: NULL в обеих колонках."""
    eng = _engine()
    SQLModel.metadata.create_all(eng)
    with eng.connect() as c:
        c.execute(text(
            "INSERT INTO booking (id, resource_id, location_id, date, start_time, duration, status, "
            "final_price, discount_amount, discount_percent, payment_method, hours_deducted, format, "
            "extras, is_re_rent_listed, user_id, created_at, updated_at) VALUES "
            f"('{uuid4().hex}', 'room_1', 'unbox_uni', '2026-10-06 00:00:00', '12:00', 60, 'confirmed', "
            "0, 0, 0, 'subscription', 1.0, 'individual', '[]', 0, 'x@x.ge', '2026-10-01', '2026-10-01')"
        ))
        c.commit()
    with Session(eng) as s:
        b = s.exec(select(Booking)).one()
        assert b.hours_pool is None and b.extra_hours_deducted is None
        assert BookingRead.model_validate(b).extra_hours_deducted is None


def test_2b_client_cannot_choose_pool():
    """Из какого пула списать — решает сервер. В BookingCreate этих полей нет."""
    fields = set(BookingCreate.model_fields)
    assert "hours_pool" not in fields and "extra_hours_deducted" not in fields, fields
    assert {"hours_pool", "extra_hours_deducted"} <= set(BookingRead.model_fields)


def test_2b_model_and_migration_in_one_place():
    model = _read("backend/app/models/booking.py")
    mig = _read("backend/app/db/init_data.py")
    for col in ("hours_pool", "extra_hours_deducted"):
        assert f"{col}: Optional" in model, f"нет {col} в модели"
        assert f'"{col}"' in mig, f"нет миграции {col}"
    assert "ADD COLUMN IF NOT EXISTS {_col}" in mig


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"  FAIL {name}: {e!r}")
    print("guard_tariffs_extra:", "FAILED" if failed else "OK")
    sys.exit(1 if failed else 0)
