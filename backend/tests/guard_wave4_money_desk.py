"""СТОРОЖ wave4 · money desk — карточка клиента, касса, аналитика на компьютере
(волна 4, пакет C, 01.10).

Что ловит (чтение исходников + node для чистых функций, без сети и базы):
  Деньги не тронуты — отпечатки обработчиков карточки (пополнение, лимит,
      продажа/пополнение абонемента, «На абонемент»), всех тел cashboxApi.*,
      закрытия смены, удаления/правки операции, тела «Новой операции»,
      корректировки и недельных кредитов. Отпечаток = sha256 без пробелов,
      снят с 4ae3f09 (до волны 4) — совпал один в один.
  G7-03 — «Баланс» в карточке выше «Общей суммы оплат», лимит — <button>,
      «Безопасность» — в «⋯ Ещё», дубль «Финансы и Статистика» убран.
  G7-08 — касса: один фильтр «Филиал · Период» ВЫШЕ цифр (BalanceCard),
      итоги — getPeriodSummary и не зависят от фильтра «Приходы/Расходы».
  G7-admin-core-M3 — графики кассы грузятся за выбранный период (с датами).
  N2 — корректировки (payment_method='adjustment') не считаются деньгами
      в графиках: excludeAdjustments() вычитает их на фронте (сервер не меняли).
  В4 — закрытие смены: ожидаемая сумма и расхождение только ПОСЛЕ ввода факта.
  В5 — «Вернуть» после записи операции только там, где сервер даст удалить
      (canUndoCashTx — зеркало DELETE /cashbox/transactions/{id}).
  Удаления без вопроса (контакты, задачи, теги клиента) — с undoToast.
  Права — строки проверок дословно.

    python3 backend/tests/guard_wave4_money_desk.py
"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent

UD = "src/pages/admin/UserDetails.tsx"
FIN = "src/pages/admin/Finance.tsx"
CASH_API = "src/api/cashbox.ts"
END_SHIFT = "src/components/admin/cashbox/EndShiftModal.tsx"
TX_TABLE = "src/components/admin/cashbox/CashboxTransactionTable.tsx"
ADD_TX = "src/components/admin/cashbox/AddCashboxTransactionModal.tsx"
BALANCE = "src/components/admin/cashbox/BalanceCard.tsx"
MONEY = "src/components/admin/cashbox/cashMoney.ts"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _body(src: str, start: str, end: str) -> str:
    i = src.find(start)
    assert i != -1, f"не нашёл {start!r}"
    j = src.find(end, i + len(start))
    assert j != -1, f"не нашёл конец {end!r} после {start!r}"
    return src[i:j]


def _fp(text: str) -> str:
    return hashlib.sha256(re.sub(r"\s+", "", text).encode()).hexdigest()[:16]


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


# ─────────────────────────────────────────────────────────────────────────
# Деньги не тронуты: отпечатки (сняты с 4ae3f09, до волны 4)
# ─────────────────────────────────────────────────────────────────────────

MONEY_FINGERPRINTS = [
    # (файл, начало, конец, отпечаток, что это)
    (UD, "const handleAddFunds = async", "const handleUpdateCreditLimit", "db9e87fe1f162a33", "пополнение баланса из карточки"),
    (UD, "const handleUpdateCreditLimit = async", "const toggleFreeze", "82366847dc731d47", "кредитный лимит"),
    (UD, "const handleAssignSubscription = async", "const handleCancelBooking", "406179f87bd4d36f", "продажа абонемента"),
    (UD, "const handleToSubscription = async", "// Excel #59", "883771eeb8c1df0e", "«На абонемент»"),
    (UD, "const handleTopup = async", "setTopupSaving(false);", "a1fb7859b68a87c9", "пополнение часов абонемента"),
    (CASH_API, "export const cashboxApi = {", "\n};", "d3cd209a7a4cf49c", "все тела cashboxApi.*"),
    (END_SHIFT, "const handleSubmit = async", "return createPortal(", "233e73ad83be0edb", "отправка закрытия смены"),
    (TX_TABLE, "const handleDelete = async", "if (isLoading)", "1899d119091c944b", "удаление операции в журнале"),
    (TX_TABLE, "const isOwner = currentUser?.role === 'owner';", "// Flatten categories", "fec6d962bb0f0382", "canEditTx / canDeleteTx"),
    (ADD_TX, "                    type,\n                    amount: value,", "} as any);", "f35a90a335e4c493", "тело «Новой операции»"),
    (ADD_TX, "if (type === 'transfer') {\n                // Transfer", "} else {", "1a25816536aaedb3", "перевод между счетами"),
    (ADD_TX, "const r = await usersApi.sellSubscription(clientId, {", "});", "04b48bb9ee731e79", "продажа абонемента из кассы"),
    (FIN, "await api.post('/cashbox/balance-correction', {", "});", "bfc1fa6db997627d", "корректировка остатка"),
    (FIN, "const preview = await pricingApi.runWeeklyRebate(true);",
     "toast.error(e?.response?.data?.detail || 'Ошибка перерасчёта');", "e5ffe1c9a13824ac", "недельные кредиты"),
]


def test_money_handlers_unchanged():
    bad = []
    for rel, start, end, expected, what in MONEY_FINGERPRINTS:
        got = _fp(_body(_read(rel), start, end))
        if got != expected:
            bad.append(f"{what} ({rel}): {got} ≠ {expected}")
    assert not bad, "денежный код изменился — нужно денежное ревью и новый отпечаток:\n" + "\n".join(bad)


def test_add_tx_still_credits_client_and_store_creates_transfers():
    src = _read(ADD_TX)
    assert "credit_user_balance: (type === 'income' && !!clientId)" in src, "приход с клиентом снова может не зачислиться"
    assert "await createTransaction({\n                    type: 'expense'," in src, "перевод больше не через стор"


# ─────────────────────────────────────────────────────────────────────────
# G7-03 — карточка клиента: деньги первыми
# ─────────────────────────────────────────────────────────────────────────

def test_card_balance_first_and_limit_is_button():
    ud = _strip_comments(_read(UD))
    summary = _strip_comments(_body(_read(UD), 'data-testid="client-money-summary"', "{/* Tabs"))
    b = summary.find(">Баланс<")
    assert b != -1, "в шапке карточки нет «Баланс»"
    total = ud.find("Общая сумма оплат")
    assert total != -1 and ud.find('data-testid="client-money-summary"') < total, \
        "«Баланс» снова ниже «Общей суммы оплат»"
    assert "STATUS.danger.fg" in summary, "минус на балансе не красный"
    # лимит — настоящая кнопка
    m = re.search(r"<button\s+type=\"button\"\s+onClick=\{\(\) => setIsEditLimitOpen\(true\)\}", summary)
    assert m, "«Кредитный лимит ✎» — не <button>"
    assert not re.search(r"<div[^>]*\n?[^>]*onClick=\{\(\) => setIsEditLimitOpen\(true\)\}", ud), \
        "правка лимита снова кликабельный <div>"
    assert "Абонемент" in summary and "осталось ${sub.remainingHours} из ${total} ч" in summary, \
        "в шапке нет «Абонемент: осталось X из Y ч»"
    for label in ("Пополнить", "Абонемент", "Позвонить"):
        assert label in summary, f"в шапке карточки нет кнопки «{label}»"
    assert "onClick={() => setIsAddFundsOpen(true)}" in summary and 'variant="primary"' in summary


def test_card_no_duplicate_finance_block_and_security_in_more():
    ud = _strip_comments(_read(UD))
    assert ud.count("Общая сумма оплат") == 1, "«Общая сумма оплат» снова в двух вкладках"
    assert ud.count("Средний чек") == 1, "«Средний чек» снова в двух вкладках"
    assert "Финансы и Статистика" not in ud, "дубль блока «Финансы и Статистика» вернулся"
    assert "function ClientMoreMenu(" in ud and "<ClientMoreMenu" in ud, "нет меню «⋯ Ещё»"
    menu = _body(ud, "function ClientMoreMenu(", "\n}\n")
    for label in ("Сбросить пароль", "Изменить email", "Архивировать", "Слить с аккаунтом"):
        assert label in menu, f"«{label}» пропал из «⋯ Ещё»"
    # левая колонка без блока «Безопасность»
    left = _strip_comments(_body(_read(UD), "{/* Left Column", "{/* Middle Column"))
    assert "setIsResetPasswordOpen(true)" not in left and "setIsMergeOpen(true)" not in left


def test_card_permission_lines_verbatim():
    ud = _read(UD)
    assert "if (!hasPermission(currentUser, 'finance.balance_correction')) {" in ud, \
        "проверка права finance.balance_correction изменилась"
    assert "(currentUser?.role === 'owner' || currentUser?.role === 'senior_admin') && (\n                                <ClientMoreMenu" in ud, \
        "«⋯ Ещё» (сброс пароля, архив) — только owner/senior_admin"
    assert "canEditEmail={currentUser?.role === 'senior_admin' || currentUser?.role === 'owner'}" in ud
    assert "canMerge={currentUser?.role === 'senior_admin' || currentUser?.role === 'owner'}" in ud


# ─────────────────────────────────────────────────────────────────────────
# G7-08 — касса «Сейчас → Период → Журнал»
# ─────────────────────────────────────────────────────────────────────────

def test_cash_filter_above_numbers_and_summary_from_server():
    fin = _strip_comments(_read(FIN))
    f = fin.find('data-testid="cash-filter"')
    b = fin.find("<BalanceCard")
    assert f != -1 and b != -1 and f < b, "фильтр «Филиал · Период» снова ниже цифр"
    assert fin.count("<select") <= 2, "снова несколько выборов филиала/периода (в корректировке — свой)"
    assert "cashboxApi.getPeriodSummary({" in fin and "summary={p.summary}" in fin, \
        "итоги периода не из getPeriodSummary"
    memo = _body(fin, "const periodTx = useMemo(", "const filtered = useMemo(")
    assert "txType" not in memo
    card = _body(fin, "<BalanceCard", "/>")
    assert "txType" not in card and "p.filtered" not in card, "итоги зависят от фильтра журнала"
    assert "filteredTransactions={p.periodTx}" in card


def test_now_block_independent_of_period():
    card = _strip_comments(_read(BALANCE))
    assert "Сейчас в кассе на" in card, "нет «Сейчас в кассе на …»"
    now = _body(card, "Сейчас в кассе на", "<section aria-label=")
    assert "periodLabel" not in now and "stats" not in now, "«Сейчас в кассе» снова зависит от периода"
    assert "За {periodLabel}:" in card, "строка итогов без подписи периода"
    assert "tx.paymentMethod === 'adjustment'" in card, "запасной расчёт снова считает корректировки"


def test_cash_header_actions():
    fin = _strip_comments(_read(FIN))
    head = _body(fin, "<PageHeader", "{p.yesterdayShiftStatus === 'missed'")
    assert "Новая операция" in head and 'variant="primary"' in head
    assert "Смена открыта" in head and "STATUS.ok" in head
    assert "<FinanceMoreMenu" in head
    for item in ("Корректировка", "Недельные кредиты", "<ReconciliationExport"):
        assert item in head, f"в «⋯» нет «{item}»"
    assert "maxWidth: 1400" not in fin and "minHeight: '100vh'" not in fin, "двойной контейнер вернулся (G7-14)"


def test_cash_permission_lines_verbatim():
    fin = _read(FIN)
    assert "const canManageCategories = currentUser?.role === 'senior_admin' || currentUser?.role === 'owner';" in fin
    assert "const canCorrectBalance = currentUser?.role === 'senior_admin' || currentUser?.role === 'owner';" in fin
    assert "{p.canCorrectBalance && (" in fin and "p.showCorrection && p.canCorrectBalance && createPortal(" in fin
    tbl = _read(TX_TABLE)
    assert "const canEditTx = (_tx: CashboxTransaction) => isOwner;" in tbl, "править операции снова может не только владелец"
    oa = _read("src/pages/admin/OwnerAnalytics.tsx")
    assert "(currentUser.email || '').toLowerCase() !== 'koren.nikolas@gmail.com'" in oa, \
        "доступ к «Аналитике» по email владельца изменился"


def test_analytics_by_period_without_adjustments():
    fin = _strip_comments(_read(FIN))
    assert "fetchAnalytics(dateFrom, dateTo)" in fin, "графики кассы снова без дат (последние 30 дней)"
    assert "fetchAnalytics()" not in fin
    assert "paymentMethod: 'adjustment'" in fin and "excludeAdjustments(rawAnalytics, adjustments)" in fin, \
        "N2: корректировки снова идут в графики как деньги"
    assert "<CashboxAnalytics analytics={p.analytics}" in fin and "revenueDaily={p.analytics?.dailyData}" in fin, \
        "графики получают сырую аналитику с корректировками"
    ca = _read("src/components/admin/cashbox/CashboxAnalytics.tsx")
    assert "useCashboxStore" not in ca, "CashboxAnalytics снова берёт сырую аналитику из стора"
    assert "все филиалы" in ca, "графики не подписаны «все филиалы» (сервер считает по всей сети)"
    assert 'type="monotone"' not in ca and 'type="monotone"' not in _read("src/components/admin/AnalyticsCharts.tsx"), \
        "сглаженные кривые вернулись (G7-19)"


def test_cash_money_pure_and_no_imports():
    code = _strip_comments(_read(MONEY))
    assert not re.search(r"^\s*import\s", code, flags=re.M), "cashMoney.ts должен быть без импортов — его гоняет node"
    for fn in ("excludeAdjustments", "canUndoCashTx", "isMoneyTx"):
        assert f"export function {fn}" in code


def test_exclude_adjustments_via_node():
    res = _node_run(f"""
