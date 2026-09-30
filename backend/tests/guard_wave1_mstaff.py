"""СТОРОЖ wave1 (шаг 2) — мобильные рабочие места персонала: /m/crm/* и /m/admin/*.

Экраны психолога (Psy-CRM на телефоне) и администратора переведены на общую
основу дизайн-системы (docs/DESIGN-SYSTEM.md). Что не должно вернуться
(чтение исходников, без сети и базы):

  - системные окна браузера confirm()/prompt()/alert() — только общее окно
    подтверждения (useConfirmDialog) с кнопками-действиями;
  - шрифт меньше 12 px;
  - бледный текст (#999/#888/#aaa/#bbb, ink-40/30/20/10 в color);
  - вписанные руками hex-цвета — только токены;
  - обращение на «ты» (ты/тебе/твой…) и «Тапни/Укажи/Введи…»;
  - «переаренда», «перебронирование», «пересд.» — функция называется «Пересдать»;
  - эмодзи вместо значков (🌱🔥⭐🤝💤⚠️✅⏳🗓💳📝🎉🔁);
  - англицизмы и обрубки: «Юзеры», «Дашб.», «Hold pending», «Hot-booking»,
    «Специал.», «Обслуж.», «Просроч.», «Заплан./Завер./Отмен.», «Синхр»;
  - месяцы/дни через date-fns ('d MMM', 'EEEE', 'LLLL') — только utils/format;
  - суммы через toFixed + «₾» руками — только formatGel/formatMoney/<Money>;
  - локальные подписи статусов вместо общего словаря (statuses.ts);
  - шторки, которые можно было перевести на общий Sheet, — снова самодельные.

    python3 backend/tests/guard_wave1_mstaff.py
"""
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

ROOT = pathlib.Path(__file__).parent.parent.parent
AREA = [ROOT / "src/pages/mobile/crm", ROOT / "src/pages/mobile/admin"]


def _files():
    out = []
    for d in AREA:
        out += sorted(p for p in d.glob("*.ts*"))
    assert out, "не нашли файлы мобильной CRM/админки"
    return out


def _strip_comments(s: str) -> str:
    """Убираем /* … */, {/* … */} и // … (но не «://» в ссылках)."""
    s = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), s, flags=re.S)
    s = re.sub(r"(?<![:'\"`])//[^\n]*", "", s)
    return s


def _code(p: pathlib.Path) -> str:
    return _strip_comments(p.read_text(encoding="utf-8"))


def _hits(pattern: str, flags=0):
    rx = re.compile(pattern, flags)
    hits = []
    for p in _files():
        code = _code(p)
        for m in rx.finditer(code):
            line = code[:m.start()].count("\n") + 1
            hits.append(f"{p.name}:{line}: {m.group(0)[:60]!r}")
    return hits


# ─────────────────────────────────────────────────────────────────────────

def test_no_native_dialogs():
    """confirm()/prompt()/alert() браузера → общее окно (confirm({ … }))."""
    hits = _hits(r"window\.(?:confirm|prompt|alert)\(|(?<![\w.$])(?:prompt|alert)\(|(?<![\w.$])confirm\(\s*(?![{\s])")
    assert not hits, f"системные окна браузера вернулись: {hits}"


def test_no_font_below_12px():
    hits = _hits(r"fontSize:\s*['\"]?(?:[0-9]|1[01])(?:\.\d+)?(?:px)?['\"]?\s*[,}\n]|text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]")
    assert not hits, f"шрифт меньше 12 px: {hits}"


def test_no_pale_text():
    pale = (
        r"color:\s*['\"](?:#999|#999999|#aaa|#bbb|#888|#888888|#ccc|#9CA3AF)['\"]"
        r"|color:\s*['\"]var\(--color-ink-(?:40|30|20|10)\)['\"]"
        r"|color:\s*(?:GH|COLOR)\.ink(?:40|30|20|10)\b"
        r"|text-gray-(?:300|400)\b"
    )
    hits = _hits(pale, re.I)
    assert not hits, f"текст бледнее ink-60: {hits}"


def test_no_hardcoded_hex_colors():
    """Цвета — только токены (var(--…) / COLOR / STATUS), не hex руками."""
    hits = _hits(r"#[0-9a-fA-F]{3,8}\b(?![\w-])")
    assert not hits, f"hex-цвета мимо токенов: {hits}"


