import { api } from './client';
import type { BookingHistoryItem } from '../store/types';

// Map Backend -> Frontend
const mapToFrontend = (b: any): BookingHistoryItem => ({
    ...b,
    resourceId: b.resource_id,
    locationId: b.location_id,
    startTime: b.start_time,
    finalPrice: b.final_price,
    paymentMethod: b.payment_method,
    paymentSource: b.payment_source,
    userId: b.user_id, // backend sends user_id now
    dateCreated: b.created_at,
    isReRentListed: b.is_re_rent_listed,
    cancellationReason: b.cancellation_reason,
    cancelledBy: b.cancelled_by,
    // Ensure Date object for date if needed, but string ISO is fine for BookingHistoryItem date: string | Date
    // logic in store uses new Date(b.date) usually.
});

// Map Frontend -> Backend
const mapToBackend = (b: Partial<BookingHistoryItem>): any => ({
    ...b,
    resource_id: b.resourceId,
    location_id: b.locationId,
    start_time: b.startTime,
    final_price: b.finalPrice,
    payment_method: b.paymentMethod,
    payment_source: b.paymentSource,
    format: b.format || 'individual',
    date: b.date, // frontend sends ISO string or Date
    target_user_id: (b as any).targetUserId // Mapped from ad-hoc property added in ConfirmationStep
});

export const bookingsApi = {
    getMyBookings: async (skip = 0, limit = 100) => {
        const response = await api.get<any[]>('/bookings/me', {
            params: { skip, limit }
        });
        return response.data.map(mapToFrontend);
    },

    getAllBookings: async (skip = 0, limit = 1000) => {
        const response = await api.get<any[]>('/bookings/', {
            params: { skip, limit }
        });
        return response.data.map(mapToFrontend);
    },

    createBooking: async (booking: Partial<BookingHistoryItem>) => {
        const payload = mapToBackend(booking);
        const response = await api.post<any>('/bookings/', payload);
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
