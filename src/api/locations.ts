import { api } from './client';
import type { Location } from '../types/index';

export const locationsApi = {
    getLocations: async (): Promise<Location[]> => {
        const response = await api.get('/locations/');
        return response.data;
    },
    getLocation: async (id: string): Promise<Location> => {
        const response = await api.get(`/locations/${id}`);
        return response.data;
    }
};
