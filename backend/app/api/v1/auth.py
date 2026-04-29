from datetime import datetime, timedelta
import time
from typing import Annotated, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from app.core import security
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import get_session
from app.models.user import User, UserCreate, UserRead
from app.api.deps import get_current_user
import hashlib
import hmac
import json
from pydantic import BaseModel

router = APIRouter()

import logging
logger = logging.getLogger(__name__)


WELCOME_BONUS_EXPIRY_DAYS = 15  # how long the new-user "free hour" stays redeemable


def _create_welcome_bonus(session: Session, user: User) -> None:
    """Create a 1-hour free booking bonus for a new user.

    Stored as a regular Bonus row so it goes through the same FIFO redemption
    pipeline as paid top-ups. Expires WELCOME_BONUS_EXPIRY_DAYS after signup —
    short window is intentional, encourages the user to actually try the
    space rather than collecting credits.
    """
    try:
        from app.models.bonus import Bonus
        bonus = Bonus(
            user_id=str(user.id),
            type="free_hour",
            quantity=1.0,
            status="active",
            description="Добро пожаловать в Unbox! 1 час аренды в подарок",
            granted_by_id="system",
            granted_by_name="Система",
            expires_at=datetime.now() + timedelta(days=WELCOME_BONUS_EXPIRY_DAYS),
        )
        session.add(bonus)
        session.commit()
        logger.info(f"Welcome bonus created for {user.email}")
    except Exception as e:
        logger.warning(f"Failed to create welcome bonus for {user.email}: {e}")


class GoogleLoginData(BaseModel):
    token: str

class TelegramLoginData(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    auth_date: int
    hash: str

@router.post("/login", response_model=dict)
@limiter.limit("10/minute")  # brute-force guard — real users need only a few tries
def login_access_token(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> Any:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    statement = select(User).where(User.email == form_data.username)
    user = session.exec(statement).first()

    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    # Excel #11 — archived users can't log in.
    if user.archived_at is not None:
        raise HTTPException(
            status_code=403,
            detail="Аккаунт архивирован. Свяжитесь с администратором для восстановления.",
        )
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        user.id, expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "token_type": "bearer"
    }

@router.post("/register", response_model=UserRead)
def register_new_user(
    *,
    session: Annotated[Session, Depends(get_session)],
    user_in: UserCreate,
) -> Any:
    """
    Create new user without the need to be logged in
    """
    user = session.exec(select(User).where(User.email == user_in.email)).first()
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system",
        )
        
    user = User.model_validate(user_in, update={"hashed_password": security.get_password_hash(user_in.password)})
    session.add(user)
    session.commit()
    session.refresh(user)

    # Auto-create welcome bonus (1 free hour)
    _create_welcome_bonus(session, user)

    return user

@router.post("/google", response_model=dict)
def google_login(
    login_data: GoogleLoginData,
    session: Annotated[Session, Depends(get_session)],
) -> Any:
    """
    Verify Google ID Token and login/register user
    """
    try:
        id_info = id_token.verify_oauth2_token(
            login_data.token, 
            google_requests.Request(), 
            settings.GOOGLE_CLIENT_ID
        )
        
        # Google ID Token is valid
        email = id_info['email']
        google_id = id_info['sub']
        name = id_info.get('name', 'Unknown')
        picture = id_info.get('picture')

        # Check if user exists by Google ID
        user = session.exec(select(User).where(User.google_id == google_id)).first()
        
        if not user:
            # Check by email
            user = session.exec(select(User).where(User.email == email)).first()
            if user:
                # Link Google ID to existing user
                user.google_id = google_id
                if not user.avatar_url:
                    user.avatar_url = picture
                session.add(user)
                session.commit()
            else:
                # Create new user
                user = User(
                    email=email,
                    name=name,
                    google_id=google_id,
                    avatar_url=picture,
                    hashed_password="", # No password for OAuth users
                    is_admin=False
                )
                session.add(user)
                session.commit()
                session.refresh(user)
                _create_welcome_bonus(session, user)

        user_id = user.id
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = security.create_access_token(
            user_id, expires_delta=access_token_expires
        )
        return {
            "access_token": access_token,
            "token_type": "bearer"
        }

    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Google Token")


