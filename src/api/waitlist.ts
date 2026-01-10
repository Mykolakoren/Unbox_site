import { api } from './client';
import type { WaitlistEntry } from '../store/types';

// Map Backend -> Frontend
const mapToFrontend = (w: any): WaitlistEntry => ({
    ...w,
    resourceId: w.resource_id,
    startTime: w.start_time,
    endTime: w.end_time,
    userId: w.user_id,
    dateCreated: w.created_at,
});

// Map Frontend -> Backend
const mapToBackend = (w: Partial<WaitlistEntry>): any => ({
    ...w,
    resource_id: w.resourceId,
    start_time: w.startTime,
    end_time: w.endTime,
});

export const waitlistApi = {
    getMyWaitlist: async (skip = 0, limit = 100) => {
        const response = await api.get<any[]>('/waitlist/my', {
            params: { skip, limit }
        });
        return response.data.map(mapToFrontend);
    },

    addToWaitlist: async (entry: Partial<WaitlistEntry>) => {
        const payload = mapToBackend(entry);
        const response = await api.post<any>('/waitlist/', payload);
        return mapToFrontend(response.data);
    },

    removeFromWaitlist: async (id: string) => {
        const response = await api.delete<any>(`/waitlist/${id}`);
        return mapToFrontend(response.data);
    }
};
