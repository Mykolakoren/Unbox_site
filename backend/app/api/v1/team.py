"""
Team Members API — публичный GET, CRUD только для admin+.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db.session import get_session
from app.api.deps import require_admin
from app.models.team_member import TeamMember, TeamMemberCreate, TeamMemberRead, TeamMemberUpdate

router = APIRouter()


@router.get("", response_model=list[TeamMemberRead])
def list_team(session: Session = Depends(get_session)):
    """Публичный эндпоинт — все активные члены команды, отсортированные по sort_order."""
    members = session.exec(
        select(TeamMember)
        .where(TeamMember.is_active == True)
        .order_by(TeamMember.sort_order)
    ).all()
    return members


@router.get("/all", response_model=list[TeamMemberRead])
def list_team_all(session: Session = Depends(get_session), current_user=Depends(require_admin)):
    """Все члены команды включая неактивных — только для admin."""
    members = session.exec(select(TeamMember).order_by(TeamMember.sort_order)).all()
    return members


@router.post("", response_model=TeamMemberRead)
def create_member(payload: TeamMemberCreate, session: Session = Depends(get_session), current_user=Depends(require_admin)):
    member = TeamMember(**payload.model_dump())
    session.add(member)
    session.commit()
    session.refresh(member)
    return member


@router.patch("/{member_id}", response_model=TeamMemberRead)
def update_member(member_id: str, payload: TeamMemberUpdate, session: Session = Depends(get_session), current_user=Depends(require_admin)):
    member = session.get(TeamMember, member_id)
    if not member:
        raise HTTPException(404, "Не найдено")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(member, k, v)
    session.add(member)
    session.commit()
    session.refresh(member)
    return member


@router.delete("/{member_id}")
def delete_member(member_id: str, session: Session = Depends(get_session), current_user=Depends(require_admin)):
    member = session.get(TeamMember, member_id)
    if not member:
        raise HTTPException(404, "Не найдено")
    session.delete(member)
    session.commit()
    return {"ok": True}
