"""СТОРОЖ: защита от двойного внесения оплаты клиента через кассу (01.10).

Случай: админ нажала «Принять оплату» (45 ₾ Ольге Малыш), увидела красное «нужен
доступ к кассе», решила, что не прошло, и внесла заново другим способом через
23 секунды. Первый платёж на самом деле записался (сервер ответил 200) — у клиента
два платежа по 45 ₾. Причину ложной ошибки установить не удалось.

Что держит этот сторож:
  Сервер (cashbox/transactions.py, create_transaction):
    1  Второй приход по тому же клиенту на ту же сумму (та же валюта) за 3 минуты →
       409 {code: duplicate_recent, message, existing{id, amount, payment_method,
       created_at, seconds_ago}}; баланс клиента и касса не тронуты.
    2  confirm_duplicate=true — записывается (и зачисляется на баланс).
    3  Способ оплаты НЕ учитывается (наличные → карта = дубль). Администратор тоже
       НЕ учитывается (решение: с телефона и с компьютера могут нажать двое).
    4  Другая сумма / другой клиент / другая валюта — пишется молча. Старше 3 минут, но
       в тот же день по Тбилиси — тот же 409 с другим текстом (02.10, см.
       guard_duplicate_today_2026_10).
    5  Не затрагивает расходы, корректировки (adjustment) и приход без клиента.
    6  Один человек под UUID и под email — один клиент.
    7  Проверка идёт ПОСЛЕ замка по клиенту (pg advisory xact lock) — без гонки двух
       одновременных запросов; на SQLite замок пропускается.
  Фронт:
    8  Все приходы с клиентом идут через createIncomeWithDuplicateGuard (вопрос
       «Записать ещё одну / Отмена» с текстом сервера, повтор с confirm_duplicate).
    9  api/client.ts не показывает второй тост на duplicate_recent.
   10  «нужен доступ к кассе» больше нигде не выводится; без ответа сервера —
       «Не удалось подтвердить запись. Проверьте журнал кассы…»; платёж и обновление
       экрана разведены по разным try (сбой fetchUsers не выглядит как «не прошло»).

Без сети и боевой базы: SQLite в памяти.

    python3 backend/tests/guard_duplicate_payment_2026_10.py
"""
import os
import pathlib
import re
import sys
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

def _engine():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
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
    return eng


def _admin(name="Админ Один"):
    from uuid import uuid4
    return SimpleNamespace(id=uuid4(), name=name, email=f"{name}@example.com", role="admin")


