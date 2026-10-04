"""СТОРОЖ: контроль денег без Excel (решение владельца 02.10).

Владелец уходит от таблиц админов: то, что админы сверяли руками, теперь
должны ловить сайт и ревизор. Что держит этот сторож:

  1  Закрытие смены (cashbox/shifts.py → services/shift_alert.py): при
     |расхождении| больше 5 ₾ владельцу уходит Telegram «Касса Unbox One: при
     закрытии смены (Валентина) ожидалось 7 600 ₾, пересчитано 7 580 ₾,
     расхождение −20 ₾» через telegram_service.send_owner_summary — те же
     получатели, что у ревизора. До 5 ₾ включительно — тишина. Сбой Telegram не
     роняет закрытие, повтор не даёт второго сообщения.
  2  Очередь закрытия смены по филиалу (pg advisory lock, на SQLite — пропуск):
     отчёт и корректировка — одним commit; второе закрытие с теми же цифрами
     даёт расхождение 0 и одну корректировку на двоих.
  3  Ревизор (scripts/money_audit.py): старые 10 проверок на месте и идут всегда,
     даже если новые не смогли загрузиться (нет shift_alert / движка цен);
     шесть новых — по заголовкам, их SQL выполняется на SQLite с ожидаемыми
     строками. «Для сведения» (повтор прихода, расхождения смен) — окно 24 ч,
     каждое событие один раз, отдельный блок, не влияют на код возврата.
  4  Перепроверка недельной скидки совпадает с настоящим начислением
     (run_weekly_rebates): пакет на неделе — по записи ленты, начисление — по
     журналу; цикл формулы совпадает с weekly_rebate.py построчно; допы к брони
     в скидку не входят (решение владельца 02.10).
  5  Продажа абонемента из карточки клиента и из кассы — с филиалом кассы.
  6  Без имён клиентов в ревизоре; money-reviewer знает про новые проверки.

Без сети и боевой базы: SQLite в памяти, транспорт Telegram подменён.

    python3 backend/tests/guard_money_controls_2026_10.py
"""
import contextlib
import io
import json
import os
import pathlib
import re
import sys
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent
NBSP = " "

# «Сейчас» для ревизора: пт 02.10.2026 06:00 UTC — время ночного крона (10:00 по Тбилиси).
NOW = datetime(2026, 10, 2, 6, 0)
# Прошлая (завершившаяся) неделя для NOW — пн 21.09.
WEEK = date(2026, 9, 21)

OLD_KEYS = [
    "subscription_label_mismatch", "stale_pending", "rebate_on_unpaid",
    "broken_subscription_pool", "negative_pool", "broken_extra_pool",
    "extra_booking_overdraw", "charge_amount_mismatch", "balance_vs_ledger",
    "over_credit_limit",
]
NEW_TITLES = {
    "income_without_branch": "Приход денег без филиала",
    "cash_expense_without_branch": "Расход наличных без филиала",
    "free_booking": "Бронь за 0 ₾ — кабинет уходит бесплатно",
    "weekly_rebate_recheck": "Недельная скидка за прошлую неделю начислена не той суммой",
    "repeat_income_same_day": "Повторный приход за день: тому же клиенту та же сумма дважды",
    "shift_discrepancies_day": "Расхождения кассы на закрытии смен за сутки (больше 5 ₾)",
}
INFO_KEYS = {"repeat_income_same_day", "shift_discrepancies_day"}
INFO_MARK = "Не баг кода, а сигнал бизнесу"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


# ─── Фикстуры ────────────────────────────────────────────────────────────

def _db():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine
    import app.models  # noqa: F401
    import app.models.balance_ledger  # noqa: F401
    import app.models.bonus  # noqa: F401
    import app.models.weekly_rebate  # noqa: F401
    from app.models.resource import Resource

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng)
    s = Session(eng)
    s.add(Resource(id="room_1", name="Кабинет 1", type="cabinet", location_id="unbox_uni",
                   hourly_rate=20.0, capacity=4, area=10, formats=["individual"]))
    s.commit()
    return s


_AUDIT = {}


def _audit(fresh: bool = False):
    """scripts/money_audit.py как модуль (это скрипт, а не пакет). fresh — новая
    загрузка (проверить, что модуль грузится без зависимостей)."""
    if fresh or "m" not in _AUDIT:
        import importlib.util
        name = "money_audit_guard_fresh" if fresh else "money_audit_guard"
        spec = importlib.util.spec_from_file_location(name, ROOT / "backend" / "scripts" / "money_audit.py")
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        if fresh:
            return m
        _AUDIT["m"] = m
    return _AUDIT["m"]


def _check(ma, key):
    return next(c for c in ma.CHECKS if c.key == key)


def _old_standins(ma):
    """Первые 10 проверок с тем же ключом/заголовком, но с SQL для SQLite (их
    настоящий SQL — Postgres): проверяем, что раннер их выполняет."""
    return [ma.Check(key=c.key, title=c.title, sql="SELECT 1 AS x WHERE 1 = 0", why=c.why)
            for c in ma.CHECKS[:10]]


def _run_audit(ma, s, checks=None, params=None, alert=False, as_json=True):
    """run() ревизора на SQLite-фикстуре. SET TRANSACTION READ ONLY — синтаксис
    Postgres, на SQLite заменяем пустышкой. params — функция вместо audit_params."""
    real = (ma.engine, ma.CHECKS, ma.audit_params, ma.text)

    def _text(sql):
        return real[3]("SELECT 1" if sql.strip().upper().startswith("SET TRANSACTION") else sql)

    ma.engine, ma.text = s.get_bind(), _text
    if checks is not None:
        ma.CHECKS = checks
    if params is not None:
        ma.audit_params = params
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            code = ma.run(as_json=as_json, alert=alert)
    finally:
        ma.engine, ma.CHECKS, ma.audit_params, ma.text = real
    out = buf.getvalue()
    return code, (json.loads(out) if as_json else out)


def _user(s, email, name=None, pricing_system="standard", pdp=0, sub=None):
    from app.models.user import User
    u = User(email=email, name=name or email.split("@")[0], hashed_password="x", balance=0.0,
             pricing_system=pricing_system, personal_discount_percent=pdp, subscription=sub)
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _bk(s, user, day, *, price=0.0, method="balance", pay="paid", rule="NONE", status="confirmed",
        start="12:00", duration=60, user_id=None, hours=None, charge=None, extras=None):
    from app.models.booking import Booking
    b = Booking(
        resource_id="room_1", location_id="unbox_uni", date=day, start_time=start,
        duration=duration, status=status, final_price=price, base_price=20.0,
        applied_rule=rule, payment_method=method, payment_status=pay,
        user_id=user_id or (user.email if user else ""), user_uuid=(user.id if user else None),
        hours_deducted=hours, charge_amount=charge, extras=extras or [],
    )
    s.add(b)
    s.commit()
    s.refresh(b)
    return b


