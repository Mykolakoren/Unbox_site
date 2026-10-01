"""СТОРОЖ: синхронизация Psy-CRM ↔ Google Календарь без дублей (01.10).

Что починили и не должно сломаться снова:
  A  событие перенесли в Google (новый id или сессия без id) → синк находит
     «свою» сессию того же клиента в тот же день (±3 ч) и двигает её, а не
     создаёт вторую; два события в один день → сессия у ближайшего;
  B  сирота (событие исчезло) + новое событие того же клиента в тот же день →
     перепривязка вместо удаления;
  C  удалённое/исчезнувшее событие: сессию с оплатой/заметкой/бронью НЕ стираем —
     CANCELLED_THERAPIST + уведомление, бронь и деньги не трогаем; пустую — удаляем;
  D  перенос брони двигает и событие в личном календаре (или привязывает его);
  E  перенос сессии без id находит событие на старом времени и двигает его;
     сбой Google → calendar_warning в ответе, а не тишина;
  F  «почти совпало» (тот же клиент ±3 ч) → 409 без force, а не молчаливая сессия;
  G  сессии из шахматки / CrmBookings / продления серии уходят в календарь;
  H  RRULE серии несёт timeZone.

Без сети и боевой базы: SQLite в памяти, Google замокан.

    python3 backend/tests/guard_crm_sync_dedupe.py
"""
import os
import pathlib
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

BACKEND = pathlib.Path(__file__).parent.parent
ROOT = BACKEND.parent


def _src(rel: str) -> str:
    return (ROOT / rel).read_text()


# ─── Фикстуры ────────────────────────────────────────────────────────────

def _engine():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
    from app.models.user import User
    from app.models.booking import Booking
    from app.models.notification import Notification
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_note import TherapistNote
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[
        User.__table__, Booking.__table__, Notification.__table__,
        TherapistClient.__table__, TherapySession.__table__,
        TherapistPayment.__table__, TherapistNote.__table__,
    ])
    return eng


def _user(master=True):
    return SimpleNamespace(
        id="sp1", email="sp1@example.com", name="Спец",
        crm_data={"calendar_id": "cal@example.com", "gcal_source_of_truth": master},
    )


def _ev(eid, summary, start_utc, minutes=60, status="confirmed"):
    end = start_utc + timedelta(minutes=minutes)
    return {
        "id": eid, "summary": summary, "status": status,
        "start": {"dateTime": start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")},
        "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%SZ")},
    }


class _Patch:
    """Мини-monkeypatch: подменяет атрибуты и всё возвращает в finally."""

    def __init__(self):
        self._saved = []

    def set(self, obj, name, value):
        self._saved.append((obj, name, getattr(obj, name)))
        setattr(obj, name, value)

    def undo(self):
        for obj, name, value in reversed(self._saved):
            setattr(obj, name, value)


def _run_sync(eng, events, master=True):
    """Прогон роут-функции синка с замоканной выдачей Google."""
    from sqlmodel import Session
    import app.services.crm_calendar as cc
    import app.services.booking as booking_svc
    from app.api.v1.crm.sync import sync_from_calendar

    p = _Patch()
    p.set(cc, "_get_events", lambda *a, **k: list(events))
    p.set(cc, "patch_event_summary", lambda *a, **k: None)
    p.set(booking_svc, "check_availability", lambda *a, **k: (True, None))
    try:
        with Session(eng) as s:
            return sync_from_calendar(
                session=s, current_user=_user(master), dry_run=False,
                auto_create_clients=False, months_back=0, months_forward=3, past_days=45,
            )
    finally:
        p.undo()


def _day(days_ahead=5, hour_utc=14, minute=0):
    base = datetime.utcnow().replace(second=0, microsecond=0) + timedelta(days=days_ahead)
    return base.replace(hour=hour_utc, minute=minute)


