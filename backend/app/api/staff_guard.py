"""Турникет на входе API: кто из администраторов что может менять.

Сами правила — в services/staff_scope.py. Здесь только обвязка: достать
пользователя из токена и тело запроса, спросить ``write_refusal`` и ответить 403.
Подключается один раз в main.py ко всему API, поэтому новая ручка не может
«забыть» проверку.
"""
import json
from typing import Optional
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from app.core import security  # noqa: F401 — тот же модуль ключей, что и в deps
from app.core.config import settings
from app.db.session import get_session
from app.models.user import User
from app.services.staff_scope import SAFE_METHODS, write_refusal


async def _json_body(request: Request) -> Optional[dict]:
    """Тело запроса, если это JSON-объект. Файлы и формы не читаем.

    На заголовок «это JSON» не полагаемся (ревизия 21.11): сервер разбирает JSON
    и без него, и запрос без заголовка проходил бы турникет с «пустым» телом.
    """
    if request.method in SAFE_METHODS:
        return None
    ctype = (request.headers.get("content-type") or "").lower()
    if ctype.startswith("multipart/") or "x-www-form-urlencoded" in ctype:
        return None
    if not (request.headers.get("authorization") or "").lower().startswith("bearer "):
        return None  # без входа турникет не работает — тело читать незачем
    try:
        raw = await request.body()  # Starlette запоминает тело — ручка прочитает его снова
        data = json.loads(raw) if raw else None
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def enforce_staff_scope(
    request: Request,
    body: Optional[dict] = Depends(_json_body),
    session: Session = Depends(get_session),
) -> None:
    if request.method in SAFE_METHODS:
        return
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return  # без входа — дальше разберутся сами ручки
    try:
        payload = jwt.decode(auth[7:].strip(), settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = UUID(str(payload.get("sub")))
    except Exception:
        return  # кривой или просроченный токен отсечёт get_current_user
    user = session.get(User, user_id)
    if user is None:
        return
    # Путь берём тот же, что видит маршрутизатор (scope), а не собранный заново
    # url.path: тот обрезается на закодированных «?» и «#» (ревизия 21.11).
    path = request.scope.get("path") or request.url.path
    prefix = settings.API_V1_STR
    if path.startswith(prefix):
        path = path[len(prefix):]
    reason = write_refusal(session, user, request.method, path, body)
    if reason:
        raise HTTPException(status_code=403, detail=reason)
