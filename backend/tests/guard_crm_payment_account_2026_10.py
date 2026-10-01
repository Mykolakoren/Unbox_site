"""СТОРОЖ: «счёт сессии» ≠ «счёт платежа» в Psy-CRM (кейс 01.10, «Андрей и Надежда»).

Что случилось: на карточке клиента нажали «Отметить оплату» — платёж записался
на «Cash». Потом в панели правки сессии выбрали в поле «Счёт для оплаты» TBC и
несколько раз нажали «Сохранить», а в «Последних оплатах» осталось «Cash 200 ₾»:
поле меняет счёт СЕССИИ, а в списке стоит счёт ПЛАТЕЖА. Править платёж можно было
только в блоке «Оплата» ниже формы, а в «Последних оплатах» кнопки правки не было.
Сам «Cash» появился так: клиенту сменили счёт по умолчанию Cash → TBC, а старый
счёт «заморозился» на прошлой неоплаченной сессии и перебил новый.

Что не должно сломаться снова:
  1  quick-pay: счёт, выбранный в запросе, главнее счёта на сессии; нет выбора — счёт
     сессии; нет и его — счёт клиента по умолчанию → счёт последнего платежа → «Cash».
     В ответе — тот счёт, на который реально записан платёж.
  2  Смена счёта клиента по умолчанию не «замораживает» старый счёт на НЕОПЛАЧЕННЫХ
     сессиях (у оплаченных — замораживает, это история).
  3  PATCH /crm/payments/{id} работает и для платежа БЕЗ сессии: без пересчёта «оплачено».
  4  Фронт: при уже внесённой оплате в форме цены нет поля «Счёт для оплаты» (счёт
     оплаты правится только в блоке «Оплата»), блок «Оплата» стоит выше формы и
     подписан; у каждой оплаты в «Последних оплатах» (компьютер и телефон) есть
     карандаш, он открывает ТО ЖЕ окно PaymentEditSheet, что и блок «Оплата».
  5  Счета сопоставляются без учёта регистра («Cash» = «cash», «TBC» = «tbc»), а в
     «Новом платеже» счёт — выбор из списка, а не свободный текст.

Без сети и боевой базы: SQLite в памяти, мост в финансы подменён.

    python3 backend/tests/guard_crm_payment_account_2026_10.py
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

BACKEND = pathlib.Path(__file__).parent.parent
ROOT = BACKEND.parent

ME = "sp1"


def _src(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_src(rel))


# ─── Фикстуры ────────────────────────────────────────────────────────────

def _engine():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
    from app.models.app_setting import AppSetting
    from app.models.specialist import Specialist
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[
        AppSetting.__table__, Specialist.__table__, TherapistClient.__table__,
        TherapySession.__table__, TherapistPayment.__table__,
    ])
    return eng


def _user(uid=ME):
    return SimpleNamespace(id=uid, email=f"{uid}@example.com", name="Спец", crm_data={})


class _Bridge:
    """Подмена моста в финансы: запоминаем вызовы, в сеть не ходим."""

    def __init__(self):
        import app.api.v1.crm.payments as pay
        import app.api.v1.crm.sessions as ses
        self.saved, self.calls = [], []
        for mod in (pay, ses):
            for name in ("push_payment", "retract_payment", "resync_payment"):
                if hasattr(mod, name):
                    self.saved.append((mod, name, getattr(mod, name)))
                    setattr(mod, name, self._make(name))

    def _make(self, name):
        def fake(*args, **kwargs):
            self.calls.append((name, args, kwargs))
        return fake

    def undo(self):
        for mod, name, fn in self.saved:
            setattr(mod, name, fn)

    def names(self):
        return [c[0] for c in self.calls]


def _seed(s, *, default_account="tbc", session_account=None, paid=False, sid="s1", cid="c1",
          past_payments=(), days_ago=2):
    """Клиент (счёт по умолчанию = default_account) + сессия 200 ₾ в прошлом."""
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession

    if not s.get(TherapistClient, cid):
        s.add(TherapistClient(id=cid, specialist_id=ME, name="Андрей и Надежда", base_price=200.0,
                              currency="GEL", default_account=default_account))
    for i, (acc, dt) in enumerate(past_payments):
        s.add(TherapistPayment(id=f"old-{cid}-{i}", client_id=cid, specialist_id=ME, amount=200.0,
                               currency="GEL", account=acc, date=dt))
    ts = TherapySession(id=sid, client_id=cid, specialist_id=ME, status="COMPLETED", price=200.0,
                        currency="GEL", account=session_account, is_paid=paid,
                        date=datetime.utcnow() - timedelta(days=days_ago))
    s.add(ts)
    s.commit()
    return ts


def _quick_pay(eng, sid="s1", payload=None):
    from sqlmodel import Session
    from app.api.v1.crm.sessions import quick_pay_session
    with Session(eng) as s:
        return quick_pay_session(session_id=sid, payload=payload or {}, session=s, current_user=_user())


def _payment_of(eng, sid="s1"):
    from sqlmodel import Session, select
    from app.models.therapist_payment import TherapistPayment
    with Session(eng) as s:
        return s.exec(select(TherapistPayment).where(TherapistPayment.session_id == sid)).first()


def _session_account(eng, sid="s1"):
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession
    with Session(eng) as s:
        return s.get(TherapySession, sid).account


# ─── 1. quick-pay: откуда берётся счёт ───────────────────────────────────

def test_quick_pay_uses_client_default_when_session_has_no_account():
    eng, br = _engine(), _Bridge()
    try:
        from sqlmodel import Session
        with Session(eng) as s:
            _seed(s, default_account="tbc", session_account=None)
        res = _quick_pay(eng)
        assert _payment_of(eng).account == "tbc", "платёж не на счёте клиента по умолчанию"
        assert res["account"] == "tbc"
    finally:
        br.undo()


def test_quick_pay_explicit_account_beats_session_account():
    """Выбор счёта в запросе — главнее старого счёта на сессии (раньше он молча игнорировался)."""
    eng, br = _engine(), _Bridge()
    try:
        from sqlmodel import Session
        with Session(eng) as s:
            _seed(s, default_account="tbc", session_account="Cash")
        res = _quick_pay(eng, payload={"account": "bog"})
        assert _payment_of(eng).account == "bog", "выбранный счёт перебит счётом сессии"
        assert res["account"] == "bog", "в ответе не тот счёт, что записан"
        assert _session_account(eng) == "bog", "счёт сессии не обновился до выбранного при оплате"
    finally:
        br.undo()


def test_quick_pay_keeps_session_account_without_explicit_choice():
    eng, br = _engine(), _Bridge()
    try:
        from sqlmodel import Session
        with Session(eng) as s:
            _seed(s, default_account="cash", session_account="tbc")
        res = _quick_pay(eng)
        assert _payment_of(eng).account == "tbc", "счёт, поставленный на сессию, не учтён"
        assert res["account"] == "tbc", "в ответе счёт не тот, что записан в платёж"
    finally:
        br.undo()


def test_quick_pay_default_chain_client_then_last_payment_then_cash():
    from sqlmodel import Session
    from app.api.v1.crm.sessions import _default_payment_account
    from app.models.therapist_client import TherapistClient
    eng = _engine()
    now = datetime.now()
    with Session(eng) as s:
        _seed(s, default_account="tbc", past_payments=[("bog", now - timedelta(days=9))])
        cl = s.get(TherapistClient, "c1")
        assert _default_payment_account(s, cl, ME) == "tbc", "счёт клиента по умолчанию не первый"
        cl.default_account = "  "
        assert _default_payment_account(s, cl, ME) == "bog", "нет счёта клиента — берём счёт последнего платежа"
        _seed(s, cid="c2", sid="s2", default_account="")
        assert _default_payment_account(s, s.get(TherapistClient, "c2"), ME) == "Cash", \
            "нет ни счёта клиента, ни платежей — «Cash»"
    # последний платёж — по дате, а не по порядку записи
    eng2 = _engine()
    with Session(eng2) as s:
        _seed(s, default_account="", past_payments=[
            ("tbc", now - timedelta(days=1)), ("bog", now - timedelta(days=30)),
        ])
        assert _default_payment_account(s, s.get(TherapistClient, "c1"), ME) == "tbc"


def test_mark_all_paid_uses_same_default_chain():
    from sqlmodel import Session, select
    from app.api.v1.crm.sessions import mark_all_sessions_paid
    from app.models.therapist_payment import TherapistPayment
    eng, br = _engine(), _Bridge()
    try:
        with Session(eng) as s:
            _seed(s, default_account="tbc", session_account=None)
        with Session(eng) as s:
            mark_all_sessions_paid(client_id="c1", session=s, current_user=_user())
        with Session(eng) as s:
            pays = s.exec(select(TherapistPayment).where(TherapistPayment.session_id == "s1")).all()
        assert [p.account for p in pays] == ["tbc"], f"«Отметить все» записало счёт {[p.account for p in pays]}"
    finally:
        br.undo()


# ─── 2. Смена счёта по умолчанию и «заморозка» ───────────────────────────

def _change_default_account(eng, new_account, cid="c1"):
    from sqlmodel import Session
    from app.api.v1.crm.clients import update_client
    from app.models.therapist_client import TherapistClientUpdate
    with Session(eng) as s:
        return update_client(client_id=cid, data=TherapistClientUpdate(default_account=new_account),
                             apply_price_to=None, session=s, current_user=_user())


def test_changing_default_account_does_not_freeze_old_one_on_unpaid_sessions():
    """Кейс 01.10: Cash → TBC; неоплаченная прошлая сессия оплачивается на TBC, а не на «Cash»."""
    eng, br = _engine(), _Bridge()
    try:
        from sqlmodel import Session
        with Session(eng) as s:
            _seed(s, default_account="Cash", session_account=None, paid=False, sid="s-unpaid")
            _seed(s, default_account="Cash", session_account=None, paid=True, sid="s-paid", days_ago=9)
        _change_default_account(eng, "tbc")
        assert _session_account(eng, "s-unpaid") is None, "на неоплаченную сессию заморозился старый счёт"
        assert _session_account(eng, "s-paid") == "Cash", "у оплаченной сессии старый счёт не сохранён (история)"
        _quick_pay(eng, sid="s-unpaid")
        assert _payment_of(eng, "s-unpaid").account == "tbc", "после смены счёта оплата ушла на старый"
    finally:
        br.undo()


def test_freeze_of_price_and_currency_untouched():
    """Заморозка цены и валюты прошлых сессий — как раньше (не трогаем деньги)."""
    src = _src("backend/app/api/v1/crm/clients.py")
    assert 'if "price" in _freeze_fields and _ts.price is None:' in src
    assert 'if "currency" in _freeze_fields and not _ts.currency:' in src
    assert 'if "account" in _freeze_fields and not _ts.account and _ts.is_paid:' in src


# ─── 3. Платёж без сессии правится ───────────────────────────────────────

def test_patch_payment_without_session_edits_without_recount():
    from sqlmodel import Session
    from app.api.v1.crm.payments import update_payment
    from app.models.therapist_payment import TherapistPayment, TherapistPaymentUpdate
    eng, br = _engine(), _Bridge()
    try:
        with Session(eng) as s:
            _seed(s, default_account="tbc")
            s.add(TherapistPayment(id="p-free", client_id="c1", specialist_id=ME, amount=50.0, currency="GEL",
                                   account="Cash", date=datetime.now(), session_id=None))
            s.commit()
        with Session(eng) as s:
            out = update_payment(payment_id="p-free", data=TherapistPaymentUpdate(account="tbc", amount=70.0),
                                 session=s, current_user=_user())
        assert out.account == "tbc" and out.amount == 70.0 and out.session_id is None
        assert "resync_payment" in br.names(), "мост в финансы не вызван при смене счёта"
        # Чужая сессия «оплачено» не трогается: сессия s1 как была неоплаченной, так и осталась.
        from app.models.therapy_session import TherapySession
        with Session(eng) as s:
            assert s.get(TherapySession, "s1").is_paid is False
    finally:
        br.undo()


# ─── 4. Фронт ────────────────────────────────────────────────────────────

DETAIL = "src/pages/crm/CrmClientDetail.tsx"
BLOCK = "src/components/crm/SessionPaymentBlock.tsx"
EDIT = "src/components/crm/PaymentEditSheet.tsx"
MOBILE_SHEET = "src/pages/mobile/crm/SessionActionSheet.tsx"
MOBILE_CLIENT = "src/pages/mobile/crm/MobileCrmClient.tsx"


def _edit_panel(src: str) -> str:
    i = src.index("Счёт для оплаты")
    return src[src.rfind("{isEditing && (() =>", 0, i):src.index("Удалить сессию", i)]


def test_front_desktop_panel_hides_account_when_payment_exists_and_block_is_first():
    src = _code(DETAIL)
    panel = _edit_panel(src)
    gate = re.search(r"\{!payment && \(\s*<label[^>]*>\s*Счёт для оплаты\s*<AccountSelect", panel)
    assert gate, "поле «Счёт для оплаты» показывается и при внесённой оплате (меняет счёт сессии, а не платежа)"
    assert "if (!payment && accountSelectValue(editSessionAccount" in panel and "patch.account = editSessionAccount" in panel, \
        "кнопка «Сохранить» может молча сменить счёт сессии при внесённой оплате"
    # Блок «Оплата» — выше формы цены.
    assert panel.index("<SessionPaymentBlock") < panel.index('label="Цена"'), "блок «Оплата» не выше формы цены"
    blk = _code(BLOCK)
    assert "Оплата · счёт, сумма и день платежа правятся здесь" in blk, "блок «Оплата» без подписи"


def test_front_shared_payment_edit_sheet_in_all_places():
    edit = _code(EDIT)
    assert "export function PaymentEditSheet" in edit and "crmApi.updatePayment" in edit
    blk = _code(BLOCK)
    assert "function PaymentEditSheet" not in blk, "в блоке «Оплата» снова своя копия окна правки"
    assert "import { PaymentEditSheet } from './PaymentEditSheet'" in blk and "<PaymentEditSheet" in blk
    desk = _code(DETAIL)
    assert "import { PaymentEditSheet } from '../../components/crm/PaymentEditSheet'" in desk and "<PaymentEditSheet" in desk, \
        "карточка клиента не открывает общее окно правки платежа"
    mob = _code(MOBILE_CLIENT)
    assert "import { PaymentEditSheet } from '../../../components/crm/PaymentEditSheet'" in mob and "<PaymentEditSheet" in mob, \
        "мобильная карточка клиента не открывает общее окно правки платежа"
    # платёж без сессии: окно не обещает «остаток вернётся в долг»
    assert "payment.sessionId" in edit, "окно правки не отличает платёж без сессии"


def test_front_pencil_in_last_payments_desktop_and_mobile():
    desk = _code(DETAIL)
    i = desk.index("Последние оплаты")
    block = desk[i:desk.index("<NoteComposer", i)]
    assert "setEditingPayment(p)" in block and 'title="Изменить оплату"' in block, "в «Последних оплатах» нет карандаша"
    assert block.index("setEditingPayment(p)") < block.index("handleDeletePayment(p.id)"), "карандаш должен стоять рядом с корзиной, до неё"
    assert "!viewingOther" in block, "карандаш виден и в «просмотре как специалист»"
    mob = _code(MOBILE_CLIENT)
    assert "onEditPayment={viewingOther ? undefined : setEditingPayment}" in mob, "в мобильной ленте нет правки оплаты"
    row = mob[mob.index("if (item.kind === 'payment')"):mob.index("return <NoteRow")]
    assert "Изменить оплату" in row and "<Pencil" in row, "в мобильной ленте у платежа нет карандаша"


def test_front_mobile_price_step_hides_account_when_payment_exists():
    src = _code(MOBILE_SHEET)
    assert "hasPayment={!!payment}" in src, "мобильная форма цены не знает, есть ли платёж"
    form = src[src.index("function PriceForm"):src.index("function NotesForm")]
    assert re.search(r"hasPayment \? \([\s\S]+?\) : \([\s\S]+?Счёт для оплаты", form), \
        "поле «Счёт для оплаты» показывается и при внесённой оплате"
    assert "if (!payment && accountSelectValue(accountRaw" in src and "patch.account = accountRaw" in src, \
        "мобильная форма цены может молча сменить счёт сессии при внесённой оплате"
    # Блок «Оплата» на главном экране шторки — выше строки «Цена».
    main = src[src.index("function Main("):src.index("function RescheduleForm")]
    assert main.index("{paymentBlock}") < main.index('label="Цена"'), "мобильный блок «Оплата» не выше строки «Цена»"


def test_front_accounts_matched_case_insensitively_and_no_free_text():
    helper = _code("src/utils/paymentAccounts.ts")
    assert "toLowerCase()" in helper and "export function matchAccount" in helper
    for rel in (DETAIL, BLOCK, MOBILE_CLIENT, "src/pages/crm/CrmFinances.tsx"):
        code = _code(rel)
        assert "paymentAccounts.find(a => a.id ===" not in code, f"{rel}: счёт ищется по точному id — «Cash» не узнать"
        assert "accountLabel" in code, f"{rel}: подпись счёта не через общий accountLabel"
    fin = _code("src/pages/crm/CrmFinances.tsx")
    assert 'id="fin-pay-account"' not in fin or "AccountSelect" in fin, "счёт в «Новом платеже» снова свободный текст"
    assert 'placeholder="cash / bank / transfer"' not in fin, "в «Новом платеже» снова свободное поле счёта"
    assert "defaultPaymentAccount(" in fin and "defaultPaymentAccount(" in _code(DETAIL), \
        "счёт по умолчанию не через общую цепочку (клиент → последний платёж → наличные)"


def test_front_account_helpers_behave():
    node = shutil.which("node")
    if not node:
        return
    src = _src("src/utils/paymentAccounts.ts")
    prog = src + """
