import type { Format, PricingResult, ExtraOption } from '../types';
import { differenceInMinutes } from 'date-fns';

export interface PricingParams {
    format: Format;
    startTime: Date; // Full Date object including time
    endTime: Date;   // Full Date object including time
    extras: ExtraOption[];
    loyaltyLevel: 'none' | 'silver' | 'gold';
}

export function calculatePrice(params: PricingParams): PricingResult {
    const { format, startTime, endTime, extras, loyaltyLevel } = params;

    // Calculate duration in hours
    const minutes = differenceInMinutes(endTime, startTime);
    const hours = minutes / 60;

    // Base Rate
    const hourlyRate = format === 'individual' ? 20 : 35;
    const basePrice = hourlyRate * hours;

    // Extras Cost
    const extrasPrice = extras.reduce((sum, extra) => sum + extra.price, 0);

    // Discounts Logic
    // 1. Duration >= 2h -> 10%
    let discountType: PricingResult['discountType'] = 'none';
    let maxDiscountPercent = 0;

    if (hours >= 2) {
        if (0.10 > maxDiscountPercent) {
            maxDiscountPercent = 0.10;
            discountType = 'duration';
        }
    }

    // 2. Hot Deal (within 24h)
    const now = new Date();
    const timeUntillStart = differenceInMinutes(startTime, now) / 60;
    // If start time is within 24h (and in future)
    if (timeUntillStart >= 0 && timeUntillStart <= 24) {
        if (0.15 > maxDiscountPercent) {
            maxDiscountPercent = 0.15;
            discountType = 'hot';
        }
    }

    // 3. Loyalty
    let loyaltyDiscount = 0;
    if (loyaltyLevel === 'silver') loyaltyDiscount = 0.05;
    if (loyaltyLevel === 'gold') loyaltyDiscount = 0.10;

    if (loyaltyDiscount > maxDiscountPercent) {
        maxDiscountPercent = loyaltyDiscount;
        discountType = 'loyalty';
    }

    // Apply discount to BASE price only
    const discountAmount = basePrice * maxDiscountPercent;
    const finalPrice = (basePrice - discountAmount) + extrasPrice;

    return {
        basePrice,
        extrasPrice,
        discountAmount,
        discountType,
        finalPrice
    };
}
