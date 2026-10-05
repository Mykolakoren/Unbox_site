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
    /** true = «да, это вторая настоящая оплата»: обходит защиту от дубля
     *  (409 duplicate_recent). Ставит только utils/cashboxDuplicate.ts после
     *  подтверждения админом. */
    confirm_duplicate?: boolean;
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

/** GET /cashbox/summary — ключи уже camelCase (интерцептор api/client.ts). */
export interface CashboxPeriodSummary {
    income: number;
    expense: number;
    net: number;
    count: number;
    adjustmentIncome: number;
    adjustmentExpense: number;
    adjustmentCount: number;
}

/** Деньги по счетам: наличные / TBC / BOG (ключи camelCase — интерцептор). */
export interface DayMoney {
    cash: number;
    cardTbc: number;
    cardBog: number;
    total: number;
    count: number;
}

/** Уже есть в журнале, но не «пришло/ушло»: расхождение смены, корректировка остатка. */
export interface DayCorrection {
    income: number;
    expense: number;
    /** + излишек / − недостача */
    net: number;
    count: number;
}

export interface DayShift {
    /** open — открыта сейчас (на конец дня); closed — закрыта в этот день; none — не было. */
    status: 'open' | 'closed' | 'none';
    openedAt: string | null;
    openedBy: string | null;
    closedAt: string | null;
    closedBy: string | null;
    /** Закрыли общую смену (по всем филиалам) — цифр по филиалу у неё нет. */
    closedAllBranches: boolean;
    expected: number | null;
    actual: number | null;
    discrepancy: number | null;
    closes: number;
    /** Наличные по записям кассы филиала на конец дня («должно быть в кассе»). */
    cashByRecords: number;
}

export interface DayBranchBlock {
    /** null — операции без филиала. */
    branch: string | null;
    income: DayMoney;
    expense: DayMoney;
    shiftRecon: DayCorrection;
    balanceFix: DayCorrection;
    /** Перевод между своими счетами (income — сколько перевели): не «пришло» и не «ушло». */
    transfer: DayCorrection;
    /** Списано с балансов клиентов за брони этого дня (по локации брони). */
    charges: { charged: number; refunded: number; net: number; bookings: number };
    shift: DayShift | null;
}

/** GET /cashbox/day-summary — «Итоги дня» (считает сервер, services/day_summary.py). */
export interface CashboxDaySummary {
    date: string;
    branch: string | null;
    isToday: boolean;
    branches: DayBranchBlock[];
    total: Omit<DayBranchBlock, 'branch' | 'shift'>;
    /** Корректировки балансов (не деньги): недельная скидка, правка баланса клиента. */
    adjustments: { income: number; expense: number; count: number };
    /** Операции дня без филиала (кроме корректировок) — видны только во «Все». */
    unassigned: { count: number; income: number; expense: number };
    /** Недельные скидки, начисленные в этот день (по понедельникам). */
    weeklyRebates: { amount: number; count: number };
    /** Клиенты с балансом ниже нуля на конец дня (сегодня — сейчас). */
    debtors: {
        /** false — день раньше стартовых остатков ленты баланса (21.07.2026): данных нет. */
        available: boolean;
        /** С какого дня есть данные о долгах (ГГГГ-ММ-ДД). */
        since: string | null;
        count: number;
        amount: number;
        /** Из них сотрудники (admin / senior_admin / owner). */
        staffCount: number;
        staffAmount: number;
        items: { userId: string; name: string; email: string; debt: number; staff: boolean }[];
        asOf: string;
    };
    /** Клиенты дня для вечерней сверки с таблицей (05.10): кто был, филиал, часы, баланс на конец дня.
     *  Необязательно — старый бэк поля не отдаёт. */
    clients?: {
        count: number;
        items: { userId: string; name: string; branch: string; hours: number; balance: number; staff: boolean }[];
    };
}

