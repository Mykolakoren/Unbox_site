"""СТОРОЖ wave3-crm-clients — CRM на компьютере: клиенты, карточка, заметки, финансы
(волна 3, пакет C, 01.10).

Что держит:
  G5-13  — «Новая сессия» в карточке открывает NewSessionSheet с этим клиентом,
           а не уводит в общий список (navigate('/crm/sessions')).
  G5-05  — карточка по макету V1 «Что дальше»: «Следующая встреча» / «Записать
           на …», строка долга → UnpaidSessionsSheet, «История», «Деньги» строкой;
           цифра 64 px ушла.
  G5-M4  — «Последние оплаты»: 5 штук + «Показать все (N)», без скрытого скролла.
  Шторки стор не обновляют — после onCreated/onChanged родитель перечитывает.
  G5-17  — список клиентов: «Следующая» и «Была» (with_stats), сортировка по
           «Следующей», а не «Посл. сессия» с будущей датой.
  G5-14 / X4-10 — строка клиента и строка журнала — ссылки (Link).
  X4-04  — окно слияния и «Новый клиент» — общие Sheet / NewClientSheet.
  В1     — деньги за период в Финансах — «Касса · с долгами».
  G5-20  — у долга «Отметить оплату» (UnpaidSessionsSheet) и «Написать» (t.me).
  G5-24  — заметки ~72 знака, имя-ссылка, без номеров, «Скрывать текст».
  Ревью волны 3:
    • заголовок вкладки карточки без имени клиента («Клиент · Psy-CRM»);
    • ссылки «Написать / Позвонить» — из общей src/utils/contactLinks.ts, без
      своих копий t.me в карточке и Финансах;
    • без Telegram кнопка карточки — «Позвонить» с иконкой телефона на tel:,
      а не «Написать»;
    • «Скрывать текст»: поиск не ищет по тексту скрытых заметок.
  ЗАПРЕТЫ — денежные обработчики карточки и их вопросы, applyPriceTo, режим
           просмотра в Финансах, notesText, оплата только quickPaySession.

Без сети и без базы (только чтение исходников):

    python3 backend/tests/guard_wave3_crm_clients.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
CRM = ROOT / "src/pages/crm"
FILES = {
    "detail": CRM / "CrmClientDetail.tsx",
    "clients": CRM / "CrmClients.tsx",
    "notes": CRM / "CrmNotes.tsx",
    "finances": CRM / "CrmFinances.tsx",
    "preview": ROOT / "src/components/crm/NoteDeletePreview.tsx",
}


def _read(key: str) -> str:
    return FILES[key].read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


def _body(src: str, start: str, end_marker: str = "\n    };") -> str:
    i = src.find(start)
    assert i != -1, f"не нашли {start!r}"
    j = src.find(end_marker, i)
    return src[i:j if j != -1 else len(src)]


# ── Карточка клиента ─────────────────────────────────────────────────────────

def test_card_new_session_opens_sheet_with_client():
    src = _read("detail")
    code = _strip_comments(src)
    assert "navigate('/crm/sessions')" not in code, \
        "«Новая сессия» снова уводит в общий список и теряет клиента (G5-13)"
    assert "from '../../components/crm/NewSessionSheet'" in src
    m = re.search(r"<NewSessionSheet(.*?)/>", src, re.S)
    assert m, "в карточке нет NewSessionSheet"
    sheet = m.group(1)
    assert "client={client}" in sheet, "NewSessionSheet должен открываться с этим клиентом"
    assert "lastSession=" in sheet, "NewSessionSheet: передайте прошлую сессию (+1 нед от неё)"
    assert "onCreated=" in sheet and ("reloadQuietly()" in sheet or "loadData()" in sheet), \
        "после записи карточка должна перечитать данные — шторка стор не обновляет"


def test_card_next_meeting_or_book_button():
    src = _read("detail")
    assert "Следующая встреча" in src, "нет полосы «Следующая встреча» (макет V1)"
    assert "Следующей нет" in src and "Записать на " in src, \
        "без следующей встречи должна быть кнопка «Записать на …»"
    assert "suggestNextSession(" in src, "дату для «Записать на …» берём из suggestNextSession"
    assert "Перенести" in src, "у следующей встречи нет «Перенести»"


def test_card_debt_row_opens_unpaid_sheet_and_reloads():
    src = _read("detail")
    m = re.search(r"<UnpaidSessionsSheet(.*?)/>", src, re.S)
    assert m, "строка долга должна открывать UnpaidSessionsSheet"
    assert "onChanged={reloadQuietly}" in m.group(1) or "onChanged={loadData}" in m.group(1), \
        "после оплаты в шторке карточка должна перечитать долг"
    assert "setUnpaidOpen(true)" in src
    assert "Отметить оплату · ${debt.label}" in src, "кнопка долга называет сумму: «Отметить оплату · 280 ₾»"


def test_card_no_big_money_hero():
    """«Всего оплачено» 64 px уходит: деньги — строкой текста справа (G5-05)."""
    src = _read("detail")
    assert "moneyParts" not in src, "крупная цифра денег вернулась в шапку"
    for m in re.finditer(r"fontSize:\s*'?clamp\(([^)]*)\)", src):
        nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)px", m.group(1))]
        assert all(n < 40 for n in nums), f"резиновый крупный размер {m.group(0)} — шкала фиксированная"
    big = [int(x) for x in re.findall(r"fontSize:\s*(\d+)", src) if int(x) >= 40]
    assert not big, f"шрифт {big[0]} px в карточке клиента"
    assert "оплачено всего" in src, "нет строки «Ставка … · оплачено всего …»"


def test_card_payments_preview_five_and_show_all():
    src = _read("detail")
    assert re.search(r"PAYMENTS_PREVIEW\s*=\s*5\b", src), "последних оплат — 5"
    assert "Показать все (${" in src, "нет «Показать все (N)»"
    assert "maxHeight: 240" not in src, "скрытый скролл истории оплат вернулся (G5-M4)"


def test_card_history_shows_session_with_notes():
    src = _read("detail")
    assert "Map<string, CrmNote[]>" in src, "к сессии показываем все её заметки, а не одну"
    assert "'72ch'" in src, "заметки в истории — строкой до ~72 знаков"
    assert "createNote({ clientId, content })" in src, "новая заметка к клиенту — только createNote"


def test_card_money_handlers_untouched():
    """ЗАПРЕТЫ: обработчики денег и тексты их вопросов — без изменений."""
    src = _read("detail")
    unmark = _body(src, "const handleUnmarkPaid = async")
    assert "title: `Снять отметку об оплате${what}?`" in unmark
    assert "message: 'Платёж удалится из истории оплат, и сессия снова станет долгом. Если потом отметить её заново, оплата запишется сегодняшним числом.'" in unmark
    assert "await crmApi.unmarkPaidSession(sessionId);" in unmark
    mark_all = _body(src, "const handleMarkAllPaid = async")
    assert "title: `Отметить оплату всех сессий с долгом (${stats.unpaidCount})?`" in mark_all
    assert "message: 'Будущие сессии не трогаем — только прошедшие без оплаты.'" in mark_all
    assert "await crmApi.markAllPaid(clientId);" in mark_all
    del_pay = _body(src, "const handleDeletePayment = async")
    assert "message: 'Если это единственная оплата сессии, сессия снова станет неоплаченной.'" in del_pay
    assert "await crmApi.deletePayment(paymentId);" in del_pay
    quick = _body(src, "const handleQuickPay = async")
    assert "await crmApi.quickPaySession(sessionId, account);" in quick
    save = _body(src, "const handleSaveProfile = async")
    assert "}, applyPriceTo !== 'none' ? applyPriceTo : undefined);" in save, "applyPriceTo уходит в updateClient как раньше"
    # Расчёт баланса — прежний.
    # 02.10: stats.debt (сумма по полной цене) убран — он нигде не использовался; долг на
    # карточке считает sumByCurrency по остатку (sessionDebt), см. guard_crm_payments_a_2026_10.
    assert "const debt = unpaid.reduce" not in src, "вернулся неиспользуемый stats.debt"
    assert "const totalPaid = balance?.totalPaid ?? 0;" in src


def test_card_pause_is_soft():
    """G5-10: пауза — мягкая (is_active=false), с «Вернуть» в тосте; навсегда — нельзя."""
    src = _read("detail")
    body = _body(src, "const handleTogglePause = async")
    assert "crmApi.deleteClient(client.id)" in body and "true)" not in body.split("crmApi.deleteClient(client.id")[1][:5], \
        "пауза не должна удалять карточку навсегда"
    assert "undoToast(" in body, "после паузы — «Вернуть» в тосте"


# ── Список клиентов ──────────────────────────────────────────────────────────

def test_clients_next_and_last_past_columns():
    src = _read("clients")
    assert "useState<SortField>('nextSessionDate')" in src, "по умолчанию сортируем по «Следующей»"
    assert "client.nextSessionDate" in src and "client.lastPastSessionDate" in src
    assert ">Следующая<" in src and ">Была<" in src
    assert "Посл. сессия" not in _strip_comments(src), "«Посл. сессия» показывала будущую дату (G5-17)"
    assert "fetchClients(false, true)" in src, "колонки берутся из with_stats"


def test_clients_row_is_link():
    src = _read("clients")
    code = _strip_comments(src)
    assert "<Link to={`/crm/clients/${client.id}`}" in src, "строка клиента — ссылка (G5-14/X4-10)"
    # Единственный navigate в карточку — после создания клиента в NewClientSheet.
    assert code.count("navigate(`/crm/clients/") == 1 and "onCreated={(client) =>" in code, \
        "переход по строке снова на onClick вместо ссылки"
    assert "padStart" not in code, "номера строк 01–11 / счётчики «011» вернулись"
    assert "onToggleActive" not in code, "точка-выключатель вернулась (G5-10)"


def test_clients_sheets_and_existing_apis():
    src = _read("clients")
    code = _strip_comments(src)
    assert "<NewClientSheet" in src, "«+ Клиент» — общая шторка NewClientSheet"
    assert "function ClientForm" not in src, "старая форма «Новый клиент» вернулась"
    assert "fixed inset-0" not in code, "самодельное окно вместо Sheet (X4-04)"
    assert re.search(r"function MergeSheet[\s\S]*?<Sheet", src), "окно слияния — на общем Sheet"
    assert "crmApi.mergeClients({ targetId, sourceIds, ...overrides })" in src, "API слияния прежнее"
    assert "await deleteClient(client.id, true);" in src, "удаление навсегда — прежний вызов"
    body = _body(src, "const onPermanentDelete = async")
    assert body.find("await confirm(") < body.find("await deleteClient(client.id, true)"), \
        "удаление навсегда — только после вопроса"


def test_clients_new_param_opens_sheet_and_is_removed():
    """Дашборд и быстрые действия ведут на /crm/clients?new=1 (пакет B)."""
    src = _read("clients")
    assert "searchParams.get('new') !== '1'" in src, "?new=1 не открывает NewClientSheet"
    assert "setNewClientOpen(true)" in src
    assert "next.delete('new')" in src and "{ replace: true }" in src, \
        "?new=1 нужно убрать из адреса через replace"


# ── Финансы ──────────────────────────────────────────────────────────────────

def test_finances_cash_word_v1():
    src = _read("finances")
    assert "'Касса · с долгами'" in src, "деньги за период называются «Касса · с долгами» (В1)"
    assert "label: 'Получено'" not in src


def test_finances_journal_links_and_debt_actions():
    src = _read("finances")
    code = _strip_comments(src)
    assert code.count("to={`/crm/clients/${client.id}`}") >= 2, "строки долга и журнала ведут в карточку клиента"
    assert "<UnpaidSessionsSheet" in src and "p.onMarkPaid(client)" in src, "у долга нет «Отметить оплату»"
    assert "telegramHref(client.telegram)" in code and "Написать" in src, "у долга нет «Написать»"
    assert "from '../../utils/contactLinks'" in src, "ссылка t.me у долга — из общей contactLinks.ts"
    assert "https://t.me/" not in code, "в Финансах снова своя сборка ссылки t.me без проверки"
    assert "padStart" not in code, "номера строк 001… вернулись"


def test_finances_view_mode_and_money_untouched():
    src = _read("finances")
    assert "specialistId: viewAsSpecialistId ?? undefined," in src, "режим просмотра: долги своего специалиста"
    assert "const revenueGel = totalInGel(revByCur);" in src
    assert src.count("accCurrency") >= 2, "форма платежа потеряла валюту счёта"
    assert "canWrite={!viewAsSpecialistId}" in src, "в просмотре как специалист кнопки записи скрыты"


# ── Заметки ──────────────────────────────────────────────────────────────────

def test_notes_reading_width_link_and_hide():
    src = _read("notes")
    code = _strip_comments(src)
    assert "72ch" in src, "строка заметки ~72 знака"
    assert "<Link" in src and "to={`/crm/clients/${client.id}`}" in src, "имя клиента — ссылка"
    assert "padStart" not in code, "номера 001… вернулись"
    assert "Скрывать текст" in src and "localStorage" in src, "нет «Скрывать текст»"
    assert "hideText={readHide()}" in src, "окно удаления не должно цитировать скрытую заметку"
    prev = _read("preview")
    assert "hideText" in prev


def test_notes_search_skips_hidden_text():
    """Ревью волны 3: при «Скрывать текст» поиск по content скрытой заметки
    выдаёт её содержимое («депрессия» → осталась одна заметка Анны)."""
    code = _strip_comments(_read("notes"))
    m = re.search(r"const filtered = useMemo\(\(\) => \{(.*?)\}, \[([^\]]*)\]\);", code, re.S)
    assert m, "в CrmNotes нет фильтра поиска const filtered = useMemo(…)"
    body, deps = m.group(1), m.group(2)
    assert "const textSearchable = !hideText || revealed.has(n.id);" in body, \
        "поиск должен знать, скрыт ли текст заметки (hideText / revealed)"
    assert body.count("n.content") == 1 and "textSearchable && n.content.toLowerCase().includes(q)" in body, \
        "по тексту скрытой заметки снова ищут — по выдаче угадывается содержимое"
    assert "n.tags" in body and "clientMap.get(n.clientId)?.name" in body, "поиск по тегам и имени клиента пропал"
    assert "hideText" in deps and "revealed" in deps, "фильтр не пересчитывается при «Скрывать/Показывать»"


# ── Ревью волны 3: приватность и контакты в карточке ────────────────────────

def test_card_tab_title_has_no_client_name():
    """Психотерапия: имя клиента во вкладке видно при показе экрана и остаётся
    в истории браузера."""
    code = _strip_comments(_read("detail"))
    titles = re.findall(r"useDocumentTitle\(([^;]*)\);", code)
    assert titles == ["'Клиент · Psy-CRM'"], f"заголовок вкладки карточки: {titles}"


def test_card_contact_from_shared_util():
    src = _read("detail")
    code = _strip_comments(src)
    assert "import { contactHref } from '../../utils/contactLinks';" in src, \
        "карточка: contactHref — из общей src/utils/contactLinks.ts"
    assert "function contactHref" not in code and "https://t.me/" not in code, \
        "в карточке снова своя копия проверки ника/номера"


def test_card_without_telegram_offers_call():
    """Фикс 04cea69: без Telegram кнопка ведёт на tel: и подписана
    «Позвонить» (contact.label), а не «Написать»."""
    code = _strip_comments(_read("detail"))
    m = re.search(r"contact\.href\.startsWith\('tel:'\) \?\s*\((.*?)\)\s*:\s*\((.*?)\)\s*\)", code, re.S)
    assert m, "у кнопки связи нет ветки для tel: — без Telegram снова «Написать» на звонок"
    tel, tg = m.group(1), m.group(2)
    assert "href={contact.href}" in tel and "<Phone" in tel and "{contact.label}" in tel, \
        "ветка tel: должна быть «Позвонить» (contact.label) с иконкой телефона"
    assert "Написать" not in tel and 'target="_blank"' not in tel, "ветка tel: снова «Написать» / новая вкладка"
    assert "Написать" in tg and "<Send" in tg, "ветка Telegram потеряла «Написать»"


# ── Общее для пакета ─────────────────────────────────────────────────────────

def test_forbidden_patterns_in_package_files():
    for key in ("detail", "clients", "notes", "finances", "preview"):
        code = _strip_comments(_read(key))
        name = FILES[key].name
        assert "notesText" not in code, f"{name}: notesText не шифруется — терапевтический текст туда не пишем"
        assert ".toISOString(" not in code, f"{name}: toISOString сдвигает время сессии на 4 часа"
        assert not re.search(r"updateSession\([^)]*isPaid", code), \
            f"{name}: оплата — только quickPaySession, не updateSession({{isPaid}})"
        assert not re.search(r"specialistId:(?!\s*viewAsSpecialistId)", code), \
            f"{name}: specialistId в запросе — только viewAsSpecialistId из стора"
        assert "updateNote" not in code, f"{name}: правки заметок нет на сервере — вне волны"


def test_view_as_hides_create_buttons():
    for key in ("detail", "clients", "notes", "finances"):
        src = _read(key)
        assert "viewAsSpecialistId" in src, f"{FILES[key].name}: кнопки записи не прячутся в просмотре как специалист"


def test_generic_error_toasts_only_in_frozen_money_handlers():
    """X3-22: «Ошибка» без смысла — только в денежных обработчиках, которые
    по запрету не трогаем (quick-pay, снятие оплаты, «отметить все»)."""
    detail = _read("detail")
    assert detail.count("|| 'Ошибка')") == 3, "новый пустой тост «Ошибка» в карточке клиента"
    for key in ("clients", "notes", "finances"):
        assert "|| 'Ошибка')" not in _read(key), f"{FILES[key].name}: пустой тост «Ошибка»"


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
    print("СТОРОЖ wave3-crm-clients: OK" if not failures else f"СТОРОЖ wave3-crm-clients УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
