"""СТОРОЖ · мобильная админка, волна 1 по ревью 09.11 (admin-ux + admin-design №1/2/10/12/14/15/20).

Что ловит (по пункту на каждую починку):
  №1  «Пополнить баланс»: филиал и способ не подставляются молча, сумма — только при долге,
      на кнопке вся операция «Пополнить на 40 ₾ · карта TBC · One».
  №4  после пополнения — «Вернуть» 5 с (удаление операции, защита от двойного нажатия).
  Р1/№3/№14 + design №1/№2  метки оплаты: «к оплате» / «✓ оплачено» / «◌ с баланса» /
      «абонемент»; у «Ждёт подтверждения» денежной метки нет; одно слово для срочной брони.
  №5  число на «Заявках» появляется сразу (отметка времени — после ответа).
  №6  поиск: телефон по цифрам, имя словами в любом порядке (node).
  №7  брони в карточке клиента нажимаются, «И ещё N» — ссылка, наверху «Принять оплату · N ₾».
  №8  отмена: процент не выбран, сумма под каждым вариантом (node), меньше 24 ч — подсказка;
      сотрудник не-владелец — причина ≥ 5 символов (сервер иначе 400, владелец 09.11).
  №9  цена 0 ₾ / ниже вдвое — только с причиной, на кнопке «(было N ₾)».
  Р3/№11  наличные в «Кассе» роль admin до закрытия смены не видит.
  №12/design №10  в журнале — клиент и кто записал, филиал названием (node).
  №13 «Доход» → «Деньги от клиента? → Пополнить баланс клиента», «Кто платит?».
  №15/design №12  один список «Должны» (Сегодня / Старые долги / Скоро уйдут за лимит), число —
      все с долгом, сводка наверху вместо баннеров.
  №16–№24  фильтры «Броней» в одну строку, «1 прошедшая скрыта», чек-лист карточкой на «Сегодня»,
      задачи, «Одобрить» с вопросом, просмотр операции, специалисты/команда.
  design №15/№20  в заявке цифры наверху; в шторке брони — оплата.

Без сети и базы (исходники + node ≥ 22.6, если есть):
    python3 backend/tests/guard_admin_wave1_2026_11.py
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
MA = "src/pages/mobile/admin/"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(rel: str) -> str:
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), _read(rel), flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


def _node():
    node = shutil.which("node")
    if not node:
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    return node if (major, minor) >= (22, 6) else None


def _node_run(body: str):
    node = _node()
    if not node:
        return None
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", body],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"node упал: {r.stderr[:600]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


def _abs(rel: str) -> str:
    return (ROOT / rel).as_posix()


# ── №1 / №4 Пополнение ─────────────────────────────────────────────────────

def test_topup_no_silent_branch_method_amount():
    t = _code(MA + "TopupSheet.tsx")
    assert "useState<Method | ''>('')" in t, "способ оплаты снова выбран заранее"
    assert "includes(defaultBranch) ? defaultBranch : ''" in t, "филиал снова подставляется сам (Uni)"
    assert "'Unbox Uni');" not in t and ": 20;" not in t, "вернулись «Unbox Uni» / «20 ₾» по умолчанию"
    assert ": debt > 0 ? debt : null;" in t, "сумма подставляется без долга"
    assert "disabled={value <= 0 || !!missing}" in t
    assert "'Выберите филиал'" in t and "'Выберите способ оплаты'" in t
    assert "`Пополнить на ${value > 0 ? formatGel(value) : '—'}`, ...opTail" in t, "на кнопке не вся операция"
    assert "card_tbc: 'карта TBC'" in t
    save = t[t.index("const save = async"):t.index("const opTail")]
    assert save.index("if (!branch || !method)") < save.index("createIncomeWithDuplicateGuard("), \
        "без филиала/способа запись всё равно уходит"


def test_topup_undo_5s():
    t = _code(MA + "TopupSheet.tsx")
    save = t[t.index("const save = async"):t.index("const opTail")]
    assert "created = await createIncomeWithDuplicateGuard(" in save and "offerUndo(id, what, onDone)" in save
    undo = t[t.index("function offerUndo("):]
    assert "undoToast(what" in undo and "if (!claimCashUndo(id)) return;" in undo
    assert "cashboxApi.deleteTransaction(id)" in undo and "releaseCashUndo(id)" in undo
    # Сервер сам откатывает зачисление при удалении операции пополнения.
    tx = _read("backend/app/api/v1/cashbox/transactions.py")
    d = tx[tx.index("def delete_transaction("):tx.index("@router.patch(\"/transactions/{transaction_id}\"")]
    assert "if tx.credited_user_id:" in d and 'reason="topup_reversal"' in d


def test_default_branch_passed_where_known():
    card = _code(MA + "MobileAdminUserCard.tsx")
    assert "cashBranchOfLastBooking(bookings)" in card and "defaultBranch={lastBranch}" in card
    fin = _code(MA + "MobileAdminFinance.tsx")
    assert "defaultBranch={branch === 'all' ? undefined : branch}" in fin
    for rel in ("MobileAdminDashboard.tsx", "MobileAdminBookings.tsx"):
        assert "defaultBranch={pay.branch}" in _code(MA + rel), rel


# ── Решение 1: метки оплаты ────────────────────────────────────────────────

def test_due_badge_marks():
    b = _code("src/components/admin/DueBadge.tsx")
    assert "if (status === 'pending_approval') return null;" in b, "у заявки снова денежная метка"
    assert "statusLabel('payment', 'covered', 'staff')" in b and "<CircleDashed" in b, "нет «◌ с баланса»"
    assert "statusLabel('payment', 'subscription', 'staff')" in b and "method === 'subscription'" in b, "нет «абонемент»"
    assert "paidLabel = statusLabel('payment', 'charged', 'staff')" in b
    # Пропсы новые и необязательные — компьютерные экраны собираются как раньше.
    assert "status?: string | null;" in b and "method?: string | null;" in b
    st = _read("src/design/statuses.ts")
    assert "covered:      { label: 'С баланса', staffLabel: 'с баланса'" in st
    assert "subscription: { label: 'Абонемент', staffLabel: 'абонемент'" in st
    assert "Списано с баланса" in st, "технический статус 02.10 не трогаем"


def test_mobile_screens_pass_status_and_method():
    for rel in ("MobileAdminDashboard.tsx", "MobileAdminBookings.tsx", "MobileAdminUserCard.tsx"):
        code = _code(MA + rel)
        tags = re.findall(r"<DueBadge\b[^>]*>", code)
        assert tags, rel
        for t in tags:
            assert "status={" in t and "method={" in t, f"{rel}: DueBadge без status/method — заявке покажется метка"
    sheets = _code(MA + "bookingSheets.tsx")
    assert "data-sheet-payment" in sheets and "<DueBadge" in sheets, "в шторке брони не видно оплаты (design №20)"
    assert "UserRound" in sheets and "<Search size={18} />" not in sheets


def test_one_word_for_pending_approval():
    for rel in ("MobileAdminDashboard.tsx", "MobileAdminUserCard.tsx", "MobileAdminInbox.tsx"):
        code = _read(MA + rel)
        assert "statusLabel('booking', 'pending_approval', 'staff')" in code, rel
        for bad in ("' · ждёт одобрения'", "Срочная бронь · ждёт ответа", "Ждут вашего решения:"):
            assert bad not in code, f"{rel}: снова «{bad}»"
    ck = _read("src/components/admin/cashbox/MorningChecklistModal.tsx")
    assert "statusLabel('booking', 'pending_approval', 'staff')" in ck and "«на подтверждении»" not in ck


# ── №5 Счётчик «Заявок» ────────────────────────────────────────────────────

def test_inbox_counter_on_load():
    lay = _code(MA + "MobileAdminLayout.tsx")
    eff = lay[lay.index("const onInbox = location.pathname.startsWith('/m/admin/inbox');"):]
    eff = eff[:eff.index("}, [currentUser, isAdmin, location.pathname, requestsTick]);")]
    assert eff.index("Promise.allSettled([") < eff.index("requestsAt.current = Date.now();"), \
        "отметка времени снова до запроса — первый отменённый запрос глушит второй на минуту"
    assert "let alive = true;" not in eff, "флаг alive снова выбрасывает ответ при перезапуске эффекта"
    assert "seq !== requestsSeq.current" in eff
    assert "колокольчик наверху — это уведомления" in _read(MA + "MobileAdminInbox.tsx")


# ── №6 Поиск ───────────────────────────────────────────────────────────────

def test_search_node():
    res = _node_run(f"""
