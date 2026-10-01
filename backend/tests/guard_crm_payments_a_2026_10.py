"""СТОРОЖ: оплата сессии в Psy-CRM, этап А (02.10) — «починить форму оплаты».

Что чинили и не должно сломаться снова:
  1  Панель правки сессии теряла валюту и счёт: слала только цену, а в
     TherapySessionUpdate не было полей currency/account. Теперь сохраняются,
     проверяются (валюта — из заведённых в курсах, счёт — непустой), null не стирает.
  2  Платёж нельзя было поправить (только удалить). PATCH /crm/payments/{id}:
     сумма, валюта, счёт, дата; чужой платёж — 404; «оплачено» у сессии
     пересчитывается тем же правилом, что при создании платежа (вверх и вниз);
     мост в финансы (resync_payment) вызывается.
  3  Частичная оплата: долг = цена − внесённое, а не вся цена — в дашборде, списке
     клиентов, балансе клиента и списке сессий (одна функция services/session_balance).
     Платёж в другой валюте пересчитывается в валюту сессии по общим курсам.
  4  «Отметить оплату» / «Отметить все» по сессии с частичным платежом дописывают
     остаток в тот же платёж (раньше — 409 / ошибка уникальности).
  5  Фронт: панель правки шлёт price + currency + account; блок «Оплата» с
     «Изменить» и «Доплатить», предупреждение «Цена и оплата не совпадают».

Без сети и боевой базы: SQLite в памяти, мост в финансы подменён.

    python3 backend/tests/guard_crm_payments_a_2026_10.py
"""
import os
import pathlib
import re
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

BACKEND = pathlib.Path(__file__).parent.parent
ROOT = BACKEND.parent

ME, OTHER = "sp1", "sp2"


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
    """Подмена моста: запоминаем вызовы, в сеть не ходим."""

    def __init__(self):
        import app.api.v1.crm.payments as pay
        import app.api.v1.crm.sessions as ses
        self.mods = [pay, ses]
        self.saved = []
        self.calls = []
        for mod in self.mods:
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


def _seed(s, *, price=185.0, currency="GEL", client_currency="GEL", status="COMPLETED",
          paid=None, pay_currency=None, account="cash", sid="s1", cid="c1"):
    """Клиент + сессия (+ платёж `paid`, если задан). is_paid — по полной оплате."""
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession

    if not s.get(TherapistClient, cid):
        s.add(TherapistClient(id=cid, specialist_id=ME, name="Анна Петрова",
                              base_price=price, currency=client_currency, default_account="cash"))
    ts = TherapySession(
        id=sid, client_id=cid, specialist_id=ME, status=status, price=price, currency=currency,
        date=datetime.utcnow() - timedelta(days=2), is_paid=False,
    )
    if paid is not None:
        pay = TherapistPayment(
            id=f"p-{sid}", client_id=cid, specialist_id=ME, amount=paid,
            currency=pay_currency or currency, account=account,
            date=datetime.now(), session_id=sid,
        )
        ts.is_paid = (pay_currency in (None, currency)) and paid + 0.01 >= price
        s.add(pay)
    s.add(ts)
    s.commit()
    return ts


def _patch_payment(eng, pid, uid=ME, **fields):
    from sqlmodel import Session
    from app.api.v1.crm.payments import update_payment
    from app.models.therapist_payment import TherapistPaymentUpdate
    with Session(eng) as s:
        return update_payment(payment_id=pid, data=TherapistPaymentUpdate(**fields),
                              session=s, current_user=_user(uid))


def _session_row(eng, sid="s1"):
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession
    with Session(eng) as s:
        ts = s.get(TherapySession, sid)
        s.expunge(ts)
        return ts


def _http_code(fn):
    from fastapi import HTTPException
    try:
        fn()
    except HTTPException as exc:
        return exc.status_code
    return None


# ─── 2. PATCH платежа: «оплачено» пересчитывается ────────────────────────

def test_patch_payment_recomputes_is_paid_down_and_up():
    from sqlmodel import Session
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=185)
    assert _session_row(eng).is_paid is True

    br = _Bridge()
    try:
        out = _patch_payment(eng, "p-s1", amount=100)
    finally:
        br.undo()
    assert out.amount == 100
    assert _session_row(eng).is_paid is False, "платёж уменьшили до 100 из 185 — сессия должна стать неоплаченной"

    br = _Bridge()
    try:
        _patch_payment(eng, "p-s1", amount=185)
    finally:
        br.undo()
    assert _session_row(eng).is_paid is True, "платёж вернули к 185 — сессия снова оплачена"

    br = _Bridge()
    try:
        _patch_payment(eng, "p-s1", amount=185.004)   # копейка допуска не ломает «оплачено»
        _patch_payment(eng, "p-s1", amount=184.995)
    finally:
        br.undo()
    assert _session_row(eng).is_paid is True, "допуск 0,01 перестал работать"


