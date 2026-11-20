"""СТОРОЖ: подарочный час — это ПЕРВЫЙ час брони, остаток по обычной цене (владелец 17.11).

Повод: Мила, 1,5 ч с 09:30 (09:30–10:00 — пик +5 ₾/ч) = 32,5 ₾, подарок 1 ч.
Бонус снимал долю цены: 32,5 × ⅓ = 10,83 ₾. Решение: «подарочный час и потом
по обычной цене» — 10:30–11:00 = 10 ₾.

20.11 (владелец, чат админов): подарок закрывает АРЕНДУ, надбавку за пиковые
часы (+5 ₾/ч) клиент платит, как по абонементу. Мила: 2,5 ₾ за 09:30–10:00 +
10 ₾ за 10:30–11:00 = 12,5 ₾ — админ ставил это руками 19.11.

Что держит:
  1  Создание брони: 1,5 ч с 09:30, подарок 1 ч → 12,5 ₾ (10 остаток + 2,5 пик подарка).
  2  Подарок покрывает всю бронь: вне пика 0 ₾; в пик — только надбавка (09:00–10:00 → 5 ₾,
     20:00–21:00 → 5 ₾).
  3  Остаток в пике — по цене пика: 2 ч с 19:00, подарок 1 ч → 20:00–21:00 = 25 ₾.
  4  Продление подарочной брони 1 ч → 2 ч: доплата = обычная цена второго часа.
  5  Правки (перенос, формат, продление) идут через ту же функцию с контекстом брони.
  6  Сайт считает так же: bonusSlotMoney берёт tail() — цену остатка; оформление на
     компьютере и телефоне, «Итого» мастера и быстрая бронь на телефоне передают tail.
  7  «Разделить» (владелец 17.11, второе решение): бонус-часы заполняют части по
     порядку с первой; целиком подарочная часть — 0 ₾ (в пик — надбавка), остальные по обычной цене;
     сумма частей = цена брони, отмена всех частей возвращает и час, и деньги.
  8  Допы частично подарочной брони при правках — целиком (booking_extras_money).
  9  Сайт показывает и списывает надбавку подарка в пик (giftPeakMoney, bonusPays);
     тексты про «1 бесплатный час» говорят про +5 ₾/ч в пик.

    python3 backend/tests/guard_bonus_first_hour_2026_11.py
"""
import os
import pathlib
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
os.environ.setdefault("ENVIRONMENT", "development")
ROOT = pathlib.Path(HERE).resolve().parents[1]


def _mh():
    import guard_money_holes_2026_10 as mh
    return mh


def test_create_partial_bonus_first_hour():
    mh = _mh()

    @mh._scenario
    def run():
        s = mh._db()
        admin = mh._admin(s)
        u = mh._client(s, None)
        mh._bonus(s, u, 1.0)
        b = mh._book(s, admin, u, start="09:30", minutes=90, method="bonus")
        assert b.payment_method == "bonus" and float(b.hours_deducted or 0) == 1.0, (b.payment_method, b.hours_deducted)
        assert float(b.base_price or 0) == 32.5, f"база 1,5 ч с 09:30 — 32,5 (пик): {b.base_price}"
        assert float(b.final_price) == 12.5, f"1: 2,5 пик подарка + остаток 10:30–11:00 10 ₾ = 12,5, а {b.final_price}"

        v = mh._client(s, None)
        mh._bonus(s, v, 1.0)
        full = mh._book(s, admin, v, days=1, start="09:00", minutes=60, method="bonus")
        assert float(full.final_price) == 5.0, f"2: подарок на весь час в пик — только надбавка 5 ₾, а {full.final_price}"

        v2 = mh._client(s, None)
        mh._bonus(s, v2, 1.0)
        calm = mh._book(s, admin, v2, days=4, start="11:00", minutes=60, method="bonus")
        assert float(calm.final_price) == 0.0, f"2: подарок на весь час вне пика — 0 ₾, а {calm.final_price}"

        v3 = mh._client(s, None)
        mh._bonus(s, v3, 1.0)
        eve = mh._book(s, admin, v3, days=5, start="20:00", minutes=60, method="bonus")
        assert float(eve.final_price) == 5.0, f"2: подарок 20:00–21:00 — надбавка 5 ₾, а {eve.final_price}"

        w = mh._client(s, None)
        mh._bonus(s, w, 1.0)
        ev = mh._book(s, admin, w, days=2, start="19:00", minutes=120, method="bonus")
        assert float(ev.final_price) == 25.0, f"3: остаток 20:00–21:00 в пик = 25 ₾, а {ev.final_price}"

    run()


