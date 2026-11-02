"""СТОРОЖ: тёмная тема (02.11).

Обещание владельцу: кто тему не включал, ничего не замечает. Поэтому:
  * выбор хранится в браузере, нет выбора — светлая, настройка устройства сама
    по себе тему не включает (только явное «Авто»);
  * data-theme ставится в index.html до загрузки кода, иначе белая вспышка;
  * тёмная палитра в index.css и в src/design/tokens.ts совпадает, а текст на
    своём фоне читается (≥ 4.5:1) — как у светлой;
  * --color-black не перекрашен: bg-black/50 — это затемнение под окном.

    python3 backend/tests/guard_dark_theme_2026_11.py
"""
import os
import re
import sys

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def _read(rel):
    with open(os.path.join(_ROOT, rel), encoding="utf-8") as f:
        return f.read()


def _dark_css():
    css = _read("src/index.css")
    m = re.search(r':root\[data-theme="dark"\] \{(.*?)\n\}', css, re.S)
    assert m, "в index.css нет блока тёмной темы"
    return {k: v.strip() for k, v in re.findall(r"(--[\w-]+):\s*([^;]+);", m.group(1))}


def _norm(v):
    return v.replace(" ", "").lower()


def _rgb(v):
    v = v.strip()
    if v.startswith("#"):
        return tuple(int(v[i:i + 2], 16) for i in (1, 3, 5))
    raise AssertionError(f"ожидали hex, получили {v}")


def _contrast(a, b):
    def lum(c):
        r = [x / 255 for x in c]
        r = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in r]
        return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def test_default_stays_light():
    html = _read("index.html")
    i = html.index("unbox.theme")
    assert i < html.index('src="/src/main.tsx"'), "тема ставится позже загрузки кода — будет вспышка"
    script = html[i - 40:html.index("</script>", i)]
    assert "_m === 'dark'" in script and "_m === 'system' && matchMedia" in script, \
        "тёмная тема снова может включиться без выбора человека"
    assert re.search(r"<html(?![^>]*data-theme)", html), "data-theme нельзя зашивать в разметку"
    ts = _read("src/utils/theme.ts")
    assert "return v === 'dark' || v === 'system' ? v : 'light';" in ts, "по умолчанию должна быть светлая"


def test_mirror_matches_css():
    css = _dark_css()
    ts = _read("src/design/tokens.ts")
    tail = ts[ts.index("if (IS_DARK) {"):]

    def val(key):
        m = re.search(rf"\b{key}: '([^']+)'", tail)
        assert m, f"в тёмной части tokens.ts нет {key}"
        return m.group(1)

    pairs = {
        "paper": "--color-paper", "card": "--color-card", "sunken": "--color-sunken", "ink": "--color-ink",
        "ink80": "--color-ink-80", "ink60": "--color-ink-60", "ink40": "--color-ink-40", "ink30": "--color-ink-30",
        "ink20": "--color-ink-20", "ink10": "--color-ink-10", "ink08": "--color-ink-08", "ink05": "--color-ink-05",
        "onInk": "--color-on-ink", "overlay": "--color-overlay", "panel": "--color-panel",
        "onPanel": "--color-on-panel", "sidebar": "--color-sidebar", "sidebarNarrow": "--color-sidebar-narrow",
        "accent": "--color-accent", "accentHover": "--color-accent-hover", "accentInk": "--color-accent-ink",
        "accentSoft": "--color-accent-soft", "onAccent": "--color-on-accent", "unboxGrey": "--color-unbox-grey",
    }
    for key, name in pairs.items():
        assert _norm(val(key)) == _norm(css[name]), f"COLOR.{key} ≠ {name}: {val(key)} / {css[name]}"
    for tone in ("ok", "pending", "danger", "info", "muted", "warn"):
        m = re.search(rf"{tone}: \{{ bg: '([^']+)', fg: '([^']+)' \}}", tail)
        assert m, f"в тёмной части tokens.ts нет STATUS.{tone}"
        assert _norm(m.group(1)) == _norm(css[f"--status-{tone}-bg"]), f"STATUS.{tone}.bg ≠ css"
        assert _norm(m.group(2)) == _norm(css[f"--status-{tone}-fg"]), f"STATUS.{tone}.fg ≠ css"


def test_text_is_readable():
    css = _dark_css()
    for fg, bg in (("--color-ink", "--color-paper"), ("--color-ink", "--color-card"), ("--color-ink", "--color-sunken"),
                   ("--color-unbox-grey", "--color-paper"), ("--color-accent-ink", "--color-paper"),
                   ("--color-accent-ink", "--color-card"), ("--color-on-accent", "--color-accent"),
                   ("--color-on-ink", "--color-ink"), ("--color-on-panel", "--color-panel")):
        r = _contrast(_rgb(css[fg]), _rgb(css[bg]))
        assert r >= 4.5, f"{fg} на {bg}: {r:.2f} < 4.5"
    for tone in ("ok", "pending", "danger", "info", "muted", "warn"):
        r = _contrast(_rgb(css[f"--status-{tone}-fg"]), _rgb(css[f"--status-{tone}-bg"]))
        assert r >= 4.5, f"статус {tone}: {r:.2f} < 4.5"


def test_overlays_and_wiring():
    css = _dark_css()
    assert "--color-black" not in css, "--color-black перекрашен: затемнение под окнами станет светлым"
    assert 'bg-ink/45' not in _read("src/components/CancelBookingChoiceModal.tsx"), \
        "затемнение на ink: в тёмной теме оно станет белёсым — нужен bg-overlay"
    assert "theme={IS_DARK ? 'dark' : 'light'}" in _read("src/App.tsx"), "уведомления (тосты) не знают про тему"
    for rel in ("src/pages/ProfilePage.tsx", "src/pages/mobile/MobileProfileEdit.tsx", "src/pages/crm/CrmSettings.tsx"):
        assert "<ThemeSwitch />" in _read(rel), f"пропал переключатель темы: {rel}"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:300]}")
    sys.exit(1 if fails else 0)
