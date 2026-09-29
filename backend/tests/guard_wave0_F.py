"""СТОРОЖ волны 0, пакет F — Psy-CRM на телефоне (/m/crm/*).

Что уже починили и не должно сломаться снова:
  G6-01  заметки в карточке клиента были пустыми (читалось поле text вместо content);
  G6-10  заметка из шторки сессии писалась в session.notes и нигде больше не была видна;
  G6-03  «Отменить бронь кабинета» — с одного тапа; сама отмена падала 500
         (detach-cabinet не передавал background_tasks в cancel_booking);
  M1     на телефоне прошедшие сессии не закрывались сами → долги занижены;
  X5-M3  «Финансы» при сбое показывали 0 ₾ и «Нет задолженностей»;
  X5-03  «Сегодня»: под новой датой висели сессии прошлого дня.

Гоняется без сети и без боевой базы (чтение исходников, заглушки, SQLite в памяти):

    python3 backend/tests/guard_wave0_F.py
"""
import importlib.util
import inspect
import os
import pathlib
import sys
from datetime import datetime
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

BACKEND = pathlib.Path(__file__).parent.parent
ROOT = BACKEND.parent
MCRM = ROOT / "src/pages/mobile/crm"


def _src(rel: str) -> str:
    return (ROOT / rel).read_text()


def _between(src: str, start: str, end: str) -> str:
    i = src.find(start)
    assert i >= 0, f"не нашли «{start}»"
    j = src.find(end, i + len(start))
    return src[i:j if j >= 0 else len(src)]


# ─── G6-01 ───────────────────────────────────────────────────────────────

def test_client_card_note_shows_content():
    """В ленте клиента текст заметки — n.content. Поле text у CrmNote нет,
    и `as any` прятал ошибку от TypeScript."""
    src = (MCRM / "MobileCrmClient.tsx").read_text()
    assert ".text ||" not in src and "(n as any).text" not in src, \
        "лента клиента снова читает несуществующее поле text — заметки будут пустыми"
    row = _between(src, "function NoteRow", "\n}\n")
    assert "n.content" in row, "NoteRow не выводит n.content"
    assert "as any" not in row, "в NoteRow вернулся `as any` — TypeScript не поймает опечатку в поле"
    assert "setExpanded" in row, "длинную заметку снова нельзя раскрыть целиком"


# ─── G6-10 ───────────────────────────────────────────────────────────────

def test_session_sheet_notes_are_shared_notes():
    """Шторка сессии пишет и читает общие заметки (TherapistNote), а не
    поле session.notes, которое больше нигде не видно."""
    src = (MCRM / "SessionActionSheet.tsx").read_text()
    assert "update({ notes" not in src, "шторка снова пишет заметку в session.notes"
    assert "crmApi.createNote({ clientId: session.clientId, sessionId: session.id" in src, \
        "заметка из шторки не создаётся как TherapistNote с привязкой к сессии"
    assert "crmApi.getNotes(session.clientId, undefined, session.id)" in src, \
        "шторка не читает заметки сессии из общих Заметок"
    api = _src("src/api/crm.ts")
    assert "session_id: sessionId" in api, "getNotes не передаёт session_id на сервер"


def test_chessboard_link_note_goes_to_notes():
    """Десктопное окно привязки брони к сессии: «Заметка к сессии» → TherapistNote."""
    body = _between(_src("src/pages/crm/CrmBookings.tsx"),
                    "const handleLinkSession", "const FILTERS")
    assert "notes: notes" not in body, "окно привязки снова пишет заметку в session.notes"
    assert "createNote({ clientId, sessionId" in body, "заметка из окна привязки не попадает в Заметки"


