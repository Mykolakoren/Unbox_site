import { create } from 'zustand';
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
    replaceSlots: (newSlots: string[]) => void;
    clearCart: () => void;
    setPaymentMethod: (method: 'balance' | 'subscription') => void;
    selectedSlots: string[]; // "resId|time"

    // Edit Mode
    editBookingId: string | null;
    mode: 'create' | 'edit' | 'reschedule';
    bookingForUser: string | null; // ID/Email of user being booked for (Admin only)

    startEditing: (booking: BookingState & { id: string }, mode?: 'edit' | 'reschedule') => void;
    setBookingForUser: (userId: string | null) => void;
    reset: () => void;

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

    fetchResources: async () => {
        try {
            const data = await resourcesApi.getAll();
            set({ resources: data });
        } catch (error) {
            console.error("Failed to fetch resources:", error);
        }
    },
    fetchLocations: async () => {
        try {
            const data = await locationsApi.getLocations();
            set({ locations: data });
        } catch (error) {
            console.error("Failed to fetch locations:", error);
        }
    },
    editBookingId: null,
    mode: 'create',
    bookingForUser: null,

    startEditing: (booking: BookingState & { id: string }, mode = 'edit') => set({
        step: 1,
        locationId: booking.locationId,
        resourceId: booking.resourceId,
        format: booking.format,
        groupSize: booking.groupSize || null,
        date: new Date(booking.date),
        startTime: booking.startTime,
        duration: booking.duration,
        selectedSlots: [],
        extras: booking.extras,
        editBookingId: booking.id,
        mode: mode as any
    }),

    price: {
        basePrice: 0,
        extrasPrice: 0,
        discountAmount: 0,
        discountType: 'none',
        finalPrice: 0,
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

    reset: () => set({ ...INITIAL_STATE, editBookingId: null, mode: 'create', bookingForUser: null, quote: null }),

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
            const extrasCost = extras.length * 5;

            set({
                quote,
                price: {
                    basePrice: quote.basePrice,
                    extrasPrice: extrasCost,
                    discountAmount: quote.discountAmount,
                    discountType: quote.appliedRule as any,
                    finalPrice: quote.finalPrice + extrasCost
                }
            });
        } catch (error) {
            console.error("Failed to fetch quote:", error);
            set({ quote: null });
        }
    },
}));
