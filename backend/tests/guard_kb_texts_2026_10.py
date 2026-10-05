"""СТОРОЖ: тексты для админов не врут о правилах (05.10).
База знаний, окно кредитного лимита и заголовок срочной брони в Telegram
раньше обещали то, чего сайт не делает.

    python3 backend/tests/guard_kb_texts_2026_10.py
"""
import pathlib, sys
ROOT = pathlib.Path(__file__).parent.parent.parent
r = lambda p: (ROOT / p).read_text(encoding="utf-8")

def test_kb_has_no_outdated_rules():
    kb = r("src/pages/admin/KnowledgeBase.tsx")
    for bad in ("Часы списываются при подтверждении брони", "бонусный баланс", "Срок действия бонусов — 60 дней",
                "Попадает в чек-лист закрытия смены", "Бронь менее чем за 12 часов"):
        assert bad not in kb, f"в базе знаний снова устаревшее: «{bad}»"
    assert "в субботу и воскресенье — меньше чем за 24 часа" in kb

def test_credit_limit_text_is_honest():
    assert "спишутся за 24 часа до начала даже сверх лимита" in r("src/components/admin/modals/EditCreditLimitModal.tsx")

def test_tg_hot_header_not_12h_only():
    t = r("backend/app/services/telegram.py")
    assert "&lt;12 ч" not in t and "Срочная бронь — нужно подтвердить" in t

if __name__ == "__main__":
    f = 0
    for n, fn in sorted(globals().items()):
        if n.startswith("test_"):
            try: fn(); print(f"  ✓ {n}")
            except AssertionError as e: f += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not f else f"УПАЛО: {f}"); sys.exit(1 if f else 0)
