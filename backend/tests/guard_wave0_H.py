"""СТОРОЖ wave0-H — новый психолог с телефона и возврат после входа (аудит 29.09).

Что ловит:
  X2-05 / G1-02  — вход игнорировал ?redirect=: после входа человек терял,
                   куда шёл (анкета специалиста, выбранный кабинет); проверки
                   входа отправляли на голый /login.
  X2-13          — «Подать заявку →» на лендинге вела на регистрацию, а после
                   неё — в кабинет клиента; с телефона анкету было не найти.
  X2-ia-navigation-M1 / G1-landing-entry-M1
                 — в /m новичок (роль user) проходил весь мастер брони и
                   получал 403 на последней кнопке, ссылки на анкету не было.
  G3-client-desktop-M1
                 — то же на компьютере: /checkout пускал к «Оплатить».
  G1-01          — на странице анкеты висели заглушки «__ ₾ / __».

Без сети и без базы (только чтение исходников):

    python3 backend/tests/guard_wave0_H.py
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


def _fn_body(src: str, start: str, end: str) -> str:
    i = src.find(start)
    assert i != -1, f"не нашёл {start!r}"
    j = src.find(end, i + len(start))
    return src[i:j if j != -1 else len(src)]


# ─────────────────────────────────────────────────────────────────────────
# G1-01 — никаких заглушек цены на сайте.
# ─────────────────────────────────────────────────────────────────────────

def test_no_price_placeholders_in_src():
    hits = []
    for path in SRC.rglob("*"):
        if not path.is_file() or path.suffix not in {".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".json", ".md"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "__ ₾" in text:
            hits.append(str(path.relative_to(ROOT)))
    assert not hits, f"на сайте снова заглушка цены «__ ₾»: {hits}"
    page = _read("src/pages/BecomeSpecialistPage.tsx")
    assert "Условия размещения. __" not in page and "<b>Сколько стоит.</b>" not in page, \
        "на странице анкеты снова абзацы-заглушки про цену и условия каталога"


# ─────────────────────────────────────────────────────────────────────────
# X2-05 / G1-02 — вход возвращает туда, откуда пришли.
# ─────────────────────────────────────────────────────────────────────────

def test_login_honors_safe_redirect():
    page = _read("src/pages/LoginPage.tsx")
    assert "safeRedirectPath(new URLSearchParams(window.location.search).get('redirect'))" in page, \
        "вход снова не читает ?redirect="
    body = _fn_body(page, "const postLoginPath = ", "const handleSubmit")
    i_redirect = body.find("return redirectTo;")
    i_mobile = body.find("return '/m';")
    assert i_redirect != -1 and i_mobile != -1 and i_redirect < i_mobile, \
        "после входа снова всегда /m — ?redirect= должен идти раньше правила «телефон → /m»"
    # Все три пути входа идут через postLoginPath (пароль/регистрация и Google).
    assert page.count("navigate(postLoginPath())") >= 2, "вход по паролю/Google обходит postLoginPath"
    assert "Войдите или создайте аккаунт — затем откроется анкета специалиста" in page, \
        "пропала подсказка над формой для тех, кто пришёл за анкетой"

    util = _read("src/utils/loginRedirect.ts")
    assert "path.startsWith('//')" in util, "redirect снова пускает //чужой-сайт"
    assert "!path.startsWith('/')" in util, "redirect снова пускает https://… и javascript:"
    assert "\\\\" in util, "redirect снова пускает /\\чужой-сайт (браузер читает как //)"


def test_safe_redirect_behaviour_with_node():
    """Живая проверка safeRedirectPath, если есть node ≥ 22.6 (умеет .ts)."""
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
    script = (
        "import('./src/utils/loginRedirect.ts').then(m => {"
        "const c = ['/become-specialist','//evil.com','/\\\\evil.com','https://evil.com',"
        "'javascript:alert(1)','/login?redirect=/x','/m/find?cab=1'];"
        "console.log(JSON.stringify(c.map(m.safeRedirectPath)));"
        "console.log(m.loginPathWithRedirect('/m/find?cab=1'));});"
    )
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "-e", script],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    if r.returncode != 0:
        return  # среда без поддержки .ts — остаются проверки по исходникам выше
    lines = r.stdout.strip().splitlines()
    assert lines[0] == '["/become-specialist",null,null,null,null,null,"/m/find?cab=1"]', lines[0]
    assert lines[1] == "/login?redirect=%2Fm%2Ffind%3Fcab%3D1", lines[1]


def test_protected_layouts_pass_redirect():
    layouts = [
        "src/pages/mobile/MobileLayout.tsx",
        "src/pages/mobile/crm/MobileCrmLayout.tsx",
        "src/pages/mobile/admin/MobileAdminLayout.tsx",
        "src/components/DashboardLayout.tsx",
        "src/pages/crm/CrmLayout.tsx",
        "src/pages/admin/AdminLayout.tsx",
    ]
    for rel in layouts:
        src = _read(rel)
        assert "loginPathWithRedirect(" in src, f"{rel}: проверка входа снова без ?redirect="
        assert "navigate('/login')" not in src, f"{rel}: снова navigate('/login') без возврата"
        assert '<Navigate to="/login"' not in src, f"{rel}: снова <Navigate to=\"/login\"> без возврата"
    client = _read("src/api/client.ts")
    assert "loginPathWithRedirect(" in client, "истёкшая сессия (401) снова уводит на голый /login"


# ─────────────────────────────────────────────────────────────────────────
# X2-13 — «Подать заявку» ведёт к анкете, а не в кабинет клиента.
# ─────────────────────────────────────────────────────────────────────────

def test_landing_apply_button_returns_to_application():
    land = _read("src/components/landing/GridHouseLanding.tsx")
    assert "/login?register=1&redirect=${encodeURIComponent('/become-specialist')}" in land, \
        "«Подать заявку →» снова ведёт на регистрацию без возврата к анкете"
    assert 'to="/login?register=1">Подать заявку' not in land


def test_mobile_has_way_to_application():
    gate = _read("src/components/SpecialistGate.tsx")
    assert "SPECIALIST_APPLICATION_PATH = '/become-specialist'" in gate
    assert "Чтобы бронировать кабинеты, заполни анкету специалиста" in gate
    assert "Анкета на проверке" in gate
    profile = _read("src/pages/mobile/MobileProfile.tsx")
    assert "navigate('/become-specialist')" in profile, "в /m/me пропала строка «Анкета специалиста»"


# ─────────────────────────────────────────────────────────────────────────
# X2-ia-navigation-M1 / G1-landing-entry-M1 / G3-client-desktop-M1 —
# правило «кто может бронировать» совпадает с сервером и проверяется ДО оплаты.
# ─────────────────────────────────────────────────────────────────────────

def test_can_book_roles_match_backend():
    perms = _read("src/utils/permissions.ts")
    m = re.search(r"const CAN_BOOK_ROLES = \[([^\]]*)\]", perms)
    assert m, "нет CAN_BOOK_ROLES в permissions.ts"
    front = set(re.findall(r"'([a-z_]+)'", m.group(1)))
    deps = _read("backend/app/api/deps.py")
    body = _fn_body(deps, "def require_can_book", "\ndef ")
    m2 = re.search(r"if role in \(([^)]*)\)", body)
    assert m2, "не нашёл список ролей в require_can_book"
    back = set(re.findall(r"\"([a-z_]+)\"", m2.group(1)))
    assert front == back, f"фронт и сервер по-разному решают, кто бронирует: {front} vs {back}"


def test_mobile_screens_gate_booking():
    today = _read("src/pages/mobile/MobileToday.tsx")
    assert "canBookCabinets(currentUser)" in today and "<SpecialistGateCard" in today, \
        "/m/today снова без карточки анкеты для новичка"
    assert "{canBook && regularSlot" in today, "«постоянный слот» снова ведёт новичка в оформление"
    sticky = _fn_body(today, "{/* Sticky CTA above tab bar", "Найти свободный кабинет")
    assert "{canBook && (" in sticky, "закреплённая «Найти свободный кабинет» снова видна новичку"

    find = _read("src/pages/mobile/MobileFind.tsx")
    assert "<SpecialistGateCard" in find, "/m/find снова без карточки анкеты наверху"
    choose = _fn_body(find, "async function chooseWindow", "\n    return (")
    i_gate = choose.find("if (!canBook)")
    i_checkout = choose.find("navigate('/m/checkout')")
    assert i_gate != -1 and i_checkout != -1 and i_gate < i_checkout, \
        "тап по слоту снова ведёт новичка на /m/checkout, где будет 403"

    checkout = _read("src/pages/mobile/MobileCheckout.tsx")
    assert checkout.count("isSpecialistOnlyRefusal(e)") >= 2, \
        "403 «только специалистам» при оформлении/серии снова показывается тостом"
    assert "<SpecialistGateCard" in checkout
    assert "needsApplication ? () => navigate(SPECIALIST_APPLICATION_PATH) : submit" in checkout, \
        "кнопка оформления снова отправляет заведомо отказную бронь"


def test_desktop_wizard_gates_before_payment():
    app = _read("src/App.tsx")
    wizard = _fn_body(app, "function BookingWizard()", "\nimport { Toaster }")
    i_gate = wizard.find("if (needsApplication)")
    i_board = wizard.find("<ChessboardStep")
    assert i_gate != -1 and i_board != -1 and i_gate < i_board, \
        "/checkout снова пускает не-специалиста к выбору времени и «Оплатить»"
    assert "!canBookCabinets(currentUser) && !editBookingId" in wizard

    my = _read("src/pages/MyBookingsPage.tsx")
    assert "viewMode === 'list' && canBook &&" in my, "«+ Новая бронь» снова видна тем, кому бронь не дадут"
    assert "<SpecialistGateCard" in my


# ─────────────────────────────────────────────────────────────────────────
# Статус анкеты: новичок может прочитать свою анкету.
# ─────────────────────────────────────────────────────────────────────────

def test_own_application_readable_by_new_user():
    src = _read("backend/app/api/v1/specialists.py")
    get_me = _fn_body(src, "def get_my_specialist_profile", "\n@router.")
    assert "Depends(get_current_user)" in get_me and "require_specialist" not in get_me.split('"""')[0], \
        "GET /specialists/me снова 403 для роли user — статус анкеты не узнать"
    assert "Specialist.user_id == current_user.id" in get_me, "GET /specialists/me должен отдавать только свою анкету"
    patch_me = _fn_body(src, "def update_my_specialist_profile", "\n@router.")
    assert "Depends(require_specialist)" in patch_me, "PATCH /me должен остаться только для специалистов"

    page = _read("src/pages/BecomeSpecialistPage.tsx")
    assert "markSpecialistApplicationSent(currentUser?.id)" in page, \
        "после отправки анкеты экраны брони не узнают, что она на проверке"