@router.post("/telegram", response_model=dict)
async def telegram_login(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Any:
    """Verify Telegram Login Widget data and log the user in.

    Accepts a raw dict body instead of a Pydantic model — Telegram has
    added optional fields over time (auth_method, is_premium, ...), and a
    strict model would silently strip them, leaving the HMAC computation
    one field short of what Telegram signed → "Invalid hash" on every
    attempt. Mirrors the GET /telegram/callback handler which has always
    iterated over `request.query_params` directly.
    """
    if not settings.TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=500, detail="Telegram Bot Token not configured")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body должен быть JSON")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body должен быть JSON-объектом")

    hash_val = body.pop("hash", None)
    if not hash_val:
        raise HTTPException(status_code=400, detail="Отсутствует поле hash в данных от Telegram")

    # Build data_check_string over ALL remaining fields, in the exact
    # form Telegram itself signed: each key alphabetically sorted,
    # `key=value` joined by '\n'. Stringify here — values may arrive as
    # ints (id, auth_date) or strings depending on the source.
    data_check_arr = []
    for key in sorted(body.keys()):
        value = body[key]
        if value is None or value == "":
            continue
        data_check_arr.append(f"{key}={value}")
    data_check_string = "\n".join(data_check_arr)

    secret_key = hashlib.sha256(settings.TELEGRAM_BOT_TOKEN.encode()).digest()
    hash_calc = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if hash_calc != hash_val:
        # Log enough to debug a future "Invalid hash" — the keys we saw
        # (NOT values, since they include user data), the calculated
        # hash, and the received hash. Helps pinpoint when Telegram adds
        # a new field we silently dropped.
        import logging as _logging
        _logging.getLogger(__name__).warning(
            "Telegram POST hash mismatch: keys=%s, expected=%s, got=%s",
            sorted(body.keys()), hash_calc[:8], str(hash_val)[:8],
        )
        raise HTTPException(status_code=400, detail="Invalid Telegram authentication hash")

    auth_date = body.get("auth_date")
    try:
        auth_date_i = int(auth_date) if auth_date is not None else 0
    except (TypeError, ValueError):
        auth_date_i = 0
    if auth_date_i and time.time() - auth_date_i > 86400:
        raise HTTPException(status_code=400, detail="Telegram auth data expired. Please try again.")

    tg_id_raw = body.get("id")
    if tg_id_raw is None:
        raise HTTPException(status_code=400, detail="Telegram payload без id")
    telegram_id = str(tg_id_raw)

    user = session.exec(select(User).where(User.telegram_id == telegram_id)).first()

    if not user:
        placeholder_email = f"{telegram_id}@telegram.unbox"
        first_name = body.get("first_name", "") or ""
        last_name = body.get("last_name", "") or ""

        user = User(
            email=placeholder_email,
            name=f"{first_name} {last_name}".strip(),
            telegram_id=telegram_id,
            avatar_url=body.get("photo_url"),
            hashed_password="",
            is_admin=False,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        user.id, expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
    }

from fastapi.responses import RedirectResponse
from fastapi import Request


