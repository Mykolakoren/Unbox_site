"""СТОРОЖ wave2 — пакет A «Мобильное приложение клиента» (волна 2, 30.09).

Чтение исходников, без сети и базы.

Что ловит:
  Деньги     — в /m/checkout расчёт, выбор способа оплаты, проверка баланса,
               тело брони и запросы брони/серии — байт-в-байт как до волны 2.
  Экран      — после брони экран подтверждения: «Ждём подтверждения
               администратора» (статус из ответа сервера) или «Бронь ваша».
  G3-02      — бронь на одобрении видна в «Сегодня» и «Моих бронях» с бейджем.
  X3-21      — клиенту меньше чем за сутки: только «Пересдать» и «Написать
               администратору»; админы — те же роли, что ADMIN_ROLES на сервере.
  X2-ia-M3   — вход в CRM по правилу сервера require_specialist.
  X5-04      — ошибки через toastApiError, без e.message.
  G4-07      — «Сегодня» V1: карточка встречи, одна кнопка брони, «Дальше».
  X2-02/X2-10/X5-08/G4-06/X2-ia-M2/G4-11 — навигация, гость, прокрутка, «Я», тур.
  Владелец   — заморозка и «Оформить абонемент» только через Telegram.
  G3-19      — «Слежу за слотами»: удаление с «Вернуть».

    python3 backend/tests/guard_wave2_mclient.py
"""
import pathlib
import re
import sys