def _cash(s, amount, *, type="income", branch="Unbox One", method="cash", category=None,
          when=None, created=None, client=None, client_name=None, credited=None, desc=None,
          currency="GEL", admin="Мария"):
    from app.models.cashbox_transaction import CashboxTransaction
    when = when or datetime(2026, 9, 1, 9, 0)
    tx = CashboxTransaction(
        type=type, amount=amount, currency=currency, payment_method=method, category_id=category,
        description=desc, branch=branch, date=when, created_at=created or when,
        admin_id="seed", admin_name=admin, client_id=client, client_name=client_name,
        credited_user_id=credited,
    )
    s.add(tx)
    s.commit()
    return tx


def _pay(s, user, amount, created, *, method="cash", branch="Unbox One", admin="Мария",
         currency="GEL", by_email=False):
    """Приход от клиента: по id с зачислением на баланс или (by_email) по email без него."""
    return _cash(
        s, amount, method=method, branch=branch, when=created, created=created, admin=admin,
        currency=currency, client=(user.email if by_email else str(user.id)), client_name=user.name,
        credited=(None if by_email or method == "adjustment" else str(user.id)),
    )


def _shift(s, end, disc, branch, admin, expected=500.0):
    from app.models.shift_report import ShiftReport
    r = ShiftReport(
        expected_balance=expected, actual_balance=round(expected + disc, 2), discrepancy=disc,
        notes=f"[{branch}]", branch=branch, shift_start=end - timedelta(hours=8), shift_end=end,
        admin_id="seed", admin_name=admin,
    )
    s.add(r)
    s.commit()
    return r


def _recon(s):
    from sqlmodel import select
    from app.models.cashbox_transaction import CashboxTransaction
    return s.exec(select(CashboxTransaction).where(
        CashboxTransaction.category_id == "cash_reconciliation")).all()


@contextlib.contextmanager
def _telegram(owner="OWNER-CHAT", admin="ADMIN-CHAT", fail=False):
    """Подменить транспорт Telegram и чаты; вернуть список отправленного."""
    from app.core import config
    from app.services import shift_alert
    from app.services.telegram import telegram_service

    sent = []

    def fake_send(*, chat_id, text, parse_mode=None, disable_web_page_preview=True, reply_markup=None):
        if fail:
            raise RuntimeError("Telegram недоступен")
        sent.append({"chat_id": chat_id, "text": text, "parse_mode": parse_mode})
        return True

    orig = (telegram_service._send_message, config.settings.TELEGRAM_OWNER_CHAT_ID,
            config.settings.TELEGRAM_ADMIN_CHAT_ID)
    telegram_service._send_message = fake_send
    config.settings.TELEGRAM_OWNER_CHAT_ID = owner
    config.settings.TELEGRAM_ADMIN_CHAT_ID = admin
    shift_alert._recent.clear()
    try:
        yield sent
    finally:
        (telegram_service._send_message, config.settings.TELEGRAM_OWNER_CHAT_ID,
         config.settings.TELEGRAM_ADMIN_CHAT_ID) = orig
        shift_alert._recent.clear()


@contextlib.contextmanager
def _logs(name="app.services.shift_alert"):
    """Собрать записи лога (и не сыпать трассировками в вывод сторожа)."""
    import logging

    records = []

    class _Keep(logging.Handler):
        def emit(self, record):
            records.append(record)

    lg = logging.getLogger(name)
    handler = _Keep(level=logging.DEBUG)
    saved = (lg.propagate, lg.level)
    lg.addHandler(handler)
    lg.propagate = False
    lg.setLevel(logging.DEBUG)
    try:
        yield records
    finally:
        lg.removeHandler(handler)
        lg.propagate, lg.level = saved


@contextlib.contextmanager
def _blocked(*names):
    """Модули «не выложены»: их import даёт ImportError."""
    saved = {n: sys.modules[n] for n in names if n in sys.modules}
    for n in names:
        sys.modules[n] = None
    try:
        yield
    finally:
        for n in names:
            if n in saved:
                sys.modules[n] = saved[n]
            else:
                sys.modules.pop(n, None)


def _close(s, actual, branch="Unbox One", name="Валентина", notes=None):
    """Закрыть смену как это делает POST /cashbox/shifts, затем выполнить фоновые
    задачи (их Starlette запускает после ответа)."""
    from fastapi import BackgroundTasks
    from app.api.v1.cashbox.shifts import end_shift
    from app.models.shift_report import ShiftReportCreate

    bg = BackgroundTasks()
    admin = SimpleNamespace(id=uuid4(), name=name, role="admin")
    report = end_shift(
        payload=ShiftReportCreate(actual_balance=actual, notes=notes, branch=branch),
        background_tasks=bg, session=s, current_user=admin,
    )
    for task in bg.tasks:
        task.func(*task.args, **task.kwargs)
    return report


def _plain(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html).replace(NBSP, " ")


# ─── 1. Telegram при расхождении кассы на закрытии смены ─────────────────

def test_shift_alert_sent_when_discrepancy_over_5():
    s = _db()
    _cash(s, 7600.0)
    with _telegram() as sent:
        rep = _close(s, 7580.0, notes="не хватает 20, ищу")
    assert round(rep.discrepancy, 2) == -20.0
    assert len(sent) == 1, sent
    assert sent[0]["chat_id"] == "OWNER-CHAT", "сообщение ушло не владельцу"
    text = _plain(sent[0]["text"])
    want = ("Касса Unbox One: при закрытии смены (Валентина) ожидалось 7 600 ₾, "
            "пересчитано 7 580 ₾, расхождение −20 ₾")
    assert want in text, text
    assert "Комментарий админа: не хватает 20, ищу" in text
    # корректирующая операция — как раньше
    recon = _recon(s)
    assert len(recon) == 1 and recon[0].type == "expense" and recon[0].amount == 20.0
    assert recon[0].shift_report_id == str(rep.id) and recon[0].branch == "Unbox One"


def test_shift_alert_silent_at_or_below_5():
    for actual, disc in ((7595.0, -5.0), (7605.0, 5.0), (7596.5, -3.5), (7600.0, 0.0)):
        s = _db()
        _cash(s, 7600.0)
        with _telegram() as sent:
            rep = _close(s, actual)
        assert round(rep.discrepancy, 2) == disc
        assert sent == [], f"сообщение при расхождении {disc} ₾ (порог — строго больше 5)"
        assert len(_recon(s)) == (0 if disc == 0 else 1), "корректировка должна писаться как раньше"
    s = _db()
    _cash(s, 7600.0)
    with _telegram() as sent:
        _close(s, 7605.01)
    assert len(sent) == 1 and "+5,01 ₾" in _plain(sent[0]["text"]), sent


