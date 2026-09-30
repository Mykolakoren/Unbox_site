"""СТОРОЖ wave1 — публичный сайт и десктопный кабинет клиента на общей основе
(аудит 29.09, волна 1, шаг 2, область «public»).

Файлы области: src/pages/*.tsx (верхний уровень: Explore, Login, BecomeSpecialist,
BookingRules, Specialists, SpecialistProfile, Subscriptions, BonusesInfo,
LocationDetails, Cabinet, DashboardOverview, MyBookings, MyWaitlist, Profile,
Test), src/pages/content/*, src/components/landing/*, src/components/Specialists/*.

Что ловит (только чтение исходников, без сети и базы):
  X3-11  — системные confirm()/prompt()/alert() вместо общего окна.
  X1-09 / G1-18 / G1-23 — текст мельче 12 px (inline fontSize и text-[Npx]).
  X1-03 / X4-02 / G2-11 / G3-12 — бледный текст (GH.ink30/ink20, unbox-grey,
           unbox-dark/≤65, gray-300/400, #999…). Бледное оставлено только для
           разделителей/иконок с пометкой «декор» в той же строке.
  X3-03  — «ты» в текстах для людей (решение владельца: везде «вы»).
  X3-04  — «переаренда / перебронирование / Пересд.» вместо «Пересдать».
  X3-23 / X1-16 — эмодзи вместо иконок.
  X3-18  — служебное «GRID HOUSE» в подвалах публичных страниц.
  G3-04  — гривна ₴ вместо лари.
  X3-copy-tone-M2 / X3-06 — свои карты статусов («Активно», «Ожидает») вместо
           общего словаря (StatusBadge / statusLabel).
  G1-10  — оговорка теста «не является диагнозом» снова 9 px моно-капсом.

    python3 backend/tests/guard_wave1_public.py
"""
import glob
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def _area_files():
    pats = [
        "src/pages/*.tsx",
        "src/pages/content/*.tsx",
        "src/components/landing/*.tsx",
        "src/components/Specialists/*.tsx",
    ]
    out = []
    for p in pats:
        out.extend(sorted(glob.glob(str(ROOT / p))))
    assert len(out) >= 30, f"файлы области не найдены ({len(out)}) — сторож смотрит не туда"
    return out


def _rel(p):
    return os.path.relpath(p, ROOT)


