import { api } from './client';
import type { PriceBreakdown } from '../store/types';

export const pricingApi = {
    getQuote: async (payload: {
        resource_id: string;
        start_time: string; // ISO string
        duration_minutes: number;
        format_type: 'individual' | 'group';
    }) => {
        const response = await api.post<PriceBreakdown>('/pricing/quote', payload);
        return response.data;
    }
};
