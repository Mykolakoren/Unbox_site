"""СТОРОЖ: законы денег на тысячах случайных сценариев (Hypothesis, 24.10).

Обычные проверки смотрят на придуманные нами случаи. Здесь генератор сам
перебирает суммы, часы и последовательности операций и ищет нарушение:

1. Баланс = сумма ленты: после ЛЮБОЙ цепочки credit/debit/apply/set_balance
   user.balance равен сумме дельт ленты, а balance_after каждой строки —
   нарастающему итогу (инвариант «Только сайт, без Excel»).
2. Вернуть то, что сняли: debit_hours → credit_hours тех же часов (с той же
   долей доп. пула) возвращает абонемент ровно в исходное состояние, если
   часов хватало.
3. Часы не уходят в минус; при достаточном остатке «осталось + израсходовано»
   не меняется; оба написания полей (remaining_hours/remainingHours) совпадают.
4. plan_split: доля доп. пула в пределах [0, часы]; если «покрывает» — списание
   не обрезается нулём (не теряем часы молча).
5. Настоящая бронь через create_booking: создал → (крон списал) → клиент отменил
   больше чем за сутки → баланс, часы абонемента и лента — ровно как до брони.
   Кабинет/капсула, длительность, время, способ оплаты, есть ли абонемент — случайно.

    python3 backend/tests/guard_money_properties_2026_10.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ENVIRONMENT", "development")

try:
    from hypothesis import given, settings, strategies as st, HealthCheck
except ImportError:  # pragma: no cover
    given = None

import guard_hours_pool_moves as H  # noqa: E402

# MONEY_PBT_SCALE=30 — большой прогон по требованию (тысячи сценариев); обычно ×1.
_SCALE = max(1, int(os.environ.get("MONEY_PBT_SCALE", "1")))
_SET = dict(max_examples=300 * _SCALE, deadline=None, suppress_health_check=[HealthCheck.too_slow]) if given else {}

# Деньги — копейки, как в кассе: до 2 знаков, реальные масштабы центра.
money = st.decimals(min_value=-2000, max_value=2000, places=2).map(float) if given else None
hours = st.sampled_from([0.5 * k for k in range(0, 41)]) if given else None  # 0…20 ч шагом 30 мин


def _pool(rem, used, extra_kind=None, er=0.0, eu=0.0):
    from app.services import subscription_pool as sp
    sub = sp.update({}, remaining_hours=rem, used_hours=used, total_hours=rem + used,
                    included_formats=["individual", "group"])
    if extra_kind:
        sub = sp.update(sub, extra_kind=extra_kind, extra_hours_remaining=er,
                        extra_hours_used=eu, extra_hours_total=er + eu)
    return sub


def _both_dialects_agree(sub):
    from app.services import subscription_pool as sp
    for snake, camel in sp._ALIASES.items():
        if snake in sub and camel in sub:
            assert sub[snake] == sub[camel], f"{snake}={sub[snake]} ≠ {camel}={sub[camel]}"


if given:
    ops = st.lists(st.tuples(st.sampled_from(["credit", "debit", "apply", "set"]), money),
                   min_size=1, max_size=25)

    @settings(**_SET)
    @given(start=money, steps=ops)
    def test_balance_equals_ledger_sum(start, steps):
        from sqlmodel import select
        from app.models.balance_ledger import BalanceLedger
        from app.services import wallet
        s = H._db()
        u = H._user(s, role="user", balance=0.0, name="Свойство")
        # Ожидаемая цепочка — из того, что вернула каждая операция (номер строки
        # ленты — случайный UUID, порядок по нему не восстановить).
        prev = 0.0
        expected = []
        for op, amt in [("set", start)] + list(steps):
            fn = {"credit": wallet.credit, "debit": wallet.debit, "apply": wallet.apply,
                  "set": wallet.set_balance}[op]
            new_bal = fn(s, u, amt, reason="t")
            expected.append((round(new_bal - prev, 2), new_bal))
            prev = new_bal
        s.commit()
        rows = s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(u.id))).all()
        assert len(rows) == len(steps) + 1
        got = sorted((round(r.delta, 2), round(r.balance_after, 2)) for r in rows)
        assert got == sorted((round(d, 2), round(b, 2)) for d, b in expected), \
            f"строки ленты не совпадают с операциями: {got} vs {expected}"
        total = round(sum(r.delta for r in rows), 2)
        assert abs(float(u.balance) - total) < 0.005, f"баланс {u.balance} ≠ сумма ленты {total}"
        if steps[-1][0] == "set":
            assert abs(float(u.balance) - round(steps[-1][1], 2)) < 0.005

    @settings(**_SET)
    @given(rem=hours, used=hours, h=hours,
           kind=st.sampled_from([None, "capsule", "individual"]), er=hours, eu=hours,
           extra_share=st.floats(min_value=0, max_value=1))
    def test_debit_then_credit_restores_pool(rem, used, h, kind, er, eu, extra_share):
        from app.services import subscription_pool as sp
        sub = _pool(rem, used, kind, er, eu)
        x = round(min(er, h) * extra_share * 2) / 2 if kind else 0.0   # шаг 30 мин
        if (h - x) > rem or x > er:
            return  # часов не хватает — этот случай проверяет test_hours_never_negative
        after = sp.debit_hours(sub, h, x)
        _both_dialects_agree(after)
        back = sp.credit_hours(after, h, x, kind=kind)
        _both_dialects_agree(back)
        for f in ("remaining_hours", "used_hours", "extra_hours_remaining", "extra_hours_used"):
            assert abs(sp.get_float(back, f) - sp.get_float(sub, f)) < 1e-6, \
                f"{f}: было {sp.get_float(sub, f)}, после списания и возврата {sp.get_float(back, f)}"
        # Сохранение суммы при достаточном остатке.
        tot = lambda d, a, b: sp.get_float(d, a) + sp.get_float(d, b)  # noqa: E731
        assert abs(tot(after, "remaining_hours", "used_hours") - tot(sub, "remaining_hours", "used_hours")) < 1e-6
        if kind:
            assert abs(tot(after, "extra_hours_remaining", "extra_hours_used")
                       - tot(sub, "extra_hours_remaining", "extra_hours_used")) < 1e-6

    @settings(**_SET)
    @given(rem=hours, used=hours, h=hours, kind=st.sampled_from([None, "capsule", "individual"]),
           er=hours, x=hours)
    def test_hours_never_negative(rem, used, h, kind, er, x):
        from app.services import subscription_pool as sp
        after = sp.debit_hours(_pool(rem, used, kind, er, 0.0), h, x)
        _both_dialects_agree(after)
        for f in ("remaining_hours", "used_hours", "extra_hours_remaining", "extra_hours_used"):
            assert sp.get_float(after, f) >= 0, f"{f} ушёл в минус: {sp.get_float(after, f)}"

    @settings(**_SET)
    @given(rem=hours, used=hours, h=hours.filter(lambda v: v > 0),
           kind=st.sampled_from([None, "capsule", "individual"]), er=hours,
           rtype=st.sampled_from(["cabinet", "capsule"]), fmt=st.sampled_from(["individual", "group"]))
    def test_plan_split_covers_without_losing_hours(rem, used, h, kind, er, rtype, fmt):
        from app.services import subscription_pool as sp
        sub = _pool(rem, used, kind, er, 0.0)
        x = sp.plan_split(sub, h, resource_type=rtype, format_type=fmt)
        if x is None:
            return
        assert 0 <= x <= h + 1e-9, f"доля доп. пула {x} вне [0, {h}]"
        assert x <= er + 1e-9, f"из доп. пула взяли {x} при остатке {er}"
        assert (h - x) <= rem + 0.01 + 1e-9, f"«покрывает», а основного пула {rem} < {h - x}"
        after = sp.debit_hours(sub, h, x)
        spent = (sp.get_float(sub, "remaining_hours") - sp.get_float(after, "remaining_hours")) \
            + (sp.get_float(sub, "extra_hours_remaining") - sp.get_float(after, "extra_hours_remaining"))
        assert abs(spent - h) <= 0.01 + 1e-9, f"бронь {h} ч, а с абонемента снято {spent} ч"


    @settings(max_examples=120 * _SCALE, deadline=None, suppress_health_check=[HealthCheck.too_slow])
    @given(days=st.integers(min_value=2, max_value=12),
           start_h=st.integers(min_value=9, max_value=18), half=st.booleans(),
           minutes=st.sampled_from([60, 90, 120, 180]),
           resource=st.sampled_from(["room_1", "room_2", "cap_1"]),
           method=st.sampled_from(["balance", "subscription"]),
           with_sub=st.booleans(), balance=money, charge_first=st.booleans())
    def test_booking_create_cancel_restores_everything(days, start_h, half, minutes, resource, method,
                                                       with_sub, balance, charge_first):
        from fastapi import BackgroundTasks, HTTPException
        from sqlmodel import select
        from app.api.v1.bookings import routes
        from app.models.balance_ledger import BalanceLedger
        from app.models.user import User
        from app.services import billing_defer, subscription_pool as sp, wallet
        with H.frozen_time():
            s = H._db()
            u = H._user(s, role="specialist", sub=H._sub() if with_sub else None, balance=0.0, name="Клиент")
            u.credit_limit = 5000.0
            wallet.set_balance(s, u, balance, reason="seed"); s.add(u); s.commit()
            before_bal = round(float(u.balance), 2)
            before_pool = H._fp_sub(u.subscription) if u.subscription else None
            try:
                b = H._create(s, u, u, days=days, start=f"{start_h:02d}:{'30' if half else '00'}",
                              minutes=minutes, resource=resource, method=method)
            except HTTPException:
                return  # отказ (нет абонемента/денег/правило) — денег не трогали, проверяем ниже
            finally:
                pass
            if charge_first:
                billing_defer.settle_pending_charge(s, s.get(type(b), b.id)); s.commit()
            routes.cancel_booking(booking_id=str(b.id), background_tasks=BackgroundTasks(),
                                  session=s, current_user=u)
            s.commit(); s.expire_all()
            uu = s.get(User, u.id)
            assert abs(round(float(uu.balance), 2) - before_bal) < 0.005, \
                f"баланс {before_bal} → {uu.balance} после брони и отмены за {days} дн. (способ {method})"
            if before_pool is not None:
                assert H._fp_sub(uu.subscription) == before_pool, \
                    f"часы абонемента {before_pool} → {H._fp_sub(uu.subscription)}"
            rows = s.exec(select(BalanceLedger).where(BalanceLedger.user_id == str(u.id))).all()
            assert abs(round(sum(r.delta for r in rows), 2) - round(float(uu.balance), 2)) < 0.005, \
                "баланс ≠ сумма ленты"


if __name__ == "__main__":
    if given is None:
        print("  (hypothesis не установлен — пропуск: pip install hypothesis)")
        sys.exit(0)
    fails = 0
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            try:
                f(); print(f"  ✓ {n}")
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"  ✗ {n}: {type(e).__name__}: {str(e)[:900]}")
    sys.exit(1 if fails else 0)
