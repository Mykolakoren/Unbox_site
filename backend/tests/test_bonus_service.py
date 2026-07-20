"""Списание/возврат бонусных бесплатных часов (bonus_service).

Правило (owner 2026-07-20): выданное бонусом — бесплатно, сверх — по обычной
цене. Проверяем FIFO-списание, частичный расход, истечение и возврат.

    python3 backend/tests/test_bonus_service.py
    pytest backend/tests/test_bonus_service.py
"""
import os
import sys
from datetime import datetime, timedelta
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from sqlmodel import Session, SQLModel, create_engine, select  # noqa: E402

from app.models.bonus import Bonus  # noqa: E402
from app.services.bonus_service import (  # noqa: E402
    available_free_hours, consume_free_hours, refund_free_hours,
)

engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
SQLModel.metadata.create_all(engine)

UID = str(uuid4())


def _fresh():
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)


def _grant(s, hours, status="active", expires_in_days=15):
    s.add(Bonus(user_id=UID, type="free_hour", quantity=hours, status=status,
                expires_at=datetime.now() + timedelta(days=expires_in_days)))
    s.commit()


def test_consume_full_hour():
    _fresh()
    with Session(engine) as s:
        _grant(s, 1.0)
        covered = consume_free_hours(s, UID, 1.0)
        s.commit()
        assert covered == 1.0, covered
        b = s.exec(select(Bonus)).first()
        assert b.status == "used" and b.quantity == 0.0


def test_partial_1p5h_leaves_half_uncovered():
    """1.5 ч брони, бонус 1 ч → покрыто 1, непокрыто 0.5 (за него платит баланс)."""
    _fresh()
    with Session(engine) as s:
        _grant(s, 1.0)
        covered = consume_free_hours(s, UID, 1.5)
        s.commit()
        assert covered == 1.0, covered
        assert available_free_hours(s, UID) == 0.0


def test_fifo_earliest_expiry_first():
    _fresh()
    with Session(engine) as s:
        _grant(s, 1.0, expires_in_days=30)   # позже
        _grant(s, 1.0, expires_in_days=5)    # раньше — тратится первым
        covered = consume_free_hours(s, UID, 1.0)
        s.commit()
        rows = s.exec(select(Bonus).order_by(Bonus.expires_at)).all()
        assert covered == 1.0
        assert rows[0].status == "used"       # ранний потрачен
        assert rows[1].status == "active"     # поздний цел


def test_expired_not_consumed():
    _fresh()
    with Session(engine) as s:
        _grant(s, 1.0, expires_in_days=-1)   # истёк вчера
        covered = consume_free_hours(s, UID, 1.0)
        s.commit()
        assert covered == 0.0
        assert s.exec(select(Bonus)).first().status == "expired"


def test_no_bonus_covers_nothing():
    _fresh()
    with Session(engine) as s:
        assert consume_free_hours(s, UID, 1.0) == 0.0


def test_refund_restores_hours():
    _fresh()
    with Session(engine) as s:
        _grant(s, 1.0)
        consume_free_hours(s, UID, 1.0)
        s.commit()
        assert available_free_hours(s, UID) == 0.0
        refund_free_hours(s, UID, 1.0)
        s.commit()
        assert available_free_hours(s, UID) == 1.0


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
