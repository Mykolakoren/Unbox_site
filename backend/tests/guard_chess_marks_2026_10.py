"""СТОРОЖ · знаки денег в клетке шахматки (01.10; переписан 03.10 по решению владельца).

03.10 (владелец: «брони, покрываемые скидкой за прошлую неделю, показывать как
оплаченные; если хватает на часть — к оплате только разницу»): третий знак
«◌ спишется с баланса» убран. Теперь два знака: «(!) к оплате N ₾» (у частично
покрытой — «из M») и «✓ оплачено» — и у списанной без долга, и у ещё не
списанной, которую целиком покрывает плюс на балансе (подсказка «спишется за
24 ч до начала»). Списанная В ДОЛГ — всегда «к оплате». Ниже — история 01.10:

Причина: в клетке шахматки «✓ оплачено» ставилась при любом due <= 0. Но у брони,
которую ещё не списали (DueInfo.charged === false), взять нечего только потому, что
её покрывает плюс на балансе клиента (спишут за сутки до начала). Админы читали «✓»
как «деньги получены» (случай 01.10: Тамрико, Валентина).

Что ловит:
  * dueMarkKind (utils/dueAmounts.ts) — три состояния: due > 0 → owes («к оплате»),
    due <= 0 и charged !== false → paid («оплачено»), due <= 0 и charged === false
    → covered («с баланса»), записи нет → null (ничего). Гоняем в node на примерах.
  * CellDueMark (угол 30-минутной брони) и обычная плитка (1,5 ч и 2 ч+) выбирают знак
    через dueMarkKind и имеют все три ветки; ветка covered рисует CircleDashed, а не
    Check и не слово «оплачено».
  * Легенда под шахматкой: пункты «оплачено — деньги уже списаны с баланса»,
    «с баланса — деньги спишутся … брать ничего не нужно», «(!) к оплате … — взять с клиента».
  * DueBadge (список броней, «Сегодня», телефон): charged === false — кружок и
    «покрыто балансом», не «✓».
  * Расчёт не тронут: computeDueByBooking по-прежнему отдаёт charged: false для ещё
    не списанной брони, покрытой плюсом (node на живых числах).

Без сети и боевой базы (чтение исходников + node ≥ 22.6, если есть):
    python3 backend/tests/guard_chess_marks_2026_10.py
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
CHESS = "src/components/admin/AdminChessboardView.tsx"
BADGE = "src/components/admin/DueBadge.tsx"
DUE = "src/utils/dueAmounts.ts"
PAGES_WITH_BADGE = [
    "src/pages/admin/Bookings.tsx",
    "src/pages/admin/Dashboard.tsx",
    "src/pages/mobile/admin/MobileAdminBookings.tsx",
    "src/pages/mobile/admin/MobileAdminDashboard.tsx",
    "src/pages/mobile/admin/MobileAdminUserCard.tsx",
]


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


def _chunk(code: str, start: str, end: str) -> str:
    a = code.index(start)
    return code[a:code.index(end, a)]


# ── 1. Выбор знака (логика) — 03.10: два знака ──────────────────────────

def test_mark_kind_source():
    code = _code(DUE)
    assert "export function dueMarkKind(" in code, "нет dueMarkKind в dueAmounts.ts"
    body = _chunk(code, "export function dueMarkKind(", "\n}\n")
    assert "if (!info) return null;" in body, "нет записи — должно быть ничего (null)"
    assert "return info.due > 0 ? 'owes' : 'paid';" in body, \
        "03.10: due > 0 — owes, иначе paid (и у ещё не списанной, покрытой плюсом)"
    assert "export type DueMarkKind = 'owes' | 'paid';" in code, "вернулся третий знак covered"


def test_mark_kind_node():
    res = _node_run(f"""
