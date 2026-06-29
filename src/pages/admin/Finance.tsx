import { useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Clock, ChevronLeft, ChevronRight, CalendarDays, X, Sun } from 'lucide-react';
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
import { OpenShiftModal } from '../../components/admin/cashbox/OpenShiftModal';
import { MorningChecklistModal } from '../../components/admin/cashbox/MorningChecklistModal';
import { PreCloseShiftChecklist } from '../../components/admin/cashbox/PreCloseShiftChecklist';
import { ShiftReportsTable } from '../../components/admin/cashbox/ShiftReportsTable';
import { CashboxAnalytics } from '../../components/admin/cashbox/CashboxAnalytics';
import type { CashboxTransaction } from '../../api/cashbox';
import clsx from 'clsx';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { formatBatumi } from '../../utils/dateUtils';

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
        // Period labels rendered in Batumi tz so admins on remote browsers see
        // the same day/month label the centre operates by.
        const label = offset === 0
            ? 'Сегодня'
            : offset === -1
            ? 'Вчера'
            : formatBatumi(base, 'd MMMM', ru);
        return { from: start, to: end, label };
    }
    if (mode === 'week') {
        const start = startOfWeek(addWeeks(now, offset), { locale: ru });
        const end = endOfWeek(addWeeks(now, offset), { locale: ru });
        const label = offset === 0
            ? 'Эта неделя'
            : offset === -1
            ? 'Прошлая неделя'
            : `${formatBatumi(start, 'd MMM', ru)} – ${formatBatumi(end, 'd MMM', ru)}`;
        return { from: start, to: end, label };
    } else {
        const base = addMonths(now, offset);
        const start = startOfMonth(base);
        const end = endOfMonth(base);
        const label = offset === 0
            ? 'Этот месяц'
            : formatBatumi(base, 'LLLL yyyy', ru);
        return { from: start, to: end, label };
    }
}

export function AdminFinance() {
    const [tab, setTab] = useState<Tab>('transactions');
    const [showAddTx, setShowAddTx] = useState(false);
    const [showEndShift, setShowEndShift] = useState(false);
    const [showOpenShift, setShowOpenShift] = useState(false);
    // Step 1 of shift close (Excel #53): pre-close checklist
    const [showCloseChecklist, setShowCloseChecklist] = useState(false);
    // Excel #54 — reason set only when the admin bypasses the checklist.
    // Propagated into the EndShift notes so the shift report records WHY the
    // list wasn't completed.
    const [checklistSkipReason, setChecklistSkipReason] = useState<string | null>(null);
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
    const { fetchBalance, fetchTransactions, fetchCategories, fetchShiftReports, fetchAnalytics, transactions, shiftReports } = useCashboxStore();

    // Yesterday's shift status (Excel #61) — was yesterday closed?
    const yesterdayShiftStatus = useMemo(() => {
        const now = new Date();
        const yStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const yEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const closedYesterday = shiftReports.some(r => {
            const endTs = new Date(r.shiftEnd).getTime();
            return endTs >= yStart.getTime() && endTs < yEnd.getTime();
        });
        return closedYesterday ? 'closed' : 'missed';
    }, [shiftReports]);
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

    // Excel #81 — disable "Открыть смену" when a shift is already open in
    // the selected branch (or anywhere if "Все филиалы"). Without this,
    // an active button when the shift is already open looks like "did
    // nothing happen? let me click again" — which then spawns duplicate
    // open events.
    const [currentOpenShift, setCurrentOpenShift] = useState<any | null>(null);
    const refetchShiftState = useCallback(async () => {
        try {
            const { cashboxApi } = await import('../../api/cashbox');
            const open = await cashboxApi.getCurrentOpenShift(selectedBranch || undefined);
            setCurrentOpenShift(open);
        } catch {
            setCurrentOpenShift(null);
        }
    }, [selectedBranch]);
    useEffect(() => { refetchShiftState(); }, [refetchShiftState]);

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

    return (

            <GridHouseAdminFinance
                tab={tab} setTab={setTab}
                showAddTx={showAddTx} setShowAddTx={setShowAddTx}
                showEndShift={showEndShift} setShowEndShift={setShowEndShift}
                showOpenShift={showOpenShift} setShowOpenShift={setShowOpenShift}
                showCloseChecklist={showCloseChecklist} setShowCloseChecklist={setShowCloseChecklist}
                checklistSkipReason={checklistSkipReason} setChecklistSkipReason={setChecklistSkipReason}
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
                yesterdayShiftStatus={yesterdayShiftStatus}
                currentOpenShift={currentOpenShift}
                refetchShiftState={refetchShiftState}
            />
        );
}

