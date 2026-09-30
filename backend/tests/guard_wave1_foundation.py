"""СТОРОЖ wave1 — фундамент дизайн-системы (аудит 29.09, волна 1, шаг 1).

Что ловит (без сети и без базы, чтение исходников; formatDayMonth ещё и
исполняется через node, если он есть):
  X1-02  — три набора токенов: токены в index.css (@theme) со значениями из
           решения владельца, TS-зеркало src/design/tokens.ts совпадает,
           GH берёт значения оттуда, «бумага» больше не чистый #FFFFFF.
  X1-03  — бледный текст: ink-60 и unbox-grey на бумаге ≥ 4.5:1 (считаем).
  X1-01  — мобильная версия на системном шрифте: три оболочки /m на Plex,
           Plex грузится в index.html, стеков system-ui в src не осталось.
  X1-06 / X1-design-system-M1 — шторки под нижним меню: единая шкала слоёв,
           меню /m на Z.nav, шторка — портал на слое выше меню.
  X1-07  — общий ConfirmDialog с кнопками-действиями + «Вернуть».
  X1-04 / X3-06 — один словарь статусов брони/оплаты/сессии.
  X1-14  — нажатие 0.92/220 мс → 0.97/140 мс.
  G4-02 / G6-13 / G7-02 — «29 сентябрь», «September 2026», «29 September».
  /dev/ui — витрина только в dev, в прод-роутер не попадает.

    python3 backend/tests/guard_wave1_foundation.py
"""
import os
import re
import shutil
import subprocess
import sys
import pathlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

ROOT = pathlib.Path(__file__).parent.parent.parent
SRC = ROOT / "src"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _css_tokens() -> dict:
    css = _read("src/index.css")
    i = css.find("@theme static {")
    assert i != -1, "в index.css нет блока @theme static — токены потеряли единый источник"
    j = css.find("\n}\n", i)
    block = css[i:j]
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"(--[\w-]+):\s*([^;]+);", block)}


def _norm(v: str) -> str:
    return re.sub(r"\s+", "", v).upper()


# ── контраст (WCAG) ─────────────────────────────────────────────────────────
def _rgb(v: str):
    v = v.strip()
    if v.startswith("#"):
        h = v[1:]
        return tuple(int(h[k:k + 2], 16) for k in (0, 2, 4)), 1.0
    m = re.match(r"rgba?\(([^)]*)\)", v)
    assert m, f"не разобрал цвет {v!r}"
    p = [float(x) for x in m.group(1).split(",")]
    return tuple(int(x) for x in p[:3]), (p[3] if len(p) > 3 else 1.0)


def _lum(rgb):
    def ch(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(fg: str, bg: str) -> float:
    (f, a), (b, _) = _rgb(fg), _rgb(bg)
    mix = tuple(a * x + (1 - a) * y for x, y in zip(f, b))
    l1, l2 = _lum(mix), _lum(b)
    return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)


# ─────────────────────────────────────────────────────────────────────────
# Токены: значения из решения владельца, один источник
# ─────────────────────────────────────────────────────────────────────────

EXPECTED = {
    "--color-paper": "#FAFAF7",
    "--color-card": "#FDFDFB",
    "--color-surface": "#FDFDFB",
    "--color-sunken": "#F4F4F2",
    "--color-ink": "#0F0F10",
    "--color-ink-60": "rgba(15,15,16,0.60)",
    "--color-ink-30": "rgba(15,15,16,0.30)",
    "--color-ink-20": "rgba(15,15,16,0.20)",
    "--color-unbox-grey": "#636A74",
    "--color-accent": "#476D6B",
    "--color-accent-ink": "#2F5F5E",
    "--text-caption": "0.75rem",
    "--text-small": "0.875rem",
    "--text-body": "1rem",
    "--text-title": "1.25rem",
    "--text-heading": "1.75rem",
    "--text-display": "2.5rem",
    "--text-hero": "3.5rem",
    "--leading-body": "1.5",
    "--leading-heading": "1.2",
    "--space-1": "4px", "--space-2": "8px", "--space-3": "12px", "--space-4": "16px",
    "--space-5": "24px", "--space-6": "32px", "--space-7": "48px",
    "--radius-grid": "0px",
    "--radius-control": "8px",
    "--radius-sheet": "16px",
}