# Fallback page served when /auth/telegram/callback is hit without a `hash`
# query parameter. Two scenarios:
#
#   1. Telegram returned the payload in the URL fragment (`#tgAuthResult=…`
#      or `#id=…&hash=…`) rather than query string. Fragments never reach
#      the server, so we parse them in the browser and repost.
#   2. The user arrived at the callback URL directly (stale history, new
#      tab on an old bookmark). No payload anywhere — we just route them
#      to /login with a gentle note.
_TG_CALLBACK_FALLBACK_HTML = """<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Telegram авторизация…</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#FAFAF7;color:#0F0F10;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}
  .spinner{width:28px;height:28px;margin:0 auto 16px;border:3px solid #E5E5E5;border-top-color:#476D6B;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .small{font-size:13px;color:#666;margin-top:8px}
  .err{color:#B00;font-size:12px;margin-top:8px;font-family:monospace;word-break:break-all}
</style></head>
<body>
  <div>
    <div class="spinner"></div>
    <div id="msg">Завершаем вход через Telegram…</div>
    <div class="small">Если ничего не происходит — <a href="/login">откройте страницу входа</a>.</div>
    <div id="err" class="err"></div>
  </div>
<script>
(async function() {
  function setMsg(t){ var e=document.getElementById('msg'); if(e)e.textContent=t; }
  function setErr(t){ var e=document.getElementById('err'); if(e)e.textContent=t||''; console.error('[tg-auth]', t); }
  function bounceLogin(){ setTimeout(function(){ window.location.replace('/login?tg_failed=1'); }, 3000); }

  // 1) Pull params from either fragment or query. Telegram prefers
  //    fragment when returning from oauth.telegram.org, so prefer it.
  var frag = window.location.hash || '';
  var search = window.location.search || '';
  var payload = null;

  function parseKV(str) {
    str = str.replace(/^[?#]/, '');
    var out = {};
    str.split('&').forEach(function(p) {
      if (!p) return;
      var i = p.indexOf('=');
      var k = decodeURIComponent(i < 0 ? p : p.slice(0, i));
      var v = decodeURIComponent(i < 0 ? '' : p.slice(i + 1));
      if (k) out[k] = v;
    });
    return out;
  }

  // Telegram's new flow wraps params into tgAuthResult=<base64>.
  function tryTgAuthResult(str) {
    var m = str.match(/[#&?]tgAuthResult=([^&#]+)/);
    if (!m) return null;
    try {
      // Telegram uses base64url — normalise to base64 for atob.
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(atob(b));
    } catch (e) { return null; }
  }

  payload = tryTgAuthResult(frag) || tryTgAuthResult(search);
  if (!payload) {
    var kv = Object.assign({}, parseKV(search), parseKV(frag));
    if (kv.hash) payload = kv;
  }

  if (!payload || !payload.hash) {
    setMsg('Ссылка авторизации просрочена. Нажмите «Войти через Telegram» ещё раз.');
    bounceLogin();
    return;
  }

  console.info('[tg-auth] payload keys:', Object.keys(payload).sort());

  // 2) Hand off to the POST endpoint which re-verifies HMAC.
  var resp, data;
  try {
    resp = await fetch('/api/v1/auth/telegram', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    data = await resp.json();
  } catch (err) {
    setMsg('Сбой при отправке данных. Попробуйте ещё раз.');
    setErr(String(err && err.message || err));
    bounceLogin();
    return;
  }
  if (!resp.ok) {
    setMsg('Не удалось войти через Telegram.');
    setErr((data && data.detail) || ('HTTP ' + resp.status));
    bounceLogin();
    return;
  }
  var token = data && (data.access_token || data.accessToken);
  if (!token) {
    setMsg('Сервер не вернул токен. Попробуйте ещё раз.');
    bounceLogin();
    return;
  }

  // 3) Persist the token. Verify the write actually landed — some
  //    browsers (private mode, storage disabled, quota issues) silently
  //    drop the value and the SPA would then redirect us back to /login,
  //    causing the "I clicked, nothing happened" symptom.
  var stored = false;
  try {
    window.localStorage.setItem('token', token);
    stored = window.localStorage.getItem('token') === token;
  } catch (e) {
    setErr('localStorage error: ' + (e && e.message || e));
  }
  if (!stored) {
    setMsg('Браузер заблокировал хранение токена (приватный режим?). Откройте сайт в обычном окне.');
    bounceLogin();
    return;
  }

  // Done — give the storage write one tick to flush, then go.
  setMsg('Готово, открываем кабинет…');
  setTimeout(function(){ window.location.replace('/dashboard?source=telegram'); }, 50);
})();
</script>
<noscript><p>Включите JavaScript или <a href="/login">войдите через форму</a>.</p></noscript>
</body></html>"""


