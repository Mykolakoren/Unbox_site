import { api } from './client';
import type { BookingHistoryItem } from '../store/types';

// Map Backend -> Frontend
// Note: api/client.ts intercepts response and converts snake_case to camelCase automatically.
// So 'b' here is already mostly camelCase.
// We just need to fix mismatches between transformed keys and Interface keys.
const mapToFrontend = (b: any): BookingHistoryItem => ({
    ...b,
    // Interface expects googleCalendarEventId, Transformer gives gcalEventId (from gcal_event_id)
    googleCalendarEventId: b.gcalEventId || b.googleCalendarEventId,
    // Interface expects 'createdAt', Transformer gives 'createdAt' (from created_at).
    // Previous manual map expected 'dateCreated' or 'created_at'.
    // Ensure we don't overwrite if unnecessary.
    createdAt: b.createdAt || b.dateCreated || new Date().toISOString(),
});

// Map Frontend -> Backend
// Note: api/client.ts intercepts request and converts camelCase to snake_case automatically.
// So we just need to produce a clean camelCase object that leads to the correct snake_case keys.
const mapToBackend = (b: Partial<BookingHistoryItem>): any => ({
    ...b,
    // Interface: googleCalendarEventId. Backend (via transformer): Needs gcalEventId -> gcal_event_id
    gcalEventId: b.googleCalendarEventId,
    // Remove interface-only or derived fields if needed, but extra fields might be ignored by backend Pydantic.
    // Explicitly handle date formatting if strict.
    // Backend expects 'date' as YYYY-MM-DD or ISO.
    // Backend expects 'targetUserId' -> target_user_id (handled by transformer).
});

export const bookingsApi = {
    getMyBookings: async (skip = 0, limit = 100) => {
        const response = await api.get<any[]>('/bookings/me', {
            params: { skip, limit }
        });
        return response.data.map(mapToFrontend);
    },

    getAllBookings: async (skip = 0, limit = 1000) => {
        const response = await api.get<any[]>('/bookings', {
            params: { skip, limit }
        });
        return response.data.map(mapToFrontend);
    },

    getPublicBookings: async () => {
        const response = await api.get<any[]>('/bookings/public');
        return response.data.map(mapToFrontend);
    },

    createBooking: async (booking: Partial<BookingHistoryItem>) => {
        const payload = mapToBackend(booking);
        const response = await api.post<any>('/bookings', payload);
        return mapToFrontend(response.data);
    },

    getBooking: async (id: string) => {
        const response = await api.get<any>(`/bookings/${id}`);
        return mapToFrontend(response.data);
    },

    cancelBooking: async (id: string) => {
        const response = await api.delete<any>(`/bookings/${id}`);
        return mapToFrontend(response.data);
    }
};
