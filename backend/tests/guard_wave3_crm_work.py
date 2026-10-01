"""СТОРОЖ wave3-B — десктопная Psy-CRM: оболочка и меню, дашборд, сессии (01.10).

Файлы: src/pages/crm/CrmLayout.tsx, CrmDashboard.tsx, CrmSessions.tsx.

Что ловит:
  В4    — меню снова плоское с номерами 01–11; нет групп «Работа / Кабинеты /
          Деньги / Я»; «Расписание» вместо «Часы приёма»; «Шахматка» вернулась
          в «Сессии»; «Купить абонемент» снова ведёт на витрину /subscriptions.
  G5-04 — дашборд снова открывается отчётом: «Сегодня» не первым, «Сегодня»
          берёт upcomingSessions (сервер не отдаёт прошедшие за день) или
          показывается только на узком экране; нет полок «Долги» и
          «Без следующей встречи».
  В5    — оплата в один клик не через quickPaySession, нет тоста «Вернуть»,
          «Вернуть» не тем путём (unmarkPaidSession), оплата через
          updateSession({isPaid}).
  В1    — деньги за месяц на дашборде снова «Доход за месяц».
  Ревью — в «просмотре как специалист» в «Сегодня» снова видна кнопка
          «Отметить оплату» (везде в режиме просмотра она скрыта).
  G5-08 — в строке сессии снова 3–4 кнопки вместо одной главной и «⋯ Ещё».
  G5-13 / G5-M1 — «Новая сессия» снова своя форма (SessionForm), ?new=1 не
          открывает шторку, после записи нет «Все» / перечитки / прокрутки.
  Деньги — формулы «Заработано» / «Касса · с долгами» (блок stats) и
          totalInGel на дашборде изменились без ревью.
  X4-04 / X3-22 / G5-22 / G5-14 — синк снова самодельным окном, «Ошибка»
          без смысла, заголовки clamp(), вкладки без aria-selected.

Без сети и без базы (только чтение исходников):

    python3 backend/tests/guard_wave3_crm_work.py
"""
import hashlib
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

ROOT = pathlib.Path(__file__).parent.parent.parent
LAYOUT = "src/pages/crm/CrmLayout.tsx"
DASH = "src/pages/crm/CrmDashboard.tsx"
SESS = "src/pages/crm/CrmSessions.tsx"

# Отпечаток блока stats в CrmSessions («Заработано» / «Касса · с долгами»):
# код без комментариев и пробелов. Поменяли формулу — это денежная правка:
# сначала ревью (money-reviewer) и решение владельца, потом новый отпечаток.
# Значение снято с кода до волны 3 (d9be5ed) — волна 3 формулы не меняла.
STATS_FINGERPRINT = "82131c00dcee448fd6cbdc23aa176365a716af9a769d44d77410a3f6232fab4c"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(rel: str) -> str:
    """Исходник без комментариев (// … и /* … */, в т.ч. {/* … */} в JSX)."""
    src = _read(rel)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _stats_block(src: str) -> str:
    start = src.index("const stats = useMemo(")
    end = src.index("}, [sessions, monthPayments, monthStart, monthEnd, clientMap]);", start)
    return src[start:end]


def _fingerprint(block: str) -> str:
    block = re.sub(r"/\*.*?\*/", "", block, flags=re.S)
    block = re.sub(r"//[^\n]*", "", block)
    return hashlib.sha256(re.sub(r"\s+", "", block).encode("utf-8")).hexdigest()


# ─────────────────────────────────────────────────────────────────────────
# Меню (В4)
# ─────────────────────────────────────────────────────────────────────────

def test_menu_four_groups_without_numbers():
    src = _code(LAYOUT)
    titles = re.findall(r"title:\s*'([^']+)'", src)
    assert titles[:4] == ["Работа", "Кабинеты", "Деньги", "Я"], \
        f"меню CRM: группы должны быть «Работа / Кабинеты / Деньги / Я», сейчас {titles[:4]}"
    assert "padStart(2, '0')" not in src, "в меню/шапке снова номера 01–11"
    assert "UNBOX · CRM" not in src, "в шапке снова дублирующее «UNBOX · CRM» (G5-19)"
    assert "'Часы приёма'" in src and "'Расписание'" not in src, "«Расписание» должно называться «Часы приёма»"
    assert "Шахматка" not in src, "«Шахматка» в меню — она только в «Бронированиях»"
    assert "'/crm/subscription'" in src, "в меню нет абонемента (/crm/subscription)"
    assert "aria-current={active ? 'page' : undefined}" in src, "у пункта меню нет aria-current (G5-14)"


def test_menu_quick_actions_open_forms():
    src = _code(LAYOUT)
    assert "/crm/sessions?new=1" in src, "быстрое действие «Новая сессия» снова просто открывает список"
    assert "viewingOther ? [] :" in src, "в просмотре чужого кабинета снова видны кнопки создания"


# ─────────────────────────────────────────────────────────────────────────
# Дашборд (G5-04, В1, В5)
# ─────────────────────────────────────────────────────────────────────────