const m = await import('{(ROOT / DUE).as_posix()}');
console.log(JSON.stringify({{
  owes:        m.dueMarkKind({{ due: 20, price: 20, charged: true }}),
  owesPending: m.dueMarkKind({{ due: 20, price: 20, charged: false }}),
  partial:     m.dueMarkKind({{ due: 11, price: 20, charged: false }}),
  paid:        m.dueMarkKind({{ due: 0, price: 20, charged: true }}),
  covered:     m.dueMarkKind({{ due: 0, price: 20, charged: false }}),
  none:        m.dueMarkKind(undefined),
  nul:         m.dueMarkKind(null),
  hintCovered: m.dueHint({{ due: 0, price: 20, charged: false }}),
}}));
""")
    if res is None:
        return  # нет node ≥ 22.6 — проверки исходников всё равно идут
    hint = res.pop("hintCovered")
    assert res == {"owes": "owes", "owesPending": "owes", "partial": "owes", "paid": "paid", "covered": "paid",
                   "none": None, "nul": None}, res
    assert "спишется с баланса за 24 ч до начала" in hint, hint


def test_calc_still_marks_covered_node():
    """Расчёт не менялся: у клиента с плюсом на балансе будущая бронь — due 0, charged false
    (знак теперь «✓ оплачено», подсказка — «спишется за 24 ч до начала»)."""
    res = _node_run(f"""
const m = await import('{(ROOT / DUE).as_posix()}');
const bk = (id, price, paymentStatus) => ({{ id, userId: 'u1', date: '2030-01-10T00:00:00', startTime: '10:00',
  duration: 60, resourceId: 'r1', status: 'confirmed', paymentMethod: 'balance', paymentStatus, finalPrice: price }});
