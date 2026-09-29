"""СТОРОЖ wave0-G — админские окна и деньги (аудит 29.09).

Что ловит:
  G7-admin-core-M1 — отмена брони из серии: системный confirm, где «ОК»
                     отменял ВСЮ серию, а выбранный штраф 50% / 0% к серии не
                     применялся (сервер всегда возвращал 100%).
  G7-04            — цена брони, сброс пароля и склейка аккаунтов через
                     prompt()/confirm(): «22,5» сохранялось как 22, пароль
                     набирался открытым текстом, email дубликата — вслепую.
  G7-03            — карточка клиента: «Общая сумма оплат 0.00 ₾» у всех
                     (читали total_paid, а после toCamelCase приходит totalPaid).
  G7-admin-core-M2 — итоги кассы менялись от фильтра журнала «Приходы/Расходы»,
                     корректировки считались деньгами, лимит 200 операций.

Без сети и без базы:

    python3 backend/tests/guard_wave0_G.py
"""
import os
import sys
import pathlib
from datetime import datetime, timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _fn_body(src: str, start: str, end: str) -> str:
    i = src.find(start)
    assert i != -1, f"не нашёл {start!r}"
    j = src.find(end, i + len(start))
    return src[i:j if j != -1 else len(src)]


# ─────────────────────────────────────────────────────────────────────────
# G7-admin-core-M1 — сервер: отмена серии применяет процент возврата админа.
# ─────────────────────────────────────────────────────────────────────────

class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeSession:
    """Первый exec — брони серии, дальше (привязанные CRM-сессии) — пусто."""

    def __init__(self, rows):
        self._rows = rows
        self._calls = 0

    def exec(self, _stmt):
        self._calls += 1
        return _FakeResult(self._rows if self._calls == 1 else [])

    def add(self, _obj):
        pass

    def commit(self):
        pass

    def get(self, *_a, **_k):
        return None


def _series(n=3, owner_email="client@x.ge"):
    base = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=10)
    return [
        SimpleNamespace(
            id=f"b{i}", user_uuid=None, user_id=owner_email, gcal_event_id=None,
            status="confirmed", payment_method="subscription", resource_id="r1",
            date=base + timedelta(days=7 * i), start_time="10:00", duration=60,
            cancellation_reason=None, cancelled_by=None,
        )
        for i in range(n)
    ]


def _run_series_cancel(actor, rows, refund_percent, reason=None):
    import app.api.v1.bookings.routes as R
    calls = []
    orig_refund, orig_owner = R._refund_booking_to_owner, R._resolve_booking_owner
    R._resolve_booking_owner = lambda s, b: SimpleNamespace(id="owner", email=b.user_id)
    R._refund_booking_to_owner = (
        lambda s, b, o, refund_percent=1.0: calls.append(refund_percent) or {}
    )
    try:
        res = R.cancel_recurring_bookings(
            group_id="g1", from_booking_id=None,
            refund_percent=refund_percent, reason=reason,
            session=_FakeSession(rows), current_user=actor,
        )
    finally:
        R._refund_booking_to_owner, R._resolve_booking_owner = orig_refund, orig_owner
    return res, calls


def test_series_cancel_applies_admin_penalty():
    """Админ выбрал «штраф 50%» для серии — каждая бронь возвращается на 50%,
    а не на 100%, и в причине отмены виден процент."""
    admin = SimpleNamespace(id="a1", email="admin@x.ge", role="admin", name="Админ")
    rows = _series(3)
    res, calls = _run_series_cancel(admin, rows, 0.5, reason="не пришёл")
    assert calls == [0.5, 0.5, 0.5], f"серия вернула не 50%: {calls}"
    assert res["cancelled"] == 3 and res["refund_percent"] == 0.5
    assert all(b.status == "cancelled" for b in rows)
    assert rows[0].cancellation_reason == "не пришёл (50% возврат)", rows[0].cancellation_reason


