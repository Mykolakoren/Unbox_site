"""СТОРОЖ: задачи крона запускаются «голыми» и сообщают о сбое (12.10).

Счёт за неделю (weekly_invoices.py) в первый понедельник упал «No module named
'app'»: крон запускает скрипт без PYTHONPATH, а путь к app/ скрипт не ставил.
Никто не узнал — сторож крона следил только за списаниями. Теперь:
  * каждый скрипт крона сам ставит путь к app/ ДО первого `from app`;
  * scripts/unbox-cron-run.sh — обёртка: сбой (код вне разрешённых или
    трассировка Python) → сообщение в «Ленту» админов.

    python3 backend/tests/guard_cron_scripts_2026_10.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
CRON_SCRIPTS = ("weekly_invoices.py", "money_audit.py", "expire_subscriptions.py")


def test_cron_scripts_bootstrap_path():
    for name in CRON_SCRIPTS:
        src = (ROOT / "backend/scripts" / name).read_text(encoding="utf-8")
        m = re.search(r"^from app|^import app", src, re.M)
        assert m, f"{name}: нет импорта app — список CRON_SCRIPTS устарел?"
        head = src[:m.start()]
        assert "sys.path.insert(0, os.path.join(os.path.dirname(" in head, \
            f"{name}: путь к app/ не ставится до первого импорта — крон упадёт «No module named 'app'»"


def test_cron_wrapper_alerts_on_failure():
    w = (ROOT / "scripts/unbox-cron-run.sh").read_text(encoding="utf-8")
    assert 'grep -q "Traceback (most recent call last)"' in w
    assert 'OK_CODES=" ${CRON_RUN_OK_CODES:-0} "' in w
    assert "TELEGRAM_ADMIN_CHAT_ID" in w and "api.telegram.org" in w
    assert 'exit "$code"' in w, "обёртка должна возвращать код задачи"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except AssertionError as e:
                fails += 1; print(f"  ✗ {n}: {e}")
    sys.exit(1 if fails else 0)
