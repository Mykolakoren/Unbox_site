"""СТОРОЖ · ясность оплаты (01.10) — «Принять оплату» не там, где долга нет.

Причина: администратор приняла оплату за бронь, которая уже была оплачена
автоматически с баланса клиента, — кнопка «Принять оплату» всегда лежала рядом
с балансом. А клиенты с «за сегодня 0 ₾», но с общим долгом, в «Сегодня»
выглядели так, будто их надо брать сегодня.

Что ловит:
  * Попап брони (BookingMoneyHints): долга по брони нет (due есть и due.due <= 0:
    «оплачено» / «покрыто балансом») — кнопка «Пополнить баланс» (prop label),
    подсказка «Долга по этой брони нет — это предоплата, деньги лягут на баланс
    клиента». Есть долг — по-прежнему «Принять оплату» (дефолт label).
  * «Сегодня» на компьютере и на телефоне: список делится — «Взять сегодня»
    (today > 0) и отдельный блок «Долг по другим броням: не сегодня»
    (today = 0, total > 0) с пояснением; «Принять оплату» у них остаётся.
  * Сводка «Взять N ₾ с K клиентов» считается только по клиентам с today > 0
    (node гоняет adminToday.ts на живых данных).
  * Деньги не тронуты: handleConfirm и тело createTransaction — на месте
    (отпечаток держит guard_wave4_desktop_today), расчёты byClient/todaySummary
    в adminToday.ts не менялись.

Без сети и боевой базы (чтение исходников + node ≥ 22.6, если есть):
    python3 backend/tests/guard_pay_clarity_2026_10.py
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
HINTS = "src/components/admin/BookingMoneyHints.tsx"
DASH = "src/pages/admin/Dashboard.tsx"
MDASH = "src/pages/mobile/admin/MobileAdminDashboard.tsx"
TODAY = "src/utils/adminToday.ts"

LATER_TITLE = "Долг по другим броням: не сегодня"
LATER_NOTE = "Эти брони уже списаны с баланса, оплатить их можно, когда клиент придёт"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(rel: str) -> str:
    """Без комментариев (// … и /* … */, в т.ч. {/* … */} в JSX)."""
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), _read(rel), flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


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


