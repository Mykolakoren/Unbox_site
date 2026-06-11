"""Users — admin management endpoints (list, update, freeze, discount, etc.)."""
from typing import Any, List, Optional
from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlmodel import Session, select
from pydantic import BaseModel
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
    limit: int = Query(1000, le=5000),
    include_archived: bool = Query(False, description="Include soft-deleted users (Excel #11)"),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Retrieve users (Admin only). Excludes archived by default.

    Limit raised from 100 → 1000 default (cap 5000) so the admin user-list
    page and /admin/users/<email> deep-links return ALL users in one call.
    Earlier defaults silently truncated past the 100th user; deep-link
    targets falling off the tail rendered as "Клиент не найден".
    """
    stmt = select(User)
    if not include_archived:
        stmt = stmt.where(User.archived_at.is_(None))  # type: ignore
    users = session.exec(stmt.offset(skip).limit(limit)).all()
    return users


# ── Archive / Unarchive (Soft delete) — Excel #11 ─────────────────────────────

class ArchiveRequest(BaseModel):
    reason: Optional[str] = None


@router.post("/{user_id}/archive", response_model=UserRead)
def archive_user(
    *,
    user_id: str,
    payload: ArchiveRequest = Body(default_factory=ArchiveRequest),
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Soft-delete a user (Excel #11).

    Archived users can't log in and are hidden from the admin list by default
    (pass `?include_archived=true` to see them). All related history
    (bookings, payments, bonuses) is preserved. Only `owner` can hard-delete
    via direct SQL — there is no UI path for permanent deletion.
    """
    user = _resolve_user(session, user_id)

    # Safety: can't archive yourself or another owner
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя архивировать собственный аккаунт")
    if user.role == "owner":
        raise HTTPException(status_code=403, detail="Нельзя архивировать владельца центра")
    # Senior admins can archive admins/specialists/users; regular admins — users/specialists only
    if current_user.role == "admin" and user.role in ("senior_admin", "admin"):
        raise HTTPException(status_code=403, detail="Недостаточно прав для архивации администратора")

    if user.archived_at is not None:
        return user  # already archived, idempotent

    user.archived_at = datetime.now()
    user.archived_by_id = str(current_user.id)
    user.archived_reason = (payload.reason or "").strip() or None
    user.updated_at = datetime.now()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@router.post("/{user_id}/unarchive", response_model=UserRead)
