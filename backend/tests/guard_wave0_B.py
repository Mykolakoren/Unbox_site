"""СТОРОЖ wave0-B — порядок оплаты брони: бонус → абонемент → баланс.

Решение владельца 29.09: 1) бонусные часы идут первыми, если их хватает на
ВСЮ бронь; 2) иначе абонемент, если он покрывает; 3) иначе баланс. Клиент
может сам переключиться, и сервер обязан уважать явный выбор бонуса (раньше
он молча менял его на абонемент — G4-client-mobile-M3).

Что ловим:
  * сервер снова ставит абонемент впереди бонуса или молча переписывает
    явный бонус;
  * частичный бонус открывает старую утечку (абонементная цена 0 ₾ при
    ярлыке не-`subscription` — 1630 ₾ в июле);
  * десктопный мастер снова шлёт «Бонусные часы» как 'balance' и списывает
    деньги (G3-03);
  * проверка баланса снова блокирует бронь, за которую деньги не берутся
    (владелец абонемента с малым балансом, новичок с бонус-часом — G4-01);
  * правки уже созданной бонусной брони (перенос, смена формата, вырезать,
    сократить, разделить, «на абонемент») снова берут с клиента полную цену
    деньгами или стирают потраченный бонус-час (ревью wave0-B).

Без сети и без боевой базы (SQLite в памяти + чтение исходников):

    python3 backend/tests/guard_wave0_B.py
"""
import os
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("ENVIRONMENT", "development")

from app.services.pricing import PriceBreakdown, resolve_payment_method  # noqa: E402

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
_REPO = os.path.join(_BACKEND, "..")


def _read(rel: str, base: str = _REPO) -> str:
    return open(os.path.join(base, rel), encoding="utf-8").read()


def _quote(rule: str, final: float, hours: float = 1.0) -> PriceBreakdown:
    return PriceBreakdown(
        base_price=20.0 * hours, hourly_rate=20.0, booked_hours=hours,
        applied_rule=rule, final_price=final,
        hours_deducted=(hours if rule == "SUBSCRIPTION" else 0.0),
    )


def _body(src: str, start: str, end: str = "\n@router.") -> str:
    i = src.find(start)
    assert i != -1, f"не нашли {start!r}"
    j = src.find(end, i + len(start))
    return src[i:j if j != -1 else len(src)]


# ─────────────────────────────────────────────────────────────────────────
# Сервер: resolve_payment_method
# ─────────────────────────────────────────────────────────────────────────

def test_bonus_goes_first_when_it_covers_whole_booking():
    """«Реши сам» (balance — так шлют и сайт, и TG-бот): бонус, которого
    хватает на всю бронь, идёт раньше абонемента и раньше денег."""
    assert resolve_payment_method("balance", _quote("SUBSCRIPTION", 0), bonus_hours_available=1.0) == "bonus"
    assert resolve_payment_method("balance", _quote("NONE", 20), bonus_hours_available=2.0) == "bonus"
    assert resolve_payment_method(None, _quote("NONE", 20), bonus_hours_available=1.0) == "bonus"


def test_partial_bonus_never_preempts_subscription():
    """Бонус не на всю бронь → абонемент. Даже явный 'bonus' при абонементной
    котировке обязан стать 'subscription' — иначе остаток уйдёт по цене 0 ₾
    и часы не сгорят (утечка 1630 ₾)."""
    q = _quote("SUBSCRIPTION", 0, hours=2.0)
    assert resolve_payment_method("balance", q, bonus_hours_available=1.0) == "subscription"
    assert resolve_payment_method("bonus", q, bonus_hours_available=1.0) == "subscription"
    assert resolve_payment_method("bonus", q) == "subscription"
    # Без абонемента и без бонуса ярлык денежный.
    assert resolve_payment_method("balance", _quote("NONE", 40, hours=2.0), bonus_hours_available=1.0) == "balance"


