import { api } from './client';

export interface TeamMember {
    id: string;
    name: string;
    role: string;
    roleType: 'founder' | 'senior_admin' | 'admin' | 'other';
    photoUrl: string | null;
    bio: string | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
}

export interface TeamMemberCreate {
    name: string;
    role: string;
    role_type?: string;
    photo_url?: string;
    bio?: string;
    sort_order?: number;
    is_active?: boolean;
}

export interface TeamMemberUpdate {
    name?: string;
    role?: string;
    role_type?: string;
    photo_url?: string;
    bio?: string;
    sort_order?: number;
    is_active?: boolean;
}

export const teamApi = {
    getAll: async (): Promise<TeamMember[]> => {
        const { data } = await api.get('/team');
        return data;
    },

    getAllAdmin: async (): Promise<TeamMember[]> => {
        const { data } = await api.get('/team/all');
        return data;
    },

    create: async (payload: TeamMemberCreate): Promise<TeamMember> => {
        const { data } = await api.post('/team', payload);
        return data;
    },

    update: async (id: string, payload: TeamMemberUpdate): Promise<TeamMember> => {
        const { data } = await api.patch(`/team/${id}`, payload);
        return data;
    },

    delete: async (id: string): Promise<void> => {
        await api.delete(`/team/${id}`);
    },
};
