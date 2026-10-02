"""СТОРОЖ: мягкое предупреждение о дубле прихода за весь день по Тбилиси (02.10).

Случай: админ внесла Тамрико 20 ₾ дважды — 15.07 в 12:45 в Uni и в 19:04 в One
(через 6 часов, в разных филиалах). Окно в 3 минуты такое не ловит, у клиента
появился ложный депозит.

Что держит этот сторож (cashbox/transactions.py, create_transaction):
  1  Тот же приход (клиент, сумма, валюта) в тот же календарный день по Тбилиси,
     но НЕ в последние 3 минуты → 409 с тем же code duplicate_recent (фронт не
     меняется), текст «Сегодня в 12:45 (Unbox Uni) этому клиенту уже внесено 20 ₾
     наличными (записал(а) Имя). Если это второй платёж, подтвердите ещё одну
     запись», existing{window:'today', branch, admin_name, time_local} (HH:MM по
     Тбилиси). Способ оплаты, филиал и админ не сравниваются.
  2  confirm_duplicate=true обходит оба окна (записывается и зачисляется).
  3  Граница дня — полночь Тбилиси (20:00 UTC): вчера до полуночи не считается;
     19:00 UTC и 20:30 UTC одних UTC-суток — это РАЗНЫЕ дни по Тбилиси.
  4  Другая сумма / клиент / валюта — молча; расходы, корректировки (adjustment) и
     приход без клиента не проверяются и не считаются «уже внесённым»;
     удалённая запись дублем не считается.
  5  Если дубль в последние 3 минуты — прежний текст «N назад» (window='recent').
  6  Проверка «сегодня» — там же, где «3 минуты»: после замка по клиенту и только
     при confirm_duplicate=false; серверные пути (продажа абонемента и др.) её не зовут.
  Фронт:
  7  Код остался duplicate_recent → isDuplicatePayment / client.ts без изменений;
     диалог показывает текст сервера, «Записать ещё одну» / «Отмена», фокус на «Отмена».

Без сети и боевой базы: SQLite в памяти, время «сейчас» подставляется.

    python3 backend/tests/guard_duplicate_today_2026_10.py
"""
import os
import pathlib
import re
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


# ─── Фикстуры ────────────────────────────────────────────────────────────

def _setup():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine
    import app.models.specialist  # noqa: F401  (relationship у User)
    from app.models.balance_ledger import BalanceLedger
    from app.models.cashbox_transaction import CashboxTransaction
    from app.models.expense_category import ExpenseCategory
    from app.models.therapist_client import TherapistClient
    from app.models.user import User

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[
        User.__table__, BalanceLedger.__table__, CashboxTransaction.__table__, ExpenseCategory.__table__,
        TherapistClient.__table__,
    ])
    s = Session(eng)
    return s, _admin("Ирина"), _client(s)


def _admin(name):
    from uuid import uuid4
    return SimpleNamespace(id=uuid4(), name=name, email=f"{name}@example.com", role="admin")


def _client(s, email="tamriko@example.com", name="Тамрико Габаидзе"):
    from app.models.user import User
    u = User(email=email, name=name, hashed_password="x", balance=0.0)
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


@contextmanager
def _now(when: datetime):
    """Подставить серверное «сейчас» (naive UTC)."""
    from app.api.v1.cashbox import transactions as t
    real = t._server_now
    t._server_now = lambda: when
    try:
        yield
    finally:
        t._server_now = real


def _seed(s, client, when, amount=20.0, method="cash", branch="Unbox Uni", admin_name="Мария",
          type="income", currency="GEL", with_client=True):
    """Готовая запись кассы с заданным created_at (naive UTC)."""
    from app.models.cashbox_transaction import CashboxTransaction
    tx = CashboxTransaction(
        type=type, amount=amount, currency=currency, payment_method=method, branch=branch,
        date=when, created_at=when, admin_id="seed-admin", admin_name=admin_name,
        client_id=(str(client.id) if with_client else None),
        credited_user_id=(str(client.id) if with_client and type == "income" and method != "adjustment" else None),
    )
    s.add(tx)
    s.commit()
    s.refresh(tx)
    return tx


def _pay(s, admin, client, amount=20.0, method="card_tbc", confirm=False, **kw):
    """Вызов create_transaction: ('ok', tx) или ('409', detail)."""
    from fastapi import HTTPException
    from app.api.v1.cashbox.transactions import create_transaction
    from app.models.cashbox_transaction import CashboxTransactionCreate

    data = dict(
        type="income", amount=amount, payment_method=method, client_id=str(client.id),
        credit_user_balance=True, confirm_duplicate=confirm, branch="Unbox One",
    )
    data.update(kw)
    try:
        return "ok", create_transaction(CashboxTransactionCreate(**data), session=s, current_user=admin)
    except HTTPException as e:
        return str(e.status_code), e.detail


