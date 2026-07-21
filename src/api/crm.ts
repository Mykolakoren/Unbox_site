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
    /** Owning specialist's display name. Populated for admin/owner callers
     * when the list spans multiple specialists, so the booking-flow dropdown
     * can disambiguate "Maria → Yana" vs "Maria → Galina". */
    specialistName?: string;
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
    currency?: string;   // Frozen at payment time; null → use client.currency
    account?: string;    // Frozen at payment time; null → use client.defaultAccount
    isPaid: boolean;
    isBooked: boolean;
    notes?: string;
    googleEventId?: string;
    bookingId?: string;
    // Stamped on every member of a recurring series so the delete UI can
    // offer "this one" vs "this and all future" — same pattern as Google
    // Calendar. Null on legacy sessions and one-off sessions.
    recurringGroupId?: string;
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
    recurringGroupId?: string;
    pushToCalendar?: boolean;
}

export interface CrmSessionUpdate {
    clientId?: string;
    date?: string;
    durationMinutes?: number;
    status?: string;
    price?: number;
    isPaid?: boolean;
    isBooked?: boolean;
    bookingId?: string;
    notes?: string;
}

export interface CrmSettings {
    calendarId: string | null;
    calendarSyncEnabled: boolean;
    googleCalendarSourceOfTruth: boolean;
}

export interface CrmSyncResult {
    totalEvents: number;
    matched: number;
    unmatched: number;
    created: number;
    updated: number;
    autoCreatedClients: number;
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
    sessionId?: string;
    specialistId: string;
    content: string;
    tags?: string;
    createdAt: string;
}

export interface CrmNoteCreate {
    clientId: string;
    sessionId?: string;
    content: string;
    tags?: string;
}

export interface MonthlyStats {
    month: string;
    received: number;
    expected: number;
    sessionCount: number;
}

export interface ClientWithoutSessions {
    id: string;
    name: string;
    lastSessionDate: string | null;
}

