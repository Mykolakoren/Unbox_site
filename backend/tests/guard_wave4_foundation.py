"""СТОРОЖ wave4 — основа волны 4 (админка, шаг 0, 01.10).

Что ловит:
  * В1 / G8-03: «Закрыть кабинет» снова ставит блокировку поверх брони
    клиента (confirmed / pending_approval) вместо 409 со списком; или 409
    срабатывает на отменённую бронь / свободное время / другое обслуживание;
    или серия с одной занятой датой создаёт остальные даты.
  * G8-12: DELETE /maintenance-blocks/group/{id} трогает брони клиентов
    (удалять можно только payment_method='service'), или права на него
    слабее, чем у удаления одного блока (require_admin).
  * MaintenanceRead потерял recurring_group_id.
  * src/utils/adminToday.ts: сумма «взять» ≠ Σ due > 0 сегодняшних броней,
    в ленту попало обслуживание, пропала прошедшая (completed), «сегодня»
    считается не по Батуми. Файл исполняется через node ≥ 22.6.
  * src/utils/dueAmounts.ts (В2): completed снова без записи (в шахматке цена
    без «✓» читается как «взять»), сумма «к оплате» по клиенту разошлась с
    долгом на балансе, будущие брони получили другие суммы. Плюс отпечаток
    computeDueByBooking — денежная формула: поменяли → ревью (money-reviewer)
    и решение владельца, потом новый отпечаток.
  * REASON_LABELS живёт в src/utils/ledgerReasons.ts, а не копией в ленте.

Без сети и боевой базы (SQLite в памяти + node + чтение исходников):
    python3 backend/tests/guard_wave4_foundation.py
"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent

TODAY = "src/utils/adminToday.ts"
DUE = "src/utils/dueAmounts.ts"

# Отпечаток computeDueByBooking + DUE_STATUSES (код без комментариев и
# пробелов). Снят 01.10 после правки В2 (completed считается как остальные
# брони; старые записи не меняются, долг клиента тот же). Поменяли формулу —
# это денежная правка: ревью money-reviewer + решение владельца, потом новый
# отпечаток.
DUE_FINGERPRINT = "feb21a3b98e3aa2b450c0a71278d35ef12782281709c33c76f2b9fc67ef17bda"


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


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
    """Выполнить ES-модуль (можно import из src/…) и вернуть JSON последней строки."""
    node = _node()
    if not node:
        return None
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", body],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"node упал: {r.stderr[:600]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


def _abs(rel: str) -> str:
    return (ROOT / rel).as_posix()


# ── Блокировки кабинета: SQLite в памяти ──────────────────────────────────

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


def _client(s, name="Анна Клиентова", email="anna@unbox.test"):
    from app.models.user import User
    u = User(email=email, name=name, role="user", hashed_password="x")
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _booking(s, user, *, day="2026-10-05", start="10:00", duration=60, status="confirmed",
             resource="unbox_one_room_1", method="balance", pay="pending", price=36.0, group=None):
    from app.models.booking import Booking
    b = Booking(
        resource_id=resource, location_id="unbox_one",
        date=datetime.strptime(day, "%Y-%m-%d"), start_time=start, duration=duration,
        status=status, final_price=price, payment_method=method, payment_status=pay,
        user_id=user.email, user_uuid=user.id, recurring_group_id=group,
    )
    s.add(b)
    s.commit()
    s.refresh(b)
    return b


def _create(s, admin, **kw):
    from app.api.v1.maintenance import MaintenanceCreate, create_blocks
    data = dict(resource_id="unbox_one_room_1", location_id="unbox_one", date_from="2026-10-05",
                start_time="09:30", duration=60, reason="Уборка")
    data.update(kw)
    return create_blocks(data=MaintenanceCreate(**data), session=s, current_user=admin)


def _service_rows(s):
    from sqlmodel import select
    from app.models.booking import Booking
    return s.exec(select(Booking).where(Booking.payment_method == "service")).all()


def test_block_over_confirmed_booking_is_409_with_list():
    from fastapi import HTTPException
    s = _memory_session()
    admin, anna = _admin(s), _client(s)
    b = _booking(s, anna, start="10:00", duration=90, pay="paid", price=54)
    try:
        _create(s, admin)  # 09:30–10:30 пересекает 10:00–11:30
    except HTTPException as e:
        assert e.status_code == 409, e.status_code
        d = e.detail
        assert isinstance(d, dict) and isinstance(d.get("conflicts"), list), d
        assert "message" in d and "брони" in d["message"], d
        assert len(d["conflicts"]) == 1, d["conflicts"]
        c = d["conflicts"][0]
        for key in ("booking_id", "date", "start_time", "duration", "client", "payment_status", "final_price"):
            assert key in c, f"в конфликте нет {key}: {c}"
        assert c["booking_id"] == str(b.id)
        assert c["date"] == "2026-10-05" and c["start_time"] == "10:00" and c["duration"] == 90
        assert c["client"] == {"name": "Анна Клиентова", "email": "anna@unbox.test"}, c["client"]
        assert c["payment_status"] == "paid" and c["final_price"] == 54
    else:
        raise AssertionError("блок поверх подтверждённой брони создан — должен быть 409 (В1)")
    assert _service_rows(s) == [], "при 409 что-то создалось"
    s.refresh(b)
    assert b.status == "confirmed" and b.payment_status == "paid", "при 409 бронь клиента тронули"


def test_block_over_pending_approval_is_409():
    from fastapi import HTTPException
    s = _memory_session()
    admin, anna = _admin(s), _client(s)
    _booking(s, anna, status="pending_approval", start="09:00", duration=60)
    try:
        _create(s, admin)
    except HTTPException as e:
        assert e.status_code == 409
    else:
        raise AssertionError("блок поверх брони «ждёт подтверждения» создан")


def test_block_over_cancelled_or_free_time_is_ok():
    s = _memory_session()
    admin, anna = _admin(s), _client(s)
    _booking(s, anna, status="cancelled", start="10:00")                     # отменённая — не мешает
    _booking(s, anna, start="10:30", duration=60)                             # встык после 10:30 — не пересечение
    _booking(s, anna, start="09:30", resource="unbox_one_room_2")             # другой кабинет
    _booking(s, anna, start="09:30", day="2026-10-06")                        # другой день
    _booking(s, admin, start="09:00", method="service", pay="waived", price=0)  # другое обслуживание
    rows = _create(s, admin)
    assert len(rows) == 1 and rows[0].start_time == "09:30"
    assert rows[0].recurring_group_id is None, "одиночный блок не должен получать серию"


def test_series_with_one_busy_date_creates_nothing():
    from fastapi import HTTPException
    s = _memory_session()
    admin, anna = _admin(s), _client(s)
    _booking(s, anna, day="2026-10-12", start="10:00")  # пн второй недели
    try:
        # понедельники 05.10, 12.10, 19.10
        _create(s, admin, date_to="2026-10-19", recurring_weekdays=[0])
    except HTTPException as e:
        assert e.status_code == 409
        assert [c["date"] for c in e.detail["conflicts"]] == ["2026-10-12"], e.detail
    else:
        raise AssertionError("серия поверх брони создана")
    assert _service_rows(s) == [], "серия с занятой датой создала свободные даты"
    rows = _create(s, admin, date_to="2026-10-19", recurring_weekdays=[0], start_time="12:00")
    assert len(rows) == 3 and rows[0].recurring_group_id and len({r.recurring_group_id for r in rows}) == 1


def test_delete_group_removes_only_service_rows():
    from app.api.v1.maintenance import delete_block_group
    s = _memory_session()
    admin, anna = _admin(s), _client(s)
    rows = _create(s, admin, date_to="2026-10-07", start_time="08:00")
    gid = rows[0].recurring_group_id
    assert gid and len(rows) == 3
    # Бронь клиента с тем же group id (не должно бывать, но удалять её нельзя ни при каком раскладе).
    victim = _booking(s, anna, start="15:00", group=gid, pay="paid")
    res = delete_block_group(group_id=gid, session=s, current_user=admin)
    assert res["deleted"] == 3, res
    assert _service_rows(s) == [], "серия обслуживания не удалилась"
    from app.models.booking import Booking
    kept = s.get(Booking, victim.id)
    assert kept is not None and kept.status == "confirmed", "удаление серии задело бронь клиента"


def test_maintenance_api_contract():
    src = _read("backend/app/api/v1/maintenance.py")
    assert "recurring_group_id: Optional[str]" in src, "MaintenanceRead без recurring_group_id"
    i = src.index('@router.delete("/group/{group_id}")')
    body = src[i:src.index("\n@router.", i + 10)]
    assert "deps.require_admin" in body, "удаление серии без require_admin"
    assert 'Booking.payment_method == "service"' in body, "удаление серии не ограничено обслуживанием"
    j = src.index('@router.delete("/{block_id}")')
    assert "deps.require_admin" in src[j:j + 400], "права удаления одного блока поменялись"
    k = src.index("def create_blocks")
    create = src[k:src.index("\n@router.", k)]
    assert create.index("find_booking_conflicts(") < create.index("session.add("), \
        "пересечения нужно проверять ДО создания строк"
    assert "status_code=409" in create
    assert "force" not in create, "В1: без force — блок поверх брони не ставится никак"


def test_frontend_maintenance_client_and_sheet():
    api = _strip_comments(_read("src/api/maintenance.ts"))
    for fn in ("list:", "create:", "remove:", "removeGroup:"):
        assert fn in api, f"maintenanceApi без {fn}"
    assert "/maintenance-blocks/group/" in api
    assert "MaintenanceConflictError" in api and "status !== 409" in api
    sheet = _strip_comments(_read("src/components/admin/MaintenanceConflictSheet.tsx"))
    assert "from '../ui/Sheet'" in sheet, "шторка конфликта не на общем Sheet"
    assert "В это время есть брони — сначала перенесите или отмените их" in sheet
    assert "linkFor(" in sheet and ">Понятно<" in sheet
    for bad in ("cancel", "removeGroup", "maintenanceApi"):
        assert bad not in sheet, f"шторка конфликта сама что-то делает ({bad}) — по В1 только показывает"


# ── adminToday.ts через node ──────────────────────────────────────────────

def test_admin_today_has_no_imports():
    code = _strip_comments(_read(TODAY))
    assert not re.search(r"^\s*import\s", code, flags=re.M), "adminToday.ts должен быть без импортов — его гоняет node"
    assert "toISOString" not in code, "toISOString — это UTC, «сегодня» должно быть по Батуми"
    for fn in ("todayRows", "todaySummary", "byClient", "batumiDayKey"):
        assert f"export function {fn}(" in code, f"пропала функция {fn}"


def test_admin_today_rows_summary_and_batumi_day():
    res = _node_run(f"""
