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
        // Flat per-hour surcharge (was percent-of-base 25% — produced
        // inconsistent numbers for cab 7/8 group rate). Aligned with admin
        // policy: «утром-вечером стандартная цена + 5 лари/час».
        surcharge_per_hour_gel: 5,
        subscription_surcharge_gel: 5, // per peak hour when using subscription
        ranges: [
            { start: "09:00", end: "10:00" }, // 9:00–10:00
            // Вечерний пик 20:00–22:00. 13 мая сужали до 21–22, 20 мая
            // вернули обратно — admin confirmed что 20:00 должен считаться
            // как пиковый час.
            { start: "20:00", end: "22:00" },
        ],
    },
    discounts: {
        priority: ['SUBSCRIPTION', 'MANUAL_OVERRIDE', 'WEEKLY_PROGRESSIVE', 'CONSECUTIVE_HOURS', 'NONE'],
        hot_booking: {
            hours_before: 12,
            percent: 0  // No discount — only admin approval for bookings <12h
        },
        // Admin 2026-05-13: верхняя граница каждого тира — ВКЛЮЧИТЕЛЬНО.
        // «до 3 включительно — 10%, до 5 включительно — 15%, больше — 20%».
        // Бронь шагает по 30-мин слотам, так что верхняя граница `max`
        // выставлена на полшага выше реальной верхней (3.5 / 5.5) — это даёт
        // 2.0–3.0 → 10%, 3.5–5.0 → 15%, 5.5+ → 20% при сравнении `min ≤ h < max`.
        // 2026-05-21: tier boundaries reverted. 3h → 15%, 5h → 20%.
        duration: [
            { min: 2, max: 3, percent: 10 },
            { min: 3, max: 5, percent: 15 },
            { min: 5, max: 9999, percent: 20 },
        ],
        // 2026-05-21: weekly_progressive disabled — admin wants
        // predictable prices; explicit personal discount only.
        weekly_progressive: [
            { min: 0, max: 9999, percent: 0 },
        ],
    },
    weekly_reconciliation_bonus: {
        enabled: true,
        wallet_name: "bonus_balance",
        currency: "GEL",
        expiry_days: 60
    }
} as const;
