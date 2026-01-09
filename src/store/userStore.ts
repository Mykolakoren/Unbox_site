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
            // Optional: filtering what to persist if needed. 
            // Currently we persist everything which is fine.
        }
    )
);
