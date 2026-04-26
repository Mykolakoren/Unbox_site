import { create } from 'zustand';
import { toast } from 'sonner';
import { crmApi } from '../api/crm';
import type {
    CrmClient, CrmClientCreate, CrmClientUpdate,
    CrmSession, CrmSessionCreate, CrmSessionUpdate,
    CrmPayment, CrmPaymentCreate,
    CrmNote, CrmNoteCreate,
    CrmDashboard, CrmSpecialist,
} from '../api/crm';

export interface PaymentAccount {
    id: string;
    label: string;
}

interface CrmStore {
    // State
    clients: CrmClient[];
    sessions: CrmSession[];
    payments: CrmPayment[];
    notes: CrmNote[];
    dashboard: CrmDashboard | null;
    paymentAccounts: PaymentAccount[];
    loading: boolean;
    error: string | null;

    // Admin: viewing another specialist's CRM
    viewAsSpecialistId: string | null;
    specialists: CrmSpecialist[];
    setViewAsSpecialist: (id: string | null) => void;
    fetchSpecialists: () => Promise<void>;

    // Clients
    fetchClients: (activeOnly?: boolean, withStats?: boolean) => Promise<void>;
    createClient: (data: CrmClientCreate) => Promise<CrmClient>;
    updateClient: (id: string, data: CrmClientUpdate) => Promise<CrmClient>;
    deleteClient: (id: string, permanent?: boolean) => Promise<void>;

    // Sessions
    fetchSessions: (params?: { clientId?: string; dateFrom?: string; dateTo?: string; status?: string }) => Promise<void>;
    createSession: (data: CrmSessionCreate) => Promise<CrmSession>;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string, scope?: 'this' | 'future') => Promise<{ deleted: number; deletedGcal: number }>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string }>;

    // Payments
    fetchPayments: (params?: { clientId?: string; dateFrom?: string; dateTo?: string }) => Promise<void>;
    createPayment: (data: CrmPaymentCreate) => Promise<CrmPayment>;

    // Notes
    fetchNotes: (clientId?: string) => Promise<void>;
    createNote: (data: CrmNoteCreate) => Promise<CrmNote>;
    deleteNote: (id: string) => Promise<void>;

    // Dashboard
    fetchDashboard: (month?: string) => Promise<void>;

    // Payment Accounts
    fetchPaymentAccounts: () => Promise<void>;
    updatePaymentAccounts: (accounts: PaymentAccount[]) => Promise<void>;
}