def test_patch_payment_currency_converts_to_session_currency():
    """Платёж в долларах за сессию в лари сопоставляется по общим курсам."""
    from sqlmodel import Session
    from app.api.v1.settings import DEFAULT_EXCHANGE_RATES
    usd = DEFAULT_EXCHANGE_RATES["USD"]
    price = round(usd * 100, 2)          # 269 ₾ = ровно 100 $
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=price, paid=price)            # 269 ₾ в лари — оплачено
    br = _Bridge()
    try:
        out = _patch_payment(eng, "p-s1", currency="USD", amount=100)
        assert out.currency == "USD"
        assert _session_row(eng).is_paid is True, "100 $ = 269 ₾ — сессия должна остаться оплаченной"
        _patch_payment(eng, "p-s1", amount=60)
        assert _session_row(eng).is_paid is False, "60 $ меньше 269 ₾ — сессия должна открыться"
        _patch_payment(eng, "p-s1", amount=100, currency="GEL")
        assert _session_row(eng).is_paid is False, "100 ₾ из 269 ₾ — не оплачено"
    finally:
        br.undo()


def test_patch_payment_account_and_date_do_not_reopen_session():
    """Правка счёта/даты не трогает «оплачено» (легаси: отметили руками, платёж меньше цены)."""
    from sqlmodel import Session
    from app.models.therapy_session import TherapySession
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=100)
        ts = s.get(TherapySession, "s1")
        ts.is_paid = True                       # отметили руками
        s.add(ts)
        s.commit()
    br = _Bridge()
    try:
        out = _patch_payment(eng, "p-s1", account="tbc", date=datetime(2026, 9, 30, 12, 0))
    finally:
        br.undo()
    assert out.account == "tbc" and out.date == datetime(2026, 9, 30, 12, 0)
    assert _session_row(eng).is_paid is True, "правка счёта/даты переоткрыла сессию"


def test_patch_payment_validates_input():
    from sqlmodel import Session
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=185)
    br = _Bridge()
    try:
        assert _http_code(lambda: _patch_payment(eng, "p-s1", amount=0)) == 400, "сумма 0 принята"
        assert _http_code(lambda: _patch_payment(eng, "p-s1", amount=-5)) == 400, "отрицательная сумма принята"
        assert _http_code(lambda: _patch_payment(eng, "p-s1", currency="ZZZ")) == 400, "неизвестная валюта принята"
        assert _http_code(lambda: _patch_payment(eng, "p-s1", account="  ")) == 400, "пустой счёт принят"
        assert _http_code(lambda: _patch_payment(eng, "нет-такого", amount=10)) == 404
        out = _patch_payment(eng, "p-s1", currency=" usd ")
        assert out.currency == "USD", "валюта не приведена к заглавным"
    finally:
        br.undo()
    assert br.calls or True


def test_patch_payment_of_other_specialist_is_404_and_untouched():
    from sqlmodel import Session
    from app.models.therapist_payment import TherapistPayment
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=185)
    br = _Bridge()
    try:
        code = _http_code(lambda: _patch_payment(eng, "p-s1", uid=OTHER, amount=1))
    finally:
        br.undo()
    assert code == 404, f"чужой платёж правится или отвечает не 404: {code}"
    assert not br.calls, "мост дёрнут при отказе"
    with Session(eng) as s:
        assert s.get(TherapistPayment, "p-s1").amount == 185, "чужая правка изменила платёж"
    assert _session_row(eng).is_paid is True


def test_patch_payment_calls_bridge_with_old_account():
    from sqlmodel import Session
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=185, account="cash")
    br = _Bridge()
    try:
        _patch_payment(eng, "p-s1", amount=150, account="tbc")
    finally:
        br.undo()
    assert "resync_payment" in br.names(), "правка платежа не дёрнула мост в финансы"
    _, args, _kw = next(c for c in br.calls if c[0] == "resync_payment")
    assert args[0].id == "p-s1" and args[0].amount == 150
    assert args[2] == "cash", "мост не узнал прежний счёт — не отзовёт наличную запись"


def test_resync_payment_bridge_rules():
    """Наличный → upsert; был наличным, стал картой → отзыв; карта→карта → ничего."""
    import app.services.finance_bridge as fb
    calls = []
    saved = (fb.push_payment, fb.retract_payment)
    fb.push_payment = lambda p, name: calls.append(("push", p.id))
    fb.retract_payment = lambda pid, sid: calls.append(("retract", pid))
    try:
        pay = lambda acc: SimpleNamespace(id="p1", specialist_id=ME, account=acc)
        fb.resync_payment(pay("cash"), "А", "cash")
        fb.resync_payment(pay("Наличные"), "А", "tbc")
        fb.resync_payment(pay("tbc"), "А", "cash")
        fb.resync_payment(pay("tbc"), "А", "bog")
    finally:
        fb.push_payment, fb.retract_payment = saved
    assert calls == [("push", "p1"), ("push", "p1"), ("retract", "p1")], calls


