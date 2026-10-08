"""СТОРОЖ «оплачено скидкой + куда ушли деньги» (решение владельца 03.10).

Владелец: «при начислении недельной скидки на баланс все первые брони,
покрываемые скидкой за прошлую неделю, показывать как оплаченные…; если
накопленного хватает на часть брони — к оплате только разницу; и чтобы на
балансе было видно, что было начислено и куда списалось».

Как устроено:
  * backend/app/services/balance_allocation.py — раскладка ленты баланса:
    самые старые деньги оплачивают самые ранние брони (по времени начала брони),
    возврат за бронь гасит списание своей брони, долг — на брони, за которую
    денег не хватило; остаток на начало (baseline) — самый старый;
  * ручки (новый файл api/v1/balance_allocation.py): GET /users/{id}/balance-allocation
    (как лента — любой админ) и GET /balance-allocation/summary (админ + crm.view_clients);
  * фронт: src/utils/balanceAllocation.ts — applyAllocation поверх прежнего
    computeDueByBooking: долг списанной брони — тот, что привязала лента (бронь
    вне окна 5000 его не теряет и не отдаёт чужим), у несписанных — чем покрыто.

Что ловим:
  1. сценарии FIFO на чистых данных: предоплата → брони; бронь в долг → оплата
     гасит; скидка гасит долг понедельничной брони; скидка больше долга → покрывает
     следующую; частичное покрытие; возврат при отмене (и штраф без возврата);
     корректировка; остаток на начало; неувязка с балансом (consistent=False);
     строки «при создании брони» без номера брони; отмена пополнения;
  2. ручки на SQLite: права, раскладка клиента (способ оплаты из кассы, неделя
     скидки), сводка только по клиентам с ненулевым балансом;
  3. риск 1: долг брони вне окна админки виден (сводка + debtsOutsideList), и
     суммы на бронях в окне не зависят от того, загружено окно или всё;
  4. паритет на случайных данных: «к оплате» фронта до правки (computeDueByBooking)
     == после (applyAllocation по раскладке сервера) — сотни клиентов;
  5. тексты строк (ledgerRowLine, сводка, «Оплачено: …», «M−N ₾ покрыто: …»),
     значки (dueLabel / dueMarkKind / DueBadge / легенда), экраны подключены.

Без сети и боевой базы (SQLite в памяти, node + esbuild из node_modules, если есть):
    python3 backend/tests/guard_balance_allocation_2026_10.py
"""
import json
import os
import pathlib
import random
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from app.services import balance_allocation as BA  # noqa: E402
from app.services.balance_allocation import BookingRef, Row, allocate, project_coverage, link_unlinked  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
TZ = timedelta(hours=4)


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _code(rel: str) -> str:
    """Без комментариев (// … и /* … */, в т.ч. {/* … */} в JSX)."""
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), _read(rel), flags=re.S)
    return re.sub(r"(?<![:'\"`\w])//[^\n]*", "", src)


def R(i, at, delta, reason, **kw) -> Row:
    return Row(id=i, at=datetime.fromisoformat(at), delta=delta, reason=reason, **kw)


def B(i, day, t="10:00", price=20.0, **kw) -> BookingRef:
    kw.setdefault("resource_name", "Кабинет 2")
    return BookingRef(id=i, day=date.fromisoformat(day), start_time=t, final_price=price, **kw)


def _rows(res) -> dict:
    return {r["id"]: r for r in res["rows"]}


def _amounts(items) -> list:
    return [(i["label"], i["amount"]) for i in items]


def _charge(i, at, amount, booking_id, reason="booking_charge"):
    return R(i, at, -amount, reason, ref_type="booking", ref_id=booking_id, booking_id=booking_id)


def _topup(i, at, amount, tx=None, method="cash"):
    return R(i, at, amount, "topup", ref_type="cashbox_tx", ref_id=tx or f"tx-{i}", method=method)


# ── 1. Сценарии FIFO ─────────────────────────────────────────────────────

def test_prepay_then_bookings():
    """Предоплата 40 ₾ → две брони по 20: обе «из оплаты 30.09», плюс 0, долгов нет."""
    bk = {"A": B("A", "2026-10-02"), "B": B("B", "2026-10-03", "12:00")}
    rows = [
        _topup("t1", "2026-09-30T08:00:00", 40),
        _charge("cA", "2026-10-01T06:00:00", 20, "A"),
        _charge("cB", "2026-10-02T08:00:00", 20, "B"),
    ]
    res = allocate(rows, bk, balance=0)
    assert res["consistent"] and res["batches"] == [] and res["debts"] == [], res
    r = _rows(res)
    assert _amounts(r["cA"]["paidFrom"]) == [("оплата 30.09", 20.0)] and r["cA"]["debtOpen"] == 0
    assert _amounts(r["cB"]["paidFrom"]) == [("оплата 30.09", 20.0)]
    assert [(t["bookingId"], t["amount"], t["closedDebt"]) for t in r["t1"]["spentOn"]] == [("A", 20.0, False), ("B", 20.0, False)]
    assert r["t1"]["left"] == 0
    assert r["t1"]["paidFrom"] == [] and r["cA"]["spentOn"] == []
    assert r["t1"]["spentOn"][0]["label"] == "02.10 10:00 Каб. 2"
    money = {m["bookingId"]: m for m in res["bookings"]}
    assert money["A"]["debt"] == 0 and _amounts(money["A"]["sources"]) == [("оплата 30.09", 20.0)]
    assert money["A"]["sources"][0]["detail"] == "наличные"


def test_debt_then_topup_closes():
    """Бронь списана в долг, потом оплата 20 ₾ — долг закрыт ЭТОЙ оплатой."""
    bk = {"A": B("A", "2026-10-02")}
    rows = [_charge("cA", "2026-10-01T06:00:00", 20, "A"), _topup("t1", "2026-10-02T07:00:00", 20)]
    res = allocate(rows, bk, balance=0)
    r = _rows(res)
    assert res["consistent"] and res["debts"] == [] and res["batches"] == []
    assert r["cA"]["paidFrom"] == [] and _amounts(r["cA"]["debtClosed"]) == [("оплата 02.10", 20.0)]
    assert r["cA"]["debtOpen"] == 0
    assert [(t["bookingId"], t["closedDebt"]) for t in r["t1"]["spentOn"]] == [("A", True)]
    # До оплаты — долг на брони.
    res0 = allocate(rows[:1], bk, balance=-20)
    assert [(d["bookingId"], d["amount"]) for d in res0["debts"]] == [("A", 20.0)]
    assert _rows(res0)["cA"]["debtOpen"] == 20.0


def test_weekly_rebate_closes_monday_booking_debt():
    """Понедельничная бронь 20 ₾ списана в воскресенье в долг; скидка за неделю
    +9 ₾ (пн 05:00) гасит её часть — к оплате 11 из 20, «9 ₾ покрыто: скидка за неделю»."""
    bk = {"M": B("M", "2026-10-05")}
    rows = [
        _charge("cM", "2026-10-04T06:00:00", 20, "M"),
        R("wr", "2026-10-05T01:00:00", 9, "weekly_rebate", ref_type="weekly_rebate", ref_id="u1",
          week_start=date(2026, 9, 28)),
    ]
    res = allocate(rows, bk, balance=-11)
    r = _rows(res)
    assert res["consistent"]
    assert [(d["bookingId"], d["amount"]) for d in res["debts"]] == [("M", 11.0)]
    assert _amounts(r["cM"]["debtClosed"]) == [("скидка за неделю", 9.0)] and r["cM"]["debtOpen"] == 11.0
    assert r["cM"]["debtClosed"][0]["detail"] == "28.09–04.10", r["cM"]["debtClosed"][0]
    assert [(t["bookingId"], t["amount"], t["closedDebt"]) for t in r["wr"]["spentOn"]] == [("M", 9.0, True)]
    money = {m["bookingId"]: m for m in res["bookings"]}
    assert money["M"]["debt"] == 11.0 and _amounts(money["M"]["sources"]) == [("скидка за неделю", 9.0)]


def test_rebate_bigger_than_debt_covers_next():
    """Скидка 12 ₾ больше долга 5 ₾: долг закрыт, 7 ₾ — на балансе и покрывают
    следующую бронь (к оплате 13 из 20); после списания — «из скидки 7 ₾»."""
    bk = {"A": B("A", "2026-10-02", price=5), "N": B("N", "2026-10-06", "10:00", price=20)}
    rows = [
        _charge("cA", "2026-10-01T06:00:00", 5, "A"),
        R("wr", "2026-10-05T01:00:00", 12, "weekly_rebate", ref_type="weekly_rebate", ref_id="u1"),
    ]
    res = allocate(rows, {"A": bk["A"]}, balance=7)
    assert res["consistent"] and res["debts"] == []
    assert [(b["kind"], b["amount"]) for b in res["batches"]] == [("weekly_rebate", 7.0)]
    r = _rows(res)
    assert [(t["bookingId"], t["amount"], t["closedDebt"]) for t in r["wr"]["spentOn"]] == [("A", 5.0, True)]
    assert r["wr"]["left"] == 7.0
    cov = project_coverage(res["batches"], [bk["N"]])
    assert [(c["bookingId"], c["covered"], c["due"]) for c in cov] == [("N", 7.0, 13.0)]
    assert _amounts(cov[0]["sources"]) == [("скидка за неделю", 7.0)]
    # Неделя скидки без записи WeeklyRebate — прошлая неделя от даты начисления.
    assert cov[0]["sources"][0]["detail"] == "28.09–04.10"
    rows2 = rows + [_charge("cN", "2026-10-05T06:00:00", 20, "N")]
    res2 = allocate(rows2, bk, balance=-13)
    r2 = _rows(res2)
    assert _amounts(r2["cN"]["paidFrom"]) == [("скидка за неделю", 7.0)] and r2["cN"]["debtOpen"] == 13.0
    assert [(d["bookingId"], d["amount"]) for d in res2["debts"]] == [("N", 13.0)]


