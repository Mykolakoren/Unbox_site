"""СТОРОЖ: контроль денег без Excel (решение владельца 02.10).

Владелец уходит от таблиц админов: то, что админы сверяли руками, теперь
должны ловить сайт и ревизор. Что держит этот сторож:

  1  Закрытие смены (cashbox/shifts.py → services/shift_alert.py): при
     |расхождении| больше 5 ₾ владельцу уходит Telegram «Касса Unbox One: при
     закрытии смены (Валентина) ожидалось 7 600 ₾, пересчитано 7 580 ₾,
     расхождение −20 ₾» — тем же путём и тем же получателям, что алерт ревизора
     (TELEGRAM_OWNER_CHAT_ID, иначе TELEGRAM_ADMIN_CHAT_ID). До 5 ₾ включительно
     — тишина. Корректирующая операция cash_reconciliation пишется как раньше.
  2  Сбой Telegram не роняет закрытие смены: отчёт и корректировка записаны.
  3  Повторный запрос второго сообщения не даёт.
  4  В ревизоре (scripts/money_audit.py) пять новых проверок — по заголовкам;
     старые 10 на месте; SQL новых выполняется на SQLite с ожидаемым числом строк.
  5  Перепроверка недельной скидки совпадает с настоящим начислением
     (run_weekly_rebates) и ловит пропущенное, двойное и устаревшее начисление;
     её формула синхронна со services/weekly_rebate.py.
  6  Информационные проверки помечены как «долг превысил лимит» («Не баг кода,
     а сигнал бизнесу»); упавшая проверка не ослепляет ревизора.

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
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent
NBSP = " "

# «Сейчас» для ревизора: пт 02.10.2026 10:00 UTC (14:00 по Тбилиси).
NOW = datetime(2026, 10, 2, 10, 0)
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
    "free_booking": "Бронь за 0 ₾ — кабинет уходит бесплатно",
    "weekly_rebate_recheck": "Недельная скидка за прошлую неделю начислена не той суммой",
    "repeat_income_same_day": "Повторный приход за день: тому же клиенту та же сумма дважды",
    "shift_discrepancies_week": "Расхождения кассы на закрытии смен за 7 дней (больше 5 ₾)",
}
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


def _audit():
    """scripts/money_audit.py как модуль (это скрипт, а не пакет)."""
    if "m" not in _AUDIT:
        import importlib.util
        path = ROOT / "backend" / "scripts" / "money_audit.py"
        spec = importlib.util.spec_from_file_location("money_audit_guard", path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _AUDIT["m"] = m
    return _AUDIT["m"]


def _check(ma, key):
    return next(c for c in ma.CHECKS if c.key == key)


def _user(s, email, name=None, pricing_system="standard", pdp=0, sub=None):
    from app.models.user import User
    u = User(email=email, name=name or email.split("@")[0], hashed_password="x", balance=0.0,
             pricing_system=pricing_system, personal_discount_percent=pdp, subscription=sub)
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _bk(s, user, day, *, price=0.0, method="balance", pay="paid", rule="NONE",
        status="confirmed", start="12:00", duration=60, user_id=None):
    from app.models.booking import Booking
    b = Booking(
        resource_id="room_1", location_id="unbox_uni", date=day, start_time=start,
        duration=duration, status=status, final_price=price, base_price=20.0,
        applied_rule=rule, payment_method=method, payment_status=pay,
        user_id=user_id or (user.email if user else ""), user_uuid=(user.id if user else None),
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
    """Собрать записи лога shift_alert (и не сыпать трассировками в вывод сторожа)."""
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


# ─── 1–3. Telegram при расхождении кассы на закрытии смены ───────────────

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
    with _telegram() as sent2:
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
    with _telegram(owner=None, admin=None) as sent:
        rep = _close(s, 900.0)
    assert sent == [] and rep.id
    # Тот же выбор чата и тот же вызов, что у алерта ревизора.
    audit = _read("backend/scripts/money_audit.py")
    alert = _read("backend/app/services/shift_alert.py")
    for line in ("settings.TELEGRAM_OWNER_CHAT_ID or settings.TELEGRAM_ADMIN_CHAT_ID",
                 "telegram_service.send_message(chat_id=str(chat_id), text="):
        assert line in audit and line in alert, f"получатели разошлись с ревизором: {line}"


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
    assert shift_alert.SHIFT_DISCREPANCY_ALERT_GEL == 5.0, "порог владельца — 5 ₾"
    assert shift_alert.fmt_gel(7600) == f"7{NBSP}600{NBSP}₾"
    assert shift_alert.fmt_gel(-20, sign=True) == f"−20{NBSP}₾"
    assert shift_alert.fmt_gel(7580.5) == f"7{NBSP}580,5{NBSP}₾"


# ─── 4. Новые проверки ревизора ──────────────────────────────────────────

def test_money_audit_has_new_checks():
    from sqlalchemy import text
    ma = _audit()
    keys = [c.key for c in ma.CHECKS]
    assert keys[:10] == OLD_KEYS, "старые 10 проверок сдвинуты или убраны"
    assert len(keys) == len(set(keys)), "ключи проверок повторяются"
    titles = {c.key: c.title for c in ma.CHECKS}
    for key, title in NEW_TITLES.items():
        assert titles.get(key) == title, f"в ревизоре нет проверки «{title}»"
    for c in ma.CHECKS[:10]:
        assert c.post is None and not text(c.sql).compile().params, f"старая проверка {c.key} изменилась"


def test_informational_checks_marked_like_credit_limit():
    ma = _audit()
    why = {c.key: c.why for c in ma.CHECKS}
    assert why["over_credit_limit"].startswith(INFO_MARK), "образец пометки пропал"
    for key in ("repeat_income_same_day", "shift_discrepancies_week"):
        assert why[key].startswith(INFO_MARK), f"{key}: информационная проверка без пометки"
    for key in ("income_without_branch", "free_booking", "weekly_rebate_recheck"):
        assert not why[key].startswith(INFO_MARK), f"{key}: это не просто сигнал, а расхождение"
        assert "Что делать" in why[key]


def test_audit_params_windows():
    ma = _audit()
    p = ma.audit_params(NOW)
    assert p["since_30d"] == datetime(2026, 9, 2, 10, 0)
    assert p["book_since"] == datetime(2026, 9, 2)
    assert p["since_7d"] == datetime(2026, 9, 24, 20, 0), "окно 7 дней — с полуночи по Тбилиси"
    assert p["shift_alert_gel"] == 5.0
    assert p["rebate_week"] == WEEK
    assert (p["rebate_credit_from"], p["rebate_credit_to"]) == (datetime(2026, 9, 28), datetime(2026, 10, 5))
    # Крон скидки — пн 01:00 UTC: до 03:00 UTC понедельника смотрим позапрошлую неделю.
    assert ma.audit_params(datetime(2026, 10, 5, 0, 30))["rebate_week"] == WEEK
    assert ma.audit_params(datetime(2026, 10, 5, 6, 0))["rebate_week"] == date(2026, 9, 28)


def test_income_without_branch_sql():
    ma = _audit()
    s = _db()
    recent = datetime(2026, 9, 30, 9, 0)
    _cash(s, 50, branch=None, when=recent)                                   # ✓ наличные без филиала
    _cash(s, 40, branch="  ", method="card_tbc", when=recent)                # ✓ пустой филиал
    _cash(s, 30, branch=None, when=datetime(2026, 8, 1), created=datetime(2026, 10, 1, 8))  # ✓ задним числом
    _cash(s, 100, type="expense", branch=None, method="card_tbc",
          desc="Перевод: Карта TBC → Наличные", when=recent)
    _cash(s, 100, branch=None, desc="Перевод: Карта TBC → Наличные", when=recent)  # ✓ перевод В наличные
    # не считаются:
    _cash(s, 60, branch="Unbox One", when=recent)
    _cash(s, 70, branch=None, method="adjustment", when=recent)
    _cash(s, 80, branch=None, category="cash_reconciliation", when=recent)
    _cash(s, 90, branch=None, when=datetime(2026, 8, 1))                     # старше 30 дней
    _cash(s, 600, type="expense", branch=None, method="card_bog",
          desc="Перевод: Карта BOG → Карта TBC", when=recent)
    _cash(s, 600, branch=None, method="card_tbc", desc="Перевод: Карта BOG → Карта TBC", when=recent)
    _cash(s, 25, type="expense", branch=None, when=recent)
    rows = ma.run_check(s, _check(ma, "income_without_branch"), ma.audit_params(NOW))
    assert sorted(r["amount"] for r in rows) == [30, 40, 50, 100], rows


def test_free_booking_sql():
    from app.services.pricing import PricingService
    ma = _audit()
    s = _db()
    u = _user(s, "client@x.ge")
    half = _user(s, "half@x.ge", pricing_system="personal", pdp=50)
    yana = _user(s, "yana@x.ge", pricing_system="personal", pdp=100)
    owner = _user(s, "koren.nikolas@gmail.com")
    service = _user(s, "admin@unbox.com")
    d = datetime(2026, 9, 30)
    _bk(s, u, d, rule="MANUAL_OVERRIDE")                                      # ✓ ручная цена 0
    _bk(s, u, datetime(2026, 10, 10), pay="pending", rule="SUBSCRIPTION")     # ✓ ярлык «баланс» при цене абонемента
    _bk(s, half, d, rule="MANUAL_OVERRIDE")                                   # ✓ скидка 50 % — не повод для 0 ₾
    # не считаются:
    _bk(s, u, d, price=20.0)
    _bk(s, u, d, method="subscription", rule="SUBSCRIPTION")
    _bk(s, u, d, method="bonus")
    _bk(s, u, d, method="service", pay="waived")
    _bk(s, u, d, pay="waived")
    _bk(s, u, d, rule="BONUS_HOUR")                                           # «Час в подарок»
    _bk(s, u, d, status="cancelled")
    _bk(s, u, datetime(2026, 8, 20), rule="MANUAL_OVERRIDE")                  # старше 30 дней
    _bk(s, owner, d, rule="COMP_ACCOUNT")
    _bk(s, service, d, rule="MANUAL_OVERRIDE")
    _bk(s, yana, d, rule="PERSONAL_DISCOUNT")
    _bk(s, None, d, user_id="irina.cbtpsy@gmail.com")                         # старая бронь без uuid
    check = _check(ma, "free_booking")
    rows = ma.run_check(s, check, ma.audit_params(NOW))
    got = sorted((r["email"], r["date"], r["applied_rule"]) for r in rows)
    assert got == [
        ("client@x.ge", "2026-09-30", "MANUAL_OVERRIDE"),
        ("client@x.ge", "2026-10-10", "SUBSCRIPTION"),
        ("half@x.ge", "2026-09-30", "MANUAL_OVERRIDE"),
    ], got
    for email in PricingService.COMP_ACCOUNTS | {"admin@unbox.com"}:
        assert f"'{email}'" in check.sql, f"comp-аккаунт {email} не исключён"


def test_repeat_income_same_day_sql():
    ma = _audit()
    s = _db()
    x = _user(s, "tamriko@x.ge", "Тамрико")
    y = _user(s, "olga@x.ge", "Ольга")
    z = _user(s, "zina@x.ge", "Зина")
    # ✓ Тамрико: 20 ₾ в 12:45 в Uni картой и в 19:04 в One наличными (01.10 по Тбилиси)
    _pay(s, x, 20, datetime(2026, 10, 1, 8, 45), method="card_tbc", branch="Unbox Uni", admin="Лиза")
    _pay(s, x, 20, datetime(2026, 10, 1, 15, 4), branch="Unbox One", admin="Валентина")
    # ✓ Ольга: одна запись по id с зачислением, вторая — по email без него
    _pay(s, y, 45, datetime(2026, 9, 30, 10, 0))
    _pay(s, y, 45, datetime(2026, 9, 30, 10, 2), by_email=True)
    # не считаются:
    _pay(s, x, 20, datetime(2026, 9, 29, 19, 0))    # 23:00 по Тбилиси, 29.09
    _pay(s, x, 20, datetime(2026, 9, 29, 20, 30))   # 00:30 по Тбилиси — уже 30.09
    _pay(s, x, 25, datetime(2026, 10, 1, 9, 0))     # другая сумма
    _pay(s, x, 20, datetime(2026, 10, 1, 9, 30), currency="USD")  # другая валюта
    _pay(s, z, 10, datetime(2026, 9, 30, 9, 0), method="adjustment")
    _pay(s, z, 10, datetime(2026, 9, 30, 9, 5), method="adjustment")
    _pay(s, z, 30, datetime(2026, 9, 20, 9, 0))     # раньше окна 7 дней
    _pay(s, z, 30, datetime(2026, 9, 20, 9, 5))
    _cash(s, 15, when=datetime(2026, 9, 30, 9, 0))  # без клиента
    _cash(s, 15, when=datetime(2026, 9, 30, 9, 1))
    rows = ma.run_check(s, _check(ma, "repeat_income_same_day"), ma.audit_params(NOW))
    got = sorted((r["day"], r["client"], r["amount"], r["times"]) for r in rows)
    assert got == [("2026-09-30", "Ольга", 45.0, 2), ("2026-10-01", "Тамрико", 20.0, 2)], got
    tam = next(r for r in rows if r["client"] == "Тамрико")
    assert "12:45 карта TBC · Unbox Uni · Лиза" in tam["entries"], tam
    assert "19:04 наличные · Unbox One · Валентина" in tam["entries"], tam


def test_shift_discrepancies_week_sql():
    ma = _audit()
    s = _db()
    _shift(s, datetime(2026, 10, 1, 14, 0), -20.0, "Unbox One", "Валентина")   # ✓
    _shift(s, datetime(2026, 9, 29, 14, 0), -5.01, "Unbox Uni", "Лиза")       # ✓
    _shift(s, datetime(2026, 9, 30, 14, 0), 5.0, "Unbox Uni", "Лиза")         # ровно порог — нет
    _shift(s, datetime(2026, 10, 1, 15, 0), 0.0, "Unbox Uni", "Лиза")
    _shift(s, datetime(2026, 9, 20, 14, 0), -50.0, "Unbox One", "Егор")       # старше 7 дней
    rows = ma.run_check(s, _check(ma, "shift_discrepancies_week"), ma.audit_params(NOW))
    assert [(r["branch"], r["discrepancy"]) for r in rows] == [("Unbox One", -20.0), ("Unbox Uni", -5.01)], rows


# ─── 5. Перепроверка недельной скидки ────────────────────────────────────

def _week(s, user):
    """6 ч за прошлую неделю, всё оплачено с баланса: пн–пт 12:00 по 20 ₾ и сб
    20:00 (пик) за 25 ₾. Тир недели 10 % → скидка 5 × 2 + 2 = 12 ₾. Пиковая бронь
    ловит «полуночный» баг: без времени старта добор вышел бы 7 ₾, а не 2."""
    for i in range(5):
        _bk(s, user, datetime.combine(WEEK + timedelta(days=i), time.min), price=20.0)
    return _bk(s, user, datetime.combine(WEEK + timedelta(days=5), time.min), price=25.0, start="20:00")


def _rebate_params(ma):
    # Лента пишет created_at настоящим «сейчас» — окно начисления вокруг него.
    real_now = datetime.now(timezone.utc).replace(tzinfo=None)
    return dict(ma.audit_params(NOW), rebate_week=WEEK,
                rebate_credit_from=real_now - timedelta(days=1),
                rebate_credit_to=real_now + timedelta(days=1))


def test_weekly_rebate_recheck_matches_real_crediting():
    from app.services import wallet
    from app.services.weekly_rebate import run_weekly_rebates

    ma = _audit()
    s = _db()
    check = _check(ma, "weekly_rebate_recheck")
    p = _rebate_params(ma)
    anna = _user(s, "anna@x.ge", "Анна")
    galina = _user(s, "galina@x.ge", "Галина")
    _week(s, anna)
    peak = _week(s, galina)
    done = run_weekly_rebates(s, WEEK, dry_run=False)
    assert {d["user_email"]: d["rebate"] for d in done["details"]} == {"anna@x.ge": 12.0, "galina@x.ge": 12.0}, done
    assert ma.run_check(s, check, p) == [], "перепроверка разошлась с настоящим начислением"

    # Пакет появился ПОСЛЕ начисления (кейс Галины: скидка 28.09, пакет 29.09) — не тревога.
    galina.subscription = {"weekly_package": True, "package_week": "2026-09-28", "status": "active"}
    s.add(galina)
    s.commit()
    assert ma.run_check(s, check, p) == []
    # Пакет без начисления — скидку и не ждём.
    _week(s, _user(s, "pack@x.ge", "Пакет", sub={"weekly_package": True, "package_week": "2026-09-21"}))
    assert ma.run_check(s, check, p) == []

    # Крон пропустил клиента → тревога; ожидаемое = сколько начислил бы run_weekly_rebates.
    _week(s, _user(s, "cyril@x.ge", "Кирилл"))
    would = {d["user_email"]: d["rebate"] for d in run_weekly_rebates(s, WEEK, dry_run=True)["details"]}
    rows = ma.run_check(s, check, p)
    assert [(r["email"], r["expected"], r["credited"]) for r in rows] == [("cyril@x.ge", would["cyril@x.ge"], 0.0)], rows
    assert would["cyril@x.ge"] == 12.0

    # Начислили дважды → тревога.
    wallet.credit(s, anna, 12.0, reason="weekly_rebate", description="повтор",
                  ref_type="weekly_rebate", ref_id=str(anna.id))
    s.commit()
    rows = {r["email"]: r for r in ma.run_check(s, check, p)}
    assert (rows["anna@x.ge"]["expected"], rows["anna@x.ge"]["credited"], rows["anna@x.ge"]["journal"]) == (12.0, 24.0, 12.0), rows

    # Бронь недели отменили уже после начисления → по формуле 10 ₾, начислено 12 ₾.
    peak.status = "cancelled"
    s.add(peak)
    s.commit()
    rows = {r["email"]: r for r in ma.run_check(s, check, p)}
    assert (rows["galina@x.ge"]["expected"], rows["galina@x.ge"]["credited"]) == (10.0, 12.0), rows
    assert set(rows) == {"anna@x.ge", "galina@x.ge", "cyril@x.ge"}, rows


def test_weekly_rebate_recheck_formula_in_sync():
    wr = _read("backend/app/services/weekly_rebate.py")
    run_body = wr[wr.index("def run_weekly_rebates"):wr.index("def estimate_booking_rebate")]
    src = _read("backend/scripts/money_audit.py")
    audit_body = src[src.index("def _weekly_rebate_recheck"):src.index("CHECKS += [")]
    for line in (
        'Booking.status == "confirmed",',
        "total_hours = sum(b.duration / 60.0 for b in user_bookings)",
        "tier = PricingService.weekly_tier_percent(total_hours)",
        'subscription_pool.get(user.subscription, "weekly_package", False)',
        'if b.payment_method != "balance":',
        'if b.payment_status in ("pending", "waived"):',
        "_start = b.date.replace(hour=_h, minute=_m, second=0, microsecond=0)",
        "exclude_booking_id=b.id,",
        "ignore_subscription=True,",
        "if base <= 0:",
        "duration_pct = int(breakdown.discount_percent or 0)",
        "weekly_extra = base * (max(0, tier - duration_pct) / 100.0)",
        "correct_at_T = recomputed - weekly_extra",
        "rebate += max(0.0, stored - correct_at_T)",
        "if rebate < MIN_REBATE_GEL:",
    ):
        assert line in run_body, f"weekly_rebate.py изменился — сверить перепроверку в ревизоре: «{line}»"
        assert line in audit_body, f"перепроверка недельной скидки разошлась с начислением: «{line}»"
    assert "session.add" not in audit_body and ".commit(" not in audit_body and "wallet" not in audit_body, \
        "перепроверка в ревизоре должна быть только чтением"


# ─── 6. Упавшая проверка не ослепляет ревизора ───────────────────────────

def test_audit_runner_survives_failing_check():
    ma = _audit()
    s = _db()
    good = ma.Check(key="ok_empty", title="Пусто", sql="SELECT 1 AS x WHERE 1 = 0", why="—")
    bad = ma.Check(key="broken", title="Сломана", sql="SELECT * FROM нет_такой_таблицы", why="—")
    after = ma.Check(key="after", title="После сломанной", sql="SELECT 2 AS x", why="—")
    real = (ma.engine, ma.CHECKS, ma.audit_params, ma.text)

    def _text(sql):
        # SET TRANSACTION READ ONLY — синтаксис Postgres; на SQLite — пустышка.
        return real[3]("SELECT 1" if sql.strip().upper().startswith("SET TRANSACTION") else sql)

    ma.engine, ma.CHECKS, ma.audit_params, ma.text = s.get_bind(), [good, bad, after], (lambda: {}), _text
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            code = ma.run(as_json=True)
    finally:
        ma.engine, ma.CHECKS, ma.audit_params, ma.text = real
    out = json.loads(buf.getvalue())
    assert code == 1 and out["violations"] == {"broken": 1, "after": 1}, out
    assert "ошибка_проверки" in out["details"]["broken"][0], out


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