def test_formal_address_only():
    """Обращение — «вы». Ни «ты», ни повелительного «Тапни/Укажи/Введи»."""
    ty = r"(?<![А-Яа-яЁё])(?:ты|Ты|тебе|Тебе|тебя|Тебя|тобой|твой|Твой|твоя|Твоя|твоё|твое|твои|Твои|твоих|твоим|твоей|твоего|твоему)(?![А-Яа-яЁё])"
    imper = r"(?<![А-Яа-яЁё])(?:Тапни|тапни|Укажи|укажи|Введи|введи|Выбери|выбери|Пройди|пройди|Нажми|нажми|Добавь|добавь|Опиши|опиши|включи|Попробуй|попробуй)(?![А-Яа-яЁё])"
    hits = _hits(ty) + _hits(imper)
    assert not hits, f"обращение на «ты»: {hits}"


def test_resale_is_called_peresdat():
    hits = _hits(r"переаренд|Переаренд|перебронир|Перебронир|Пересд\.|пересд\.|re-rent\)|\(re-rent")
    assert not hits, f"старое название «Пересдать»: {hits}"


def test_no_emoji_icons():
    hits = _hits("[\U0001F300-\U0001FAFF☀-➿⭐⏳⌛⏰]")
    assert not hits, f"эмодзи вместо значков Lucide: {hits}"


def test_no_slang_and_stubs():
    bad = [
        "Юзеры", "Юзер", "Дашб.", "Hold pending", "Hot-booking", "hot-booking",
        "Специал.", "Обслуж.", "Просроч.", "Заплан.", "Завер.", "Отмен.",
        "Синхр:", "'Синхр'", "Синхр…", "десктоп", "Drag-and-drop", "клиент(ов)",
        "Загружаю", "Сохраняю", "Создаю", "Отклоняю", "ID ${",
    ]
    hits = []
    for p in _files():
        code = _code(p)
        for b in bad:
            if b in code:
                hits.append(f"{p.name}: {b!r}")
    assert not hits, f"сленг/обрубки/«я»-состояния в интерфейсе: {hits}"


def test_dates_through_format_utils():
    """Никаких date-fns-форматов для показа дат ('d MMM', 'EEEE', 'LLLL')."""
    hits = _hits(r"['\"][^'\"\n]*(?:MMM|EEE|LLLL)[^'\"\n]*['\"]")
    assert not hits, f"даты мимо utils/format: {hits}"


def test_money_through_formatter():
    """«94,5 ₾» через formatGel/formatMoney, а не toFixed(0) + «₾» руками."""
    hits = _hits(r"toFixed\(\d\)[^\n]{0,20}(?:₾|GEL|currency|symbol)")
    hits += _hits(r"\{[^{}\n]*\}\s?₾")  # «{x} ₾» / «{x}₾» в JSX
    assert not hits, f"сумма собрана руками: {hits}"


def test_statuses_from_one_dictionary():
    area = {p.name: _code(p) for p in _files()}
    books = area["MobileAdminBookings.tsx"]
    assert "function StatusBadge" not in books, "в «Бронях» снова своя копия StatusBadge"
    assert '<StatusBadge kind="booking"' in books and "audience=\"staff\"" in books
    assert "statusLabel(" in books  # сторож фундамента тоже это проверяет
    today = area["MobileCrmToday.tsx"]
    assert '<StatusBadge kind="session"' in today and '<StatusBadge kind="payment"' in today, \
        "«Сегодня» в CRM рисует статусы своими словами"
    for name in ("MobileCrmSessions.tsx", "MobileCrmClient.tsx"):
        assert "statusLabel('session'" in area[name], f"{name}: статус сессии не из словаря"
    client = area["MobileCrmClient.tsx"]
    assert "function statusLabel" not in client, "в карточке клиента снова свой словарь статусов"


