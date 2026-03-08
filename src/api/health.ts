import { api as client } from './client';

export interface IntegrationStatus {
    googleCalendar: {
        connected: boolean;
        status: string;
    };
}

export const healthApi = {
    checkIntegrations: async (): Promise<IntegrationStatus> => {
        // The api client already has the auth interceptor, so the token will be attached
        const response = await client.get<IntegrationStatus>('/health/integrations');
        return response.data;
    },
};