def test_explicit_bonus_is_respected_over_subscription():
    """G4-client-mobile-M3: клиент явно выбрал бонус при действующем
    абонементе — тратим бонус, а не оплаченные часы абонемента."""
    assert resolve_payment_method("bonus", _quote("SUBSCRIPTION", 0), bonus_hours_available=1.0) == "bonus"


def test_explicit_subscription_and_service_labels_untouched():
    """Клиент переключился на абонемент — уважаем; служебные ярлыки
    (cash/service от админа) порядок оплаты не трогает."""
    assert resolve_payment_method("subscription", _quote("SUBSCRIPTION", 0), bonus_hours_available=5.0) == "subscription"
    for m in ("cash", "service"):
        assert resolve_payment_method(m, _quote("SUBSCRIPTION", 0), bonus_hours_available=5.0) == m
        assert resolve_payment_method(m, _quote("NONE", 20), bonus_hours_available=5.0) == m


def test_bonus_not_burned_on_free_booking():
    """Comp-аккаунт / персональные 100 %: бронь и так 0 ₾ — бонус-час не
    сжигаем, даже если экран прислал 'bonus'."""
    for rule in ("COMP_ACCOUNT", "PERSONAL_DISCOUNT"):
        q = _quote(rule, 0)
        assert resolve_payment_method("balance", q, bonus_hours_available=3.0) == "balance"
        assert resolve_payment_method("bonus", q, bonus_hours_available=3.0) == "balance"


# ─────────────────────────────────────────────────────────────────────────
# Сервер: _resolve_with_bonus (перекотировка + FIFO-списание бонуса)
# ─────────────────────────────────────────────────────────────────────────

class _FakePricing:
    """Движок цены без БД: считает 20 ₾/ч и запоминает, просили ли его
    игнорировать абонемент."""

    def __init__(self):
        self.calls = []

    def calculate_price(self, **kw):
        self.calls.append(kw)
        hrs = kw["duration_minutes"] / 60.0
        return PriceBreakdown(base_price=20.0 * hrs, hourly_rate=20.0, booked_hours=hrs,
                              applied_rule="NONE", final_price=20.0 * hrs)


def _bonus_db(hours_list):
    from sqlmodel import Session, create_engine
    from app.models.bonus import Bonus
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Bonus.__table__.create(engine)
    uid = str(uuid4())
    s = Session(engine)
    for i, h in enumerate(hours_list):
        s.add(Bonus(user_id=uid, type="free_hour", quantity=h, status="active",
                    expires_at=datetime.now() + timedelta(days=10 + i)))
    s.commit()
    return s, uid


def _resolve(session, uid, requested, quote, bonus_left, consume=True, extras=0.0):
    from app.api.v1.bookings.routes import _resolve_with_bonus
    pricing = _FakePricing()
    out = _resolve_with_bonus(
        session, pricing, SimpleNamespace(id=uid), requested, quote,
        resource_id="room_1", start_dt=datetime(2026, 10, 1, 12, 0),
        duration_minutes=int(quote.booked_hours * 60), format_type="individual",
        bonus_left=bonus_left, extras_price=extras, consume=consume,
    )
    return out, pricing


def test_bonus_booking_requoted_without_subscription_and_spent():
    """Бонусная бронь не должна остаться с абонементной котировкой: её
    перекотировывают с ignore_subscription, бонус тратится FIFO, цена 0."""
    from app.services.bonus_service import available_free_hours
    s, uid = _bonus_db([1.0])
    (method, quote, covered), pricing = _resolve(
        s, uid, "balance", _quote("SUBSCRIPTION", 0), available_free_hours(s, uid), extras=5.0)
    s.commit()
    assert method == "bonus", method
    assert pricing.calls and pricing.calls[0].get("ignore_subscription") is True, \
        "бонусную бронь не перекотировали без абонемента"
    assert quote.applied_rule != "SUBSCRIPTION" and float(quote.hours_deducted or 0) == 0
    assert covered == 1.0 and quote.final_price == 0.0, (covered, quote.final_price)
    assert available_free_hours(s, uid) == 0.0, "бонус-час не потрачен"


