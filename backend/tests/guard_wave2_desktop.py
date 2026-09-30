"""СТОРОЖ wave2 — пакет D: компьютерный мастер брони и кабинет клиента.

Только чтение исходников, без сети и базы. Ловит возврат того, что починили:
  - «стекло» (backdrop-blur/backdropFilter, белые полупрозрачные фоны,
    rounded-2xl, unbox-*) в мастере, «Моих бронях», «Обзоре», профиле;
  - ячейки шахматки мастера снова недоступны с клавиатуры (G3-10, X4-10);
  - прошедшее время снова выглядит «занятым» и открывает «следить» (G3-09);
  - «Назад»/шаг 1 мастера снова уводят на главную (G3-11, X2-15);
  - экран успеха снова «подтверждено» для брони на одобрении (G3-02);
  - бронь «Ждём подтверждения» снова не в «Предстоящих», отменённые будущие —
    снова в «Прошедших» (G3-02, G3-client-desktop-M3);
  - «Депозит/Кредит» вместо «С баланса / Бонус / Абонемент» (G3-14, X3-05);
  - разные правила 24 ч на компьютере и телефоне (X3-21);
  - «Обзор» снова с полосой цифр и пустыми «Последними платежами» (G3-06, G3-08);
  - «Скидки и бонусы» снова обещают недельную скидку и «60 дней» (решение владельца);
  - абонемент: заморозка снова мимо Telegram / счётчик пауз наоборот;
  - переключатель CRM снова шлёт заявку без подтверждения (G3-21);
  - меню кабинета снова с номерами 01–07 (G3-20);
  - системные окна, шрифт < 12 px, «ты».

    python3 backend/tests/guard_wave2_desktop.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent

D_FILES = [
    "src/components/Wizard/BookingWizard.tsx",
    "src/components/Wizard/ChessboardStep.tsx",
    "src/components/Wizard/ConfirmationStep.tsx",
    "src/components/Summary.tsx",
    "src/components/MinimalLayout.tsx",
    "src/components/DashboardLayout.tsx",
    "src/components/CrmAccessToggle.tsx",
    "src/components/SubscriptionCard.tsx",
    "src/components/Dashboard/DiscountProgress.tsx",
    "src/pages/DashboardOverview.tsx",
    "src/pages/MyBookingsPage.tsx",
    "src/pages/ProfilePage.tsx",
    "src/pages/BonusesInfoPage.tsx",
]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"\{/\*.*?\*/\}", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    src = re.sub(r"(?m)(^|[^:'\"`\\])//.*$", r"\1", src)
    return src


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


# ── 1. Grid House: без «стекла» ──────────────────────────────────────────

def test_no_glass_in_desktop_client_files():
    bad = []
    for rel in D_FILES:
        code = _code(rel)
        if rel.endswith("ConfirmationStep.tsx"):
            # Всплывающий тост «Недостаточно средств» живёт внутри handleConfirm
            # (его пакет D не трогает) — всплывающему скругление можно.
            code = re.sub(r"toast\.custom\(.*?\{ duration: Infinity \}\)", "", code, flags=re.S)
        for pat, what in (
            (r"backdrop-blur|backdropFilter|WebkitBackdropFilter", "размытие (стекло)"),
            (r"rgba\(\s*255\s*,\s*255\s*,\s*255", "белый полупрозрачный фон"),
            (r"\bbg-white/\d+", "белый полупрозрачный фон"),
            (r"\brounded-2xl\b", "rounded-2xl"),
            (r"\bunbox-(?:green|dark|light|grey)\b", "старые цвета unbox-*"),
        ):
            if re.search(pat, code):
                bad.append(f"{rel}: {what}")
    assert not bad, "вернулось «стекло» / старые цвета: " + "; ".join(bad)


def test_desktop_cards_are_square():
    """Карточки на компьютере — радиус 0 (Grid House)."""
    wiz = _code("src/components/Wizard/BookingWizard.tsx")
    assert "borderRadius: 0" in wiz, "карточки мастера снова скруглены"
    chess = _code("src/components/Wizard/ChessboardStep.tsx")
    raw = _read("src/components/Wizard/ChessboardStep.tsx")
    desktop = raw[raw.index("── DESKTOP VIEW"):]  # узкий экран (<768) — радиусы телефона, это можно
    assert "borderRadius: 12" not in desktop, "сетка/полоса дней мастера снова скруглены 12 px"


# ── 2. Шахматка мастера с клавиатуры, прошлое ≠ занятое ─────────────────

def test_wizard_cells_keyboard_accessible():
    src = _code("src/components/Wizard/ChessboardStep.tsx")
    assert 'role="button"' in src, "ячейка сетки снова просто div без роли"
    assert "tabIndex={cellKey === tabStopKey ? 0 : -1}" in src, "нет roving tabindex у ячеек"
    assert "onKeyDown={(e) => handleCellKeyDown(e, r.id, time)}" in src, "ячейка не слушает клавиатуру"
    body = src[src.index("const handleCellKeyDown"):]
    body = body[:body.index("const getPrice")]
    for key in ("'ArrowRight'", "'ArrowLeft'", "'ArrowDown'", "'ArrowUp'", "'Enter'", "' '"):
        assert key in body, f"клавиша {key} не обрабатывается"
    act = src[src.index("const activateCell"):src.index("const focusCell")]
    # С клавиатуры — тот же путь, что мышью (выбор не дублируется).
    assert "handlePointerDown(resId, timeStr, 'new')" in act and "handlePointerUp()" in act
    # Мышь и перетаскивание на месте.
    assert "handlePointerDown(r.id, time, 'move')" in src and "onPointerEnter={() => handlePointerEnter(r.id, time)}" in src


def test_wizard_past_is_not_busy():
    src = _code("src/components/Wizard/ChessboardStep.tsx")
    assert "const isSlotClosed" in src, "нет различия «прошло» / «занято»"
    assert "if (closed) return;" in src, "прошедшее время снова открывает окно «следить»"
    assert "'Прошло'" in src and "Занято — можно следить" in src, "нет легенды сетки"
    assert "PRICING_CONFIG.peak_hours.surcharge_per_hour_gel" in src, "пиковые часы не подписаны доплатой"
    # isSlotBlocked (правила брони) не трогаем: буфер 30 мин и исключение для админа на месте.
    blocked = src[src.index("const isSlotBlocked"):src.index("const getSlotBookerInfo")]
    assert "const bufferMinutes = isPrivileged ? 0 : 30;" in blocked


# ── 3. Навигация мастера ─────────────────────────────────────────────────

def test_wizard_back_never_goes_home():
    chess = _code("src/components/Wizard/ChessboardStep.tsx")
    assert "setStep(1)" not in chess, "«Назад» с сетки снова = шаг 1 = главная"
    wiz = _code("src/components/Wizard/BookingWizard.tsx")
    assert '<Navigate to="/" replace />' not in wiz, "шаг 1 мастера снова редирект на главную"
    assert "onBack={handleBack}" in wiz and "setStep(2)" in wiz, "«Назад» в шапке с оплаты не ведёт к сетке"
    conf = _code("src/components/Wizard/ConfirmationStep.tsx")
    assert "← Назад" not in conf, "вторая «Назад» у кнопки оплаты вернулась"
    assert "navigate(-1)" not in conf, "«Выбрать другое время» снова history.back"
    summ = _code("src/components/Summary.tsx")
    assert "handleBack" not in summ, "третья «Назад» в корзине вернулась"


def test_success_screen_knows_pending_approval():
    src = _code("src/components/Wizard/ConfirmationStep.tsx")
    assert "Ждём подтверждения администратора" in src, "нет экрана «Ждём подтверждения» для брони на одобрении"
    i = src.index("const createdPending")
    block = src[i:i + 600]
    assert "cartDetails.some(" in block, "«на одобрении» снова считается по всем броням клиента, а не по этой корзине"
    assert "'Бронирование подтверждено!'" not in src


def test_confirmation_money_logic_untouched_markers():
    """Вёрстку меняли, логику — нет: ключевые строки на месте."""
    src = _read("src/components/Wizard/ConfirmationStep.tsx")
    for needle in ("const finalMethod: PayMethod = resolveFinalMethod(", "paymentMethod: finalMethod",
                   "plan.auto", "netPrice = rescheduleDiff;", "bookingsApi.createRecurringBooking(",
                   "bookingsApi.rescheduleBooking(", "submittingRef.current = true;"):
        assert needle in src, f"ConfirmationStep: пропало {needle!r}"


# ── 4. «Мои брони» ───────────────────────────────────────────────────────

def test_my_bookings_upcoming_includes_pending_and_splits_cancelled():
    src = _code("src/pages/MyBookingsPage.tsx")
    up = src[src.index("const upcomingBookings"):src.index("const cancelledUpcoming")]
    assert "'pending_approval'" in up, "бронь «Ждём подтверждения» снова не в «Предстоящих»"
    past = src[src.index("const pastBookings"):]
    past = past[:past.index(";")]
    assert "startMs(b) < nowMs" in past, "отменённые будущие снова в «Прошедших»"
    assert "Отменённые" in src
    assert "viewMode === 'list' && canBook &&" in src


def test_my_bookings_payment_words():
    for rel in ("src/pages/MyBookingsPage.tsx", "src/components/Summary.tsx",
                "src/components/Wizard/ConfirmationStep.tsx"):
        code = _code(rel)
        assert "Депозит" not in code, f"{rel}: снова «Депозит»"
    my = _code("src/pages/MyBookingsPage.tsx")
    assert "'С баланса'" in my and "'Бонус'" in my and "'Абонемент'" in my, "нет подписей способа оплаты"
    assert "Кредит</" not in my and "'Кредит'" not in my, "«Кредит» снова значит «в долг»"


def test_rule_24h_single_wording():
    src = _code("src/pages/MyBookingsPage.tsx")
    assert "отменить уже нельзя" in src, "правило 24 ч снова своими словами (X3-21)"
    assert "Менее 24ч" not in src


def test_my_bookings_no_promo_strip_and_sheet_confirm():
    src = _code("src/pages/MyBookingsPage.tsx")
    assert "Оформить абонемент" not in src, "полоса промо-кнопок вернулась над бронями (G3-13)"
    assert "<Sheet" in src and "Оставить бронь" in src, "подтверждение отмены снова самодельным окном"
    assert "MOИ БРОНИРОВАНИЯ" not in src and "UNBOX · 2026" not in src


# ── 5. Обзор ─────────────────────────────────────────────────────────────

def test_overview_next_booking_card_no_payments():
    src = _code("src/pages/DashboardOverview.tsx")
    assert "Ближайшая бронь" in src, "нет карточки ближайшей брони"
    assert "ПОСЛЕДНИЕ ПЛАТЕЖИ" not in src and "Последние платежи" not in src and "getTransactionsByUser" not in src, \
        "вернулся всегда пустой блок платежей (G3-08)"
    assert "СКИДКА" not in src and "discountPercent" not in src, "вернулась плашка «Скидка 0 %»"
    assert "'pending_approval'" in src, "бронь на одобрении не попадает в ближайшие"
    assert "<Link" in src and "Маршрут" in src and "Детали" in src


# ── 6. Скидки и бонусы, абонемент ────────────────────────────────────────

def test_bonuses_page_only_working_offers():
    src = _code("src/pages/BonusesInfoPage.tsx")
    assert "weekly_progressive" not in src and "по неделе" not in src.lower(), "недельная скидка снова на странице"
    assert not re.search(r"60(?:\s|&nbsp;)*дн", src), "«60 дней» снова на странице"
    assert "Приведите" not in src
    assert "PRICING_CONFIG.discounts.duration" in src and "15&nbsp;дней" in src


def test_subscription_freeze_via_telegram():
    src = _code("src/components/SubscriptionCard.tsx")
    assert "toggle-freeze" not in src, "карточка снова зовёт /subscriptions/toggle-freeze"
    assert "https://t.me/UnboxCenter" in src and "?text=" in src and "Попросить заморозку" in src
    # 01.10 (владелец): заморозка по тарифу — бюджет дней (freezeDaysLeft), а не
    # «1 пауза на 7 дней». Суть та же: показываем, сколько ОСТАЛОСЬ.
    assert "const freeze = freezeBudget(sub);" in src and "осталось ${fmtFreezeDays(freeze.left)}" in src, \
        "счётчик пауз снова не от оставшихся дней по тарифу"
    assert "viewerIsAdmin ?" in src


def test_crm_request_needs_confirmation():
    src = _code("src/components/CrmAccessToggle.tsx")
    body = src[src.index("const handleToggle"):]
    i_conf = body.find("await confirm(")
    i_apply = body.find("crmApi.applyForAccess()")
    assert i_conf != -1 and i_apply != -1 and i_conf < i_apply, "заявка на CRM снова уходит без подтверждения"
    assert 'role="switch"' not in src, "вернулся безобидный на вид переключатель"


def test_dashboard_menu_without_numbers():
    src = _code("src/components/DashboardLayout.tsx")
    assert "padStart(2, '0')" not in src, "в меню кабинета снова номера 01–07"
    assert "external: true" in src and "На сайте" in src, "уход на публичный сайт снова без пометки"
    assert "/dashboard/bookings?view=grid" in src


# ── 7. Общие правила ─────────────────────────────────────────────────────

_TY = re.compile(r"(?i)(?<![а-яё])(?:ты|тебе|тебя|тобой|твой|твоя|твоё|твои|твоих|твоим|твоей|твою)(?![а-яё])")


def test_rules_in_d_files():
    bad = []
    for rel in D_FILES:
        code = _code(rel)
        for m in re.finditer(r"fontSize:\s*['\"]?(\d+(?:\.\d+)?)", code):
            if float(m.group(1)) < 12:
                bad.append(f"{rel}: fontSize {m.group(1)}")
        if re.search(r"text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]", code):
            bad.append(f"{rel}: text-[<12px]")
        # Системное окно — confirm('текст') / window.confirm(…); общий
        # useConfirmDialog().confirm({ … }) — можно.
        if re.search(r"(?<![\w$.])(?:confirm|prompt|alert)\s*\(\s*['\"`]|window\.(?:confirm|prompt|alert)\s*\(", code):
            bad.append(f"{rel}: системное окно")
        if _TY.search(code):
            bad.append(f"{rel}: «ты»")
        if re.search(r"\btext-gray-(?:300|400|500)\b", code):
            bad.append(f"{rel}: бледный серый текст")
    assert not bad, "; ".join(bad)


_REPO_ROOT_FOR_VIEW = str(pathlib.Path(__file__).resolve().parents[2])

def test_view_grid_reacts_to_navigation_on_same_page():
    """Ревью 30.09: «Забронировать кабинет» (?view=grid) с уже открытых «Моих
    броней» ничего не делал — viewMode читался только при первом рендере."""
    src = (pathlib.Path(_REPO_ROOT_FOR_VIEW) / "src/pages/MyBookingsPage.tsx").read_text(encoding="utf-8")
    i = src.index("}, [location.key]);")
    block = src[max(0, i - 400):i]
    assert "get('view')" in block and "setViewMode(v)" in block, \
        "MyBookingsPage: ?view=grid снова читается только при первом рендере"

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
    print("СТОРОЖ wave2-desktop: OK" if not failures else f"СТОРОЖ wave2-desktop УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
