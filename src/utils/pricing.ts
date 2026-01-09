import { RESOURCES, EXTRAS } from './data';
import { differenceInMinutes } from 'date-fns';
import type { Format, PricingResult, ExtraOption, BookingState } from '../types';
import { PRICING_CONFIG } from './pricingConfig';

export interface PricingParams {
    format: Format;
    startTime: Date;
    endTime: Date;
    extras: ExtraOption[];
    resourceId?: string;
    selectedSlots?: string[];
    paymentMethod?: 'balance' | 'subscription';
    accumulatedWeeklyHours?: number;
    // User Settings
    personalDiscountPercent?: number;
    pricingSystem?: 'standard' | 'personal';
}

// Helper: Convert BookingState to PricingParams
export const mapStateToParams = (state: BookingState): PricingParams => {
    // Map string[] IDs to ExtraOption[]
    const bookingExtras = state.extras.map(id => EXTRAS.find(e => e.id === id)).filter(Boolean) as ExtraOption[];

    // Determine start/end from props or slots
    let start = state.date;
    let end = new Date(state.date.getTime() + (state.duration * 60000));

    if (state.selectedSlots && state.selectedSlots.length > 0) {
        // Find min/max from slots
        const times = state.selectedSlots.map(s => s.split('|')[1]);
        times.sort();
        const [h1, m1] = times[0].split(':').map(Number);
        const [h2, m2] = times[times.length - 1].split(':').map(Number);

        start = new Date(state.date);
        start.setHours(h1, m1, 0, 0);

        end = new Date(state.date);
        end.setHours(h2, m2 + 30, 0, 0); // +30 min for last slot
    } else if (state.startTime) {
        const [h, m] = state.startTime.split(':').map(Number);
        start = new Date(state.date);
        start.setHours(h, m, 0, 0);
        end = new Date(start.getTime() + (state.duration * 60000));
    }

    return {
        format: state.format,
        startTime: start,
        endTime: end,
        extras: bookingExtras,
        resourceId: state.resourceId || undefined,
        selectedSlots: state.selectedSlots,
        paymentMethod: state.paymentMethod,
    };
};

// Helper: Get base rate from Resource ID and Format
const getBaseRate = (resourceId: string, format: Format): number => {
    const resource = RESOURCES.find(r => r.id === resourceId);
    if (!resource) return 20; // Fallback

    // Determine Space Type
    const isCapsule = resource.type === 'capsule';
    const spaceType = isCapsule ? 'CAP' : 'ROOM';

    // Determine Format Code
    const formatCode = format === 'group' ? 'GRP' : 'IND';

    // Lookup Rate
    return PRICING_CONFIG.base_rates[spaceType][formatCode];
};

export const calculatePrice = (params: PricingParams): PricingResult => {
    let totalBasePrice = 0;
    let totalMinutes = 0;

    // 1. Base Price
    if (params.selectedSlots && params.selectedSlots.length > 0) {
        params.selectedSlots.forEach(slot => {
            const [rId] = slot.split('|');
            const rate = getBaseRate(rId, params.format);
            totalBasePrice += (rate / 2); // 30 min slot
            totalMinutes += 30;
        });
    } else if (params.resourceId) {
        const rate = getBaseRate(params.resourceId, params.format);
        totalMinutes = differenceInMinutes(params.endTime, params.startTime);
        totalBasePrice = (rate / 60) * totalMinutes;
    }

    // 2. Extras
    const extrasPrice = params.extras.reduce((sum, extra) => sum + extra.price, 0);

    // 3. Discounts (Priority Order: Subscription > Manual > Weekly > Hot)
    let discountAmount = 0;
    let discountType: 'none' | 'duration' | 'hot' | 'loyalty' | 'personal' = 'none';

    // Check Subscription (Payment Method)
    const isSubscription = params.paymentMethod === 'subscription';

    if (!isSubscription) {
        // Check for Personal Pricing System
        if (params.pricingSystem === 'personal' && params.personalDiscountPercent && params.personalDiscountPercent > 0) {
            discountAmount = totalBasePrice * (params.personalDiscountPercent / 100);
            discountType = 'personal';
        } else {
            // Standard Pricing System (Duration, Weekly, Hot)
            const hours = totalMinutes / 60;
            const totalWeeklyHours = (params.accumulatedWeeklyHours || 0) + hours;

            // A. Weekly Progressive
            let weeklyPercent = 0;
            const weeklyTiers = PRICING_CONFIG.discounts.weekly_progressive;
            const matchWeekly = weeklyTiers.find(t => totalWeeklyHours >= t.min && totalWeeklyHours < t.max);
            if (matchWeekly) weeklyPercent = matchWeekly.percent;

            // B. Duration (Consecutive)
            let durationPercent = 0;
            const durationTiers = PRICING_CONFIG.discounts.duration;
            const matchDuration = durationTiers.find(t => hours >= t.min && hours < t.max);
            if (matchDuration) durationPercent = matchDuration.percent;

            // C. Hot Booking
            let hotPercent = 0;
            const now = new Date();
            const diffHours = differenceInMinutes(params.startTime, now) / 60;
            if (diffHours >= 0 && diffHours <= PRICING_CONFIG.discounts.hot_booking.hours_before) {
                hotPercent = PRICING_CONFIG.discounts.hot_booking.percent;
            }

            // Apply Best Discount (Max)
            const maxPercent = Math.max(weeklyPercent, durationPercent, hotPercent);

            if (maxPercent > 0) {
                discountAmount = totalBasePrice * (maxPercent / 100);

                // Determine Type for UI Label
                if (maxPercent === durationPercent) discountType = 'duration';
                else if (maxPercent === weeklyPercent) discountType = 'loyalty';
                else discountType = 'hot';
            }
        }
    }

    const finalPrice = Math.max(0, totalBasePrice + extrasPrice - discountAmount);

    return {
        basePrice: totalBasePrice,
        extrasPrice,
        discountAmount,
        discountType,
        finalPrice,
    };
};
