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
    from app.models.app_setting import AppSetting

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    # 02.10: AppSetting — ответ правки сессии теперь несёт «внесено/остаток»,
    # а курсы валют лежат в app_settings.
    SQLModel.metadata.create_all(eng, tables=[
        User.__table__, Booking.__table__, Notification.__table__,
        TherapistClient.__table__, TherapySession.__table__,
        TherapistPayment.__table__, TherapistNote.__table__, AppSetting.__table__,
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


def _run_sync(eng, events, master=True, user=None):
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
                session=s, current_user=user or _user(master), dry_run=False,
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
    сдвиг сессии без новой сессии. Бронь кабинета синк НЕ двигает (цена не
    пересчитывается) — только уведомление специалисту."""
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
        assert b.start_time == "18:00" and b.duration == 60 and b.final_price == 20, \
            "синк сам сдвинул бронь (без пересчёта цены)"
        from app.models.notification import Notification
        n = s.exec(select(Notification).where(Notification.type == "booking_conflict")).first()
        assert n is not None and "перенесите её сами" in n.description, \
            "нет уведомления «бронь осталась на старом времени»"
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

def test_orphan_within_3h_is_relinked_far_is_not():
    """Событие 17:00 удалили и поставили новое на 19:30 → сирота перепривязана
    (платёж на месте). Сирота 10:00 и событие 18:00 того же дня — это РАЗНЫЕ
    встречи (дальше ±3 ч): новая сессия, а ценная сирота только отменена."""
    from sqlmodel import Session, select
    from app.models.therapy_session import TherapySession
    from app.models.therapist_payment import TherapistPayment

    eng = _engine()
    d17 = _day(hour_utc=13)
    d1930 = _day(hour_utc=15, minute=30)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d17,
                             google_event_id="evOld", is_paid=True, price=100))
        s.add(TherapistPayment(client_id="c1", specialist_id="sp1", amount=100,
                               date=datetime.now(), session_id="s1"))
        s.commit()
    res = _run_sync(eng, [_ev("evNew", "Анна Петрова #1234", d1930)])
    with Session(eng) as s:
        rows = s.exec(select(TherapySession)).all()
        assert len(rows) == 1, f"ждали одну сессию, есть {len(rows)}"
        assert rows[0].id == "s1" and rows[0].google_event_id == "evNew" and rows[0].date == d1930, \
            "сирота не перепривязана к новому событию в пределах 3 ч"
        assert rows[0].status != "CANCELLED_THERAPIST"
        assert s.exec(select(TherapistPayment)).first().session_id == "s1", "платёж отвязался"
    assert res["orphans_cancelled"] == 0

    eng = _engine()
    d10 = _day(days_ahead=6, hour_utc=6)
    d18 = _day(days_ahead=6, hour_utc=14)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s10", client_id="c1", specialist_id="sp1", date=d10,
                             google_event_id="evMorning", is_paid=True, price=100))
        s.commit()
    _run_sync(eng, [_ev("evEvening", "Анна Петрова #1234", d18)])
    with Session(eng) as s:
        s10 = s.get(TherapySession, "s10")
        assert s10.date == d10 and s10.google_event_id == "evMorning", \
            "сирота дальше 3 ч склеена с другой встречей того же дня"
        assert s10.status == "CANCELLED_THERAPIST"
        assert len(s.exec(select(TherapySession)).all()) == 2


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
        assert "кабинет cab1" in notes[0].description and "спишется за 24 ч" in notes[0].description, \
            "уведомление не называет бронь кабинета и не предупреждает о списании"
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


def test_sync_never_moves_or_reprices_booking():
    """Сессия с id переехала в Google: брони любых видов (оплаченная,
    абонементная, неоплаченная, прошедшая) синк не двигает, не меняет
    длительность и цену; специалист получает уведомление."""
    from uuid import uuid4
    from sqlmodel import Session, select
    from app.models.booking import Booking
    from app.models.notification import Notification
    from app.models.therapy_session import TherapySession

    cases = [
        ("paid", "balance", 3),
        ("pending", "subscription", 3),
        ("pending", "balance", 3),
        ("paid", "balance", -2),   # прошедшая
    ]
    for status, method, days in cases:
        eng = _engine()
        d = _day(days_ahead=days, hour_utc=14)
        bid = uuid4()
        with Session(eng) as s:
            _seed_client(s)
            s.add(Booking(id=bid, resource_id="cab1", location_id="loc1",
                          date=(d + timedelta(hours=4)).replace(hour=0, minute=0),
                          start_time="18:00", duration=60, status="confirmed",
                          user_id="sp1@example.com", final_price=20, base_price=20,
                          payment_method=method, payment_status=status,
                          charge_amount=20 if status == "paid" else None,
                          hours_deducted=1 if method == "subscription" else None))
            s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d,
                                 google_event_id="evA", booking_id=str(bid), is_booked=True))
            s.commit()
        # 18:00 → 20:00 (пик) и 60 → 180 мин
        _run_sync(eng, [_ev("evA", "Анна Петрова #1234", d + timedelta(hours=2), minutes=180)])
        with Session(eng) as s:
            b = s.get(Booking, bid)
            tag = f"{status}/{method}/{days}д"
            assert b.start_time == "18:00", f"[{tag}] синк сдвинул бронь"
            assert b.duration == 60, f"[{tag}] синк поменял длительность брони"
            assert b.final_price == 20 and b.base_price == 20, f"[{tag}] синк поменял цену брони"
            assert s.get(TherapySession, "s1").date == d + timedelta(hours=2), f"[{tag}] сессия не переехала"
            n = s.exec(select(Notification).where(Notification.type == "booking_conflict")).all()
            assert len(n) == 1, f"[{tag}] нет уведомления «перенесите бронь сами»"
    src = _src("backend/app/api/v1/crm/sync.py")
    body = src[src.find("def _try_move_linked_booking"):src.find("def _delete_session_safely")]
    for forbidden in ("booking.duration =", "booking.start_time =", "booking.date =",
                      "final_price", "check_availability"):
        assert forbidden not in body.split('"""', 2)[-1], f"синк снова трогает бронь: {forbidden}"


def test_sync_cancel_is_restored_when_event_returns():
    """Синк отменил ценную сессию (событие пропало), событие с тем же id
    вернулось → статус возвращается (PLANNED / COMPLETED для прошедшей).
    Ручную отмену специалиста синк не отменяет."""
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession

    eng = _engine()
    fut = _day(days_ahead=4, hour_utc=10)
    past = _day(days_ahead=-2, hour_utc=10)
    with Session(eng) as s:
        _seed_client(s)
        _seed_client(s, cid="c2", name="Борис Иванов", alias="5678")
        s.add(TherapySession(id="fut", client_id="c1", specialist_id="sp1", date=fut,
                             google_event_id="gF", price=80))
        s.add(TherapySession(id="past", client_id="c1", specialist_id="sp1", date=past,
                             google_event_id="gP", status="COMPLETED"))
        s.add(TherapySession(id="manual", client_id="c1", specialist_id="sp1",
                             date=fut + timedelta(days=1), google_event_id="gM",
                             status="CANCELLED_THERAPIST", price=80))
        s.commit()
    user = _user()
    other = _ev("gOther", "Борис Иванов #5678", fut + timedelta(days=9))
    manual_ev = _ev("gM", "Анна Петрова #1234", fut + timedelta(days=1))
    _run_sync(eng, [other, manual_ev], user=user)
    with Session(eng) as s:
        assert s.get(TherapySession, "fut").status == "CANCELLED_THERAPIST"
        assert s.get(TherapySession, "past").status == "CANCELLED_THERAPIST", \
            "проведённая сессия (долг клиента) должна считаться ценной"
    _run_sync(eng, [other, manual_ev,
                    _ev("gF", "Анна Петрова #1234", fut),
                    _ev("gP", "Анна Петрова #1234", past)], user=user)
    with Session(eng) as s:
        assert s.get(TherapySession, "fut").status == "PLANNED", "вернувшееся событие не сняло отмену"
        assert s.get(TherapySession, "past").status == "COMPLETED", "прошедшая не вернулась в «Проведена»"
        assert s.get(TherapySession, "manual").status == "CANCELLED_THERAPIST", \
            "синк отменил ручную отмену специалиста"


# ─── D: перенос брони двигает событие ───────────────────────────────────

def _seed_owner(s, master=True):
    """Специалист как строка User (нужен _push_session_moves_to_gcal)."""
    from uuid import uuid4
    import app.api.v1.bookings.routes  # noqa: F401 — регистрирует все модели (Specialist и т.д.)
    from app.models.user import User
    uid = uuid4()
    s.add(User(id=uid, email="sp1@example.com", name="Спец", hashed_password="x",
               crm_data={"calendar_id": "cal@example.com", "gcal_source_of_truth": master}))
    return str(uid)


def _fake_calendar(p, *, exact_at=None, existing_event=None, fail_update=False):
    """Замоканный календарь: find_matching_event видит событие `existing_event`
    ровно на времени `exact_at`; update/insert только записываются."""
    import app.services.crm_calendar as cc
    calls = {"update": [], "create": [], "find": []}

    def _find(cal, name, alias, when, dur=60):
        calls["find"].append(when)
        if exact_at is not None and existing_event and abs((when - exact_at).total_seconds()) < 60:
            return existing_event, "exact"
        return None, None

    def _update(*a, **k):
        # Зовут и позиционно (move_or_attach_event), и именованно (sessions.py).
        names = ("calendar_id", "event_id", "client_name", "alias_code",
                 "session_date", "duration_minutes", "notes")
        args = dict(zip(names, a))
        args.update(k)
        if fail_update:
            raise RuntimeError("Google 503")
        calls["update"].append((args["event_id"], args["session_date"], args.get("duration_minutes", 60)))

    def _create(cal, name, alias, when, dur=60, notes=None, session_id=None, booking_id=None):
        calls["create"].append(when)
        return "evCreated"

    p.set(cc, "find_matching_event", _find)
    p.set(cc, "update_calendar_event", _update)
    p.set(cc, "create_calendar_event", _create)
    return calls


def test_booking_reschedule_moves_calendar_event():
    """Перенос брони 18:00 → 19:40: сессия едет, событие клиента на старом
    времени привязывается к сессии и двигается (а не остаётся сиротой, которую
    синк превратит в дубль/откат)."""
    from uuid import uuid4
    from sqlmodel import Session
    from app.models.booking import Booking
    from app.models.therapy_session import TherapySession
    from app.api.v1.bookings.routes import (
        _push_session_moves_to_gcal, _sync_linked_session_to_booking,
    )

    eng = _engine()
    d18 = _day(hour_utc=14)
    bid = uuid4()
    with Session(eng) as s:
        spid = _seed_owner(s)
        from app.models.therapist_client import TherapistClient
        s.add(TherapistClient(id="c1", specialist_id=spid, name="Анна Петрова", alias_code="1234"))
        s.add(Booking(id=bid, resource_id="cab1", location_id="loc1",
                      date=(d18 + timedelta(hours=4)).replace(hour=0, minute=0),
                      start_time="18:00", duration=60, status="confirmed",
                      user_id="sp1@example.com", final_price=20, base_price=20,
                      payment_method="balance"))
        s.add(TherapySession(id="s1", client_id="c1", specialist_id=spid, date=d18,
                             booking_id=str(bid), is_booked=True))
        s.commit()

    p = _Patch()
    calls = _fake_calendar(p, exact_at=d18, existing_event={"id": "evOld", "summary": "Анна Петрова #1234"})
    try:
        with Session(eng) as s:
            b = s.get(Booking, bid)
            b.start_time = "19:40"
            b.duration = 90
            s.add(b)
            s.commit()
            move = _sync_linked_session_to_booking(s, b, old_booking_duration=60)
            s.commit()
            assert move and move["old_date"] == d18, "перенос брони не вернул описание переноса сессии"
            _push_session_moves_to_gcal(s, [move])
        with Session(eng) as s:
            ts = s.get(TherapySession, "s1")
            assert ts.date == d18 + timedelta(hours=1, minutes=40), "сессия не поехала за бронью"
            assert ts.duration_minutes == 90, "длительность брони не перенесена в сессию"
            assert ts.google_event_id == "evOld", "событие на старом времени не привязано"
        assert calls["update"] and calls["update"][0][0] == "evOld", "событие не сдвинуто"
        assert calls["update"][0][1] == d18 + timedelta(hours=1, minutes=40)
        assert not calls["create"], "создано второе событие вместо переноса"
    finally:
        p.undo()

    # Уже привязанная сессия: просто patch по id; сбой Google → уведомление.
    p = _Patch()
    calls = _fake_calendar(p, fail_update=True)
    try:
        with Session(eng) as s:
            b = s.get(Booking, bid)
            b.start_time = "20:00"
            s.add(b)
            s.commit()
            move = _sync_linked_session_to_booking(s, b)
            s.commit()
            _push_session_moves_to_gcal(s, [move])
        with Session(eng) as s:
            from sqlmodel import select
            from app.models.notification import Notification
            n = s.exec(select(Notification).where(Notification.type == "calendar_push_failed")).first()
            assert n is not None, "сбой переноса события прошёл молча"
    finally:
        p.undo()


def test_routes_push_session_move_after_commit():
    """Оба переноса (одиночный и серия) отдают движение события в фон ПОСЛЕ commit."""
    src = _src("backend/app/api/v1/bookings/routes.py")
    i = src.find("def reschedule_booking(")
    body = src[i:src.find("def reschedule_booking_series(")]
    a = body.find("_sync_linked_session_to_booking(")
    c = body.find("session.commit()", a)
    t = body.find("_push_session_moves_to_gcal_bg", a)
    assert 0 < a < c < t, "событие должно двигаться после commit переноса брони"
    j = src.find("def reschedule_booking_series(")
    sbody = src[j:j + 12000]
    assert "_series_session_moves" in sbody and "_push_session_moves_to_gcal_bg" in sbody, \
        "перенос серии не двигает события сессий"


# ─── E: перенос сессии из CRM ────────────────────────────────────────────

def _call_update(eng, sid, data, master=True):
    from sqlmodel import Session
    from app.api.v1.crm.sessions import update_session
    with Session(eng) as s:
        return update_session(session_id=sid, data=data, session=s, current_user=_user(master))


def test_update_session_without_id_finds_and_moves_event():
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession, TherapySessionUpdate

    eng = _engine()
    d18 = _day(hour_utc=14)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d18))
        s.commit()
    new_tbs = (d18 + timedelta(hours=4 + 1)).replace(minute=40)  # 19:40 Тбилиси
    p = _Patch()
    calls = _fake_calendar(p, exact_at=d18, existing_event={"id": "evOld", "summary": "Анна Петрова #1234"})
    try:
        out = _call_update(eng, "s1", TherapySessionUpdate(date=new_tbs))
    finally:
        p.undo()
    assert out.google_event_id == "evOld", "событие на старом времени не привязано к сессии"
    assert calls["update"] and calls["update"][0][0] == "evOld", "событие не сдвинуто"
    assert not calls["create"], "создано второе событие"
    assert out.calendar_warning is None


