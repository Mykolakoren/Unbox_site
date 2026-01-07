export const PRICING_CONFIG = {
    meta: {
        currency: 'GEL',
        pricing_version: '2025-12-27',
    },
    base_rates: {
        ROOM: {
            IND: 20,
            GRP: 35,
        },
        CAP: {
            IND: 10,
            GRP: 10, // Assuming group cap is same/na, defaulting to 10
        }
    },
    discounts: {
        priority: ['SUBSCRIPTION', 'MANUAL_OVERRIDE', 'WEEKLY_PROGRESSIVE', 'HOT_BOOKING', 'NONE'],
        hot_booking: {
            hours_before: 12,
            percent: 10
        },
        duration: [
            { min: 2, max: 2.99, percent: 10 },
            { min: 3, max: 3.99, percent: 15 },
            { min: 4, max: 9999, percent: 20 },
        ],
        weekly_progressive: [
            { min: 0, max: 4.999, percent: 0 },
            { min: 5, max: 10.999, percent: 10 },
            { min: 11, max: 15.999, percent: 25 },
            { min: 16, max: 9999, percent: 50 },
        ]
    },
    weekly_reconciliation_bonus: {
        enabled: true,
        wallet_name: "bonus_balance",
        currency: "GEL",
        expiry_days: 60
    }
} as const;
