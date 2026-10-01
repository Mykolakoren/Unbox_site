"""СТОРОЖ волны 4, пакет A — админка на телефоне (/m/admin).

Что сделали 01.10 и что не должно вернуться (чтение исходников, без сети):

  G9-04 / X1-08  /m/admin/users/:email — нативная карточка (MobileAdminUserCard),
                 баланс первым, опасное («Удобнее на компьютере») — в самом низу.
                 Раньше — компьютерная AdminUserDetails, сжатая до 390 px.
  N3 / G9-13     «Сегодня» — лента дня через adminToday + computeDueByBooking,
                 без нового запроса и без фильтра «только confirmed»
                 (закончившиеся брони не пропадают).
  В2 / В3        «к оплате» тоном danger (DueBadge); «Принять оплату» →
                 TopupSheet, сумма по умолчанию — весь долг (byClient.total).
  G9-10 / В4     Касса: «Сейчас в кассе» выше периода, «Закрыть смену» видна
                 всегда; при закрытии смены ожидаемая сумма — ПОСЛЕ ввода факта.
  В5             Своя операция: сводка на кнопке и тост «Вернуть».
  G8-03 / В1     «Закрыть кабинет» — maintenanceApi, 409 → MaintenanceConflictSheet,
                 без toast.error(detail) (на объекте React падал, #31).
  G9-09          Подтверждение при выключении/скрытии/одобрении, не при включении.
  X2-07 / M2     Шапка «Админка ▾», CRM клиентов, счётчик на «Заявках».

Деньги не трогаем: отпечатки TopupSheet.save, bookingSheets.performCancel,
отправки закрытия смены.

    python3 backend/tests/guard_wave4_madmin.py
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
ADMIN_M = ROOT / "src/pages/mobile/admin"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _m(name: str) -> str:
    return (ADMIN_M / name).read_text(encoding="utf-8")


def _strip_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), s, flags=re.S)
    return re.sub(r"(?<![:'\"`])//[^\n]*", "", s)


def _block(src: str, start: str) -> str:
    """Тело от `start` до парной закрывающей скобки первой «{» после него."""
    i = src.find(start)
    assert i != -1, f"не нашёл {start!r}"
    j = src.find("{", i)
    depth = 0
    for k in range(j, len(src)):
        if src[k] == "{":
            depth += 1
        elif src[k] == "}":
            depth -= 1
            if depth == 0:
                return src[i:k + 1]
    raise AssertionError(f"не закрыт блок {start!r}")


def _fp(code: str) -> str:
    norm = re.sub(r"\s+", " ", _strip_comments(code)).strip()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]


def _mobile_admin_routes(app: str) -> str:
    i = app.find('<Route path="/m/admin"')
    assert i != -1, "нет блока маршрутов /m/admin"
    j = app.find("</Route>", i)
    return app[i:j]


# ─────────────────────────────────────────────────────────────────────────
# Отпечатки денежного кода — менять только осознанно, с денежным ревью.
# ─────────────────────────────────────────────────────────────────────────

# Сняты с кода ДО волны 4 (4ae3f09): TopupSheet.save == прежний submit из
# MobileAdminUsers.tsx (только имя функции), performCancel и handleSubmit — как были.
TOPUP_SAVE_FP = "a09bd23bbb62316e"
PERFORM_CANCEL_FP = "4eedaafde0cd9b02"
END_SHIFT_SUBMIT_FP = "5978bf9faa11448e"


def test_money_fingerprints():
    topup = _m("TopupSheet.tsx")
    save = _block(topup, "const save = async")
    for field in ("type: 'income'", "category_id: 'cat-topup'", "credit_user_balance: true",
                  "payment_method: method", "branch,", "client_id: user.id || user.email",
                  "cashboxApi.createTransaction("):
        assert field in save, f"TopupSheet.save: поле оплаты изменено — {field}"
    sheets = _m("bookingSheets.tsx")
    cancel = _block(sheets, "const performCancel = async")
    shift = _block(_m("MobileCloseShiftSheet.tsx"), "const handleSubmit = async")
    got = (_fp(save), _fp(cancel), _fp(shift))
    want = (TOPUP_SAVE_FP, PERFORM_CANCEL_FP, END_SHIFT_SUBMIT_FP)
    assert got == want, (
        "денежный код пакета A изменился (TopupSheet.save, performCancel, отправка смены): "
        f"{got} != {want}. Если правка осознанная — денежное ревью и новый отпечаток."
    )
    assert "refundPercent: refundPercent / 100" in cancel
    assert "needsFullData(b)) return;" in sheets


# ─────────────────────────────────────────────────────────────────────────
# Карточка клиента
# ─────────────────────────────────────────────────────────────────────────

def test_user_card_is_native_and_balance_first():
    routes = _mobile_admin_routes(_read("src/App.tsx"))
    m = re.search(r'<Route path="users/:email" element=\{<(\w+) />\}', routes)
    assert m and m.group(1) == "MobileAdminUserCard", \
        "/m/admin/users/:email снова открывает не нативную карточку"
    assert "AdminUserDetails" not in routes, "в мобильной админке снова десктопная карточка клиента"
    card = _strip_comments(_m("MobileAdminUserCard.tsx"))
    bal = card.find('aria-label="Баланс"')
    danger = card.find('aria-label="Удобнее на компьютере"')
    assert bal != -1 and danger != -1 and bal < danger, "баланс не выше «Удобнее на компьютере»"
    assert bal < card.find("Ближайшие брони") and bal < card.find("Движения баланса")
    assert "phoneHref(" in card, "телефон не звонит по нажатию"
    assert "<TopupSheet" in card and "Новая бронь" in card
    assert "REASON_LABELS" in card, "движения баланса не теми же словами, что на компьютере"
    for bad in ("resetPassword", "mergeUsers", "archiveUser"):
        assert bad not in card, f"опасное действие {bad} на телефоне — только на компьютере"


def test_access_rights_wrapped():
    routes = _mobile_admin_routes(_read("src/App.tsx"))
    assert "<AdminAccessRights />" not in routes, "десктопные права доступа без обёртки с полями"
    assert "MobileAdminAccessRights" in routes
    wrap = _m("MobileAdminAccessRights.tsx")
    assert "padding: '0 16px" in wrap and "MobilePageHeader" in wrap


# ─────────────────────────────────────────────────────────────────────────
# «Сегодня»
# ─────────────────────────────────────────────────────────────────────────

def test_today_feed_via_admin_today():
    dash = _strip_comments(_m("MobileAdminDashboard.tsx"))
    pay = _strip_comments(_m("adminPayment.ts"))
    assert "todayRows(" in dash and "todaySummary(" in dash and "byClient(" in dash
    assert "useAdminDueMap(" in dash and "computeDueByBooking(" in pay, \
        "«к оплате» не из computeDueByBooking"
    assert "fetchAllBookings()" in dash
    assert not re.search(r"b\.status === 'confirmed' &&", dash), \
        "снова фильтр «только confirmed» — закончившиеся брони пропадают (N3)"
    assert "api.get(" not in dash and "getAllBookings" not in dash, "новый запрос к броням в «Сегодня»"
    assert "<DueBadge" in dash and "Взять сегодня" in dash
    for seg in ("'all'", "'due'", "'tomorrow'"):
        assert f"value: {seg}" in dash, f"нет сегмента {seg}"
    assert "function Stat(" not in dash, "вернулись плитки Stat"
    assert "paddingBottom: 96" in dash, "FAB снова закрывает конец списка"


def test_accept_payment_defaults_to_full_debt():
    pay = _strip_comments(_m("adminPayment.ts"))
    assert "mine.total" in pay, "«Принять оплату» не по всему долгу (В3)"
    dash = _strip_comments(_m("MobileAdminDashboard.tsx"))
    assert "defaultAmount={pay.total}" in dash and "todayAmount={pay.today}" in dash
    assert "acceptPayment=" in dash and "acceptPayment=" in _m("MobileAdminBookings.tsx")
    sheet = _strip_comments(_m("TopupSheet.tsx"))
    assert "Из них за сегодня" in sheet


# ─────────────────────────────────────────────────────────────────────────
# Касса и смена
# ─────────────────────────────────────────────────────────────────────────

def test_cashbox_order_and_close_shift_always():
    fin = _strip_comments(_m("MobileAdminFinance.tsx"))
    now = fin.find('aria-label="Сейчас в кассе"')
    per = fin.find('aria-label="Период"')
    assert now != -1 and per != -1 and now < per, "«Сейчас в кассе» не выше периода"
    assert not re.search(r"\{branch !== 'all' && \(\s*<Button", fin), \
        "«Закрыть смену» снова видна только при выбранном филиале"
    assert "setPickShiftBranch(true)" in fin, "при «Все» не спрашиваем филиал"
    assert "getPeriodSummary(" in fin
    assert "currentUser?.role === 'owner'" in fin, "права на правку операций (canEditTx) изменены"
    assert "'Unbox One');" not in fin, "в новой операции снова навязан филиал Unbox One"


def test_own_operation_summary_and_undo():
    fin = _strip_comments(_m("MobileAdminFinance.tsx"))
    assert "`Записать ${type === 'income' ? 'доход' : 'расход'}" in fin, "нет сводки на кнопке (В5)"
    body = _block(fin, "const createWithUndo = async")
    assert "undoToast(" in body and "cashboxApi.deleteTransaction(id)" in body, \
        "нет «Вернуть» после записи своей операции"


def test_close_shift_blind_count():
    src = _strip_comments(_m("MobileCloseShiftSheet.tsx"))
    inp = src.find("<Input")
    exp = src.find("По системе должно быть")
    assert inp != -1 and exp > inp, "ожидаемая сумма снова выше поля факта (В4)"
    guard = src.rfind("{hasAmount && (", 0, exp)
    assert guard != -1 and guard > inp, "ожидаемая сумма видна до ввода факта (В4)"


# ─────────────────────────────────────────────────────────────────────────
# Кабинеты, подтверждения
# ─────────────────────────────────────────────────────────────────────────

def test_close_cabinet_via_maintenance_api():
    cab = _strip_comments(_m("MobileAdminCabinets.tsx"))
    assert "maintenanceApi.create(" in cab and "isMaintenanceConflict(e)" in cab
    assert "<MaintenanceConflictSheet" in cab
    assert "api.post('/maintenance-blocks" not in cab
    assert "response?.data?.detail" not in cab, "detail снова уходит в тост (объект на 409 ронял React)"


def _confirm_only_when_off(body: str, cond: str, name: str):
    i = body.find(cond)
    c = body.find("confirm(")
    assert i != -1, f"{name}: нет проверки «{cond}»"
    assert c != -1 and c > i, f"{name}: нет подтверждения при выключении/скрытии"
    assert body.count("confirm(") == 1, f"{name}: лишнее подтверждение (при включении не спрашиваем)"


def test_confirm_on_disable_not_enable():
    cab = _strip_comments(_m("MobileAdminCabinets.tsx"))
    _confirm_only_when_off(_block(cab, "const toggleActive = async"), "if (!next)", "кабинет")
    _confirm_only_when_off(_block(cab, "const handleToggleLocation = async"), "if (!next)", "локация")
    team = _strip_comments(_m("MobileAdminTeam.tsx"))
    _confirm_only_when_off(_block(team, "const handleToggle = async"), "if (m.isActive)", "команда")
    spec = _strip_comments(_m("MobileAdminSpecialists.tsx"))
    _confirm_only_when_off(_block(spec, "const handleVerify = async"), "if (!next || approving)", "специалист")


# ─────────────────────────────────────────────────────────────────────────
# Оболочка
# ─────────────────────────────────────────────────────────────────────────

def test_shell_switcher_links_and_badge():
    lay = _strip_comments(_m("MobileAdminLayout.tsx"))
    assert "Админка" in lay and "ChevronDown" in lay, "нет переключателя «Админка ▾»"
    assert "'/m/admin/crm'" in lay and "'/m/admin/access-rights'" in lay
    assert "badge={requests" in lay, "нет счётчика на вкладке «Заявки»"
    assert "window.scrollTo(0, saved ?? 0)" in lay, "нет сброса прокрутки при смене экрана"
    # Проверка ролей в оболочке — как была.
    assert ("currentUser.role === 'owner'\n        || currentUser.role === 'senior_admin'\n"
            "        || currentUser.role === 'admin'\n        || currentUser.isAdmin") in lay
    dash = _m("MobileAdminDashboard.tsx")
    assert 'to="/m/admin/crm"' in dash, "с «Сегодня» не попасть в CRM клиентов"
    inbox = _m("MobileAdminInbox.tsx")
    assert "Специалисты на проверке" in inbox


def test_older_guards_rewritten_on_sheet_footer():
    c = _read("backend/tests/guard_wave0_c.py")
    assert '("TopupSheet.tsx", "Пополнить на")' in c and 'src.find("footer={")' in c, \
        "guard_wave0_c снова ищет самодельные шторки на SHEET_FOOTER"
    s = _read("backend/tests/guard_wave1_mstaff.py")
    assert '"TopupSheet.tsx", "MobileAdminFinance.tsx", "MobileAdminCabinets.tsx"' in s
    for name in ("TopupSheet.tsx", "MobileAdminFinance.tsx", "MobileAdminCabinets.tsx", "MobileAdminUsers.tsx"):
        assert "SHEET_FOOTER" not in _m(name), f"{name}: самодельная шторка вернулась"


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
    print("СТОРОЖ wave4-madmin: OK" if not failures else f"СТОРОЖ wave4-madmin УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
