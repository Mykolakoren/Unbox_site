"""СТОРОЖ wave4 · polish — доработка волны 4 по итогам трёх ревизоров (01.10).

Что ловит:
  * В5: «Вернуть» у кассовой операции снова без флага «уже нажато» — двойной
    тап отправлял два DELETE подряд (второй — 404 и красная ошибка).
    Компьютер (AddCashboxTransactionModal) и телефон (MobileAdminFinance).
  * Права на самих страницах, а не только скрытым пунктом меню:
    /admin/finance без finance.manage_cashbox / finance.view_reports и
    /admin/access-rights (и мобильная обёртка) без роли owner / senior_admin
    снова открываются по прямой ссылке. Внутри мобильной шапки «Права
    доступа» снова второй H1.
  * ⌘K: поиск открывается и тянет пользователей у клиента/специалиста
    (провайдер висит на всём приложении); или при пустом сторе броней раздел
    «Бронь» в поиске всегда пуст (нет fetchAllBookings).
  * «Закрыть кабинет» (POST /maintenance-blocks/): период длиннее 366 дней
    снова принимается — опечатка в годе создавала десятки тысяч блоков.
  * Фильтр списка броней без «Прошла» (completed): прошедшие не найти.
  * Мобильная админка: вкладка «Касса», «＋₾», «Пополнить», «Принять оплату»
    снова видны без права на кассу (canCash = userCanAccessFinance).
  * «Сегодня»: прошедшая не списанная бронь (completed + pending) снова без
    плашки «не списана»; due = 0 у не списанной (покрыта плюсом баланса)
    снова «оплачено» вместо «покрыто балансом»; «Принять оплату» из
    «Должны» снова без филиала (шторка ставила «Unbox Uni» клиенту One).
  * Карточка клиента на телефоне снова декодирует :email второй раз
    (decodeURIComponent поверх useParams роняет страницу на «%»).

Без сети и боевой базы (SQLite в памяти + node + чтение исходников):
    python3 backend/tests/guard_wave4_polish.py
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent
ADMIN = "src/pages/admin/"
MADMIN = "src/pages/mobile/admin/"
COMP = "src/components/admin/"
MONEY = COMP + "cashbox/cashMoney.ts"
TODAY = "src/utils/adminToday.ts"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


def _node():
    """Путь к node ≥ 22.6 (умеет --experimental-strip-types) или None."""
    node = shutil.which("node")
    if not node:
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    return node if (major, minor) >= (22, 6) else None


def _node_run(body: str):
    node = _node()
    if not node:
        return None
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", body],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"node упал: {r.stderr[:600]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


def _abs(rel: str) -> str:
    return (ROOT / rel).as_posix()


# ── 1. «Вернуть» — один раз ──────────────────────────────────────────────

def test_cash_undo_claimed_once_in_both_screens():
    desk = _code(COMP + "cashbox/AddCashboxTransactionModal.tsx")
    i = desk.index("undoToast(doneText")
    body = desk[i:desk.index("} else {", i)]
    claim = body.find("if (!claimCashUndo(created.id)) return;")
    assert claim != -1, "компьютер: «Вернуть» без флага «уже нажато» — двойной тап шлёт два DELETE"
    assert claim < body.find("cashboxApi.deleteTransaction(created.id)"), "флаг ставится после DELETE"
    assert "releaseCashUndo(created.id)" in body, "после ошибки «Вернуть» нельзя повторить"

    mob = _code(MADMIN + "MobileAdminFinance.tsx")
    i = mob.index("const createWithUndo = async")
    body = mob[i:mob.index("\n    };", i)]
    claim = body.find("if (!claimCashUndo(id)) return;")
    assert claim != -1, "телефон: «Вернуть» без флага «уже нажато»"
    assert claim < body.find("cashboxApi.deleteTransaction(id)")
    assert "releaseCashUndo(id)" in body


def test_cash_undo_flag_logic():
    res = _node_run(f"""