const m = await import('{_abs(MA + "searchMatch.ts")}');
const u = {{ name: 'Елена Миронова', email: 'client@unbox.test', phone: '+995 599 12 34 56' }};
const q = ['599123456', '+995599123456', '599 12', 'Миронова Елена', 'миронова', 'елена 599', 'Петров', '599 77'];
console.log(JSON.stringify(q.map(x => m.matchesPerson(x, u))));
""")
    if res is not None:
        assert res == [True, True, True, True, True, True, False, False], res
    for rel in ("MobileAdminUsers.tsx", "MobileAdminCrm.tsx", "MobileAdminBookings.tsx"):
        assert "matchesPerson(" in _code(MA + rel), f"{rel}: поиск не общий"
    assert "import " not in _read(MA + "searchMatch.ts"), "searchMatch.ts должен быть без импортов (node)"


# ── №7 Карточка клиента ────────────────────────────────────────────────────

def test_user_card_rows_tappable():
    c = _code(MA + "MobileAdminUserCard.tsx")
    assert "onClick={() => setActiveBooking(b)}" in c and "<AdminBookingSheets" in c
    assert "`/m/admin/bookings?q=${encodeURIComponent(user.email)}&past=0`" in c, "«И ещё N» не ссылка"
    assert "Принять оплату · {formatGel(payTotal)}" in c and "futureChargedDue(bookings, dueMap, batumiDayKey())" in c
    b = _code(MA + "MobileAdminBookings.tsx")
    assert "searchParams.get('q')" in b and "clientMode" in b, "«Брони» не понимают ?q= из карточки"


# ── №8 Отмена ─────────────────────────────────────────────────────────────

def test_cancel_sheet_rules():
    s = _code(MA + "bookingSheets.tsx")
    cs = s[s.index("function CancelBookingSheet("):s.index("function EditPriceSheet(")]
    assert "useState<number | null>(isRequest ? 100 : null)" in cs, "процент возврата снова выбран заранее"
    assert "[100, 50, 0]" in cs and "refundPreview(booking, v / 100, formatGel)" in cs
    assert "disabled={pct === null || !reasonOk}" in cs
    assert "`Отменить и ${preview.replace(/^вернём/, 'вернуть')}`" in cs
    assert "По правилам клиент сам уже не отменит — без возврата" in cs
    # 09.11 (владелец): не-владелец меньше чем за 24 ч — причина ≥ 5 символов, видит владелец.
    assert "const LATE_REASON_MIN = 5;" in s and "const lateNeedsReason = late && !isOwner;" in cs
    assert "'Причина (увидит владелец)'" in cs
    assert "До начала меньше 24 часов — клиент так отменить не может. Владелец получит уведомление" in cs
    assert "isOwner={isOwner}" in s and "const isOwner = currentUser?.role === 'owner';" in s
    # Деньги не тронуты: доля 0..1 и причина уходят как раньше.
    pc = s[s.index("const performCancel = async"):s.index("const doEditPrice")]
    assert "refundPercent: refundPercent / 100, reason: reason || undefined" in pc


def test_refund_preview_node():
    res = _node_run(f"""
