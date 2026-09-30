"""СТОРОЖ wave2-B — «Свободно», календарь, кабинеты, тарифы (волна 2, пакет B, 30.09).

Только чтение исходников и файлов в public/, без сети и базы.

Что ловит:
  НЕЛЬЗЯ  — в MobileFind не тронуты: buildFreeWindows, блокировка повторного
            тапа (inFlightRef/pendingChip), chooseWindow (единственная правка —
            ссылка на анкету через catalogPath), граница 60 дней, occupancyReady.
  G4-04   — результаты на первом экране: фильтры свёрнуты в строку-сводку
            с «Изменить» и живут в шторке; последний выбор запоминается
            в localStorage только внутри try/catch.
  G4-06 / X2-08 — «Сообщить, когда освободится» через общий
            WaitlistSubscribeModal (сам файл ui/* не трогаем).
  G4-04   — «Календарь» без значка внешней ссылки и без липкой кнопки.
  G4-client-mobile-M4 / G4-22 — у календаря шапка «Назад», подсказка и
            «+ Свободно» в свободных часах.
  X3-20   — «залы 7, 8, 9» не возвращается (кабинет 9 закрыт).
  G2-02 / G2-12 / G2-15 / G2-16 / X2-04 — каталожные страницы: в /m без своей
            шапки (MobilePageHeader), на компьютере PublicHeader, ссылки через
            catalogPath, без MinimalLayout; только сдаваемые кабинеты.
  G2-14 / G2-21 — общий PhotoLightbox: Esc, стрелки, свайп, role=dialog.
  Тарифы  — решение владельца: только цена часа из SUBSCRIPTION_PLANS, без
            процентов и зачёркнутых цен; «Оформить» → Telegram с текстом;
            недельной скидки нет; цены в data.ts не менялись.
  X5-17   — у каждого фото кабинета из data.ts есть sm/md WebP-превью.
  Общие правила — шрифт ≥ 12, текст не бледнее ink-60, «вы», без confirm().

    python3 backend/tests/guard_wave2_find_catalog.py
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
SRC = ROOT / "src"

B_FILES = (
    "src/pages/mobile/MobileFind.tsx",
    "src/pages/mobile/MobileCalendar.tsx",
    "src/pages/mobile/MobilePlaces.tsx",
    "src/pages/SubscriptionsPage.tsx",
    "src/pages/LocationDetailsPage.tsx",
    "src/pages/CabinetPage.tsx",
    "src/components/catalog/PhotoLightbox.tsx",
    "src/components/catalog/PhotoStrip.tsx",
    "src/utils/cabinetPhotos.ts",
)
CATALOG_PAGES = ("src/pages/SubscriptionsPage.tsx", "src/pages/LocationDetailsPage.tsx", "src/pages/CabinetPage.tsx")


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)(^|[^:'\"`\\])//.*$", r"\1", src)


def _block(src: str, start: str, end: str) -> str:
    i = src.find(start)
    assert i != -1, f"не нашли «{start}»"
    j = src.find(end, i)
    assert j != -1, f"не нашли конец блока после «{start}»"
    return src[i:j]


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# ── MobileFind: НЕЛЬЗЯ ─────────────────────────────────────────────────

def test_find_protected_logic_untouched():
    """Хэши сняты 30.09 после пакета B. Меняете эти куски — это уже не вёрстка:
    нужен отдельный разбор (двойная бронь, перенос, занятость) и новый хэш."""
    src = _read("src/pages/mobile/MobileFind.tsx")
    assert _sha(_block(src, "function buildFreeWindows(", "\n}\n")) == "8d16c484ca75a0c7", \
        "buildFreeWindows изменилась — расчёт свободных окон трогать нельзя"
    assert _sha(_block(src, "const inFlightRef", "\n    const chipsBusy")) == "fe70d7f6e804df6d", \
        "блокировка повторного тапа (inFlightRef/pendingChip) изменилась"
    assert _sha(_block(src, "async function chooseWindow(", "\n    return (\n")) == "8869fe980be6112b", \
        "chooseWindow изменилась — оформление/перенос/привязка трогать нельзя"


def test_find_occupancy_and_60_days():
    src = _read("src/pages/mobile/MobileFind.tsx")
    assert "const occupancyReady = occupancyStatus === 'ready';" in src
    assert "{occupancyReady && slots.map(" in src, "окна снова видны до загрузки занятости"
    assert "max={fmtDate(new Date(Date.now() + 60 * 24 * 3600 * 1000), 'yyyy-MM-dd')}" in src, \
        "пропала граница 60 дней в выборе даты"


def test_find_application_link_stays_in_app():
    src = _read("src/pages/mobile/MobileFind.tsx")
    assert "navigate(catalogPath(SPECIALIST_APPLICATION_PATH, true))" in src, \
        "«Анкета» из /m/find снова уводит на компьютерную /become-specialist"
    assert "navigate(SPECIALIST_APPLICATION_PATH)" not in src


# ── MobileFind: вёрстка ────────────────────────────────────────────────

def test_find_results_first_filters_in_sheet():
    src = _read("src/pages/mobile/MobileFind.tsx")
    ret = src[src.find("\n    return (\n        <>"):]
    i_summary = ret.find("onClick={() => setFiltersOpen(true)}")
    i_results = ret.find("{occupancyReady && slots.map(")
    i_sheet = ret.find("<Sheet")
    i_when = ret.find('<FieldGroup label="Когда">')
    assert -1 not in (i_summary, i_results, i_sheet, i_when), "не нашли сводку/результаты/шторку фильтров"
    assert i_summary < i_results < i_sheet < i_when, \
        "фильтры снова стоят над результатами — ответ уезжает со первого экрана"
    assert ">\n                            Изменить\n" in ret, "в строке-сводке нет «Изменить»"
    assert "formatRelativeDay(targetDate)" in src and "'оба центра'" in src, "сводка «Сегодня · 1 ч · оба центра» пропала"


def test_find_prefs_in_try_catch():
    src = _read("src/pages/mobile/MobileFind.tsx")
    for fn in ("function readFindPrefs(", "function writeFindPrefs("):
        body = _block(src, fn, "\n}\n")
        assert "localStorage." in body and "try {" in body and "catch" in body, \
            f"{fn} без try/catch — в приватном режиме экран упадёт"
    code = _strip_comments(src)
    uses = len(re.findall(r"localStorage\.", code))
    assert uses == 2, f"localStorage в MobileFind только через readFindPrefs/writeFindPrefs (нашли {uses})"


def test_find_waitlist_and_calendar_link():
    src = _read("src/pages/mobile/MobileFind.tsx")
    code = _strip_comments(src)
    assert "import { WaitlistSubscribeModal } from '../../components/ui/WaitlistSubscribeModal';" in src
    assert "<WaitlistSubscribeModal" in code and "Сообщить, когда освободится" in code
    assert "ExternalLink" not in code, "у «Календаря» снова значок внешней ссылки"
    assert "navigate('/m/calendar')" in code
    assert "залы 7, 8, 9" not in src, "X3-20: кабинет 9 закрыт — «залы 7, 8»"
    assert "GROUP_HALLS_SUB" in code


def test_calendar_back_and_hint():
    src = _read("src/pages/mobile/MobileCalendar.tsx")
    assert "<MobilePageHeader" in src and 'fallbackTo="/m/find"' in src, "у календаря нет «Назад»"
    assert "+ Свободно" in src and "Нажмите на свободный час" in src, "свободные часы снова не выглядят нажимаемыми"
    assert "color: 'transparent'" not in src


# ── Каталожные страницы ────────────────────────────────────────────────

def test_catalog_pages_one_header():
    for rel in CATALOG_PAGES:
        src = _read(rel)
        code = _strip_comments(src)
        assert "<PublicHeader" in code, f"{rel}: на компьютере нет общей PublicHeader"
        assert "<MobilePageHeader" in code and "useInMobileShell()" in code, f"{rel}: в /m нет MobilePageHeader"
        assert "MinimalLayout" not in code, f"{rel}: снова MinimalLayout — вторая шапка в /m"
        assert "logout()" not in code, f"{rel}: снова «Выйти» в шапке страницы"
        assert "navigate(-1)" not in code, f"{rel}: «Назад» через navigate(-1) — выкидывает из приложения (X2-19)"
        # Внутренние ссылки каталога — только через catalogPath.
        for m in re.finditer(r"""to=\{?[`'"](/(?:cabinet|location|specialists|subscriptions|booking-rules|dashboard)\b[^`'"]*)""", code):
            raise AssertionError(f"{rel}: ссылка {m.group(1)} мимо catalogPath — из /m выкинет на сайт")
        assert 'to="/"' not in code and "to='/'" not in code, f"{rel}: ссылка на главную мимо catalogPath"


def test_only_rentable_rooms():
    for rel in ("src/pages/mobile/MobilePlaces.tsx", "src/pages/LocationDetailsPage.tsx",
                "src/pages/CabinetPage.tsx", "src/pages/mobile/MobileCalendar.tsx"):
        assert "isActive !== false" in _read(rel), f"{rel}: показывает закрытые кабинеты (кабинет 9)"
    cab = _read("src/pages/CabinetPage.tsx")
    assert "resource.isActive === false" in cab, "страница закрытого кабинета снова открывается"


def test_lightbox_contract():
    src = _read("src/components/catalog/PhotoLightbox.tsx")
    for must in ("'Escape'", "'ArrowRight'", "'ArrowLeft'", "onTouchStart", "onTouchEnd",
                 'role="dialog"', 'aria-modal="true"', "document.body.style.overflow", "closeRef.current?.focus()"):
        assert must in src, f"PhotoLightbox: пропало {must}"
    for rel in ("src/pages/LocationDetailsPage.tsx", "src/pages/CabinetPage.tsx"):
        assert "<PhotoLightbox" in _read(rel), f"{rel}: своя модалка вместо общего PhotoLightbox"


def test_location_photos_order_and_strip():
    src = _read("src/pages/LocationDetailsPage.tsx")
    order = _block(src, "const ordered = [", "];")
    assert order.find("r.photos?.[0]") < order.find("...commonPhotos"), \
        "G2-14: первыми снова общие фото, а не по кадру каждого кабинета"
    assert "<PhotoStrip" in src and "scrollSnapType" in _read("src/components/catalog/PhotoStrip.tsx")


def test_cabinet_sticky_cta_and_photo_first():
    src = _read("src/pages/CabinetPage.tsx")
    assert ".cabpg-photos { order: -1; }" in src, "на телефоне фото снова после текста"
    assert "Забронировать · <span className=\"num\">{rateLabel}</span>" in src
    assert "position: 'fixed'" in src, "кнопка брони на телефоне снова не липкая"


# ── Тарифы ─────────────────────────────────────────────────────────────

def test_tariffs_hour_price_only():
    src = _read("src/pages/SubscriptionsPage.tsx")
    code = _strip_comments(src)
    assert "SUBSCRIPTION_PLANS.find(x => x.id === copy.dataId)" in code, "цена/часы карточек не из SUBSCRIPTION_PLANS"
    assert "≈ {formatGel(plan.hourPrice)}/ч вместо {formatGel(plan.baseRate)}" in code
    for bad in ("plan.discount", "fullPrice", "line-through", "% к ставке", "savingPct", "до 50%"):
        assert bad not in code, f"тарифы: снова проценты/зачёркнутые цены ({bad}) — решение владельца 30.09"
    for bad in ("Недельная скидка", "WEEKLY_TIERS", "60 дней"):
        assert bad not in code, f"тарифы: вернулось «{bad}» — владелец убрал со страницы"
    assert "https://t.me/UnboxCenter?text=" in code and "Хочу оформить абонемент «${planName}»" in code, \
        "«Оформить абонемент» не ведёт в Telegram с готовым текстом"
    assert "10%" in code and "15%" in code and "20%" in code, "пропала скидка за длительность 10/15/20 %"


def test_data_plans_unchanged():
    data = _read("src/utils/data.ts")
    plans = _block(data, "export let SUBSCRIPTION_PLANS = [", "\n];")
    got = re.findall(r"id: '(\w+)',\s*name: '[^']+',\s*hours: (\d+),(?:\s*bonusHours: (\d+),)?\s*price: (\d+)", plans)
    assert got == [("TRIAL", "4", "", "70"), ("WARM_START", "10", "", "180"),
                   ("REGULAR_PRACTITIONER", "20", "", "350"), ("PRO_PLUS", "40", "2", "650"),
                   ("GROUP_MASTER", "20", "", "450")], f"цены/часы абонементов в data.ts изменились: {got}"


# ── Картинки ───────────────────────────────────────────────────────────

def test_cabinet_photo_previews_exist():
    data = _read("src/utils/data.ts")
    photos = set(re.findall(r"'(/img/cabinets/[^']+/\d\d\.jpg)'", data))
    loc = _read("src/pages/LocationDetailsPage.tsx")
    for slug, count in re.findall(r"slug: '(\w+)', count: (\d+)", loc):
        photos.update(f"/img/cabinets/{slug}/common/{i:02d}.jpg" for i in range(1, int(count) + 1))
    assert len(photos) >= 70, f"мало фото ({len(photos)}) — сторож смотрит не туда"
    missing = []
    for p in sorted(photos):
        base = ROOT / "public" / p.lstrip("/")
        assert base.exists(), f"оригинал {p} удалён"
        for size in ("sm", "md"):
            prev = base.parent / size / (base.stem + ".webp")
            if not prev.exists():
                missing.append(str(prev.relative_to(ROOT)))
    assert not missing, f"нет превью (python3 scripts/make-cabinet-previews.py): {missing[:5]}"
    assert "photoVariant(" in _read("src/pages/mobile/MobilePlaces.tsx"), "миниатюры /m/places снова оригиналы 1280×960"


# ── Общие правила для файлов пакета ─────────────────────────────────────

def test_b_files_follow_rules():
    ty = re.compile(r"(?<![а-яё])(?:ты|тебе|тебя|твой|твоя|твои|твоё|твоего|выбери|нажми|попробуй)(?![а-яё])", re.I)
    pale = re.compile(r"color:\s*(?:GH\.ink(?:20|30|40)|COLOR\.ink(?:05|08|10|20|30|40)\b)")
    for rel in B_FILES:
        code = _strip_comments(_read(rel))
        small = [s for s in re.findall(r"fontSize:\s*'?(\d+(?:\.\d+)?)", code) if float(s) < 12]
        assert not small, f"{rel}: шрифт меньше 12 px: {small}"
        assert not pale.search(code), f"{rel}: бледный текст ({pale.search(code).group(0)})"
        assert not re.search(r"(?<![\w.])(?:window\.)?(?:confirm|prompt|alert)\(", code), f"{rel}: системное окно браузера"
        strings = " ".join(re.findall(r"'[^'\n]*'|\"[^\"\n]*\"|`[^`]*`|>[^<>{}\n]+<", code))
        assert not ty.search(strings), f"{rel}: обращение на «ты»"
        assert "opacity: 0.7" not in code, f"{rel}: текст с прозрачностью 0.7 бледнее ink-60"


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
    print("СТОРОЖ wave2-find-catalog: OK" if not failures else f"СТОРОЖ wave2-find-catalog УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
