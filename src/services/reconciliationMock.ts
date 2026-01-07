import { PRICING_CONFIG } from '../utils/pricingConfig';
// import { BookingHistoryItem } from '../store/userStore'; // Import from userStore where it is likely defined or types if found there
// Actually, let me check where BookingHistoryItem is.
// Based on previous file views, BookingHistoryItem is in userStore.ts
// But wait, the userStore exports it?
// Let's assume BookingHistoryItem is the right type for "completed bookings" (history).

// Re-importing correctly based on finding.
import { startOfWeek, endOfWeek, subWeeks, isWithinInterval } from 'date-fns';

// Defining a minimal interface if not found, or using `any` for now to avoid blocking if type is complex.
// But better to use the real type. I'll use 'any' cast if import fails? 
// No, I'll try to import BookingHistoryItem from userStore or define a local interface.
interface Booking {
    date: Date | string;
    status: string;
    duration: number;
    price?: {
        amount: number;
        basePrice?: number;
    };
}

/**
 * Service to handle the "Weekly Reconciliation" logic described in pricing_policy.yaml.
 * 
 * Logic:
 * 1. Compute total_base_week_price from all eligible bookings.
 * 2. Determine weekly_discount_percent from total fulfilled hours using weekly_progressive tiers.
 * 3. ideal_week_price = total_base_week_price * (1 - weekly_discount_percent)
 * 4. actually_paid_week_price = sum(final_price_paid)
 * 5. delta = actually_paid_week_price - ideal_week_price
 * 6. if delta > 0 => credit delta to bonus_wallet
 */
export const reconciliationService = {
    /**
     * Simulates running the weekly reconciliation for a specific user.
     * @param bookings List of user's bookings (history)
     * @param date Date to run reconciliation for (usually "now", looking back at previous week)
     */
    runWeeklyReconciliation: (bookings: Booking[], date: Date = new Date()) => {
        // 1. Determine previous week's range
        const prevWeekStart = startOfWeek(subWeeks(date, 1), { weekStartsOn: 1 });
        const prevWeekEnd = endOfWeek(subWeeks(date, 1), { weekStartsOn: 1 });

        console.log(`Running Reconciliation for week: ${prevWeekStart.toLocaleDateString()} - ${prevWeekEnd.toLocaleDateString()}`);

        // 2. Filter bookings for that week (Confirmed only)
        const weekBookings = bookings.filter(b => {
            const bookingDate = new Date(b.date);
            return isWithinInterval(bookingDate, { start: prevWeekStart, end: prevWeekEnd }) && b.status === 'confirmed';
        });

        if (weekBookings.length === 0) {
            console.log("No bookings found for the previous week.");
            return null;
        }

        // 3. Calculate Totals
        let totalBasePrice = 0;
        let totalPaidPrice = 0;
        let totalMinutes = 0;

        weekBookings.forEach(b => {
            const paid = b.price?.amount || 0;
            const base = b.price?.basePrice || paid; // Fallback

            totalBasePrice += base;
            totalPaidPrice += paid;
            totalMinutes += b.duration;
        });

        const totalHours = totalMinutes / 60;
        console.log(`Total Hours: ${totalHours.toFixed(2)}, Total Paid: ${totalPaidPrice}, Total Base: ${totalBasePrice}`);

        // 4. Determine Weekly Discount Tier
        const tiers = PRICING_CONFIG.discounts.weekly_progressive;
        const applicableTier = tiers.find(t => totalHours >= t.min && totalHours <= t.max);
        const discountPercent = applicableTier ? applicableTier.percent : 0;

        // 5. Calculate Ideal Price
        const idealPrice = totalBasePrice * (1 - discountPercent / 100);

        // 6. Calculate Delta (Cashback)
        const delta = totalPaidPrice - idealPrice;

        console.log(`Weekly Discount: ${discountPercent}%`);
        console.log(`Ideal Price: ${idealPrice.toFixed(2)}`);
        console.log(`Delta (Potential Bonus): ${delta.toFixed(2)}`);

        if (delta > 0.01) {
            const bonus = parseFloat(delta.toFixed(2));
            console.log(`🎉 CREDIT BONUS: ${bonus} ${PRICING_CONFIG.weekly_reconciliation_bonus.currency} to ${PRICING_CONFIG.weekly_reconciliation_bonus.wallet_name}`);
            return {
                amount: bonus,
                currency: PRICING_CONFIG.weekly_reconciliation_bonus.currency,
                reason: `Weekly Reconciliation (Paid: ${totalPaidPrice}, Ideal: ${idealPrice})`,
                validUntil: new Date(Date.now() + PRICING_CONFIG.weekly_reconciliation_bonus.expiry_days * 24 * 60 * 60 * 1000)
            };
        } else {
            console.log('No bonus to credit (paid amount is equal or less than ideal).');
            return null;
        }
    }
};