def test_sheets_on_shared_sheet():
    """Где перевод на общий Sheet был прямой заменой — шторки на Sheet
    (слой выше меню, Esc, свайп, фокус, подвал с кнопкой всегда виден)."""
    for rel in (
        "src/pages/mobile/admin/bookingSheets.tsx",
        "src/pages/mobile/admin/MobileCloseShiftSheet.tsx",
        "src/pages/mobile/admin/MobileAdminInbox.tsx",
        "src/pages/mobile/admin/MobileAdminTasks.tsx",
        "src/pages/mobile/crm/SessionActionSheet.tsx",
    ):
        code = _strip_comments((ROOT / rel).read_text(encoding="utf-8"))
        assert "from '../../../components/ui/Sheet'" in code, f"{rel}: не на общем Sheet"
        assert "<Sheet" in code, f"{rel}: шторка не рендерит общий Sheet"
        assert "position: 'fixed', inset: 0" not in code, f"{rel}: вернулся самодельный оверлей"
    # Три шторки с прилипающим низом (сторож C) остаются самодельными, но на
    # токенах: подложка и тень — из дизайн-системы, крестик — 44 px с подписью.
    for name in ("MobileAdminUsers.tsx", "MobileAdminFinance.tsx", "MobileAdminCabinets.tsx"):
        code = _code(ROOT / "src/pages/mobile/admin" / name)
        assert "boxShadow: 'var(--shadow-pop)'" in code, f"{name}: тень шторки мимо токена"
        assert 'aria-label="Закрыть"' in code, f"{name}: у крестика шторки нет подписи"


def test_shell_header_targets_and_no_dead_desktop_button():
    for rel in ("src/pages/mobile/crm/MobileCrmLayout.tsx", "src/pages/mobile/admin/MobileAdminLayout.tsx"):
        code = _code(ROOT / rel)
        assert "minHeight: 44, minWidth: 44" in code, f"{rel}: кнопка «Кабинет» в шапке меньше 44 px"
        assert "width: 28, height: 28" not in code, f"{rel}: снова стрелка 28×28"
        assert 'aria-label="Мой кабинет"' in code
    crm = _code(ROOT / "src/pages/mobile/crm/MobileCrmLayout.tsx")
    assert "sessionStorage.setItem('forceDesktop'" not in crm, \
        "вернулась мёртвая кнопка «десктоп» (App.tsx не читает sessionStorage.forceDesktop)"
    admin = _code(ROOT / "src/pages/mobile/admin/MobileAdminLayout.tsx")
    assert 'label="Клиенты"' in admin and 'label="Главная"' in admin


def test_loading_error_empty_are_distinct():
    """Загрузка ≠ ошибка ≠ пусто: на экранах со списками — Skeleton/ErrorBar/EmptyState."""
    need = {
        "MobileAdminInbox.tsx": ("ErrorBar", "SkeletonList", "EmptyState"),
        "MobileAdminTasks.tsx": ("ErrorBar", "SkeletonList", "EmptyState"),
        "MobileAdminWaitlist.tsx": ("ErrorBar", "SkeletonList", "EmptyState"),
        "MobileAdminDashboard.tsx": ("ErrorBar", "SkeletonList", "EmptyState"),
        "MobileCrmNotes.tsx": ("ErrorBar", "SkeletonList", "EmptyState"),
        "MobileCrmClients.tsx": ("ErrorBar", "SkeletonList", "EmptyState"),
        "MobileCrmSessions.tsx": ("ErrorBar", "SkeletonList", "EmptyState"),
        "MobileCrmToday.tsx": ("ErrorBar", "SkeletonList", "EmptyState"),
    }
    area = {p.name: _code(p) for p in _files()}
    for name, comps in need.items():
        for c in comps:
            assert f"<{c}" in area[name], f"{name}: нет {c}"
    inbox = area["MobileAdminInbox.tsx"]
    assert "!loading && !failed && items.length === 0" in inbox, \
        "при сбое «Заявки» снова пишут «Все заявки разобраны»"


# ─────────────────────────────────────────────────────────────────────────
# Ревью 77087bf: разбор сумм, время кассы по Батуми, кнопка шага в подвале,
# ссылки на полную версию, «Выключить» в «Команде».
# ─────────────────────────────────────────────────────────────────────────

PARSER = "src/pages/mobile/admin/parseMoneyInput.ts"
MONEY_FIELDS = (
    "src/pages/mobile/admin/MobileCloseShiftSheet.tsx",   # факт в кассе
    "src/pages/mobile/admin/MobileAdminUsers.tsx",        # пополнение баланса
    "src/pages/mobile/admin/MobileAdminFinance.tsx",      # операция кассы
    "src/pages/mobile/admin/bookingSheets.tsx",           # цена брони
    "src/pages/mobile/crm/SessionActionSheet.tsx",        # цена сессии CRM
)


