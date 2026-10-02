"""СТОРОЖ: «Заработано» считается в валюте СЕССИИ, а не клиента (01.10, ревизор денег).

Находка: 41 завершённая оплаченная сессия (6765 ₾, session.currency = GEL) у клиентов,
чья валюта по умолчанию USDT. «Заработано» брало валюту клиента — 6765 «USDT» в
пересчёте на лари раздувались ≈ ×2,7 (курс USDT 2,69). Обратный случай: пять сессий по
75 USDT у клиента с валютой UAH считались как 75 грн (≈ 5 ₾) вместо ≈ 202 ₾.

Что держит этот сторож:
  Сервер (services/session_balance.py, api/v1/crm/dashboard.py, clients.py):
    1  price_in: цена сессии в валюте самой сессии (нет — валюта клиента, цены нет — ставка
       клиента) и пересчёт по общим курсам.
    2  Дашборд, monthly_stats: «ожидалось» по валюте сессии (в лари и по валютам);
       «получено» / revenue_this_month / revenue_by_currency («Касса») НЕ изменились.
    3  Дашборд, upcoming_sessions: валюта строки = валюта сессии.
    4  Список клиентов, totalCost: в валюте клиента из цен в валютах сессий.
  Фронт:
    5  CrmSessions, блок stats: «Заработано» через earnedByCurrency (валюта сессии),
       без client.currency внутри; «Касса» по-прежнему по p.currency (валюта платежа).
    6  earnedByCurrency работает: 100 ₾ у клиента с USDT → {GEL: 100}; сессия без своей
       валюты — валюта клиента; цена пустая — ставка клиента; неоплаченные/чужие статусы
       не считаются; пересчёт в лари — по курсам.

Без сети и боевой базы: SQLite в памяти.

    python3 backend/tests/guard_earned_currency_2026_10.py
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
SESS = "src/pages/crm/CrmSessions.tsx"
MONEY = "src/utils/sessionMoney.ts"
RATES = {"GEL": 1.0, "USD": 2.7, "USDT": 2.7, "EUR": 3.0, "RUB": 0.03}


def _src(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_src(rel))


def _near(a, b, eps=0.01):
    return abs(a - b) <= eps


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


def _user():
    return SimpleNamespace(id=ME, email="sp1@example.com", name="Спец", crm_data={})


def _seed(s):
    """Клиент с валютой USDT (ставка 60 USDT) и две сессии этого месяца:
    А — 100 ₾ (валюта сессии GEL), Б — без своей валюты и цены (60 USDT по ставке клиента)."""
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession

    d = datetime.now().replace(day=1, hour=12, minute=0, second=0, microsecond=0)
    s.add(TherapistClient(id="c1", specialist_id=ME, name="Клиент USDT", base_price=60.0, currency="USDT"))
    s.add(TherapySession(id="sA", client_id="c1", specialist_id=ME, status="COMPLETED", price=100.0,
                         currency="GEL", is_paid=True, date=d))
    s.add(TherapySession(id="sB", client_id="c1", specialist_id=ME, status="COMPLETED", price=None,
                         currency=None, is_paid=False, date=d + timedelta(hours=2)))
    s.add(TherapistPayment(id="pA", client_id="c1", specialist_id=ME, amount=100.0, currency="GEL",
                           account="cash", date=d, session_id="sA"))
    s.commit()


# ─── 1. price_in ─────────────────────────────────────────────────────────

def test_price_in_uses_session_currency_not_client():
    from app.services import session_balance as sb
    client = SimpleNamespace(base_price=60.0, currency="USDT")
    ts = SimpleNamespace(price=100.0, currency="GEL")
    assert _near(sb.price_in(ts, client, RATES, "GEL"), 100.0), "100 ₾ у клиента с USDT должно остаться 100 ₾"
    assert _near(sb.price_in(ts, client, RATES, "USDT"), 100.0 / 2.7), "пересчёт в USDT — по курсам"
    assert _near(sb.price_in(ts, client, RATES), 100.0), "по умолчанию — в лари"


def test_price_in_session_in_client_currency_as_before():
    from app.services import session_balance as sb
    client = SimpleNamespace(base_price=60.0, currency="USDT")
    ts = SimpleNamespace(price=60.0, currency=None)
    assert _near(sb.price_in(ts, client, RATES, "GEL"), 60.0 * 2.7), "сессия в валюте клиента — как раньше"
    ts_same = SimpleNamespace(price=60.0, currency="USDT")
    assert _near(sb.price_in(ts_same, client, RATES, "GEL"), 60.0 * 2.7)


def test_price_in_falls_back_to_client_rate():
    from app.services import session_balance as sb
    client = SimpleNamespace(base_price=60.0, currency="USDT")
    assert _near(sb.price_in(SimpleNamespace(price=None, currency=None), client, RATES, "GEL"), 162.0)
    # замороженная валюта сессии при пустой цене: ставка клиента в валюте сессии
    assert sb.session_currency(SimpleNamespace(price=None, currency="GEL"), client) == "GEL"


def test_price_in_reverse_case_usdt_session_for_uah_client():
    """Сессия 75 USDT у клиента с валютой UAH — это 75 USDT, а не 75 грн (прод, авг–сен 2026)."""
    from app.services import session_balance as sb
    rates = dict(RATES, UAH=0.065)
    client = SimpleNamespace(base_price=3368.0, currency="UAH")
    ts = SimpleNamespace(price=75.0, currency="USDT")
    assert _near(sb.price_in(ts, client, rates, "GEL"), 75 * 2.7)


# ─── 2–3. Дашборд ────────────────────────────────────────────────────────

def _dashboard(eng):
    from sqlmodel import Session
    from app.api.v1.crm.dashboard import crm_dashboard
    with Session(eng) as s:
        return crm_dashboard(session=s, current_user=_user(), month=None)


def test_dashboard_expected_in_session_currency():
    eng = _engine()
    from sqlmodel import Session
    with Session(eng) as s:
        _seed(s)
    out = _dashboard(eng)
    cur = out["monthly_stats"][-1]
    # А: 100 ₾ (валюта сессии). Б: цены нет → ставка клиента 60 USDT = 162 ₾ (курс из настроек, здесь — по умолчанию).
    from app.api.v1.settings import DEFAULT_EXCHANGE_RATES as R
    want = 100.0 + 60.0 * R["USDT"]
    assert _near(cur["expected"], round(want, 2)), f"ожидалось {want}, дашборд {cur['expected']} (раньше было бы 160 × курс USDT)"
    assert _near(cur["expected_by_currency"].get("GEL", 0), 100.0), cur["expected_by_currency"]
    assert _near(cur["expected_by_currency"].get("USDT", 0), 60.0), cur["expected_by_currency"]
    assert cur["session_count"] == 2


def test_dashboard_cash_unchanged():
    """«Касса» — платежи по валюте ПЛАТЕЖА: 100 ₾ остаются 100 ₾."""
    eng = _engine()
    from sqlmodel import Session
    with Session(eng) as s:
        _seed(s)
    out = _dashboard(eng)
    assert _near(out["revenue_this_month"], 100.0), out["revenue_this_month"]
    assert out["revenue_by_currency"] == {"GEL": 100.0}, out["revenue_by_currency"]
    assert _near(out["monthly_stats"][-1]["received"], 100.0)
    assert out["monthly_stats"][-1]["received_by_currency"] == {"GEL": 100.0}


def test_dashboard_upcoming_currency_is_session_currency():
    eng = _engine()
    from sqlmodel import Session
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession
    soon = datetime.now() + timedelta(hours=3)
    with Session(eng) as s:
        s.add(TherapistClient(id="c1", specialist_id=ME, name="Клиент USDT", base_price=60.0, currency="USDT"))
        s.add(TherapySession(id="u1", client_id="c1", specialist_id=ME, status="PLANNED", price=100.0,
                             currency="GEL", date=soon))
        s.add(TherapySession(id="u2", client_id="c1", specialist_id=ME, status="PLANNED", price=None,
                             currency=None, date=soon + timedelta(hours=1)))
        s.commit()
    by_id = {u["id"]: u for u in _dashboard(eng)["upcoming_sessions"]}
    assert by_id["u1"]["currency"] == "GEL" and by_id["u1"]["price"] == 100.0, by_id["u1"]
    assert by_id["u2"]["currency"] == "USDT" and by_id["u2"]["price"] == 60.0, by_id["u2"]


def test_dashboard_debt_unchanged():
    """Долг и остаток уже были в валюте сессии: сессия Б (60 USDT по ставке) — долг 60 USDT."""
    eng = _engine()
    from sqlmodel import Session
    with Session(eng) as s:
        _seed(s)
    out = _dashboard(eng)
    assert out["debt_by_currency"] == {"USDT": 60.0}, out["debt_by_currency"]


# ─── 4. Список клиентов ──────────────────────────────────────────────────

def test_clients_total_cost_in_client_currency():
    eng = _engine()
    from sqlmodel import Session
    from app.api.v1.crm.clients import list_clients
    from app.api.v1.settings import DEFAULT_EXCHANGE_RATES as R
    with Session(eng) as s:
        _seed(s)
    with Session(eng) as s:
        rows = list_clients(session=s, current_user=_user(), active_only=False, with_stats=True, specialist_id=None)
    row = next(r for r in rows if r["id"] == "c1")
    want = 100.0 * 1.0 / R["USDT"] + 60.0   # 100 ₾ → USDT + 60 USDT
    assert _near(row["totalCost"], want, 0.05), f"totalCost {row['totalCost']} ≠ {want}"


# ─── 5. Фронт, статика ───────────────────────────────────────────────────

def _stats_block(code: str) -> str:
    start = code.index("const stats = useMemo(")
    end = code.index("}, [sessions, monthPayments, monthStart, monthEnd, clientMap]);", start)
    return code[start:end]


def test_front_stats_earned_uses_session_currency():
    code = _code(SESS)
    block = _stats_block(code)
    assert "earnedByCurrency(" in block, "«Заработано» не через earnedByCurrency (валюта сессии)"
    assert "client?.currency" not in block and "client.currency" not in block, \
        "в блоке stats снова берётся валюта клиента — «Заработано» завышается ×2,7 у клиентов с USDT"
    assert "earnedByCurrency" in re.search(r"import \{[^}]*\} from '../../utils/sessionMoney';", code).group(0)
    # «Касса» — по-прежнему по валюте платежа
    assert re.search(r"monthPayments\.forEach\(p => \{\s*const cur = p\.currency \|\| 'GEL';", block), \
        "«Касса · с долгами» должна считаться по валюте платежа"
    helper = _code(MONEY)
    body = helper[helper.index("export function earnedByCurrency"):]
    body = body[:body.index("\n}\n")]
    assert "sessionCurrencyOf(s, client)" in body and "sessionPriceOf(s, client)" in body, \
        "earnedByCurrency должен брать цену и валюту сессии через общие помощники"
    assert "client?.currency" not in body and "client.currency" not in body


def test_front_earned_behaves():
    node = shutil.which("node")
    if not node:
        return
    src = re.sub(r"^import [^\n]*\n", "", _src(MONEY), flags=re.M)
    prog = ("const EXCHANGE_RATES: Record<string, number> = { GEL: 1, USDT: 2.7, USD: 2.7, UAH: 0.065 };\n"
            "type CrmSession = any;\n" + src + """