type GHAFProps = {
    tab: Tab; setTab: (t: Tab) => void;
    showAddTx: boolean; setShowAddTx: (v: boolean) => void;
    showEndShift: boolean; setShowEndShift: (v: boolean) => void;
    showOpenShift: boolean; setShowOpenShift: (v: boolean) => void;
    showCloseChecklist: boolean; setShowCloseChecklist: (v: boolean) => void;
    checklistSkipReason: string | null; setChecklistSkipReason: (v: string | null) => void;
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
    yesterdayShiftStatus: 'closed' | 'missed';
    currentOpenShift: any | null;
    refetchShiftState: () => void;
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
    const currentUser = useUserStore(s => s.currentUser);
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
                    {/* Action bar — three zones:
                        • left: shift status (text marker) + shift control panel
                        • right: correction (secondary link) + primary "+ Новая операция"
                        Visual hierarchy collapses six look-alike buttons into one
                        primary + one grouped tri-control + one text marker + one link. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        {/* Yesterday shift — marker when healthy, urgent button when missed */}
                        {p.yesterdayShiftStatus === 'closed' ? (
                            <span
                                title="Вчерашняя смена была закрыта."
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 10,
                                    letterSpacing: '0.18em',
                                    textTransform: 'uppercase',
                                    color: GH.ink60,
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                ✓ Вчера закрыта
                            </span>
                        ) : (
                            <button
                                onClick={() => p.setShowCloseChecklist(true)}
                                title="Вчерашняя смена не была закрыта. Нажмите, чтобы закрыть."
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 10,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                    background: GH.ink,
                                    color: GH.paper,
                                    border: `1px solid ${GH.ink}`,
                                    padding: '10px 14px',
                                    cursor: 'pointer',
                                }}
                            >
                                ⚠ Вчера не закрыта · закрыть →
                            </button>
                        )}

                        {/* Shift control — three segments share one crisp 1px ink
                            border and 1px ink dividers. Reads as a single panel,
                            the select doesn't look orphaned anymore. Branch picker
                            sits between open/close so scope is chosen before
                            either action (Excel #68). */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'stretch',
                                border: `1px solid ${GH.ink}`,
                                background: GH.paper,
                            }}
                        >
                            {(() => {
                                // Excel #81 — disable when a shift is already
                                // open for the selected scope. Visually: faded
                                // label + "cursor: not-allowed" so админ
                                // видит что кнопка не «ничего не делает»,
                                // а «уже нечего делать».
                                const shiftOpen = !!p.currentOpenShift;
                                return (
                                    <button
                                        onClick={() => { if (!shiftOpen) p.setShowOpenShift(true); }}
                                        disabled={shiftOpen}
                                        title={
                                            shiftOpen
                                                ? 'Смена уже открыта — кнопка заблокирована'
                                                : 'Зафиксировать начало рабочей смены'
                                        }
                                        style={{
                                            fontFamily: GH_MONO,
                                            fontSize: 10,
                                            letterSpacing: '0.16em',
                                            textTransform: 'uppercase',
                                            background: 'transparent',
                                            color: shiftOpen ? GH.ink30 : GH.ink,
                                            border: 'none',
                                            borderRight: `1px solid ${GH.ink}`,
                                            padding: '10px 14px',
                                            cursor: shiftOpen ? 'not-allowed' : 'pointer',
                                            opacity: shiftOpen ? 0.55 : 1,
                                        }}
                                    >
                                        <Sun size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                                        {shiftOpen ? 'Открыта' : 'Открыть'}
                                    </button>
                                );
                            })()}
                            <select
                                value={p.selectedBranch}
                                onChange={e => p.setSelectedBranch(e.target.value)}
                                title="Филиал для закрытия смены"
                                style={{
                                    padding: '10px 28px 10px 14px',
                                    fontSize: 10,
                                    fontFamily: GH_MONO,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                    border: 'none',
                                    borderRight: `1px solid ${GH.ink}`,
                                    background: 'transparent',
                                    color: GH.ink,
                                    cursor: 'pointer',
                                    appearance: 'none',
                                    backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(-45deg, transparent 50%, currentColor 50%)',
                                    backgroundPosition: 'calc(100% - 14px) 50%, calc(100% - 9px) 50%',
                                    backgroundSize: '5px 5px',
                                    backgroundRepeat: 'no-repeat',
                                }}
                            >
                                <option value="">Все филиалы</option>
                                <option value="Unbox Uni">Unbox Uni</option>
                                <option value="Unbox One">Unbox One</option>
                                <option value="Neo School">Neo School</option>
                            </select>
                            <button
                                onClick={() => p.setShowCloseChecklist(true)}
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 10,
                                    letterSpacing: '0.16em',
                                    textTransform: 'uppercase',
                                    background: 'transparent',
                                    color: GH.ink,
                                    border: 'none',
                                    padding: '10px 14px',
                                    cursor: 'pointer',
                                }}
                            >
                                <Clock size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                                Закрыть
                            </button>
                        </div>

                        {/* Pushes the primary action to the right edge */}
                        <div style={{ flex: 1 }} />

                        {/* Correction — rare, demoted to a quiet text link */}
                        {p.canCorrectBalance && (
                            <button
                                onClick={() => { p.setCorrBranch(p.selectedBranch); p.setShowCorrection(true); }}
                                title="Корректировка остатка на счёте"
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 10,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                    background: 'transparent',
                                    color: GH.ink60,
                                    border: 'none',
                                    padding: '10px 4px',
                                    cursor: 'pointer',
                                    textDecoration: 'underline',
                                    textUnderlineOffset: 4,
                                }}
                            >
                                Корректировка
                            </button>
                        )}

                        <button
                            onClick={async () => {
                                const { toast } = await import('sonner');
                                const { pricingApi } = await import('../../api/pricing');
                                try {
                                    const preview = await pricingApi.runWeeklyRebate(true);
                                    if (!preview.users_credited) {
                                        toast.info(`За неделю с ${preview.week_start} начислять нечего`);
                                        return;
                                    }
                                    const ok = window.confirm(
                                        `Начислить недельные кредиты за неделю с ${preview.week_start}?\n\n` +
                                        `${preview.users_credited} клиент(ов), всего ${preview.total_credited} ₾.\n` +
                                        `Деньги зачислятся на их балансы (повторно — не начислит).`
                                    );
                                    if (!ok) return;
                                    const real = await pricingApi.runWeeklyRebate(false);
                                    toast.success(`Начислено ${real.total_credited} ₾ · ${real.users_credited} клиент(ов)`);
                                } catch (e: any) {
                                    toast.error(e?.response?.data?.detail || 'Ошибка перерасчёта');
                                }
                            }}
                            style={{ ...inkBtn, padding: '10px 18px', fontSize: 11, background: 'transparent', color: GH.ink, border: `1px solid ${GH.ink}` }}
                            title="Начислить недельные кредиты за завершившуюся неделю (cron делает это автоматически по понедельникам)"
                        >
                            Недельные кредиты
                        </button>

                        <button
                            onClick={() => p.setShowAddTx(true)}
                            style={{ ...inkBtn, padding: '10px 18px', fontSize: 11 }}
                        >
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
                                    max={formatBatumi(new Date(), 'yyyy-MM-dd')}
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
            <PreCloseShiftChecklist
                isOpen={p.showCloseChecklist}
                onClose={() => p.setShowCloseChecklist(false)}
                // Excel #54: capture skip reason (if any) and pass into EndShiftModal
                // which will append it to the shift-report notes for audit.
                onProceed={(skipReason) => {
                    p.setChecklistSkipReason(skipReason ?? null);
                    p.setShowCloseChecklist(false);
                    p.setShowEndShift(true);
                }}
            />
            <EndShiftModal
                isOpen={p.showEndShift}
                onClose={() => { p.setShowEndShift(false); p.setChecklistSkipReason(null); }}
                branch={p.selectedBranch || undefined}
                checklistSkipReason={p.checklistSkipReason || undefined}
            />
            <OpenShiftModal isOpen={p.showOpenShift} onClose={() => p.setShowOpenShift(false)} branch={p.selectedBranch || undefined} />

            {/* Excel #54 variant B — morning checklist, soft reminder only.
                Shown at most once per day per admin. Closing doesn't block
                access to Finance. */}
            {currentUser?.email && <MorningChecklistModal adminEmail={currentUser.email} />}

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
