from typing import Any
from fastapi import APIRouter, Depends
from app.models.user import User
from app.api import deps
from app.services.google_calendar import gcal_service

router = APIRouter()

@router.get("/integrations")
def check_integrations(
    # Unauthenticated info for status page
) -> Any:
    """
    Check status of system integrations.
    """
    return {
        "google_calendar": {
            "connected": gcal_service.is_connected(),
            "status": "active" if gcal_service.is_connected() else "missing_credentials"
        }
    }
