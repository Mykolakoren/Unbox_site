"""СТОРОЖ · «откуда оплата» в попапе брони (02.10).

Причина: у Тамрико бронь стояла «оплачено», а свежего платежа не было — деньги
списаны с баланса, внесённого в июле. Админ искала платёж и приняла лишние 30 ₾.
Теперь в попапе брони (BookingMoneyHints — общий для обеих панелей шахматки)
есть строка «Оплата»: «Оплачено с баланса 30 сент. · 30 ₾» / «Списано часами
абонемента …» / «Спишется с баланса за 24 ч до начала» / «Штраф снят».

Что держит: строка есть в BookingMoneyHints и не дублируется в AdminChessboardView;
тексты по способам оплаты; обслуживание (service) строки не получает.

    python3 backend/tests/guard_payment_source_2026_10.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_hints_has_payment_source_line():
    src = _read("src/components/admin/BookingMoneyHints.tsx")
    assert "export function paymentSourceLine(" in src, "paymentSourceLine пропал"
    assert "const payLine = paymentSourceLine(booking, due);" in src, "строка «Оплата» не считается"
    assert '<span className="text-ink-60 shrink-0">Оплата</span>' in src, "строка «Оплата» не рисуется"
    for text in ("Оплачено с баланса", "Списано часами абонемента", "Оплачено бонусным часом",
                 "Спишется с баланса за 24 ч до начала", "Штраф снят"):
        assert text in src, f"нет текста «{text}»"
    assert "method === 'service'" in src, "обслуживание не должно получать строку об оплате"
    assert "paymentSourceLine(booking, due)" in src, "строка об оплате не знает про долг клиента"
    assert "клиент ещё не оплатил" in src, "списано в долг (баланс в минусе) не должно называться «Оплачено с баланса»"


def test_chessboard_does_not_duplicate_payment_row():
    src = _read("src/components/admin/AdminChessboardView.tsx")
    assert 'label="Оплата"' not in src, "в AdminChessboardView снова своя строка «Оплата» — задвоится с BookingMoneyHints"


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
    print("СТОРОЖ откуда оплата 2026-10: OK" if not failures else f"СТОРОЖ откуда оплата 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