const m = await import('{(ROOT / MONEY).as_posix()}');
const a = {{
  dailyData: [
    {{ date: '2026-09-22', income: 120, expense: 10 }},
    {{ date: '2026-09-23', income: 40, expense: 0 }},
    {{ date: '2026-09-24', income: 15, expense: 0 }},
  ],
  categoryBreakdown: [
    {{ categoryName: 'Хозрасходы', total: 10, percentage: 100 }},
  ],
  totalIncome: 175, totalExpense: 10, currentBalance: 500,
}};
const adj = [
  {{ type: 'income', amount: 40, paymentMethod: 'adjustment', date: '2026-09-23T10:00:00' }},
  {{ type: 'income', amount: 5, paymentMethod: 'adjustment', date: '2026-09-22T23:30:00' }},
  {{ type: 'income', amount: 15, paymentMethod: 'adjustment', date: '2026-09-24T08:00:00' }},
  {{ type: 'income', amount: 999, paymentMethod: 'cash', date: '2026-09-22T09:00:00' }},
];
const r = m.excludeAdjustments(a, adj);
const same = m.excludeAdjustments(a, []);
console.log(JSON.stringify({{ r, sameRef: same === a, money: m.isMoneyTx({{ paymentMethod: 'cash' }}), notMoney: m.isMoneyTx({{ paymentMethod: 'adjustment' }}) }}));
""")
    if res is None:
        return
    r = res["r"]
    assert r["totalIncome"] == 115, f"итог прихода с корректировками: {r['totalIncome']}"
    assert r["totalExpense"] == 10
    days = {d["date"]: d for d in r["dailyData"]}
    assert days["2026-09-22"]["income"] == 115, "корректировка не вычтена из своего дня"
    assert "2026-09-23" not in days and "2026-09-24" not in days, "день только с корректировками остался на графике"
    assert r["currentBalance"] == 500
    assert res["sameRef"] is True and res["money"] is True and res["notMoney"] is False


# ─────────────────────────────────────────────────────────────────────────
# В4 — слепой пересчёт; В5 — «Вернуть» только где сервер разрешит
# ─────────────────────────────────────────────────────────────────────────

def test_end_shift_expected_only_after_fact():
    src = _strip_comments(_read(END_SHIFT))
    form = _body(src, "<form onSubmit={handleSubmit}", "</form>")
    fact = form.find("Сколько наличных в кассе сейчас")
    gate = form.find("{hasAmount && (")
    exp = form.find("Ожидаемый остаток наличных")
    disc = form.find("{discrepancy !== null && (")
    assert -1 not in (fact, gate, exp, disc), "не нашёл поле факта / ожидаемую / расхождение"
    assert fact < gate < exp, "ожидаемая сумма снова видна до ввода факта (В4)"
    assert fact < disc, "расхождение видно до ввода факта"


def test_undo_only_when_server_allows():
    src = _strip_comments(_read(ADD_TX))
    assert "canUndoCashTx(role, created.date)" in src, "«Вернуть» показывается без проверки, разрешит ли сервер"
    undo = _body(src, "undoToast(doneText", "} else {")
    assert "cashboxApi.deleteTransaction(created.id)" in undo, "«Вернуть» удаляет не ту операцию"
    assert "Записать ${verb} ${formatGel(v)} · ${where} · ${br}" in src, "нет сводки на кнопке «Записать …»"
    server = _read("backend/app/api/v1/cashbox/transactions.py")
    assert 'if current_user.role not in ("owner", "senior_admin") and not is_today:' in server, \
        "правило удаления на сервере изменилось — сверить canUndoCashTx"
    res = _node_run(f"""
