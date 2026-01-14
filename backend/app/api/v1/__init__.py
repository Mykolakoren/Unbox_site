from fastapi import APIRouter
from app.api.v1 import bookings, users, auth, waitlist, health

api_router = APIRouter()
api_router.include_router(bookings.router, prefix="/bookings", tags=["bookings"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(waitlist.router, prefix="/waitlist", tags=["waitlist"])
api_router.include_router(health.router, prefix="/health", tags=["health"])
api_router.include_router(timeline.router, prefix="/timeline", tags=["timeline"])
