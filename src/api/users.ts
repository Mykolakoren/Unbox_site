import { api } from './client';
import type { User } from '../store/types';

export const usersApi = {
    /**
     * Default limit raised from 100 → 1000 so every active user fits in
     * one fetch even at moderate scale. The /admin/users/<email> page
     * looks up by email in the local store; if a user falls past the
     * limit they appear as "Клиент не найден" even though they exist.
     * Backend caps at 5000 internally.
     */
    getUsers: async (skip = 0, limit = 1000, includeArchived = false) => {
        const response = await api.get<User[]>('/users/', {
            params: { skip, limit, include_archived: includeArchived }
        });
        return response.data;
    },

    /** Soft-delete a user (Excel #11). Preserves all history; prevents login. */
    archiveUser: async (id: string, reason?: string) => {
        const response = await api.post<User>(
            `/users/${encodeURIComponent(id)}/archive`,
            { reason: reason || null },
        );
        return response.data;
    },

    /** Restore a previously archived user. */
    unarchiveUser: async (id: string) => {
        const response = await api.post<User>(
            `/users/${encodeURIComponent(id)}/unarchive`,
        );
        return response.data;
    },

    updateUser: async (id: string, data: Partial<User> & { reason?: string }) => {
        // Backend expects UserUpdateAdmin model structure
        // We might need to map some fields if names differ, but mostly same.
        // Special case: reason is for logging, handle where needed or separate?
        // Backend update_user endpoint takes UserUpdateAdmin which has tags, etc.
        const response = await api.patch<User>(`/users/${id}`, data);
        return response.data;
    },

    updateMe: async (data: Partial<User>) => {
        const response = await api.patch<User>('/users/me', data);
        return response.data;
    },

    toggleSubscriptionFreeze: async (id: string) => {
        const response = await api.post<User>(`/users/${id}/subscription/freeze`);
        return response.data;
    },

    updatePersonalDiscount: async (id: string, percent: number, reason: string) => {
        const response = await api.post<User>(`/users/${id}/discount`, { percent, reason });
        return response.data;
    },

    /** Admin-only email change. Cascades to Booking/Waitlist/Cashbox refs
     *  that store email as a soft foreign key. Returns the updated user. */
    changeEmail: async (id: string, newEmail: string) => {
        const response = await api.post<User>(
            `/users/${encodeURIComponent(id)}/change-email`,
            { new_email: newEmail },
        );
        return response.data;
    },

    /** Merge two user accounts: `source` is absorbed into `target` and
     *  deleted. All FKs (booking/waitlist/cashbox/notifications) move to
     *  the target, balances sum, subscription fallback, tags union. */
    mergeUsers: async (sourceIdOrEmail: string, targetIdOrEmail: string) => {
        const response = await api.post<User>('/users/merge', {
            source: sourceIdOrEmail,
            target: targetIdOrEmail,
        });
        return response.data;
    },

    getDiscountProgress: async () => {
        const response = await api.get<{
            accumulatedHours: number;
            totalSaved: number;
            currentDiscount: number;
            nextTierHours: number;
            nextTierDiscount: number;
            progressPercent: number;
            tiers: any[];
        }>('/users/me/discount-progress');
        return response.data;
    }
};