def _client(s, email="olga@example.com", name="Ольга Малыш", balance=0.0):
    from app.models.user import User
    u = User(email=email, name=name, hashed_password="x", balance=balance)
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _pay(s, admin, client, amount=45.0, method="cash", confirm=False, by="id", **kw):
    """Вызов create_transaction как обработчика: ('ok', tx) или ('409', detail)."""
    from fastapi import HTTPException
    from app.api.v1.cashbox.transactions import create_transaction
    from app.models.cashbox_transaction import CashboxTransactionCreate

    data = dict(
        type="income", amount=amount, payment_method=method,
        client_id=(str(client.id) if by == "id" else client.email),
        credit_user_balance=True, confirm_duplicate=confirm,
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


def _ledger(s):
    from sqlmodel import select
    from app.models.balance_ledger import BalanceLedger
    return len(s.exec(select(BalanceLedger)).all())


def _age(s, tx_id, minutes):
    """Состарить запись: created_at на N минут назад (как будто платёж был давно)."""
    from app.models.cashbox_transaction import CashboxTransaction
    t = s.get(CashboxTransaction, tx_id)
    t.created_at = datetime.now() - timedelta(minutes=minutes)
    s.add(t)
    s.commit()


def _age_at(s, tx_id, when):
    """Поставить записи конкретное created_at (naive UTC)."""
    from app.models.cashbox_transaction import CashboxTransaction
    t = s.get(CashboxTransaction, tx_id)
    t.created_at = when
    s.add(t)
    s.commit()


def _setup():
    from sqlmodel import Session
    eng = _engine()
    s = Session(eng)
    return s, _admin(), _client(s)


# ─── Сервер ──────────────────────────────────────────────────────────────

def test_second_same_payment_is_409_and_nothing_changes():
    s, admin, c = _setup()
    st, first = _pay(s, admin, c, 45, "card_tbc")
    assert st == "ok", (st, first)
    s.refresh(c)
    assert c.balance == 45
    rows, ledger = _count(s), _ledger(s)

    st, d = _pay(s, admin, c, 45, "cash")  # «другим способом» — как в реальном случае
    assert st == "409", f"второй такой же приход прошёл молча: {st}"
    assert d["code"] == "duplicate_recent", d
    ex = d["existing"]
    assert ex["id"] == first.id and ex["amount"] == 45 and ex["payment_method"] == "card_tbc", ex
    assert isinstance(ex["seconds_ago"], int) and 0 <= ex["seconds_ago"] < 30, ex
    assert ex["created_at"], ex
    msg = d["message"]
    assert "уже записана" in msg and "45 ₾" in msg and "карта TBC" in msg and "подтвердите" in msg, msg
    assert "секунд" in msg and "назад" in msg, msg
    s.refresh(c)
    assert c.balance == 45, f"баланс удвоился при 409: {c.balance}"
    assert _count(s) == rows and _ledger(s) == ledger, "при 409 что-то записалось"


def test_confirm_duplicate_creates_second_and_credits():
    s, admin, c = _setup()
    _pay(s, admin, c, 45)
    st, tx = _pay(s, admin, c, 45, "card_bog", confirm=True)
    assert st == "ok", (st, tx)
    s.refresh(c)
    assert c.balance == 90, c.balance
    assert _count(s) == 2


def test_other_amount_client_currency_pass_silently():
    s, admin, c = _setup()
    other = _client(s, "ira@example.com", "Ирина")
    assert _pay(s, admin, c, 45)[0] == "ok"
    assert _pay(s, admin, c, 50)[0] == "ok", "другая сумма — не дубль"
    assert _pay(s, admin, other, 45)[0] == "ok", "другой клиент — не дубль"
    assert _pay(s, admin, c, 45, currency="USD", credit_user_balance=False)[0] == "ok", "другая валюта — не дубль"
    s.refresh(c)
    assert c.balance == 95, c.balance


def test_cents_are_compared_not_rounded():
    s, admin, c = _setup()
    assert _pay(s, admin, c, 32.5)[0] == "ok"
    assert _pay(s, admin, c, 33)[0] == "ok", "32,5 и 33 — разные суммы"
    assert _pay(s, admin, c, 32.5)[0] == "409"


def test_other_admin_is_also_duplicate():
    """Решение: администратора не сравниваем. Два админа (телефон + компьютер)
    могут нажать «Принять оплату» по одной брони; лишний вопрос — одно нажатие,
    двойной платёж — деньги клиента. Другой админ получает тот же вопрос и может
    подтвердить; в тексте — кто записал первым."""
    s, admin, c = _setup()
    other_admin = _admin("Админ Два")
    assert _pay(s, admin, c, 45)[0] == "ok"
    st, d = _pay(s, other_admin, c, 45)
    assert st == "409" and d["code"] == "duplicate_recent", (st, d)
    assert "записал(а) Админ Один" in d["message"], d["message"]
    st, d = _pay(s, admin, c, 45)
    assert st == "409" and "записал(а)" not in d["message"], "про себя «записал(а)» не пишем"
    assert _pay(s, other_admin, c, 45, confirm=True)[0] == "ok", "подтверждённая запись другого админа не прошла"


def test_expense_adjustment_and_no_client_not_checked():
    from app.models.cashbox_transaction import CashboxTransaction
    s, admin, c = _setup()
    # расход с клиентом — не проверяется
    assert _pay(s, admin, c, 45, type="expense", credit_user_balance=False)[0] == "ok"
    assert _pay(s, admin, c, 45, type="expense", credit_user_balance=False)[0] == "ok"
    # приход без клиента — не проверяется
    for _ in range(2):
        st, _tx = _pay(s, admin, c, 45, client_id=None, credit_user_balance=False)
        assert st == "ok", "приход без клиента получил проверку дубля"
    # корректировка (adjustment) — ни как новая, ни как «уже существующая»
    for _ in range(2):
        st, _tx = _pay(s, admin, c, 45, method="adjustment", credit_user_balance=False)
        assert st == "ok", "корректировка получила проверку дубля"
    s2, admin2, c2 = _setup()
    s2.add(CashboxTransaction(
        type="income", amount=45, currency="GEL", payment_method="adjustment", date=datetime.now(),
        admin_id="x", client_id=str(c2.id), credited_user_id=str(c2.id),
    ))
    s2.commit()
    assert _pay(s2, admin2, c2, 45)[0] == "ok", "старая корректировка на ту же сумму сошла за «такую же оплату»"
    # расход не считается «уже записанной оплатой»
    s3, admin3, c3 = _setup()
    assert _pay(s3, admin3, c3, 45, type="expense", credit_user_balance=False)[0] == "ok"
    assert _pay(s3, admin3, c3, 45)[0] == "ok", "расход сошёл за «такую же оплату»"


def test_window_is_three_minutes():
    """Окно «только что» — 3 минуты: до него в тексте «N назад», после — уже другое
    (мягкое предупреждение «сегодня», см. guard_duplicate_today_2026_10). Время
    «сейчас» фиксируем в полдень по Тбилиси, чтобы тест не зависел от полуночи."""
    from app.api.v1.cashbox import transactions as t
    real = t._server_now
    t._server_now = lambda: datetime(2026, 7, 15, 8, 0, 0)  # 12:00 по Тбилиси
    try:
        s, admin, c = _setup()
        _st, first = _pay(s, admin, c, 45)
        _age_at(s, first.id, datetime(2026, 7, 15, 7, 58, 0))  # 2 минуты назад
        st, d = _pay(s, admin, c, 45)
        assert st == "409" and "минуты назад" in d["message"] and d["existing"]["window"] == "recent", \
            "через 2 минуты уже не дубль"
        s2, admin2, c2 = _setup()
        _st, first2 = _pay(s2, admin2, c2, 45)
        _age_at(s2, first2.id, datetime(2026, 7, 15, 7, 56, 0))  # 4 минуты назад
        st, d = _pay(s2, admin2, c2, 45)
        assert st == "409" and d["existing"]["window"] == "today" and "назад" not in d["message"], \
            "через 4 минуты должно быть уже «сегодняшнее» предупреждение, не «N назад»"
    finally:
        t._server_now = real


def test_deleted_first_payment_is_not_duplicate():
    """«Вернуть» первый платёж и внести заново — легально, дубля нет."""
    from app.models.cashbox_transaction import CashboxTransaction
    s, admin, c = _setup()
    _st, first = _pay(s, admin, c, 45)
    s.delete(s.get(CashboxTransaction, first.id))
    s.commit()
    assert _pay(s, admin, c, 45)[0] == "ok"


def test_same_person_by_uuid_and_by_email_is_one_client():
    s, admin, c = _setup()
    assert _pay(s, admin, c, 45, by="id")[0] == "ok"
    assert _pay(s, admin, c, 45, by="email")[0] == "409", "тот же человек под email обошёл защиту"


def test_uuid_vs_email_without_credit_flag():
    """NB-3: без зачисления на баланс тот же человек под email тоже один клиент."""
    s, admin, c = _setup()
    assert _pay(s, admin, c, 45, by="id", credit_user_balance=False)[0] == "ok"
    assert _pay(s, admin, c, 45, by="email", credit_user_balance=False)[0] == "409", \
        "без credit_user_balance email и UUID одного человека не склеились"
    # клиент, которого нет среди пользователей (id клиента Psy-CRM): остаётся сырой client_id
    assert _pay(s, admin, c, 45, client_id="crm-client-1", credit_user_balance=False)[0] == "ok"
    assert _pay(s, admin, c, 45, client_id="crm-client-1", credit_user_balance=False)[0] == "409"
    assert _pay(s, admin, c, 45, client_id="crm-client-2", credit_user_balance=False)[0] == "ok"


def test_lock_wait_is_bounded_and_timeout_is_409():
    """NB-1: ожидание замка ≤ 5 с (SET LOCAL), после замка таймаут возвращается в
    умолчание; вышло время (55P03) → 409 с понятным текстом, без записи."""
    from fastapi import HTTPException
    from sqlalchemy.exc import OperationalError
    from app.api.v1.cashbox import transactions as t

    class _Orig(Exception):
        def __init__(self, code):
            self.pgcode = code

    def run(fail_code=None):
        log = []

        class _S:
            def get_bind(self):
                return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

            def execute(self, stmt, params=None):
                sql = str(stmt)
                log.append(sql)
                if "pg_advisory_xact_lock" in sql and fail_code:
                    raise OperationalError(sql, params, _Orig(fail_code))

            def rollback(self):
                log.append("ROLLBACK")

        try:
            t._lock_client_for_payment(_S(), "k")
            return log, None
        except Exception as e:  # noqa: BLE001
            return log, e

    log, err = run()
    assert err is None
    assert "lock_timeout = '5s'" in log[0] and "pg_advisory_xact_lock" in log[1] and "lock_timeout TO DEFAULT" in log[2], log
    log, err = run("55P03")
    assert isinstance(err, HTTPException) and err.status_code == 409, err
    assert "уже записывается операция" in err.detail and "повторите через минуту" in err.detail, err.detail
    assert "ROLLBACK" in log and not any("DEFAULT" in x for x in log), log
    log, err = run("40001")
    assert isinstance(err, OperationalError), "чужие ошибки БД глотать нельзя"


def test_plural_and_ago_text():
    from app.api.v1.cashbox.transactions import _ago_ru
    got = [_ago_ru(n) for n in (1, 23, 5, 11, 21, 0, 60, 125)]
    assert got == ["1 секунду назад", "23 секунды назад", "5 секунд назад", "11 секунд назад",
                   "21 секунду назад", "0 секунд назад", "1 минуту назад", "2 минуты назад"], got


def test_lock_taken_before_check_on_postgres_only():
    """Замок по клиенту: только в Postgres, ключ — id пользователя; в коде он
    стоит РАНЬШЕ проверки дубля (иначе гонка двух запросов)."""
    from app.api.v1.cashbox import transactions as t
    calls = []

    class _Sess:
        def __init__(self, name):
            self._name = name

        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name=self._name))

        def execute(self, stmt, params=None):
            calls.append((str(stmt), params))

    t._lock_client_for_payment(_Sess("sqlite"), "k1")
    assert calls == [], "в SQLite замок не нужен"
    t._lock_client_for_payment(_Sess("postgresql"), "k1")
    lock = [c for c in calls if "pg_advisory_xact_lock" in c[0]]
    assert len(lock) == 1 and lock[0][1] == {"k": "k1"}, calls

    src = (ROOT / "backend/app/api/v1/cashbox/transactions.py").read_text(encoding="utf-8")
    body = src[src.index("def create_transaction("):]
    assert body.index("_lock_client_for_payment(") < body.index("_find_recent_duplicate("), "замок после проверки"
    assert body.index("_find_recent_duplicate(") < body.index("session.commit()"), "проверка вне транзакции записи"
    assert "pg_advisory_xact_lock" in src and "advisory_lock(" not in src, "нужен именно xact-замок (снимается сам при commit/rollback)"


