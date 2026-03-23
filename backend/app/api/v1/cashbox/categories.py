"""Cashbox — expense categories: list (tree), create, update, delete."""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.db.session import get_session
from app.models.user import User
from app.models.expense_category import (
    ExpenseCategory, ExpenseCategoryCreate, ExpenseCategoryRead,
)
from app.api.v1.cashbox import require_cashbox, require_category_manage, build_category_tree

router = APIRouter()


@router.get("/categories")
def list_categories(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_cashbox),
):
    cats = session.exec(
        select(ExpenseCategory).order_by(ExpenseCategory.name)
    ).all()
    return build_category_tree(cats)


@router.post("/categories", response_model=ExpenseCategoryRead)
def create_category(
    payload: ExpenseCategoryCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_category_manage),
):
    if payload.parent_id:
        parent = session.get(ExpenseCategory, payload.parent_id)
        if not parent:
            raise HTTPException(404, "Родительская категория не найдена")
        if parent.parent_id:
            raise HTTPException(400, "Допускается только один уровень вложенности")

    cat = ExpenseCategory(
        name=payload.name,
        parent_id=payload.parent_id,
        icon=payload.icon,
        category_type=payload.category_type or "expense",
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return ExpenseCategoryRead.model_validate(cat)


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_category_manage),
):
    cat = session.get(ExpenseCategory, category_id)
    if not cat:
        raise HTTPException(404, "Категория не найдена")

    children = session.exec(
        select(ExpenseCategory).where(ExpenseCategory.parent_id == category_id)
    ).all()
    if children:
        raise HTTPException(400, "Сначала удалите подкатегории")

    session.delete(cat)
    session.commit()
    return {"ok": True}


@router.patch("/categories/{category_id}", response_model=ExpenseCategoryRead)
def update_category(
    category_id: str,
    payload: dict,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_category_manage),
):
    cat = session.get(ExpenseCategory, category_id)
    if not cat:
        raise HTTPException(404, "Категория не найдена")

    for field in ("name", "icon", "is_active", "category_type"):
        if field in payload:
            setattr(cat, field, payload[field])

    session.add(cat)
    session.commit()
    session.refresh(cat)
    return ExpenseCategoryRead.model_validate(cat)
