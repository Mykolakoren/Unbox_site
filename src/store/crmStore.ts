import { create } from 'zustand';
import { toast } from 'sonner';
import { crmApi } from '../api/crm';
import { calendarNearConflict } from '../utils/crmCalendarConflict';
import { toastApiError } from '../utils/errors';
import { paidLocally } from '../utils/sessionMoney';
import { fetchExchangeRates } from '../utils/currency';

// Dedup concurrent quick-pay calls per session id — a double-tap on the "Оплатить"
// button (the flag flips isPaid only AFTER the await) would otherwise fire two
// payment API calls. Returning the same in-flight promise = one call, both
// callers get the real result.
const _quickPayInFlight = new Map<string, Promise<{ amount: number; currency: string; added?: number; created?: boolean }>>();
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
    /** Валюта счёта (07.09): выбрал счёт «Mono» — платёж по умолчанию в UAH. */
    currency?: string;
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
    fetchClients: (activeOnly?: boolean, withStats?: boolean, specialistId?: string) => Promise<void>;
    createClient: (data: CrmClientCreate) => Promise<CrmClient>;
    updateClient: (id: string, data: CrmClientUpdate) => Promise<CrmClient>;
    deleteClient: (id: string, permanent?: boolean) => Promise<void>;

    // Sessions
    fetchSessions: (params?: { clientId?: string; dateFrom?: string; dateTo?: string; status?: string }) => Promise<void>;
    createSession: (data: CrmSessionCreate) => Promise<CrmSession>;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string, scope?: 'this' | 'future') => Promise<{ deleted: number; deletedGcal: number }>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string; added?: number; created?: boolean }>;

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

    fetchClients: async (activeOnly = false, withStats = false, specialistId?: string) => {
        set({ loading: true, error: null });
        // Курсы валют для «≈ ₾» — вошедшему подтягиваем здесь (модуль сам грузит их только при токене).
        void fetchExchangeRates();
        try {
            // Explicit `specialistId` (admin-proxy booking flow) wins over
            // the persistent `viewAsSpecialistId` (admin CRM viewer mode).
            const targetId = specialistId ?? get().viewAsSpecialistId ?? undefined;
            const clients = await crmApi.getClients(activeOnly, targetId, withStats);
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
            // «Рядом уже есть встреча в календаре» — вопрос, а не сбой:
            // его разбирает createSessionResolvingCalendar на экране.
            if (!calendarNearConflict(error)) toast.error('Не удалось создать сессию');
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
            // Русский ответ сервера («Валюта «ZZZ» не заведена…») показываем как есть,
            // а не общее «не удалось»; без ответа — понятная причина (связь, таймаут).
            toastApiError(error, 'Не удалось обновить сессию');
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
        const existing = _quickPayInFlight.get(id);
        if (existing) return existing;
        const p = (async () => {
            try {
                const result = await crmApi.quickPaySession(id, account);
                set((s) => ({
                    sessions: s.sessions.map((sess) =>
                        sess.id === id ? paidLocally(sess) : sess
                    ),
                }));
                return { amount: result.amount, currency: result.currency, added: result.added, created: result.created };
            } catch (error) {
                toast.error('Не удалось отметить оплату');
                throw error;
            } finally {
                _quickPayInFlight.delete(id);
            }
        })();
        _quickPayInFlight.set(id, p);
        return p;
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
                // «Оплачено» решает сервер: частичный платёж сессию не закрывает. Берём из
                // базы свежую сессию (isPaid, внесено, остаток), а не ставим галочку наугад.
                try {
                    const fresh = (await crmApi.getSessions({ clientId: data.clientId }))
                        .find(x => x.id === data.sessionId);
                    if (fresh) {
                        set((s) => ({
                            sessions: s.sessions.map((sess) => (sess.id === fresh.id ? fresh : sess)),
                        }));
                    }
                } catch { /* платёж записан; сессии обновятся при следующей загрузке */ }
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
