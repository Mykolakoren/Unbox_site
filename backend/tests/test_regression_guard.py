"""СТОРОЖ ОТ РЕГРЕССИЙ — «что уже работало и не должно сломаться снова».

Owner 2026-07-24: «чиним одно — отваливается другое, сделай чтобы больше
такого не было». Причина регрессий — нет автопроверки, которая ловит поломку
уже работавшего до деплоя.

ПРАВИЛО: каждый раз, когда мы чиним баг, сюда добавляется проверка, которая
бы его поймала. Тогда этот баг физически не может вернуться незамеченным —
на следующем деплое сторож упадёт.

Гоняется без сети и без боевой базы (лёгкие фикстуры / монипатч транспорта):

    python3 backend/tests/test_regression_guard.py

Прогонять ПЕРЕД каждым деплоем бэкенда. Красный сторож = деплой не выкатываем.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from app.services.telegram import telegram_service, TelegramService  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────
# 2026-07-24 — кнопки подтверждения горячей брони пропали в бот-пути.
# Бронь через TG-бот приходила админам БЕЗ кнопок ✅/❌ — подтвердить нельзя.
# ─────────────────────────────────────────────────────────────────────────

def test_hot_booking_markup_has_both_buttons():
    """У срочной брони две кнопки: подтвердить и отклонить."""
    mk = TelegramService.hot_booking_markup("abc-123")
    rows = mk["inline_keyboard"]
    buttons = [b for row in rows for b in row]
    assert len(buttons) == 2, f"ждали 2 кнопки, получили {len(buttons)}"


def test_hot_booking_callback_data_matches_handler():
    """callback_data должен быть ba:<id> / br:<id> — иначе обработчик
    _handle_hot_booking_callback не поймает нажатие (он парсит этот префикс)."""
    mk = TelegramService.hot_booking_markup("XYZ")
    datas = [b["callback_data"] for row in mk["inline_keyboard"] for b in row]
    assert "ba:XYZ" in datas, f"нет approve-callback: {datas}"
    assert "br:XYZ" in datas, f"нет reject-callback: {datas}"


def test_send_admin_alert_forwards_reply_markup():
    """send_admin_alert обязан пробрасывать кнопки в транспорт. Именно тут и
    была дыра: функция кнопки не принимала, и бот-алерт шёл голым."""
    captured = {}

    def fake_send(*, chat_id, text, parse_mode=None, disable_web_page_preview=True, reply_markup=None):
        captured["reply_markup"] = reply_markup
        return True

    orig_send = telegram_service._send_message
    orig_chat = None
    from app.core import config
    orig_chat = config.settings.TELEGRAM_ADMIN_CHAT_ID
    try:
        config.settings.TELEGRAM_ADMIN_CHAT_ID = "-100999"
        telegram_service._send_message = fake_send
        mk = TelegramService.hot_booking_markup("b1")
        telegram_service.send_admin_alert("тест", reply_markup=mk)
        assert captured.get("reply_markup") == mk, "кнопки не дошли до транспорта"
    finally:
        telegram_service._send_message = orig_send
        config.settings.TELEGRAM_ADMIN_CHAT_ID = orig_chat


def test_hot_booking_dms_send_to_each_configured_id():
    """Дубль срочной брони в личку уходит КАЖДОМУ id из списка (просьба Егора).
    Регрессия была бы, если список парсится неверно или отправка одному
    роняет остальных."""
    sent_to = []

    def fake_send(*, chat_id, text, parse_mode=None, disable_web_page_preview=True, reply_markup=None):
        if chat_id == "BAD":
            raise RuntimeError("не начал диалог с ботом")
        sent_to.append(chat_id)
        return True

    from app.core import config
    orig_send = telegram_service._send_message
    orig_ids = config.settings.TELEGRAM_HOT_BOOKING_DM_IDS
    try:
        config.settings.TELEGRAM_HOT_BOOKING_DM_IDS = "111, BAD, 222"
        telegram_service._send_message = fake_send
        n = telegram_service.send_hot_booking_dms("тест", TelegramService.hot_booking_markup("x"))
        assert sent_to == ["111", "222"], f"дошло не тем: {sent_to}"
        assert n == 2, f"ждали 2 успешных, получили {n}"  # BAD упал, но не сломал остальных
    finally:
        telegram_service._send_message = orig_send
        config.settings.TELEGRAM_HOT_BOOKING_DM_IDS = orig_ids


# ─────────────────────────────────────────────────────────────────────────
# 2026-07-15 — утечка часов абонемента: бронь оценивалась по абонементу, но
# помечалась другим способом оплаты, и часы не списывались.
# ─────────────────────────────────────────────────────────────────────────

def test_subscription_pricing_forces_subscription_label():
    """Если цена посчитана по абонементу — способ оплаты обязан стать
    'subscription', иначе часы не сгорят (утечка 1630 ₾)."""
    from app.services.pricing import resolve_payment_method, PriceBreakdown
    q = PriceBreakdown(base_price=20, hourly_rate=20, booked_hours=1,
                       final_price=0, applied_rule="SUBSCRIPTION")
    assert resolve_payment_method("balance", q) == "subscription"
    assert resolve_payment_method("bonus", q) == "subscription"
    # Без абонемента ярлык не трогаем.
    q2 = PriceBreakdown(base_price=20, hourly_rate=20, booked_hours=1,
                        final_price=20, applied_rule="NONE")
    assert resolve_payment_method("balance", q2) == "balance"


# ─────────────────────────────────────────────────────────────────────────
# 2026-07-15 — истёкший абонемент продолжал оплачивать брони (гейт не
# проверял срок вовсе).
# ─────────────────────────────────────────────────────────────────────────

def test_expired_subscription_is_not_active():
    """Истёкший абонемент не активен → бронь им не покрывается."""
    from datetime import datetime
    from app.services import subscription_pool
    expired = {"expiry_date": "2020-01-01T00:00:00", "remaining_hours": 10, "status": "active"}
    assert subscription_pool.is_active(expired, datetime.utcnow()) is False
    active = {"expiry_date": "2099-01-01T00:00:00", "remaining_hours": 10, "status": "active"}
    assert subscription_pool.is_active(active, datetime.utcnow()) is True


# ─────────────────────────────────────────────────────────────────────────
# 2026-07-25 — перевод брони на абонемент. Двойной перевод НЕ должен второй
# раз списать часы: если бронь уже на абонементе — отказ.
# ─────────────────────────────────────────────────────────────────────────

def test_convert_to_subscription_rejects_already_subscription():
    """Перевод брони, которая уже на абонементе, обязан падать — иначе часы
    спишутся дважды."""
    from app.api.v1.bookings.routes import _convert_booking_to_subscription
    from app.models.booking import Booking

    class _FakeBooking:
        payment_method = "subscription"

    try:
        _convert_booking_to_subscription(None, _FakeBooking(), None)
        raise AssertionError("ожидали ValueError, а перевод прошёл")
    except ValueError as e:
        assert "уже" in str(e).lower(), f"неожиданная причина: {e}"


# ─────────────────────────────────────────────────────────────────────────
# 2026-08 — «полуночный» баг цены. calculate_price берёт час пик из времени
# старта; если передать b.date (полночь), пик теряется и цена/скидка считаются
# неверно. Встречался дважды: в пересчёте цен и в weekly_rebate (кредит за
# объём выходил завышенным у клиентов с бронями в пик). Сторож ловит паттерн
# `start_time=<...>.date` без `.replace(hour=...)` в денежных модулях.
# ─────────────────────────────────────────────────────────────────────────

def test_no_midnight_pricing_pattern_in_money_code():
    """Ни один денежный модуль не должен звать calculate_price со временем-
    полночью. Правильно — строить start из date+start_time (.replace(hour=...))."""
    import re
    base = os.path.join(os.path.dirname(__file__), "..")
    targets = [
        "app/services/weekly_rebate.py",
        "app/api/v1/bookings/routes.py",
    ]
    # «start_time=<что-то>.date» на конце токена (не .date.replace(...))
    bad = re.compile(r"start_time\s*=\s*[A-Za-z_][\w.]*\.date\b(?!\.replace)")
    offenders = []
    for rel in targets:
        p = os.path.join(base, rel)
        if not os.path.exists(p):
            continue
        for i, line in enumerate(open(p, encoding="utf-8"), 1):
            if bad.search(line):
                offenders.append(f"{rel}:{i}: {line.strip()}")
    assert not offenders, (
        "полуночный паттерн цены (start_time=...date без времени):\n  "
        + "\n  ".join(offenders))


def test_monthly_recurrence_is_four_weeks_not_calendar_month():
    """«Раз в 4 недели» должно шагать ровно 28 днями (день недели фиксирован),
    а НЕ календарным месяцем. Владелец: серия обязана попадать на тот же день
    недели. Регресс = возврат relativedelta(months=...) или step_days=30."""
    import re
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    # Ветка создания серии monthly должна давать 28-дневный шаг.
    assert re.search(r'pattern\s*==\s*"monthly"\s*:\s*\n\s*#.*\n(?:\s*#.*\n)*\s*dates\s*=\s*\[first\s*\+\s*timedelta\(weeks=i\s*\*\s*4\)', src), \
        "monthly-серия должна строиться как first + timedelta(weeks=i*4) (28 дней)"
    # Календарный месяц не должен вернуться (ловим импорт/вызов, не упоминание в коммент.).
    assert "dateutil" not in src and "rdelta(" not in src and "relativedelta(" not in src, \
        "relativedelta (календарный месяц) не должен использоваться в сериях броней"
    # Продление серии для monthly — шаг 28, а не 30.
    assert re.search(r'pattern_override\s*==\s*"monthly"\s*:\s*\n\s*step_days\s*=\s*28\b', src), \
        "продление monthly-серии должно шагать 28 днями, не 30"


def test_session_payments_dated_by_operation_day_not_session_date():
    """Обе кнопки оплаты сессии (quick_pay_session И mark_all_sessions_paid)
    должны датировать TherapistPayment ДНЁМ ОПЛАТЫ (datetime.now()), а НЕ датой
    сессии (ts.date). Иначе оплата старого долга задним числом меняет «кассу»
    прошлого месяца и ломает кэш-флоу. Владелец: касса = когда деньги пришли."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/crm/sessions.py"), encoding="utf-8").read()
    # В создании ПЛАТЕЖА не должно быть date=ts.date (обе ветки — операционный
    # день). Ищем только внутри конструктора TherapistPayment(...): подстрока
    # session_date=ts.date в календарном пуше — легитимна (Этап 2, 27.08).
    import re as _re
    _pay_blocks = _re.findall(r"TherapistPayment\((?:[^()]|\([^()]*\))*\)", src)
    assert not any("date=ts.date" in b for b in _pay_blocks), (
        "платёж за сессию датируется ts.date — верни datetime.now() (день оплаты)")
    # Обе платёжные ветки (quick_pay + mark_all) создают платёж с датой now().
    assert src.count("date=datetime.now()") >= 2, (
        "ожидаем ≥2 платёжных путей с date=datetime.now() (quick_pay + mark_all)")