def test_partial_bonus_leaves_subscription_and_bonus_intact():
    """Бонуса 0.5 ч на часовую бронь при абонементе: берём абонемент, бонус
    не трогаем, котировку не меняем."""
    from app.services.bonus_service import available_free_hours
    s, uid = _bonus_db([0.5])
    q = _quote("SUBSCRIPTION", 0)
    (method, quote, covered), pricing = _resolve(s, uid, "balance", q, 0.5)
    s.commit()
    assert method == "subscription" and covered == 0.0
    assert not pricing.calls and quote.applied_rule == "SUBSCRIPTION"
    assert available_free_hours(s, uid) == 0.5


def test_explicit_partial_bonus_without_subscription_keeps_old_rule():
    """Старое правило 20.07 цело: явный бонус без абонемента — бонус-часы
    бесплатно, остаток по обычной цене."""
    s, uid = _bonus_db([1.0])
    (method, quote, covered), _ = _resolve(s, uid, "bonus", _quote("NONE", 30, hours=1.5), 1.0)
    s.commit()
    assert method == "bonus" and covered == 1.0
    assert abs(quote.final_price - 10.0) < 0.01, quote.final_price


def test_series_tryon_does_not_spend_bonus():
    """«Примерка» серии считает бонус, но ничего не списывает."""
    from app.services.bonus_service import available_free_hours
    s, uid = _bonus_db([1.0])
    (method, _q, covered), _ = _resolve(s, uid, "balance", _quote("NONE", 20), 1.0, consume=False)
    assert method == "bonus" and covered == 1.0
    assert available_free_hours(s, uid) == 1.0, "примерка потратила бонус"
    src = _read("app/api/v1/bookings/routes.py", _BACKEND)
    body = _body(src, "def quote_recurring_booking", "def create_recurring_booking")
    assert "consume=False" in body, "примерка серии списывает бонусы"


def test_every_create_path_uses_bonus_first_resolver():
    """Порядок оплаты одинаков везде, где рождается бронь: разовая, пачка,
    серия, продление серии (и примерка серии)."""
    src = _read("app/api/v1/bookings/routes.py", _BACKEND)
    for fn in ("def create_booking", "def create_multi_slot_booking", "def quote_recurring_booking",
               "def create_recurring_booking", "def extend_recurring_series"):
        assert "_resolve_with_bonus(" in _body(src, fn), f"{fn}: порядок оплаты не через _resolve_with_bonus"
    helper = _body(src, "def _resolve_with_bonus", "\n# ─── Create booking")
    assert "ignore_subscription=True" in helper, "бонусная бронь снова остаётся с абонементной котировкой"


# ─────────────────────────────────────────────────────────────────────────
# Фронт: десктоп шлёт 'bonus', экран = сервер, проверка баланса только за деньги
# ─────────────────────────────────────────────────────────────────────────

def test_desktop_wizard_sends_bonus():
    """G3-03: finalMethod в ConfirmationStep был типа 'subscription' | 'balance'
    — «Бонусные часы — бесплатно» уходили как 'balance' и списывали деньги."""
    src = _read("src/components/Wizard/ConfirmationStep.tsx")
    assert "'subscription' | 'balance' =" not in src, "finalMethod снова без 'bonus'"
    assert "const finalMethod: PayMethod = resolveFinalMethod(" in src
    assert "paymentMethod: finalMethod" in src
    pp = _read("src/utils/paymentPriority.ts")
    assert "export type PayMethod = 'balance' | 'subscription' | 'bonus'" in pp


def test_bonus_filter_moved_but_still_accepts_free_hour():
    """Фильтр бонус-часов переехал из ConfirmationStep в paymentPriority
    (общий для десктопа и телефона). Он обязан принимать 'free_hour' —
    иначе подарочный час снова станет невидимым (кейс Оксаны)."""
    pp = _read("src/utils/paymentPriority.ts")
    i = pp.find("export function activeBonusHours")
    assert i != -1, "activeBonusHours пропал"
    assert "'free_hour'" in pp[i:i + 800], "фильтр бонусов не принимает 'free_hour'"
    for rel in ("src/components/Wizard/ConfirmationStep.tsx", "src/pages/mobile/MobileCheckout.tsx"):
        assert "useActiveBonusHours(" in _read(rel), f"{rel}: бонус-часы считаются мимо общего фильтра"


