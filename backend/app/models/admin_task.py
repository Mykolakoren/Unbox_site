"""AdminTask — задачи администраторов (Kanban-доска)."""
from typing import Optional, List
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field, JSON
from sqlalchemy import Column


class AdminTaskBase(SQLModel):
    title: str
    description: str = Field(default="")
    status: str = Field(default="TODO", index=True)  # TODO, IN_PROGRESS, DONE
    priority: str = Field(default="MEDIUM")  # LOW, MEDIUM, HIGH
    assignee_id: Optional[str] = Field(default=None, index=True)
    assignee_name: Optional[str] = Field(default=None)
    participants: List[dict] = Field(default_factory=list, sa_column=Column(JSON))  # [{id, name}]
    deadline: Optional[datetime] = Field(default=None)
    start_date: Optional[datetime] = Field(default=None)
    labels: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    checklist: List[dict] = Field(default_factory=list, sa_column=Column(JSON))
    attachments: List[dict] = Field(default_factory=list, sa_column=Column(JSON))  # [{id, type, name, url, size?, createdAt}]
    sort_order: int = Field(default=0)


class AdminTask(AdminTaskBase, table=True):
    __tablename__ = "admin_tasks"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    created_by: str = Field(default="")
    created_by_name: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.now, index=True)
    updated_at: datetime = Field(default_factory=datetime.now)


class AdminTaskCreate(SQLModel):
    title: str
    description: str = ""
    status: str = "TODO"
    priority: str = "MEDIUM"
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    participants: List[dict] = []
    deadline: Optional[datetime] = None
    start_date: Optional[datetime] = None
    labels: List[str] = []
    checklist: List[dict] = []
    attachments: List[dict] = []
    sort_order: int = 0


class AdminTaskUpdate(SQLModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = None
    participants: Optional[List[dict]] = None
    deadline: Optional[datetime] = None
    start_date: Optional[datetime] = None
    labels: Optional[List[str]] = None
    checklist: Optional[List[dict]] = None
    attachments: Optional[List[dict]] = None
    sort_order: Optional[int] = None


class AdminTaskRead(AdminTaskBase):
    id: str
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: datetime


# ── Comments ──────────────────────────────────────────────────────────────────


class AdminTaskCommentBase(SQLModel):
    text: str


class AdminTaskComment(AdminTaskCommentBase, table=True):
    __tablename__ = "admin_task_comments"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    task_id: str = Field(index=True)
    author_id: str = Field(default="")
    author_name: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.now, index=True)


class AdminTaskCommentCreate(SQLModel):
    text: str


class AdminTaskCommentRead(AdminTaskCommentBase):
    id: str
    task_id: str
    author_id: str
    author_name: str
    created_at: datetime
