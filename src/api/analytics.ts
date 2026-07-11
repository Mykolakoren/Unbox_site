import { api } from './client';

export interface CenterStat {
    locationId: string; name: string;
    revenue: number; bookings: number; hours: number; avgCheck: number;
    rooms: number; availableHours: number; occupancyPct: number;
}
export interface RoomStat {
    resourceId: string; name: string; locationId: string;
    hours: number; bookings: number; revenue: number; occupancyPct: number;
}
export interface AdminStat {
    adminId: string; name: string;
    cashIncome: number; cashExpense: number; cashOps: number;
    bookingsCreated: number; bookingsRevenue: number;
}
export interface OwnerAnalytics {
    period: { from: string; to: string; days: number };
    summary: { revenue: number; bookings: number; hours: number; occupancyPct: number; avgCheck: number };
    byCenter: CenterStat[];
    byRoom: RoomStat[];
    byAdmin: AdminStat[];
    adminBookingsTracked: number;
}
export interface MonthlyMetric {
    month: string; revenue: number; bookings: number; hours: number;
    occupancyPct: number; avgCheck: number; data: OwnerAnalytics;
}

export const analyticsApi = {
    getOwner: async (dateFrom?: string, dateTo?: string): Promise<OwnerAnalytics> => {
        const r = await api.get('/analytics/owner', { params: { date_from: dateFrom, date_to: dateTo } });
        return r.data;
    },
    getHistory: async (limit = 24): Promise<MonthlyMetric[]> => {
        const r = await api.get('/analytics/history', { params: { limit } });
        return r.data;
    },
    snapshot: async (month?: string): Promise<{ ok: boolean; month: string; revenue: number }> => {
        const r = await api.post('/analytics/snapshot', null, { params: { month } });
        return r.data;
    },
};