def test_partial_cover_and_order():
    """Плюс 9 ₾ (скидка) покрывает ближайшую несписанную бронь частично; дальние — нет."""
    rows = [R("wr", "2026-10-05T01:00:00", 9, "weekly_rebate")]
    res = allocate(rows, {}, balance=9)
    far = B("F", "2026-10-09", price=20)
    near = B("N", "2026-10-07", price=20)
    cov = {c["bookingId"]: c for c in project_coverage(res["batches"], [far, near])}
    assert (cov["N"]["covered"], cov["N"]["due"]) == (9.0, 11.0)
    assert (cov["F"]["covered"], cov["F"]["due"]) == (0.0, 20.0) and cov["F"]["sources"] == []


def test_refund_on_cancel():
    """Отмена с возвратом: возврат гасит СВОЁ списание; оплата снова на балансе."""
    bk = {"A": B("A", "2026-10-02")}
    rows = [
        _topup("t1", "2026-09-30T08:00:00", 20),
        _charge("cA", "2026-10-01T06:00:00", 20, "A"),
        R("rA", "2026-10-01T09:00:00", 20, "booking_refund", ref_type="booking", ref_id="A", booking_id="A"),
    ]
    res = allocate(rows, bk, balance=20)
    r = _rows(res)
    assert res["consistent"] and res["debts"] == []
    assert [(b["rowId"], b["amount"]) for b in res["batches"]] == [("t1", 20.0)], "оплата не вернулась на баланс"
    assert [x["amount"] for x in r["rA"]["reversed"]] == [20.0] and r["rA"]["spentOn"] == []
    assert [x["label"] for x in r["cA"]["reversedBy"]] == ["возврат 01.10"] and r["cA"]["paidFrom"] == []
    assert r["t1"]["left"] == 20.0
    # Списана в долг и отменена с возвратом — долга нет (не висит на отменённой).
    res2 = allocate(rows[1:], bk, balance=0)
    assert res2["consistent"] and res2["debts"] == [] and res2["batches"] == []
    # Отмена со штрафом (без возврата) — долг остаётся на отменённой брони, с пометкой.
    bk3 = {"A": B("A", "2026-10-02", status="cancelled")}
    res3 = allocate(rows[1:2], bk3, balance=-20)
    assert [(d["bookingId"], d["amount"], d["label"]) for d in res3["debts"]] == [("A", 20.0, "02.10 10:00 Каб. 2, отменена")]


def test_correction_rows():
    """Корректировка: минус — потребитель (из оплаты), плюс — партия «корректировка»."""
    rows = [
        _topup("t1", "2026-09-20T08:00:00", 50, method="card_tbc"),
        R("k1", "2026-09-21T08:00:00", -15, "correction", ref_type="user", ref_id="u1"),
        R("k2", "2026-09-22T08:00:00", 10, "correction", ref_type="user", ref_id="u1"),
    ]
    res = allocate(rows, {}, balance=45)
    r = _rows(res)
    assert res["consistent"]
    assert _amounts(r["k1"]["paidFrom"]) == [("оплата 20.09", 15.0)]
    assert [(b["kind"], b["label"], b["amount"]) for b in res["batches"]] == [
        ("topup", "оплата 20.09", 35.0), ("correction", "корректировка 22.09", 10.0)]
    assert res["batches"][0]["detail"] == "TBC"
    assert [t["label"] for t in r["t1"]["spentOn"]] == ["корректировка 21.09"]


def test_baseline_is_oldest():
    """Стартовый остаток (21.07) — деньги ДО ленты: оплачивает и более ранние строки;
    долг на начало закрывают первым."""
    bk = {"A": B("A", "2026-07-11")}
    rows = [_charge("cA", "2026-07-10T06:00:00", 20, "A"),
            R("bl", "2026-07-21T05:44:45", 100, "baseline", ref_type=None)]
    res = allocate(rows, bk, balance=80)
    r = _rows(res)
    assert _amounts(r["cA"]["paidFrom"]) == [("остаток на начало", 20.0)] and r["cA"]["debtClosed"] == []
    assert [(b["kind"], b["amount"]) for b in res["batches"]] == [("baseline", 80.0)]
    rows2 = [R("bl", "2026-07-21T05:44:45", -30, "baseline"), _topup("t1", "2026-07-25T08:00:00", 10)]
    res2 = allocate(rows2, {}, balance=-20)
    assert [(d["label"], d["amount"]) for d in res2["debts"]] == [("долг на начало", 20.0)]
    assert _amounts(_rows(res2)["bl"]["debtClosed"]) == [("оплата 25.07", 10.0)]


def test_inconsistent_flag_no_crash():
    """Баланс правили мимо кошелька: сумма ленты 20 ≠ баланс 50 — флаг, без падения."""
    res = allocate([_topup("t1", "2026-09-20T08:00:00", 20)], {}, balance=50)
    assert res["consistent"] is False and res["ledgerSum"] == 20.0 and res["balance"] == 50.0
    assert res["allocatedBalance"] == 20.0
    res_empty = allocate([], {}, balance=0)
    assert res_empty["consistent"] is True and res_empty["rows"] == []


def test_unlinked_creation_rows_linked():
    """Списание и откат «при создании брони» пишутся без номера брони: узнаём по
    клиенту и времени (≤ 3 с), серию — по дате в описании."""
    t = datetime(2026, 10, 4, 10, 0, 0)
    h = B("H", "2026-10-04", "18:00")
    rows = [
        Row("c0", t, -20, "booking_charge", "Оплата брони с баланса (при создании)", "booking", None),
        Row("r0", t + timedelta(milliseconds=1), 20, "booking_charge_revert",
            "Откат списания — бронь ушла на подтверждение (hot)", "booking", None),
        _charge("ap", "2026-10-04T11:00:00", 20, "H"),
    ]
    other = B("X", "2026-10-09", "10:00", price=20)
    link_unlinked(rows, {"H": (t + timedelta(milliseconds=5), h), "X": (t - timedelta(minutes=30), other)})
    assert rows[0].booking_id == "H" and rows[1].booking_id == "H"
    res = allocate(rows, {"H": h}, balance=-20)
    assert [(d["bookingId"], d["amount"]) for d in res["debts"]] == [("H", 20.0)]
    r = _rows(res)
    assert [x["amount"] for x in r["r0"]["reversed"]] == [20.0], "откат не погасил своё списание"
    assert r["r0"]["reversed"][0]["rowId"] == "c0", "откат погасил списание при подтверждении, а не при создании"
    assert res["debts"][0]["rowIds"] == ["ap"] and r["ap"]["debtOpen"] == 20.0
    # Серия одним запросом: две брони по 20 ₾, у каждой своя строка — по дате.
    s1, s2 = B("S1", "2026-10-05", "10:00"), B("S2", "2026-10-12", "10:00")
    rs = [Row("a", t, -20, "booking_charge", "Оплата брони с баланса (серия 2026-10-12)", "booking", None),
          Row("b", t, -20, "booking_charge", "Оплата брони с баланса (серия 2026-10-05)", "booking", None)]
    link_unlinked(rs, {"S1": (t, s1), "S2": (t, s2)})
    assert (rs[0].booking_id, rs[1].booking_id) == ("S2", "S1"), [(x.id, x.booking_id) for x in rs]
    # Мульти-слот: время из описания.
    m1, m2 = B("M1", "2026-10-05", "10:00"), B("M2", "2026-10-05", "12:00")
    rm = [Row("m", t, -20, "booking_charge", "Оплата брони с баланса (мульти-слот 2026-10-05 00:00:00 12:00)", "booking", None)]
    link_unlinked(rm, {"M1": (t, m1), "M2": (t, m2)})
    assert rm[0].booking_id == "M2"
    # Далеко по времени — не привязываем.
    far = [Row("z", t, -20, "booking_charge", "Оплата брони с баланса (при создании)", "booking", None)]
    link_unlinked(far, {"H": (t + timedelta(seconds=10), h)})
    assert far[0].booking_id is None


def test_topup_reversal_nets():
    """Удалили кассовую проводку — отмена гасит своё пополнение, денег «из воздуха» нет."""
    rows = [_topup("t1", "2026-09-20T08:00:00", 50, tx="tx1"),
            R("x1", "2026-09-20T09:00:00", -50, "topup_reversal", ref_type="cashbox_tx", ref_id="tx1")]
    res = allocate(rows, {}, balance=0)
    assert res["consistent"] and res["batches"] == [] and res["debts"] == []
    r = _rows(res)
    assert [x["amount"] for x in r["x1"]["reversed"]] == [50.0] and [x["amount"] for x in r["t1"]["reversedBy"]] == [50.0]