def test_dashboard_order_today_first():
    src = _code(DASH)
    order = [
        ('aria-label="Сессии сегодня"', "«Сегодня»"),
        ('title="Долги"', "«Долги»"),
        ('title="Без следующей встречи"', "«Без следующей встречи»"),
        ('aria-label="Показатели месяца"', "ряд показателей"),
        ("<BarChart", "график"),
    ]
    pos = []
    for needle, name in order:
        i = src.find(needle)
        assert i != -1, f"дашборд: нет блока {name}"
        pos.append((i, name))
    assert [n for _, n in sorted(pos)] == [n for _, n in pos], \
        f"дашборд: порядок должен быть {[n for _, n in pos]}, сейчас {[n for _, n in sorted(pos)]}"
    assert "ghNarrow &&" not in src and "useGHDashNarrow" not in src, \
        "«Сегодня» снова только на узком экране — должно быть на любой ширине"


def test_dashboard_today_includes_past_sessions():
    src = _code(DASH)
    assert "crmApi.getSessions({ dateFrom: addDaysYmd(today, -1), dateTo: today" in src, \
        "«Сегодня» должно читать GET /crm/sessions за сегодня (с запасом на пояс)"
    assert "tbilisiToday()" in src and "utcNaiveToTbilisi(s.date)?.date === today" in src, \
        "«Сегодня» — день по Тбилиси (tbilisiToday / utcNaiveToTbilisi)"
    assert not re.search(r"upcomingSessions[^\n]*\)\.filter\([^\n]*toDateString", src), \
        "«Сегодня» снова из upcomingSessions — сервер не отдаёт прошедшие за день"


def test_dashboard_one_click_pay_with_undo():
    src = _code(DASH)
    assert "await quickPaySession(s.id)" in src, "оплата в «Сегодня» — только quickPaySession"
    assert "undoToast(`Отмечено" in src, "после оплаты нет тоста «Отмечено · Вернуть» (В5)"
    assert "crmApi.unmarkPaidSession(s.id)" in src, "«Вернуть» должно снимать оплату тем же путём, что шторка"
    assert "Отметить оплату · " in src, "кнопка оплаты должна называть сумму: «Отметить оплату · 140 ₾»"
    assert not re.search(r"updateSession\([^)]*isPaid", src), "оплата через updateSession({isPaid}) запрещена"


def test_dashboard_today_pay_hidden_when_viewing_other():
    """Ревью волны 3: в «просмотре как специалист» «Отметить оплату» в «Сегодня»
    не показывается — как кнопки «Кабинет», «Записать» и «Новый клиент»."""
    src = _code(DASH)
    i = src.index("onClick={() => handlePay(s)}")
    cond = src[src.rindex("{!cancelled", 0, i):i]
    assert "&& !viewingOther && (" in cond, \
        "«Сегодня»: «Отметить оплату» видна в режиме просмотра чужой CRM"


def test_dashboard_shelves_use_wave3_sheets():
    src = _code(DASH)
    assert "<UnpaidSessionsSheet" in src and "setDebtFor(client)" in src, "«Долги» должны открывать UnpaidSessionsSheet"
    assert "debts.slice(0, SHELF_LIMIT)" in src and "SHELF_LIMIT = 5" in src, "«Долги» — 5 строк"
    assert "<NewSessionSheet" in src and "setNewFor(client)" in src, "«Без следующей встречи» → «Записать» → NewSessionSheet"
    assert "dashboard?.clientsWithoutFutureSessions" in src
    assert "<NewClientSheet" in src, "«Новый клиент» на дашборде — шторкой"
    assert "isNewAccount &&" in src and "С чего начать" in src, "новому аккаунту — чек-лист вместо нулей"


def test_dashboard_money_words_and_formulas():
    src = _code(DASH)
    assert "'Касса · с долгами'" in src, "В1: деньги за месяц — «Касса · с долгами»"
    assert "Доход за месяц" not in src, "В1: «Доход за месяц» → «Касса · с долгами»"
    assert "totalInGel(revenueByCurrency)" in src and "totalInGel(debtByCurrency)" in src, \
        "totalInGel на дашборде трогать нельзя"
    assert "'/crm/subscription'" in src and "'/subscriptions'" not in src, \
        "«Купить абонемент» должен вести на /crm/subscription"
    assert "ДЕЙСТВИЕ ·" not in src, "в быстрых действиях снова «→ ДЕЙСТВИЕ · 01»"


def test_dashboard_no_clickable_divs_and_header():
    src = _code(DASH)
    assert not re.search(r"<div[^>]*\bonClick=", src), "кликабельный <div> — используйте Link/кнопку (X4-10)"
    assert "<PageHeader" in src, "шапка дашборда — общий PageHeader (G5-22)"
    assert "clamp(" not in src, "размер заголовка резиновый clamp() (G5-22)"
    assert "viewingOther ? undefined :" in src, "в просмотре чужого кабинета кнопки создания должны прятаться"


# ─────────────────────────────────────────────────────────────────────────
# Сессии (G5-08, G5-13, G5-M1, В4, В5)
# ─────────────────────────────────────────────────────────────────────────