# Эталон денежных блоков MobileCheckout.tsx (как в main до волны 2).
MONEY_SNIPPETS = {
    'PLAN': '    const plan = useMemo(\n        () => paymentPlan({ hours: totalDurationHours, bonusHours: totalBonusHours, sub: subHours, isSeries, moneyPrice: priced.total }),\n        [totalDurationHours, totalBonusHours, subHours, isSeries, priced.total],\n    );\n',
    'USERPICK': "    const userPickedPay = useRef(false);\n    useEffect(() => {\n        const cur: PayMethod = state.paymentMethod ?? 'balance';\n        const want: PayMethod = isSeries ? 'balance' : plan.auto;\n        if (userPickedPay.current && isSelectable(cur, plan, isSeries)) return;\n        userPickedPay.current = false;\n        if (cur !== want) useBookingStore.setState({ paymentMethod: want });\n    }, [plan, isSeries, state.paymentMethod]);\n    const pickPay = (m: PayMethod) => {\n        if (!isSelectable(m, plan, isSeries)) return;\n        userPickedPay.current = true;\n        useBookingStore.setState({ paymentMethod: m });\n    };\n",
    'RESOLVE': '    const resolveFinalMethod = (): PayMethod => resolvePayMethod(state.paymentMethod, plan, isSeries);\n',
    'SUBMIT_MONEY': "        const finalMethod = resolveFinalMethod();\n\n        // Recurring series path: one API call creates N bookings,\n        // all sharing the same `recurring_group_id`.\n        if (recurPattern !== 'once' && firstSlot) {\n            await createSeries(false);\n            return;\n        }\n\n        // Balance check: bail with toast if the user can't afford it within\n        // their credit limit. Только когда платим деньгами: бонусы и абонемент\n        // сервер спишет часами — раньше владелец абонемента с малым балансом\n        // получал «Не хватает 45 ₾», хотя деньги бы не понадобились (G4-01).\n        // We check the *effective* user (target if admin-proxy, else current user).\n        if (finalMethod === 'balance' && priced.total > 0 && effectiveUser?.email === currentUser.email) {\n            // Skip the projected-balance gate when admin is booking for someone\n            // else — let the backend enforce against the target's wallet.\n            const projected = (effectiveUser.balance ?? 0) - priced.total;\n            const limit = effectiveUser.creditLimit ?? 0;\n            if (projected < -limit) {\n                const shortfall = Math.abs(projected + limit);\n                const shortfallGel = formatGel(shortfall, { fraction: 0 });\n                toast.error(`Не хватает ${shortfallGel}. Пополните баланс или попросите администратора поднять кредитный лимит.`, { duration: 6000 });\n                return;\n            }\n        }\n\n        let paymentSource: 'subscription' | 'deposit' | 'credit' = 'deposit';\n        if (finalMethod === 'subscription') paymentSource = 'subscription';\n        else if (finalMethod === 'bonus') paymentSource = 'deposit';\n        else if ((effectiveUser?.balance ?? 0) < priced.total) paymentSource = 'credit';\n\n        const newBookings = priced.items.map(item => ({\n            id: Math.random().toString(36).slice(2, 11),\n            step: 4,\n            locationId: state.locationId || resource?.locationId || 'unbox_one',\n            resourceId: item.resourceId,\n            format: state.format,\n            date: fmtDate(state.date, 'yyyy-MM-dd'),\n            startTime: item.startTime,\n            duration: item.duration,\n            extras: state.extras,\n            status: 'confirmed' as const,\n            createdAt: new Date().toISOString(),\n            finalPrice: item.price.finalPrice,\n            selectedSlots: [],\n            price: item.price,\n            paymentMethod: finalMethod,\n            paymentSource,\n            hoursDeducted: finalMethod === 'subscription' ? (item.duration / 60) : 0,\n            ...(selectedCrmClientId ? { crmClientId: selectedCrmClientId } : {}),\n            // Admin-proxy: when bookingForUser is set, the booking is owned by\n            // that target — backend resolves via target_user_id.\n            ...(state.bookingForUser ? { targetUserId: state.bookingForUser } : {}),\n        }));\n",
    'SERIES_CALL': "            const result = await bookingsApi.createRecurringBooking({\n                resourceId: firstSlot.resourceId,\n                locationId: state.locationId || resource?.locationId || 'unbox_one',\n                startTime: firstSlot.startTime,\n                duration: firstSlot.duration,\n                format: state.format,\n                paymentMethod: resolveFinalMethod(),\n                firstDate: fmtDate(state.date, 'yyyy-MM-dd'),\n                occurrences: effectiveOccurrences,\n                pattern: recurPattern === 'once' ? 'weekly' : recurPattern,\n                targetUserId: state.bookingForUser || undefined,\n                crmClientId: selectedCrmClientId || undefined,\n                skipConflicts: skipConflicts || undefined,\n            });\n",
    'SINGLE_CALL': '                const created = await bookingsApi.createBooking(newBookings[0] as any);\n                await Promise.all([fetchCurrentUser(), fetchBookings()]);\n                useBookingStore.getState().reset();\n                setConfirmed(true);\n',
    'PRICED': '    const priced = useMemo(() => {\n        if (cartItems.length === 0) return { items: [], total: 0 };\n        const selectedExtras = EXTRAS.filter(e => state.extras.includes(e.id));\n        let total = 0;\n        const items = cartItems.map(b => {\n            const start = new Date(state.date);\n            const [h, m] = b.startTime.split(\':\').map(Number);\n            start.setHours(h, m, 0, 0);\n            const end = new Date(start.getTime() + b.duration * 60000);\n            const p = calculatePrice({\n                format: state.format,\n                startTime: start,\n                endTime: end,\n                extras: selectedExtras,\n                paymentMethod: state.paymentMethod,\n                resourceId: b.resourceId,\n                accumulatedWeeklyHours,\n                personalDiscountPercent: effectiveUser?.personalDiscountPercent,\n                pricingSystem: effectiveUser?.pricingSystem,\n            });\n            total += p.finalPrice;\n            return { ...b, start, end, price: p };\n        });\n        return { items, total };\n    }, [\n        cartItems, state.extras, state.format, state.date, state.paymentMethod,\n        accumulatedWeeklyHours,\n        // Admin-proxy fix: the price depends on the BOOKING TARGET\'s\n        // personal discount, not the logged-in admin\'s. Re-key the memo\n        // on effectiveUser so switching "за кого бронируешь" recomputes.\n        effectiveUser?.id,\n        effectiveUser?.personalDiscountPercent,\n        effectiveUser?.pricingSystem,\n    ]);\n',
    'HOT': '    const isHotBooking = useMemo(() => {\n        const first = priced.items[0];\n        if (!first) return false;\n        const hoursUntil = (first.start.getTime() - Date.now()) / 3600000;\n        const dow = first.start.getDay(); // 0=Sun, 6=Sat (local browser TZ)\n        const isWeekend = dow === 0 || dow === 6;\n        const threshold = isWeekend ? 24 : 12;\n        return hoursUntil >= 0 && hoursUntil < threshold;\n    }, [priced.items]);\n',
}