def _strip_comments(src: str) -> str:
    """Убираем комментарии (JSX {/* */}, /* */, //), сохраняя переносы строк,
    чтобы номера строк в сообщениях совпадали с файлом."""
    src = re.sub(r"\{/\*.*?\*/\}", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    src = re.sub(r"(?m)(^|[^:'\"`\\])//.*$", r"\1", src)
    return src


def _hits(pattern, flags=0, keep_line=None):
    """[(файл:строка, текст)] по коду без комментариев."""
    rx = re.compile(pattern, flags)
    found = []
    for f in _area_files():
        raw = open(f, encoding="utf-8").read()
        raw_lines = raw.split("\n")
        code = _strip_comments(raw).split("\n")
        for i, line in enumerate(code):
            if rx.search(line) and not (keep_line and keep_line(raw_lines[i])):
                found.append(f"{_rel(f)}:{i + 1}: {raw_lines[i].strip()[:120]}")
    return found


def _fmt(hits, limit=8):
    return "\n    " + "\n    ".join(hits[:limit]) + (f"\n    …ещё {len(hits) - limit}" if len(hits) > limit else "")


# ─────────────────────────────────────────────────────────────────────────


def test_no_system_dialogs():
    """X3-11: confirm()/prompt()/alert() показывают серое окно «OK / Cancel».
    Вместо них — confirmAction/useConfirmDialog, поле в Sheet, toast."""
    hits = _hits(r"(?<![\w$.])(?:confirm|prompt|alert)\s*\(|window\.(?:confirm|prompt|alert)\s*\(")
    assert not hits, "системные окна браузера вместо общего ConfirmDialog/Sheet:" + _fmt(hits)


def test_no_font_below_12px():
    """Меньше 12 px — нельзя (inline fontSize, fontSize в тернарнике, text-[Npx])."""
    hits = _hits(
        r"fontSize:\s*['\"]?(?:[0-9]|1[01])(?:\.\d+)?(?:px)?['\"]?\s*[,}\s]"
        r"|fontSize:\s*[^,}\n]*\?\s*(?:[0-9]|1[01])\s*:"
        r"|fontSize:\s*[^,}\n]*\?\s*\d+\s*:\s*(?:[0-9]|1[01])\s*[,}]"
        r"|(?<![\w-])text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]"
        r"|fontSize:\s*['\"]0?\.\d+rem"
    )
    assert not hits, "текст мельче 12 px:" + _fmt(hits)


def test_no_pale_text():
    """Текст не бледнее ink-60. Бледное — только линии/иконки/неактивное:
    такая строка помечается комментарием «декор» (или это text-ink-30/20)."""
    hits = _hits(
        r"(?<![A-Za-z])color:\s*(?:GH\.ink(?:30|20|10)\b|COLOR\.ink(?:40|30|20|10)\b)"
        r"|(?<![A-Za-z])color:\s*['\"]#(?:999|aaa|bbb|999999|aaaaaa|bbbbbb|9ca3af|9299[aA]3)['\"]"
        r"|(?<!placeholder:)\btext-unbox-grey\b"
        r"|(?<!placeholder:)\btext-unbox-dark/(?:[1-5]\d|6[0-5])\b"
        r"|(?<!placeholder:)\btext-gray-(?:300|400)\b"
        r"|(?<!placeholder:)\btext-black/(?:[1-5]0)\b",
        keep_line=lambda raw: "декор" in raw,
    )
    assert not hits, "бледный текст (контраст ниже 4.5:1):" + _fmt(hits)


_TY = r"(?i)(?<![а-яё])(?:ты|тебе|тебя|тобой|твой|твоя|твоё|твое|твои|твоих|твоим|твоей|твою|твоего|твоему)(?![а-яё])"
_TY_VERBS = (
    r"(?<![а-яёА-ЯЁ])(?:[Вв]ыбери|[Нн]ажми|[Зз]айди|[Пп]ополни|[Пп]одожди|[Пп]опробуй|[Зз]аполни|[Уу]кажи"
    r"|[Вв]веди|[Нн]апиши|[Зз]агрузи|[Дд]обавь|[Оо]форми|[Зз]абронируй|[Пп]ерейди|[Бб]ронируй|[Рр]асскажи"
    r"|[Оо]ставь|[Нн]ачни|[Пп]ринимай|[Рр]аботай|[Пп]риведи|[Зз]наешь|[Мм]ожешь|[Хх]очешь|[Пп]латишь"
    r"|[Пп]риходишь|[Рр]аботаешь)(?![а-яё])"
)


def test_no_informal_you():
    """Решение владельца: к людям — на «вы» (ни «ты», ни «Выбери/Нажми»)."""
    hits = _hits(_TY) + _hits(_TY_VERBS)
    assert not hits, "обращение на «ты»:" + _fmt(hits)


def test_rerent_is_called_peresdat():
    """Функция «вернуть 50 % за освобождённое время» называется «Пересдать»
    («На пересдаче» / «Пересдана»). Регулярка, которая ищет старое слово в
    причине отмены с сервера, — не текст для людей, её не считаем."""
    def is_regex_literal(raw):
        return bool(re.search(r"/[^/\n]*переаренд[^/\n]*/[gimsuy]*\.test\(", raw))
    hits = _hits(r"(?i)переаренд|перебронир|Пересд\.", keep_line=is_regex_literal)
    assert not hits, "старые слова вместо «Пересдать»:" + _fmt(hits)


def test_no_emoji_icons():
    """Эмодзи как иконки запрещены (PRODUCT.md) — только Lucide."""
    hits = _hits(r"[☀-➿\U0001F300-\U0001FAFF⭐⌛⏱⏳]")
    assert not hits, "эмодзи в интерфейсе вместо иконок Lucide:" + _fmt(hits)


def test_no_internal_brand_or_hryvnia():
    """«GRID HOUSE» — внутреннее имя дизайн-системы, клиентам не показываем;
    ₴ — гривна, у нас лари (G3-04)."""
    hits = _hits(r"GRID HOUSE") + _hits(r"₴|\\u20B4")
    assert not hits, "«GRID HOUSE» в подвале или знак гривны:" + _fmt(hits)


def test_statuses_come_from_dictionary():
    """Своя карта статусов в «Обзоре» показывала «ждём подтверждения» как
    «Активно»; «Мои бронирования» — «✅ Активно / Ожидает / Завершено»."""
    for rel in ("src/pages/DashboardOverview.tsx", "src/pages/MyBookingsPage.tsx"):
        src = _strip_comments((ROOT / rel).read_text(encoding="utf-8"))
        assert "StatusBadge" in src, f"{rel}: статус брони не через StatusBadge"
        for old in ("'Активно'", "'Завершено'", "> Ожидает<", "Активно'", "statusConfig.confirmed"):
            assert old not in src, f"{rel}: снова своя подпись статуса {old}"


def test_test_disclaimer_readable():
    """G1-10: оговорка «не является медицинским диагнозом» была 9 px капсом
    с контрастом ~2:1. Должна читаться: обычный текст, ≥ 14 px."""
    src = (ROOT / "src/pages/TestPage.tsx").read_text(encoding="utf-8")
    i = src.find("не&nbsp;является медицинским диагнозом")
    assert i != -1, "TestPage: оговорка о диагнозе пропала или снова капсом"
    block = src[src.rfind("<p", 0, i):i]
    m = re.search(r"fontSize:\s*(\d+)", block)
    assert m and int(m.group(1)) >= 14, "TestPage: оговорка о диагнозе мельче 14 px"
    assert "ink80" in block or "GH.ink," in block, "TestPage: оговорка о диагнозе бледнее ink-80"


def test_waitlist_error_is_not_empty():
    """Сбой загрузки «Слежу за слотами» показывал «Подписок пока нет»."""
    src = (ROOT / "src/pages/MyWaitlistPage.tsx").read_text(encoding="utf-8")
    assert "ErrorBar" in src and "loadError" in src, "MyWaitlistPage: ошибка загрузки снова выглядит как «пусто»"
    assert "SkeletonList" in src, "MyWaitlistPage: пока грузится — снова спиннер вместо силуэтов"


def test_post_list_header_fits_narrow_screen():
    """Ревью 30.09: на 375–390 px подпись раздела в шапке /news и /articles
    слипалась со ссылкой меню («новостиНОВОСТИ»). Суть: на телефоне у логотипа
    нет подписи раздела, меню не вылезает за экран, ссылки — 44 px.

    Волна 2 (пакет C): своя шапка ленты заменена общей PublicHeader — на узком
    экране она сама сворачивает меню в «Меню» (Sheet, строки 44 px) и не
    рисует подписи раздела у логотипа. Поэтому проверяем: своей <header>
    больше нет, шапка — PublicHeader, подпись {copy.label} не стоит рядом
    с логотипом, строка разделов переносится и её ссылки — 44 px."""
    src = (ROOT / "src/pages/content/PostListPage.tsx").read_text(encoding="utf-8")
    assert "<PublicHeader" in src, "PostListPage: шапка не общая (PublicHeader)"
    assert "<header" not in src, "PostListPage: снова своя шапка вместо PublicHeader"
    i = src.find("<PublicHeader")
    j = src.find("/>\n", i)
    header = src[i:j]
    assert "{copy.label}" not in header, "PostListPage: подпись раздела снова в шапке рядом с меню"
    assert "flexWrap: 'wrap'" in header, "PostListPage: строка разделов не переносится на узком экране"
    assert "minHeight: 44" in src, "PostListPage: ссылки разделов на телефоне ниже 44 px"
    ph = (ROOT / "src/components/public/PublicHeader.tsx").read_text(encoding="utf-8")
    assert "minHeight: 44" in ph and ">\n                        Меню\n" in ph, \
        "PublicHeader: на телефоне нет кнопки «Меню» или строки меню ниже 44 px"


def _data_cabinets():
    """{номер кабинета: (вместимость, активен)} из src/utils/data.ts."""
    data = (ROOT / "src/utils/data.ts").read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r"\{\s*id: '[^']+',\s*name: 'Кабинет (\d+)',(.*?)\n    \},", data, re.S):
        body = m.group(2)
        cap = re.search(r"capacity:\s*(\d+)", body)
        out[int(m.group(1))] = (int(cap.group(1)) if cap else 0, "isActive: false" not in body)
    return out


