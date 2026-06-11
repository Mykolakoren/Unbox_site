import { api } from './client';
import type { BookingHistoryItem } from '../store/types';

// Map Backend -> Frontend
// Note: api/client.ts intercepts response and converts snake_case to camelCase automatically.
// So 'b' here is already mostly camelCase.
// We just need to fix mismatches between transformed keys and Interface keys.
/**
 * Normalise startTime to "HH:MM" format. Backend should always send this,
 * but defending here means a bad row can't crash every consumer that does
 * `.startTime.split(':')` (chessboard, summary, timeline, pricing).
 */
function normaliseStartTime(t: any): string {
    if (typeof t !== 'string' || !t.includes(':')) return '00:00';
    const parts = t.split(':');
    const h = parts[0]?.padStart(2, '0') ?? '00';
    const m = parts[1]?.padStart(2, '0') ?? '00';
    return `${h}:${m}`;
}

const mapToFrontend = (b: any): BookingHistoryItem => ({
    ...b,
    // Interface expects googleCalendarEventId, Transformer gives gcalEventId (from gcal_event_id)
    googleCalendarEventId: b.gcalEventId || b.googleCalendarEventId,
    // Interface expects 'createdAt', Transformer gives 'createdAt' (from created_at).
    // Previous manual map expected 'dateCreated' or 'created_at'.
    // Ensure we don't overwrite if unnecessary.
    createdAt: b.createdAt || b.dateCreated || new Date().toISOString(),
    // Public bookings (/bookings/public) hide user_id for privacy — default to ''
    // so downstream code calling .split/.includes on userId doesn't crash.
    userId: b.userId ?? '',
    // Public bookings also hide final_price — default to 0 so rendering doesn't NaN.
    finalPrice: b.finalPrice ?? 0,
    // Defensive defaults for fields that crashed admin pages on edge data:
    // a missing duration / startTime crashed the chessboard with split-on-undefined.
    startTime: normaliseStartTime(b.startTime),
    duration: typeof b.duration === 'number' ? b.duration : 60,
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
    getMyBookings: async (skip = 0, limit = 2000) => {
        // Default raised from 100 → 2000. With 100, heavy users (Mykola
        // had 106 bookings) silently lost their newest rows from the
        // result; the chessboard then fell back to the public anonymous
        // copy and rendered each missing booking as "Занято" because
        // userId was empty. Backend caps at 2000 too.
        const response = await api.get<any[]>('/bookings/me', {
            params: { skip, limit }
        });
        return response.data.map(mapToFrontend);
    },

    getAllBookings: async (skip = 0, limit = 5000) => {
        // 5000 — enough headroom for ~12 months of activity at scale;
        // backend caps at 20k. Bumped from 1000 because admins reported
        // newly-placed recurring bookings missing from the chessboard
        // (1000 fit the historical slow-growth count, but with 800+
        // weekly recurring rows the tail got truncated).
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

    /**
     * Cancel a booking. Excel #66 — admins can override the default full-refund
     * with a penalty percentage; clients' refund_percent is ignored server-side.
     *
     *   refundPercent: 1.0 = full refund, 0.5 = 50% penalty, 0.0 = full penalty.
     *   reason: free-text audit note (shown in booking history for admin-penalised cancels).
     */
    cancelBooking: async (id: string, opts?: { refundPercent?: number; reason?: string }) => {
        const params: Record<string, any> = {};
        if (opts?.refundPercent !== undefined) params.refund_percent = opts.refundPercent;
        if (opts?.reason) params.reason = opts.reason;
        const response = await api.delete<any>(`/bookings/${id}`, { params });
        return mapToFrontend(response.data);
    },

    /**
     * Admin: waive the charge on a booking. If the row was `paid`, money/hours
     * are refunded; if `pending`, the cron simply skips it. Reason is required.
     * Generates a TG admin alert + notifies the booking owner.
     */
    waiveCharge: async (id: string, reason: string): Promise<{ ok: boolean; scenario: string; payment_status: string }> => {
        const response = await api.post(`/billing/bookings/${id}/waive`, { reason });
        return response.data;
    },

    /**
     * Switch a booking between individual and group format.
     * Server re-quotes via PricingService and adjusts the user's balance/sub
     * by the delta (only if booking was already `paid`); for `pending` rows
     * the new price is just stamped and the cron charges the right amount.
     */
    changeFormat: async (id: string, newFormat: 'individual' | 'group'): Promise<any> => {
        const response = await api.patch(`/bookings/${id}/format`, { new_format: newFormat });
        return mapToFrontend(response.data);
    },

    /**
     * Admin: override booking price. The previous setManualPrice flow only
     * mutated the local Zustand store and lost the change on reload.
     * Server now persists the new price + adjusts the owner's balance
     * (or subscription hours) by the delta when the row is already paid.
     */
    setPrice: async (id: string, newPrice: number, reason?: string): Promise<any> => {
        const response = await api.patch(`/bookings/${id}/price`, {
            new_price: newPrice,
            reason: reason || null,
        });
        return mapToFrontend(response.data);
    },

    checkAvailability: async (slots: Array<{
        resourceId: string;
        date: string;       // "YYYY-MM-DD"
        startTime: string;  // "HH:MM"
        duration: number;   // minutes
    }>): Promise<Array<{ available: boolean; conflict: string | null }>> => {
        const response = await api.post<any[]>('/bookings/check-availability', slots);
        return response.data;
    },

    rescheduleBooking: async (id: string, data: {
        newDate: string;        // "YYYY-MM-DD"
        newStartTime: string;   // "HH:MM"
        newResourceId?: string;
        newDuration?: number;   // minutes, multiple of 30 — for /m/find reschedule
    }) => {
        const response = await api.patch<any>(`/bookings/${id}/reschedule`, data);
        return mapToFrontend(response.data);
    },

    /**
     * "This and following" reschedule for a booking that lives in a
     * recurring series. The anchor booking takes the full date/time/
     * resource change; every later sibling keeps its own date but
     * adopts the new start_time and (if changed) new resource.
     *
     * Returns the anchor plus a count of how many siblings were
     * propagated and a list of skipped ones (slot conflicts).
     */
    rescheduleBookingSeries: async (id: string, data: {
        newDate: string;
        newStartTime: string;
        newResourceId?: string;
    }): Promise<{
        ok: boolean;
        anchor: any;
        propagated: number;
        skipped: Array<{ id: string; date: string; reason: string }>;
    }> => {
        const response = await api.patch<any>(`/bookings/${id}/reschedule-series`, data);
        return response.data;
    },

    linkCrmClient: async (bookingId: string, crmClientId: string | null) => {
        const response = await api.patch<any>(`/bookings/${bookingId}/link-client`, {
            crmClientId,
        });
        return mapToFrontend(response.data);
    },

    toggleReRent: async (bookingId: string) => {
        const response = await api.patch<any>(`/bookings/${bookingId}/re-rent`);
        return mapToFrontend(response.data);
    },

    extendBooking: async (bookingId: string, extraMinutes: number = 30) => {
        const response = await api.patch<any>(`/bookings/${bookingId}/extend`, {
            extra_minutes: extraMinutes,
        });
        return mapToFrontend(response.data);
    },

    // Hot booking approval
    getPendingApprovals: async (): Promise<BookingHistoryItem[]> => {
        const response = await api.get<any[]>('/bookings/pending-approval');
        return response.data.map(mapToFrontend);
    },

    approveBooking: async (bookingId: string): Promise<BookingHistoryItem> => {
        const response = await api.post<any>(`/bookings/${bookingId}/approve`);
        return mapToFrontend(response.data);
    },

    /** Сократить бронь на N минут (кратно 30), отрезать с начала или с конца.
     *  Минимальная итоговая длительность — 60 мин. Возврат пропорциональной
     *  доли цены / часов абонемента происходит автоматически на сервере. */
    shortenBooking: async (
        bookingId: string,
        opts: { removeMinutes: number; side?: 'start' | 'end' }
    ): Promise<BookingHistoryItem> => {
        const response = await api.patch<any>(`/bookings/${bookingId}/shorten`, {
            removeMinutes: opts.removeMinutes,
            side: opts.side || 'end',
        });
        return mapToFrontend(response.data);
    },

    rejectBooking: async (bookingId: string, reason?: string): Promise<BookingHistoryItem> => {
        // Reason — admin-supplied text shown to the client in their TG/in-app
        // notification. Optional — backend falls back to «Слот недоступен»
        // if missing.
        const response = await api.post<any>(`/bookings/${bookingId}/reject`, reason ? { reason } : null);
        return mapToFrontend(response.data);
    },

    /** Excel #24 — batch-create multiple non-contiguous slots in one call.
     *  All slots share one `recurring_group_id` so the whole series can be
     *  cancelled together later. Each slot is priced independently (duration
     *  discount per slot, not across the series). */
    createMultiSlotBooking: async (data: {
        slots: Array<{
            resourceId: string;
            locationId: string;
            date: string;       // "YYYY-MM-DD"
            startTime: string;  // "HH:MM"
            duration: number;
            format: string;
        }>;
        paymentMethod: string;
        targetUserId?: string;
        crmClientId?: string;
    }): Promise<{ ok: boolean; groupId: string; bookings: any[]; totalCost: number }> => {
        const response = await api.post('/bookings/multi-slot', data);
        return {
            ok: response.data.ok,
            groupId: response.data.group_id,
            bookings: (response.data.bookings || []).map(mapToFrontend),
            totalCost: response.data.total_cost,
        };
    },

    // Recurring bookings
    createRecurringBooking: async (data: {
        resourceId: string;
        locationId: string;
        startTime: string;
        duration: number;
        format: string;
        paymentMethod: string;
        firstDate: string;
        occurrences: number;
        pattern: 'weekly' | 'biweekly' | 'monthly';
        weeks?: number;  // backward compat
        targetUserId?: string;
        crmClientId?: string;
    }): Promise<{ ok: boolean; recurringGroupId: string; created: number; totalCost: number; dates: string[]; bookingIds: string[] }> => {
        const response = await api.post('/bookings/recurring', {
            ...data,
            weeks: data.occurrences,  // backend compat
        });
        return response.data;
    },

    getRecurringGroups: async (opts?: { scope?: 'mine' }): Promise<Array<{
        recurringGroupId: string;
        resourceId: string;
        locationId: string;
        startTime: string;
        duration: number;
        crmClientId?: string;
        paymentMethod: string;
        futureCount: number;
        totalCount: number;
        nextDate: string | null;
        lastDate: string | null;
        pattern: 'weekly' | 'biweekly' | 'monthly';
    }>> => {
        // scope=mine forces user-only filtering even for admins.
        // The CRM page passes it so an admin viewing /crm/bookings doesn't
        // see every specialist's series — that view belongs in /admin/*.
        const response = await api.get('/bookings/recurring-groups', {
            params: opts?.scope ? { scope: opts.scope } : undefined,
        });
        return response.data;
    },

    /**
     * Cancel a recurring series.
     *
     * Pass `fromBookingId` for "this and following" semantics — the
     * anchor booking and every sibling on the same calendar day or
     * later get cancelled, earlier siblings (incl. ones in the past)
     * are preserved. This matches Google Calendar.
     *
     * Omit it to fall back to legacy "every future booking" scope —
     * kept for callers that don't yet know the anchor.
     */
    cancelRecurringSeries: async (
        groupId: string,
        fromBookingId?: string,
    ): Promise<{ ok: boolean; cancelled: number }> => {
        const response = await api.delete(`/bookings/recurring/${groupId}`, {
            params: fromBookingId ? { from_booking_id: fromBookingId } : undefined,
        });
        return response.data;
    },

    /**
     * Extend an existing recurring series by N more occurrences after
     * its last booking. Used by the "Продлить серию" button shown in
     * the booking detail popup and in Telegram reminder messages
     * approaching end-of-series.
     */
    extendRecurringSeries: async (groupId: string, addOccurrences: number): Promise<{ ok: boolean; created: number; totalCost: number }> => {
        const response = await api.post(`/bookings/recurring/${groupId}/extend`, {
            add_occurrences: addOccurrences,
        });
        return response.data;
    },

    /** Acknowledge the "series ending soon" Telegram reminder so further
     *  pings (3 → 2 → 1) are suppressed. Used by the "ОК, завершится в
     *  срок" button on the series deep-link banner. */
    dismissSeriesEndReminder: async (groupId: string): Promise<{ ok: boolean }> => {
        const response = await api.post(`/bookings/recurring/${groupId}/dismiss-end-reminder`);
        return response.data;
    },
};