ROOT = pathlib.Path(__file__).parent.parent.parent
MOBILE = ROOT / "src" / "pages" / "mobile"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(rel: str) -> str:
    """Исходник без комментариев — ловим код и тексты интерфейса."""
    src = _read(rel)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:\\])//[^\n]*", r"\1", src)


# ─────────────────────────────────────────────────────────────────────────
# Деньги: в оформлении брони расчёт и запросы — байт-в-байт (НЕЛЬЗЯ пакета A)
# ─────────────────────────────────────────────────────────────────────────

def test_checkout_money_core_untouched():
    """paymentPlan, userPickedPay/pickPay, resolveFinalMethod, проверка баланса,
    тело брони (payload), запросы брони и серии — ровно как до волны 2.
    Меняется только вёрстка и тексты. Если правка денег законная — сначала
    решение владельца и ревью денег, потом обновите эталон здесь."""
    src = _read("src/pages/mobile/MobileCheckout.tsx")
    for name, snippet in MONEY_SNIPPETS.items():
        assert snippet in src, f"MobileCheckout: изменён денежный блок {name} — его трогать нельзя"
    assert src.count("paymentPlan({ hours: totalDurationHours") == 1
    # submit(): после успеха — экран подтверждения, а не тост + переход.
    body = src[src.index("const submit = async () => {"):src.index("    // Снимок брони для экрана подтверждения")]
    assert "setDone({ pending: (created as any).status === 'pending_approval' })" in body, \
        "экран подтверждения должен брать статус из ответа сервера на эту бронь"
    assert "toast.success('Бронь создана'" not in body and "navigate('/m/bookings', { replace: true })" not in body, \
        "после брони снова тост и уход в «Мои брони» вместо экрана подтверждения"


def test_approval_promised_only_by_server():
    """Денежное ревью 30.09 (B1): мультислот (POST /bookings/multi-slot) сервер
    на одобрение не отправляет, админов (ADMIN_ROLES) — тоже. «Ждём
    подтверждения» — только по ответу сервера на одиночную бронь; обещание
    «уйдёт на одобрение» — только для одиночной горячей брони не-админа."""
    src = _code("src/pages/mobile/MobileCheckout.tsx")
    assert "setDone({ pending: isHotBooking" not in src, "мультислот снова обещает одобрение по догадке экрана"
    assert src.count("setDone({") == 2 and "setDone({ pending: false })" in src
    assert "const expectApproval = isHotBooking && priced.items.length === 1 && !isBookingAdmin(currentUser);" in src
    render = src[src.index("if (done) {"):]
    assert "isHotBooking ?" not in render and ": isHotBooking" not in render, \
        "тексты «на одобрение» снова по isHotBooking — нужно expectApproval"
    assert "Спишем после одобрения" in src


def test_subscription_pool_denominator():
    """B2: пул абонемента на сервере = totalHours + bonusHours («42 ч из 40»)."""
    src = _code("src/pages/mobile/MobileSubscription.tsx")
    assert "(Number(sub.totalHours) || 0) + (Number(sub.bonusHours) || 0)" in src
    assert "из {fmtHours(poolTotal)}" in src and "из {fmtHours(sub.totalHours)}" not in src
    assert "subscriptionHours(sub," in src, "«Свободно» должно считаться как в оформлении"
    assert "usedHours" in src


def test_checkout_done_screen_texts():
    src = _code("src/pages/mobile/MobileCheckout.tsx")
    for text in ("Ждём подтверждения администратора", "Бронь ваша", ">Мои брони<", ">На главную<"):
        assert text in src, f"экран подтверждения: нет «{text}»"
    i = src.index("if (done) {")
    j = src.index("if (!firstSlot) return null;")
    assert i < j, "экран подтверждения должен рисоваться до выхода «нет слотов» (стор уже сброшен)"


