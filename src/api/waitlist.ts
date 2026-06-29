import { api } from './client';
import type { WaitlistEntry } from '../store/types';

// Map Backend -> Frontend
// Input 'w' is already camelCase from client interceptor.
const mapToFrontend = (w: any): WaitlistEntry => ({
    ...w,
    // Interface matches transformed keys (resourceId, startTime, userId, createdAt)
    // No special mapping needed if names align.
    // Just ensure types.
});

// Map Frontend -> Backend
// Output camelCase, client interceptor converts to snake_case.
const mapToBackend = (w: Partial<WaitlistEntry>): any => ({
    ...w,
    // No special mapping needed if Interface matches Backend logic names.
});

export const waitlistApi = {
    getMyWaitlist: async (skip = 0, limit = 100) => {
        const response = await api.get<any[]>('/waitlist/my', {
            params: { skip, limit }
        });
        return response.data.map(mapToFrontend);
    },

    /** Admin-only: every active waitlist entry across all users. Used by
     *  the admin waitlist page (desktop + /m/admin/cabinets). */
    getAllWaitlistAdmin: async (skip = 0, limit = 500) => {
        const response = await api.get<any[]>('/waitlist/admin/all', {
            params: { skip, limit },
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
    },

    /** Admin: вручную уведомить клиента из листа ожидания о его слоте. */
    notifyEntry: async (id: string): Promise<{ ok: boolean; notified: string }> => {
        const response = await api.post<any>(`/waitlist/${id}/notify`);
        return response.data;
    },
};