def test_sessions_formulas_unchanged():
    block = _stats_block(_read(SESS))
    fp = _fingerprint(block)
    assert fp == STATS_FINGERPRINT, (
        "формулы «Заработано» / «Касса · с долгами» (stats в CrmSessions) изменились — "
        f"это денежная правка, нужно ревью. Новый отпечаток: {fp}"
    )
    assert "'Касса · с долгами'" in _code(SESS) and "'Заработано'" in _code(SESS)


def test_sessions_new_session_sheet():
    src = _code(SESS)
    assert "function SessionForm" not in src and "<SessionForm" not in src, "вернулась старая форма SessionForm"
    assert "<NewSessionSheet" in src, "«Новая сессия» — общая шторка NewSessionSheet"
    assert "searchParams.get('new') !== '1'" in src, "/crm/sessions?new=1 должен открывать шторку"
    m = re.search(r"const handleCreated = \(session: CrmSession\) => \{(.*?)\n    \};", src, re.S)
    assert m, "нет handleCreated"
    body = m.group(1)
    assert "setStatusFilter('all')" in body, "после записи — фильтр «Все» (иначе новую не видно, G5-M1)"
    assert "setHighlightId(session.id)" in body, "после записи — подсветка новой сессии"
    assert "fetchSessions(" in body or "setCurrentMonth(" in body, "после записи список надо перечитать"
    assert "scrollIntoView(" in src, "после записи — прокрутка к новой сессии"


def test_sessions_no_chessboard_view():
    src = _code(SESS)
    assert "CrmChessboardView" not in src, "«Шахматка» вернулась в «Сессии» — она в «Бронированиях» (В4)"
    assert "'Шахматка'" not in src
    assert 'role="tab"' in src and "aria-selected={p.view === v.key}" in src, "вкладки вида без role=tab/aria-selected"
    assert "aria-pressed={p.statusFilter === s.key}" in src, "фильтры статуса без aria-pressed"


def test_session_row_one_primary_action():
    src = _code(SESS)
    m = re.search(r"function GHSessionRow\((.*?)\n}\n", src, re.S)
    assert m, "нет GHSessionRow"
    row = m.group(1)
    assert "canPay && isPastSession(session) ? 'pay' : canBook ? 'cab' : null" in row, \
        "главное действие: «Отметить оплату» (началась и не оплачена), иначе «Кабинет»"
    assert "<RowMenu" in row, "остальные действия — в «⋯ Ещё»"
    assert 'aria-haspopup="menu"' in src and 'aria-label="Ещё действия"' in src, "у «⋯» нет подписи/aria-haspopup"
    # Красная корзина в каждой строке — только внутри меню.
    assert "<Trash2" in row and row.index("<Trash2") > row.index("<RowMenu"), "«Удалить» должно быть в «⋯ Ещё»"
    assert "<Link" in row and "to={`/crm/clients/${session.clientId}`}" in row, "имя клиента — ссылка на карточку"
    assert "onKeyDown={onRowKey}" in row, "строку нельзя открыть на правку с клавиатуры (Enter)"


def test_sessions_pay_with_undo():
    src = _code(SESS)
    m = re.search(r"async function payWithUndo\((.*?)\n}\n", src, re.S)
    assert m, "нет payWithUndo (оплата в один клик, В5)"
    body = m.group(1)
    assert "await quickPay(sessionId)" in body, "оплата — только quickPaySession"
    assert "undoToast(`Отмечено" in body, "нет тоста «Отмечено · Вернуть»"
    assert "crmApi.unmarkPaidSession(sessionId)" in body, "«Вернуть» — unmarkPaidSession"
    assert not re.search(r"updateSession\([^)]*isPaid", src), "оплата через updateSession({isPaid}) запрещена"


def test_sessions_sync_on_sheet_and_errors():
    src = _code(SESS)
    assert 'title="Синхронизация с Google Календарём"' in src and "<Sheet" in src, \
        "окно синхронизации — на общем Sheet (X4-04)"
    assert "fixed inset-0" not in src, "самодельный оверлей вернулся"
    assert "syncIgnoreNames" in src and "syncExcluded" in src, "логика исключений синка пропала"
    for bad in ("|| 'Ошибка')", "'Ошибка синхронизации'", "toast.error('Ошибка')"):
        assert bad not in src, f"пустое сообщение об ошибке {bad!r} (X3-22)"
    assert "<PageHeader" in src and "clamp(" not in src, "шапка «Сессий» — PageHeader без clamp() (G5-22)"


def test_no_specialist_id_in_writes():
    """Изоляция: в записывающих запросах specialistId не передаём."""
    for rel in (DASH, SESS, LAYOUT):
        src = _code(rel)
        bad = re.findall(r"(?:createSession|updateSession|quickPaySession|createClient|markAllPaid|createPayment)\([^)]*specialistId", src)
        assert not bad, f"{rel}: specialistId в записи {bad[:1]}"


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
    print("СТОРОЖ wave3-crm-work: OK" if not failures else f"СТОРОЖ wave3-crm-work УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