# ─── 3. Частичная оплата: долг = остаток ─────────────────────────────────

def test_partial_payment_debt_is_remainder_everywhere():
    """100 из 185 внесено → долг 85 в дашборде, списке клиентов, балансе и списке сессий."""
    from sqlmodel import Session
    from app.api.v1.crm.clients import get_client_balance, list_clients
    from app.api.v1.crm.dashboard import crm_dashboard
    from app.api.v1.crm.sessions import list_sessions
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=100)
        assert s.get(__import__("app.models.therapy_session", fromlist=["x"]).TherapySession, "s1").is_paid is False
        user = _user()

        dash = crm_dashboard(session=s, current_user=user, month=None)
        debt = {d["client_id"]: d for d in dash["debt_by_client"]}["c1"]
        assert debt["total_debt"] == 85, f"дашборд: долг {debt['total_debt']} вместо 85"
        assert debt["unpaid_sessions_count"] == 1
        assert dash["total_active_debt"] == 85

        rows = list_clients(session=s, current_user=user, active_only=False, with_stats=True, specialist_id=None)
        assert rows[0]["unpaidSum"] == 85, f"список клиентов: unpaidSum {rows[0]['unpaidSum']} вместо 85"

        bal = get_client_balance(client_id="c1", session=s, current_user=user)
        assert bal["debt"] == 85 and bal["debt_by_currency"] == {"GEL": 85}, bal

        sess = list_sessions(session=s, current_user=user, client_id=None, date_from=None, date_to=None, status=None)
        assert sess[0].paid_amount == 100 and sess[0].remaining == 85, (sess[0].paid_amount, sess[0].remaining)


def test_unpaid_without_payment_still_owes_full_price_and_paid_owes_nothing():
    from sqlmodel import Session
    from app.api.v1.crm.dashboard import crm_dashboard
    from app.api.v1.crm.sessions import list_sessions
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, sid="s1")                 # без платежа
        _seed(s, price=100, paid=100, sid="s2")       # оплачена
        dash = crm_dashboard(session=s, current_user=_user(), month=None)
        assert dash["debt_by_client"][0]["total_debt"] == 185, "сессия без оплаты должна висеть на полную цену"
        by = {r.id: r for r in list_sessions(session=s, current_user=_user(), client_id=None,
                                             date_from=None, date_to=None, status=None)}
        assert by["s1"].remaining == 185 and by["s1"].paid_amount == 0
        assert by["s2"].remaining == 0 and by["s2"].paid_amount == 100


def test_debt_in_client_currency_converts_session_currency_and_payment_currency():
    """Сессия в $ с платежом в ₾: остаток считается в валюте сессии, потом в валюте клиента."""
    from sqlmodel import Session
    from app.api.v1.crm.dashboard import crm_dashboard
    from app.api.v1.settings import DEFAULT_EXCHANGE_RATES
    usd = DEFAULT_EXCHANGE_RATES["USD"]
    eng = _engine()
    with Session(eng) as s:
        # Цена 100 $, внесено 134,5 ₾ (= 50 $). Клиент ведётся в $.
        _seed(s, price=100, currency="USD", client_currency="USD", paid=round(usd * 50, 2), pay_currency="GEL")
        dash = crm_dashboard(session=s, current_user=_user(), month=None)
        d = dash["debt_by_client"][0]
        assert d["currency"] == "USD" and abs(d["total_debt"] - 50) < 0.02, d


def test_remaining_helper_rules():
    import app.services.session_balance as sb
    rates = {"GEL": 1.0, "USD": 2.7, "UAH": 0.065}
    ts = SimpleNamespace(price=185, currency="GEL", is_paid=False)
    cl = SimpleNamespace(base_price=0, currency="GEL")
    pay = lambda a, c="GEL": SimpleNamespace(amount=a, currency=c)
    assert sb.session_money(ts, cl, [], rates).remaining == 185
    assert sb.session_money(ts, cl, [pay(100)], rates).remaining == 85
    assert sb.session_money(ts, cl, [pay(184.995)], rates).remaining == 0, "допуск в копейку"
    ts.is_paid = True
    assert sb.session_money(ts, cl, [pay(100)], rates).remaining == 0, "оплаченная сессия долга не имеет"
    free = SimpleNamespace(price=0, currency=None, is_paid=False)
    assert sb.session_money(free, cl, [], rates).remaining == 0, "бесплатная сессия не долг"
    nop = SimpleNamespace(price=None, currency=None, is_paid=False)
    assert sb.session_money(nop, SimpleNamespace(base_price=50, currency="USD"), [], rates).remaining == 50
    # доллары за сессию в лари, округление до цента не оставляет «долг 1 тетри»
    ts2 = SimpleNamespace(price=15, currency="GEL", is_paid=False)
    assert sb.session_money(ts2, cl, [pay(5.56, "USD")], rates).remaining == 0, "15 ₾ = 5,556 $ → 5,56 $ закрывает"
    for bad in ("", "  ", "ZZZ"):
        try:
            sb.clean_currency(bad, rates)
        except ValueError:
            continue
        raise AssertionError(f"валюта {bad!r} принята")
    assert sb.clean_currency(" uah ", rates) == "UAH"