def test_checkout_layout_v1():
    src = _code("src/pages/mobile/MobileCheckout.tsx")
    for text in ('title="Стоимость"', "Чем платите", 'title="Что произойдёт"', "Бесплатная отмена — до",
                 "только «Пересдать»", "в т.ч. пиковые часы", "за сутки до начала", "<MobilePageHeader"):
        assert text in src, f"оформление V1: нет «{text}»"
    # Время показываем один раз — в карточке брони; редактор — в шторке.
    assert 'title="Время брони"' in src and '<Section title="Время">' not in src
    # Анкета — внутри /m.
    assert "navigate(catalogPath(SPECIALIST_APPLICATION_PATH, true))" in src


# ─────────────────────────────────────────────────────────────────────────
# X5-04 — ошибки без английского и без второго тоста
# ─────────────────────────────────────────────────────────────────────────

AREA = [
    "src/pages/mobile/MobileCheckout.tsx", "src/pages/mobile/BookingDetailSheet.tsx",
    "src/pages/mobile/MobileMyBookings.tsx", "src/pages/mobile/MobileProfileEdit.tsx",
    "src/pages/mobile/MobileToday.tsx", "src/pages/mobile/MobileProfile.tsx",
    "src/pages/mobile/MobileSubscription.tsx", "src/pages/MyWaitlistPage.tsx",
]


def test_no_raw_error_message_in_toasts():
    for rel in AREA:
        src = _code(rel)
        assert "e.message" not in src and "e?.message" not in src, f"{rel}: наружу снова сырой e.message"
        assert "?.data?.detail ||" not in src, f"{rel}: detail мимо apiErrorMessage/toastApiError"
    for rel in ("src/pages/mobile/MobileCheckout.tsx", "src/pages/mobile/BookingDetailSheet.tsx", "src/pages/MyWaitlistPage.tsx"):
        assert "toastApiError(" in _read(rel), f"{rel}: ошибки не через toastApiError"


# ─────────────────────────────────────────────────────────────────────────
# G3-02 — бронь на одобрении видна в «Сегодня» и «Моих бронях»
# ─────────────────────────────────────────────────────────────────────────

def test_pending_approval_visible():
    view = _read("src/pages/mobile/bookingView.ts")
    assert "b.status === 'confirmed' || b.status === 'pending_approval'" in view
    for rel in ("src/pages/mobile/MobileToday.tsx", "src/pages/mobile/MobileMyBookings.tsx"):
        src = _code(rel)
        assert "isLiveBooking(" in src, f"{rel}: будущие снова только confirmed — бронь на одобрении пропадёт"
        assert "&& b.status === 'confirmed'\n" not in src
        assert re.search(r'<StatusBadge[^>]*kind="booking" status="pending_approval"', src), \
            f"{rel}: у брони на одобрении нет бейджа из словаря"
    assert "Ждём подтверждения администратора" in view


# ─────────────────────────────────────────────────────────────────────────
# X3-21 / G4-client-mobile-M2 — меньше суток: клиенту только «Пересдать» и связь
# ─────────────────────────────────────────────────────────────────────────

