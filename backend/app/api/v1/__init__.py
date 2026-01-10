from fastapi import APIRouter
from app.api.v1 import auth, users, bookings, waitlist, timeline

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(bookings.router, prefix="/bookings", tags=["bookings"])
api_router.include_router(waitlist.router, prefix="/waitlist", tags=["waitlist"])
api_router.include_router(timeline.router, prefix="/timeline", tags=["timeline"])

