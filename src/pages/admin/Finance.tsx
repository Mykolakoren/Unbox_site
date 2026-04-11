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
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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
    const gridHouse = useDesignFlag();
    const [tab, setTab] = useState<Tab>('transactions');
    const [showAddTx, setShowAddTx] = useState(false);
    const [showEndShift, setShowEndShift] = useState(false);
    const [showCorrection, setShowCorrection] = useState(false);
    const [corrAccount, setCorrAccount] = useState('cash');
    const [corrBranch, setCorrBranch] = useState('');
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

    // Compute period range (hoisted so gridHouse branch can use it)
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

    const refetchTransactions = () => {
        const dateFrom = format(period.from, "yyyy-MM-dd'T'00:00:00");
        const dateTo = format(period.to, "yyyy-MM-dd'T'23:59:59");
        fetchTransactions({ dateFrom, dateTo, limit: 200 });
    };

    useEffect(() => {
        refetchTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchTransactions, period.from.getTime(), period.to.getTime()]);

    const canGoNext = periodMode !== 'custom' && periodOffset < 0;

    const filtered = useMemo((): CashboxTransaction[] => {
        return transactions.filter(tx => {
            if (selectedBranch && tx.branch !== selectedBranch) return false;
            if (txType !== 'all' && tx.type !== txType) return false;
            const d = new Date(tx.date);
            if (d < period.from || d > period.to) return false;
            return true;
        });
    }, [transactions, selectedBranch, txType, period]);

    if (gridHouse) {
        return (
            <GridHouseAdminFinance
                tab={tab} setTab={setTab}
                showAddTx={showAddTx} setShowAddTx={setShowAddTx}
                showEndShift={showEndShift} setShowEndShift={setShowEndShift}
                showCorrection={showCorrection} setShowCorrection={setShowCorrection}
                corrAccount={corrAccount} setCorrAccount={setCorrAccount}
                corrBranch={corrBranch} setCorrBranch={setCorrBranch}
                corrAmount={corrAmount} setCorrAmount={setCorrAmount}
                corrReason={corrReason} setCorrReason={setCorrReason}
                corrSaving={corrSaving} setCorrSaving={setCorrSaving}
                periodMode={periodMode} setPeriodMode={setPeriodMode}
                periodOffset={periodOffset} setPeriodOffset={setPeriodOffset}
                customFrom={customFrom} setCustomFrom={setCustomFrom}
                customTo={customTo} setCustomTo={setCustomTo}
                selectedBranch={selectedBranch} setSelectedBranch={setSelectedBranch}
                txType={txType} setTxType={setTxType}
                period={period}
                canGoNext={canGoNext}
                filtered={filtered}
                canManageCategories={canManageCategories}
                canCorrectBalance={canCorrectBalance}
                refetchTransactions={refetchTransactions}
                fetchBalance={fetchBalance}
                fetchTransactions={fetchTransactions}
            />
        );
    }

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
                            onClick={() => { setCorrBranch(selectedBranch); setShowCorrection(true); }}
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
                {tab === 'transactions' && <CashboxTransactionTable filteredTransactions={filtered} onRefresh={refetchTransactions} />}
                {tab === 'categories' && canManageCategories && <CategoryManager />}
                {tab === 'shifts' && <ShiftReportsTable />}
            </div>

            {/* Analytics */}
            <CashboxAnalytics />

            {/* Modals */}
            <AddCashboxTransactionModal isOpen={showAddTx} onClose={() => { setShowAddTx(false); refetchTransactions(); }} />
            <EndShiftModal isOpen={showEndShift} onClose={() => setShowEndShift(false)} branch={selectedBranch || undefined} />

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
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Филиал</label>
                            <select value={corrBranch} onChange={e => setCorrBranch(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm">
                                <option value="">Общая касса (все филиалы)</option>
                                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
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
                                            new_balance: parseFloat(corrAmount),
                                            reason: corrReason.trim(),
                                            branch: corrBranch || undefined,
                                        });
                                        const { toast } = await import('sonner');
                                        toast.success('Остаток скорректирован');
                                        setShowCorrection(false);
                                        setCorrAmount('');
                                        setCorrReason('');
                                        setCorrBranch('');
                                        fetchBalance(selectedBranch || undefined);
                                        refetchTransactions();
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