def test_shift_alert_failure_does_not_break_close():
    from sqlmodel import select
    from app.models.shift_report import ShiftReport
    from app.services import shift_alert

    s = _db()
    _cash(s, 7600.0)
    with _logs() as logs, _telegram(fail=True) as sent:
        rep = _close(s, 7550.0)
    assert rep.id and round(rep.discrepancy, 2) == -50.0 and sent == []
    assert len(s.exec(select(ShiftReport)).all()) == 1
    assert len(_recon(s)) == 1, "сбой Telegram не должен отменять корректировку"
    assert any("не смог отправить" in r.getMessage() for r in logs), "сбой отправки не попал в лог"

    # Сбой ещё раньше — при подготовке текста — тоже не роняет закрытие.
    real = shift_alert.format_message
    shift_alert.format_message = lambda **kw: 1 / 0
    try:
        s2 = _db()
        _cash(s2, 100.0)
        with _logs() as logs2, _telegram() as sent2:
            rep2 = _close(s2, 50.0)
        assert round(rep2.discrepancy, 2) == -50.0 and sent2 == []
        assert len(_recon(s2)) == 1
        assert any("сбой при подготовке" in r.getMessage() for r in logs2), "сбой не попал в лог"
    finally:
        shift_alert.format_message = real

    # Даже если модуля сообщений нет (выложили shifts.py без shift_alert.py) —
    # смена закрывается, корректировка пишется, сбой в логе.
    with _blocked("app.services.shift_alert"):
        s3 = _db()
        _cash(s3, 100.0)
        with _logs("app.api.v1.cashbox.shifts") as logs3:
            rep3 = _close(s3, 80.0)
    assert round(rep3.discrepancy, 2) == -20.0 and len(_recon(s3)) == 1
    assert any("не удалось поставить" in r.getMessage() for r in logs3), "сбой импорта не попал в лог"


def test_shift_alert_not_repeated_on_retry():
    from app.services.shift_alert import notify_shift_discrepancy

    s = _db()
    _cash(s, 7600.0)
    with _telegram() as sent:
        first = _close(s, 7580.0)
        again = _close(s, 7580.0)  # повтор того же запроса (обрыв связи, второе нажатие)
    assert round(first.discrepancy, 2) == -20.0
    assert round(again.discrepancy, 2) == 0.0, "корректировка не вошла в итог кассы"
    assert len(sent) == 1, sent
    assert len(_recon(s)) == 1

    # Одновременные запросы с теми же цифрами — одно сообщение; другое закрытие — своё.
    with _logs(), _telegram() as sent2:
        kw = dict(branch="Unbox Uni", admin_name="Лиза", expected=500.0, actual=480.0, discrepancy=-20.0)
        assert notify_shift_discrepancy(None, **kw) is True
        assert notify_shift_discrepancy(None, **kw) is False
        assert notify_shift_discrepancy(None, **dict(kw, branch="Unbox One")) is True
    assert len(sent2) == 2, sent2


def test_shift_alert_goes_to_audit_recipients():
    s = _db()
    _cash(s, 1000.0)
    with _telegram(owner=None, admin="ADMIN-CHAT") as sent:
        _close(s, 900.0)
    assert [m["chat_id"] for m in sent] == ["ADMIN-CHAT"], "без чата владельца — как у ревизора, в чат админов"
    s = _db()
    _cash(s, 1000.0)
    with _logs() as logs, _telegram(owner=None, admin=None) as sent:
        rep = _close(s, 900.0)
    assert sent == [] and rep.id
    assert any("не доставлено" in r.getMessage() for r in logs)
    # Чат выбирает telegram_service.send_owner_summary — в shift_alert выбор не дублируется,
    # а у ревизора он тот же.
    alert = _read("backend/app/services/shift_alert.py")
    code = alert[alert.index('"""', 3) + 3:]
    assert "telegram_service.send_owner_summary(" in code, "сообщение о кассе снова выбирает чат само"
    assert "TELEGRAM_OWNER_CHAT_ID" not in code and "TELEGRAM_ADMIN_CHAT_ID" not in code
    tg = _read("backend/app/services/telegram.py")
    i = tg.index("def send_owner_summary")
    owner = tg[i:tg.index("\n    def ", i + 10)]
    line = "settings.TELEGRAM_OWNER_CHAT_ID or settings.TELEGRAM_ADMIN_CHAT_ID"
    assert line in owner and line in _read("backend/scripts/money_audit.py"), "получатели разошлись с ревизором"


def test_shift_alert_after_close_is_written():
    from app.services import shift_alert
    src = _read("backend/app/api/v1/cashbox/shifts.py")
    body = src[src.index("def end_shift("):src.index('@router.get("/analytics")')]
    assert "background_tasks: BackgroundTasks" in body, "отправка должна идти в фоне, ответ админу не ждёт Telegram"
    i_recon = body.index("session.add(recon)")
    i_commit = body.index("session.commit()", i_recon)
    i_notify = body.index("notify_shift_discrepancy(")
    assert i_commit < i_notify < body.index("return report"), "сообщение — только после записи отчёта и корректировки"
    assert 'category_id="cash_reconciliation"' in body, "корректировка при закрытии смены пропала"
    call = body[body.rindex("try:", 0, i_notify):body.index("return report")]
    assert "except Exception" in call, "вызов сообщения не обёрнут в try/except — сбой уронит закрытие смены"
    assert shift_alert.SHIFT_DISCREPANCY_ALERT_GEL == 5.0, "порог владельца — 5 ₾"
    assert shift_alert.fmt_gel(7600) == f"7{NBSP}600{NBSP}₾"
    assert shift_alert.fmt_gel(-20, sign=True) == f"−20{NBSP}₾"
    assert shift_alert.fmt_gel(7580.5) == f"7{NBSP}580,5{NBSP}₾"


# ─── 2. Очередь закрытия смены по филиалу ────────────────────────────────

def test_shift_close_queue_lock():
    from fastapi import HTTPException
    from sqlalchemy.exc import OperationalError
    from sqlmodel import select
    import app.api.v1.cashbox.shifts as sh
    from app.models.shift_report import ShiftReport

    src = _read("backend/app/api/v1/cashbox/shifts.py")
    body = src[src.index("def end_shift("):src.index('@router.get("/analytics")')]
    i_lock = body.index("_lock_shift_close(session, payload.branch)")
    assert i_lock < body.index("now = datetime.now()") < body.index("last_shift = session.exec(last_query).first()"), \
        "очередь должна браться до чтения прошлой смены и «ожидалось»"
    assert body.count("session.commit()") == 1, "отчёт и корректировка снова двумя commit — замок снимется раньше"

    class _Bind:
        def __init__(self, name):
            self.dialect = SimpleNamespace(name=name)

    class _Fake:
        def __init__(self, dialect="postgresql", fail=None):
            self.bind, self.fail, self.sql, self.params, self.rolled = _Bind(dialect), fail, [], [], False

        def get_bind(self):
            return self.bind

        def execute(self, stmt, params=None):
            self.sql.append(str(stmt))
            self.params.append(params)
            if self.fail is not None and "pg_advisory_xact_lock" in str(stmt):
                raise self.fail

        def rollback(self):
            self.rolled = True

    f = _Fake()
    sh._lock_shift_close(f, "Unbox One")
    assert f.sql == ["SET LOCAL lock_timeout = '5s'", "SELECT pg_advisory_xact_lock(7102, hashtext(:k))",
                     "SET LOCAL lock_timeout TO DEFAULT"], f.sql
    assert f.params[1] == {"k": "shift-close:Unbox One"}
    g = _Fake()
    sh._lock_shift_close(g, None)
    assert g.params[1] == {"k": "shift-close:*"}, "общее закрытие — своя очередь"
    # ждали дольше 5 с — понятный 409, транзакция откатывается
    t = _Fake(fail=OperationalError("SELECT", {}, SimpleNamespace(pgcode="55P03")))
    try:
        sh._lock_shift_close(t, "Unbox Uni")
        raise AssertionError("ждали 409 при тайм-ауте очереди")
    except HTTPException as e:
        assert e.status_code == 409 and t.rolled
    # другую ошибку базы не прячем
    o = _Fake(fail=OperationalError("SELECT", {}, SimpleNamespace(pgcode="40P01")))
    try:
        sh._lock_shift_close(o, "Unbox Uni")
        raise AssertionError("ждали OperationalError")
    except OperationalError:
        pass
    # SQLite — без замка
    q = _Fake(dialect="sqlite")
    sh._lock_shift_close(q, "Unbox One")
    assert q.sql == []

    # Два закрытия подряд с одинаковыми цифрами — одна корректировка, второе — расхождение 0.
    s = _db()
    _cash(s, 7600.0)
    with _telegram():
        first = _close(s, 7580.0)
        second = _close(s, 7580.0)
    assert round(first.discrepancy, 2) == -20.0 and round(second.discrepancy, 2) == 0.0
    assert len(_recon(s)) == 1, "двойное закрытие снова пишет две корректировки"

    # Один commit: сорвалась запись корректировки — отчёта смены тоже нет.
    s2 = _db()
    _cash(s2, 100.0)
    real_add = s2.add

    def _add(obj, *a, **k):
        if getattr(obj, "category_id", None) == "cash_reconciliation":
            raise RuntimeError("сбой записи корректировки")
        return real_add(obj, *a, **k)

    s2.add = _add
    try:
        _close(s2, 90.0)
        raise AssertionError("ждали сбой записи корректировки")
    except RuntimeError:
        s2.rollback()
    finally:
        s2.add = real_add
    assert s2.exec(select(ShiftReport)).all() == [] and _recon(s2) == [], "отчёт записался без корректировки"