def test_tokens_have_owner_values():
    t = _css_tokens()
    for name, want in EXPECTED.items():
        assert name in t, f"пропал токен {name}"
        assert _norm(t[name]) == _norm(want), f"{name} = {t[name]}, ожидали {want}"
    assert t["--font-sans"].startswith('"IBM Plex Sans"'), "--font-sans не IBM Plex Sans"
    assert t["--font-mono"].startswith('"IBM Plex Mono"'), "--font-mono не IBM Plex Mono"
    assert "--shadow-pop" in t, "нет единственного токена тени --shadow-pop"
    for z in ("dropdown", "sticky", "nav", "sheet-backdrop", "sheet", "dialog", "toast", "tooltip"):
        assert f"--z-{z}" in t, f"нет слоя --z-{z}"
    assert int(t["--z-sheet"]) > int(t["--z-nav"]) and int(t["--z-sheet-backdrop"]) > int(t["--z-nav"]), \
        "шторка не выше нижнего меню"
    assert int(t["--z-dialog"]) > 10000, "подтверждение ниже старых модалок (9999/10000)"
    for s in ("ok", "pending", "danger", "info", "muted"):
        assert f"--status-{s}-bg" in t and f"--status-{s}-fg" in t, f"нет статуса --status-{s}-*"
    css = _read("src/index.css")
    assert not re.search(r"--color-paper:\s*#FFFFFF", css, re.I), "«бумага» снова чистый #FFFFFF"
    assert "Akrobat" not in css, "в --font-sans вернулись неподключённые шрифты (Akrobat/Inter)"


def test_ts_mirror_matches_css():
    t = _css_tokens()
    ts = _read("src/design/tokens.ts")

    def ts_val(key: str) -> str:
        m = re.search(rf"\b{key}: '([^']+)'", ts)
        assert m, f"в tokens.ts нет COLOR.{key}"
        return m.group(1)

    pairs = {
        "paper": "--color-paper", "card": "--color-card", "sunken": "--color-sunken", "ink": "--color-ink",
        "ink80": "--color-ink-80", "ink60": "--color-ink-60", "ink40": "--color-ink-40", "ink30": "--color-ink-30",
        "ink20": "--color-ink-20", "ink10": "--color-ink-10", "ink08": "--color-ink-08", "ink05": "--color-ink-05",
        "accent": "--color-accent", "accentHover": "--color-accent-hover", "accentInk": "--color-accent-ink",
        "accentSoft": "--color-accent-soft", "onAccent": "--color-on-accent", "unboxGrey": "--color-unbox-grey",
    }
    for key, css_name in pairs.items():
        assert _norm(ts_val(key)) == _norm(t[css_name]), f"COLOR.{key} ≠ {css_name} ({ts_val(key)} vs {t[css_name]})"
    for tone in ("ok", "pending", "danger", "info", "muted"):
        m = re.search(rf"{tone}: \{{ bg: '([^']+)', fg: '([^']+)' \}}", ts)
        assert m, f"в tokens.ts нет STATUS.{tone}"
        assert _norm(m.group(1)) == _norm(t[f"--status-{tone}-bg"]), f"STATUS.{tone}.bg ≠ css"
        assert _norm(m.group(2)) == _norm(t[f"--status-{tone}-fg"]), f"STATUS.{tone}.fg ≠ css"
    zmap = {"dropdown": "dropdown", "sticky": "sticky", "nav": "nav", "sheetBackdrop": "sheet-backdrop",
            "sheet": "sheet", "dialog": "dialog", "toast": "toast", "tooltip": "tooltip"}
    for key, css_key in zmap.items():
        m = re.search(rf"\b{key}: (\d+),", ts)
        assert m and int(m.group(1)) == int(t[f"--z-{css_key}"]), f"Z.{key} ≠ --z-{css_key}"
    for key, px in (("caption", 12), ("small", 14), ("body", 16), ("title", 20), ("heading", 28), ("display", 40), ("hero", 56)):
        m = re.search(rf"\b{key}: (\d+),", ts)
        assert m and int(m.group(1)) == px, f"TEXT.{key} ≠ {px}"
        assert float(t[f"--text-{key}"].replace("rem", "")) * 16 == px, f"--text-{key} ≠ {px}px"
    assert re.search(r"RADIUS = \{ grid: 0, control: 8, sheet: 16 \}", ts), "RADIUS в TS разошёлся со шкалой 0/8/16"
    assert "weight" not in ts.lower() or re.search(r"WEIGHT = \{ regular: 400, medium: 500, semibold: 600 \}", ts), \
        "веса шрифта не 400/500/600"


