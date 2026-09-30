"""СТОРОЖ wave1 — десктопные компоненты админки на общей основе (волна 1, шаг 2).

Область: все файлы src/components/admin/** (шахматка AdminChessboardView,
карточки клиента UserBookingsTab/UserTransactions/UserBonuses/…, касса
cashbox/*, окна modals/*, AdminCancelBookingModal и т.д.).

Что ловит (только чтение исходников, без сети и базы):
  X1-07 / X3-11 / G7-04 — системные confirm()/prompt()/alert(): вместо них
           общий ConfirmDialog (кнопки называют действие), шторка с полем
           или уведомление.
  X1-05  — шрифт мельче 12 px (inline fontSize и Tailwind text-[Npx]).
  X1-03  — бледный текст: text-gray-300/400, text-unbox-grey, #888/#999/#bbb,
           color: GH/COLOR.ink30/20/40 (пустые/неактивные — только с пометкой
           cursor-not-allowed / disabled / aria-hidden).
  X3     — обращение на «ты» («перетащи», «выбери», «обратись»…).
  Владелец — «Пересдать»: никаких «переаренда», «перебронирование», «Пересд.»,
           «Пересдано» (статус — «Пересдана» / «На пересдаче»).
  G7-15 / X1-16 — эмодзи вместо значков Lucide.
  Токены  — кирпичный #B84A2F и сырые hex-цвета в компонентах.
  G7-05  — легенда шахматки: слова из общего словаря + «Ждёт подтверждения».

    python3 backend/tests/guard_wave1_admincomp.py
"""
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
AREA = ROOT / "src" / "components" / "admin"


def _files():
    return sorted(p for p in AREA.rglob("*.tsx")) + sorted(p for p in AREA.rglob("*.ts"))


def _strip_comments(src: str) -> str:
    """Убираем комментарии (в них допустимо цитировать старые слова и prompt())."""
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    src = re.sub(r"(?m)(^|[^:'\"`])//.*$", r"\1", src)
    return src


def _code(p: pathlib.Path) -> str:
    return _strip_comments(p.read_text(encoding="utf-8"))


def _rel(p: pathlib.Path) -> str:
    return str(p.relative_to(ROOT))


def _hits(pattern: str, allow_line=None):
    rx = re.compile(pattern)
    out = []
    for p in _files():
        for i, line in enumerate(_code(p).split("\n"), 1):
            if rx.search(line) and not (allow_line and allow_line(line)):
                out.append(f"{_rel(p)}:{i}: {line.strip()[:120]}")
    return out


def test_area_exists():
    assert AREA.is_dir() and len(_files()) >= 40, "папка src/components/admin не найдена или пуста"


def test_no_native_confirm_prompt_alert():
    # Нативный вызов — window.confirm( / confirm('…') / prompt(…) / alert(…).
    # Общий диалог вызывается как confirm({ … }) — объект, это разрешено.
    bad = _hits(r"(?<![\w.])(?:window\.)?(?:confirm|prompt|alert)\s*\(\s*(?!\{)")
    assert not bad, "системные confirm/prompt/alert вернулись:\n" + "\n".join(bad)


def test_confirm_dialog_is_used_where_confirms_were():
    for rel in (
        "AdminChessboardView.tsx", "UserBookingsTab.tsx",
        "cashbox/AddCashboxTransactionModal.tsx",
    ):
        src = (AREA / rel).read_text(encoding="utf-8")
        assert "useConfirmDialog" in src, f"{rel}: подтверждение не через общий ConfirmDialog"
    # prompt() с причиной → шторка с полем
    for rel in ("AdminChessboardView.tsx", "UserBookingsTab.tsx", "cashbox/PreCloseShiftChecklist.tsx"):
        src = (AREA / rel).read_text(encoding="utf-8")
        assert "<Sheet" in src and "TextArea" in src, f"{rel}: причина снова через prompt(), а не поле в шторке"


def test_no_font_smaller_than_12():
    bad = _hits(r"fontSize\s*:\s*['\"]?(?:[0-9]|1[01])(?:\.\d+)?(?:px)?['\"]?\s*[,}]")
    bad += _hits(r"text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]")
    bad += _hits(r"text-\[0\.[0-6]\d*rem\]")
    assert not bad, "шрифт мельче 12 px:\n" + "\n".join(bad)


def test_micro_labels_letter_spacing():
    bad = _hits(r"letterSpacing:\s*'0\.(?:0[7-9]|1\d*|2\d*)em'")
    bad += _hits(r"(?<![\w-])tracking-widest(?![\w-])")
    assert not bad, "разрядка моно-подписей больше 0.06em:\n" + "\n".join(bad)


def _pale_allowed(line: str) -> bool:
    # Бледное допустимо только для неактивного и декоративного.
    return any(k in line for k in ("cursor-not-allowed", "disabled", "aria-hidden", "past ?"))


def test_no_pale_text():
    bad = _hits(
        r"text-(?:gray|slate|zinc|neutral|stone)-(?:300|400)\b|text-unbox-grey"
        r"|color\s*:\s*['\"]#(?:999|aaa|bbb|888|9ca3af)['\"]|text-\[#(?:999|aaa|bbb|888)\]"
        r"|color\s*:\s*(?:GH|COLOR)\.ink(?:40|30|20|10)\b|text-ink-(?:40|30|20)\b",
        allow_line=_pale_allowed,
    )
    assert not bad, "бледный текст (минимум ink-60):\n" + "\n".join(bad)


