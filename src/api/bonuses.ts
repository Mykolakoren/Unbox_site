import { api } from './client';

export interface Bonus {
    id: string;
    userId: string;
    type: string;
    description: string;
    quantity: number;
    status: 'pending' | 'approved' | 'active' | 'used' | 'expired' | 'rejected';
    grantedById: string;
    grantedByName: string;
    approvedById?: string;
    approvedByName?: string;
    rejectReason?: string;
    expiresAt?: string;
    usedAt?: string;
    isBulk: boolean;
    bulkId?: string;
    createdAt: string;
    updatedAt: string;
}

export const bonusesApi = {
    // User-facing
    getMyBonuses: async (): Promise<Bonus[]> => {
        const { data } = await api.get('/bonuses/my');
        return data;
    },

    // Admin
    listBonuses: async (params?: { status?: string; userId?: string }): Promise<Bonus[]> => {
        const { data } = await api.get('/bonuses/', { params });
        return data;
    },

    createBonus: async (payload: {
        userId: string;
        type?: string;
        description?: string;
        quantity?: number;
        expiresDays?: number;
    }): Promise<Bonus> => {
        const { data } = await api.post('/bonuses/', {
            user_id: payload.userId,
            type: payload.type || 'free_hour',
            description: payload.description || '',
            quantity: payload.quantity || 1,
            expires_days: payload.expiresDays || 90,
        });
        return data;
    },

    createBulkBonus: async (payload: {
        type?: string;
        description?: string;
        quantity?: number;
        expiresDays?: number;
        target?: string;
        userIds?: string[];
    }): Promise<{ ok: boolean; created: number; bulkId: string }> => {
        const { data } = await api.post('/bonuses/bulk', {
            type: payload.type || 'free_hour',
            description: payload.description || '',
            quantity: payload.quantity || 1,
            expires_days: payload.expiresDays || 90,
            target: payload.target || 'all_active',
            user_ids: payload.userIds,
        });
        return data;
    },

    approveBonus: async (id: string): Promise<Bonus> => {
        const { data } = await api.post(`/bonuses/${id}/approve`);
        return data;
    },

    rejectBonus: async (id: string, reason?: string): Promise<Bonus> => {
        const { data } = await api.post(`/bonuses/${id}/reject`, { reason });
        return data;
    },

    useBonus: async (id: string): Promise<Bonus> => {
        const { data } = await api.post(`/bonuses/${id}/use`);
        return data;
    },

    getPendingCount: async (): Promise<{ count: number }> => {
        const { data } = await api.get('/bonuses/pending-count');
        return data;
    },
};
