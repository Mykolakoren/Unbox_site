"""СТОРОЖ: страницы CRM всегда подгружают свежий список клиентов (06.11).

Кейс владельца: новый клиент внесён в Google Календарь → синк завёл карточку и
сессию на сервере. А шахматка CRM грузила клиентов, только если список в памяти
пуст, — нового человека она не знала: встреча в «Сессии без кабинета» без имени,
после «Снять кабинет» бронь подписана «Без клиента», хотя на сервере связь есть.

    python3 backend/tests/guard_crm_fresh_clients_2026_11.py
"""
import os
import re

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")

_FILES = (
    "src/components/crm/CrmChessboardView.tsx",
    "src/pages/crm/CrmBookings.tsx",
    "src/pages/mobile/crm/MobileCrmSessions.tsx",
    "src/pages/mobile/crm/MobileCrmNotes.tsx",
)


def test_crm_pages_refetch_clients_every_visit():
    bad = []
    for rel in _FILES:
        src = open(os.path.join(_ROOT, rel), encoding="utf-8").read()
        assert "fetchClients(" in src, f"{rel}: клиенты больше не грузятся"
        if re.search(r"if\s*\(\s*clients\.length\s*===\s*0\s*\)\s*\{?\s*(setLoadingClients\(true\);\s*)?fetchClients", src):
            bad.append(rel)
    assert not bad, f"клиенты грузятся только при пустом списке (новые из календаря не видны): {bad}"


if __name__ == "__main__":
    test_crm_pages_refetch_clients_every_visit()
    print("СТОРОЖ crm_fresh_clients: OK")
