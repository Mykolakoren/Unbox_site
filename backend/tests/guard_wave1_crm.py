"""СТОРОЖ wave1-crm — десктопная Psy-CRM на общей основе (аудит 29.09, волна 1, шаг 2).

Файлы: src/pages/crm/*.tsx и src/components/crm/*.tsx.

Что ловит:
  X1-07 / G5-01 / G5-25 — системные confirm()/prompt()/alert(): кнопки «ОК /
           Отмена» не называли действие. Теперь общий ConfirmDialog, поле в
           шторке (причина снятия штрафа) или тост.
  X1-09 / X4-09 / G5-08 — шрифт 8–11 px («Pay / +Каб / Ред. / Уд.» 8 px).
           Минимум 12 px, разрядка мелких моно-подписей ≤ 0.06em.
  X4-02  — бледный текст GH.ink30/ink20, text-unbox-grey, text-gray-400/300.
  X1-16  — эмодзи вместо значков (⭐ серия, 📤 переаренда, 🩹, 🔄, 🗑, ⚠).
  X1-04  — свои карты статусов (STATUS_COLORS, «ЗАВЕРШЕНА», «ОТМЕНА · КЛ.»),
           сырые коды; теперь StatusBadge / statusLabel из statuses.ts.
  G5-06 / X3-13 — одна кнопка «оплатил» шестью словами («Pay», «Оплатить»,
           «140 ₾ · Оплачено», «Снять оплату»…). Теперь «Оплачено» — статус,
           «Отметить оплату» — действие, «Снять отметку об оплате» — отмена.
  Кирпичный красный rgba(184,74,47,…) и прочие ad-hoc цвета → токены --status-*.
  Обращение только на «вы»; «Пересдать» вместо «переаренда».

Без сети и без базы (только чтение исходников):

    python3 backend/tests/guard_wave1_crm.py
"""
import os
import re
import sys
import pathlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

ROOT = pathlib.Path(__file__).parent.parent.parent
FILES = sorted(
    list((ROOT / "src/pages/crm").glob("*.tsx"))
    + list((ROOT / "src/components/crm").glob("*.tsx"))
)


