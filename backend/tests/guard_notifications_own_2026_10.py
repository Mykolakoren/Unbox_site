"""СТОРОЖ: уведомления видит любой вошедший — но только свои (10.10).

CRM и «Слежу за слотами» пишут уведомления специалистам и клиентам; ручки
были «только админ» → 403, колокольчик в кабинете специалиста молчал.

    python3 backend/tests/guard_notifications_own_2026_10.py
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def test_any_user_own_only():
    s = (ROOT / "backend/app/api/v1/notifications.py").read_text(encoding="utf-8")
    assert "require_admin" not in s, "уведомления снова только для админов"
    assert s.count("Depends(deps.get_current_user)]") == 4
    for fn in re.split(r"\n@router\.", s)[1:]:
        assert "recipient_id" in fn, "каждая ручка обязана фильтровать по получателю"


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