def test_sheet_24h_rule_matches_server():
    access = _read("src/pages/mobile/crmAccess.ts")
    assert "ADMIN_ROLES.includes(" in access
    perms = _read("src/utils/permissions.ts")
    front = set(re.findall(r"'([a-z_]+)'", re.search(r"export const ADMIN_ROLES = \[([^\]]*)\]", perms).group(1)))
    back_src = _read("backend/app/core/permissions.py")
    back = set(re.findall(r'"([a-z_]+)"', re.search(r"ADMIN_ROLES = \{([^}]*)\}", back_src).group(1)))
    assert front == back, f"админы для правила 24 ч разошлись с сервером: {front} vs {back}"

    src = _code("src/pages/mobile/BookingDetailSheet.tsx")
    assert "const lateForClient = within24h && !isAdmin;" in src
    assert "const isAdmin = isBookingAdmin(currentUser);" in src
    # Ветка «меньше суток, клиент»: нет «Отменить»/«Перенести», есть «Пересдать» и связь.
    i = src.index("isLive && !isActive && lateForClient && (")
    j = src.index("isLive && !isActive && !lateForClient && (")
    late = src[i:j]
    assert "Пересдать" in late and "Написать администратору" in late
    for bad in ('label="Отменить бронь"', 'label="Перенести"', 'label="Отменить часть"', "setMode('confirmCancel')"):
        assert bad not in late, f"клиенту меньше чем за сутки снова предлагается {bad}"
    # «Отменить» и «Перенести» — только в ветке !lateForClient.
    assert src.count('label="Отменить бронь"') == 1 and src.count('label="Перенести"') == 1
    k = src.index('label="Отменить бронь"')
    assert j < k, "«Отменить бронь» вне ветки !lateForClient"
    # Отмена серии с бронью < 24 ч клиенту не показывается (сервер откажет).
    s = src.index('label="Отменить эту и следующие"')
    assert src.rfind("{!lateForClient && (", 0, s) > src.index("Продлить серию"), "отмена серии видна клиенту < 24 ч"
    # Пересдать — только подтверждённую (сервер: status == confirmed).
    assert "const canReRent = isLive && booking.status === 'confirmed';" in src


def test_sheet_on_shared_sheet_and_order():
    src = _code("src/pages/mobile/BookingDetailSheet.tsx")
    assert "<Sheet" in src and "position: 'fixed', inset: 0" not in src, "шторка брони снова самодельная"
    branch = src[src.index("isLive && !isActive && !lateForClient && ("):]
    a, b, c = branch.index('label="Перенести"'), branch.index("'Пересдать'"), branch.index('label="Отменить бронь"')
    assert a < b < c, "порядок действий: Перенести → Пересдать → Отменить"
    assert src.index('label="Отменить бронь"') < src.index('label="Повторить"'), "«Повторить» — ниже основных"
    assert "{showCrm && (" in src and "canUsePsyCrm(currentUser)" in src, "поле CRM-клиента снова видно всем"


def test_crm_entry_matches_server():
    access = _read("src/pages/mobile/crmAccess.ts")
    roles = set(re.findall(r"'([a-z_]+)'", re.search(r"PSY_CRM_ROLES = \[([^\]]*)\]", access).group(1)))
    deps = _read("backend/app/api/deps.py")
    m = re.search(r"def require_specialist\(.*?if current_user\.role in \(([^)]*)\)", deps, re.S)
    assert m, "не нашёл роли в require_specialist"
    back = set(re.findall(r'"([a-z_]+)"', m.group(1)))
    assert roles == back, f"вход в CRM на телефоне разошёлся с сервером: {roles} vs {back}"
    assert "hasPermission(user, 'psy_crm.access')" in access
    layout = _code("src/pages/mobile/crm/MobileCrmLayout.tsx")
    assert "const canUseCrm = canUsePsyCrm(currentUser);" in layout
    assert "|| currentUser.role === 'admin'" not in layout
    for rel in ("src/pages/mobile/MobileToday.tsx", "src/pages/mobile/MobileProfile.tsx"):
        assert "canUsePsyCrm(currentUser)" in _read(rel), f"{rel}: кнопка CRM не по правилу сервера"


# ─────────────────────────────────────────────────────────────────────────
# «Сегодня» V1
# ─────────────────────────────────────────────────────────────────────────

def test_today_v1():
    src = _code("src/pages/mobile/MobileToday.tsx")
    for text in ("NextMeetingCard", "formatRelativeDay(", "formatStartsIn(", "Маршрут", "Детали",
                 ">Дальше<", "Все брони", "paymentLine(", "mapsUrl("):
        assert text in src, f"«Сегодня» V1: нет {text}"
    assert "nextRows = sortedFuture.slice(1, 4)" in src, "«Дальше» — три следующие брони"
    assert "Найти свободный кабинет" not in src and "Z.sticky" not in src, "вернулась закреплённая кнопка"
    assert src.count("Забронировать кабинет") == 1, "главная кнопка брони должна быть одна"


# ─────────────────────────────────────────────────────────────────────────
# Навигация: ссылки бота, гость, прокрутка, «Я» без перезагрузок
# ─────────────────────────────────────────────────────────────────────────

