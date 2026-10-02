"""СТОРОЖ wave4 · desktop_today — «Сегодня», шахматка и список броней на компьютере
(волна 4, пакет B, 01.10).

Решения владельца:
  В2 — неоплаченная бронь (к оплате > 0, прошедшая или будущая) заметна тоном
       danger везде: шахматка (на КАЖДОЙ брони, у 30-минутной — значок в углу),
       «Сегодня», список броней. Легенда объясняет «к оплате» / «оплачено».
  В3 — «Принять оплату» из «Сегодня»: по умолчанию весь долг клиента, с подписью
       «из них за сегодня».
  «Две колонки» — /admin: касса + сводка «взять X ₾ с N клиентов» → AdminInbox →
       слева «Кто придёт», справа «Взять сегодня», «Сверх лимита», прогноз.

Что ловит (только чтение исходников):
  G7-01 — /admin снова витрина KPI/графиков вместо «кто сегодня и кто должен»;
  N1/G7-05 — бронь в шахматке без отметки оплаты (в т.ч. 30-минутная);
  G7-12 — панель брони снова плавает поверх сетки;
  G7-admin-core-M4 — «Продолжить» занимает колонку без выделения, слот 44 px
          на ноутбуке, нет прокрутки к текущему часу;
  G7-06 / G7-18 / X2-14 — список из CSS-grid строк, «+ Бронь» на /dashboard/bookings;
  деньги — отпечатки handleConfirm («Принять оплату»), отмены/переноса/продления/
          «Часа в подарок»/пересдачи/dueMap в шахматке и списке не изменились.

    python3 backend/tests/guard_wave4_desktop_today.py
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
DASH = "src/pages/admin/Dashboard.tsx"
LIST = "src/pages/admin/Bookings.tsx"
CHESS = "src/components/admin/AdminChessboardView.tsx"
HINTS = "src/components/admin/BookingMoneyHints.tsx"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(text: str) -> str:
    """Без комментариев (// … и /* … */, в т.ч. {/* … */} в JSX)."""
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", text)


def _between(src: str, start: str, end: str) -> str:
    i = src.index(start)
    j = src.index(end, i)
    return src[i:j]


def _fp(text: str, n: int = 16) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:n]


# ─────────────────────────────────────────────────────────────────────────
# /admin — «Сегодня»
# ─────────────────────────────────────────────────────────────────────────

def test_today_is_first_and_built_on_admin_today():
    src = _read(DASH)
    code = _code(src)
    for name in ("todayRows(", "todaySummary(", "byClient(", "batumiDayKey("):
        assert name in code, f"«Сегодня» не через src/utils/adminToday.ts ({name})"
    assert "computeDueByBooking(" in code, "«к оплате» на /admin не из computeDueByBooking"
    assert 'title="Сегодня"' in code, "первый экран /admin — не «Сегодня»"
    # Порядок: сводка → AdminInbox → «Кто придёт» → «Взять сегодня» → «Сверх лимита» → прогноз.
    order = ["data-today-summary", "<AdminInbox", ">Кто придёт<", ">Взять сегодня<", ">Сверх лимита<", "Прогноз · завтра"]
    pos = [code.find(m) for m in order]
    assert all(p != -1 for p in pos), f"нет блока «Сегодня»: {[m for m, p in zip(order, pos) if p == -1]}"
    assert pos == sorted(pos), "блоки «Сегодня» не в порядке варианта «Две колонки»"


def test_today_has_no_kpi_showcase():
    code = _code(_read(DASH))
    assert "AnalyticsCharts" not in code, "графики снова на /admin (их место — «Финансы»)"
    assert "Выручка · Месяц" not in code and "Выручка за месяц" not in code, "KPI выручки снова на /admin"
    assert "getAnalytics(" not in code, "/admin снова тянет кассовую аналитику"
    assert "padStart" not in code, "декоративные нули («00», «040») вернулись на /admin"


def test_today_no_new_booking_requests():
    code = _code(_read(DASH))
    assert "fetchAllBookings()" in code, "«Сегодня» не грузит полный список броней"
    assert "bookingsApi" not in code and "getAllBookings" not in code, \
        "«Сегодня» делает свой запрос в /bookings (должно хватать fetchAllBookings)"


def test_today_due_marks_and_danger_tone():
    code = _code(_read(DASH))
    assert "<DueBadge due={r.due} paid={r.paid}" in code, "в ленте дня нет «к оплате / оплачено»"
    assert "STATUS.danger" in code, "неоплаченные в «Сегодня» не тоном danger (В2)"


