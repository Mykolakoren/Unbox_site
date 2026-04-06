from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel

from app.db.session import get_session
from app.models.specialist import Specialist, SpecialistRead, SpecialistCreate, SpecialistUpdate
from app.api.deps import require_admin, require_specialist
from app.models.user import User

router = APIRouter()

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
    # Only return verified specialists for the public directory, sorted by sort_order
    statement = select(Specialist).where(Specialist.is_verified == True).order_by(Specialist.sort_order)

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

    return specialists


@router.get("/admin/all", response_model=List[SpecialistRead])
def get_all_specialists_admin(
    *,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin)
):
    """Admin: get all specialists including unverified."""
    return session.exec(select(Specialist)).all()


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
    """Admin: bulk update sort_order for specialists."""
    for item in data.items:
        specialist = session.get(Specialist, item.id)
        if specialist:
            specialist.sort_order = item.sort_order
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
    # Prevent specialist from self-granting admin-only fields
    for restricted in ("user_id", "is_verified", "category", "sort_order"):
        update_data.pop(restricted, None)

    for key, value in update_data.items():
        setattr(specialist, key, value)

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