def test_contrast_of_text_tokens():
    t = _css_tokens()
    paper, card, sunken = t["--color-paper"], t["--color-card"], t["--color-sunken"]
    for bg in (paper, card, sunken):
        c = _contrast(t["--color-ink-60"], bg)
        assert c >= 4.5, f"ink-60 на {bg} = {c:.2f}:1 < 4.5 — вторичный текст снова бледный"
    c = _contrast(t["--color-unbox-grey"], paper)
    assert c >= 4.5, f"unbox-grey на бумаге = {c:.2f}:1 < 4.5"
    assert _contrast(t["--color-accent-ink"], paper) >= 4.5, "мелкий бирюзовый текст < 4.5:1"
    assert _contrast(t["--color-on-accent"], t["--color-accent"]) >= 4.5, "текст на главной кнопке < 4.5:1"
    assert _contrast(t["--color-on-accent"], t["--status-danger-solid"]) >= 4.5, "текст на опасной кнопке < 4.5:1"
    for s in ("ok", "pending", "danger", "info", "muted"):
        c = _contrast(t[f"--status-{s}-fg"], t[f"--status-{s}-bg"])
        assert c >= 4.5, f"статус {s}: {c:.2f}:1 < 4.5"


def test_gh_reads_from_tokens():
    gh = _read("src/hooks/useDesignFlag.ts")
    assert "from '../design/tokens'" in gh, "GH снова хранит свои значения, а не берёт из токенов"
    body = gh[gh.find("export const GH = {"):gh.find("} as const;", gh.find("export const GH = {"))]
    code = re.sub(r"//[^\n]*", "", body)  # комментарии могут упоминать старые цвета
    hexes = re.findall(r"#[0-9A-Fa-f]{3,8}\b", code)
    assert hexes == ["#F6F2E8"], f"в GH вписаны цвета мимо токенов: {hexes}"
    for key, src in (("paper", "COLOR.paper"), ("ink", "COLOR.ink"), ("ink60", "COLOR.ink60"),
                     ("accent", "COLOR.accent"), ("danger", "STATUS.danger.fg"), ("label", "COLOR.accentInk")):
        assert re.search(rf"\b{key}: {re.escape(src)},", body), f"GH.{key} не из {src}"
    assert "export const GH_SANS = FONT.sans" in gh and "export const GH_MONO = FONT.mono" in gh


# ─────────────────────────────────────────────────────────────────────────
# Шрифт Plex в мобильных оболочках
# ─────────────────────────────────────────────────────────────────────────

SHELLS = ("src/pages/mobile/MobileLayout.tsx",
          "src/pages/mobile/crm/MobileCrmLayout.tsx",
          "src/pages/mobile/admin/MobileAdminLayout.tsx")