def test_update_session_patch_failure_returns_warning():
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession, TherapySessionUpdate

    eng = _engine()
    d18 = _day(hour_utc=14)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d18,
                             google_event_id="evA"))
        s.commit()
    p = _Patch()
    _fake_calendar(p, fail_update=True)
    try:
        out = _call_update(eng, "s1", TherapySessionUpdate(date=d18 + timedelta(hours=6)))
    finally:
        p.undo()
    assert out.calendar_warning, "сбой патча Google снова проглочен молча"
    with Session(eng) as s:
        assert s.get(TherapySession, "s1").date == d18 + timedelta(hours=2), "перенос в CRM не сохранён"


# ─── F: «почти совпало» → 409 ────────────────────────────────────────────

def test_create_session_near_conflict_is_409_without_force():
    from fastapi import HTTPException
    from sqlmodel import Session, select
    import app.services.crm_calendar as cc
    from app.api.v1.crm.sessions import create_session
    from app.models.therapy_session import TherapySession, TherapySessionCreate

    eng = _engine()
    d18 = _day(hour_utc=14)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="old", client_id="c1", specialist_id="sp1", date=d18,
                             google_event_id="evNear"))
        s.commit()
    near_ev = {"id": "evNear", "summary": "Анна Петрова #1234",
               "start": {"dateTime": d18.strftime("%Y-%m-%dT%H:%M:%SZ")}}
    p = _Patch()
    created = []
    p.set(cc, "find_matching_event", lambda *a, **k: (near_ev, "near"))
    p.set(cc, "create_calendar_event", lambda *a, **k: created.append(1) or "evForced")
    try:
        req = dict(client_id="c1", date=(d18 + timedelta(hours=5)).replace(minute=0),
                   push_to_calendar=True)
        with Session(eng) as s:
            try:
                create_session(data=TherapySessionCreate(**req), session=s, current_user=_user())
                raise AssertionError("near-конфликт не дал 409 — сессия создалась молча")
            except HTTPException as e:
                assert e.status_code == 409
                assert e.detail["code"] == "calendar_near"
                assert e.detail["existing_session_id"] == "old", "фронту не передана существующая сессия"
                assert "уже есть встреча в календаре" in e.detail["message"]
        with Session(eng) as s:
            assert len(s.exec(select(TherapySession)).all()) == 1, "409, но сессия всё равно записана"
        with Session(eng) as s:
            out = create_session(data=TherapySessionCreate(**req, force=True), session=s,
                                 current_user=_user())
            assert out.google_event_id == "evForced" and created, "force не создал отдельное событие"
    finally:
        p.undo()


