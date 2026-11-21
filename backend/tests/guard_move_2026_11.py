"""СТОРОЖ: переезд Unbox — филиал не принимает брони вне своих дат (21.11.2026).

Случай: оба старых центра закрываются (Палиашвили по 29.11, Абусеридзе по 30.11),
новый UNBOX 99 открывается 30.11, а сайт продолжал принимать брони в старые
кабинеты на декабрь — Валентина сообщила об этом 21.11. Что не должно сломаться:
  A  check_availability отказывает в закрывшемся филиале после последнего дня
     и в новом — до дня открытия; в последний/первый день бронь проходит;
  B  филиал без дат работает как раньше;
  C  кривая дата в базе не закрывает филиал навсегда;
  D  бот в закрытый день не предлагает свободного времени;
  E  продление брони проверяет даты филиала;
  F  филиал брони берётся из кабинета, а не из запроса экрана.

Без сети и боевой базы: SQLite в памяти.

    python3 backend/tests/guard_move_2026_11.py
"""
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")


def _session():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine
    import app.models  # noqa: F401 — регистрирует все таблицы
    from app.models.location import Location
    from app.models.resource import Resource
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng)
    s = Session(eng)
    for lid, name, frm, until in (
        ("unbox_one", "Unbox One", None, "2026-11-29"),
        ("unbox_uni", "Unbox Uni", None, "2026-11-30"),
        ("unbox_99", "UNBOX 99", "2026-11-30", None),
        ("free", "Без дат", None, None),
        ("junk", "Кривая дата", "вчера", "никогда"),
    ):
        s.add(Location(id=lid, name=name, address="—", open_from=frm, open_until=until))
        s.add(Resource(id=f"{lid}_room_1", name="Кабинет 1", type="cabinet", location_id=lid,
                       hourly_rate=20, capacity=4, area=10))
    s.commit()
    return s


def _ok(s, rid, y, m, d):
    from app.services.booking import check_availability
    return check_availability(s, rid, datetime(y, m, d), "10:00", 60)


def test_closed_branch_rejects_after_last_day():
    s = _session()
    assert _ok(s, "unbox_one_room_1", 2026, 11, 29)[0], "последний день Палиашвили должен работать"
    ok, why = _ok(s, "unbox_one_room_1", 2026, 11, 30)
    assert not ok and "29.11.2026" in why and "UNBOX 99" in why, why
    assert _ok(s, "unbox_uni_room_1", 2026, 11, 30)[0], "последний день Абусеридзе должен работать"
    assert not _ok(s, "unbox_uni_room_1", 2026, 12, 1)[0]
    assert not _ok(s, "unbox_uni_room_1", 2027, 1, 15)[0]


def test_new_branch_rejects_before_opening():
    s = _session()
    ok, why = _ok(s, "unbox_99_room_1", 2026, 11, 29)
    assert not ok and "30.11.2026" in why, why
    assert _ok(s, "unbox_99_room_1", 2026, 11, 30)[0]
    assert _ok(s, "unbox_99_room_1", 2027, 2, 1)[0]


def test_branch_without_dates_and_junk_dates_stay_open():
    s = _session()
    assert _ok(s, "free_room_1", 2030, 1, 1)[0]
    assert _ok(s, "junk_room_1", 2030, 1, 1)[0], "кривая дата не должна закрывать филиал"


def test_bot_offers_no_slots_on_closed_day():
    from app.api.v1.telegram import SLOT_END_HOUR, SLOT_START_HOUR, SLOT_STEP_MIN, _get_busy_slots
    s = _session()
    full = set(range(SLOT_START_HOUR * 60, SLOT_END_HOUR * 60, SLOT_STEP_MIN))
    assert _get_busy_slots(s, "unbox_uni_room_1", date(2026, 12, 3)) == full
    assert _get_busy_slots(s, "unbox_uni_room_1", date(2026, 11, 30)) == set()
    assert _get_busy_slots(s, "unbox_99_room_1", date(2026, 11, 28)) == full


def test_extend_checks_branch_dates():
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "bookings", "routes.py"),
               encoding="utf-8").read()
    body = src.split("def extend_booking", 1)[1].split("\n@router.", 1)[0] if "def extend_booking" in src \
        else src.split('@router.patch("/{booking_id}/extend"', 1)[1].split("\n@router.", 1)[0]
    assert "closure_reason" in body, "продление брони перестало проверять даты филиала"


def test_booking_branch_comes_from_room():
    """F  филиал брони берётся из кабинета в базе, а не из того, что прислал экран."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "bookings", "routes.py"),
               encoding="utf-8").read()
    assert src.count("_location_of_room(") >= 4, "одиночная бронь, корзина и серия должны брать филиал из кабинета"
    assert "location_id=s.location_id," not in src and "location_id=data.location_id," not in src
    from app.api.v1.bookings.routes import _location_of_room
    s = _session()
    assert _location_of_room(s, "unbox_99_room_1", "unbox_one") == "unbox_99"
    assert _location_of_room(s, "нет такого", "unbox_one") == "unbox_one"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("СТОРОЖ: OK" if not failures else f"СТОРОЖ УПАЛ ({failures})")
    sys.exit(1 if failures else 0)