def test_frontend_default_follows_server_priority():
    """Экран выбирает по умолчанию то же, что сервер: бонус → абонемент → баланс
    (раньше по умолчанию стоял «Баланс», а сервер брал часы — G4-01)."""
    pp = _read("src/utils/paymentPriority.ts")
    assert "bonusCovers ? 'bonus' : subCovers ? 'subscription' : 'balance'" in pp, \
        "порядок по умолчанию на фронте разошёлся с сервером"
    for rel in ("src/components/Wizard/ConfirmationStep.tsx", "src/pages/mobile/MobileCheckout.tsx"):
        assert "plan.auto" in _read(rel), f"{rel}: способ по умолчанию не следует порядку оплаты"


def test_balance_precheck_only_when_money_is_charged():
    """G4-01: проверка «Не хватает N ₾» — только когда реально платим
    деньгами. Бонус и абонемент сервер спишет часами."""
    mob = _read("src/pages/mobile/MobileCheckout.tsx")
    i = mob.find("Не хватает ${shortfall")
    assert i != -1, "мобильная проверка баланса пропала/переехала — обнови сторожа"
    k = mob.rfind("if (finalMethod", 0, i)
    assert k != -1 and i - k < 1500, "мобильная проверка баланса не завязана на способ оплаты"
    gate = mob[k:mob.find("\n", k)]
    assert "finalMethod === 'balance'" in gate, "мобильная проверка баланса бьёт и по бонусу/абонементу"
    desk = _read("src/components/Wizard/ConfirmationStep.tsx")
    j = desk.find("Недостаточно средств для бронирования")
    assert j != -1, "десктопная проверка баланса пропала/переехала — обнови сторожа"
    head = desk[:j]
    gate = head[head.rfind("if (effectiveUser"):]
    assert "chargesMoney" in gate.split("\n")[0], "десктопная проверка баланса не смотрит на способ оплаты"
    assert ": finalMethod === 'balance';" in head, "chargesMoney не завязан на оплату деньгами"


def test_summary_has_no_second_payment_switch():
    """G3-03: в правой колонке был второй переключатель «Абонемент | Депозит»
    без бонусов. Выбор — в одном месте (ConfirmationStep)."""
    src = _read("src/components/Summary.tsx")
    assert "setPaymentMethod(" not in src, "в Summary снова свой переключатель оплаты"
    assert ">Депозит<" not in src, "в Summary снова кнопка «Депозит»"


def test_cron_message_says_money_on_subscription_fallback():
    """M1: абонемент исчерпан → крон списал деньги (hours_deducted=0), а
    TG писал «N ч абонемента» — списание денег было замаскировано."""
    src = _read("app/api/v1/billing.py", _BACKEND)
    assert '_pm == "subscription" and (b.hours_deducted or 0) > 0' in src


# ─────────────────────────────────────────────────────────────────────────
# Правки уже созданной бонусной брони (ревью wave0-B). Бонус теперь идёт
# первым — бонусных броней стало много (каждый приветственный час). Бонус
# тратится при создании: payment_method='bonus', hours_deducted=бонус-часы,
# final_price=0. Перенос / смена формата пересчитывали цену «как денежной» —
# клиент платил весь слот деньгами, а бонус-час пропадал.
# ─────────────────────────────────────────────────────────────────────────

def _bonus_booking(**over):
    base = dict(
        id=uuid4(), status="confirmed", user_uuid="owner-1", user_id="c@x.ge",
        date=datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=5),
        start_time="12:00", duration=60, resource_id="room_1", location_id="unbox_uni",
        format="individual", extras=[], gcal_event_id=None,
        payment_method="bonus", payment_status="paid", final_price=0.0, charge_amount=0.0,
        hours_deducted=1.0, base_price=20.0, applied_rule="NONE",
        discount_amount=0.0, discount_percent=0, reminder_sent_at=None, updated_at=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