def _count(s):
    from sqlmodel import select
    from app.models.cashbox_transaction import CashboxTransaction
    return len(s.exec(select(CashboxTransaction)).all())


# Реальный случай: 12:45 по Тбилиси = 08:45 UTC; повторное внесение в 19:04 = 15:04 UTC.
D = datetime(2026, 7, 15)
T_FIRST = D.replace(hour=8, minute=45)
T_SECOND = D.replace(hour=15, minute=4)


# ─── Сервер ──────────────────────────────────────────────────────────────

def test_same_day_six_hours_other_branch_is_409_with_text_time_branch():
    s, admin, c = _setup()
    first = _seed(s, c, T_FIRST, 20, "cash", "Unbox Uni", "Мария")
    rows = _count(s)
    with _now(T_SECOND):
        st, d = _pay(s, admin, c, 20, "card_tbc", branch="Unbox One")
    assert st == "409", f"повторный платёж через 6 часов прошёл молча: {st}"
    assert d["code"] == "duplicate_recent", d
    msg = d["message"]
    assert msg.startswith("Сегодня в 12:45 (Unbox Uni) этому клиенту уже внесено 20 ₾ наличными"), msg
    assert "наличными (записал(а) Мария)" in msg and "записал(а) Мария" in msg, msg
    assert msg.endswith("Если это второй платёж, подтвердите ещё одну запись."), msg
    ex = d["existing"]
    assert ex["id"] == first.id and ex["window"] == "today", ex
    assert ex["branch"] == "Unbox Uni" and ex["admin_name"] == "Мария" and ex["time_local"] == "12:45", ex
    assert ex["amount"] == 20 and ex["payment_method"] == "cash", ex
    assert _count(s) == rows, "при 409 что-то записалось"
    s.refresh(c)
    assert c.balance == 0, f"баланс изменился при 409: {c.balance}"


def test_confirm_duplicate_bypasses_today_window_and_credits():
    s, admin, c = _setup()
    _seed(s, c, T_FIRST)
    with _now(T_SECOND):
        st, tx = _pay(s, admin, c, 20, confirm=True)
    assert st == "ok", (st, tx)
    s.refresh(c)
    assert c.balance == 20, c.balance
    assert _count(s) == 2


def test_same_admin_and_same_method_are_also_checked_and_no_branch_text():
    """Админ и способ не сравниваются. Если у первой записи нет филиала — в тексте
    нет пустых скобок."""
    s, admin, c = _setup()
    _seed(s, c, T_FIRST, 20, "card_bog", None, "Ирина")
    with _now(T_SECOND):
        st, d = _pay(s, admin, c, 20, "card_bog")
    assert st == "409", st
    assert d["message"].startswith("Сегодня в 12:45 этому клиенту"), d["message"]
    assert "()" not in d["message"] and "картой BOG" in d["message"], d["message"]
    assert d["existing"]["branch"] is None


def test_recent_three_minutes_keeps_old_text():
    s, admin, c = _setup()
    _seed(s, c, T_SECOND - timedelta(minutes=1))
    with _now(T_SECOND):
        st, d = _pay(s, admin, c, 20)
    assert st == "409" and d["existing"]["window"] == "recent", (st, d)
    assert "уже записана" in d["message"] and "назад" in d["message"], d["message"]
    assert "Сегодня" not in d["message"], d["message"]
    # две записи сегодня: свежая (минуту назад) и старая — действует «только что»
    s2, admin2, c2 = _setup()
    _seed(s2, c2, T_FIRST)
    _seed(s2, c2, T_SECOND - timedelta(minutes=1))
    with _now(T_SECOND):
        st, d = _pay(s2, admin2, c2, 20)
    assert st == "409" and d["existing"]["window"] == "recent", (st, d)


