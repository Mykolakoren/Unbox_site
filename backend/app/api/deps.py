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
    except (JWTError, ValidationError) as e:
        print(f"DEBUG AUTH ERROR: {e}")
        print(f"DEBUG TOKEN: {token}") 
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

ADMIN_ROLES = {"owner", "senior_admin", "admin"}
SPECIALIST_ROLE = "specialist"

# ── Granular permissions ───────────────────────────────────────────────────────
# CRM permissions — also auto-granted to role=specialist
CRM_PERMISSIONS = {"crm.access", "crm.clients", "crm.sessions", "crm.finances"}

# Permissions that senior_admin is allowed to grant/revoke (subset of all)
SENIOR_ADMIN_GRANTABLE = {
    # CRM
    "crm.access", "crm.clients", "crm.sessions", "crm.finances",
    # Bookings
    "bookings.override_24h", "bookings.cancel_any", "bookings.reschedule_any",
    # Users
    "users.set_personal_discount", "users.manage_subscription",
    # Finance
    "finance.topup", "finance.add_funds", "finance.view_reports",
}
# Owner can grant everything above + these
OWNER_ONLY_GRANTABLE = {
    "users.assign_roles",
    "content.edit_locations",
    "content.edit_pricing",
    "admin.access",
    "admin.assign_owner",
}
ALL_GRANTABLE = SENIOR_ADMIN_GRANTABLE | OWNER_ONLY_GRANTABLE

def has_permission(user: User, permission: str) -> bool:
    """Check if user has a specific granular permission.

    Specialists auto-have all crm.* permissions via their role.
    Admins/owners auto-have admin.access via their role.
    """
    if permission in CRM_PERMISSIONS and user.role == SPECIALIST_ROLE:
        return True
    if permission == "admin.access" and user.role in ADMIN_ROLES:
        return True
    return permission in (user.permissions or [])

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

def require_specialist(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Legacy: requires specialist role OR crm.access permission."""
    if not has_permission(current_user, "crm.access"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CRM доступен только пользователям с правом crm.access",
        )
    return current_user

def require_crm_access(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Dependency: требует разрешение crm.access (или роль specialist)."""
    if not has_permission(current_user, "crm.access"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CRM доступен только пользователям с правом crm.access",
        )
    return current_user

def get_optional_current_user(
    session: Annotated[Session, Depends(get_session)],
    token: Annotated[str | None, Depends(reusable_oauth2)] = None
) -> User | None:
    if not token:
        return None
    try:
        return get_current_user(session, token)
    except HTTPException:
        return None