def test_app_redirects():
    app = _read("src/App.tsx")
    assert r"[/^\/dashboard\/profile\/?$/, '/m/me']" in app, "/dashboard/profile на телефоне снова компьютерный"
    assert r"[/^\/crm\/clients\/([^/]+)\/?$/, '/m/crm/clients/$1']" in app
    assert r"[/^\/admin\/users\/([^/]+)\/?$/, '/m/admin/users/$1']" in app
    assert app.index(r"/^\/crm\/clients\/([^/]+)") < app.index(r"[/^\/crm\/[^/]+\/?$/, '/m/crm']")
    assert "}, [currentUser, pathname]);" in app, "переадресация снова только при загрузке пользователя"
    assert '<Route path="profile" element={<MobileProfileEdit />} />' in app


def test_profile_edit_uses_same_patch():
    src = _code("src/pages/mobile/MobileProfileEdit.tsx")
    assert "await updateUser(updates)" in src, "/m/profile должен сохранять через тот же PATCH /users/me"
    assert 'kind="phone"' in src and 'kind="name"' in src


def test_layout_guest_scroll_banner():
    src = _code("src/pages/mobile/MobileLayout.tsx")
    assert "publicTwin(location.pathname)" in src, "гость по ссылке каталога снова на /login"
    assert "[/^\\/m\\/tariffs$/, '/subscriptions']" in src
    assert "window.scrollTo(0, y)" in src and "navType === 'POP'" in src, "нет сброса прокрутки при смене экрана"
    assert "!tourOpen && hasCompletedTour(currentUser.id) && <InstallBanner />" in src


def test_me_menu():
    src = _code("src/pages/mobile/MobileProfile.tsx")
    assert "window.location" not in src, "в «Я» снова переходы с перезагрузкой"
    for path in ("'/m/specialists'", "'/m/places'", "'/m/tariffs'", "'/m/waitlist'", "'/m/profile'",
                 "'/m/subscription'", "'/m/bonuses'", "'/m/booking-rules'"):
        assert f"navigate({path})" in src, f"в «Я» нет перехода {path}"
    for title in ('"Кошелёк"', '"Каталог"', '"Профиль и уведомления"', '"Помощь"'):
        assert f"title={title}" in src
    assert "Как пополнить баланс" in src


def test_tour_by_role_and_no_hardcoded_count():
    src = _code("src/pages/mobile/OnboardingTour.tsx")
    assert "const CLIENT_STEPS: Step[]" in src and "defaultSteps(currentUser?.role)" in src
    assert re.search(r"pill: '\d+ из \d+", src) is None, "номер шага снова зашит в подпись"
    assert "{step + 1} из {total}" in src


def test_notifications_open_inside_app():
    src = _code("src/pages/mobile/NotificationsBell.tsx")
    assert "window.location.href = n.link" not in src and "navigate(n.link)" in src


# ─────────────────────────────────────────────────────────────────────────
# Решения владельца: абонемент через Telegram; «Слежу за слотами» с «Вернуть»
# ─────────────────────────────────────────────────────────────────────────

def test_subscription_freeze_via_telegram():
    src = _code("src/pages/mobile/MobileSubscription.tsx")
    assert "toggle-freeze" not in src and "api.post" not in src, "заморозку снова зовут на сервере"
    assert "https://t.me/${ADMIN_TG}?text=" in src and "UnboxCenter" in src
    assert "Хочу оформить абонемент «${sub.name}»" in src
    assert "Попросить заморозку" in src
    assert "MAX_FREEZES - used" in src, "счётчик заморозок снова показывает использованные как оставшиеся"
    assert "Свободно для брони" in src


def test_waitlist_undo():
    src = _code("src/pages/MyWaitlistPage.tsx")
    assert "undoToast(" in src and "window.setTimeout(" in src, "удаление подписки снова без «Вернуть»"
    assert "Любой кабинет в ${location.name}" in src
    assert "aria-label={`Перестать следить" in src


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
    print("СТОРОЖ wave2-mclient: OK" if not failures else f"СТОРОЖ wave2-mclient УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