export interface DebtByClient {
    clientId: string;
    clientName: string;
    totalDebt: number;
    unpaidSessionsCount: number;
    currency?: string;
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
    // Extended
    monthlyStats?: MonthlyStats[];
    clientsWithoutFutureSessions?: ClientWithoutSessions[];
    debtByClient?: DebtByClient[];
    avgCheck?: number;
    avgHourlyRate?: number;
    minRate?: number;
    maxRate?: number;
    totalActiveDebt?: number;
    debtByCurrency?: Record<string, number>;
    revenueByCurrency?: Record<string, number>;
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface CrmSpecialist {
    id: string;
    name: string;
    email: string;
}

export interface CrmAccessStatus {
    accessStatus: 'none' | 'pending' | 'active' | 'expired' | 'rejected';
    permanent: boolean;
    expiresAt: string | null;
    daysRemaining: number | null;
}

export interface CrmAccessRequest {
    userId: string;
    name: string;
    email: string;
    phone?: string;
    profession: string;
    message: string;
    submittedAt: string;
    avatarUrl?: string;
}

export const crmApi = {
    // Specialists (admin only)
    getSpecialists: async (): Promise<CrmSpecialist[]> => {
        const response = await api.get('/crm/specialists');
        return response.data;
    },

    // Clients
    getClients: async (activeOnly = false, specialistId?: string, withStats = false): Promise<CrmClient[]> => {
        const response = await api.get('/crm/clients', {
            params: { active_only: activeOnly, specialist_id: specialistId, with_stats: withStats },
        });
        return response.data;
    },

    getClient: async (id: string): Promise<CrmClient> => {
        const response = await api.get(`/crm/clients/${id}`);
        return response.data;
    },

    getClientBalance: async (id: string): Promise<{ total_paid: number; total_expected: number; debt: number; prepayment: number; unpaid_sessions_count: number }> => {
        const response = await api.get(`/crm/clients/${id}/balance`);
        return response.data;
    },

    createClient: async (data: CrmClientCreate): Promise<CrmClient> => {
        const response = await api.post('/crm/clients', data);
        return response.data;
    },

    updateClient: async (id: string, data: CrmClientUpdate, applyPriceTo?: 'all_unpaid' | 'future_only'): Promise<CrmClient> => {
        const response = await api.patch(`/crm/clients/${id}`, data, {
            params: applyPriceTo ? { apply_price_to: applyPriceTo } : {},
        });
        return response.data;
    },

    deleteClient: async (id: string, permanent = false): Promise<void> => {
        await api.delete(`/crm/clients/${id}`, { params: permanent ? { permanent: true } : {} });
    },

    mergeClients: async (data: {
        targetId: string;
        sourceIds: string[];
        name?: string;
        phone?: string;
        email?: string;
        telegram?: string;
    }): Promise<{ ok: boolean; targetId: string; mergedCount: number; reassigned: { sessions: number; payments: number; notes: number } }> => {
        const response = await api.post('/crm/clients/merge', {
            target_id: data.targetId,
            source_ids: data.sourceIds,
            name: data.name,
            phone: data.phone,
            email: data.email,
            telegram: data.telegram,
        });
        return response.data;
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

    /**
     * Delete a CRM session. Pass `scope='future'` to also remove every later
     * occurrence in the same recurring series (matches the GCal delete UX).
     * Backend cleans up Google Calendar events for the deleted rows.
     */
    deleteSession: async (id: string, scope: 'this' | 'future' = 'this'): Promise<{ ok: boolean; deleted: number; deletedGcal: number; scope: string }> => {
        const res = await api.delete(`/crm/sessions/${id}`, { params: { scope } });
        return res.data;
    },

    /**
     * Detach the cabinet booking from a CRM session. Default keeps the
     * underlying booking alive (so it can be re-attached to a different
     * session); pass `cancelBooking=true` to also cancel the cabinet
     * booking entirely (refund + GCal delete via the standard cancel flow).
     */
    detachCabinet: async (sessionId: string, cancelBooking = false): Promise<{ ok: boolean; sessionId: string; detachedBookingId: string; bookingCancelled: boolean }> => {
        const res = await api.post(`/crm/sessions/${sessionId}/detach-cabinet`, null, {
            params: { cancel_booking: cancelBooking },
        });
        return res.data;
    },

    /**
     * Find unlinked (CRM session, cabinet booking) pairs that share the
     * same date + time. Used by the dashboard banner to ask "найдено N
     * пар бронь+сессия в одно время — объединить?".
     */
    getMergeSuggestions: async (): Promise<{
        pairs: Array<{
            sessionId: string;
            sessionDate: string;
            sessionDuration: number;
            clientId: string;
            clientName?: string | null;
            bookingId: string;
            bookingResourceId: string;
            bookingStartTime: string;
            bookingDuration: number;
        }>;
    }> => {
        const res = await api.get('/crm/merge-suggestions');
        return res.data;
    },

    /** Apply a single merge: link the session to the booking. Sets
     *  session.booking_id + is_booked, and back-fills the booking's
     *  crm_client_id if missing. */
    acceptMergeSuggestion: async (sessionId: string, bookingId: string): Promise<{ ok: boolean }> => {
        const res = await api.post('/crm/merge-suggestions/accept', { sessionId, bookingId });
        return res.data;
    },

    autoCompleteSessions: async (): Promise<{ ok: boolean; autoCompleted: number }> => {
        const response = await api.post('/crm/sessions/auto-complete');
        return response.data;
    },

    quickPaySession: async (id: string, account?: string): Promise<{ ok: boolean; amount: number; currency: string; account?: string }> => {
        const response = await api.post(`/crm/sessions/${id}/quick-pay`, account ? { account } : {});
        return response.data;
    },

    unmarkPaidSession: async (id: string): Promise<{ ok: boolean }> => {
        const response = await api.post(`/crm/sessions/${id}/unmark-paid`);
        return response.data;
    },

    markAllPaid: async (clientId: string): Promise<{ ok: boolean; marked: number }> => {
        const response = await api.post(`/crm/clients/${clientId}/mark-all-paid`);
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

    /** Удалить платёж. Если он был последним по своей сессии, с неё снимается «оплачено». */
    deletePayment: async (paymentId: string): Promise<void> => {
        await api.delete(`/crm/payments/${paymentId}`);
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
    getDashboard: async (specialistId?: string, month?: string): Promise<CrmDashboard> => {
        const params: Record<string, string> = {};
        if (specialistId) params.specialist_id = specialistId;
        if (month) params.month = month;
        const response = await api.get('/crm/dashboard', { params });
        return response.data;
    },

    // Settings
    getSettings: async (): Promise<CrmSettings> => {
        const response = await api.get('/crm/settings');
        return response.data;
    },

    updateSettings: async (data: { calendarId?: string | null; googleCalendarSourceOfTruth?: boolean }): Promise<{ ok: boolean }> => {
        const body: Record<string, any> = {};
        if (data.calendarId !== undefined) body.calendar_id = data.calendarId;
        if (data.googleCalendarSourceOfTruth !== undefined) body.google_calendar_source_of_truth = data.googleCalendarSourceOfTruth;
        const response = await api.patch('/crm/settings', body);
        return response.data;
    },

    // Google Calendar Sync
    syncFromCalendar: async (dryRun = false, monthsBack = 1, monthsForward = 1): Promise<CrmSyncResult> => {
        // Бэкенд раньше игнорировал months_back и тянул только 48 ч назад —
        // поэтому сессии за прошлую неделю не появлялись. Теперь реальное
        // окно прошлого задаётся past_days; привязываем к контролу «период
        // назад»: 0 = текущий месяц (с 1-го числа), N = +N месяцев вглубь.
        const dayOfMonth = new Date().getDate();
        const pastDays = Math.max(2, monthsBack * 31 + dayOfMonth);
        const response = await api.post('/crm/sync/calendar', null, {
            params: { dry_run: dryRun, months_back: monthsBack, months_forward: monthsForward, past_days: pastDays },
        });
        return response.data;
    },

    /**
     * Smoke-test the user's calendar config. Returns ok/false with a
     * Russian message ready to show in the UI — useful as a pre-flight
     * check on /crm/settings so misconfigured sharing surfaces before
     * the admin clicks "Синхронизировать" expecting it to just work.
     */
    testCalendarConnection: async (): Promise<{
        ok: boolean;
        calendarId: string | null;
        serviceAccount: string;
        message?: string;
    }> => {
        const response = await api.get('/crm/sync/test-connection');
        return response.data;
    },

    syncClientHistory: async (clientId: string, monthsBack?: number, monthsForward?: number): Promise<{ totalFound: number; created: number }> => {
        const params: Record<string, number> = {};
        if (monthsBack !== undefined) params.months_back = monthsBack;
        if (monthsForward !== undefined) params.months_forward = monthsForward;
        const response = await api.post(`/crm/clients/${clientId}/sync-history`, null, { params });
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

    getUserAccess: async (userId: string): Promise<CrmAccessStatus & { profession?: string; message?: string; submittedAt?: string }> => {
        const response = await api.get(`/crm/access-status/${userId}`);
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

    // Payment Accounts
    getPaymentAccounts: async (): Promise<{ id: string; label: string }[]> => {
        const response = await api.get('/crm/payment-accounts');
        return response.data;
    },

    updatePaymentAccounts: async (accounts: { id: string; label: string }[]): Promise<{ id: string; label: string }[]> => {
        const response = await api.put('/crm/payment-accounts', accounts);
        return response.data;
    },
};