def _seed_client(s, cid="c1", name="Анна Петрова", alias="1234"):
    from app.models.therapist_client import TherapistClient
    s.add(TherapistClient(id=cid, specialist_id="sp1", name=name, alias_code=alias))


# ─── A: перенос события ──────────────────────────────────────────────────

def test_moved_event_relinks_session_without_id():
    """Событие перенесли на 19:40, у клиента сессия 18:00 без id → привязка и
    сдвиг (вместе с бронью), без новой сессии."""
    from uuid import uuid4
    from sqlmodel import Session, select
    from app.models.booking import Booking
    from app.models.therapy_session import TherapySession

    eng = _engine()
    d18 = _day(hour_utc=14)                      # 18:00 Тбилиси
    d1940 = d18 + timedelta(hours=1, minutes=40)  # 19:40 Тбилиси
    bid = uuid4()
    with Session(eng) as s:
        _seed_client(s)
        tb_midnight = (d18 + timedelta(hours=4)).replace(hour=0, minute=0)
        s.add(Booking(id=bid, resource_id="cab1", location_id="loc1", date=tb_midnight,
                      start_time="18:00", duration=60, status="confirmed",
                      user_id="sp1@example.com", final_price=20, base_price=20,
                      payment_method="balance"))
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d18,
                             booking_id=str(bid), is_booked=True))
        s.commit()

    res = _run_sync(eng, [_ev("evNEW", "Анна Петрова #1234", d1940)])
    with Session(eng) as s:
        rows = s.exec(select(TherapySession)).all()
        assert len(rows) == 1, f"перенос родил дубль: сессий {len(rows)}"
        ts = rows[0]
        assert ts.google_event_id == "evNEW", "сессия не привязана к перенесённому событию"
        assert ts.date == d1940, f"сессия не сдвинута: {ts.date} вместо {d1940}"
        b = s.get(Booking, bid)
        assert b.start_time == "19:40", f"бронь не поехала за сессией: {b.start_time}"
    assert res["created"] == 0 and res["relinked"] == 1


def test_same_id_event_moves_session_as_before():
    """Сессия с id 18:00, событие с тем же id теперь 19:40 → сдвиг (как раньше)."""
    from sqlmodel import Session, select
    from app.models.therapy_session import TherapySession

    eng = _engine()
    d18 = _day(hour_utc=14)
    d1940 = d18 + timedelta(hours=1, minutes=40)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d18,
                             google_event_id="evA"))
        s.commit()
    res = _run_sync(eng, [_ev("evA", "Анна Петрова #1234", d1940)])
    with Session(eng) as s:
        rows = s.exec(select(TherapySession)).all()
        assert len(rows) == 1 and rows[0].date == d1940 and rows[0].google_event_id == "evA"
    assert res["created"] == 0


def test_two_events_same_day_bind_nearest():
    """Два живых события клиента в один день → сессия без id уходит к
    ближайшему, второе событие даёт новую сессию."""
    from sqlmodel import Session, select
    from app.models.therapy_session import TherapySession

    eng = _engine()
    d = _day(hour_utc=14)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d))
        s.commit()
    far = _ev("evFar", "Анна Петрова #1234", d + timedelta(hours=2, minutes=30))
    near = _ev("evNear", "Анна Петрова #1234", d - timedelta(hours=1))
    _run_sync(eng, [near, far])
    with Session(eng) as s:
        s1 = s.get(TherapySession, "s1")
        assert s1.google_event_id == "evNear", f"сессия ушла не к ближайшему: {s1.google_event_id}"
        rows = s.exec(select(TherapySession)).all()
        assert len(rows) == 2, f"ждали 2 сессии (s1 + новая для второго события), есть {len(rows)}"


def test_exact_duplicate_events_do_not_duplicate_sessions():
    """Два события клиента на одно время (дубль в календаре) → одна сессия."""
    from sqlmodel import Session, select
    from app.models.therapy_session import TherapySession

    eng = _engine()
    d = _day(hour_utc=14)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d,
                             google_event_id="evA"))
        s.commit()
    _run_sync(eng, [_ev("evA", "Анна Петрова #1234", d), _ev("evB", "Анна Петрова #1234", d)])
    with Session(eng) as s:
        assert len(s.exec(select(TherapySession)).all()) == 1, "дубль события родил дубль сессии"


