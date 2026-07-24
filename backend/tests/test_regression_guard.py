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
