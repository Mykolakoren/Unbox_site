"""СТОРОЖ: «Отменить» на телефоне = как на компьютере (владелец 08.10).

Раньше (спека 14.05) «Отменить» в мобильной CRM УДАЛЯЛО сессию из CRM и
Google, а на компьютере — ставило статус «Отменил клиент». Теперь одинаково:
статус отмены, сессия остаётся в истории; удалить совсем — отдельной кнопкой
«Записали по ошибке — удалить совсем».

    python3 backend/tests/guard_mobile_cancel_2026_10.py
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def test_mobile_cancel_sets_status():
    s = (ROOT / "src/pages/mobile/crm/SessionActionSheet.tsx").read_text(encoding="utf-8")
    assert "function CancelConfirm(" in s
    body = s[s.index("function CancelConfirm("):s.index("function DeleteConfirm(")]
    assert "onStatus('CANCELLED_CLIENT')" in body and "onStatus('CANCELLED_THERAPIST')" in body
    assert "deleteSession" not in body, "отмена не должна удалять сессию"
    assert "Записали по ошибке — удалить совсем" in body
    assert "onClick={onCancel}" in s and "onClick={onDelete}\n                />\n            </div>" not in s, \
        "плитка «Отменить» снова ведёт прямо в удаление"
    assert "label=\"Вернуть\"" in s, "у отменённой сессии — «Вернуть»"
    d = s[s.index("function DeleteConfirm("):]
    assert "Удалить сессию?" in d and "Удалить только эту сессию" in d


def test_desktop_cancel_unchanged():
    s = (ROOT / "src/pages/crm/CrmSessions.tsx").read_text(encoding="utf-8")
    assert "await onSave({ status: 'CANCELLED_CLIENT' });" in s


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