def test_extend_gift_booking_charges_normal_hour():
    mh = _mh()
    from app.api.v1.bookings import routes as R
    src = (ROOT / "backend/app/api/v1/bookings/routes.py").read_text(encoding="utf-8")
    body = src[src.index("def extend_booking("):]
    body = body[:body.index("\n@router")]
    assert "_bonus_uncovered_price(booking, float(new_quote.final_price or 0), new_duration, **_ctx)" in body, \
        "4: продление подарочной брони без контекста — снова доля цены"
    for needle in ("resource_id=new_resource, start_dt=new_start_dt",
                   "resource_id=booking.resource_id, start_dt=start_dt, format_type=new_format"):
        assert needle in src, f"5: правка брони считает подарок без контекста ({needle})"
    assert "def _bonus_tail_price(" in src and "start_time=start_dt + timedelta(minutes=head_min)" in src
    assert R._bonus_tail_price is not None


def test_front_mirrors_tail():
    pp = (ROOT / "src/utils/paymentPriority.ts").read_text(encoding="utf-8")
    assert "export function bonusSlotMoney(" in pp and "it.tail(c)" in pp, "6: сайт снова считает долю цены"
    assert "bonusBySlots(opts.items!, bonusHours).money" in pp
    for rel, start in (("src/components/Wizard/ConfirmationStep.tsx", "i.startDateTime.getTime()"),
                       ("src/pages/mobile/MobileCheckout.tsx", "i.start.getTime()")):
        c = (ROOT / rel).read_text(encoding="utf-8")
        assert re.search(r"tail: \(c: number\) => calculatePrice\(\{", c) and start in c, f"6: {rel} без tail"


def test_more_screens_split_extras():
    for rel, needle in (("src/components/Summary.tsx", "tail: b.tail"),
                        ("src/pages/mobile/MobileFind.tsx", "tail: (c: number) => calculatePrice({")):
        c = (ROOT / rel).read_text(encoding="utf-8")
        assert needle in c, f"6: {rel} снова считает долю цены"
    from types import SimpleNamespace
    from datetime import datetime as _dt
    from app.services.pricing import booking_extras_money
    b = SimpleNamespace(extras=["coffee"], final_price=23.0, payment_method="bonus", base_price=40.0,
                        discount_amount=4.0, duration=120, hours_deducted=1.0, start_time="13:00",
                        date=_dt(2026, 11, 20))
    from app.services.pricing import PricingService
    listed = PricingService.calculate_extras_price(["coffee"])
    assert booking_extras_money(b) == round(min(listed, 23.0), 2), f"8: допы ужаты долей: {booking_extras_money(b)}"


def test_front_gift_peak_surcharge():
    """9  Сайт (владелец 20.11): подарок в пик — надбавка деньгами, и при полном покрытии."""
    pp = (ROOT / "src/utils/paymentPriority.ts").read_text(encoding="utf-8")
    assert "export function giftPeakMoney(" in pp and "subscription_surcharge_gel" in pp, "9: нет надбавки подарка"
    body = pp[pp.index("export function bonusSlotMoney("):]
    body = body[:body.index("\n}\n")]
    assert "Math.min(giftPeak, price)" in body and "it.tail(c)) + giftPeak" in body, \
        "9: bonusSlotMoney снова дарит надбавку за пик"
    assert "const bonusPays = bonusPartial || (bonusCovers && bonusMoney > 0);" in pp
    assert "return plan.bonusPays ? plan.bonusMoney : 0;" in pp, "9: проверка баланса не видит надбавку подарка"
    for rel, needle in (("src/components/Wizard/ConfirmationStep.tsx", "start: i.startDateTime"),
                        ("src/pages/mobile/MobileCheckout.tsx", "start: i.start,"),
                        ("src/components/Summary.tsx", "start: b.start"),
                        ("src/pages/mobile/MobileFind.tsx", "price: price.finalPrice, start,")):
        c = (ROOT / rel).read_text(encoding="utf-8")
        assert needle in c, f"9: {rel} не передаёт начало слота — надбавка подарка не посчитается"
    for rel in ("src/pages/SubscriptionsPage.tsx", "src/pages/BonusesInfoPage.tsx",
                "src/pages/mobile/MobileBonuses.tsx", "src/pages/admin/KnowledgeBase.tsx"):
        c = (ROOT / rel).read_text(encoding="utf-8")
        assert "+5 ₾/ч" in c and "как по абонементу" in c, f"9: {rel}: текст не говорит про надбавку в пик"


