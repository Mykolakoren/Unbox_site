"""СТОРОЖ wave3-D — кабинеты в Psy-CRM: бронирования, шахматка, часы приёма,
настройки, анкета (волна 3, пакет D, 01.10).

Что ловит:
  * X4-04 — окна привязки сессии к брони (CrmBookings), быстрой брони и
    «Распределить клиентов» (CrmChessboardView) снова стали самодельными
    оверлеями `fixed inset-0` вместо общей шторки Sheet.
  * Денежная логика брони тронута при смене обёртки: быстрая бронь пишет
    не тем вызовом / не тем способом оплаты, handleBooked перестал вешать
    сессию на бронь, защита от двойного клика (savingRef) пропала, поля цены
    перестали быть type="number" (иначе «50,5» → NaN → 0), пересдача
    (claimable → окно брони) или «следить» (WaitlistSubscribeModal) пропали.
  * G5-16 — свои брони не тёмные, чужие залиты серым, колокольчик виден
    всегда, легенда не объясняет все виды клеток, «без клиента» красным,
    вернулась «+ Бронь», которая ничего не делала.
  * G5-14 — «Google Календарь главный» без role="switch"/aria-checked или
    без вопроса при включении.
  * G5-M2 — курсы валют снова можно править не owner/senior_admin.
  * G5-21 — в анкете снова две кнопки «Сохранить», нет признака правок и
    beforeunload; набор полей PATCH /specialists/me изменился.
  * X2-14 — в подсказке режима CRM на «Моих бронях» нет «← Вернуться в CRM».
  * G5-19 / X3-22 — «Конфигурация CRM.», «источник правды», «tagline»,
    «Ошибка при сохранении» без подсказки, что делать.

Без сети и без базы (только чтение исходников):
    python3 backend/tests/guard_wave3_crm_rooms.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent

BOOKINGS = "src/pages/crm/CrmBookings.tsx"
CHESS = "src/components/crm/CrmChessboardView.tsx"
SCHEDULE = "src/pages/crm/CrmSchedule.tsx"
SETTINGS = "src/pages/crm/CrmSettings.tsx"
PROFILE = "src/pages/crm/CrmProfile.tsx"
ACCOUNTS = "src/components/crm/PaymentAccountsManager.tsx"
MYBOOKINGS = "src/pages/MyBookingsPage.tsx"
ZONE = (BOOKINGS, CHESS, SCHEDULE, SETTINGS, PROFILE, ACCOUNTS)


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


def _fn(src: str, start: str, end: str) -> str:
    i = src.index(start)
    return src[i:src.index(end, i + len(start))]


# ── X4-04: окна на Sheet ──────────────────────────────────────────────────

def test_booking_windows_are_sheets():
    for rel in (BOOKINGS, CHESS):
        code = _strip_comments(_read(rel))
        assert "fixed inset-0" not in code, f"{rel}: самодельный оверлей вместо Sheet (X4-04)"
    chess = _read(CHESS)
    for name, nxt in (("function CrmQuickBookModal", "function durationLabel"),
                      ("function LinkBookingModal", "// ─── Main Component")):
        body = _fn(chess, name, nxt)
        assert "<Sheet" in body, f"{name}: окно не на общей шторке Sheet"
        assert "dismissible={!saving" in body, f"{name}: шторку можно закрыть посреди сохранения"
    link = _fn(_read(BOOKINGS), "function LinkSessionModal", "// BookingCard")
    assert "<Sheet" in link and "dismissible={!saving}" in link, "окно привязки сессии не на Sheet"


# ── Деньги: обёртка сменилась, логика — нет ───────────────────────────────

def test_quick_book_money_logic_unchanged():
    body = _fn(_read(CHESS), "const handleBook = async", "// Волна 3 (X4-04)")
    assert "bookingsApi.createRecurringBooking({" in body, "серия из быстрой брони идёт не тем вызовом"
    assert "paymentMethod: 'balance'," in body, "серия: способ оплаты больше не баланс"
    assert "crmClientId: selectedClientId || undefined," in body
    assert "bookingsApi.createBooking({" in body, "разовая бронь идёт не тем вызовом"
    assert "await onBooked(" in body and "Number(price) || 0" in body, "бронь не передаёт цену сессии в handleBooked"


def test_handle_booked_links_session_to_booking():
    body = _fn(_read(CHESS), "const handleBooked = async", "// Handle saving multi-slot")
    assert "if (clientId && bookingId)" in body, "handleBooked: сессия без брони/клиента"
    assert "bookingId," in body and "isBooked: true," in body, "handleBooked: сессия не привязана к брони"
    assert "pendingChunks.length > 0" in body, "очередь нескольких периодов сломана"


def test_link_modal_double_click_guard_and_series():
    chess = _read(CHESS)
    body = _fn(chess, "function LinkBookingModal", "// ─── Main Component")
    assert "if (savingRef.current) return;" in body, "пропала защита от двойного клика (savingRef)"
    assert "if (result !== false) onClose();" in body, "окно закрывается при неудачной серии"
    multi = _fn(chess, "const handleMultiSlotSave = async", "const handleDeleteBooking")
    assert "pushToCalendar: true," in multi, "будущие сессии серии не уходят в Google Календарь"
    assert "paymentMethod: (booking as any).paymentMethod || 'balance'," in multi, "серия броней: способ оплаты изменился"


def test_price_inputs_keep_number_parsing():
    for rel in (BOOKINGS, CHESS):
        src = _read(rel)
        for m in re.finditer(r"<Input\s+kind=\"money\"([^>]*)/>", src, flags=re.S):
            assert 'type="number"' in m.group(1), f"{rel}: поле цены не type=\"number\" — «50,5» станет 0"


def test_resale_and_watch_still_wired():
    chess = _read(CHESS)
    assert chess.count("const claimable = !isMine && booking.isReRentListed;") == 2, \
        "пересдача: чужой слот на пересдаче больше не открывает бронь (телефон и компьютер)"
    assert chess.count("openWaitlistFor(booking);") >= 2, "«следить за слотом» больше не открывается"
    assert chess.count("<WaitlistSubscribeModal") == 2, "окно «следить» пропало на телефоне или компьютере"


def test_crm_bookings_link_session_unchanged():
    body = _fn(_read(BOOKINGS), "const handleLinkSession", "const FILTERS")
    assert "bookingId: modalBooking.id," in body and "isBooked: true," in body, \
        "привязка: сессия создаётся без брони"
    assert "slotOffsetRef.current += dur;" in body, "разбивка брони: время частей больше не сдвигается"


# ── G5-16: шахматка ───────────────────────────────────────────────────────

def test_chessboard_own_dark_foreign_outline():
    chess = _read(CHESS)
    assert "'bg-ink text-on-ink border-ink cursor-grab" in chess, "свои брони — не сплошная тёмная заливка"
    assert "'bg-transparent text-ink-60 border-ink-20" in chess, "чужие брони — не тонкая рамка"
    assert "bg-gray-100 text-gray-600" not in chess, "чужие снова залиты серым"
    bells = re.findall(r"<Bell[^>]*?/>", chess, flags=re.S)
    assert bells, "нет колокольчика «следить»"
    for b in bells:
        assert "opacity-0" in b and "group-focus-visible:opacity-100" in b, \
            "колокольчик виден всегда — должен появляться при наведении/фокусе"
    assert "onKeyDown={activateOnKey}" in chess, "клетки-брони недоступны с клавиатуры"


def test_chessboard_honest_legend():
    chess = _read(CHESS)
    i = chess.index("aria-label=\"Обозначения\"")
    legend = chess[i:i + 2500]
    for word in ("Мои брони", "Чужие", "На пересдаче", "Пиковые часы", "Выбрано", "Прошло"):
        assert word in legend, f"легенда шахматки не объясняет «{word}»"


def test_bookings_header_neutral_and_no_dead_plus():
    src = _read(BOOKINGS)
    assert "+ Бронь" not in _strip_comments(src), "вернулась «+ Бронь», которая ничего не делала"
    head = _fn(src, "<PageHeader", "/>\n")
    assert "без клиента" in head and "danger" not in head, "«без клиента» в шапке — снова красным"
    assert not re.search(r"String\((?:index|idx|i) \+ 1\)\.padStart", src), "номера строк «01, 02…» вернулись"


# ── G5-14 / G5-M2: настройки ──────────────────────────────────────────────

def test_calendar_switch_is_switch_and_asks():
    src = _read(SETTINGS)
    assert 'role="switch"' in src and "aria-checked={sourceOfTruth}" in src, \
        "переключатель «Google Календарь главный» без role=switch/aria-checked"
    toggle = _fn(src, "const handleToggleSourceOfTruth", "const handleSaveRates")
    assert "if (newVal) {" in toggle and "await confirm({" in toggle, "при включении больше не спрашиваем"
    assert "googleCalendarSourceOfTruth: newVal" in toggle


def test_rates_only_for_owner_and_senior():
    src = _read(SETTINGS)
    assert "const RATE_EDITOR_ROLES = ['owner', 'senior_admin'];" in src, "курсы правит не owner/senior_admin"
    assert "canEditRates ? (" in src and "Курсы задаёт администратор центра" in src, \
        "специалисту снова показываются поля курсов"
    assert "api.put('/settings/exchange_rates', rates)" in src, "сохранение курсов идёт не тем вызовом"


# ── G5-21: анкета ─────────────────────────────────────────────────────────

def test_profile_single_save_when_dirty():
    src = _read(PROFILE)
    assert src.count("onClick={onSave}") == 1, "в анкете снова больше одной кнопки «Сохранить»"
    assert "(dirty || saving) &&" in src, "кнопка сохранения видна без правок"
    assert "'beforeunload'" in src, "нет вопроса при уходе с несохранённой анкетой"
    body = _fn(src, "api.patch('/specialists/me', {", "});")
    keys = re.findall(r"^\s*(\w+):", body, flags=re.M)
    assert keys == ["firstName", "lastName", "photoUrl", "tagline", "bio", "specializations",
                    "formats", "basePriceGel", "sessionDurationMin"], f"PATCH /specialists/me изменился: {keys}"


# ── X2-14: дорога обратно в CRM ───────────────────────────────────────────

def test_crm_mode_hint_has_way_back():
    src = _read(MYBOOKINGS)
    i = src.index("Выберите время для сессии с")
    block = src[max(0, i - 1500):i]
    assert "Вернуться в CRM" in block, "в подсказке режима CRM нет «← Вернуться в CRM»"


# ── G5-19 / X3-22: тексты ─────────────────────────────────────────────────

def test_copy_words():
    for rel in ZONE:
        code = _strip_comments(_read(rel))
        for bad in ("Конфигурация CRM", "источник правды", "· tagline", "Ошибка при сохранении",
                    "Ошибка при отмене", "Ошибка при создании", "Ошибка при удалении", "Еженед.",
                    "Раздел · ", "Unbox · CRM", "Unbox · Конфигурация"):
            assert bad not in code, f"{rel}: старый текст «{bad}»"
    assert "Часы приёма" in _read(SCHEDULE), "экран называется не «Часы приёма» (В4)"



def test_quick_book_modal_resets_per_period():
    """Деньги (ревью 01.10): при нескольких выделенных периодах окно быстрой брони
    переиспользовалось, и 2-й и далее бронировались с длительностью (и ценой) 1-го.
    key по слоту пересоздаёт окно на каждый период."""
    import re as _re
    from pathlib import Path as _P
    src = (_P(__file__).resolve().parents[2] / "src/components/crm/CrmChessboardView.tsx").read_text(encoding="utf-8")
    n = len(_re.findall(r"<CrmQuickBookModal\s+key=\{`\$\{bookSlot\.resId\}\|\$\{bookSlot\.time\}\|\$\{bookSlot\.duration\}`\}", src))
    assert n == src.count("<CrmQuickBookModal"), "CrmQuickBookModal без key по слоту — следующий период возьмёт длительность первого"

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
    print("СТОРОЖ wave3-crm-rooms: OK" if not failures else f"СТОРОЖ wave3-crm-rooms УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
