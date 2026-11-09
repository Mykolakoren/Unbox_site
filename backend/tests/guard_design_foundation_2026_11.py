"""СТОРОЖ фундамента дизайна 09.11 — общие правила, на которых перекрашиваются экраны.

Ревью /m (клиент, Psy-CRM, админка, 09.11) нашло одни и те же системные
дыры. Здесь проверяются правки фундамента (без сети и без базы, только
чтение исходников):

  * .num — Plex SANS с ровными цифрами (tabular-nums), а не Plex Mono:
    моно-цифры выглядели «терминалом» и смешивали два шрифта в строке.
    Моно остаётся только в .mono / .code (коды, плотные таблицы).
  * ListGroup / ListRow / ChoiceCard существуют и экспортируются — один вид
    списка и один вид «выбираемой карточки» вместо пяти самодельных.
  * Money tone="flow": приход зелёный, РАСХОД ЧЕРНИЛАМИ (не красный),
    долг — danger (никогда не янтарь), ноль — серый.
  * «Выбрано» — accent-soft + рамка accent, без чёрной заливки (в тёмной теме
    чёрное становится белым пятном) и без галочки, которая расширяла чип.
  * Скругления в общих компонентах — только 8 / 16 / круг (+0 Grid House на компьютере).
  * Большие тёмные блоки — --color-panel / --color-on-panel, токены есть в обеих темах.
  * Одна главная кнопка: Button primary — бирюза; size="sm" для действий в строке.
  * Шапка /m: крупный вариант 28 / подзаголовок 14 / поля 16.
  * EmptyState — со спокойной картинкой и вторым действием.
  * docs/DESIGN-SYSTEM.md — раздел «Как собирать экран».

    python3 backend/tests/guard_design_foundation_2026_11.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
UI = ROOT / "src" / "components" / "ui"

# Легаси «стекла»: остаётся как есть до удаления при миграции экранов
# (docs/DESIGN-SYSTEM.md, чек-лист шага 2). Новые экраны её не используют.
LEGACY_UI = {"LegacyButton.tsx"}


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)(^|[^:'\"])//[^\n]*", r"\1", src)


def _css_rule(css: str, selector: str) -> str:
    """Тело первого правила, у которого селектор ровно `selector` (с начала строки)."""
    m = re.search(rf"(?m)^\s*{re.escape(selector)}\s*\{{([^}}]*)\}}", css)
    assert m, f"нет правила {selector}"
    return m.group(1)


def _theme_block(css: str) -> str:
    i = css.find("@theme static {")
    assert i != -1, "нет @theme static в index.css"
    return css[i:css.find("\n}\n", i)]


def _dark_block(css: str) -> str:
    i = css.find(':root[data-theme="dark"] {')
    assert i != -1, "нет блока тёмной темы в index.css"
    return css[i:css.find("\n}\n", i)]


# ── 1. Цифры ───────────────────────────────────────────────────────────────

def test_num_is_sans_with_tabular_figures():
    css = _strip_comments(_read("src/index.css"))
    body = _css_rule(css, ".num")
    assert "font-mono" not in body and "monospace" not in body.lower(), \
        ".num снова моноширинный — крупные суммы и время опять «терминал»"
    assert "var(--font-sans)" in body, ".num должен быть IBM Plex Sans"
    assert "tabular-nums" in body, ".num без tabular-nums — цифры в столбцах прыгают"
    assert "lining-nums" in body, ".num без lining-nums"
    assert not re.search(r"word-spacing:\s*-", body), "в Sans пробелы сужать нельзя — «1250 ₾» слипнется"
    inline = _css_rule(css, ".num-inline")
    assert "tabular-nums" in inline and "font-family" not in inline, ".num-inline должен брать шрифт фразы"
    m = re.search(r"(?m)^\s*\.mono,\s*\.code[^{]*\{([^}]*)\}", css)
    assert m and "var(--font-mono)" in m.group(1), "нет .mono / .code для кодов и плотных таблиц"


# ── 2. Компоненты ──────────────────────────────────────────────────────────

EXPORTS = {
    "src/components/ui/ListRow.tsx": ["export function ListGroup", "export function ListRow", "export function ListTime",
                                      "export function ListIcon", "export function ListAvatar"],
    "src/components/ui/ChoiceCard.tsx": ["export const ChoiceCard", "export function ChoiceGroup"],
    "src/components/ui/EmptyIllustration.tsx": ["export function EmptyIllustration"],
    "src/components/ui/Money.tsx": ["export function Money", "export function moneyToneClass"],
    "src/components/ui/SummaryCard.tsx": ["export function SummaryCard"],
}


def test_new_components_exist_and_export():
    for rel, exports in EXPORTS.items():
        assert (ROOT / rel).exists(), f"нет {rel}"
        src = _read(rel)
        for e in exports:
            assert e in src, f"{rel}: нет {e}"


def test_list_row_contract():
    src = _strip_comments(_read("src/components/ui/ListRow.tsx"))
    assert "<ul className={clsx('ui-list'" in src and "<li" in src, "ListGroup/ListRow — не список ul/li"
    assert '<button type="button" className="ui-row__main"' in src, "строка с onClick — не кнопка"
    assert "<Link to={to} className=\"ui-row__main\"" in src, "строка с to — не ссылка"
    # Своё действие — вне нажимаемой области (кнопка в кнопке невалидна)
    assert re.search(r"\{main\}\s*\{action && <div className=\"ui-row__action\">", src), \
        "action должен стоять рядом с нажимаемой частью, а не внутри неё"
    css = _strip_comments(_read("src/styles/ui.css"))
    row = _css_rule(css, ".ui-row")
    assert "min-height: 48px" in row, "строка ниже 48 px"
    lst = _css_rule(css, ".ui-list")
    assert "var(--radius-card)" in lst, "группа строк не со скруглением 16"
    assert "var(--color-card)" in lst, "группа строк не на поверхности card"
    t = _css_rule(css, ".ui-row__time")
    assert "width: 52px" in t, "колонка времени не фиксированной ширины"
    assert "white-space: nowrap" in _css_rule(css, ".ui-row__trail-main"), "сумма справа переносится"
    for sel in (".ui-row__title", ".ui-row__subtitle"):
        b = _css_rule(css, sel)
        assert "ellipsis" not in b and "nowrap" not in b, f"{sel} режется — название и подпись должны переноситься"
    assert re.search(r"\.ui-row__main:focus-visible\s*\{[^}]*outline: 2px solid var\(--color-accent\)", css), \
        "у строки нет видимого фокуса"


# ── 3. Деньги ──────────────────────────────────────────────────────────────

def test_money_flow_tone_expense_is_not_danger():
    src = _strip_comments(_read("src/components/ui/Money.tsx"))
    assert "export type MoneyTone = 'flow' | 'balance' | 'debt'" in src
    assert "if (tone === 'flow') return n > 0 ? 'ui-money--in' : 'ui-money--out';" in src, \
        "правило flow изменилось: приход → in, расход → out"
    assert "signed ?? sign ?? tone === 'flow'" in src, "у flow знак «+/−» должен быть по умолчанию"
    assert "'ui-money--zero'" in src, "ноль не приглушается"
    assert "inline ? 'num-inline' : 'num'" in src, "нет варианта для числа внутри фразы"
    css = _strip_comments(_read("src/styles/ui.css"))
    out = _css_rule(css, ".ui-money--out")
    assert "danger" not in out and "var(--color-ink)" in out, "расход снова красный — красный только у долга"
    assert "var(--status-ok-fg)" in _css_rule(css, ".ui-money--in"), "приход не зелёный ok"
    debt = _css_rule(css, ".ui-money--debt")
    assert "var(--status-danger-fg)" in debt and "pending" not in debt, "долг не danger (или янтарный)"
    zero = _css_rule(css, ".ui-money--zero")
    assert "var(--color-ink-60)" in zero and "font-weight: 400" in zero, "ноль выделен как сумма"


# ── 4. «Выбрано» без чёрной заливки ────────────────────────────────────────

_INK_FILL = re.compile(
    r"background(?:Color)?\s*:\s*[^,;}\n]*(?:COLOR\.ink\b(?!\d)|var\(--color-ink\)|#000\b|#000000|#111\b|#0F0F10|'black'|\"black\")",
    re.I,
)
_INK_CLASS = re.compile(r"\bbg-(?:ink|black|unbox-dark)\b(?![-/])")


def test_no_black_selected_fill_in_ui():
    bad = []
    for p in sorted(UI.glob("*.ts*")):
        if p.name in LEGACY_UI:
            continue
        code = _strip_comments(p.read_text(encoding="utf-8"))
        for m in list(_INK_FILL.finditer(code)) + list(_INK_CLASS.finditer(code)):
            bad.append(f"{p.name}:{code.count(chr(10), 0, m.start()) + 1}: {m.group(0)[:60]}")
    assert not bad, "чёрная (ink) заливка в общих компонентах — в тёмной теме белое пятно; " \
                    "большое тёмное → panel, выбранное → accent-soft: " + "; ".join(bad)
    css = _strip_comments(_read("src/styles/ui.css"))
    for m in re.finditer(r"([^{}]*(?:aria-pressed=\"true\"|aria-selected|aria-checked|--selected|:checked)[^{}]*)\{([^}]*)\}", css):
        sel_text, body = m.group(1), m.group(2)
        if re.search(r":not\([^)]*aria-pressed", sel_text) and "aria-pressed=\"true\"]" not in re.sub(r":not\([^)]*\)\)?", "", sel_text):
            continue  # :hover:not([aria-pressed="true"]) — это НЕ выбранное
        assert not re.search(r"background[^;]*var\(--color-ink\)", body), f"«выбрано» залито ink: {m.group(1).strip()}"
        assert "accent" in body or "border-left-color" in body, f"«выбрано» не бирюзой: {m.group(1).strip()}"
    chip = _strip_comments(_read("src/components/ui/Chip.tsx"))
    assert "Check" not in chip, "у выбранного чипа снова галочка — чип расширяется, ряд переносится"
    choice = _strip_comments(_read("src/components/ui/ChoiceCard.tsx"))
    assert "aria-pressed={selected}" in choice and "ui-choice__mark" in choice
    sel = _css_rule(css, '.ui-choice[aria-pressed="true"]')
    chip_sel = _css_rule(css, '.ui-chip[aria-pressed="true"]')
    for name, body in (("ChoiceCard", sel), ("Chip", chip_sel)):
        assert "var(--color-accent-soft)" in body and "border-color: var(--color-accent)" in body, \
            f"{name}: выбранное не accent-soft + рамка accent"


# ── 5. Скругления ──────────────────────────────────────────────────────────

_OK_CSS_RADIUS = {
    "var(--radius-control)", "var(--radius-sheet)", "var(--radius-card)", "var(--radius-pill)",
    "calc(var(--radius-card) - 1px)",
    "var(--radius-grid)",  # 0 — только десктоп Grid House (окно по центру) и «голый» список
}
_OK_TSX_RADIUS = re.compile(r"^(RADIUS\.(control|sheet|grid)|SHAPE\.(control|card|pill)|radius|'50%'|\"50%\"|0|8|16|9999)$")
_BAD_TW = re.compile(r"\brounded-(?:sm|md|xl|3xl|\[[^\]]+\])\b|\brounded(?:-[trbl]{1,2})?-(?:sm|md|xl|3xl)\b")


def test_radius_scale_only_8_16_full():
    t = {m.group(1): m.group(2).strip() for m in re.finditer(r"(--radius-[\w-]+):\s*([^;]+);", _theme_block(_read("src/index.css")))}
    assert t.get("--radius-control") == "8px" and t.get("--radius-sheet") == "16px"
    assert t.get("--radius-card") == "16px", "нет --radius-card: 16px"
    assert t.get("--radius-pill") == "9999px", "нет --radius-pill"
    extra = set(t) - {"--radius-grid", "--radius-control", "--radius-sheet", "--radius-card", "--radius-pill"}
    assert not extra, f"лишние скругления в шкале: {extra}"
    ts = _read("src/design/tokens.ts")
    assert "export const SHAPE = { control: RADIUS.control, card: RADIUS.sheet, pill: 9999 } as const;" in ts
    css = _strip_comments(_read("src/styles/ui.css"))
    def _ok_css(v: str) -> bool:
        v = v.strip()
        if v in _OK_CSS_RADIUS or v == "0":
            return True
        # «var(--radius-sheet) var(--radius-sheet) 0 0» — углы по отдельности
        return all(part in _OK_CSS_RADIUS or part == "0" for part in v.split())

    bad = [f"ui.css: {v.strip()}" for v in re.findall(r"border(?:-[a-z]+)*-radius:\s*([^;]+);", css)
           if not _ok_css(v)]
    for p in sorted(UI.glob("*.tsx")):
        if p.name in LEGACY_UI:
            continue
        code = _strip_comments(p.read_text(encoding="utf-8"))
        for v in re.findall(r"borderRadius:\s*([^,}\n]+)", code):
            if not _OK_TSX_RADIUS.match(v.strip()):
                bad.append(f"{p.name}: borderRadius {v.strip()}")
        for m in _BAD_TW.finditer(code):
            bad.append(f"{p.name}: {m.group(0)}")
    assert not bad, "скругления вне шкалы 8 / 16 / круг: " + ", ".join(bad)


# ── 6. Тёмные панели ───────────────────────────────────────────────────────

def test_dark_panels_have_tokens_in_both_themes():
    css = _read("src/index.css")
    theme, dark = _theme_block(css), _dark_block(css)
    for tok in ("--color-panel", "--color-on-panel"):
        assert re.search(rf"{tok}:\s*#", theme), f"нет {tok} в светлой теме"
        assert re.search(rf"{tok}:\s*#", dark), f"нет {tok} в тёмной теме — панель станет светлой"
    ts = _read("src/design/tokens.ts")
    assert len(re.findall(r"\bpanel: '#", ts)) >= 2 and len(re.findall(r"\bonPanel: '#", ts)) >= 2, \
        "COLOR.panel / onPanel не заданы для обеих тем"
    # Палитра владельца 09.11: тёплая бумага, тёмная бирюзовая панель в обеих темах.
    for tok, want in (("--color-paper", "#F4F2EC"), ("--color-card", "#FBFAF6"), ("--color-panel", "#22302F"),
                      ("--color-on-panel", "#F4F2EC")):
        assert re.search(rf"{tok}:\s*{want}", theme, re.I), f"{tok} не {want} (палитра 09.11)"
    for tok, want in (("--color-paper", "#161513"), ("--color-card", "#1E1D1B"), ("--color-panel", "#22302F"),
                      ("--color-on-panel", "#ECEBE6")):
        assert re.search(rf"{tok}:\s*{want}", dark, re.I), f"тёмная {tok} не {want} (палитра 09.11)"
    fab = _strip_comments(_read("src/components/ui/QuickActionsFab.tsx"))
    assert "open ? 'var(--color-panel)'" in fab, "открытая быстрая кнопка снова ink (в тёмной теме — белая)"


# ── 7. Кнопка, шапка, пустое ───────────────────────────────────────────────

def test_one_primary_and_row_actions():
    src = _read("src/components/ui/Button.tsx")
    assert "'primary' | 'secondary' | 'quiet' | 'danger'" in src
    assert "'auto' | 'touch' | 'compact' | 'sm'" in src, "нет size=\"sm\" для действий в строке"
    assert "ОДНА на экран" in src, "в Button не записано правило «одна главная на экран»"
    css = _strip_comments(_read("src/styles/ui.css"))
    assert "var(--color-accent)" in _css_rule(css, ".ui-btn--primary"), "главная кнопка не бирюзовая"
    sm = re.search(r"\.ui-btn--sm\s*\{([^}]*)\}", css)
    assert sm and "--btn-h: 36px" in sm.group(1), "sm не 36 px"
    assert re.search(r"\.ui-btn--sm::after\s*\{[^}]*inset: -4px 0", css), "у sm нет запаса до 44 px для пальца"


def test_mobile_page_header_large():
    src = _strip_comments(_read("src/components/ui/PageHeader.tsx"))
    assert "variant?: 'bar' | 'large'" in src and "subtitle?: ReactNode" in src
    assert "const showBack = back ?? variant === 'bar';" in src, "у старых шапок пропала стрелка «←»"
    css = _strip_comments(_read("src/styles/ui.css"))
    assert "var(--text-heading)" in _css_rule(css, ".ui-m-header-lg__title"), "крупная шапка не 28"
    assert "var(--text-small)" in _css_rule(css, ".ui-m-header-lg__sub"), "подзаголовок не 14"
    assert "var(--space-4)" in _css_rule(css, ".ui-m-header-lg"), "поля шапки не 16"


def test_empty_state_illustration():
    src = _strip_comments(_read("src/components/ui/EmptyState.tsx"))
    assert "illustration?:" in src and "secondaryAction?:" in src
    art = _strip_comments(_read("src/components/ui/EmptyIllustration.tsx"))
    assert not re.search(r"#[0-9A-Fa-f]{3,8}\b", art), "в картинках вписаны цвета — только currentColor и токены"


def test_docs_how_to_build_a_screen():
    doc = _read("docs/DESIGN-SYSTEM.md")
    for needle in ("Как собирать экран", "ListGroup", "ListRow", "ChoiceCard", 'tone="flow"', "--color-panel", "SHAPE"):
        assert needle in doc, f"в DESIGN-SYSTEM.md нет «{needle}»"


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
    print("СТОРОЖ фундамент дизайна 2026-11: OK" if not failures
          else f"СТОРОЖ фундамент дизайна 2026-11 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