const m0 = await import('{_abs(MA + "cancelRules.ts")}');
const gel = n => String(Math.round(n * 100) / 100).replace('.', ',') + ' ₾';
const m = {{ refundPreview: (b, p) => m0.refundPreview(b, p, gel), hoursUntilStart: m0.hoursUntilStart }};
const bal = {{ status: 'confirmed', paymentStatus: 'paid', paymentMethod: 'balance', finalPrice: 20 }};
const pend = {{ ...bal, paymentStatus: 'pending' }};
const sub = {{ status: 'confirmed', paymentStatus: 'paid', paymentMethod: 'subscription', finalPrice: 0, hoursDeducted: 2 }};
const charge = {{ ...bal, finalPrice: 0, chargeAmount: 18 }};
const req = {{ ...bal, status: 'pending_approval' }};
const h = m.hoursUntilStart({{ status: 'confirmed', date: '2026-11-10T00:00:00', startTime: '10:00' }}, Date.UTC(2026, 10, 9, 6, 0));
console.log(JSON.stringify([m.refundPreview(bal, 1), m.refundPreview(bal, 0.5), m.refundPreview(bal, 0),
  m.refundPreview(pend, 1), m.refundPreview(sub, 0.5), m.refundPreview(charge, 1), m.refundPreview(req, 1), h]));