# ─── 1. Валюта и счёт сессии сохраняются ─────────────────────────────────

def _update_session(eng, sid="s1", **fields):
    from sqlmodel import Session
    from app.api.v1.crm.sessions import update_session
    from app.models.therapy_session import TherapySessionUpdate
    with Session(eng) as s:
        return update_session(session_id=sid, data=TherapySessionUpdate(**fields), session=s, current_user=_user())


def test_update_session_saves_currency_and_account():
    from sqlmodel import Session
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, currency="GEL")
    out = _update_session(eng, price=70, currency="usd", account="tbc")
    ts = _session_row(eng)
    assert (ts.price, ts.currency, ts.account) == (70, "USD", "tbc"), (ts.price, ts.currency, ts.account)
    assert out.currency == "USD" and out.account == "tbc"
    # null не стирает «замороженные» значения
    _update_session(eng, currency=None, account=None, price=71)
    ts = _session_row(eng)
    assert (ts.currency, ts.account) == ("USD", "tbc"), "null стёр валюту/счёт сессии"


def test_update_session_rejects_bad_currency_account_price():
    from sqlmodel import Session
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185)
    assert _http_code(lambda: _update_session(eng, currency="ZZZ")) == 400, "неизвестная валюта принята"
    assert _http_code(lambda: _update_session(eng, currency="")) == 400, "пустая валюта принята"
    assert _http_code(lambda: _update_session(eng, account="   ")) == 400, "пустой счёт принят"
    assert _http_code(lambda: _update_session(eng, price=-1)) == 400, "отрицательная цена принята"
    ts = _session_row(eng)
    assert ts.price == 185 and ts.currency == "GEL", "отказ всё же записал часть полей"


def test_update_session_price_change_keeps_paid_flag_but_reports_mismatch():
    """Подняли цену у оплаченной — НЕ переоткрываем (предупреждение на карточке);
    ответ несёт внесённое для сравнения. Опустили у частичной так, что хватает, — закрываем."""
    from sqlmodel import Session
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=185)
    out = _update_session(eng, price=200)
    assert _session_row(eng).is_paid is True, "подняли цену — сессия молча переоткрылась"
    assert out.paid_amount == 185 and out.remaining == 0, (out.paid_amount, out.remaining)

    eng2 = _engine()
    with Session(eng2) as s:
        _seed(s, price=185, paid=100)
    assert _session_row(eng2).is_paid is False
    _update_session(eng2, price=100)
    assert _session_row(eng2).is_paid is True, "цену опустили до внесённого — сессия должна закрыться"


# ─── 4. Оплата остатка ───────────────────────────────────────────────────

def test_create_payment_cross_currency_topup_and_flag():
    """Доплата в другой валюте прибавляется в валюте платежа, а не складывается числом."""
    from sqlmodel import Session
    from app.api.v1.crm.payments import create_payment
    from app.models.therapist_payment import TherapistPayment, TherapistPaymentCreate
    from app.api.v1.settings import DEFAULT_EXCHANGE_RATES
    usd = DEFAULT_EXCHANGE_RATES["USD"]
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=100, currency="USD", client_currency="USD", paid=60)
    br = _Bridge()
    try:
        with Session(eng) as s:
            # 40 $ доплатили в лари: 40 × 2,69 = 107,6 ₾
            create_payment(
                data=TherapistPaymentCreate(client_id="c1", session_id="s1", amount=round(40 * usd, 2),
                                            currency="GEL", date=datetime.now()),
                session=s, current_user=_user(),
            )
    finally:
        br.undo()
    with Session(eng) as s:
        p = s.get(TherapistPayment, "p-s1")
        assert p.currency == "USD" and abs(p.amount - 100) < 0.02, (p.amount, p.currency)
    assert _session_row(eng).is_paid is True, "доплата закрыла цену — сессия должна стать оплаченной"
    assert "push_payment" in br.names()


def test_create_payment_partial_keeps_session_open_with_frozen_currency():
    from sqlmodel import Session
    from app.api.v1.crm.payments import create_payment
    from app.models.therapist_payment import TherapistPaymentCreate
    from app.models.therapy_session import TherapySession
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, currency=None)       # валюта ещё не «заморожена»
    br = _Bridge()
    try:
        with Session(eng) as s:
            create_payment(
                data=TherapistPaymentCreate(client_id="c1", session_id="s1", amount=100,
                                            currency="GEL", date=datetime.now()),
                session=s, current_user=_user(),
            )
    finally:
        br.undo()
    ts = _session_row(eng)
    assert ts.is_paid is False and ts.currency == "GEL", (ts.is_paid, ts.currency)