def test_legacy_session_notes_migration():
    """Скрипт переноса старых session.notes: переносит текст специалиста,
    пропускает служебную пометку с сайта и дубли, повторный запуск — 0."""
    from sqlmodel import Session, SQLModel, create_engine, select
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_note import TherapistNote
    from app.models.therapy_session import TherapySession

    spec = importlib.util.spec_from_file_location(
        "migrate_session_notes_2026_09", BACKEND / "scripts/migrate_session_notes_2026_09.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    eng = create_engine("sqlite://")
    SQLModel.metadata.create_all(eng, tables=[
        TherapistClient.__table__, TherapistNote.__table__, TherapySession.__table__,
    ])
    with Session(eng) as s:
        s.add(TherapistClient(id="c1", specialist_id="sp1", name="Анна"))
        d = datetime(2026, 9, 1, 10, 0)
        s.add(TherapySession(id="s1", client_id="c1", specialist_id="sp1", date=d,
                             notes="Говорили о тревоге"))
        s.add(TherapySession(id="s2", client_id="c1", specialist_id="sp1", date=d,
                             notes="Заявка через публичный сайт. Кабинет и оплата — отдельно."))
        s.add(TherapySession(id="s3", client_id="c1", specialist_id="sp1", date=d,
                             notes="Уже перенесено"))
        s.add(TherapistNote(client_id="c1", session_id="s3", specialist_id="sp1",
                            content="Уже перенесено"))
        s.commit()

    orig_engine = mod.engine
    mod.engine = eng
    try:
        mod.run(apply=False)
        with Session(eng) as s:
            assert len(s.exec(select(TherapistNote)).all()) == 1, "холостой прогон что-то записал"
        mod.run(apply=True)
        mod.run(apply=True)  # повторный запуск не должен плодить дубли
        with Session(eng) as s:
            notes = s.exec(select(TherapistNote)).all()
            by_session = {n.session_id: n for n in notes}
            assert len(notes) == 2, f"ждали 2 заметки, получили {len(notes)}"
            assert by_session["s1"].content == "Говорили о тревоге"
            assert by_session["s1"].client_id == "c1" and by_session["s1"].specialist_id == "sp1"
            assert "s2" not in by_session, "служебная пометка с сайта попала в Заметки"
            # session.notes не трогаем — перенос без потерь
            assert s.get(TherapySession, "s1").notes == "Говорили о тревоге"
    finally:
        mod.engine = orig_engine


# ─── G6-03 ───────────────────────────────────────────────────────────────

def test_cabinet_cancel_needs_second_step():
    """Отмена брони кабинета — только из отдельного шага с последствиями,
    не с одного тапа в главном меню шторки."""
    src = (MCRM / "SessionActionSheet.tsx").read_text()
    main = _between(src, "function Main(", "\nfunction RescheduleForm")
    assert "onCancelBooking" not in main and "handleDetach" not in main, \
        "в главном меню шторки снова кнопка, отменяющая бронь с одного тапа"
    assert "ОК = только открепить" not in src, "вернулся непонятный системный confirm()"
    cab = _between(src, "function CabinetForm", "\nfunction DeleteConfirm")
    assert "hoursLeft < 24" in cab, "шаг «Кабинет» не предупреждает, что за сутки отменить нельзя"
    assert "оплата вернётся" in cab, "шаг «Кабинет» не говорит про возврат оплаты"
    assert "тоже отменится" not in src, \
        "«Отменить сессию» снова обещает отменить бронь, хотя delete_session её не трогает"


def test_note_delete_asks_confirmation():
    src = (MCRM / "SessionActionSheet.tsx").read_text()
    body = _between(src, "const handleDeleteNote", "// Drag-to-dismiss")
    assert "await confirm(" in body and "destructive: true" in body, \
        "заметка в шторке удаляется без подтверждения"
    assert body.find("await confirm(") < body.find("crmApi.deleteNote("), \
        "удаление заметки идёт раньше подтверждения"


def test_detach_cabinet_cancel_passes_background_tasks():
    """detach-cabinet?cancel_booking=true вызывал cancel_booking без
    background_tasks → TypeError → 500, бронь не отменялась никогда."""
    from fastapi import BackgroundTasks
    import app.api.v1.bookings.routes as routes
    from app.api.v1.crm import sessions as crm_sessions

    ts = SimpleNamespace(id="s1", specialist_id="u1", booking_id="b1",
                         is_booked=True, updated_at=None)

    class _Db:
        def get(self, model, key):
            return ts if key == "s1" else None

        def refresh(self, obj):
            pass

        def add(self, obj):
            pass

        def commit(self):
            pass

    captured = {}

    def fake_cancel(**kw):
        captured.update(kw)

    real = routes.cancel_booking
    routes.cancel_booking = fake_cancel
    try:
        res = crm_sessions.detach_session_cabinet(
            session_id="s1", background_tasks=BackgroundTasks(), cancel_booking=True,
            session=_Db(), current_user=SimpleNamespace(id="u1"),
        )
    finally:
        routes.cancel_booking = real
    assert res["booking_cancelled"] is True
    assert "background_tasks" in captured, "cancel_booking вызывается без background_tasks"
    # Настоящая подпись должна принять ровно такой набор аргументов.
    inspect.signature(real).bind(**captured)


# ─── M1 ──────────────────────────────────────────────────────────────────

def test_mobile_crm_autocompletes_past_sessions():
    """На телефоне, как на десктопе, прошедшие сессии закрываются сами,
    и экраны с деньгами/статусами перечитываются."""
    layout = (MCRM / "MobileCrmLayout.tsx").read_text()
    assert "crmApi.autoCompleteSessions()" in layout, "мобильная CRM не закрывает прошедшие сессии"
    assert "<Outlet context={outletContext}" in layout, "экраны не узнают, что данные обновились"
    for name in ("MobileCrmFinance.tsx", "MobileCrmClient.tsx", "MobileCrmToday.tsx", "MobileCrmSessions.tsx"):
        src = (MCRM / name).read_text()
        assert "useCrmDataVersion()" in src and "dataVersion]" in src, \
            f"{name} не перечитывает данные после автозакрытия сессий"


# ─── X5-states-speed-M3 ──────────────────────────────────────────────────

def test_mobile_finance_error_is_not_zero():
    src = (MCRM / "MobileCrmFinance.tsx").read_text()
    assert "(value || 0).toFixed" not in src, "при сбое «Финансы» снова рисуют 0 ₾"
    assert "setFailed(true)" in src and "Не удалось загрузить финансы" in src, \
        "у «Финансов» нет состояния ошибки"
    # rfind: последнее вхождение — сам текст на экране (выше — комментарии).
    i_fail, i_none = src.find(": !dashboard ?"), src.rfind("Нет задолженностей")
    assert 0 <= i_fail < i_none, "«Нет задолженностей» показывается и при сбое загрузки"


# ─── X5-03 ───────────────────────────────────────────────────────────────

def test_today_never_shows_other_day():
    src = (MCRM / "MobileCrmToday.tsx").read_text()
    assert "loaded?.date === dateStr" in src, "список дня не привязан к своей дате"
    assert "seq !== reqSeq.current" in src, "запоздавший ответ за другой день перезапишет список"
    assert "setSessions(list)" not in src, "вернулась старая схема без проверки даты"
    assert "Не удалось загрузить день" in src, "при сбое нет строки «Не удалось загрузить день»"


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
    print("СТОРОЖ F: OK" if not failures else f"СТОРОЖ F УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
