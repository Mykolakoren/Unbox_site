"""Users — self-service profile endpoints (GET /me, PATCH /me, discount-progress)."""
from typing import Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from app.api import deps
from app.db.session import get_session
from app.models.user import User, UserRead, UserUpdate
from app.models.booking import Booking
from app.services.pricing import PricingService

router = APIRouter()


@router.get("/me", response_model=UserRead)
def read_user_me(
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Get current user."""
    return current_user


@router.get("/me/discount-progress")
def get_discount_progress(
    *,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Get weekly discount progress and total savings."""
    # 1. Total Saved (All Time)
    stmt_saved = select(func.sum(Booking.discount_amount)).where(
        (Booking.user_uuid == current_user.id) | (Booking.user_id == current_user.email),
        Booking.status == 'confirmed'
    )
    total_saved = session.exec(stmt_saved).one() or 0.0

    # 2. Weekly Accumulated Hours
    pricing = PricingService(session)
    now = datetime.now(timezone.utc)
    accumulated_hours = pricing._get_weekly_accumulated_hours(current_user, now)

    # 3. Determine Tiers
    config = PricingService.PRICING_CONFIG["weekly_progressive"]
    current_discount = 0
    next_tier_hours = 5.0
    next_tier_discount = 10

    for tier in config:
        if tier["min"] <= accumulated_hours < tier["max"]:
            current_discount = tier["percent"]
            idx = config.index(tier)
            if idx + 1 < len(config):
                next_tier = config[idx + 1]
                next_tier_hours = next_tier["min"]
                next_tier_discount = next_tier["percent"]
            else:
                next_tier_hours = accumulated_hours
                next_tier_discount = current_discount
            break

    if accumulated_hours >= 16.0:
        progress_percent = 100
        next_tier_hours = 16.0
        next_tier_discount = 50
    else:
        progress_percent = (accumulated_hours / 16.0) * 100

    return {
        "accumulated_hours": round(accumulated_hours, 1),
        "total_saved": round(total_saved, 2),
        "current_discount": current_discount,
        "next_tier_hours": next_tier_hours,
        "next_tier_discount": next_tier_discount,
        "progress_percent": min(100, progress_percent),
        "tiers": config,
    }


@router.patch("/me", response_model=UserRead)
def update_user_me(
    *,
    session: Session = Depends(get_session),
    user_in: UserUpdate,
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Update own profile."""
    try:
        user_data = user_in.dict(exclude_unset=True)
        for key, value in user_data.items():
            setattr(current_user, key, value)

        session.add(current_user)
        session.commit()
        session.refresh(current_user)
        return current_user
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
