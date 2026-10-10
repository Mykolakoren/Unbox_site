"""СТОРОЖ: «Виден / Скрыт» анкеты специалиста пишется в историю (10.10).

Четыре анкеты оказались скрыты, а кто и когда — узнать было нельзя.

    python3 backend/tests/guard_specialist_visibility_log_2026_10.py
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def test_visibility_change_logged():
    s = (ROOT / "backend/app/api/v1/specialists.py").read_text(encoding="utf-8")
    body = s[s.index("_was = (bool(specialist.is_verified)"):s.index('@router.post("/admin/create"')]
    assert 'event_type="specialist_visibility"' in body and "commit=False" in body
    assert body.index("_was =") < body.index("setattr(specialist, key, value)") < body.index("_now =")


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
