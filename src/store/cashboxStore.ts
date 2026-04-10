import { create } from 'zustand';
import { toast } from 'sonner';
import {
    cashboxApi,
    type CashboxTransaction,
    type CashboxBalances,
    type ExpenseCategory,
    type ShiftReport,
    type CashboxAnalytics,
} from '../api/cashbox';

interface CashboxStore {
    balance: number;
    balances: CashboxBalances;
    transactions: CashboxTransaction[];
    categories: ExpenseCategory[];
    shiftReports: ShiftReport[];
    analytics: CashboxAnalytics | null;
    isLoading: boolean;

    fetchBalance: (branch?: string) => Promise<void>;
    fetchTransactions: (params?: Parameters<typeof cashboxApi.getTransactions>[0]) => Promise<void>;
    createTransaction: (data: Parameters<typeof cashboxApi.createTransaction>[0]) => Promise<void>;
    deleteTransaction: (id: string) => Promise<void>;
    updateTransaction: (id: string, data: Partial<Parameters<typeof cashboxApi.createTransaction>[0]>) => Promise<void>;
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
    balances: { balance: 0, cash: 0, card_tbc: 0, card_bog: 0 },
    transactions: [],
    categories: [],
    shiftReports: [],
    analytics: null,
    isLoading: false,

    fetchBalance: async (branch?: string) => {
        try {
            const data = await cashboxApi.getBalance(branch);
            set({ balance: data.balance, balances: data });
        } catch (error) {
            toast.error('Не удалось загрузить баланс кассы');
        }
    },

    fetchTransactions: async (params) => {
        set({ isLoading: true });
        try {
            const transactions = await cashboxApi.getTransactions(params);
            set({ transactions });
        } catch (error) {
            toast.error('Не удалось загрузить транзакции');
        } finally {
            set({ isLoading: false });
        }
    },

    createTransaction: async (data) => {
        try {
            await cashboxApi.createTransaction(data);
            await get().fetchBalance();
            toast.success('Транзакция создана');
        } catch (error) {
            toast.error('Не удалось создать транзакцию');
            throw error;
        }
    },

    deleteTransaction: async (id) => {
        try {
            await cashboxApi.deleteTransaction(id);
            await get().fetchBalance();
            toast.success('Транзакция удалена');
        } catch (error) {
            toast.error('Не удалось удалить транзакцию');
            throw error;
        }
    },

    updateTransaction: async (id, data) => {
        try {
            await cashboxApi.updateTransaction(id, data);
            await get().fetchBalance();
            toast.success('Транзакция обновлена');
        } catch (error) {
            toast.error('Не удалось обновить транзакцию');
            throw error;
        }
    },

    fetchCategories: async () => {
        try {
            const categories = await cashboxApi.getCategories();
            set({ categories });
        } catch (error) {
            toast.error('Не удалось загрузить категории');
        }
    },

    createCategory: async (data) => {
        try {
            await cashboxApi.createCategory(data);
            await get().fetchCategories();
        } catch (error) {
            toast.error('Не удалось создать категорию');
            throw error;
        }
    },

    updateCategory: async (id, data) => {
        try {
            await cashboxApi.updateCategory(id, data);
            await get().fetchCategories();
        } catch (error) {
            toast.error('Не удалось обновить категорию');
            throw error;
        }
    },

    deleteCategory: async (id) => {
        try {
            await cashboxApi.deleteCategory(id);
            await get().fetchCategories();
        } catch (error) {
            toast.error('Не удалось удалить категорию');
            throw error;
        }
    },

    fetchShiftReports: async () => {
        try {
            const shiftReports = await cashboxApi.getShiftReports();
            set({ shiftReports });
        } catch (error) {
            toast.error('Не удалось загрузить отчёты смен');
        }
    },

    endShift: async (data) => {
        try {
            const report = await cashboxApi.endShift(data);
            await get().fetchShiftReports();
            await get().fetchBalance();
            return report;
        } catch (error) {
            toast.error('Не удалось закрыть смену');
            throw error;
        }
    },

    fetchAnalytics: async (dateFrom, dateTo) => {
        try {
            const analytics = await cashboxApi.getAnalytics(dateFrom, dateTo);
            set({ analytics });
        } catch (error) {
            toast.error('Не удалось загрузить аналитику');
        }
    },
}));
