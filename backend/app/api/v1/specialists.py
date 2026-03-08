from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import List, Optional
from uuid import UUID

from app.db.session import get_session
from app.models.specialist import Specialist, SpecialistRead, SpecialistCreate

router = APIRouter()

@router.get("/", response_model=List[SpecialistRead])
def get_specialists(
    *,
    session: Session = Depends(get_session),
    format: Optional[str] = Query(None, description="Filter by format e.g., ONLINE"),
    specialization: Optional[str] = Query(None, description="Filter by specialization"),
    max_price: Optional[int] = Query(None, description="Maximum base price in GEL")
):
    """
    Get a list of verified specialists for the public directory.
    Supports basic filtering.
    """
    # Only return verified specialists for the public directory
    statement = select(Specialist).where(Specialist.is_verified == True)
    
    # Execute and filter in python for JSON array fields since SQLite JSON filtering can be tricky
    specialists = session.exec(statement).all()
    
    if format:
        specialists = [s for s in specialists if format in s.formats]
        
    if specialization:
        specialists = [s for s in specialists if specialization in s.specializations]
        
    if max_price is not None:
        specialists = [s for s in specialists if s.base_price_gel <= max_price]
        
    return specialists

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