def _node_run(body: str):
    node = _node()
    if not node:
        return None
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", body],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"node упал: {r.stderr[:600]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


# ── 1. Попап брони: «Пополнить баланс» при due <= 0 ──────────────────────

def test_popup_label_topup_when_no_debt():
    code = _code(HINTS)
    popup = code[:code.index("export function AcceptPaymentButton(")]
    assert "const noDebtOnBooking = !!due && due.due <= 0;" in popup, \
        "«долга по брони нет» считается не как due есть и due.due <= 0"
    assert "noDebtOnBooking ? 'Пополнить баланс' : undefined" in popup, \
        "при due <= 0 кнопка не «Пополнить баланс» (а при долге — не дефолтная «Принять оплату»)"
    assert "Долга по этой брони нет — это предоплата, деньги лягут на баланс клиента" in popup, \
        "нет подсказки про предоплату в окне пополнения"
    assert "label={payLabel}" in popup and "hint={payHint}" in popup, \
        "кнопка в попапе брони не получает label/hint"
    # Есть долг — «Принять оплату» по-прежнему дефолт кнопки.
    btn = code[code.index("export function AcceptPaymentButton("):]
    assert "label = 'Принять оплату'" in btn, "дефолт подписи AcceptPaymentButton больше не «Принять оплату»"


def test_popup_label_only_where_no_debt_node():
    """Метка и подсказка — по тем же выражениям, что записаны в файле, на живых числах."""
    code = _code(HINTS)
    popup = code[:code.index("export function AcceptPaymentButton(")]
    m = re.search(r"const noDebtOnBooking = (.+?);\n\s*const payLabel = (.+?);\n\s*const payHint = ([^;]+);", popup, re.S)
    assert m, "не нашли вычисление noDebtOnBooking / payLabel / payHint"
    res = _node_run(f"""
const calc = (due, debt, suggestedHint) => {{
  const noDebtOnBooking = {m.group(1)};
  const payLabel = {m.group(2)};
  const payHint = {m.group(3)};
  return {{ label: payLabel ?? 'Принять оплату', hint: payHint ?? null }};
}};
const out = {{
  paid:    calc({{ due: 0, price: 20, charged: true }}, 0, 'x'),
  covered: calc({{ due: -5, price: 20, charged: true }}, 0, 'x'),
  debt:    calc({{ due: 20, price: 20, charged: true }}, 0, 'x'),
  noInfo:  calc(undefined, 0, 'x'),
  minus:   calc({{ due: 0, price: 20, charged: true }}, 15, 'долг'),
}};
console.log(JSON.stringify(out));
""")
    if res is None:
        return  # нет node ≥ 22.6 — проверка исходника выше всё равно идёт
    pre = "Долга по этой брони нет — это предоплата, деньги лягут на баланс клиента"
    assert res["paid"] == {"label": "Пополнить баланс", "hint": pre}, res["paid"]
    assert res["covered"] == {"label": "Пополнить баланс", "hint": pre}, res["covered"]
    assert res["debt"] == {"label": "Принять оплату", "hint": "x"}, res["debt"]
    assert res["noInfo"] == {"label": "Принять оплату", "hint": "x"}, res["noInfo"]
    # Минус на балансе при покрытой брони: метка «Пополнить баланс», но подсказка про долг (сумма = долг).
    assert res["minus"] == {"label": "Пополнить баланс", "hint": "долг"}, res["minus"]


# ── 2. «Сегодня»: «Взять сегодня» отдельно от «Долг … не сегодня» ────────

def test_desktop_today_split_groups():
    code = _code(DASH)
    assert "const collectToday = toCollect.filter(c => c.today > 0);" in code, "«Взять сегодня» — не только today > 0"
    assert "const collectLater = toCollect.filter(c => !(c.today > 0));" in code, "нет группы «не сегодня» (today = 0, total > 0)"
    assert "{collectToday.map(c => (" in code, "«Взять сегодня» рисует не collectToday"
    assert "{collectLater.map(c => (" in code, "блок «не сегодня» не рисуется"
    assert code.count("<CollectRow ") == 2, "«Принять оплату» (CollectRow) должен быть и у «сегодня», и у «не сегодня»"
    src = _read(DASH)
    assert LATER_TITLE in src, "нет заголовка «Долг по другим броням: не сегодня» (компьютер)"
    assert LATER_NOTE in src, "нет пояснения про уже списанные брони (компьютер)"
    # Блок «не сегодня» — под «Взять сегодня», над «Сверх лимита».
    assert code.index(">Взять сегодня<") < code.index("collectLater.map") < code.index(">Сверх лимита<"), \
        "блок «не сегодня» не между «Взять сегодня» и «Сверх лимита»"


def test_mobile_today_split_groups():
    code = _code(MDASH)
    assert "owing.filter(c => c.today > 0)" in code, "телефон: «Должны» — не только today > 0"
    assert "owing.filter(c => !(c.today > 0))" in code, "телефон: нет группы «не сегодня»"
    assert "owingToday.map(c => renderOwing(c))" in code, "телефон: «сегодня» рисует не owingToday"
    assert "owingLater.map(c => renderOwing(c, true))" in code, "телефон: блок «не сегодня» не рисуется"
    assert code.count("Принять оплату · ") == 1 and "renderOwing = (" in code, \
        "«Принять оплату» на телефоне должна быть в общей карточке renderOwing (у обеих групп)"
    src = _read(MDASH)
    assert LATER_TITLE in src and LATER_NOTE in src, "телефон: нет заголовка/пояснения блока «не сегодня»"
    assert "`Должны · ${owingToday.length}`" in code, "телефон: счётчик «Должны» считает не только today > 0"


# ── 3. Сводка «Взять N ₾ с K клиентов» — только today > 0 ────────────────

def test_summary_counts_only_clients_with_today():
    res = _node_run(f"""
const m = await import('{(ROOT / TODAY).as_posix()}');
const day = '2026-10-01';
const users = [
  {{ id: 'a', email: 'a@x', name: 'Анна', balance: 0 }},
  {{ id: 'b', email: 'b@x', name: 'Борис', balance: -40 }},
  {{ id: 'c', email: 'c@x', name: 'Вера', balance: 10 }},
];
const bk = (id, userId, price) => ({{ id, userId, date: day + 'T00:00:00', startTime: '10:00', duration: 60,
  resourceId: 'r1', status: 'confirmed', paymentMethod: 'balance', paymentStatus: 'pending', finalPrice: price }});
const bookings = [bk('1', 'a', 30), bk('2', 'b', 20), bk('3', 'c', 20)];
// A — к оплате 30 сегодня; B — сегодняшняя уже списана и оплачена (due 0), но минус на балансе;
// C — оплачено (due 0), баланс в плюсе.
const dueMap = new Map([
  ['1', {{ due: 30, price: 30, charged: false }}],
  ['2', {{ due: 0, price: 20, charged: true }}],
  ['3', {{ due: 0, price: 20, charged: true }}],
]);
const rows = m.todayRows({{ bookings, users, dueMap, dayKey: day }});
const summary = m.todaySummary(rows);
const clients = m.byClient(rows, users);
const withToday = clients.filter(c => c.today > 0);
const later = clients.filter(c => c.today <= 0 && c.total > 0);
console.log(JSON.stringify({{
  summary, withToday: withToday.map(c => c.userId), later: later.map(c => c.userId),
  sumToday: Math.round(withToday.reduce((s, c) => s + c.today, 0) * 100) / 100,
}}));
""")
    if res is None:
        return
    assert res["withToday"] == ["a"], res
    assert res["later"] == ["b"], f"клиент с today = 0 и общим долгом должен уйти в «не сегодня»: {res}"
    assert res["summary"]["clients"] == len(res["withToday"]) == 1, f"сводка считает клиентов не по today > 0: {res}"
    assert res["summary"]["amount"] == res["sumToday"] == 30, f"сумма сводки ≠ Σ today: {res}"
    label = res["summary"]["label"].replace("\xa0", " ")  # money() может ставить неразрывный пробел
    assert label.startswith("взять 30 ₾ с 1 клиента"), label


def test_summary_and_by_client_calc_untouched():
    """Суммы не менялись: сводка — по строкам due > 0, today — Σ due > 0, total — минус + не списанные."""
    code = _code(TODAY)
    assert "if (r.due !== null && r.due > 0) {" in code and "who.add(r.clientKey ?? r.userId);" in code, \
        "todaySummary считает клиентов не по строкам due > 0"
    assert "list.reduce((s, r) => s + (r.due !== null && r.due > 0 ? r.due : 0), 0)" in code, "byClient.today изменён"
    assert "total: round2(debt + notCharged)," in code, "byClient.total изменён"


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
    print("СТОРОЖ ясность оплаты 2026-10: OK" if not failures else f"СТОРОЖ ясность оплаты 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
