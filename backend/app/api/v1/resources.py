from typing import List, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from sqlalchemy.orm.attributes import flag_modified
from app.db.session import get_session
from app.models.resource import Resource, ResourceCreate, ResourceRead, ResourceUpdate
from app.models.user import User
from app.api.deps import get_current_user, get_current_superuser

router = APIRouter()

ALLOWED_ROLES = ["owner", "senior_admin", "admin"]


@router.get("/", response_model=List[ResourceRead])
def read_resources(
    skip: int = 0,
    limit: int = 100,
    include_inactive: bool = Query(
        False,
        description="Admins pass true to see cabinets whose parent location is "
        "hidden (Location.is_active=False). Default filters them out so a "
        "deactivated branch hides its cabinets everywhere clients can reach.",
    ),
    session: Session = Depends(get_session)
):
    from app.models.location import Location
    stmt = select(Resource).order_by(Resource.sort_order, Resource.name)
    if not include_inactive:
        # Exclude cabinets whose location is inactive.
        inactive_ids = session.exec(
            select(Location.id).where(Location.is_active == False)  # noqa: E712
        ).all()
        if inactive_ids:
            stmt = stmt.where(Resource.location_id.notin_(inactive_ids))  # type: ignore
    resources = session.exec(stmt.offset(skip).limit(limit)).all()
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
    current_user: User = Depends(get_current_user)
) -> Any:
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

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
    current_user: User = Depends(get_current_user)
) -> Any:
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    db_resource = session.get(Resource, resource_id)
    if not db_resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    resource_data = resource_in.model_dump(exclude_unset=True)
    for key, value in resource_data.items():
        setattr(db_resource, key, value)

    # Force SQLAlchemy to detect JSON field changes
    if "photos" in resource_data:
        flag_modified(db_resource, "photos")
    if "services" in resource_data:
        flag_modified(db_resource, "services")
    if "formats" in resource_data:
        flag_modified(db_resource, "formats")

    session.add(db_resource)
    session.commit()
    session.refresh(db_resource)
    return db_resource
