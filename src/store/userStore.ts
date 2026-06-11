import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserStore } from './types';
import { createAuthSlice } from './slices/createAuthSlice';
import { createBookingSlice } from './slices/createBookingSlice';
import { createUserSlice } from './slices/createUserSlice';
import { createWaitlistSlice } from './slices/createWaitlistSlice';
import { createFinanceSlice } from './slices/createFinanceSlice';

// Re-export types for backward compatibility
export * from './types';

export const useUserStore = create<UserStore>()(
    persist(
        (...a) => ({
            ...createAuthSlice(...a),
            ...createBookingSlice(...a),
            ...createUserSlice(...a),
            ...createWaitlistSlice(...a),
            ...createFinanceSlice(...a),
        }),
        {
            name: 'unbox-user-storage',
            // Bump version → zustand throws away the old localStorage blob
            // and starts fresh. Earlier the persist had no whitelist, so a
            // user could rehydrate with `bookings: []` (saved when they
            // were logged out / had no data) and the page froze on "0
            // активных" because the empty array overrode whatever
            // fetchBookings just wrote. Райская hit this exact loop. Any
            // bump invalidates pre-fix blobs across all phones.
            version: 2,
            // Whitelist what actually needs to survive page reload: just the
            // auth token + current user identity. The big collections
            // (bookings, users, transactions, waitlist, balance) used to be
            // persisted by default and on iOS Safari (≈5 MB per-origin quota)
            // a 5 000-row bookings dump tripped QuotaExceededError →
            // "The quota has been exceeded." toast that actually came from
            // localStorage, not the API. Those collections are re-fetched on
            // mount from the server anyway, so persisting them just wasted
            // storage and made the dashboard look broken on phones.
            partialize: (state: any) => ({
                currentUser: state.currentUser,
                token: state.token,
            }),
            // Defensive migrate: when the old (v1, pre-fix) blob is loaded
            // by an installed PWA / persistent tab, strip every field
            // except the auth bits. Without this the rehydrate could
            // briefly clobber freshly-fetched bookings with an empty array.
            migrate: (persistedState: any, fromVersion: number) => {
                if (!persistedState || fromVersion < 2) {
                    return {
                        currentUser: persistedState?.currentUser ?? null,
                        token: persistedState?.token ?? null,
                    };
                }
                return persistedState;
            },
        }
    )
);