""")
    if res is None:
        return
    assert res == ["вернём 20 ₾", "вернём 10 ₾", "без возврата", "ещё не списано — с клиента ничего не спишется",
                   "вернём 1 ч абонемента", "вернём 18 ₾", "денег ещё не брали — возвращать нечего", 24], res


# ── №9 Цена ───────────────────────────────────────────────────────────────

def test_price_reason_required():
    s = _code(MA + "bookingSheets.tsx")
    ps = s[s.index("function EditPriceSheet("):]
    assert "(num === 0 || num < current * 0.5)" in ps, "0 ₾ / снижение вдвое без причины"
    assert "disabled={!valid || !reasonOk}" in ps
    assert "`Сохранить ${formatGel(num)} (было ${formatGel(current)})`" in ps
    assert "'Почему бесплатно?'" in ps


# ── Решение 3 / №11 / №12 / №13 / №22 Касса ───────────────────────────────

def test_cash_hidden_for_admin_role():
    f = _code(MA + "MobileAdminFinance.tsx")
    assert "const hideCash = currentUser?.role === 'admin' || !!balances.cashHidden || balances.cash === null;" in f
    assert "? <HiddenCashTile />" in f and "скрыто до закрытия смены" in f
    assert "MorningChecklistModal" not in f, "чек-лист снова окном поверх «Кассы» (№17)"


def test_journal_rows_and_branch_labels():
    f = _code(MA + "MobileAdminFinance.tsx")
    row = f[f.index("function TransactionRow("):f.index("function txClient(")]
    assert "branchLabel(tx.branch)" in row and "tx.branch,\n" not in row, "филиал снова кодом"
    assert "`записал(а) ${tx.adminName}`" in row and "txClient(tx)" in row and "data-tx-who" in row
    assert "|| tx.paymentMethod" not in row, "неизвестный способ снова кодом"
    assert "onTap={canEditTx(t) ? () => setEditingTx(t) : () => setViewingTx(t)}" in f, \
        "у не-владельца строка снова ничего не делает (№22)"
    assert "function TransactionViewSheet(" in f
    res = _node_run(f"""
const m = await import('{_abs(MA + "branchLabel.ts")}');
console.log(JSON.stringify([m.branchLabel('unbox_uni'), m.branchLabel('Unbox One'), m.branchLabel('neo_school'),
  m.branchLabel(''), m.humanizeMoneyText('Пополнение через кассу (cash)'), m.humanizeMoneyText('Оплата unbox_one')]));
