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

    # Peak hours
    peak_surcharge: float = 0.0
    peak_slot_count: int = 0
    subscription_peak_debt: float = 0.0

    # Flags
    is_non_refundable: bool = False
    is_non_reschedulable: bool = False

class PricingService:
    def __init__(self, session: Session):
        self.session = session

    # Extras price registry (server-side source of truth, mirrors frontend EXTRAS).
    # 2026-05-06: bundled sandbox+toys to 5 GEL, projector / couch / coffee
    # rebalanced to current Unbox pricing. Legacy IDs (sandbox_toys, flipchart)
    # kept here at 0 so historical bookings carrying them in `extras` JSON
    # array don't error out at render time, but they're not exposed in UI.
    EXTRAS_PRICES: Dict[str, float] = {
        "sandbox": 5.0,
        "projector": 5.0,
        "couch": 5.0,
        "coffee_meama": 3.0,
        "sandbox_toys": 0.0,  # legacy — included in `sandbox` now
        "flipchart": 0.0,     # legacy — kept for old bookings
        # 2026-06-02 owner: бесплатные опции для пред-заказа специалистом.
        # Цена 0, но extras сохраняются в брони → попадают в TG-уведомление
        # → персонал подготавливает кабинет к началу сессии.
        "flipchart_free": 0.0,
        "table_free": 0.0,
    }

    @classmethod
    def calculate_extras_price(cls, extras_ids: List[str]) -> float:
        """Calculate total extras price from server-side registry."""
        return sum(cls.EXTRAS_PRICES.get(eid, 0.0) for eid in extras_ids)

    @classmethod
    def validate_extras(cls, extras_ids: List[str]) -> List[str]:
        """Return list of unknown extra IDs (if any)."""
        return [eid for eid in extras_ids if eid not in cls.EXTRAS_PRICES]

    # Base rates lookup — mirrors frontend PRICING_CONFIG.base_rates
    # Space type (ROOM/CAP) × Format (IND/GRP/INTV) → GEL per hour
    BASE_RATES = {
        "ROOM": {"IND": 20.0, "GRP": 35.0, "INTV": 30.0},
        "CAP": {"IND": 10.0, "GRP": 10.0, "INTV": 10.0},
    }

    # Format string → lookup code
    FORMAT_CODES = {
        "individual": "IND",
        "group": "GRP",
        "intervision": "INTV",
    }

    # Pricing Configuration (Mirroring Frontend)
    # Aligned with Unbox-actual policy 2026-05-07:
    #   * Peak hour (9-10, 20-22) — flat +5 GEL surcharge per hour, BEFORE discounts
    #     applied to non-peak portion. Peak hours themselves are not discounted.
    #   * Duration tiers based on NON-PEAK hours only — peak часы не двигают
    #     юзера в более выгодный тир, потому что они сами по себе уже наценка.
    #   * Tiers: 2-2.99h → 10%, 3-4.99h → 15%, 5+ → 20% (раньше было 2/3/4 — bug).
    PRICING_CONFIG = {
        "hot_booking": {"hours_before": 12, "percent": 0},  # No discount — only admin approval
        # Tier ranges half-open `[min, max)`. Admin spec 2026-05-21:
        #   2.0, 2.5    → 10%   ([2.0, 3.0))
        #   3.0..4.5    → 15%   ([3.0, 5.0))
        #   5.0+        → 20%   ([5.0, ∞))
        # Reverted from the 13.05 boundaries which were giving 3h → 10%
        # and 5h → 15% — admin says 3h should be 15% и 5h should be 20%.
        "duration": [
            {"min": 2.0, "max": 3.0, "percent": 10},
            {"min": 3, "max": 5, "percent": 15},
            {"min": 5, "max": 9999, "percent": 20},
        ],
        # 2026-06-07 owner: weekly_progressive восстановлен — нужен как
        # маркетинг-аргумент «чем больше практикуешь, тем дешевле час».
        # Тиры идентичны тем что были до отключения 2026-05-21.
        # Backend применяет max(duration, weekly) — если в одной броне
        # сработает duration 20% а на неделе уже 50% — клиент платит по 50%.
        # Инфографика на /subscriptions должна совпадать с этими числами.
        "weekly_progressive": [
            {"min": 0,  "max": 4.999,  "percent": 0},
            {"min": 5,  "max": 10.999, "percent": 10},
            {"min": 11, "max": 15.999, "percent": 25},
            {"min": 16, "max": 9999,   "percent": 50},
        ],
        "peak_hours": {
            # Flat per-hour surcharge (was percent-of-base 25%, причиняло
            # путаницу — например 25% от 20 = 5, что совпадает с фиксом для
            # cab-1, но для cab-7/8 группового 25% × 35 = 8.75 ≠ 5).
            "surcharge_per_hour_gel": 5,
            "subscription_surcharge_gel": 5,  # для абонементов та же логика
            "ranges": [
                # Утро 9-10, вечер 20-22 (admin policy 2026-05-20:
                # вернули обратно — 21-22 оказался слишком узким,
                # вечерние брони 20:00 продолжают ловить наценку).
                {"start": "09:00", "end": "10:00"},
                {"start": "20:00", "end": "22:00"},
            ],
        },
    }

    @staticmethod
    def _is_peak_time(time_str: str) -> bool:
        """Check if HH:MM falls into a peak hour range."""
        h, m = map(int, time_str.split(":"))
        mins = h * 60 + m
        for r in PricingService.PRICING_CONFIG["peak_hours"]["ranges"]:
            sh, sm = map(int, r["start"].split(":"))
            eh, em = map(int, r["end"].split(":"))
            if mins >= sh * 60 + sm and mins < eh * 60 + em:
                return True
        return False

    def calculate_price(
        self,
        user: Optional[User],
        resource_id: str,
        start_time: datetime, # Full datetime
        duration_minutes: int,
        format_type: str = "individual",
        consecutive_total_hours: Optional[float] = None,
        exclude_booking_id: Optional[str] = None,  # for recompute: skip self
    ) -> PriceBreakdown:

        # 1. Fetch Resource
        resource = self.session.get(Resource, resource_id)
        if not resource:
            raise ValueError("Resource not found")

        booked_hours = duration_minutes / 60.0

        # 2. Determine Base Rate via config lookup (space_type × format).
        # Neo School halls/gym are an exception — we rent the school's space
        # and the rate is fixed per resource regardless of format (55 ₾/час
        # for the halls, 40 ₾/час for the gym). Honour resource.hourly_rate
        # directly for those, while still letting the discount stack apply.
        space_type = "CAP" if resource.type == "capsule" else "ROOM"
        format_code = self.FORMAT_CODES.get(format_type, "IND")
        if resource.location_id == "neo_school":
            base_rate = float(resource.hourly_rate)
        # Cabinet 2 in Unbox One can host mini-groups (до 4 чел), но остаётся
        # маленькой комнатой — групповой тариф больших залов (35₾/ч на cab 7/8)
        # тут неуместен. Берём индивидуальный рейт независимо от выбранного
        # формата, чтобы цена не прыгала когда юзер ставит "group" на Cab 2.
        elif resource.id == "unbox_one_room_2":
            rate_table = self.BASE_RATES.get(space_type, {})
            base_rate = rate_table.get("IND", resource.hourly_rate)
        else:
            rate_table = self.BASE_RATES.get(space_type, {})
            # Fallback: resource.hourly_rate if format_code missing (defensive)
            base_rate = rate_table.get(format_code, resource.hourly_rate)

        # 2b. Walk 30-min slots, separating peak vs non-peak portions.
        # New model (2026-05-07):
        #   non_peak_base = non_peak_hours × base_rate  (gets discounted)
        #   peak_total    = peak_hours × 5 GEL flat     (NOT discounted)
        # Final = non_peak_base × (1 - discount%) + peak_total
        peak_surcharge_gel = float(self.PRICING_CONFIG["peak_hours"]["surcharge_per_hour_gel"])
        non_peak_hours = 0.0
        peak_hours_count = 0.0
        peak_slot_count = 0  # 30-min slots — kept for subscription debt math

        start_h = start_time.hour
        start_m = start_time.minute
        start_total = start_h * 60 + start_m
        for m in range(start_total, start_total + duration_minutes, 30):
            h = m // 60
            mm = m % 60
            slot_str = f"{h:02d}:{mm:02d}"
            if self._is_peak_time(slot_str):
                peak_hours_count += 0.5
                peak_slot_count += 1
            else:
                non_peak_hours += 0.5

        # Peak hours = `base_rate × hours + surcharge × hours`. Earlier this
        # silently dropped the base — booking 09:00–10:00 in a 20₾/h cabinet
        # cost just 5₾ instead of 25₾, because peak_total was only the
        # surcharge. Policy (admin 2026-05-13): peak часы = «стандартная
        # цена + 5 ₾/час», т.е. base × ч + 5 × ч; БЕЗ скидки.
        non_peak_base = non_peak_hours * base_rate
        peak_base = peak_hours_count * base_rate
        peak_surcharge = peak_hours_count * peak_surcharge_gel
        peak_total = peak_base + peak_surcharge
        base_price = non_peak_base + peak_total

        breakdown = PriceBreakdown(
            base_price=base_price,
            hourly_rate=base_rate,
            booked_hours=booked_hours,
            applied_rule="NONE",
            final_price=base_price,
            peak_surcharge=peak_surcharge,
            peak_slot_count=peak_slot_count,
        )

        # If user is anonymous — return base price without discounts
        if user is None:
            return breakdown

        # 3. Apply Hierarchy
        # Order: Subscription -> Manual (N/A here) -> Max(Weekly, Duration, Hot)

        # A. Subscription (Priority 1)
        if self._apply_subscription(user, breakdown, resource, format_type):
            return breakdown

        # B. Personal pricing takes EXCLUSIVE priority over tier discounts.
        #
        # 2026-05-20 policy change: when admin sets pricing_system='personal'
        # with a personal_discount_percent, that's the NEGOTIATED rate — the
        # client and admin agreed on it explicitly. Layering weekly_progressive
        # or duration tier on top would silently undercharge: Алла Коноплицкая
        # has a 25% personal rate, but her heavy weekly volume kept pushing the
        # MAX-of-three logic to a 50% weekly tier → she paid 30 ₾ instead of
        # the agreed 45 ₾ per 3-hour session. Fix: if pricing_system='personal',
        # apply ONLY the personal percent; ignore weekly/duration entirely.
        # Discount applies to the FULL base rate (non-peak + peak), but NOT
        # to the peak surcharge. Admin (2026-05-21, Anna Borta case): «у
        # клиента с 25% скидка действует и на пиковую базу — наценка +5/ч
        # начисляется поверх дисконтированной цены».
        # Formula: discount_val = (non_peak_base + peak_base) × percent
        #          final = base_price − discount_val (peak surcharge stays full)
        full_base = non_peak_base + peak_base
        if user.pricing_system == "personal" and (user.personal_discount_percent or 0) > 0:
            personal_percent = float(user.personal_discount_percent)
            discount_val = full_base * (personal_percent / 100.0)
            breakdown.discount_percent = personal_percent
            breakdown.discount_amount = discount_val
            breakdown.final_price = max(0.0, breakdown.base_price - discount_val)
            breakdown.applied_rule = "PERSONAL_DISCOUNT"
            return breakdown

        # Standard pricing — collect tier candidates, apply the BEST.
        # Hot booking: no discount, only admin approval (handled in routes.py)
        # Duration tier — based on NON-PEAK hours only. Peak hours don't
        # bump tier (they're surcharged separately), and a booking with
        # 1.5h non-peak (even if part of a longer chain) doesn't qualify
        # for the 2h-tier — admin clarified: «скидка считается от 2 и более».
        # If caller didn't pass an aggregate hour count, look up adjacent
        # bookings in the SAME cabinet on the same day for THIS user and
        # merge the contiguous chain. Admin 2026-05-21: «5 часов подряд
        # должно давать тир 20%, даже если разбито на 5 отдельных строк».
        # Different cabinets → not aggregated (admin example: «в разных
        # кабинетах 2 часа = 2 × 20, без скидки»).
        if consecutive_total_hours is None and user is not None:
            consecutive_total_hours = self._compute_block_hours(
                user_uuid=user.id,
                resource_id=resource_id,
                start_time=start_time,
                duration_minutes=duration_minutes,
                exclude_booking_id=exclude_booking_id,
            )
        duration_lookup_hours = (
            consecutive_total_hours if consecutive_total_hours is not None else non_peak_hours
        )
        duration_percent = 0
        for tier in self.PRICING_CONFIG["duration"]:
            if tier["min"] <= duration_lookup_hours < tier["max"]:
                duration_percent = tier["percent"]
                break

        weekly_percent = 0
        weekly_hours = self._get_weekly_accumulated_hours(user, start_time, exclude_booking_id=exclude_booking_id)
        total_weekly = weekly_hours + booked_hours
        for tier in self.PRICING_CONFIG["weekly_progressive"]:
            if tier["min"] <= total_weekly < tier["max"]:
                weekly_percent = tier["percent"]
                break

        # Apply the BEST (max) discount — no stacking.
        # Discount applies ONLY to the non-peak portion of base price.
        # Peak surcharge stays full — admin: «утром-вечером стандартная цена
        # + 5 лари/час», т.е. peak часы уже наценены и доп.скидку не получают.
        best_percent = max(duration_percent, weekly_percent)

        if best_percent > 0:
            discount_val = full_base * (best_percent / 100.0)
            breakdown.discount_percent = best_percent
            breakdown.discount_amount = discount_val
            breakdown.final_price = max(0.0, breakdown.base_price - discount_val)

            # Label by which discount won
            if best_percent == weekly_percent:
                breakdown.applied_rule = "WEEKLY_PROGRESSIVE"
            elif best_percent == duration_percent:
                breakdown.applied_rule = "CONSECUTIVE_HOURS"

        return breakdown

    def _is_hot_booking(self, start_time: datetime) -> bool:
        now = datetime.now()
        # Strip timezone info to ensure both are naive (local server time)
        if start_time.tzinfo is not None:
            start_time = start_time.replace(tzinfo=None)
        diff = start_time - now
        hours_before = diff.total_seconds() / 3600.0
        return 0 < hours_before <= self.PRICING_CONFIG["hot_booking"]["hours_before"]

    def _compute_block_hours(
        self,
        user_uuid,
        resource_id: str,
        start_time: datetime,
        duration_minutes: int,
        exclude_booking_id: Optional[str] = None,
    ) -> float:
        """Sum hours of the contiguous booking chain at this slot.

        Looks up confirmed bookings for `user_uuid` in `resource_id` on the
        same calendar day, walks forwards and backwards from this booking's
        time range, and returns the total span (in hours). The current
        booking's own duration is included; if it's already saved in DB,
        pass `exclude_booking_id` to avoid double-counting.
        """
        day_start = start_time.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        q = select(Booking).where(
            Booking.user_uuid == user_uuid,
            Booking.resource_id == resource_id,
            Booking.status == "confirmed",
            Booking.date >= day_start,
            Booking.date < day_end,
        )
        if exclude_booking_id:
            q = q.where(Booking.id != exclude_booking_id)  # type: ignore[arg-type]
        others = self.session.exec(q).all()

        # Convert all into (start_min, end_min) ranges.
        ranges: list[tuple[int, int]] = []
        for b in others:
            try:
                h, m = (b.start_time or "00:00").split(":")
                s = int(h) * 60 + int(m)
                ranges.append((s, s + (b.duration or 0)))
            except Exception:
                continue
        # Current candidate booking
        target_s = start_time.hour * 60 + start_time.minute
        target_e = target_s + duration_minutes
        ranges.append((target_s, target_e))

        # Walk both directions to find the contiguous chain containing target.
        chain_start, chain_end = target_s, target_e
        expanded = True
        while expanded:
            expanded = False
            for s, e in ranges:
                if e == chain_start:
                    chain_start = s
                    expanded = True
                elif s == chain_end:
                    chain_end = e
                    expanded = True
        return (chain_end - chain_start) / 60.0

    def _get_weekly_accumulated_hours(
        self,
        user: User,
        start_time: datetime,
        exclude_booking_id: Optional[str] = None,
    ) -> float:
        """Sum confirmed booking hours for `user` in the same calendar week
        as `start_time`. Monday-start.

        `exclude_booking_id` skips one row by id — needed when re-pricing
        an existing booking (otherwise the booking under recalc counts
        itself in `weekly_hours` AND again via the `+ booked_hours` term
        in `calculate_price`, falsely pushing users into a higher tier).
        For new-booking creation (booking not yet inserted) pass None.
        """
        dt = start_time.replace(tzinfo=None) if start_time.tzinfo else start_time

        iso_day = dt.isoweekday()  # Monday=1 .. Sunday=7
        start_of_week = (dt - timedelta(days=iso_day - 1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        end_of_week = start_of_week + timedelta(days=7)

        stmt = select(Booking).where(
            (Booking.user_uuid == user.id) | (Booking.user_id == user.email),
            Booking.status == 'confirmed',
            Booking.date >= start_of_week,
            Booking.date < end_of_week,
        )
        if exclude_booking_id:
            stmt = stmt.where(Booking.id != exclude_booking_id)  # type: ignore[arg-type]
        bookings = self.session.exec(stmt).all()
        return sum(b.duration / 60.0 for b in bookings)

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
            # Peak hours debt: subscription covers base but peak surcharge = +5 GEL/hr
            if breakdown.peak_slot_count > 0:
                peak_hours = breakdown.peak_slot_count / 2.0
                sub_surcharge = self.PRICING_CONFIG["peak_hours"]["subscription_surcharge_gel"]
                breakdown.subscription_peak_debt = peak_hours * sub_surcharge
                breakdown.final_price = breakdown.subscription_peak_debt
            else:
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

    # Removed _apply_hot_booking as it is now integrated into calculate_price logic