def test_confirm_flag_not_a_table_column():
    from app.models.cashbox_transaction import CashboxTransaction, CashboxTransactionCreate
    assert "confirm_duplicate" in CashboxTransactionCreate.model_fields
    assert "confirm_duplicate" not in CashboxTransaction.__table__.columns, "флаг подтверждения попал в таблицу"
    assert CashboxTransactionCreate(type="income", amount=1).confirm_duplicate is False


# ─── Фронт: статика ──────────────────────────────────────────────────────

CLIENT_INCOME_FILES = [
    "src/components/admin/BookingMoneyHints.tsx",
    "src/pages/admin/UserDetails.tsx",
    "src/pages/mobile/admin/TopupSheet.tsx",
    "src/components/admin/cashbox/AddCashboxTransactionModal.tsx",
]


def test_all_client_incomes_go_through_the_guard_helper():
    for rel in CLIENT_INCOME_FILES:
        code = _code(rel)
        assert "createIncomeWithDuplicateGuard(" in code, f"{rel}: приход с клиентом не через защиту от дубля"
        assert "isDuplicateDeclined" in code, f"{rel}: отказ от повтора не обработан (покажется как ошибка)"
        assert "paymentErrorText(" in code, f"{rel}: текст ошибки не общий"
        assert "from " in code and "utils/cashboxDuplicate'" in code, rel
    # И обратное: прямой cashboxApi.createTransaction с client_id в src не остался.
    allowed = {"src/utils/cashboxDuplicate.ts", "src/api/cashbox.ts"}
    bad = []
    for p in (ROOT / "src").rglob("*.ts*"):
        rel = str(p.relative_to(ROOT))
        if rel in allowed:
            continue
        code = _strip_comments(p.read_text(encoding="utf-8"))
        for m in re.finditer(r"cashboxApi\.createTransaction\(", code):
            if "client_id" in code[m.end():m.end() + 900] or "credit_user_balance" in code[m.end():m.end() + 900]:
                bad.append(rel)
    assert not bad, f"приход с клиентом мимо защиты от дубля: {bad}"
    # Мобильная «Касса» (MobileAdminFinance) и стор — без клиента: сервер их не проверяет.
    mf = _code("src/pages/mobile/admin/MobileAdminFinance.tsx")
    assert "client_id" not in mf[mf.index("interface AddPayload"):mf.index("interface AddPayload") + 400], \
        "в мобильной кассе появился выбор клиента — подключите createIncomeWithDuplicateGuard"