def test_desktop_chessboard_series_goes_through_gate():
    """Ревью 30.09: на /dashboard/bookings вкладка «Шахматка» открыта и для
    не-специалиста, а «Серия · N» создавала серию прямо через API — 403 на
    последнем шаге. Для не-специалиста серия идёт через /checkout с карточкой."""
    root = os.path.join(os.path.dirname(__file__), "..", "..")
    src = open(os.path.join(root, "src/pages/MyBookingsPage.tsx"), encoding="utf-8").read()
    i = src.find("const handleRecurringBooking")
    body = src[i:src.find("createRecurringBooking(", i)]
    assert "if (!canCreate)" in body and "proceedToCheckout()" in body, \
        "серия из шахматки снова минует карточку анкеты"
    assert "canCreate={canBook}" in src, "шахматке не передаётся, может ли человек бронировать"


def test_approve_application_grants_booking_role():
    """Решение владельца 30.09: «Одобрить» анкету = человек сразу может
    бронировать. Роль user → specialist (только обычному клиенту; админов и
    владельца не трогаем), смена роли пишется в журнал role_change."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "app/api/v1/specialists.py"),
               encoding="utf-8").read()
    i = src.find("def approve_specialist_application")
    body = src[i:src.find("@router.post(\"/admin/{specialist_id}/reject\"", i)]
    assert 'owner_user.role = "specialist"' in body, "одобрение снова не даёт права бронировать"
    assert '== "user"' in body, "одобрение может понизить админа/владельца до специалиста"
    assert 'event_type="role_change"' in body, "выдача роли при одобрении не пишется в журнал"


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
    print("СТОРОЖ wave0-H: OK" if not failures else f"СТОРОЖ wave0-H УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
