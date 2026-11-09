"""СТОРОЖ: частичный денежный возврат — вверх до 50 тетри (владелец 09.11).

Повод: Алле Коноплицкой при пересдаче брони за 17,5 ₾ вернули 50 % = 8,75 ₾,
и на балансе завёлся хвост 0,25 ₾. По правилам суммы — целые или с половиной.

Что держит (bookings/routes._partial_refund_gel и _refund_booking_to_owner):
  1  50 % от 17,5 → 9; от 20 → 10; от 35 → 17,5; от 15 → 7,5.
  2  Доля пересдачи по куску (0,25 от 30 = 7,5; 0,3333 от 15 → 5; доля 0,1667
     от 30 — ровно 5, а не 5,5: сначала до копеек, потом вверх до 50 тетри).
  3  Полный возврат — ровно списанное, без округления; 0 % — ноль.
  4  Не больше списанного (0,99 от 0,3 → 0,3, а не 0,5).
  5  Оба денежных возврата в _refund_booking_to_owner (баланс и пиковая надбавка
     абонемента) идут через это округление.
  6  Снятие штрафа возвращает часы абонемента долей ПРАВИЛА (не долей денег).
  7  Тексты сайта о возврате считают ту же сумму (refundText.refundMoney).
  8  Живой сценарий: 22,5 ₾, отмена 50 % → +11,5, снятие штрафа → +11, итого 22,5.

    python3 backend/tests/guard_refund_rounding_2026_11.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")


def _scenario_cancel_then_waive():
    sys.path.insert(0, os.path.dirname(__file__))
    import guard_money_holes_2026_10 as mh
    @mh._scenario
    def run():
        s = mh._db()
        admin = mh._admin(s)
        v = mh._client(s, None)
        v.pricing_system, v.personal_discount_percent = "personal", 25
        s.add(v)
        s.commit()
        c = mh._book(s, admin, v, start="14:00", minutes=90, method="balance")
        assert (c.charge_amount, mh._bal(s, v)) == (22.5, 77.5), (c.charge_amount, mh._bal(s, v))
        mh._cancel(s, admin, c, refund_percent=0.5)
        assert mh._bal(s, v) == 89.0, f"после отмены 50 % (11,25 → 11,5) ждали 89, а {mh._bal(s, v)}"
        w = mh._waive(s, admin, c)
        assert w["money"] == 11.0 and mh._bal(s, v) == 100.0, (w, mh._bal(s, v))
        mh._ledger_ok(s, v, 100.0)

    run()


def test_rules():
    from app.api.v1.bookings import routes
    f = routes._partial_refund_gel
    fails = []

    def eq(got, want, msg):
        if abs(got - want) > 1e-9:
            fails.append(f"{msg}: ждали {want}, получили {got}")

    eq(f(17.5, 0.5), 9.0, "1: 50 % от 17,5")
    eq(f(20, 0.5), 10.0, "1: 50 % от 20")
    eq(f(35, 0.5), 17.5, "1: 50 % от 35")
    eq(f(15, 0.5), 7.5, "1: 50 % от 15")
    eq(f(30, 0.25), 7.5, "2: 25 % от 30")
    eq(f(15, 0.3333), 5.0, "2: треть от 15")
    eq(f(17.25, 1.0), 17.25, "3: полный возврат — как списано")
    eq(f(17.5, 0.0), 0.0, "3: 0 %")
    eq(f(0.3, 0.99), 0.3, "4: не больше списанного")
    eq(f(30, round(0.5 * 30 / 90, 4)), 5.0, "2: кусок 30 мин из 90 (доля 0,1667) — точные 5, не 5,5")
    eq(f(60, round(0.5 * 30 / 90, 4)), 10.0, "2: кусок 30 мин из 90 от 60 — 10, не 10,5")

    src = open(routes.__file__, encoding="utf-8").read()
    body = src[src.index("def _refund_booking_to_owner"):src.index("def _future_booking_load")]
    if "refund_amount = _partial_refund_gel(full_amount, refund_percent)" not in body:
        fails.append("5: возврат с баланса не через _partial_refund_gel")
    if "_peak = _partial_refund_gel(" not in body:
        fails.append("5: возврат пиковой надбавки не через _partial_refund_gel")
    if re.search(r"refund_amount = round\(full_amount \* refund_percent", body):
        fails.append("5: вернулось старое округление до копеек")

    # 6 — снятие штрафа: часы абонемента по доле правила, не по доле денег
    from app.services import billing_defer as bd
    bsrc = open(bd.__file__, encoding="utf-8").read()
    w = bsrc[bsrc.index("share_returned = _cancel_refund_share(session, b, money_base, refunded)"):]
    w = w[:w.index("hours_back = round(")]
    if "_policy_refund_share(session, b)" not in w:
        fails.append("6: снятие штрафа считает часы по доле денег — после округления недодаст часы")

    # 7 — тексты сайта совпадают с деньгами (зеркало округления на фронте)
    root = os.path.join(os.path.dirname(__file__), "..", "..")
    rt = open(os.path.join(root, "src/pages/mobile/refundText.ts"), encoding="utf-8").read()
    if "export function refundMoney" not in rt or "Math.ceil(raw * 2" not in rt:
        fails.append("7: на фронте нет зеркала округления refundMoney")
    if re.search(r"parts\.money = round2\(", rt):
        fails.append("7: refundParts снова считает деньги без округления до 50 тетри")
    mb = open(os.path.join(root, "src/pages/MyBookingsPage.tsx"), encoding="utf-8").read()
    if "refundMoney(booking.finalPrice" not in mb:
        fails.append("7: MyBookingsPage — запасной расчёт возврата без округления")

    # 8 — живой сценарий: бронь 22,5 ₾, отмена 50 % → +11,5; снятие штрафа → +11;
    #     итого вернули ровно 22,5, лента сходится с балансом.
    try:
        _scenario_cancel_then_waive()
    except AssertionError as e:
        fails.append(f"8: отмена 50 % + снятие штрафа: {e}")

    assert not fails, "; ".join(fails)
    print("СТОРОЖ refund_rounding: OK (8 правил)")


if __name__ == "__main__":
    try:
        test_rules()
    except AssertionError as e:
        print("СТОРОЖ refund_rounding: ПРОВАЛ —", e)
        sys.exit(1)
