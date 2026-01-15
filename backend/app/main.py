from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db.session import init_db
from .db.init_data import init_data
from .core.config import settings
from .api.v1 import api_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # init_db() # Skipped to avoid hanging on locks
    init_data()
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Backend API for Unbox Coworking Booking System",
    version="0.1.0",
    lifespan=lifespan,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

from fastapi.staticfiles import StaticFiles
import os

# Ensure uploads directory exists
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# CORS Middleware (Allow Frontend to connect)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request, call_next):
    print(f"DEBUG REQUEST: {request.method} {request.url.path}")
    response = await call_next(request)
    print(f"DEBUG RESPONSE: {response.status_code}")
    return response

app.include_router(api_router, prefix=settings.API_V1_STR)



@app.get("/")
def read_root():
    return {"message": "Welcome to Unbox Booking API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