def test_individual_cabinets_list_matches_data():
    """«Индивидуальный кабинет — Кабинеты 1–8» было неправдой: 7 и 8 —
    групповые (35 ₾/час), 3 и 4 нет. Список берётся из RESOURCES."""
    src = _strip_comments((ROOT / "src/pages/SubscriptionsPage.tsx").read_text(encoding="utf-8"))
    assert "Кабинеты 1–8" not in src and "Кабинеты 1-8" not in src, "SubscriptionsPage: снова «Кабинеты 1–8»"
    assert re.search(r"RESOURCES\s*\n?\s*\.filter\(r => r\.type === 'cabinet' && \(r\.capacity \?\? 0\) < 20 && r\.isActive !== false\)", src), \
        "SubscriptionsPage: список индивидуальных кабинетов не из данных"
    cabs = _data_cabinets()
    assert cabs, "не разобрал кабинеты в data.ts"
    for group_room in (7, 8):
        assert group_room in cabs and cabs[group_room][0] >= 20, \
            f"data.ts: кабинет {group_room} больше не групповой — пересмотрите фильтр «вместимость < 20»"
    # Кабинет 9 закрыт (владелец, 30.09): на тарифах только сдаваемые.
    individual = sorted(n for n, (cap, active) in cabs.items() if cap < 20 and active)
    assert individual == [1, 2, 5, 6], f"сдаваемые индивидуальные кабинеты по data.ts: {individual} (ждали 1, 2, 5, 6)"


def test_phq_orange_result_uses_warn_pair():
    """Ревью 30.09: «оранжевый» результат теста был красным текстом на
    янтарном фоне. Вся карточка — пара warn (--status-warn-fg/bg)."""
    src = (ROOT / "src/pages/TestPage.tsx").read_text(encoding="utf-8")
    m = re.search(r"^\s*orange:\s*\{(.*)\},\s*$", src, re.M)
    assert m, "TestPage: нет цвета для «orange»"
    line = m.group(1)
    assert "--status-warn-fg" in line and "--status-warn-bg" in line, "TestPage: «orange» не на паре warn"
    assert "STATUS.danger" not in line and "STATUS.pending" not in line, "TestPage: «orange» смешивает пары цветов"


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
    print("СТОРОЖ wave1-public: OK" if not failures else f"СТОРОЖ wave1-public УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