def test_series_cancel_full_penalty_refunds_nothing():
    """«Полный штраф · 0%» — как в одиночной отмене: возврата нет вовсе."""
    admin = SimpleNamespace(id="a1", email="admin@x.ge", role="admin", name="Админ")
    rows = _series(2)
    res, calls = _run_series_cancel(admin, rows, 0.0, reason="no-show")
    assert calls == [], f"при штрафе 0% серия всё равно вернула деньги: {calls}"
    assert res["cancelled"] == 2


def test_series_cancel_default_and_client_stay_full_refund():
    """Старые вызовы (без процента) и клиенты — всегда 100%, клиент штраф
    себе не выставит и не отменит без возврата."""
    admin = SimpleNamespace(id="a1", email="admin@x.ge", role="admin", name="Админ")
    _, calls = _run_series_cancel(admin, _series(2), 1.0)
    assert calls == [1.0, 1.0], calls
    client = SimpleNamespace(id="c1", email="client@x.ge", role="user", name="Клиент")
    rows = _series(2, owner_email="client@x.ge")
    _, calls = _run_series_cancel(client, rows, 0.0)
    assert calls == [1.0, 1.0], f"клиент выставил себе возврат не 100%: {calls}"
    assert rows[0].cancellation_reason == "Series cancelled"


# ─────────────────────────────────────────────────────────────────────────
# G7-admin-core-M1 — фронт: без системного confirm, якорь + процент уходят.
# ─────────────────────────────────────────────────────────────────────────

def test_admin_cancel_dialogs_pass_scope_anchor_and_refund():
    api = _read("src/api/bookings.ts")
    body = _fn_body(api, "cancelRecurringSeries: async (", "extendRecurringSeries")
    assert "params.refund_percent = opts.refundPercent" in body, \
        "отмена серии снова не передаёт процент возврата"

    lst = _read("src/pages/admin/Bookings.tsx")
    h = _fn_body(lst, "const handleCancel = (bookingId: string)", "const handleCancelConfirm")
    assert "window.confirm(" not in h, "список броней снова спрашивает серию системным confirm"
    c = _fn_body(lst, "const handleCancelConfirm", "const handleReRent")
    assert "cancelModal.seriesGroupId, cancelModal.bookingId" in c, \
        "отмена серии из списка без якоря — отменит и более ранние брони"
    assert "{ refundPercent, reason" in c, "выбранный штраф снова не доходит до отмены серии"
    assert "series={cancelModal.series}" in lst

    cb = _read("src/components/admin/AdminChessboardView.tsx")
    assert "confirm('Отменить это бронирование?')" not in cb, \
        "шахматка снова отменяет бронь системным confirm без выбора возврата"
    assert "<CancelBookingChoiceModal" not in cb
    assert "target.recurringGroupId, target.id," in cb and "{ refundPercent, reason" in cb

    modal = _read("src/components/admin/AdminCancelBookingModal.tsx")
    assert "useState<CancelScope>('single')" in modal, \
        "окно отмены должно по умолчанию отменять ТОЛЬКО эту бронь"
    assert "(x.status === 'confirmed' && bookingDayKey(x) >= from)" in modal, \
        "подсчёт «эту и все следующие» разошёлся с сервером (якорь по дате)"


# ─────────────────────────────────────────────────────────────────────────
# G7-04 — цена с запятой, пароль без prompt, склейка с предпросмотром.
# ─────────────────────────────────────────────────────────────────────────

def _parse_money_like_front(raw: str):
    """Копия parseMoneyInput из BookingPriceModal.tsx — проверяем поведение."""
    import re
    v = re.sub(r"\s+", "", raw.strip()).replace(",", ".", 1)
    if not re.fullmatch(r"\d+(\.\d{1,2})?", v):
        return None
    return float(v)


