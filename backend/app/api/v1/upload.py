from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
import os
import uuid
from typing import Dict
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()

# Helper to get upload dir (replicated logic or shared config would be better, but simple is fine)
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads")
# /app/api/v1/../../.. -> /backend/uploads

IMAGE_MAX_BYTES = 2 * 1024 * 1024  # 2 MB — keeps avatars/cabinet photos light


@router.post("/", response_model=Dict[str, str])
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    # Server-side size guard — defence-in-depth in case the frontend check is
    # bypassed. 2 MB is plenty for a profile/cabinet photo; anything larger
    # is almost certainly an unoptimised original. Reject with a clear msg.
    contents = await file.read()
    if len(contents) > IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Файл слишком большой ({len(contents) // 1024} KB). Максимум 2 МБ — сожмите изображение.",
        )

    file_ext = os.path.splitext(file.filename or "")[1]
    filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    try:
        with open(file_path, "wb") as buffer:
            buffer.write(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {str(e)}")

    return {"url": f"/uploads/{filename}"}


MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

# SECURITY: task-file attachments are served as same-origin static content from
# /uploads, so an uploaded .html/.svg/.js would execute in our origin = stored
# XSS. Allow only inert document/image types; reject everything else.
TASK_FILE_ALLOWED_EXTS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
}


@router.post("/task-file", response_model=Dict[str, str])
async def upload_task_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a document/image for task attachments (max 20MB, inert types only)."""
    # Read and check size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    file_ext = (os.path.splitext(file.filename)[1] if file.filename else "").lower()
    # Stored-XSS guard: only allow inert extensions (blocks .html/.svg/.js/etc).
    if file_ext not in TASK_FILE_ALLOWED_EXTS:
        raise HTTPException(
            status_code=400,
            detail="Недопустимый тип файла. Разрешены: PDF, изображения, документы (doc/xls), txt/csv.",
        )
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
