import type { StateCreator } from 'zustand';
import type { UserStore, UserSlice } from '../types';
import { startOfWeek, endOfWeek } from 'date-fns';

export const createUserSlice: StateCreator<UserStore, [], [], UserSlice> = (set, get) => ({
    users: [],

    updateUser: (updates) => set((state) => {
        if (!state.currentUser) return state;
        const updatedUser = { ...state.currentUser, ...updates };
        return {
            currentUser: updatedUser,
            users: state.users.map(u => u.email === state.currentUser?.email ? updatedUser : u)
        };
    }),

    updateUserById: (userId, updates) => set((state) => {
        const updatedUsers = state.users.map(u =>
            u.email === userId ? { ...u, ...updates } : u
        );
        const currentUser = state.currentUser?.email === userId
            ? { ...state.currentUser, ...updates }
            : state.currentUser;
        return { users: updatedUsers, currentUser };
    }),

    toggleSubscriptionFreeze: (userId) => set((state) => {
        const userIndex = state.users.findIndex(u => u.email === userId);
        if (userIndex === -1) return state;

        const user = state.users[userIndex];
        if (!user.subscription) return state;

        const newSubscription = {
            ...user.subscription,
            isFrozen: !user.subscription.isFrozen,
            frozenUntil: !user.subscription.isFrozen
                ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                : undefined
        };

        const updatedUser = { ...user, subscription: newSubscription };
        const updatedUsers = [...state.users];
        updatedUsers[userIndex] = updatedUser;

        return {
            users: updatedUsers,
            currentUser: state.currentUser?.email === userId ? updatedUser : state.currentUser
        };
    }),

    updatePersonalDiscount: (userId, percent, reason, adminName) => set((state) => {
        const user = state.users.find(u => u.email === userId);
        if (!user) return state;

        const oldPercent = user.personalDiscountPercent || 0;
        if (oldPercent === percent) return state;

        const logEntry = {
            id: `log-${Date.now()}`,
            date: new Date().toISOString(),
            oldValue: oldPercent,
            newValue: percent,
            reason,
            adminName
        };

        const updatedUser = {
            ...user,
            personalDiscountPercent: percent,
            discountHistory: [logEntry, ...(user.discountHistory || [])]
        };

        return {
            users: state.users.map(u => u.email === userId ? updatedUser : u),
            currentUser: state.currentUser?.email === userId ? updatedUser : state.currentUser
        };
    }),

    runWeeklyReconciliation: () => {
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
            const updatedUser = {
                ...currentUser,
                balance: currentUser.balance + bonus
            };

            set({
                currentUser: updatedUser,
                users: state.users.map(u => u.email === currentUser.email ? updatedUser : u)
            });

            return { amount: bonus, totalHours, discountPercent };
        }

        return { amount: 0, totalHours, discountPercent };
    },

    // CRM Actions Implementation
    addUserTag: (email, tag) => set((state) => {
        const user = state.users.find(u => u.email === email);
        if (!user) return state;

        const tags = user.tags || [];
        if (tags.includes(tag)) return state;

        const updatedUser = { ...user, tags: [...tags, tag] };

        return {
            users: state.users.map(u => u.email === email ? updatedUser : u),
            currentUser: state.currentUser?.email === email ? updatedUser : state.currentUser
        };
    }),

    removeUserTag: (email, tag) => set((state) => {
        const user = state.users.find(u => u.email === email);
        if (!user || !user.tags) return state;

        const updatedUser = {
            ...user,
            tags: user.tags.filter(t => t !== tag)
        };

        return {
            users: state.users.map(u => u.email === email ? updatedUser : u),
            currentUser: state.currentUser?.email === email ? updatedUser : state.currentUser
        };
    }),

    addUserTask: (email, taskData) => set((state) => {
        const user = state.users.find(u => u.email === email);
        if (!user) return state;

        const newTask = {
            id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            ...taskData,
            createdAt: new Date().toISOString()
        };

        const updatedUser = {
            ...user,
            adminTasks: [...(user.adminTasks || []), newTask]
        };

        return {
            users: state.users.map(u => u.email === email ? updatedUser : u),
            currentUser: state.currentUser?.email === email ? updatedUser : state.currentUser
        };
    }),

    toggleUserTask: (email, taskId) => set((state) => {
        const user = state.users.find(u => u.email === email);
        if (!user || !user.adminTasks) return state;

        const updatedTasks = user.adminTasks.map(t =>
            t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t
        );

        const updatedUser = { ...user, adminTasks: updatedTasks };

        return {
            users: state.users.map(u => u.email === email ? updatedUser : u),
            currentUser: state.currentUser?.email === email ? updatedUser : state.currentUser
        };
    }),

    removeUserTask: (email, taskId) => set((state) => {
        const user = state.users.find(u => u.email === email);
        if (!user || !user.adminTasks) return state;

        const updatedUser = {
            ...user,
            adminTasks: user.adminTasks.filter(t => t.id !== taskId)
        };

        return {
            users: state.users.map(u => u.email === email ? updatedUser : u),
            currentUser: state.currentUser?.email === email ? updatedUser : state.currentUser
        };
    }),

    addUserComment: (email, text, adminName) => set((state) => {
        const user = state.users.find(u => u.email === email);
        if (!user) return state;

        const newNote = {
            id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text,
            date: new Date().toISOString(),
            adminName
        };

        const updatedUser = {
            ...user,
            commentHistory: [newNote, ...(user.commentHistory || [])]
        };

        return {
            users: state.users.map(u => u.email === email ? updatedUser : u),
            currentUser: state.currentUser?.email === email ? updatedUser : state.currentUser
        };
    })
});