def test_yesterday_before_tbilisi_midnight_is_not_counted():
    # «Сейчас» 12:00 по Тбилиси (08:00 UTC). Полночь Тбилиси = 20:00 UTC накануне.
    now = datetime(2026, 7, 15, 8, 0)
    s, admin, c = _setup()
    _seed(s, c, datetime(2026, 7, 14, 19, 59, 59))  # 23:59:59 по Тбилиси — вчера
    with _now(now):
        assert _pay(s, admin, c, 20)[0] == "ok", "вчерашний платёж сошёл за сегодняшний"
    s2, admin2, c2 = _setup()
    _seed(s2, c2, datetime(2026, 7, 14, 20, 0, 0))  # ровно 00:00 по Тбилиси — уже сегодня
    with _now(now):
        st, d = _pay(s2, admin2, c2, 20)
    assert st == "409" and d["existing"]["time_local"] == "00:00", (st, d)
    s3, admin3, c3 = _setup()
    _seed(s3, c3, datetime(2026, 7, 14, 12, 0))  # вчера днём
    with _now(now):
        assert _pay(s3, admin3, c3, 20)[0] == "ok"


def test_tbilisi_midnight_boundary_not_utc_day():
    """Граница — полночь Тбилиси, а не UTC: 19:00 UTC и 20:30 UTC одних UTC-суток —
    это 23:00 и 00:30 по Тбилиси, то есть РАЗНЫЕ дни."""
    # событие 23:00 по Тбилиси (19:00 UTC); проверка в 00:30 по Тбилиси (20:30 UTC) — другой день
    s, admin, c = _setup()
    _seed(s, c, datetime(2026, 7, 15, 19, 0))
    with _now(datetime(2026, 7, 15, 20, 30)):
        assert _pay(s, admin, c, 20)[0] == "ok", "платёж 23:00 засчитан в следующий день (граница по UTC?)"
    # событие 00:30 по Тбилиси (20:30 UTC 14.07); проверка в 23:00 по Тбилиси 15.07
    # (19:00 UTC 15.07) — тот же день по Тбилиси, хотя UTC-дни разные
    s2, admin2, c2 = _setup()
    _seed(s2, c2, datetime(2026, 7, 14, 20, 30))
    with _now(datetime(2026, 7, 15, 19, 0)):
        st, d = _pay(s2, admin2, c2, 20)
    assert st == "409" and d["existing"]["time_local"] == "00:30", \
        f"платёж 00:30 не засчитан в тот же день (граница по UTC?): {st}"
    # событие 00:30 по Тбилиси (20:30 UTC), проверка в 02:00 по Тбилиси (22:00 UTC) того же UTC-дня
    s3, admin3, c3 = _setup()
    _seed(s3, c3, datetime(2026, 7, 14, 20, 30))
    with _now(datetime(2026, 7, 14, 22, 0)):
        assert _pay(s3, admin3, c3, 20)[0] == "409"


def test_day_start_helper():
    from app.api.v1.cashbox.transactions import _tbilisi_day_start_utc as f
    assert f(datetime(2026, 7, 15, 19, 59, 59)) == datetime(2026, 7, 14, 20, 0)
    assert f(datetime(2026, 7, 15, 20, 0, 0)) == datetime(2026, 7, 15, 20, 0)
    assert f(datetime(2026, 7, 15, 0, 0, 1)) == datetime(2026, 7, 14, 20, 0)
    assert f(datetime(2026, 12, 31, 21, 0)) == datetime(2026, 12, 31, 20, 0)  # через границу года


def test_other_amount_client_currency_pass():
    s, admin, c = _setup()
    other = _client(s, "ira@example.com", "Ирина")
    _seed(s, c, T_FIRST, 20)
    with _now(T_SECOND):
        assert _pay(s, admin, c, 25)[0] == "ok", "другая сумма — не дубль"
        assert _pay(s, admin, c, 20.5)[0] == "ok", "20,5 и 20 — разные суммы (копейки)"
        assert _pay(s, admin, other, 20)[0] == "ok", "другой клиент — не дубль"
        assert _pay(s, admin, c, 20, currency="USD", credit_user_balance=False)[0] == "ok", "другая валюта — не дубль"
        assert _pay(s, admin, c, 20, client_id="crm-client-1", credit_user_balance=False)[0] == "ok", \
            "клиент Psy-CRM с тем же числом — другой клиент"


def test_same_person_by_email_is_found_today():
    s, admin, c = _setup()
    _seed(s, c, T_FIRST)
    with _now(T_SECOND):
        st, _d = _pay(s, admin, c, 20, client_id=c.email)
    assert st == "409", "тот же человек под email обошёл проверку за день"