const m = await import('{_abs(MONEY)}');
const a = m.claimCashUndo('tx1');
const b = m.claimCashUndo('tx1');
const other = m.claimCashUndo('tx2');
m.releaseCashUndo('tx1');
const again = m.claimCashUndo('tx1');
const empty = m.claimCashUndo('');
console.log(JSON.stringify({{ a, b, other, again, empty }}));
""")
    if res is None:
        return  # нет node ≥ 22.6 — проверка исходника выше всё равно идёт
    assert res == {"a": True, "b": False, "other": True, "again": True, "empty": False}, res


# ── 2. Права на самих страницах ──────────────────────────────────────────

def test_finance_page_redirects_without_rights():
    src = _code(ADMIN + "Finance.tsx")
    assert "if (!userCanAccessFinance(currentUser)) return <Navigate to=\"/admin\" replace />;" in src, \
        "/admin/finance открывается без права на кассу (прячется только пункт меню)"
    i = src.index("export function AdminFinance()")
    head = src[i:src.index("function AdminFinancePage()", i)]
    assert "return <AdminFinancePage />;" in head, "проверка права не перед самой страницей (хуки и запросы уже идут)"
    mob = _code(MADMIN + "MobileAdminFinance.tsx")
    assert "if (!userCanAccessFinance(currentUser)) return <Navigate to=\"/m/admin/dashboard\" replace />;" in mob, \
        "/m/admin/finance открывается без права на кассу"


def test_access_rights_redirects_without_role():
    src = _code(ADMIN + "AccessRights.tsx")
    assert "if (!userCanAccessRights(currentUser)) return <Navigate to={deniedTo} replace />;" in src, \
        "/admin/access-rights открывается не владельцу / не старшему админу"
    assert "deniedTo = '/admin'" in src
    mob = _code(MADMIN + "MobileAdminAccessRights.tsx")
    assert "if (!userCanAccessRights(currentUser)) return <Navigate to=\"/m/admin/dashboard\" replace />;" in mob, \
        "мобильные «Права доступа» открываются не владельцу / не старшему админу"
    # Один H1: в мобильной шапке. Компьютерная страница — embedded, без PageHeader.
    assert "<AdminAccessRights embedded" in mob, "внутри мобильной шапки снова второй H1"
    assert "embedded ? (" in src and "<PageHeader title=\"Права доступа\"" in src


def test_shared_access_helpers_used_by_layouts():
    perms = _code("src/utils/permissions.ts")
    assert "export function userCanAccessFinance(" in perms and "export function userCanAccessRights(" in perms
    lay = _code(ADMIN + "AdminLayout.tsx")
    assert "userCanAccessFinance(currentUser)" in lay and "userCanAccessRights(currentUser)" in lay
    mlay = _code(MADMIN + "MobileAdminLayout.tsx")
    assert "canRights={userCanAccessRights(currentUser)}" in mlay


# ── 3. ⌘K — только сотрудникам админки ───────────────────────────────────

def test_cmdk_role_gate_and_bookings_load():
    src = _code(COMP + "CmdKSearch.tsx")
    assert "return ADMIN_ROLES.includes(role ?? '');" in src, "⌘K без проверки роли"
    assert "if (!open || !isStaff) return null;" in src, "оверлей ⌘K рисуется не сотруднику"
    assert "if (open && isStaff) {" in src, "⌘K грузит пользователей не сотруднику"
    assert "if (isCombo && allowed()) {" in src, "⌘K перехватывает сочетание у клиента"
    assert "const onOpen = () => { if (allowed()) setOpen(true); };" in src
    assert "if (bookings.length === 0) fetchAllBookings();" in src, \
        "⌘K не подгружает брони — раздел «Бронь» пуст, если «Брони» ещё не открывали"
    perms = _code("src/utils/permissions.ts")
    m = re.search(r"export const ADMIN_ROLES = \[([^\]]*)\];", perms)
    assert m and set(re.findall(r"'([^']+)'", m.group(1))) == {"owner", "senior_admin", "admin"}, \
        "ADMIN_ROLES изменился — ⌘K открывается не тем ролям"


# ── 4. Потолок периода «Закрыть кабинет» ─────────────────────────────────

def _memory_session():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, create_engine
    from app.models.booking import Booking
    from app.models.user import User

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    User.__table__.create(engine)
    Booking.__table__.create(engine)
    return Session(engine)


def _admin(s):
    from app.models.user import User
    u = User(email="admin@unbox.test", name="Админ", role="admin", hashed_password="x")
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _create(s, admin, **kw):
    from app.api.v1.maintenance import MaintenanceCreate, create_blocks
    data = dict(resource_id="unbox_one_room_1", location_id="unbox_one", date_from="2026-10-05",
                start_time="09:30", duration=60, reason="Уборка")
    data.update(kw)
    return create_blocks(data=MaintenanceCreate(**data), session=s, current_user=admin)


def test_maintenance_range_capped_at_366_days():
    src = _read("backend/app/api/v1/maintenance.py")
    assert "MAX_BLOCK_RANGE_DAYS = 366" in src, "потолок периода «Закрыть кабинет» не 366 дней"
    assert "if (date_to - date_from).days > MAX_BLOCK_RANGE_DAYS:" in src

    from fastapi import HTTPException
    from sqlmodel import select
    from app.models.booking import Booking
    s = _memory_session()
    admin = _admin(s)
    # 05.10.2026 → 07.10.2027 = 367 дней — отказ, ни одного блока.
    try:
        _create(s, admin, date_to="2027-10-07", recurring_weekdays=[0])
        raise AssertionError("период 367 дней принят — опечатка в годе создаст тысячи блоков")
    except HTTPException as e:
        assert e.status_code == 400, e.status_code
        assert "366" in str(e.detail) and "период" in str(e.detail).lower(), e.detail
    assert not s.exec(select(Booking)).all(), "при отказе блоки всё равно созданы"
    # Ровно 366 дней — можно (раз в неделю, чтобы не плодить 367 строк).
    rows = _create(s, admin, date_to="2027-10-06", recurring_weekdays=[0])
    assert 52 <= len(rows) <= 53, len(rows)


# ── 5. Фильтр списка броней ──────────────────────────────────────────────

def test_bookings_filter_has_completed():
    src = _code(ADMIN + "Bookings.tsx")
    assert "['pending_approval', 'confirmed', 'completed', 'cancelled', 're-rented']" in src, \
        "в фильтре броней нет «Прошла» (completed) — прошедшие не найти"
    assert "statusLabel('booking', v, 'staff')" in src, "подпись фильтра не из словаря статусов"
    st = _read("src/design/statuses.ts")
    assert re.search(r"completed:\s*\{ label: 'Прошла'", st), "в словаре нет подписи completed"


# ── 6. Касса на телефоне — по праву ──────────────────────────────────────

def test_mobile_admin_cash_gated():
    lay = _code(MADMIN + "MobileAdminLayout.tsx")
    assert "const canCash = userCanAccessFinance(currentUser);" in lay
    assert "{canCash && <TabLink to=\"/m/admin/finance\"" in lay, "вкладка «Касса» видна без права на кассу"
    assert "<MobileAdminTour canCash={canCash}" in lay, "тур ведёт к вкладке «Касса», которой нет"

    users = _code(MADMIN + "MobileAdminUsers.tsx")
    assert "const canCash = userCanAccessFinance(currentUser);" in users
    assert "{canCash && <button" in users and "{canCash && topupUser && (" in users, "«＋₾» без права на кассу"

    card = _code(MADMIN + "MobileAdminUserCard.tsx")
    assert "const canCash = userCanAccessFinance(currentUser);" in card
    i = card.index("{canCash && (")
    assert card.find("Пополнить", i) != -1 and card.find("Пополнить", i) < card.find("Новая бронь", i), \
        "«Пополнить» в карточке без права на кассу"
    assert "{canCash && topupOpen && (" in card

    dash = _code(MADMIN + "MobileAdminDashboard.tsx")
    assert "const canCash = userCanAccessFinance(currentUser);" in dash
    i = dash.index("{canCash && (")
    assert dash.find("Принять оплату", i) != -1, "«Принять оплату» в «Должны» без права на кассу"
    assert "{canCash && pay && (" in dash

    sheets = _code(MADMIN + "bookingSheets.tsx")
    assert "const canCash = userCanAccessFinance(useUserStore(s => s.currentUser));" in sheets
    assert "pay={canCash && acceptPayment ? acceptPayment(booking) : null}" in sheets, \
        "«Принять оплату» в шторке брони без права на кассу"


# ── 7. «Сегодня»: подписи и филиал ───────────────────────────────────────

def test_today_uncharged_and_covered_labels():
    badge = _code(COMP + "DueBadge.tsx")
    assert "charged === false ? 'покрыто балансом' : paidLabel" in badge, \
        "не списанная бронь, покрытая плюсом баланса, снова «оплачено»"
    assert "ui-badge--pending" in badge and "statusLabel('payment', 'not_charged', 'staff')" in badge, \
        "нет плашки «не списана»"
    st = _read("src/design/statuses.ts")
    assert "not_charged: { label: 'Не списана', tone: 'pending'" in st
    for rel, needle in ((ADMIN + "Dashboard.tsx", "<DueBadge due={r.due} paid={r.paid} charged={r.charged} uncharged={r.uncharged} />"),
                        (MADMIN + "MobileAdminDashboard.tsx", "<DueBadge due={row.due} paid={row.paid} charged={row.charged} uncharged={row.uncharged} />")):
        assert needle in _code(rel), f"{rel}: «Сегодня» без «не списана / покрыто балансом»"

    res = _node_run(f"""
