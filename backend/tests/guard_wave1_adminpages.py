"""СТОРОЖ wave1 · adminpages — десктопные страницы админки на общей основе
(аудит 29.09, волна 1, шаг 2). Файлы: src/pages/admin/*.tsx.

Что ловит (только чтение исходников, без сети и базы):
  X1-07 / G7-admin-core-M1 — системные confirm()/prompt()/alert() вместо общего
           окна с кнопками-действиями и шторки с полем (их было 15).
  X4-02 / X1-03 — бледный текст (GH.ink30, text-gray-300/400, unbox-grey,
           unbox-dark/40) и шрифт меньше 12 px (было 216 мест).
  X3 / решение владельца — «вы», а не «ты»; функция называется «Пересдать»
           («На пересдаче» / «Пересдана»), без «переаренды» и «Пересд.».
  G7-02 — английские остатки: «ADMIN · BOOKINGS», «CLIENT PROFILE»,
           «Basic Client», «EMPTY», «WIP/DONE», «G-Cal», «GEL», сырой {item.status}.
  G7-21 — нажатие на телефон клиента открывало prompt() правки вместо звонка.
  X4-accessibility-M2 — «Смена открыта» погашенной кнопкой (1.4:1).
  G8-05 — «Вкл/Выкл» у кабинета: непонятно, состояние это или действие.
  Эмодзи вместо значков, старый кирпичный #B84A2F, #fff.

    python3 backend/tests/guard_wave1_adminpages.py
"""
import os
import re
import sys
import pathlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

ROOT = pathlib.Path(__file__).parent.parent.parent
ADMIN = ROOT / "src" / "pages" / "admin"


def _files():
    files = sorted(ADMIN.glob("*.tsx"))
    assert files, "не нашёл src/pages/admin/*.tsx"
    return files


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(text: str) -> str:
    """Исходник без комментариев (// … и /* … */, в том числе {/* … */} в JSX)."""
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", text)


def _hits(pattern, flags=0, *, raw=False):
    out = []
    for f in _files():
        text = f.read_text(encoding="utf-8")
        src = text if raw else _code(text)
        for m in re.finditer(pattern, src, flags):
            line = src[:m.start()].count("\n") + 1
            out.append(f"{f.name}:{line}: {m.group(0)[:60]!r}")
    return out


# ─────────────────────────────────────────────────────────────────────────
# X1-07 — никаких системных окон браузера
# ─────────────────────────────────────────────────────────────────────────

def test_no_native_confirm_prompt_alert():
    hits = _hits(r"\bwindow\.(?:confirm|prompt|alert)\s*\(")
    hits += _hits(r"(?<![\w.$])(?:prompt|alert)\s*\(")
    # confirm('…') со строкой — это системное окно; confirm({ … }) — общее.
    hits += _hits(r"(?<![\w.$])confirm\s*\(\s*['\"`]")
    assert not hits, f"системные confirm/prompt/alert в админке: {hits}"


def test_bare_confirm_is_the_shared_dialog():
    """Если в файле зовут confirm(…), это должен быть useConfirmDialog()."""
    bad = []
    for f in _files():
        src = _code(f.read_text(encoding="utf-8"))
        if re.search(r"(?<![\w.$])confirm\s*\(", src) and not re.search(
            r"const\s*\{\s*confirm(?:\s*:\s*\w+)?\s*\}\s*=\s*useConfirmDialog\(\)", src
        ):
            bad.append(f.name)
    assert not bad, f"confirm(…) без общего окна useConfirmDialog: {bad}"


def test_old_confirmation_modal_is_gone_from_pages():
    hits = _hits(r"ConfirmationModal")
    assert not hits, f"свой ConfirmationModal вместо общего окна подтверждения: {hits}"


def test_prompts_became_sheets_with_fields():
    bookings = _read("src/pages/admin/Bookings.tsx")
    assert "RejectBookingSheet" in bookings and "<TextArea" in bookings, \
        "причина отклонения брони снова не в шторке с полем"
    ud = _read("src/pages/admin/UserDetails.tsx")
    assert "UserFieldSheets" in ud and "<Sheet" in ud and "<Input" in ud, \
        "телефон/Telegram/email/архив клиента снова правятся не в шторке"
    # G7-21: номер — ссылка «позвонить», правка — отдельной кнопкой.
    assert "href={`tel:" in ud, "телефон клиента не ссылка tel: (нажатие снова откроет правку)"
    assert "aria-label=\"Изменить телефон\"" in ud, "нет отдельной кнопки правки телефона"