""")
    if res is not None:
        assert res == ["Uni", "One", "Neo School", "", "Пополнение через кассу · наличные", "Оплата One"], res
    assert "humanizeMoneyText(e.description)" in _code(MA + "MobileAdminUserCard.tsx"), "в ленте баланса снова «(cash)»"
    assert "`Прочее (${e.reason})`" not in _read(MA + "MobileAdminUserCard.tsx"), "в ленте снова код причины"


def test_income_points_to_client_topup():
    f = _code(MA + "MobileAdminFinance.tsx")
    assert "Деньги от клиента? → Пополнить баланс клиента" in f and "data-client-payment-hint" in f
    assert "CLIENT_INCOME_CATEGORY_IDS = new Set(['cat-rent', 'cat-subscription'])" in f
    assert "disabled={!parsedAmount || needBranch || askWhoPays}" in f and "Кто платит?" in f
    assert "<ClientPickSheet" in f and "<TopupSheet" in f
    # Приход с клиентом — только через TopupSheet (защита от дубля), сама касса клиента не пишет.
    add = f[f.index("interface AddPayload"):f.index("interface AddPayload") + 400]
    assert "client_id" not in add


# ── №15 / design №12 «Сегодня» ────────────────────────────────────────────

def test_one_due_list_and_top_summary():
    d = _code(MA + "MobileAdminDashboard.tsx")
    assert "`Должны · ${debtorsCount}`" in d, "число «Должны» — не все с долгом"
    for t in ('title="Сегодня"', 'title="Старые долги"', 'title="Скоро уйдут за лимит"'):
        assert t in d, f"нет раздела {t}"
    assert d.count("Принять оплату · ") == 1 and "payButton(d.amount" in d and "payButton(c.overLimitBy" in d
    # 09.11 фаза 3: отступ сверху 8 — под общей крупной шапкой MobilePageHeader.
    assert "minHeight: 44" in d[d.index("const renderOther"):d.index("return (\n        <div style={{ paddingTop: 8")]
    assert "data-today-summary" in d and "<SummaryCell" in d, "нет сводки наверху"
    assert "bannerStyle" not in d and "'var(--status-ok-bg)'" not in d, "хорошая новость снова ярким баннером"
    assert "<MorningChecklistCard adminEmail={currentUser.email} />" in d


# ── №16–№24 мелочи ────────────────────────────────────────────────────────

def test_bookings_filters_one_row():
    b = _code(MA + "MobileAdminBookings.tsx")
    assert 'aria-label="Фильтры: день, филиал, прошедшие"' in b and "open={filtersOpen}" in b
    assert "plural(counts.past, 'прошедшая скрыта', 'прошедшие скрыты', 'прошедших скрыто')" in b
    assert "прошедших скрыто)` : ''" not in b
    raw = _read(MA + "MobileAdminBookings.tsx")
    # 09.11 фаза 3: строка брони — общий AdminBookingRow; статус — словом в подписи
    # под именем (слово из statuses.ts), справа только одна метка оплаты.
    i = raw.index("Статус — словом в подписи под именем")
    assert "status={b.status}" in raw[i:i + 200], "статус снова справа, рядом с меткой оплаты"
    row = _code(MA + "AdminBookingRow.tsx")
    assert "statusLabel('booking', status, 'staff')" in row and "subtitle=" in row and "trail={badge}" in row
    assert "label: 'Unbox One'" not in b and "LOC_LABEL" in b


def test_checklist_card():
    m = _code("src/components/admin/cashbox/MorningChecklistModal.tsx")
    assert "export function MorningChecklistCard(" in m and "Утро: " in m
    assert "progressKey(" in m and "markDoneToday(adminEmail)" in m


def test_tasks():
    t = _code(MA + "MobileAdminTasks.tsx")
    assert "setTabRaw('team')" in t and "tabTouched" in t, "«Мои» пустые — «Команда» не открывается"
    assert "byStatus.filter(t => !!t.assigneeId).length" in t, "числа вкладок без учёта фильтра статуса"
    assert "/>срочно" in t, "у срочной задачи нет слова «срочно»"
    assert "const setDeadline = async (day: string | null)" in t and "['custom', 'Дата…']" in t


def test_inbox_confirm_and_links():
    i = _code(MA + "MobileAdminInbox.tsx")
    ap = i[i.index("const approve = async"):i.index("const submitReject")]
    assert ap.index("await confirm({") < ap.index("bookingsApi.approveBooking("), "«Одобрить» снова с одного нажатия"
    assert "`/m/admin/users/${encodeURIComponent(user.email)}`" in i, "имя клиента в заявке не ссылка"
    assert "data-decision-numbers" in i and "не хватает" in i, "цифры для решения не наверху"
    # Отмены одобрения на сервере нет — поэтому подтверждение, а не «Вернуть».
    r = _read("backend/app/api/v1/bookings/routes.py")
    assert "/unapprove" not in r


def test_specialists_and_team():
    s = _code(MA + "MobileAdminSpecialists.tsx")
    assert ">Ждёт проверки<" in s and "· ждёт проверки" not in s
    t = _code(MA + "MobileAdminTeam.tsx")
    assert "{!isMe && (" in t, "у себя снова кнопка «Выключить»"
    assert "'Скрыть' : 'Показать'" in t and "'Выключить'" not in t
    assert "Доступ в админку не меняется" in t


# ── Шаг 2 (поручение лида 09.11): то же на компьютере и на сервере ─────────

def test_desktop_chessboard_three_marks():
    due = _code("src/utils/dueAmounts.ts")
    assert "export type DueMarkKind = 'owes' | 'paid' | 'covered';" in due
    assert "if (status === 'pending_approval') return null;" in due
    ch = _code("src/components/admin/AdminChessboardView.tsx")
    assert "dueMarkKind(d, b.status)" in ch and "dueMarkKind(info, status)" in ch
    assert "<CellDueMark info={dueMap.get(b.id)} />" not in ch, "клетка без статуса"
    leg = _read("src/components/admin/AdminChessboardView.tsx")
    assert "с баланса — ещё не списано, баланса хватает" in leg


def test_desktop_badges_get_status_and_method():
    d = _code("src/pages/admin/Dashboard.tsx")
    assert "status={r.status} method={r.paymentMethod} />" in d
    b = _code("src/pages/admin/Bookings.tsx")
    assert b.count("status={booking.status} method={booking.paymentMethod as string | undefined} />") == 2


def test_pending_approval_not_in_take_today_node():
    t = _code("src/utils/adminToday.ts")
    assert "const info = b.status === 'pending_approval' ? undefined : dueMap.get(b.id);" in t
    res = _node_run(f"""