# ─── 3. Ревизор: состав, живучесть, «для сведения» ───────────────────────

def test_money_audit_has_new_checks():
    from sqlalchemy import text
    ma = _audit()
    keys = [c.key for c in ma.CHECKS]
    assert keys[:10] == OLD_KEYS, "старые 10 проверок сдвинуты или убраны"
    assert keys[10:] == list(NEW_TITLES), keys
    titles = {c.key: c.title for c in ma.CHECKS}
    for key, title in NEW_TITLES.items():
        assert titles[key] == title, f"в ревизоре нет проверки «{title}»"
    for c in ma.CHECKS[:10]:
        assert c.post is None and not c.info and isinstance(c.sql, str) and not text(c.sql).compile().params, \
            f"старая проверка {c.key} изменилась"
    p = ma.audit_params(NOW)
    for c in ma.CHECKS[10:]:
        sql = c.sql() if callable(c.sql) else c.sql
        assert set(text(sql).compile().params) <= set(p), f"{c.key}: параметр не из окон ревизора"


def test_informational_checks_marked_like_credit_limit():
    ma = _audit()
    by = {c.key: c for c in ma.CHECKS}
    assert by["over_credit_limit"].why.startswith(INFO_MARK) and not by["over_credit_limit"].info, \
        "«долг превысил лимит» — поведение прежнее"
    for key in INFO_KEYS:
        assert by[key].info and by[key].why.startswith(INFO_MARK), f"{key}: «для сведения» без пометки"
    for key in set(NEW_TITLES) - INFO_KEYS:
        assert not by[key].info and not by[key].why.startswith(INFO_MARK), f"{key}: это расхождение, а не сведение"
        assert "Что делать" in by[key].why


def test_audit_params_windows():
    ma = _audit()
    p = ma.audit_params(NOW)
    assert p["since_30d"] == datetime(2026, 9, 2, 6, 0)
    assert p["book_since"] == datetime(2026, 9, 2)
    assert p["since_24h"] == datetime(2026, 10, 1, 6, 0), "«для сведения» — с прошлого запуска (24 ч)"
    assert p["repeat_from"] == datetime(2026, 9, 30, 20, 0), "пара за день ищется с полуночи по Тбилиси"
    assert p["shift_alert_gel"] == 5.0
    assert p["rebate_week"] == WEEK and p["rebate_week_start"] == datetime(2026, 9, 21)
    assert (p["rebate_credit_from"], p["rebate_credit_to"]) == (datetime(2026, 9, 28), datetime(2026, 10, 5))
    # Крон скидки — пн 01:00 UTC: до 03:00 UTC понедельника смотрим позапрошлую неделю.
    assert ma.audit_params(datetime(2026, 10, 5, 0, 30))["rebate_week"] == WEEK
    assert ma.audit_params(datetime(2026, 10, 5, 6, 0))["rebate_week"] == date(2026, 9, 28)


def test_audit_survives_missing_modules():
    """money_audit.py выложили раньше shift_alert.py, или не загрузился движок
    цен / недельная скидка: первые 10 проверок всё равно выполняются."""
    with _blocked("app.services.shift_alert", "app.services.pricing", "app.services.weekly_rebate"):
        bare = _audit(fresh=True)  # модуль грузится и без них
        p = bare.audit_params(NOW)
        assert p["shift_alert_gel"] == 5.0, "без shift_alert — запасной порог 5 ₾"
        assert p["rebate_week"] == WEEK, "неделя считается и без weekly_rebate"
        s = _db()
        windows = bare.audit_params  # до подмены: _run_audit ставит params на место audit_params
        code, out = _run_audit(bare, s, checks=_old_standins(bare) + bare.CHECKS[10:],
                               params=lambda: windows(NOW))
    failed = {k for k, rows in out["details"].items() if "ошибка_проверки" in rows[0]}
    assert failed == {"free_booking", "weekly_rebate_recheck"}, out
    assert not set(out["details"]) & set(OLD_KEYS), "первые 10 проверок не выполнились"
    assert code == 1

    # Окна не посчитались вовсе — новые помечены «не выполнилась», первые 10 идут.
    ma = _audit()

    def _boom():
        raise RuntimeError("нет окна")

    code, out = _run_audit(ma, _db(), checks=_old_standins(ma) + ma.CHECKS[10:], params=_boom)
    assert set(out["details"]) == set(NEW_TITLES), out
    assert all("окна времени не посчитались" in rows[0]["ошибка_проверки"] for rows in out["details"].values())
    assert out["info"] == {} and code == 1


def test_audit_runner_survives_failing_check():
    ma = _audit()
    good = ma.Check(key="ok_empty", title="Пусто", sql="SELECT 1 AS x WHERE 1 = 0", why="—")
    bad = ma.Check(key="broken", title="Сломана", sql="SELECT * FROM нет_такой_таблицы", why="—")
    after = ma.Check(key="after", title="После сломанной", sql="SELECT 2 AS x", why="—")
    code, out = _run_audit(ma, _db(), checks=[good, bad, after], params=lambda: {})
    assert code == 1 and out["violations"] == {"broken": 1, "after": 1}, out
    assert "ошибка_проверки" in out["details"]["broken"][0], out
    # В Telegram упавшая проверка видна как «не выполнилась», а не как «1 расхождение».
    with _telegram() as sent:
        ma._send_telegram_alert(out["details"], {"broken": "Сломана", "after": "После сломанной"})
    text = _plain(sent[0]["text"])
    assert sent[0]["chat_id"] == "OWNER-CHAT"
    assert "Сломана: проверка не выполнилась" in text and "После сломанной: 1" in text, text


