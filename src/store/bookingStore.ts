import { create } from 'zustand';
import type { BookingState, Format, PricingResult } from '../types';


export interface BookingStore extends BookingState {
    // Actions
    setStep: (step: number) => void;
    setLocation: (locationId: string) => void;
    setResource: (resourceId: string) => void;
    setResourceId: (resourceId: string) => void;
    setFormat: (format: Format) => void;
    setDate: (date: Date) => void;
    setTimeRange: (startTime: string, duration: number) => void;
    setStartTime: (startTime: string) => void;
    setDuration: (duration: number) => void;
    toggleExtra: (extraId: string) => void;
    toggleSlot: (resourceId: string, time: string) => void;
    clearCart: () => void;
    setPaymentMethod: (method: 'balance' | 'subscription') => void;
    selectedSlots: string[]; // "resId|time"

    // Edit Mode
    editBookingId: string | null;
    startEditing: (booking: BookingState & { id: string }) => void;
    reset: () => void;

    // Computed
    price: PricingResult;
}

const INITIAL_STATE: BookingState = {
    step: 1,
    locationId: null,
    resourceId: null,
    format: 'individual',
    date: new Date(),
    startTime: null,
    duration: 0,
    selectedSlots: [],
    extras: [],
    paymentMethod: 'balance', // Default to balance (deposit/credit)
};

export const useBookingStore = create<BookingStore>((set) => ({
    ...INITIAL_STATE,
    // ...
    // Actions
    // ...
    startEditing: (booking: BookingState & { id: string }) => set({
        step: 1,
        locationId: booking.locationId,
        resourceId: booking.resourceId,
        format: booking.format,
        date: new Date(booking.date),
        startTime: booking.startTime,
        duration: booking.duration,
        selectedSlots: [], // Reset slots on edit legacy single booking
        extras: booking.extras,
        editBookingId: booking.id
    }),
    // ...

    price: {
        basePrice: 0,
        extrasPrice: 0,
        discountAmount: 0,
        discountType: 'none',
        finalPrice: 0,
    },

    editBookingId: null, // New field for edit mode

    selectedSlots: [],

    setStep: (step) => set({ step }),

    setLocation: (locationId) => set({
        locationId,
        resourceId: null,
        selectedSlots: [], // Clear cart when changing location
        step: 1
    }),

    setResource: (resourceId) => set({ resourceId }),
    setResourceId: (resourceId) => set({ resourceId }), // Alias for consistency

    setFormat: (format) => set({ format }),

    setDate: (date) => set({ date, startTime: null, duration: 0, selectedSlots: [] }),

    setTimeRange: (startTime, duration) => set({ startTime, duration }), // Legacy keep
    setStartTime: (startTime) => set({ startTime }),
    setDuration: (duration) => set({ duration }),

    // New Cart Action
    toggleSlot: (resourceId, time) => set((state) => {
        const slotId = `${resourceId}|${time}`;
        const exists = state.selectedSlots.includes(slotId);
        const newSlots = exists
            ? state.selectedSlots.filter(s => s !== slotId)
            : [...state.selectedSlots, slotId];

        return { selectedSlots: newSlots };
    }),

    clearCart: () => set({ selectedSlots: [] }),

    toggleExtra: (extraId) => set((state) => {
        const isSelected = state.extras.includes(extraId);
        const newExtras = isSelected
            ? state.extras.filter(id => id !== extraId)
            : [...state.extras, extraId];
        return { extras: newExtras };
    }),

    // ...

    setPaymentMethod: (paymentMethod) => set({ paymentMethod }),

    reset: () => set({ ...INITIAL_STATE, editBookingId: null }),
}));

// Subscribe to state changes to recalculate price
// (Or we can use a derived selector, but simple subscription updater is fine too)
// Actually, let's make a hook or just a computed property updater.
// Zustand recommends usage of selectors or middleware for computed values.
// For simplicity, I'll add a middleware-like wrapper or just recalculate on every set if I change the implementation above.
// However, the cleanest way in a simple store is to just calculate in the component or have a `getPrice` selector. 
// But the prompt says "Change ... instantly recalculates price".
// Let's implement a `computed` approach where we export a selector that calculates price on the fly.
// Wait, `calculatePrice` needs date objects logic which might be complex to keep in sync if I only store strings strings.
// I stored `date: Date` but `startTime: string`.
// I need to parse them to full Date objects for `calculatePrice`.