class _FakeSession:
    def __init__(self, booking, owner):
        self.booking, self.owner = booking, owner

    def get(self, model, key):
        from app.models.booking import Booking
        from app.models.user import User
        return {Booking: self.booking, User: self.owner}.get(model)

    def exec(self, *a, **kw):
        return SimpleNamespace(first=lambda: None, all=lambda: [])

    def add(self, *a):
        pass

    def commit(self):
        pass

    def refresh(self, *a):
        pass

    def rollback(self):
        pass


def _run_with_fakes(fn, booking, per_hour: float):
    """Вызвать эндпоинт брони без БД/сети: цена — per_hour ₾/ч, кошелёк пишет
    вызовы в список. Возвращает (результат | HTTPException, движения кошелька)."""
    import app.services.pricing as pricing_mod
    import app.services.telegram as tg_mod
    import app.services.timeline as tl_mod
    from app.api.v1.bookings import routes
    from fastapi import HTTPException

    moves = []

    class _Wallet:
        @staticmethod
        def debit(session, user, amount, reason, **kw):
            moves.append(("debit", round(float(amount), 2)))

        @staticmethod
        def credit(session, user, amount, reason, **kw):
            moves.append(("credit", round(float(amount), 2)))

        @staticmethod
        def apply(session, user, delta, reason, **kw):
            moves.append(("apply", round(float(delta), 2)))

    class _Pricing:
        def __init__(self, *a, **kw):
            pass

        def calculate_price(self, **kw):
            hrs = kw["duration_minutes"] / 60.0
            return PriceBreakdown(base_price=per_hour * hrs, hourly_rate=per_hour, booked_hours=hrs,
                                  applied_rule="NONE", final_price=per_hour * hrs)

        @staticmethod
        def calculate_extras_price(ids):
            return 0.0

    _silent = SimpleNamespace(log_event=lambda **kw: None,
                              send_booking_rescheduled=lambda **kw: None,
                              send_admin_event=lambda **kw: None,
                              _send_message=lambda **kw: None)
    owner = SimpleNamespace(id="owner-1", email="c@x.ge", name="Клиент", role="user",
                            balance=100.0, credit_limit=0.0, telegram_id=None, subscription=None)
    patches = [
        (routes, "wallet", _Wallet), (routes, "check_availability", lambda **kw: (True, None)),
        (routes, "_sync_linked_session_to_booking", lambda *a, **kw: None),
        (routes, "timeline_service", _silent), (routes, "telegram_service", _silent),
        (pricing_mod, "PricingService", _Pricing),
        (tg_mod, "telegram_service", _silent), (tl_mod, "timeline_service", _silent),
    ]
    saved = [(m, n, getattr(m, n)) for m, n, _ in patches]
    fake_wl = SimpleNamespace(notify_waitlist_for_freed_slot=lambda *a, **kw: None)
    saved_wl = sys.modules.get("app.services.waitlist_notify")
    try:
        for m, n, v in patches:
            setattr(m, n, v)
        sys.modules["app.services.waitlist_notify"] = fake_wl
        try:
            out = fn(routes, _FakeSession(booking, owner), owner)
        except HTTPException as exc:
            out = exc
    finally:
        for m, n, v in saved:
            setattr(m, n, v)
        if saved_wl is not None:
            sys.modules["app.services.waitlist_notify"] = saved_wl
        else:
            sys.modules.pop("app.services.waitlist_notify", None)
    return out, moves


def _reschedule(booking, per_hour, new_time="19:00", new_duration=None):
    from fastapi import BackgroundTasks

    def call(routes, session, owner):
        return routes.reschedule_booking(
            booking_id=str(booking.id),
            data=routes.RescheduleRequest(new_date=booking.date.strftime("%Y-%m-%d"),
                                          new_start_time=new_time, new_duration=new_duration),
            background_tasks=BackgroundTasks(), session=session, current_user=owner,
        )
    return _run_with_fakes(call, booking, per_hour)


