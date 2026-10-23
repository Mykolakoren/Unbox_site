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


def _sniff_image_ext(data: bytes):
    """Тип картинки — по первым байтам файла, а не по имени и заголовку от клиента.
    Аудит 23.10: раньше `x.html` с `Content-Type: image/png` сохранялся как .html
    и открывался с нашего домена (чужой скрипт с доступом к входу админа).
    SVG не принимаем — внутри может быть скрипт."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


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

    file_ext = _sniff_image_ext(contents)
    if not file_ext:
        raise HTTPException(status_code=400, detail="Можно загрузить только фото: JPG, PNG, WEBP или GIF")
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
    # Картинка с чужим нутром под видом .png — тоже отказ (см. _sniff_image_ext).
    if file_ext in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        _real = _sniff_image_ext(contents)
        if not _real:
            raise HTTPException(status_code=400, detail="Файл не похож на изображение")
        file_ext = _real
    if file_ext == ".pdf" and b"%PDF" not in contents[:1024]:  # заголовок может быть не с 1-го байта
        raise HTTPException(status_code=400, detail="Файл не похож на PDF")
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