const m = await import('{_abs(TODAY)}');
const users = [
  {{ id: 'u1', email: 'anna@x.ge', name: 'Анна', phone: '+995 1', balance: -96, creditLimit: 50 }},
  {{ id: 'u2', email: 'boris@x.ge', name: 'Борис', phone: null, balance: 0, creditLimit: 0 }},
  {{ id: 'u3', email: 'vera@x.ge', name: 'Вера', phone: null, balance: 20 }},
];
const D = '2026-10-02';
const bookings = [
  {{ id: 'a1', userId: 'anna@x.ge', date: D + 'T00:00:00', startTime: '09:00', duration: 60, resourceId: 'r1', status: 'completed', paymentMethod: 'balance', paymentStatus: 'paid', finalPrice: 20 }},
  {{ id: 'a2', userId: 'u1', date: D + 'T00:00:00', startTime: '18:00', duration: 90, resourceId: 'r2', status: 'confirmed', paymentMethod: 'balance', paymentStatus: 'paid', finalPrice: 36 }},
  {{ id: 'b1', userId: 'boris@x.ge', date: D, startTime: '12:00', duration: 60, resourceId: 'r1', status: 'pending_approval', paymentMethod: 'balance', paymentStatus: 'pending', finalPrice: 30 }},
  {{ id: 'v1', userId: 'vera@x.ge', date: D + 'T00:00:00', startTime: '11:00', duration: 60, resourceId: 'r1', status: 'confirmed', paymentMethod: 'balance', paymentStatus: 'paid', finalPrice: 20 }},
  // обслуживание, отменённая, вчера, завтра — не попадают
  {{ id: 's1', userId: 'admin@x.ge', date: D + 'T08:00:00', startTime: '08:00', duration: 60, resourceId: 'r1', status: 'confirmed', paymentMethod: 'service', paymentStatus: 'waived', finalPrice: 0 }},
  {{ id: 'c1', userId: 'u1', date: D + 'T00:00:00', startTime: '14:00', duration: 60, resourceId: 'r1', status: 'cancelled', paymentMethod: 'balance', finalPrice: 20 }},
  {{ id: 'y1', userId: 'u1', date: '2026-10-01T00:00:00', startTime: '23:00', duration: 60, resourceId: 'r1', status: 'completed', paymentMethod: 'balance', paymentStatus: 'paid', finalPrice: 20 }},
  {{ id: 't1', userId: 'u1', date: '2026-10-03T00:00:00', startTime: '00:30', duration: 60, resourceId: 'r1', status: 'confirmed', paymentMethod: 'balance', paymentStatus: 'pending', finalPrice: 20 }},
  // момент с поясом: 01.10 21:30 UTC = 02.10 01:30 по Батуми — это «сегодня»
  {{ id: 'z1', userId: 'u2', date: '2026-10-01T21:30:00Z', startTime: '01:30', duration: 30, resourceId: 'r3', status: 'confirmed', paymentMethod: 'subscription', paymentStatus: 'paid', finalPrice: 0 }},
];
const dueMap = new Map([
  ['a1', {{ due: 20, price: 20, charged: true }}],
  ['a2', {{ due: 36, price: 36, charged: true }}],
  ['b1', {{ due: 30, price: 30, charged: false }}],
  ['v1', {{ due: 0, price: 20, charged: true }}],
  ['s1', {{ due: 999, price: 0, charged: true }}],
]);
const rows = m.todayRows({{ bookings, users, dueMap, dayKey: D, resources: [{{ id: 'r1', name: 'Кабинет 1' }}] }});
const sum = m.todaySummary(rows);
const cl = m.byClient(rows, users);
console.log(JSON.stringify({{
  ids: rows.map(r => r.bookingId),
  first: rows[0],
  sum,
  manual: rows.filter(r => r.due > 0).reduce((s, r) => s + r.due, 0),
  cl: cl.map(c => [c.client, c.today, c.debt, c.total, c.creditLimit, c.overLimit]),
  dayLate: m.batumiDayKey(new Date('2026-10-01T21:30:00Z')),
  dayEarly: m.batumiDayKey(new Date('2026-10-01T19:59:00Z')),
  keyZ: m.bookingDayKey('2026-10-01T21:30:00Z'),
  keyNaive: m.bookingDayKey('2026-10-01T23:00:00'),
}}));
""")
    if res is None:
        return  # нет node ≥ 22.6 — проверка исходника выше всё равно идёт
    assert res["ids"] == ["z1", "a1", "v1", "b1", "a2"], f"лента дня: {res['ids']} (обслуживание/отмена/вчера попали или completed пропала?)"
    assert "s1" not in res["ids"], "обслуживание в «Сегодня»"
    f = res["first"]
    assert f["time"] == "01:30" and f["endTime"] == "02:00" and f["client"] == "Борис" and f["cabinet"] == "r3", f
    assert f["due"] is None and f["paid"] is False, "у абонемента без записи dueMap не должно быть «к оплате»"
    assert res["sum"]["amount"] == res["manual"] == 86, f"«взять» ≠ Σ due>0 сегодняшних: {res['sum']} vs {res['manual']}"
    assert res["sum"]["clients"] == 2, res["sum"]
    assert res["sum"]["label"] == "взять 86 ₾ с 2 клиентов", res["sum"]["label"]
    assert res["cl"][0] == ["Анна", 56, 96, 96, 50, True], res["cl"]
    assert res["cl"][1] == ["Борис", 30, 0, 30, 0, False], res["cl"]  # ещё не списана — в «весь долг» входит
    assert res["dayLate"] == "2026-10-02" and res["dayEarly"] == "2026-10-01", "«сегодня» не по Батуми (UTC+4)"
    assert res["keyZ"] == "2026-10-02", "момент с поясом не переведён в день по Батуми"
    assert res["keyNaive"] == "2026-10-01", "naive-дату из базы надо брать как есть (это день по Батуми)"


def test_admin_today_summary_plural():
    res = _node_run(f"""