def unarchive_user(
    *,
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    """Restore an archived user (Excel #11)."""
    user = _resolve_user(session, user_id)
    if user.archived_at is None:
        return user  # not archived, idempotent
    user.archived_at = None
    user.archived_by_id = None
    user.archived_reason = None
    user.updated_at = datetime.now()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


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
            # Senior admin can assign any role that isn't more privileged than
            # their own. That includes "specialist" now — practitioners
            # joining the platform need a role flip, not a ticket to the owner.
            if target_role not in ["admin", "user", "specialist"]:
                raise HTTPException(
                    status_code=403,
                    detail="Старший администратор может назначать только роли: 'admin', 'specialist', 'user'",
                )
            if current_role_db in ["owner", "senior_admin"]:
                raise HTTPException(
                    status_code=403,
                    detail="Старший администратор не может менять роль Владельца или другого Старшего администратора",
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
        new_sub["frozen_until"] = (datetime.now() + timedelta(days=7)).isoformat()
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
    # Setting a discount is a senior-only privileged op — gate on the same
    # permission used elsewhere for discount changes. Owner/senior_admin have
    # it by default; a plain admin needs the explicit grant.
    if not deps.has_permission(current_user, "subscriptions.set_discount"):
        raise HTTPException(
            status_code=403, detail="Requires subscriptions.set_discount permission"
        )

    user = _resolve_user(session, user_id)

    percent = payload.get("percent")
    reason = payload.get("reason", "Manual Admin Update")

    if percent is None:
        raise HTTPException(status_code=400, detail="percent required")

    # Clamp/validate range — anything outside 0..100 would produce free or
    # negative-priced bookings.
    try:
        percent = int(percent)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="percent must be an integer 0..100")
    if percent < 0 or percent > 100:
        raise HTTPException(status_code=400, detail="percent must be between 0 and 100")

    old_percent = user.personal_discount_percent

    log_entry = {
        "id": f"log-{int(datetime.now().timestamp())}",
        "date": datetime.now().isoformat(),
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


# ── Balance correction ──────────────────────────────────────────────────────
# Owner + Egor 2026-05-27: admins need a fast way to set User.balance to an
# exact value (e.g. matching the Excel reconciliation) without having to add
# a one-off cashbox transaction and remember to flip credit_user_balance.
# This endpoint takes the new absolute balance + a reason, and writes BOTH:
#   1. The User.balance field directly.
#   2. A CashboxTransaction(type="adjustment") capturing the delta + reason,
#      so the change is visible in audit history alongside regular payments.
@router.post("/{user_id}/balance-correction", response_model=UserRead)
def correct_user_balance(
    *,
    user_id: str,
    payload: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
) -> Any:
    user = _resolve_user(session, user_id)

    new_balance = payload.get("new_balance")
    reason = (payload.get("reason") or "").strip()

    if new_balance is None:
        raise HTTPException(status_code=400, detail="new_balance required")
    if not reason:
        raise HTTPException(status_code=400, detail="reason required")

    try:
        new_balance = float(new_balance)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="new_balance must be a number")

    old_balance = float(user.balance or 0)
    delta = round(new_balance - old_balance, 2)
    if abs(delta) < 0.01:
        raise HTTPException(status_code=400, detail="Новое значение совпадает с текущим балансом")

    user.balance = round(new_balance, 2)
    session.add(user)

    # Audit row in cashbox so the change shows up in finance history (positive
    # delta → income, negative → expense). adjustment is its own type so it
    # never gets re-categorised by future reports.
    from app.models.cashbox_transaction import CashboxTransaction
    tx = CashboxTransaction(
        type="income" if delta > 0 else "expense",
        amount=abs(delta),
        currency="GEL",
        payment_method="adjustment",
        description=f"Корректировка баланса {old_balance:.2f} → {new_balance:.2f}. {reason}",
        branch=None,
        date=datetime.now(),
        admin_id=str(current_user.id),
        admin_name=current_user.name or current_user.email or "admin",
        client_id=str(user.id),
        client_name=user.name,
        credited_user_id=str(user.id) if delta > 0 else None,
    )
    session.add(tx)
    session.commit()
    session.refresh(user)

    from app.services.timeline import timeline_service
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=str(user.id),
        target_type="user",
        event_type="balance_correction",
        description=f"Balance {old_balance:.2f} → {new_balance:.2f} (Δ {delta:+.2f}). {reason}",
        metadata={
            "old_balance": old_balance,
            "new_balance": new_balance,
            "delta": delta,
            "reason": reason,
        },
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
    user.updated_at = datetime.now()
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
    user.updated_at = datetime.now()
    session.add(user)

    comment_history = list(user.comment_history or [])
    comment_history.append({
        "date": datetime.now().isoformat(),
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
        "date": datetime.now().isoformat(),
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
    user.updated_at = datetime.now()
    session.add(user)

    # Auto-create cashbox income transaction
    if amount > 0:
        from app.models.cashbox_transaction import CashboxTransaction as CashboxTx
        # Map payment_method to cashbox account
        account_map = {"cash": "cash", "card": "card_tbc", "transfer": "card_bog"}
        cashbox_method = account or account_map.get(payment_method, "cash")
        branch = payload.get("branch", None)
        cashbox_tx = CashboxTx(
            type="income",
            amount=amount,
            currency="GEL",
            payment_method=cashbox_method,
            description=f"Абонемент: {user.name} +{hours}ч" + (f" ({note})" if note else ""),
            branch=branch,
            date=datetime.now(),
            admin_id=str(current_user.id),
            admin_name=current_user.name or "",
        )
        session.add(cashbox_tx)

    session.commit()
    session.refresh(user)
    return user


# ── Change email (senior_admin / owner only) ─────────────────────────────────
# Excel #47. Email is used as a soft foreign key in legacy tables
# (Booking.user_id, Waitlist.user_id, etc.). This endpoint atomically updates
# User.email plus every row that pins to the old email — so history and balance
# stay attached to the user after the change.

from pydantic import BaseModel as _Pyd


class _ChangeEmailRequest(_Pyd):
    new_email: str


@router.post("/{user_id}/change-email", response_model=UserRead)
def change_user_email(
    *,
    user_id: str,
    session: Session = Depends(get_session),
    payload: _ChangeEmailRequest,
    current_user: User = Depends(deps.require_admin),
) -> Any:
    # Only senior_admin / owner may rename emails — it's a rare privileged op.
    if current_user.role not in ("senior_admin", "owner"):
        raise HTTPException(
            status_code=403,
            detail="Только старший администратор или владелец может менять email пользователя",
        )

    user = _resolve_user(session, user_id)
    old_email = user.email
    new_email = (payload.new_email or "").strip().lower()

    if not new_email:
        raise HTTPException(400, "Новый email не может быть пустым")

    import re
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", new_email):
        raise HTTPException(400, "Email имеет некорректный формат")

    if new_email == (old_email or "").lower():
        raise HTTPException(400, "Новый email совпадает с текущим")

    existing = session.exec(select(User).where(User.email == new_email)).first()
    if existing and existing.id != user.id:
        raise HTTPException(409, f"Email {new_email} уже используется другим пользователем")

    # ── Cascade-update every table that stores this email as a soft FK ──
    from sqlalchemy import text
    updates: dict[str, int] = {}

    def _bulk(sql: str, label: str) -> None:
        res = session.execute(text(sql), {"old": old_email, "new": new_email})
        updates[label] = int(getattr(res, "rowcount", 0) or 0)

    # Bookings — owner reference via email
    _bulk('UPDATE booking SET user_id = :new WHERE user_id = :old', "booking.user_id")
    # Bookings — cancelled_by audit field
    _bulk('UPDATE booking SET cancelled_by = :new WHERE cancelled_by = :old', "booking.cancelled_by")
    # Waitlist — owner reference via email
    _bulk('UPDATE waitlist SET user_id = :new WHERE user_id = :old', "waitlist.user_id")
    # Cashbox — client_id may be stored as email for unregistered picks
    _bulk(
        'UPDATE cashbox_transactions SET client_id = :new WHERE client_id = :old',
        "cashbox_transactions.client_id",
    )
    # User self-refs. Postgres requires quoting the reserved word "user".
    user_table = '"user"' if session.bind.dialect.name == 'postgresql' else 'user'
    _bulk(
        f'UPDATE {user_table} SET responsible_admin_id = :new WHERE responsible_admin_id = :old',
        "user.responsible_admin_id",
    )
    _bulk(
        f'UPDATE {user_table} SET attracted_by_admin_id = :new WHERE attracted_by_admin_id = :old',
        "user.attracted_by_admin_id",
    )

    user.email = new_email
    user.updated_at = datetime.now()
    session.add(user)

    comment_history = (user.comment_history or []).copy()
    comment_history.append({
        "text": f"Email изменён: {old_email} → {new_email}",
        "author_id": str(current_user.id),
        "author_name": current_user.name or current_user.email,
        "created_at": datetime.now().isoformat(),
        "type": "email_change",
        "old_email": old_email,
        "new_email": new_email,
        "cascade": updates,
    })
    user.comment_history = comment_history

    session.commit()
    session.refresh(user)
    return user


# ── Merge two user accounts ──────────────────────────────────────────────────
# Closes a long-standing duplicate-account problem: the same human can end up
# with both a placeholder Telegram-Login user (`<chat_id>@telegram.unbox`) and
# a regular site account (`real@gmail.com`). Merging consolidates everything
# the user owns onto the keeper and deletes the duplicate.

class _MergeUsersRequest(_Pyd):
    """source: account to absorb (will be deleted).
       target: account to keep (gets all data)."""
    source: str  # email or UUID of the account being absorbed
    target: str  # email or UUID of the account being kept


@router.post("/merge", response_model=UserRead)
def merge_users(
    *,
    session: Session = Depends(get_session),
    payload: _MergeUsersRequest,
    current_user: User = Depends(deps.require_admin),
) -> Any:
    if current_user.role not in ("senior_admin", "owner"):
        raise HTTPException(403, "Только старший администратор или владелец")

    src = _resolve_user(session, payload.source)
    tgt = _resolve_user(session, payload.target)
    if src.id == tgt.id:
        raise HTTPException(400, "Нельзя слить аккаунт сам с собой")

    from sqlalchemy import text
    user_table = '"user"' if session.bind.dialect.name == 'postgresql' else 'user'

    moved: dict[str, int] = {}

    def _bulk(sql: str, label: str, params: dict) -> None:
        res = session.execute(text(sql), params)
        moved[label] = int(getattr(res, "rowcount", 0) or 0)

    # 1) Re-point all referencing rows from src → tgt.
    # Bookings (uuid + email)
    _bulk(
        'UPDATE booking SET user_uuid = :t WHERE user_uuid = :s',
        "booking.user_uuid", {"s": src.id, "t": tgt.id},
    )
    _bulk(
        'UPDATE booking SET user_id = :t_email WHERE user_id = :s_email',
        "booking.user_id", {"s_email": src.email, "t_email": tgt.email},
    )
    _bulk(
        'UPDATE booking SET cancelled_by = :t_email WHERE cancelled_by = :s_email',
        "booking.cancelled_by", {"s_email": src.email, "t_email": tgt.email},
    )
    # Waitlist
    _bulk(
        'UPDATE waitlist SET user_uuid = :t WHERE user_uuid = :s',
        "waitlist.user_uuid", {"s": src.id, "t": tgt.id},
    )
    _bulk(
        'UPDATE waitlist SET user_id = :t_email WHERE user_id = :s_email',
        "waitlist.user_id", {"s_email": src.email, "t_email": tgt.email},
    )
    # Cashbox: client_id (email or UUID) + credited_user_id (UUID)
    _bulk(
        'UPDATE cashbox_transactions SET client_id = :t_email WHERE client_id = :s_email',
        "cashbox_transactions.client_id(email)",
        {"s_email": src.email, "t_email": tgt.email},
    )
    _bulk(
        'UPDATE cashbox_transactions SET client_id = :t_uuid WHERE client_id = :s_uuid',
        "cashbox_transactions.client_id(uuid)",
        {"s_uuid": str(src.id), "t_uuid": str(tgt.id)},
    )
    _bulk(
        'UPDATE cashbox_transactions SET credited_user_id = :t WHERE credited_user_id = :s',
        "cashbox_transactions.credited_user_id",
        {"s": str(src.id), "t": str(tgt.id)},
    )
    # Notifications
    _bulk(
        'UPDATE notifications SET recipient_id = :t WHERE recipient_id = :s',
        "notifications.recipient_id", {"s": str(src.id), "t": str(tgt.id)},
    )
    # Psy-CRM data (therapist_* tables use specialist_id == user.id).
    # Without these, a merge leaves clients/sessions/payments/notes
    # orphaned under the absorbed UUID and they vanish from CRM. Was
    # exactly the trap that bit koren.nikolas when his Telegram got
    # mis-bound to a sibling account.
    _bulk(
        'UPDATE therapist_clients SET specialist_id = :t WHERE specialist_id = :s',
        "therapist_clients.specialist_id", {"s": str(src.id), "t": str(tgt.id)},
    )
    _bulk(
        'UPDATE therapy_sessions SET specialist_id = :t WHERE specialist_id = :s',
        "therapy_sessions.specialist_id", {"s": str(src.id), "t": str(tgt.id)},
    )
    _bulk(
        'UPDATE therapist_payments SET specialist_id = :t WHERE specialist_id = :s',
        "therapist_payments.specialist_id", {"s": str(src.id), "t": str(tgt.id)},
    )
    _bulk(
        'UPDATE therapist_notes SET specialist_id = :t WHERE specialist_id = :s',
        "therapist_notes.specialist_id", {"s": str(src.id), "t": str(tgt.id)},
    )
    # User self-refs (responsible / attracted admin links by email)
    _bulk(
        f'UPDATE {user_table} SET responsible_admin_id = :t_email WHERE responsible_admin_id = :s_email',
        "user.responsible_admin_id", {"s_email": src.email, "t_email": tgt.email},
    )
    _bulk(
        f'UPDATE {user_table} SET attracted_by_admin_id = :t_email WHERE attracted_by_admin_id = :s_email',
        "user.attracted_by_admin_id", {"s_email": src.email, "t_email": tgt.email},
    )

    # 2) Carry over scalar/JSON fields where the target is empty.
    if not tgt.telegram_id and src.telegram_id:
        tgt.telegram_id = src.telegram_id
    if not tgt.google_id and src.google_id:
        tgt.google_id = src.google_id
    if not tgt.phone and src.phone:
        tgt.phone = src.phone
    if not tgt.avatar_url and src.avatar_url:
        tgt.avatar_url = src.avatar_url
    if not tgt.name and src.name:
        tgt.name = src.name
    # Sum balances; src can be negative (debt) — we honour that.
    tgt.balance = float(tgt.balance or 0) + float(src.balance or 0)
    # Take the higher credit limit / personal discount
    tgt.credit_limit = max(float(tgt.credit_limit or 0), float(src.credit_limit or 0))
    tgt.personal_discount_percent = max(
        int(tgt.personal_discount_percent or 0),
        int(src.personal_discount_percent or 0),
    )
    # Subscription: keep target's, fall back to src's
    if not tgt.subscription and src.subscription:
        tgt.subscription = src.subscription
    # Append history lists
    if src.comment_history:
        tgt.comment_history = (tgt.comment_history or []) + list(src.comment_history)
    if src.admin_tasks:
        tgt.admin_tasks = (tgt.admin_tasks or []) + list(src.admin_tasks)
    if getattr(src, "discount_history", None):
        tgt.discount_history = (tgt.discount_history or []) + list(src.discount_history)
    # Tags union
    if src.tags:
        tgt.tags = sorted(set((tgt.tags or []) + list(src.tags)))

    # 3) Drop telegram_id from src first (avoids any unique-collision
    # downstream if we ever add a unique constraint).
    src.telegram_id = None
    src.email = f"merged-into-{tgt.id}-{src.id}@deleted.unbox"  # unique placeholder
    session.add(src)

    # 4) Audit on the keeper.
    audit = (tgt.comment_history or []).copy()
    audit.append({
        "text": f"Слияние аккаунта {src.email if not src.email.startswith('merged-into-') else '(deleted source)'} → {tgt.email}",
        "author_id": str(current_user.id),
        "author_name": current_user.name or current_user.email,
        "created_at": datetime.now().isoformat(),
        "type": "user_merge",
        "absorbed_id": str(src.id),
        "moved": moved,
    })
    tgt.comment_history = audit
    tgt.updated_at = datetime.now()
    session.add(tgt)
    session.flush()

    # 5) Delete the absorbed user.
    session.delete(src)
    session.commit()
    session.refresh(tgt)
    return tgt


# ── Restore orphaned Psy-CRM data ────────────────────────────────────────────
# When a user gets re-created (e.g. Telegram linked to the wrong sibling
# account, then corrected), their therapist_* rows keep the *old* user_id
# as specialist_id and fall out of reach — the CRM filters by the new
# user_id and finds nothing. `merge` can't rescue it because the source
# isn't a user anymore, it's a bare UUID in the CRM tables.
#
# This endpoint re-points all CRM rows from a raw specialist_id to the
# current user. Owner-only, reversible by calling it again with the
# arguments swapped.

class _RestoreCrmRequest(_Pyd):
    """source_specialist_id: the orphaned UUID (no matching user row).
       target_user_id: the live user whose CRM this data should appear in."""
    source_specialist_id: str
    target_user_id: str


@router.post("/restore-crm-data")
def restore_orphaned_crm(
    *,
    session: Session = Depends(get_session),
    payload: _RestoreCrmRequest,
    current_user: User = Depends(deps.require_admin),
) -> Any:
    if current_user.role not in ("owner", "senior_admin"):
        raise HTTPException(403, "Только старший администратор или владелец")

    # Validate UUIDs and target user
    try:
        src_id = str(UUID(payload.source_specialist_id))
        tgt_id = str(UUID(payload.target_user_id))
    except ValueError:
        raise HTTPException(400, "Некорректный UUID")

    if src_id == tgt_id:
        raise HTTPException(400, "source и target совпадают")

    tgt = session.get(User, UUID(tgt_id))
    if not tgt:
        raise HTTPException(404, f"Целевой пользователь не найден: {tgt_id}")

    from sqlalchemy import text
    moved: dict[str, int] = {}

    def _bulk(sql: str, label: str) -> None:
        res = session.execute(text(sql), {"s": src_id, "t": tgt_id})
        moved[label] = int(getattr(res, "rowcount", 0) or 0)

    _bulk(
        "UPDATE therapist_clients  SET specialist_id = :t WHERE specialist_id = :s",
        "therapist_clients",
    )
    _bulk(
        "UPDATE therapy_sessions   SET specialist_id = :t WHERE specialist_id = :s",
        "therapy_sessions",
    )
    _bulk(
        "UPDATE therapist_payments SET specialist_id = :t WHERE specialist_id = :s",
        "therapist_payments",
    )
    _bulk(
        "UPDATE therapist_notes    SET specialist_id = :t WHERE specialist_id = :s",
        "therapist_notes",
    )

    # Audit the operation on the recipient.
    audit = (tgt.comment_history or []).copy()
    audit.append({
        "text": f"Восстановление CRM: перенесены записи от specialist_id={src_id}",
        "author_id": str(current_user.id),
        "author_name": current_user.name or current_user.email,
        "created_at": datetime.now().isoformat(),
        "type": "crm_restore",
        "source_specialist_id": src_id,
        "moved": moved,
    })
    tgt.comment_history = audit
    tgt.updated_at = datetime.now()
    session.add(tgt)
    session.commit()

    return {
        "ok": True,
        "source_specialist_id": src_id,
        "target_user_id": tgt_id,
        "moved": moved,
    }
