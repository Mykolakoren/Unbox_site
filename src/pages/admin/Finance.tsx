import { useEffect, useState, useMemo } from 'react';
import { Plus, Clock, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import {
    startOfWeek, endOfWeek, startOfMonth, endOfMonth,
    addWeeks, addMonths, format,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCashboxStore } from '../../store/cashboxStore';
import { useUserStore } from '../../store/userStore';
import { BalanceCard } from '../../components/admin/cashbox/BalanceCard';
import { CashboxTransactionTable } from '../../components/admin/cashbox/CashboxTransactionTable';
import { AddCashboxTransactionModal } from '../../components/admin/cashbox/AddCashboxTransactionModal';
import { CategoryManager } from '../../components/admin/cashbox/CategoryManager';
import { EndShiftModal } from '../../components/admin/cashbox/EndShiftModal';
import { ShiftReportsTable } from '../../components/admin/cashbox/ShiftReportsTable';
import { CashboxAnalytics } from '../../components/admin/cashbox/CashboxAnalytics';
import type { CashboxTransaction } from '../../api/cashbox';
import clsx from 'clsx';

type Tab = 'transactions' | 'categories' | 'shifts';
type PeriodMode = 'week' | 'month' | 'custom';
type TxType = 'all' | 'income' | 'expense';

const BRANCHES = ['Uni', 'One'];

const TABS: { id: Tab; label: string }[] = [
    { id: 'transactions', label: 'Транзакции' },
    { id: 'categories', label: 'Категории' },
    { id: 'shifts', label: 'Смены' },
];

function getPeriodRange(mode: PeriodMode, offset: number): { from: Date; to: Date; label: string } {
    const now = new Date();
    if (mode === 'week') {
        const start = startOfWeek(addWeeks(now, offset), { locale: ru });
        const end = endOfWeek(addWeeks(now, offset), { locale: ru });
        const label = offset === 0
            ? 'Эта неделя'
            : offset === -1
            ? 'Прошлая неделя'
            : `${format(start, 'd MMM', { locale: ru })} – ${format(end, 'd MMM', { locale: ru })}`;
        return { from: start, to: end, label };
    } else {
        const base = addMonths(now, offset);
        const start = startOfMonth(base);
        const end = endOfMonth(base);
        const label = offset === 0
            ? 'Этот месяц'
            : format(base, 'LLLL yyyy', { locale: ru });
        return { from: start, to: end, label };
    }
}

export function AdminFinance() {
    const [tab, setTab] = useState<Tab>('transactions');
    const [showAddTx, setShowAddTx] = useState(false);
    const [showEndShift, setShowEndShift] = useState(false);

    // Period filters
    const [periodMode, setPeriodMode] = useState<PeriodMode>('week');
    const [periodOffset, setPeriodOffset] = useState(0);
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    // Branch & type filters
    const [selectedBranch, setSelectedBranch] = useState(''); // '' = all
    const [txType, setTxType] = useState<TxType>('all');

    const currentUser = useUserStore(s => s.currentUser);
    const { fetchBalance, fetchTransactions, fetchCategories, fetchShiftReports, fetchAnalytics, transactions } = useCashboxStore();
    const canManageCategories = currentUser?.role === 'senior_admin' || currentUser?.role === 'owner';

    useEffect(() => {
        fetchBalance();
        fetchTransactions();
        fetchCategories();
        fetchShiftReports();
        fetchAnalytics();
    }, [fetchBalance, fetchTransactions, fetchCategories, fetchShiftReports, fetchAnalytics]);

    // Compute period range
    const period = useMemo(() => {
        if (periodMode === 'custom') {
            const from = customFrom ? new Date(customFrom) : new Date(0);
            const to = customTo ? new Date(customTo + 'T23:59:59') : new Date();
            return { from, to, label: 'Диапазон' };
        }
        return getPeriodRange(periodMode, periodOffset);
    }, [periodMode, periodOffset, customFrom, customTo]);

    const canGoNext = periodMode !== 'custom' && periodOffset < 0;

    // Filtered transactions
    const filtered = useMemo((): CashboxTransaction[] => {
        return transactions.filter(tx => {
            if (selectedBranch && tx.branch !== selectedBranch) return false;
            if (txType !== 'all' && tx.type !== txType) return false;
            const d = new Date(tx.date);
            if (d < period.from || d > period.to) return false;
            return true;
        });
    }, [transactions, selectedBranch, txType, period]);

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-unbox-dark">Финансы</h1>
                    <p className="text-sm text-unbox-grey mt-0.5">Управление кассой и расходами</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowEndShift(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        <Clock size={15} />
                        Закрыть смену
                    </button>
                    <button
                        onClick={() => setShowAddTx(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors"
                    >
                        <Plus size={15} />
                        Новая операция
                    </button>
                </div>
            </div>

            {/* Period + Branch selectors */}
            <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-4">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Period mode buttons */}
                    <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {(['week', 'month', 'custom'] as PeriodMode[]).map(m => (
                            <button
                                key={m}
                                onClick={() => { setPeriodMode(m); setPeriodOffset(0); }}
                                className={clsx(
                                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                                    periodMode === m ? 'bg-white shadow text-unbox-dark' : 'text-gray-500 hover:text-gray-700',
                                )}
                            >
                                {m === 'week' ? 'Неделя' : m === 'month' ? 'Месяц' : 'Диапазон'}
                            </button>
                        ))}
                    </div>

                    {/* Navigation arrows + label */}
                    {periodMode !== 'custom' ? (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPeriodOffset(o => o - 1)}
                                className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <span className="text-sm font-medium text-gray-700 px-2 min-w-[120px] text-center">
                                {period.label}
                            </span>
                            <button
                                onClick={() => canGoNext && setPeriodOffset(o => o + 1)}
                                disabled={!canGoNext}
                                className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <CalendarDays size={14} className="text-gray-400" />
                            <input
                                type="date"
                                value={customFrom}
                                onChange={e => setCustomFrom(e.target.value)}
                                className="px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                            />
                            <span className="text-gray-400 text-xs">—</span>
                            <input
                                type="date"
                                value={customTo}
                                onChange={e => setCustomTo(e.target.value)}
                                max={format(new Date(), 'yyyy-MM-dd')}
                                className="px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                            />
                        </div>
                    )}

                    {/* Branch dropdown */}
                    <div className="ml-auto">
                        <select
                            value={selectedBranch}
                            onChange={e => setSelectedBranch(e.target.value)}
                            className="px-3 py-1.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-unbox-green"
                        >
                            <option value="">Общая касса</option>
                            {BRANCHES.map(b => (
                                <option key={b} value={b}>{b}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Balance cards with period stats */}
            <BalanceCard filteredTransactions={filtered} periodLabel={period.label} />

            {/* Tabs */}
            <div className="flex gap-1 bg-white/70 backdrop-blur rounded-2xl p-1.5 border border-white/80 shadow-sm w-fit">
                {TABS.map(t => {
                    if (t.id === 'categories' && !canManageCategories) return null;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={clsx(
                                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                                tab === t.id
                                    ? 'bg-unbox-green text-white shadow-md shadow-unbox-green/25'
                                    : 'text-unbox-grey hover:text-unbox-dark hover:bg-unbox-light/60',
                            )}
                        >
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* Type filter (only on transactions tab) */}
            {tab === 'transactions' && (
                <div className="flex gap-1.5 items-center">
                    {(['all', 'income', 'expense'] as TxType[]).map(type => (
                        <button
                            key={type}
                            onClick={() => setTxType(type)}
                            className={clsx(
                                'px-3 py-1 rounded-lg text-xs font-medium border transition-all',
                                txType === type
                                    ? type === 'income' ? 'bg-green-100 text-green-800 border-green-200'
                                    : type === 'expense' ? 'bg-red-100 text-red-800 border-red-200'
                                    : 'bg-gray-800 text-white border-gray-800'
                                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50',
                            )}
                        >
                            {type === 'all' ? 'Все' : type === 'income' ? 'Приходы' : 'Расходы'}
                        </button>
                    ))}
                    {filtered.length > 0 && (
                        <span className="ml-auto text-xs text-gray-400">
                            {filtered.length} операций
                        </span>
                    )}
                </div>
            )}

            {/* Tab content */}
            <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-6">
                {tab === 'transactions' && <CashboxTransactionTable filteredTransactions={filtered} />}
                {tab === 'categories' && canManageCategories && <CategoryManager />}
                {tab === 'shifts' && <ShiftReportsTable />}
            </div>

            {/* Analytics */}
            <CashboxAnalytics />

            {/* Modals */}
            <AddCashboxTransactionModal isOpen={showAddTx} onClose={() => setShowAddTx(false)} />
            <EndShiftModal isOpen={showEndShift} onClose={() => setShowEndShift(false)} />
        </div>
    );
}