// ============================================================================
// Grid House variant — Vignelli/Bierut finance index
// ============================================================================

type GHAFProps = {
    tab: Tab; setTab: (t: Tab) => void;
    showAddTx: boolean; setShowAddTx: (v: boolean) => void;
    showEndShift: boolean; setShowEndShift: (v: boolean) => void;
    showCorrection: boolean; setShowCorrection: (v: boolean) => void;
    corrAccount: string; setCorrAccount: (v: string) => void;
    corrBranch: string; setCorrBranch: (v: string) => void;
    corrAmount: string; setCorrAmount: (v: string) => void;
    corrReason: string; setCorrReason: (v: string) => void;
    corrSaving: boolean; setCorrSaving: (v: boolean) => void;
    periodMode: PeriodMode; setPeriodMode: (m: PeriodMode) => void;
    periodOffset: number; setPeriodOffset: (fn: any) => void;
    customFrom: string; setCustomFrom: (v: string) => void;
    customTo: string; setCustomTo: (v: string) => void;
    selectedBranch: string; setSelectedBranch: (v: string) => void;
    txType: TxType; setTxType: (t: TxType) => void;
    period: { from: Date; to: Date; label: string };
    canGoNext: boolean;
    filtered: CashboxTransaction[];
    canManageCategories: boolean;
    canCorrectBalance: boolean;
    refetchTransactions: () => void;
    fetchBalance: (branch?: string) => void;
    fetchTransactions: (params?: any) => void;
};

function GHFSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
    return (
        <section style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, borderTop: `2px solid ${GH.ink}`, paddingTop: 16, marginBottom: 20 }}>
                <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.14em', color: GH.ink60, minWidth: 32 }}>{number}</div>
                <h2 style={{ fontFamily: GH_SANS, fontSize: 'clamp(20px, 2.4vw, 30px)', fontWeight: 800, letterSpacing: '-0.01em', color: GH.ink, margin: 0 }}>{title}</h2>
            </div>
            <div>{children}</div>
        </section>
    );
}

