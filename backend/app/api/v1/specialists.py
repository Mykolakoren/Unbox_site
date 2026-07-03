from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field as PField

from app.db.session import get_session
from app.models.specialist import Specialist, SpecialistRead, SpecialistCreate, SpecialistUpdate
from app.api.deps import require_admin, require_specialist, get_current_user
from app.models.user import User
from app.services.telegram import telegram_service

router = APIRouter()


def _order_specialists(session: Session, specialists: list) -> List[SpecialistRead]:
    """Catalogue ordering rule (2026-05-22):
      1. Owner's card always first.
      2. Then complete cards (photo + bio filled) by sort_order.
      3. Then incomplete cards (no photo OR empty bio) by sort_order — they
         sink to the bottom of the list.
    Returns SpecialistRead objects with `is_owner` populated.
    """
    owner_ids = {
        str(u.id) for u in session.exec(
            select(User).where(User.role == "owner")
        ).all()
    }

    def is_owner(s) -> bool:
        return bool(s.user_id) and str(s.user_id) in owner_ids

    def is_complete(s) -> bool:
        return bool((s.photo_url or "").strip()) and bool((s.bio or "").strip())

    ordered = sorted(specialists, key=lambda s: (
        0 if is_owner(s) else 1,
        0 if is_complete(s) else 1,
        s.sort_order or 0,
    ))
    out: List[SpecialistRead] = []
    for s in ordered:
        r = SpecialistRead.model_validate(s, from_attributes=True)
        r.is_owner = is_owner(s)
        out.append(r)
    return out


@router.get("/", response_model=List[SpecialistRead])
def get_specialists(
    *,
    session: Session = Depends(get_session),
    format: Optional[str] = Query(None, description="Filter by format e.g., ONLINE"),
    specialization: Optional[str] = Query(None, description="Filter by specialization"),
    max_price: Optional[int] = Query(None, description="Maximum base price in GEL"),
    category: Optional[str] = Query(None, description="Filter by category e.g., psychology")
):
    """
    Get a list of verified specialists for the public directory.
    Supports basic filtering.
    """
    # Only return verified AND publicly listed specialists for the public
    # directory, sorted by sort_order. `is_public=False` covers the case
    # where someone is fully verified and active in CRM but should not
    # appear in the public catalog (owner's partner/co-founder, etc).
    statement = (
        select(Specialist)
        .where(Specialist.is_verified == True)
        .where(Specialist.is_public == True)
        .order_by(Specialist.sort_order)
    )

    # Execute and filter in python for JSON array fields since SQLite JSON filtering can be tricky
    specialists = session.exec(statement).all()

    if format:
        specialists = [s for s in specialists if format in s.formats]

    if specialization:
        specialists = [s for s in specialists if specialization in s.specializations]

    if max_price is not None:
        specialists = [s for s in specialists if s.base_price_gel <= max_price]

    if category:
        specialists = [s for s in specialists if s.category == category]

    return _order_specialists(session, specialists)