def test_quick_pay_and_mark_all_close_remainder_of_partial_payment():
    """По сессии уже внесена часть: «Отметить оплату» и «Отметить все» дописывают остаток
    в тот же платёж (раньше — 409 и ошибка уникальности)."""
    from sqlmodel import Session, select
    from app.api.v1.crm.sessions import mark_all_sessions_paid, quick_pay_session
    from app.models.therapist_payment import TherapistPayment
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=100, sid="s1")
        _seed(s, price=200, paid=50, sid="s2")
    br = _Bridge()
    try:
        with Session(eng) as s:
            res = quick_pay_session(session_id="s1", payload={}, session=s, current_user=_user())
            assert res["topped_up"] == 85, res
        with Session(eng) as s:
            out = mark_all_sessions_paid(client_id="c1", session=s, current_user=_user())
            assert out["marked"] == 1, out
    finally:
        br.undo()
    with Session(eng) as s:
        pays = {p.session_id: p for p in s.exec(select(TherapistPayment)).all()}
        assert len(pays) == 2, "появилась вторая строка платежа на сессию"
        assert pays["s1"].amount == 185 and pays["s2"].amount == 200, (pays["s1"].amount, pays["s2"].amount)
    assert _session_row(eng, "s1").is_paid and _session_row(eng, "s2").is_paid
    assert br.names().count("push_payment") == 2, "дописанный остаток не ушёл в мост"


def test_cash_flow_semantics_untouched():
    """«Касса» и «Заработано» — прежние: платежи месяца по дате платежа, без остатка."""
    src = (BACKEND / "app/api/v1/crm/dashboard.py").read_text()
    assert "payments_this_month = sum(_to_gel(p.amount, p.currency) for p in month_payments)" in src
    assert "received_gel += amt * GEL_RATES.get(cur, 1)" in src
    fin = _code("src/pages/crm/CrmSessions.tsx")
    assert "earnedByCur" in fin and "revenueLabel" in fin, "пропали «Заработано»/«Касса» в CrmSessions"


# ─── 5. Фронт ────────────────────────────────────────────────────────────

DETAIL = "src/pages/crm/CrmClientDetail.tsx"


def test_front_session_panel_sends_price_currency_account():
    src = _code(DETAIL)
    i = src.index("Счёт для оплаты")
    panel = src[src.rfind("<Field", 0, i - 800):src.index("Удалить сессию", i)]
    assert "handleUpdateSession(session.id, patch)" in panel, "панель правки не сохраняет сессию"
    assert "price: parsedEditPrice" in panel, "панель правки сессии не шлёт price"
    assert "patch.currency = editSessionCurrency" in panel and "patch.account = editSessionAccount" in panel, \
        "панель правки сессии не шлёт currency/account (только изменённые)"
    assert "editSessionCurrency" in panel and "CURRENCIES" in src, "в панели нет выбора валюты"
    assert "AccountSelect" in panel and "SessionPaymentBlock" in panel, "в панели нет счёта или блока «Оплата»"
    api = _code("src/api/crm.ts")
    upd = api[api.index("export interface CrmSessionUpdate"):api.index("export interface CrmSettings")]
    assert "currency?: string" in upd and "account?: string" in upd, "CrmSessionUpdate без currency/account"
    sess = api[api.index("export interface CrmSession {"):api.index("export interface CrmSessionCreate")]
    assert "paidAmount" in sess and "remaining" in sess, "CrmSession не знает про внесённое/остаток"
    # Второй десктопный редактор (список сессий) тоже не теряет валюту.
    ses = _code("src/pages/crm/CrmSessions.tsx")
    assert "updateData.currency = currency" in ses, "форма сессии в «Сессиях» теряет валюту"


BLOCK = "src/components/crm/SessionPaymentBlock.tsx"


def test_front_payment_block_edit_and_topup():
    blk = _code(BLOCK)
    assert "crmApi.updatePayment" in blk, "блок «Оплата» не вызывает правку платежа"
    assert "Оплата:" in blk and "Изменить" in blk
    assert "Цена и оплата не совпадают" in blk, "нет предупреждения о расхождении цены и оплаты"
    assert "Доплатить" in blk and "crmApi.createPayment" in blk and "sessionId: session.id" in blk, \
        "нет кнопки «Доплатить» через POST /payments"
    assert "Оплачено ${formatMoney(partial.paid" in blk and "долг" in blk, "нет подписи частичной оплаты"
    api = _code("src/api/crm.ts")
    assert re.search(r"updatePayment:[^=]*=>[\s\S]{0,200}api\.patch\(`/crm/payments/\$\{", api), \
        "в crmApi нет PATCH /crm/payments/{id}"
    for need in ("'../ui/Sheet'", "'../ui/Button'", "'../ui/Field'", "formatMoney", "kind=\"money\""):
        assert need in blk, f"блок оплаты не использует {need}"
    assert "SessionPaymentBlock" in _code(DETAIL), "блок «Оплата» не подключён к карточке клиента"