def test_confirm_dialog_focus_on_cancel_without_red_button():
    """NB-2: стартовый фокус на «Отмена», кнопка «Записать ещё одну» не красная."""
    h = _code("src/utils/cashboxDuplicate.ts")
    assert "initialFocus: 'cancel'" in h and "tone: 'danger'" not in h, "фокус на «Отмена» не задан или кнопка красная"
    p = _code("src/components/ui/ConfirmDialogProvider.tsx")
    assert "opts?.initialFocus === 'cancel' ? cancelRef : confirmRef" in p, "провайдер не слушает initialFocus"
    assert "variant={danger ? 'danger' : 'primary'}" in p


def test_helper_asks_with_server_text_and_retries_with_flag():
    h = _code("src/utils/cashboxDuplicate.ts")
    assert "confirmAction(" in h and "body: message" in h, "нет подтверждения с текстом сервера"
    assert "confirmLabel: 'Записать ещё одну'" in h and "cancelLabel: 'Отмена'" in h
    assert "confirm_duplicate: true" in h, "повтор без confirm_duplicate"
    assert "throw new DuplicatePaymentDeclined()" in h, "отказ должен останавливать запись и успех"
    assert "isDuplicatePayment(err)" in h


def test_client_interceptor_silent_on_duplicate_and_cashbox_write_failures():
    c = _code("src/api/client.ts")
    assert "isDuplicatePayment(error)" in c, "общий client.ts покажет второй тост на 409 duplicate_recent"
    assert "isCashboxWrite" in c, "общий тост «повторите» на сбой записи в кассу (платёж мог пройти)"
    e = _code("src/utils/errors.ts")
    assert "code === 'duplicate_recent'" in e
    assert "Не удалось подтвердить запись. Проверьте журнал кассы, прежде чем вносить заново" in e


