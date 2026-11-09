"""СТОРОЖ: Psy-CRM на телефоне, волна 1 ревью (09.11, crm-ux п. 1–20 кроме 9 + дизайн п. 1, 7, 9, 23).

Что чинили и не должно сломаться снова (номер = пункт ревью crm-ux.md):
  1  Одна цена везде: шторка, история клиента и «Сессии» берут sessionPriceOf
     (своя цена сессии или ставка клиента) и пишут «по ставке клиента».
  2  «Оплачено» без суммы — нельзя (решение владельца 2): quick-pay при цене 0 без
     amount → 400 с русским текстом, с amount → платёж + цена сессии; «Отметить все»
     пропускает сессии без цены; новый клиент (вручную и из календаря) получает
     ставку из «Базовой цены сессии» анкеты; телефон спрашивает «Сколько заплатили?».
  3  Подзаголовок шторки — статус словами; «Вернуть в план» ↶ не на главном месте;
     у прошедшей главные плитки — «Оплата» и «Отменить».
  4  Перенос: плашка «Кабинет … переедет»; тост называет кабинет; ошибка сервера —
     человеческое название кабинета, без служебного id и приписки в скобках.
  5  Отмена: галочки «Освободить кабинет и вернуть деньги» (>24 ч) и «Убрать из Google
     Календаря»; <24 ч — строка про пересдачу.
  6  (решение 6) «Не пришёл / поздняя отмена — оплачивается» = NO_SHOW: в долге
     (список клиентов, баланс клиента, дашборд), синк его не отменяет; статусы
     проверяются (опечатка — 400).
  6' Календарь не подключён: нет ⟳, есть плашка «Как подключить»; «Календарь и счета»
     в меню; текст ошибки синка — реальный путь.
  7  Поиск «#4150» находит; подсказка «Имя, код, телефон»; код — «#4150».
  8  Частичная оплата видна в истории, «Сессиях», «Финансах»; платёж — «за 3 нояб.».
  10 «Скрывать текст» — общая настройка, по умолчанию включена; шторка — «Заметки · N».
  11–20 мелочи (дубль «Перенести времени», фильтры клиентов, долг первым, должник →
     список неоплаченных, «Заработано за месяц», «+ Сессия», «Состоялись», «Не оплачены»,
     «Показать ещё», имя на 2 строки, стрелки недели, FileText, долг один раз,
     «оплачено за всё время»).
  Дизайн п. 1: большие тёмные блоки — --color-panel (тёмная тема без светлых пятен).

Без сети и боевой базы: SQLite в памяти, мост в финансы и Google подменены.

    python3 backend/tests/guard_crm_wave1_2026_11.py
"""
import os
import pathlib
import re
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

BACKEND = pathlib.Path(__file__).parent.parent
ROOT = BACKEND.parent
MCRM = "src/pages/mobile/crm/"


def _src(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_src(rel))


# ─── Фикстуры ────────────────────────────────────────────────────────────

ME = str(uuid4())


def _engine():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
    from app.models.app_setting import AppSetting
    from app.models.specialist import Specialist
    from app.models.therapist_client import TherapistClient
    from app.models.therapist_payment import TherapistPayment
    from app.models.therapy_session import TherapySession

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[
        AppSetting.__table__, Specialist.__table__, TherapistClient.__table__,
        TherapySession.__table__, TherapistPayment.__table__,
    ])
    return eng


def _user():
    return SimpleNamespace(id=ME, email="spec@example.com", name="Спец", crm_data={}, role="specialist")


def _no_bridge():
    import app.api.v1.crm.sessions as ses
    ses.push_payment = lambda *a, **k: None
    ses.retract_payment = lambda *a, **k: None


def _profile(s, price=120):
    from uuid import UUID
    from app.models.specialist import Specialist
    s.add(Specialist(id=uuid4(), user_id=UUID(ME), first_name="Ольга", last_name="К", base_price_gel=price))
    s.commit()