def test_audit_info_block_separate():
    """«Для сведения» не поднимает тревогу: не влияет на код возврата и счётчик
    расхождений, в Telegram — отдельная строка «Для сведения: N», только если N > 0."""
    ma = _audit()
    s = _db()
    main_ok = ma.Check(key="m_ok", title="Основная", sql="SELECT 1 AS x WHERE 1 = 0", why="—")
    main_bad = ma.Check(key="m_bad", title="Основная с расхождением", sql="SELECT 7 AS x", why="—")
    info_one = ma.Check(key="i_one", title="Сведение", sql="SELECT 1 AS x", why="—", info=True)
    info_none = ma.Check(key="i_none", title="Пустое сведение", sql="SELECT 1 AS x WHERE 1 = 0", why="—", info=True)

    with _telegram() as sent:
        code, out = _run_audit(ma, s, checks=[main_ok, info_one, info_none], params=lambda: {},
                               alert=True, as_json=False)
    assert code == 0, "сведения не должны давать код ошибки"
    assert "ВСЁ СХОДИТСЯ — 1 проверок пройдено" in out and "РАСХОЖДЕНИЙ" not in out, out
    assert "ДЛЯ СВЕДЕНИЯ" in out and "Для сведения: 1" in out and "Пустое сведение: нет" in out, out
    text = _plain(sent[0]["text"])
    assert "расхождений нет" in text and "Для сведения: 1 (Сведение — 1)" in text, text

    with _telegram() as sent:
        code, out = _run_audit(ma, s, checks=[main_bad, info_one, info_none], params=lambda: {}, alert=True)
    assert code == 1 and out["violations"] == {"m_bad": 1} and out["info"] == {"i_one": 1}, out
    text = _plain(sent[0]["text"])
    assert "расхождения" in text and "Основная с расхождением: 1" in text and "Для сведения: 1" in text, text

    with _telegram() as sent:
        code, out = _run_audit(ma, s, checks=[main_ok, info_none], params=lambda: {}, alert=True)
    assert code == 0 and sent == [] and out["info"] == {}, "без расхождений и сведений — тишина"

    broken_info = ma.Check(key="i_bad", title="Сломанное сведение", sql="SELECT * FROM нет_таблицы",
                           why="—", info=True)
    code, out = _run_audit(ma, s, checks=[broken_info], params=lambda: {})
    assert code == 1 and "i_bad" in out["violations"], "упавшая проверка — сбой, а не сведение"


# ─── 4. SQL новых проверок на SQLite ─────────────────────────────────────

def test_income_without_branch_sql():
    ma = _audit()
    s = _db()
    recent = datetime(2026, 9, 30, 9, 0)
    _cash(s, 50, branch=None, when=recent)                                   # ✓ наличные без филиала
    _cash(s, 40, branch="  ", method="card_tbc", when=recent)                # ✓ пустой филиал
    _cash(s, 30, branch=None, when=datetime(2026, 8, 1), created=datetime(2026, 10, 1, 8))  # ✓ задним числом
    to_cash = "Перевод: Карта TBC → Наличные"
    _cash(s, 100, type="expense", branch=None, method="card_tbc", desc=to_cash, when=recent)
    _cash(s, 100, branch=None, desc=to_cash, when=recent)                    # ✓ перевод В наличные
    card = "Перевод: Карта BOG → Карта TBC"
    _cash(s, 600, type="expense", branch=None, method="card_bog", desc=card, when=recent)
    _cash(s, 600, branch=None, method="card_tbc", desc=card, when=recent)    # пара в тот же день — не тревога
    _cash(s, 600, branch=None, method="card_tbc", desc=card, when=recent.replace(hour=11))  # ✓ второй приход без своего расхода
    _cash(s, 200, type="expense", branch=None, method="card_bog", desc=card, when=datetime(2026, 9, 26, 9))
    _cash(s, 200, branch=None, method="card_tbc", desc=card, when=datetime(2026, 9, 25, 9))  # ✓ «близнец» — в другой день
    # не считаются:
    _cash(s, 60, branch="Unbox One", when=recent)
    _cash(s, 70, branch=None, method="adjustment", when=recent)
    _cash(s, 80, branch=None, category="cash_reconciliation", when=recent)
    _cash(s, 90, branch=None, when=datetime(2026, 8, 1))                     # старше 30 дней
    _cash(s, 25, type="expense", branch=None, method="card_bog", when=recent)
    rows = ma.run_check(s, _check(ma, "income_without_branch"), ma.audit_params(NOW))
    assert sorted(r["amount"] for r in rows) == [30, 40, 50, 100, 200, 600], rows
    assert all(len(r["date"]) == 16 for r in rows), rows


def test_cash_expense_without_branch_sql():
    ma = _audit()
    s = _db()
    recent = datetime(2026, 9, 30, 9, 0)
    _cash(s, 35, type="expense", branch=None, when=recent)                                   # ✓
    _cash(s, 45, type="expense", branch=" ", when=recent)                                    # ✓
    from_cash = "Перевод: Наличные → Карта TBC"
    _cash(s, 55, type="expense", branch=None, desc=from_cash, when=recent)                   # ✓ перевод ИЗ наличных
    _cash(s, 55, branch=None, method="card_tbc", desc=from_cash, when=recent)
    _cash(s, 65, type="expense", branch=None, when=datetime(2026, 8, 1), created=datetime(2026, 10, 1))  # ✓
    # не считаются:
    _cash(s, 75, type="expense", branch="Unbox Uni", when=recent)
    _cash(s, 85, type="expense", branch=None, method="card_bog", when=recent)                # карта — не ящик
    _cash(s, 95, type="expense", branch=None, method="adjustment", when=recent)
    _cash(s, 15, type="expense", branch=None, category="cash_reconciliation", when=recent)
    _cash(s, 25, type="expense", branch=None, when=datetime(2026, 8, 1))                     # старше 30 дней
    _cash(s, 33, branch=None, when=recent)                                                    # приход — другая проверка
    rows = ma.run_check(s, _check(ma, "cash_expense_without_branch"), ma.audit_params(NOW))
    assert sorted(r["amount"] for r in rows) == [35, 45, 55, 65], rows


