"""
TherapistNote — заметки специалиста по клиентам.
"""
from typing import Optional
from uuid import uuid4
from datetime import datetime
from sqlalchemy import Column
from sqlmodel import SQLModel, Field

from app.services.note_crypto import EncryptedText


class TherapistNoteBase(SQLModel):
    client_id: str = Field(index=True, foreign_key="therapist_clients.id")
    session_id: Optional[str] = Field(default=None, index=True)
    content: str
    tags: Optional[str] = None  # Comma-separated tags


class TherapistNote(TherapistNoteBase, table=True):
    __tablename__ = "therapist_notes"

    # Текст заметки шифруется в самой колонке (см. services/note_crypto).
    # Переопределяем поле только здесь, в таблице: TherapistNoteRead и
    # TherapistNoteCreate наследуют обычный str и работают как раньше.
    content: str = Field(sa_column=Column("content", EncryptedText, nullable=False))

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    specialist_id: str = Field(index=True)  # User UUID as string (no FK due to SQLite UUID limitation)
    created_at: datetime = Field(default_factory=datetime.now, index=True)
    updated_at: datetime = Field(default_factory=datetime.now)


class TherapistNoteCreate(SQLModel):
    client_id: str
    session_id: Optional[str] = None
    content: str
    tags: Optional[str] = None


class TherapistNoteRead(TherapistNoteBase):
    id: str
    specialist_id: str
    created_at: datetime
    updated_at: datetime