def test_price_edit_accepts_decimal_comma():
    modal = _read("src/components/admin/BookingPriceModal.tsx")
    assert ".replace(',', '.')" in modal and "inputMode=\"decimal\"" in modal, \
        "поле цены снова режет «22,5» до 22"
    assert _parse_money_like_front("22,5") == 22.5
    assert _parse_money_like_front(" 36 ") == 36.0
    assert _parse_money_like_front("22,5,1") is None
    assert _parse_money_like_front("-5") is None

    cb = _read("src/components/admin/AdminChessboardView.tsx")
    assert "prompt(`Новая цена" not in cb, "цена в шахматке снова через prompt()"
    assert "<BookingPriceModal" in cb
    lst = _read("src/pages/admin/Bookings.tsx")
    assert "<BookingPriceModal" in lst and "parseFloat(val)" not in lst
    assert "prompt('На сколько повторений продлить серию?'" not in cb, \
        "продление серии снова через prompt — Enter создаёт 8 броней"


def test_password_reset_and_merge_use_dialogs():
    ud = _read("src/pages/admin/UserDetails.tsx")
    assert "prompt('Новый пароль" not in ud and "prompt('Подтвердите новый пароль" not in ud, \
        "пароль клиента снова вводится открытым текстом в prompt()"
    assert "Введите email или UUID поглощаемого" not in ud, \
        "склейка снова через email вслепую, без предпросмотра"
    assert "<ResetPasswordModal" in ud and "<MergeAccountsModal" in ud

    pw = _read("src/components/admin/modals/ResetPasswordModal.tsx")
    assert "type={visible ? 'text' : 'password'}" in pw and 'autoComplete="new-password"' in pw
    assert "navigator.clipboard.writeText(savedPassword)" in pw, "нет кнопки «Скопировать» после сброса"

    mg = _read("src/components/admin/modals/MergeAccountsModal.tsx")
    assert "usersApi.mergeUsers(source.id, target.id)" in mg, \
        "склейка должна оставлять ЭТУ карточку и удалять выбранный дубликат"
    assert "disabled={!agree" in mg, "необратимая склейка без галочки «понимаю»"
    assert "Абонемент дубликата" in mg, "предпросмотр не предупреждает о пропаже абонемента"


# ─────────────────────────────────────────────────────────────────────────
# G7-03 — «Общая сумма оплат» читается по camelCase-имени.
# ─────────────────────────────────────────────────────────────────────────

def test_client_total_paid_reads_camelcase():
    cash = _read("src/api/cashbox.ts")
    body = _fn_body(cash, "getClientTotalPaid:", "getTransactions:")
    assert "data?.totalPaid" in body, \
        "«Общая сумма оплат» снова читает total_paid — у всех клиентов 0.00 ₾"
    ud = _read("src/pages/admin/UserDetails.tsx")
    assert "<UserLoyaltyCard email={user.email} bookings={userBookings} />" in ud, \
        "«Уровень клиента» снова считается по чужому стору — всегда 0 часов"


# ─────────────────────────────────────────────────────────────────────────
# G7-admin-core-M2 — итоги кассы не зависят от фильтра журнала.
# ─────────────────────────────────────────────────────────────────────────

def test_finance_totals_ignore_journal_filter_and_adjustments():
    fin = _read("src/pages/admin/Finance.tsx")
    memo = _fn_body(fin, "const periodTx = useMemo(", "const filtered = useMemo(")
    assert "txType" not in memo, "итоги кассы снова зависят от фильтра «Приходы/Расходы»"
    assert "filteredTransactions={p.periodTx}" in fin, "BalanceCard снова получает журнал с фильтром"
    assert "limit: 200" not in fin and "limit: TX_LIMIT" in fin

    card = _read("src/components/admin/cashbox/BalanceCard.tsx")
    assert "tx.paymentMethod === 'adjustment'" in card, \
        "корректировки баланса снова считаются приходом/расходом кассы"


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
    print("СТОРОЖ wave0-G: OK" if not failures else f"СТОРОЖ wave0-G УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