def test_no_misleading_cashbox_access_text():
    bad = []
    for p in (ROOT / "src").rglob("*.ts*"):
        if "нужен доступ к кассе" in _strip_comments(p.read_text(encoding="utf-8")):
            bad.append(str(p.relative_to(ROOT)))
    assert not bad, f"«нужен доступ к кассе» снова выводится (админ принимает сбой за отсутствие прав): {bad}"


def test_payment_and_screen_refresh_are_separate_tries():
    """Сбой fetchUsers/onDone ПОСЛЕ записанного платежа не должен давать «не прошло»."""
    hints = _code("src/components/admin/BookingMoneyHints.tsx")
    hc = hints[hints.index("const handleConfirm = async"):]
    hc = hc[:hc.index("    };")]
    assert hc.index("createIncomeWithDuplicateGuard(") < hc.index("catch") < hc.index("fetchUsers()"), "fetchUsers снова внутри try платежа"
    assert "try { await fetchUsers(); } catch" in hc

    ud = _code("src/pages/admin/UserDetails.tsx")
    af = ud[ud.index("const handleAddFunds = async"):ud.index("const handleUpdateCreditLimit")]
    assert af.index("createIncomeWithDuplicateGuard(") < af.index("catch") < af.index("await fetchUsers()"), "fetchUsers снова внутри try платежа"
    assert "await reloadTotalPaid();\n        } catch" in af

    ts = _code("src/pages/mobile/admin/TopupSheet.tsx")
    sv = ts[ts.index("const save = async"):ts.index("return (", ts.index("const save = async"))]
    assert sv.index("createIncomeWithDuplicateGuard(") < sv.index("catch") < sv.index("await onDone()"), "onDone снова внутри try платежа"