def _client(s, cid="c1", base_price=0.0):
    from app.models.therapist_client import TherapistClient
    s.add(TherapistClient(id=cid, specialist_id=ME, name="Вера Котова", base_price=base_price, currency="GEL"))
    s.commit()


def _session(s, sid="s1", cid="c1", price=None, status="COMPLETED", days=-1):
    from app.models.therapy_session import TherapySession
    s.add(TherapySession(id=sid, client_id=cid, specialist_id=ME, status=status, price=price,
                         date=datetime.utcnow() + timedelta(days=days), is_paid=False))
    s.commit()


def _payments(s, sid):
    from sqlmodel import select
    from app.models.therapist_payment import TherapistPayment
    return s.exec(select(TherapistPayment).where(TherapistPayment.session_id == sid)).all()


# ─── 2. Оплата без суммы ─────────────────────────────────────────────────

def test_quick_pay_without_price_needs_amount():
    from fastapi import HTTPException
    from sqlmodel import Session
    from app.api.v1.crm.sessions import quick_pay_session
    from app.models.therapy_session import TherapySession
    _no_bridge()
    with Session(_engine()) as s:
        _client(s)
        _session(s)
        try:
            quick_pay_session("s1", {}, s, _user())
            raise AssertionError("цена 0 без суммы — сессия стала «оплаченной» без денег")
        except HTTPException as e:
            assert e.status_code == 400 and "цена" in str(e.detail) and "сумм" in str(e.detail), e.detail
        s.expire_all()
        assert not s.get(TherapySession, "s1").is_paid and not _payments(s, "s1")
        for bad in (0, -5, "abc"):
            try:
                quick_pay_session("s1", {"amount": bad}, s, _user())
                raise AssertionError(f"сумма {bad!r} принята")
            except HTTPException as e:
                assert e.status_code == 400
        res = quick_pay_session("s1", {"amount": 120}, s, _user())
        assert res["amount"] == 120 and res["created"] is True
        s.expire_all()
        ts = s.get(TherapySession, "s1")
        assert ts.is_paid and ts.price == 120, "сумма оплаты должна стать ценой сессии"
        pays = _payments(s, "s1")
        assert len(pays) == 1 and pays[0].amount == 120


def test_quick_pay_with_client_rate_unchanged():
    from sqlmodel import Session
    from app.api.v1.crm.sessions import quick_pay_session
    _no_bridge()
    with Session(_engine()) as s:
        _client(s, base_price=120)
        _session(s)
        res = quick_pay_session("s1", {}, s, _user())
        assert res["amount"] == 120 and len(_payments(s, "s1")) == 1


def test_mark_all_paid_skips_sessions_without_price():
    from sqlmodel import Session
    from app.api.v1.crm.sessions import mark_all_sessions_paid
    from app.models.therapy_session import TherapySession
    _no_bridge()
    with Session(_engine()) as s:
        _client(s)
        _session(s, "s1", price=None)
        _session(s, "s2", price=100)
        res = mark_all_sessions_paid("c1", s, _user())
        assert res["marked"] == 1 and res["skipped_no_price"] == 1, res
        s.expire_all()
        assert not s.get(TherapySession, "s1").is_paid, "сессия без цены отмечена «оплаченной» без денег"
        assert s.get(TherapySession, "s2").is_paid


def test_new_client_gets_profile_price():
    from sqlmodel import Session
    from app.api.v1.crm.clients import create_client
    from app.models.therapist_client import TherapistClientCreate
    with Session(_engine()) as s:
        _profile(s, 120)
        c = create_client(TherapistClientCreate(name="Новый"), s, _user())
        assert c.base_price == 120, "ставка не указана — должна быть «Базовая цена сессии» из анкеты"
        c0 = create_client(TherapistClientCreate(name="Бесплатный", base_price=0), s, _user())
        assert c0.base_price == 0, "явно введённый 0 — уважаем"
        c2 = create_client(TherapistClientCreate(name="Свой", base_price=90), s, _user())
        assert c2.base_price == 90
        cu = create_client(TherapistClientCreate(name="Доллары", currency="USD"), s, _user())
        assert cu.base_price == 0, "цена анкеты в лари — клиенту в долларах не подставляем"


