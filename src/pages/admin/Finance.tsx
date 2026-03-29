import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Clock, ChevronLeft, ChevronRight, CalendarDays, Settings2, X } from 'lucide-react';
import {
    startOfWeek, endOfWeek, startOfMonth, endOfMonth,
    startOfDay, endOfDay, addDays, addWeeks, addMonths, format,
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
type PeriodMode = 'day' | 'week' | 'month' | 'custom';
type TxType = 'all' | 'income' | 'expense';

const BRANCHES = ['Unbox Uni', 'Unbox One', 'Neo School'];

const TABS: { id: Tab; label: string }[] = [
    { id: 'transactions', label: 'Транзакции' },
    { id: 'categories', label: 'Категории' },
    { id: 'shifts', label: 'Смены' },
];

function getPeriodRange(mode: PeriodMode, offset: number): { from: Date; to: Date; label: string } {
    const now = new Date();
    if (mode === 'day') {
        const base = addDays(now, offset);
        const start = startOfDay(base);
        const end = endOfDay(base);
        const label = offset === 0
            ? 'Сегодня'
            : offset === -1
            ? 'Вчера'
            : format(base, 'd MMMM', { locale: ru });
        return { from: start, to: end, label };
    }
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
    const [showCorrection, setShowCorrection] = useState(false);
    const [corrAccount, setCorrAccount] = useState('cash');
    const [corrAmount, setCorrAmount] = useState('');
    const [corrReason, setCorrReason] = useState('');
    const [corrSaving, setCorrSaving] = useState(false);

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
    const canCorrectBalance = currentUser?.role === 'senior_admin' || currentUser?.role === 'owner';

    // Compute period range
    const period = useMemo(() => {
        if (periodMode === 'custom') {
            const from = customFrom ? new Date(customFrom) : new Date(0);
            const to = customTo ? new Date(customTo + 'T23:59:59') : new Date();
            return { from, to, label: 'Диапазон' };
        }
        return getPeriodRange(periodMode, periodOffset);
    }, [periodMode, periodOffset, customFrom, customTo]);

    useEffect(() => {
        fetchBalance(selectedBranch || undefined);
        fetchCategories();
        fetchShiftReports();
        fetchAnalytics();
    }, [fetchBalance, fetchCategories, fetchShiftReports, fetchAnalytics, selectedBranch]);

    // Fetch transactions when period or branch changes
    useEffect(() => {
        const dateFrom = format(period.from, "yyyy-MM-dd'T'00:00:00");
        const dateTo = format(period.to, "yyyy-MM-dd'T'23:59:59");
        fetchTransactions({ dateFrom, dateTo, limit: 200 });
    }, [fetchTransactions, period.from.getTime(), period.to.getTime()]);

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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-unbox-dark">Финансы</h1>
                    <p className="text-xs sm:text-sm text-unbox-grey mt-0.5">Управление кассой и расходами</p>
                </div>
                <div className="flex gap-2">
                    {canCorrectBalance && (
                        <button
                            onClick={() => setShowCorrection(true)}
                            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-amber-300 text-xs sm:text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors"
                        >
                            <Settings2 size={14} />
                            <span className="hidden sm:inline">Корректировка</span>
                        </button>
                    )}
                    <button
                        onClick={() => setShowEndShift(true)}
                        className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-gray-200 text-xs sm:text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        <Clock size={14} />
                        <span className="hidden sm:inline">Закрыть</span> смену
                    </button>
                    <button
                        onClick={() => setShowAddTx(true)}
                        className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl bg-unbox-green text-white text-xs sm:text-sm font-medium hover:bg-unbox-green/90 transition-colors"
                    >
                        <Plus size={14} />
                        <span className="hidden sm:inline">Новая</span> операция
                    </button>
                </div>
            </div>

            {/* Period + Branch selectors */}
            <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-4">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Period mode buttons */}
                    <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                        {(['day', 'week', 'month', 'custom'] as PeriodMode[]).map(m => (
                            <button
                                key={m}
                                onClick={() => { setPeriodMode(m); setPeriodOffset(0); }}
                                className={clsx(
                                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                                    periodMode === m ? 'bg-white shadow text-unbox-dark' : 'text-gray-500 hover:text-gray-700',
                                )}
                            >
                                {m === 'day' ? 'День' : m === 'week' ? 'Неделя' : m === 'month' ? 'Месяц' : 'Диапазон'}
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

            {/* Balance Correction Modal — owner/senior_admin only */}
            {showCorrection && canCorrectBalance && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowCorrection(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-gray-900">Корректировка остатка</h3>
                            <button onClick={() => setShowCorrection(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <p className="text-xs text-gray-500">Установите фактический остаток на счёте. Разница будет записана как корректировка с сохранением истории.</p>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Счёт</label>
                            <select value={corrAccount} onChange={e => setCorrAccount(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm">
                                <option value="cash">Наличные</option>
                                <option value="card_tbc">Карта TBC</option>
                                <option value="card_bog">Карта BOG</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Фактический остаток (GEL)</label>
                            <input
                                type="number"
                                value={corrAmount}
                                onChange={e => setCorrAmount(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Причина корректировки *</label>
                            <textarea
                                value={corrReason}
                                onChange={e => setCorrReason(e.target.value)}
                                placeholder="Укажите причину..."
                                rows={2}
                                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm resize-none"
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button onClick={() => setShowCorrection(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Отмена</button>
                            <button
                                disabled={corrSaving || !corrReason.trim() || corrAmount === ''}
                                onClick={async () => {
                                    setCorrSaving(true);
                                    try {
                                        const { api } = await import('../../api/client');
                                        await api.post('/cashbox/balance-correction', {
                                            payment_method: corrAccount,
                                            actual_balance: parseFloat(corrAmount),
                                            reason: corrReason.trim(),
                                        });
                                        const { toast } = await import('sonner');
                                        toast.success('Остаток скорректирован');
                                        setShowCorrection(false);
                                        setCorrAmount('');
                                        setCorrReason('');
                                        fetchBalance();
                                        fetchTransactions();
                                    } catch (err: any) {
                                        const { toast } = await import('sonner');
                                        toast.error(err?.response?.data?.detail || 'Ошибка корректировки');
                                    } finally {
                                        setCorrSaving(false);
                                    }
                                }}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
                            >
                                {corrSaving ? 'Сохранение...' : 'Применить'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