@router.get("/admin/all", response_model=List[SpecialistRead])
def get_all_specialists_admin(
    *,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """Admin: get all specialists including unverified."""
    return _order_specialists(session, list(session.exec(select(Specialist)).all()))


# Фиксированный набор плашек-маркеров (ставит только админ).
ALLOWED_BADGES = {"in_training", "recommended"}


@router.patch("/admin/{specialist_id}", response_model=SpecialistRead)
def update_specialist_admin(
    *,
    specialist_id: UUID,
    specialist_in: SpecialistUpdate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """Admin: update specialist fields including category and is_verified."""
    specialist = session.get(Specialist, specialist_id)
    if not specialist:
        raise HTTPException(status_code=404, detail="Specialist not found")

    update_data = specialist_in.model_dump(exclude_unset=True)

    # Плашки — только из фиксированного набора (защита от произвольных кодов).
    if "badges" in update_data and update_data["badges"] is not None:
        update_data["badges"] = [b for b in update_data["badges"] if b in ALLOWED_BADGES]

    # If user_id is being changed, unlink it from any other specialist first
    # (user_id has a UNIQUE constraint, so we must clear the old link before assigning)
    if "user_id" in update_data and update_data["user_id"] is not None:
        new_user_id = update_data["user_id"]
        existing = session.exec(
            select(Specialist).where(
                Specialist.user_id == new_user_id,
                Specialist.id != specialist_id
            )
        ).first()
        if existing:
            existing.user_id = None  # type: ignore
            session.add(existing)

    for key, value in update_data.items():
        setattr(specialist, key, value)

    session.add(specialist)
    session.commit()
    session.refresh(specialist)
    return specialist


class ReorderItem(BaseModel):
    id: UUID
    sort_order: int

class ReorderRequest(BaseModel):
    items: List[ReorderItem]

@router.post("/admin/reorder")
def reorder_specialists(
    *,
    data: ReorderRequest,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """Admin: bulk update sort_order for specialists.

    The owner's card is pinned — its sort_order is forced to 0 and never
    accepts a value from the client, so admins can shuffle everyone else
    without ever pushing the owner off the top.
    """
    owner_ids = {
        str(u.id) for u in session.exec(
            select(User).where(User.role == "owner")
        ).all()
    }
    for item in data.items:
        specialist = session.get(Specialist, item.id)
        if not specialist:
            continue
        if specialist.user_id and str(specialist.user_id) in owner_ids:
            specialist.sort_order = 0  # pinned — ignore client value
        else:
            # Keep everyone else strictly below the owner.
            specialist.sort_order = max(1, item.sort_order)
        session.add(specialist)
    session.commit()
    return {"ok": True}


@router.delete("/admin/{specialist_id}")
def delete_specialist(
    *,
    specialist_id: UUID,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """Admin: permanently delete a specialist profile."""
    specialist = session.get(Specialist, specialist_id)
    if not specialist:
        raise HTTPException(status_code=404, detail="Specialist not found")

    session.delete(specialist)
    session.commit()
    return {"ok": True, "id": str(specialist_id)}


@router.get("/me", response_model=SpecialistRead)
def get_my_specialist_profile(
    *,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_specialist)
):
    """Specialist: get own profile."""
    specialist = session.exec(
        select(Specialist).where(Specialist.user_id == current_user.id)
    ).first()
    if not specialist:
        raise HTTPException(status_code=404, detail="Specialist profile not found")
    return specialist


@router.patch("/me", response_model=SpecialistRead)
def update_my_specialist_profile(
    *,
    specialist_in: SpecialistUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_specialist)
):
    """Specialist: update own profile. Admin-only fields (user_id, is_verified, category, sort_order) are ignored."""
    specialist = session.exec(
        select(Specialist).where(Specialist.user_id == current_user.id)
    ).first()
    if not specialist:
        raise HTTPException(status_code=404, detail="Specialist profile not found")

    update_data = specialist_in.model_dump(exclude_unset=True)
    # Prevent specialist from self-granting admin-only fields.
    # badges — только админ (нельзя самому поставить «Рекомендованный»).
    for restricted in ("user_id", "is_verified", "category", "sort_order", "badges"):
        update_data.pop(restricted, None)

    for key, value in update_data.items():
        setattr(specialist, key, value)

    session.add(specialist)
    session.commit()
    session.refresh(specialist)
    return specialist


# ─── Self-service application flow ──────────────────────────────────────────
# Anyone with a logged-in account can submit a specialist application. It's
# stored as an unverified Specialist row tagged application_status="pending".
# Admins approve via /admin/{id}/approve, which flips is_verified=True and
# the row appears in the public catalog. Rejection just marks the status —
# we don't delete so admins can review history.

class SpecialistApplyPayload(BaseModel):
    first_name: str = PField(min_length=1, max_length=100)
    last_name: str = PField(min_length=1, max_length=100)
    photo_url: Optional[str] = None
    tagline: str = PField(default="", max_length=150)
    bio: str = PField(default="", max_length=5000)
    specializations: List[str] = PField(default_factory=list)
    formats: List[str] = PField(default_factory=list)
    base_price_gel: int = PField(default=0, ge=0)
    category: Optional[str] = None
    # Дипломы/сертификаты — обязательны при подаче (валидация во фронте;
    # на бэке страхуемся минимум одним документом).
    documents: List[str] = PField(default_factory=list)


@router.post("/apply", response_model=SpecialistRead)
def apply_as_specialist(
    *,
    payload: SpecialistApplyPayload,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Submit a specialist-catalog application. Re-submitting overwrites the
    user's existing draft as long as it's not already approved (is_verified)."""
    # Документы обязательны при подаче (owner 2026-07-03).
    if not payload.documents:
        raise HTTPException(
            status_code=400,
            detail="Загрузите хотя бы один документ (диплом/сертификат).",
        )

    existing = session.exec(
        select(Specialist).where(Specialist.user_id == current_user.id)
    ).first()

    if existing and existing.is_verified:
        raise HTTPException(
            status_code=409,
            detail="Профиль уже верифицирован — изменения вносите через /me.",
        )

    if existing:
        # Resubmit: update fields, reset status to pending, keep id stable
        for field, value in payload.model_dump().items():
            setattr(existing, field, value)
        existing.application_status = "pending"
        session.add(existing)
        session.commit()
        session.refresh(existing)
        specialist = existing
    else:
        specialist = Specialist(
            **payload.model_dump(),
            user_id=current_user.id,
            is_verified=False,
            application_status="pending",
        )
        session.add(specialist)
        session.commit()
        session.refresh(specialist)

    # Fire-and-forget admin notification — failures here mustn't break the
    # submission (TG could be rate-limited, network blip, etc.).
    try:
        telegram_service.send_admin_event(
            event="specialist_application",
            fields={
                "Имя": f"{specialist.first_name} {specialist.last_name}".strip(),
                "Email": current_user.email or "—",
                "Категория": specialist.category or "—",
                "Форматы": ", ".join(specialist.formats) if specialist.formats else "—",
                "Цена/час": f"{specialist.base_price_gel} GEL" if specialist.base_price_gel else "—",
            },
        )
    except Exception:
        pass

    return specialist


@router.post("/admin/{specialist_id}/approve", response_model=SpecialistRead)
def approve_specialist_application(
    *,
    specialist_id: UUID,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Admin: approve a pending application — flip is_verified=True so the
    profile shows up publicly. Status moves to "approved" for audit; future
    edits don't touch this field unless the admin re-rejects."""
    specialist = session.get(Specialist, specialist_id)
    if not specialist:
        raise HTTPException(status_code=404, detail="Specialist not found")
    specialist.is_verified = True
    specialist.application_status = "approved"
    session.add(specialist)
    session.commit()
    session.refresh(specialist)
    return specialist


@router.post("/admin/{specialist_id}/reject", response_model=SpecialistRead)
def reject_specialist_application(
    *,
    specialist_id: UUID,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Admin: reject application. We keep the row (is_verified stays False,
    status="rejected") so the user sees the decision in their profile and
    can resubmit if asked to revise — no silent deletion."""
    specialist = session.get(Specialist, specialist_id)
    if not specialist:
        raise HTTPException(status_code=404, detail="Specialist not found")
    specialist.is_verified = False
    specialist.application_status = "rejected"
    session.add(specialist)
    session.commit()
    session.refresh(specialist)
    return specialist


@router.get("/{specialist_id}", response_model=SpecialistRead)
def get_specialist(
    *,
    specialist_id: UUID,
    session: Session = Depends(get_session)
):
    """
    Get detailed profile of a specific specialist.
    """
    specialist = session.get(Specialist, specialist_id)
    if not specialist or not specialist.is_verified:
        raise HTTPException(status_code=404, detail="Specialist not found")

    return specialist