def test_calendar_clients_get_profile_price():
    code = _code("backend/app/api/v1/crm/sync.py")
    assert "_default_price = profile_base_price(session, current_user.id)" in code
    i = code.index("new_client = TherapistClient(")
    assert "base_price=_default_price" in code[i:i + 300], "клиент из календаря снова со ставкой 0"


def test_settings_expose_default_price():
    code = _code("backend/app/api/v1/crm/dashboard.py")
    assert '"default_session_price": profile_base_price(session, current_user.id)' in code


# ─── 6. NO_SHOW «неявка, оплачивается» ───────────────────────────────────

def test_no_show_is_debt_everywhere():
    from sqlmodel import Session
    from app.api.v1.crm.clients import get_client_balance, list_clients
    _no_bridge()
    with Session(_engine()) as s:
        _client(s, base_price=100)
        _session(s, "s1", status="NO_SHOW")
        _session(s, "s2", status="CANCELLED_CLIENT")
        bal = get_client_balance("c1", s, _user())
        assert bal["debt"] == 100 and bal["unpaid_sessions_count"] == 1, bal
        rows = list_clients(s, _user(), False, True, None)
        assert rows[0]["unpaidSum"] == 100, "неявка не попала в долг в списке клиентов"
    dash = _code("backend/app/api/v1/crm/dashboard.py")
    assert dash.count("TherapySession.status.in_(BILLABLE_STATUSES)") >= 2, "дашборд: неявка вне долга"
    init = _code("backend/app/api/v1/crm/__init__.py")
    assert 'BILLABLE_STATUSES = ("COMPLETED", "NO_SHOW")' in init


def test_status_validated_and_no_show_kept_by_sync():
    from fastapi import HTTPException
    from sqlmodel import Session
    from app.api.v1.crm.sessions import update_session
    from app.models.therapy_session import TherapySessionUpdate, TherapySession
    _no_bridge()
    with Session(_engine()) as s:
        _client(s, base_price=100)
        _session(s)
        try:
            update_session("s1", TherapySessionUpdate(status="CANCELED"), s, _user(), None)
            raise AssertionError("опечатка в статусе принята — сессия выпала бы из долга")
        except HTTPException as e:
            assert e.status_code == 400
        update_session("s1", TherapySessionUpdate(status="NO_SHOW"), s, _user(), None)
        s.expire_all()
        ts = s.get(TherapySession, "s1")
        assert ts.status == "NO_SHOW"
        from app.api.v1.crm.sync import _keep_valuable_session
        kept = []
        assert _keep_valuable_session(s, ts, kept, {}) is True and ts.status == "NO_SHOW" and not kept, \
            "удалили событие в календаре — неявку (долг) синк отменять не должен"


def test_remove_from_calendar_on_cancel():
    from sqlmodel import Session
    import app.services.crm_calendar as cal
    from app.api.v1.crm.sessions import update_session
    from app.models.therapy_session import TherapySessionUpdate, TherapySession
    _no_bridge()
    deleted = []
    saved = cal.delete_calendar_event
    cal.delete_calendar_event = lambda calendar_id, event_id: deleted.append((calendar_id, event_id))
    try:
        with Session(_engine()) as s:
            _client(s, base_price=100)
            _session(s, status="PLANNED", days=3)
            ts = s.get(TherapySession, "s1")
            ts.google_event_id = "ev1"
            s.add(ts)
            s.commit()
            u = _user()
            u.crm_data = {"calendar_id": "spec@example.com"}
            update_session("s1", TherapySessionUpdate(status="CANCELLED_CLIENT", remove_from_calendar=True), s, u, None)
            s.expire_all()
            ts = s.get(TherapySession, "s1")
            assert deleted == [("spec@example.com", "ev1")] and ts.google_event_id is None
            assert ts.status == "CANCELLED_CLIENT"
    finally:
        cal.delete_calendar_event = saved


