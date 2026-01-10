import { api } from './client';
import type { User } from '../store/types';

export const usersApi = {
    getUsers: async (skip = 0, limit = 100) => {
        const response = await api.get<User[]>('/users/', {
            params: { skip, limit }
        });
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
    }
};