const m = await import('{_abs(TODAY)}');
const r = (id, u, due) => ({{ bookingId: id, userId: u, due }});
console.log(JSON.stringify([
  m.todaySummary([r('1', 'a', 36)]).label,
  m.todaySummary([r('1', 'a', 1250.5), r('2', 'b', 0), r('3', 'c', null)]).label,
  m.todaySummary([r('1', 'a', 0)]).label,
]));
""")
    if res is None:
        return
    assert res == ["взять 36 ₾ с 1 клиента", "взять 1 250,5 ₾ с 1 клиента", "сегодня брать не с кого"], res


# ── dueAmounts.ts (В2) ────────────────────────────────────────────────────

def _due_block(src: str) -> str:
    a = src.index("const DUE_STATUSES")
    b = src.index("export function dueLabel", a)
    return src[a:b]


def _fingerprint(block: str) -> str:
    block = re.sub(r"/\*.*?\*/", "", block, flags=re.S)
    block = re.sub(r"//[^\n]*", "", block)
    return hashlib.sha256(re.sub(r"\s+", "", block).encode("utf-8")).hexdigest()


def test_due_amounts_fingerprint():
    src = _read(DUE)
    assert "'completed'" in _due_block(src), "В2: completed снова не считается в dueAmounts"
    fp = _fingerprint(_due_block(src))
    assert fp == DUE_FINGERPRINT, (
        "computeDueByBooking изменился — это денежная правка, нужно ревью (money-reviewer) "
        f"и решение владельца. Новый отпечаток: {fp}"
    )


def test_due_amounts_completed_gets_entry_and_client_sum_holds():
    res = _node_run(f"""