# ─── 4. Перенос: человеческое имя кабинета ───────────────────────────────

def test_reschedule_conflict_text_human():
    code = _code("backend/app/api/v1/crm/sessions.py")
    i = code.index("if not available:")
    block = code[i:i + 900]
    assert "_room_label(session, bk.resource_id)" in block
    assert "кабинет {bk.resource_id}" not in block and "({conflict_msg})" not in block, \
        "в тексте ошибки снова служебный id кабинета / техническая приписка"
    sheet = _code(MCRM + "SessionActionSheet.tsx")
    assert "переедет на новое время, если он свободен. Цена брони может измениться." in sheet
    assert "`Сессия и ${cabinetShort ?? 'кабинет'} перенесены на ${when}`" in sheet


def test_sync_error_gives_real_path():
    code = _src("backend/app/api/v1/crm/sync.py")
    assert "укажите его в Настройках CRM" not in code
    assert code.count("raise HTTPException(400, CALENDAR_NOT_CONNECTED)") == 3
    assert "«Календарь и счета»" in code


# ─── Фронт ───────────────────────────────────────────────────────────────

def test_one_price_and_partial_on_screens():
    sheet = _code(MCRM + "SessionActionSheet.tsx")
    assert "sessionPriceOf(session, client)" in sheet and "' · по ставке клиента'" in sheet
    assert "'цена не указана'" not in sheet, "п. 1: шторка снова «цена не указана» при ставке клиента"
    client = _code(MCRM + "MobileCrmClient.tsx")
    # 09.11 фаза 3: строка цены — sessionPriceLine, «оплачено / не оплачено» — бейджем (sessionPayState).
    assert "sessionPriceLine(s, client" in client and "оплачено ${formatMoney(partial.paid" in client
    assert "sessionPayState(s, client" in client
    assert "` · за ${formatDayMonth(parseUTC(forSession.date), TZ)}`" in client, "п. 8: платёж без «за какую сессию»"
    assert "s.price ? ` · ${formatMoney(s.price" not in client
    sess = _code(MCRM + "MobileCrmSessions.tsx")
    assert "sessionPriceOf(s, client)" in sess and "partialPayment(s, client)" in sess
    fin = _code(MCRM + "MobileCrmFinance.tsx")
    assert "partialSessionsCount" in fin and "частично" in fin


def test_pay_asks_amount_when_no_price():
    sheet = _code(MCRM + "SessionActionSheet.tsx")
    i = sheet.index("const handlePaid = async")
    body = sheet[i:sheet.index("const handlePayAmount", i)]
    assert "sessionPriceOf(session, client) <= 0" in body and "setMode('pay')" in body
    assert "title=\"Сколько заплатили?\"" in sheet
    assert "crmApi.quickPaySession(session.id, undefined, amount," in sheet
    assert "s.crmSettings?.defaultSessionPrice" in sheet, "сумма не подставляется из анкеты"
    store = _code("src/store/crmStore.ts")
    assert "crmApi.quickPaySession(id, account, amount, rememberRate)" in store
    assert "toastApiError(error, 'Не удалось отметить оплату')" in store, "причина отказа сервера не видна"


def test_sheet_status_words_and_tiles():
    sheet = _code(MCRM + "SessionActionSheet.tsx")
    assert "sessionStatusWords(session, client, cabinetShort)" in sheet
    assert "parts.push('не оплачена')" in sheet
    main = sheet[sheet.index("function Main("):sheet.index("\nfunction PayAmountForm")]
    # 09.11 фаза 3 (дизайн-ревью п. 8): «Отменить» — не плитка рядом с главными, а тихая
    # кнопка внизу шторки (текст danger); у прошедшей главная плитка — «Оплата».
    assert "else if (isCompleted) tiles = [payTile];" in main
    assert "canCancel && (" in main and "Отменить сессию" in main, "в шторке нет «Отменить сессию»"
    assert 'label="Запланирована"' not in main, "п. 3: плитка «Запланирована» читается как статус"
    assert 'label="Вернуть в план"' in main and "<RotateCcw" in main
    assert "!hasRescheduleTile && (" in main, "п. 11: «Перенести время» дублирует плитку «Перенести»"
    assert "<FileText size={20}" in main, "дизайн п. 9: у заметки иконка-стрелка"  # 09.11 фаза 3: значки строк 20 px
    assert "truncate(latestNote" not in main and "`Заметки · ${noteCount}`" in main, \
        "п. 10: начало заметки на главном экране шторки"