def test_booking_wizard_bonus_filter_matches_free_hour():
    """Мастер брони (ConfirmationStep.tsx) фильтрует подарочные бонусы. Бэкенд
    хранит тип 'free_hour' (auth._create_welcome_bonus). Если фильтр ищет только
    'freeHour' (camelCase) — опция «оплатить бонусом» не показывается и подарочный
    час нельзя использовать (кейс Оксаны, −20). Значит фильтр обязан принимать
    'free_hour'."""
    base = os.path.join(os.path.dirname(__file__), "..", "..")
    p = os.path.join(base, "src/components/Wizard/ConfirmationStep.tsx")
    if not os.path.exists(p):
        return  # фронт может отсутствовать в некоторых окружениях — не валим
    src = open(p, encoding="utf-8").read()
    # Бэкенд выдаёт 'free_hour' — фронт обязан его принимать.
    assert "'free_hour'" in src or '"free_hour"' in src, (
        "фильтр бонусов в ConfirmationStep.tsx не принимает 'free_hour' — "
        "подарочный час снова станет невыбираемым (см. кейс Оксаны)")


def test_deferred_charge_claims_booking_row_with_lock():
    """settle_pending_charge обязан «застолбить» бронь блокировкой строки
    (with_for_update) ПЕРЕД списанием — иначе два прогона крона внахлёст
    спишут одну бронь дважды без возврата (12 случаев за 21.07–07.08.2026).
    Проверка payment_status без FOR UPDATE недостаточна."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/services/billing_defer.py"), encoding="utf-8").read()
    assert "with_for_update()" in src, (
        "settle_pending_charge не блокирует строку брони (with_for_update) — "
        "вернётся двойное списание при параллельных прогонах крона")
    # Лок должен реально уходить в БД, а не отдавать кэш identity-map.
    assert "populate_existing=True" in src, (
        "нужен populate_existing=True, иначе FOR UPDATE вернёт кэш без блокировки")


def test_refund_of_subscription_fallback_to_balance_returns_money():
    """Отмена абонементной брони, которая ушла в баланс-долг (исчерпан пул,
    hours_deducted=0, method остался 'subscription') должна вернуть ДЕНЬГИ, а
    не 0 часов. _refund_booking_to_owner обязан гейтить возврат часов на
    hours_deducted>0 (иначе деньги клиента пропадают при отмене)."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    assert "and (booking.hours_deducted or 0) > 0" in src, (
        "_refund_booking_to_owner не гейтит возврат часов на hours_deducted>0 — "
        "вернётся баг: отмена абонемент→баланс брони теряет деньги клиента")


