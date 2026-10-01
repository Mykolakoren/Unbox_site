"""СТОРОЖ · мелочи после волны 4 (01.10) — доделки по итогам демо-проверки.

Что ловит:
  * Мобильная админка, «Брони»: «+ Бронь» снова плавающей кнопкой — при
    прокрутке она ложилась на отметку «к оплате / ✓». Кнопка должна стоять
    в шапке (как на «Сегодня») и оставаться заметной (тёмная, с подписью):
    быстрый «+» владелец просил в июне. Бронь архивного клиента — снова
    началом почты, а не именем с пометкой «архив»; или архив подмешан в деньги.
  * Пополнение из карточки клиента на компьютере (AddFundsModal) снова можно
    записать с филиалом «Не указан» — деньги не попадали в остаток кассы ни
    Uni, ни One. Филиал — по последней брони клиента (cashBranchOfLastBooking),
    не определился — окно без выбора не пишет (requireBranch). Сам запрос
    пополнения (handleAddFunds) не меняется.
  * Psy-CRM на телефоне: в истории оплат счёт снова сырым id («cash»).
  * Суммы моноширинным шрифтом (GH_MONO в style) без .num / wordSpacing —
    широкий пробел перед ₾ («145  ₾»).
  * Перенос сессии в Psy-CRM: под полем даты нет даты по-русски (браузер
    рисует поле на языке системы — «10/07/2026»).
  * leaflet / react-leaflet / @types/leaflet снова в package.json или в
    package-lock.json, хотя карты в коде нет.
  * Вход через Telegram снова не возвращает на ?redirect= (почта и Google
    возвращают); или возврат пускает на чужой сайт («//host», «https://…»).

Без сети и боевой базы (чтение исходников + node, если есть ≥ 22.6):
    python3 backend/tests/guard_leftovers_2026_10.py
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent
MADMIN = "src/pages/mobile/admin/"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


def _node():
    """Путь к node ≥ 22.6 (умеет --experimental-strip-types) или None."""
    node = shutil.which("node")
    if not node:
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    return node if (major, minor) >= (22, 6) else None


def _node_run(body: str, cwd: str | None = None):
    node = _node()
    if not node:
        return None
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", body],
                       capture_output=True, text=True, cwd=cwd or str(ROOT), timeout=60)
    assert r.returncode == 0, f"node упал: {r.stderr[:600]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


def _abs(rel: str) -> str:
    return (ROOT / rel).as_posix()


# ── 1. «Брони»: «+ Бронь» в шапке, а не плавающей кнопкой ───────────────

def test_bookings_new_booking_button_in_header():
    src = _code(MADMIN + "MobileAdminBookings.tsx")
    assert "position: 'fixed'" not in src, "«+» в «Бронях» снова плавает и ложится на отметку оплаты"
    assert src.count('aria-label="Новая бронь"') == 1, "нет кнопки «Новая бронь» (или их две)"
    btn = src.index('aria-label="Новая бронь"')
    # В шапке: после заголовка «Все брони», до фильтров «Когда».
    assert src.index("Все брони") < btn < src.index("<GroupLabel>Когда</GroupLabel>"), \
        "«+ Бронь» не в шапке «Броней»"
    link = src[src.rfind("<Link", 0, btn):src.index("</Link>", btn)]
    assert 'to="/m/find"' in link, "«+ Бронь» ведёт не в общий поиск слота /m/find"
    assert "onClick={() => setBookingForUser(null)}" in link, "«+ Бронь» не сбрасывает «бронь за клиента»"
    # Заметная, как на «Сегодня»: тёмная, с подписью «Бронь», палец попадает (44 px).
    assert "background: 'var(--color-ink)'" in link and "minHeight: 44" in link, "«+ Бронь» в шапке стала незаметной"
    assert re.search(r"<Plus [^>]*/>\s*Бронь\s*$", link), "у кнопки нет подписи «Бронь»"
    dash = _code(MADMIN + "MobileAdminDashboard.tsx")
    assert "position: 'fixed'" not in dash, "«+» на «Сегодня» снова плавает"


def test_bookings_archived_client_named_not_email():
    src = _code(MADMIN + "MobileAdminBookings.tsx")
    assert "useArchivedClients(missingUserIds)" in src, "«Брони»: архивный клиент снова началом почты"
    assert ">архив<" in src, "«Брони»: нет пометки «архив» у брони архивного клиента"
    assert "archivedNameOf(email) ?? getAdminUserName(users, email)" in src, "имя из архива не подставляется"
    assert "`${arch} (архив)`" in src, "шторка брони: архивный клиент без пометки"
    # В деньги архив не подмешиваем: «к оплате» — только по обычному списку.
    assert "useAdminDueMap(bookings, users)" in src, "«Брони»: архив подмешан в «к оплате»"


# ── 3. Пополнение в карточке клиента: филиал обязателен ──────────────────

def test_user_details_topup_requires_branch():
    src = _code("src/pages/admin/UserDetails.tsx")
    i = src.index("<AddFundsModal")
    modal = src[i:src.index("/>", i)]
    assert "defaultBranch={cashBranchOfLastBooking(userBookings)}" in modal, \
        "пополнение в карточке без филиала по последней брони"
    assert "requireBranch" in modal, "пополнение в карточке снова пишется с филиалом «Не указан»"
    # Сам запрос пополнения — прежний (филиал из окна уходит в кассу).
    j = src.index("const handleAddFunds = async (amount: number, method: 'cash' | 'tbc' | 'bog', branch?: string)")
    body = src[j:src.index("\n    };", j)]
    for part in ("category_id: 'cat-topup'", "branch: branch || undefined,", "credit_user_balance: true,"):
        assert part in body, f"запрос пополнения изменился: нет «{part}»"
    m = _code("src/components/admin/modals/AddFundsModal.tsx")
    assert "if (requireBranch && !branch) {" in m, "AddFundsModal пишет без филиала даже с requireBranch"


def test_cash_branch_of_last_booking_logic():
    if not _node():
        return  # нет node ≥ 22.6 — проверка исходника выше всё равно идёт
    # cashBranch.ts импортирует './data' без расширения — node так не умеет;
    # копируем оба файла во временную папку и дописываем «.ts».
    with tempfile.TemporaryDirectory() as tmp:
        src = _read("src/utils/cashBranch.ts").replace("from './data';", "from './data.ts';")
        pathlib.Path(tmp, "cashBranch.ts").write_text(src, encoding="utf-8")
        shutil.copy(ROOT / "src/utils/data.ts", pathlib.Path(tmp, "data.ts"))
        res = _node_run("""
