"""Остаток по сессии Psy-CRM: цена минус внесённое.

Один способ считать долг для всех экранов (дашборд, список клиентов, баланс
клиента, список сессий). Раньше каждое место считало по-своему и все — как
ПОЛНУЮ цену неоплаченной сессии: клиент внёс 100 из 185, а в долге всё равно
стояло 185 ₾.

Правила:
- Цена сессии — `ts.price`, нет — ставка клиента; валюта — `ts.currency`
  (заморожена на момент оплаты), нет — валюта клиента.
- Внесённое — платежи по этой сессии, пересчитанные в валюту сессии через
  общие курсы (`app_settings.exchange_rates`, те же, что в дашборде).
- «Оплачено полностью»: цена ≤ 0 либо внесено + 0,01 ≥ цены (как в
  create_payment). Допуск в копейку гасит ошибку округления курса.
- Остаток считаем только у НЕоплаченной сессии. У отмеченной «оплачено» он 0
  (в том числе у старых сессий без платежа — их оплату отметили руками),
  а расхождение «цена ≠ внесено» показывается предупреждением в карточке,
  а не долгом.

Модуль без обращений к сети; к базе ходит только load_payments_by_session.
"""
from collections import defaultdict
from typing import Dict, Iterable, List, NamedTuple, Optional

from sqlmodel import Session, select

from app.models.therapist_payment import TherapistPayment

# Допуск в копейку: 0.1 + 0.2 и пересчёт по курсу не должны плодить «долг 0,01».
EPS = 0.01


def norm_currency(code: Optional[str]) -> str:
    return (code or "GEL").strip().upper() or "GEL"


def clean_currency(code: Optional[str], rates: Dict[str, float], *allowed: Optional[str]) -> str:
    """Код валюты для записи: заглавными, и только из тех, что знает система.

    Валюты добавляются через настройки (app_settings.exchange_rates: GEL, USD,
    EUR, RUB, USDT, UAH…), белого списка в коде нет — ориентир это ключи
    курсов. `allowed` — валюты, уже стоящие у клиента/сессии/платежа: их
    оставляем даже если из курсов убрали (иначе старую запись не исправить).
    ValueError с понятным текстом — эндпоинт превратит его в 400.
    """
    cur = (code or "").strip().upper()
    if not cur:
        raise ValueError("Укажите валюту")
    known = {norm_currency(k) for k in rates} | {norm_currency(a) for a in allowed if a}
    if cur not in known:
        raise ValueError(f"Валюта «{cur}» не заведена в настройках курсов")
    return cur


def convert(amount: float, from_cur: Optional[str], to_cur: Optional[str], rates: Dict[str, float]) -> float:
    """Сумма из одной валюты в другую через лари. Неизвестная валюта — курс 1
    (как в дашборде: лучше показать число, чем уронить страницу)."""
    f, t = norm_currency(from_cur), norm_currency(to_cur)
    amount = float(amount or 0)
    if f == t:
        return amount
    rf = float(rates.get(f, 1) or 1)
    rt = float(rates.get(t, 1) or 1)
    return amount * rf / rt


def session_price(ts, client) -> float:
    if ts.price is not None:
        return float(ts.price or 0)
    return float(getattr(client, "base_price", 0) or 0) if client is not None else 0.0


def session_currency(ts, client) -> str:
    return norm_currency(getattr(ts, "currency", None) or getattr(client, "currency", None))


def paid_in(payments: Iterable, currency: str, rates: Dict[str, float]) -> float:
    """Сколько внесено по сессии, в валюте `currency`."""
    return round(sum(convert(p.amount, p.currency, currency, rates) for p in payments), 2)


def slack(payments: Iterable, currency: str, rates: Dict[str, float]) -> float:
    """Допуск на округление платежей в ДРУГОЙ валюте: сумму в долларах пишут
    с точностью до цента, и в лари это ещё до ~1,3 тетри. Без допуска
    «доплатить 15 ₾» платежом в долларах оставляло бы вечный долг в 1 тетри."""
    cur = norm_currency(currency)
    return round(sum(
        0.005 * convert(1, p.currency, cur, rates)
        for p in payments if norm_currency(p.currency) != cur
    ), 4)


def covers(price: float, paid: float, extra: float = 0.0) -> bool:
    """Внесённого хватает на цену (бесплатная сессия — всегда хватает)."""
    return price <= 0 or paid + EPS + extra >= price


class SessionMoney(NamedTuple):
    price: float
    currency: str
    paid: float        # внесено, в валюте сессии
    remaining: float   # долг по сессии, в валюте сессии (0, если оплачена)


def session_money(ts, client, payments: Iterable, rates: Dict[str, float]) -> SessionMoney:
    """Цена, внесённое и остаток по одной сессии (в валюте сессии)."""
    price = session_price(ts, client)
    cur = session_currency(ts, client)
    payments = list(payments)
    paid = paid_in(payments, cur, rates)
    if ts.is_paid:
        remaining = 0.0
    else:
        remaining = 0.0 if covers(price, paid, slack(payments, cur, rates)) else round(price - paid, 2)
    return SessionMoney(round(price, 2), cur, paid, remaining)


def remaining_in(ts, client, payments: Iterable, rates: Dict[str, float], currency: Optional[str] = None) -> float:
    """Остаток по сессии в валюте `currency` (по умолчанию — в валюте клиента).
    Нужен там, где долги разных сессий клиента складываются в одно число."""
    m = session_money(ts, client, payments, rates)
    target = norm_currency(currency or getattr(client, "currency", None) or m.currency)
    return round(convert(m.remaining, m.currency, target, rates), 2)


def load_payments_by_session(db: Session, specialist_id: str) -> Dict[str, List[TherapistPayment]]:
    """Платежи специалиста, привязанные к сессиям, сгруппированные по сессии.
    Одним запросом на весь список — а не по запросу на сессию. По клиенту НЕ
    фильтруем: сессию могли перепривязать к другому клиенту, а платёж остался на
    прежнем — важна связь «платёж ↔ сессия», а не клиент платежа."""
    stmt = select(TherapistPayment).where(
        TherapistPayment.specialist_id == specialist_id,
        TherapistPayment.session_id.is_not(None),
    )
    by_session: Dict[str, List[TherapistPayment]] = defaultdict(list)
    for p in db.exec(stmt).all():
        by_session[p.session_id].append(p)
    return by_session
