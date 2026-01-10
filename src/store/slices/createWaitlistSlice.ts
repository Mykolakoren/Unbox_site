import type { StateCreator } from 'zustand';
import type { UserStore, WaitlistSlice } from '../types';
import { waitlistApi } from '../../api/waitlist';

export const createWaitlistSlice: StateCreator<UserStore, [], [], WaitlistSlice> = (set) => ({
    waitlist: [],

    fetchWaitlist: async () => {
        try {
            const waitlist = await waitlistApi.getMyWaitlist();
            set({ waitlist });
        } catch (error) {
            console.error("Failed to fetch waitlist", error);
        }
    },

    addToWaitlist: async (entry) => {
        try {
            const newEntry = await waitlistApi.addToWaitlist(entry);
            set((state) => ({ waitlist: [...state.waitlist, newEntry] }));
        } catch (error) {
            console.error("Failed to add to waitlist", error);
        }
    },

    removeFromWaitlist: async (id) => {
        try {
            await waitlistApi.removeFromWaitlist(id);
            set((state) => ({
                waitlist: state.waitlist.filter(w => w.id !== id)
            }));
        } catch (error) {
            console.error("Failed to remove from waitlist", error);
        }
    },
});
