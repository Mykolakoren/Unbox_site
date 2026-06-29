import { api } from './client';
import type { PriceBreakdown } from '../store/types';

export const pricingApi = {
    getQuote: async (payload: {
        resource_id: string;
        start_time: string; // ISO string
        duration_minutes: number;
        format_type: 'individual' | 'group' | 'intervision';
    }) => {
        const response = await api.post<PriceBreakdown>('/pricing/quote', payload);
        return response.data;
    },

    /** Недельный перерасчёт скидки. dryRun=true — только посчитать суммы. */
    runWeeklyRebate: async (dryRun: boolean, weekStart?: string): Promise<{
        week_start: string; dry_run: boolean; users_credited: number;
        total_credited: number; skipped_already_done: number;
        details: { user_name: string; rebate: number; tier_percent: number; total_hours: number }[];
    }> => {
        const response = await api.post('/pricing/weekly-rebate/run', { dry_run: dryRun, week_start: weekStart ?? null });
        return response.data;
    },
};