export const useCrmStore = create<CrmStore>((set, get) => ({
    clients: [],
    sessions: [],
    payments: [],
    notes: [],
    dashboard: null,
    paymentAccounts: [
        { id: 'cash', label: 'Наличные' },
        { id: 'tbc', label: 'TBC' },
        { id: 'bog', label: 'BOG' },
    ],
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

    fetchClients: async (activeOnly = false, withStats = false) => {
        set({ loading: true, error: null });
        try {
            const clients = await crmApi.getClients(activeOnly, get().viewAsSpecialistId ?? undefined, withStats);
            set({ clients, loading: false });
        } catch (e: any) {
            set({ error: e.message, loading: false });
        }
    },

    createClient: async (data) => {
        try {
            const client = await crmApi.createClient(data);
            set((s) => ({ clients: [...s.clients, client].sort((a, b) => a.name.localeCompare(b.name)) }));
            return client;
        } catch (error) {
            toast.error('Не удалось создать клиента');
            throw error;
        }
    },

    updateClient: async (id, data) => {
        try {
            const updated = await crmApi.updateClient(id, data);
            set((s) => ({
                clients: s.clients.map((c) => (c.id === id ? updated : c)),
            }));
            return updated;
        } catch (error) {
            toast.error('Не удалось обновить клиента');
            throw error;
        }
    },

    deleteClient: async (id, permanent = false) => {
        try {
            await crmApi.deleteClient(id, permanent);
            if (permanent) {
                set((s) => ({ clients: s.clients.filter((c) => c.id !== id) }));
            } else {
                set((s) => ({ clients: s.clients.map((c) => (c.id === id ? { ...c, isActive: false } : c)) }));
            }
        } catch (error) {
            toast.error('Не удалось удалить клиента');
            throw error;
        }
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
        try {
            const session = await crmApi.createSession(data);
            set((s) => ({ sessions: [session, ...s.sessions] }));
            return session;
        } catch (error) {
            toast.error('Не удалось создать сессию');
            throw error;
        }
    },

    updateSession: async (id, data) => {
        try {
            const updated = await crmApi.updateSession(id, data);
            set((s) => ({
                sessions: s.sessions.map((sess) => (sess.id === id ? updated : sess)),
            }));
            return updated;
        } catch (error) {
            toast.error('Не удалось обновить сессию');
            throw error;
        }
    },

    deleteSession: async (id, scope = 'this') => {
        try {
            const res = await crmApi.deleteSession(id, scope);
            // For scope='this' we drop just one row; for 'future' we drop the
            // pivot session and every later sibling in the same series.
            if (scope === 'future') {
                const pivot = get().sessions.find((s) => s.id === id);
                const groupId = pivot?.recurringGroupId;
                if (pivot && groupId) {
                    set((s) => ({
                        sessions: s.sessions.filter(
                            (sess) =>
                                !(sess.recurringGroupId === groupId && new Date(sess.date) >= new Date(pivot.date)),
                        ),
                    }));
                } else {
                    set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
                }
            } else {
                set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
            }
            return { deleted: res.deleted, deletedGcal: res.deletedGcal };
        } catch (error) {
            toast.error('Не удалось удалить сессию');
            throw error;
        }
    },

    quickPaySession: async (id, account?) => {
        try {
            const result = await crmApi.quickPaySession(id, account);
            set((s) => ({
                sessions: s.sessions.map((sess) =>
                    sess.id === id ? { ...sess, isPaid: true } : sess
                ),
            }));
            return { amount: result.amount, currency: result.currency };
        } catch (error) {
            toast.error('Не удалось отметить оплату');
            throw error;
        }
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
        try {
            const payment = await crmApi.createPayment(data);
            set((s) => ({ payments: [payment, ...s.payments] }));
            if (data.sessionId) {
                set((s) => ({
                    sessions: s.sessions.map((sess) =>
                        sess.id === data.sessionId ? { ...sess, isPaid: true } : sess
                    ),
                }));
            }
            return payment;
        } catch (error) {
            toast.error('Не удалось создать платёж');
            throw error;
        }
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
        try {
            const note = await crmApi.createNote(data);
            set((s) => ({ notes: [note, ...s.notes] }));
            return note;
        } catch (error) {
            toast.error('Не удалось создать заметку');
            throw error;
        }
    },

    deleteNote: async (id) => {
        try {
            await crmApi.deleteNote(id);
            set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
        } catch (error) {
            toast.error('Не удалось удалить заметку');
            throw error;
        }
    },

    // ── Dashboard ────────────────────────────────────────────────────────────

    fetchDashboard: async (month?: string) => {
        set({ loading: true, error: null });
        try {
            const dashboard = await crmApi.getDashboard(get().viewAsSpecialistId ?? undefined, month);
            set({ dashboard, loading: false });
        } catch (e: any) {
            set({ error: e.message, loading: false });
        }
    },

    // ── Payment Accounts ──────────────────────────────────────────────────

    fetchPaymentAccounts: async () => {
        try {
            const accounts = await crmApi.getPaymentAccounts();
            if (accounts && accounts.length > 0) {
                set({ paymentAccounts: accounts });
            }
        } catch { /* use defaults */ }
    },

    updatePaymentAccounts: async (accounts) => {
        try {
            const updated = await crmApi.updatePaymentAccounts(accounts);
            set({ paymentAccounts: updated });
        } catch (error) {
            toast.error('Не удалось сохранить платёжные аккаунты');
            throw error;
        }
    },
}));
