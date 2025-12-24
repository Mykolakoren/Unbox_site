import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BookingState } from '../types';

export interface User {
    name: string;
    email: string;
    phone: string;
    level: 'none' | 'silver' | 'gold';
}

export interface BookingHistoryItem extends BookingState {
    id: string;
    status: 'confirmed' | 'cancelled' | 'completed';
    dateCreated: string; // ISO string
    finalPrice: number;
}

interface UserStore {
    user: User | null;
    bookings: BookingHistoryItem[];

    // Actions
    login: (user: User) => void;
    logout: () => void;
    addBooking: (booking: BookingHistoryItem) => void;
    updateUser: (updates: Partial<User>) => void;
}

export const useUserStore = create<UserStore>()(
    persist(
        (set) => ({
            user: null,
            bookings: [],

            login: (user) => set({ user }),
            logout: () => set({ user: null }),

            addBooking: (booking) => set((state) => ({
                bookings: [booking, ...state.bookings]
            })),

            updateUser: (updates) => set((state) => ({
                user: state.user ? { ...state.user, ...updates } : null
            })),
        }),
        {
            name: 'unbox-user-storage',
        }
    )
);
