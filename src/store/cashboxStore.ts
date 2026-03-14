import { create } from 'zustand';
import {
    cashboxApi,
    type CashboxTransaction,
    type ExpenseCategory,
    type ShiftReport,
    type CashboxAnalytics,
} from '../api/cashbox';

interface CashboxStore {
    balance: number;
    transactions: CashboxTransaction[];
    categories: ExpenseCategory[];
    shiftReports: ShiftReport[];
    analytics: CashboxAnalytics | null;
    isLoading: boolean;

    fetchBalance: () => Promise<void>;
    fetchTransactions: (params?: Parameters<typeof cashboxApi.getTransactions>[0]) => Promise<void>;
    createTransaction: (data: Parameters<typeof cashboxApi.createTransaction>[0]) => Promise<void>;
    deleteTransaction: (id: string) => Promise<void>;
    fetchCategories: () => Promise<void>;
    createCategory: (data: Parameters<typeof cashboxApi.createCategory>[0]) => Promise<void>;
    updateCategory: (id: string, data: Parameters<typeof cashboxApi.updateCategory>[1]) => Promise<void>;
    deleteCategory: (id: string) => Promise<void>;
    fetchShiftReports: () => Promise<void>;
    endShift: (data: Parameters<typeof cashboxApi.endShift>[0]) => Promise<ShiftReport>;
    fetchAnalytics: (dateFrom?: string, dateTo?: string) => Promise<void>;
}

export const useCashboxStore = create<CashboxStore>((set, get) => ({
    balance: 0,
    transactions: [],
    categories: [],
    shiftReports: [],
    analytics: null,
    isLoading: false,

    fetchBalance: async () => {
        const { balance } = await cashboxApi.getBalance();
        set({ balance });
    },

    fetchTransactions: async (params) => {
        set({ isLoading: true });
        try {
            const transactions = await cashboxApi.getTransactions(params);
            set({ transactions });
        } finally {
            set({ isLoading: false });
        }
    },

    createTransaction: async (data) => {
        await cashboxApi.createTransaction(data);
        await Promise.all([get().fetchTransactions(), get().fetchBalance()]);
    },

    deleteTransaction: async (id) => {
        await cashboxApi.deleteTransaction(id);
        await Promise.all([get().fetchTransactions(), get().fetchBalance()]);
    },

    fetchCategories: async () => {
        const categories = await cashboxApi.getCategories();
        set({ categories });
    },

    createCategory: async (data) => {
        await cashboxApi.createCategory(data);
        await get().fetchCategories();
    },

    updateCategory: async (id, data) => {
        await cashboxApi.updateCategory(id, data);
        await get().fetchCategories();
    },

    deleteCategory: async (id) => {
        await cashboxApi.deleteCategory(id);
        await get().fetchCategories();
    },

    fetchShiftReports: async () => {
        const shiftReports = await cashboxApi.getShiftReports();
        set({ shiftReports });
    },

    endShift: async (data) => {
        const report = await cashboxApi.endShift(data);
        await get().fetchShiftReports();
        await get().fetchBalance();
        return report;
    },

    fetchAnalytics: async (dateFrom, dateTo) => {
        const analytics = await cashboxApi.getAnalytics(dateFrom, dateTo);
        set({ analytics });
    },
}));