/** GET /cashbox/weekly-rebates — недельные скидки за неделю броней. */
export interface WeeklyRebateReport {
    weekStart: string;
    weekEnd: string;
    creditedOn: string;
    items: { userId: string; name: string; email: string | null; hours: number; percent: number; amount: number; creditedAt: string | null }[];
    count: number;
    total: number;
}

/** GET /cashbox/weekly-rebates/recent — начислено с последнего понедельника (лента баланса). */
export interface RecentWeeklyRebates {
    since: string;
    items: { userId: string; email: string | null; amount: number; creditedAt: string }[];
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

    // «Общая сумма оплат» клиента — из реальных кассовых приходов (backend),
    // а не из фронтового стора. userId — UUID или email.
    // Ответ проходит через toCamelCase (api/client.ts): сервер шлёт total_paid,
    // сюда приходит totalPaid. Раньше читали data.total_paid → undefined → у
    // КАЖДОГО клиента в карточке крупно «0.00 ₾» (аудит 29.09, G7-03).
    getClientTotalPaid: async (userId: string): Promise<number> => {
        const { data } = await api.get(`/cashbox/client-total-paid/${encodeURIComponent(userId)}`);
        return Number(data?.totalPaid ?? data?.total_paid ?? 0);
    },

    getTransactions: async (params?: {
        dateFrom?: string;
        dateTo?: string;
        type?: string;
        categoryId?: string;
        paymentMethod?: string;
        branch?: string;
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
                branch: params?.branch,
                skip: params?.skip,
                limit: params?.limit,
            },
        });
        return data;
    },

    /** Итоги за период по ВСЕМ операциям (считает сервер). Корректировки
     *  (payment_method='adjustment') — не деньги, приходят отдельно. */
    getPeriodSummary: async (params: {
        dateFrom: string;
        dateTo: string;
        branch?: string;
    }): Promise<CashboxPeriodSummary> => {
        const { data } = await api.get('/cashbox/summary', {
            params: {
                date_from: params.dateFrom,
                date_to: params.dateTo,
                branch: params.branch,
            },
        });
        return data;
    },

    /** Excel для сверки с таблицей админов за месяц (YYYY-MM). */
    downloadReconciliation: async (month: string): Promise<Blob> => {
        const response = await api.get(`/cashbox/reconciliation.xlsx`, { params: { month }, responseType: 'blob' });
        return response.data as Blob;
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

    /** Филиалы, где смена открыта и не закрыта с прошлого дня («вчера не закрыли»). */
    getPendingCloseShifts: async (): Promise<{ anyPending: boolean; pending: { branch: string; openedAt: string; adminName: string }[] }> => {
        const { data } = await api.get('/cashbox/shifts/pending-close');
        return data;
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

/**
 * Отчёты кассы — ТОЛЬКО ЧТЕНИЕ (решение владельца 02.10): «Итоги дня» и
 * «Недельные скидки». Отдельно от cashboxApi: тела денежных вызовов там держит
 * отпечаток сторожа (guard_wave4_money_desk), а здесь денег не двигаем.
 * Все цифры считает сервер (services/day_summary.py).
 */
export const cashboxReportsApi = {
    /** «Итоги дня» по Тбилиси (date — ГГГГ-ММ-ДД). branch не передан — все филиалы. */
    getDaySummary: async (params: { date: string; branch?: string }): Promise<CashboxDaySummary> => {
        const { data } = await api.get('/cashbox/day-summary', {
            params: { date: params.date, branch: params.branch },
        });
        return data;
    },

    /** Недельные скидки за неделю броней (weekStart — любой день недели; пусто — прошлая неделя). */
    getWeeklyRebates: async (weekStart?: string): Promise<WeeklyRebateReport> => {
        const { data } = await api.get('/cashbox/weekly-rebates', { params: weekStart ? { week_start: weekStart } : {} });
        return data;
    },

    /** Скидки, начисленные с последнего понедельника, — для метки в «Сегодня». */
    getRecentWeeklyRebates: async (): Promise<RecentWeeklyRebates> => {
        const { data } = await api.get('/cashbox/weekly-rebates/recent');
        return data;
    },
};
