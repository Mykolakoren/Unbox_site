from fastapi import APIRouter
from app.api.v1 import bookings, users, auth, waitlist, health, timeline, resources, upload, pricing, locations, specialists, crm

api_router = APIRouter()
api_router.include_router(bookings.router, prefix="/bookings", tags=["bookings"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(waitlist.router, prefix="/waitlist", tags=["waitlist"])
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(timeline.router, prefix="/timeline", tags=["timeline"])
api_router.include_router(resources.router, prefix="/resources", tags=["resources"])
api_router.include_router(locations.router, prefix="/locations", tags=["locations"])
api_router.include_router(upload.router, prefix="/upload", tags=["upload"])
api_router.include_router(pricing.router, prefix="/pricing", tags=["pricing"])
api_router.include_router(specialists.router, prefix="/specialists", tags=["specialists"])
api_router.include_router(crm.router, prefix="/crm", tags=["crm"])
