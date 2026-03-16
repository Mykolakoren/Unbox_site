"""Users — admin management endpoints (list, update, freeze, discount, etc.)."""
from typing import Any, List
from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlmodel import Session, select
from app.api import deps
from app.db.session import get_session
from app.models.user import User, UserRead, UserUpdateAdmin

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _resolve_user(session: Session, user_id: str) -> User:
    """Resolve user by UUID or email. Raises 404 if not found."""
    user = None
    try:
        user = session.get(User, UUID(user_id))
    except ValueError:
        pass
    if not user:
        user = session.exec(select(User).where(User.email == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"User not found (ID: {user_id})")
    return user


# ── List users ────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[UserRead])
def read_users(
    session: Session = Depends(get_session),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Retrieve users (Admin only)."""
    users = session.exec(select(User).offset(skip).limit(limit)).all()
    return users


# ── Update user (Admin) ──────────────────────────────────────────────────────

@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    *,
    user_id: str,
    session: Session = Depends(get_session),
    user_in: UserUpdateAdmin,
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Update a user by ID or Email (Admin only)."""
    user = _resolve_user(session, user_id)

    # Role Update Protection
    if user_in.role is not None:
        target_role = user_in.role
        current_role_db = user.role

        if current_user.role == "owner":
            pass  # Allowed
        elif current_user.role == "senior_admin":
            if target_role not in ["admin", "user"]:
                raise HTTPException(
                    status_code=403,
                    detail="Senior Admin can only assign 'admin' or 'user' roles",
                )
            if current_role_db in ["owner", "senior_admin"]:
                raise HTTPException(
                    status_code=403,
                    detail="Senior Admin cannot modify Owner or System Admin accounts",
                )
        else:
            raise HTTPException(status_code=403, detail="Not authorized to change roles")

        # Prevent demoting the last owner
        if user.role == "owner" and user_in.role != "owner":
            other_owners = session.exec(
                select(User).where(User.role == "owner").where(User.id != user.id)
            ).all()
            if not other_owners:
                raise HTTPException(status_code=400, detail="Cannot demote the last Owner")

    user_data = user_in.dict(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    # Sync is_admin flag based on role for backward compatibility
    if user.role in ["owner", "senior_admin", "admin"]:
        user.is_admin = True
    else:
        user.is_admin = False

    session.add(user)
    session.commit()
    session.refresh(user)

    # --- AUDIT LOGGING ---
    from app.services.timeline import timeline_service

    if user_in.role is not None and user_in.role != current_role_db:
        timeline_service.log_event(
            session=session,
            actor_id=current_user.id,
            actor_role=current_user.role,
            target_id=str(user.id),
            target_type="user",
            event_type="role_change",
            description=f"Changed role from {current_role_db} to {user_in.role}",
            metadata={"old_role": current_role_db, "new_role": user_in.role},
        )

    return user


# ── Subscription freeze ──────────────────────────────────────────────────────

@router.post("/{user_id}/subscription/freeze", response_model=UserRead)
def toggle_subscription_freeze(
    *,
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Toggle subscription freeze status."""
    user = _resolve_user(session, user_id)

    if not user.subscription:
        raise HTTPException(status_code=400, detail="User has no subscription")

    from datetime import timedelta

    new_sub = user.subscription.copy()
    is_frozen = new_sub.get("is_frozen", False)
    freeze_count = new_sub.get("freeze_count", 0)

    if not is_frozen:
        if freeze_count >= 1:
            raise HTTPException(
                status_code=400, detail="Subscription has already been frozen once"
            )
        new_sub["is_frozen"] = True
        new_sub["freeze_count"] = freeze_count + 1
        new_sub["frozen_until"] = (datetime.utcnow() + timedelta(days=7)).isoformat()
    else:
        new_sub["is_frozen"] = False
        new_sub["frozen_until"] = None

    user.subscription = new_sub
    session.add(user)
    session.commit()
    session.refresh(user)

    # --- AUDIT LOGGING ---
    from app.services.timeline import timeline_service

    action = "Freezing" if not is_frozen else "Unfreezing"
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(user.id),
        target_type="user",
        event_type="subscription_freeze",
        description=f"{action} subscription",
        metadata={"action": action, "previous_state_frozen": is_frozen},
    )

    return user


# ── Personal discount ────────────────────────────────────────────────────────

@router.post("/{user_id}/discount", response_model=UserRead)
def update_personal_discount(
    *,
    user_id: str,
    payload: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Update personal discount with logging."""
    user = _resolve_user(session, user_id)

    percent = payload.get("percent")
    reason = payload.get("reason", "Manual Admin Update")

    if percent is None:
        raise HTTPException(status_code=400, detail="percent required")

    old_percent = user.personal_discount_percent

    log_entry = {
        "id": f"log-{int(datetime.utcnow().timestamp())}",
        "date": datetime.utcnow().isoformat(),
        "oldValue": old_percent,
        "newValue": percent,
        "reason": reason,
        "adminName": current_user.name,
    }

    current_history = list(user.discount_history) if user.discount_history else []
    current_history.insert(0, log_entry)

    user.personal_discount_percent = percent
    user.discount_history = current_history

    # Auto-switch pricing system
    if percent > 0:
        user.pricing_system = "personal"
    else:
        user.pricing_system = "standard"

    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(user, "discount_history")

    session.add(user)
    session.commit()
    session.refresh(user)

    # --- AUDIT LOGGING ---
    from app.services.timeline import timeline_service

    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(user.id),
        target_type="user",
        event_type="discount_change",
        description=f"Changed discount from {old_percent}% to {percent}%. Reason: {reason}",
        metadata={"old_percent": old_percent, "new_percent": percent, "reason": reason},
    )

    return user


# ── Change password ──────────────────────────────────────────────────────────

@router.post("/{user_id}/change-password")
def change_user_password(
    *,
    user_id: str,
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """
    Change password for a user (Admin only).
    Owner can change any user's password.
    Senior admin can change passwords for admin/specialist/user roles.
    """
    from app.core.security import get_password_hash

    new_password = payload.get("new_password")
    if not new_password or len(new_password) < 6:
        raise HTTPException(
            status_code=400, detail="Password must be at least 6 characters"
        )

    user = _resolve_user(session, user_id)

    # Permission check
    if current_user.role == "owner":
        pass
    elif current_user.role == "senior_admin":
        if user.role in ["owner", "senior_admin"]:
            raise HTTPException(
                status_code=403,
                detail="Senior Admin cannot change Owner/Senior Admin passwords",
            )
    else:
        raise HTTPException(status_code=403, detail="Not authorized to change passwords")

    user.hashed_password = get_password_hash(new_password)
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()

    # Audit log
    from app.services.timeline import timeline_service

    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(user.id),
        target_type="user",
        event_type="password_change",
        description=f"Password changed by {current_user.name}",
        metadata={"changed_by": current_user.name},
    )

    return {"status": "ok", "message": "Password changed successfully"}


# ── Permissions management ───────────────────────────────────────────────────

@router.patch("/{user_id}/permissions", response_model=UserRead)
def update_permissions(
    user_id: str,
    permissions: List[str] = Body(..., embed=True),
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """
    Update granular permissions for a user.
    Owner: can grant/revoke any permission.
    Senior Admin: can only grant/revoke permissions within SENIOR_ADMIN_GRANTABLE set.
    """
    user = _resolve_user(session, user_id)

    invalid = [p for p in permissions if p not in deps.ALL_GRANTABLE]
    if invalid:
        raise HTTPException(400, f"Unknown permissions: {invalid}")

    if current_user.role == "senior_admin":
        disallowed = [p for p in permissions if p not in deps.SENIOR_ADMIN_GRANTABLE]
        if disallowed:
            raise HTTPException(403, f"Senior Admin cannot grant: {disallowed}")
        existing_owner_perms = [
            p for p in (user.permissions or []) if p in deps.OWNER_ONLY_GRANTABLE
        ]
        senior_perms = [p for p in permissions if p in deps.SENIOR_ADMIN_GRANTABLE]
        final_permissions = existing_owner_perms + senior_perms
    else:
        final_permissions = permissions

    user.permissions = final_permissions
    user.updated_at = datetime.utcnow()
    session.add(user)

    comment_history = list(user.comment_history or [])
    comment_history.append({
        "date": datetime.utcnow().isoformat(),
        "adminName": current_user.name,
        "text": f"Обновлены права доступа: {', '.join(final_permissions) if final_permissions else 'все сброшены'}",
        "type": "permissions_update",
    })
    user.comment_history = comment_history
    session.commit()
    session.refresh(user)
    return user


# ── Subscription top-up ──────────────────────────────────────────────────────

@router.post("/{user_id}/subscription/topup", response_model=UserRead)
def topup_subscription(
    user_id: str,
    payload: dict = Body(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """
    Top-up subscription hours for a user.
    payload: { hours: float, amount: float, payment_method: str, account: str, note?: str }
    """
    if current_user.role == "admin" and not deps.has_permission(
        current_user, "subscriptions.manage"
    ):
        raise HTTPException(403, "Requires subscriptions.manage permission")

    user = _resolve_user(session, user_id)

    hours = float(payload.get("hours", 0))
    amount = float(payload.get("amount", 0))
    payment_method = payload.get("payment_method", "")
    account = payload.get("account", "")
    note = payload.get("note", "")

    if hours <= 0:
        raise HTTPException(400, "Hours must be positive")

    subscription = dict(user.subscription or {})
    current_hours = float(subscription.get("remainingHours", 0))
    total_hours = float(subscription.get("totalHours", 0))
    subscription["remainingHours"] = round(current_hours + hours, 2)
    subscription["totalHours"] = round(total_hours + hours, 2)
    user.subscription = subscription

    comment_history = list(user.comment_history or [])
    log_text = (
        f"Пополнение абонемента: +{hours}ч · {amount} · {payment_method} · счёт: {account}"
        + (f" · {note}" if note else "")
    )
    comment_history.append({
        "date": datetime.utcnow().isoformat(),
        "adminName": current_user.name,
        "text": log_text,
        "type": "subscription_topup",
        "meta": {
            "hours": hours,
            "amount": amount,
            "payment_method": payment_method,
            "account": account,
        },
    })
    user.comment_history = comment_history
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