def test_paymentErrorText_logic():
    """Без ответа сервера — «проверьте журнал»; с ответом — слова сервера."""
    import shutil
    import subprocess
    import tempfile
    node = shutil.which("node")
    if not node:
        return
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return
    if (major, minor) < (22, 6):
        return
    src = _read("src/utils/errors.ts").replace("import { toast } from 'sonner';", "const toast: any = { error() {} };")
    with tempfile.TemporaryDirectory() as d:
        pathlib.Path(d, "errors.ts").write_text(src, encoding="utf-8")
        prog = """
import { paymentErrorText, isDuplicatePayment, PAYMENT_UNCERTAIN_TEXT } from './errors.ts';
const r = (status, detail) => ({ response: { status, data: { detail } } });
console.log(JSON.stringify({
  noResponse: paymentErrorText(new Error('boom')) === PAYMENT_UNCERTAIN_TEXT,
  network: paymentErrorText({ isAxiosError: true, request: {}, message: 'Network Error' }) === PAYMENT_UNCERTAIN_TEXT,
  gateway: paymentErrorText(r(504, 'Gateway Time-out')) === PAYMENT_UNCERTAIN_TEXT,
  server500: paymentErrorText(r(500, 'Внутренняя ошибка')) === PAYMENT_UNCERTAIN_TEXT,
  serverWords: paymentErrorText(r(403, 'Нет доступа к кассе')),
  english: paymentErrorText(r(400, 'Bad request'), 'Не удалось записать оплату'),
  dup: isDuplicatePayment(r(409, { code: 'duplicate_recent', message: 'x' })),
  otherConflict: isDuplicatePayment(r(409, 'Конфликт')),
  dup400: isDuplicatePayment(r(400, { code: 'duplicate_recent' })),
}));
"""
        pathlib.Path(d, "t.mts").write_text(prog, encoding="utf-8")
        r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", str(pathlib.Path(d, "t.mts"))],
                           capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        if "strip-types" in r.stderr or "bad option" in r.stderr:
            return
        raise AssertionError(f"node упал: {r.stderr[:500]}")
    import json
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["noResponse"] and out["network"] and out["gateway"] and out["server500"], out
    assert out["serverWords"] == "Нет доступа к кассе", out
    assert out["english"] == "Не удалось записать оплату", out
    assert out["dup"] is True and out["otherConflict"] is False and out["dup400"] is False, out


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
    print("СТОРОЖ ДУБЛЯ ОПЛАТЫ: OK" if not fails else f"СТОРОЖ ДУБЛЯ ОПЛАТЫ УПАЛ ({fails})")
    sys.exit(1 if fails else 0)
