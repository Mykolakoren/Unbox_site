from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import datetime
from sqlmodel import Session

from app.api.deps import get_session, get_current_user, get_optional_current_user
from app.models.user import User
from app.services.pricing import PricingService, PriceBreakdown

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
        print(f"Pricing Error: {e}")
        raise HTTPException(status_code=500, detail="Pricing calculation failed")
