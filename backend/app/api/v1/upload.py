from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
import shutil
import os
import uuid
from typing import Dict
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()

# Helper to get upload dir (replicated logic or shared config would be better, but simple is fine)
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads")
# /app/api/v1/../../.. -> /backend/uploads

@router.post("/", response_model=Dict[str, str])
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    # Generate unique filename
    file_ext = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {str(e)}")

    # Return relative URL
    return {"url": f"/uploads/{filename}"}


MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


@router.post("/task-file", response_model=Dict[str, str])
async def upload_task_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload any file type for task attachments (max 20MB)."""
    # Read and check size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
    unique_name = f"{uuid.uuid4()}{file_ext}"

    # Store in uploads/tasks/ subfolder
    tasks_dir = os.path.join(UPLOAD_DIR, "tasks")
    os.makedirs(tasks_dir, exist_ok=True)
    file_path = os.path.join(tasks_dir, unique_name)

    try:
        with open(file_path, "wb") as buffer:
            buffer.write(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {str(e)}")

    return {
        "url": f"/uploads/tasks/{unique_name}",
        "name": file.filename or unique_name,
        "size": str(len(contents)),
    }
