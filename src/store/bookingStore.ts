import { create } from 'zustand';
import { toast } from 'sonner';
import type { BookingState, Format, PricingResult, GroupSize } from '../types';
import { resourcesApi } from '../api/resources';
import { pricingApi } from '../api/pricing';
import { RESOURCES } from '../utils/data';
import type { Resource, Location } from '../types/index';
import type { PriceBreakdown } from './types';
import { locationsApi } from '../api/locations';

export interface BookingStore extends BookingState {

    // Data
    resources: Resource[];
    fetchResources: () => Promise<void>;
    locations: Location[];
    fetchLocations: () => Promise<void>;

    // Actions
    setStep: (step: number) => void;

    setLocation: (locationId: string) => void;
    setResource: (resourceId: string) => void;
    setResourceId: (resourceId: string) => void; // Alias
    setFormat: (format: Format) => void;
    setGroupSize: (size: GroupSize | null) => void;
    setDate: (date: Date) => void;
    setTimeRange: (startTime: string, duration: number) => void;
    setStartTime: (startTime: string) => void;
    setDuration: (duration: number) => void;
    toggleExtra: (extraId: string) => void;
    toggleSlot: (resourceId: string, time: string) => void;
    setSlotRange: (resourceId: string, timeSlots: string[]) => void;
    /** Excel #24 — append a disconnected range to the same resource. */
    addSlotRange: (resourceId: string, timeSlots: string[]) => void;
    replaceSlots: (newSlots: string[]) => void;
    clearCart: () => void;
    setPaymentMethod: (method: 'balance' | 'subscription' | 'bonus') => void;
    selectedSlots: string[]; // "resId|time"

    // Excel #24 — when the user clicks "+ Ещё период в этом кабинете" in
    // Summary, we remember the resource they want to append to and the slots
    // they already selected there. On return to the chessboard, any new drag
    // in that resource merges with the preserved slots instead of replacing.
    pendingAddResourceId: string | null;
    preservedResourceSlots: string[];  // slots of pendingAddResourceId captured at click time
    startAddMoreSlots: (resourceId: string) => void;
    clearAddMore: () => void;

    // Edit Mode
    editBookingId: string | null;
    mode: 'create' | 'edit' | 'reschedule';
    bookingForUser: string | null; // ID/Email of user being booked for (Admin only)

    startEditing: (booking: BookingState & { id: string }, mode?: 'edit' | 'reschedule') => void;
    setBookingForUser: (userId: string | null) => void;
    reset: () => void;

    // Highlighted resource (for visual emphasis on chessboard)
    highlightedResourceId: string | null;
    setHighlightedResourceId: (id: string | null) => void;

    // Computed
    price: PricingResult;
    quote: PriceBreakdown | null;
    fetchQuote: () => Promise<void>;
}

const INITIAL_STATE: BookingState = {
    step: 1,
    locationId: null,
    resourceId: null,
    format: 'individual',
    groupSize: null,
    date: new Date(),
    startTime: null,
    duration: 0,
    selectedSlots: [],
    extras: [],
    paymentMethod: 'balance',
    bookingForUser: null,
};

