"""СТОРОЖ wave2 — основа волны 2 (шаг 0, 30.09).

Чтение исходников без сети и базы; чистые функции (даты, ссылки каталога,
направления, тексты ошибок) ещё и исполняются через node ≥ 22.6, если он есть.

Что ловит:
  шаг 0   — мастер брони вынесен из App.tsx в Wizard/BookingWizard.tsx;
            анкета специалиста открывается внутри /m (/m/become-specialist).
  G2-02   — ссылки каталога в /m ведут в мобильные маршруты (catalogPath),
            и каждый такой маршрут реально есть в App.tsx.
  G1-21 / G2-17 — одна публичная шапка: Специалисты, Кабинеты, Тарифы,
            Войти/имя; на телефоне «Меню» → Sheet; в /m не рисуется.
  G2-08   — технические ключи направлений (GENERAL_PSYCHOLOGY) → по-русски,
            неизвестная латиница скрыта.
  X3-09   — экран сбоя без «Ошибка в модуле «Mobile»» и стека для клиентов.
  X5-04   — «Network Error» и сырой err.message не уходят в интерфейс;
            интерцептор помечает ошибку «тост уже показан».
  X4-18   — хук заголовка вкладки «Мои брони · Unbox».
  Даты    — «Сегодня / Завтра / ср, 7 окт.», «через 20 мин / идёт сейчас».

    python3 backend/tests/guard_wave2_foundation.py
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
SRC = ROOT / "src"

NEW_FILES = (
    "src/utils/catalogPath.ts",
    "src/components/public/PublicHeader.tsx",
    "src/hooks/useDocumentTitle.ts",
    "src/components/ui/ModuleErrorBoundary.tsx",
    "src/utils/errors.ts",
)


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:\\])//[^\n]*", r"\1", src)


def _node_eval(module_rel: str, expr: str):
    """Импортирует .ts через node и возвращает JSON от expr(m).
    None — node нет или он старше 22.6 (не умеет .ts): тогда проверяем
    только исходники."""
    node = shutil.which("node")
    if not node:
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    if (major, minor) < (22, 6):
        return None
    path = (ROOT / module_rel).as_posix()
    script = f"import('{path}').then(m => console.log(JSON.stringify({expr})))"
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "-e", script],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"{module_rel} не запустился в node: {r.stderr[:400]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


def _mobile_block(app: str) -> str:
    i = app.find('<Route path="/m" element=')
    j = app.find('<Route path="/m/crm" element=', i)
    assert i != -1 and j != -1, "не нашёл блок маршрутов /m в App.tsx"
    return app[i:j]


# ─────────────────────────────────────────────────────────────────────────
# App.tsx: мастер в своём файле, анкета внутри /m
# ─────────────────────────────────────────────────────────────────────────

def test_booking_wizard_extracted():
    app = _read("src/App.tsx")
    assert "function BookingWizard(" not in app, "BookingWizard снова живёт в App.tsx"
    assert "import { BookingWizard } from './components/Wizard/BookingWizard';" in app
    assert "<BookingWizard />" in app, "/checkout больше не открывает мастер"
    wiz = _read("src/components/Wizard/BookingWizard.tsx")
    assert "export function BookingWizard()" in wiz
    # Логика не потерялась при переносе.
    for needle in ("if (needsApplication)", "beforeunload", "<ChessboardStep />", "<ConfirmationStep />",
                   "<Summary />", "setBookingForUser(null)"):
        assert needle in wiz, f"BookingWizard.tsx: при переносе пропало {needle!r}"
    # Шаг 1 по-прежнему обработан — но теперь (волна 2, пакет D, G3-11/X2-15)
    # не редиректом на главную, а сеткой времени: прямой /checkout и «Назад»
    # с сетки больше не выкидывают клиента на лендинг.
    assert "if (step < 2) setStep(2);" in wiz, "шаг 1 мастера снова ничем не обработан"
    assert '<Navigate to="/" replace />' not in wiz, "шаг 1 мастера снова уводит на главную"


def test_become_specialist_inside_mobile_shell():
    app = _read("src/App.tsx")
    block = _mobile_block(app)
    assert '<Route path="become-specialist" element={<BecomeSpecialistPage />} />' in block, \
        "нет маршрута /m/become-specialist внутри мобильной оболочки"
    assert '<Route path="/become-specialist"' in app, "пропала компьютерная анкета /become-specialist"


# ─────────────────────────────────────────────────────────────────────────
# G2-02 — ссылки каталога внутри /m
# ─────────────────────────────────────────────────────────────────────────

def test_catalog_path_targets_are_real_routes():
    src = _strip_comments(_read("src/utils/catalogPath.ts"))
    block = _mobile_block(_read("src/App.tsx"))
    routes = set(re.findall(r'<Route path="([^"]+)"', block))
    targets = set(re.findall(r"'(/m(?:/[^']*)?)'", src))
    assert "/m/specialists/$1" in targets and "/m/cabinet/$1" in targets, "catalogPath потерял ссылки на карточки"
    assert targets, "в catalogPath.ts не нашёл ни одного мобильного пути"
    for t in sorted(targets):
        if t in ("/m", "/m/"):  # сама оболочка (isMobileShellPath)
            continue
        rest = t[len("/m/"):]
        # /m/specialists/$1 → specialists/:id
        pattern = re.sub(r"/\$\d+", "/:", rest).rstrip("/")
        ok = any(re.sub(r"/:[^/]+", "/:", r) == pattern for r in routes) or rest in routes
        assert ok, f"catalogPath ведёт на {t}, но такого маршрута в /m нет"


def test_catalog_path_mapping_live():
    got = _node_eval(
        "src/utils/catalogPath.ts",
        "[['/specialists/42','/location/unbox_uni','/cabinet/5?x=1','/subscriptions','/booking-rules',"
        "'/#specialists','/#cabinets','/news','/m/find','/become-specialist','/dashboard/bookings'].map(m.toMobilePath),"
        " m.catalogPath('/specialists/42', false), m.catalogPath('/specialists/42', true)]",
    )
    if got is None:
        return
    mapped, outside, inside = got
    assert mapped == ["/m/specialists/42", "/m/location/unbox_uni", "/m/cabinet/5?x=1", "/m/tariffs",
                      "/m/booking-rules", "/m/specialists", "/m/places", "/news", "/m/find",
                      "/m/become-specialist", "/m/bookings"], f"catalogPath: {mapped}"
    assert outside == "/specialists/42", "вне /m ссылка каталога должна оставаться компьютерной"
    assert inside == "/m/specialists/42"


# ─────────────────────────────────────────────────────────────────────────
# G1-21 / G2-17 — одна публичная шапка
# ─────────────────────────────────────────────────────────────────────────

def test_public_header_contract():
    src = _read("src/components/public/PublicHeader.tsx")
    code = _strip_comments(src)
    for label in ("'Специалисты'", "'Кабинеты'", "'Тарифы'", "'Войти'", "Меню"):
        assert label in code, f"PublicHeader: нет пункта {label}"
    assert "<Sheet" in code, "PublicHeader: меню на телефоне не через общий Sheet"
    assert "isMobileShellPath(location.pathname)) return null" in code, "PublicHeader рисуется внутри /m"
    assert "loginPathWithRedirect(" in code, "«Войти» без возврата на текущую страницу"
    assert not re.search(r"#[0-9a-fA-F]{3,8}\b['\"]", code), "PublicHeader: сырой hex-цвет вместо токенов"


# ─────────────────────────────────────────────────────────────────────────
# G2-08 — направления специалистов по-русски
# ─────────────────────────────────────────────────────────────────────────

def test_specialization_labels():
    src = _read("src/utils/specialistFormat.ts")
    assert "export function specializationLabel(" in src
    assert "general_psychology: 'Общая психология'" in src
    got = _node_eval(
        "src/utils/specialistFormat.ts",
        "[m.specializationLabel('GENERAL_PSYCHOLOGY'), m.specializationLabel('gestalt'), m.specializationLabel('cbt'),"
        " m.specializationLabel('Тревога'), m.specializationLabel('some_new_key'), m.specializationLabel('constructor'),"
        " m.specializationLabel(''), m.specializationLabels(['cbt', 'КПТ', 'xx_yy', null, 'Стресс'])]",
    )
    if got is None:
        return
    assert got[:3] == ["Общая психология", "Гештальт-терапия", "КПТ"], f"словарь направлений: {got[:3]}"
    assert got[3] == "Тревога", "русское направление должно показываться как есть"
    assert got[4] is None and got[5] is None and got[6] is None, "неизвестная латиница должна скрываться"
    assert got[7] == ["КПТ", "Стресс"], f"specializationLabels: {got[7]}"


# ─────────────────────────────────────────────────────────────────────────
# Даты: «Сегодня / Завтра», «через 20 мин»
# ─────────────────────────────────────────────────────────────────────────

def test_relative_day_and_starts_in():
    src = _read("src/utils/format.ts")
    assert "export function formatRelativeDay(" in src and "export function formatStartsIn(" in src
    assert not re.search(r"^import ", src, flags=re.M), "format.ts должен остаться без импортов (сторожа гоняют его в node)"
    now = "new Date('2026-09-30T10:00:00+04:00')"
    tz = "'Asia/Tbilisi'"
    got = _node_eval(
        "src/utils/format.ts",
        f"[m.formatRelativeDay('2026-09-30', {{now: {now}, timeZone: {tz}}}),"
        f" m.formatRelativeDay('2026-10-01', {{now: {now}, timeZone: {tz}}}),"
        f" m.formatRelativeDay('2026-09-29', {{now: {now}, timeZone: {tz}}}),"
        f" m.formatRelativeDay('2026-10-07', {{now: {now}, timeZone: {tz}}}),"
        f" m.formatRelativeDay('2026-09-30T23:30:00+04:00', {{now: {now}, timeZone: {tz}}}),"
        f" m.formatRelativeDay('2026-09-30', {{now: {now}, capitalize: false}}),"
        f" m.formatStartsIn('2026-09-30T10:20:00+04:00', {{now: {now}}}),"
        f" m.formatStartsIn('2026-09-30T13:00:00+04:00', {{now: {now}}}),"
        f" m.formatStartsIn('2026-09-30T11:30:00+04:00', {{now: {now}}}),"
        f" m.formatStartsIn('2026-10-02T10:00:00+04:00', {{now: {now}}}),"
        f" m.formatStartsIn('2026-09-30T09:30:00+04:00', {{now: {now}, end: '2026-09-30T10:30:00+04:00'}}),"
        f" m.formatStartsIn('2026-09-30T08:00:00+04:00', {{now: {now}, end: '2026-09-30T09:00:00+04:00'}})]",
    )
    if got is None:
        return
    assert got == ["Сегодня", "Завтра", "Вчера", "ср, 7 окт.", "Сегодня", "сегодня",
                   "через 20 мин", "через 3 ч", "через 1 ч 30 мин", "через 2 дня",
                   "идёт сейчас", "закончилась"], f"относительные даты: {got}"


# ─────────────────────────────────────────────────────────────────────────
# X5-04 — ошибки сети по-русски и без второго тоста
# ─────────────────────────────────────────────────────────────────────────

def test_api_errors_are_human():
    code = _strip_comments(_read("src/utils/errors.ts"))
    assert "return err.message" not in code, "apiErrorMessage снова отдаёт сырой err.message («Network Error»)"
    for fn in ("export function markErrorToastShown", "export function wasErrorToastShown",
               "export function toastApiError", "export function isNetworkError"):
        assert fn in code, f"errors.ts: нет {fn}"
    got = _node_eval(
        "src/utils/errors.ts",
        "(() => { const net = {isAxiosError: true, message: 'Network Error', code: 'ERR_NETWORK', request: {}};"
        " const r = [m.apiErrorMessage(net, 'X'),"
        " m.apiErrorMessage({isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 60000ms exceeded'}, 'X'),"
        " m.apiErrorMessage({response: {status: 429, data: {}}}, 'X'),"
        " m.apiErrorMessage({response: {status: 404, data: {detail: 'Not found'}}}, 'Не удалось загрузить'),"
        " m.apiErrorMessage({response: {status: 400, data: {detail: 'Бронь уже отменена'}}}, 'X'),"
        " m.apiErrorMessage(new Error('Cannot read properties of undefined'), 'Не удалось'),"
        " m.apiErrorMessage({isAxiosError: true, code: 'ERR_CANCELED', message: 'canceled'}, 'X'),"
        " m.wasErrorToastShown(net)];"
        " m.markErrorToastShown(net); r.push(m.wasErrorToastShown(net)); return r; })()",
    )
    if got is None:
        return
    net, timeout, rate, en_detail, ru_detail, crash, cancel, before, after = got
    assert net.startswith("Нет соединения с сервером"), f"сетевой сбой → {net!r}"
    assert timeout.startswith("Сервер долго не отвечает"), f"таймаут → {timeout!r}"
    assert rate.startswith("Слишком много запросов"), f"429 → {rate!r}"
    assert en_detail == "Не удалось загрузить", "английский detail сервера ушёл в интерфейс"
    assert ru_detail == "Бронь уже отменена", "русский detail сервера должен показываться"
    assert crash == "Не удалось", "английский текст исключения ушёл в интерфейс"
    assert cancel == "X", "отменённый запрос не сетевой сбой"
    assert before is False and after is True, "признак «тост уже показан» не работает"


def test_interceptor_marks_toast_shown():
    client = _strip_comments(_read("src/api/client.ts"))
    assert "markErrorToastShown(error)" in client, "интерцептор не помечает ошибку «тост уже показан» — будет второй тост"
    assert "NETWORK_ERROR_TEXT" in client, "текст сетевого сбоя в интерцепторе снова свой, не общий"
    assert "'Нет соединения с сервером.'" not in client


# ─────────────────────────────────────────────────────────────────────────
# X3-09 — экран сбоя по-человечески
# ─────────────────────────────────────────────────────────────────────────

def test_error_boundary_is_human():
    code = _strip_comments(_read("src/components/ui/ModuleErrorBoundary.tsx"))
    assert "Этот экран не загрузился" in code
    assert "Обновить страницу" in code and "window.location.reload()" in code
    assert "Написать администратору" in code
    assert "Ошибка в модуле" not in code, "клиенту снова пишем «Ошибка в модуле «Mobile»»"
    assert "import.meta.env.DEV || isStaffViewer()" in code, "стек и текст ошибки видны не только dev/админам"
    i = code.find("{showDetails && (")
    assert i != -1, "подробности ошибки не спрятаны за showDetails"
    for needle in ("this.state.error?.message", "{stack}", "handleCopy}"):
        j = code.find(needle, code.find("render()"))
        assert j > i, f"{needle} показывается вне блока для админов"
    # Unhandled chunk-reload recovery остаётся.
    assert "unbox_chunk_retry_" in code and "failed to fetch dynamically imported module" in code


# ─────────────────────────────────────────────────────────────────────────
# X4-18 — заголовок вкладки
# ─────────────────────────────────────────────────────────────────────────

def test_document_title_hook():
    code = _strip_comments(_read("src/hooks/useDocumentTitle.ts"))
    assert "export function useDocumentTitle(" in code
    assert "`${t} · ${DOCUMENT_TITLE_SUFFIX}`" in code and "DOCUMENT_TITLE_SUFFIX = 'Unbox'" in code
    assert "const previous = document.title" in code and "document.title = previous" in code, \
        "при уходе со страницы заголовок не возвращается"


# ─────────────────────────────────────────────────────────────────────────
# Общие правила для новых файлов
# ─────────────────────────────────────────────────────────────────────────

def test_new_files_follow_rules():
    ty = re.compile(r"\b(ты|тебе|тебя|твой|твоя|твои|твоё|твоего)\b", re.I)
    for rel in NEW_FILES:
        code = _strip_comments(_read(rel))
        for m in re.finditer(r"fontSize:\s*(\d+)", code):
            assert int(m.group(1)) >= 12, f"{rel}: шрифт {m.group(1)} px (меньше 12 нельзя)"
        assert not re.search(r"text-\[(?:[0-9]|1[01])px\]", code), f"{rel}: шрифт мельче 12 px"
        assert not re.search(r"\b(?:window\.)?(?:confirm|prompt|alert)\(", code), f"{rel}: системное окно браузера"
        assert not ty.search(code), f"{rel}: обращение на «ты»"
        assert "text-gray-400" not in code and "text-gray-500" not in code, f"{rel}: бледный текст"


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
    print("СТОРОЖ wave2-foundation: OK" if not failures else f"СТОРОЖ wave2-foundation УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
