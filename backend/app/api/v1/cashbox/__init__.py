"""
Cashbox module — финансовый учёт: транзакции, категории, смены, аналитика.
Sub-modules: transactions, categories, shifts.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from app.api import deps
from app.models.user import User
from app.models.expense_category import ExpenseCategory

router = APIRouter()


# ── Shared dependencies ──────────────────────────────────────────────────────

def require_cashbox(current_user: User = Depends(deps.require_admin)) -> User:
    """Require finance.manage_cashbox permission."""
    if not deps.has_permission(current_user, "finance.manage_cashbox"):
        raise HTTPException(403, "Нет права finance.manage_cashbox")
    return current_user


def require_reports(current_user: User = Depends(deps.require_admin)) -> User:
    """Require finance.view_reports permission."""
    if not deps.has_permission(current_user, "finance.view_reports"):
        raise HTTPException(403, "Нет права finance.view_reports")
    return current_user


def require_category_manage(current_user: User = Depends(require_cashbox)) -> User:
    """Categories can only be created/edited by senior_admin or owner."""
    if current_user.role not in ("senior_admin", "owner"):
        raise HTTPException(403, "Управление категориями доступно только старшему админу или владельцу")
    return current_user


def build_category_tree(categories: List[ExpenseCategory]) -> List[dict]:
    """Build nested category tree from flat list."""
    by_id = {}
    roots = []
    for cat in categories:
        node = {
            "id": cat.id,
            "name": cat.name,
            "parent_id": cat.parent_id,
            "icon": cat.icon,
            "is_active": cat.is_active,
            "created_at": cat.created_at,
            "children": [],
        }
        by_id[cat.id] = node

    for cat in categories:
        node = by_id[cat.id]
        if cat.parent_id and cat.parent_id in by_id:
            by_id[cat.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


# ── Sub-routers ──────────────────────────────────────────────────────────────
from app.api.v1.cashbox import transactions, categories, shifts  # noqa: E402

router.include_router(transactions.router)
router.include_router(categories.router)
router.include_router(shifts.router)
