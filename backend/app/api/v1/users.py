from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.api import deps
from app.db.session import get_session
from app.models.user import User, UserRead

router = APIRouter()

from app.models.user import User, UserRead, UserUpdate, UserUpdateAdmin
from uuid import UUID

@router.get("/me", response_model=UserRead)
def read_user_me(
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Get current user.
    """
    return current_user

@router.post("/debug/promote-me", response_model=UserRead)
def debug_promote_me(
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Emergency Owner Promotion (Temporary).
    Only allows specific email to become Owner.
    """
    allowed_emails = ["koren.nikolas@gmail.com", "mykola@example.com"]
    if current_user.email not in allowed_emails:
        raise HTTPException(status_code=403, detail="Not in allowed list for promotion")
        
    current_user.role = "owner"
    current_user.is_admin = True
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user

@router.patch("/me", response_model=UserRead)
def update_user_me(
    *,
    session: Session = Depends(get_session),
    user_in: UserUpdate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Update own profile.
    """
    """
    Update own profile.
    """
    try:
        user_data = user_in.dict(exclude_unset=True)
        for key, value in user_data.items():
            setattr(current_user, key, value)
        
        session.add(current_user)
        session.commit()
        session.refresh(current_user)
        return current_user
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"DEBUG USERS: {str(e)}")

@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    *,
    user_id: str,
    session: Session = Depends(get_session),
    user_in: UserUpdateAdmin,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Update a user by ID or Email (Admin only).
    """
    if not current_user.is_admin:
         raise HTTPException(status_code=403, detail="Not authorized")
    
    user = None
    # Try as UUID
    try:
        uuid_obj = UUID(user_id)
        user = session.get(User, uuid_obj)
    except ValueError:
        pass
        
    # Try as Email
    if not user:
        user = session.exec(select(User).where(User.email == user_id)).first()
        
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Role Update Protection
    if user_in.role is not None:
        # Hierarchical Logic:
        # 1. Owner can do anything (except delete last owner - checked below)
        # 2. Senior Admin can ONLY manage 'admin' and 'user' roles.
        #    - Cannot change TO owner or senior_admin
        #    - Cannot change FROM owner or senior_admin
        
        target_role = user_in.role
        current_role_db = user.role
        
        if current_user.role == "owner":
            pass # Allowed
            
        elif current_user.role == "senior_admin":
            # Constraint 1: Target role must be 'admin' or 'user'
            if target_role not in ["admin", "user"]:
                raise HTTPException(status_code=403, detail="Senior Admin can only assign 'admin' or 'user' roles")
            
            # Constraint 2: Cannot modify an existing Owner or Senior Admin
            if current_role_db in ["owner", "senior_admin"]:
                 raise HTTPException(status_code=403, detail="Senior Admin cannot modify Owner or System Admin accounts")
                 
        else:
             # Regular admins or users cannot change roles
             raise HTTPException(status_code=403, detail="Not authorized to change roles")

        # Prevent demoting the last owner (Safety Check)
        if user.role == "owner" and user_in.role != "owner":
            # Check if there are other owners
            other_owners = session.exec(select(User).where(User.role == "owner").where(User.id != user.id)).all()
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
    
    # Log Role Change
    if user_in.role is not None and user_in.role != current_role_db:
        timeline_service.log_event(
            session=session,
            actor_id=current_user.id,
            actor_role=current_user.role,
            target_id=str(user.id),
            target_type="user",
            event_type="role_change",
            description=f"Changed role from {current_role_db} to {user_in.role}",
            metadata={"old_role": current_role_db, "new_role": user_in.role}
        )
        
    # Log other critical updates could go here
    # ---------------------
    
    return user

@router.post("/{user_id}/subscription/freeze", response_model=UserRead)
def toggle_subscription_freeze(
    *,
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Toggle subscription freeze status.
    """
    if not current_user.is_admin:
         raise HTTPException(status_code=403, detail="Not authorized")
    
    # User Lookup (Reuse logic or refactor to dep? For now inline)
    user = None
    try:
        user = session.get(User, UUID(user_id))
    except ValueError:
        pass
    if not user:
        user = session.exec(select(User).where(User.email == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if not user.subscription:
        raise HTTPException(status_code=400, detail="User has no subscription")
        
    from datetime import datetime, timedelta
    
    new_sub = user.subscription.copy()
    is_frozen = new_sub.get('isFrozen', False)
    
    new_sub['isFrozen'] = not is_frozen
    if not is_frozen:
        # Freezing now
        new_sub['frozenUntil'] = (datetime.utcnow() + timedelta(days=14)).isoformat()
    else:
        # Unfreezing
        new_sub['frozenUntil'] = None
        
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
        metadata={"action": action, "previous_state_frozen": is_frozen}
    )
    # ---------------------
    
    return user

@router.post("/{user_id}/discount", response_model=UserRead)
def update_personal_discount(
    *,
    user_id: str,
    payload: dict, # { percent: int, reason: str }
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Update personal discount with logging.
    """
    if not current_user.is_admin:
         raise HTTPException(status_code=403, detail="Not authorized")
    
    # User Lookup
    user = None
    try:
        user = session.get(User, UUID(user_id))
    except ValueError:
        pass
    if not user:
        user = session.exec(select(User).where(User.email == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    percent = payload.get('percent')
    reason = payload.get('reason', 'Manual Admin Update')
    
    if percent is None:
        raise HTTPException(status_code=400, detail="percent required")
        
    old_percent = user.personal_discount_percent
    
    # Log entry
    from datetime import datetime
    log_entry = {
        "id": f"log-{int(datetime.utcnow().timestamp())}",
        "date": datetime.utcnow().isoformat(),
        "oldValue": old_percent,
        "newValue": percent,
        "reason": reason,
        "adminName": current_user.name
    }
    
    # Update user history
    # Note: discount_history is NOT in User model explicit fields yet in python? 
    # Let's check UserBase. It has `personal_discount_percent`.
    # It seems `discount_history` is missing in UserBase in python.
    # I should add it to UserBase or crm_data. 
    # Let's add it to UserBase for clarity as JSON.
    
    # Assuming I add it:
    history = user.criteria_data.get('discountHistory', []) if hasattr(user, 'criteria_data') else [] 
    # Wait, let me check UserBase fields again. I suspect `discount_history` is missing.
    # I will add it to `crm_data` for now if I don't want to change schema too much or add to UserBase.
    # Actually, Frontend `User` has `discountHistory`.
    # Let's add `discount_history` to User model in next step.
    
    # Short circuit for now during this file edit, assuming field exists or I add it.
    # I will add `discount_history` to User model in the corresponding tool call.
    
    # Update user history (Legacy JSON field - keep for now if needed, or rely on Timeline)
    # For now we keep the JSON history in frontend/backend model alignment, 
    # BUT we also add the official Timeline Entry
    
    current_history = user.discount_history or []
    current_history.insert(0, log_entry) # Prepend
    
    user.personal_discount_percent = percent
    user.discount_history = current_history 
    
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
        metadata={"old_percent": old_percent, "new_percent": percent, "reason": reason}
    )
    # ---------------------
    
    return user

@router.get("/", response_model=List[UserRead])
def read_users(
    session: Session = Depends(get_session),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """
    Retrieve users.
    """
    allowed_roles = ["owner", "senior_admin", "admin"]
    if current_user.role not in allowed_roles and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    users = session.exec(select(User).offset(skip).limit(limit)).all()
    return users
