"""Архив рабочего чата админов в Telegram (решение владельца 09.10).

Бот Unbox добавлен в чат «UNBOX admin» (режим приватности бота выключен) и
молча сохраняет каждое сообщение — чтобы Claude по просьбе владельца читал
переписку целиком (ответы, пересылки, скриншоты) и сверял с сайтом. Админы
предупреждены. Бот в чате НИЧЕГО не пишет.

Хранение — файлы на сервере, вне сайта (nginx отдаёт только dist):
    <TELEGRAM_ARCHIVE_DIR>/<chat_id>/<YYYY-MM-DD>.jsonl   (день по Тбилиси)
Одна строка — одно сообщение или его правка. Скриншоты не качаем сразу:
храним file_id (у бота он постоянный), выгрузка — scripts/tg_archive_dump.py.
Файлы старше ARCHIVE_KEEP_DAYS (90) удаляются сами.

Какие чаты пишем — TELEGRAM_ARCHIVE_CHAT_IDS (через запятую). Другие группы
не пишем; их id и название один раз попадают в журнал сервиса — так чат
админов находится при подключении.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

TZ = timedelta(hours=4)  # Тбилиси
GROUP_TYPES = ("group", "supergroup")
ARCHIVE_KEEP_DAYS = 90
_seen_unarchived: set = set()
_last_cleanup: dict = {"day": None}


def archive_chat_ids() -> set[str]:
    raw = getattr(settings, "TELEGRAM_ARCHIVE_CHAT_IDS", None) or ""
    return {x.strip() for x in raw.split(",") if x.strip()}


def archive_dir() -> str:
    return getattr(settings, "TELEGRAM_ARCHIVE_DIR", None) or "/var/lib/unbox/tg_archive"


def _name(u: Optional[dict]) -> Optional[str]:
    if not u:
        return None
    full = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x).strip()
    return full or u.get("title") or (("@" + u["username"]) if u.get("username") else None)


def _short(m: Optional[dict]) -> Optional[dict]:
    """Сообщение, на которое ответили: кто и начало текста."""
    if not m:
        return None
    text = m.get("text") or m.get("caption") or ""
    return {
        "message_id": m.get("message_id"),
        "from": _name(m.get("from")),
        "text": (text[:300] + "…") if len(text) > 300 else text,
        "has_photo": bool(m.get("photo")),
    }


def record(message: dict, edited: bool = False) -> dict:
    """Строка архива из сообщения Telegram (без побочных эффектов)."""
    ts = int(message.get("edit_date") or message.get("date") or 0)
    photo = message.get("photo") or []
    doc = message.get("document") or {}
    fwd = message.get("forward_origin") or {}
    fwd_from = (
        _name(fwd.get("sender_user")) or fwd.get("sender_user_name")
        or _name(fwd.get("sender_chat")) or _name(fwd.get("chat"))
        or _name(message.get("forward_from")) or message.get("forward_sender_name")
    )
    return {
        "message_id": message.get("message_id"),
        "ts": ts,
        "at": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None,
        "edited": edited,
        "from": _name(message.get("from")),
        "text": message.get("text") or message.get("caption") or "",
        "reply_to": _short(message.get("reply_to_message")),
        "forward_from": fwd_from,
        # Самый крупный размер фото; документ (скрин «файлом», PDF) — отдельно.
        "photo_file_id": photo[-1].get("file_id") if photo else None,
        "document": {"file_id": doc.get("file_id"), "name": doc.get("file_name"),
                     "mime": doc.get("mime_type")} if doc else None,
        "voice": bool(message.get("voice") or message.get("video_note")),
    }


def _cleanup(folder: str, today: str) -> None:
    """Раз в день: удалить дни старше ARCHIVE_KEEP_DAYS."""
    if _last_cleanup["day"] == today:
        return
    _last_cleanup["day"] = today
    cutoff = time.time() - ARCHIVE_KEEP_DAYS * 86400
    for fn in os.listdir(folder):
        p = os.path.join(folder, fn)
        if fn.endswith(".jsonl") and os.path.getmtime(p) < cutoff:
            os.remove(p)


def maybe_archive(update: dict[str, Any]) -> bool:
    """Записать сообщение из чатов архива. True — записано.

    Никогда не бросает исключений наружу: архив не должен ломать бота.
    """
    try:
        edited = "edited_message" in update and "message" not in update
        message = update.get("message") or update.get("edited_message") or {}
        chat = message.get("chat") or {}
        if chat.get("type") not in GROUP_TYPES:
            return False
        chat_id = str(chat.get("id"))
        if chat_id not in archive_chat_ids():
            if chat_id not in _seen_unarchived:
                _seen_unarchived.add(chat_id)
                logger.info("[tg:archive] группа не в архиве: id=%s title=%r", chat_id, chat.get("title"))
                # Только id и название — чтобы найти чат админов при подключении.
                os.makedirs(archive_dir(), mode=0o700, exist_ok=True)
                with open(os.path.join(archive_dir(), "_groups_seen.jsonl"), "a", encoding="utf-8") as f:
                    f.write(json.dumps({"id": chat_id, "title": chat.get("title"),
                                        "at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False) + "\n")
            return False
        rec = record(message, edited=edited)
        day = (datetime.fromtimestamp(rec["ts"] or time.time(), tz=timezone.utc) + TZ).date().isoformat()
        folder = os.path.join(archive_dir(), chat_id.lstrip("-"))
        os.makedirs(folder, mode=0o700, exist_ok=True)
        with open(os.path.join(folder, f"{day}.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        _cleanup(folder, day)
        return True
    except Exception:  # noqa: BLE001
        logger.warning("[tg:archive] не удалось записать сообщение", exc_info=True)
        return False


def is_group_update(update: dict[str, Any]) -> bool:
    message = update.get("message") or update.get("edited_message") or {}
    return (message.get("chat") or {}).get("type") in GROUP_TYPES
