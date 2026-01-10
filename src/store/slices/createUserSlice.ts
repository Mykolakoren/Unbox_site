import type { StateCreator } from 'zustand';
import type { UserStore, UserSlice } from '../types';
import { usersApi } from '../../api/users';
import { startOfWeek, endOfWeek } from 'date-fns';

export const createUserSlice: StateCreator<UserStore, [], [], UserSlice> = (set, get) => ({
    users: [],

    fetchUsers: async () => {
        try {
            const users = await usersApi.getUsers();
            set({ users });
        } catch (error) {
            console.error("Failed to fetch users", error);
        }
    },

    updateUser: async (updates) => {
        try {
            // Assume this updates "currentUser". Backend has updateMe.
            const updatedUser = await usersApi.updateMe(updates);
            set((state) => ({
                currentUser: updatedUser,
                users: state.users.map(u => u.email === updatedUser.email ? updatedUser : u)
            }));
        } catch (error) {
            console.error("Failed to update profile", error);
        }
    },

    updateUserById: async (userId, updates) => {
        try {
            const updatedUser = await usersApi.updateUser(userId, updates);
            set((state) => ({
                users: state.users.map(u => u.email === updatedUser.email ? updatedUser : u),
                currentUser: state.currentUser?.email === updatedUser.email ? updatedUser : state.currentUser
            }));
        } catch (error) {
            console.error("Failed to update user", error);
        }
    },

    toggleSubscriptionFreeze: async (userId) => {
        try {
            const updatedUser = await usersApi.toggleSubscriptionFreeze(userId);
            set((state) => ({
                users: state.users.map(u => u.email === updatedUser.email ? updatedUser : u),
                currentUser: state.currentUser?.email === updatedUser.email ? updatedUser : state.currentUser
            }));
        } catch (error) {
            console.error("Failed to toggle freeze", error);
        }
    },

    updatePersonalDiscount: async (userId, percent, reason) => {
        try {
            const updatedUser = await usersApi.updatePersonalDiscount(userId, percent, reason);
            set((state) => ({
                users: state.users.map(u => u.email === updatedUser.email ? updatedUser : u),
                currentUser: state.currentUser?.email === updatedUser.email ? updatedUser : state.currentUser
            }));
        } catch (error) {
            console.error("Failed to update discount", error);
        }
    },

    runWeeklyReconciliation: () => {
        // ... (Keep existing client-side logic or migrate? This logic calculates bonuses based on bookings)
        // Since we don't have a backend endpoint for this specific logic yet, I'll keep it as "client side calculation"
        // but it modifies balance!
        // To persist, I must call API.
        // It updates currentUser balance.
        // I should call `updateMe` or `updateUser` with new balance.

        const state = get();
        const currentUser = state.currentUser;
        if (!currentUser) return null;

        const now = new Date();
        const start = startOfWeek(now, { weekStartsOn: 1 });
        const end = endOfWeek(now, { weekStartsOn: 1 });

        const weekBookings = state.bookings.filter(b => {
            if (b.userId !== currentUser.email || b.status !== 'confirmed') return false;
            const bookingDate = new Date(b.date);
            return bookingDate >= start && bookingDate <= end;
        });

        if (weekBookings.length === 0) return null;

        let totalBasePrice = 0;
        let totalPaidPrice = 0;
        let totalMinutes = 0;

        weekBookings.forEach(b => {
            const final = b.finalPrice || 0;
            const base = b.price?.basePrice || final;

            totalPaidPrice += final;
            totalBasePrice += base;
            totalMinutes += b.duration;
        });

        const totalHours = totalMinutes / 60;

        let discountPercent = 0;
        if (totalHours >= 16) discountPercent = 50;
        else if (totalHours >= 11) discountPercent = 25;
        else if (totalHours >= 5) discountPercent = 10;

        const idealPrice = totalBasePrice * (1 - discountPercent / 100);
        const delta = totalPaidPrice - idealPrice;

        if (delta > 0.01) {
            const bonus = parseFloat(delta.toFixed(2));
            const newBalance = currentUser.balance + bonus;

            // Call API to persist
            // This is "bonus", maybe just update balance.
            get().updateUser({ balance: newBalance }); // using our new async action

            return { amount: bonus, totalHours, discountPercent };
        }

        return { amount: 0, totalHours, discountPercent };
    },

    // CRM Actions Implementation
    addUserTag: async (email, tag) => {
        // Fetch fresh user or use state?
        const state = get();
        const user = state.users.find(u => u.email === email);
        if (!user) return; // Or fetch

        const tags = user.tags || [];
        if (tags.includes(tag)) return;

        const newTags = [...tags, tag];
        await get().updateUserById(email, { tags: newTags });
    },

    removeUserTag: async (email, tag) => {
        const state = get();
        const user = state.users.find(u => u.email === email);
        if (!user || !user.tags) return;

        const newTags = user.tags.filter(t => t !== tag);
        await get().updateUserById(email, { tags: newTags });
    },

    addUserTask: async (email, taskData) => {
        const state = get();
        const user = state.users.find(u => u.email === email);
        if (!user) return;

        const newTask = {
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            ...taskData,
            createdAt: new Date().toISOString()
        };
        const newTasks = [...(user.adminTasks || []), newTask];
        await get().updateUserById(email, { adminTasks: newTasks } as any); // adminTasks field match
    },

    toggleUserTask: async (email, taskId) => {
        const state = get();
        const user = state.users.find(u => u.email === email);
        if (!user || !user.adminTasks) return;

        const updatedTasks = user.adminTasks.map(t =>
            t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t
        );
        await get().updateUserById(email, { adminTasks: updatedTasks } as any);
    },

    removeUserTask: async (email, taskId) => {
        const state = get();
        const user = state.users.find(u => u.email === email);
        if (!user || !user.adminTasks) return;

        const updatedTasks = user.adminTasks.filter(t => t.id !== taskId);
        await get().updateUserById(email, { adminTasks: updatedTasks } as any);
    },

    addUserComment: async (email, text, adminName) => {
        const state = get();
        const user = state.users.find(u => u.email === email);
        if (!user) return;

        const newNote = {
            id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text,
            date: new Date().toISOString(),
            adminName
        };
        const newHistory = [newNote, ...(user.commentHistory || [])];
        await get().updateUserById(email, { commentHistory: newHistory } as any);
    }
});
