"""СТОРОЖ волны 0, пакет C — мобильная админка (/m/admin).

Что чинили 29.09 и что не должно вернуться:

  G9-02 / X5-M1  Дашборд брал обезличенное публичное расписание: в «Сегодня»
                 не было имён, шторка брони показывала «0 ₾», «Цена» →
                 «Сохранить» обнуляла стоимость (клиенту возвращалась вся
                 сумма), «Удалить» всегда возвращала 100%. И этот урезанный
                 список затирал полные данные вкладки «Брони».
  G9-01 / X1-M1  Нижнее меню (zIndex 100) закрывало главную кнопку в шторках
                 «Пополнить баланс», «Новая операция», «Закрыть кабинет».
  G9-03          Итоги кассы за неделю/месяц считались по последним 100
                 операциям, а «корректировки» (недельная скидка, правка
                 баланса) шли как настоящие деньги.

Без сети и без боевой базы: сводку кассы гоняем на SQLite в памяти, фронт
проверяем чтением исходников.

    python3 backend/tests/guard_wave0_c.py
"""
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

BACKEND = os.path.join(os.path.dirname(__file__), "..")
FRONT = os.path.join(BACKEND, "..", "src")
ADMIN_M = os.path.join(FRONT, "pages", "mobile", "admin")


def _read(*parts):
    return open(os.path.join(*parts), encoding="utf-8").read()


def _memory_session():
    """Пустая SQLite в памяти только с таблицей кассы."""
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, create_engine
    from app.models.cashbox_transaction import CashboxTransaction
    from app.models.expense_category import ExpenseCategory

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    ExpenseCategory.__table__.create(engine)
    CashboxTransaction.__table__.create(engine)
    return Session(engine)


def _tx(type_, amount, method="cash", branch="Unbox One", when=datetime(2026, 9, 10, 12, 0)):
    from app.models.cashbox_transaction import CashboxTransaction
    return CashboxTransaction(
        type=type_, amount=amount, payment_method=method, branch=branch,
        date=when, admin_id="guard", admin_name="guard",
    )


def _summary(session, date_from=None, date_to=None, branch=None):
    from app.api.v1.cashbox.transactions import get_period_summary
    # Зовём как обычную функцию — все параметры явно (иначе в них попадут
    # объекты Query(...) из сигнатуры).
    return get_period_summary(
        session=session, current_user=None,
        date_from=date_from, date_to=date_to, branch=branch,
    )


# ─────────────────────────────────────────────────────────────────────────
# G9-03 — итоги кассы: все операции периода, корректировки не деньги.
# ─────────────────────────────────────────────────────────────────────────

def test_summary_counts_all_rows_not_last_100():
    """150 приходов по 10 ₾ = 1500 ₾. Телефон раньше видел только 100 строк
    и показывал 1000 ₾ — итог месяца молча занижался."""
    s = _memory_session()
    for _ in range(150):
        s.add(_tx("income", 10))
    s.add(_tx("expense", 40))
    s.commit()
    r = _summary(s)
    assert r["income"] == 1500, f"доход {r['income']} — считаются не все операции"
    assert r["expense"] == 40
    assert r["net"] == 1460
    assert r["count"] == 151


def test_summary_excludes_adjustments_from_money():
    """Недельная скидка (expense/adjustment) и ручная правка баланса
    (income/adjustment) — не деньги в кассе. В итоги не входят, но видны
    отдельной строкой."""
    s = _memory_session()
    s.add(_tx("income", 100))
    s.add(_tx("expense", 30, method="card_tbc"))
    s.add(_tx("expense", 12.5, method="adjustment", branch=None))  # недельная скидка
    s.add(_tx("income", 50, method="adjustment", branch=None))     # правка баланса
    s.commit()
    r = _summary(s)
    assert r["income"] == 100, f"корректировка попала в доход: {r['income']}"
    assert r["expense"] == 30, f"недельная скидка попала в расход: {r['expense']}"
    assert r["net"] == 70
    assert r["adjustment_income"] == 50
    assert r["adjustment_expense"] == 12.5
    assert r["adjustment_count"] == 2


