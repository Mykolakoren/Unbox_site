"""СТОРОЖ · знаки денег в клетке шахматки (01.10) — «✓» ≠ «деньги получены».

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


# ── 1. Выбор знака (логика) ──────────────────────────────────────────────

def test_mark_kind_source():
    code = _code(DUE)
    assert "export function dueMarkKind(" in code, "нет dueMarkKind в dueAmounts.ts"
    body = _chunk(code, "export function dueMarkKind(", "\n}\n")
    assert "info.due > 0" in body and "'owes'" in body, "нет ветки «к оплате» (due > 0)"
    assert "info.charged === false ? 'covered' : 'paid'" in body, \
        "due <= 0: charged === false должно давать covered, иначе paid"
    assert "if (!info) return null;" in body, "нет записи — должно быть ничего (null)"


def test_mark_kind_node():
    res = _node_run(f"""
const m = await import('{(ROOT / DUE).as_posix()}');
console.log(JSON.stringify({{
  owes:        m.dueMarkKind({{ due: 20, price: 20, charged: true }}),
  owesPending: m.dueMarkKind({{ due: 20, price: 20, charged: false }}),
  paid:        m.dueMarkKind({{ due: 0, price: 20, charged: true }}),
  covered:     m.dueMarkKind({{ due: 0, price: 20, charged: false }}),
  none:        m.dueMarkKind(undefined),
  nul:         m.dueMarkKind(null),
}}));
""")
    if res is None:
        return  # нет node ≥ 22.6 — проверки исходников всё равно идут
    assert res == {"owes": "owes", "owesPending": "owes", "paid": "paid", "covered": "covered",
                   "none": None, "nul": None}, res


def test_calc_still_marks_covered_node():
    """Расчёт не менялся: у клиента с плюсом на балансе будущая бронь — due 0, charged false."""
    res = _node_run(f"""
const m = await import('{(ROOT / DUE).as_posix()}');
const bk = (id, price, paymentStatus) => ({{ id, userId: 'u1', date: '2030-01-10T00:00:00', startTime: '10:00',
  duration: 60, resourceId: 'r1', status: 'confirmed', paymentMethod: 'balance', paymentStatus, finalPrice: price }});