def test_reschedule_updates_charge_amount():
    """Перенос брони со сменой цены обязан обновлять charge_amount (как /extend,
    /trim, /format), иначе charge_amount навсегда расходится с final_price и
    портит будущие возвраты (waive, перевод на абонемент) и дашборд."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.rfind('reason="reschedule_diff"')
    assert i != -1, "не найден блок reschedule_diff"
    j = src.find("# Update booking price fields", i)
    assert j != -1 and "charge_amount" in src[i:j], (
        "reschedule не обновляет charge_amount после доплаты/возврата — "
        "charge_amount разойдётся с final_price (см. money_audit charge_amount_mismatch)")


def test_merge_paths_move_balance_and_zero_source():
    """Слияние аккаунтов не должно оставлять деньги на мёртвом профиле.
    - /users/merge (admin): переносит баланс на tgt И удаляет src (session.delete).
    - _merge_into (Telegram auto): переносит на keep И обнуляет absorb (иначе
      баланс задваивается + виснет — как 31 легаси-случай)."""
    import re
    base = os.path.join(os.path.dirname(__file__), "..")
    admin = open(os.path.join(base, "app/api/v1/users/admin.py"), encoding="utf-8").read()
    tg = open(os.path.join(base, "app/api/v1/telegram.py"), encoding="utf-8").read()
    # admin merge: переносит баланс на tgt и удаляет src.
    assert re.search(r'_wallet\.apply\(session, tgt,', admin), \
        "/users/merge не переносит баланс на tgt"
    assert "session.delete(src)" in admin, "/users/merge не удаляет источник"
    # telegram auto-merge: переносит на keep И обнуляет absorb.
    assert re.search(r'apply\(session, keep,', tg), "_merge_into не переносит баланс на keep"
    assert re.search(r'apply\(session, absorb, -', tg), \
        "_merge_into не обнуляет источник — баланс задвоится и зависнет на мёртвом профиле"


def test_cron_charges_subscription_peak_surcharge():
    """Крон (settle_pending_charge), когда абонемент покрыл часы, обязан всё равно
    списать пиковую надбавку (final_price = subscription_peak_debt) — иначе Unbox
    недополучает ~5₾/ч на пиковых абонементных бронях, забронированных заранее."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/services/billing_defer.py"), encoding="utf-8").read()
    assert "пиковая надбавка абонемента (T-24ч)" in src, (
        "крон не списывает пиковую надбавку абонемента в ветке «часы покрыли» — "
        "Unbox недополучает деньги за пик")


