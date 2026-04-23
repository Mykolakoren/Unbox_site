import { api } from './client';
import type { Location } from '../types/index';

export const locationsApi = {
    // Public/client calls — backend already filters is_active=False out.
    getLocations: async (): Promise<Location[]> => {
        const response = await api.get('/locations/');
        return response.data;
    },
    // Admin-only: includes hidden/inactive locations so owner can toggle them.
    getAllLocations: async (): Promise<Location[]> => {
        const response = await api.get('/locations/?include_inactive=true');
        return response.data;
    },
    getLocation: async (id: string): Promise<Location> => {
        const response = await api.get(`/locations/${id}`);
        return response.data;
    },
    updateLocation: async (
        id: string,
        patch: Partial<Pick<Location, 'name' | 'address' | 'isActive'>>,
    ): Promise<Location> => {
        const response = await api.put(`/locations/${id}`, patch);
        return response.data;
    },
    setActive: async (id: string, isActive: boolean): Promise<Location> => {
        const response = await api.put(`/locations/${id}`, { isActive });
        return response.data;
    },
};