def test_reschedule_control_money_booking_still_pays_difference():
    """Контроль (фейки рабочие): денежная бронь 20 ₾ → слот за 25 ₾ — доплата 5 ₾."""
    b = _bonus_booking(payment_method="balance", final_price=20.0, charge_amount=20.0, hours_deducted=None)
    out, moves = _reschedule(b, per_hour=25.0)
    assert not isinstance(out, Exception), out
    assert moves == [("debit", 5.0)], moves
    assert b.final_price == 25.0


def test_reschedule_paid_bonus_booking_charges_nothing():
    """Оплаченная бонус-часом бронь переносится бесплатно: без списания,
    цена 0, бонус-час остаётся на брони (его вернёт отмена)."""
    b = _bonus_booking()
    out, moves = _reschedule(b, per_hour=25.0)
    assert not isinstance(out, Exception), out
    assert moves == [], f"перенос бонусной брони двинул деньги: {moves}"
    assert b.final_price == 0.0 and b.charge_amount == 0.0, (b.final_price, b.charge_amount)
    assert b.payment_method == "bonus" and b.hours_deducted == 1.0
    assert b.start_time == "19:00"


def test_reschedule_pending_bonus_booking_keeps_zero_for_cron():
    """Бронь ещё pending: final_price не должен стать полной ценой — крон
    T-24ч (settle_pending_charge, ветка bonus) списал бы её с баланса."""
    b = _bonus_booking(payment_status="pending", charge_amount=None)
    out, moves = _reschedule(b, per_hour=25.0)
    assert not isinstance(out, Exception), out
    assert moves == [] and b.final_price == 0.0, (moves, b.final_price)


def test_reschedule_partial_bonus_reprices_only_uncovered_part():
    """2 ч, из них 1 ч бонусом, 20 ₾ деньгами → слот 25 ₾/ч: деньгами
    непокрытая половина 25 ₾, доплата 5 ₾ (а не 30)."""
    b = _bonus_booking(duration=120, final_price=20.0, charge_amount=20.0)
    out, moves = _reschedule(b, per_hour=25.0)
    assert not isinstance(out, Exception), out
    assert moves == [("debit", 5.0)], moves
    assert b.final_price == 25.0 and b.hours_deducted == 1.0


def test_reschedule_bonus_booking_duration_change_refused():
    """Смена длительности бонусной брони требует вернуть/дотратить бонус —
    пока честно отказываем, ничего не двигая."""
    b = _bonus_booking()
    out, moves = _reschedule(b, per_hour=25.0, new_duration=90)
    assert getattr(out, "status_code", None) == 400, out
    assert "бонусными часами" in str(out.detail)
    assert moves == [] and b.duration == 60 and b.start_time == "12:00"


def test_change_format_bonus_booking_charges_nothing():
    """Смена формата бонусной брони: длительность та же — бонус покрывает ту
    же долю, деньгами 0 (раньше списывалась полная цена группового слота)."""
    b = _bonus_booking()

    def call(routes, session, owner):
        return routes.change_booking_format(
            booking_id=str(b.id), payload=routes.ChangeFormatRequest(new_format="group"),
            session=session, current_user=owner,
        )
    out, moves = _run_with_fakes(call, b, per_hour=35.0)
    assert not isinstance(out, Exception), out
    assert all(abs(v) < 0.005 for _, v in moves), f"смена формата двинула деньги: {moves}"
    assert b.final_price == 0.0 and b.format == "group"


def test_bonus_uncovered_price_formula():
    """Формула доли — как при создании (_resolve_with_bonus)."""
    from app.api.v1.bookings.routes import _bonus_uncovered_price
    assert _bonus_uncovered_price(_bonus_booking(), 25.0, 60) == 0.0
    assert _bonus_uncovered_price(_bonus_booking(hours_deducted=1.0), 50.0, 120) == 25.0
    # Не бонусная бронь / бонус не потрачен — цена как есть.
    assert _bonus_uncovered_price(_bonus_booking(payment_method="balance"), 25.0, 60) == 25.0
    assert _bonus_uncovered_price(_bonus_booking(hours_deducted=None), 25.0, 60) == 25.0


