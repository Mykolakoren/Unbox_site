import type { BookingHistoryItem } from '../../store/types';

/**
 * Booking price label, payment-method-aware.
 *
 * When a booking is paid with subscription hours (or via the welcome/bonus
 * pool), showing the GEL `finalPrice` confuses users — they paid in hours,
 * not lari. Server stores the GEL "would-be" price for accounting, but the UI
 * should reflect what was actually deducted.
 *
 * Usage:
 *   <span>{priceLabel(booking)}</span>
 *
 * Rules:
 *   - paymentMethod === 'subscription' → "1.5 ч из абонемента"
 *   - paymentMethod === 'bonus'        → "1 ч из бонусов"
 *   - else (balance / unknown legacy)  → "60 ₾"
 *   - if finalPrice is 0 (admin-zero / promo)        → "Бесплатно"
 */
export function priceLabel(b: BookingHistoryItem): string {
    const method = (b as any).paymentMethod as string | undefined;
    const hoursDeducted = b.hoursDeducted ?? ((b.duration ?? 60) / 60);
    const price = b.finalPrice ?? 0;

    if (method === 'subscription') {
        return `${formatHours(hoursDeducted)} из абонемента`;
    }
    if (method === 'bonus') {
        return `${formatHours(hoursDeducted)} из бонусов`;
    }
    if (price <= 0) return 'Бесплатно';
    return `${price.toFixed(0)} ₾`;
}

function formatHours(h: number): string {
    if (h % 1 === 0) return `${h} ч`;
    return `${h.toFixed(1)} ч`;
}
