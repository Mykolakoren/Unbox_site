from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import ValidationError
from sqlmodel import Session, select
from ..core import security
from ..core.config import settings
from ..db.session import get_session
from ..models.user import User

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login"
)

# Optional version: does NOT return 401 when token is missing
optional_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login",
    auto_error=False,
)

def get_current_user(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str, Depends(reusable_oauth2)]
) -> User:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        token_data = payload.get("sub")
        # In our case 'sub' is the User ID (UUID) as string
        if token_data is None:
             raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
            )
    except (JWTError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )

    from uuid import UUID
    try:
        user_id = UUID(token_data)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid user identifier",
        )

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail=f"User not found (ID: {user_id})")
    return user

def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    # Assuming all users are active for now or check current_user.is_active if exists
    return current_user

# ── Permissions: canonical source is core/permissions.py, re-exported here ────
from app.core.permissions import (  # noqa: F401 — re-export for backward compat
    ADMIN_ROLES, SPECIALIST_ROLE, PSY_CRM_PERMISSIONS,
    SENIOR_ADMIN_GRANTABLE, OWNER_ONLY_GRANTABLE, ALL_GRANTABLE,
    has_permission,
)

def get_current_superuser(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Legacy alias — prefer require_admin for new routes."""
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough privileges",
        )
    return current_user

def require_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Dependency: требует роль admin/senior_admin/owner. HTTP 403 иначе."""
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough privileges",
        )
    return current_user

def require_can_book(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Cabinet booking is gated to specialists + admins.

    Why: clients without an approved specialist profile shouldn't be able to
    rent rooms — the platform is for therapists running their own practice,
    not a generic coworking. Plain `client` role accounts go through
    `/become-specialist` first; until that's approved by an admin, every
    booking endpoint refuses with a 403 + actionable message.
    """
    role = (current_user.role or "").lower()
    if role in ("specialist", "owner", "senior_admin", "admin"):
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            "Бронирование кабинетов доступно только верифицированным специалистам. "
            "Подайте заявку на /become-specialist — после одобрения админом "
            "появится возможность бронировать."
        ),
    )


def require_specialist(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Requires specialist role OR active psy_crm.access with valid expiry."""
    # Permanent access for specialist role, owner, and senior_admin
    if current_user.role in ("specialist", "owner", "senior_admin"):
        return current_user

    # For other roles — check permission + expiry
    if not has_permission(current_user, "psy_crm.access"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Psy-CRM доступен только пользователям с правом psy_crm.access",
        )

    # Check expiry date
    crm_data = current_user.crm_data or {}
    expires_at = crm_data.get("access_expires_at")
    if expires_at:
        from datetime import datetime, timezone
        try:
            expiry_dt = datetime.fromisoformat(expires_at)
            # Ensure both sides use the same timezone awareness
            now = datetime.now(timezone.utc) if expiry_dt.tzinfo else datetime.now()
            if now > expiry_dt:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Срок доступа к CRM истёк. Запросите продление.",
                )
        except (ValueError, TypeError):
            pass

    return current_user

def require_crm_access(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Dependency: требует разрешение psy_crm.access (или роль specialist)."""
    if not has_permission(current_user, "psy_crm.access"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Psy-CRM доступен только пользователям с правом psy_crm.access",
        )
    return current_user

def get_optional_current_user(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str | None, Depends(optional_oauth2)] = None,
) -> User | None:
    if not token:
        return None
    try:
        return get_current_user(session, token)
    except HTTPException:
        return None