def test_cancel_options():
    sheet = _code(MCRM + "SessionActionSheet.tsx")
    body = sheet[sheet.index("function CancelConfirm("):sheet.index("function CheckRow(")]
    assert "Освободить {label ?? 'кабинет'} и вернуть деньги на баланс" in body
    assert "hoursLeft >= CABINET_CANCEL_HOURS" in body and "const CABINET_CANCEL_HOURS = 24;" in sheet
    assert "Кабинет отменить уже нельзя — можно пересдать в «Моих бронях»." in body
    assert "Убрать из Google Календаря" in body
    assert "onCancel('NO_SHOW', opts)" in body and "Не пришёл / поздняя отмена — оплачивается" in body
    handler = sheet[sheet.index("const handleCancel = async"):sheet.index("const handlePaid = async")]
    assert "crmApi.detachCabinet(session.id, true)" in handler and "removeFromCalendar: true" in handler
    assert "NO_SHOW:" in _code("src/design/statuses.ts")
    money = _code("src/utils/sessionMoney.ts")
    assert "new Set(['COMPLETED', 'NO_SHOW'])" in money


def test_calendar_first_run():
    today = _code(MCRM + "MobileCrmToday.tsx")
    assert "calendar.connected !== false && (" in today, "п. 6: ⟳ видна без подключённого календаря"
    assert "Календарь не подключён" in today and "Как подключить" in today
    lay = _code(MCRM + "MobileCrmLayout.tsx")
    assert "Календарь и счета" in lay and "<CalendarSetupSheet" in lay
    setup = _code(MCRM + "CalendarSetupSheet.tsx")
    assert "crmApi.updateSettings({ calendarId: id })" in setup and "testCalendarConnection" in setup
    clients = _code(MCRM + "MobileCrmClients.tsx")
    assert "calendar.connected === false ?" in clients, "п. 6: пустой список обещает синк без календаря"


def test_search_and_code():
    flows = _code(MCRM + "crmFlows.tsx")
    assert "replace(/^#+\\s*/, '')" in flows and "`#${c}`" in flows
    for name in ("MobileCrmClients.tsx", "MobileCrmSessions.tsx"):
        code = _code(MCRM + name)
        assert "normalizeClientQuery(" in code and 'placeholder="Имя, код, телефон"' in code, name
        # 09.11 фаза 3 (дизайн-ревью п. 10): в строках списков — только имя, без «#4150 ·»;
        # поиск по коду остаётся (normalizeClientQuery). Код с «#» — в карточке клиента.
        assert "aliasLabel(" not in code, f"{name}: служебный код снова перед именем в строке"
    card = _code(MCRM + "MobileCrmClient.tsx")
    assert '<span className="mono">{aliasLabel(client.aliasCode)}</span>' in card, "карточка: код для календаря без «#»"


def test_clients_list_debt_first_and_chips():
    code = _code(MCRM + "MobileCrmClients.tsx")
    # 09.11 фаза 3 (дизайн-ревью п. 12): долг — справа суммой <Money tone="debt"> (не режется
    # многоточием), а не началом второй строки; смысл тот же — долг виден всегда.
    assert 'trail={debt > 0 ? <Money value={debt}' in code and 'tone="debt"' in code, "п. 12: долг снова в строке, где его режет многоточие"
    assert "долг {formatMoney(debt" not in code, "п. 12: долг снова текстом во второй строке"
    assert "'С долгом'" in code and "'Без следующей'" in code


