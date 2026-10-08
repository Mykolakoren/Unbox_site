"""СТОРОЖ: фильтр по филиалу в списке броней админки (владелец 06.10).

Кнопки «Все филиалы / Unbox One / Unbox Uni / …» над таблицей; филиал брони —
из брони, у старых броней без него — по кабинету; выбор помнится на компьютере.

    python3 backend/tests/guard_bookings_branch_filter_2026_10.py
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def test_branch_filter_in_list():
    s = (ROOT / "src/pages/admin/Bookings.tsx").read_text(encoding="utf-8")
    assert "data-branch-filter" in s and "'Все филиалы'" in s
    assert "if (branchFilter !== 'all' && bookingBranch(b) !== branchFilter) return false;" in s
    assert "b.locationId || RESOURCES.find(r => r.id === b.resourceId)?.locationId" in s, "старые брони — по кабинету"
    assert "localStorage.getItem('admin.bookings.branch')" in s and "try {" in s
    assert "[filterStatus, timeFilter, search, branchFilter" in s, "смена филиала — снова первые 50"


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
