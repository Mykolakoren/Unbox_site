from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.db.session import get_session
from app.models.location import Location, LocationRead, LocationCreate, LocationUpdate
from app.models.user import User
from app.api.deps import get_current_superuser

router = APIRouter()

@router.get("/", response_model=List[LocationRead])
def read_locations(
    skip: int = 0,
    limit: int = 100,
    session: Session = Depends(get_session)
):
    locations = session.exec(select(Location).offset(skip).limit(limit)).all()
    return locations

@router.get("/{location_id}", response_model=LocationRead)
def read_location(
    location_id: str,
    session: Session = Depends(get_session)
):
    location = session.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return location

@router.post("/", response_model=LocationRead)
def create_location(
    *,
    session: Session = Depends(get_session),
    location: LocationCreate,
    current_user: User = Depends(get_current_superuser)
):
    db_location = session.get(Location, location.id)
    if db_location:
        raise HTTPException(status_code=400, detail="Location with this ID already exists")
    
    db_obj = Location.model_validate(location)
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj

@router.put("/{location_id}", response_model=LocationRead)
def update_location(
    *,
    session: Session = Depends(get_session),
    location_id: str,
    location_in: LocationUpdate,
    current_user: User = Depends(get_current_superuser)
):
    db_location = session.get(Location, location_id)
    if not db_location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    location_data = location_in.model_dump(exclude_unset=True)
    db_location.sqlmodel_update(location_data)
    
    session.add(db_location)
    session.commit()
    session.refresh(db_location)
    return db_location