def _rel(p: pathlib.Path) -> str:
    return str(p.relative_to(ROOT))


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    """Грубо вырезает // и /* */ комментарии (строки с http:// не трогаем)."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


def _hits(pattern, text, flags=0):
    return [m.group(0) for m in re.finditer(pattern, text, flags)]


def test_files_found():
    names = {p.name for p in FILES}
    for must in ("CrmSessions.tsx", "CrmClientDetail.tsx", "CrmDashboard.tsx", "CrmChessboardView.tsx"):
        assert must in names, f"нет файла {must} — сторож смотрит не туда"


def test_no_native_dialogs():
    """confirm()/prompt()/alert() браузера — запрещены. confirm({…}) из
    useConfirmDialog — разрешён (аргумент — объект)."""
    pat = r"(?<![\w.])(?:window\.)?(?:confirm|prompt|alert)\(\s*(?!\{)"
    for p in FILES:
        bad = _hits(pat, _strip_comments(_read(p)))
        assert not bad, f"{_rel(p)}: системное окно браузера {bad[:3]} — используйте ConfirmDialog/Sheet/toast"


def test_no_font_below_12():
    num = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?![\w.%])")
    for p in FILES:
        src = _read(p)
        for m in re.finditer(r"fontSize:\s*([^,}\n]+)", src):
            expr = m.group(1)
            if re.search(r"\d(?:\.\d+)?(?:em|rem|vw|vh)", expr) and "px" not in expr:
                continue  # относительный размер (0.4em от крупной цифры)
            for n in num.findall(expr.replace("px", " ")):
                assert float(n) >= 12, f"{_rel(p)}: fontSize {expr.strip()} < 12 px"
        small = [s for s in re.findall(r"text-\[(\d+(?:\.\d+)?)px\]", src) if float(s) < 12]
        assert not small, f"{_rel(p)}: text-[{small[0]}px] < 12 px"


def test_mono_labels_letter_spacing():
    for p in FILES:
        for v in re.findall(r"letterSpacing:\s*'(\d*\.?\d+)em'", _read(p)):
            assert float(v) <= 0.06, f"{_rel(p)}: letterSpacing {v}em > 0.06em у мелкой подписи"


def test_no_pale_text():
    """Текст не бледнее ink-60. ink30/20 остаются для линий, рамок, точек,
    фона и неактивного — но не как color."""
    pat = (
        r"color:\s*(?:GH\.ink30|GH\.ink20|GH\.ink10|COLOR\.ink30|COLOR\.ink40|COLOR\.ink20)\b"
        r"|color:\s*'#(?:999|aaa|bbb|ccc|888)(?:999|aaa|bbb|ccc|888)?'"
        r"|(?<![\w-])text-(?:unbox-grey|gray-300|gray-400)(?![\w-])"
        r"|text-ink-60/\d"
    )
    for p in FILES:
        bad = _hits(pat, _read(p), re.I)
        assert not bad, f"{_rel(p)}: бледный текст {bad[:3]} — для текста минимум ink-60"


def test_no_opacity_dimmed_rows():
    """Приглушение прозрачностью роняло контраст (X4-19): opacity 0.4/0.5 у строк."""
    for p in FILES:
        bad = _hits(r"opacity:\s*(?:isCancelled|isInactive|isActive)\s*\?\s*0\.\d|opacity:\s*isInactive", _read(p))
        assert not bad, f"{_rel(p)}: строка приглушена прозрачностью {bad[:2]} — используйте цвет ink-60"


def test_no_brick_red_and_hex():
    for p in FILES:
        src = _read(p)
        assert not re.search(r"184,\s*74,\s*47|#B84A2F", src, re.I), \
            f"{_rel(p)}: старый кирпичный красный — берите STATUS.danger / GH.danger"
        hexes = _hits(r"'#[0-9a-fA-F]{3,8}'", _strip_comments(src))
        assert not hexes, f"{_rel(p)}: цвет-литерал {hexes[:3]} — только токены (GH/COLOR/STATUS)"


def test_no_decorative_tailwind_colors():
    """Синие/фиолетовые/янтарные «для красоты» — нет; статусы — через --status-*."""
    pat = r"\b(?:text|bg|border|ring|from|to|via|accent)-(?:red|green|blue|purple|indigo|violet|amber|yellow|emerald|orange|pink|teal|sky|cyan|rose|lime|fuchsia)-\d{2,3}\b"
    for p in FILES:
        bad = _hits(pat, _read(p))
        assert not bad, f"{_rel(p)}: цвет Tailwind {bad[:3]} — замените на var(--status-*) или токены"


def test_no_emoji_icons():
    pat = re.compile(r"[☀-➿\U0001F300-\U0001FAFF]")
    for p in FILES:
        bad = pat.findall(_read(p))
        assert not bad, f"{_rel(p)}: эмодзи {bad[:3]} — используйте значки Lucide"


def test_vy_not_ty():
    """Обращение только на «вы» (решение владельца)."""
    ty = re.compile(
        r"(?<![\wА-Яа-яЁё])(ты|тебе|тебя|тобой|твой|твоя|твоё|твое|твои|твоих|твоим|твоего|твоей|твою"
        r"|отметь|выбери|нажми|добавь|заполни|проверь|укажи|введи|сохрани|создай|открой|попробуй|загрузи"
        r"|посмотри|подключи|включи|напиши|перейди|жми|уточни|тапни|кликни)(?![\wА-Яа-яЁё])",
        re.I,
    )
    for p in FILES:
        bad = ty.findall(_strip_comments(_read(p)))
        assert not bad, f"{_rel(p)}: обращение на «ты» {bad[:3]} — пишите на «вы»"


def test_resale_wording():
    """«Пересдать / На пересдаче / Пересдана» — вместо «переаренда»,
    «перебронирование» и сокращения «Пересд.»."""
    for p in FILES:
        bad = _hits(r"переаренд|перебронир|Пересд\.", _read(p), re.I)
        assert not bad, f"{_rel(p)}: старое слово {bad[:2]} — пишите «пересдача» / «На пересдаче»"
    chess = _read(ROOT / "src/components/crm/CrmChessboardView.tsx")
    assert "На пересдаче" in chess, "шахматка CRM: чужой слот на пересдаче должен называться «На пересдаче»"


def test_statuses_from_dictionary():
    """Никаких своих карт статусов: StatusBadge / statusLabel из statuses.ts."""
    for p in FILES:
        src = _read(p)
        for old in ("STATUS_COLORS", "STATUS_GH", "GH_STATUS_COLORS", "BOOKING_STATUS_COLORS",
                    "'ЗАВЕРШЕНА'", "'ОТМЕНА · КЛ.'", "'Завершена'", "Отмена (терапевт)", "Ожидает оплату"):
            assert old not in src, f"{_rel(p)}: своя подпись/карта статуса {old!r}"
    for name in ("CrmSessions.tsx", "CrmClientDetail.tsx", "CrmBookings.tsx", "CrmDashboard.tsx", "CrmClients.tsx"):
        src = _read(ROOT / "src/pages/crm" / name)
        assert "StatusBadge" in src, f"{name}: статусы должны идти через общий StatusBadge"


def test_paid_wording_unified():
    """G5-06: «Оплачено» — статус, «Отметить оплату» — действие,
    «Снять отметку об оплате» — отмена. Старые слова не возвращаются."""
    old_words = [r">\s*Pay\s*<", r"\bOплатить все\b", r"Оплатить все", r">\s*Оплатить\s*<",
                 r"· Оплачено`", r"'Снять оплату'", r"\"Снять оплату\""]
    for p in FILES:
        src = _read(p)
        for w in old_words:
            assert not re.search(w, src), f"{_rel(p)}: старое название кнопки оплаты ({w})"
    for name in ("CrmSessions.tsx", "CrmClientDetail.tsx", "CrmDashboard.tsx"):
        assert "Отметить оплату" in _read(ROOT / "src/pages/crm" / name), f"{name}: нет действия «Отметить оплату»"
    assert "Снять отметку об оплате" in _read(ROOT / "src/pages/crm/CrmClientDetail.tsx"), \
        "карточка клиента: отмена оплаты должна называться «Снять отметку об оплате»"


def test_session_row_actions_readable():
    """X3-13 / X4-09: «Pay / +Каб / Ред. / Уд.» → полные слова или значки с подписью."""
    src = _read(ROOT / "src/pages/crm/CrmSessions.tsx")
    for old in (">+Каб<", ">Ред.<", ">Уд.<", "'Каб ✓'"):
        assert old not in src, f"CrmSessions: сокращение {old} вернулось"
    assert 'aria-label="Удалить сессию"' in src and 'aria-label="Изменить сессию"' in src, \
        "CrmSessions: у значков строки нет подписи для диктора"


def test_money_and_dates_through_format():
    """Суммы и даты — через utils/format: без .toFixed, toLocaleDateString,
    «GEL» у суммы и date-fns-месяцев ('d MMM', 'LLLL')."""
    for p in FILES:
        src = _read(p)
        for bad in (".toFixed(", "toLocaleDateString(", "toLocaleTimeString("):
            assert bad not in src, f"{_rel(p)}: {bad} — используйте formatMoney/formatDayMonth/formatTime"
        months = _hits(r"format\([^;\n]*?'[^']*(?:MMM|LLLL)[^']*'", src)
        assert not months, f"{_rel(p)}: месяц через date-fns {months[:1]} — используйте formatDayMonth/formatMonthLabel"
        assert not re.search(r"\|\|\s*'GEL'\)\s*\}|\{\s*[\w.?]*currency\s*\|\|\s*'GEL'\s*\}", src), \
            f"{_rel(p)}: «GEL» показывается пользователю — нужен знак ₾"


def test_loading_is_not_empty():
    """rule 8: пока грузится — скелетон, при сбое — ErrorBar, «пусто» только после ответа."""
    for name in ("CrmSessions.tsx", "CrmClients.tsx", "CrmNotes.tsx", "CrmFinances.tsx", "CrmDashboard.tsx", "CrmBookings.tsx"):
        src = _read(ROOT / "src/pages/crm" / name)
        assert "Skeleton" in src, f"{name}: нет скелетона на время загрузки"
    for name in ("CrmSessions.tsx", "CrmClients.tsx", "CrmNotes.tsx", "CrmFinances.tsx", "CrmDashboard.tsx", "CrmClientDetail.tsx", "CrmProfile.tsx"):
        src = _read(ROOT / "src/pages/crm" / name)
        assert "ErrorBar" in src, f"{name}: сбой загрузки должен показывать ErrorBar, а не «пусто»"
    for name in ("CrmSessions.tsx", "CrmClients.tsx", "CrmNotes.tsx", "CrmFinances.tsx", "CrmBookings.tsx"):
        for old in ("'Загрузка...'", ">Загрузка...<", "Загрузка клиентов…", "Загрузка…<"):
            assert old not in _read(ROOT / "src/pages/crm" / name), f"{name}: текст «Загрузка…» вместо скелетона"


def test_delete_session_modal_on_sheet():
    src = _read(ROOT / "src/components/crm/DeleteSessionModal.tsx")
    assert "from '../ui/Sheet'" in src and 'variant="danger"' in src, \
        "DeleteSessionModal: окно удаления — на общем Sheet с Button variant=danger"
    assert "Оставить" in src, "DeleteSessionModal: кнопка отказа называет действие («Оставить»)"


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
    print("СТОРОЖ wave1-crm: OK" if not failures else f"СТОРОЖ wave1-crm УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
