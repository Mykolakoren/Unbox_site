"""Bonuses — grant free hours to users (individual or bulk)."""
from typing import List, Optional
from datetime import datetime, timedelta
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from pydantic import BaseModel
from sqlmodel import Session, select
from app.api import deps
from app.db.session import get_session
from app.models.user import User
from app.models.bonus import Bonus, BonusRead

router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class BonusCreateRequest(BaseModel):
    user_id: str
    type: str = "free_hour"
    description: str = ""
    quantity: float = 1.0
    expires_days: Optional[int] = 90  # days until expiry


class BulkBonusCreateRequest(BaseModel):
    type: str = "free_hour"
    description: str = ""
    quantity: float = 1.0
    expires_days: Optional[int] = 90
    target: str = "all_active"  # all_active | with_subscription | custom
    user_ids: Optional[List[str]] = None  # for target=custom


# ── My bonuses (user-facing) ─────────────────────────────────────────────────

@router.get("/my", response_model=List[BonusRead])
def get_my_bonuses(
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
):
    """Get current user's active/pending bonuses."""
    uid = str(current_user.id)
    bonuses = session.exec(
        select(Bonus)
        .where(Bonus.user_id == uid, Bonus.status.in_(["active", "pending", "approved"]))
        .order_by(Bonus.created_at.desc())
    ).all()
    return bonuses


# ── List all bonuses (admin) ─────────────────────────────────────────────────

@router.get("/", response_model=List[BonusRead])
def list_bonuses(
    status: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """List bonuses (admin only)."""
    stmt = select(Bonus).order_by(Bonus.created_at.desc())
    if status:
        stmt = stmt.where(Bonus.status == status)
    if user_id:
        stmt = stmt.where(Bonus.user_id == user_id)
    return session.exec(stmt.limit(200)).all()


# ── Create individual bonus ──────────────────────────────────────────────────

@router.post("/", response_model=BonusRead)
def create_bonus(
    data: BonusCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """
    Create a bonus for a user.
    - owner/senior_admin: auto-approved (status=active)
    - admin with bonuses.grant permission: status=pending (needs approval)
    """
    # Verify target user exists
    from uuid import UUID as UUIDType
    try:
        target = session.get(User, UUIDType(data.user_id))
    except ValueError:
        target = None
    if not target:
        raise HTTPException(404, "User not found")

    # Permission check
    can_grant = deps.has_permission(current_user, "bonuses.grant")
    is_senior_or_owner = current_user.role in ("owner", "senior_admin")

    if not is_senior_or_owner and not can_grant:
        raise HTTPException(403, "No permission to grant bonuses")

    # Auto-approve for senior/owner
    status = "active" if is_senior_or_owner else "pending"

    expires_at = None
    if data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_days)

    bonus = Bonus(
        user_id=data.user_id,
        type=data.type,
        description=data.description,
        quantity=data.quantity,
        status=status,
        granted_by_id=str(current_user.id),
        granted_by_name=current_user.name or "",
        approved_by_id=str(current_user.id) if is_senior_or_owner else None,
        approved_by_name=current_user.name if is_senior_or_owner else None,
        expires_at=expires_at,
    )
    session.add(bonus)
    session.commit()
    session.refresh(bonus)

    # Audit log
    from app.services.timeline import timeline_service
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=data.user_id,
        target_type="user",
        event_type="bonus_granted",
        description=f"Бонус: {data.description or data.type} ({data.quantity}ч) — {'активен' if status == 'active' else 'ожидает одобрения'}",
        metadata={"bonus_id": str(bonus.id), "quantity": data.quantity, "type": data.type, "status": status},
    )

    return bonus


# ── Bulk bonus ───────────────────────────────────────────────────────────────

@router.post("/bulk")
def create_bulk_bonus(
    data: BulkBonusCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """
    Create bonuses for multiple users at once.
    Only owner/senior_admin can do bulk bonuses.
    """
    if current_user.role not in ("owner", "senior_admin"):
        raise HTTPException(403, "Only owner or senior admin can create bulk bonuses")

    # Determine target users
    if data.target == "custom" and data.user_ids:
        from uuid import UUID as UUIDType
        users = []
        for uid in data.user_ids:
            try:
                u = session.get(User, UUIDType(uid))
                if u:
                    users.append(u)
            except ValueError:
                pass
    else:
        # all_active — users with role=user or specialist who have recent activity
        stmt = select(User).where(User.role.in_(["user", "specialist"]))
        users = session.exec(stmt).all()

    if not users:
        raise HTTPException(400, "No target users found")

    bulk_id = str(uuid4())
    expires_at = None
    if data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_days)

    created = 0
    for user in users:
        bonus = Bonus(
            user_id=str(user.id),
            type=data.type,
            description=data.description,
            quantity=data.quantity,
            status="active",
            granted_by_id=str(current_user.id),
            granted_by_name=current_user.name or "",
            approved_by_id=str(current_user.id),
            approved_by_name=current_user.name or "",
            expires_at=expires_at,
            is_bulk=True,
            bulk_id=bulk_id,
        )
        session.add(bonus)
        created += 1

    session.commit()

    # Audit log
    from app.services.timeline import timeline_service
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id="bulk",
        target_type="bonus",
        event_type="bulk_bonus_granted",
        description=f"Массовый бонус: {data.description or data.type} ({data.quantity}ч) для {created} пользователей",
        metadata={"bulk_id": bulk_id, "quantity": data.quantity, "count": created},
    )

    return {"ok": True, "created": created, "bulk_id": bulk_id}