const m = await import('{_abs("src/utils/adminToday.ts")}');
const D = '2026-11-09';
const users = [{{ id: 'u1', email: 'a@x', name: 'А', balance: 0 }}, {{ id: 'u2', email: 'b@x', name: 'Б', balance: 0 }}];
const bookings = [
  {{ id: 'p', userId: 'u1', date: D, startTime: '10:00', duration: 60, resourceId: 'r', status: 'pending_approval', paymentMethod: 'balance', paymentStatus: 'pending', finalPrice: 30 }},
  {{ id: 'c', userId: 'u2', date: D, startTime: '11:00', duration: 60, resourceId: 'r', status: 'confirmed', paymentMethod: 'balance', paymentStatus: 'pending', finalPrice: 20 }},
];
const dueMap = new Map([['p', {{ due: 30, price: 30, charged: false }}], ['c', {{ due: 20, price: 20, charged: false }}]]);
const rows = m.todayRows({{ bookings, users, dueMap, dayKey: D }});
console.log(JSON.stringify({{ sum: m.todaySummary(rows).amount, p: rows.find(r => r.bookingId === 'p').due,
  cl: m.byClient(rows, users).map(c => [c.client, c.total]) }}));
""")
    if res is not None:
        assert res["sum"] == 20 and res["p"] is None, res
        assert ["А", 0] in res["cl"] and ["Б", 20] in res["cl"], res


def test_server_hides_cash_from_admin_role():
    init = _read("backend/app/api/v1/cashbox/__init__.py")
    assert 'return getattr(user, "role", None) == "admin"' in init
    tx = _read("backend/app/api/v1/cashbox/transactions.py")
    bal = tx[tx.index("def get_balance("):tx.index('@router.get("/client-total-paid')]
    assert "if cash_hidden_for(current_user):" in bal and '"cash": None' in bal and '"balance": None' in bal
    sh = _read("backend/app/api/v1/cashbox/shifts.py")
    pv = sh[sh.index("def preview_close_shift("):sh.index('@router.get("/shifts/open/current"')]
    assert "if cash_hidden_for(current_user):" in pv and '"expected": None' in pv and '"starting_balance": None' in pv
    # Закрытие смены считает само и отдаёт «ожидалось» в ответе — от скрытия не зависит.
    end = sh[sh.index("def end_shift("):sh.index('@router.get("/analytics")')]
    assert "cash_hidden_for" not in end and "expected_balance=expected" in end
    ds = _read("backend/app/api/v1/cashbox/day_summary.py")
    assert "_hide_cash_by_records(out)" in ds and 'sh["cash_by_records"] = None' in ds


def test_server_cash_hidden_sqlite():
    """Живой прогон эндпоинтов на тестовой SQLite: роль admin не получает наличные,
    владелец получает; закрытие смены админом возвращает «ожидалось» в ответе."""
    try:
        import os
        os.environ.setdefault("DATABASE_URL", "sqlite://")
        sys.path.insert(0, str(ROOT / "backend"))
        from sqlmodel import SQLModel, Session, create_engine
        from sqlalchemy.pool import StaticPool
        from fastapi import BackgroundTasks
        from app.models.user import User
        from app.models.cashbox_transaction import CashboxTransaction
        from app.models.shift_report import ShiftReportCreate
        from app.api.v1.cashbox import transactions as T, shifts as S
        import app.models  # noqa: F401  (все таблицы)
    except Exception as exc:  # noqa: BLE001
        print(f"    (пропуск живой проверки: {exc!r})")
        return
    from datetime import datetime
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng)
    with Session(eng) as s:
        admin = User(email="a@x", name="Адм", role="admin", hashed_password="x")
        owner = User(email="o@x", name="Влад", role="owner", hashed_password="x")
        s.add(admin); s.add(owner); s.commit(); s.refresh(admin); s.refresh(owner)
        s.add(CashboxTransaction(type="income", amount=120, payment_method="cash", branch="Unbox Uni",
                                 date=datetime.now(), admin_id=str(owner.id)))
        s.commit()
        a = T.get_balance(session=s, current_user=admin, branch="Unbox Uni")
        o = T.get_balance(session=s, current_user=owner, branch="Unbox Uni")
        assert a["cash"] is None and a["balance"] is None and a.get("cash_hidden") is True, a
        assert o["cash"] == 120, o
        pa = S.preview_close_shift(branch="Unbox Uni", session=s, current_user=admin)
        po = S.preview_close_shift(branch="Unbox Uni", session=s, current_user=owner)
        assert pa["expected"] is None and pa["cash_in"] is None and pa["cash_hidden"] is True, pa
        assert po["expected"] == 120, po
        rep = S.end_shift(ShiftReportCreate(actual_balance=100, branch="Unbox Uni"), BackgroundTasks(),
                          session=s, current_user=admin)
        assert rep.expected_balance == 120 and rep.discrepancy == -20, (rep.expected_balance, rep.discrepancy)


def test_close_shift_blind_ui():
    m = _code(MA + "MobileCloseShiftSheet.tsx")
    assert "const blind = blindProp || !!preview?.cashHidden;" in m
    assert "{hasAmount && !blind && (" in m and "report?.expectedBalance" in m
    assert "blind={hideCash}" in _code(MA + "MobileAdminFinance.tsx")
    e = _code("src/components/admin/cashbox/EndShiftModal.tsx")
    assert "const blind = !!preview?.cashHidden || !!balances?.cashHidden;" in e and "{hasAmount && !blind && (" in e
    assert "report.expectedBalance" in e
    o = _code("src/components/admin/cashbox/OpenShiftModal.tsx")
    assert "p.expected != null ? Number(p.expected).toFixed(2) : ''" in o, "«на старте» подставляет 0 вместо пустого"
    bc = _code("src/components/admin/cashbox/BalanceCard.tsx")
    assert "acc.value === null ?" in bc and "скрыто до закрытия смены" in bc
    dsu = _code("src/components/admin/cashbox/DaySummary.tsx")
    assert "shift.cashByRecords === null ?" in dsu
    dash = _code("src/pages/admin/Dashboard.tsx")
    assert "b.value?.cash != null ? Number(b.value.cash) : null" in dash, "строка кассы покажет 0 вместо «скрыто»"


def test_day_summary_one_card_per_branch():
    svc = _read("backend/app/services/day_summary.py")
    assert "name = _canon_branch(name)" in svc and "def _canon_branch(" in svc


def test_bell_tooltip_explains_difference():
    bell = _read("src/pages/mobile/NotificationsBell.tsx")
    assert "Заявки, которые ждут решения, — на вкладке «Заявки»" in bell


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}"[:400])
    print("СТОРОЖ admin-wave1 2026-11: OK" if not failures else f"СТОРОЖ admin-wave1 2026-11 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
