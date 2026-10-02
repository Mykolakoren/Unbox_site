"""Сообщение владельцу о расхождении кассы при закрытии смены (решение 02.10).

Владелец уходит от Excel: админы больше не сверяют кассу вручную в таблице.
При закрытии смены, если пересчитанные деньги разошлись с остатком на сайте,
сайт молча пишет корректирующую операцию (cash_reconciliation) — остаток
выравнивается, и владелец о расхождении раньше не узнавал вовсе. Теперь при
расхождении больше порога он получает сообщение в Telegram сразу:

  «Касса Unbox One: при закрытии смены (Валентина) ожидалось 7 600 ₾,
   пересчитано 7 580 ₾, расхождение −20 ₾»

Получатели — те же, что у ночного ревизора (scripts/money_audit.py):
TELEGRAM_OWNER_CHAT_ID, а если он не задан — TELEGRAM_ADMIN_CHAT_ID. Чат
выбирает telegram_service.send_owner_summary — здесь выбор не дублируем.

Отправка никогда не роняет закрытие смены: всё в try/except, сбой — в лог.
"""
from __future__ import annotations

import logging
import threading
import time
from html import escape
from typing import Optional

logger = logging.getLogger(__name__)

# Порог владельца (02.10): о расхождении до 5 ₾ включительно не пишем — это
# мелочь (сдача, округление). Им же пользуется ревизор (сводка расхождений смен
# за неделю), поэтому порог живёт в одном месте — здесь.
SHIFT_DISCREPANCY_ALERT_GEL = 5.0

# Повторный запрос не должен присылать второе сообщение. Последовательный
# повтор (обрыв связи → админ жмёт ещё раз) и так безопасен: корректировка уже
# вошла в итог кассы, и второе закрытие даёт расхождение 0. Одновременные
# запросы (двойное нажатие, два устройства) ловим здесь: одно сообщение на
# (филиал, ожидалось, пересчитано) за 10 минут. API работает одним процессом
# uvicorn — памяти процесса для этого достаточно.
_REPEAT_WINDOW_SEC = 600
_recent: dict[tuple, float] = {}
_recent_lock = threading.Lock()

_NBSP = " "
_MINUS = "−"


def fmt_gel(amount: float, sign: bool = False) -> str:
    """Сумма как на сайте (formatGel): «7 600 ₾», «31,5 ₾», «−20 ₾», «+20 ₾».

    Разряды и знак валюты — через неразрывный пробел, копейки — только если есть.
    """
    value = round(float(amount or 0.0), 2)
    body = f"{abs(value):,.2f}".replace(",", _NBSP).replace(".", ",")
    body = body.rstrip("0").rstrip(",")
    if value < 0:
        prefix = _MINUS
    elif sign and value > 0:
        prefix = "+"
    else:
        prefix = ""
    return f"{prefix}{body}{_NBSP}₾"


def needs_alert(discrepancy: float) -> bool:
    """Писать владельцу, только если |расхождение| строго больше порога."""
    return abs(round(float(discrepancy or 0.0), 2)) > SHIFT_DISCREPANCY_ALERT_GEL


def format_message(
    *,
    branch: Optional[str],
    admin_name: Optional[str],
    expected: float,
    actual: float,
    discrepancy: float,
    notes: Optional[str] = None,
) -> str:
    """Текст сообщения (HTML: имя админа и комментарий экранируем)."""
    where = f"Касса {branch}" if branch else "Касса (все филиалы)"
    who = (admin_name or "").strip() or "админ"
    lines = [
        f"⚠️ <b>{escape(where)}</b>: при закрытии смены ({escape(who)}) "
        f"ожидалось {fmt_gel(expected)}, пересчитано {fmt_gel(actual)}, "
        f"расхождение {fmt_gel(discrepancy, sign=True)}",
        "",
        "Остаток кассы на сайте уже выровнен корректирующей операцией.",
    ]
    comment = (notes or "").strip()
    if comment:
        if len(comment) > 300:
            comment = comment[:300] + "…"
        lines.append(f"Комментарий админа: {escape(comment)}")
    return "\n".join(lines)


def _claim(branch: Optional[str], expected: float, actual: float) -> bool:
    """True — по этому закрытию ещё не писали (и теперь оно «занято»)."""
    key = (branch or "", round(float(expected), 2), round(float(actual), 2))
    now = time.monotonic()
    with _recent_lock:
        for k, ts in list(_recent.items()):
            if now - ts > _REPEAT_WINDOW_SEC:
                del _recent[k]
        if key in _recent:
            return False
        _recent[key] = now
        return True


def send_alert(text: str) -> bool:
    """Отправить владельцу (чат владельца, без него — чат админов). Не бросает."""
    try:
        from app.services.telegram import telegram_service

        ok = bool(telegram_service.send_owner_summary(text))
        if not ok:
            logger.warning("[shift-alert] сообщение о расхождении кассы не доставлено "
                           "(не задан чат или Telegram отказал)")
        return ok
    except Exception:  # noqa: BLE001
        logger.exception("[shift-alert] не смог отправить сообщение о расхождении кассы")
        return False


def notify_shift_discrepancy(
    background_tasks=None,
    *,
    branch: Optional[str],
    admin_name: Optional[str],
    expected: float,
    actual: float,
    discrepancy: float,
    notes: Optional[str] = None,
) -> bool:
    """Решить, нужно ли сообщение, и отправить его (в фоне, если передан
    BackgroundTasks — ответ админу не ждёт Telegram). True — сообщение поставлено.

    Вызывать ПОСЛЕ того, как отчёт смены и корректировка записаны. Никогда не
    бросает исключение: смена уже закрыта, сбой здесь — только запись в лог.
    """
    try:
        if not needs_alert(discrepancy):
            return False
        if not _claim(branch, expected, actual):
            logger.info("[shift-alert] повторное закрытие с теми же цифрами — второе сообщение не шлём")
            return False
        text = format_message(
            branch=branch, admin_name=admin_name, expected=expected,
            actual=actual, discrepancy=discrepancy, notes=notes,
        )
        if background_tasks is not None:
            background_tasks.add_task(send_alert, text)
        else:
            send_alert(text)
        return True
    except Exception:  # noqa: BLE001
        logger.exception("[shift-alert] сбой при подготовке сообщения о расхождении кассы")
        return False