const m = await import('./cashBranch.ts');
const d = await import('./data.ts');
const one = d.RESOURCES.find(r => r.locationId === 'unbox_one').id;
const uni = d.RESOURCES.find(r => r.locationId === 'unbox_uni').id;
const neo = (d.RESOURCES.find(r => r.locationId !== 'unbox_one' && r.locationId !== 'unbox_uni') || {}).id;
const f = m.cashBranchOfLastBooking;
console.log(JSON.stringify({
  empty: f([]) ?? null,
  latest: f([
    { resourceId: uni, date: '2026-09-01', startTime: '10:00', status: 'completed' },
    { resourceId: one, date: '2026-09-20', startTime: '09:00', status: 'confirmed' },
  ]) ?? null,
  sameDayLaterTime: f([
    { resourceId: one, date: '2026-09-20', startTime: '18:00', status: 'confirmed' },
    { resourceId: uni, date: '2026-09-20', startTime: '09:00', status: 'confirmed' },
  ]) ?? null,
  skipsCancelled: f([
    { resourceId: uni, date: '2026-09-01', startTime: '10:00', status: 'completed' },
    { resourceId: one, date: '2026-09-30', startTime: '10:00', status: 'cancelled' },
  ]) ?? null,
  dateObject: f([
    { resourceId: uni, date: '2026-09-01', startTime: '10:00' },
    { resourceId: one, date: new Date(2026, 8, 25), startTime: '10:00' },
  ]) ?? null,
  notCashBranch: neo ? (f([{ resourceId: neo, date: '2026-09-30', startTime: '10:00' }]) ?? null) : null,
}));
""", cwd=tmp)
    assert res == {
        "empty": None, "latest": "Unbox One", "sameDayLaterTime": "Unbox One",
        "skipsCancelled": "Unbox Uni", "dateObject": "Unbox One", "notCashBranch": None,
    }, res


# ── 4. Psy-CRM на телефоне: счёт названием ───────────────────────────────

def test_mobile_crm_payment_account_label():
    src = _code("src/pages/mobile/crm/MobileCrmClient.tsx")
    assert "` · ${p.account}`" not in src, "история оплат на телефоне снова пишет сырой счёт («cash»)"
    # 01.10 (счёт платежа ≠ счёт сессии): подпись — общий accountLabel, он узнаёт «Cash»/«TBC» без учёта регистра.
    assert "accountLabel(p.account, paymentAccounts)" in src, "подпись счёта платежа не по списку счетов"
    assert "fetchPaymentAccounts()" in src, "свои счета специалиста не подгружаются — подпись только по умолчанию"


# ── 5. Моно-суммы: тонкий пробел перед ₾ ─────────────────────────────────

_MONEY = re.compile(r"formatGel\(|formatMoney\(|\}\s*₾")


def _mono_money_offenders():
    out = []
    for p in sorted((ROOT / "src").rglob("*.tsx")):
        src = p.read_text(encoding="utf-8")
        for m in re.finditer(r"fontFamily:\s*(?:GH_MONO|FONT\.mono)", src):
            lt = src.rfind("<", 0, m.start())
            tm = re.match(r"<([A-Za-z][\w.]*)", src[lt:])
            if not tm:
                continue
            tag = tm.group(1)
            gt = src.find(">", src.find("}}", m.end()))
            if gt == -1 or src[gt - 1] == "/":
                continue
            opening = src[lt:gt + 1]
            depth, end = 1, None
            for t in re.finditer(r"<(/?)" + re.escape(tag) + r"\b[^>]*?(/?)>", src[gt + 1:], flags=re.S):
                if t.group(1):
                    depth -= 1
                elif not t.group(2):
                    depth += 1
                if depth == 0:
                    end = gt + 1 + t.start()
                    break
            if end is None or end - gt > 1500:
                continue
            body = src[gt + 1:end]
            # Только «чистая» сумма: без вложенных тегов (подписи, таблицы).
            if "<" in body or not _MONEY.search(body):
                continue
            if "wordSpacing" in opening or re.search(r"className=(\"num|\{[^}]*'num')", opening):
                continue
            out.append(f"{p.relative_to(ROOT)}:{src.count(chr(10), 0, m.start()) + 1}")
    return out


def test_mono_money_has_thin_spaces():
    css = _read("src/index.css")
    assert re.search(r"\.num \{[^}]*word-spacing: -0\.3em;", css), ".num больше не сужает пробелы"
    bad = _mono_money_offenders()
    assert not bad, "сумма моноширинным без .num / wordSpacing — широкий пробел перед ₾: " + ", ".join(bad)


# ── 6. Перенос сессии: дата по-русски ────────────────────────────────────

def test_session_reschedule_date_in_russian():
    src = _code("src/pages/mobile/crm/SessionActionSheet.tsx")
    i = src.index("function RescheduleForm(")
    form = src[i:src.index("\n}\n", i)]
    assert "formatDateLabel(date, { capitalize: true, withYear: 'auto' })" in form, \
        "перенос сессии: под полем даты нет даты по-русски"
    desk = _code("src/pages/crm/CrmSessions.tsx")
    assert "formatDateLabel(new Date(date), { capitalize: true, withYear: 'auto' })" in desk, \
        "правка сессии на компьютере: под полем даты нет даты по-русски"


# ── 7. Leaflet убран ─────────────────────────────────────────────────────

def test_leaflet_removed_from_dependencies():
    pkg = json.loads(_read("package.json"))
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    for name in ("leaflet", "react-leaflet", "@types/leaflet"):
        assert name not in deps, f"{name} снова в package.json — карты в коде нет"
    lock = json.loads(_read("package-lock.json"))
    root_deps = lock.get("packages", {}).get("", {})
    for name in ("leaflet", "react-leaflet", "@types/leaflet"):
        assert name not in root_deps.get("dependencies", {}) and name not in root_deps.get("devDependencies", {}), \
            f"{name} остался в package-lock.json"
        assert f"node_modules/{name}" not in lock.get("packages", {}), f"{name} остался в package-lock.json"
    for p in (ROOT / "src").rglob("*.ts*"):
        code = _strip_comments(p.read_text(encoding="utf-8"))
        assert not re.search(r"from ['\"](?:react-)?leaflet", code) and "leaflet.css" not in code, \
            f"{p.relative_to(ROOT)} снова импортирует leaflet — верните зависимость"
    assert "leaflet" not in _code("vite.config.ts"), "vite.config снова ссылается на leaflet"


# ── 8. Telegram-вход возвращает на ?redirect= ────────────────────────────

def test_telegram_login_keeps_redirect():
    lr = _code("src/utils/loginRedirect.ts")
    assert "export function rememberTelegramRedirect(" in lr and "export function takeTelegramRedirect(" in lr, \
        "нет помощников возврата после Telegram (loginRedirect.ts)"
    btn = _code("src/components/TelegramLoginButton.tsx")
    i = btn.index("const handleClick = () => {")
    click = btn[i:btn.index("window.location.href = authUrl;", i)]
    assert "rememberTelegramRedirect(redirectTo);" in click, "Telegram-кнопка не запоминает ?redirect= перед уходом"
    login = _code("src/pages/LoginPage.tsx")
    assert "redirectTo={redirectTo}" in login, "страница входа не отдаёт ?redirect= в Telegram-кнопку"
    assert 'TelegramLoginButton botName="8209648149" block redirectTo={redirectTo}' in login
    app = _code("src/App.tsx")
    assert "if (token && params.get('source') === 'telegram') {" in app, "после Telegram возврат не забирается"
    assert "const back = takeTelegramRedirect();" in app and "navigate(back, { replace: true })" in app


def test_telegram_redirect_only_local_paths():
    res = _node_run(f"""