const clients: Record<string, any> = {
  u: { basePrice: 60, currency: 'USDT' },
  h: { basePrice: 3368, currency: 'UAH' },
};
const earned = (s: any) => s.status === 'COMPLETED' && !!s.isPaid;
const sess = [
  { id: 1, clientId: 'u', status: 'COMPLETED', isPaid: true, price: 100, currency: 'GEL' },
  { id: 2, clientId: 'u', status: 'COMPLETED', isPaid: true, price: 60 },
  { id: 3, clientId: 'u', status: 'COMPLETED', isPaid: true },
  { id: 4, clientId: 'u', status: 'COMPLETED', isPaid: false, price: 999, currency: 'GEL' },
  { id: 5, clientId: 'u', status: 'PLANNED', isPaid: true, price: 999, currency: 'GEL' },
  { id: 6, clientId: 'h', status: 'COMPLETED', isPaid: true, price: 75, currency: 'USDT' },
  { id: 7, clientId: 'gone', status: 'COMPLETED', isPaid: true, price: 10 },
];
const by = earnedByCurrency(sess as any, (id) => clients[id], earned);
const gel = Object.entries(by).reduce((a, [c, v]) => a + convertMoney(v as number, c, 'GEL'), 0);
console.log(JSON.stringify({ by, gel, only: earnedByCurrency([sess[0]] as any, (id) => clients[id], earned) }));
""")
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d) / "m.mts"
        f.write_text(prog, encoding="utf-8")
        r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", str(f)],
                           capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        if "strip-types" in r.stderr or "bad option" in r.stderr:
            return   # старый node — поведение держат статические проверки выше
        raise AssertionError(f"node упал: {r.stderr[:500]}")
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["only"] == {"GEL": 100}, f"100 ₾ у клиента с USDT должно дать {{GEL: 100}}, получили {out['only']}"
    # GEL: 100 + 10 (клиента нет → лари); USDT: 60 (сессия 2, валюта клиента) + 60 (сессия 3, ставка клиента) + 75
    assert out["by"] == {"GEL": 110, "USDT": 195}, out["by"]
    assert _near(out["gel"], 110 + 195 * 2.7), out["gel"]


def test_front_finances_revenue_by_payment_currency():
    """Страница «Финансы»: «Доход/получено» группирует платежи по валюте ПЛАТЕЖА
    (47 платежей на 7215 раньше шли в валюте клиента: USDT-платёж у клиента с UAH
    показывался как гривны)."""
    code = (pathlib.Path(__file__).resolve().parents[2] / "src/pages/crm/CrmFinances.tsx").read_text(encoding="utf-8")
    i = code.index("const revByCur")
    block = code[i:i + 600]
    assert "p.currency" in block, "«Финансы»: валюта платежа не используется для «получено»"
    assert "const cur = client?.currency || 'GEL';" not in block, "«Финансы»: снова валюта клиента вместо валюты платежа"


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
    print("СТОРОЖ «ЗАРАБОТАНО В ВАЛЮТЕ СЕССИИ»: OK" if not fails else f"СТОРОЖ «ЗАРАБОТАНО В ВАЛЮТЕ СЕССИИ» УПАЛ ({fails})")
    sys.exit(1 if fails else 0)