def test_today_accept_payment_defaults_to_whole_debt():
    code = _code(_read(DASH))
    assert "<AcceptPaymentButton" in code, "в «Взять сегодня» нет «Принять оплату»"
    row = _between(code, "function CollectRow(", "function RecentBookings(")
    assert "c.total > 0 ? c.total : c.today" in row, "сумма по умолчанию — не весь долг (В3)"
    assert "из них за сегодня" in row, "нет подписи «из них за сегодня» (В3)"
    assert "defaultAmount={amount}" in row


def test_today_cash_line_only_with_finance_access():
    code = _code(_read(DASH))
    assert "hasPermission(currentUser, 'finance.manage_cashbox')" in code, "строка кассы без проверки прав"
    assert "смена открыта с" in code and "наличные" in code, "нет строки «Касса: смена открыта с … · наличные …»"


# ─────────────────────────────────────────────────────────────────────────
# «Принять оплату» — вынесена, handleConfirm байт-в-байт
# ─────────────────────────────────────────────────────────────────────────

# 01.10 (guard_duplicate_payment_2026_10): handleConfirm осознанно изменён — запрос идёт через
# createIncomeWithDuplicateGuard (дубль → «Записать ещё одну?»), платёж и fetchUsers разведены по
# двум try, ошибка — paymentErrorText вместо «нужен доступ к кассе». Поля тела прежние.
# Прежний отпечаток: 4f175bb15d224eb5af9e1aa7efe55ea5ce6e698774dd8ae7d8110789eb201262.
HANDLE_CONFIRM_FP = "16309e7b20430aa1383eb467ddb7e70b797d442c2c6677e97efa7252f9d483e9"


def test_accept_payment_handle_confirm_fingerprint():
    src = _read(HINTS)
    i = src.index("    const handleConfirm = async")
    j = src.index("    };\n", i) + len("    };\n")
    block = src[i:j]
    assert hashlib.sha256(block.encode("utf-8")).hexdigest() == HANDLE_CONFIRM_FP, \
        "handleConfirm («Принять оплату») изменён — это деньги, нужен денежный ревью и новый отпечаток"
    assert src.count("const handleConfirm = async") == 1, "второй handleConfirm — оплата разошлась"
    btn = src[src.index("export function AcceptPaymentButton("):]
    assert "const handleConfirm = async" in btn, "handleConfirm не внутри AcceptPaymentButton"
    hints = _code(src[:src.index("export function AcceptPaymentButton(")])
    assert "<AcceptPaymentButton" in hints, "попап брони больше не через общую AcceptPaymentButton"


# ─────────────────────────────────────────────────────────────────────────
# Шахматка
# ─────────────────────────────────────────────────────────────────────────

def test_chessboard_due_mark_on_every_booking():
    src = _read(CHESS)
    d = src[src.index("// ── DESKTOP VIEW ──"):]
    assert "cell.colspan === 1 ? (" in d, "30-минутная бронь без отметки оплаты (нужна ветка colspan === 1)"
    assert "<CellDueMark info={dueMap.get(b.id)} corner />" in d, "у 30-минутной брони нет значка в углу"
    # Сумма «к оплате» — на любой брони ≥ 1 ч; слово «к оплате» — от 2 ч (roomy):
    # в 1,5 ч оно обрезалось (доработка 01.10, guard_wave4_polish).
    assert "{roomy ? 'к оплате ' : ''}{formatGel(d.due)}" in d, "у брони ≥ 1 ч нет «к оплате X ₾»"
    helper = _between(src, "function CellDueMark(", "function LegendItem(")
    assert "aria-label={label}" in helper and "title={label}" in helper, "значок в углу без подписи"
    assert "`к оплате ${formatGel(info.due)}`" in helper
    # Мобильная ветка — тоже с отметкой.
    m = src[src.index("// ── MOBILE VIEW ──"):src.index("// ── DESKTOP VIEW ──")]
    assert "<CellDueMark info={dueMap.get(b.id)} />" in m, "на телефоне у брони нет отметки оплаты"


def test_chessboard_unpaid_is_danger_tone():
    src = _read(CHESS)
    style = _between(src, "const getBookingStyle = (b: BookingHistoryItem) => {", "// ── Popup status")
    assert "dueInfo.due > 0" in style and "b.status === 'completed'" in style, \
        "неоплаченная (в т.ч. прошедшая) бронь не выделена (В2)"
    assert "status-danger-bg" in style.split("dueInfo.due > 0", 1)[1][:400], "неоплаченная бронь не тоном danger"


