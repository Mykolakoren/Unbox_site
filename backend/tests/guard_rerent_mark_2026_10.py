"""СТОРОЖ: «на пересдаче» видно и на неоплаченной брони в шахматке (Егор 09.10).

Красная рамка «к оплате» перекрывала отметку пересдачи — бронь Кариманидзе
09.10 15:00 стояла на пересдаче, а в шахматке выглядела обычной.

    python3 backend/tests/guard_rerent_mark_2026_10.py
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def test_mark_survives_due_style():
    s = (ROOT / "src/components/admin/AdminChessboardView.tsx").read_text(encoding="utf-8")
    style = s[s.index("const getBookingStyle"):s.index("// ── Popup status")]
    i_due = style.index("dueInfo.due > 0")
    assert "b.isReRentListed && b.status === 'confirmed'" in style[i_due:i_due + 600], "красная бронь снова прячет пересдачу"
    assert "border-dashed" in style[i_due:i_due + 600]
    assert s.count("data-rerent-mark") >= 2, "значок «на пересдаче» — в сетке и в списке дня"
    assert "' · на пересдаче'" in s


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
