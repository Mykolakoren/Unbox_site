"""СТОРОЖ: личные дела из Google-календаря не становятся клиентами Psy-CRM (09.11).

Случай: напоминание на весь день «Проверить счётчики на Сулаберидзе» синк
завёл карточкой клиента и сессией длиной сутки; неделей раньше так же
появился «клиент» «Заложить в бюджет января…». Что не должно сломаться:
  A  событие на весь день не становится ни клиентом, ни сессией — даже если
     его название совпадает с существующим клиентом или несёт #код;
  B  заголовок, начинающийся с глагола («Проверить…», «Заложить…»),
     карточкой не становится; обычные имена — становятся;
  C  событие на весь день остаётся «живым» — из-за него ничего не отменяется;
  D  подгрузка истории клиента и привязка события к сессии тоже
     пропускают события на весь день.

Без сети и боевой базы: SQLite в памяти, Google замокан.

    python3 backend/tests/guard_crm_all_day_events_2026_11.py
"""
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("ENVIRONMENT", "development")

from guard_crm_sync_dedupe import _Patch, _day, _ev, _seed_client, _user  # noqa: E402


def _engine():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
    import app.models  # noqa: F401 — регистрирует все таблицы
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng)
    return eng


def _all_day(eid, summary, day):
    d = day.strftime("%Y-%m-%d")
    nxt = (day + timedelta(days=1)).strftime("%Y-%m-%d")
    return {"id": eid, "summary": summary, "status": "confirmed",
            "start": {"date": d}, "end": {"date": nxt}}


def _run(eng, events, auto_create=True):
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
                session=s, current_user=_user(True), dry_run=False,
                auto_create_clients=auto_create, months_back=0, months_forward=3, past_days=45,
            )
    finally:
        p.undo()


def _rows(eng):
    from sqlmodel import Session, select
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession
    with Session(eng) as s:
        return ([c.name for c in s.exec(select(TherapistClient)).all()],
                s.exec(select(TherapySession)).all())


def test_all_day_event_is_never_a_client_or_session():
    eng = _engine()
    _run(eng, [_all_day("evA", "Проверить счётчики на Сулаберидзе", _day(1)),
               _all_day("evB", "Мария Иванова", _day(2))])
    names, sessions = _rows(eng)
    assert names == [], f"событие на весь день стало клиентом: {names}"
    assert sessions == [], f"событие на весь день стало сессией: {len(sessions)}"


def test_all_day_event_with_existing_client_name_or_code_is_skipped():
    from sqlmodel import Session
    eng = _engine()
    with Session(eng) as s:
        _seed_client(s)
        s.commit()
    _run(eng, [_all_day("evA", "Анна Петрова #1234", _day(1)),
               _all_day("evB", "Анна Петрова", _day(2))])
    _, sessions = _rows(eng)
    assert sessions == [], "событие на весь день сопоставилось с клиентом и стало сессией"


def test_infinitive_titles_are_not_clients_but_names_are():
    from app.api.v1.crm.sync import _looks_non_client
    for t in ("Проверить счётчики на Сулаберидзе",
              "Заложить в бюджет января деньги на регистрацию товарного знака ООО",
              "Записаться к стоматологу", "Отправить документы"):
        assert _looks_non_client(t), f"«{t}» принят за клиента"
    for t in ("Анна Петрова", "Мать и дочь Ивановы", "Елена и Иван", "Ростислав", "Пара, Полина и Ярослав"):
        assert not _looks_non_client(t), f"«{t}» ошибочно считается личным делом"


def test_timed_infinitive_event_does_not_create_client_but_name_does():
    eng = _engine()
    _run(eng, [_ev("ev1", "Заложить в бюджет деньги", _day(1)),
               _ev("ev2", "Ольга Смирнова", _day(2))])
    names, sessions = _rows(eng)
    assert names == ["Ольга Смирнова"], f"карточки после синка: {names}"
    assert len(sessions) == 1


def test_all_day_event_keeps_nothing_cancelled():
    """Сессия, привязанная к событию, которое теперь «на весь день» и всё ещё
    есть в календаре, не отменяется и не удаляется синком."""
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession
    eng = _engine()
    d = _day(3)
    with Session(eng) as s:
        _seed_client(s)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d,
                             google_event_id="evX"))
        s.commit()
    _run(eng, [_all_day("evX", "Анна Петрова #1234", d)], auto_create=False)
    with Session(eng) as s:
        ts = s.get(TherapySession, "s1")
        assert ts is not None and ts.status == "PLANNED", "живое событие на весь день отменило сессию"


def test_history_and_link_paths_skip_all_day():
    import app.services.crm_calendar as cc
    d = _day(2)
    p = _Patch()
    p.set(cc, "_get_events", lambda *a, **k: [_all_day("evA", "Анна Петрова #1234", d)])
    try:
        hist = cc.sync_client_history("cal@example.com", "c1", "1234", client_name="Анна Петрова")
        assert hist == [], "история клиента подтянула событие на весь день"
    finally:
        p.undo()
    src = open(cc.__file__).read()
    assert 'ev.get("status") == "cancelled" or is_all_day_event(ev)' in src, \
        "поиск события для привязки к сессии снова видит события на весь день"


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
    print("СТОРОЖ ВЕСЬ ДЕНЬ/ЛИЧНЫЕ ДЕЛА: OK" if not failures else f"СТОРОЖ УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