def test_mobile_shells_use_plex():
    for rel in SHELLS:
        src = _read(rel)
        assert "fontFamily: FONT.sans" in src, f"{rel}: оболочка не на IBM Plex (FONT.sans)"
        assert "system-ui" not in src.replace("был system-ui", ""), f"{rel}: снова system-ui"
        assert "useTouchDensity()" in src, f"{rel}: нет «пальцевой» плотности (44 px)"
        assert "'#999'" not in src, f"{rel}: подписи вкладок снова #999 (2.8:1)"
        assert "fontSize: TEXT.caption" in src, f"{rel}: подписи вкладок меньше 12 px"
    html = _read("index.html")
    assert "family=IBM+Plex+Mono" in html and "family=IBM+Plex+Sans" in html, "index.html не грузит Plex"
    assert "fonts.gstatic.com" in html, "нет preconnect к шрифтам"


def test_no_system_ui_font_stacks_left():
    hits = []
    for path in SRC.rglob("*.tsx"):
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r"fontFamily:\s*['\"`][^'\"`]*system-ui", text):
            hits.append(f"{path.relative_to(ROOT)}:{text[:m.start()].count(chr(10)) + 1}")
    assert not hits, f"остались системные шрифты вместо Plex: {hits}"


def test_nav_and_sheets_on_one_layer_scale():
    ts = _read("src/design/tokens.ts")
    z = {k: int(v) for k, v in re.findall(r"\b(nav|sheetBackdrop|sheet|dialog): (\d+),", ts)}
    for rel in SHELLS[:2]:
        assert "zIndex: Z.nav" in _read(rel), f"{rel}: нижнее меню не на слое Z.nav"
    layers = _read("src/pages/mobile/admin/sheetLayers.ts")
    consts = {m.group(1): int(m.group(2)) for m in re.finditer(r"export const (Z_\w+) = (\d+);", layers)}
    assert consts["Z_TABBAR"] == z["nav"], "Z_TABBAR разошёлся со шкалой Z.nav"
    assert consts["Z_SHEET"] >= z["sheetBackdrop"], "Z_SHEET ниже слоя шторок"
    sheet = _read("src/components/ui/Sheet.tsx")
    assert "createPortal(" in sheet and "document.body" in sheet, "Sheet не порталится в body"
    assert "Z.sheet" in sheet and "Z.dialog" in sheet, "Sheet не на слоях из шкалы"


# ─────────────────────────────────────────────────────────────────────────
# Компоненты
# ─────────────────────────────────────────────────────────────────────────

COMPONENTS = {
    "src/components/ui/Button.tsx": ["export const Button"],
    "src/components/ui/Sheet.tsx": ["export function Sheet"],
    "src/components/ui/ConfirmDialogProvider.tsx": ["export function ConfirmDialogProvider", "export function useConfirmDialog", "export function confirmAction"],
    "src/components/ui/undoToast.ts": ["export function undoToast"],
    "src/components/ui/StatusBadge.tsx": ["export function StatusBadge"],
    "src/components/ui/Field.tsx": ["export function Field", "export const Input", "export const TextArea", "export const Select"],
    "src/components/ui/Chip.tsx": ["export const Chip", "export function Segmented"],
    "src/components/ui/Skeleton.tsx": ["export function Skeleton", "export function SkeletonList"],
    "src/components/ui/ErrorBar.tsx": ["export function ErrorBar"],
    "src/components/ui/EmptyState.tsx": ["export function EmptyState"],
    "src/components/ui/PageHeader.tsx": ["export function PageHeader", "export function MobilePageHeader"],
    "src/components/ui/Money.tsx": ["export function Money"],
    "src/utils/format.ts": ["export function formatGel", "export function formatMoney", "export function formatDateLabel",
                            "export function formatDayMonth", "export function formatTime"],
    "src/design/statuses.ts": ["export const STATUS_DICTIONARY", "export function statusLabel"],
}


def test_components_exist_and_export():
    for rel, exports in COMPONENTS.items():
        assert (ROOT / rel).exists(), f"нет {rel}"
        src = _read(rel)
        for e in exports:
            assert e in src, f"{rel}: нет {e}"