# ─── G: пуш при создании сессий ──────────────────────────────────────────

def test_session_creation_paths_push_to_calendar():
    chess = _src("src/components/crm/CrmChessboardView.tsx")
    hb = chess[chess.find("const handleBooked"):chess.find("const handleMultiSlotSave")]
    assert "pushToCalendar: true" in hb, "сессия из шахматки CRM не уходит в календарь"
    ms = chess[chess.find("const handleMultiSlotSave"):chess.find("// Recurring strategy")]
    assert "pushToCalendar: true" in ms, "мульти-слот шахматки не уходит в календарь"
    bk = _src("src/pages/crm/CrmBookings.tsx")
    lk = bk[bk.find("const handleLinkSession"):bk.find("const FILTERS")]
    assert "pushToCalendar: true" in lk, "привязка брони в CrmBookings не уходит в календарь"
    rts = _src("backend/app/api/v1/bookings/routes.py")
    ext = rts[rts.find("ext_crm_calendar_id = None"):rts.find("def dismiss_series_end_reminder")]
    assert "create_or_link_event" in ext, "продление серии не пушит сессии в календарь"
    sch = _src("backend/app/api/v1/specialist_schedule.py")
    link = sch[sch.find("def _link_appointment_to_crm"):]
    assert "tbilisi_naive_to_utc_naive" in link, "заявка с сайта снова пишет время по Тбилиси вместо UTC"


