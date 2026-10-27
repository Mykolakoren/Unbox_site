"""СТОРОЖ: подарочный час — только новому клиенту, решение у админов (27.10).

Кейс Лейсан Хусаиновой: сайт сверял только почту — подарок получал и тот, кто
уже был клиентом. Теперь совпадение имени+фамилии (в любом порядке, ё=е) или
телефона с известным клиентом (сайт, архив, касса) → подарок «ждёт решения» и
вопрос в чат с кнопками; без совпадений — подарок сразу и уведомление с
кнопкой «забрать».

    python3 backend/tests/guard_welcome_known_client_2026_10.py
"""
import os
import sys
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402


def _register(s, name, email=None, phone=None):
    from app.api.v1 import auth
    from app.models.user import UserCreate
    data = dict(email=email or f"n-{uuid4().hex[:6]}@x.ge", name=name, password="x" * 10)
    u = auth.register_new_user(session=s, user_in=UserCreate(**data))
    if phone:
        u.phone = phone; s.add(u); s.commit()
    return u


def _bonus(s, u):
    from sqlmodel import select
    from app.models.bonus import Bonus
    return s.exec(select(Bonus).where(Bonus.user_id == str(u.id), Bonus.type == "free_hour")).first()


def _capture():
    from app.services.telegram import telegram_service
    sent = []
    orig = telegram_service.send_admin_alert
    telegram_service.send_admin_alert = lambda text, reply_markup=None, **kw: sent.append((text, reply_markup)) or True
    return sent, lambda: setattr(telegram_service, "send_admin_alert", orig)


def _cb(markup):
    return [b["callback_data"] for row in markup["inline_keyboard"] for b in row]


def test_known_name_waits_for_admin_new_name_gets_it_now():
    import app.models.bonus  # noqa: F401
    sent, restore = _capture()
    try:
        s = H._db()
        H._user(s, role="specialist", name="Лейсан Хусаинова", balance=0.0)
        dup = _register(s, "хусаинова  лейсан")
        b = _bonus(s, dup)
        assert b.status == "pending", "похожий на известного клиента получил подарок сразу"
        text, markup = sent[-1]
        assert "не новый" in text.lower() and f"wa:{b.id}" in _cb(markup) and f"wr:{b.id}" in _cb(markup)

        fresh = _register(s, "Новая Клиентка")
        b2 = _bonus(s, fresh)
        assert b2.status == "active"
        assert f"wx:{b2.id}" in _cb(sent[-1][1]), "уведомление без кнопки «забрать подарок»"

        one_word = _register(s, "Клиентка")              # одно слово — не сверяем
        assert _bonus(s, one_word).status == "active"
        H._user(s, role="user", name="Пётр Иванов", balance=0.0)
        assert _bonus(s, _register(s, "Иванов Петр")).status == "pending", "ё и е — одно и то же"
    finally:
        restore()


def test_cashbox_name_counts_as_known():
    from app.models.cashbox_transaction import CashboxTransaction
    sent, restore = _capture()
    try:
        s = H._db()
        s.add(CashboxTransaction(type="income", amount=20, currency="GEL", payment_method="cash",
                                 description="оплата", client_name="Мария Старая", admin_id="a", admin_name="a",
                                 date=__import__("datetime").datetime(2026, 9, 1)))
        s.commit()
        assert _bonus(s, _register(s, "Мария Старая")).status == "pending"
    finally:
        restore()


def test_admin_decisions():
    from app.services import welcome_bonus as wb
    sent, restore = _capture()
    try:
        s = H._db()
        H._user(s, role="specialist", name="Анна Повтор", balance=0.0)
        b = _bonus(s, _register(s, "Анна Повтор"))
        assert wb.decide(s, str(b.id), "wa", "Админ") == "Подарочный час выдан"
        s.refresh(b); assert b.status == "active"
        assert wb.decide(s, str(b.id), "wa", "Админ") == "Уже решено раньше"
        assert wb.decide(s, str(b.id), "wx", "Админ") == "Подарочный час убран"
        s.refresh(b); assert b.status == "rejected"
        b2 = _bonus(s, _register(s, "Свежий Человек"))
        b2.status = "used"; s.add(b2); s.commit()
        assert "уже потрачен" in wb.decide(s, str(b2.id), "wx", "Админ")
    finally:
        restore()


def test_buttons_wired_in_bot():
    tg = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "telegram.py"), encoding="utf-8").read()
    assert 'if data[:3] in ("wa:", "wr:", "wx:"):' in tg and "def _handle_welcome_callback(" in tg
    au = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "auth.py"), encoding="utf-8").read()
    assert "grant_welcome_bonus(session, user, WELCOME_BONUS_EXPIRY_DAYS)" in au


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:500]}")
                traceback.print_exc(limit=4)
    sys.exit(1 if fails else 0)