const m = await import('{(ROOT / MONEY).as_posix()}');
const now = new Date('2026-10-01T22:30:00Z');  // 02:30 по Батуми — сервер (UTC) ещё 1 октября
console.log(JSON.stringify({{
  adminToday: m.canUndoCashTx('admin', '2026-10-01T22:29:00', now),
  adminBackdated: m.canUndoCashTx('admin', '2026-09-30T10:00:00', now),
  seniorBackdated: m.canUndoCashTx('senior_admin', '2026-09-30T10:00:00', now),
  ownerOld: m.canUndoCashTx('owner', '2026-01-01T00:00:00', now),
}}));
""")
    if res is None:
        return
    assert res == {"adminToday": True, "adminBackdated": False, "seniorBackdated": True, "ownerOld": True}, res


def test_client_small_deletes_have_undo():
    for rel in ("src/components/admin/UserContacts.tsx", "src/components/admin/UserTasks.tsx",
                "src/components/admin/UserTags.tsx"):
        src = _strip_comments(_read(rel))
        assert "undoToast(" in src, f"{rel}: удаление снова без «Вернуть»"
    tasks = _read("src/components/admin/UserTasks.tsx")
    assert "onClick={() => removeUserTask(email, task.id)}" not in tasks
    tags = _read("src/components/admin/UserTags.tsx")
    assert "onClick={() => removeUserTag(email, tag)}" not in tags


def test_registry_audience_chips_and_role_text():
    src = _strip_comments(_read("src/pages/admin/Users.tsx"))
    assert "'Клиенты'" in src and "'Команда'" in src, "нет чипов «Клиенты / Команда»"
    assert 'title="Изменить роль"' not in src, "роль снова кнопка «Изменить роль»"
    assert "padStart(" not in src, "количества снова с нулями «040»"
    assert "GEL" not in src


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
    print("СТОРОЖ wave4-money-desk: OK" if not failures else f"СТОРОЖ wave4-money-desk УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
