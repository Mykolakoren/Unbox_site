"""СТОРОЖ wave2-C — главная, вход и регистрация, специалисты (аудит 29.09, волна 2).

Только чтение исходников, без сети и базы.

Что ловит:
  G1-07 / X3-20 — KPI-полоса StatStrip и «02 Кабинета» (центры ≠ кабинеты).
  G1-06   — запасное «17 специалистов» до ответа сервера и «1 специалистов».
  G1-08 / G1-21 / G2-17 / X2-11 — у публичных страниц своя шапка, на телефоне
            нет меню и цен; главная, вход, каталог, профиль, новости, правила,
            тесты — на общей PublicHeader.
  G1-20   — «Новости» и «Статьи» в меню, когда там пусто.
  G1-05   — «+ Забронировать» в режиме клиента уводила в аренду кабинетов.
  G1-25 / X5-10 — Leaflet в каждой загрузке (мёртвые импорты + vendor-leaflet).
  X5-05   — пустой #root до загрузки приложения.
  G1-14 / X4-14 — вход без <label htmlFor>, autocomplete, h1, «глазок» 14 px
            вне Tab, ошибка без role=alert.
  G1-landing-entry-M2 — «Войти через Telegram» на регистрации (403-тупик).
  wave0-H — регистрация не передаёт роль/права/баланс; ?redirect= безопасный.
  G2-04   — запись к специалисту без контакта и с тостом «Записано.» вместо
            экрана подтверждения; для вошедшего форма пустая.
  G2-22   — слоты — div с onClick (без клавиатуры).
  G2-catalog-M2 — «Онлайн» показывал очные слоты; филиалы по OFFLINE_ROOM.
  G2-08   — сырые направления (GENERAL_PSYCHOLOGY) в карточке и профиле.
  G2-09   — фильтр профиля только по началу tagline.
  G2-03   — в /m у профиля 104 px пустоты, нет липкой «Записаться».

    python3 backend/tests/guard_wave2_public.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
SRC = ROOT / "src"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)(^|[^:'\"`\\])//.*$", r"\1", src)
    return src


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


def _fn_body(src: str, start: str, end: str = "\nfunction ") -> str:
    i = src.find(start)
    assert i != -1, f"не нашёл {start!r}"
    j = src.find(end, i + len(start))
    return src[i:j if j != -1 else len(src)]


LANDING = "src/components/landing/GridHouseLanding.tsx"
EXPLORE = "src/pages/ExplorePage.tsx"
LOGIN = "src/pages/LoginPage.tsx"
GRID = "src/components/Specialists/SpecialistBookingChessboardGrid.tsx"
PROFILE = "src/pages/SpecialistProfilePage.tsx"


# ─────────────────────────────────────────────────────────────────────────
# Главная
# ─────────────────────────────────────────────────────────────────────────

def test_landing_has_no_stat_strip_and_no_fake_count():
    src = _code(LANDING)
    assert "StatStrip" not in src, "главная: снова KPI-полоса StatStrip («02 Кабинета», «∞ онлайн»)"
    assert "'Кабинета'" not in src and "label: 'Кабинета'" not in src, "главная: центры снова подписаны «Кабинета»"
    assert not re.search(r"\|\|\s*17\b", src), "главная: снова запасное «17 специалистов» до ответа сервера"
    assert not re.search(r"\?\?\s*17\b", src), "главная: снова запасное «17»"
    assert "ruCountWord(" in src, "главная: число специалистов без склонения («1 специалистов»)"


def test_landing_count_not_from_filtered_list():
    """Заголовок не зависит от фильтра категорий: список грузится один раз."""
    src = _code(LANDING)
    body = _fn_body(src, "function ClientLanding(")
    assert "?category=" not in body, "главная: фильтр снова отдельным запросом — число в заголовке «прыгает»"
    assert "totalSpecialists={specialists ? specialists.length : null}" in body, \
        "главная: число в заголовке снова берётся из отфильтрованного списка"


def test_landing_uses_public_header_with_menu():
    src = _code(LANDING)
    assert "<PublicHeader" in src, "главная: своя шапка вместо общей PublicHeader (на телефоне нет «Меню»)"
    assert "hideOnNarrow" not in src, "главная: пункты меню снова прячутся на телефоне"
    assert "<header" not in src, "главная: снова своя <header>"


def test_empty_posts_hidden_from_menus():
    """«Статьи»/«Новости» — только если там есть публикации."""
    hook = _read("src/pages/content/usePostsAvailability.ts")
    assert "postsApi.list(type, 1)" in hook, "проверка наличия публикаций не через postsApi"
    land = _code(LANDING)
    for link, flag in (('to="/articles"', "posts.article &&"), ('to="/news"', "posts.news &&")):
        for m in re.finditer(re.escape(link), land):
            line_start = land.rfind("\n", 0, m.start())
            assert flag in land[line_start:m.start()], f"главная: ссылка {link} без проверки, что там есть публикации"
    lst = _code("src/pages/content/PostListPage.tsx")
    assert "available.news" in lst and "available.article" in lst, \
        "лента: соседний раздел в меню без проверки, что там есть публикации"


def test_welcome_gate_actions_and_login():
    src = _code(LANDING)
    gate = _fn_body(src, "function WelcomeGate(")
    assert "Войти как клиент" not in gate and "Войти как специалист" not in gate, \
        "экран выбора: кнопки снова «Войти как…», хотя ничего не входят"
    assert 'to="/login"' in gate, "экран выбора: в шапке нет «Войти»"
    assert "Выберите режим, чтобы продолжить" not in gate
    assert "<h1" in gate, "экран выбора: нет h1"
    col = _fn_body(src, "function GateColumn(")
    assert "outline: 'none'" not in col, "экран выбора: outline:none снова прячет фокус с клавиатуры"
    assert "onFocus=" in col, "экран выбора: фокус с клавиатуры не инвертирует карточку"


def test_logged_in_user_skips_gate():
    src = _code(EXPLORE)
    assert "storedMode ?? roleMode" in src, "вошедший снова видит экран «Я клиент / Я специалист»"


def test_client_mode_has_no_rental_fab():
    src = _code(EXPLORE)
    assert "visitorMode !== 'specialist'" in src, "плавающая кнопка снова видна в режиме «клиент»"
    assert "navigate('/m/find')" not in src, "плавающая кнопка снова ведёт клиента в аренду /m/find"
    assert "borderRadius: 999" not in src, "плавающая кнопка снова «пилюля» вне дизайн-системы"


def test_landing_specialist_mode_for_user_without_application():
    src = _code(LANDING)
    body = _fn_body(src, "function SpecialistRoute(")
    assert "useSpecialistApplicationStatus(" in body, "режим «специалист»: статус анкеты не учитывается"
    assert "Заполнить анкету →" in body, "вошедший без анкеты снова видит «Выберите кабинет»"
    assert "/login?register=1&redirect=${encodeURIComponent('/become-specialist')}" in body, \
        "«Подать заявку» снова без возврата к анкете (wave0-H)"


def test_no_leaflet_anywhere_on_critical_path():
    explore = _code(EXPLORE)
    assert "leaflet" not in explore, "ExplorePage снова тянет Leaflet (карты на «/» нет)"
    for dead in ("TeamSection", "SpecialistsSection", "WelcomeOverlay", "SelfTestsSection", "MapContainer"):
        assert dead not in explore, f"ExplorePage: снова мёртвый импорт {dead}"
    vite = _code("vite.config.ts")
    assert "vendor-leaflet" not in vite, "vendor-leaflet снова в manualChunks → modulepreload на каждой странице"


def test_index_html_has_boot_placeholder():
    html = _read("index.html")
    m = re.search(r'<div id="root">(.*?)</div>\s*<script type="module"', html, re.S)
    assert m and 'class="boot"' in m.group(1), "index.html: #root снова пустой до загрузки"
    assert "#FAFAF7" in html and "#F4F4F2" in html, "index.html: заглушка не на токенах бумаги"


# ─────────────────────────────────────────────────────────────────────────
# Вход и регистрация
# ─────────────────────────────────────────────────────────────────────────

def test_login_form_accessibility():
    src = _code(LOGIN)
    field = _fn_body(src, "function GHField(")
    assert "<label htmlFor={id}" in field, "вход: подписи полей снова div, не связаны с полями"
    assert "autoComplete={autoComplete}" in field, "вход: у полей нет autocomplete"
    for ac in ("'current-password'", "'new-password'", 'autoComplete="name"', 'autoComplete="tel"'):
        assert ac in src, f"вход: нет autocomplete {ac}"
    assert "tabIndex={-1}" not in src, "вход: «глазок» снова вне Tab"
    assert "aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}" in src, "вход: «глазок» без названия"
    assert "width: 44" in src and "height: 44" in src, "вход: «глазок» меньше 44 px"
    assert 'role="alert"' in src, "вход: ошибка не озвучивается (нет role=alert)"
    assert src.count("<h1") >= 2, "вход: нет h1 (десктоп и телефон)"
    assert "'••••••••'" not in src and '"••••••••"' not in src, "вход: точки в placeholder пароля выглядят как введённый пароль"


def test_registration_copy_and_no_telegram():
    src = _code(LOGIN)
    assert "Новый специалист." not in src, "регистрация снова «Новый специалист.» для всех"
    assert "Резиденты и клиенты" not in src, "вход: снова внутренний жаргон «Резиденты и клиенты»"
    i = src.find("<TelegramLoginButton")
    assert i != -1, "вход: пропала кнопка Telegram на экране входа"
    before = src[max(0, i - 400):i]
    assert "{!isRegistering && (" in before, "регистрация: снова «Войти через Telegram» (аккаунт через него не создаётся)"
    assert "Работает, если Telegram уже привязан в профиле." in src, "вход: нет пояснения к кнопке Telegram"


def test_register_payload_has_no_privileges():
    """При регистрации уходят только email, пароль, имя и телефон."""
    src = _code(LOGIN)
    m = re.search(r"await register\(\{(.*?)\}\)", src, re.S)
    assert m, "не нашёл вызов register({...})"
    keys = set(re.findall(r"(\w+)\s*:", m.group(1)))
    assert keys == {"email", "password", "name", "phone"}, f"регистрация передаёт лишнее: {sorted(keys)}"
    for bad in ("role", "permissions", "balance", "isAdmin", "creditLimit"):
        assert bad not in m.group(1), f"регистрация передаёт {bad}"


def test_login_redirect_still_safe():
    src = _read(LOGIN)
    assert "safeRedirectPath(new URLSearchParams(window.location.search).get('redirect'))" in src
    assert "redirectTo === '/m/become-specialist'" in src, "подсказка про анкету не срабатывает для /m/become-specialist"


# ─────────────────────────────────────────────────────────────────────────
# Специалисты
# ─────────────────────────────────────────────────────────────────────────

def test_specializations_through_label_helper():
    for rel in ("src/components/Specialists/SpecialistCard.tsx", PROFILE, "src/pages/SpecialistsPage.tsx"):
        src = _code(rel)
        assert "specializationLabels(" in src, f"{rel}: направления снова сырыми ключами (GENERAL_PSYCHOLOGY)"
    card = _code("src/components/Specialists/SpecialistCard.tsx")
    assert "specialist.specializations.slice(" not in card, "карточка: снова сырые specializations.slice"
    prof = _code(PROFILE)
    assert "specialist.specializations.map(" not in prof, "профиль: снова сырые specializations.map"


def test_catalog_role_filter_matches_stem():
    src = _code("src/pages/SpecialistsPage.tsx")
    assert ".startsWith(roleFilter" not in src, "каталог: роль снова только по началу tagline"
    assert "matchesRole(" in src, "каталог: нет поиска роли по основе слова"
    assert "Сбросить фильтры" in src, "каталог: в пустом результате нет «Сбросить фильтры»"
    assert "<Chip" in src, "каталог: фильтры не на общем Chip"
    assert "Все профили" not in src


def test_catalog_two_columns_on_phone():
    src = _code("src/pages/SpecialistsPage.tsx")
    assert "repeat(2, minmax(0, 1fr))" in src and "compact={narrow}" in src, \
        "каталог: на телефоне снова одна колонка на 23 экрана"


def test_public_pages_use_public_header():
    for rel in (LOGIN, "src/pages/SpecialistsPage.tsx", PROFILE, "src/pages/BookingRulesPage.tsx",
                "src/pages/content/PostListPage.tsx", "src/pages/content/PostDetailPage.tsx", "src/pages/TestPage.tsx"):
        src = _code(rel)
        assert "<PublicHeader" in src, f"{rel}: своя шапка вместо общей PublicHeader"
    test_page = _code("src/pages/TestPage.tsx")
    assert "navigate(-1)" not in test_page, "тест: «Назад» снова navigate(-1) — уводит с сайта"


def test_booking_requires_contact_and_prefills():
    src = _code(GRID)
    assert "if (!phone && !telegram)" in src, "запись: снова можно записаться без телефона и Telegram"
    assert "currentUser.phone" in src and "currentUser.name" in src, "запись: вошедшему не подставляются имя и телефон"
    assert "toast.success('Записано.')" not in src, "запись: снова тост «Записано.» вместо экрана подтверждения"
    assert "Вы записаны: {specialistName}" in src, "запись: нет экрана «Вы записаны: специалист, дата, время»"
    assert "scrollIntoView" in src, "запись: форма не прокручивается в видимость после выбора времени"


def test_booking_request_fields_unchanged():
    """Поля запроса те же (wave0-A): Telegram — в notes, не новым полем."""
    src = _code(GRID)
    m = re.search(r"const data: AppointmentCreate = \{(.*?)\};", src, re.S)
    assert m, "не нашёл тело запроса записи"
    keys = set(re.findall(r"(?m)^\s+(\w+)\s*:", m.group(1)))
    assert keys <= {"clientName", "clientPhone", "clientEmail", "date", "startTime", "locationId", "notes", "duration"}, \
        f"запрос записи с неизвестными полями: {sorted(keys)}"
    api = _read("src/api/specialists.ts")
    assert "telegram" not in re.search(r"export interface AppointmentCreate \{(.*?)\n\}", api, re.S).group(1).lower(), \
        "AppointmentCreate расширен — сервер такого поля не знает"


def test_slots_are_buttons():
    src = _code(GRID)
    assert "onClick={slot ? () => setSelectedSlot(slot) : undefined}" not in src, "слоты снова div с onClick"
    assert not re.search(r"<div[^>]*onClick=\{\(\) => setSelectedSlot\(slot\)\}", src), "слот на телефоне снова div"
    assert src.count("aria-pressed={isSelected}") >= 2, "слоты не кнопки с aria-pressed (десктоп и телефон)"
    assert "<Field" in src, "поля записи не на общем Field (подпись не связана с полем)"


def test_online_filter_shows_only_online():
    src = _code(GRID)
    assert "formats.includes('OFFLINE_ROOM')" not in src, "запись: центры снова по устаревшему OFFLINE_ROOM"
    assert "allSlots.filter(s => !s.locationId)" in src, "запись: «Онлайн» снова показывает очные слоты"
    assert "Ближайшее свободное" in src, "запись: пустая неделя без подсказки ближайшего окна"


def test_profile_mobile_first_screen():
    src = _code(PROFILE)
    assert "paddingTop: '104px'" not in src, "профиль: снова 104 px пустоты сверху"
    assert "paddingTop: inShell ? 16 : 0" in src
    assert "calc(72px + env(safe-area-inset-bottom, 0px))" in src, "профиль: липкая «Записаться» не над нижним меню /m"
    assert "ОТ ПЕРВОГО ЛИЦА" not in src and "ID ·" not in src
    assert "bg-unbox-light" not in src and "animate-spin" not in src, "профиль: снова мятный фон со спиннером"
    assert "toCatalog('/specialists')" in src, "профиль: «Назад к списку» снова ведёт мимо каталога /m"


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
    print("СТОРОЖ wave2-public: OK" if not failures else f"СТОРОЖ wave2-public УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