# ─────────────────────────────────────────────────────────────────────────
# Текст: не меньше 12 px и не бледнее ink-60
# ─────────────────────────────────────────────────────────────────────────

def test_no_font_size_below_12():
    small = []
    for f in _files():
        src = _code(f.read_text(encoding="utf-8"))
        for m in re.finditer(r"fontSize\s*[:=]\s*\{?([^,}\n]+)", src):
            for n in re.findall(r"(?<![\w.(])(\d+(?:\.\d+)?)(?![\w.%(])", m.group(1)):
                if 5 <= float(n) < 12:
                    small.append(f"{f.name}: fontSize {m.group(1).strip()[:30]}")
        for m in re.finditer(r"text-\[(\d+(?:\.\d+)?)px\]", src):
            if float(m.group(1)) < 12:
                small.append(f"{f.name}: {m.group(0)}")
        for m in re.finditer(r"font-size:\s*(\d+(?:\.\d+)?)px", src):
            if float(m.group(1)) < 12:
                small.append(f"{f.name}: {m.group(0)}")
    assert not small, f"шрифт меньше 12 px: {small[:10]} (всего {len(small)})"


def test_micro_labels_letter_spacing_capped():
    wide = [h for h in _hits(r"letterSpacing:\s*'(\d*\.?\d+)em'")
            if float(re.search(r"(\d*\.?\d+)em", h).group(1)) > 0.06]
    assert not wide, f"межбуквенный у подписей шире 0.06em: {wide[:10]}"


def test_no_pale_text():
    hits = _hits(r"(?<![A-Za-z])color:\s*[^,}\n]*GH\.ink(?:10|20|30|40)\b")
    hits += _hits(r"(?<![A-Za-z])color:\s*[^,}\n]*COLOR\.ink(?:10|20|30|40)\b")
    hits += _hits(r"(?<![\w-])text-gray-(?:200|300|400)\b")
    hits += _hits(r"(?<![\w-])text-ink-(?:10|20|30|40)\b")
    hits += _hits(r"(?<![\w-])text-unbox-grey\b")
    hits += _hits(r"(?<![\w-])text-unbox-dark/[1-5]0\b")
    hits += _hits(r"(?<![\w-])text-black/[1-5]0\b")
    hits += _hits(r"(?<![A-Za-z])color:\s*['\"]#(?:999|aaa|bbb|ccc|888)(?:[0-9a-f]{3})?['\"]", re.I)
    assert not hits, f"бледный текст (ниже ink-60): {hits[:10]} (всего {len(hits)})"


# ─────────────────────────────────────────────────────────────────────────
# Тон и слова владельца
# ─────────────────────────────────────────────────────────────────────────

def test_no_ty_pronouns():
    hits = _hits(
        r"(?<![А-Яа-яЁё])(?:ты|тебе|тебя|тобой|твой|твоя|твоё|твое|твои|твоего|твоей|твоих|твоим|твоему)(?![А-Яа-яЁё])",
        re.I,
    )
    hits += _hits(
        r"(?<![а-яё])(?:выбери|нажми|введи|укажи|проверь|добавь|включи|выключи|подожди|пополни|"
        r"открой|закрой|сохрани|удали|заполни|перейди|попробуй|посмотри|напиши)(?![а-яё])",
        re.I,
    )
    assert not hits, f"обращение на «ты»: {hits}"


def test_resell_is_called_peresdat():
    hits = _hits(r"переаренд|перебронир|Пересд\.", re.I, raw=True)
    assert not hits, f"старые слова вместо «Пересдать»: {hits}"
    bookings = _read("src/pages/admin/Bookings.tsx")
    assert "'Пересдать'" in bookings, "кнопка в списке броней — не «Пересдать»"
    assert "На пересдаче" in bookings, "метка выставленной брони — не «На пересдаче»"
    kb = _read("src/pages/admin/KnowledgeBase.tsx")
    assert "На пересдаче" in kb and "Пересдана" in kb, "база знаний описывает пересдачу старыми словами"


# ─────────────────────────────────────────────────────────────────────────
# G7-02 — английские остатки и сырые коды
# ─────────────────────────────────────────────────────────────────────────

