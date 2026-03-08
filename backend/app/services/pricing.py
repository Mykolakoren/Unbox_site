from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict
from pydantic import BaseModel
from sqlmodel import Session, select
from app.models.user import User
from app.models.resource import Resource
from app.models.booking import Booking

class PriceBreakdown(BaseModel):
    base_price: float
    hourly_rate: float
    booked_hours: float
    
    # Applied Rules
    applied_rule: str # "SUBSCRIPTION", "HOT_BOOKING", "WEEKLY_PROGRESSIVE", "NONE"
    
    # Discount Details
    discount_percent: int = 0
    discount_amount: float = 0.0
    
    # Subscription Details
    subscription_plan: Optional[str] = None
    hours_deducted: float = 0.0
    
    final_price: float
    
    # Flags
    is_non_refundable: bool = False
    is_non_reschedulable: bool = False

class PricingService:
    def __init__(self, session: Session):
        self.session = session

    # Pricing Configuration (Mirroring Frontend)
    PRICING_CONFIG = {
        "hot_booking": {"hours_before": 12, "percent": 10},
        "duration": [
            {"min": 2, "max": 2.99, "percent": 10},
            {"min": 3, "max": 3.99, "percent": 15},
            {"min": 4, "max": 9999, "percent": 20},
        ],
        "weekly_progressive": [
            {"min": 0, "max": 4.999, "percent": 0},
            {"min": 5, "max": 10.999, "percent": 10},
            {"min": 11, "max": 15.999, "percent": 25},
            {"min": 16, "max": 9999, "percent": 50},
        ]
    }

    def calculate_price(
        self, 
        user: User, 
        resource_id: str, 
        start_time: datetime, # Full datetime
        duration_minutes: int,
        format_type: str = "individual"
    ) -> PriceBreakdown:
        
        # 1. Fetch Resource
        resource = self.session.get(Resource, resource_id)
        if not resource:
            raise ValueError("Resource not found")
            
        booked_hours = duration_minutes / 60.0
        
        # 2. Determine Base Rate
        base_rate = resource.hourly_rate
        # Create a simple multiplier for group format if not explicitly stored
        if format_type == "group" and resource.type == "cabinet": 
             # Logic from config: IND=20, GRP=35. (Multiplier ~1.75 or explicit lookup)
             pass

        base_price = base_rate * booked_hours
        
        breakdown = PriceBreakdown(
            base_price=base_price,
            hourly_rate=base_rate,
            booked_hours=booked_hours,
            applied_rule="NONE",
            final_price=base_price
        )

        # 3. Apply Hierarchy
        # Order: Subscription -> Manual (N/A here) -> Max(Weekly, Duration, Hot)
        
        # A. Subscription (Priority 1)
        if self._apply_subscription(user, breakdown, resource, format_type):
            return breakdown
            
        # B. Compare Standard Discounts
        # We need to find the BEST discount among: Weekly, Duration, Hot
        
        # 1. Hot Booking
        hot_percent = 0
        if self._is_hot_booking(start_time):
            hot_percent = self.PRICING_CONFIG["hot_booking"]["percent"]
            
        # 2. Duration (Consecutive)
        duration_percent = 0
        for tier in self.PRICING_CONFIG["duration"]:
            if tier["min"] <= booked_hours < tier["max"]:
                duration_percent = tier["percent"]
                break
                
        # 3. Weekly Progressive
        weekly_percent = 0
        weekly_hours = self._get_weekly_accumulated_hours(user, start_time)
        print(f"DEBUG: Weekly Hours for {user.email}: {weekly_hours} + Current {booked_hours}")
        total_weekly = weekly_hours + booked_hours
        
        for tier in self.PRICING_CONFIG["weekly_progressive"]:
            if tier["min"] <= total_weekly < tier["max"]:
                weekly_percent = tier["percent"]
                break
                
        # Apply Best Discount
        best_percent = max(hot_percent, duration_percent, weekly_percent)
        
        if best_percent > 0:
            discount_val = breakdown.base_price * (best_percent / 100.0)
            breakdown.discount_percent = best_percent
            breakdown.discount_amount = discount_val
            breakdown.final_price = max(0, breakdown.base_price - discount_val)
            
            # Label
            if best_percent == weekly_percent:
                breakdown.applied_rule = "WEEKLY_PROGRESSIVE"
            elif best_percent == duration_percent:
                breakdown.applied_rule = "CONSECUTIVE_HOURS"
            else:
                breakdown.applied_rule = "HOT_BOOKING"
                # Hot booking implies non-refundable usually, but if other discount matched same percent?
                # Sticking to simplified logic. 
                if best_percent == hot_percent: 
                    breakdown.is_non_refundable = True
                    breakdown.is_non_reschedulable = True

        return breakdown

    def _is_hot_booking(self, start_time: datetime) -> bool:
        now = datetime.now(timezone.utc)
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)
        diff = start_time - now
        hours_before = diff.total_seconds() / 3600.0
        return 0 < hours_before <= self.PRICING_CONFIG["hot_booking"]["hours_before"]

    def _get_weekly_accumulated_hours(self, user: User, start_time: datetime) -> float:
        # Calculate start/end of week (Monday start)
        # start_time is the booking time. We look at the week of the booking.
        dt = start_time if start_time.tzinfo else start_time.replace(tzinfo=timezone.utc)
        
        # ISO calendar: Monday=1, Sunday=7
        iso_day = dt.isoweekday() 
        start_of_week = dt - timedelta(days=iso_day-1)
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_week = start_of_week + timedelta(days=7)
        
        # Query confirmed bookings
        # Assuming Booking.user_id (email) or Booking.user_uuid (id)
        # Using Booking.user_uuid preferred if populated
        stmt = select(Booking).where(
            (Booking.user_uuid == user.id) | (Booking.user_id == user.email),
            Booking.status == 'confirmed',
            Booking.date >= start_of_week,
            Booking.date < end_of_week
        )
        bookings = self.session.exec(stmt).all()
        
        total_hours = sum(b.duration / 60.0 for b in bookings)
        return total_hours

    def _apply_subscription(
        self, 
        user: User, 
        breakdown: PriceBreakdown, 
        resource: Resource,
        format_type: str
    ) -> bool:
        """
        Attempts to apply subscription logic. Returns True if applied.
        """
        if not user.subscription or user.subscription.get("is_frozen", user.subscription.get("isFrozen", False)):
            return False
            
        # Handle both snake_case (stored via API) and camelCase (stored via direct logic) for safety
        plan_id = user.subscription.get("plan_id", user.subscription.get("planId"))
        included_formats = user.subscription.get("included_formats", user.subscription.get("includedFormats", ["individual"]))
        
        # 1. Format Check
        if format_type not in included_formats:
            return False
            
        # 2. Check Remaining Hours
        remaining = float(user.subscription.get("remaining_hours", user.subscription.get("remainingHours", 0)))
        
        if remaining >= breakdown.booked_hours - 0.01: # Float safety
            # Full coverage by hours
            breakdown.applied_rule = "SUBSCRIPTION"
            breakdown.subscription_plan = plan_id
            breakdown.hours_deducted = breakdown.booked_hours
            breakdown.final_price = 0.0 
            return True
        else:
            # Hours exhausted, apply generic plan discount if any
            discount_percent = float(user.subscription.get("discount_percent", user.subscription.get("discountPercent", 0)))
            if discount_percent > 0:
                breakdown.applied_rule = "SUBSCRIPTION_DISCOUNT"
                breakdown.subscription_plan = plan_id
                breakdown.discount_percent = int(discount_percent)
                discount_val = breakdown.base_price * (discount_percent / 100.0)
                breakdown.discount_amount = discount_val
                breakdown.final_price = breakdown.base_price - discount_val
                return True
                
        return False
                
        return False
                
        return False
    
    # Removed _apply_hot_booking as it is now integrated into calculate_price logic