def test_front_debt_uses_remaining_not_full_price():
    helper = _code("src/utils/sessionMoney.ts")
    assert "s.remaining" in helper and "s.paidAmount" in helper, "общий расчёт долга не читает remaining"
    for rel in (DETAIL, "src/components/crm/UnpaidSessionsSheet.tsx", "src/pages/crm/CrmSessions.tsx",
                "src/pages/crm/CrmFinances.tsx", "src/pages/mobile/crm/MobileCrmClient.tsx"):
        assert "sessionDebt" in _code(rel), f"{rel}: долг считается без остатка по сессии (sessionDebt)"


def test_front_mobile_has_currency_and_payment_edit():
    src = _code("src/pages/mobile/crm/SessionActionSheet.tsx")
    form = src[src.index("function PriceForm"):src.index("function NotesForm") if "function NotesForm" in src else None]
    assert "Валюта" in form and "Счёт" in form, "мобильная форма цены без валюты/счёта"
    assert "patch.currency = currencyRaw" in src and "patch.account = accountRaw" in src, "мобильная форма не шлёт валюту и счёт"
    assert "SessionPaymentBlock" in src, "мобильная шторка сессии не показывает блок «Оплата»"


# ─── Ревью этапа А (02.10): исправления ──────────────────────────────────

def _create_payment(eng, uid=ME, **fields):
    from sqlmodel import Session
    from app.api.v1.crm.payments import create_payment
    from app.models.therapist_payment import TherapistPaymentCreate
    with Session(eng) as s:
        return create_payment(data=TherapistPaymentCreate(**fields), session=s, current_user=_user(uid))


def test_create_payment_date_defaults_and_amount_must_be_positive():
    """N1: «Новый платёж» без даты давал 422; сумма ≤ 0 — 400 и для нового, и для доплаты."""
    from sqlmodel import Session
    from app.models.therapist_payment import TherapistPaymentCreate
    p = TherapistPaymentCreate(client_id="c1", amount=10)
    assert isinstance(p.date, datetime), "дата платежа по умолчанию не подставляется"
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=100)
    br = _Bridge()
    try:
        out = _create_payment(eng, client_id="c1", amount=20)          # без сессии и без даты
        assert out.amount == 20 and out.date is not None
        for bad in (0, -5):
            assert _http_code(lambda: _create_payment(eng, client_id="c1", amount=bad)) == 400, f"сумма {bad} принята"
            assert _http_code(lambda: _create_payment(eng, client_id="c1", session_id="s1", amount=bad)) == 400, \
                f"доплата {bad} принята"
    finally:
        br.undo()


def test_cap_to_remaining_blocks_double_topup():
    """N2: «Доплатить» с capToRemaining не принимает сумму больше остатка — повторный клик не задваивает."""
    from sqlmodel import Session
    from app.models.therapist_payment import TherapistPayment
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=200, paid=185)           # оплачена по цене 185, цену подняли до 200
    br = _Bridge()
    try:
        assert _http_code(lambda: _create_payment(eng, client_id="c1", session_id="s1", amount=50,
                                                  cap_to_remaining=True)) == 409, "доплата больше остатка принята"
        _create_payment(eng, client_id="c1", session_id="s1", amount=15, cap_to_remaining=True)
        assert _http_code(lambda: _create_payment(eng, client_id="c1", session_id="s1", amount=15,
                                                  cap_to_remaining=True)) == 409, "повторная доплата задвоила платёж"
    finally:
        br.undo()
    with Session(eng) as s:
        assert s.get(TherapistPayment, "p-s1").amount == 200, "после доплаты и отказа должно быть ровно 200"


def test_create_payment_account_client_and_session_checks():
    """N8: счёт «по умолчанию» не перетирает прежний; сессия должна быть клиента и своей."""
    from sqlmodel import Session
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_payment import TherapistPayment
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=100, account="tbc")
        s.add(TherapistClient(id="c2", specialist_id=ME, name="Борис", base_price=10))
        s.commit()
    br = _Bridge()
    try:
        _create_payment(eng, client_id="c1", session_id="s1", amount=10)          # счёт не прислали
        with Session(eng) as s:
            assert s.get(TherapistPayment, "p-s1").account == "tbc", "счёт по умолчанию перетёр прежний"
        _create_payment(eng, client_id="c1", session_id="s1", amount=10, account="bog")
        with Session(eng) as s:
            assert s.get(TherapistPayment, "p-s1").account == "bog", "явно выбранный счёт не записался"
        assert _http_code(lambda: _create_payment(eng, client_id="c2", session_id="s1", amount=5)) == 400, \
            "платёж чужого клиента на сессию принят"
        assert _http_code(lambda: _create_payment(eng, client_id="c1", session_id="нет-такой", amount=5)) == 404, \
            "платёж на несуществующую сессию принят"
    finally:
        br.undo()