const m = await import('{_abs(TODAY)}');
const D = '2026-10-02';
const users = [{{ id: 'u1', email: 'anna@x.ge', name: 'Анна', balance: 30 }}];
const bookings = [
  {{ id: 'p1', userId: 'u1', date: D, startTime: '09:00', duration: 60, resourceId: 'r1', status: 'completed', paymentMethod: 'balance', paymentStatus: 'pending', finalPrice: 20 }},
  {{ id: 'f1', userId: 'u1', date: D, startTime: '18:00', duration: 60, resourceId: 'r1', status: 'confirmed', paymentMethod: 'balance', paymentStatus: 'pending', finalPrice: 20 }},
  {{ id: 'w1', userId: 'u1', date: D, startTime: '08:00', duration: 60, resourceId: 'r1', status: 'completed', paymentMethod: 'subscription', paymentStatus: 'pending', finalPrice: 0 }},
];
const dueMap = new Map([['f1', {{ due: 0, price: 20, charged: false }}]]);
const rows = m.todayRows({{ bookings, users, dueMap, dayKey: D }});
const by = Object.fromEntries(rows.map(r => [r.bookingId, {{ due: r.due, paid: r.paid, charged: r.charged, uncharged: r.uncharged }}]));
console.log(JSON.stringify({{ by, sum: m.todaySummary(rows).amount }}));
""")
    if res is None:
        return
    by = res["by"]
    assert by["p1"] == {"due": None, "paid": False, "charged": False, "uncharged": True}, by["p1"]
    assert by["f1"] == {"due": 0, "paid": True, "charged": False, "uncharged": False}, by["f1"]
    assert by["w1"]["uncharged"] is False, "абонемент без доплаты помечен «не списана»"
    assert res["sum"] == 0, "«не списана» попала в сумму «взять» — это только подпись"


def test_pay_from_due_list_keeps_branch():
    dash = _code(MADMIN + "MobileAdminDashboard.tsx")
    i = dash.index("const openPayFor = (c: TodayClient) => {")
    body = dash[i:dash.index("\n    };", i)]
    assert "branchOfBooking({ resourceId: first.cabinetId })" in body and "const first = c.rows[0];" in body, \
        "«Принять оплату» из «Должны» без филиала — шторка подставит «Unbox Uni»"
    assert "onClick={() => openPayFor(c)}" in dash


def test_user_card_no_double_decode():
    card = _code(MADMIN + "MobileAdminUserCard.tsx")
    assert "decodeURIComponent(" not in card, "двойной decodeURIComponent поверх useParams — URIError на «%»"
    assert "const param = rawParam || '';" in card


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
    print("СТОРОЖ wave4-polish: OK" if not failures else f"СТОРОЖ wave4-polish УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
