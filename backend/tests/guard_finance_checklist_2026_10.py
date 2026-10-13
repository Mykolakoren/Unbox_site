"""СТОРОЖ: «Финансы» — чек-лист смены и защита от опечатки в сумме (13.10).

1. Владелец 13.10: при входе в «Финансы» раз в день — окно с чек-листом; если
   админ отметил галочки — сегодня больше не показывать. Раньше окно можно было
   закрыть «Принято, больше не показывать» без единой галочки, день считался по
   UTC (менялся в 04:00 по Тбилиси), на телефоне окна не было.
2. Михаил Стефанович 13.10: «Принять оплату» записала 2020 ₾ при долге 20 —
   теперь сумма сильно больше ожидаемой переспрашивается (компьютер и телефон).

    python3 backend/tests/guard_finance_checklist_2026_10.py
"""
import os
import re
import sys

_REPO = os.path.join(os.path.dirname(__file__), "..", "..")


def _src(rel):
    return open(os.path.join(_REPO, rel), encoding="utf-8").read()


def test_checklist_needs_all_ticks_and_tbilisi_day():
    m = _src("src/components/admin/cashbox/MorningChecklistModal.tsx")
    assert "batumiDayKey()" in m and "toISOString().slice(0, 10)" not in m, "день чек-листа — по Тбилиси"
    ack = m[m.index("const handleAcknowledge"):m.index("const handleAcknowledge") + 200]
    assert "if (!allDone) return;" in ack, "«больше не показывать» — только когда отмечены все пункты"
    assert "disabled={!allDone}" in m
    assert "Принято, больше не показывать сегодня" not in m
    assert len(re.findall(r"\{ key: '", m)) >= 5


def test_checklist_on_desktop_and_phone():
    assert "<MorningChecklistModal adminEmail={currentUser.email} />" in _src("src/pages/admin/Finance.tsx")
    assert "<MorningChecklistModal adminEmail={currentUser.email} />" in _src("src/pages/mobile/admin/MobileAdminFinance.tsx")


def test_topup_typo_guard():
    g = _src("src/utils/topupGuard.ts")
    assert "value >= Math.max(exp * 5, exp + 100)" in g and "BIG_TOPUP_GEL = 500" in g
    a = _src("src/components/admin/modals/AddFundsModal.tsx")
    assert "topupLooksLikeTypo(value, defaultAmount) && confirmFor !== value" in a
    i = a.index("topupLooksLikeTypo(value, defaultAmount)")
    assert i < a.index("onConfirm(value, method, branch || undefined);"), "вопрос — до записи"
    t = _src("src/pages/mobile/admin/TopupSheet.tsx")
    assert "topupLooksLikeTypo(value, expected) && confirmFor !== value" in t
    assert t.index("topupLooksLikeTypo(value, expected)") < t.index("await createIncomeWithDuplicateGuard("), "вопрос — до записи"


if __name__ == "__main__":
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:300]}")
    sys.exit(1 if fails else 0)
