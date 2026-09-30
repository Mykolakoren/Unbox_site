"""СТОРОЖ wave1 — область «shared» (волна 1, шаг 2): десктопный мастер брони
(src/components/Wizard/*), общие компоненты прямо в src/components/ и прочие
папки src/components/* (кроме ui/, admin/, crm/, landing/, Specialists/).

Что ловит (без сети и базы, только чтение исходников):
  - системные confirm()/prompt()/alert() — только общий ConfirmDialog/тосты;
  - шрифт меньше 12 px (inline fontSize и text-[..px]);
  - бледный ТЕКСТ (GH.ink30, text-gray-400, text-unbox-grey, text-white/40 …);
  - обращение на «ты» в текстах интерфейса;
  - старые слова «переаренда», «перебронирование», «Пересд.»;
  - эмодзи вместо значков в коде (в комментариях можно);
  - кирпичный #B84A2F и самодельные суммы «x.toFixed(1) ₾» в мастере.

В ChessboardStep ещё живут мёртвые ветки `className={isGH ? '' : "…"}`
(isGH === true — строки никогда не рендерятся). Их вырезаем перед проверкой,
чтобы сторож смотрел только на то, что видит человек.

    python3 backend/tests/guard_wave1_shared.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).parent.parent.parent
COMPONENTS = ROOT / "src" / "components"
OTHER_AREAS = re.compile(r"^src/components/(ui|admin|crm|landing|Specialists)/")


def _files():
    out = []
    for p in sorted(COMPONENTS.rglob("*")):
        rel = str(p.relative_to(ROOT))
        if p.suffix in (".ts", ".tsx") and not OTHER_AREAS.match(rel):
            out.append(p)
    # Было ≥ 25. Волна 2, пакет D удалила три мёртвых шага мастера
    # (OptionsStep, FormatDateStep, LocationStep — их никто не импортировал).
    assert len(out) >= 22, f"нашли только {len(out)} файлов области — структура поменялась, обнови сторожа"
    return out


def _strip_dead_gh(src: str) -> str:
    """Вырезает мёртвые ветки `isGH ? '' : "…"` / `isGH ? '' : clsx(…)`."""
    out, i = [], 0
    marker = re.compile(r"isGH\s*\?\s*''\s*:\s*")
    while True:
        m = marker.search(src, i)
        if not m:
            out.append(src[i:])
            break
        out.append(src[i:m.start()])
        j = m.end()
        if src.startswith('"', j):
            j = src.index('"', j + 1) + 1
        elif src.startswith("clsx(", j):
            depth, j = 0, j + 4
            while True:
                if src[j] == "(":
                    depth += 1
                elif src[j] == ")":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
        out.append("''")
        i = j
    return "".join(out)


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    # // до конца строки, но не внутри "https://"
    return re.sub(r"(?<![:\"'])//[^\n]*", "", src)


def _live(p: pathlib.Path) -> str:
    return _strip_comments(_strip_dead_gh(p.read_text(encoding="utf-8")))


def _rel(p):
    return str(p.relative_to(ROOT))


# ── 1. системные окна ────────────────────────────────────────────────────
NATIVE_DIALOG = re.compile(r"(?<![\w.])(?:window\.)?(?:confirm|prompt|alert)\(\s*(?!\{)|window\.(?:confirm|prompt|alert)\(")


def test_no_native_dialogs():
    bad = []
    for p in _files():
        for m in NATIVE_DIALOG.finditer(_live(p)):
            bad.append(f"{_rel(p)}: {m.group(0)}")
    assert not bad, "системные confirm()/prompt()/alert() вместо ConfirmDialog/тоста: " + "; ".join(bad)


def test_overlap_warning_uses_shared_confirm():
    src = _live(COMPONENTS / "Wizard" / "ChessboardStep.tsx")
    assert "useConfirmDialog()" in src, "пересечение по времени снова своим окном, а не общим ConfirmDialog"
    assert "confirmLabel: 'Продолжить с пересечением'" in src
    assert "Да, продолжить" not in src and "Вы уверены" not in src


# ── 2. шрифт ≥ 12 px ─────────────────────────────────────────────────────
FS_INLINE = re.compile(r"fontSize\s*:\s*['\"]?(\d*\.?\d+)(px|rem|em)?")
FS_TW = re.compile(r"text-\[(\d*\.?\d+)(px|rem|em)\]")


def _px(v, unit):
    v = float(v)
    return v * 16 if unit in ("rem", "em") else v


def test_no_font_below_12px():
    bad = []
    for p in _files():
        src = _live(p)
        for rx in (FS_INLINE, FS_TW):
            for m in rx.finditer(src):
                if _px(m.group(1), m.group(2)) < 12:
                    bad.append(f"{_rel(p)}: {m.group(0)}")
    assert not bad, "шрифт меньше 12 px: " + "; ".join(bad)


# ── 3. бледный текст ─────────────────────────────────────────────────────
PALE_TEXT = [
    re.compile(r"(?<![-\w])color\s*:\s*GH\.ink(?:30|20|10|8|5)\b"),
    re.compile(r"(?<![-\w])color\s*:\s*COLOR\.ink(?:40|30|20|10|08|05)\b"),
    re.compile(r"(?<![-\w])color\s*:\s*['\"]#(?:999|aaa|bbb|ccc|999999|aaaaaa|bbbbbb)['\"]", re.I),
    re.compile(r"\btext-(?:gray|slate|zinc|neutral|stone)-(?:300|400)\b"),
    re.compile(r"\btext-unbox-grey\b"),
    re.compile(r"\btext-unbox-dark/\d+"),
    re.compile(r"\btext-white/[1-5]\d\b"),
    re.compile(r"\btext-ink-(?:30|20|10)\b"),
    re.compile(r"\btext-accent-ink/\d+"),
]


def test_no_pale_text():
    bad = []
    for p in _files():
        src = _live(p)
        for rx in PALE_TEXT:
            for m in rx.finditer(src):
                bad.append(f"{_rel(p)}: {m.group(0)}")
    assert not bad, "текст бледнее ink-60 (2:1 вместо 5:1): " + "; ".join(bad)


# ── 4. «вы», а не «ты» ───────────────────────────────────────────────────
TY = re.compile(
    r"(?<![а-яё])(?:ты|тебе|тебя|тобой|твой|твоя|твоё|твое|твои|твоих|твоим|твоими|твою|твоей|твоего|твоему"
    r"|заполни|поправь|напиши|тапни|выбери|нажми|попробуй|подожди|пополни|бронируешь|хочешь|можешь)(?![а-яё])",
    re.I,
)


def test_no_ty_address():
    bad = []
    for p in _files():
        for m in TY.finditer(_live(p)):
            bad.append(f"{_rel(p)}: {m.group(0)}")
    assert not bad, "обращение на «ты» (решение владельца — везде «вы»): " + "; ".join(bad)


def test_specialist_gate_mobile_copy_is_vy():
    src = (COMPONENTS / "SpecialistGate.tsx").read_text(encoding="utf-8")
    i = src.find("const MOBILE_COPY")
    j = src.find("const DESKTOP_COPY")
    assert i != -1 and j > i
    mobile = src[i:j]
    assert "заполните анкету специалиста" in mobile
    assert "Поправьте её и отправьте" in mobile and "напишите ему" in mobile


# ── 5. «Пересдать» — старые слова не возвращаются ───────────────────────
def test_no_old_rerent_words():
    bad = []
    rx = re.compile(r"переаренд|перебронир|Пересд\.", re.I)
    for p in _files():
        for m in rx.finditer(_live(p)):
            bad.append(f"{_rel(p)}: {m.group(0)}")
    assert not bad, "старые слова вместо «Пересдать»: " + "; ".join(bad)


# ── 6. эмодзи вместо значков ────────────────────────────────────────────
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐⏰-⏺]")


def test_no_emoji_icons_in_code():
    bad = []
    for p in _files():
        for m in EMOJI.finditer(_live(p)):
            bad.append(f"{_rel(p)}: {m.group(0)}")
    assert not bad, "эмодзи вместо значков Lucide: " + "; ".join(bad)


# ── 7. мастер брони: токены и форматтеры ────────────────────────────────
def test_wizard_has_no_brick_red_or_glass():
    chess = _live(COMPONENTS / "Wizard" / "ChessboardStep.tsx")
    assert "#B84A2F" not in chess and "184,74,47" not in chess, "в шахматке снова кирпичный #B84A2F"
    assert "'#fff'" not in chess, "в шахматке снова чистый #fff вместо токенов"
    for name in ("Wizard/ConfirmationStep.tsx", "Summary.tsx"):
        src = _live(COMPONENTS / name)
        assert "backdropFilter" not in src, f"{name}: снова «стеклянные» карточки"
        assert not re.search(r"toFixed\(\d\)\}?\s*₾", src), f"{name}: сумма собрана вручную, а не formatGel"
        assert "formatGel(" in src


def test_minimal_layout_dead_glass_removed():
    src = (COMPONENTS / "MinimalLayout.tsx").read_text(encoding="utf-8")
    assert "/hero-bg.jpg" not in src, "вернулся фото-фон «стекла» в шапке мастера"
    assert 'aria-label="Go back"' not in src, "подпись кнопки «назад» снова по-английски"


def test_subscription_card_is_light_grid_house():
    src = (COMPONENTS / "SubscriptionCard.tsx").read_text(encoding="utf-8")
    assert "bg-unbox-dark" not in src and "blur-2xl" not in src, "абонемент снова тёмной карточкой со свечением"
    assert "viewerIsAdmin ?" in src  # кнопка заморозки — только админу (старый сторож)


# ── 8. загрузка ≠ ошибка ≠ пусто ────────────────────────────────────────
def test_loading_error_empty_are_distinct():
    tl = _live(COMPONENTS / "Timeline" / "TimelineList.tsx")
    assert "<ErrorBar" in tl and "История пуста" not in tl, "ошибка загрузки истории снова выдаётся за «пусто»"
    dp = _live(COMPONENTS / "Dashboard" / "DiscountProgress.tsx")
    assert "<ErrorBar" in dp and ".catch(() => {})" not in dp, "сбой скидки снова вечная «Загрузка…»"
    chess = (COMPONENTS / "Wizard" / "ChessboardStep.tsx").read_text(encoding="utf-8")
    assert "occupancyFailed" in chess and "<ErrorBar" in chess, "шахматка снова молчит, что занятость не загрузилась"


if __name__ == "__main__":
    import sys
    failures = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"  ✓ {name}")
        except AssertionError as exc:
            failures += 1
            print(f"  ✗ {name}: {exc}")
    print(f"проверок: {len(tests)}")
    print("СТОРОЖ wave1-shared: OK" if not failures else f"СТОРОЖ wave1-shared УПАЛ ({failures})")
    sys.exit(1 if failures else 0)
