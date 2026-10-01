"""СТОРОЖ · точные цены в личном кабинете клиента (01.10).

Причина: у клиентки цена брони 32,5 ₾ показывалась как «33 ₾» (formatGel с
fraction: 0 округляет до целого), админы объясняли «сайт округляет». Цена,
которую платит клиент, должна совпадать с той, что видит админ, до копейки.

Что ловит: цена брони, баланс и расшифровка цены в личном кабинете
(MyBookingsPage, SpecialistPortalHero) и итог серии в мастере брони
(ConfirmationStep) показываются без fraction: 0. Итоги-ориентиры («≈ всего»)
и аналитика могут округлять — они здесь не проверяются.

    python3 backend/tests/guard_exact_prices_2026_10.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

# Файлы, где показывается точная сумма, которую платит/видит клиент.
EXACT_FILES = [
    "src/pages/MyBookingsPage.tsx",
    "src/components/landing/SpecialistPortalHero.tsx",
]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_client_cabinet_prices_not_rounded():
    for rel in EXACT_FILES:
        src = _read(rel)
        bad = [m.group(0) for m in re.finditer(r"formatGel\([^()]*fraction: 0[^()]*\)", src)]
        assert not bad, f"{rel}: цена округляется до целого лари (32,5 → 33): {bad[:2]}"


def test_series_total_toast_exact():
    src = _read("src/components/Wizard/ConfirmationStep.tsx")
    i = src.find("Серия создана")
    assert i != -1, "тост «Серия создана» пропал"
    line = src[i:i + 300]
    assert "fraction: 0" not in line.split("\n")[0], "итог серии в тосте снова округляется"


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
    print("СТОРОЖ точные цены 2026-10: OK" if not failures else f"СТОРОЖ точные цены 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
