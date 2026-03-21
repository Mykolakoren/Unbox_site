"""Admin Tasks — CRUD for the Kanban task board."""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from pydantic import BaseModel
from app.api import deps
from app.db.session import get_session
from app.models.user import User
from app.models.admin_task import (
    AdminTask, AdminTaskCreate, AdminTaskRead, AdminTaskUpdate,
    AdminTaskComment, AdminTaskCommentCreate, AdminTaskCommentRead,
)

router = APIRouter()


@router.get("/", response_model=List[AdminTaskRead])
def list_tasks(
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
    status: Optional[str] = Query(None),
    assignee_id: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
):
    """List all admin tasks with optional filters."""
    stmt = select(AdminTask).order_by(AdminTask.sort_order, AdminTask.created_at.desc())

    if status:
        stmt = stmt.where(AdminTask.status == status)
    if assignee_id:
        stmt = stmt.where(AdminTask.assignee_id == assignee_id)
    if priority:
        stmt = stmt.where(AdminTask.priority == priority)

    return session.exec(stmt).all()


@router.post("/", response_model=AdminTaskRead)
def create_task(
    data: AdminTaskCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Create a new admin task."""
    task = AdminTask(
        **data.model_dump(),
        created_by=str(current_user.id),
        created_by_name=current_user.name,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.get("/{task_id}", response_model=AdminTaskRead)
def get_task(
    task_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    task = session.get(AdminTask, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.patch("/{task_id}", response_model=AdminTaskRead)
def update_task(
    task_id: str,
    data: AdminTaskUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Update task fields (partial update)."""
    task = session.get(AdminTask, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)
    task.updated_at = datetime.utcnow()

    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.delete("/{task_id}")
def delete_task(
    task_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    task = session.get(AdminTask, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    # Delete comments too
    comments = session.exec(
        select(AdminTaskComment).where(AdminTaskComment.task_id == task_id)
    ).all()
    for c in comments:
        session.delete(c)

    session.delete(task)
    session.commit()
    return {"ok": True}


class ReorderItem(BaseModel):
    id: str
    sort_order: int
    status: Optional[str] = None


class ReorderRequest(BaseModel):
    items: List[ReorderItem]


@router.patch("/batch/reorder")
def reorder_tasks(
    data: ReorderRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    """Batch update sort_order (and optionally status) for multiple tasks."""
    for item in data.items:
        task = session.get(AdminTask, item.id)
        if task:
            task.sort_order = item.sort_order
            if item.status:
                task.status = item.status
            task.updated_at = datetime.utcnow()
            session.add(task)
    session.commit()
    return {"ok": True, "updated": len(data.items)}


# ── Comments ──────────────────────────────────────────────────────────────────

@router.get("/{task_id}/comments", response_model=List[AdminTaskCommentRead])
def list_comments(
    task_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    return session.exec(
        select(AdminTaskComment)
        .where(AdminTaskComment.task_id == task_id)
        .order_by(AdminTaskComment.created_at.desc())
    ).all()


@router.post("/{task_id}/comments", response_model=AdminTaskCommentRead)
def add_comment(
    task_id: str,
    data: AdminTaskCommentCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.require_admin),
):
    task = session.get(AdminTask, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    comment = AdminTaskComment(
        task_id=task_id,
        text=data.text,
        author_id=str(current_user.id),
        author_name=current_user.name,
    )
    session.add(comment)
    session.commit()
    session.refresh(comment)
    return comment
