"""Мост в семейную книгу расходов (Finance Tracker на этом же сервере).

Оплату сессии отмечают здесь, в CRM, а семейный бюджет ведётся в соседнем
сервисе. Без моста каждый платёж надо вносить дважды; вторая запись то
забывается, то расходится с первой. Мост отправляет платёж туда сам:
создание и доплата — upsert по id платежа, удаление — отзыв.

Правила скромные и намеренные:
- Шлём только платежи специалистов из FINANCE_SPECIALIST_IDS — семейный
  бюджет пополняет практика Николая, а не всех специалистов центра.
- Шлём только НАЛИЧНЫЕ. Карточные оплаты приходят в книгу с банковской
  выпиской, и там они точнее: настоящая дата зачисления, настоящая карта,
  имя отправителя. Здесь же у платежа стоит день отметки (клиент мог
  перевести раньше), а счёт записан как «tbc» — карт TBC у Николая две, и
  мост однажды положил 200 ₾ не на ту. Наличные же в выписках не появятся
  никогда: для них этот мост — единственный источник.
- Ошибка моста никогда не ломает операцию в CRM: оплата важнее синхронизации.
  Не долетело — записано в лог, у финансов платёж идемпотентный, можно
  дослать повторной отметкой.
- Сервисы соседствуют на одном дроплете, ходим по локальному адресу.
"""

import logging
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Через настройки приложения, а не os.getenv: сервис читает .env сам,
# pydantic-settings'ом, и в окружение процесса эти переменные не попадают.
FINANCE_URL = (getattr(settings, "FINANCE_URL", "") or "").rstrip("/")
FINANCE_SECRET = getattr(settings, "FINANCE_SECRET", "") or ""
_ALLOWED = {
    s.strip()
    for s in (getattr(settings, "FINANCE_SPECIALIST_IDS", "") or "").split(",")
    if s.strip()
}


# Названия наличных счетов в CRM: исторически встречаются «Cash» и «cash».
CASH_ACCOUNTS = {"cash", "наличные"}


def _enabled(specialist_id: str) -> bool:
    return bool(FINANCE_URL and FINANCE_SECRET) and specialist_id in _ALLOWED


def _is_cash(account: Optional[str]) -> bool:
    return (account or "").strip().lower() in CASH_ACCOUNTS


def push_payment(payment, client_name: Optional[str]) -> None:
    """Наличный платёж создан или дополнен — той же записью уходит в финансы."""
    if not _enabled(payment.specialist_id) or not _is_cash(payment.account):
        return
    try:
        resp = httpx.post(
            f"{FINANCE_URL}/api/integrations/unbox/payment",
            json={
                "external_id": payment.id,
                "amount": float(payment.amount or 0),
                "currency": payment.currency or "GEL",
                "account": payment.account or "Cash",
                # Дата платежа, не сессии: книга расходов — про движение денег.
                "date": payment.date.date().isoformat(),
                "client_name": client_name,
            },
            headers={"X-Integration-Secret": FINANCE_SECRET},
            timeout=5.0,
        )
        body = resp.json() if resp.status_code == 200 else resp.text[:200]
        logger.info("finance_bridge push %s → %s %s", payment.id, resp.status_code, body)
    except Exception as exc:  # мост не имеет права уронить оплату
        logger.error("finance_bridge push %s не долетел: %s", payment.id, exc)


def retract_payment(payment_id: str, specialist_id: str) -> None:
    """Платёж удалили — отзываем и его след в финансах.

    Проверку на наличные здесь не делаем: отзыв идёт по идентификатору, и
    если записи там нет, финансы честно отвечают «absent». Зато карточный
    платёж, отправленный до этой правки, отзовётся как надо.
    """
    if not _enabled(specialist_id):
        return
    try:
        resp = httpx.delete(
            f"{FINANCE_URL}/api/integrations/unbox/payment/{payment_id}",
            headers={"X-Integration-Secret": FINANCE_SECRET},
            timeout=5.0,
        )
        logger.info("finance_bridge retract %s → %s", payment_id, resp.status_code)
    except Exception as exc:
        logger.error("finance_bridge retract %s не долетел: %s", payment_id, exc)