def test_reject_refunds_bonus_hour():
    """reject_booking (отклонение горячей брони) должен вернуть бонусный час —
    hot-gate его не откатывает, а reject раньше вообще ничего не возвращал."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.find("def reject_booking")
    assert i != -1, "reject_booking не найден"
    j = src.find("\ndef ", i + 10)
    body = src[i:j if j != -1 else len(src)]
    assert "_refund_booking_to_owner" in body, (
        "reject_booking не возвращает бонусный час (нет вызова _refund_booking_to_owner)")


def test_recurring_recomputes_consecutive_chain():
    """Создание СЕРИИ обязано пересчитывать цепочку смежных часов, как это уже
    делают одиночная бронь и мульти-слот. Иначе новая бронь получает скидку за
    смежность, а её сосед остаётся по полной цене (кейс Натальи Ященко 12.08:
    11:00 — 18₾ со скидкой, смежная 12:00 — 20₾ без; клиент ушёл в минус)."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.find("def create_recurring_booking")
    assert i != -1, "create_recurring_booking не найден"
    j = src.find("\n@router.", i + 10)
    body = src[i:j if j != -1 else len(src)]
    assert "recompute_user_chains_for_day" in body, (
        "создание серии не пересчитывает цепочку смежных часов — "
        "соседняя бронь останется без скидки за длительность")


def test_group_rate_has_no_per_room_exceptions():
    """Владелец 2026-08-12: групповой тариф ЕДИНЫЙ (35₾/ч), интервизия 30₾/ч —
    никаких исключений «в этом кабинете группа по индивидуальной ставке».
    Такое исключение уже было (Кабинет 2) и создавало расхождение: фронт
    показывал 35₾, бэк списывал 20₾. Сторож не даёт ему вернуться."""
    base = os.path.join(os.path.dirname(__file__), "..")
    back = open(os.path.join(base, "app/services/pricing.py"), encoding="utf-8").read()
    assert "MINI_GROUP_ROOMS" not in back, (
        "в бэкенде вернулось кабинетное исключение группового тарифа")
    # Базовые ставки на месте и совпадают с политикой владельца.
    assert '"GRP": 35.0' in back and '"INTV": 30.0' in back, (
        "базовые ставки группы/интервизии изменились — сверить с владельцем")
    front_path = os.path.join(base, "..", "src/utils/pricing.ts")
    if os.path.exists(front_path):
        front = open(front_path, encoding="utf-8").read()
        assert "MINI_GROUP_ROOMS" not in front, (
            "во фронте вернулось кабинетное исключение группового тарифа")