def test_finance_debtor_sheet_and_earned():
    fin = _code(MCRM + "MobileCrmFinance.tsx")
    assert "<UnpaidSessionsSheet" in fin and "setDebtor(c)" in fin, "п. 13: должник снова ведёт в карточку"
    assert 'label="Заработано за месяц"' in fin and "earnedByCurrency(" in fin, "решение 5"


def test_sessions_tab():
    sess = _code(MCRM + "MobileCrmSessions.tsx")
    assert "label: 'Состоялись'" in sess and "label: 'Не оплачены'" in sess
    assert "'Будущие 7 дней'" not in sess and "'7 дней с сегодня'" in sess
    assert "bookNext.open()" in sess, "п. 15: нет «+ Сессия»"


def test_client_card_bits():
    c = _code(MCRM + "MobileCrmClient.tsx")
    assert ".slice(0, 30)" not in c and "Показать ещё" in c, "п. 16: лента молча обрезается"
    # 09.11 фаза 3: «Ставка / Оплачено за всё время» — ячейки SummaryCard (подпись с заглавной).
    assert "Оплачено за всё время" in c
    i = c.index("onClick={() => setUnpaidOpen(true)}")
    assert "Отметить оплату…" in c[i:c.index("</Button>", i)], "дизайн п. 7: сумма долга дважды"


def test_notes_hidden_everywhere():
    priv = _code(MCRM + "notesPrivacy.ts")
    assert "localStorage.getItem(HIDE_KEY) !== '0'" in priv, "п. 10: скрытие не включено по умолчанию"
    for name in ("MobileCrmNotes.tsx", "MobileCrmClient.tsx", "SessionActionSheet.tsx"):
        assert "useNotesHidden()" in _code(MCRM + name), f"{name}: не слушает общую настройку «Скрывать текст»"
    notes = _code(MCRM + "MobileCrmNotes.tsx")
    assert "aria-pressed={hideText}" in notes and "'Текст скрыт · показать'" in notes, "дизайн п. 23"


def test_today_small_things():
    today = _code(MCRM + "MobileCrmToday.tsx")
    # 09.11 фаза 3: строки — общий ListRow (имя переносится, не режется); оплата — в action
    # (отдельно от имени), а не в одной строке с ним.
    close = today[today.index('title="Закрыть день"'):today.index('title="Аренда без сессии"')]
    assert "<ListRow" in close and "action={s.isPaid ? undefined" in close, "п. 18: имя снова обрезается кнопкой оплаты"
    assert "WebkitLineClamp: 1" not in today and "textOverflow: 'ellipsis'" not in close
    assert "shiftDay(-7)" in today and "shiftDay(7)" in today, "п. 19: нет стрелок недели"
    assert "s.status !== 'NO_SHOW'" in today, "неявка в будущем попала в «Дальше»"


def test_dark_theme_panels():
    today = _code(MCRM + "MobileCrmToday.tsx")
    i = today.index("const nextCard")
    assert "var(--color-panel)" in today[i:i + 200] and "var(--color-ink)'" not in today[i:i + 200]
    prof = _code(MCRM + "MobileCrmProfile.tsx")
    assert "background: 'var(--color-panel)', color: 'var(--color-on-panel)'" in prof
    assert "background: 'var(--color-ink)', color: 'var(--color-on-ink)'" not in prof


# ─── Доработки 09.11 (координатор): компьютер, «запомнить ставку», заявки с сайта ──