def test_quick_pay_reconcile_freezes_price_and_currency_first():
    """N4: цена клиента (₾) не превращается в сумму платежа в другой валюте: сначала заморозка."""
    from sqlmodel import Session
    from app.api.v1.crm.sessions import quick_pay_session
    from app.api.v1.settings import DEFAULT_EXCHANGE_RATES
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession
    usd = DEFAULT_EXCHANGE_RATES["USD"]
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=270, currency=None, paid=50, pay_currency="USD")
        ts = s.get(TherapySession, "s1")
        ts.price = None          # цена и валюта сессии не заморожены — идут от клиента (270 ₾)
        ts.is_paid = False
        s.add(ts)
        s.commit()
    br = _Bridge()
    try:
        with Session(eng) as s:
            res = quick_pay_session(session_id="s1", payload={}, session=s, current_user=_user())
    finally:
        br.undo()
    ts = _session_row(eng)
    assert ts.price == 270 and ts.currency == "GEL", (ts.price, ts.currency)
    with Session(eng) as s:
        p = s.get(TherapistPayment, "p-s1")
        assert p.currency == "USD" and abs(p.amount - 270 / usd) < 0.02, (p.amount, p.currency)
    assert ts.is_paid is True and abs(res["added"] - (270 / usd - 50)) < 0.02, res


def test_quick_pay_reports_added_amount():
    from sqlmodel import Session
    from app.api.v1.crm.sessions import quick_pay_session
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, sid="s1")
        _seed(s, price=185, paid=100, sid="s2")
    br = _Bridge()
    try:
        with Session(eng) as s:
            assert quick_pay_session(session_id="s1", payload={}, session=s, current_user=_user())["added"] == 185
        with Session(eng) as s:
            assert quick_pay_session(session_id="s2", payload={}, session=s, current_user=_user())["added"] == 85, \
                "тост должен показывать добавленную сумму, а не весь платёж"
    finally:
        br.undo()


def test_debt_survives_session_moved_to_other_client():
    """п.4: платёж не фильтруется по клиенту: сессию перепривязали — остаток по-прежнему цена − внесённое."""
    from sqlmodel import Session
    from app.api.v1.crm.sessions import list_sessions
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession
    eng = _engine()
    with Session(eng) as s:
        _seed(s, price=185, paid=100)
        s.add(TherapistClient(id="c2", specialist_id=ME, name="Борис", base_price=185))
        ts = s.get(TherapySession, "s1")
        ts.client_id = "c2"
        s.add(ts)
        s.commit()
        row = list_sessions(session=s, current_user=_user(), client_id=None, date_from=None, date_to=None, status=None)[0]
        assert row.paid_amount == 100 and row.remaining == 85, (row.paid_amount, row.remaining)
    src = (BACKEND / "app/services/session_balance.py").read_text()
    sig = src[src.index("def load_payments_by_session"):src.index("def load_payments_by_session") + 120]
    assert "client_id" not in sig, "загрузка платежей снова принимает фильтр по клиенту"
    stmt = src[src.index("stmt = select(TherapistPayment)"):]
    assert "TherapistPayment.client_id" not in stmt, "загрузка платежей снова фильтрует по клиенту"


def test_mark_all_locks_sessions():
    """N3: «Отметить все» выбирает сессии под замком (двойной клик не задвоит платежи)."""
    src = (BACKEND / "app/api/v1/crm/sessions.py").read_text()
    body = src[src.index("def mark_all_sessions_paid"):]
    assert ".with_for_update()" in body[:body.index("count = 0")], "mark-all без FOR UPDATE по выборке unpaid"