# ─── B: сирота того же дня → перепривязка ────────────────────────────────

def test_orphan_same_day_is_relinked_not_deleted():
    """Событие 10:00 удалили и поставили новое на 18:00 того же дня →
    сессия переезжает (с id нового события), а не удаляется + создаётся."""
    from sqlmodel import Session, select
    from app.models.therapy_session import TherapySession
    from app.models.therapist_payment import TherapistPayment

    eng = _engine()
    d10 = _day(hour_utc=6)       # 10:00 Тбилиси
    d18 = _day(hour_utc=14)      # 18:00 Тбилиси
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d10,
                             google_event_id="evOld", is_paid=True, price=100))
        s.add(TherapistPayment(client_id="c1", specialist_id="sp1", amount=100,
                               date=datetime.now(), session_id="s1"))
        s.commit()
    res = _run_sync(eng, [_ev("evNew", "Анна Петрова #1234", d18)])
    with Session(eng) as s:
        rows = s.exec(select(TherapySession)).all()
        assert len(rows) == 1, f"ждали одну сессию, есть {len(rows)}"
        assert rows[0].id == "s1" and rows[0].google_event_id == "evNew" and rows[0].date == d18, \
            "сирота не перепривязана к новому событию того же дня"
        assert rows[0].status != "CANCELLED_THERAPIST"
        pay = s.exec(select(TherapistPayment)).first()
        assert pay.session_id == "s1", "платёж отвязался от сессии"
    assert res["orphans_cancelled"] == 0


# ─── C: защита при удалении ──────────────────────────────────────────────

def test_orphans_with_value_cancelled_empty_deleted():
    """Сирота с оплатой / заметкой / встроенной заметкой / бронью → CANCELLED +
    уведомление, бронь не отменена; пустая сирота → удалена."""
    from uuid import uuid4
    from sqlmodel import Session, select
    from app.models.booking import Booking
    from app.models.notification import Notification
    from app.models.therapist_note import TherapistNote
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession

    eng = _engine()
    d = _day(days_ahead=3, hour_utc=10)
    bid = uuid4()
    with Session(eng) as s:
        _seed_client(s)
        _seed_client(s, cid="c2", name="Борис Иванов", alias="5678")
        s.add(Booking(id=bid, resource_id="cab1", location_id="loc1",
                      date=(d + timedelta(hours=4)).replace(hour=0, minute=0),
                      start_time="14:00", duration=60, status="confirmed",
                      user_id="sp1@example.com", final_price=20, base_price=20, payment_method="balance",
                      payment_status="paid"))
        s.add(TherapySession(id="paid", client_id="c1", specialist_id="sp1", date=d,
                             google_event_id="g1", is_paid=True, price=100))
        s.add(TherapistPayment(client_id="c1", specialist_id="sp1", amount=100,
                               date=datetime.now(), session_id="paid"))
        s.add(TherapySession(id="noted", client_id="c1", specialist_id="sp1",
                             date=d + timedelta(days=1), google_event_id="g2"))
        s.add(TherapistNote(client_id="c1", session_id="noted", specialist_id="sp1",
                            content="Важная заметка"))
        s.add(TherapySession(id="inline", client_id="c1", specialist_id="sp1",
                             date=d + timedelta(days=2), google_event_id="g3",
                             notes="Встроенная заметка"))
        s.add(TherapySession(id="booked", client_id="c1", specialist_id="sp1",
                             date=d + timedelta(days=3), google_event_id="g4",
                             booking_id=str(bid), is_booked=True))
        s.add(TherapySession(id="empty", client_id="c1", specialist_id="sp1",
                             date=d + timedelta(days=4), google_event_id="g5"))
        s.add(TherapySession(id="site", client_id="c1", specialist_id="sp1",
                             date=d + timedelta(days=5), google_event_id="g6",
                             notes="Заявка через публичный сайт. Кабинет и оплата — отдельно."))
        s.commit()

    # Живое событие ДРУГОГО клиента — иначе сработает аварийный стоп уборки.
    res = _run_sync(eng, [_ev("gOther", "Борис Иванов #5678", d + timedelta(days=10))])
    with Session(eng) as s:
        for sid in ("paid", "noted", "inline", "booked"):
            ts = s.get(TherapySession, sid)
            assert ts is not None, f"сессия «{sid}» с ценностью удалена жёстко"
            assert ts.status == "CANCELLED_THERAPIST", f"«{sid}» не отменена: {ts.status}"
        assert s.get(TherapySession, "empty") is None, "пустая сирота не удалена"
        assert s.get(TherapySession, "site") is None, "служебная пометка заявки — не ценность"
        assert s.exec(select(TherapistPayment)).first().session_id == "paid"
        assert s.get(TherapySession, "inline").notes == "Встроенная заметка", "встроенная заметка потеряна"
        b = s.get(Booking, bid)
        assert b.status == "confirmed" and b.cancelled_by is None, "синк сам отменил бронь"
        notes = s.exec(select(Notification).where(Notification.type == "calendar_session_cancelled")).all()
        assert len(notes) == 1, "нет (или несколько) уведомлений об отменённых сессиях"
        assert "оплата/бронь сохранены" in notes[0].description
    assert res["sessions_cancelled_kept"] == 4 and res["orphans_cancelled"] == 2

    # Повторный прогон (крон каждые 20 мин) не плодит уведомления.
    _run_sync(eng, [_ev("gOther", "Борис Иванов #5678", d + timedelta(days=10))])
    with Session(eng) as s:
        assert len(s.exec(select(Notification)).all()) == 1, "уведомление дублируется каждым синком"


