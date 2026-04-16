import { RESOURCES, EXTRAS } from './data';
import { differenceInMinutes } from 'date-fns';
import type { Format, PricingResult, ExtraOption, BookingState } from '../types';
import { PRICING_CONFIG } from './pricingConfig';

/** Check if a "HH:mm" time string falls into a peak-hour range */
export function isPeakTime(time: string): boolean {
    const mins = timeToMinutes(time);
    return PRICING_CONFIG.peak_hours.ranges.some(r => {
        const s = timeToMinutes(r.start);
        const e = timeToMinutes(r.end);
        return mins >= s && mins < e;
    });
}

function timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

export interface PricingParams {
    format: Format;
    startTime: Date;
    endTime: Date;
    extras: ExtraOption[];
    resourceId?: string;
    selectedSlots?: string[];
    paymentMethod?: 'balance' | 'subscription' | 'bonus';
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
    const formatCode: 'IND' | 'GRP' | 'INTV' =
        format === 'group' ? 'GRP' :
        format === 'intervision' ? 'INTV' : 'IND';

    // Lookup Rate
    return PRICING_CONFIG.base_rates[spaceType][formatCode];
};

export const calculatePrice = (params: PricingParams): PricingResult => {
    let totalBasePrice = 0;
    let totalMinutes = 0;
    let peakSurcharge = 0;
    let peakSlotCount = 0;

    const surchargePercent = PRICING_CONFIG.peak_hours.surcharge_percent;

    // 1. Base Price (with peak hours surcharge)
    if (params.selectedSlots && params.selectedSlots.length > 0) {
        params.selectedSlots.forEach(slot => {
            const [rId, time] = slot.split('|');
            const rate = getBaseRate(rId, params.format);
            const slotBase = rate / 2; // 30 min slot
            if (isPeakTime(time)) {
                const surcharge = slotBase * (surchargePercent / 100);
                peakSurcharge += surcharge;
                peakSlotCount++;
                totalBasePrice += slotBase + surcharge;
            } else {
                totalBasePrice += slotBase;
            }
            totalMinutes += 30;
        });
    } else if (params.resourceId) {
        const rate = getBaseRate(params.resourceId, params.format);
        totalMinutes = differenceInMinutes(params.endTime, params.startTime);
        // Check each 30-min slot within the range for peak hours
        const startMins = params.startTime.getHours() * 60 + params.startTime.getMinutes();
        for (let m = startMins; m < startMins + totalMinutes; m += 30) {
            const h = Math.floor(m / 60);
            const mm = m % 60;
            const timeStr = `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
            const slotBase = rate / 2;
            if (isPeakTime(timeStr)) {
                const surcharge = slotBase * (surchargePercent / 100);
                peakSurcharge += surcharge;
                peakSlotCount++;
                totalBasePrice += slotBase + surcharge;
            } else {
                totalBasePrice += slotBase;
            }
        }
    }

    // 2. Extras
    const extrasPrice = params.extras.reduce((sum, extra) => sum + extra.price, 0);

    // 3. Discounts (Priority Order: Subscription > Manual > Weekly > Hot)
    let discountAmount = 0;
    let discountType: 'none' | 'duration' | 'hot' | 'loyalty' | 'personal' = 'none';

    // Check Subscription (Payment Method)
    const isSubscription = params.paymentMethod === 'subscription';

    if (!isSubscription) {
        // Collect ALL discount candidates, apply the MAX one (no stacking)
        const personalPercent = (params.pricingSystem === 'personal' && params.personalDiscountPercent && params.personalDiscountPercent > 0)
            ? params.personalDiscountPercent : 0;

        const hours = totalMinutes / 60;
        const totalWeeklyHours = (params.accumulatedWeeklyHours || 0) + hours;

        // Weekly Progressive
        let weeklyPercent = 0;
        const weeklyTiers = PRICING_CONFIG.discounts.weekly_progressive;
        const matchWeekly = weeklyTiers.find(t => totalWeeklyHours >= t.min && totalWeeklyHours < t.max);
        if (matchWeekly) weeklyPercent = matchWeekly.percent;

        // Duration (Consecutive)
        let durationPercent = 0;
        const durationTiers = PRICING_CONFIG.discounts.duration;
        const matchDuration = durationTiers.find(t => hours >= t.min && hours < t.max);
        if (matchDuration) durationPercent = matchDuration.percent;

        // Hot Booking: no discount, only admin approval (handled server-side)

        // Apply BEST discount (max of all — no stacking)
        const maxPercent = Math.max(personalPercent, weeklyPercent, durationPercent);

        if (maxPercent > 0) {
            discountAmount = totalBasePrice * (maxPercent / 100);

            // Determine Type for UI Label
            if (maxPercent === personalPercent && personalPercent > 0) discountType = 'personal';
            else if (maxPercent === durationPercent) discountType = 'duration';
            else if (maxPercent === weeklyPercent) discountType = 'loyalty';
        }
    }

    const finalPrice = Math.max(0, totalBasePrice + extrasPrice - discountAmount);

    // Subscription + peak hours → debt for surcharge
    let subscriptionPeakDebt = 0;
    if (isSubscription && peakSlotCount > 0) {
        const peakHours = peakSlotCount / 2; // 30-min slots → hours
        subscriptionPeakDebt = peakHours * PRICING_CONFIG.peak_hours.subscription_surcharge_gel;
    }

    return {
        basePrice: totalBasePrice,
        extrasPrice,
        discountAmount,
        discountType,
        finalPrice: isSubscription ? subscriptionPeakDebt : finalPrice,
        peakSurcharge,
        peakSlotCount,
        subscriptionPeakDebt,
    };
};