def test_frontend_handles_near_conflict_and_calendar_warning():
    sheet = _src("src/components/crm/NewSessionSheet.tsx")
    assert "calendarNearConflict(e)" in sheet and "force: true" in sheet, \
        "NewSessionSheet не разбирает 409 calendar_near / не умеет «Всё равно создать»"
    assert "Перенести существующую" in sheet and "crmApi.updateSession(near.existingSessionId" in sheet, \
        "NewSessionSheet не предлагает перенести существующую встречу"
    util = _src("src/utils/crmCalendarConflict.ts")
    assert "d.code !== 'calendar_near'" in util and "force: true" in util
    client = _src("src/api/client.ts")
    assert "detail.code === 'calendar_near'" in client, \
        "глобальный тост 409 перекрикивает вопрос «перенести или создать»"
    api = _src("src/api/crm.ts")
    assert "calendarWarning" in api and "toast.warning(warning" in api, \
        "предупреждение календаря при переносе не показывается"


def test_static_calendar_calls_are_gated():
    """Ревизор регрессий 01.10: Google зовём только при подключённом календаре;
    продление серии пушит под `if ext_crm_calendar_id`; заявка с сайта — в UTC;
    перенос сессии без id ставит в календарь только будущие PLANNED."""
    sch = _src("backend/app/api/v1/specialist_schedule.py")
    assert "tbilisi_naive_to_utc_naive(" in sch, "заявка с сайта не переводит время в UTC"

    rts = _src("backend/app/api/v1/bookings/routes.py")
    ext = rts[rts.find("ext_crm_calendar_id = None"):rts.find("def dismiss_series_end_reminder")]
    g, c = ext.find("if ext_crm_calendar_id:"), ext.find("_crm_push_ext(")
    assert 0 < g < c, "продление серии зовёт Google без проверки календаря"

    push = rts[rts.find("def _push_session_moves_to_gcal("):rts.find("def _push_session_moves_to_gcal_bg(")]
    g, c = push.find("if not cal_id:"), push.find("_move_ev(")
    assert 0 < g < c and "continue" in push[g:g + 60], \
        "_push_session_moves_to_gcal зовёт Google без calendar_id"

    ses = _src("backend/app/api/v1/crm/sessions.py")
    cs = ses[ses.find("def create_session("):ses.find("def update_session(")]
    g = cs.find("if calendar_id:")
    for call in ("create_or_link_event(", "create_calendar_event("):
        c = cs.find(call)
        assert 0 < g < c, f"create_session: {call} вне `if calendar_id:`"

    us = ses[ses.find("def update_session("):ses.find("def delete_session(")]
    g, c = us.find("if ts.google_event_id and _cal_id:"), us.find("update_calendar_event(")
    assert 0 < g < c, "update_session: patch события без calendar_id"
    m = us.find("move_or_attach_event(")
    gate = us.rfind("if (", 0, m)
    block = us[gate:m]
    assert "_cal_id" in block, "update_session: перенос без id зовёт Google без calendar_id"
    assert 'ts.status == "PLANNED"' in block and "ts.date > datetime.utcnow()" in block, \
        "update_session: в календарь снова уходят прошедшие/проведённые сессии"


