"""СТОРОЖ вида клиентской части /m — фаза 3 (09.11).

Ревью client-design (09.11) + «Как собирать экран» (docs/DESIGN-SYSTEM.md).
Только чтение исходников, без сети и базы. Проверяет, что экраны клиента:

  * собраны из общих деталей: списки — ListGroup/ListRow, итоги — SummaryCard,
    шапки — MobilePageHeader, выбор — Chip/ChoiceCard;
  * не рисуют «выбранное» и крупные плиты чёрным (COLOR.ink): в тёмной теме
    это белые слепящие прямоугольники; выбранное — accent-soft + рамка accent;
  * скругляют только 8 / 16 / круг (RADIUS.control / RADIUS.sheet / SHAPE.pill);
  * каталожные страницы внутри /m (анкета специалиста, центр, кабинет, тарифы,
    правила) имеют «мобильную кожу», не меняя компьютерный вид.

    python3 backend/tests/guard_client_design_2026_11.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
M = "src/pages/mobile/"

# Экраны клиентского /m (без /m/crm и /m/admin).
CLIENT_FILES = [
    "MobileLayout.tsx", "MobileToday.tsx", "MobileMyBookings.tsx", "MobileFind.tsx",
    "MobileCheckout.tsx", "BookingDetailSheet.tsx", "MobileProfile.tsx", "MobileProfileEdit.tsx",
    "MobileSubscription.tsx", "MobileBonuses.tsx", "MobileBalance.tsx", "MobileCalendar.tsx",
    "MobilePlaces.tsx", "MobileSpecialists.tsx", "NotificationsBell.tsx", "OnboardingTour.tsx",
    "InstallBanner.tsx", "LoadStates.tsx", "SwipeRow.tsx", "TelegramConnectCard.tsx",
    "ClientPickerSheet.tsx", "PullIndicator.tsx",
]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(rel: str) -> str:
    """Исходник без комментариев (// и /* */) — проверяем код, а не пояснения."""
    src = _read(rel)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)^\s*//.*$", "", src)
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    return src


def test_screens_use_shared_parts():
    need = {
        "MobileToday.tsx": ["<MobilePageHeader", "<ListGroup", "<ListRow"],
        # 09.11 фаза 3 (общие файлы): строки броней — сам ListRow (as="div" внутри SwipeRow), без ручных ui-row__*
        "MobileMyBookings.tsx": ["<MobilePageHeader", "<ListGroup", "<ListRow", 'as="div"', "priceTrail("],
        "MobileFind.tsx": ["<MobilePageHeader", "<ChoiceCard", "<ChoiceGroup", "<Chip"],
        "MobileCheckout.tsx": ["<MobilePageHeader", "<ChoiceCard"],
        "BookingDetailSheet.tsx": ["<ListGroup bare", "<ListRow", "<ChoiceCard"],
        "MobileProfile.tsx": ["<ListGroup", "<ListRow", "<ChoiceCard"],
        "MobileSubscription.tsx": ["<SummaryCard", "<MobilePageHeader"],
        "MobileBonuses.tsx": ["<SummaryCard", "<ListGroup", "<Segmented"],
        "MobileBalance.tsx": ["<SummaryCard", "<ListGroup", "tone=\"flow\"", "tone=\"balance\""],
        "MobileSpecialists.tsx": ["<MobilePageHeader", "<ListGroup", "kind=\"search\""],
        "MobilePlaces.tsx": ["<ListGroup", "<ListRow"],
        "NotificationsBell.tsx": ["<ListGroup bare", "<ListRow"],
        "MobileCalendar.tsx": ["<Chip"],
        "OnboardingTour.tsx": ["<Button"],
    }
    for f, parts in need.items():
        src = _code(M + f)
        for p in parts:
            assert p in src, f"{f}: нет {p} — экран снова собран из самодельных блоков"


def test_no_black_selected_or_slabs():
    # «Выбрано»/плита чернилами: background: … ? COLOR.ink : … / background: COLOR.ink,
    bg_ink = re.compile(r"background:\s*(?:[^,\n}]*\?\s*)?COLOR\.ink\s*[,:}\n]")
    for f in CLIENT_FILES:
        src = _code(M + f)
        m = bg_ink.search(src)
        assert not m, f"{f}: чёрная заливка ({m.group(0).strip()}) — выбранное accent-soft, плита --color-panel"
        assert not re.search(r"(?<!\?)\?\s*COLOR\.onInk\s*:", src), f"{f}: текст «на чёрном выбранном»"
    gate = _code("src/components/SpecialistGate.tsx")
    mob = gate[gate.find("if (variant === 'mobile')"):]
    mob = mob[:mob.find("\n    return (", 10)]
    assert "COLOR.ink," not in mob.split("<Button")[0].split("background:")[-1], "карточка анкеты: чёрная кнопка"
    assert "<Button" in mob, "карточка анкеты в /m: главная кнопка — общий Button"


def test_radii_only_8_16_circle():
    lit = re.compile(r"borderRadius:\s*(\d+)\b")
    for f in CLIENT_FILES:
        src = _code(M + f)
        for v in lit.findall(src):
            assert int(v) in (0, 8, 16, 999, 9999), f"{f}: скругление {v} — на телефоне только 8 / 16 / круг"
        assert not re.search(r"borderRadius:\s*'(?:1[0-4]|[2-7]|2[0-9])px", src), f"{f}: скругление вне шкалы"