def test_session_order_like_front():
    """Деньги — ранним броням по времени НАЧАЛА брони, как «к оплате» с 29.09:
    горячая бронь сегодня (списана позже) получает старую оплату, долг — на завтрашней."""
    bk = {"T": B("T", "2026-10-06", "10:00"), "H": B("H", "2026-10-05", "20:00")}
    rows = [_charge("cT", "2026-10-05T06:00:00", 20, "T"), _charge("cH", "2026-10-05T14:00:00", 20, "H"),
            _topup("t1", "2026-10-05T16:00:00", 20)]
    res = allocate(rows, bk, balance=-20)
    assert [(d["bookingId"], d["amount"]) for d in res["debts"]] == [("T", 20.0)], res["debts"]
    assert _amounts(_rows(res)["cH"]["debtClosed"]) == [("оплата 05.10", 20.0)]


# ── 2. Ручки на SQLite ───────────────────────────────────────────────────

def _db():
    from sqlmodel import Session, SQLModel, create_engine
    from sqlalchemy.pool import StaticPool
    import app.models  # noqa: F401
    import app.models.balance_ledger  # noqa: F401
    import app.models.weekly_rebate  # noqa: F401
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    return Session(engine)


_P2_DAY = (__import__("datetime").datetime.utcnow() + __import__("datetime").timedelta(days=30)).date()


def _seed(s):
    from app.models.balance_ledger import BalanceLedger
    from app.models.booking import Booking
    from app.models.cashbox_transaction import CashboxTransaction
    from app.models.resource import Resource
    from app.models.user import User
    from app.models.weekly_rebate import WeeklyRebate

    s.add(Resource(id="room_2", name="Кабинет 2", type="cabinet", location_id="unbox_uni",
                   hourly_rate=20.0, capacity=4, area=10, formats=["individual"]))
    admin = User(email="admin@demo.ge", name="Админ", role="admin", hashed_password="x")
    spec = User(email="spec@demo.ge", name="Специалист", role="specialist", hashed_password="x")
    plus = User(email="plus@demo.ge", name="Клиент Плюс", role="specialist", hashed_password="x", balance=9.0)
    debt = User(email="debt@demo.ge", name="Клиент Долг", role="specialist", hashed_password="x", balance=-40.0)
    zero = User(email="zero@demo.ge", name="Клиент Ноль", role="specialist", hashed_password="x", balance=0.0)
    for u in (admin, spec, plus, debt, zero):
        s.add(u)
    s.commit()
    for u in (admin, spec, plus, debt, zero):
        s.refresh(u)

    def bk(user, day, t, price, status="confirmed", pay="paid"):
        b = Booking(resource_id="room_2", location_id="unbox_uni", date=datetime.fromisoformat(day), start_time=t,
                    duration=60, status=status, final_price=price, payment_method="balance", payment_status=pay,
                    user_id=user.email, user_uuid=user.id, created_at=datetime(2026, 8, 1))
        s.add(b)
        s.commit()
        s.refresh(b)
        return b

    def led(user, at, delta, reason, ref_type=None, ref_id=None, desc=""):
        s.add(BalanceLedger(user_id=str(user.id), delta=delta, balance_after=0, reason=reason, description=desc,
                            ref_type=ref_type, ref_id=ref_id, created_at=datetime.fromisoformat(at)))

    # Плюс 9 ₾: оплата 20 картой TBC → бронь 20 (оплачена); скидка 9 ₾ за 28.09–04.10.
    tx = CashboxTransaction(type="income", amount=20, payment_method="card_tbc", date=datetime(2026, 9, 30, 8),
                            admin_id=str(admin.id), credited_user_id=str(plus.id))
    s.add(tx)
    s.commit()
    s.refresh(tx)
    p1 = bk(plus, "2026-10-02T00:00:00", "10:00", 20)
    led(plus, "2026-09-30T08:00:00", 20, "topup", "cashbox_tx", tx.id)
    led(plus, "2026-10-01T06:00:00", -20, "booking_charge", "booking", str(p1.id))
    led(plus, "2026-10-05T01:00:01", 9, "weekly_rebate", "weekly_rebate", str(plus.id))
    s.add(WeeklyRebate(user_id=plus.id, week_start=date(2026, 9, 21), amount=9, tier_percent=10,
                       created_at=datetime(2026, 10, 5, 1, 0, 2)))
    # Будущая несписанная бронь — дата от «сейчас» (08.10 стала прошлым 08.10.2026 и сторож упал).
    p2 = bk(plus, f"{_P2_DAY.isoformat()}T00:00:00", "12:00", 20, pay="pending")
    # Долг 40 ₾: старая бронь (август — вне окна админки) и новая — обе в долг.
    old = bk(debt, "2026-08-03T00:00:00", "10:00", 20)
    new = bk(debt, "2026-10-04T00:00:00", "14:00", 20)
    led(debt, "2026-08-02T06:00:00", -20, "booking_charge", "booking", str(old.id))
    led(debt, "2026-10-03T10:00:00", -20, "booking_charge", "booking", str(new.id))
    s.commit()
    return {"admin": admin, "spec": spec, "plus": plus, "debt": debt, "zero": zero,
            "p1": p1, "p2": p2, "old": old, "new": new}


def test_endpoints_and_rights_sqlite():
    from fastapi import HTTPException
    from app.api import deps
    from app.api.v1 import balance_allocation as api
    s = _db()
    d = _seed(s)
    # Права: сводка — админ с crm.view_clients; специалисту — 403 на обе ручки.
    assert api.require_clients_view(current_user=d["admin"]) is d["admin"]
    for fn in (lambda: deps.require_admin(d["spec"]), lambda: api.require_clients_view(current_user=d["spec"])):
        try:
            fn()
            raise AssertionError("специалисту отдали раскладку денег клиентов")
        except HTTPException as e:
            assert e.status_code == 403
    src = _read("backend/app/api/v1/balance_allocation.py")
    assert 'current_user: User = Depends(deps.require_admin),' in src, "раскладка клиента — не как лента (require_admin)"
    assert "current_user: User = Depends(require_clients_view)," in src

    res = api.get_user_balance_allocation(user_id=str(d["plus"].id), session=s, current_user=d["admin"])
    assert res["consistent"] and res["balance"] == 9.0
    assert [(b["kind"], b["amount"], b["detail"]) for b in res["batches"]] == [("weekly_rebate", 9.0, "21.09–27.09")], \
        "неделя скидки не из WeeklyRebate"
    money = {m["bookingId"]: m for m in res["bookings"]}
    assert money[str(d["p1"].id)]["sources"][0]["detail"] == "TBC", "способ оплаты не из кассовой проводки"
    assert [(c["bookingId"], c["covered"], c["due"]) for c in res["coverage"]] == [(str(d["p2"].id), 9.0, 11.0)]
    assert res["coverage"][0]["booking"]["label"] == f"{_P2_DAY:%d.%m} 12:00 Каб. 2"
    by_email = api.get_user_balance_allocation(user_id="plus@demo.ge", session=s, current_user=d["admin"])
    assert by_email["userId"] == str(d["plus"].id)

    summ = api.get_balance_allocation_summary(session=s, current_user=d["admin"])
    clients = {c["email"]: c for c in summ["clients"]}
    assert set(clients) == {"plus@demo.ge", "debt@demo.ge"}, "в сводке клиенты с нулём или без денег"
    debts = clients["debt@demo.ge"]["debts"]
    assert [(x["bookingId"], x["amount"]) for x in debts] == [(str(d["old"].id), 20.0), (str(d["new"].id), 20.0)]
    assert debts[0]["booking"]["date"] == "2026-08-03" and debts[0]["label"] == "03.08 10:00 Каб. 2"
    assert all(isinstance(c, dict) for c in summ["clients"]), "сводка — массив объектов (ключи-почты сломал бы toCamelCase)"


# ── 3–5. Фронт в node (esbuild) ──────────────────────────────────────────

def _tools():
    node = shutil.which("node")
    esb = ROOT / "node_modules" / ".bin" / "esbuild"
    if not node or not esb.exists():
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    return (node, str(esb)) if (major, minor) >= (22, 6) else None


_BUNDLE = {}