TY = re.compile(
    r"(?<![А-Яа-яЁё])(?:[Тт]ы|[Тт]ебе|[Тт]ебя|[Тт]вой|[Тт]воя|[Тт]воё|[Тт]вои|[Тт]воих|[Тт]обой"
    r"|[Пп]еретащи|[Вв]ыбери|[Зз]акрой|[Оо]братись|[Нн]ачни|[Нн]ажми|[Вв]веди|[Уу]кажи|[Пп]роверь"
    r"|[Пп]опробуй|[Пп]ополни|[Пп]одожди|[Оо]ткрой|[Дд]обавь|[Сс]охрани|[Уу]дали|[Нн]апиши)(?![А-Яа-яЁё])"
)


def test_no_ty_address():
    bad = []
    for p in _files():
        for i, line in enumerate(_code(p).split("\n"), 1):
            m = TY.search(line)
            if m:
                bad.append(f"{_rel(p)}:{i}: «{m.group(0)}» — {line.strip()[:100]}")
    assert not bad, "обращение на «ты» (владелец: везде «вы»):\n" + "\n".join(bad)


def test_rerent_is_called_peresdat():
    bad = _hits(r"[Пп]ереаренд|[Пп]еребронир|[Пп]ересд\.|Пересдано")
    assert not bad, "старые слова вместо «Пересдать / На пересдаче / Пересдана»:\n" + "\n".join(bad)


def test_no_emoji_icons():
    bad = _hits(r"[\U0001F300-\U0001FAFF☀-➿⭐✅⏳⌛]")
    assert not bad, "эмодзи вместо значков Lucide:\n" + "\n".join(bad)


def test_no_brick_red_and_no_raw_hex():
    brick = _hits(r"#B84A2F|184\s*,\s*74\s*,\s*47")
    assert not brick, "старый кирпичный красный (нужен --status-danger-*):\n" + "\n".join(brick)
    hexes = _hits(r"#[0-9a-fA-F]{6}\b|['\"]#[0-9a-fA-F]{3}['\"]")
    assert not hexes, "сырые hex-цвета вместо токенов:\n" + "\n".join(hexes)


def test_no_decorative_purple_blue():
    bad = _hits(r"\b(?:bg|text|border|ring)-(?:purple|violet|indigo|blue|sky|teal)-\d{2,3}\b")
    assert not bad, "фиолетовое/синее «для красоты» (цвет — только статус):\n" + "\n".join(bad)


def test_no_gel_shown_to_users():
    bad = _hits(r"\(GEL\)|['\"`>]\s*[^'\"`<]*\bGEL\b[^'\"`<]*['\"`<]", allow_line=lambda l: "currency" in l)
    assert not bad, "«GEL» в интерфейсе вместо ₾:\n" + "\n".join(bad)


def test_chessboard_legend_and_statuses():
    src = (AREA / "AdminChessboardView.tsx").read_text(encoding="utf-8")
    code = _strip_comments(src)
    assert "statusLabel('booking', 'pending_approval', 'staff')" in code, \
        "в легенде шахматки нет «Ждёт подтверждения» (G7-05)"
    assert "На пересдаче" in code and "statusLabel('booking', 're-rented'" in code, \
        "легенда: «На пересдаче» / «Пересдана» — слова владельца"
    assert "<StatusBadge" in code, "статус в карточке брони не через общий StatusBadge"
    assert "'✅ Активно'" not in code and "b.status;" not in code, "локальная копия подписей статуса вернулась"
    # Сетка остаётся фиксированной (владелец 03.07: колонки не разъезжаются).
    assert "tableLayout: 'fixed'" in code, "шахматка потеряла table-layout: fixed"


def test_status_badges_from_dictionary():
    for rel in ("UserBookingsTab.tsx", "UserTransactions.tsx"):
        src = _strip_comments((AREA / rel).read_text(encoding="utf-8"))
        assert "<StatusBadge" in src, f"{rel}: статус не через общий StatusBadge"
    ub = _strip_comments((AREA / "UserBookingsTab.tsx").read_text(encoding="utf-8"))
    for old in ("'Забронировано'", "'Завершено'", "'Пересдано'"):
        assert old not in ub, f"UserBookingsTab: снова своя подпись статуса {old}"


def test_money_through_formatter():
    bad = _hits(r"toFixed\(\d\)\s*\}?\s*₾|\.toFixed\(\d\)\}\s*₾|\$\{[^}]*toFixed\([^)]*\)\}\s*₾")
    assert not bad, "сумма собрана вручную через toFixed + ₾ (нужен formatGel/<Money>):\n" + "\n".join(bad)


def test_load_errors_are_not_empty_states():
    ub = (AREA / "UserBonuses.tsx").read_text(encoding="utf-8")
    assert "ErrorBar" in ub and "// ignore" not in ub, "бонусы: ошибка загрузки снова выглядит как «Бонусов нет»"
    led = (AREA / "UserBalanceLedger.tsx").read_text(encoding="utf-8")
    assert "ErrorBar" in led, "лента баланса: ошибка без «Повторить»"
    inbox = (AREA / "AdminInbox.tsx").read_text(encoding="utf-8")
    assert "ErrorBar" in inbox and "setFailed" in inbox, "Inbox: при ошибке пишет «всё под контролем»"


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
    print("СТОРОЖ wave1-admincomp: OK" if not failures else f"СТОРОЖ wave1-admincomp УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