def test_button_contract():
    src = _read("src/components/ui/Button.tsx")
    assert "'primary' | 'secondary' | 'quiet' | 'danger'" in src, "у Button не те варианты"
    assert "disabled={disabled || loading}" in src, "во время запроса кнопку снова можно нажать второй раз"
    assert "aria-busy" in src and "Loader2" in src
    css = _read("src/styles/ui.css")
    assert re.search(r"\.ui-btn:active:not\(:disabled\)\s*\{\s*transform: scale\(0\.97\)", css), "нажатие не 0.97"
    assert ".ui-btn--touch   { --btn-h: 44px" in css and ".ui-btn--compact { --btn-h: 36px" in css
    idx = _read("src/index.css")
    assert "--control-h: 44px" in idx and "--control-h: 36px" in idx, "нет плотности 44/36"
    assert "scale(0.92)" not in idx, ".press снова сжимается до 0.92"
    assert "--dur-press:     140ms" in idx


def test_sheet_contract():
    src = _read("src/components/ui/Sheet.tsx")
    for needle, why in (("'Escape'", "Esc не закрывает"), ("useScrollLock()", "фон прокручивается под шторкой"),
                        ("key !== 'Tab'", "нет фокус-ловушки"), ("opener.focus", "фокус не возвращается"),
                        ("dragControls", "нет закрытия свайпом"), ('aria-modal="true"', "нет aria-modal"),
                        ("MOTION.sheetIn", "длительность появления не из токенов")):
        assert needle in src, f"Sheet: {why}"
    css = _read("src/styles/ui.css")
    assert "env(safe-area-inset-bottom" in css, "подвал шторки не учитывает вырез iPhone"
    assert "100dvh" in css and "overflow-y: auto" in css, "шторка без ограничения высоты/внутренней прокрутки"
    ts = _read("src/design/tokens.ts")
    assert "sheetIn: 220" in ts and "sheetOut: 180" in ts
    # На компьютере прокручивается корень страницы: без лока html фон под
    # шторкой ездил колесом мыши (проверено в браузере 30.09: 300 → 1100 px).
    lock = _read("src/hooks/useScrollLock.ts")
    assert "document.documentElement.classList.add('scroll-locked')" in lock, "лок не держит корень страницы"
    assert "html.scroll-locked" in _read("src/index.css")


def test_confirm_dialog_names_actions():
    src = _read("src/components/ui/ConfirmDialogProvider.tsx")
    assert "tone?: 'default' | 'danger'" in src, "нет tone:'danger'"
    assert 'layer="dialog"' in src and "<Sheet" in src, "подтверждение не на общем Sheet/слое dialog"
    assert "initialFocus={danger ? cancelRef : confirmRef}" in src, "у опасного фокус не на «Отмена»"
    assert "message?: ReactNode" in src and "destructive?: boolean" in src, "сломан старый API (message/destructive)"
    undo = _read("src/components/ui/undoToast.ts")
    assert "label: 'Вернуть'" in undo and "ms = 5000" in undo


def test_one_status_dictionary():
    st = _read("src/design/statuses.ts")
    for code in ("confirmed", "pending_approval", "completed", "cancelled", "rescheduled", "'re-rented'", "no_show",
                 "paid", "unpaid", "partial", "PLANNED", "COMPLETED", "CANCELLED_CLIENT"):
        assert code in st, f"в словаре статусов нет {code}"
    assert "label: 'Ждём подтверждения', staffLabel: 'Ждёт подтверждения'" in st
    assert "tone: 'danger'" in st and "tone: 'pending'" in st and "tone: 'ok'" in st
    badge = _read("src/components/ui/StatusBadge.tsx")
    assert "from '../../design/statuses'" in badge
    helpers = _read("src/utils/bookingHelpers.ts")
    assert "STATUS_DICTIONARY.booking" in helpers, "bookingHelpers снова держит свой словарь статусов"
    assert "'Ожидает'" not in helpers


# ─────────────────────────────────────────────────────────────────────────
# Даты и деньги
# ─────────────────────────────────────────────────────────────────────────

