export const PRICING_CONFIG = {
    meta: {
        currency: 'GEL',
        pricing_version: '2026-04-03',
    },
    base_rates: {
        ROOM: {
            IND: 20,
            GRP: 35,
            INTV: 30, // Intervision: group price variant for peer supervision
        },
        CAP: {
            IND: 10,
            GRP: 10, // Assuming group cap is same/na, defaulting to 10
            INTV: 10,
        }
    },
    peak_hours: {
        surcharge_percent: 25,
        subscription_surcharge_gel: 5, // per peak hour when using subscription
        ranges: [
            { start: "09:00", end: "10:00" }, // 9:00–10:00
            { start: "20:00", end: "22:00" }, // 20:00–22:00
        ],
    },
    discounts: {
        priority: ['SUBSCRIPTION', 'MANUAL_OVERRIDE', 'WEEKLY_PROGRESSIVE', 'CONSECUTIVE_HOURS', 'NONE'],
        hot_booking: {
            hours_before: 12,
            percent: 0  // No discount — only admin approval for bookings <12h
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