const map = m.computeDueByBooking([bk('f', 20, 'pending')], () => 50);
const map2 = m.computeDueByBooking([bk('f', 20, 'pending')], () => 0);
const map3 = m.computeDueByBooking([bk('p', 20, 'paid')], () => 0);
console.log(JSON.stringify({{
  covered: [map.get('f'), m.dueMarkKind(map.get('f'))],
  owes: [map2.get('f'), m.dueMarkKind(map2.get('f'))],
  paid: [map3.get('p'), m.dueMarkKind(map3.get('p'))],
}}));
""")
    if res is None:
        return
    assert res["covered"] == [{"due": 0, "price": 20, "charged": False}, "covered"], res["covered"]
    assert res["owes"] == [{"due": 20, "price": 20, "charged": False}, "owes"], res["owes"]
    assert res["paid"] == [{"due": 0, "price": 20, "charged": True}, "paid"], res["paid"]


# ── 2. Клетка шахматки ───────────────────────────────────────────────────

def test_cell_due_mark_three_branches():
    code = _code(CHESS)
    cell = code[code.index("function CellDueMark("):code.index("function LegendItem(")]
    assert "dueMarkKind(info)" in cell, "CellDueMark не выбирает знак через dueMarkKind"
    for kind in ("'owes'", "'covered'", "'paid'"):
        assert kind in cell, f"в CellDueMark нет ветки {kind}"
    # Подпись covered — подробный текст, а не «оплачено».
    assert "kind === 'covered' ? COVERED_HINT" in cell, "у covered нет подробного title/aria-label"
    # Значок covered — кружок, а не галочка.
    icon = _chunk(cell, "const icon =", ";\n    if (corner)")
    assert re.search(r"kind === 'covered'\s*\?\s*<CircleDashed", icon), "covered в CellDueMark рисует не CircleDashed"
    assert icon.index("CircleDashed") < icon.index("<Check"), "Check стоит раньше CircleDashed — covered получит галочку"
    # Никакого красного у covered.
    assert "kind === 'covered' && 'bg-[var(--status-muted-bg)] text-[var(--status-muted-fg)]'" in cell, \
        "covered в углу не нейтральный (muted)"
    assert "kind === 'covered' ? 'ui-badge--muted'" in cell, "covered в плашке не ui-badge--muted"
    assert "kind === 'covered' ? COVERED_SHORT" in cell, "в плашке covered нет подписи «с баланса»"
    assert "danger" not in cell.split("kind === 'covered'")[1].split("kind === 'paid'")[0], "у covered появился danger-тон"


def test_regular_tile_three_branches():
    code = _code(CHESS)
    tile = _chunk(code, "const kind = dueMarkKind(d);", "})()}")
    assert "kind === 'owes' && d ?" in tile and "kind === 'covered' ?" in tile and "kind === 'paid' ?" in tile, \
        "в обычной плитке не три ветки owes/covered/paid"
    cov = tile[tile.index("kind === 'covered' ? ("):tile.index("kind === 'paid' ? (")]
    assert "<CircleDashed" in cov and "<Check" not in cov, "ветка covered в плитке рисует галочку или не кружок"
    assert "COVERED_SHORT" in cov, "в широкой плитке (>= 4 клетки) нет подписи «с баланса»"
    assert "roomy" in cov, "подпись «с баланса» не привязана к ширине плитки"
    assert "'оплачено'" not in cov, "ветка covered в плитке пишет «оплачено»"
    assert "kind === 'covered' ? COVERED_HINT" in tile, "у covered в плитке нет подробного title/aria-label"
    # Ветка paid по-прежнему с галочкой.
    paid = tile[tile.index("kind === 'paid' ? ("):]
    assert "<Check" in paid and "оплачено" in paid, "ветка paid потеряла «✓ оплачено»"
    # Старого «любой due <= 0 → ✓» больше нет.
    assert "d && d.due > 0 ? (" not in tile, "осталась старая развилка due > 0 / иначе ✓"


def test_covered_text_constants():
    code = _code(DUE)
    assert "export const COVERED_SHORT = 'с баланса';" in code
    assert ("export const COVERED_HINT = 'Покрыто балансом клиента: "
            "деньги спишутся с баланса за сутки до начала';") in code


# ── 3. Легенда ───────────────────────────────────────────────────────────

def test_legend_items():
    code = _read(CHESS)
    legend = code[code.index("data-chess-legend"):code.index("{/* ── Панель брони")]
    assert "(!) к оплате 36 ₾ — взять с клиента" in legend, "в легенде нет «(!) к оплате … — взять с клиента»"
    assert "оплачено — деньги уже списаны с баланса" in legend, "в легенде нет «оплачено — деньги уже списаны с баланса»"
    assert "с баланса — деньги спишутся с баланса за сутки до начала, брать ничего не нужно" in legend, \
        "в легенде нет пункта «с баланса …»"
    assert "<CircleDashed" in legend and "<Check" in legend and "<AlertCircle" in legend, \
        "в легенде нет значков (!), галочки и кружка (сами символы ✓ и ◌ в тексте не пишем — эмодзи-сторож)"


# ── 4. Список броней / «Сегодня» / телефон: один DueBadge ───────────────

def test_due_badge_covered_not_checkmark():
    code = _code(BADGE)
    tail = code[code.index("if (!paid) return null;"):]
    assert "const covered = charged === false;" in tail, "DueBadge: covered не от charged === false"
    assert "'покрыто балансом'" in tail, "DueBadge: нет подписи «покрыто балансом»"
    assert re.search(r"covered\s*\?\s*<CircleDashed[^>]*/>\s*:\s*<Check", tail), \
        "DueBadge: при covered рисуется не кружок (или галочка раньше кружка)"
    assert "covered ? 'ui-badge--muted' : 'ui-badge--ok'" in tail, "DueBadge: covered не нейтральный"


def test_other_screens_use_due_badge_with_charged():
    for rel in PAGES_WITH_BADGE:
        code = _code(rel)
        assert "<DueBadge" in code, f"{rel}: нет DueBadge"
        for m in re.finditer(r"<DueBadge\b[^>]*>", code):
            assert "charged=" in m.group(0), f"{rel}: DueBadge без charged — «покрыто балансом» превратится в «оплачено»"
        # Своих «✓ оплачено» рядом нет.
        assert "'✓ оплачено'" not in code and "✓ оплачено" not in code, f"{rel}: свой «✓ оплачено» вместо DueBadge"


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