def test_free_booking_sql():
    from app.services.pricing import PricingService
    ma = _audit()
    s = _db()
    u = _user(s, "client@x.ge")
    half = _user(s, "half@x.ge", pricing_system="personal", pdp=50)
    partner = _user(s, "partner@x.ge", pricing_system="personal", pdp=100)
    owner = _user(s, "koren.nikolas@gmail.com")
    service = _user(s, "admin@unbox.com")
    d = datetime(2026, 9, 30)
    _bk(s, u, d, rule="MANUAL_OVERRIDE")                                      # ✓ ручная цена 0
    _bk(s, u, datetime(2026, 10, 10), pay="pending", rule="SUBSCRIPTION")     # ✓ ярлык «баланс» при цене абонемента
    _bk(s, half, d, rule="MANUAL_OVERRIDE")                                   # ✓ скидка 50 % — не повод для 0 ₾
    _bk(s, None, d, user_id="nobody@x.ge", rule="MANUAL_OVERRIDE")            # ✓ старая бронь без uuid
    # скрытая утечка: «по абонементу», оплачена, не списано ни часов, ни денег
    _bk(s, u, d, method="subscription", rule="SUBSCRIPTION", hours=0.0)        # ✓
    _bk(s, u, d, method="subscription", rule="SUBSCRIPTION", start="13:00")    # ✓ (часы не записаны)
    # не считаются:
    _bk(s, u, d, price=20.0)
    _bk(s, u, d, method="subscription", rule="SUBSCRIPTION", hours=1.0, charge=1.0)    # списаны часы
    _bk(s, u, d, method="subscription", rule="SUBSCRIPTION", charge=1.0)               # крон списал 1 ч (снимок)
    _bk(s, u, d, method="subscription", rule="SUBSCRIPTION", hours=0.0, charge=16.0)   # абонемент исчерпан → 16 ₾
    _bk(s, u, d, method="subscription", rule="SUBSCRIPTION", pay="pending")            # спишет крон
    _bk(s, u, d, method="bonus")
    _bk(s, u, d, method="service", pay="waived")
    _bk(s, u, d, pay="waived")
    _bk(s, u, d, rule="BONUS_HOUR")                                           # «Час в подарок»
    _bk(s, u, d, rule="BONUS_HOUR_PART")                                      # часть подарочной брони после «Разделить»
    _bk(s, u, d, status="cancelled")
    _bk(s, u, datetime(2026, 8, 20), rule="MANUAL_OVERRIDE")                  # старше 30 дней
    _bk(s, owner, d, rule="COMP_ACCOUNT")
    _bk(s, service, d, rule="MANUAL_OVERRIDE")
    _bk(s, partner, d, rule="PERSONAL_DISCOUNT")
    _bk(s, None, d, user_id="irina.cbtpsy@gmail.com")                         # старая бронь без uuid, comp
    _bk(s, None, d, user_id="PARTNER@x.ge", rule="PERSONAL_DISCOUNT")         # старая бронь без uuid, 100 % по email
    check = _check(ma, "free_booking")
    rows = ma.run_check(s, check, ma.audit_params(NOW))
    got = sorted((r["email"], r["date"], r["payment_method"], r["applied_rule"]) for r in rows)
    assert got == [
        ("client@x.ge", "2026-09-30", "balance", "MANUAL_OVERRIDE"),
        ("client@x.ge", "2026-09-30", "subscription", "SUBSCRIPTION"),
        ("client@x.ge", "2026-09-30", "subscription", "SUBSCRIPTION"),
        ("client@x.ge", "2026-10-10", "balance", "SUBSCRIPTION"),
        ("half@x.ge", "2026-09-30", "balance", "MANUAL_OVERRIDE"),
        ("nobody@x.ge", "2026-09-30", "balance", "MANUAL_OVERRIDE"),
    ], got
    sql = check.sql()
    for email in PricingService.COMP_ACCOUNTS | {"admin@unbox.com"}:
        assert f"'{email.lower()}'" in sql, f"comp-аккаунт {email} не исключён"


def test_repeat_income_same_day_sql():
    ma = _audit()
    s = _db()
    x = _user(s, "x@x.ge", "Клиент Х")
    y = _user(s, "y@x.ge", "Клиент У")
    z = _user(s, "z@x.ge", "Клиент Z")
    w = _user(s, "w@x.ge", "Клиент W")
    # ✓ Х: 20 ₾ в 08:45 по Тбилиси (до окна суток) картой в Uni и в 19:04 наличными в One — 01.10
    _pay(s, x, 20, datetime(2026, 10, 1, 4, 45), method="card_tbc", branch="Unbox Uni", admin="Лиза")
    _pay(s, x, 20, datetime(2026, 10, 1, 15, 4), branch="Unbox One", admin="Валентина")
    # ✓ У: одна запись по id с зачислением, вторая — по email без него
    _pay(s, y, 45, datetime(2026, 10, 1, 10, 0))
    _pay(s, y, 45, datetime(2026, 10, 1, 10, 2), by_email=True)
    # не считаются:
    _pay(s, z, 30, datetime(2026, 9, 30, 9, 0))      # пара прошлого дня — была во вчерашнем отчёте
    _pay(s, z, 30, datetime(2026, 9, 30, 9, 5))
    _pay(s, x, 25, datetime(2026, 9, 30, 19, 0))     # 23:00 по Тбилиси, 30.09
    _pay(s, x, 25, datetime(2026, 9, 30, 20, 30))    # 00:30 по Тбилиси — уже 01.10
    _pay(s, x, 26, datetime(2026, 10, 1, 9, 0))      # другая сумма
    _pay(s, x, 20, datetime(2026, 10, 1, 9, 30), currency="USD")
    _pay(s, z, 10, datetime(2026, 10, 1, 9, 0), method="adjustment")
    _pay(s, z, 10, datetime(2026, 10, 1, 9, 5), method="adjustment")
    for at in (datetime(2026, 10, 1, 11, 0), datetime(2026, 10, 1, 11, 5)):   # допы к броне — не дубль
        _cash(s, 3, when=at, created=at, client=str(y.id), client_name=y.name,
              desc="Допы к броне (дозаказ): coffee_meama")
    _cash(s, 15, when=datetime(2026, 10, 1, 9, 0))   # без клиента
    _cash(s, 15, when=datetime(2026, 10, 1, 9, 1))
    # W: пара 01.10 в 05:00 и 06:00 по Тбилиси — день тот же, но до окна суток:
    # её сообщил вчерашний запуск, сегодня — не повторяем
    _pay(s, w, 40, datetime(2026, 10, 1, 1, 0))
    _pay(s, w, 40, datetime(2026, 10, 1, 2, 0))
    check = _check(ma, "repeat_income_same_day")
    rows = ma.run_check(s, check, ma.audit_params(NOW))
    got = sorted((r["day"], r["client"], r["amount"], r["times"]) for r in rows)
    assert got == [("2026-10-01", "Клиент У", 45.0, 2), ("2026-10-01", "Клиент Х", 20.0, 2)], got
    xx = next(r for r in rows if r["client"] == "Клиент Х")
    assert "08:45 карта TBC · Unbox Uni · Лиза" in xx["entries"], xx
    assert "19:04 наличные · Unbox One · Валентина" in xx["entries"], xx
    # Через сутки те же пары не повторяются: каждое событие — один раз.
    assert ma.run_check(s, check, ma.audit_params(NOW + timedelta(days=1))) == []
    # А пары W и Z сообщил вчерашний запуск.
    earlier = {(r["client"], r["amount"]) for r in ma.run_check(s, check, ma.audit_params(NOW - timedelta(days=1)))}
    assert {("Клиент W", 40.0), ("Клиент Z", 30.0)} <= earlier, earlier