def test_tg_approve_marks_booking_paid():
    """Подтверждение горячей брони ЧЕРЕЗ TELEGRAM-БОТ обязано ставить
    payment_status='paid' сразу после списания. Иначе крон T-24ч видит бронь
    как confirmed+pending и списывает второй раз (кейс Алёны Ловиц 13.08:
    бот снял 20₾ в 06:50, крон снял ещё 20₾ в 07:00)."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/telegram.py"), encoding="utf-8").read()
    i = src.find('description="Бронь через Telegram-бот"')
    assert i != -1, "не найдено списание в tg-approve"
    tail = src[i:i + 1500]
    assert 'payment_status = "paid"' in tail, (
        "tg-approve не помечает бронь оплаченной — крон спишет второй раз")


def test_admin_user_update_routes_balance_through_wallet():
    """PATCH /users/{id} не должен писать balance напрямую через setattr —
    только через wallet.set_balance, иначе движение не попадает в ленту и
    ломается инвариант «сумма ленты == баланс». Так молча исчезли 650₾ у
    Валерии Костенецкой при выдаче абонемента «за счёт баланса»."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/users/admin.py"), encoding="utf-8").read()
    i = src.find("def update_user(")
    assert i != -1, "update_user не найден"
    body = src[i:i + 4000]
    assert 'user_data.pop("balance"' in body, (
        "update_user не вынимает balance из общего setattr — баланс запишется мимо ленты")
    assert "set_balance(" in body, (
        "update_user не проводит баланс через wallet.set_balance")


def test_extend_prices_via_engine_not_proportion():
    """Продление брони обязано считать доплату ПРАЙС-ДВИЖКОМ (разница котировок
    старая длительность → новая), а не пропорцией «цена за минуту × минуты».

    Пропорция не проходит через тарифную сетку, и продление сбивало скидку за
    длительность: бронь 1 ч (20 ₾) + 1 ч давала 40 ₾ вместо 36 ₾ — тир «2 часа
    подряд = −10%» исчезал (Екатерина Жук, Кабинет 7, 18.08; нашла Лиза).
    Та же формула промахивалась и в минус для Unbox: 19:00 + 1 ч заезжает в пик
    (должно 41 ₾, пропорция давала 40 ₾), а допы из /add-extras задваивались
    (кофе 3 ₾ → 6 ₾)."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.find("def extend_booking")
    assert i != -1, "extend_booking не найден"
    j = src.find("\n@router.", i + 10)
    body = src[i:j if j != -1 else len(src)]
    assert "price_per_min" not in body, (
        "в /extend вернулась пропорциональная доплата — скидка за длительность "
        "снова потеряется при продлении")
    assert body.count("pricing.calculate_price(") >= 2, (
        "/extend не котирует цену движком дважды (старая и новая длительность) — "
        "доплата считается мимо тарифной сетки")
    assert "exclude_booking_id" in body, (
        "/extend котирует без exclude_booking_id — движок посчитает бронь "
        "соседом самой себе и задвоит часы в цепочке")


def test_personal_hourly_rate_disables_all_discounts():
    """Личная ставка за час (crm_data.personal_hourly_rate) — эксклюзивна:
    ни тир за длительность, ни недельная скидка к ней не применяются.

    Владелец 2026-08-25: Ольга Корень и Кристина Ропель снимают ГРУППОВОЙ кабинет
    по 20 GEL/ч, Алла Коноплицкая по 15 GEL/ч. Пока договорённость жила только в
    Excel, система считала их обычными клиентами и накидывала скидку за объём —
    Ольге так натекло 58 GEL недельных скидок, которых быть не должно.

    Ветка обязана стоять ПОСЛЕ абонемента (купленные часы должны сгорать, а не
    списываться деньгами) и выходить ДО тарифной сетки, оставляя
    discountable_base=0 — иначе weekly_rebate снова начнёт их добирать."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/services/pricing.py"), encoding="utf-8").read()
    assert "personal_hourly_rate" in src, "личная ставка за час пропала из движка"
    i = src.find('breakdown.applied_rule = "PERSONAL_RATE"')
    assert i != -1, "нет ветки PERSONAL_RATE"
    sub = src.find("_apply_subscription(user, breakdown, resource, format_type)")
    assert sub != -1 and sub < i, (
        "ветка личной ставки оказалась ПЕРЕД абонементом — купленные часы "
        "перестанут сгорать и спишутся деньгами")
    tier = src.find('for tier in self.PRICING_CONFIG["duration"]')
    assert tier != -1 and i < tier, (
        "личная ставка не выходит до тиров за длительность — скидка вернётся")


