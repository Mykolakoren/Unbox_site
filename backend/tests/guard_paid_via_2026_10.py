"""СТОРОЖ «Чем оплачено» в таблице броней + «Карточка клиента» из панели брони (владелец 06.10).

Сервер (/balance-allocation/paid-via) по раскладке ленты говорит, какие деньги
заплатили за бронь: «наличные в кассу», «на счёт TBC/BOG», «часы абонемента»,
«бонус», «в долг N ₾». Таблица показывает подпись под значком оплаты; имя
клиента в панели брони (шахматка) ведёт в карточку клиента.

    python3 backend/tests/guard_paid_via_2026_10.py
"""
import importlib.util, pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _module():
    p = ROOT / "backend/app/services/balance_allocation.py"
    spec = importlib.util.spec_from_file_location("ba_guard_paid_via", p)
    m = importlib.util.module_from_spec(spec)
    sys.modules["ba_guard_paid_via"] = m  # dataclass ищет модуль в sys.modules
    spec.loader.exec_module(m)
    return m


def test_labels_by_method():
    m = _module()
    src = lambda kind, detail=None: {"kind": kind, "detail": detail}
    assert m.paid_via_label([src("topup", "наличные")], 0) == ["наличные в кассу"]
    assert m.paid_via_label([src("topup", "TBC")], 0) == ["на счёт TBC"]
    assert m.paid_via_label([src("topup", "BOG")], 0) == ["на счёт BOG"]
    assert m.paid_via_label([src("topup")], 0) == ["оплата на баланс"], "пополнение без способа — не выдумываем"
    assert m.paid_via_label([src("weekly_rebate", "21.09–27.09"), src("topup", "наличные"), src("topup", "наличные")], 0) \
        == ["скидка за неделю", "наличные в кассу"], "без повторов, в порядке траты"
    assert m.paid_via_label([], 15) == ["в долг 15 ₾"]
    assert m.paid_via_label([src("topup", "TBC")], 2.5) == ["на счёт TBC", "в долг 2.5 ₾"]


def test_endpoint_read_only_and_guarded():
    s = _read("backend/app/api/v1/balance_allocation.py")
    assert '@router.get("/balance-allocation/paid-via")' in s
    body = s[s.index('"/balance-allocation/paid-via"'):]
    assert "Depends(require_clients_view)" in body, "право — как у сводки (админ + crm.view_clients)"
    svc = _read("backend/app/services/balance_allocation.py")
    body = svc[svc.index("def paid_via("):]
    assert "session.add(" not in body and "commit(" not in body, "только чтение"
    assert "PAID_VIA_MAX_IDS" in body and "except ValueError" in body, "лимит id и мусор в запросе — не 500"
    assert '"часы абонемента"' in body and '"бонус"' in body and '"без оплаты"' in body


def test_table_shows_paid_via():
    s = _read("src/pages/admin/Bookings.tsx")
    assert "function PaidViaNote(" in s
    assert s.count("<PaidViaNote item={paidVia.get(booking.id)} />") == 2, "и таблица, и карточки на телефоне"
    assert "usePaidVia(visibleIds, storeUsers, bookings)" in s, "запрос — только за видимые строки"
    h = _read("src/hooks/useBalanceAllocation.ts")
    assert "export function usePaidVia(" in h
    a = _read("src/api/balanceAllocation.ts")
    assert "i += 200" in a, "длинный список — кусками по 200 (лимит сервера)"


def test_booking_panel_links_to_client():
    s = _read("src/components/admin/AdminChessboardView.tsx")
    assert "const openClient = (userId" in s
    assert "navigate(`/admin/users/${encodeURIComponent(userId)}`)" in s
    assert s.count("onClick={() => openClient(selectedBooking.userId)}") == 2, "панель справа и попап на узком экране"
    assert s.count("Карточка клиента →") == 2


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