def test_shift_discrepancies_day_sql():
    ma = _audit()
    s = _db()
    _shift(s, datetime(2026, 10, 1, 14, 0), -20.0, "Unbox One", "Валентина")   # ✓
    _shift(s, datetime(2026, 10, 1, 8, 0), -5.01, "Unbox Uni", "Лиза")        # ✓
    _shift(s, datetime(2026, 10, 1, 7, 0), 5.0, "Unbox Uni", "Лиза")          # ровно порог — нет
    _shift(s, datetime(2026, 10, 1, 15, 0), 0.0, "Unbox Uni", "Лиза")
    _shift(s, datetime(2026, 10, 1, 5, 0), -50.0, "Unbox One", "Егор")        # до окна — было во вчерашнем отчёте
    check = _check(ma, "shift_discrepancies_day")
    rows = ma.run_check(s, check, ma.audit_params(NOW))
    assert [(r["branch"], r["discrepancy"]) for r in rows] == [("Unbox One", -20.0), ("Unbox Uni", -5.01)], rows
    assert ma.run_check(s, check, ma.audit_params(NOW + timedelta(days=1))) == []


# ─── 5. Недельная скидка ─────────────────────────────────────────────────

def _week(s, user):
    """6 ч за прошлую неделю, всё оплачено с баланса: пн–пт 12:00 по 20 ₾ и сб
    20:00 (пик) за 25 ₾. Тир недели 10 % → скидка 5 × 2 + 2 = 12 ₾. Пиковая бронь
    ловит «полуночный» баг: без времени старта добор вышел бы 7 ₾, а не 2."""
    for i in range(5):
        _bk(s, user, datetime.combine(WEEK + timedelta(days=i), time.min), price=20.0)
    return _bk(s, user, datetime.combine(WEEK + timedelta(days=5), time.min), price=25.0, start="20:00")


def _package_record(s, user, week):
    """Запись ленты, которую пишет крон недельных пакетов (services/weekly_package.py)."""
    from app.models.balance_ledger import BalanceLedger
    s.add(BalanceLedger(
        user_id=str(user.id), delta=-160.0, balance_after=0.0, reason="subscription_purchase",
        description=f"Пакет 16 ч на неделю {week:%d.%m}–{week + timedelta(days=6):%d.%m}",
        created_at=datetime.combine(week, time.min) - timedelta(hours=4),
    ))
    s.commit()


def test_weekly_rebate_recheck_matches_real_crediting():
    from sqlmodel import select
    from app.models.balance_ledger import BalanceLedger
    from app.models.weekly_rebate import WeeklyRebate
    from app.services.weekly_rebate import run_weekly_rebates

    ma = _audit()
    s = _db()
    check = _check(ma, "weekly_rebate_recheck")
    p = ma.audit_params(NOW)  # окно ленты: 28.09–05.10
    a = _user(s, "a@x.ge", "Клиент А")
    b = _user(s, "b@x.ge", "Клиент Б")
    _week(s, a)
    peak_b = _week(s, b)
    done = run_weekly_rebates(s, WEEK, dry_run=False)
    assert {d["user_email"]: d["rebate"] for d in done["details"]} == {"a@x.ge": 12.0, "b@x.ge": 12.0}, done
    assert ma.run_check(s, check, p) == [], "перепроверка разошлась с настоящим начислением"

    # Пакет оформили ПОСЛЕ начисления — не тревога: начисленное сверяем с формулой.
    b.subscription = {"weekly_package": True, "package_week": "2026-09-28", "status": "active"}
    s.add(b)
    s.commit()
    assert ma.run_check(s, check, p) == []
    # Неделя была пакетной (запись «Пакет … на неделю 21.09–27.09»), пакет есть и сейчас — скидки нет.
    e = _user(s, "e@x.ge", "Клиент Е", sub={"weekly_package": True, "package_week": "2026-09-28"})
    _package_record(s, e, WEEK)
    _week(s, e)
    assert ma.run_check(s, check, p) == []

    # Крон пропустил клиента → тревога; ожидаемое = сколько начислил бы run_weekly_rebates.
    c = _user(s, "c@x.ge", "Клиент В")
    _week(s, c)
    would = {d["user_email"]: d["rebate"] for d in run_weekly_rebates(s, WEEK, dry_run=True)["details"]}
    rows = ma.run_check(s, check, p)
    assert [(r["email"], r["expected"], r["credited"]) for r in rows] == [("c@x.ge", would["c@x.ge"], 0.0)], rows
    assert would["c@x.ge"] == 12.0

    # Запоздалый ручной прогон за эту неделю (20.10, вне окна ленты) — по журналу, не тревога.
    run_weekly_rebates(s, WEEK, dry_run=False)
    late = datetime(2026, 10, 20, 10, 0)
    for led in s.exec(select(BalanceLedger).where(
            BalanceLedger.user_id == str(c.id), BalanceLedger.reason == "weekly_rebate")).all():
        led.created_at = late
        s.add(led)
    jr = s.exec(select(WeeklyRebate).where(WeeklyRebate.user_id == c.id)).one()
    jr.created_at = late + timedelta(seconds=1)
    s.add(jr)
    s.commit()
    assert ma.run_check(s, check, p) == [], "запоздалое начисление за эту неделю принято за пропуск"

    # Пакет был НА ЭТОЙ неделе, а потом его сняли — не тревога (раньше была ложная).
    f = _user(s, "f@x.ge", "Клиент Г", sub={"plan_id": "REGULAR_PRACTITIONER", "status": "active"})
    _package_record(s, f, WEEK)
    _week(s, f)
    assert ma.run_check(s, check, p) == []

    # Ручное начисление за ДРУГУЮ неделю (14.09), сделанное в окне этой, — не путает счёт.
    at = datetime(2026, 9, 30, 12, 0)
    s.add(WeeklyRebate(user_id=a.id, week_start=WEEK - timedelta(days=7), total_hours=6.0,
                       tier_percent=10, amount=5.0, created_at=at))
    s.add(BalanceLedger(user_id=str(a.id), delta=5.0, balance_after=0.0, reason="weekly_rebate",
                        description="за 14.09", created_at=at + timedelta(seconds=1)))
    s.commit()
    assert ma.run_check(s, check, p) == [], "начисление за другую неделю засчитано этой"

    # Лишняя строка ленты в окне без пары в журнале (двойное начисление) → тревога.
    s.add(BalanceLedger(user_id=str(a.id), delta=12.0, balance_after=0.0, reason="weekly_rebate",
                        description="повтор", created_at=datetime(2026, 9, 29, 10, 0)))
    s.commit()
    rows = {r["email"]: r for r in ma.run_check(s, check, p)}
    assert (rows["a@x.ge"]["expected"], rows["a@x.ge"]["credited"], rows["a@x.ge"]["journal"]) == (12.0, 24.0, 12.0), rows

    # Журнал разошёлся с ожидаемым → тревога.
    jr.amount = 11.5
    s.add(jr)
    s.commit()
    rows = {r["email"]: r for r in ma.run_check(s, check, p)}
    assert (rows["c@x.ge"]["expected"], rows["c@x.ge"]["credited"], rows["c@x.ge"]["journal"]) == (12.0, 12.0, 11.5), rows

    # Бронь недели отменили уже после начисления → по формуле 10 ₾, начислено 12 ₾.
    peak_b.status = "cancelled"
    s.add(peak_b)
    s.commit()
    rows = {r["email"]: r for r in ma.run_check(s, check, p)}
    assert (rows["b@x.ge"]["expected"], rows["b@x.ge"]["credited"]) == (10.0, 12.0), rows
    assert set(rows) == {"a@x.ge", "b@x.ge", "c@x.ge"}, rows


