// NOTE: file name retained for import compatibility. Implementation is
// no longer a mock — it calls the real backend, which in turn pulls events
// from the resource's Google Calendar via Service Account credentials.
// Two-way GCal sync (Excel #15, #32, #38):
//   push: create_event on confirmed booking (backend/services/google_calendar.py)
//   pull: THIS module → GET /bookings/external-events
import { api } from '../api/client';

export interface ExternalEvent {
    id: string;
    resourceId: string;
    start: string; // ISO
    end: string;   // ISO
    title: string;
    source: 'google_calendar';
}

// In-memory cache, 5 min TTL. Avoids hammering the API on chessboard scrolls.
type CacheEntry = { at: number; events: ExternalEvent[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

function cacheKey(resourceId: string, dateFrom?: string, dateTo?: string) {
    return `${resourceId}|${dateFrom ?? ''}|${dateTo ?? ''}`;
}

export const googleCalendarService = {
    /** Synchronous lookup for legacy callers — returns whatever is in cache.
     *  New callers should prefer `fetchEvents(...)`. */
    getEvents: (resourceId: string): ExternalEvent[] => {
        const latest = [...cache.entries()]
            .filter(([k]) => k.startsWith(`${resourceId}|`))
            .sort((a, b) => b[1].at - a[1].at)[0];
        return latest ? latest[1].events : [];
    },

    /** Fetch external events for a resource in a time window.
     *  Cached for 5 minutes per (resourceId, window) tuple. */
    fetchEvents: async (
        resourceId: string,
        dateFrom?: string,
        dateTo?: string,
    ): Promise<ExternalEvent[]> => {
        const key = cacheKey(resourceId, dateFrom, dateTo);
        const now = Date.now();
        const hit = cache.get(key);
        if (hit && now - hit.at < TTL_MS) return hit.events;
        try {
            const response = await api.get<any[]>('/bookings/external-events', {
                params: {
                    resource_id: resourceId,
                    date_from: dateFrom,
                    date_to: dateTo,
                },
            });
            // axios interceptor converts snake_case → camelCase, so
            // resource_id → resourceId. Coerce shape just in case.
            const events: ExternalEvent[] = (response.data || []).map((e: any) => ({
                id: e.id,
                resourceId: e.resourceId ?? e.resource_id ?? resourceId,
                start: e.start,
                end: e.end,
                title: e.title || 'Событие',
                source: 'google_calendar',
            }));
            cache.set(key, { at: now, events });
            return events;
        } catch (err) {
            // Swallow errors — GCal is best-effort for the chessboard. We don't
            // want a transient 500 to break booking creation.
            // eslint-disable-next-line no-console
            console.warn('[gcal] failed to fetch external events:', err);
            return [];
        }
    },

    /** Invalidate the in-memory cache — useful after admin-side changes
     *  that should be picked up immediately. */
    invalidate: () => cache.clear(),
};