const map = m.computeDueByBooking([bk('f', 20, 'pending')], () => 50);
const map2 = m.computeDueByBooking([bk('f', 20, 'pending')], () => 0);
const map3 = m.computeDueByBooking([bk('p', 20, 'paid')], () => 0);
const map4 = m.computeDueByBooking([bk('h', 20, 'pending')], () => 9);
console.log(JSON.stringify({{
  covered: [map.get('f'), m.dueMarkKind(map.get('f'))],
  owes: [map2.get('f'), m.dueMarkKind(map2.get('f'))],
  paid: [map3.get('p'), m.dueMarkKind(map3.get('p'))],
  partial: [map4.get('h'), m.dueLabel(map4.get('h'))],
}}));
""")
    if res is None:
        return
    assert res["covered"] == [{"due": 0, "price": 20, "charged": False}, "paid"], res["covered"]
    assert res["owes"] == [{"due": 20, "price": 20, "charged": False}, "owes"], res["owes"]
    assert res["paid"] == [{"due": 0, "price": 20, "charged": True}, "paid"], res["paid"]
    assert res["partial"] == [{"due": 11, "price": 20, "charged": False}, "к оплате 11 ₾ из 20"], res["partial"]


# ── 2. Клетка шахматки ───────────────────────────────────────────────────

def test_cell_due_mark_three_branches():
    """(имя прежнее) 03.10: две ветки — owes и paid; подписи из dueHint."""
    code = _code(CHESS)
    cell = code[code.index("function CellDueMark("):code.index("function LegendItem(")]
    assert "dueMarkKind(info)" in cell, "CellDueMark не выбирает знак через dueMarkKind"
    assert "'owes'" in cell and "'paid'" in cell and "'covered'" not in cell, "в CellDueMark снова третий знак"
    assert "const label = dueHint(info);" in cell, "у знака нет подробного title/aria-label"
    icon = _chunk(cell, "const icon =", ";\n    if (corner)")
    assert "<AlertCircle" in icon and "<Check" in icon and "CircleDashed" not in icon
    assert "kind === 'paid' && 'bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]'" in cell
    assert "kind === 'owes' ? 'ui-badge--danger' : 'ui-badge--ok'" in cell
    assert "'оплачено'" in cell and "'списано с баланса'" not in cell


def test_regular_tile_three_branches():
    """(имя прежнее) 03.10: в обычной плитке две ветки; частичное — «к оплате N из M»."""
    code = _code(CHESS)
    tile = _chunk(code, "const kind = dueMarkKind(d);", "})()}")
    assert "kind === 'owes' && d ?" in tile and "kind === 'paid' ?" in tile, "в обычной плитке не две ветки owes/paid"
    assert "kind === 'covered'" not in tile and "CircleDashed" not in tile and "COVERED_SHORT" not in tile, \
        "в плитке снова «◌ спишется с баланса»"
    assert "const markLabel = dueHint(d);" in tile, "у знака в плитке нет подробного title/aria-label"
    assert "roomy && partial ? ` из ${formatGel(d.price)}` : ''" in tile, "частично покрытая без «из M»"
    assert "{roomy && !partial ? 'к оплате ' : ''}" in tile, "у частично покрытой в плитке снова длинная подпись"
    paid = tile[tile.index("kind === 'paid' ? ("):]
    assert "<Check" in paid and "'оплачено'" in paid, "ветка paid потеряла «✓ оплачено»"
    assert "d && d.due > 0 ? (" not in tile, "осталась старая развилка due > 0 / иначе ✓"


def test_covered_text_constants():
    code = _code(DUE)
    assert "COVERED_SHORT" not in code, "вернулась подпись «спишется с баланса» для значка"
    assert ("export const COVERED_HINT = 'Оплачено плюсом на балансе клиента: спишется с баланса "
            "за 24 ч до начала, брать ничего не нужно';") in code
    assert "export function dueHint(" in code


# ── 3. Легенда ───────────────────────────────────────────────────────────

def test_legend_items():
    code = _read(CHESS)
    legend = code[code.index("data-chess-legend"):code.index("{/* ── Панель брони")]
    assert "(!) к оплате 36 ₾ — взять с клиента" in legend, "в легенде нет «(!) к оплате … — взять с клиента»"
    assert "(!) к оплате 11 ₾ из 20 — взять только разницу" in legend, "в легенде нет частичного покрытия"
    assert "оплачено — бронь покрыта деньгами клиента, брать ничего не нужно" in legend
    assert "Списанная в долг — всегда «к оплате»" in legend, "нет пояснения (title) про списанную в долг"
    assert legend.count("whitespace-normal") >= 2, "длинные плашки легенды снова в одну строку — обрезаются"
    assert "спишется с баланса —" not in legend and "<CircleDashed" not in legend, "в легенде снова третий знак"
    assert "<Check" in legend and "<AlertCircle" in legend, \
        "в легенде нет значков (!) и галочки (сами символы ✓ в тексте не пишем — эмодзи-сторож)"


# ── 4. Список броней / «Сегодня» / телефон: один DueBadge ───────────────

def test_due_badge_covered_not_checkmark():
    """(имя прежнее) 03.10: «оплачено» у покрытой плюсом — та же галочка, подсказка другая."""
    code = _code(BADGE)
    tail = code[code.index("if (!paid) return null;"):]
    assert "charged === false ? COVERED_HINT : PAID_HINT" in tail, "у покрытой плюсом нет подсказки «спишется за 24 ч»"
    assert "'ui-badge--ok'" in tail and "<Check" in tail and "CircleDashed" not in code
    assert "спишется с баланса" not in code, "в DueBadge снова «спишется с баланса»"
    head = code[:code.index("if (!paid) return null;")]
    assert "partial &&" in head and "из <span" in head, "нет «к оплате N из M»"


def test_other_screens_use_due_badge_with_charged():
    for rel in PAGES_WITH_BADGE:
        code = _code(rel)
        assert "<DueBadge" in code, f"{rel}: нет DueBadge"
        for m in re.finditer(r"<DueBadge\b[^>]*>", code):
            assert "charged=" in m.group(0), f"{rel}: DueBadge без charged — пропадёт подсказка «спишется за 24 ч»"
            assert "price=" in m.group(0), f"{rel}: DueBadge без price — частичное покрытие без «из M»"
        # Своих «✓ оплачено» рядом нет.
        assert "'✓ оплачено'" not in code and "✓ оплачено" not in code and "✓ списано" not in code, f"{rel}: свой «✓ оплачено» вместо DueBadge"


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
    print("СТОРОЖ знаки шахматки 2026-10: OK" if not failures else f"СТОРОЖ знаки шахматки 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