def test_approve_recomputes_consecutive_chain():
    """Подтверждение срочной брони обязано пересобирать цепочку смежных часов.

    Срочная бронь создаётся как `pending_approval`, а `_compute_block_hours`
    считает только `confirmed` — соседние часы друг друга не видят, и каждый
    получает свой тир. Александр Беляев (26.08.2026): 5 часов подряд в капсуле
    двумя бронями дали 15% и 10% вместо общих 20%."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.find("def approve_booking")
    assert i != -1, "approve_booking не найден"
    j = src.find("class RejectBookingPayload", i)
    body = src[i:j if j != -1 else len(src)]
    assert "recompute_user_chains_for_day" in body, (
        "approve_booking не пересчитывает цепочку — смежные часы останутся "
        "с раздельными скидками вместо общей")


def test_series_extension_stamps_payment_status():
    """«Продлить серию» обязана ставить payment_status='pending'.

    Крон списания (find_due_pending) ищет строго 'pending'. Бронь с NULL он не
    увидит НИКОГДА — Валентина Ястребова: серия по понедельникам, 5 прошедших
    занятий на 98 ₾ прошли бесплатно, и вся будущая серия ушла бы так же."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.find("def extend_recurring_series")
    assert i != -1, "extend_recurring_series не найден"
    j = src.find("\n@router.", i + 10)
    body = src[i:j if j != -1 else len(src)]
    assert 'payment_status="pending"' in body, (
        "продление серии не ставит payment_status — брони не спишутся никогда")


def test_split_preserves_total_and_keeps_first_booking():
    """Деление брони не должно создавать и терять деньги.

    Сумма частей обязана равняться исходной цене: части раскладываются ДОЛЯМИ от
    уже списанного (остаток округления уходит в первую часть), а не считаются
    «как новые» — иначе потерялись бы допы, бонусные часы и ручные правки.

    Первой частью остаётся ИСХОДНАЯ бронь (тот же id), иначе отвалятся
    привязанная CRM-сессия, событие Google Calendar и ссылки на неё."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.find("def split_booking")
    assert i != -1, "split_booking не найден"
    j = src.find("\n@router.", i + 10)
    body = src[i:j if j != -1 else len(src)]
    assert "_split_amount" in body, "деление сумм долями пропало"
    assert "out[0] = round(total - sum(out[1:]), 2)" in body, (
        "остаток округления не сводится в первую часть — сумма частей "
        "разойдётся с исходной ценой")
    assert "sum(parts) != int(booking.duration or 0)" in body, (
        "не проверяется, что сумма частей равна длительности брони")
    assert "crm_client_id=None" in body, (
        "новым частям копируется клиент CRM — смысл деления в том, что у "
        "каждой части свой клиент")


def test_webhook_masks_start_token_in_logs():
    """Вебхук Telegram не должен логировать payload /start целиком: там
    одноразовый link-token, по которому биндится telegram_id (= вход на сайт).
    Токен в journalctl = захват чужого аккаунта тем, кто читает логи
    (аудит безопасности 2026-08-27)."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/telegram.py"), encoding="utf-8").read()
    i = src.find("[tg:webhook] in:")
    assert i != -1, "строка логирования вебхука не найдена"
    assert "<masked>" in src[max(0, i - 1200):i], (
        "payload /start логируется без маскировки — link-token утечёт в journalctl")


# ─────────────────────────────────────────────────────────────────────────
# 2026-08-27 — консилиум (money+regression+security+frontend): пакет фиксов.
# ─────────────────────────────────────────────────────────────────────────

def test_price_recompute_ignores_fresh_subscription():
    """Пересчёт цены СУЩЕСТВУЮЩЕЙ денежной брони (reschedule/trim/format/
    extend/split) не должен тихо применять свежекупленный абонемент — иначе
    рождаются «нулёвки» balance+final_price=0+rule=SUBSCRIPTION (серия Галины,
    501 бронь). Все 5 точек обязаны передавать ignore_subscription."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    assert src.count("ignore_subscription") >= 5, (
        f"точек с ignore_subscription {src.count('ignore_subscription')} < 5 — "
        "какой-то пересчёт снова тихо применяет абонемент")


def test_series_extension_requotes_each_date():
    """extend_recurring_series обязан пере-котировать каждую новую дату живым
    движком (+resolve_payment_method), а не копировать template байт-в-байт —
    копирование размножало испорченную запись каждым продлением."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    i = src.find("def extend_recurring_series")
    j = src.find("\ndef ", i + 10)
    body = src[i:j if j != -1 else len(src)]
    assert "calculate_price" in body and "resolve_payment_method" in body, (
        "extend_recurring_series снова копирует шаблон без пересчёта")


def test_series_has_hard_length_cap():
    """Серия капится SERIES_MAX_OCCURRENCES и в create, и в extend (суммарно) —
    без этого повторные продления по 52 растили серии до 500+ броней."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    assert src.count("SERIES_MAX_OCCURRENCES") >= 3, (
        "потолок длины серии исчез из create или extend")


def test_charge_fallback_fails_loud():
    """Если пересчёт цены в cash-fallback крона падает — бронь остаётся pending
    и уходит в failures (TG-алерт), а НЕ помечается paid со списанием 0₾."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/services/billing_defer.py"), encoding="utf-8").read()
    assert "price_recompute_failed" in src, (
        "fallback снова глотает исключение и дарит комнату за 0₾")


