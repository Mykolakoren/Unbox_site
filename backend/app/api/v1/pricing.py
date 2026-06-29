import logging
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime
from sqlmodel import Session

from app.api.deps import get_session, get_current_user, get_optional_current_user
from app.models.user import User
from app.services.pricing import PricingService, PriceBreakdown

logger = logging.getLogger(__name__)

router = APIRouter()

class QuoteRequest(BaseModel):
    resource_id: str
    start_time: datetime
    duration_minutes: int
    format_type: str = "individual"

@router.post("/quote", response_model=PriceBreakdown)
def get_pricing_quote(
    request: QuoteRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User | None, Depends(get_optional_current_user)],
):
    """
    Calculate price for a potential booking based on user's subscription,
    time of booking (hot deals), and other rules.
    """
    service = PricingService(session)
    try:
        quote = service.calculate_price(
            user=current_user,
            resource_id=request.resource_id,
            start_time=request.start_time,
            duration_minutes=request.duration_minutes,
            format_type=request.format_type
        )
        return quote
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Pricing Error: {e}")
        raise HTTPException(status_code=500, detail="Pricing calculation failed")


# ── Недельный перерасчёт скидки (owner 2026-06-29) ───────────────────────────
from datetime import date as _date  # noqa: E402
from app.api.deps import require_admin  # noqa: E402
from app.services.weekly_rebate import run_weekly_rebates, last_completed_week_start  # noqa: E402


class WeeklyRebateRequest(BaseModel):
    # Понедельник недели (YYYY-MM-DD). По умолчанию — прошлая завершившаяся.
    week_start: str | None = None
    dry_run: bool = True


@router.post("/weekly-rebate/run")
def run_weekly_rebate(
    *,
    payload: WeeklyRebateRequest,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
):
    """Начислить недельные кредиты за неделю. dry_run=True (по умолчанию) —
    только посчитать суммы, ничего не записывать. Только админ."""
    if payload.week_start:
        try:
            ws = _date.fromisoformat(payload.week_start)
        except ValueError:
            raise HTTPException(400, "week_start должен быть YYYY-MM-DD")
    else:
        ws = last_completed_week_start()
    return run_weekly_rebates(session, ws, dry_run=payload.dry_run)
