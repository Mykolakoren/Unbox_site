import type { StateCreator } from 'zustand';
import type { UserStore, WaitlistSlice } from '../types';

export const createWaitlistSlice: StateCreator<UserStore, [], [], WaitlistSlice> = (set) => ({
    waitlist: [],

    addToWaitlist: (entry) => set((state) => ({
        waitlist: [
            ...state.waitlist,
            {
                ...entry,
                id: Math.random().toString(36).substr(2, 9),
                dateCreated: new Date().toISOString(),
                status: 'active'
            }
        ]
    })),

    removeFromWaitlist: (id) => set((state) => ({
        waitlist: state.waitlist.filter(w => w.id !== id)
    })),
});
