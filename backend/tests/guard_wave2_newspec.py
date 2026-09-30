"""СТОРОЖ wave2-E — путь нового психолога (анкета специалиста, 30.09).

Только чтение исходников, без сети и базы:

    python3 backend/tests/guard_wave2_newspec.py

Что ловит:
  анкета в /m  — /m/become-specialist снова рисуется компьютерной страницей
                 (своя шапка, две колонки) вместо MobilePageHeader.
  G1-18 / X4-05 — подписи не связаны с полями (голые <label> без htmlFor,
                 самодельные inputStyle/labelStyle), мелкий/бледный текст.
  G1-19        — ошибки только тостом вверху длинной формы: теперь под полем,
                 с прокруткой и фокусом к первой; после отправки — экран
                 «Анкета у администратора» с шагами, а не тост.
  Решение владельца 30.09 — «Проверим анкету за 1 рабочий день»; цену
                 каталога и приветственный час до одобрения не упоминаем.
  Состояния    — нет анкеты / на проверке / отклонена / одобрена, у каждой
                 свой следующий шаг; у отклонённой — причина, если есть.
  Карточка     — в /m ведёт на /m/become-specialist; рамка видна на фоне.
  Неприкосновенное — запрос анкеты, загрузка документов, сжатие фото,
                 canBookCabinets, SPECIALIST_APPLICATION_PATH и сигнатура
                 SpecialistGateCard({variant, status}) (её зовут пакеты A и B).
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent

PAGE = "src/pages/BecomeSpecialistPage.tsx"
GATE = "src/components/SpecialistGate.tsx"
HOOK = "src/hooks/useSpecialistApplication.ts"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:\\'\"])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


# ─────────────────────────────────────────────────────────────────────────
# Анкета внутри /m — мобильная раскладка
# ─────────────────────────────────────────────────────────────────────────

def test_page_mobile_shell_layout():
    page = _code(PAGE)
    assert "useInMobileShell()" in page, "страница анкеты не отличает /m от компьютера"
    assert "<MobilePageHeader" in page, "в /m нет шапки MobilePageHeader со стрелкой «Назад»"
    i = page.find("if (inShell) {")
    assert i != -1, "нет отдельной раскладки для /m"
    shell = page[i:page.find("\n    }\n", i)]
    assert "<MobilePageHeader" in shell and "<PublicHeader" not in shell and "<PageHeader" not in shell, \
        "в /m снова компьютерная шапка"
    # Одна колонка в /m: пары полей встают рядом только на компьютере.
    assert "gridTemplateColumns: inShell ? '1fr'" in page, "в /m форма снова в две колонки"
    assert "gridTemplateColumns: '1fr 1fr'" not in page, "жёсткие две колонки вернулись (на телефоне тесно)"
    # Компьютер: общая публичная шапка (в /m она сама не рисуется).
    assert "<PublicHeader />" in page and "<PageHeader" in page


# ─────────────────────────────────────────────────────────────────────────
# G1-18 / X4-05 — подписи связаны с полями, текст читаемый
# ─────────────────────────────────────────────────────────────────────────

def test_fields_are_labelled():
    page = _code(PAGE)
    assert "from '../components/ui/Field'" in page, "анкета не на общем Field"
    assert page.count("<Field ") >= 8, "поля анкеты снова без общего Field (подпись ↔ поле)"
    # Голых <label> больше нет: подписи даёт Field (htmlFor) или FieldGroup (aria-labelledby).
    assert not re.search(r"<label\b", page), "голый <label> без связи с полем"
    assert "<input value=" not in page and "<textarea" not in page and "<select" not in page, \
        "самодельные поля ввода вместо Input/TextArea/Select"
    assert "labelStyle" not in page and "inputStyle" not in page, "вернулись самодельные стили подписей/полей"
    assert 'aria-labelledby={`${id}-label`}' in page, "группы (документы, формат) без связанной подписи"
    assert "/specialists</Link>" not in page, "в тексте снова адрес «/specialists» вместо слов"


def test_text_rules():
    for rel in (PAGE, GATE):
        code = _code(rel)
        for m in re.finditer(r"fontSize:\s*(\d+)", code):
            assert int(m.group(1)) >= 12, f"{rel}: шрифт {m.group(1)} px (меньше 12 нельзя)"
        assert not re.search(r"text-\[(?:[0-9]|1[01])px\]", code), f"{rel}: шрифт мельче 12 px"
        assert not re.search(r"(?<![\w$.])(?:confirm|prompt|alert)\s*\(|window\.(?:confirm|prompt|alert)\s*\(", code), \
            f"{rel}: системное окно браузера"
        assert not re.search(r"color:\s*(?:GH\.ink(?:30|20|10)|COLOR\.ink(?:40|30|20|10))\b", code), \
            f"{rel}: бледный текст (не бледнее ink-60)"
        assert not re.search(
            r"(?i)(?<![а-яё])(?:ты|тебе|тебя|твой|твоя|твоё|твои)(?![а-яё])"
            r"|(?<![а-яёА-ЯЁ])(?:[Зз]аполни|[Зз]агрузи|[Вв]ыбери|[Уу]кажи|[Нн]апиши|[Дд]обавь)(?![а-яё])",
            code,
        ), f"{rel}: обращение на «ты»"
        assert "fontWeight: 700" not in code and "fontWeight: 800" not in code, f"{rel}: вес шрифта больше 600"


def test_buttons_are_touch_size():
    page = _code(PAGE)
    # Кнопки — общий Button (44 px в /m через --control-h), без самодельных <button style>.
    assert not re.search(r"<button\b", page), "самодельная <button> вместо общего Button"
    assert "from '../components/ui/Button'" in page
    gate = _code(GATE)
    assert gate.count("minHeight: 44") >= 2, "кнопка карточки анкеты ниже 44 px"


# ─────────────────────────────────────────────────────────────────────────
# G1-19 — ошибки под полем + к первой ошибке; экран после отправки
# ─────────────────────────────────────────────────────────────────────────

def test_errors_under_field_and_focus_first():
    page = _code(PAGE)
    assert "noValidate" in page, "браузерные всплывашки «Заполните поле» перебивают ошибки под полем"
    m = re.search(r"const ERROR_ORDER: ErrorKey\[\] = \[([^\]]*)\]", page)
    assert m, "нет порядка обязательных полей для прокрутки к первой ошибке"
    order = re.findall(r"'(\w+)'", m.group(1))
    assert order[:2] == ["firstName", "lastName"] and "documents" in order and "formats" in order, order
    assert "scrollIntoView(" in page and ".focus(" in page, "нет прокрутки и фокуса к первой ошибке"
    body = page[page.find("const handleSubmit"):page.find("const cancelEditing")]
    assert "toast.error(" not in body, "ошибки анкеты снова тостом вверху экрана"
    assert "ERROR_ORDER.find(" in body and "scrollToAndFocus(" in body
    i_check = body.find("if (first)")
    i_apply = body.find("specialistsApi.apply(")
    assert -1 < i_check < i_apply, "анкета уходит на сервер, не проверив обязательные поля"
    # Документ обязателен, цена — больше 0 (в каталог уходило «0 ₾»).
    assert "form.documents.length === 0" in page
    assert "!(price > 0)" in page, "цена консультации снова может быть 0 ₾"
    for key in ("firstName", "lastName", "documents", "formats", "basePriceGel"):
        assert f"errors.{key}" in page, f"ошибка «{key}» не показывается под полем"


def test_after_submit_status_screen():
    page = _code(PAGE)
    assert "Анкета у администратора" in page, "после отправки нет экрана «Анкета у администратора»"
    for step in ("Заполнили анкету", "'Проверка'", "Доступ к бронированию"):
        assert step in page, f"нет шага {step}"
    assert "Проверим анкету за 1 рабочий день" in page, "нет срока проверки (решение владельца)"
    body = page[page.find("const handleSubmit"):page.find("const cancelEditing")]
    assert "toast.success(" not in body, "успех снова только всплывающим сообщением"
    assert "setJustSubmitted(true)" in body and "setEditing(false)" in body
    # После отправки экран статуса с начала и фокус на его заголовок.
    assert "statusHeadingRef.current?.focus(" in page


def test_owner_copy_no_catalog_price_or_welcome_hour():
    for rel in (PAGE, GATE):
        code = _code(rel).lower()
        for bad in ("приветствен", "бесплатн", "час в подарок", "__ ₾", "сколько стоит", "2 рабочих дн"):
            assert bad not in code, f"{rel}: до одобрения упоминается «{bad}» (решение владельца 30.09)"
        assert "админ " not in code and "админ." not in code, f"{rel}: «админ» — пишем «администратор»"


def test_all_statuses_have_next_step():
    page = _code(PAGE)
    assert "applicationStatusOf(profile)" in page, "страница решает статус не тем правилом, что карточка"
    i = page.find("function StatusScreen(")
    screen = page[i:page.find("\nfunction RejectReason", i)]
    assert "status === 'approved'" in screen and "status === 'rejected'" in screen
    assert "Анкета одобрена" in screen and "Анкета не прошла проверку" in screen
    assert "Забронировать кабинет" in screen, "у одобренной нет шага «Забронировать кабинет»"
    assert "Исправить анкету" in screen, "у отклонённой нет шага «Исправить анкету»"
    assert "Изменить анкету" in screen, "у анкеты на проверке нет «Изменить анкету»"
    assert screen.count("adminLink(") >= 2, "нет связи с администратором для отклонённой/зависшей анкеты"
    assert "applicationRejectReason(profile)" in page and "<RejectReason" in page, \
        "причина отказа не показывается"
    # Одобренную анкету сервер не принимает повторно (409) — формы у неё нет.
    assert "(editing && status !== 'approved')" in page
    # Сбой загрузки ≠ пустая форма (человек с поданной анкетой подал бы заново).
    assert "setLoadState('error')" in page and "<ErrorBar" in page


# ─────────────────────────────────────────────────────────────────────────
# Карточка на экранах брони
# ─────────────────────────────────────────────────────────────────────────

def test_gate_card_routes_and_border():
    gate = _code(GATE)
    assert "export function SpecialistGateCard({ variant, status }: {" in gate, \
        "сигнатура SpecialistGateCard({variant, status}) изменилась — её зовут пакеты A и B"
    assert "SPECIALIST_APPLICATION_PATH = '/become-specialist'" in gate
    assert "useInMobileShell()" in gate and "catalogPath(SPECIALIST_APPLICATION_PATH, inShell)" in gate, \
        "в /m карточка снова уводит на компьютерную анкету"
    assert "navigate(SPECIALIST_APPLICATION_PATH)" not in gate
    assert ": COLOR.ink08}" not in gate, "серая рамка карточки снова ink-08 — сливается с фоном"
    assert "Проверим её за 1 рабочий день" in gate


# ─────────────────────────────────────────────────────────────────────────
# Неприкосновенное: запрос анкеты, документы, фото, права
# ─────────────────────────────────────────────────────────────────────────

def test_untouchables():
    page = _code(PAGE)
    assert page.count("specialistsApi.apply(") == 1, "запрос анкеты изменился"
    assert "api.post<{ url: string }>('/upload/task-file'" in page, "загрузка документов изменилась"
    assert "api.post<{ url: string }>('/upload/'" in page and "compressImage(file)" in page, \
        "загрузка/сжатие фото изменились"
    assert "upload.size > 2 * 1024 * 1024" in page
    assert "markSpecialistApplicationSent(currentUser?.id)" in page
    perms = _read("src/utils/permissions.ts")
    assert "export function canBookCabinets(" in perms

    hook = _code(HOOK)
    assert "export function applicationStatusOf(" in hook
    assert "const next = applicationStatusOf(profile);" in hook, "карточка и страница снова решают статус по-разному"
    m = re.search(r"export function applicationStatusOf\([^)]*\)[^{]*\{(.*?)\n\}", hook, flags=re.S)
    assert m, "не нашёл applicationStatusOf"
    body = m.group(1)
    assert "profile.isVerified || profile.applicationStatus === 'approved'" in body
    assert "'rejected'" in body and "return 'pending';" in body


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
    print("СТОРОЖ wave2-newspec: OK" if not failures else f"СТОРОЖ wave2-newspec УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
