"""
TherapistNote — заметки специалиста по клиентам.
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import SQLModel, Field


class TherapistNoteBase(SQLModel):
    client_id: str = Field(index=True, foreign_key="therapist_clients.id")
    content: str
    tags: Optional[str] = None  # Comma-separated tags


class TherapistNote(TherapistNoteBase, table=True):
    __tablename__ = "therapist_notes"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    specialist_id: str = Field(index=True)  # User UUID, no FK constraint (type mismatch)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TherapistNoteCreate(SQLModel):
    client_id: str
    content: str
    tags: Optional[str] = None


class TherapistNoteRead(TherapistNoteBase):
    id: str
    specialist_id: str
    created_at: datetime
    updated_at: datetime
