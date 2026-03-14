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
}

export interface ExpenseCategory {
    id: string;
    name: string;
    parentId?: string;
    icon?: string;
    isActive: boolean;
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
}

export interface CashboxAnalytics {
    dailyData: { date: string; income: number; expense: number }[];
    categoryBreakdown: { categoryName: string; total: number; percentage: number }[];
    totalIncome: number;
    totalExpense: number;
    currentBalance: number;
}

// ── API ──────────────────────────────────────────────────────────────────────

export const cashboxApi = {
    getBalance: async (): Promise<{ balance: number }> => {
        const { data } = await api.get('/cashbox/balance');
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

    endShift: async (payload: { actual_balance: number; notes?: string }): Promise<ShiftReport> => {
        const { data } = await api.post('/cashbox/shifts', payload);
        return data;
    },

    getAnalytics: async (dateFrom?: string, dateTo?: string): Promise<CashboxAnalytics> => {
        const { data } = await api.get('/cashbox/analytics', {
            params: { date_from: dateFrom, date_to: dateTo },
        });
        return data;
    },
};
