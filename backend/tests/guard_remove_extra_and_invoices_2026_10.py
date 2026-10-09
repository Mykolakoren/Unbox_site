"""СТОРОЖ «Убрать доп» и «Счёт за неделю» (владелец 09.10).

1. PATCH /bookings/{id}/remove-extra — зеркало /add-extras: один доп; деньги
   «в цене» (booking_extras_money до/после) — уменьшают цену и, если бронь уже
   списана, возвращаются на баланс строкой extras_refund на свою бронь; доп,
   оплаченный на месте, баланс не трогает (ответ просит вернуть из кассы).
2. scripts/weekly_invoices.py — пн 09:00: счёт за прошлую неделю (пн–вс) по
   клиентам с меткой «счёт за неделю» / WEEKLY_INVOICE_EMAILS → лента админов.

    python3 backend/tests/guard_remove_extra_and_invoices_2026_10.py
"""
import pathlib, sys
from datetime import date

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_remove_extra_endpoint():
    s = _read("backend/app/api/v1/bookings/routes.py")
    body = s[s.index("def remove_booking_extra("):s.index("# ─── Перевод брони на абонемент")]
    assert "current_user.role not in ADMIN_ROLES" in body
    assert "booking_extras_money(booking)" in body, "сколько допа в цене — общей функцией"
    assert "min(in_price_before, listed_after)" in body and "reduction = min(reduction, price_one)" in body
    assert 'charged = booking.payment_status not in ("pending", "waived")' in body, "возврат — только если списано"
    assert 'reason="extras_refund"' in body and 'ref_type="booking", ref_id=str(booking.id)' in body
    assert "remaining.remove(extra)" in body, "убираем ОДИН доп"
    assert "из кассы" in body, "наличный доп — подсказка вернуть из кассы"
    assert "with_for_update()" in body, "блокировка брони: двойной клик не вернёт дважды"
    assert 'Допы к броне (дозаказ):' in body, "подсказка «из кассы» — только если был приход на месте"
    assert "status_code=409" in body, "оплачено, а владельца нет — ничего не меняем"


def test_remove_extra_screen():
    s = _read("src/components/admin/AdminChessboardView.tsx")
    assert "const handleRemoveExtra = async" in s and s.count("data-extras-row") == 2, "строка «Допы» — в панели и в попапе"
    assert "bookingsApi.removeBookingExtra(" in s
    a = _read("src/api/bookings.ts")
    assert "/remove-extra" in a


def test_weekly_invoice_logic():
    sys.path.insert(0, str(ROOT / "backend"))
    src = _read("backend/scripts/weekly_invoices.py")
    assert 'TAGS = {"счёт за неделю", "счет за неделю"}' in src
    assert "send_admin_alert" in src and "--dry-run" in src
    assert "session.add(" not in src and "commit(" not in src, "только чтение"
    ns: dict = {}
    import ast
    tree = ast.parse(src)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "week_bounds")
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "x", "exec"), {"date": date, "timedelta": __import__("datetime").timedelta}, ns)
    wb = ns["week_bounds"]
    assert wb(date(2026, 10, 12), None) == (date(2026, 10, 5), date(2026, 10, 11)), "в понедельник — прошлая неделя"
    assert wb(date(2026, 10, 9), "2026-10-01") == (date(2026, 9, 28), date(2026, 10, 4))


def test_config_and_cron_doc():
    c = _read("backend/app/core/config.py")
    assert "WEEKLY_INVOICE_EMAILS: Optional[str] = None" in c


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
