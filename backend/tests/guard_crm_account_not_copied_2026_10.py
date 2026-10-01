"""СТОРОЖ: сессия из брони кабинета НЕ копирует счёт клиента (Psy-CRM, 01.10.2026).

Что случилось: при создании сессии из брони кабинета (bookings/routes.py) в
TherapySession.account копировался client.default_account. Клиенту потом меняли
счёт по умолчанию (Cash -> TBC), а неоплаченная сессия оставалась на старом счёте,
и «Отметить оплату» отправляла платёж не туда (кейс «Андрей и Надежда»).

Что не должно сломаться снова:
  1  В bookings/routes.py ни одно создание TherapySession (`_TS(...)`) не получает
     `account=`, и нигде нет присваивания `<сессия>.account = ...` при привязке
     существующей сессии к брони.
  2  Во всём backend/app создание TherapySession с `account=` не встречается
     (счёт сессии ставится только на оплате / в явной правке человеком).
  3  Форма создания сессии (TherapySessionCreate) не принимает `account`.
  4  Сессия без счёта (как из брони): после смены счёта клиента Cash -> TBC
     «Отметить оплату» записывает платёж на новый счёт (TBC), а не на старый.
     Контроль: сессия со скопированным старым счётом уходит на старый — ради этого
     копию и убрали.
  5  Скрипт чистки crm_clear_copied_account_2026_10.py: по умолчанию ничего не
     пишет; обнуляет только НЕОПЛАЧЕННЫЕ сессии, где счёт = счёт клиента без учёта
     регистра; другие счета, оплаченные сессии и сессии с платежом не трогает.

Без сети и боевой базы: SQLite в памяти, мост в финансы подменён.

    python3 backend/tests/guard_crm_account_not_copied_2026_10.py
"""
import ast
import importlib.util
import os
import pathlib
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

BACKEND = pathlib.Path(__file__).parent.parent
APP = BACKEND / "app"
BOOKINGS = APP / "api" / "v1" / "bookings"
SCRIPT = BACKEND / "scripts" / "crm_clear_copied_account_2026_10.py"

# Фикстуры берём у соседнего сторожа счёта платежа (SQLite, подмена моста, quick-pay).
_spec = importlib.util.spec_from_file_location(
    "_guard_pay_account", pathlib.Path(__file__).parent / "guard_crm_payment_account_2026_10.py")
_pa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pa)


# ─── AST-помощники ───────────────────────────────────────────────────────

_SESSION_NAMES = {"TherapySession", "_TS"}


def _calls_of_session(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else None)
            if name in _SESSION_NAMES:
                yield node


def _account_assignments(tree):
    """Присваивания вида `что-то.account = ...` (в том числе augmented)."""
    for node in ast.walk(tree):
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets = [node.target]
        for t in targets:
            if isinstance(t, ast.Attribute) and t.attr == "account":
                yield node


# ─── 1-2. Исходники ──────────────────────────────────────────────────────

def test_booking_routes_session_creation_has_no_account():
    path = BOOKINGS / "routes.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    calls = list(_calls_of_session(tree))
    assert len(calls) >= 2, f"в routes.py не нашлось создания сессий (_TS(...)): {len(calls)} — сторож устарел?"
    for c in calls:
        kws = {k.arg for k in c.keywords}
        assert "account" not in kws, (
            f"bookings/routes.py:{c.lineno}: сессия из брони снова получает account= "
            f"(копия счёта клиента замораживается после смены счёта)")


