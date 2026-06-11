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
    let nonPeakHours = 0;
    let peakHoursCount = 0;
    let nonPeakBase = 0;
    let peakBase = 0;

    // Aligned with backend pricing.py (admin policy 2026-05-13):
    //   peak hours = base × hours + 5 ₾/h flat (BOTH base AND surcharge);
    //   discount applies to non-peak portion only;
    //   tiers are based on non-peak hours (peak hours don't bump tier).
    const peakSurchargePerHour = PRICING_CONFIG.peak_hours.surcharge_per_hour_gel;

    const accountSlot = (timeStr: string, rate: number) => {
        if (isPeakTime(timeStr)) {
            peakHoursCount += 0.5;
            peakSlotCount++;
            // Bug fix: peak base used to be skipped — admin reported
            // 09:00–10:00 = 5 ₾ instead of 25 ₾. Peak hours include the
            // standard rate AND the +5/h surcharge.
            peakBase += rate / 2;
        } else {
            nonPeakHours += 0.5;
            nonPeakBase += rate / 2;
        }
        totalMinutes += 30;
    };

    // 1. Base Price (separating peak vs non-peak)
    if (params.selectedSlots && params.selectedSlots.length > 0) {
        params.selectedSlots.forEach(slot => {
            const [rId, time] = slot.split('|');
            const rate = getBaseRate(rId, params.format);
            accountSlot(time, rate);
        });
    } else if (params.resourceId) {
        const rate = getBaseRate(params.resourceId, params.format);
        totalMinutes = 0; // re-counted by accountSlot below
        const minutes = differenceInMinutes(params.endTime, params.startTime);
        const startMins = params.startTime.getHours() * 60 + params.startTime.getMinutes();
        for (let m = startMins; m < startMins + minutes; m += 30) {
            const h = Math.floor(m / 60);
            const mm = m % 60;
            const timeStr = `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
            accountSlot(timeStr, rate);
        }
    }

    // peakTotal = base for those hours + flat surcharge × hours
    const peakSurchargeAmount = peakHoursCount * peakSurchargePerHour;
    const peakTotal = peakBase + peakSurchargeAmount;
    peakSurcharge = peakSurchargeAmount;
    totalBasePrice = nonPeakBase + peakTotal;

    // 2. Extras
    const extrasPrice = params.extras.reduce((sum, extra) => sum + extra.price, 0);

    // 3. Discounts (Priority Order: Subscription > Manual > Weekly > Hot)
    let discountAmount = 0;
    let discountType: 'none' | 'duration' | 'hot' | 'loyalty' | 'personal' = 'none';

    // Check Subscription (Payment Method)
    const isSubscription = params.paymentMethod === 'subscription';

    if (!isSubscription) {
        // 2026-05-20: pricing_system='personal' means the admin and client
        // negotiated a fixed rate. That rate is EXCLUSIVE — not a floor,
        // not part of MAX. Heavy users with personal rate were silently
        // losing it to weekly_progressive (e.g. Алла 25% → 50%, paid 30
        // instead of agreed 45). Skip tier checks entirely when personal
        // is set.
        const personalPercent = (params.pricingSystem === 'personal' && params.personalDiscountPercent && params.personalDiscountPercent > 0)
            ? params.personalDiscountPercent : 0;

        // 2026-05-21: discount applies to the FULL hourly base (peak + non-peak),
        // but NOT to the peak surcharge (+5 ₾/ч). Surcharge always charged in full.
        const fullBase = nonPeakBase + peakBase;
        if (personalPercent > 0) {
            discountAmount = fullBase * (personalPercent / 100);
            discountType = 'personal';
        } else {
            const hours = totalMinutes / 60;
            const totalWeeklyHours = (params.accumulatedWeeklyHours || 0) + hours;

            // Weekly Progressive — based on total hours including peak (this
            // is per-week accumulation, not per-booking duration).
            let weeklyPercent = 0;
            const weeklyTiers = PRICING_CONFIG.discounts.weekly_progressive;
            const matchWeekly = weeklyTiers.find(t => totalWeeklyHours >= t.min && totalWeeklyHours < t.max);
            if (matchWeekly) weeklyPercent = matchWeekly.percent;

            // Duration tier — based on NON-PEAK hours only (admin policy).
            let durationPercent = 0;
            const durationTiers = PRICING_CONFIG.discounts.duration;
            const matchDuration = durationTiers.find(t => nonPeakHours >= t.min && nonPeakHours < t.max);
            if (matchDuration) durationPercent = matchDuration.percent;

            // Apply BEST tier discount (max of weekly/duration) to FULL base.
            const maxPercent = Math.max(weeklyPercent, durationPercent);
            if (maxPercent > 0) {
                discountAmount = fullBase * (maxPercent / 100);
                if (maxPercent === durationPercent) discountType = 'duration';
                else if (maxPercent === weeklyPercent) discountType = 'loyalty';
            }
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