def test_admin_gift_button_and_free_rent():
    """10 «Час в подарок» (кнопка админа) — то же правило: надбавку за пик клиент платит.
       11 Бесплатная аренда (comp / «личные 100 %») с допами — надбавки нет (ревью денег 20.11)."""
    mh = _mh()
    from app.api.v1.bookings import routes as R

    @mh._scenario
    def run():
        s = mh._db()
        admin = mh._admin(s)
        u = mh._client(s, None)
        b = mh._book(s, admin, u, days=6, start="09:00", minutes=60, method="balance")
        assert float(b.final_price) == 25.0, b.final_price
        mh._bonus(s, u, 1.0)
        R.apply_bonus_hour(booking_id=str(b.id), session=s, current_user=admin)
        s.commit()
        b = s.get(mh.Booking, b.id)
        assert float(b.final_price) == 5.0, f"10: «Час в подарок» 09:00–10:00 — остаётся надбавка 5 ₾, а {b.final_price}"

        v = mh._client(s, None)
        c = mh._book(s, admin, v, days=7, start="12:00", minutes=60, method="balance")
        mh._bonus(s, v, 1.0)
        R.apply_bonus_hour(booking_id=str(c.id), session=s, current_user=admin)
        s.commit()
        c = s.get(mh.Booking, c.id)
        assert float(c.final_price) == 0.0, f"10: «Час в подарок» днём — 0 ₾, а {c.final_price}"

    run()

    from app.services.pricing import PricingService
    from datetime import datetime as _dt
    coffee = float(PricingService.calculate_extras_price(["coffee"]))
    full = R._bonus_tail_price(PricingService(None), None, full_price=coffee, resource_id="room_1",
                               start_dt=_dt(2026, 11, 25, 9, 0), duration_minutes=60, format_type="individual",
                               covered_hours=1.0, extras_price=coffee)
    assert full == 0.0, f"11: бесплатная аренда + кофе в пик — надбавка взялась: {full}"


def test_split_gift_goes_to_first_parts():
    mh = _mh()

    @mh._scenario
    def run():
        s = mh._db()
        admin = mh._admin(s)
        u = mh._client(s, None, balance=100.0)
        mh._bonus(s, u, 1.0)
        b = mh._book(s, admin, u, start="09:30", minutes=90, method="bonus")
        assert float(b.final_price) == 12.5, b.final_price
        a, c = mh._split(s, admin, b, [60, 30])
        got = [(float(x.hours_deducted or 0), float(x.final_price)) for x in (a, c)]
        assert got == [(1.0, 2.5), (0.0, 10.0)], f"7: подарок — первая часть (2,5 пик), вторая 10 ₾: {got}"

        v = mh._client(s, None, balance=500.0)
        mh._bonus(s, v, 1.0)
        b2 = mh._book(s, admin, v, days=3, start="12:00", minutes=180, method="bonus")
        total = float(b2.final_price)
        parts = mh._split(s, admin, b2, [60, 60, 60])
        assert [float(x.hours_deducted or 0) for x in parts] == [1.0, 0.0, 0.0]
        assert float(parts[0].final_price) == 0.0 and round(sum(float(x.final_price) for x in parts), 2) == total, \
            [x.final_price for x in parts]
        for x in parts:
            mh._cancel(s, admin, x)
        assert (mh._free_hours(s, v), mh._bal(s, v)) == (1.0, 500.0), (mh._free_hours(s, v), mh._bal(s, v))

    run()


if __name__ == "__main__":
    for name, fn in sorted(dict(globals()).items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("  ✓", name)
    print("СТОРОЖ bonus_first_hour: OK")