def test_peak_surcharge_is_refunded_everywhere():
    """Пиковая надбавка абонемента — деньги. Списывается при создании и кроном,
    значит обязана возвращаться во всех трёх точках: отмена (_refund_booking_
    to_owner), hot-gate revert, waive. Иначе клиент теряет 5₾/ч навсегда."""
    base = os.path.join(os.path.dirname(__file__), "..")
    routes = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    bd = open(os.path.join(base, "app/services/billing_defer.py"), encoding="utf-8").read()
    assert "Возврат пиковой надбавки абонемента" in routes, "нет возврата пика при отмене"
    assert "Откат пиковой надбавки" in routes, "нет отката пика в hot-gate"
    assert "возврат пиковой надбавки" in bd, "нет возврата пика в waive"


def test_analytics_keeps_hours_and_money_apart():
    """Аналитика владельца не должна суммировать charge_amount абонементных
    броней как деньги (там по конвенции ЧАСЫ у крон-списанных) — это раздувало
    «скидки» и портило ₾/час арендаторов."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/analytics.py"), encoding="utf-8").read()
    assert "_cash_paid_sum" in src, "скидки снова считаются по всем броням разом"
    assert src.count('== "subscription"') >= 2, (
        "исключение абонементных из денежных сумм пропало")


def test_userdetails_hook_before_early_return():
    """convertingId (useState) обязан стоять ДО раннего return «Загрузка…» в
    UserDetails — иначе холодное открытие карточки (F5/прямая ссылка) роняет
    весь /admin: Rendered more hooks than during the previous render."""
    base = os.path.join(os.path.dirname(__file__), "..", "..")
    p = os.path.join(base, "src/pages/admin/UserDetails.tsx")
    if not os.path.exists(p):
        return
    src = open(p, encoding="utf-8").read()
    hook = src.find("convertingId, setConvertingId")
    early = src.find("\n    if (!user) {")
    assert hook != -1 and early != -1, "не нашёл хук или ранний return"
    assert hook < early, "useState(convertingId) снова после раннего return — /admin будет падать"


def test_balance_correction_requires_permission():
    """Решение владельца 27.08 («вариант а»): менять баланс клиента можно только
    с правом finance.balance_correction — и в /balance-correction, и в generic
    PATCH /users. Без гейта любой admin правил чужие балансы в обход матрицы."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/users/admin.py"), encoding="utf-8").read()
    assert src.count('"finance.balance_correction"') >= 2, (
        "гейт права на баланс пропал из correct_user_balance или update_user")


