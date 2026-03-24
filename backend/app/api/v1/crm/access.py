"""CRM Access — application, approval/rejection of psy_crm.access."""
from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlmodel import Session, select
from app.api import deps
from app.models.user import User

router = APIRouter()


@router.post("/apply")
def apply_for_crm_access(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_active_user),
    profession: Optional[str] = Body(None, embed=True),
    message: Optional[str] = Body(None, embed=True),
):
    """Any authenticated user can apply for psy_crm.access.
    Owner and senior_admin get auto-approved. Blocks duplicate pending requests."""
    now = datetime.now()
    crm_data = dict(current_user.crm_data or {})
    current_status = crm_data.get("access_status", "none")

    # Auto-approve for owner and senior_admin
    if current_user.role in ("owner", "senior_admin"):
        crm_data["access_status"] = "active"
        crm_data["access_expires_at"] = (now + timedelta(days=365 * 10)).isoformat()
        crm_data["access_granted_by"] = "auto"
        crm_data["access_granted_at"] = now.isoformat()
        perms = list(current_user.permissions or [])
        if "psy_crm.access" not in perms:
            perms.append("psy_crm.access")
            current_user.permissions = perms
        current_user.crm_data = crm_data
        current_user.updated_at = now
        session.add(current_user)
        session.commit()
        return {"ok": True, "status": "active"}

    if current_status == "pending":
        raise HTTPException(400, "Запрос уже на рассмотрении")

    crm_data["access_status"] = "pending"
    crm_data["access_application"] = {
        "profession": profession or "",
        "message": message or "",
        "submitted_at": now.isoformat(),
    }
    current_user.crm_data = crm_data

    # Record request in comment_history for timeline
    comment_history = list(current_user.comment_history or [])
    req_text = f"Подана заявка на CRM"
    if profession:
        req_text += f" (специализация: {profession})"
    if message:
        req_text += f" — {message}"
    comment_history.append({
        "id": f"crm-request-{now.timestamp()}",
        "date": now.isoformat(),
        "adminName": current_user.name,
        "text": req_text,
        "type": "crm_access_requested",
        "meta": {
            "profession": profession or "",
            "message": message or "",
        },
    })
    current_user.comment_history = comment_history

    current_user.updated_at = now
    session.add(current_user)
    session.commit()

    # Notify admins with accept_requests permission
    from app.services.notification_service import notification_service
    notification_service.notify_by_permission(
        session, "admin.accept_requests",
        type="crm_access_request",
        title="Новый запрос на CRM",
        description=f"{current_user.name} подал(а) запрос на доступ к CRM",
        icon="UserPlus",
        link="/admin/specialists?tab=crm-requests",
    )
    session.commit()

    return {"ok": True, "status": "pending"}


@router.get("/my-access")
def get_my_crm_access(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.get_current_active_user),
):
    """Returns the current user's CRM access status, checking expiry."""
    if current_user.role in ("specialist", "owner", "senior_admin"):
        return {
            "access_status": "active",
            "permanent": True,
            "expires_at": None,
            "days_remaining": None,
        }

    crm_data = dict(current_user.crm_data or {})
    access_status = crm_data.get("access_status", "none")

    if access_status == "active":
        expires_at = crm_data.get("access_expires_at")
        if expires_at:
            try:
                expiry_dt = datetime.fromisoformat(expires_at)
                if datetime.now() > expiry_dt:
                    crm_data["access_status"] = "expired"
                    current_user.crm_data = crm_data
                    current_user.updated_at = datetime.now()
                    perms = list(current_user.permissions or [])
                    if "psy_crm.access" in perms:
                        perms.remove("psy_crm.access")
                        current_user.permissions = perms
                    session.add(current_user)
                    session.commit()
                    return {
                        "access_status": "expired",
                        "permanent": False,
                        "expires_at": expires_at,
                        "days_remaining": 0,
                    }
                days_remaining = (expiry_dt - datetime.now()).days
                return {
                    "access_status": "active",
                    "permanent": False,
                    "expires_at": expires_at,
                    "days_remaining": max(0, days_remaining),
                }
            except (ValueError, TypeError):
                pass

    return {
        "access_status": access_status,
        "permanent": False,
        "expires_at": crm_data.get("access_expires_at"),
        "days_remaining": None,
    }


