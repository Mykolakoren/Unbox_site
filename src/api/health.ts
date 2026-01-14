import { api as client } from './client';

export interface IntegrationStatus {
    google_calendar: {
        connected: boolean;
        status: string;
    };
}

export const healthApi = {
    checkIntegrations: async (): Promise<IntegrationStatus> => {
        const response = await client.get<IntegrationStatus>('/health/integrations');
        return response.data;
    },
};
