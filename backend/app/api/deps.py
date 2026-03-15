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
# Psy-CRM permissions — also auto-granted to role=specialist
PSY_CRM_PERMISSIONS = {"psy_crm.access", "psy_crm.clients", "psy_crm.sessions", "psy_crm.finances"}

# Permissions that senior_admin is allowed to grant/revoke (subset of all)
SENIOR_ADMIN_GRANTABLE = {
    # CRM Unbox
    "crm.view_clients", "crm.create_client", "crm.edit_client", "crm.manage_status",
    # Бронирования
    "bookings.view_all", "bookings.cancel_any", "bookings.reschedule_any",
    "bookings.override_24h", "bookings.manage_rerent",
    # Абонементы и скидки
    "subscriptions.manage", "subscriptions.request_discount", "subscriptions.set_discount",
    # Финансы
    "finance.topup_balance", "finance.set_credit_limit", "finance.view_reports", "finance.manage_cashbox",
    # Контент
    "content.edit_locations", "content.edit_rooms", "content.add_locations", "content.add_rooms",
    "content.set_hours", "content.edit_pricing",
    # Специалисты
    "specialists.verify",
    # Система
    "admin.access", "admin.dashboard", "admin.accept_requests",
}

# Owner can grant everything above + these
OWNER_ONLY_GRANTABLE = {
    "admin.assign_roles",
    "admin.assign_owner",
    "content.delete",
}
ALL_GRANTABLE = SENIOR_ADMIN_GRANTABLE | OWNER_ONLY_GRANTABLE

def has_permission(user: User, permission: str) -> bool:
    """Check if user has a specific granular permission.

    Owner auto-has ALL permissions.
    Specialists auto-have all psy_crm.* permissions via their role.
    Admins/owners auto-have admin.access via their role.
    """
    # Owner has all permissions
    if user.role == "owner":
        return True
    if permission in PSY_CRM_PERMISSIONS and user.role == SPECIALIST_ROLE:
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
    """Requires specialist role OR active psy_crm.access with valid expiry."""
    # Permanent access for specialist role and owner
    if current_user.role in ("specialist", "owner"):
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
        from datetime import datetime
        try:
            expiry_dt = datetime.fromisoformat(expires_at)
            if datetime.utcnow() > expiry_dt:
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
    token: Annotated[str | None, Depends(reusable_oauth2)] = None
) -> User | None:
    if not token:
        return None
    try:
        return get_current_user(session, token)
    except HTTPException:
        return None
