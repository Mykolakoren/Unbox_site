import { create } from 'zustand';
import { crmApi } from '../api/crm';
import type {
    CrmClient, CrmClientCreate, CrmClientUpdate,
    CrmSession, CrmSessionCreate, CrmSessionUpdate,
    CrmPayment, CrmPaymentCreate,
    CrmNote, CrmNoteCreate,
    CrmDashboard, CrmSpecialist,
} from '../api/crm';

interface CrmStore {
    // State
    clients: CrmClient[];
    sessions: CrmSession[];
    payments: CrmPayment[];
    notes: CrmNote[];
    dashboard: CrmDashboard | null;
    loading: boolean;
    error: string | null;

    // Admin: viewing another specialist's CRM
    viewAsSpecialistId: string | null;
    specialists: CrmSpecialist[];
    setViewAsSpecialist: (id: string | null) => void;
    fetchSpecialists: () => Promise<void>;

    // Clients
    fetchClients: (activeOnly?: boolean) => Promise<void>;
    createClient: (data: CrmClientCreate) => Promise<CrmClient>;
    updateClient: (id: string, data: CrmClientUpdate) => Promise<CrmClient>;
    deleteClient: (id: string) => Promise<void>;

    // Sessions
    fetchSessions: (params?: { clientId?: string; dateFrom?: string; dateTo?: string; status?: string }) => Promise<void>;
    createSession: (data: CrmSessionCreate) => Promise<CrmSession>;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string) => Promise<void>;
    quickPaySession: (id: string) => Promise<{ amount: number; currency: string }>;

    // Payments
    fetchPayments: (params?: { clientId?: string; dateFrom?: string; dateTo?: string }) => Promise<void>;
    createPayment: (data: CrmPaymentCreate) => Promise<CrmPayment>;

    // Notes
    fetchNotes: (clientId?: string) => Promise<void>;
    createNote: (data: CrmNoteCreate) => Promise<CrmNote>;
    deleteNote: (id: string) => Promise<void>;

    // Dashboard
    fetchDashboard: () => Promise<void>;
}

export const useCrmStore = create<CrmStore>((set, get) => ({
    clients: [],
    sessions: [],
    payments: [],
    notes: [],
    dashboard: null,
    loading: false,
    error: null,

    // ── Admin specialist view ─────────────────────────────────────────────────
    viewAsSpecialistId: null,
    specialists: [],

    setViewAsSpecialist: (id) => {
        set({ viewAsSpecialistId: id });
    },

    fetchSpecialists: async () => {
        try {
            const specialists = await crmApi.getSpecialists();
            set({ specialists });
        } catch { /* ignore if not admin */ }
    },

    // ── Clients ──────────────────────────────────────────────────────────────

    fetchClients: async (activeOnly = false) => {
        set({ loading: true, error: null });
        try {
            const clients = await crmApi.getClients(activeOnly, get().viewAsSpecialistId ?? undefined);
            set({ clients, loading: false });
        } catch (e: any) {
            set({ error: e.message, loading: false });
        }
    },

    createClient: async (data) => {
        const client = await crmApi.createClient(data);
        set((s) => ({ clients: [...s.clients, client].sort((a, b) => a.name.localeCompare(b.name)) }));
        return client;
    },

    updateClient: async (id, data) => {
        const updated = await crmApi.updateClient(id, data);
        set((s) => ({
            clients: s.clients.map((c) => (c.id === id ? updated : c)),
        }));
        return updated;
    },

    deleteClient: async (id) => {
        await crmApi.deleteClient(id);
        // Soft delete — update is_active to false locally
        set((s) => ({
            clients: s.clients.map((c) => (c.id === id ? { ...c, isActive: false } : c)),
        }));
    },

    // ── Sessions ─────────────────────────────────────────────────────────────

    fetchSessions: async (params) => {
        set({ loading: true, error: null });
        try {
            const sessions = await crmApi.getSessions({
                ...params,
                specialistId: get().viewAsSpecialistId ?? undefined,
            });
            set({ sessions, loading: false });
        } catch (e: any) {
            set({ error: e.message, loading: false });
        }
    },

    createSession: async (data) => {
        const session = await crmApi.createSession(data);
        set((s) => ({ sessions: [session, ...s.sessions] }));
        return session;
    },

    updateSession: async (id, data) => {
        const updated = await crmApi.updateSession(id, data);
        set((s) => ({
            sessions: s.sessions.map((sess) => (sess.id === id ? updated : sess)),
        }));
        return updated;
    },

    deleteSession: async (id) => {
        await crmApi.deleteSession(id);
        set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
    },

    quickPaySession: async (id) => {
        const result = await crmApi.quickPaySession(id);
        set((s) => ({
            sessions: s.sessions.map((sess) =>
                sess.id === id ? { ...sess, isPaid: true } : sess
            ),
        }));
        return { amount: result.amount, currency: result.currency };
    },

    // ── Payments ─────────────────────────────────────────────────────────────

    fetchPayments: async (params) => {
        set({ loading: true, error: null });
        try {
            const payments = await crmApi.getPayments({
                ...params,
                specialistId: get().viewAsSpecialistId ?? undefined,
            });
            set({ payments, loading: false });
        } catch (e: any) {
            set({ error: e.message, loading: false });
        }
    },

    createPayment: async (data) => {
        const payment = await crmApi.createPayment(data);
        set((s) => ({ payments: [payment, ...s.payments] }));
        // If session linked, mark it as paid
        if (data.sessionId) {
            set((s) => ({
                sessions: s.sessions.map((sess) =>
                    sess.id === data.sessionId ? { ...sess, isPaid: true } : sess
                ),
            }));
        }
        return payment;
    },

    // ── Notes ────────────────────────────────────────────────────────────────

    fetchNotes: async (clientId) => {
        try {
            const notes = await crmApi.getNotes(clientId, get().viewAsSpecialistId ?? undefined);
            set({ notes });
        } catch (e: any) {
            set({ error: e.message });
        }
    },

    createNote: async (data) => {
        const note = await crmApi.createNote(data);
        set((s) => ({ notes: [note, ...s.notes] }));
        return note;
    },

    deleteNote: async (id) => {
        await crmApi.deleteNote(id);
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    },

    // ── Dashboard ────────────────────────────────────────────────────────────

    fetchDashboard: async () => {
        set({ loading: true, error: null });
        try {
            const dashboard = await crmApi.getDashboard(get().viewAsSpecialistId ?? undefined);
            set({ dashboard, loading: false });
        } catch (e: any) {
            set({ error: e.message, loading: false });
        }
    },
}));
