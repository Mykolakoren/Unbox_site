import type { StateCreator } from 'zustand';
import type { UserStore, AuthSlice, User, Format } from '../types';

export const createAuthSlice: StateCreator<UserStore, [], [], AuthSlice> = (set, get) => ({
    currentUser: null,

    login: (email, name) => {
        const state = get();
        const existingUser = state.users.find(u => u.email === email);
        if (existingUser) {
            if (!existingUser.subscription) {
                const patchedUser: User = {
                    ...existingUser,
                    subscription: {
                        id: 'sub-existing',
                        name: 'Unbox Pro (Promo)',
                        totalHours: 20,
                        remainingHours: 12.5,
                        freeReschedules: 2,
                        expiryDate: '2026-01-30T00:00:00.000Z',
                        isFrozen: false,
                        includedFormats: ['individual'] as Format[]
                    }
                };
                const updatedUsers = state.users.map(u => u.email === email ? patchedUser : u);
                set({ users: updatedUsers, currentUser: patchedUser });
            } else {
                set({ currentUser: existingUser });
            }
        } else if (name) {
            const newUser: User = {
                email,
                name,
                phone: '',
                level: 'basic',
                balance: 0,
                creditLimit: 0,
                subscription: {
                    id: 'sub-123',
                    name: 'Unbox Pro',
                    totalHours: 20,
                    remainingHours: 12.5,
                    freeReschedules: 2,
                    expiryDate: '2026-01-30T00:00:00.000Z',
                    isFrozen: false,
                    includedFormats: ['individual'] as Format[]
                },
                registrationDate: new Date().toISOString(),
                tags: [],
                adminTasks: []
            };
            set({ users: [...state.users, newUser], currentUser: newUser });
        }
    },

    logout: () => set({ currentUser: null }),

    register: (user) => set((state) => ({
        users: [...state.users, {
            ...user,
            registrationDate: user.registrationDate || new Date().toISOString(),
            tags: user.tags || [],
            adminTasks: user.adminTasks || []
        }],
        currentUser: {
            ...user,
            registrationDate: user.registrationDate || new Date().toISOString(),
            tags: user.tags || [],
            adminTasks: user.adminTasks || []
        }
    })),
});