function GridHouseAdminFinance(p: GHAFProps) {
    const inkBtn: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: 11,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        background: GH.ink,
        color: GH.paper,
        border: `1px solid ${GH.ink}`,
        padding: '12px 20px',
        cursor: 'pointer',
    };
    const outlineBtn: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: 11,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        background: 'transparent',
        color: GH.ink,
        border: `1px solid ${GH.ink10}`,
        padding: '12px 20px',
        cursor: 'pointer',
    };
    const dangerBtn: React.CSSProperties = {
        ...outlineBtn,
        color: GH.danger,
        borderColor: GH.danger,
    };
    const hairlineInput: React.CSSProperties = {
        fontFamily: GH_SANS,
        fontSize: 14,
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${GH.ink10}`,
        padding: '10px 0',
        outline: 'none',
        width: '100%',
        color: GH.ink,
    };

    const periodTabs: { id: PeriodMode; label: string }[] = [
        { id: 'day', label: 'День' },
        { id: 'week', label: 'Неделя' },
        { id: 'month', label: 'Месяц' },
        { id: 'custom', label: 'Диапазон' },
    ];

    const typeTabs: { id: TxType; label: string }[] = [
        { id: 'all', label: 'Все' },
        { id: 'income', label: 'Приходы' },
        { id: 'expense', label: 'Расходы' },
    ];

    const tabs: { id: Tab; label: string }[] = [
        { id: 'transactions', label: 'Транзакции' },
        { id: 'categories', label: 'Категории' },
        { id: 'shifts', label: 'Смены' },
    ];

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
            <div style={{ maxWidth: 1400, margin: '0 auto', padding: 'clamp(24px, 4vw, 48px)' }}>
                {/* HEAD */}
                <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 24, marginBottom: 32 }}>
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 12 }}>
                            Раздел · Финансы
                        </div>
                        <h1 style={{ fontFamily: GH_SANS, fontSize: 'clamp(28px, 4.5vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, margin: 0 }}>
                            Касса и поток средств.
                        </h1>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {p.canCorrectBalance && (
                            <button onClick={() => { p.setCorrBranch(p.selectedBranch); p.setShowCorrection(true); }} style={{ ...dangerBtn, padding: '10px 14px', fontSize: 10 }}>
                                <Settings2 size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                                Корректировка
                            </button>
                        )}
                        <button onClick={() => p.setShowEndShift(true)} style={{ ...outlineBtn, padding: '10px 14px', fontSize: 10 }}>
                            <Clock size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                            Закрыть смену
                        </button>
                        <button onClick={() => p.setShowAddTx(true)} style={{ ...inkBtn, padding: '10px 14px', fontSize: 10 }}>
                            <Plus size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                            Новая операция
                        </button>
                    </div>
                </div>

                {/* 01 — Баланс */}
                <GHFSection number="01" title="Баланс.">
                    <div style={{ border: `1px solid ${GH.ink10}`, padding: 24 }}>
                        <BalanceCard filteredTransactions={p.filtered} periodLabel={p.period.label} />
                    </div>
                </GHFSection>

                {/* 02 — Период и локация */}
                <GHFSection number="02" title="Период и локация.">
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
                        {/* Period mode tabs */}
                        <div style={{ display: 'flex', border: `1px solid ${GH.ink10}`, flexWrap: 'wrap' }}>
                            {periodTabs.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => { p.setPeriodMode(t.id); p.setPeriodOffset(0); }}
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 10,
                                        letterSpacing: '0.12em',
                                        textTransform: 'uppercase',
                                        padding: '10px 12px',
                                        background: p.periodMode === t.id ? GH.ink : 'transparent',
                                        color: p.periodMode === t.id ? GH.paper : GH.ink,
                                        border: 'none',
                                        borderRight: `1px solid ${GH.ink10}`,
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>

                        {/* Nav arrows or custom dates */}
                        {p.periodMode !== 'custom' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button
                                    onClick={() => p.setPeriodOffset((o: number) => o - 1)}
                                    style={{ width: 32, height: 32, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <ChevronLeft size={14} />
                                </button>
                                <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', minWidth: 140, textAlign: 'center' }}>
                                    {p.period.label}
                                </span>
                                <button
                                    onClick={() => p.canGoNext && p.setPeriodOffset((o: number) => o + 1)}
                                    disabled={!p.canGoNext}
                                    style={{ width: 32, height: 32, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: p.canGoNext ? 'pointer' : 'not-allowed', opacity: p.canGoNext ? 1 : 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <CalendarDays size={14} color={GH.ink60} />
                                <input
                                    type="date"
                                    value={p.customFrom}
                                    onChange={e => p.setCustomFrom(e.target.value)}
                                    style={{ ...hairlineInput, width: 140, fontFamily: GH_MONO, fontSize: 12 }}
                                />
                                <span style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>—</span>
                                <input
                                    type="date"
                                    value={p.customTo}
                                    onChange={e => p.setCustomTo(e.target.value)}
                                    max={format(new Date(), 'yyyy-MM-dd')}
                                    style={{ ...hairlineInput, width: 140, fontFamily: GH_MONO, fontSize: 12 }}
                                />
                            </div>
                        )}

                        {/* Branch dropdown */}
                        <div>
                            <select
                                value={p.selectedBranch}
                                onChange={e => p.setSelectedBranch(e.target.value)}
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 11,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                    background: 'transparent',
                                    color: GH.ink,
                                    border: `1px solid ${GH.ink10}`,
                                    padding: '10px 16px',
                                    outline: 'none',
                                    cursor: 'pointer',
                                }}
                            >
                                <option value="">Общая касса</option>
                                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>
                    </div>
                </GHFSection>

                {/* 03 — Журнал */}
                <GHFSection number="03" title="Журнал операций.">
                    {/* Tab selector */}
                    <div style={{ display: 'flex', border: `2px solid ${GH.ink}`, width: '100%', maxWidth: 'fit-content', marginBottom: 24, overflowX: 'auto' }}>
                        {tabs.map((t, idx) => {
                            if (t.id === 'categories' && !p.canManageCategories) return null;
                            const active = p.tab === t.id;
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => p.setTab(t.id)}
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 10,
                                        letterSpacing: '0.14em',
                                        textTransform: 'uppercase',
                                        padding: '12px 16px',
                                        background: active ? GH.ink : 'transparent',
                                        color: active ? GH.paper : GH.ink,
                                        border: 'none',
                                        borderLeft: idx > 0 ? `1px solid ${active ? GH.paper : GH.ink}` : 'none',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                        flex: '1 0 auto',
                                    }}
                                >
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Type filter (transactions tab only) */}
                    {p.tab === 'transactions' && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                            <div style={{ display: 'flex', border: `1px solid ${GH.ink10}` }}>
                                {typeTabs.map(t => {
                                    const active = p.txType === t.id;
                                    return (
                                        <button
                                            key={t.id}
                                            onClick={() => p.setTxType(t.id)}
                                            style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 10,
                                                letterSpacing: '0.12em',
                                                textTransform: 'uppercase',
                                                padding: '8px 12px',
                                                background: active ? GH.ink : 'transparent',
                                                color: active ? GH.paper : GH.ink,
                                                border: 'none',
                                                borderRight: `1px solid ${active ? GH.paper : GH.ink10}`,
                                                cursor: 'pointer',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                            {p.filtered.length > 0 && (
                                <span style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.12em', color: GH.ink60, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                    {p.filtered.length} операций · {p.period.label}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Tab content */}
                    <div style={{ border: `1px solid ${GH.ink10}`, padding: 'clamp(8px, 2vw, 24px)', background: GH.paper, overflowX: 'auto' }}>
                        {p.tab === 'transactions' && <CashboxTransactionTable filteredTransactions={p.filtered} onRefresh={p.refetchTransactions} />}
                        {p.tab === 'categories' && p.canManageCategories && <CategoryManager />}
                        {p.tab === 'shifts' && <ShiftReportsTable />}
                    </div>
                </GHFSection>

                {/* 04 — Аналитика */}
                <GHFSection number="04" title="Аналитика.">
                    <div style={{ border: `1px solid ${GH.ink10}`, padding: 24 }}>
                        <CashboxAnalytics />
                    </div>
                </GHFSection>

                {/* Footer */}
                <div style={{ borderTop: `2px solid ${GH.ink}`, paddingTop: 20, marginTop: 32, display: 'flex', justifyContent: 'space-between', fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 }}>
                    <span>Unbox · Касса · {new Date().getFullYear()}</span>
                    <span>{p.period.label}</span>
                </div>
            </div>

            {/* Modals */}
            <AddCashboxTransactionModal isOpen={p.showAddTx} onClose={() => { p.setShowAddTx(false); p.refetchTransactions(); }} />
            <EndShiftModal isOpen={p.showEndShift} onClose={() => p.setShowEndShift(false)} branch={p.selectedBranch || undefined} />

            {/* Grid House balance correction modal */}
            {p.showCorrection && p.canCorrectBalance && createPortal(
                <div
                    style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,15,16,0.50)', padding: 24 }}
                    onClick={() => p.setShowCorrection(false)}
                >
                    <div
                        style={{ background: GH.paper, border: `2px solid ${GH.ink}`, maxWidth: 520, width: '100%', padding: 36 }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 24 }}>
                            <div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 6 }}>
                                    Действие · Корректировка
                                </div>
                                <h3 style={{ fontFamily: GH_SANS, fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
                                    Остаток на счёте.
                                </h3>
                            </div>
                            <button onClick={() => p.setShowCorrection(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60 }}>
                                <X size={20} />
                            </button>
                        </div>

                        <p style={{ fontFamily: GH_SANS, fontSize: 13, lineHeight: 1.5, color: GH.ink60, marginTop: 0, marginBottom: 24 }}>
                            Установите фактический остаток. Разница запишется как корректировка с сохранением истории.
                        </p>

                        <div style={{ marginBottom: 20 }}>
                            <label style={{ display: 'block', fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 }}>
                                Счёт
                            </label>
                            <select
                                value={p.corrAccount}
                                onChange={e => p.setCorrAccount(e.target.value)}
                                style={{ ...hairlineInput, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}
                            >
                                <option value="cash">Наличные</option>
                                <option value="card_tbc">Карта TBC</option>
                                <option value="card_bog">Карта BOG</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: 20 }}>
                            <label style={{ display: 'block', fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 }}>
                                Филиал
                            </label>
                            <select
                                value={p.corrBranch}
                                onChange={e => p.setCorrBranch(e.target.value)}
                                style={{ ...hairlineInput, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}
                            >
                                <option value="">Общая касса (все филиалы)</option>
                                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>

                        <div style={{ marginBottom: 20 }}>
                            <label style={{ display: 'block', fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 }}>
                                Фактический остаток · GEL
                            </label>
                            <input
                                type="number"
                                value={p.corrAmount}
                                onChange={e => p.setCorrAmount(e.target.value)}
                                placeholder="0.00"
                                style={{ ...hairlineInput, fontFamily: GH_MONO, fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                            />
                        </div>

                        <div style={{ marginBottom: 24 }}>
                            <label style={{ display: 'block', fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 }}>
                                Причина *
                            </label>
                            <textarea
                                value={p.corrReason}
                                onChange={e => p.setCorrReason(e.target.value)}
                                placeholder="Укажите причину корректировки..."
                                rows={3}
                                style={{ ...hairlineInput, resize: 'none', padding: '10px 0' }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: 0, borderTop: `2px solid ${GH.ink}`, paddingTop: 20 }}>
                            <button
                                onClick={() => p.setShowCorrection(false)}
                                style={{ flex: 1, ...outlineBtn, padding: '14px 20px', borderRight: 'none' }}
                            >
                                Отмена
                            </button>
                            <button
                                disabled={p.corrSaving || !p.corrReason.trim() || p.corrAmount === ''}
                                onClick={async () => {
                                    p.setCorrSaving(true);
                                    try {
                                        const { api } = await import('../../api/client');
                                        await api.post('/cashbox/balance-correction', {
                                            payment_method: p.corrAccount,
                                            new_balance: parseFloat(p.corrAmount),
                                            reason: p.corrReason.trim(),
                                            branch: p.corrBranch || undefined,
                                        });
                                        const { toast } = await import('sonner');
                                        toast.success('Остаток скорректирован');
                                        p.setShowCorrection(false);
                                        p.setCorrAmount('');
                                        p.setCorrReason('');
                                        p.setCorrBranch('');
                                        p.fetchBalance(p.selectedBranch || undefined);
                                        p.refetchTransactions();
                                    } catch (err: any) {
                                        const { toast } = await import('sonner');
                                        toast.error(err?.response?.data?.detail || 'Ошибка корректировки');
                                    } finally {
                                        p.setCorrSaving(false);
                                    }
                                }}
                                style={{
                                    flex: 1,
                                    ...inkBtn,
                                    padding: '14px 20px',
                                    opacity: (p.corrSaving || !p.corrReason.trim() || p.corrAmount === '') ? 0.4 : 1,
                                    cursor: (p.corrSaving || !p.corrReason.trim() || p.corrAmount === '') ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {p.corrSaving ? 'Сохранение…' : 'Применить'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
