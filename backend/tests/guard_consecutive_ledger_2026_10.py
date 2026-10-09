"""СТОРОЖ: пересчёт «часов подряд» пишет строку ленты на СВОЮ бронь (09.10, Кузуб).

Раньше — одна общая строка на клиента (ref_type=user): раскладка денег отдавала
возврат самой ранней броне дня (17:00 «к оплате» 10 вместо 13, подешевевшая
18:00 — 30 вместо 27). Итог и баланс те же — сторож только про привязку.

    python3 backend/tests/guard_consecutive_ledger_2026_10.py
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def test_row_per_booking():
    s = (ROOT / "backend/app/services/consecutive_pricing.py").read_text(encoding="utf-8")
    i = s.index("if settled:")
    body = s[i:s.index("return {", i)]
    assert 'reason="consecutive_recompute"' in body
    assert 'ref_type="booking", ref_id=str(b.id)' in body, "строка пересчёта снова не привязана к брони"
    assert 'ref_type="user", ref_id=str(user.id)' not in s, "вернулась общая строка на клиента"
    assert "wallet.apply(session, user, -delta," in body, "знак: подорожание — списание, удешевление — возврат"


def test_allocation_nets_booking_refund():
    a = (ROOT / "backend/app/services/balance_allocation.py").read_text(encoding="utf-8")
    assert '"consecutive_recompute"' in a.split("REFUND_REASONS")[1][:600], "пересчёт — возврат по своей брони"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except AssertionError as e:
                fails += 1; print(f"  ✗ {n}: {e}")
    print("OK" if not fails else f"УПАЛО: {fails}")
    sys.exit(1 if fails else 0)
