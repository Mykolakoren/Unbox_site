"""СТОРОЖ: админам — сводка о постоянных бронях, которые заканчиваются (владелец 08.11).

Повод: Арпеник думала, что серия по четвергам идёт до конца года. Напоминание
«серия подходит к концу» сайт шлёт только клиенту и только через бота, а бот
подключён меньше чем у половины владельцев серий (59 из 102 на 08.11).

Что держит этот сторож (telegram._series_end_admin_digest):
  1  Серия с ≤2 будущими занятиями попадает в одно сообщение в админ-чат:
     клиент, кабинет, день недели и время, сколько осталось, последняя дата,
     подключён ли бот; «бота нет — напишите клиенту», если нет.
  2  Серия с 3+ занятиями — не попадает.
  3  Повторный запуск крона (каждые 10 минут) — ничего не шлёт.
  4  Серию продлили в той же группе (сменилась последняя дата) — новое сообщение.
  5  Отправка не удалась — отметку не ставим, следующий запуск повторит.
  6  Архивный клиент — не попадает. Другие серии клиента видны строкой
     «другие серии» (вдруг продление уже поставлено отдельной серией).
  7  Эндпоинт /send-reminders вызывает сводку и не падает, если она сломалась.

Без сети и боевой базы: SQLite в памяти.

    python3 backend/tests/guard_series_end_admin_2026_11.py
"""
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

NOW = datetime(2026, 11, 8, 12, 0)  # «сейчас» по Тбилиси


def _session():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine
    import app.models.specialist  # noqa: F401
    from app.models.booking import Booking
    from app.models.resource import Resource
    from app.models.user import User

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[User.__table__, Booking.__table__, Resource.__table__])
    s = Session(eng)
    s.add(Resource(id="unbox_one_room_1", name="Кабинет 1", location_id="unbox_one", type="room",
                   capacity=4, area=9, hourly_rate=20))
    s.commit()
    return s


def _user(s, name, tg=None, archived=False):
    from app.models.user import User
    u = User(email=f"{uuid4().hex[:8]}@example.com", name=name, hashed_password="x",
             telegram_id=tg, archived_at=datetime(2026, 9, 1) if archived else None)
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _series(s, user, n, start, time="17:00", group=None):
    from app.models.booking import Booking
    group = group or uuid4().hex
    for i in range(n):
        s.add(Booking(resource_id="unbox_one_room_1", location_id="unbox_one",
                      date=start + timedelta(days=7 * i), start_time=time, duration=60,
                      status="confirmed", final_price=20, payment_method="balance",
                      user_id=user.email, user_uuid=user.id, recurring_group_id=group))
    s.commit()
    return group


def _groups(s):
    from sqlmodel import select
    from app.models.booking import Booking
    g = defaultdict(list)
    for b in s.exec(select(Booking).where(Booking.status == "confirmed")
                    .where(Booking.date >= NOW.replace(hour=0, minute=0))):
        g[b.recurring_group_id].append(b)
    return g


class FakeTG:
    def __init__(self):
        self.sent, self.fail = [], False

    def send_admin_alert(self, text, **kw):
        if self.fail:
            return False
        self.sent.append(text)
        return True


def test_rules():
    """Подмена бота и id админ-чата — только на время проверки (общий прогон
    гоняет следующие сторожа в том же процессе)."""
    from app.api.v1 import telegram as tgmod
    from app.core.config import settings

    orig_tg, orig_chat = tgmod.telegram_service, settings.TELEGRAM_ADMIN_CHAT_ID
    fake = FakeTG()
    tgmod.telegram_service = fake
    settings.TELEGRAM_ADMIN_CHAT_ID = "-1"
    try:
        _rules(tgmod, fake)
    finally:
        tgmod.telegram_service, settings.TELEGRAM_ADMIN_CHAT_ID = orig_tg, orig_chat


def _rules(tgmod, fake):
    fails = []

    def check(cond, msg):
        if not cond:
            fails.append(msg)

    s = _session()
    d0 = datetime(2026, 11, 12)  # четверг
    arp = _user(s, "Арпеник")                       # без бота
    ivan = _user(s, "Иван", tg="123")               # с ботом
    long_ = _user(s, "Длинный")
    gone = _user(s, "Архивный", archived=True)
    g_arp = _series(s, arp, 2, d0)
    _series(s, arp, 4, datetime(2026, 11, 20), time="16:00")   # её другая серия (пт)
    g_ivan = _series(s, ivan, 1, d0, time="10:00")
    _series(s, long_, 3, d0)
    _series(s, gone, 1, d0)

    # 1, 2, 6
    n = tgmod._series_end_admin_digest(s, _groups(s), NOW)
    check(n == 2, f"1/2/6: в сводке должно быть 2 серии, а {n}")
    check(len(fake.sent) == 1, f"1: одно сообщение на всю сводку, а {len(fake.sent)}")
    txt = fake.sent[0] if fake.sent else ""
    check("Арпеник" in txt and "Иван" in txt, "1: в сводке клиенты Арпеник и Иван")
    check("Длинный" not in txt, "2: серия с 3 занятиями не должна попадать")
    check("Архивный" not in txt, "6: архивный клиент не должен попадать")
    check("Кабинет 1" in txt and "чт 17:00" in txt, "1: кабинет, день недели и время")
    check("последняя 19.11" in txt, "1: последняя дата серии Арпеник — 19.11")
    check("бота нет" in txt and "бот подключён" in txt, "1: метка про бота")
    check("другие серии: пт 16:00 до 11.12" in txt, "6: другие серии клиента")

    # 3
    fake.sent.clear()
    n = tgmod._series_end_admin_digest(s, _groups(s), NOW)
    check(n == 0 and not fake.sent, "3: повторный запуск не должен ничего слать")

    # 4 — продлили серию Арпеник в той же группе
    _series(s, arp, 1, datetime(2026, 11, 26), group=g_arp)
    from sqlmodel import select
    from app.models.booking import Booking
    first = s.exec(select(Booking).where(Booking.recurring_group_id == g_arp)
                   .where(Booking.date == d0)).first()
    first.status = "cancelled"
    s.add(first)
    s.commit()
    n = tgmod._series_end_admin_digest(s, _groups(s), NOW)
    check(n == 1 and "последняя 26.11" in "".join(fake.sent), "4: после продления — новое сообщение")

    # 5 — отправка не удалась
    fake.sent.clear()
    _series(s, ivan, 1, datetime(2026, 11, 15), time="12:00")
    fake.fail = True
    tgmod._series_end_admin_digest(s, _groups(s), NOW)
    fake.fail = False
    n = tgmod._series_end_admin_digest(s, _groups(s), NOW)
    check(n == 1, f"5: после неудачной отправки следующий запуск должен повторить, а {n}")
    check(g_ivan in ((ivan.crm_data or {}).get("series_admin_notified") or {}), "5: отметки сохраняются")

    # 7
    src = open(tgmod.__file__, encoding="utf-8").read()
    body = src[src.index("def send_reminders_endpoint"):src.index('@router.post("/daily-summary")')]
    check(re.search(r"try:\s+series_admin_alerts = _series_end_admin_digest", body) is not None,
          "7: /send-reminders вызывает сводку внутри try")

    assert not fails, "; ".join(fails)
    print("СТОРОЖ series_end_admin: OK (7 правил)")


if __name__ == "__main__":
    try:
        test_rules()
    except AssertionError as e:
        print("СТОРОЖ series_end_admin: ПРОВАЛ —", e)
        sys.exit(1)