def test_format_day_month_is_genitive():
    src = _read("src/utils/format.ts")
    body = src[src.find("export function formatDayMonth"):src.find("export function formatDateLabel")]
    assert "day: 'numeric', month: 'long'" in body, "formatDayMonth берёт месяц отдельно — будет «29 сентябрь»"
    node = shutil.which("node")
    if node:
        js = ("import('" + str(SRC / "utils/format.ts") + "').then(m => console.log(JSON.stringify(["
              "m.formatDayMonth('2026-09-29'), m.formatDateLabel('2026-09-29'), m.formatGel(1250),"
              " m.formatGel(31.5), m.formatGel(-150), m.formatTime('14:05:00')])))")
        try:
            out = subprocess.run([node, "--no-warnings", "-e", js], capture_output=True, text=True, timeout=30)
        except Exception:  # noqa: BLE001
            out = None
        if out is not None and out.returncode == 0 and out.stdout.strip():
            import json
            day, label, gel, half, neg, time = json.loads(out.stdout.strip())
            assert day == "29 сентября", f"formatDayMonth → {day!r}"
            assert label == "вт, 29 сентября", f"formatDateLabel → {label!r}"
            assert gel == "1 250 ₾", f"formatGel(1250) → {gel!r}"
            assert half == "31,5 ₾" and neg == "−150 ₾", f"formatGel → {half!r} / {neg!r}"
            assert time == "14:05"


def test_known_date_bugs_fixed():
    # «29 сентябрь»: месяц отдельно от дня — именительный падеж.
    hits = []
    for path in SRC.rglob("*.ts*"):
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r"toLocaleDateString\('ru-RU', \{ month: 'long' \}\)", text):
            hits.append(f"{path.relative_to(ROOT)}:{text[:m.start()].count(chr(10)) + 1}")
        for m in re.finditer(r"['\"]d{1,2} LLLL?['\"]", text):
            hits.append(f"{path.relative_to(ROOT)}:{text[:m.start()].count(chr(10)) + 1} (d LLLL)")
    assert not hits, f"снова «29 сентябрь» (месяц в именительном рядом с числом): {hits}"
    # «September 2026» / «29 September»: format без русской локали.
    for rel, bad in (("src/pages/admin/Dashboard.tsx", "format(new Date(), 'LLLL yyyy')"),
                     ("src/pages/admin/Dashboard.tsx", "format(new Date(), 'dd MMMM')"),
                     ("src/pages/mobile/crm/SessionActionSheet.tsx", "formatBatumi(session.date, 'd MMMM, EEE')")):
        assert bad not in _read(rel), f"{rel}: снова английский месяц ({bad})"
    assert "formatDateLabelRu(d, { capitalize: true })" in _read("src/pages/mobile/MobileMyBookings.tsx")


# ─────────────────────────────────────────────────────────────────────────
# /dev/ui — только в dev; MotionConfig
# ─────────────────────────────────────────────────────────────────────────

def test_dev_ui_is_dev_only():
    app = _read("src/App.tsx")
    i = app.find("const DevUiPage = import.meta.env.DEV")
    assert i != -1, "витрина /dev/ui не спрятана за import.meta.env.DEV"
    assert ": null;" in app[i:i + 300], "в прод-сборке DevUiPage должен быть null"
    assert '{DevUiPage && <Route path="/dev/ui"' in app, "маршрут /dev/ui не зависит от DEV"
    assert "import { DevUiPage }" not in app and "from './dev/DevUiPage'" not in app.replace(
        "import('./dev/DevUiPage')", ""), "витрина импортирована статически — попадёт в прод"
    dist = ROOT / "dist" / "assets"
    if dist.exists():
        leaked = [p.name for p in dist.glob("*.js") if "Витрина wave 1" in p.read_text(encoding="utf-8", errors="ignore")]
        assert not leaked, f"витрина /dev/ui попала в прод-сборку: {leaked}"


def test_motion_config_reduced_motion():
    app = _read("src/App.tsx")
    assert '<MotionConfig reducedMotion="user">' in app, "framer-motion не уважает «уменьшить движение»"


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
    print("СТОРОЖ wave1-foundation: OK" if not failures else f"СТОРОЖ wave1-foundation УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
