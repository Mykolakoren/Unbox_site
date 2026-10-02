"""СТОРОЖ: «Итоги дня» в кассе и видимость недельной скидки (решение владельца 02.10).

Цель: админы перестают вести Excel и пересчитывать недельную скидку вручную —
пользуются только сайтом. Экран денежный, но ТОЛЬКО ЧТЕНИЕ.

Что держит этот сторож:
  Сервер (services/day_summary.py, одна функция compute_day_summary):
  1  «Пришло» — по филиалам и счетам (наличные / TBC / BOG); корректировки
     (payment_method='adjustment'), «корректировка при закрытии смены»
     (category_id='cash_reconciliation') и «[КОРРЕКЦИЯ …]» в «пришло/ушло» не
     попадают — идут отдельными строками; «пришло» + они = журнал кассы за день.
  2  Граница дня — полночь Тбилиси (20:00 UTC), а не UTC.
  3  «Списано с балансов» — по ленте баланса за брони ЭТОГО дня, филиал — по
     кабинету брони; возвраты отдельно; списание «при создании» без номера брони
     находится по клиенту и времени; бронь завтрашнего дня, списанная сегодня, —
     не в сегодняшних итогах.
  4  «Должны на конец дня» — баланс на конец дня (текущий − движения после),
     без архивных; сегодня — текущие балансы.
  5  Недельные скидки: начисленные в день; «с последнего понедельника» — одно
     правило для «Сегодня» и попапа брони; отчёт за неделю (клиент, часы, %, ₾).
  6  Смена: открыта / закрыта / не было; ожидалось / по факту / расхождение.
  7  Эндпоинты закрыты правами отчётов (require_reports), не шире.
  8  Сводка в Telegram берёт цифры из ТОЙ ЖЕ функции; сбой блока не ломает сводку.
  Фронт (статика + node):
  9  Блок «Итоги дня» есть на компьютере и телефоне, тексты простые, подсказка
     про сверку с таблицей; раздел «Недельные скидки».
  10 Метка «скидка за неделю +9 ₾ уже учтена в «к оплате»» — в «Сегодня»
     (компьютер и телефон) и в попапе брони, одна формулировка.

Без сети и боевой базы: SQLite в памяти, node — если есть ≥ 22.6.

    python3 backend/tests/guard_day_summary_2026_10.py
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

ROOT = pathlib.Path(__file__).parent.parent.parent

D = date(2026, 10, 1)                      # день по Тбилиси
D_START = datetime(2026, 9, 30, 20, 0)     # 00:00 по Тбилиси = 20:00 UTC накануне
D_END = datetime(2026, 10, 1, 20, 0)


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:'\"`\\])//[^\n]*", r"\1", src)


def _code(rel: str) -> str:
    return _strip_comments(_read(rel))


def _py_code(rel: str) -> str:
    """Python без комментариев и докстрингов (грубо, для статических проверок)."""
    src = _read(rel)
    src = re.sub(r'"""[\s\S]*?"""', '""', src)
    return re.sub(r"#[^\n]*", "", src)


# ─── Фикстуры ────────────────────────────────────────────────────────────

def _session():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine
    import app.models.specialist  # noqa: F401  (relationship у User)
    from app.models.balance_ledger import BalanceLedger
    from app.models.booking import Booking
    from app.models.cashbox_transaction import CashboxTransaction
    from app.models.expense_category import ExpenseCategory
    from app.models.location import Location
    from app.models.shift_open_log import ShiftOpenLog
    from app.models.shift_report import ShiftReport
    from app.models.user import User
    from app.models.weekly_rebate import WeeklyRebate

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[
        User.__table__, BalanceLedger.__table__, Booking.__table__, CashboxTransaction.__table__,
        ExpenseCategory.__table__, Location.__table__, ShiftOpenLog.__table__, ShiftReport.__table__,
        WeeklyRebate.__table__,
    ])
    s = Session(eng)
    for lid, name in (("unbox_one", "Unbox One"), ("unbox_uni", "Unbox Uni"), ("neo_school", "Neo School")):
        s.add(Location(id=lid, name=name, address="Батуми"))
    s.commit()
    return s


def _user(s, name, balance=0.0, archived=False):
    from app.models.user import User
    u = User(email=f"{uuid4().hex[:8]}@example.com", name=name, hashed_password="x", balance=balance,
             archived_at=datetime(2026, 9, 1) if archived else None)
    s.add(u)
    s.commit()
    s.refresh(u)
    return u


def _tx(s, when, amount, method="cash", branch="Unbox One", type="income", category=None, description=None):
    from app.models.cashbox_transaction import CashboxTransaction
    tx = CashboxTransaction(
        type=type, amount=amount, payment_method=method, branch=branch, category_id=category,
        description=description, date=when, created_at=when, admin_id="a1", admin_name="Ирина",
    )
    s.add(tx)
    s.commit()
    return tx


def _booking(s, user, day, loc="unbox_one", price=20.0, created=None, status="confirmed", method="balance"):
    from app.models.booking import Booking
    b = Booking(
        resource_id=f"{loc}_room_1", location_id=loc, date=datetime(day.year, day.month, day.day),
        start_time="10:00", duration=60, status=status, final_price=price, payment_method=method,
        payment_status="paid", user_id=user.email, user_uuid=user.id,
        created_at=created or datetime(2026, 9, 20, 9, 0),
    )
    s.add(b)
    s.commit()
    s.refresh(b)
    return b


def _ledger(s, user, delta, reason, when, booking=None, ref_type="booking"):
    from app.models.balance_ledger import BalanceLedger
    s.add(BalanceLedger(
        user_id=str(user.id), delta=delta, balance_after=0.0, reason=reason,
        ref_type=ref_type if (booking is not None or ref_type != "booking") else "booking",
        ref_id=str(booking.id) if booking is not None else None, created_at=when,
    ))
    s.commit()


def _cash_day(s):
    """Касса дня D: по филиалам, счетам, корректировкам и на границах дня."""
    _tx(s, datetime(2026, 10, 1, 6, 0), 100, "cash", "Unbox One")
    _tx(s, datetime(2026, 10, 1, 7, 0), 50, "card_tbc", "Unbox One")
    _tx(s, datetime(2026, 10, 1, 8, 0), 20, "card_bog", "Unbox One")
    _tx(s, datetime(2026, 10, 1, 9, 0), 30, "cash", "Unbox One", type="expense", category="cat-supplies")
    _tx(s, datetime(2026, 10, 1, 15, 0), 2, "cash", "Unbox One", category="cash_reconciliation",
        description="Корректировка при закрытии смены (Ирина). Ожидалось 1.00 ₾, фактически 3.00 ₾.")
    _tx(s, datetime(2026, 10, 1, 15, 10), 10, "cash", "Unbox One",
        description="[КОРРЕКЦИЯ · Unbox One] Пересчёт кассы (было: 1.00, стало: 11.00)")
    _tx(s, D_START, 70, "cash", "Unbox Uni")                                    # 00:00 по Тбилиси — уже D
    _tx(s, D_END - timedelta(seconds=1), 15, "card_bog", "Unbox Uni")          # 23:59:59 — ещё D
    _tx(s, datetime(2026, 10, 1, 16, 0), 3, "cash", "Unbox Uni", type="expense", category="cash_reconciliation")
    _tx(s, D_START - timedelta(seconds=1), 999, "cash", "Unbox Uni")           # 23:59:59 вчера — не D
    _tx(s, D_END, 888, "cash", "Unbox Uni")                                     # 00:00 завтра — не D
    _tx(s, datetime(2026, 10, 1, 1, 0), 9, "adjustment", None, type="expense",
        description="Недельная скидка за объём (10%, 10.5 ч) — неделя с 2026-09-21")
    _tx(s, datetime(2026, 10, 1, 6, 35), 640, "adjustment", None, description="Корректировка баланса")
    _tx(s, datetime(2026, 10, 1, 10, 0), 5, "card_bog", None)


def _block(res, branch):
    for b in res["branches"]:
        if b["branch"] == branch:
            return b
    raise AssertionError(f"нет блока филиала {branch!r}: {[b['branch'] for b in res['branches']]}")


# ─── 1. Пришло / ушло по филиалам и счетам ───────────────────────────────

def test_income_by_method_and_branch_without_adjustments():
    from app.services.day_summary import compute_day_summary
    s = _session()
    _cash_day(s)
    res = compute_day_summary(s, D, now_utc=datetime(2026, 10, 3, 9, 0))
    one, uni, none = _block(res, "Unbox One"), _block(res, "Unbox Uni"), _block(res, None)
    assert one["income"] == {"cash": 100, "card_tbc": 50, "card_bog": 20, "total": 170, "count": 3}, one["income"]
    assert one["expense"]["cash"] == 30 and one["expense"]["total"] == 30, one["expense"]
    assert one["shift_recon"]["net"] == 2 and one["shift_recon"]["income"] == 2, "расхождение смены попало в «пришло»?"
    assert one["balance_fix"]["net"] == 10, "корректировка остатка не отдельной строкой"
    assert uni["income"] == {"cash": 70, "card_tbc": 0, "card_bog": 15, "total": 85, "count": 2}, uni["income"]
    assert uni["expense"]["total"] == 0, "расхождение смены (−3) ушло в «ушло»"
    assert uni["shift_recon"]["net"] == -3, uni["shift_recon"]
    assert none["income"]["card_bog"] == 5 and none["income"]["total"] == 5, "приход без филиала потерялся"
    t = res["total"]
    assert (t["income"]["cash"], t["income"]["card_tbc"], t["income"]["card_bog"], t["income"]["total"]) == (170, 50, 40, 260), t
    assert t["expense"]["total"] == 30, t["expense"]
    assert res["adjustments"] == {"income": 640, "expense": 9, "count": 2}, "корректировки балансов — не деньги, отдельно"
    # Порядок: One, Uni (филиалы кассы), «без филиала» — в конце.
    assert [b["branch"] for b in res["branches"]] == ["Unbox One", "Unbox Uni", None]


def test_branch_filter_only_that_branch():
    from app.services.day_summary import compute_day_summary
    s = _session()
    _cash_day(s)
    res = compute_day_summary(s, D, "Unbox Uni", now_utc=datetime(2026, 10, 3, 9, 0))
    assert [b["branch"] for b in res["branches"]] == ["Unbox Uni"], res["branches"]
    assert res["total"]["income"]["total"] == 85 and res["total"]["income"]["cash"] == 70, res["total"]
    assert res["adjustments"]["count"] == 0, "корректировки без филиала попали в итоги филиала"


def test_matches_cash_journal_for_the_day():
    """Пришло + расхождение смены + корректировка остатка = приходы журнала кассы
    (GET /cashbox/transactions за тот же день и филиал), по каждому счёту."""
    from app.api.v1.cashbox.transactions import list_transactions
    from app.services.day_summary import compute_day_summary, tx_kind
    s = _session()
    _cash_day(s)
    res = compute_day_summary(s, D, now_utc=datetime(2026, 10, 3, 9, 0))
    for branch in ("Unbox One", "Unbox Uni"):
        journal = list_transactions(
            session=s, current_user=None, date_from=D_START.isoformat(),
            date_to=(D_END - timedelta(microseconds=1)).isoformat(), type=None, category_id=None,
            payment_method=None, branch=branch, skip=0, limit=1000,
        )
        blk = _block(res, branch)
        for side in ("income", "expense"):
            for method, key in (("cash", "cash"), ("card_tbc", "card_tbc"), ("card_bog", "card_bog")):
                money = sum(t.amount for t in journal if t.type == side and t.payment_method == method
                            and tx_kind(t) == "money")
                assert round(money, 2) == blk[side][key], (branch, side, method, money, blk[side])
            other = sum(t.amount for t in journal if t.type == side and tx_kind(t) in ("shift_recon", "balance_fix"))
            together = blk[side]["total"] + blk["shift_recon"][side] + blk["balance_fix"][side]
            assert round(sum(t.amount for t in journal if t.type == side), 2) == round(together, 2), \
                (branch, side, "журнал ≠ пришло + отдельные строки", other)


def test_tbilisi_day_boundary_not_utc():
    from app.services.day_summary import compute_day_summary, day_bounds_utc, tbilisi_today
    assert day_bounds_utc(D) == (D_START, D_END)
    assert tbilisi_today(datetime(2026, 10, 1, 19, 59)) == date(2026, 10, 1)
    assert tbilisi_today(datetime(2026, 10, 1, 20, 0)) == date(2026, 10, 2)
    s = _session()
    _cash_day(s)
    prev = compute_day_summary(s, date(2026, 9, 30), now_utc=datetime(2026, 10, 3, 9, 0))
    nxt = compute_day_summary(s, date(2026, 10, 2), now_utc=datetime(2026, 10, 3, 9, 0))
    assert _block(prev, "Unbox Uni")["income"]["cash"] == 999, "23:59:59 по Тбилиси ушло не в свой день"
    assert _block(nxt, "Unbox Uni")["income"]["cash"] == 888, "00:00 по Тбилиси ушло не в свой день"
    assert compute_day_summary(s, D, now_utc=datetime(2026, 10, 1, 10, 0))["is_today"] is True
    assert compute_day_summary(s, D, now_utc=datetime(2026, 10, 1, 20, 0))["is_today"] is False


# ─── 2. Списано с балансов за брони дня ──────────────────────────────────

def _charges_fixture(s):
    a, b = _user(s, "Анна"), _user(s, "Борис")
    b1 = _booking(s, a, D, "unbox_one", 20)
    _ledger(s, a, -20, "booking_charge", datetime(2026, 9, 30, 6, 0), b1)          # T−24ч, накануне
    b2 = _booking(s, b, D, "unbox_uni", 15)
    _ledger(s, b, -15, "booking_charge", datetime(2026, 9, 30, 7, 0), b2)
    _ledger(s, b, -8.5, "extend_charge", datetime(2026, 10, 1, 9, 0), b2)
    b3 = _booking(s, a, D, "unbox_uni", 10, status="cancelled")
    _ledger(s, a, -10, "booking_charge", datetime(2026, 9, 30, 8, 0), b3)
    _ledger(s, a, 10, "booking_refund", datetime(2026, 9, 30, 9, 0), b3)
    # Бронь на сегодня, созданная сегодня: списание «при создании» без номера брони.
    created = datetime(2026, 10, 1, 7, 0, 0, 100)
    b4 = _booking(s, b, D, "unbox_one", 12, created=created)
    _ledger(s, b, -12, "booking_charge", created + timedelta(microseconds=400))
    # Бронь на ЗАВТРА того же клиента, созданная в ту же секунду, — её запись не наша.
    b6 = _booking(s, b, D + timedelta(days=1), "unbox_uni", 30, created=created + timedelta(microseconds=200))
    _ledger(s, b, -30, "booking_charge", created + timedelta(microseconds=600))
    # Бронь на завтра, списанная сегодня (T−24ч), — не в сегодняшних итогах.
    b5 = _booking(s, a, D + timedelta(days=1), "unbox_one", 20)
    _ledger(s, a, -20, "booking_charge", datetime(2026, 10, 1, 6, 0), b5)
    # Обслуживание и абонемент — с баланса не списываются.
    _booking(s, a, D, "unbox_one", 0, method="subscription")
    return a, b, (b1, b2, b3, b4, b5, b6)


def test_charges_for_bookings_of_the_day_by_branch():
    from app.services.day_summary import compute_day_summary
    s = _session()
    _charges_fixture(s)
    res = compute_day_summary(s, D, now_utc=datetime(2026, 10, 3, 9, 0))
    one, uni = _block(res, "Unbox One")["charges"], _block(res, "Unbox Uni")["charges"]
    assert one == {"charged": 32, "refunded": 0, "net": 32, "bookings": 2}, \
        f"One: 20 (T−24ч) + 12 (при создании, без номера брони): {one}"
    assert uni == {"charged": 33.5, "refunded": 10, "net": 23.5, "bookings": 2}, \
        f"Uni: 15 + продление 8,5 + отменённая 10 и её возврат: {uni}"
    assert res["total"]["charges"]["net"] == 55.5, res["total"]["charges"]
    nxt = compute_day_summary(s, D + timedelta(days=1), now_utc=datetime(2026, 10, 3, 9, 0))
    assert _block(nxt, "Unbox One")["charges"]["charged"] == 20, "бронь завтрашнего дня потеряла списание"
    assert _block(nxt, "Unbox Uni")["charges"]["charged"] == 30, \
        "запись «при создании» досталась не той брони (не сверили сумму/клиента)"


def test_unlinked_charge_of_other_client_not_attached():
    from app.services.day_summary import compute_day_summary
    s = _session()
    a, b = _user(s, "Анна"), _user(s, "Борис")
    created = datetime(2026, 10, 1, 7, 0)
    _booking(s, a, D, "unbox_one", 12, created=created)
    _ledger(s, b, -12, "booking_charge", created)                     # другой клиент
    _ledger(s, a, -12, "booking_charge", created + timedelta(seconds=40))  # слишком далеко по времени
    res = compute_day_summary(s, D, now_utc=datetime(2026, 10, 3, 9, 0))
    assert _block(res, "Unbox One")["charges"]["charged"] == 0, "чужая/далёкая запись ленты привязалась к брони"


# ─── 3. Должники на конец дня ────────────────────────────────────────────

def test_debtors_at_end_of_day_and_now():
    from app.services.day_summary import compute_day_summary
    s = _session()
    a = _user(s, "Анна", balance=-50)
    b = _user(s, "Борис", balance=20)
    _user(s, "Вера (архив)", balance=-100, archived=True)
    g = _user(s, "Глеб", balance=-10)
    e = _user(s, "Ева (новая)", balance=-20)
    _ledger(s, a, 30, "topup", datetime(2026, 10, 2, 8, 0), ref_type="cashbox_tx")     # после дня: на конец дня −80
    _ledger(s, b, -40, "booking_charge", datetime(2026, 10, 2, 9, 0), ref_type="user")  # на конец дня было 60
    _ledger(s, e, -20, "baseline", datetime(2026, 10, 2, 10, 0), ref_type="user")       # появилась после дня
    past = compute_day_summary(s, D, now_utc=datetime(2026, 10, 3, 9, 0))["debtors"]
    assert past["count"] == 2 and past["amount"] == 90, past
    assert [(x["name"], x["debt"]) for x in past["items"]] == [("Анна", 80), ("Глеб", 10)], past["items"]
    assert past["as_of"] == D_END.isoformat()
    today = compute_day_summary(s, date(2026, 10, 3), now_utc=datetime(2026, 10, 3, 9, 0))["debtors"]
    assert today["count"] == 3 and today["amount"] == 80, f"сегодня — текущие балансы: {today}"
    assert str(g.id) in {x["user_id"] for x in today["items"]}


# ─── 4. Недельные скидки ─────────────────────────────────────────────────

def _rebates_fixture(s):
    from app.models.weekly_rebate import WeeklyRebate
    a, b = _user(s, "Ольга"), _user(s, "Марина")
    monday = datetime(2026, 9, 28, 1, 0)        # пн 05:00 по Тбилиси — крон
    _ledger(s, a, 9, "weekly_rebate", monday, ref_type="weekly_rebate")
    _ledger(s, b, 3, "weekly_rebate", monday + timedelta(seconds=1), ref_type="weekly_rebate")
    _ledger(s, a, 7, "weekly_rebate", datetime(2026, 9, 27, 19, 59), ref_type="weekly_rebate")  # вс 23:59 — прошлая
    s.add(WeeklyRebate(user_id=a.id, week_start=date(2026, 9, 21), total_hours=10.5, tier_percent=10, amount=9,
                       created_at=monday))
    s.add(WeeklyRebate(user_id=b.id, week_start=date(2026, 9, 21), total_hours=8.0, tier_percent=10, amount=3,
                       created_at=monday))
    s.commit()
    return a, b


def test_weekly_rebates_credited_that_day_and_since_last_monday():
    from app.services.day_summary import compute_day_summary, recent_weekly_rebates, last_monday_start_utc
    s = _session()
    a, b = _rebates_fixture(s)
    mon = compute_day_summary(s, date(2026, 9, 28), now_utc=datetime(2026, 10, 3, 9, 0))
    assert mon["weekly_rebates"] == {"amount": 12, "count": 2}, mon["weekly_rebates"]
    assert compute_day_summary(s, D, now_utc=datetime(2026, 10, 3, 9, 0))["weekly_rebates"]["count"] == 0
    # «С последнего понедельника по Тбилиси»: пн 28.09 00:00 = вс 27.09 20:00 UTC.
    assert last_monday_start_utc(datetime(2026, 10, 1, 10, 0)) == datetime(2026, 9, 27, 20, 0)
    assert last_monday_start_utc(datetime(2026, 9, 27, 20, 30)) == datetime(2026, 9, 27, 20, 0), \
        "понедельник 00:30 по Тбилиси — уже новая неделя"
    rows = recent_weekly_rebates(s, now_utc=datetime(2026, 10, 1, 10, 0))
    assert sorted(float(r.delta) for r in rows) == [3, 9], "в «скидки этой недели» попала прошлая (вс 23:59)"
    assert [float(r.delta) for r in recent_weekly_rebates(s, now_utc=datetime(2026, 10, 1, 10, 0), user_id=str(a.id))] == [9]
    assert recent_weekly_rebates(s, now_utc=datetime(2026, 10, 5, 3, 0)) == [], \
        "в новый понедельник висит скидка прошлой недели"


def test_weekly_rebate_report_for_week():
    from app.services.day_summary import weekly_rebate_report
    s = _session()
    _rebates_fixture(s)
    rep = weekly_rebate_report(s, date(2026, 9, 24))      # любой день недели → её понедельник
    assert rep["week_start"] == "2026-09-21" and rep["week_end"] == "2026-09-27" and rep["credited_on"] == "2026-09-28", rep
    assert [(i["name"], i["hours"], i["percent"], i["amount"]) for i in rep["items"]] == \
        [("Ольга", 10.5, 10, 9), ("Марина", 8.0, 10, 3)], rep["items"]
    assert rep["total"] == 12 and rep["count"] == 2
    assert weekly_rebate_report(s, date(2026, 9, 14))["items"] == []


def test_popup_last_rebate_uses_same_rule():
    """Попап брони (estimate_booking_rebate.last_rebate) — то же правило «с последнего
    понедельника», что метка в «Сегодня»; формула самой скидки не тронута."""
    src = _py_code("backend/app/services/weekly_rebate.py")
    est = src[src.index("def estimate_booking_rebate("):]
    assert "recent_weekly_rebates(session, user_id=str(user.id))" in est, "попап считает «последнюю скидку» по-своему"
    assert "timedelta(days=8)" not in est, "в попапе снова окно «8 дней»"
    run = src[src.index("def run_weekly_rebates("):src.index("def estimate_booking_rebate(")]
    assert "day_summary" not in run, "начисление скидки зависит от экрана итогов"


# ─── 5. Смена ────────────────────────────────────────────────────────────

def test_shift_open_closed_none():
    from app.models.shift_open_log import ShiftOpenLog
    from app.models.shift_report import ShiftReport
    from app.services.day_summary import compute_day_summary
    s = _session()
    _tx(s, datetime(2026, 9, 1, 8, 0), 500, "cash", "Unbox Uni")
    s.add(ShiftReport(expected_balance=517.7, actual_balance=517.7, discrepancy=0, branch="Unbox One",
                      shift_start=datetime(2026, 9, 30, 14, 0), shift_end=datetime(2026, 10, 1, 14, 6),
                      admin_id="v", admin_name="Валентина"))
    s.add(ShiftOpenLog(branch="Unbox Uni", starting_balance=365.6, opened_at=datetime(2026, 10, 1, 17, 35),
                       admin_id="i", admin_name="Ирина"))
    s.add(ShiftReport(expected_balance=515.6, actual_balance=520.0, discrepancy=4.4, branch="Unbox Uni",
                      shift_start=datetime(2026, 9, 30, 16, 43), shift_end=datetime(2026, 10, 1, 17, 45),
                      admin_id="i", admin_name="Ирина"))
    s.add(ShiftOpenLog(branch="Unbox Uni", starting_balance=520, opened_at=datetime(2026, 10, 2, 7, 55),
                       admin_id="e", admin_name="Егор"))
    s.commit()
    res = compute_day_summary(s, D, now_utc=datetime(2026, 10, 2, 10, 0))
    one, uni = _block(res, "Unbox One")["shift"], _block(res, "Unbox Uni")["shift"]
    assert one["status"] == "closed" and one["closed_by"] == "Валентина" and one["expected"] == 517.7 \
        and one["actual"] == 517.7 and one["discrepancy"] == 0, one
    assert uni["status"] == "closed" and uni["discrepancy"] == 4.4 and uni["actual"] == 520, uni
    nxt = compute_day_summary(s, date(2026, 10, 2), now_utc=datetime(2026, 10, 2, 10, 0))
    uni2, one2 = _block(nxt, "Unbox Uni")["shift"], _block(nxt, "Unbox One")["shift"]
    assert uni2["status"] == "open" and uni2["opened_by"] == "Егор" and uni2["closed_at"] is None, uni2
    assert uni2["cash_by_records"] == 500, "«наличных по записям» не равно итогу наличных филиала"
    assert one2["status"] == "none", one2
    # Общее закрытие (branch NULL) закрывает смену филиала, но цифр филиала у него нет.
    s.add(ShiftReport(expected_balance=1000, actual_balance=1000, discrepancy=0, branch=None,
                      shift_start=datetime(2026, 10, 2, 0, 0), shift_end=datetime(2026, 10, 2, 15, 0),
                      admin_id="o", admin_name="Владелец"))
    s.commit()
    uni3 = _block(compute_day_summary(s, date(2026, 10, 2), now_utc=datetime(2026, 10, 2, 16, 0)), "Unbox Uni")["shift"]
    assert uni3["status"] == "closed" and uni3["closed_all_branches"] is True and uni3["expected"] is None, uni3
    # Своё закрытие филиала в тот же день важнее более позднего общего — его цифры и показываем.
    s.add(ShiftReport(expected_balance=600, actual_balance=598, discrepancy=-2, branch="Unbox One",
                      shift_start=datetime(2026, 10, 1, 14, 6), shift_end=datetime(2026, 10, 2, 14, 0),
                      admin_id="v", admin_name="Валентина"))
    s.commit()
    one3 = _block(compute_day_summary(s, date(2026, 10, 2), now_utc=datetime(2026, 10, 2, 16, 0)), "Unbox One")["shift"]
    assert one3["status"] == "closed" and one3["closed_all_branches"] is False and one3["discrepancy"] == -2 \
        and one3["closed_by"] == "Валентина", one3


# ─── 6. Права ────────────────────────────────────────────────────────────

def test_endpoints_closed_by_reports_permission():
    src = _py_code("backend/app/api/v1/cashbox/day_summary.py")
    assert src.count("Depends(require_reports)") == 3, "не все эндпоинты итогов закрыты require_reports"
    assert "require_cashbox" not in src and "require_admin" not in src, "доступ к итогам расширен"
    assert "ds.compute_day_summary(" in src, "эндпоинт считает итоги не общей функцией"
    init = _read("backend/app/api/v1/cashbox/__init__.py")
    assert "router.include_router(day_summary.router)" in init

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api import deps
    from app.api.v1.cashbox import router as cashbox_router
    from app.db.session import get_session

    s = _session()
    _cash_day(s)
    app = FastAPI()
    app.include_router(cashbox_router, prefix="/cashbox")
    app.dependency_overrides[get_session] = lambda: s
    who = {"user": None}
    app.dependency_overrides[deps.get_current_user] = lambda: who["user"]
    client = TestClient(app)
    urls = ["/cashbox/day-summary?date=2026-10-01", "/cashbox/weekly-rebates", "/cashbox/weekly-rebates/recent"]
    for role in ("specialist", "user"):
        who["user"] = SimpleNamespace(id=uuid4(), role=role, permissions=[], name="x", email="x@x")
        for u in urls:
            r = client.get(u)
            assert r.status_code == 403, f"{role} получил {u}: {r.status_code}"
    who["user"] = SimpleNamespace(id=uuid4(), role="admin", permissions=[], name="Ирина", email="i@x")
    for u in urls:
        r = client.get(u)
        assert r.status_code == 200, f"админ не получил {u}: {r.status_code} {r.text[:200]}"
    body = client.get("/cashbox/day-summary", params={"date": "2026-10-01", "branch": "Unbox One"}).json()
    assert body["branch"] == "Unbox One" and body["total"]["income"]["total"] == 170, body["total"]
    assert client.get("/cashbox/day-summary", params={"date": "01.10.2026"}).status_code == 400


# ─── 7. Telegram: та же функция ──────────────────────────────────────────

def _run_daily_summary(s, monkey_compute=None):
    from app.api.v1 import telegram as tg
    from app.core import config
    from app.services import day_summary
    sent = {}
    orig_secret = getattr(config.settings, "TELEGRAM_REMINDER_SECRET", None)
    orig_send = tg.telegram_service.send_owner_summary
    orig_compute = day_summary.compute_day_summary
    try:
        config.settings.TELEGRAM_REMINDER_SECRET = "s3cret"
        tg.telegram_service.send_owner_summary = lambda text: sent.setdefault("text", text) and True
        if monkey_compute is not None:
            day_summary.compute_day_summary = monkey_compute
        res = tg.daily_summary_endpoint(secret="s3cret", session=s)
    finally:
        config.settings.TELEGRAM_REMINDER_SECRET = orig_secret
        tg.telegram_service.send_owner_summary = orig_send
        day_summary.compute_day_summary = orig_compute
    return res, sent.get("text", "")


def test_telegram_summary_uses_same_function():
    from app.services import day_summary
    s = _session()
    yday = day_summary.tbilisi_today() - timedelta(days=1)
    start, _end = day_summary.day_bounds_utc(yday)
    _tx(s, start + timedelta(hours=10), 100, "cash", "Unbox One")
    _tx(s, start + timedelta(hours=11), 50, "card_tbc", "Unbox One")
    _tx(s, start + timedelta(hours=12), 15, "card_bog", "Unbox Uni")
    _tx(s, start + timedelta(hours=13), 640, "adjustment", None)
    _user(s, "Должник", balance=-25)
    calls = []
    real = day_summary.compute_day_summary

    def spy(session, day, *a, **kw):
        calls.append(day)
        return real(session, day, *a, **kw)

    res, text = _run_daily_summary(s, spy)
    assert calls == [yday], f"сводка не позвала compute_day_summary за вчера: {calls}"
    assert "📊 <b>Сводка за" in text and "<b>Касса</b>" in text and "<b>Остатки на утро</b>" in text, \
        "сломан прежний текст сводки"
    assert "<b>Пришло по филиалам</b> (без корректировок)" in text, text
    assert "• Unbox One: нал <b>100</b> · TBC <b>50</b> · BOG <b>0</b> ₾" in text, text
    assert "• Unbox Uni: нал <b>0</b> · TBC <b>0</b> · BOG <b>15</b> ₾" in text, text
    assert "• Должны на конец дня: <b>25</b> ₾ · 1 клиент" in text, text
    assert text.index("Пришло по филиалам") < text.index("Остатки на утро")
    assert res["income"] == 805, "прежние цифры сводки изменились"


def test_telegram_summary_survives_day_block_failure():
    s = _session()

    def boom(*a, **kw):
        raise RuntimeError("сбой")

    import logging
    log = logging.getLogger("app.api.v1.telegram")
    was = log.disabled
    log.disabled = True  # ожидаемый сбой — без трассировки в выводе сторожа
    try:
        res, text = _run_daily_summary(s, boom)
    finally:
        log.disabled = was
    assert "<b>Остатки на утро</b>" in text and "Пришло по филиалам" not in text, text
    src = _py_code("backend/app/api/v1/telegram.py")
    body = src[src.index("def daily_summary_endpoint("):src.index("def resolve_telegram_username(")]
    assert "compute_day_summary(session, (yesterday_start + TBS).date())" in body, \
        "сводка в Telegram считает итоги дня не общей функцией"


# ─── 8. Фронт: блок на компьютере и телефоне, метка скидки ───────────────

def test_day_summary_block_desktop_and_mobile():
    ds = _code("src/components/admin/cashbox/DaySummary.tsx")
    for text in ("Пришло за день", "Ушло", "Списано с балансов клиентов", "Должны на конец дня", "Смена"):
        assert text in ds, f"в «Итогах дня» нет «{text}»"
    assert "'Сверка с таблицей: сравните наличные, TBC и BOG по филиалу'" in ds, "нет подсказки про сверку"
    assert "{DAY_SUMMARY_HINT}" in ds
    assert "cashboxReportsApi.getDaySummary(" in ds and "batumiDayKey()" in ds, "день не по Тбилиси / не с сервера"
    assert "formatGel(" in ds and "toFixed(" not in ds and ".reduce(" not in ds, \
        "в «Итогах дня» свои денежные подсчёты или формат мимо utils/format"
    api = _code("src/api/cashbox.ts")
    assert "api.get('/cashbox/day-summary'" in api and "api.get('/cashbox/weekly-rebates'" in api
    fin = _code("src/pages/admin/Finance.tsx")
    assert "{ value: 'day', label: 'Итоги дня' }" in fin and "{ value: 'rebates', label: 'Недельные скидки' }" in fin
    assert "<DaySummary branch={p.selectedBranch || undefined}" in fin, "на компьютере нет «Итогов дня»"
    assert "<WeeklyRebates" in fin, "на компьютере нет «Недельных скидок»"
    mob = _code("src/pages/mobile/admin/MobileAdminFinance.tsx")
    assert "<DaySummary branch={branchParam} compact" in mob, "на телефоне нет «Итогов дня»"
    assert "<WeeklyRebates compact" in mob and "{ value: 'day', label: 'Итоги дня' }" in mob
    wr = _code("src/components/admin/cashbox/WeeklyRebates.tsx")
    assert "cashboxReportsApi.getWeeklyRebates(" in wr and "Итого" in wr and "formatGel(" in wr


def test_rebate_note_in_today_and_popup():
    note = _code("src/utils/weeklyRebateNote.ts")
    assert "`скидка за неделю ${formatGel(amount, { sign: true })} уже учтена в «к оплате»`" in note
    for rel in ("src/pages/admin/Dashboard.tsx", "src/pages/mobile/admin/MobileAdminDashboard.tsx"):
        src = _code(rel)
        assert "useRecentWeeklyRebates(hasPermission(currentUser, 'finance.view_reports'))" in src, \
            f"{rel}: «Сегодня» не берёт скидки с последнего понедельника"
        assert "weeklyRebateNote(" in src and "data-weekly-rebate-note" in src, f"{rel}: нет метки недельной скидки"
        assert "rebateRowsOnce(" in src, f"{rel}: метка не один раз на клиента"
    hook = _code("src/hooks/useRecentWeeklyRebates.ts")
    assert "cashboxReportsApi.getRecentWeeklyRebates()" in hook and "rebateIndex(" in hook
    hints = _code("src/components/admin/BookingMoneyHints.tsx")
    assert "weeklyRebateNote(est.lastRebate.amount)" in hints, "в попапе брони другая формулировка скидки"
    assert "в т.ч. недельная скидка" not in hints and "formatDayMonth(est.lastRebate.date)" not in hints, \
        "в попапе снова «от —» (дата «28.09» не разбирается formatDayMonth)"


def _node():
    node = shutil.which("node")
    if not node:
        return None
    ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    try:
        major, minor = (int(x) for x in ver.split(".")[:2])
    except ValueError:
        return None
    return node if (major, minor) >= (22, 6) else None


def test_rebate_note_text_and_index_node():
    node = _node()
    if not node:
        return  # нет node ≥ 22.6 — статическая проверка выше всё равно идёт
    fmt = (ROOT / "src/utils/format.ts").as_uri()
    src = _read("src/utils/weeklyRebateNote.ts").replace("from './format'", f"from '{fmt}'")
    with tempfile.TemporaryDirectory() as tmp:
        mod = pathlib.Path(tmp) / "weeklyRebateNote.ts"
        mod.write_text(src, encoding="utf-8")
        body = f"""
