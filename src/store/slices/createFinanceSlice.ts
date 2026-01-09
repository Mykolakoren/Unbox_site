import type { StateCreator } from 'zustand';
import type { UserStore, FinanceSlice } from '../types';

export const createFinanceSlice: StateCreator<UserStore, [], [], FinanceSlice> = (set, get) => ({
    transactions: [],

    addTransaction: (transactionData) => set((state) => {
        // Derive category from type if not provided
        let category: any = transactionData.category;
        if (!category) {
            switch (transactionData.type) {
                case 'deposit': category = 'deposit'; break;
                case 'subscription_purchase': category = 'subscription'; break;
                case 'booking_payment': category = 'booking'; break;
                case 'manual_correction': category = 'correction'; break;
                default: category = 'shop'; // fallback
            }
        }

        const newTransaction: any = {
            id: `txn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            date: new Date().toISOString(),
            currency: 'GEL',
            status: 'completed',
            category,
            ...transactionData
        };

        return {
            transactions: [newTransaction, ...state.transactions]
        };
    }),

    getTransactionsByUser: (userId) => {
        const state = get();
        return state.transactions
            .filter(t => t.userId === userId)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
});