# ── Approve / Reject ─────────────────────────────────────────────────────────

@router.post("/{bonus_id}/approve", response_model=BonusRead)
def approve_bonus(
    bonus_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Approve a pending bonus. Only owner/senior_admin."""
    if current_user.role not in ("owner", "senior_admin"):
        raise HTTPException(403, "Only owner or senior admin can approve bonuses")

    from uuid import UUID as UUIDType
    bonus = session.get(Bonus, UUIDType(bonus_id))
    if not bonus:
        raise HTTPException(404, "Bonus not found")
    if bonus.status != "pending":
        raise HTTPException(400, f"Cannot approve bonus with status '{bonus.status}'")

    bonus.status = "active"
    bonus.approved_by_id = str(current_user.id)
    bonus.approved_by_name = current_user.name or ""
    bonus.updated_at = datetime.utcnow()
    session.add(bonus)
    session.commit()
    session.refresh(bonus)

    # Audit
    from app.services.timeline import timeline_service
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=bonus.user_id,
        target_type="user",
        event_type="bonus_approved",
        description=f"Бонус одобрен: {bonus.description or bonus.type} ({bonus.quantity}ч)",
        metadata={"bonus_id": str(bonus.id)},
    )

    return bonus


@router.post("/{bonus_id}/reject", response_model=BonusRead)
def reject_bonus(
    bonus_id: str,
    payload: dict = Body(default={}),
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Reject a pending bonus. Only owner/senior_admin."""
    if current_user.role not in ("owner", "senior_admin"):
        raise HTTPException(403, "Only owner or senior admin can reject bonuses")

    from uuid import UUID as UUIDType
    bonus = session.get(Bonus, UUIDType(bonus_id))
    if not bonus:
        raise HTTPException(404, "Bonus not found")
    if bonus.status != "pending":
        raise HTTPException(400, f"Cannot reject bonus with status '{bonus.status}'")

    bonus.status = "rejected"
    bonus.reject_reason = payload.get("reason", "")
    bonus.approved_by_id = str(current_user.id)
    bonus.approved_by_name = current_user.name or ""
    bonus.updated_at = datetime.utcnow()
    session.add(bonus)
    session.commit()
    session.refresh(bonus)

    # Audit
    from app.services.timeline import timeline_service
    timeline_service.log_event(
        session=session,
        actor_id=current_user.id,
        actor_role=current_user.role,
        target_id=bonus.user_id,
        target_type="user",
        event_type="bonus_rejected",
        description=f"Бонус отклонён: {bonus.description or bonus.type} ({bonus.quantity}ч)",
        metadata={"bonus_id": str(bonus.id), "reason": payload.get("reason", "")},
    )

    return bonus


# ── Use bonus ────────────────────────────────────────────────────────────────

@router.post("/{bonus_id}/use", response_model=BonusRead)
def use_bonus(
    bonus_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Mark bonus as used (admin action, e.g. when applying to a booking)."""
    from uuid import UUID as UUIDType
    bonus = session.get(Bonus, UUIDType(bonus_id))
    if not bonus:
        raise HTTPException(404, "Bonus not found")
    if bonus.status != "active":
        raise HTTPException(400, f"Cannot use bonus with status '{bonus.status}'")

    # Check expiry
    if bonus.expires_at and bonus.expires_at < datetime.utcnow():
        bonus.status = "expired"
        bonus.updated_at = datetime.utcnow()
        session.add(bonus)
        session.commit()
        raise HTTPException(400, "Bonus has expired")

    bonus.status = "used"
    bonus.used_at = datetime.utcnow()
    bonus.updated_at = datetime.utcnow()
    session.add(bonus)
    session.commit()
    session.refresh(bonus)

    return bonus


# ── Pending count (for admin badge) ──────────────────────────────────────────

@router.get("/pending-count")
def pending_bonus_count(
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Get count of pending bonuses awaiting approval."""
    from sqlmodel import func
    count = session.exec(
        select(func.count(Bonus.id)).where(Bonus.status == "pending")  # type: ignore
    ).one()
    return {"count": count}