def test_money_input_parser_cases():
    """«1 280,50» было 1.28 ₾ при закрытии смены. Живая проверка через node
    (≥ 22.6 умеет .ts); без node — проверки по исходникам ниже."""
    import shutil
    import subprocess
    src = (ROOT / PARSER).read_text(encoding="utf-8")
    assert "export function parseMoneyInput" in src and "import " not in src, \
        "parseMoneyInput должен быть модулем без импортов (сторож гоняет его через node)"
    node = shutil.which("node")
    if not node:
        return
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return
    if (major, minor) < (22, 6):
        return
    cases = ["1 280,50", "1280,5", "1280.50", "1 280", "12abc", "1,2,3", "", "  ", "-5", "12.345", "0", "20"]
    script = (
        f"import('./{PARSER}').then(m => console.log(JSON.stringify("
        f"{cases!r}.map(m.parseMoneyInput))));"
    ).replace("'", '"')
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "-e", script],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"parseMoneyInput не запустился в node: {r.stderr[:300]}"
    got = r.stdout.strip()
    assert got == "[1280.5,1280.5,1280.5,1280,null,null,null,null,null,null,0,20]", \
        f"разбор сумм сломан: {got}"


def test_money_inputs_use_shared_parser():
    for rel in MONEY_FIELDS:
        code = _strip_comments((ROOT / rel).read_text(encoding="utf-8"))
        assert "parseMoneyInput(" in code, f"{rel}: сумма разбирается мимо parseMoneyInput"
        assert "MONEY_INPUT_ERROR" in code, f"{rel}: нет понятной ошибки под полем суммы"
        assert "replace(/[\\s,]/g, '.')" not in code, f"{rel}: вернулся разбор, делавший «1 280,50» → 1.28"
        assert not re.search(r"parseFloat\([^)]*(?:amount|price|raw|actualBalance)", code), \
            f"{rel}: сумма снова через parseFloat"
    sheet = _strip_comments((ROOT / "src/pages/mobile/crm/SessionActionSheet.tsx").read_text(encoding="utf-8"))
    assert "|| 0)" not in sheet, "пустая цена сессии снова сохраняется как 0"
    assert "disabled={parsedPrice === null}" in sheet, "«Сохранить цену» активна при пустом поле"


def test_cashbox_times_in_batumi():
    code = _code(ROOT / "src/pages/mobile/admin/MobileAdminFinance.tsx")
    i = code.find("function TransactionRow")
    row = code[i:code.find("\nfunction ", i + 10)]
    assert "parseUTC(tx.date)" in row and "timeZone: BATUMI_TZ" in row, \
        "время операции кассы снова в поясе браузера (десктоп показывает по Батуми)"
    rng = code[code.find("function getRange"):code.find("\nexport function MobileAdminFinance")]
    assert rng.count("timeZone: BATUMI_TZ") >= 4, "подписи периода кассы не по Батуми"


def test_session_sheet_step_action_in_footer():
    code = _code(ROOT / "src/pages/mobile/crm/SessionActionSheet.tsx")
    assert "footer={footer}" in code, "кнопка шага шторки сессии не в подвале"
    for fn in ("function RescheduleForm", "function PriceForm", "function NotesForm"):
        i = code.find(fn)
        body = code[i:code.find("\nfunction ", i + 10)]
        assert "<Button block" not in body, f"{fn}: главная кнопка снова в прокручиваемом теле"


def test_desktop_links_and_team_wording():
    link = _code(ROOT / "src/pages/mobile/admin/DesktopLink.tsx")
    assert "forceDesktop=1" in link and "minHeight: 44" in link, \
        "ссылка на полную версию без ?forceDesktop=1 уводит по кругу / меньше 44 px"
    kb = _code(ROOT / "src/pages/mobile/admin/MobileAdminKB.tsx")
    assert '<DesktopLink href="/admin/knowledge-base">Открыть полную статью →</DesktopLink>' in kb
    team = _code(ROOT / "src/pages/mobile/admin/MobileAdminTeam.tsx")
    assert "'Выключить' : 'Включить'" in team and "Отключить" not in team
    assert "opacity: m.isActive" not in team, "имя и роль выключенного сотрудника снова бледнее ink-60"
    assert '<DesktopLink href="/admin/team">' in team


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
    print("СТОРОЖ wave1-mstaff: OK" if not failures else f"СТОРОЖ wave1-mstaff УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