const acc = [{ id: 'cash', label: 'Наличные' }, { id: 'tbc', label: 'TBC' }, { id: 'bog', label: 'BOG' }];
console.log(JSON.stringify({
  cash: matchAccount('Cash', acc)?.id, tbc: matchAccount('TBC', acc)?.id, exact: matchAccount('bog', acc)?.id,
  byLabel: matchAccount('наличные', acc)?.id, unknown: matchAccount('paypal', acc) ?? null,
  label: accountLabel('Cash', acc), labelUnknown: accountLabel('paypal', acc),
  sel: accountSelectValue('TBC', acc), selUnknown: accountSelectValue('paypal', acc),
  d1: defaultPaymentAccount(acc, 'TBC', 'bog'),
  d2: defaultPaymentAccount(acc, '', 'BOG'),
  d3: defaultPaymentAccount(acc),
  d4: defaultPaymentAccount([], undefined, undefined),
  last: lastPaymentAccountOf([{ account: 'cash', date: '2026-09-01T10:00:00' }, { account: 'tbc', date: '2026-09-30T10:00:00' }, { account: '', date: '2026-10-05T10:00:00' }]),
}));
"""
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d) / "m.mts"
        f.write_text(prog, encoding="utf-8")
        r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", str(f)],
                           capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        if "strip-types" in r.stderr or "bad option" in r.stderr:
            return
        raise AssertionError(f"node упал: {r.stderr[:500]}")
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["cash"] == "cash" and out["tbc"] == "tbc" and out["exact"] == "bog" and out["byLabel"] == "cash", out
    assert out["unknown"] is None and out["label"] == "Наличные" and out["labelUnknown"] == "paypal", out
    assert out["sel"] == "tbc" and out["selUnknown"] == "paypal", out
    assert out["d1"] == "tbc", "счёт клиента должен идти первым"
    assert out["d2"] == "bog", "нет счёта клиента — счёт последнего платежа"
    assert out["d3"] == "cash" and out["d4"] == "cash", "в конце — наличные"
    assert out["last"] == "tbc", "последний платёж берётся по дате"


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
    print("СТОРОЖ СЧЁТА ПЛАТЕЖА CRM: OK" if not fails else f"СТОРОЖ СЧЁТА ПЛАТЕЖА CRM УПАЛ ({fails})")
    sys.exit(1 if fails else 0)