def test_expense_adjustment_no_client_not_checked_and_not_counted():
    # ничего не проверяется у расхода / корректировки / прихода без клиента
    s, admin, c = _setup()
    _seed(s, c, T_FIRST, 20)
    with _now(T_SECOND):
        assert _pay(s, admin, c, 20, type="expense", credit_user_balance=False)[0] == "ok", "расход получил проверку дубля"
        assert _pay(s, admin, c, 20, method="adjustment", credit_user_balance=False)[0] == "ok", \
            "корректировка получила проверку дубля"
        assert _pay(s, admin, c, 20, client_id=None, credit_user_balance=False)[0] == "ok", \
            "приход без клиента получил проверку дубля"
    # и не считаются «уже внесённым»
    for kind in ("expense", "adjustment", "no_client"):
        s2, admin2, c2 = _setup()
        if kind == "expense":
            _seed(s2, c2, T_FIRST, type="expense")
        elif kind == "adjustment":
            _seed(s2, c2, T_FIRST, method="adjustment")
        else:
            _seed(s2, c2, T_FIRST, with_client=False)
        with _now(T_SECOND):
            assert _pay(s2, admin2, c2, 20)[0] == "ok", f"{kind} сошёл за «уже внесённую оплату»"


def test_deleted_payment_is_not_duplicate():
    from app.models.cashbox_transaction import CashboxTransaction
    s, admin, c = _setup()
    first = _seed(s, c, T_FIRST)
    s.delete(s.get(CashboxTransaction, first.id))
    s.commit()
    with _now(T_SECOND):
        assert _pay(s, admin, c, 20)[0] == "ok"


def test_today_check_sits_in_the_same_guarded_block():
    """Проверка «сегодня» — после замка по клиенту, внутри `if not confirm_duplicate`,
    до записи; серверные пути (продажа абонемента и др.) её не вызывают."""
    src = _read("backend/app/api/v1/cashbox/transactions.py")
    body = src[src.index("def create_transaction("):]
    i_lock = body.index("_lock_client_for_payment(")
    i_confirm = body.index("if not payload.confirm_duplicate:")
    i_recent = body.index("_find_recent_duplicate(")
    i_today = body.index("_find_today_duplicate(")
    i_commit = body.index("session.commit()")
    assert i_lock < i_confirm < i_recent < i_today < i_commit, "порядок: замок → confirm → 3 минуты → сегодня → запись"
    assert 'window="today"' in body, "ответ «сегодня» не помечен window"
    # Проверка по типу/клиенту/корректировке — общий внешний if.
    pre = body[i_lock - 400:i_lock]
    assert 'payload.type == "income"' in pre and "payload.client_id" in pre and "NON_MONEY_METHOD" in pre, pre
    # Только create_transaction зовёт проверки.
    for p in (ROOT / "backend/app").rglob("*.py"):
        if p.name == "transactions.py" and p.parent.name == "cashbox":
            continue
        t = p.read_text(encoding="utf-8")
        assert "_find_today_duplicate" not in t and "_find_recent_duplicate" not in t, \
            f"{p}: серверный путь вызывает проверку дубля кассы"


# ─── Фронт: статика ──────────────────────────────────────────────────────

def test_frontend_unchanged_contract_works_for_today_case():
    e = _code("src/utils/errors.ts")
    assert "code === 'duplicate_recent'" in e, "isDuplicatePayment не узнаёт 409 duplicate_recent"
    c = _code("src/api/client.ts")
    assert "isDuplicatePayment(error)" in c, "общий client.ts покажет второй тост на «сегодняшний» дубль"
    h = _code("src/utils/cashboxDuplicate.ts")
    assert "body: message" in h and "detail?.message" in h, "диалог не показывает текст сервера"
    assert "confirmLabel: 'Записать ещё одну'" in h and "cancelLabel: 'Отмена'" in h
    assert "initialFocus: 'cancel'" in h and "tone: 'danger'" not in h, "фокус на «Отмена» потерян"
    assert "confirm_duplicate: true" in h
    # запасной текст не врёт про «только что» — дубль может быть и сегодняшним
    assert "только что" not in h, "запасной текст диалога снова говорит «только что»"
    # серверный текст — простыми словами, на «вы», без жаргона
    s = _read("backend/app/api/v1/cashbox/transactions.py")
    assert "Сегодня в {time_local}" in s and "подтвердите ещё одну запись" in s


if __name__ == "__main__":
    fails = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for n, f in tests:
        try:
            f()
            print(f"  ✓ {n}")
        except AssertionError as exc:
            fails += 1
            print(f"  ✗ {n}: {exc}")
        except Exception as exc:  # noqa: BLE001
            fails += 1
            print(f"  ✗ {n}: {exc!r}")
    print(f"проверок: {len(tests)}")
    print("СТОРОЖ ДУБЛЯ ЗА ДЕНЬ: OK" if not fails else f"СТОРОЖ ДУБЛЯ ЗА ДЕНЬ УПАЛ ({fails})")
    sys.exit(1 if fails else 0)