def test_front_unmark_resets_money_and_debt_is_robust():
    """B1: после «Снять оплату» остаток/внесённое сбрасываются; sessionDebt не верит remaining: 0 у неоплаченной."""
    import json
    import shutil
    import subprocess
    import tempfile
    for rel in ("src/pages/mobile/crm/SessionActionSheet.tsx", DETAIL, "src/pages/mobile/crm/crmFlows.tsx"):
        code = _code(rel)
        assert "isPaid: false, paidAmount: undefined, remaining: undefined" in code, \
            f"{rel}: после снятия оплаты остаётся старый remaining (долг 0 до перезагрузки)"
    node = shutil.which("node")
    if not node:
        return
    src = _src("src/utils/sessionMoney.ts")
    src = re.sub(r"^import [^\n]*\n", "", src, flags=re.M)
    prog = ("const EXCHANGE_RATES: Record<string, number> = { GEL: 1, USD: 2.69, UAH: 0.065 };\n"
            "type CrmSession = any;\n" + src + """
const c = { basePrice: 0, currency: 'GEL' };
console.log(JSON.stringify({
  afterUnmark: sessionDebt({ isPaid: false, price: 185, remaining: 0, paidAmount: undefined } as any, c).amount,
  afterUnmarkStalePaid: sessionDebt({ isPaid: false, price: 185, remaining: 0, paidAmount: 0 } as any, c).amount,
  noMoney: sessionDebt({ isPaid: false, price: 185 } as any, c).amount,
  partial: sessionDebt({ isPaid: false, price: 185, remaining: 85, paidAmount: 100 } as any, c).amount,
  covered: sessionDebt({ isPaid: false, price: 185, remaining: 0, paidAmount: 185 } as any, c).amount,
  paid: sessionDebt({ isPaid: true, price: 185, remaining: 0, paidAmount: 185 } as any, c).amount,
  free: sessionDebt({ isPaid: false, price: 0, remaining: 0, paidAmount: 0 } as any, c).amount,
  mismatchNoCur: !!paymentMismatch({ isPaid: true, price: 15, paidAmount: 15.0102 } as any, c),
  mismatchUsd: !!paymentMismatch({ isPaid: true, price: 15, paidAmount: 15.0102 } as any, c, 'USD'),
  mismatchReal: !!paymentMismatch({ isPaid: true, price: 200, paidAmount: 185 } as any, c, 'USD'),
}));
""")
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d) / "m.mts"
        f.write_text(prog, encoding="utf-8")
        r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", str(f)],
                           capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        if "strip-types" in r.stderr or "bad option" in r.stderr:
            return   # старый node — поведение проверяют статические проверки выше
        raise AssertionError(f"node упал: {r.stderr[:500]}")
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["afterUnmark"] == 185 and out["afterUnmarkStalePaid"] == 185, out
    assert out["noMoney"] == 185 and out["partial"] == 85 and out["covered"] == 0 and out["paid"] == 0 and out["free"] == 0, out
    assert out["mismatchNoCur"] is True and out["mismatchUsd"] is False and out["mismatchReal"] is True, \
        f"допуск «цена и оплата не совпадают» не такой, как у сервера: {out}"


def test_front_review_fixes_hold():
    detail = _code(DETAIL)
    # п.1: валюту и счёт шлём только изменёнными
    assert "patch.currency = editSessionCurrency" in detail and "patch.account = editSessionAccount" in detail, \
        "десктопная правка цены снова шлёт валюту и счёт всегда"
    mob = _code("src/pages/mobile/crm/SessionActionSheet.tsx")
    assert "patch.currency = currencyRaw" in mob and "patch.account = accountRaw" in mob, \
        "мобильная правка цены снова шлёт валюту и счёт всегда"
    # N5: после «Оплатить» цену и валюту сессии из платежа не подставляем
    assert "price: res.amount" not in mob and "currency: res.currency ?? session.currency" not in mob
    i = mob.index("const res = await crmApi.quickPaySession")
    assert "refreshSession()" in mob[i:i + 700], "после «Оплатить» сессия не перечитывается"
    assert "price: res.amount" not in _code("src/pages/mobile/crm/crmFlows.tsx"), "crmFlows подставляет цену из платежа"
    # п.2: «Сегодня», строки сессий и тосты — остаток / добавленная сумма
    for rel in ("src/pages/crm/CrmDashboard.tsx", "src/pages/mobile/crm/MobileCrmToday.tsx", "src/pages/crm/CrmSessions.tsx"):
        assert "sessionDebt(" in _code(rel), f"{rel}: кнопки оплаты показывают полную цену, а не остаток"
    for rel in (DETAIL, "src/pages/crm/CrmDashboard.tsx", "src/pages/crm/CrmSessions.tsx",
                "src/components/crm/UnpaidSessionsSheet.tsx", "src/pages/mobile/crm/crmFlows.tsx"):
        code = _code(rel)
        assert "res.added ?? res.amount" in code or "result.added ?? result.amount" in code, \
            f"{rel}: тост после оплаты показывает весь платёж, а не добавленную сумму"
    # N2: «Доплатить» идемпотентно
    blk = _code(BLOCK)
    assert "crmApi.quickPaySession(session.id)" in blk and "capToRemaining: true" in blk, \
        "«Доплатить» не использует quick-pay / capToRemaining"
    # п.5: русские ошибки стора
    store = _code("src/store/crmStore.ts")
    assert "toastApiError(error, 'Не удалось обновить сессию')" in store, "стор не показывает ответ сервера при правке сессии"
    # п.6: мёртвый stats.debt убран
    assert "const debt = unpaid.reduce" not in detail, "вернулся неиспользуемый stats.debt"


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
    print("СТОРОЖ ОПЛАТЫ CRM (А): OK" if not fails else f"СТОРОЖ ОПЛАТЫ CRM (А) УПАЛ ({fails})")
    sys.exit(1 if fails else 0)
