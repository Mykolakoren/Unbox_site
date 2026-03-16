"""CRM Notes — therapist notes for clients."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.api import deps
from app.models.user import User
from app.models.therapist_client import TherapistClient
from app.models.therapist_note import (
    TherapistNote, TherapistNoteCreate, TherapistNoteRead,
)

router = APIRouter()


@router.get("/notes", response_model=List[TherapistNoteRead])
def list_notes(
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
    client_id: Optional[str] = Query(None),
):
    uid = str(current_user.id)
    stmt = select(TherapistNote).where(TherapistNote.specialist_id == uid)
    if client_id:
        stmt = stmt.where(TherapistNote.client_id == client_id)
    stmt = stmt.order_by(TherapistNote.created_at.desc())
    return session.exec(stmt).all()


@router.post("/notes", response_model=TherapistNoteRead)
def create_note(
    data: TherapistNoteCreate,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    client = session.get(TherapistClient, data.client_id)
    if not client or client.specialist_id != str(current_user.id):
        raise HTTPException(404, "Client not found")

    note = TherapistNote(
        **data.model_dump(),
        specialist_id=str(current_user.id),
    )
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


@router.delete("/notes/{note_id}")
def delete_note(
    note_id: str,
    session: Session = Depends(deps.get_session),
    current_user: User = Depends(deps.require_specialist),
):
    note = session.get(TherapistNote, note_id)
    if not note or note.specialist_id != str(current_user.id):
        raise HTTPException(404, "Note not found")
    session.delete(note)
    session.commit()
    return {"ok": True}