const m = await import('{mod.as_uri()}');
const idx = m.rebateIndex([{{ userId: 'u1', email: 'a@x', amount: 9 }}, {{ userId: 'u2', email: null, amount: 3.5 }}, {{ userId: 'u3', amount: 0 }}]);
const rows = [
  {{ bookingId: 'b1', clientKey: 'u1', userId: 'a@x' }},
  {{ bookingId: 'b2', clientKey: 'u1', userId: 'a@x' }},
  {{ bookingId: 'b3', clientKey: 'u2', userId: 'u2' }},
  {{ bookingId: 'b4', clientKey: 'u9', userId: 'z@x' }},
];
console.log(JSON.stringify({{
  note: m.weeklyRebateNote(9), half: m.weeklyRebateNote(12.5),
  byEmail: m.rebateFor(idx, null, 'a@x'), none: m.rebateFor(idx, 'u3'),
  once: [...m.rebateRowsOnce(rows, idx).entries()],
}}));
"""
        r = subprocess.run([node, "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", body],
                           capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    assert r.returncode == 0, f"node упал: {r.stderr[:600]}"
    res = json.loads(r.stdout.strip().splitlines()[-1])
    nb = lambda t: t.replace(" ", " ")  # noqa: E731  (formatGel ставит неразрывный пробел)
    assert nb(res["note"]) == "скидка за неделю +9 ₾ уже учтена в «к оплате»", res["note"]
    assert nb(res["half"]) == "скидка за неделю +12,5 ₾ уже учтена в «к оплате»", res["half"]
    assert res["byEmail"] == 9 and res["none"] == 0, res
    assert res["once"] == [["b1", 9], ["b3", 3.5]], f"метка не один раз на клиента: {res['once']}"


if __name__ == "__main__":
    fails = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for n, f in tests:
        try:
            f()
            print(f"  ✓ {n}")
        except AssertionError as exc:
            fails += 1
            print(f"  ✗ {n}: {exc}")
        except Exception as exc:  # noqa: BLE001
            fails += 1
            print(f"  ✗ {n}: {exc!r}")
    print(f"проверок: {len(tests)}")
    print("СТОРОЖ ИТОГОВ ДНЯ: OK" if not fails else f"СТОРОЖ ИТОГОВ ДНЯ УПАЛ ({fails})")
    sys.exit(1 if fails else 0)