@router.get("/telegram/callback")
def telegram_login_callback(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> Any:
    """
    Handle redirect from Telegram Login Widget (data-auth-url)
    """
    if not settings.TELEGRAM_BOT_TOKEN:
         raise HTTPException(status_code=500, detail="Telegram Bot Token not configured")

    # Get all query params
    params = dict(request.query_params)
    hash_val = params.pop("hash", None)

    if not hash_val:
        # Fallback — Telegram sometimes returns the auth payload in the URL
        # fragment (#tgAuthResult=base64 / #hash=...) instead of query. Frag-
        # ments don't reach the server, so we respond with a tiny HTML page
        # that reads the fragment in the browser, reposts it to POST
        # /auth/telegram, stores the token, and redirects into the SPA.
        # Also covers "user opened the callback URL directly" (stale history
        # tab) — they'll be cleanly bounced to /login with a friendly message
        # instead of seeing a JSON 400.
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=_TG_CALLBACK_FALLBACK_HTML)
    
    # Sort keys alphabetically and prepare string
    data_check_arr = []
    for key, value in params.items():
        if value:
             data_check_arr.append(f"{key}={value}")
    
    data_check_arr.sort()
    data_check_string = "\n".join(data_check_arr)
    
    secret_key = hashlib.sha256(settings.TELEGRAM_BOT_TOKEN.encode()).digest()
    hash_calc = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    if hash_calc != hash_val:
        raise HTTPException(status_code=400, detail="Invalid Telegram Hash.")
        
    telegram_id = str(params.get("id"))
    
    # Check user by Telegram ID
    user = session.exec(select(User).where(User.telegram_id == telegram_id)).first()
    
    if not user:
        placeholder_email = f"{telegram_id}@telegram.unbox"
        first_name = params.get("first_name", "")
        last_name = params.get("last_name", "")
        
        user = User(
            email=placeholder_email,
            name=f"{first_name} {last_name}".strip(),
            telegram_id=telegram_id,
            avatar_url=params.get("photo_url"),
            hashed_password="",
            is_admin=False
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        _create_welcome_bonus(session, user)

    user_id = user.id
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        user_id, expires_delta=access_token_expires
    )
    
    # Full-page redirect flow (frontend now navigates the whole tab to
    # oauth.telegram.org instead of opening a popup, see TelegramLoginButton).
    # We respond with a tiny HTML page that:
    #   1. Stores the token in localStorage (same origin as the SPA).
    #   2. Replaces the URL with /dashboard so the SPA picks it up.
    # Token is never in the address bar / URL params for security.
    #
    # `location.replace` is used instead of `location.href = …` so the
    # browser's back button doesn't bring the user back to this page (and
    # cause a duplicate auth attempt).
    from fastapi.responses import HTMLResponse
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Авторизация Unbox...</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                display: flex; align-items: center; justify-content: center;
                height: 100vh; margin: 0; background: #FAFAF7; color: #0F0F10;
                text-align: center; padding: 20px;
            }}
            .ok {{ font-size: 18px; font-weight: 600; line-height: 1.5; }}
            .small {{ font-size: 13px; color: #666; margin-top: 8px; }}
            .spinner {{
                width: 28px; height: 28px; margin: 0 auto 16px;
                border: 3px solid #E5E5E5; border-top-color: #476D6B;
                border-radius: 50%; animation: spin 0.8s linear infinite;
            }}
            @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
        </style>
    </head>
    <body>
        <div>
            <div class="spinner"></div>
            <div id="ok" class="ok">✓ Telegram авторизован</div>
            <div id="small" class="small">Открываем ваш кабинет…</div>
        </div>
        <script>
            (function() {{
                var token = '{access_token}';
                var stored = false;
                try {{
                    window.localStorage.setItem('token', token);
                    // Verify the write actually landed — some browsers
                    // (private mode / disabled storage) silently drop it
                    // and the SPA would then bounce us back to /login,
                    // creating the "I clicked, nothing happened" symptom.
                    stored = window.localStorage.getItem('token') === token;
                }} catch (e) {{
                    stored = false;
                }}
                if (!stored) {{
                    document.getElementById('ok').textContent = 'Не удалось сохранить токен';
                    document.getElementById('small').textContent =
                        'Браузер блокирует localStorage (приватный режим?). Откройте сайт в обычном окне и повторите.';
                    setTimeout(function(){{ window.location.replace('/login?tg_failed=storage'); }}, 3000);
                    return;
                }}
                // Give the storage write one tick to flush before we
                // navigate. Without this, on some browsers the SPA's
                // first read of localStorage on the new page returns
                // null because the previous document hasn't finished
                // unloading.
                setTimeout(function(){{
                    window.location.replace('/dashboard?source=telegram');
                }}, 50);
            }})();
        </script>
        <noscript>
            <p><a href="/dashboard?source=telegram">Перейти в кабинет</a></p>
        </noscript>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)


# ── Self change password ─────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_own_password(
    *,
    payload: ChangePasswordRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: User = Depends(get_current_user),
) -> Any:
    """Change own password. Requires current password verification."""
    if not current_user.hashed_password:
        raise HTTPException(400, "Аккаунт без пароля (Google/Telegram). Установите пароль через администратора.")

    if not security.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(400, "Неверный текущий пароль")

    if len(payload.new_password) < 6:
        raise HTTPException(400, "Пароль должен быть не менее 6 символов")

    current_user.hashed_password = security.get_password_hash(payload.new_password)
    from datetime import datetime as dt
    current_user.updated_at = dt.now()
    session.add(current_user)
    session.commit()
    return {"ok": True}