def test_chessboard_legend_explains_money():
    src = _read(CHESS)
    leg = _between(src, "data-chess-legend", "</div>")
    assert "к оплате" in leg and "списано с баланса" in leg, "легенда не объясняет «к оплате» / «списано с баланса»"
    assert "ui-badge--danger" in leg and "ui-badge--ok" in leg


def test_chessboard_panel_beside_grid_and_continue_only_on_selection():
    src = _read(CHESS)
    code = _code(src)
    assert "fixed bottom-6 right-6" not in code, "панель брони снова плавает поверх сетки (G7-12)"
    assert "data-booking-panel" in code and "<aside" in code, "панель брони не справа от сетки"
    assert "const hasNewSelection = selectedNewBlocks.length > 0;" in code
    assert "{hasNewSelection && <col" in code and "{hasNewSelection && <td" in code and "{hasNewSelection && <th" in code, \
        "колонка «Продолжить» занимает место без выделения"


def test_chessboard_slot_width_and_scroll_to_now():
    code = _code(_read(CHESS))
    assert "window.innerWidth < 1600 ? 36 : 44" in code, "на ноутбуке (< 1600 px) слот не 36 px"
    assert "TIME_SLOTS.length * 44" not in code, "ширина слота снова зашита 44 px"
    assert "data-slot={slot}" in code and "tbilisiNow()" in code and "scroller.scrollLeft" in code, \
        "сегодня шахматка не прокручивается к текущему часу"


CHESS_MONEY_FP = {
    ("const handleCancelConfirm = async", "    // «Час в подарок»"): "b655ef28838f2ce0",
    ("const handleBonusHour = async", "    const handleEditPrice"): "2dca2bd67b90e716",
    ("const handleToggleReRent = async", "    /** \"Продлить +30 мин\""): "73d6d7d0a5e4a3f7",
    ("const handleExtend = async", "    /** Сократить бронь"): "4c09297c63012f35",
    ("const doShorten = async", "    /** \"Перенести\""): "830d3b7231125147",
    ("const handleDropMove = async", "    /** Собственно перенос"): "25ae16962b80e8ba",
    ("const doMove = async", "    // ─── Render"): "40db36a87307795b",
    ("const dueMap = useMemo(() => {", "    // ── Bookings on selected date"): "b8f8276e912cd3bf",
}

LIST_MONEY_FP = {
    ("const handleCancelConfirm = async", "    // Excel #67"): "86f0510436e2d8e4",
    ("const handleReRent = async", "    // Excel #28"): "58c0c9e4e7dc5642",
    ("const handleToSubscription = async", "    // Excel #59"): "f5e119923ff5a68b",
    ("const loadAllBookings = async", "    // Только для списка"): "3bbe851c2336fa0a",
}


def test_money_handlers_untouched():
    for rel, table in ((CHESS, CHESS_MONEY_FP), (LIST, LIST_MONEY_FP)):
        src = _read(rel)
        for (start, end), fp in table.items():
            got = _fp(_between(src, start, end))
            assert got == fp, f"{rel}: {start} изменён (отпечаток {got} ≠ {fp}) — деньги, нужен денежный ревью"


# ─────────────────────────────────────────────────────────────────────────
# Список броней
# ─────────────────────────────────────────────────────────────────────────

def test_bookings_list_one_table_and_show_more():
    code = _code(_read(LIST))
    assert "<table data-bookings-table" in code, "список броней — не одна <table>"
    assert "gridTemplateColumns: '56px 110px 1fr 1fr" not in code, "строки снова отдельные CSS-grid"
    assert "Показать ещё" in code and "setLimit(l => l + PAGE)" in code and "const PAGE = 50;" in code, \
        "нет «Показать ещё 50»"
    assert "filteredBookings.slice(0, limit)" in code
    assert "<DueBadge due={info?.due} paid={!!info}" in code, "в списке нет «к оплате / оплачено»"
    assert "onOpenInGrid(booking.id)" in code, "клик по строке не открывает панель брони"
    assert "padStart" not in code, "нули «001» вернулись в список броней"


def test_new_booking_goes_to_chessboard():
    code = _code(_read(LIST))
    assert "navigate('/dashboard/bookings')" not in code, "«+ Бронь» снова уводит в личный кабинет"
    assert "setViewMode('grid'); setPickHint(true);" in code, "«+ Бронь» не открывает шахматку"
    assert "Выделите время в сетке" in code, "нет подсказки «Выделите время в сетке»"


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
    print("СТОРОЖ wave4-desktop_today: OK" if not failures else f"СТОРОЖ wave4-desktop_today УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