const m = await import('{_abs(DUE)}');
const b = (id, day, st, pay, price, method = 'balance') => ({{ id, userId: 'u', date: '2026-10-' + day + 'T00:00:00', startTime: '10:00', status: st, paymentStatus: pay, paymentMethod: method, finalPrice: price }});
const list = [
  b('p1', '01', 'completed', 'paid', 40),
  b('p2', '02', 'completed', 'paid', 36),
  b('p3', '02', 'cancelled', 'paid', 99),
  b('f1', '03', 'confirmed', 'paid', 20),
  b('f2', '05', 'confirmed', 'pending', 60),
  b('s1', '02', 'completed', 'paid', 0, 'subscription'),  // абонемент без доплаты — записи нет
  b('u1', '02', 'completed', 'pending', 25),  // прошла, но не списана (сбой крона) — плюс баланса не забирает
];
const out = (bal) => Object.fromEntries([...m.computeDueByBooking(list, () => bal)].map(([k, v]) => [k, v]));
console.log(JSON.stringify({{ debt96: out(-96), debt20: out(-20), plus30: out(30), label: m.dueLabel(out(-20).p1) }}));
""")
    if res is None:
        return
    d = res["debt96"]
    # Будущие брони — как до В2 (f1 списана: долг сначала на неё; f2 не списана, баланса нет).
    assert d["f1"] == {"due": 20, "price": 20, "charged": True}, d["f1"]
    assert d["f2"] == {"due": 60, "price": 60, "charged": False}, d["f2"]
    # Прошедшие получили записи, долг лёг на самые свежие.
    assert d["p2"]["due"] == 36 and d["p1"]["due"] == 40, d
    assert "p3" not in d and "s1" not in d, "отменённая или абонемент без доплаты получили запись"
    assert "u1" not in d, "прошедшая несписанная бронь вошла в расчёт — заберёт плюс баланса у будущих"
    # Сумма «к оплате» по списанным = долг на балансе (96), всего = долг + непокрытые будущие.
    charged_sum = sum(v["due"] for v in d.values() if v["charged"])
    assert charged_sum == 96, f"Σ к оплате по списанным {charged_sum} ≠ долг 96"
    assert sum(v["due"] for v in d.values()) == 96 + 60
    # Долг меньше — покрытые прошедшие получают «✓» (due 0), а не пропадают.
    s = res["debt20"]
    assert s["f1"]["due"] == 20 and s["p2"]["due"] == 0 and s["p1"]["due"] == 0, s
    assert sum(v["due"] for v in s.values() if v["charged"]) == 20
    assert res["label"] == "оплачено"
    # Плюс на балансе покрывает ближайшую не списанную, прошедшие — 0.
    p = res["plus30"]
    assert p["f2"]["due"] == 30 and p["p1"]["due"] == 0 and p["f1"]["due"] == 0, p


def test_ledger_reasons_shared():
    util = _read("src/utils/ledgerReasons.ts")
    assert "export const REASON_LABELS" in util and "weekly_rebate: 'Недельная скидка'" in util
    led = _read("src/components/admin/UserBalanceLedger.tsx")
    assert "import { REASON_LABELS } from '../../utils/ledgerReasons'" in led
    assert "const REASON_LABELS" not in led, "в ленте баланса снова своя копия подписей"


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
    print("СТОРОЖ wave4-foundation: OK" if not failures else f"СТОРОЖ wave4-foundation УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