def _bundle():
    """Собрать dueAmounts.ts + balanceAllocation.ts в один модуль для node (один раз)."""
    if "path" in _BUNDLE:
        return _BUNDLE["path"]
    tools = _tools()
    if not tools:
        _BUNDLE["path"] = None
        return None
    node, esb = tools
    tmp = tempfile.mkdtemp(prefix="alloc-guard-")
    entry = os.path.join(tmp, "entry.ts")
    with open(entry, "w", encoding="utf-8") as f:
        f.write(
            f"export * from '{(ROOT / 'src/utils/dueAmounts.ts').as_posix()}';\n"
            f"export * from '{(ROOT / 'src/utils/balanceAllocation.ts').as_posix()}';\n"
        )
    out = os.path.join(tmp, "alloc.mjs")
    r = subprocess.run([esb, entry, "--bundle", "--format=esm", "--platform=node", f"--outfile={out}",
                        "--log-level=error"], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, f"esbuild упал: {r.stderr[:600]}"
    _BUNDLE["path"] = out
    _BUNDLE["node"] = node
    return out


def _node(script: str, payload) -> object:
    mod = _bundle()
    if not mod:
        return None
    tmp = tempfile.mkdtemp(prefix="alloc-guard-run-")
    data = os.path.join(tmp, "data.json")
    with open(data, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    body = f"import * as m from '{pathlib.Path(mod).as_posix()}';\nimport {{ readFileSync }} from 'node:fs';\n" \
           f"const data = JSON.parse(readFileSync('{pathlib.Path(data).as_posix()}', 'utf8'));\n{script}"
    r = subprocess.run([_BUNDLE["node"], "--input-type=module", "-e", body], capture_output=True, text=True,
                       timeout=180, cwd=str(ROOT))
    assert r.returncode == 0, f"node упал: {r.stderr[:800]}"
    return json.loads(r.stdout.strip().splitlines()[-1])


def _nb(s):
    """Неразрывные пробелы formatGel → обычные (для сравнения строк)."""
    return re.sub(r"[  ]", " ", s) if isinstance(s, str) else s


# ── Симулятор клиента: брони, списания за 24 ч, горячие брони, оплаты, скидки ──

NOW_UTC = datetime(2026, 10, 5, 6, 0)          # пн 05.10, 10:00 по Тбилиси
NOW_TBS = NOW_UTC + TZ


def _simulate(rng: random.Random, n: int, edge):
    """Один клиент. edge=False — обычные потоки (возврат при любой отмене списанной
    брони, без списаний не за брони); "nonbooking" — ещё списания не за бронь
    (корректировка, абонемент с баланса, продажа абонемента с кассы парой, склейка
    с долгом, «часы подряд»); "penalty" — ещё поздняя отмена без возврата (штраф)."""
    email = f"c{n}@demo.ge"
    rows: list[Row] = []
    refs: dict[str, BookingRef] = {}
    front = []
    created: dict[str, tuple] = {}
    used_starts = set()
    kinds = {"penalty": 0, "non_booking": 0}
    for k in range(rng.randint(1, 9)):
        while True:
            start = (NOW_TBS.replace(minute=0) + timedelta(hours=rng.randint(-24 * 20, 24 * 12)))
            start = start.replace(hour=rng.randint(9, 20), minute=rng.choice([0, 30]))
            if start not in used_starts:
                used_starts.add(start)
                break
        bid = f"b{n}-{k}"
        lead = timedelta(hours=rng.choice([1, 3, 6, 12, 20, 30, 50, 24 * 4, 24 * 9]))
        created_tbs = min(start - lead, NOW_TBS - timedelta(minutes=5))
        method = rng.choices(["balance", "subscription", "bonus"], weights=[86, 8, 6])[0]
        price = float(rng.choice([10, 15, 20, 20, 30, 36, 40, 60, 17.5]))
        if method == "subscription":
            price = float(rng.choice([0, 0, 5, 7.5]))
        elif method == "bonus":
            price = float(rng.choice([0, 10]))
        hot = (start - created_tbs) <= timedelta(hours=24)
        charge_tbs = created_tbs if hot else start - timedelta(hours=24)
        charged = charge_tbs <= NOW_TBS
        end = start + timedelta(minutes=60)
        status, pay = "confirmed", ("paid" if charged else "pending")
        awaiting = hot and start > NOW_TBS and rng.random() < 0.12 and method == "balance" and price > 0
        cron_fail = (not hot) and charged and end < NOW_TBS and rng.random() < 0.04
        cancel_at = None
        if not awaiting and rng.random() < 0.18:
            cancel_at = created_tbs + (min(start, NOW_TBS) - created_tbs) * rng.random()
        unlinked = hot and rng.random() < 0.7
        at_created_utc = created_tbs - TZ
        if awaiting:
            # Горячая бронь не-админа: списали и сразу откатили (обе строки без номера).
            rows.append(Row(f"{bid}-c0", at_created_utc, -price, "booking_charge",
                            "Оплата брони с баланса (при создании)", "booking", None))
            rows.append(Row(f"{bid}-r0", at_created_utc + timedelta(milliseconds=1), price,
                            "booking_charge_revert", "Откат списания — бронь ушла на подтверждение (hot)", "booking", None))
            status, pay = "pending_approval", "pending"
        elif cron_fail:
            pay = "pending"
        elif charged and price > 0 and (cancel_at is None or cancel_at > charge_tbs):
            if unlinked:
                rows.append(Row(f"{bid}-c", charge_tbs - TZ, -price, "booking_charge",
                                "Оплата брони с баланса (при создании)", "booking", None))
            else:
                rows.append(Row(f"{bid}-c", charge_tbs - TZ, -price, "booking_charge", "списание с баланса (T-24ч)",
                                "booking", bid, booking_id=bid))
            if cancel_at is not None:
                if edge == "penalty" and rng.random() < 0.5:
                    kinds["penalty"] += 1  # поздняя отмена: деньги не вернули
                else:
                    rows.append(Row(f"{bid}-rf", cancel_at - TZ, price, "booking_refund", "Возврат при отмене брони",
                                    "booking", bid, booking_id=bid))
        if cancel_at is not None:
            status = "cancelled"
        ref = BookingRef(id=bid, day=start.date(), start_time=start.strftime("%H:%M"), duration=60,
                         resource_id="room_2", resource_name="Кабинет 2", status=status, payment_status=pay,
                         payment_method=method, final_price=price)
        refs[bid] = ref
        created[bid] = (at_created_utc + timedelta(milliseconds=3), ref)
        fstatus = status
        if status == "confirmed" and end < NOW_TBS:
            fstatus = "completed"
        front.append({"id": bid, "userId": email, "date": start.strftime("%Y-%m-%dT00:00:00"),
                      "startTime": start.strftime("%H:%M"), "duration": 60, "status": fstatus,
                      "paymentStatus": pay, "paymentMethod": method, "finalPrice": price})
    for k in range(rng.randint(0, 4)):
        at = NOW_UTC - timedelta(minutes=rng.randint(10, 60 * 24 * 21))
        rows.append(_topup(f"t{n}-{k}", at.isoformat(), float(rng.choice([10, 20, 30, 40, 50, 100, 12.5])),
                           method=rng.choice(["cash", "card_tbc", "card_bog"])))
    for wk in range(3):
        if rng.random() < 0.45:
            at = datetime(2026, 9, 21, 1, 0) + timedelta(days=7 * wk)
            rows.append(R(f"w{n}-{wk}", at.isoformat(), float(rng.choice([1.5, 4, 6, 9, 12, 18])), "weekly_rebate"))
    if edge == "nonbooking":
        for j in range(rng.randint(1, 3)):
            kinds["non_booking"] += 1
            at = NOW_UTC - timedelta(minutes=rng.randint(10, 60 * 24 * 14))
            kind = rng.choice(["correction", "subscription_purchase", "sale", "merge", "consecutive_recompute"])
            amt = float(rng.choice([2, 10, 15, 70, 350]))
            if kind == "sale":
                # Продажа абонемента с кассы: пополнение и списание одним действием.
                rows.append(R(f"s{n}-{j}", at.isoformat(), amt, "topup", ref_type="cashbox_tx", ref_id=f"tx-s{n}-{j}",
                              description="Пополнение через кассу (cash) — оплата абонемента «Профи+»"))
                rows.append(R(f"p{n}-{j}", (at + timedelta(milliseconds=4)).isoformat(), -amt, "subscription_purchase",
                              ref_type="user", description="Оплата абонемента «Профи+»"))
            elif kind == "merge":
                rows.append(R(f"k{n}-{j}", at.isoformat(), -amt, "merge", ref_type="user",
                              description="Слияние баланса из old@demo.ge"))
            else:
                rows.append(R(f"k{n}-{j}", at.isoformat(), -amt, kind, ref_type="user"))
    link_unlinked(rows, created)
    balance = round(sum(r.delta for r in rows), 2)
    res = allocate(rows, refs, balance=balance)
    assert res["consistent"], f"клиент {n}: раскладка не сошлась с лентой"
    # Сводка считает без раскладки по строкам (detail=False) — партии и долги те же.
    lite = allocate(rows, refs, balance=balance, detail=False)
    assert lite["batches"] == res["batches"] and lite["debts"] == res["debts"], f"клиент {n}: сводка ≠ карточка"
    summary = {"userId": f"id-{n}", "email": email, "balance": balance, "consistent": True,
               "batches": res["batches"], "debts": res["debts"],
               "unlinked": BA.unlinked_charged(rows, list(refs.values()), NOW_TBS) if balance < 0 else []}
    return {"id": n, "email": email, "balance": balance, "bookings": front, "summary": summary, "kinds": kinds}


_PARITY_JS = r"""
const out = [];
for (const c of data) {
  const balanceOf = uid => (uid === c.email ? c.balance : null);
  const old = m.computeDueByBooking(c.bookings, balanceOf);
  const idx = m.indexAllocation([c.summary]);
  const neu = m.applyAllocation(old, c.bookings, idx, balanceOf);
  const obj = mp => Object.fromEntries([...mp].map(([k, v]) => [k, { due: v.due, price: v.price, charged: v.charged,
    covered: (v.coveredBy || []).reduce((s, p) => s + p.amount, 0) }]));
  let win = null;
  if (c.window) {
    const wb = c.bookings.filter(b => c.window.includes(b.id));
    const o2 = m.computeDueByBooking(wb, balanceOf);
    const n2 = m.applyAllocation(o2, wb, idx, balanceOf);
    win = { old: obj(o2), neu: obj(n2),
      outside: m.debtsOutsideList(c.summary, new Set(wb.map(b => b.id))).map(d => [d.bookingId, d.amount]) };
  }
  out.push({ id: c.id, old: obj(old), neu: obj(neu), win });
}
console.log(JSON.stringify(out));
"""


_PARITY_STATS = {}


_PARITY_CACHE: dict = {}


def _parity_run(count: int, edge: bool, seed: int):
    key = (count, edge, seed)
    if key not in _PARITY_CACHE:
        _PARITY_CACHE[key] = _parity_run_uncached(count, edge, seed)
    return _PARITY_CACHE[key]


def _parity_run_uncached(count: int, edge: bool, seed: int):
    rng = random.Random(seed)
    cases = [_simulate(rng, i, edge) for i in range(count)]
    wrng = random.Random(seed + 1)
    for c in cases:
        # Окно админки — последние брони по дате (ORDER BY date DESC LIMIT 5000):
        # обрезаются самые СТАРЫЕ, будущие в окне всегда. У каждого второго
        # клиента «теряем» брони раньше случайной даты в прошлом.
        if c["id"] % 2 == 0 and len(c["bookings"]) > 1:
            cutoff = (NOW_TBS - timedelta(days=wrng.randint(0, 12))).strftime("%Y-%m-%d")
            c["window"] = [b["id"] for b in c["bookings"] if b["date"][:10] >= cutoff]
    payload = [{k: c[k] for k in ("id", "email", "balance", "bookings", "summary")} | {"window": c.get("window")}
               for c in cases]
    res = _node(_PARITY_JS, payload)
    return cases, res


def test_parity_front_old_vs_new_random():
    """«К оплате» не меняется по смыслу: при полном списке броней прежний расчёт фронта
    (computeDueByBooking) и новый (applyAllocation по раскладке сервера) дают одни и те
    же суммы по КАЖДОЙ брони — 600 клиентов с обычными потоками (предоплата, долг,
    горячие брони вне порядка, возвраты, скидки, брони на подтверждении)."""
    cases, res = _parity_run(600, edge=False, seed=20261003)
    if res is None:
        return
    checked = mism = covered_checks = 0
    bad = []
    for c, r in zip(cases, res):
        for bid, o in r["old"].items():
            n = r["neu"].get(bid)
            checked += 1
            if n is None or abs(n["due"] - o["due"]) > 0.005 or n["charged"] != o["charged"]:
                mism += 1
                bad.append((c["id"], bid, o, n))
            if n and not n["charged"] and n["covered"] > 0:
                covered_checks += 1
                assert abs(n["covered"] - (n["price"] - n["due"])) < 0.006, (c["id"], bid, n)
        assert set(r["neu"]) >= set(r["old"]), "новый расчёт потерял бронь"
    _PARITY_STATS["strict"] = (len(cases), checked, mism, covered_checks)
    assert mism == 0, f"суммы «к оплате» разошлись: {mism} из {checked}: {bad[:3]}"
    assert checked > 1500 and covered_checks > 50, (checked, covered_checks)


def test_parity_non_booking_debits_exact():
    """Списания не за бронь (корректировка, абонемент с баланса, продажа абонемента с
    кассы, склейка с долгом, «часы подряд»): «к оплате» по КАЖДОЙ брони — как прежний
    расчёт (ревью денег 03.10: новое такое списание не «забирает» долг у броней —
    иначе брони в долг получали «✓ оплачено»). 400 клиентов, расхождений 0."""
    cases, res = _parity_run(400, edge="nonbooking", seed=20261005)
    if res is None:
        return
    checked = mism = with_debits = 0
    bad = []
    for c, r in zip(cases, res):
        with_debits += bool(c["kinds"]["non_booking"])
        for bid, o in r["old"].items():
            n = r["neu"][bid]
            checked += 1
            if abs(n["due"] - o["due"]) > 0.005:
                mism += 1
                bad.append((c["id"], bid, o["due"], n["due"]))
    _PARITY_STATS["nonbooking"] = (len(cases), checked, mism, with_debits)
    assert mism == 0, f"списание не за бронь сдвинуло «к оплате»: {mism} из {checked}: {bad[:3]}"


def test_parity_penalty_flows_totals_hold():
    """Поздняя отмена без возврата (штраф): долг остаётся на отменённой брони (её в
    шахматке нет — видна в «Ещё долг» и в карточке), у остальных броней «к оплате»
    может стать только МЕНЬШЕ и только у клиентов со штрафом. Долг клиента целиком на
    месте: Σ «к оплате» по списанным броням + долги вне списка == минус баланса."""
    cases, res = _parity_run(400, edge="penalty", seed=20261004)
    if res is None:
        return
    moved = clients_moved = 0
    for c, r in zip(cases, res):
        debt = max(0.0, -c["balance"])
        neu_charged = sum(v["due"] for v in r["neu"].values() if v["charged"])
        shown = {b["id"] for b in c["bookings"] if b["id"] in r["neu"]}
        outside = sum(d["amount"] for d in c["summary"]["debts"] if not d["bookingId"] or d["bookingId"] not in shown)
        assert abs(neu_charged + outside - debt) < 0.011, (c["id"], neu_charged, outside, debt)
        for bid, o in r["old"].items():
            if not o["charged"]:
                assert abs(r["neu"][bid]["due"] - o["due"]) < 0.006, "покрытие несписанной брони изменилось"
        diff = [bid for bid, o in r["old"].items() if abs(r["neu"][bid]["due"] - o["due"]) > 0.005]
        moved += len(diff)
        clients_moved += bool(diff)
        if diff:
            assert c["kinds"]["penalty"], f"клиент {c['id']}: сумма сдвинулась без штрафа"
            assert all(r["neu"][b]["due"] <= r["old"][b]["due"] + 0.005 for b in diff), \
                f"клиент {c['id']}: у брони стало БОЛЬШЕ «к оплате»"
    _PARITY_STATS["penalty"] = (len(cases), moved, clients_moved)


def test_review_scenarios_no_false_paid():
    """Сценарии ревью денег 03.10 — бронь в долг не получает «✓ оплачено»:
    продажа абонемента с кассы при долге; корректировка после броней; деление брони
    (вторая часть без строк ленты); склейка (брони с другого профиля, долг одной
    строкой); «часы подряд» (возврат на клиента, «к оплате» не больше цены брони)."""
    cases = {}

    def fb(i, email, day, t, price, pay="paid", status="completed"):
        return {"id": i, "userId": email, "date": f"{day}T00:00:00", "startTime": t, "duration": 60, "status": status,
                "paymentStatus": pay, "paymentMethod": "balance", "finalPrice": price}

    def case(name, rows, refs, front, balance, expect):
        res = allocate(rows, refs, balance=balance)
        assert res["consistent"], name
        email = front[0]["userId"]
        cases[name] = {"email": email, "balance": balance, "bookings": front, "expect": expect,
                       "summary": {"userId": "id-" + name, "email": email, "balance": balance, "consistent": True,
                                   "batches": res["batches"], "debts": res["debts"],
                                   "unlinked": BA.unlinked_charged(rows, list(refs.values()), NOW_TBS)}}

    # 1. Три неоплаченные брони, потом продажа абонемента с кассы (+350 / −350).
    e = "sale@demo.ge"
    refs = {f"b{i}": B(f"b{i}", f"2026-10-0{i}", "10:00") for i in (1, 2, 3)}
    rows = [_charge(f"c{i}", f"2026-09-3{0}T06:00:00" if i == 1 else f"2026-10-0{i - 1}T06:00:00", 20, f"b{i}")
            for i in (1, 2, 3)]
    rows += [R("ts", "2026-10-04T08:00:00", 350, "topup", ref_type="cashbox_tx", ref_id="txs",
               description="Пополнение через кассу (cash) — оплата абонемента «Профи+»"),
             R("ps", "2026-10-04T08:00:00.004000", -350, "subscription_purchase", ref_type="user",
               description="Оплата абонемента «Профи+»")]
    case("sale", rows, refs, [fb(f"b{i}", e, f"2026-10-0{i}", "10:00", 20) for i in (1, 2, 3)], -60,
         {"b1": 20, "b2": 20, "b3": 20})
    # 2. Корректировка −10 после броней: b1 оплачена, b2 в долг.
    e = "corr@demo.ge"
    refs = {"b1": B("b1", "2026-10-01"), "b2": B("b2", "2026-10-02")}
    rows = [_topup("t1", "2026-09-29T08:00:00", 20), _charge("c1", "2026-09-30T06:00:00", 20, "b1"),
            _charge("c2", "2026-10-01T06:00:00", 20, "b2"),
            R("k1", "2026-10-04T08:00:00", -10, "correction", ref_type="user")]
    case("correction", rows, refs, [fb("b1", e, "2026-10-01", "10:00", 20), fb("b2", e, "2026-10-02", "10:00", 20)],
         -30, {"b1": 10, "b2": 20})
    # 3. Деление брони: X (2 ч, 40 ₾) списана в долг, потом разделена на X 20 + Y 20 (у Y строк нет).
    e = "split@demo.ge"
    refs = {"X": B("X", "2026-10-02", "10:00", price=20), "Y": B("Y", "2026-10-02", "11:00", price=20)}
    rows = [_charge("cx", "2026-10-01T06:00:00", 40, "X")]
    case("split", rows, refs, [fb("X", e, "2026-10-02", "10:00", 20), fb("Y", e, "2026-10-02", "11:00", 20)], -40,
         {"X": 20, "Y": 20})
    # 4. Склейка: долг 50 ₾ приехал одной строкой, брони с другого профиля — без строк ленты.
    e = "merge@demo.ge"
    refs = {"T1": B("T1", "2026-09-20", price=20), "T2": B("T2", "2026-09-25", price=30)}
    rows = [R("m1", "2026-10-01T08:00:00", -50, "merge", ref_type="user", description="Слияние баланса из old@demo.ge")]
    case("merge", rows, refs, [fb("T1", e, "2026-09-20", "10:00", 20), fb("T2", e, "2026-09-25", "10:00", 30)], -50,
         {"T1": 20, "T2": 30})
    # 5. «Часы подряд»: A и B по 18 ₾ после пересчёта, возврат +2 ₾ пишется на клиента.
    e = "chain@demo.ge"
    refs = {"A": B("A", "2026-10-02", "10:00", price=18), "B": B("B", "2026-10-02", "11:00", price=18)}
    rows = [_charge("ca", "2026-10-01T06:00:00", 20, "A"), _charge("cb", "2026-10-01T07:00:00", 18, "B"),
            R("cr", "2026-10-01T07:00:01", 2, "consecutive_recompute", ref_type="user")]
    case("chain", rows, refs, [fb("A", e, "2026-10-02", "10:00", 18), fb("B", e, "2026-10-02", "11:00", 18)], -36,
         {"A": 18, "B": 18})
    out = _node("""
const res = {};
for (const [name, c] of Object.entries(data)) {
  const balanceOf = uid => (uid === c.email ? c.balance : null);
  const old = m.computeDueByBooking(c.bookings, balanceOf);
  const neu = m.applyAllocation(old, c.bookings, m.indexAllocation([c.summary]), balanceOf);
  res[name] = { old: Object.fromEntries([...old].map(([k, v]) => [k, v.due])),
                neu: Object.fromEntries([...neu].map(([k, v]) => [k, [v.due, v.price]])) };
}
console.log(JSON.stringify(res));
""", cases)
    if out is None:
        return
    for name, c in cases.items():
        got = {k: v[0] for k, v in out[name]["neu"].items()}
        assert got == c["expect"], f"{name}: «к оплате» {got}, ждали {c['expect']} (прежний расчёт {out[name]['old']})"
        assert got == out[name]["old"], f"{name}: разошлось с прежним расчётом {out[name]['old']}"
        for k, (due, price) in out[name]["neu"].items():
            assert due <= price + 0.005, f"{name}/{k}: к оплате {due} больше цены {price}"
    # Подписи: склейка на принимающем профиле — «долг с другого профиля»; продажа — пара.
    r_sale = _rows(allocate(
        [R("ts", "2026-10-04T08:00:00", 350, "topup", ref_type="cashbox_tx", ref_id="txs",
           description="Пополнение через кассу (cash) — оплата абонемента «Профи+»"),
         R("ps", "2026-10-04T08:00:00.004000", -350, "subscription_purchase", ref_type="user",
           description="Оплата абонемента «Профи+»")], {}, balance=0))
    assert _amounts(r_sale["ps"]["paidFrom"]) == [("оплата 04.10", 350.0)], r_sale["ps"]
    assert [t["label"] for t in r_sale["ts"]["spentOn"]] == ["абонемент «Профи+»"]
    r_merge = _rows(allocate([R("m1", "2026-10-01T08:00:00", -50, "merge", description="Слияние баланса из old@demo.ge")],
                             {}, balance=-50))
    assert BA.debit_label(Row("m1", datetime(2026, 10, 1, 8), -50, "merge", "Слияние баланса из old@demo.ge"), None) \
        == "долг с другого профиля 01.10"
    assert r_merge["m1"]["debtOpen"] == 50.0


def test_risk1_window_does_not_lose_debt():
    """Риск 1: брони вне окна админки (последние 5000). Суммы на бронях в окне те же,
    что при полном списке, а долг броней вне окна не пропадает — он в сводке."""
    cases, res = _parity_run(600, edge=False, seed=20261003)
    if res is None:
        return
    windows = old_lost = 0
    for c, r in zip(cases, res):
        if not r["win"]:
            continue
        windows += 1
        for bid, n in r["win"]["neu"].items():
            full = r["neu"][bid]
            assert abs(n["due"] - full["due"]) < 0.006, f"клиент {c['id']}: сумма брони зависит от окна"
        debt = max(0.0, -c["balance"])
        in_win = sum(v["due"] for v in r["win"]["neu"].values() if v["charged"])
        outside = sum(a for _, a in r["win"]["outside"])
        assert abs(in_win + outside - debt) < 0.011, (c["id"], in_win, outside, debt)
        old_in_win = sum(v["due"] for v in r["win"]["old"].values() if v["charged"])
        if old_in_win < debt - 0.005:
            old_lost += 1
    _PARITY_STATS["window"] = (windows, old_lost)
    assert windows > 200


def test_risk1_concrete_case():
    """Долг 30 ₾: старая бронь (август, 20 ₾) вне окна и новая (10 ₾) в окне.
    Раньше в окне видно 10 ₾, 20 ₾ терялись; теперь — в «Ещё долг»."""
    bk = {"O": B("O", "2026-08-03", price=20), "N": B("N", "2026-10-04", price=10)}
    rows = [_charge("cO", "2026-08-02T06:00:00", 20, "O"), _charge("cN", "2026-10-03T06:00:00", 10, "N")]
    res = allocate(rows, bk, balance=-30)
    summary = {"userId": "id-1", "email": "o@demo.ge", "balance": -30, "consistent": True,
               "batches": res["batches"], "debts": res["debts"]}
    win = [{"id": "N", "userId": "o@demo.ge", "date": "2026-10-04T00:00:00", "startTime": "10:00", "status": "completed",
            "paymentStatus": "paid", "paymentMethod": "balance", "finalPrice": 10}]
    out = _node("""
const balanceOf = () => -30;
const old = m.computeDueByBooking(data.win, balanceOf);
const neu = m.applyAllocation(old, data.win, m.indexAllocation([data.summary]), balanceOf);
console.log(JSON.stringify({ old: old.get('N').due, neu: neu.get('N').due,
  outside: m.debtsOutsideList(data.summary, new Set(['N'])).map(d => [d.bookingId, d.amount, d.label]) }));
""", {"win": win, "summary": summary})
    if out is None:
        return
    assert out["old"] == 10 and out["neu"] == 10
    assert out["outside"] == [["O", 20, "03.08 10:00 Каб. 2"]], out


def test_texts_in_node():
    """Тексты строк и значков — на живых примерах."""
    bk = {"M": B("M", "2026-10-05")}
    rows = [
        _topup("t0", "2026-09-30T08:00:00", 11),
        _charge("cM", "2026-10-04T06:00:00", 20, "M"),
        R("wr", "2026-10-05T01:00:00", 9, "weekly_rebate"),
        _charge("cX", "2026-10-05T06:00:00", 20, "X"),
    ]
    bk["X"] = B("X", "2026-10-06", "14:00")
    res = allocate(rows, bk, balance=-20)
    rows_by = _rows(res)
    undo = _rows(allocate([_topup("t9", "2026-09-20T08:00:00", 50, tx="tx9"),
                           R("x9", "2026-09-20T09:00:00", -50, "topup_reversal", ref_type="cashbox_tx", ref_id="tx9")],
                          {}, balance=0))
    rows_by.update(undo)
    plus = allocate([R("wr", "2026-10-05T01:00:00", 9, "weekly_rebate"), _topup("t1", "2026-09-30T08:00:00", 11)],
                    {}, balance=20)
    plus["coverage"] = project_coverage(plus["batches"], [B("P", "2026-10-07", "14:00", price=20)])
    out = _node("""
const r = data.rows;
const mk = (due, price, charged, coveredBy) => ({ due, price, charged, coveredBy });
const covered = mk(0, 20, false, [{ rowId: 'wr', kind: 'weekly_rebate', label: 'скидка за неделю', amount: 9 },
                                 { rowId: 't1', kind: 'topup', label: 'оплата 30.09', amount: 11 }]);
console.log(JSON.stringify({
  cM: m.ledgerRowLine(r.cM), cX: m.ledgerRowLine(r.cX), wr: m.ledgerRowLine(r.wr), t0: m.ledgerRowLine(r.t0),
  t9: m.ledgerRowLine(r.t9), x9: m.ledgerRowLine(r.x9),
  headDebt: m.allocationHeadline(data.debt), headPlus: m.allocationHeadline(data.plus),
  payCovered: m.allocationPayLine(covered, null),
  payCharged: m.allocationPayLine(mk(0, 20, true), { sources: [{ label: 'оплата 30.09', amount: 20 }] }),
  payDebt: m.allocationPayLine(mk(20, 20, true), { sources: [] }),
  partial: m.partialCoverLine(mk(11, 20, false, [{ rowId: 'wr', kind: 'weekly_rebate', label: 'скидка за неделю', amount: 9 }])),
  partialNoSrc: m.partialCoverLine(mk(11, 20, true), null),
  labels: [m.dueLabel(mk(0, 20, true)), m.dueLabel(mk(0, 20, false)), m.dueLabel(mk(11, 20, false)), m.dueLabel(mk(20, 20, true))],
  kinds: [m.dueMarkKind(mk(0, 20, false)), m.dueMarkKind(mk(0, 20, true)), m.dueMarkKind(mk(5, 20, true)), m.dueMarkKind(null)],
  hints: [m.dueHint(mk(0, 20, false)), m.dueHint(mk(11, 20, true))],
}));
""", {"rows": rows_by, "debt": res, "plus": plus})
    if out is None:
        return
    out = {k: (_nb(v) if isinstance(v, str) else [_nb(x) for x in v] if isinstance(v, list) else v) for k, v in out.items()}
    assert out["cM"] == "из: оплата 30.09 11 ₾; в долг 9 ₾ → закрыто скидкой за неделю", out["cM"]
    assert out["cX"] == "в долг 20 ₾ — ещё не оплачено", out["cX"]
    assert out["wr"] == "закрыло долг: 05.10 10:00 Каб. 2 — 9 ₾", out["wr"]
    assert out["t0"] == "ушло на: 05.10 10:00 Каб. 2 — 11 ₾", out["t0"]
    assert out["t9"] == "отменено: отмена пополнения 20.09 — 50 ₾", out["t9"]
    assert out["x9"] == "отменило: оплата 20.09 — 50 ₾", out["x9"]
    assert out["headDebt"] == "Долг 20 ₾: бронь 06.10 14:00 Каб. 2 (20 ₾)", out["headDebt"]
    assert out["headPlus"] == ("На балансе 20 ₾: оплата 30.09 11 ₾ + скидка за неделю 9 ₾. "
                               "Покроет: 07.10 14:00 Каб. 2 (20 ₾)"), out["headPlus"]
    assert out["payCovered"] == "Оплачено: скидка за неделю 9 ₾ + оплата 30.09 11 ₾ · спишется за 24 ч до начала"
    assert out["payCharged"] == "Оплачено: оплата 30.09 20 ₾"
    assert out["payDebt"] is None, "бронь в долг не должна называться «оплачено»"
    assert out["partial"] == "9 ₾ покрыто: скидка за неделю"
    assert out["partialNoSrc"] == "9 ₾ уже покрыто балансом"
    assert out["labels"] == ["оплачено", "оплачено", "к оплате 11 ₾ из 20", "к оплате 20 ₾"], out["labels"]
    assert out["kinds"] == ["paid", "paid", "owes", None], out["kinds"]
    assert "спишется с баланса за 24 ч до начала" in out["hints"][0]
    assert out["hints"][1].startswith("к оплате 11 ₾ из 20 — часть уже покрыта балансом")


# ── Одно правило покрытия в трёх местах (ревью регрессий 03.10) ────────

def _js_set(src: str, name: str) -> set:
    m = re.search(rf"const {name} = new Set(?:<string>)?\(\[(.*?)\]\)", src, re.S)
    assert m, f"не нашёл {name}"
    out = set()
    for tok in (t.strip() for t in m.group(1).split(",")):
        if tok in ("undefined", "null"):
            out.add(None)
        elif tok:
            out.add(tok.strip("'\""))
    return out


def test_coverage_rule_constants_match():
    """Какие брони считаются в «к оплате» — одинаково на сервере (раскладка, покрытие
    несписанных) и на фронте (computeDueByBooking и applyAllocation)."""
    due = _read("src/utils/dueAmounts.ts")
    alloc = _read("src/utils/balanceAllocation.ts")
    statuses_front = _js_set(due, "DUE_STATUSES")
    assert statuses_front == set(BA.DUE_STATUSES) == _js_set(alloc, "SHOWN_STATUSES"), \
        (statuses_front, BA.DUE_STATUSES)
    money_front = _js_set(due, "MONEY_METHODS")
    assert "b.paymentMethod !== 'subscription'" in due, "фронт перестал брать абонемент с доплатой"
    assert money_front | {"subscription"} == set(BA.MONEY_METHODS), (money_front, BA.MONEY_METHODS)
    body = _code("src/utils/dueAmounts.ts")
    assert "if (b.status === 'completed' && b.paymentStatus === 'pending') continue;" in body
    assert "if (price <= 0 || b.paymentStatus === 'waived') continue;" in body
    assert "b.paymentStatus !== 'pending' && b.status !== 'pending_approval'" in body
    src = _read("backend/app/services/balance_allocation.py")
    assert 'if status == "completed" and b.payment_status == "pending":' in src
    assert 'if float(b.final_price or 0) <= 0 or b.payment_status == "waived":' in src
    assert 'charged = b.payment_status != "pending" and status != "pending_approval"' in src


def test_coverage_cross_run_server_front():
    """Покрытие несписанных броней плюсом баланса: сервер (due_kind + project_coverage —
    сводка «Покроет» в карточке) и фронт (computeDueByBooking + applyAllocation — значки)
    на одних и тех же случайных бронях: те же брони, суммы и партии."""
    rng = random.Random(20261006)
    cases = []
    for n in range(300):
        credits = [R(f"c{n}-{k}", (NOW_UTC - timedelta(days=rng.randint(1, 20), minutes=k)).isoformat(),
                     float(rng.choice([5, 9, 12.5, 20, 40])), rng.choice(["topup", "weekly_rebate", "correction"]))
                   for k in range(rng.randint(1, 3))]
        bal = round(sum(r.delta for r in credits), 2)
        res = allocate(credits, {}, balance=bal)
        refs, front, used = [], [], set()
        for k in range(rng.randint(1, 7)):
            while True:
                start = (NOW_TBS + timedelta(hours=rng.randint(-72, 24 * 10))).replace(minute=rng.choice([0, 30]))
                if start not in used:
                    used.add(start)
                    break
            status = rng.choices(["confirmed", "pending_approval", "cancelled", "completed"], weights=[70, 12, 10, 8])[0]
            pay = rng.choices(["pending", "paid", "waived", None], weights=[70, 15, 8, 7])[0]
            method = rng.choice(["balance", "balance", "bonus", "subscription", "cash", "", None])
            price = float(rng.choice([0, 5, 10, 17.5, 20]))
            ref = BookingRef(id=f"b{n}-{k}", day=start.date(), start_time=start.strftime("%H:%M"), duration=60,
                             status=status, payment_status=pay, payment_method=method, final_price=price)
            refs.append(ref)
            fstatus = "completed" if status == "confirmed" and start + timedelta(minutes=60) < NOW_TBS else status
            front.append({"id": ref.id, "userId": f"x{n}@demo.ge", "date": start.strftime("%Y-%m-%dT00:00:00"),
                          "startTime": ref.start_time, "duration": 60, "status": fstatus, "paymentStatus": pay,
                          "paymentMethod": method, "finalPrice": price})
        cov = BA.project_coverage(res["batches"], [b for b in refs if BA.due_kind(b, NOW_TBS) == "pending"])
        cases.append({"email": f"x{n}@demo.ge", "balance": bal, "bookings": front,
                      "summary": {"userId": f"x{n}", "email": f"x{n}@demo.ge", "balance": bal, "consistent": True,
                                  "batches": res["batches"], "debts": []},
                      "server": {c["bookingId"]: [c["due"], c["covered"], [x["amount"] for x in c["sources"]]] for c in cov}})
    out = _node("""
const res = [];
for (const c of data) {
  const balanceOf = uid => (uid === c.email ? c.balance : null);
  const neu = m.applyAllocation(m.computeDueByBooking(c.bookings, balanceOf), c.bookings, m.indexAllocation([c.summary]), balanceOf);
  const o = {};
  for (const [k, v] of neu) if (!v.charged) o[k] = [v.due, (v.coveredBy || []).reduce((s, p) => s + p.amount, 0), (v.coveredBy || []).map(p => p.amount)];
  res.push(o);
}
console.log(JSON.stringify(res));
""", cases)
    if out is None:
        return
    checked = 0
    for c, front_cov in zip(cases, out):
        assert set(front_cov) == set(c["server"]), (c["summary"]["userId"], sorted(front_cov), sorted(c["server"]))
        for bid, (due, covered, parts) in c["server"].items():
            f_due, f_cov, f_parts = front_cov[bid]
            assert abs(f_due - due) < 0.006 and abs(f_cov - covered) < 0.006, (bid, (due, covered), (f_due, f_cov))
            assert [round(x, 2) for x in f_parts] == [round(x, 2) for x in parts], (bid, parts, f_parts)
            checked += 1
    assert checked > 300, checked
    _PARITY_STATS["coverage"] = (len(cases), checked)


def test_hidden_debts_and_today_screens():
    """«Долги по броням вне списка» (риск 1): долг старой брони вне окна не теряется —
    hiddenDebts его отдаёт, «Сегодня» на компьютере и телефоне показывает (только если есть)."""
    bk = {"O": B("O", "2026-08-03", price=20), "N": B("N", "2026-10-04", price=10)}
    rows = [_charge("cO", "2026-08-02T06:00:00", 20, "O"), _charge("cN", "2026-10-03T06:00:00", 10, "N"),
            R("k1", "2026-10-03T08:00:00", -5, "correction", ref_type="user")]
    res = allocate(rows, bk, balance=-35)
    summary = {"userId": "id-h", "email": "h@demo.ge", "balance": -35, "consistent": True,
               "batches": res["batches"], "debts": res["debts"], "unlinked": []}
    win = [{"id": "N", "userId": "h@demo.ge", "date": "2026-10-04T00:00:00", "startTime": "10:00", "status": "completed",
            "paymentStatus": "paid", "paymentMethod": "balance", "finalPrice": 10}]
    out = _node("""
const balanceOf = uid => (uid === 'h@demo.ge' || uid === 'id-h' ? -35 : null);
const idx = m.indexAllocation([data.summary]);
const due = m.applyAllocation(m.computeDueByBooking(data.win, balanceOf), data.win, idx, balanceOf);
const h = m.hiddenDebts(due, data.win, idx, balanceOf);
const stale = m.hiddenDebts(due, data.win, idx, () => -10);
console.log(JSON.stringify({ shown: due.get('N').due, hidden: h.map(x => [x.userId, x.amount, x.debts.map(d => d.label)]), stale }));
""", {"win": win, "summary": summary})
    if out is not None:
        assert out["shown"] == 10, out
        assert out["hidden"] == [["id-h", 25, ["корректировка 03.10", "03.08 10:00 Каб. 2"]]], out["hidden"]
        assert out["stale"] == [], "устаревшая сводка (баланс другой) не должна давать долгов вне списка"
    for rel in ("src/pages/admin/Dashboard.tsx", "src/pages/mobile/admin/MobileAdminDashboard.tsx"):
        code = _code(rel)
        assert "hiddenDebts(dueMap, bookings, allocIndex," in code, f"{rel}: нет «Долги по броням вне списка»"
        assert "Долги по броням вне списка:" in code and "data-hidden-debts" in code
        assert "hidden.length > 0 &&" in code, f"{rel}: блок показывается и без долгов"


def test_summary_skips_broken_client():
    """Один «битый» клиент не роняет сводку в 500: он пропускается (в лог), остальные —
    в ответе; экран для пропущенного считает «к оплате» по-старому."""
    s = _db()
    d = _seed(s)
    orig = BA._summary_entry
    broken = str(d["debt"].id)

    def boom(u, data, now):
        if str(u.id) == broken:
            raise ValueError("битые данные")
        return orig(u, data, now)

    BA._summary_entry = boom
    BA.logger.disabled = True  # ожидаемая ошибка — без трассировки в выводе сторожа
    try:
        res = BA.summary(s)
    finally:
        BA._summary_entry = orig
        BA.logger.disabled = False
    assert [c["email"] for c in res["clients"]] == ["plus@demo.ge"], res["clients"]


def test_ui_no_flicker_and_phone_wrap():
    led = _code("src/components/admin/UserBalanceLedger.tsx")
    assert "if (loading && !data) {" in led, "лента снова мигает скелетоном при каждом перечитывании"
    assert "const allocOk = !!alloc && alloc.consistent" in led and "allocOk ? allocationHeadline(alloc) : null" in led
    hook = _code("src/hooks/useBalanceAllocation.ts")
    assert "stale: !current && !!prev," in hook, "раскладка клиента пропадает, пока грузится новая"
    card = _code("src/pages/mobile/admin/MobileAdminUserCard.tsx")
    assert "allocOk ? allocationHeadline(alloc) : null" in card
    for rel in ("src/pages/mobile/admin/MobileAdminBookings.tsx", "src/pages/mobile/admin/MobileAdminDashboard.tsx",
                "src/pages/mobile/admin/MobileAdminUserCard.tsx"):
        for m_ in re.finditer(r"<DueBadge\b[^>]*>", _code(rel)):
            assert "whitespace-normal" in m_.group(0) and "max-w-[124px]" in m_.group(0), \
                f"{rel}: «к оплате N ₾ из M» на телефоне не переносится — сжимает имя клиента"
    util = _code("src/utils/balanceAllocation.ts")
    assert "export const PENALTY_DEBT_ON_ACTIVE_BOOKINGS = false;" in util, \
        "долг за штраф: по умолчанию — на отменённой брони, пока владелец не решил иначе"


# ── Экраны подключены, значки по новому правилу ─────────────────────────

DUE_SCREENS = {
    "src/components/admin/AdminChessboardView.tsx": "useAllocationIndex(users, bookings)",
    "src/pages/admin/Bookings.tsx": "useAllocationIndex(users, bookings)",
    "src/pages/admin/Dashboard.tsx": "useAllocationIndex(users, bookings)",
    "src/pages/mobile/admin/adminPayment.ts": "useAllocationIndex(users || [], bookings || [])",
}


def test_screens_apply_allocation():
    for rel, hook in DUE_SCREENS.items():
        code = _code(rel)
        assert hook in code, f"{rel}: нет сводки раскладки"
        assert "applyAllocation(computeDueByBooking(bookings, balanceOf), bookings, allocIndex, balanceOf)" in code, \
            f"{rel}: «к оплате» не через applyAllocation поверх computeDueByBooking"
    card = _code("src/pages/mobile/admin/MobileAdminUserCard.tsx")
    assert "applyAllocation(computeDueByBooking(bookings, balanceOf), bookings, index, balanceOf)" in card
    assert "useClientAllocation(" in card and "ledgerRowLine(allocRows.get(e.id))" in card and "allocationHeadline(alloc)" in card
    led = _code("src/components/admin/UserBalanceLedger.tsx")
    assert "ledgerRowLine(allocRows.get(e.id))" in led and "allocationHeadline(alloc)" in led and "data-alloc-line" in led
    hints = _code("src/components/admin/BookingMoneyHints.tsx")
    assert "allocationPayLine(due, bookingMoney)" in hints and "partialCoverLine(due, bookingMoney)" in hints
    assert "data-other-debts" in hints, "попап брони не показывает долг по другим броням (риск 1)"
    api = _read("backend/app/api/v1/__init__.py")
    assert 'safe_include(api_router, "app.api.v1.balance_allocation", "", ["balance-allocation"])' in api


def test_badges_new_rule_no_covered_sign():
    badge = _code("src/components/admin/DueBadge.tsx")
    assert "спишется с баланса" not in badge and "CircleDashed" not in badge and "ui-badge--muted" not in badge, \
        "в DueBadge снова «◌ спишется с баланса»"
    assert "paidLabel = 'оплачено'" in badge and "к оплате" in badge and "partial &&" in badge
    chess = _code("src/components/admin/AdminChessboardView.tsx")
    assert "CircleDashed" not in chess and "COVERED_SHORT" not in chess and "'covered'" not in chess
    assert "'списано с баланса'" not in chess, "на плитке снова «списано с баланса» вместо «оплачено»"
    legend = _read("src/components/admin/AdminChessboardView.tsx")
    legend = legend[legend.index("data-chess-legend"):legend.index("{/* ── Панель брони")]
    assert "(!) к оплате 11 ₾ из 20" in legend and "оплачено — бронь покрыта деньгами клиента" in legend
    led = _code("src/components/admin/UserBalanceLedger.tsx")
    assert "}, [userId, reloadTick, balanceKey]);" in led, "после «Принять оплату» лента и сводка над ней не перечитываются"
    assert "balance={user.balance}" in _read("src/pages/admin/UserDetails.tsx")
    assert "спишется с баланса —" not in legend
    due = _code("src/utils/dueAmounts.ts")
    assert "export type DueMarkKind = 'owes' | 'paid';" in due
    assert "if (info.due <= 0) return 'оплачено';" in due
    st = _read("src/design/statuses.ts")
    assert "Списано с баланса" in st, "технический статус «Списано с баланса» трогать нельзя (решение 02.10)"


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
    if _PARITY_STATS:
        s = _PARITY_STATS
        if "strict" in s:
            print(f"  паритет: клиентов {s['strict'][0]}, броней сверено {s['strict'][1]}, расхождений {s['strict'][2]}, "
                  f"частично/полностью покрытых несписанных {s['strict'][3]}")
        if "nonbooking" in s:
            print(f"  списания не за бронь: клиентов {s['nonbooking'][0]} (со списаниями {s['nonbooking'][3]}), "
                  f"броней сверено {s['nonbooking'][1]}, расхождений {s['nonbooking'][2]}")
        if "penalty" in s:
            print(f"  штрафы без возврата: клиентов {s['penalty'][0]}, броней с другой суммой {s['penalty'][1]} "
                  f"(у {s['penalty'][2]} клиентов, все со штрафом, только «меньше»)")
        if "coverage" in s:
            print(f"  покрытие сервер↔фронт: клиентов {s['coverage'][0]}, несписанных броней сверено {s['coverage'][1]}, расхождений 0")
        if "window" in s:
            print(f"  окно 5000: клиентов с обрезанным списком {s['window'][0]}, у {s['window'][1]} прежний расчёт терял долг")
    print("СТОРОЖ оплачено скидкой 2026-10: OK" if not failures else f"СТОРОЖ оплачено скидкой 2026-10 УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