const store = new Map();
globalThis.sessionStorage = {{
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
}};
const m = await import('{_abs("src/utils/loginRedirect.ts")}');
const round = v => {{ m.rememberTelegramRedirect(v); return m.takeTelegramRedirect(); }};
const ok = round('/m/become-specialist?x=1');
const once = m.takeTelegramRedirect();
const evilProto = round('//evil.com/x');
const evilScheme = round('https://evil.com');
const evilSlash = round('/\\\\evil.com');
const loginLoop = round('/login?redirect=/x');
m.rememberTelegramRedirect('/crm');
m.rememberTelegramRedirect(null);
const cleared = m.takeTelegramRedirect();
store.set('tgLoginRedirect', '//evil.com');
const tampered = m.takeTelegramRedirect();
console.log(JSON.stringify({{ ok, once, evilProto, evilScheme, evilSlash, loginLoop, cleared, tampered }}));
""")
    if res is None:
        return  # нет node ≥ 22.6 — проверка исходника выше всё равно идёт
    assert res == {
        "ok": "/m/become-specialist?x=1", "once": None, "evilProto": None, "evilScheme": None,
        "evilSlash": None, "loginLoop": None, "cleared": None, "tampered": None,
    }, res


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("СТОРОЖ мелочи 2026-10: OK" if not failures else f"СТОРОЖ мелочи 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
