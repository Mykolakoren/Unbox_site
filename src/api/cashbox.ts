import { api } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CashboxTransaction {
    id: string;
    type: 'income' | 'expense';
    amount: number;
    currency: string;
    paymentMethod: string;
    categoryId?: string;
    categoryName?: string;
    description?: string;
    branch?: string;
    date: string;
    adminId: string;
    adminName: string;
    shiftReportId?: string;
    clientId?: string;
    clientName?: string;
    createdAt: string;
}

export interface CashboxTransactionCreate {
    type: 'income' | 'expense';
    amount: number;
    currency?: string;
    payment_method?: string;
    category_id?: string;
    description?: string;
    branch?: string;
    date?: string;
    client_id?: string;
    client_name?: string;
    /** If true, tops up User.balance by `amount` and records credited_user_id
     *  (reversible on delete/edit). Backend ignores the flag unless
     *  type=income and client_id is set. */
    credit_user_balance?: boolean;
}

export interface ExpenseCategory {
    id: string;
    name: string;
    parentId?: string;
    icon?: string;
    isActive: boolean;
    categoryType?: 'income' | 'expense' | 'both';
    createdAt: string;
    children: ExpenseCategory[];
}

export interface ExpenseCategoryCreate {
    name: string;
    parent_id?: string;
    icon?: string;
}

export interface ShiftReport {
    id: string;
    expectedBalance: number;
    actualBalance: number;
    discrepancy: number;
    notes?: string;
    shiftStart: string;
    shiftEnd: string;
    adminId: string;
    adminName: string;
    createdAt: string;
    /** null = global close across all branches; otherwise the branch name */
    branch?: string | null;
}

export interface ShiftOpenLog {
    id: string;
    branch?: string | null;
    startingBalance: number;
    notes?: string;
    adminId: string;
    adminName: string;
    openedAt: string;
}

export interface CashboxAnalytics {
    dailyData: { date: string; income: number; expense: number }[];
    categoryBreakdown: { categoryName: string; total: number; percentage: number }[];
    totalIncome: number;
    totalExpense: number;
    currentBalance: number;
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface CashboxBalances {
    balance: number;
    cash: number;
    card_tbc: number;  // snake_case from backend
    card_bog: number;
}

export const cashboxApi = {
    getBalance: async (branch?: string): Promise<CashboxBalances> => {
        const { data } = await api.get('/cashbox/balance', { params: branch ? { branch } : {} });
        return data;
    },

    getTransactions: async (params?: {
        dateFrom?: string;
        dateTo?: string;
        type?: string;
        categoryId?: string;
        paymentMethod?: string;
        skip?: number;
        limit?: number;
    }): Promise<CashboxTransaction[]> => {
        const { data } = await api.get('/cashbox/transactions', {
            params: {
                date_from: params?.dateFrom,
                date_to: params?.dateTo,
                type: params?.type,
                category_id: params?.categoryId,
                payment_method: params?.paymentMethod,
                skip: params?.skip,
                limit: params?.limit,
            },
        });
        return data;
    },

    createTransaction: async (payload: CashboxTransactionCreate): Promise<CashboxTransaction> => {
        const { data } = await api.post('/cashbox/transactions', payload);
        return data;
    },

    deleteTransaction: async (id: string): Promise<void> => {
        await api.delete(`/cashbox/transactions/${id}`);
    },

    updateTransaction: async (id: string, payload: Partial<CashboxTransactionCreate>): Promise<CashboxTransaction> => {
        const { data } = await api.patch(`/cashbox/transactions/${id}`, payload);
        return data;
    },

    getCategories: async (): Promise<ExpenseCategory[]> => {
        const { data } = await api.get('/cashbox/categories');
        return data;
    },

    createCategory: async (payload: ExpenseCategoryCreate): Promise<ExpenseCategory> => {
        const { data } = await api.post('/cashbox/categories', payload);
        return data;
    },

    updateCategory: async (id: string, payload: Partial<ExpenseCategoryCreate & { is_active: boolean }>): Promise<ExpenseCategory> => {
        const { data } = await api.patch(`/cashbox/categories/${id}`, payload);
        return data;
    },

    deleteCategory: async (id: string): Promise<void> => {
        await api.delete(`/cashbox/categories/${id}`);
    },

    getShiftReports: async (skip?: number, limit?: number): Promise<ShiftReport[]> => {
        const { data } = await api.get('/cashbox/shifts', { params: { skip, limit } });
        return data;
    },

    endShift: async (payload: { actual_balance: number; notes?: string; branch?: string }): Promise<ShiftReport> => {
        const { data } = await api.post('/cashbox/shifts', payload);
        return data;
    },

    /** Mark the start of an admin's shift (audit + UI badge, no cash math). */
    openShift: async (payload: { branch?: string; starting_balance?: number; notes?: string }): Promise<ShiftOpenLog> => {
        const { data } = await api.post('/cashbox/shifts/open', payload);
        return data;
    },

    /** Preview close-shift math WITHOUT writing a ShiftReport.
     *  Excel #13 — admins see startingBalance + cashIn − cashOut breakdown
     *  before submitting, so phantom discrepancies are traceable.
     *
     *  NOTE: api/client.ts auto-transforms all response keys from snake_case
     *  to camelCase. Backend sends starting_balance, frontend sees
     *  startingBalance. Don't reach for the snake_case names here — they're
     *  undefined on the wire and silently crashed EndShiftModal in Safari. */
    previewCloseShift: async (branch?: string): Promise<{
        startingBalance: number;
        cashIn: number;
        cashOut: number;
        expected: number;
        txCount: number;
        shiftStart: string | null;
        now: string;
        branch: string | null;
        prevCloseId: string | null;
    }> => {
        const { data } = await api.get('/cashbox/shifts/preview', {
            params: branch ? { branch } : {},
        });
        return data;
    },

    /** Most recent open event since the last close. Returns null if no open
     *  shift currently in progress. */
    getCurrentOpenShift: async (branch?: string): Promise<ShiftOpenLog | null> => {
        const { data } = await api.get('/cashbox/shifts/open/current', {
            params: branch ? { branch } : {},
        });
        return data ?? null;
    },

    getAnalytics: async (dateFrom?: string, dateTo?: string): Promise<CashboxAnalytics> => {
        const { data } = await api.get('/cashbox/analytics', {
            params: { date_from: dateFrom, date_to: dateTo },
        });
        return data;
    },

    correctBalance: async (payload: { payment_method: string; new_balance: number; reason?: string }): Promise<any> => {
        const { data } = await api.post('/cashbox/balance-correction', payload);
        return data;
    },
};