def test_font_sizes_on_scale():
    lit = re.compile(r"fontSize:\s*(\d+(?:\.\d+)?)\b")
    for f in CLIENT_FILES:
        src = _code(M + f)
        for v in lit.findall(src):
            assert float(v) in (12, 14, 16, 20, 28, 40), f"{f}: размер шрифта {v} вне шкалы 12/14/16/20/28/40"


def test_layout_paper_and_skeleton():
    src = _code(M + "MobileLayout.tsx")
    assert "background: COLOR.paper," in src, "колонка /m — тёплая бумага (карточки видны без рамок)"
    assert "animate-spin" not in src and "<SkeletonList" in src, "пока грузится пользователь — каркас, не спиннер"


def test_bookings_rows_quiet():
    src = _code(M + "MobileMyBookings.tsx")
    assert "inset 3px 0 0" not in src, "полоса «сегодня» вернулась (резалась скруглением, белая в тёмной теме)"
    assert 'variant="quiet"' in src and 'size="sm"' in src and "<Repeat" in src, "«Повторить» — тихая иконка в строке"
    assert "series.length > 0 ? `Серии · ${series.length}`" in src, "«Серии · 0» снова показывает ноль"
    badges = src[src.find("function rowBadges"):]
    badges = badges[:badges.find("\n}\n")]
    assert "paymentStatus === 'waived'" in badges and "!== 'pending'" not in badges, "«Оплачено» у каждой строки — шум"


def test_find_wall_and_filters():
    src = _code(M + "MobileFind.tsx")
    assert "repeat(auto-fill, minmax(100px, 1fr))" in src, "плитки «Свободно» снова разной ширины"
    assert "SLOT_ROW_LIMIT" in src and "ещё {hidden}" in src, "длинная строка кабинетов не сворачивается"
    assert 'layout="tile"' in src and "columns={3}" in src, "тип помещения — три плитки ChoiceCard"
    assert "ui-chip-row--scroll" in src, "ряд дней без затухания справа"
    assert "function CheckCard" not in src, "самодельная карточка с чёрной галочкой вернулась"


def test_notifications_calm():
    src = _code(M + "NotificationsBell.tsx")
    assert "STATUS.pending.bg" not in src, "непрочитанное снова залито янтарём"
    # 09.11 фаза 3 (общие файлы): счётчик — общий Counter (один вид во всём приложении), тон accent.
    assert "STATUS.danger" not in src and '<Counter value={unread} tone="accent"' in src, "счётчик колокольчика — бирюза, не «долг»"


def test_sheet_one_primary_and_rule_note():
    src = _code(M + "BookingDetailSheet.tsx")
    assert "function Field(" not in src, "серые плашки «ГДЕ/ОПЛАТА» вернулись"
    assert "ruleNote" in src and "background: COLOR.sunken, borderRadius: 12" not in src, "правило — подписью, без серой заливки"
    assert "<PrimaryAction" in src, "главное действие шторки — одна бирюзовая кнопка"


def test_catalog_mobile_skin():
    sp = _code("src/pages/SpecialistProfilePage.tsx")
    assert "if (inShell) {" in sp and 'title="Специалист"' in sp and "<ListGroup" in sp, "анкета специалиста в /m без мобильной кожи"
    assert "ui-badge--" in sp, "бирка «Рекомендованный» в /m — статусные токены, не мятный Tailwind"
    loc = _code("src/pages/LocationDetailsPage.tsx")
    assert 'title="Кабинеты и пространства"' in loc and "radius={inShell ? RADIUS.sheet : 0}" in loc
    assert "borderBottom: inShell ? 'none'" in loc, "центр в /m: чёрная черта под заголовком"
    cab = _code("src/pages/CabinetPage.tsx")
    assert "inShell={inShell}" in cab and "flex: '0 0 200px'" in cab, "кабинет в /m: «Другие кабинеты» — лента 200×150"
    assert "photos={photos} onOpen={i => setLightbox(i)} altFor={altFor} radius={RADIUS.sheet}" in cab, "одна карусель 4:3"
    subs = _code("src/pages/SubscriptionsPage.tsx")
    assert "M_GROUP" in subs and "border: plan.popular ? `1px solid ${COLOR.accent}`" in subs, "тарифы в /m: рамка «Популярного» — accent"
    assert "className=\"ui-overline\"" in subs, "тарифы в /m: подписи Sans-капсом"
    rules = _code("src/pages/BookingRulesPage.tsx")
    assert "MobileSkin" in rules and "textDecoration: 'underline'" not in rules, "правила в /m: подчёркивание / моно-подписи"
    # Компьютерный вид не тронут: Grid House-константы на месте.
    assert "border: plan.popular ? `2px solid ${GH.ink}`" in subs, "тарифы на компьютере: изменился вид"
    assert "fontFamily: GH_MONO" in sp, "анкета на компьютере: изменился вид"


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
    print("СТОРОЖ вида клиента (фаза 3): OK" if not failures else f"СТОРОЖ вида клиента УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
