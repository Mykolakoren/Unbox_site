import { api } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CrmClient {
    id: string;
    specialistId: string;
    name: string;
    phone?: string;
    email?: string;
    telegram?: string;
    aliasCode?: string;
    basePrice: number;
    currency: string;
    defaultAccount: string;
    isActive: boolean;
    pipelineStatus: string;
    tags: string[];
    notesText?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CrmClientCreate {
    name: string;
    phone?: string;
    email?: string;
    telegram?: string;
    aliasCode?: string;
    basePrice?: number;
    currency?: string;
    defaultAccount?: string;
    pipelineStatus?: string;
    tags?: string[];
}

export interface CrmClientUpdate {
    name?: string;
    phone?: string;
    email?: string;
    telegram?: string;
    aliasCode?: string;
    basePrice?: number;
    currency?: string;
    defaultAccount?: string;
    isActive?: boolean;
    pipelineStatus?: string;
    tags?: string[];
    notesText?: string;
}

export interface CrmSession {
    id: string;
    clientId: string;
    specialistId: string;
    date: string;
    durationMinutes: number;
    status: 'PLANNED' | 'COMPLETED' | 'CANCELLED_CLIENT' | 'CANCELLED_THERAPIST';
    price?: number;
    isPaid: boolean;
    isBooked: boolean;
    notes?: string;
    googleEventId?: string;
    bookingId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CrmSessionCreate {
    clientId: string;
    date: string;
    durationMinutes?: number;
    status?: string;
    price?: number;
    isPaid?: boolean;
    isBooked?: boolean;
    notes?: string;
    bookingId?: string;
    pushToCalendar?: boolean;
}

export interface CrmSessionUpdate {
    date?: string;
    durationMinutes?: number;
    status?: string;
    price?: number;
    isPaid?: boolean;
    isBooked?: boolean;
    notes?: string;
}

export interface CrmSettings {
    calendarId: string | null;
    calendarSyncEnabled: boolean;
}

export interface CrmSyncResult {
    totalEvents: number;
    matched: number;
    unmatched: number;
    created: number;
    updated: number;
    unmatchedSummaries: string[];
}

export interface CrmPayment {
    id: string;
    clientId: string;
    specialistId: string;
    amount: number;
    currency: string;
    account: string;
    date: string;
    sessionId?: string;
    createdAt: string;
}

export interface CrmPaymentCreate {
    clientId: string;
    amount: number;
    currency?: string;
    account?: string;
    date?: string;
    sessionId?: string;
}

export interface CrmNote {
    id: string;
    clientId: string;
    specialistId: string;
    content: string;
    tags?: string;
    createdAt: string;
}

export interface CrmNoteCreate {
    clientId: string;
    content: string;
    tags?: string;
}

export interface CrmDashboard {
    activeClients: number;
    sessionsThisMonth: number;
    unpaidSessions: number;
    revenueThisMonth: number;
    upcomingSessions: {
        id: string;
        date: string;
        clientName: string;
        clientId: string;
        status: string;
        isBooked: boolean;
    }[];
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface CrmSpecialist {
    id: string;
    name: string;
    email: string;
}

export interface CrmAccessStatus {
    access_status: 'none' | 'pending' | 'active' | 'expired' | 'rejected';
    permanent: boolean;
    expires_at: string | null;
    days_remaining: number | null;
}

export interface CrmAccessRequest {
    user_id: string;
    name: string;
    email: string;
    phone?: string;
    profession: string;
    message: string;
    submitted_at: string;
    avatar_url?: string;
}

export const crmApi = {
    // Specialists (admin only)
    getSpecialists: async (): Promise<CrmSpecialist[]> => {
        const response = await api.get('/crm/specialists');
        return response.data;
    },

    // Clients
    getClients: async (activeOnly = false, specialistId?: string): Promise<CrmClient[]> => {
        const response = await api.get('/crm/clients', {
            params: { active_only: activeOnly, specialist_id: specialistId },
        });
        return response.data;
    },

    getClient: async (id: string): Promise<CrmClient> => {
        const response = await api.get(`/crm/clients/${id}`);
        return response.data;
    },

    createClient: async (data: CrmClientCreate): Promise<CrmClient> => {
        const response = await api.post('/crm/clients', data);
        return response.data;
    },

    updateClient: async (id: string, data: CrmClientUpdate): Promise<CrmClient> => {
        const response = await api.patch(`/crm/clients/${id}`, data);
        return response.data;
    },

    deleteClient: async (id: string, permanent = false): Promise<void> => {
        await api.delete(`/crm/clients/${id}`, { params: permanent ? { permanent: true } : {} });
    },

    // Sessions
    getSessions: async (params?: {
        clientId?: string;
        dateFrom?: string;
        dateTo?: string;
        status?: string;
        specialistId?: string;
    }): Promise<CrmSession[]> => {
        const response = await api.get('/crm/sessions', {
            params: {
                client_id: params?.clientId,
                date_from: params?.dateFrom,
                date_to: params?.dateTo,
                status: params?.status,
                specialist_id: params?.specialistId,
            },
        });
        return response.data;
    },

    createSession: async (data: CrmSessionCreate): Promise<CrmSession> => {
        const response = await api.post('/crm/sessions', data);
        return response.data;
    },

    updateSession: async (id: string, data: CrmSessionUpdate): Promise<CrmSession> => {
        const response = await api.patch(`/crm/sessions/${id}`, data);
        return response.data;
    },

    deleteSession: async (id: string): Promise<void> => {
        await api.delete(`/crm/sessions/${id}`);
    },

    quickPaySession: async (id: string): Promise<{ ok: boolean; amount: number; currency: string }> => {
        const response = await api.post(`/crm/sessions/${id}/quick-pay`);
        return response.data;
    },

    // Payments
    getPayments: async (params?: {
        clientId?: string;
        dateFrom?: string;
        dateTo?: string;
        specialistId?: string;
    }): Promise<CrmPayment[]> => {
        const response = await api.get('/crm/payments', {
            params: {
                client_id: params?.clientId,
                date_from: params?.dateFrom,
                date_to: params?.dateTo,
                specialist_id: params?.specialistId,
            },
        });
        return response.data;
    },

    createPayment: async (data: CrmPaymentCreate): Promise<CrmPayment> => {
        const response = await api.post('/crm/payments', data);
        return response.data;
    },

    // Notes
    getNotes: async (clientId?: string, specialistId?: string): Promise<CrmNote[]> => {
        const response = await api.get('/crm/notes', {
            params: { client_id: clientId, specialist_id: specialistId },
        });
        return response.data;
    },

    createNote: async (data: CrmNoteCreate): Promise<CrmNote> => {
        const response = await api.post('/crm/notes', data);
        return response.data;
    },

    deleteNote: async (id: string): Promise<void> => {
        await api.delete(`/crm/notes/${id}`);
    },

    // Dashboard
    getDashboard: async (specialistId?: string): Promise<CrmDashboard> => {
        const response = await api.get('/crm/dashboard', {
            params: specialistId ? { specialist_id: specialistId } : {},
        });
        return response.data;
    },

    // Settings
    getSettings: async (): Promise<CrmSettings> => {
        const response = await api.get('/crm/settings');
        return response.data;
    },

    updateSettings: async (calendarId: string | null): Promise<{ ok: boolean; calendarId: string | null }> => {
        const response = await api.patch('/crm/settings', { calendar_id: calendarId });
        return response.data;
    },

    // Google Calendar Sync
    syncFromCalendar: async (dryRun = false): Promise<CrmSyncResult> => {
        const response = await api.post('/crm/sync/calendar', null, {
            params: { dry_run: dryRun },
        });
        return response.data;
    },

    syncClientHistory: async (clientId: string): Promise<{ totalFound: number; created: number }> => {
        const response = await api.post(`/crm/clients/${clientId}/sync-history`);
        return response.data;
    },

    // CRM Access / Subscription
    getMyAccess: async (): Promise<CrmAccessStatus> => {
        const response = await api.get('/crm/my-access');
        return response.data;
    },

    applyForAccess: async (profession?: string, message?: string): Promise<{ ok: boolean; status: string }> => {
        const response = await api.post('/crm/apply', { profession, message });
        return response.data;
    },

    getAccessRequests: async (): Promise<CrmAccessRequest[]> => {
        const response = await api.get('/crm/access-requests');
        return response.data;
    },

    approveAccessRequest: async (userId: string, days = 30): Promise<{ ok: boolean }> => {
        const response = await api.post(`/crm/access-requests/${userId}/approve`, { days });
        return response.data;
    },

    rejectAccessRequest: async (userId: string, reason?: string): Promise<{ ok: boolean }> => {
        const response = await api.post(`/crm/access-requests/${userId}/reject`, { reason });
        return response.data;
    },
};
