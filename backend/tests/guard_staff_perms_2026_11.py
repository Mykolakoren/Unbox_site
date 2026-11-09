"""СТОРОЖ: права сотрудников на чужие брони и пополнение проверяет сервер (09.11).

Ревизия мобильного приложения: галочки «отменять любые брони», «переносить»,
«пересдача», «пополнение баланса» ничего не значили — сервер смотрел только на
роль. Теперь каждое действие с ЧУЖОЙ бронью требует своё право, а зачисление
на баланс клиента — finance.topup_balance. Ролям эти права выдаются по
умолчанию, поэтому нынешние админы работают как раньше.

    python3 backend/tests/guard_staff_perms_2026_11.py
"""
import os
import re

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def _src(rel):
    return open(os.path.join(_ROOT, rel), encoding="utf-8").read()


def _func(src, name):
    m = re.search(rf"^def {name}\(.*?(?=^def |^@router|\Z)", src, re.S | re.M)
    assert m, f"нет функции {name}"
    return m.group(0)


def test_foreign_booking_actions_need_permission():
    src = _src("backend/app/api/v1/bookings/routes.py")
    assert "def _staff_may(" in src
    need = {
        "cancel_booking": "bookings.cancel_any",
        "cancel_recurring_bookings": "bookings.cancel_any",
        "reschedule_booking": "bookings.reschedule_any",
        "reschedule_booking_series": "bookings.reschedule_any",
        "trim_booking": "bookings.reschedule_any",
        "shorten_booking": "bookings.reschedule_any",
        "split_booking": "bookings.reschedule_any",
        "toggle_re_rent": "bookings.manage_rerent",
    }
    missing = [f for f, p in need.items() if f'_staff_may(current_user, "{p}")' not in _func(src, f)]
    assert not missing, f"сервер не проверяет право сотрудника в: {missing}"


def test_topup_needs_topup_permission():
    src = _src("backend/app/api/v1/cashbox/transactions.py")
    body = _func(src, "create_transaction")
    assert 'has_permission(current_user, "finance.topup_balance")' in body, \
        "зачисление на баланс клиента не проверяет право «Пополнение баланса»"


def test_role_defaults_keep_current_admins_working():
    from importlib import util
    spec = util.spec_from_file_location("perm", os.path.join(_ROOT, "backend/app/core/permissions.py"))
    perm = util.module_from_spec(spec)
    spec.loader.exec_module(perm)
    for p in ("bookings.cancel_any", "bookings.reschedule_any", "bookings.manage_rerent", "finance.topup_balance"):
        assert p in perm.ADMIN_DEFAULT_PERMISSIONS, f"админ потерял право по умолчанию {p}"


def test_late_staff_cancel_needs_reason_and_reports_owner():
    """Владелец 09.11: админ может отменить меньше чем за 24 ч, но с причиной,
    записью в историю клиента и сообщением владельцу в Telegram."""
    src = _src("backend/app/api/v1/bookings/routes.py")
    for name in ("_is_staff_rule_override", "_require_override_reason", "_report_rule_override"):
        assert f"def {name}(" in src, f"нет {name}"
    report = _func(src, "_report_rule_override")
    assert "send_owner_summary" in src and "_send_owner_safe" in report, "владелец не получает сообщение"
    assert 'event_type="late_cancel_override"' in report, "нет записи в историю"
    single = _func(src, "cancel_booking")
    assert "_require_override_reason(reason)" in single and "_report_rule_override(" in single
    series = _func(src, "cancel_recurring_bookings")
    assert "_require_override_reason(reason)" in series and "_report_rule_override(" in series
    # проверка причины — ДО возврата денег и удаления события календаря
    assert single.index("_require_override_reason(reason)") < single.index("_refund_booking_to_owner(")
    modal = _src("src/components/admin/AdminCancelBookingModal.tsx")
    assert "lateOverride" in modal and "Причина (увидит владелец)" in modal, "окно отмены не просит причину"


def test_review_fixes_09_11():
    """Ревизоры 09.11: своя бронь сотрудника — без «обхода правил»; причина с
    компьютера доходит до сервера; служебная запись не видна клиенту; режим
    «бронь за клиента» — только по ?admin=1; наличные скрыты и в аналитике/сменах."""
    src = _src("backend/app/api/v1/bookings/routes.py")
    body = _func(src, "_is_staff_rule_override")
    assert "_check_ownership(b, user)" in body, "своя бронь сотрудника требует причину — тупик"
    store = _src("src/store/slices/createBookingSlice.ts")
    assert "reason: _reason" in store, "стор выбрасывает причину отмены"
    tab = _src("src/components/admin/UserBookingsTab.tsx")
    assert "await cancelBooking(id, false, reason" in tab and "может только старший админ" not in tab
    tl = _src("backend/app/api/v1/timeline.py")
    assert "STAFF_ONLY_EVENT_TYPES" in tl and "late_cancel_override" in tl, "клиент видит причину поздней отмены"
    layout = _src("src/pages/mobile/MobileLayout.tsx")
    assert "sp.get('admin') === '1'" in layout, "режим «бронь за клиента» включается без явного признака"
    shifts = _src("backend/app/api/v1/cashbox/shifts.py")
    assert '"current_balance": None if cash_hidden_for(current_user)' in shifts
    assert _func(shifts, "list_shifts").count("cash_hidden_for(current_user)") == 1
    assert "cash_hidden_for(current_user)" in _func(shifts, "get_current_open_shift")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("  ✓", name)
    print("СТОРОЖ staff_perms: OK")