export const useBookingStore = create<BookingStore>((set, get) => ({
    ...INITIAL_STATE,
    resources: RESOURCES, // Initial static data
    locations: [],
    quote: null,
    highlightedResourceId: null,

    fetchResources: async () => {
        try {
            const data = await resourcesApi.getAll();
            // Merge photos from static data if API doesn't return them
            const staticMap = new Map(RESOURCES.map(r => [r.id, r]));
            for (const r of data) {
                if ((!r.photos || r.photos.length === 0) && staticMap.has(r.id)) {
                    r.photos = staticMap.get(r.id)!.photos;
                }
            }
            data.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
            set({ resources: data });
        } catch (error) {
            toast.error('Не удалось загрузить кабинеты');
        }
    },
    fetchLocations: async () => {
        try {
            const data = await locationsApi.getLocations();
            set({ locations: data });
        } catch (error) {
            toast.error('Не удалось загрузить локации');
        }
    },
    editBookingId: null,
    mode: 'create',
    bookingForUser: null,

    startEditing: (booking: BookingState & { id: string }, mode = 'edit') => {
        // Excel #27 fix: pre-populate selectedSlots from the existing booking
        // so that ConfirmationStep's cart isn't empty if the user doesn't
        // re-click slots. Covers the common reschedule path where the admin
        // just wants to move a single booking to a new time.
        const slots: string[] = [];
        try {
            const [h, m] = (booking.startTime || '').split(':').map(Number);
            if (!Number.isNaN(h) && !Number.isNaN(m) && booking.duration > 0 && booking.resourceId) {
                const startMinutes = h * 60 + m;
                for (let offset = 0; offset < booking.duration; offset += 30) {
                    const sm = startMinutes + offset;
                    const hh = Math.floor(sm / 60);
                    const mm = sm % 60;
                    slots.push(`${booking.resourceId}|${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`);
                }
            }
        } catch {
            // Defensive: fall through to empty slots.
        }
        return set({
            step: 1,
            locationId: booking.locationId,
            resourceId: booking.resourceId,
            format: booking.format,
            groupSize: booking.groupSize || null,
            date: new Date(booking.date),
            startTime: booking.startTime,
            duration: booking.duration,
            selectedSlots: slots,
            extras: booking.extras,
            editBookingId: booking.id,
            mode: mode as any,
        });
    },

    price: {
        basePrice: 0,
        extrasPrice: 0,
        discountAmount: 0,
        discountType: 'none',
        finalPrice: 0,
        peakSurcharge: 0,
        peakSlotCount: 0,
        subscriptionPeakDebt: 0,
    },

    setStep: (step) => set({ step }),

    setLocation: (locationId) => set({
        locationId,
        resourceId: null,
        selectedSlots: [],
        step: 1,
        quote: null
    }),

    setResource: (resourceId) => {
        set({ resourceId });
        get().fetchQuote();
    },
    setResourceId: (resourceId) => {
        set({ resourceId });
        get().fetchQuote();
    },
    setHighlightedResourceId: (id) => set({ highlightedResourceId: id }),

    setFormat: (format) => {
        set({ format, groupSize: format === 'individual' ? null : get().groupSize });
        get().fetchQuote();
    },
    setGroupSize: (groupSize) => {
        set({ groupSize, step: 1 }); // reset to step 1 on format change to lock UI
    },

    setDate: (date) => set({ date, startTime: null, duration: 0, selectedSlots: [], quote: null }),

    setTimeRange: (startTime, duration) => {
        set({ startTime, duration });
        get().fetchQuote();
    },
    setStartTime: (startTime) => {
        set({ startTime });
        get().fetchQuote();
    },
    setDuration: (duration) => {
        set({ duration });
        get().fetchQuote();
    },

    toggleSlot: (resourceId, time) => set((state) => {
        const slotId = `${resourceId}|${time}`;
        const exists = state.selectedSlots.includes(slotId);
        const newSlots = exists
            ? state.selectedSlots.filter(s => s !== slotId)
            : [...state.selectedSlots, slotId];

        return { selectedSlots: newSlots };
    }),

    setSlotRange: (resourceId, timeSlots) => set((state) => {
        // Remove all slots for this resource first to replace them cleanly
        const otherSlots = state.selectedSlots.filter(s => !s.startsWith(`${resourceId}|`));
        const newSlots = timeSlots.map(time => `${resourceId}|${time}`);
        return { selectedSlots: [...otherSlots, ...newSlots] };
    }),

    // Excel #24 — add a second independent block to the same resource without
    // wiping the first. Used when the user already has a range in this
    // resource and clicks "+ Ещё период" to pick an adjacent-but-not-touching
    // interval (e.g. 10:00-12:00 AND 15:00-17:00 in cabinet #3).
    addSlotRange: (resourceId, timeSlots) => set((state) => {
        const existing = new Set(state.selectedSlots);
        const additions = timeSlots
            .map(time => `${resourceId}|${time}`)
            .filter(id => !existing.has(id));
        return { selectedSlots: [...state.selectedSlots, ...additions] };
    }),

    pendingAddResourceId: null,
    preservedResourceSlots: [],

    startAddMoreSlots: (resourceId) => set((state) => {
        // Snapshot current slots for the target resource so a subsequent drag
        // in the chessboard can merge rather than replace.
        const preserved = state.selectedSlots.filter(s => s.startsWith(`${resourceId}|`));
        return {
            pendingAddResourceId: resourceId,
            preservedResourceSlots: preserved,
        };
    }),

    clearAddMore: () => set({
        pendingAddResourceId: null,
        preservedResourceSlots: [],
    }),

    replaceSlots: (newSlots) => set({ selectedSlots: newSlots }),

    clearCart: () => set({ selectedSlots: [], quote: null }),

    toggleExtra: (extraId) => {
        set((state) => {
            const isSelected = state.extras.includes(extraId);
            const newExtras = isSelected
                ? state.extras.filter(id => id !== extraId)
                : [...state.extras, extraId];
            return { extras: newExtras };
        });
        get().fetchQuote();
    },

    setPaymentMethod: (paymentMethod) => set({ paymentMethod }),

    setBookingForUser: (bookingForUser) => {
        set({ bookingForUser });
        get().fetchQuote();
    },

    reset: () => set({
        ...INITIAL_STATE,
        editBookingId: null, mode: 'create', bookingForUser: null, quote: null,
        pendingAddResourceId: null, preservedResourceSlots: [],
    }),

    fetchQuote: async () => {
        const { resourceId, date, startTime, duration, format } = get();
        if (!resourceId || !date || !startTime || duration <= 0) {
            set({ quote: null });
            return;
        }

        const [h, m] = startTime.split(':').map(Number);
        const startDateTime = new Date(date);
        startDateTime.setHours(h, m, 0, 0);

        try {
            const quote = await pricingApi.getQuote({
                resource_id: resourceId,
                start_time: startDateTime.toISOString(),
                duration_minutes: duration,
                format_type: format
            });

            const { extras } = get();
            const { EXTRAS } = await import('../utils/data');
            const extrasCost = extras.reduce((sum, id) => {
                const extra = EXTRAS.find(e => e.id === id);
                return sum + (extra?.price || 0);
            }, 0);

            set({
                quote,
                price: {
                    basePrice: quote.basePrice,
                    extrasPrice: extrasCost,
                    discountAmount: quote.discountAmount,
                    discountType: quote.appliedRule as any,
                    finalPrice: quote.finalPrice + extrasCost,
                    peakSurcharge: quote.peakSurcharge ?? 0,
                    peakSlotCount: quote.peakSlotCount ?? 0,
                    subscriptionPeakDebt: quote.subscriptionPeakDebt ?? 0,
                }
            });
        } catch (error) {
            // Silent for quote — user sees empty price, no need to spam toast
            set({ quote: null });
        }
    },
}));
