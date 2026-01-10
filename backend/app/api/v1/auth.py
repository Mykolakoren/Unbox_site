from datetime import timedelta
from typing import Annotated, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from app.core import security
from app.core.config import settings
from app.db.session import get_session
from app.models.user import User, UserCreate, UserRead
from app.api.deps import get_current_user
import hashlib
import hmac
import json
from pydantic import BaseModel

router = APIRouter()

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
def login_access_token(
    session: Annotated[Session, Depends(get_session)],
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Any:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    statement = select(User).where(User.email == form_data.username)
    user = session.exec(statement).first()
    
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    
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
def telegram_login(
    login_data: TelegramLoginData,
    session: Annotated[Session, Depends(get_session)],
) -> Any:
    """
    Verify Telegram Login Widget Data and login/register user
    """
    if not settings.TELEGRAM_BOT_TOKEN:
         raise HTTPException(status_code=500, detail="Telegram Bot Token not configured")

    # Verify Hash
    # Logic: sha256_HMAC(bot_token_hash, data_check_string) == hash
    
    data_check_arr = []
    # Sort keys alphabetically and filter out hash
    auth_data_dict = login_data.model_dump(exclude={"hash", "photo_url"}, exclude_none=True)
    if login_data.photo_url:
        auth_data_dict['photo_url'] = login_data.photo_url
        
    for key, value in auth_data_dict.items():
        if value is not None:
             data_check_arr.append(f"{key}={value}")
    
    data_check_arr.sort()
    data_check_string = "\n".join(data_check_arr)
    
    secret_key = hashlib.sha256(settings.TELEGRAM_BOT_TOKEN.encode()).digest()
    hash_calc = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    # DEBUG LOGGING (Can be removed later)
    # print(f"Telegram Auth Debug:")
    # print(f"Received Data: {login_data.dict()}")
    # print(f"Check String: {data_check_string}")
    # print(f"Calculated Hash: {hash_calc}")
    # print(f"Received Hash: {login_data.hash}")
    
    if hash_calc != login_data.hash:
        print(f"Telegram Hash Mismatch! Exp: {hash_calc}, Got: {login_data.hash}")
        print(f"Check String used: \n{data_check_string}")
        raise HTTPException(status_code=400, detail=f"Invalid Telegram Hash. Debug: {hash_calc} != {login_data.hash}")
        
    # Check Auth Date (Optional: expiration check)
    # if time.time() - login_data.auth_date > 86400: ...

    telegram_id = str(login_data.id)
    
    # Check user by Telegram ID
    user = session.exec(select(User).where(User.telegram_id == telegram_id)).first()
    
    if not user:
        # Note: Telegram Widget usually doesn't provide Email unless requested specifically
        # If we don't have email, we might generate a placeholder or ask user to provide it later.
        # For now, let's generate a placeholder email
        placeholder_email = f"{telegram_id}@telegram.unbox"
        
        user = User(
            email=placeholder_email,
            name=f"{login_data.first_name} {login_data.last_name or ''}".strip(),
            telegram_id=telegram_id,
            avatar_url=login_data.photo_url,
            hashed_password="",
            is_admin=False
        )
        session.add(user)
        session.commit()
        session.refresh(user)

    user_id = user.id
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        user_id, expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "token_type": "bearer"
    }