def test_no_english_leftovers():
    leftovers = [
        "ADMIN · BOOKINGS", "ADMIN · USERS", "ADMIN · SPECIALISTS", "CLIENT PROFILE",
        "Basic Client", "Loyal Client", "VIP Client", "UNBOX ADMIN", ">EMPTY<", "G-Cal",
        "'WIP'", "'TODO' : col", "Hot Booking", "Overstay", "No-show", "Tagline (",
    ]
    hits = []
    for f in _files():
        text = f.read_text(encoding="utf-8")
        for w in leftovers:
            if w in _code(text):
                hits.append(f"{f.name}: {w}")
    assert not hits, f"английские подписи в админке: {hits}"


def test_no_gel_shown_to_users():
    hits = _hits(r"\d\s*GEL\b|· GEL\b|\} GEL\b|'\d+ GEL'")
    assert not hits, f"«GEL» вместо «₾»: {hits}"


def test_role_and_status_not_raw_codes():
    ud = _read("src/pages/admin/UserDetails.tsx")
    assert "(user.role || 'user').toUpperCase()" not in ud, "роль клиента снова сырым кодом «USER»"
    assert "{item.status}" not in ud, "в «Истории операций» снова сырой статус брони"
    assert "statusLabel('booking', item.status" in ud
    wl = _read("src/pages/admin/Waitlist.tsx")
    assert ": entry.status}" not in wl, "статус листа ожидания снова сырым кодом"


def test_booking_status_words_from_dictionary():
    bookings = _read("src/pages/admin/Bookings.tsx")
    assert '<StatusBadge kind="booking"' in bookings, "статус брони в списке — не общий StatusBadge"
    assert "statusLabel(" in bookings
    dash = _read("src/pages/admin/Dashboard.tsx")
    assert "getStatusDef('booking'" in dash and "statusLabel(" in dash, \
        "цвет/слово статуса на дашборде — не из общего словаря"


# ─────────────────────────────────────────────────────────────────────────
# Цвет, эмодзи, состояния
# ─────────────────────────────────────────────────────────────────────────

def test_no_emoji_icons():
    emoji = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐⭕]")
    hits = _hits(emoji.pattern)
    assert not hits, f"эмодзи/символы вместо значков Lucide: {hits}"


def test_no_old_brick_red_or_pure_white():
    hits = _hits(r"#B84A2F|184,\s*74,\s*47", re.I)
    hits += _hits(r"['\"]#fff(?:fff)?['\"]", re.I)
    hits += _hits(r"#9333ea|#b45309|#b91c1c|#166534|#D1FAE5|#065F46", re.I)
    assert not hits, f"самодельные цвета вместо токенов: {hits}"


def test_no_purple_blue_decoration():
    hits = _hits(r"(?<![\w\[-])(?:[\w/-]+:)*(?:text|bg|border|ring)-(?:purple|indigo|violet|blue|pink|cyan|fuchsia|sky)-\d{2,3}\b")
    assert not hits, f"фиолетовый/синий декор (цвет — только для статуса): {hits[:10]}"


def test_open_shift_is_a_status_not_a_faded_button():
    fin = _read("src/pages/admin/Finance.tsx")
    assert "Смена открыта" in fin and "STATUS.ok" in fin, "открытая смена снова погашенной кнопкой"
    assert "opacity: shiftOpen ? 0.55" not in fin


def test_cabinet_toggle_names_the_action():
    cab = _read("src/pages/admin/Cabinets.tsx")
    assert "'Вкл'" not in cab and "'Выкл'" not in cab, "кнопка кабинета снова «Вкл/Выкл» (состояние, а не действие)"
    assert "undoToast(" in cab, "скрытие кабинета без «Вернуть»"
    assert "Все ${childrenAffected.length} кабинета" not in cab, "снова «Все 7 кабинета»"


def test_loading_is_not_empty():
    """Загрузка ≠ ошибка ≠ пусто: силуэты и полоса ошибки вместо «пусто»/«Загрузка…»."""
    for rel in ("Bookings.tsx", "Maintenance.tsx", "OwnerAnalytics.tsx", "AdminPosts.tsx"):
        src = _read(f"src/pages/admin/{rel}")
        assert "SkeletonList" in src, f"{rel}: пока грузится, нет силуэтов"
        assert "ErrorBar" in src, f"{rel}: ошибка загрузки выглядит как «пусто»"
    crm = _read("src/pages/admin/AdminCrm.tsx")
    assert "fetchUsers()" in crm and "SkeletonList" in crm, \
        "«Клиентский поток» при прямом открытии снова показывает нули"


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
    print("СТОРОЖ wave1-adminpages: OK" if not failures else f"СТОРОЖ wave1-adminpages УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