def test_price_required_detail_and_remember_rate():
    from fastapi import HTTPException
    from sqlmodel import Session
    from app.api.v1.crm.sessions import quick_pay_session
    from app.models.therapist_client import TherapistClient
    _no_bridge()
    with Session(_engine()) as s:
        _profile(s, 130)
        _client(s)
        _session(s, "s1")
        _session(s, "s2")
        try:
            quick_pay_session("s1", {}, s, _user())
            raise AssertionError("без суммы приняли")
        except HTTPException as e:
            d = e.detail
            assert isinstance(d, dict) and d["code"] == "price_required", d
            assert d["default_price"] == 130 and d["client_base_price"] == 0 and "цена" in d["message"]
        quick_pay_session("s1", {"amount": 110, "remember_rate": True}, s, _user())
        s.expire_all()
        assert s.get(TherapistClient, "c1").base_price == 110, "«Запомнить как ставку клиента» не сработало"
        # Ставка уже есть — не перезаписываем (s2 теперь платится по ставке 110 сама).
        res = quick_pay_session("s2", {}, s, _user())
        assert res["amount"] == 110


def test_remember_rate_never_overwrites_existing_rate():
    code = _code("backend/app/api/v1/crm/sessions.py")
    i = code.index('payload.get("remember_rate") is True')
    assert "not client.base_price" in code[i:i + 200], "галочка перезаписала бы существующую ставку"


def test_frontend_asks_amount_everywhere():
    api = _code("src/api/crm.ts")
    i = api.index("quickPaySession: async")
    body = api[i:api.index("unmarkPaidSession", i)]
    assert "detail.code !== 'price_required'" in body and "askPaymentAmount(" in body, \
        "компьютер снова упирается в 400 вместо «Сколько заплатили?»"
    assert "crmApi.quickPaySession(id, account, answer.amount, answer.rememberRate)" in body
    ask = _code("src/components/crm/askPaymentAmount.tsx")
    assert "const showRemember = !(clientRate > 0);" in ask and "Запомнить как ставку клиента" in ask
    sheet = _code(MCRM + "SessionActionSheet.tsx")
    assert "const canRememberRate = !!client && !(Number(client.basePrice) > 0);" in sheet
    assert "crmApi.quickPaySession(session.id, undefined, amount, canRememberRate && rememberRate)" in sheet
    unpaid = _code("src/components/crm/UnpaidSessionsSheet.tsx")
    assert "result.skippedNoPrice" in unpaid and "'Указать сумму оплаты…'" in unpaid


def test_desktop_counts_no_show():
    for rel in ("src/pages/crm/CrmSessions.tsx", "src/pages/crm/CrmClientDetail.tsx"):
        code = _code(rel)
        assert "'PLANNED', 'COMPLETED', 'NO_SHOW', 'CANCELLED_CLIENT', 'CANCELLED_THERAPIST'" in code, \
            f"{rel}: «Неявка · оплачивается» нельзя выбрать"
        assert "isBillableStatus(" in code, f"{rel}: неявка вне долга"
    sess = _code("src/pages/crm/CrmSessions.tsx")
    assert "return isBillableStatus(eff) && !s.isPaid;" in sess
    assert "(s) => isBillableStatus(getEffectiveStatus(s)) && !!s.isPaid," in sess, "неявка вне «Заработано»"
    fin = _code("src/pages/crm/CrmFinances.tsx")
    assert "['COMPLETED', 'NO_SHOW'].map(status => crmApi.getSessions(" in fin
    assert "status: 'COMPLETED'," not in fin
    assert "'Неявка · оплачивается'" in _code("src/design/statuses.ts")


def test_new_client_hint_and_site_leads():
    ncs = _code("src/components/crm/NewClientSheet.tsx")
    assert "s.crmSettings?.defaultSessionPrice" in ncs and "базовая цена из вашей анкеты" in ncs
    sched = _code("backend/app/api/v1/specialist_schedule.py")
    i = sched.index('pipeline_status="LEAD"')
    assert "base_price=_profile_price(session, user_id_str)" in sched[i - 400:i], \
        "клиент с заявки на сайте снова со ставкой 0"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f()
                print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {n}: {type(e).__name__}: {e}")
    if fails:
        print(f"СТОРОЖ crm-wave1 УПАЛ ({fails}) — деплой НЕ выкатывать")
        sys.exit(1)
    print("СТОРОЖ crm-wave1: OK")
