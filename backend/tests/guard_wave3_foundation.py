"""СТОРОЖ wave3 — основа волны 3 (Psy-CRM, шаг 0, 01.10).

Что ловит:
  * suggestNextSession (src/utils/crmNextSession.ts) перестал давать «тот же
    день недели и время по Батуми через неделю», длительность «прошлая →
    анкета → 60», цену = ставка клиента; toTbilisiNaive отдаёт не naive-строку;
    generateAliasCode выдаёт занятый код. Функции исполняются через node ≥ 22.6.
  * В новых шторках (NewSessionSheet / NewClientSheet / UnpaidSessionsSheet)
    появились toISOString (сдвиг на 4 ч), specialistId в записи, заметки
    (`notes:` — они шифруются и живут только в createNote) или оплата через
    updateSession({isPaid…}) вместо quickPaySession.
  * with_stats: будущая сессия попала в lastPastSessionDate, чужие сессии
    (другой специалист) или отменённые считаются в nextSessionDate.
  * index.css: у html, body последним стоит не overflow-x: clip (hidden ломает
    sticky, X1-M3) или пропал запасной hidden перед clip для iOS ≤ 15.
  * src/utils/contactLinks.ts (ревью волны 3): ссылка t.me строится из мусора
    («Анна в телеге»), без Telegram кнопка ведёт не на tel: с подписью
    «Позвонить»; функции исполняются через node.
  * Мёртвый src/components/SidebarLayout.tsx вернулся или его снова импортируют.

Без сети и боевой базы (SQLite в памяти + чтение исходников):
    python3 backend/tests/guard_wave3_foundation.py
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent

SHEETS = (
    "src/components/crm/NewSessionSheet.tsx",
    "src/components/crm/NewClientSheet.tsx",
    "src/components/crm/UnpaidSessionsSheet.tsx",
)
UTIL = "src/utils/crmNextSession.ts"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    return re.sub(r"(^|[^:\\])//[^\n]*", r"\1", src)


def _node_eval(module_rel: str, expr: str):
    """JSON от expr(m) после import .ts через node. None — node нет / старый."""
    node = shutil.which("node")
    if not node:
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    if (major, minor) < (22, 6):
        return None
    path = (ROOT / module_rel).as_posix()
    script = f"import('{path}').then(m => console.log(JSON.stringify({expr})))"
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "-e", script],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"{module_rel} не запустился в node: {r.stderr[:400]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


# ── crmNextSession.ts ─────────────────────────────────────────────────────

def test_next_session_util_has_no_imports():
    code = _strip_comments(_read(UTIL))
    assert not re.search(r"^\s*import\s", code, flags=re.M), \
        "crmNextSession.ts должен быть без импортов — его гоняет node"
    assert "toISOString" not in code, "toISOString даёт UTC — сессия съедет на 4 часа"
    for fn in ("suggestNextSession", "toTbilisiNaive", "generateAliasCode"):
        assert f"export function {fn}(" in code, f"пропала функция {fn}"


def test_suggest_next_session_same_weekday_time_in_batumi():
    now = "new Date('2026-10-01T08:00:00Z')"  # 12:00 по Батуми, чт
    out = _node_eval(UTIL, f"""[
      m.suggestNextSession({{ lastSession: {{ date: '2026-09-30T15:00:00', durationMinutes: 50, price: 90 }},
                              client: {{ basePrice: 140, currency: 'GEL' }}, profileDurationMin: 55, now: {now} }}),
      m.suggestNextSession({{ lastSession: {{ date: '2026-09-30T15:00:00', durationMinutes: 50 }},
                              client: {{ basePrice: 140 }}, now: {now}, weeks: 2 }}),
      m.suggestNextSession({{ lastSession: {{ date: '2026-08-05T15:00:00' }},
                              client: {{ basePrice: 100, currency: 'usd' }}, profileDurationMin: 55, now: {now} }}),
      m.suggestNextSession({{ lastSession: null, client: {{ basePrice: 140 }}, now: {now} }}),
      m.suggestNextSession({{ lastSession: {{ date: '2026-09-30T21:30:00' }}, client: {{ basePrice: 140 }}, now: {now} }}),
      m.toTbilisiNaive('2026-10-07', '9:05'),
    ]""")
    if out is None:
        return  # node нет — исходник проверен тестом выше
    a, b, c, d, e, naive = out
    # 15:00 UTC = 19:00 по Батуми, среда → следующая среда 7 октября.
    assert (a["date"], a["time"]) == ("2026-10-07", "19:00"), a
    assert a["durationMinutes"] == 50, "длительность должна браться из прошлой сессии"
    assert a["price"] == 140 and a["currency"] == "GEL", "цена — ставка клиента"
    assert a["fromLastSession"] is True
    assert (b["date"], b["time"]) == ("2026-10-14", "19:00"), f"«+2 нед»: {b}"
    # Прошлая была давно — ближайшая такая же среда впереди, не дата в прошлом.
    assert (c["date"], c["time"]) == ("2026-10-07", "19:00"), c
    assert c["durationMinutes"] == 55, "нет длительности у сессии — из анкеты"
    assert c["currency"] == "USD"
    assert d["durationMinutes"] == 60 and d["date"] == "2026-10-08", f"без истории: +7 дн. от сегодня, 60 мин: {d}"
    # 21:30 UTC 30.09 = 01:30 по Батуми 1.10 — день по Батуми, а не по UTC.
    assert (e["date"], e["time"]) == ("2026-10-08", "01:30"), e
    assert naive == "2026-10-07T09:05:00", f"на сервер — naive по Батуми без пояса: {naive}"


def test_generate_alias_code_is_free_and_four_digits():
    out = _node_eval(UTIL, """(() => {
        const taken = []; for (let n = 1000; n <= 9998; n++) taken.push(String(n));
        let i = 0; const seq = () => [0, 0.5, 0.9999][i++ % 3];
        return [m.generateAliasCode(['#1000', '5500'], () => 0), m.generateAliasCode(taken, seq),
                m.generateAliasCode(['1234'], () => 0.026)];
    })()""")
    if out is None:
        return
    first, last_free, other = out
    assert first == "1001" or (re.fullmatch(r"\d{4}", first) and first not in ("1000", "5500")), first
    assert last_free == "9999", f"единственный свободный код не найден: {last_free}"
    assert re.fullmatch(r"[1-9]\d{3}", other) and other != "1234", other


# ── Шторки ────────────────────────────────────────────────────────────────

def test_new_sheets_forbidden_patterns():
    ty = re.compile(r"[«\"'>\s](ты|тебе|тебя|твой|твоя|твои|твоё)[\s,.!?»\"'<]", re.I)
    for rel in SHEETS:
        code = _strip_comments(_read(rel))
        assert "toISOString" not in code, f"{rel}: toISOString — дата уедет в UTC (−4 ч)"
        assert not re.search(r"\bspecialistId\b", code), f"{rel}: specialistId в шторке записи (изоляция Psy-CRM)"
        assert not re.search(r"\bnotes\s*:", code), f"{rel}: заметки пишутся только через createNote"
        assert not re.search(r"updateSession\(\s*[^)]*isPaid", code, flags=re.S), \
            f"{rel}: оплата только через quickPaySession, не updateSession({{isPaid}})"
        assert not re.search(r"\b(?:window\.)?(?:prompt|alert)\(", code), f"{rel}: системное окно браузера"
        assert "window.confirm" not in code and not re.search(r"(?<![\w.])confirm\(\s*['\"`]", code), \
            f"{rel}: confirm() браузера вместо useConfirmDialog"
        for m in re.finditer(r"fontSize:\s*(\d+)", code):
            assert int(m.group(1)) >= 12, f"{rel}: шрифт {m.group(1)} px"
        assert not re.search(r"text-\[(?:[0-9]|1[01])px\]", code), f"{rel}: шрифт мельче 12 px"
        assert "ink-40" not in code and "ink-30" not in code and "text-gray-4" not in code, f"{rel}: бледный текст"
        assert not ty.search(code), f"{rel}: обращение на «ты»"
        assert "toastApiError" in code, f"{rel}: ошибки — через toastApiError"


def test_sheets_use_existing_write_paths():
    ns = _strip_comments(_read(SHEETS[0]))
    assert "crmApi.createSession(" in ns and "toTbilisiNaive(" in ns
    assert "pushToCalendar: calendarConnected && pushCal" in ns, \
        "В3: в календарь — только если подключён и галочка стоит"
    assert "useState(true)" in ns and "Добавить в Google Календарь" in ns, "В3: галочка включена по умолчанию"
    nc = _strip_comments(_read(SHEETS[1]))
    assert "crmApi.createClient(" in nc and "generateAliasCode(" in nc, "В2: свободный код сразу"
    up = _strip_comments(_read(SHEETS[2]))
    assert "quickPaySession(s.id)" in up and "useCrmStore(s => s.quickPaySession)" in up, \
        "оплата строки — quickPaySession из стора (защита _quickPayInFlight)"
    assert "crmApi.markAllPaid(client.id)" in up
    assert "Отметить оплату всех сессий с долгом (" in up and "Будущие сессии не трогаем" in up, \
        "вопрос «Отметить все» разошёлся с десктопной карточкой"


def test_client_type_has_next_and_last_past():
    api = _read("src/api/crm.ts")
    i = api.find("export interface CrmClient {")
    block = api[i:api.find("}", api.find("specialistName?", i))]
    assert "nextSessionDate?:" in block and "lastPastSessionDate?:" in block


# ── with_stats: nextSessionDate / lastPastSessionDate ─────────────────────

def test_with_stats_next_and_last_past_session():
    from sqlmodel import Session, create_engine
    from app.models.therapist_client import TherapistClient
    from app.models.therapy_session import TherapySession
    from app.models.therapist_payment import TherapistPayment
    from app.api.v1.crm.clients import list_clients

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    for model in (TherapistClient, TherapySession, TherapistPayment):
        model.__table__.create(engine)
    s = Session(engine)
    me, other = str(uuid4()), str(uuid4())
    c = TherapistClient(name="Анна", specialist_id=me, base_price=140)
    lonely = TherapistClient(name="Борис", specialist_id=me, base_price=100)
    s.add(c); s.add(lonely); s.commit()
    now = datetime.utcnow().replace(microsecond=0)
    past = now - timedelta(days=3)
    future = now + timedelta(days=2)

    def add(spec, when, status="PLANNED"):
        s.add(TherapySession(client_id=c.id, specialist_id=spec, date=when, status=status))

    add(me, past, "COMPLETED")
    add(me, future)
    add(me, now + timedelta(days=1), "CANCELLED_CLIENT")      # отменённая — не «следующая»
    add(me, now - timedelta(days=1), "CANCELLED_THERAPIST")   # отменённая — не «была»
    add(other, now - timedelta(hours=5), "COMPLETED")          # чужой специалист
    add(other, now + timedelta(hours=5))
    s.commit()

    rows = list_clients(session=s, current_user=SimpleNamespace(id=me),
                        active_only=False, with_stats=True, specialist_id=None)
    by = {r["name"]: r for r in rows}
    a = by["Анна"]
    assert a["lastPastSessionDate"] == past.isoformat(), \
        f"lastPastSessionDate: {a['lastPastSessionDate']} (будущая/чужая/отменённая попала?)"
    assert a["nextSessionDate"] == future.isoformat(), \
        f"nextSessionDate: {a['nextSessionDate']} (чужая/отменённая попала?)"
    assert a["lastSessionDate"] == future.isoformat(), "lastSessionDate (максимум по всем) поменял смысл"
    assert a["sessionCount"] == 2, a["sessionCount"]
    b = by["Борис"]
    assert b["nextSessionDate"] is None and b["lastPastSessionDate"] is None


# ── index.css ─────────────────────────────────────────────────────────────

def test_index_css_overflow_clip():
    css = _strip_comments(_read("src/index.css"))
    m = re.search(r"html\s*,\s*body\s*\{([^}]*)\}", css)
    assert m, "нет правила html, body в index.css"
    vals = re.findall(r"overflow-x:\s*([a-z-]+)", m.group(1))
    assert vals and vals[-1] == "clip", \
        f"html, body: последним должен стоять overflow-x: clip (hidden ломает sticky, X1-M3), сейчас {vals}"
    # hidden разрешён только как запасной вариант ПЕРЕД clip: iOS ≤ 15 clip
    # не знает и без него остаётся с горизонтальной прокруткой.
    assert vals[:-1] == ["hidden"], \
        f"html, body: перед clip нужен ровно один запасной overflow-x: hidden для iOS ≤ 15, сейчас {vals}"


# ── contactLinks.ts (ревью волны 3) ───────────────────────────────────────

CONTACT = "src/utils/contactLinks.ts"


def test_contact_links_util_has_no_imports():
    code = _strip_comments(_read(CONTACT))
    assert not re.search(r"^\s*import\s", code, flags=re.M), \
        "contactLinks.ts должен быть без импортов — его гоняет node"
    for fn in ("telegramHref", "phoneHref", "contactHref"):
        assert f"export function {fn}(" in code, f"contactLinks.ts: нет {fn}"


def test_contact_links_validate_nick_and_number():
    cases = {
        "nick": "m.telegramHref('@anna_k')",
        "url": "m.telegramHref('https://t.me/anna_k')",
        "bare_url": "m.telegramHref('t.me/anna_k')",
        "number": "m.telegramHref('+995 599 32-46-68')",
        "junk": "m.telegramHref('Анна в телеге')",
        "short": "m.telegramHref('@ab')",
        "empty": "m.telegramHref('')",
        "phone": "m.phoneHref('+995 599 324 668')",
        "phone_short": "m.phoneHref('12-34')",
        "c_tg": "m.contactHref({ telegram: '@anna_k', phone: '+995599324668' })",
        "c_tel": "m.contactHref({ telegram: 'Анна в телеге', phone: '+995 599 324 668' })",
        "c_none": "m.contactHref({ telegram: '', phone: '' })",
    }
    expr = "{" + ", ".join(f"{k}: {v}" for k, v in cases.items()) + "}"
    r = _node_eval(CONTACT, expr)
    if r is None:
        print("    (node ≥ 22.6 нет — проверка contactLinks по исполнению пропущена)")
        return
    assert r["nick"] == "https://t.me/anna_k", r
    assert r["url"] == "https://t.me/anna_k" and r["bare_url"] == "https://t.me/anna_k", r
    assert r["number"] == "https://t.me/+995599324668", r
    assert r["junk"] is None and r["short"] is None and r["empty"] is None, \
        f"из мусора в поле Telegram строится битая ссылка t.me: {r}"
    assert r["phone"] == "tel:+995599324668" and r["phone_short"] is None, r
    assert r["c_tg"] == {"href": "https://t.me/anna_k", "label": "Написать в Telegram"}, r
    # Без (корректного) Telegram — звонок, и подпись «Позвонить», не «Написать».
    assert r["c_tel"] == {"href": "tel:+995599324668", "label": "Позвонить"}, r
    assert r["c_none"] is None, r


def test_dead_sidebar_layout_stays_deleted():
    assert not (ROOT / "src/components/SidebarLayout.tsx").exists(), \
        "вернулся мёртвый SidebarLayout.tsx (не рендерится с апреля)"
    for p in (ROOT / "src").rglob("*.ts*"):
        code = _strip_comments(p.read_text(encoding="utf-8"))
        assert "SidebarLayout" not in code, f"{p.relative_to(ROOT)}: импорт удалённого SidebarLayout"


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
    print("СТОРОЖ wave3-foundation: OK" if not failures else f"СТОРОЖ wave3-foundation УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