@router.get("/access-status/{user_id}")
def get_user_crm_access(
    user_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Admin: get CRM access status for a specific user."""
    from uuid import UUID as _UUID
    try:
        target_user = session.get(User, _UUID(user_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "User not found")
    if not target_user:
        raise HTTPException(404, "User not found")

    if target_user.role in ("specialist", "owner", "senior_admin"):
        app_data = (target_user.crm_data or {}).get("access_application", {})
        return {
            "access_status": "active",
            "permanent": True,
            "expires_at": None,
            "days_remaining": None,
            "profession": app_data.get("profession", ""),
        }

    crm_data = dict(target_user.crm_data or {})
    access_status = crm_data.get("access_status", "none")
    app_data = crm_data.get("access_application", {})

    expires_at = crm_data.get("access_expires_at")
    days_remaining = None

    if access_status == "active" and expires_at:
        try:
            expiry_dt = datetime.fromisoformat(expires_at)
            if datetime.now() > expiry_dt:
                access_status = "expired"
                crm_data["access_status"] = "expired"
                target_user.crm_data = crm_data
                perms = list(target_user.permissions or [])
                if "psy_crm.access" in perms:
                    perms.remove("psy_crm.access")
                    target_user.permissions = perms
                session.add(target_user)
                session.commit()
                days_remaining = 0
            else:
                days_remaining = max(0, (expiry_dt - datetime.now()).days)
        except (ValueError, TypeError):
            pass

    return {
        "access_status": access_status,
        "permanent": False,
        "expires_at": expires_at,
        "days_remaining": days_remaining,
        "profession": app_data.get("profession", ""),
        "message": app_data.get("message"),
        "submitted_at": app_data.get("submitted_at"),
    }


@router.get("/access-requests")
def list_crm_access_requests(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Admin: list all users with pending CRM access requests."""
    if not deps.has_permission(current_user, "admin.accept_requests"):
        raise HTTPException(403, "Недостаточно прав для просмотра запросов")

    all_users = session.exec(select(User)).all()
    pending = []
    for user in all_users:
        crm_data = user.crm_data or {}
        if crm_data.get("access_status") == "pending":
            app_data = crm_data.get("access_application", {})
            pending.append({
                "user_id": str(user.id),
                "name": user.name,
                "email": user.email,
                "phone": user.phone,
                "profession": app_data.get("profession", ""),
                "message": app_data.get("message", ""),
                "submitted_at": app_data.get("submitted_at", ""),
                "avatar_url": user.avatar_url,
            })

    pending.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)
    return pending


@router.post("/access-requests/{user_id}/approve")
def approve_crm_access(
    user_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
    days: int = Body(30, embed=True),
):
    """Admin: approve CRM access for a user (30-day default)."""
    if not deps.has_permission(current_user, "admin.accept_requests"):
        raise HTTPException(403, "Недостаточно прав для одобрения запросов")

    from uuid import UUID as _UUID
    try:
        target_user = session.get(User, _UUID(user_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "User not found")
    if not target_user:
        raise HTTPException(404, "User not found")

    now = datetime.now()
    expires_at = now + timedelta(days=days)

    crm_data = dict(target_user.crm_data or {})
    crm_data["access_status"] = "active"
    crm_data["access_expires_at"] = expires_at.isoformat()
    crm_data["access_granted_by"] = str(current_user.id)
    crm_data["access_granted_at"] = now.isoformat()
    target_user.crm_data = crm_data

    perms = list(target_user.permissions or [])
    if "psy_crm.access" not in perms:
        perms.append("psy_crm.access")
        target_user.permissions = perms

    # Record in comment_history
    comment_history = list(target_user.comment_history or [])
    comment_history.append({
        "id": f"crm-approve-{now.timestamp()}",
        "date": now.isoformat(),
        "adminName": current_user.name,
        "text": f"CRM доступ одобрен на {days} дн. (до {expires_at.strftime('%d.%m.%Y')})",
        "type": "crm_access_approved",
        "meta": {
            "days": days,
            "expires_at": expires_at.isoformat(),
            "admin_id": str(current_user.id),
        },
    })
    target_user.comment_history = comment_history

    target_user.updated_at = now
    session.add(target_user)
    session.commit()

    return {"ok": True, "access_status": "active", "expires_at": expires_at.isoformat(), "days": days}


@router.post("/access-requests/{user_id}/reject")
def reject_crm_access(
    user_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_admin),
    reason: Optional[str] = Body(None, embed=True),
):
    """Admin: reject CRM access request."""
    if not deps.has_permission(current_user, "admin.accept_requests"):
        raise HTTPException(403, "Недостаточно прав для отклонения запросов")

    from uuid import UUID as _UUID
    try:
        target_user = session.get(User, _UUID(user_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "User not found")
    if not target_user:
        raise HTTPException(404, "User not found")

    crm_data = dict(target_user.crm_data or {})
    crm_data["access_status"] = "rejected"
    crm_data["rejected_by"] = str(current_user.id)
    crm_data["rejected_at"] = datetime.now().isoformat()
    if reason:
        crm_data["rejection_reason"] = reason

    target_user.crm_data = crm_data

    # Record in comment_history
    now = datetime.now()
    comment_history = list(target_user.comment_history or [])
    reject_text = f"CRM запрос отклонён"
    if reason:
        reject_text += f": {reason}"
    comment_history.append({
        "id": f"crm-reject-{now.timestamp()}",
        "date": now.isoformat(),
        "adminName": current_user.name,
        "text": reject_text,
        "type": "crm_access_rejected",
        "meta": {
            "admin_id": str(current_user.id),
            "reason": reason,
        },
    })
    target_user.comment_history = comment_history

    target_user.updated_at = now
    session.add(target_user)
    session.commit()

    return {"ok": True, "access_status": "rejected"}