def test_series_asks_once_for_near_conflicts():
    """Серия из шахматки: один вопрос «Применить ко всем датам?», а не по
    вопросу на каждую дату."""
    util = _src("src/utils/crmCalendarConflict.ts")
    assert "Применить этот ответ ко всем датам серии?" in util and "series.decision = decision" in util
    chess = _src("src/components/crm/CrmChessboardView.tsx")
    loop = chess[chess.find("// Recurring strategy"):]
    assert "const seriesCalendarChoice: SeriesCalendarChoice = {}" in loop and \
        "}, seriesCalendarChoice);" in loop, "цикл серии не делится одним ответом на конфликты"


# ─── H: RRULE с timeZone ─────────────────────────────────────────────────

def test_recurring_event_has_timezone():
    import app.services.crm_calendar as cc
    captured = {}

    class _Ins:
        def __init__(self, body):
            captured["body"] = body

        def execute(self):
            return {"id": "master1"}

    class _Events:
        def insert(self, calendarId, body):
            return _Ins(body)

    class _Svc:
        def events(self):
            return _Events()

    p = _Patch()
    p.set(cc, "_get_calendar_service", lambda: _Svc())
    try:
        first = datetime(2026, 11, 2, 14, 0)
        master, ids = cc.create_recurring_event(
            "cal@example.com", "Анна", "1234", first, 60, 3, 1)
    finally:
        p.undo()
    body = captured["body"]
    assert body["start"].get("timeZone") == "Asia/Tbilisi", "RRULE без timeZone — Google отвергнет серию"
    assert body["end"].get("timeZone") == "Asia/Tbilisi"
    assert ids[0] == "master1_20261102T140000Z" and len(ids) == 3, "instance-id серии поплыли"


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