def test_summary_period_and_branch_filters():
    """Период режется по датам, филиал — на сервере (а не после обрезки
    ленты на телефоне)."""
    s = _memory_session()
    s.add(_tx("income", 10, when=datetime(2026, 8, 31, 23, 0)))                 # до периода
    s.add(_tx("income", 20, when=datetime(2026, 9, 1, 1, 0)))                   # в периоде
    s.add(_tx("income", 40, branch="Unbox Uni", when=datetime(2026, 9, 2)))     # другой филиал
    s.add(_tx("income", 80, when=datetime(2026, 10, 1, 0, 30)))                 # после периода
    s.commit()
    r = _summary(s, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z")
    assert r["income"] == 60, f"период не режется: {r['income']}"
    r = _summary(s, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z", branch="Unbox One")
    assert r["income"] == 20, f"филиал не фильтруется: {r['income']}"


def test_summary_date_parsing_z_and_bad_input():
    """Телефон шлёт toISOString() с 'Z' — до Python 3.11 fromisoformat его не
    понимал и фильтр по дате молча выключался (итог «за всё время»). Теперь
    'Z' → UTC, а кривая дата — честная ошибка 400, не тихий итог без периода."""
    from fastapi import HTTPException
    from app.api.v1.cashbox.transactions import _parse_range_bound
    assert _parse_range_bound("2026-09-28T20:00:00.000Z") == datetime(2026, 9, 28, 20, 0)
    # Смещение +04:00 (Тбилиси) приводится к наивному UTC — так даты в базе.
    assert _parse_range_bound("2026-09-29T00:00:00+04:00") == datetime(2026, 9, 28, 20, 0)
    assert _parse_range_bound(None) is None
    try:
        _parse_range_bound("вчера")
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("кривая дата проглочена молча")


def test_list_transactions_accepts_branch():
    """Лента кассы умеет ?branch= (старые вызовы без него работают как раньше)."""
    from app.api.v1.cashbox.transactions import list_transactions
    s = _memory_session()
    s.add(_tx("income", 5, branch="Unbox One"))
    s.add(_tx("income", 7, branch="Unbox Uni"))
    s.commit()
    kw = dict(session=s, current_user=None, date_from=None, date_to=None, type=None,
              category_id=None, payment_method=None, skip=0, limit=50)
    assert len(list_transactions(branch=None, **kw)) == 2
    rows = list_transactions(branch="Unbox Uni", **kw)
    assert [r.amount for r in rows] == [7], f"филиал не отфильтрован: {rows}"


def test_mobile_finance_uses_server_summary():
    """Экран берёт итоги с сервера; запасной счёт по ленте тоже пропускает
    корректировки; у корректировки есть русская подпись."""
    src = _read(ADMIN_M, "MobileAdminFinance.tsx")
    assert "getPeriodSummary(" in src, "итоги снова считаются по ленте из 100 строк"
    assert "adjustment: 'Корректировка (не деньги)'" in src, "нет подписи для корректировки"
    assert "paymentMethod === 'adjustment'" in src, "запасной счёт считает корректировки деньгами"
    api = _read(FRONT, "api", "cashbox.ts")
    assert "'/cashbox/summary'" in api


# ─────────────────────────────────────────────────────────────────────────
# G9-02 / X5-M1 — шторка брони на дашборде.
# ─────────────────────────────────────────────────────────────────────────

def test_dashboard_loads_full_admin_bookings():
    """Дашборд грузит полный админский список (/bookings), а не /me+/public:
    иначе нет имён и цен, и урезанный список затирает данные «Броней»."""
    src = _read(ADMIN_M, "MobileAdminDashboard.tsx")
    code = re.sub(r"//[^\n]*", "", src)  # комментарии могут упоминать старый путь
    assert "fetchAllBookings()" in code, "дашборд не грузит полный список броней"
    assert not re.search(r"\bfetchBookings\b", code), "дашборд снова зовёт fetchBookings (/public без имён и цен)"
    assert "{b.userId}" not in src, "в «Сегодня» снова выводится сырой userId вместо имени"


def test_dashboard_uses_shared_booking_sheets():
    """Одна и та же шторка на дашборде и в «Бронях»: своя шторка дашборда
    с «Цена» = 0 и «Удалить» без выбора возврата не должна вернуться."""
    dash = _read(ADMIN_M, "MobileAdminDashboard.tsx")
    books = _read(ADMIN_M, "MobileAdminBookings.tsx")
    assert "<AdminBookingSheets" in dash and "<AdminBookingSheets" in books
    assert "BookingActionSheet" not in dash, "вернулась отдельная шторка дашборда"
    assert "cancelBooking(" not in dash and "setPrice(" not in dash, \
        "дашборд снова сам отменяет/меняет цену в обход общих шторок"


def test_shared_sheets_guard_money_actions():
    """Отмена — с выбором 100/50/0 и долей 0..1 для бэка; смена цены не
    сохраняется без изменения; по обезличенной строке (нет userId) ни
    отменить, ни сменить цену нельзя."""
    src = _read(ADMIN_M, "bookingSheets.tsx")
    assert "[100, 50, 0]" in src, "пропал выбор возврата 100/50/0"
    assert "refundPercent: refundPercent / 100" in src, "процент возврата не переводится в долю"
    assert "num !== current" in src, "«Сохранить» снова активна без изменения цены"
    assert "needsFullData(b)) return;" in src and src.count("needsFullData(b)) return;") >= 2, \
        "отмену/цену снова можно открыть по обезличенной брони с ложным «0 ₾»"


# ─────────────────────────────────────────────────────────────────────────
# G9-01 / X1-M1 — нижнее меню поверх шторок.
# ─────────────────────────────────────────────────────────────────────────

def _z_value(token, consts):
    token = token.strip()
    if token.isdigit():
        return int(token)
    return consts.get(token)


def test_sheet_layers_above_tabbar():
    layers = _read(ADMIN_M, "sheetLayers.ts")
    consts = {m.group(1): int(m.group(2))
              for m in re.finditer(r"export const (Z_\w+) = (\d+);", layers)}
    assert consts["Z_SHEET"] > consts["Z_TABBAR"], "шторка не выше нижнего меню"
    assert consts["Z_SHEET_OVER_SHEET"] > consts["Z_SHEET"]
    layout = _read(ADMIN_M, "MobileAdminLayout.tsx")
    assert "zIndex: Z_TABBAR" in layout, "меню ушло со шкалы слоёв"


def test_admin_overlays_never_under_tabbar():
    """Любой полноэкранный оверлей мобильной админки (position fixed +
    inset 0) должен быть выше нижнего меню. Так пропадали «Пополнить»,
    «Сохранить» и «Закрыть кабинет»."""
    layers = _read(ADMIN_M, "sheetLayers.ts")
    consts = {m.group(1): int(m.group(2))
              for m in re.finditer(r"export const (Z_\w+) = (\d+);", layers)}
    tabbar = consts["Z_TABBAR"]
    bad = []
    for name in sorted(os.listdir(ADMIN_M)):
        if not name.endswith(".tsx") or name == "MobileAdminLayout.tsx":
            continue
        src = _read(ADMIN_M, name)
        for m in re.finditer(r"inset: 0", src):
            window = src[m.end():m.end() + 400]
            z = re.search(r"zIndex: ([\w]+)", window)
            if not z:
                continue
            val = _z_value(z.group(1), consts)
            if val is None or val <= tabbar:
                line = src[:m.start()].count("\n") + 1
                bad.append(f"{name}:{line} zIndex {z.group(1)}")
    assert not bad, "оверлей под нижним меню: " + ", ".join(bad)


def test_three_sheets_keep_cta_visible():
    """У трёх шторок главная кнопка в прилипающем низу, а сама шторка
    ограничена по высоте и прокручивается внутри."""
    for name, cta in (("MobileAdminUsers.tsx", "Пополнить на"),
                      ("MobileAdminFinance.tsx", "Сохранить"),
                      ("MobileAdminCabinets.tsx", "Закрыть кабинет\n")):
        src = _read(ADMIN_M, name)
        assert "zIndex: Z_SHEET" in src, f"{name}: шторка не на слое Z_SHEET"
        assert "maxHeight: SHEET_MAX_HEIGHT" in src, f"{name}: нет ограничения высоты"
        i = src.find("<div style={SHEET_FOOTER}>")
        assert i != -1, f"{name}: главная кнопка не в прилипающем низу"
        assert cta in src[i:i + 2500], f"{name}: «{cta.strip()}» не внутри SHEET_FOOTER"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ✓ {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  ✗ {name}: {exc}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"  ✗ {name}: {exc!r}")
    print("СТОРОЖ C: OK" if not failures else f"СТОРОЖ C УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
