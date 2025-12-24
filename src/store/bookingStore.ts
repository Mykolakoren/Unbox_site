import { create } from 'zustand';
import type { BookingState, Format, PricingResult } from '../types';


interface BookingStore extends BookingState {
    // Actions
    setStep: (step: number) => void;
    setLocation: (locationId: string) => void;
    setResource: (resourceId: string) => void;
    setFormat: (format: Format) => void;
    setDate: (date: Date) => void;
    setTimeRange: (startTime: string, duration: number) => void;
    toggleExtra: (extraId: string) => void;
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
    extras: [],
};

export const useBookingStore = create<BookingStore>((set) => ({
    ...INITIAL_STATE,

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
        resourceId: null, // Reset resource when location changes
        step: 1 // Stay on step 1 or move? Logic handled by UI usually. 
    }),

    setResource: (resourceId) => set({ resourceId }),

    setFormat: (format) => set({ format }),

    setDate: (date) => set({ date, startTime: null, duration: 0 }),

    setTimeRange: (startTime, duration) => set({ startTime, duration }),

    toggleExtra: (extraId) => set((state) => {
        const isSelected = state.extras.includes(extraId);
        const newExtras = isSelected
            ? state.extras.filter(id => id !== extraId)
            : [...state.extras, extraId];
        return { extras: newExtras };
    }),

    reset: () => set({ ...INITIAL_STATE }),
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


