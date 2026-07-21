"""Шифрование текста заметок терапевта.

ЗАЧЕМ. Заметки о клиентах — самое чувствительное, что есть в системе.
Лежали открытым текстом: полный слепок базы (а ночной бэкап делает именно
его) показывал бы их как есть. Шифруем на уровне поля, а не в конкретных
эндпоинтах: так текст защищён везде — в списке, в ответе API, в будущем
коде, который ещё никто не написал и где легко забыть про расшифровку.

КАК. Симметричный ключ Fernet в переменной окружения NOTES_ENCRYPTION_KEY
(в .env на сервере, в .secrets.md локально — в git не попадает).
Зашифрованное значение помечается префиксом `enc1:` — по нему отличаем
уже зашифрованное от старого открытого текста, поэтому переход
безболезненный: старые записи читаются как были, новые пишутся закрытыми.

ВАЖНО ПРО КЛЮЧ. Потеря ключа = потеря заметок, расшифровать нечем.
Ключ должен лежать в двух местах: на сервере и в .secrets.md у владельца.
Бэкап базы без ключа бесполезен для восстановления заметок — это и есть
смысл затеи, но и риск, о котором надо помнить.

БЕЗ КЛЮЧА система не падает: пишет открытым текстом с громким предупреждением в лог,
а уже зашифрованное отдаёт заглушкой вместо ошибки. Молча терять данные
хуже, чем временно остаться без шифрования.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from sqlalchemy import Text, TypeDecorator

logger = logging.getLogger(__name__)

PREFIX = "enc1:"
_ENV_VAR = "NOTES_ENCRYPTION_KEY"
_UNREADABLE = "[зашифровано — ключ недоступен]"

_fernet = None
_warned = False


def _read_key() -> str:
    """Ключ из настроек приложения, с запасным вариантом из окружения.

    Порядок важен. pydantic читает .env в объект settings, но НЕ кладёт
    значения в os.environ, а EnvironmentFile у systemd-юнита нет — через
    одно только os.getenv ключ на проде не виден, и шифрование молча
    выключается. Окружение оставлено запасным путём для тестов и скриптов,
    которые задают ключ напрямую.
    """
    key = (os.getenv(_ENV_VAR) or "").strip()
    if key:
        return key
    try:
        from app.core.config import settings
        return (getattr(settings, _ENV_VAR, None) or "").strip()
    except Exception:  # noqa: BLE001 — настройки могут быть недоступны в тестах
        return ""


def _get_fernet():
    """Ленивая инициализация: ключ читается при первом обращении."""
    global _fernet, _warned
    if _fernet is not None:
        return _fernet
    key = _read_key()
    if not key:
        if not _warned:
            logger.warning(
                "%s не задан — заметки терапевта пишутся ОТКРЫТЫМ ТЕКСТОМ. "
                "Сгенерировать ключ: python3 -c \"from cryptography.fernet import Fernet;"
                " print(Fernet.generate_key().decode())\"", _ENV_VAR,
            )
            _warned = True
        return None
    try:
        from cryptography.fernet import Fernet
        _fernet = Fernet(key.encode())
    except Exception as exc:  # noqa: BLE001
        if not _warned:
            logger.error("%s задан, но непригоден (%s) — пишем открытым текстом", _ENV_VAR, exc)
            _warned = True
        return None
    return _fernet


def encrypt(value: Optional[str]) -> Optional[str]:
    """Открытый текст → `enc1:<шифр>`. Без ключа возвращает как есть."""
    if value is None or value == "":
        return value
    if value.startswith(PREFIX):
        return value  # уже зашифровано — не шифруем дважды
    f = _get_fernet()
    if f is None:
        return value
    return PREFIX + f.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: Optional[str]) -> Optional[str]:
    """`enc1:<шифр>` → открытый текст. Старый открытый текст отдаётся как есть."""
    if value is None or value == "":
        return value
    if not value.startswith(PREFIX):
        return value  # запись сделана до шифрования
    f = _get_fernet()
    if f is None:
        return _UNREADABLE
    try:
        return f.decrypt(value[len(PREFIX):].encode("ascii")).decode("utf-8")
    except Exception as exc:  # noqa: BLE001
        logger.error("Не удалось расшифровать заметку: %s", exc)
        return _UNREADABLE


def is_enabled() -> bool:
    """Работает ли шифрование прямо сейчас (для диагностики)."""
    return _get_fernet() is not None


class EncryptedText(TypeDecorator):
    """Поле, которое само шифруется при записи и расшифровывается при чтении.

    Весь остальной код продолжает работать с обычной строкой и про
    шифрование не знает — включая сериализацию ответов FastAPI.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):  # noqa: D102  (в базу)
        return encrypt(value)

    def process_result_value(self, value, dialect):  # noqa: D102  (из базы)
        return decrypt(value)
