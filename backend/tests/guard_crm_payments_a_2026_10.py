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
    i = src.index("Правка цены и статуса")
    panel = src[i:src.index("Удалить сессию", i)]
    call = re.search(r"handleUpdateSession\(session\.id, \{[^}]*price[^}]*\}\)", panel, re.S)
    assert call, "панель правки не шлёт цену"
    assert "currency:" in call.group(0) and "account:" in call.group(0), \
        "панель правки сессии снова шлёт не всё: нужны price, currency и account"
    assert "editSessionCurrency" in panel and "CURRENCIES" in src, "в панели нет выбора валюты"
    assert "AccountSelect" in panel
    api = _code("src/api/crm.ts")
    upd = api[api.index("export interface CrmSessionUpdate"):api.index("export interface CrmSettings")]
    assert "currency?: string" in upd and "account?: string" in upd, "CrmSessionUpdate без currency/account"
    sess = api[api.index("export interface CrmSession {"):api.index("export interface CrmSessionCreate")]
    assert "paidAmount" in sess and "remaining" in sess, "CrmSession не знает про внесённое/остаток"


def test_front_payment_block_edit_and_topup():
    src = _code(DETAIL)
    assert "updatePayment" in src, "блок «Оплата» не вызывает правку платежа"
    assert "Оплата:" in src and "Изменить" in src
    assert "Цена и оплата не совпадают" in src, "нет предупреждения о расхождении цены и оплаты"
    assert "Доплатить" in src and "createPayment" in src, "нет кнопки «Доплатить»"
    assert "Оплачено ${" in _src(DETAIL) or "Оплачено " in src, "нет подписи частичной оплаты"
    assert "долг " in src
    api = _code("src/api/crm.ts")
    assert re.search(r"updatePayment:[^=]*=>[\s\S]{0,200}api\.patch\(`/crm/payments/\$\{", api), \
        "в crmApi нет PATCH /crm/payments/{id}"
    # Общие компоненты и форматтер, не самописные
    for need in ("from '../../components/ui/Sheet'", "from '../../components/ui/Button'",
                 "from '../../components/ui/Field'", "formatMoney"):
        assert need in src, f"блок оплаты не использует {need}"


def test_front_debt_uses_remaining_not_full_price():
    for rel in (DETAIL, "src/components/crm/UnpaidSessionsSheet.tsx", "src/pages/crm/CrmSessions.tsx",
                "src/pages/crm/CrmFinances.tsx", "src/pages/mobile/crm/MobileCrmClient.tsx"):
        assert "remaining" in _code(rel), f"{rel}: долг считается без остатка по сессии (remaining)"


def test_front_mobile_has_currency_and_payment_edit():
    src = _code("src/pages/mobile/crm/SessionActionSheet.tsx")
    assert "currency" in src[src.index("function PriceForm"):], "мобильная форма цены без валюты"
    assert "updatePayment" in src, "мобильная шторка сессии не правит платёж"
    assert "Цена и оплата не совпадают" in src


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
