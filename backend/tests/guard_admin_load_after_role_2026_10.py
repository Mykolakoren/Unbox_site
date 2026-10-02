"""СТОРОЖ · админские экраны грузят полный список броней и клиентов только когда
известна роль вошедшего (02.10).

Случай: у админа в шахматке все брони «Гость · 0 ₾» (обезличенное публичное
расписание), у другого вместо имён почты. Причина: экран монтировался раньше, чем
подгружался currentUser, fetchAllBookings молча отказывался (роль неизвестна),
и повторного запроса не было.

    python3 backend/tests/guard_admin_load_after_role_2026_10.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_chessboard_waits_for_role_and_loads_users():
    src = _read("src/components/admin/AdminChessboardView.tsx")
    assert "const viewerRole = useUserStore(s => s.currentUser?.role);" in src
    i = src.index("const viewerRole = useUserStore(s => s.currentUser?.role);")
    block = src[i:i + 600]
    assert "if (!viewerRole) return;" in block and "fetchAllBookings();" in block and "fetchUsersForNames();" in block
    assert "[viewerRole, fetchAllBookings, fetchResources, fetchUsersForNames]" in block, "эффект не перезапускается при появлении роли"


def test_dashboard_waits_for_role():
    src = _read("src/pages/admin/Dashboard.tsx")
    assert "if (!viewerRole) return;" in src and "[viewerRole, fetchUsers, load]" in src


def test_bookings_list_waits_for_role():
    src = _read("src/pages/admin/Bookings.tsx")
    assert "if (!viewerRole || viewMode !== 'list' || allListStatus === 'ready') return;" in src
    assert "[viewMode, viewerRole]" in src


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("СТОРОЖ загрузка после роли 2026-10: OK" if not failures else f"СТОРОЖ загрузка после роли 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
