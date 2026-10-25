"""СТОРОЖ: неподтверждённая срочная заявка не «висит» молча (25.10).

Заявка держит время (12.10), а если её никто не нажал — так и висела. Сами её
не снимаем (встреча могла пройти, а админ забыл нажать), а напоминаем в чат
админов с кнопками ✅/❌: за час до начала и после начала, каждое один раз.
Работает внутри крона charge-due (каждые 10 минут).

    python3 backend/tests/guard_pending_reminders_2026_10.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

import guard_hours_pool_moves as H  # noqa: E402


def test_reminds_once_per_stage_with_buttons():
    from app.api.v1 import billing
    sent = []
    orig = billing.telegram_service.send_admin_alert
    billing.telegram_service.send_admin_alert = lambda text, reply_markup=None, **kw: sent.append((text, reply_markup)) or True
    try:
        with H.frozen_time():   # пн 05.10 10:00 по Тбилиси
            s = H._db()
            u = H._user(s, role="specialist", balance=500.0, name="Срочная")
            b = H._create(s, u, u, days=0, start="10:30")
            assert b.status == "pending_approval", f"ждали заявку на одобрении, а статус {b.status}"
            assert billing._remind_pending_hot_step(s) == 1
            text, markup = sent[-1]
            assert "через 30 мин" in text and markup and "inline_keyboard" in markup
            datas = [x["callback_data"] for row in markup["inline_keyboard"] for x in row]
            assert f"ba:{b.id}" in datas and f"br:{b.id}" in datas, "без кнопок подтвердить/отклонить"
            assert billing._remind_pending_hot_step(s) == 0, "повторное напоминание каждые 10 минут — шум"
            b.start_time = "09:30"; s.add(b); s.commit()       # время уже началось
            assert billing._remind_pending_hot_step(s) == 1 and "уже началось" in sent[-1][0]
            assert billing._remind_pending_hot_step(s) == 0
            # Подтверждённую/обычную бронь не трогаем.
            c = H._create(s, u, u, days=3, start="12:00")
            assert c.status == "confirmed" and billing._remind_pending_hot_step(s) == 0
    finally:
        billing.telegram_service.send_admin_alert = orig


def test_wired_into_cron_sweep():
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "billing.py"), encoding="utf-8").read()
    i = src.index("def _sweep_due_bookings(")
    assert "_remind_pending_hot_step(session)" in src[i:src.index("def _remind_pending_hot_step(")]


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                import traceback
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:400]}")
                traceback.print_exc(limit=4)
    sys.exit(1 if fails else 0)
