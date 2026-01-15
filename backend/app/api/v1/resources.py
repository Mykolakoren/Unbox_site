from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.db.session import get_session
from app.models.resource import Resource, ResourceCreate, ResourceRead, ResourceUpdate
from app.models.user import User
from app.api.deps import get_current_user, get_current_active_user, get_current_superuser

router = APIRouter()

@router.get("/", response_model=List[ResourceRead])
def read_resources(
    skip: int = 0,
    limit: int = 100,
    session: Session = Depends(get_session)
):
    resources = session.exec(select(Resource).offset(skip).limit(limit)).all()
    return resources

@router.get("/{resource_id}", response_model=ResourceRead)
def read_resource(
    resource_id: str,
    session: Session = Depends(get_session)
):
    resource = session.get(Resource, resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    return resource

@router.post("/", response_model=ResourceRead)
def create_resource(
    *,
    session: Session = Depends(get_session),
    resource: ResourceCreate,
    current_user: User = Depends(get_current_superuser)
):
    db_resource = session.get(Resource, resource.id)
    if db_resource:
        raise HTTPException(status_code=400, detail="Resource with this ID already exists")
    
    db_obj = Resource.model_validate(resource)
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj

@router.put("/{resource_id}", response_model=ResourceRead)
def update_resource(
    *,
    session: Session = Depends(get_session),
    resource_id: str,
    resource_in: ResourceUpdate,
    current_user: User = Depends(get_current_superuser)
):
    db_resource = session.get(Resource, resource_id)
    if not db_resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    
    resource_data = resource_in.model_dump(exclude_unset=True)
    db_resource.sqlmodel_update(resource_data)
    
    session.add(db_resource)
    session.commit()
    session.refresh(db_resource)
    return db_resource
