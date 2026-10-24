"""СТОРОЖ: UX топ-5 (24.10).

1. «Пересдать» везде спрашивает подтверждение (денежное действие: займут
   время — клиенту 50 %). Снять с пересдачи — сразу.
2. Оплата на телефоне: «не хватает N ₾» видно ДО нажатия, кнопка не обещает
   «уйдёт в долг», если лимит не позволяет.
3. Оплата: время уже началось / его заняли — видно сразу, кнопка не жмётся.
   Заявка на одобрении тоже держит время.
4. Ошибки сервера — через toastApiError (понятный текст, без «[object Object]»
   и без двойных уведомлений), а не toast.error(e.response.data.detail || …).
5. Хуки React — до ранних return во всём src (ревизия 24.10 поймала: счётчик
   времени после `if (done) return` ронял экран «Готово» после каждой брони;
   tsc и vite build такое пропускают). eslint.hooks.config.js, ~4 с.

    python3 backend/tests/guard_ux_top5_2026_10.py
"""
import os
import re
import subprocess
import sys

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _src(rel):
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def _fn(src, start, size=900):
    i = src.index(start)
    return src[i:i + size]


def test_rerent_always_confirmed():
    cb = _fn(_src("src/components/admin/AdminChessboardView.tsx"), "const handleToggleReRent = async")
    assert "!b.isReRentListed && !(await confirm(" in cb
    ms = _fn(_src("src/pages/mobile/admin/bookingSheets.tsx"), "const doToggleReRent = async")
    assert "!b.isReRentListed && !(await confirm(" in ms
    cs = _fn(_src("src/pages/mobile/BookingDetailSheet.tsx"), "async function doToggleReRent()")
    assert "!booking.isReRentListed && !(await confirm(" in cs
    assert "confirm(" in _fn(_src("src/pages/admin/Bookings.tsx"), "const handleReRent = async")
    assert "setModalConfig(" in _fn(_src("src/pages/MyBookingsPage.tsx"), "const handleReRent = (id: string)")
    assert "void askReRent(b)" in _src("src/pages/mobile/MobileMyBookings.tsx")


def test_checkout_shows_shortfall_and_slot_problems_early():
    s = _src("src/pages/mobile/MobileCheckout.tsx")
    assert "const overLimitBy =" in s and "Не хватает ${formatGel(overLimitBy)} — пополните баланс" in s
    assert "overLimitBy === 0 && (() =>" in s, "строка «уйдёт в долг» не должна показываться при нехватке сверх лимита"
    assert "const slotProblem" in s and "Это время уже началось" in s and "Это время уже заняли" in s
    assert "(overLimitBy > 0 || !!slotProblem) && !needsApplication" in s, "кнопка должна быть недоступна"
    assert "b.status === 'pending_approval'" in s[s.index("const dayBusy"):s.index("const dayBusy") + 600]


def test_no_raw_detail_toasts():
    out = subprocess.run(["grep", "-rn", r"toast.error(.*response?.data?.detail", os.path.join(_REPO, "src")],
                         capture_output=True, text=True).stdout.strip()
    assert not out, "сырые detail-тосты вернулись (нужен toastApiError):\n" + out[:800]
    bare = subprocess.run(["grep", "-rn", "toastApiError([a-z]*, 'Ошибка')", os.path.join(_REPO, "src")],
                          capture_output=True, text=True).stdout.strip()
    assert not bare, "пустое «Ошибка» вместо «Не удалось …»:\n" + bare[:500]


def test_rules_of_hooks_whole_src():
    import shutil
    if not shutil.which("npx"):
        print("    (npx нет — проверка хуков пропущена)")
        return
    r = subprocess.run(["npx", "eslint", "-c", "eslint.hooks.config.js", "src"], cwd=_REPO,
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, "хук после раннего return / в условии — экран упадёт:\n" + (r.stdout + r.stderr)[-1500:]


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:500]}")
    sys.exit(1 if fails else 0)