def test_trim_and_shorten_refuse_bonus_booking():
    """Вырезать/сократить бонусную бронь: денежная ветка её не знает —
    остатки получали полную цену, а бонус-часы не возвращались. Отказ
    должен стоять ДО любых движений денег."""
    src = _read("app/api/v1/bookings/routes.py", _BACKEND)
    for fn, money in (("def trim_booking", "wallet.credit("), ("def shorten_booking", "wallet.credit(")):
        body = _body(src, fn)
        g = body.find("if _bonus_hours_on(booking) > 0:")
        assert g != -1, f"{fn}: нет отказа для бонусной брони"
        assert g < body.find(money), f"{fn}: отказ для бонусной брони стоит после денег"


def test_split_parts_never_negative_for_bonus_booking():
    """Бонусная бронь с допами: final_price=0, а допы 5 ₾ — «комната» уходила
    в минус, и части получали отрицательные цены."""
    src = _read("app/api/v1/bookings/routes.py", _BACKEND)
    body = _body(src, "def split_booking")
    assert "extras_price = min(extras_price, max(0.0," in body


def test_bonus_booking_cannot_be_converted_to_subscription():
    """«Перевести на абонемент» для бонусной брони стирал запись о бонус-часе
    и списывал ещё и часы абонемента. Отказ — и на сервере, и во всех трёх
    кнопках админки (шахматка, список, карточка клиента)."""
    from app.api.v1.bookings.routes import _convert_booking_to_subscription
    b = _bonus_booking()
    try:
        _convert_booking_to_subscription(None, b, None)
    except ValueError as exc:
        assert "бонусными часами" in str(exc), exc
    else:
        raise AssertionError("бонусную бронь перевели на абонемент")
    assert b.payment_method == "bonus" and b.hours_deducted == 1.0
    assert "if (b.paymentMethod === 'bonus') return false;" in _read("src/components/admin/AdminChessboardView.tsx")
    assert "if (b.paymentMethod === 'bonus') return false;" in _read("src/pages/admin/Bookings.tsx")
    assert "booking.paymentMethod !== 'bonus'" in _read("src/components/admin/UserBookingsTab.tsx")


def test_desktop_reschedule_shows_bonus_share_not_full_price():
    """Десктопный перенос бонусной брони: «Разница к оплате» и проверка
    баланса — от непокрытой доли (новичок с 0 ₾ не должен упираться в
    «Недостаточно средств»)."""
    src = _read("src/components/Wizard/ConfirmationStep.tsx")
    assert "oldBooking.paymentMethod !== 'bonus'" in src
    assert "netPrice = rescheduleDiff;" in src
    assert "totalPrice - oldBooking.finalPrice" not in src, "разница снова от полной цены"


def test_extend_series_never_copies_bonus_template_for_free():
    """Ревью 29.09: если движок цен упал при продлении серии, ветка «берём
    шаблон» копировала payment_method='bonus' с final_price=0 без списания
    бонусного часа — комната бесплатно. Такая дата должна пропускаться."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "app/api/v1/bookings/routes.py"),
               encoding="utf-8").read()
    i = src.find("def extend_recurring_series")
    body = src[i:src.find("@router.post(\"/recurring/{group_id}/dismiss-end-reminder\")", i)]
    fb = body[body.find("берём шаблон"):]
    guard = fb.find('if template.payment_method == "bonus"')
    copy = fb.find("_method = template.payment_method")
    assert guard != -1 and copy != -1 and guard < copy, \
        "фолбэк продления снова копирует бонусный шаблон бесплатно"
    assert "continue" in fb[guard:copy] and "skipped.append" in fb[guard:copy]
    assert '"skipped": skipped' in body, "пропущенные даты не возвращаются админу"


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
    print("СТОРОЖ wave0-B: OK" if not failures else f"СТОРОЖ wave0-B УПАЛ ({failures}) — деплой НЕ выкатывать")
    sys.exit(1 if failures else 0)
