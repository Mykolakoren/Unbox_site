"""СТОРОЖ wave3, пакет A — Psy-CRM на телефоне (/m/crm/*, 01.10).

Что ловит (чтение исходников, без сети и базы):
  * «Записать следующую» перестало быть 3 тапами: нет первой строки в
    шторке сессии, экран её не подключил, шторка записи показывает свой
    тост вместо «Записали · Забронировать кабинет», ссылка на кабинет
    разошлась с контрактом MobileFind (?linkSession=&date=&time=&duration=).
  * Оплата в 1 тап (В5) пошла мимо quickPaySession стора, без защиты от
    двойного тапа, без «Вернуть», или «Вернуть» снимает оплату не тем путём,
    что шторка сессии (crmApi.unmarkPaidSession), или спрашивает подтверждение.
  * Оплата через updateSession({ isPaid }) — фантомная оплата без платежа.
  * «Сегодня» потеряло три полки / «+ Сессия»; вернулся мёртвый span.
  * «Финансы»: месяц снова «Доход за месяц» (В1 — «Касса · с долгами»),
    вернулся пустой «Средний чек», «Долги сейчас» снова под выбором месяца.
  * Вкладки снова с «Анкетой», переключатель «Psy-CRM ▾» пропал или
    показывает «Админку» всем.
  * toISOString / specialistId / notesText в мобильной CRM; заметка «+ Заметка»
    не через createNote.
  * После записи/оплаты экран не перечитывает данные (шторки стор не обновляют).
  * «Все сессии»: шторка снова показывает старый объект после действия (G6-09).
  * У будущей сессии снова главная кнопка «Прошла» (G6-M4).
  * Ревью волны 3: имя клиента в заголовке вкладки карточки; ссылки t.me /
    tel: снова собираются без проверки, мимо src/utils/contactLinks.ts;
    кнопка долга «Отметить оплату · 280 ₾» обещает мгновенную оплату, хотя
    только открывает список неоплаченных.

    python3 backend/tests/guard_wave3_mcrm.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
MCRM = ROOT / "src/pages/mobile/crm"


def _strip_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), s, flags=re.S)
    return re.sub(r"(?<![:'\"`])//[^\n]*", "", s)


def _code(name: str) -> str:
    return _strip_comments((MCRM / name).read_text(encoding="utf-8"))


def _between(src: str, start: str, end: str) -> str:
    i = src.find(start)
    assert i >= 0, f"не нашли «{start}»"
    j = src.find(end, i + len(start))
    return src[i:j if j >= 0 else len(src)]


# ── Сценарий «записать следующую» — 3 тапа ──────────────────────────────

def test_book_next_is_first_row_of_session_sheet():
    sheet = _code("SessionActionSheet.tsx")
    assert "onBookNext?: (session: CrmSession) => void" in sheet, "шторка сессии не принимает onBookNext"
    main = _between(sheet, "function Main(", "\nfunction RescheduleForm")
    i_row = main.find("Записать следующую · ${nextSessionLabel(session, client)}")
    i_tiles = main.find("<ActionTile")
    assert 0 <= i_row < i_tiles, "«Записать следующую · …» должна быть первой строкой шторки"
    assert "!viewingOther" in sheet, "в «просмотре как специалист» строка записи не должна показываться"
    for name in ("MobileCrmToday.tsx", "MobileCrmSessions.tsx", "MobileCrmClient.tsx"):
        code = _code(name)
        assert "onBookNext=" in code and "bookNext.open(" in code and "{bookNext.sheet}" in code, \
            f"{name}: шторка сессии без «Записать следующую»"


def test_book_next_own_toast_and_link_contract():
    flows = _code("crmFlows.tsx")
    assert "successToast={false}" in flows, "NewSessionSheet покажет свой тост — без «Забронировать кабинет»"
    assert "label: 'Забронировать кабинет'" in flows and "navigate(path)" in flows, \
        "после записи нет тоста с «Забронировать кабинет»"
    assert "/m/find?linkSession=${encodeURIComponent(session.id)}&date=${w.date}&time=${w.time}&duration=${dur}" in flows, \
        "ссылка на кабинет разошлась с контрактом MobileFind"
    assert "utcNaiveToTbilisi(session.date)" in flows, "дата/время для /m/find не по Батуми"
    find = (ROOT / "src/pages/mobile/MobileFind.tsx").read_text(encoding="utf-8")
    for p in ("get('linkSession')", "get('date')", "get('time')", "get('duration'"):
        assert p in find, f"MobileFind больше не читает {p} — тост «Забронировать кабинет» сломан"


# ── Оплата в один тап (В5) ───────────────────────────────────────────────

def test_quick_pay_one_tap_with_undo():
    flows = _code("crmFlows.tsx")
    body = _between(flows, "export function useQuickPay", "\n}\n")
    assert "useCrmStore(s => s.quickPaySession)" in body, "оплата в 1 тап мимо quickPaySession стора"
    assert "busyRef.current.has(session.id)" in body, "нет защиты от двойного тапа"
    assert "undoToast(" in body, "нет тоста «Вернуть»"
    undo = _between(body, "const undo = async", "const pay = async")
    assert "crmApi.unmarkPaidSession(before.id)" in undo, "«Вернуть» снимает оплату не тем путём, что шторка"
    assert "confirm(" not in undo, "«Вернуть» — отмена своего действия, без вопроса"
    sheet = _code("SessionActionSheet.tsx")
    assert "crmApi.unmarkPaidSession(session.id)" in sheet, "шторка снимает оплату иначе — сверить с «Вернуть»"
    today = _code("MobileCrmToday.tsx")
    assert "quickPay.pay(s)" in today and "`Оплата · ${formatMoney(" in today, "на «Сегодня» нет «Оплата · 140 ₾»"
    assert "loading={busy}" in today, "кнопка оплаты не блокируется на время запроса"


def test_no_payment_via_update_session():
    for p in sorted(MCRM.glob("*.ts*")):
        code = _strip_comments(p.read_text(encoding="utf-8"))
        assert not re.search(r"updateSession\([^)]*isPaid", code, re.S), \
            f"{p.name}: оплата через updateSession — платёж не запишется"


# ── Экраны ───────────────────────────────────────────────────────────────

def test_today_three_shelves():
    today = _code("MobileCrmToday.tsx")
    for text in (">Дальше<", ">Закрыть день<", ">Без следующей встречи<", "bookNext.open()",
                 "formatStartsIn(", "nextSessionLabel(last, client)"):
        assert text in today, f"«Сегодня» V2: нет {text}"
    assert "display: 'none'" not in today, "вернулся мёртвый скрытый span"
    assert "utcNaiveToTbilisi(s.date)?.date === dateStr" in today, "день не по Батуми"


def test_finance_kassa_wording():
    fin = _code("MobileCrmFinance.tsx")
    assert 'label="Касса · с долгами"' in fin, "В1: деньги за месяц — «Касса · с долгами»"
    assert "Доход за месяц" not in fin and "Средний чек" not in fin and "avgCheck" not in fin
    assert fin.find(">Месяц<") < fin.find(">Долги сейчас<"), "«Долги сейчас» — отдельный раздел после месяца"
    assert "totalActiveDebt" in _between(fin, ">Долги сейчас<", "function TotalCell"), \
        "общий долг снова стоит под выбором месяца"


def test_tabs_and_switcher():
    layout = _code("MobileCrmLayout.tsx")
    tabs = re.findall(r'<TabLink to="([^"]+)"', layout)
    assert tabs == ["/m/crm/today", "/m/crm/clients", "/m/crm/sessions", "/m/crm/finance", "/m/crm/notes"], \
        f"вкладки В4: Сегодня · Клиенты · Сессии · Финансы · Заметки, а не {tabs}"
    sw = _between(layout, "function SectionSwitcher", "const switcherItem")
    for to in ("'/m'", "'/m/crm/profile'", "'/m/crm/schedule'"):
        assert to in sw, f"в «Psy-CRM ▾» нет {to}"
    assert "...(isAdmin ? [{ to: '/m/admin'" in sw, "«Админка» должна показываться только по роли"
    assert "isAdmin={isBookingAdmin(currentUser)}" in layout
    assert "aria-current" in sw, "текущий раздел не отмечен"
    assert "window.scrollTo(0, saved ?? 0)" in layout, "прокрутка не сбрасывается при смене экрана (X5-08)"


def test_new_client_opens_card():
    code = _code("MobileCrmClients.tsx")
    assert "<NewClientSheet" in code, "нет «+ Клиент»"
    created = _between(code, "onCreated={(c) => {", "}}")
    assert "load()" in created and "navigate(`/m/crm/clients/${c.id}`)" in created, \
        "после создания клиента список не перечитан или не открыта карточка"
    assert "action={viewingOther ? undefined : { label: 'Добавить клиента'" in code, "в пустом списке нет «+ Клиент»"


def test_client_card_next_debt_note():
    code = _code("MobileCrmClient.tsx")
    for text in ("Следующая встреча", "Следующей нет", "<UnpaidSessionsSheet", "onChanged={refresh}",
                 "crmApi.createNote({ clientId, content })", "onOpenSession"):
        assert text in code, f"карточка клиента: нет {text}"
    assert "navigate('/m/find')" not in code, "вернулась «Забронировать кабинет» без клиента"
    assert "useBookNext(() => refresh()" in code, "после записи карточка не перечитывается"


def test_client_card_tab_title_has_no_name():
    code = _code("MobileCrmClient.tsx")
    titles = re.findall(r"useDocumentTitle\(([^;]*)\);", code)
    assert titles == ["'Клиент · Psy-CRM'"], \
        f"заголовок вкладки карточки клиента с именем (психотерапия, видно при показе экрана): {titles}"


def test_contact_links_from_shared_util():
    for name in ("MobileCrmClient.tsx", "MobileCrmClients.tsx"):
        src = (MCRM / name).read_text(encoding="utf-8")
        code = _strip_comments(src)
        assert "import { phoneHref, telegramHref } from '../../../utils/contactLinks';" in src, \
            f"{name}: ссылки «Позвонить / Telegram» — из общей contactLinks.ts"
        assert "https://t.me/" not in code and "`tel:" not in code, \
            f"{name}: ссылка t.me / tel: снова собирается без проверки ника и номера"
    card = _code("MobileCrmClient.tsx")
    assert "href={tgHref}" in card and "href={telHref}" in card
    lst = _code("MobileCrmClients.tsx")
    assert "href={telegramHref(c.telegram)!}" in lst and "href={phoneHref(c.phone)!}" in lst


def test_client_card_debt_button_does_not_promise_instant_pay():
    code = _code("MobileCrmClient.tsx")
    i = code.index("onClick={() => setUnpaidOpen(true)}")
    label = code[i:code.index("</Button>", i)]
    assert "Долг ${debtTotal} · Оплатить" in label, "кнопка долга: «Долг 280 ₾ · Оплатить»"
    assert "Отметить оплату" not in label, \
        "кнопка долга только открывает список — «Отметить оплату · 280 ₾» обещает мгновенную оплату"


def test_screens_reload_after_sheets():
    today = _code("MobileCrmToday.tsx")
    assert "useBookNext(() => { reloadAll(); }" in today and "useQuickPay(patchOne, () => { reloadAll(); })" in today
    assert "fetchClients(false, true)" in today, "без статистики клиентов полка «Без следующей встречи» врёт"
    sess = _code("MobileCrmSessions.tsx")
    change = _between(sess, "onChange={(updated) => {", "}}")
    assert "setActiveSheet(updated)" in change and "reload(true)" in change, \
        "G6-09: шторка «Сессий» снова показывает старый объект"


def test_future_session_has_no_completed_tile():
    main = _between(_code("SessionActionSheet.tsx"), "function Main(", "\nfunction RescheduleForm")
    assert "session.status !== 'COMPLETED' && isFuture ?" in main and 'label="Перенести"' in main, \
        "G6-M4: у будущей сессии снова «Прошла»"


def test_forbidden_patterns_in_mobile_crm():
    for p in sorted(MCRM.glob("*.ts*")):
        code = _strip_comments(p.read_text(encoding="utf-8"))
        assert "toISOString" not in code, f"{p.name}: toISOString сдвинет дату на 4 часа"
        assert "notesText" not in code, f"{p.name}: client.notesText не шифруется — не трогаем"
        assert not re.search(r"\bspecialistId\s*:", code), f"{p.name}: specialistId в записи"
    for name in ("MobileCrmToday.tsx", "MobileCrmClients.tsx", "MobileCrmClient.tsx", "SessionActionSheet.tsx"):
        assert "viewAsSpecialistId" in _code(name), f"{name}: в «просмотре как специалист» видны кнопки создания"


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
    print("СТОРОЖ wave3-mcrm: OK" if not failures else f"СТОРОЖ wave3-mcrm УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