def test_weekly_rebate_extras_not_rebated():
    """Решение владельца 02.10: допы (кофе 3 ₾, песочница/проектор/кушетка 5 ₾) —
    не аренда, недельная скидка их не возвращает. 5 броней по 20 ₾ + бронь 23 ₾
    с кофе (20 + 3), всё с баланса, 6 ч → тир 10 % → скидка 6 × 2 = 12 ₾, а не 15."""
    from app.services.weekly_rebate import estimate_booking_rebate, run_weekly_rebates
    ma = _audit()
    s = _db()
    u = _user(s, "coffee@x.ge", "Клиент с кофе")
    for i in range(5):
        _bk(s, u, datetime.combine(WEEK + timedelta(days=i), time.min), price=20.0)
    cup = _bk(s, u, datetime.combine(WEEK + timedelta(days=5), time.min), price=23.0, extras=["coffee_meama"])
    est = estimate_booking_rebate(s, cup)
    assert (est["booking_rebate"], est["week_rebate"]) == (2.0, 12.0), est
    assert [d["rebate"] for d in run_weekly_rebates(s, WEEK, dry_run=True)["details"]] == [12.0]
    run_weekly_rebates(s, WEEK, dry_run=False)
    assert ma.run_check(s, _check(ma, "weekly_rebate_recheck"), ma.audit_params(NOW)) == []
    # Допы дороже уплаченного (бонусная бронь) не уводят «уплаченное» в минус.
    v = _user(s, "bonus@x.ge", "Клиент с бонусом")
    for i in range(5):
        _bk(s, v, datetime.combine(WEEK + timedelta(days=i), time.min), price=20.0)
    free = _bk(s, v, datetime.combine(WEEK + timedelta(days=5), time.min), price=0.0, extras=["sandbox"])
    assert estimate_booking_rebate(s, free)["booking_rebate"] == 0.0


def _strip_py_comment(line: str) -> str:
    quote = None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#":
            return line[:i]
    return line


def _rebate_loop(src: str) -> list:
    """Цикл формулы: от «rebate = 0.0 / for b in user_bookings:» до «if rebate <
    MIN_REBATE_GEL:» — без комментариев и пустых строк."""
    start = src.index("rebate = 0.0\n        for b in user_bookings:")
    end = src.index("if rebate < MIN_REBATE_GEL:", start) + len("if rebate < MIN_REBATE_GEL:")
    lines = (_strip_py_comment(x).rstrip() for x in src[start:end].splitlines())
    return [x for x in lines if x.strip()]


def test_weekly_rebate_formula_in_sync():
    import difflib
    wr = _read("backend/app/services/weekly_rebate.py")
    audit = _read("backend/scripts/money_audit.py")
    run_loop = _rebate_loop(wr[wr.index("def run_weekly_rebates"):])
    audit_loop = _rebate_loop(audit[audit.index("def _weekly_rebate_recheck"):])
    diff = "\n".join(difflib.unified_diff(run_loop, audit_loop, "weekly_rebate.py", "money_audit.py",
                                          lineterm="", n=1))
    assert run_loop == audit_loop, "цикл недельной скидки в ревизоре разошёлся с run_weekly_rebates:\n" + diff
    assert len(run_loop) >= 30, run_loop
    # Прогноз в попапе брони вычитает допы так же.
    est = wr[wr.index("def estimate_booking_rebate"):]
    for line in ("extras_price = round(float(PricingService.calculate_extras_price(list(b.extras or []))), 2)",
                 "extras_price = min(extras_price, max(0.0, round(stored, 2)))",
                 "stored = stored - extras_price"):
        assert line in est, f"прогноз недельной скидки не вычитает допы: «{line}»"
        assert line in "\n".join(run_loop), f"начисление недельной скидки не вычитает допы: «{line}»"
    body = audit[audit.index("def _weekly_rebate_recheck"):audit.index("CHECKS += [")]
    assert "session.add" not in body and ".commit(" not in body and "wallet" not in body, \
        "перепроверка в ревизоре должна быть только чтением"


def test_package_label_matches_weekly_package():
    wp = _read("backend/app/services/weekly_package.py")
    audit = _read("backend/scripts/money_audit.py")
    assert 'reason="subscription_purchase"' in wp
    assert "на неделю {wk:%d.%m}–{wk + timedelta(days=6):%d.%m}" in wp, "крон пакетов пишет запись по-другому"
    assert "на неделю {week_start:%d.%m}–{week_start + timedelta(days=6):%d.%m}" in audit, \
        "ревизор ищет пакетную неделю не по той записи"


# ─── 6. Продажа абонемента — с филиалом кассы ────────────────────────────

def test_subscription_sale_passes_cash_branch():
    ud = _read("src/pages/admin/UserDetails.tsx")
    body = ud[ud.index("const handleAssignSubscription = async"):ud.index("const handleCancelBooking")]
    assert "branch?: string" in body and "branch," in body, "продажа абонемента из карточки снова без филиала"
    i = ud.index("<AssignSubscriptionModal")
    use = ud[i:ud.index("/>", i)]
    assert "defaultBranch={cashBranchOfLastBooking(userBookings)}" in use and "requireBranch" in use, \
        "филиал не подставляется по последней брони / не обязателен"
    m = _read("src/components/admin/modals/AssignSubscriptionModal.tsx")
    assert "const paysToCashbox = method !== 'balance';" in m
    assert "if (requireBranch && paysToCashbox && !branch)" in m, "окно продаёт за деньги без филиала"
    assert "await onConfirm(selectedPlanIndex, method, paysToCashbox ? (branch || undefined) : undefined);" in m
    assert "|| busy" in m, "двойной клик снова проведёт продажу дважды"
    tx = _read("src/components/admin/cashbox/AddCashboxTransactionModal.tsx")
    sale = tx[tx.index("if (isSubscriptionSale) {"):tx.index("const r = await usersApi.sellSubscription(clientId, {")]
    assert "if (!branch)" in sale, "касса снова продаёт абонемент без филиала"
    assert "branch: data.branch" in _read("src/api/users.ts")
    assert 'branch=payload.get("branch") or None' in _read("backend/app/api/v1/users/admin.py")


# ─── 7. Мелочи ───────────────────────────────────────────────────────────

def test_money_audit_comments_without_names():
    """Репозиторий публичный: в ревизоре и сообщении о кассе нет «Имя Фамилия»."""
    pat = re.compile(r"\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]{2,}")
    for rel in ("backend/scripts/money_audit.py", "backend/app/services/shift_alert.py"):
        found = pat.findall(_read(rel))
        assert not found, f"{rel}: похоже на имя и фамилию: {found}"


def test_money_reviewer_knows_audit_checks():
    md = _read(".claude/agents/money-reviewer.md")
    ma = _audit()
    assert f"{len(ma.CHECKS)} проверок" in md, "money-reviewer.md: устарело число проверок ревизора"
    for title in ("Приход денег без филиала", "Расход наличных без филиала", "Бронь за 0 ₾",
                  "Недельная скидка за прошлую неделю"):
        assert title in md, f"money-reviewer.md не знает про «{title}»"


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
    print("СТОРОЖ: OK" if not failures else f"СТОРОЖ УПАЛ ({failures})")
    sys.exit(1 if failures else 0)