def test_psycrm_roster_fully_isolated():
    """Решение владельца 27.08: список клиентов Psy-CRM видит ТОЛЬКО сам
    специалист — admin-proxy через ?specialist_id= закрыт для всех ролей."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/crm/clients.py"), encoding="utf-8").read()
    assert "только самому специалисту" in src, "403-гейт изоляции ростера пропал"
    assert "is_admin and specialist_id" not in src, (
        "admin-proxy по specialist_id вернулся в list_clients")


def test_calendar_push_dedupes_before_creating():
    """Этап 1 календарного плана (владелец 27.08): пуш события в личный
    календарь обязан СНАЧАЛА искать существующее событие клиента на это время
    (привязка/сигнал), а не создавать вслепую — слепой пуш плодил дубли
    («Алёна грум» ×8, «Николай Горячев»)."""
    base = os.path.join(os.path.dirname(__file__), "..")
    cal = open(os.path.join(base, "app/services/crm_calendar.py"), encoding="utf-8").read()
    assert "def find_matching_event" in cal and "def create_or_link_event" in cal, (
        "дедуп-ядро пуша исчезло из crm_calendar.py")
    assert "extendedProperties" in cal, (
        "события больше не несут метки происхождения (origin=unbox)")
    ses = open(os.path.join(base, "app/api/v1/crm/sessions.py"), encoding="utf-8").read()
    assert "create_or_link_event" in ses, "ручная сессия снова пушит вслепую"
    rts = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    assert "create_or_link_event" in rts, "зеркало серии снова пушит вслепую"
    snc = open(os.path.join(base, "app/api/v1/crm/sync.py"), encoding="utf-8").read()
    assert "calendar_duplicates" in snc, "отчёт синка потерял список дублей календаря"


def test_calendar_two_way_and_recurring():
    """Этап 2 календарного плана: (1) перенос сессии из CRM двигает ТО ЖЕ
    событие Google (update_calendar_event по google_event_id); (2) серия
    создаётся одним recurring-событием (RRULE) с детерминированными
    instance-id; (3) patch события не затирает описание при переносе."""
    base = os.path.join(os.path.dirname(__file__), "..")
    cal = open(os.path.join(base, "app/services/crm_calendar.py"), encoding="utf-8").read()
    assert "def create_recurring_event" in cal and "RRULE:FREQ=WEEKLY" in cal, (
        "recurring-создатель серии пропал")
    assert 'if notes is not None:' in cal, (
        "patch события снова затирает описание пустой строкой")
    ses = open(os.path.join(base, "app/api/v1/crm/sessions.py"), encoding="utf-8").read()
    assert "update_calendar_event" in ses, (
        "перенос сессии из CRM больше не двигает событие Google")
    rts = open(os.path.join(base, "app/api/v1/bookings/routes.py"), encoding="utf-8").read()
    assert "_series_instance_ids" in rts and "create_recurring_event" in rts, (
        "серия снова пушится N одиночными событиями")


def test_calendar_autosync_endpoint_secret_gated():
    """Этап 3: автосинк календарей по крону — эндпоинт /crm/sync/auto обязан
    существовать и быть закрыт TELEGRAM_REMINDER_SECRET (паттерн billing)."""
    base = os.path.join(os.path.dirname(__file__), "..")
    src = open(os.path.join(base, "app/api/v1/crm/sync.py"), encoding="utf-8").read()
    assert '"/sync/auto"' in src, "cron-эндпоинт автосинка пропал"
    i = src.find("def auto_sync_all_calendars")
    body = src[i:i+2000]
    assert "TELEGRAM_REMINDER_SECRET" in body and "Invalid secret" in body, (
        "автосинк без секрет-гейта — любой сможет дергать синк")


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
    print("СТОРОЖ: OK" if not failures else f"СТОРОЖ УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)


def test_session_notes_never_pushed_to_google_calendar():
    """Ревизия приватности 29.08: заметки терапевта шифруются в базе и не
    должны уходить открытым текстом в описание события Google. Пуш сессии
    в календарь (create_or_link_event в sessions.py) обязан передавать
    notes=None. Если кто-то вернёт notes=data.notes — этот сторож упадёт."""
    import pathlib
    src = (pathlib.Path(__file__).parent.parent / "app/api/v1/crm/sessions.py").read_text()
    i = src.find("res = create_or_link_event(")
    assert i != -1, "пуш сессии в календарь исчез — проверь sessions.py"
    call = src[i:i + 700]
    assert "notes=None" in call, "пуш сессии должен слать notes=None"
    assert "notes=data.notes" not in call, "заметка сессии утекает в Google!"


def test_quick_pay_reconciles_existing_payment_instead_of_500():
    """29.08: у сессии есть запись оплаты, а is_paid=False (легаси-рассинхрон).
    quick-pay обязан НЕ вставлять второй платёж (unique-констрейнт дал бы 500),
    а идемпотентно чинить флаг. Проверяем: до создания TherapistPayment стоит
    поиск существующего платежа с веткой reconciled."""
    import pathlib
    src = (pathlib.Path(__file__).parent.parent / "app/api/v1/crm/sessions.py").read_text()
    i = src.find('def quick_pay_session')
    assert i != -1
    body = src[i:src.find("def unmark_paid_session")]
    assert '"reconciled": True' in body, "нет идемпотентной ветки при существующем платеже"
    assert body.find("existing_payment") < body.find("TherapistPayment("), \
        "проверка существующего платежа должна стоять ДО создания нового"


def test_update_session_unpaid_deletes_orphan_payments():
    """29.08: снятие «Оплачено» через форму (PATCH is_paid=False) должно
    удалять платежи сессии, как это делает unmark-paid. Иначе платёж-сирота
    остаётся жить: доход завышен, повторная оплата падает."""
    import pathlib
    src = (pathlib.Path(__file__).parent.parent / "app/api/v1/crm/sessions.py").read_text()
    i = src.find("def update_session")
    body = src[i:src.find("def delete_session")]
    assert 'update_data.get("is_paid") is False' in body, \
        "PATCH is_paid=False больше не чистит платежи-сироты"
    assert "session.delete(_p)" in body


def test_series_quote_is_read_only():
    """30.08: «примерка» серии (/recurring/quote) обязана быть чистым чтением —
    ни броней, ни списаний, ни коммитов. Если в неё просочится запись,
    двойное списание вернётся через самый безобидный на вид эндпоинт."""
    import pathlib
    src = (pathlib.Path(__file__).parent.parent / "app/api/v1/bookings/routes.py").read_text()
    i = src.find("def quote_recurring_booking")
    j = src.find("def create_recurring_booking")
    assert 0 < i < j, "эндпоинт примерки исчез или переехал за создание"
    body = src[i:j]
    for forbidden in ("session.add(", "session.commit(", "wallet.debit", "wallet.credit", "subscription_pool.update"):
        assert forbidden not in body, f"примерка серии пишет в базу: {forbidden}"
    assert "resolve_payment_method" in body and "calculate_price" in body, \
        "примерка должна считать той же математикой, что создание"
