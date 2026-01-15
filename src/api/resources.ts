import { api } from './client';
import type { Resource } from '../types';

export const resourcesApi = {
    getAll: async (): Promise<Resource[]> => {
        const response = await api.get('/resources');
        return response.data;
    },

    getById: async (id: string): Promise<Resource> => {
        const response = await api.get(`/resources/${id}`);
        return response.data;
    },

    create: async (resource: Resource): Promise<Resource> => {
        const response = await api.post('/resources', resource);
        return response.data;
    },

    update: async (id: string, updates: Partial<Resource>): Promise<Resource> => {
        const response = await api.put(`/resources/${id}`, updates);
        return response.data;
    },

    delete: async (id: string): Promise<void> => {
        await api.delete(`/resources/${id}`);
    }
};