def test_cancelled_event_keeps_paid_session_deletes_empty():
    """Ветка «событие отменено в Google»: оплаченная → CANCELLED, пустая → удалена."""
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession

    eng = _engine()
    d = _day(days_ahead=2, hour_utc=10)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="paid", client_id="c1", specialist_id="sp1", date=d,
                             google_event_id="gc1", is_paid=True, price=50))
        s.add(TherapySession(id="empty", client_id="c1", specialist_id="sp1",
                             date=d + timedelta(days=1), google_event_id="gc2"))
        s.commit()
    _run_sync(eng, [
        _ev("gc1", "Анна Петрова #1234", d, status="cancelled"),
        _ev("gc2", "Анна Петрова #1234", d + timedelta(days=1), status="cancelled"),
    ])
    with Session(eng) as s:
        assert s.get(TherapySession, "paid").status == "CANCELLED_THERAPIST"
        assert s.get(TherapySession, "empty") is None


def test_safe_mode_still_holds_deletions():
    """Защитный режим (gcal_source_of_truth=false) по-прежнему ничего не трогает."""
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession

    eng = _engine()
    d = _day(days_ahead=2, hour_utc=10)
    with Session(eng) as s:
        _seed_client(s)
        _seed_client(s, cid="c2", name="Борис Иванов", alias="5678")
        s.add(TherapySession(id="empty", client_id="c1", specialist_id="sp1", date=d,
                             google_event_id="g5"))
        s.commit()
    res = _run_sync(eng, [_ev("gOther", "Борис Иванов #5678", d + timedelta(days=3))], master=False)
    with Session(eng) as s:
        assert s.get(TherapySession, "empty") is not None
    assert res["deletions_held"] == 1


if __name__ == "__main__":
    import traceback
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
                if os.environ.get("GUARD_TRACE"):
                    traceback.print_exc()
    print("СТОРОЖ CRM-SYNC: OK" if not failures else f"СТОРОЖ CRM-SYNC УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