def test_booking_routes_does_not_stamp_account_on_existing_session():
    for path in sorted(BOOKINGS.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        bad = list(_account_assignments(tree))
        assert not bad, (
            f"{path.name}:{bad[0].lineno}: при привязке существующей сессии к брони "
            f"ставится .account — счёт клиента снова копируется")


def test_no_session_is_created_with_account_anywhere_in_app():
    offenders = []
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for c in _calls_of_session(tree):
            if "account" in {k.arg for k in c.keywords}:
                offenders.append(f"{path.relative_to(BACKEND)}:{c.lineno}")
    assert not offenders, "TherapySession создаётся сразу со счётом: " + ", ".join(offenders)


def test_session_create_schema_has_no_account():
    from app.models.therapy_session import TherapySessionCreate
    assert "account" not in TherapySessionCreate.model_fields, \
        "форма создания сессии принимает account — вернётся замороженный счёт"


# ─── 4. Цепочка выбора счёта при оплате ──────────────────────────────────

def _seed_booking_like_session(eng, session_account):
    """Клиент со счётом Cash + неоплаченная сессия «из брони» (счёт — как задан)."""
    from sqlmodel import Session
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession
    with Session(eng) as s:
        s.add(TherapistClient(id="c1", specialist_id=_pa.ME, name="Андрей и Надежда", base_price=200.0,
                              currency="GEL", default_account="Cash"))
        s.add(TherapySession(
            id="s1", client_id="c1", specialist_id=_pa.ME, status="COMPLETED", price=200.0,
            currency="GEL", account=session_account, is_paid=False, is_booked=True, booking_id="b1",
            date=datetime.utcnow() - timedelta(days=2)))
        s.commit()


def test_session_without_account_pays_to_new_client_account_after_change():
    eng, br = _pa._engine(), _pa._Bridge()
    try:
        _seed_booking_like_session(eng, session_account=None)
        _pa._change_default_account(eng, "tbc")
        res = _pa._quick_pay(eng)
        assert _pa._payment_of(eng).account == "tbc", "платёж ушёл не на новый счёт клиента (TBC)"
        assert res["account"] == "tbc"
    finally:
        br.undo()


def test_control_copied_account_would_pay_to_old_account():
    """Контроль смысла правки: скопированный счёт перебивает новый счёт клиента."""
    eng, br = _pa._engine(), _pa._Bridge()
    try:
        _seed_booking_like_session(eng, session_account="Cash")
        # Смена счёта БЕЗ «применить к неоплаченным»: сессия с копией остаётся на старом.
        _pa._change_default_account(eng, "tbc")
        _pa._quick_pay(eng)
        assert _pa._payment_of(eng).account == "Cash", \
            "цепочка выбора счёта изменилась: счёт сессии больше не главнее счёта клиента — пересмотри сторож"
    finally:
        br.undo()


def test_explicit_choice_in_request_still_wins_over_empty_session_account():
    eng, br = _pa._engine(), _pa._Bridge()
    try:
        _seed_booking_like_session(eng, session_account=None)
        _pa._quick_pay(eng, payload={"account": "bog"})
        assert _pa._payment_of(eng).account == "bog", "явный выбор счёта в запросе перестал работать"
    finally:
        br.undo()


# ─── 5. Скрипт чистки ────────────────────────────────────────────────────

def _load_script():
    spec = importlib.util.spec_from_file_location("_clear_copied_account", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_cleanup_script_is_dry_run_by_default_and_backs_up():
    src = SCRIPT.read_text(encoding="utf-8")
    assert "apply = args.apply and not args.dry_run" in src, "скрипт больше не dry-run по умолчанию"
    assert "/root/backups" in src and "json.dump" in src, "у --apply нет JSON-бэкапа"
    assert src.index("json.dump") < src.index("UPDATE therapy_sessions"), "бэкап должен быть ДО обновления"
    assert "is_paid = false" in src.split("UPDATE therapy_sessions", 1)[1], \
        "UPDATE не перепроверяет, что сессия неоплачена"


def test_cleanup_script_picks_only_unpaid_copies_case_insensitive():
    from sqlalchemy import text
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession

    m = _load_script()
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[
        TherapistClient.__table__, TherapySession.__table__, TherapistPayment.__table__])
    now = datetime.utcnow()

    def sess(sid, cid, account, paid=False):
        return TherapySession(id=sid, client_id=cid, specialist_id="sp1", status="PLANNED",
                              account=account, is_paid=paid, date=now)

    with Session(eng) as s:
        s.add(TherapistClient(id="c1", specialist_id="sp1", name="А", default_account="TBC"))
        s.add(TherapistClient(id="c2", specialist_id="sp1", name="Б", default_account="Cash"))
        s.add(TherapistClient(id="c3", specialist_id="sp1", name="В", default_account=""))
        s.add_all([
            sess("copy-lower", "c1", "tbc"),            # копия, другой регистр -> чистим
            sess("copy-exact", "c2", "Cash"),           # копия -> чистим
            sess("copy-spaces", "c2", " cash "),        # копия с пробелами -> чистим
            sess("explicit", "c1", "bog"),              # выбран явно -> не трогаем
            sess("paid", "c1", "tbc", paid=True),       # оплачена -> история
            sess("empty", "c1", None),                  # уже пусто
            sess("noclientacc", "c3", "tbc"),           # у клиента нет счёта -> не трогаем
            sess("partial", "c2", "Cash"),              # есть частичный платёж -> не трогаем
        ])
        s.add(TherapistPayment(id="p1", client_id="c2", specialist_id="sp1", session_id="partial",
                               amount=50.0, currency="GEL", account="Cash", date=now))
        s.commit()

    with eng.connect() as conn:
        rows = [dict(r._mapping) for r in conn.execute(text(m.SQL_ROWS))]
    ids = {r["id"] for r in rows}
    assert "paid" not in ids, "оплаченная сессия попала в выборку"
    b = m.classify(rows)
    assert {r["id"] for r in b["copy"]} == {"copy-lower", "copy-exact", "copy-spaces"}, \
        f"к обнулению выбраны не те: {sorted(r['id'] for r in b['copy'])}"
    assert {r["id"] for r in b["other"]} == {"explicit"}
    assert {r["id"] for r in b["copy_partial"]} == {"partial"}
    assert {r["id"] for r in b["client_empty"]} == {"noclientacc"}
    assert {r["id"] for r in b["none"]} == {"empty"}


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
    print("СТОРОЖ «СЧЁТ НЕ КОПИРУЕТСЯ В СЕССИЮ ИЗ БРОНИ»: OK" if not fails
          else f"СТОРОЖ «СЧЁТ НЕ КОПИРУЕТСЯ В СЕССИЮ ИЗ БРОНИ» УПАЛ ({fails})")
    sys.exit(1 if fails else 0)
