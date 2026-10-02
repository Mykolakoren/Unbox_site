import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import { Plus, ChevronLeft, ChevronRight, CalendarDays, X, Sun, Check, AlertTriangle, MoreHorizontal, ChevronDown } from 'lucide-react';
import {
    startOfWeek, endOfWeek, startOfMonth, endOfMonth,
    startOfDay, endOfDay, addDays, addWeeks, addMonths, format,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCashboxStore } from '../../store/cashboxStore';
import { useUserStore } from '../../store/userStore';
import { userCanAccessFinance } from '../../utils/permissions';
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
import { ReconciliationExport } from '../../components/admin/cashbox/ReconciliationExport';
import { DaySummary } from '../../components/admin/cashbox/DaySummary';
import { WeeklyRebates } from '../../components/admin/cashbox/WeeklyRebates';
import { AnalyticsCharts } from '../../components/admin/AnalyticsCharts';
import { excludeAdjustments } from '../../components/admin/cashbox/cashMoney';
import { cashboxApi, type CashboxTransaction, type CashboxPeriodSummary, type CashboxAnalytics as CashboxAnalyticsData } from '../../api/cashbox';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { formatBatumi, parseUTC, BATUMI_TZ } from '../../utils/dateUtils';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { COLOR, SHADOW, STATUS, Z } from '../../design/tokens';
import { formatGel, formatDayMonth, formatDayMonthShort, formatMonthLabel, formatTime } from '../../utils/format';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Chip';

// «Итоги дня» и «Недельные скидки» (решение владельца 02.10): админы сверяют день
// и скидки с сайтом, а не со своим Excel.
type Tab = 'transactions' | 'day' | 'rebates' | 'categories' | 'shifts';
type PeriodMode = 'day' | 'week' | 'month' | 'custom';
type TxType = 'all' | 'income' | 'expense';

const BRANCHES = ['Unbox Uni', 'Unbox One'];
/** Короткие имена филиалов для подписей («Uni», «One»). */
const BRANCH_SHORT: Record<string, string> = { 'Unbox Uni': 'Uni', 'Unbox One': 'One' };

// Сколько операций за период тянем за раз — это потолок бэкенда
// (/cashbox/transactions, limit ≤ 1000). Было 200: за «Диапазон» или
// насыщенный месяц ранние операции молча выпадали из итогов.
const TX_LIMIT = 1000;

/** Подпись периода для строки итогов: «сегодня», «22–28 сент.», «сентябрь 2026». */
function getPeriodRange(mode: PeriodMode, offset: number): { from: Date; to: Date; label: string } {
    const now = new Date();
    if (mode === 'day') {
        const base = addDays(now, offset);
        const start = startOfDay(base);
        const end = endOfDay(base);
        // Подписи — по Батуми, как работает центр.
        const label = offset === 0
            ? 'сегодня'
            : offset === -1
            ? 'вчера'
            : formatDayMonth(base, { timeZone: BATUMI_TZ, withYear: 'auto' });
        return { from: start, to: end, label };
    }
    if (mode === 'week') {
        const start = startOfWeek(addWeeks(now, offset), { locale: ru });
        const end = endOfWeek(addWeeks(now, offset), { locale: ru });
        return { from: start, to: end, label: rangeLabel(start, end) };
    }
    const base = addMonths(now, offset);
    const start = startOfMonth(base);
    const end = endOfMonth(base);
    return { from: start, to: end, label: formatMonthLabel(base) };
}

/** «22–28 сент.» / «29 сент. – 5 окт.» — короткий диапазон дат. */
function rangeLabel(from: Date, to: Date): string {
    const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
    if (sameMonth) return `${from.getDate()}–${formatDayMonthShort(to, { withYear: 'auto' })}`;
    return `${formatDayMonthShort(from, { withYear: 'auto' })} – ${formatDayMonthShort(to, { withYear: 'auto' })}`;
}

/**
 * Волна 4 (доработка): страницу закрывает та же проверка, что прячет пункт
 * меню (userCanAccessFinance). Раньше без права пункт пропадал, но по прямой
 * ссылке /admin/finance касса открывалась. Обёртка — чтобы без права не
 * запускались хуки и запросы самой страницы.
 */
export function AdminFinance() {
    const currentUser = useUserStore(s => s.currentUser);
    if (!currentUser) return null;
    if (!userCanAccessFinance(currentUser)) return <Navigate to="/admin" replace />;
    return <AdminFinancePage />;
}

function AdminFinancePage() {
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
    const { fetchBalance, fetchTransactions, fetchCategories, fetchShiftReports, fetchAnalytics, transactions } = useCashboxStore();

    // Yesterday's shift status (Excel #61) — was yesterday closed?
    // Филиалы с «зависшей» вчерашней сменой (открыта и не закрыта с прошлого дня).
    const [pendingCloseBranches, setPendingCloseBranches] = useState<string[]>([]);
    // «Вчера не закрыта» — теперь по РЕАЛЬНОМУ состоянию смен (бэкенд
    // /shifts/pending-close): филиал, где смена открыта и не закрыта с прошлого
    // дня. Раньше проверялось «был ли close с датой ровно вчера», но смену
    // закрывают наутро (shift_end = сегодня) → надпись висела после закрытия.
    const yesterdayShiftStatus = useMemo<'closed' | 'missed'>(() => {
        if (selectedBranch) {
            return pendingCloseBranches.includes(selectedBranch) ? 'missed' : 'closed';
        }
        return pendingCloseBranches.length > 0 ? 'missed' : 'closed';
    }, [pendingCloseBranches, selectedBranch]);
    const canManageCategories = currentUser?.role === 'senior_admin' || currentUser?.role === 'owner';
    const canCorrectBalance = currentUser?.role === 'senior_admin' || currentUser?.role === 'owner';

    // Compute period range (hoisted so gridHouse branch can use it)
    const period = useMemo(() => {
        if (periodMode === 'custom') {
            const from = customFrom ? new Date(customFrom) : new Date(0);
            const to = customTo ? new Date(customTo + 'T23:59:59') : new Date();
            // Подпись с датами: итоги подписаны периодом, и
            // «Диапазон» без дат не говорил, за что эти цифры.
            const label = customFrom ? rangeLabel(from, to) : `всё время по ${formatDayMonthShort(to, { withYear: 'auto' })}`;
            return { from, to, label };
        }
        return getPeriodRange(periodMode, periodOffset);
    }, [periodMode, periodOffset, customFrom, customTo]);

    useEffect(() => {
        fetchBalance(selectedBranch || undefined);
        fetchCategories();
        fetchShiftReports();
    }, [fetchBalance, fetchCategories, fetchShiftReports, selectedBranch]);

    // Excel #81 — disable "Открыть смену" when a shift is already open in
    // the selected branch (or anywhere if "Все филиалы"). Without this,
    // an active button when the shift is already open looks like "did
    // nothing happen? let me click again" — which then spawns duplicate
    // open events.
    const [currentOpenShift, setCurrentOpenShift] = useState<any | null>(null);
    const refetchShiftState = useCallback(async () => {
        try {
            const open = await cashboxApi.getCurrentOpenShift(selectedBranch || undefined);
            setCurrentOpenShift(open);
        } catch {
            setCurrentOpenShift(null);
        }
        try {
            const p = await cashboxApi.getPendingCloseShifts();
            setPendingCloseBranches((p.pending || []).map(x => x.branch));
        } catch {
            setPendingCloseBranches([]);
        }
    }, [selectedBranch]);
    useEffect(() => { refetchShiftState(); }, [refetchShiftState]);

    // Итоги периода — с сервера (/cashbox/summary): по ВСЕМ операциям периода,
    // корректировки отдельно. Тот же вызов, что у телефона, — цифры совпадают.
    const [summary, setSummary] = useState<CashboxPeriodSummary | null>(null);
    const [summaryFailed, setSummaryFailed] = useState(false);
    const summarySeq = useRef(0);
    const loadSummary = useCallback(async () => {
        const seq = ++summarySeq.current;
        setSummary(null);
        try {
            const s = await cashboxApi.getPeriodSummary({
                dateFrom: period.from.toISOString(),
                dateTo: period.to.toISOString(),
                branch: selectedBranch || undefined,
            });
            if (seq !== summarySeq.current) return;
            setSummary(s);
            setSummaryFailed(false);
        } catch {
            if (seq === summarySeq.current) setSummaryFailed(true);
        }
    }, [period, selectedBranch]);
    useEffect(() => { loadSummary(); }, [loadSummary]);

    const refetchTransactions = () => {
        const dateFrom = format(period.from, "yyyy-MM-dd'T'00:00:00");
        const dateTo = format(period.to, "yyyy-MM-dd'T'23:59:59");
        fetchTransactions({ dateFrom, dateTo, limit: TX_LIMIT });
        loadSummary();
    };

    useEffect(() => {
        const dateFrom = format(period.from, "yyyy-MM-dd'T'00:00:00");
        const dateTo = format(period.to, "yyyy-MM-dd'T'23:59:59");
        fetchTransactions({ dateFrom, dateTo, limit: TX_LIMIT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchTransactions, period.from.getTime(), period.to.getTime()]);

    // ── Аналитика (свёрнута; графики переехали сюда с /admin) ─────────────
    // Грузим только когда раздел открыт, и ровно за выбранный период
    // (раньше — всегда последние 30 дней при любом фильтре, G7-admin-core-M3).
    const [analyticsOpen, setAnalyticsOpen] = useState(false);
    const [adjustments, setAdjustments] = useState<CashboxTransaction[]>([]);
    const rawAnalytics = useCashboxStore(s => s.analytics);
    const bookings = useUserStore(s => s.bookings);
    const fetchAllBookings = useUserStore(s => s.fetchAllBookings);
    useEffect(() => {
        if (!analyticsOpen) return;
        const dateFrom = format(period.from, "yyyy-MM-dd'T'00:00:00");
        const dateTo = format(period.to, "yyyy-MM-dd'T'23:59:59");
        fetchAnalytics(dateFrom, dateTo);
        // N2: корректировки того же периода — их вычтем из графиков на фронте.
        cashboxApi.getTransactions({ dateFrom, dateTo, paymentMethod: 'adjustment', limit: TX_LIMIT })
            .then(setAdjustments)
            .catch(() => setAdjustments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [analyticsOpen, fetchAnalytics, period.from.getTime(), period.to.getTime()]);
    useEffect(() => {
        if (analyticsOpen && bookings.length === 0) void fetchAllBookings();
    }, [analyticsOpen, bookings.length, fetchAllBookings]);
    // N2: корректировки (недельная скидка, правка баланса клиента) — не деньги.
    const analytics = useMemo(
        () => (rawAnalytics ? excludeAdjustments(rawAnalytics, adjustments) : null),
        [rawAnalytics, adjustments],
    );

    const canGoNext = periodMode !== 'custom' && periodOffset < 0;

    // Операции периода и филиала — БЕЗ фильтра «Приходы/Расходы» журнала.
    // Итоги считаются отсюда (запасной расчёт), раньше они брали отфильтрованный
    // журнал, и после клика «Приходы» внизу «Расход» наверху становился 0
    // (аудит 29.09, G7-admin-core-M2).
    const periodTx = useMemo((): CashboxTransaction[] => {
        return transactions.filter(tx => {
            if (selectedBranch && tx.branch !== selectedBranch) return false;
            const d = new Date(tx.date);
            if (d < period.from || d > period.to) return false;
            return true;
        });
    }, [transactions, selectedBranch, period]);

    const filtered = useMemo((): CashboxTransaction[] => {
        if (txType === 'all') return periodTx;
        return periodTx.filter(tx => tx.type === txType);
    }, [periodTx, txType]);

    // Сервер отдал ровно потолок — за период операций, скорее всего, больше,
    // и итоги неполные. Честно говорим об этом в карточке.
    const totalsTruncated = transactions.length >= TX_LIMIT;

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
                periodTx={periodTx}
                totalsTruncated={totalsTruncated}
                summary={summary}
                summaryFailed={summaryFailed}
                analyticsOpen={analyticsOpen} setAnalyticsOpen={setAnalyticsOpen}
                analytics={analytics}
                bookings={bookings}
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
    /** Операции периода и филиала без фильтра типа — для итогов. */
    periodTx: CashboxTransaction[];
    totalsTruncated: boolean;
    summary: CashboxPeriodSummary | null;
    summaryFailed: boolean;
    analyticsOpen: boolean; setAnalyticsOpen: (v: boolean) => void;
    /** Аналитика периода уже без корректировок (N2). */
    analytics: CashboxAnalyticsData | null;
    bookings: any[];
    canManageCategories: boolean;
    canCorrectBalance: boolean;
    refetchTransactions: () => void;
    fetchBalance: (branch?: string) => void;
    fetchTransactions: (params?: any) => void;
    yesterdayShiftStatus: 'closed' | 'missed';
    currentOpenShift: any | null;
    refetchShiftState: () => void;
};

/** Меню «⋯» в шапке кассы: редкие действия (корректировка, недельные кредиты, выгрузка). */
function FinanceMoreMenu({ children }: { children: (close: () => void) => React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);
    return (
        <div ref={rootRef} style={{ position: 'relative' }}>
            <Button
                variant="secondary"
                icon={<MoreHorizontal size={16} aria-hidden="true" />}
                aria-label="Ещё действия кассы"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
            />
            {open && (
                <div
                    role="menu"
                    style={{
                        position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: Z.dropdown,
                        minWidth: 300, background: COLOR.card, border: `1px solid ${GH.ink10}`, boxShadow: SHADOW.pop,
                        padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
                    }}
                >
                    {children(() => setOpen(false))}
                </div>
            )}
        </div>
    );
}

const menuItemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
    background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: GH_SANS, fontSize: 14, color: GH.ink,
};

function GridHouseAdminFinance(p: GHAFProps) {
    const currentUser = useUserStore(s => s.currentUser);
    const { confirm } = useConfirmDialog();
    const inkBtn: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: 12,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: GH.ink,
        color: GH.paper,
        border: `1px solid ${GH.ink}`,
        padding: '12px 20px',
        cursor: 'pointer',
    };
    const outlineBtn: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: 12,
        letterSpacing: '0.06em',
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

    // Недельные кредиты — тот же расчёт и то же подтверждение, что раньше
    // (кнопка переехала в меню «⋯»).
    const handleWeeklyRebate = async () => {
        const { toast } = await import('sonner');
        const { pricingApi } = await import('../../api/pricing');
        try {
            const preview = await pricingApi.runWeeklyRebate(true);
            if (!preview.users_credited) {
                toast.info(`За неделю с ${preview.week_start} начислять нечего`);
                return;
            }
            const ok = await confirm({
                title: `Начислить недельные кредиты за неделю с ${preview.week_start}?`,
                body: `${preview.users_credited} клиент(ов), всего ${formatGel(preview.total_credited)}. `
                    + 'Деньги зачислятся на их балансы; повторно за эту неделю не начислим.',
                confirmLabel: `Начислить ${formatGel(preview.total_credited)}`,
                cancelLabel: 'Не начислять',
            });
            if (!ok) return;
            const real = await pricingApi.runWeeklyRebate(false);
            toast.success(`Начислено ${formatGel(real.total_credited)} · ${real.users_credited} клиент(ов)`);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Ошибка перерасчёта');
        }
    };

    const shiftOpen = !!p.currentOpenShift;
    const openedAt = p.currentOpenShift?.openedAt ? formatTime(parseUTC(p.currentOpenShift.openedAt), { timeZone: BATUMI_TZ }) : null;
    const branchLabel = p.selectedBranch ? (BRANCH_SHORT[p.selectedBranch] || p.selectedBranch) : 'все филиалы';

    const periodTabs: { value: PeriodMode; label: string }[] = [
        { value: 'day', label: 'День' },
        { value: 'week', label: 'Неделя' },
        { value: 'month', label: 'Месяц' },
        { value: 'custom', label: 'Диапазон' },
    ];
    const typeTabs: { value: TxType; label: string }[] = [
        { value: 'all', label: 'Все' },
        { value: 'income', label: 'Приходы' },
        { value: 'expense', label: 'Расходы' },
    ];
    const tabs: { value: Tab; label: string }[] = [
        { value: 'transactions', label: 'Операции' },
        { value: 'day', label: 'Итоги дня' },
        { value: 'rebates', label: 'Недельные скидки' },
        ...(p.canManageCategories ? [{ value: 'categories' as Tab, label: 'Категории' }] : []),
        { value: 'shifts', label: 'Смены' },
    ];

    return (
        // Без своего контейнера с maxWidth/padding/minHeight: отступы даёт
        // AdminLayout (G7-14, G7-07 — двойной контейнер съедал ~96 px журнала).
        <div style={{ color: GH.ink, fontFamily: GH_SANS }}>
            <PageHeader
                title="Касса"
                actions={(
                    <>
                        {/* Статус смены — текст статуса, а не погашенная кнопка (X4-M2). */}
                        {shiftOpen ? (
                            <span
                                role="status"
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 12px', height: 36,
                                    background: STATUS.ok.bg, color: STATUS.ok.fg, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap',
                                }}
                            >
                                <Check size={14} aria-hidden="true" />
                                Смена открыта{openedAt ? ` с ${openedAt}` : ''}
                            </span>
                        ) : (
                            <Button variant="secondary" icon={<Sun size={16} aria-hidden="true" />} onClick={() => p.setShowOpenShift(true)}>
                                Открыть смену
                            </Button>
                        )}
                        <Button variant="secondary" onClick={() => p.setShowCloseChecklist(true)}>
                            {shiftOpen ? 'Закрыть' : 'Закрыть смену'}
                        </Button>
                        <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => p.setShowAddTx(true)}>
                            Новая операция
                        </Button>
                        <FinanceMoreMenu>
                            {(close) => (
                                <>
                                    {p.canCorrectBalance && (
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="hover:bg-ink-05"
                                            style={menuItemStyle}
                                            onClick={() => { close(); p.setCorrBranch(p.selectedBranch); p.setShowCorrection(true); }}
                                        >
                                            Корректировка остатка
                                            <span style={{ display: 'block', fontSize: 12, color: GH.ink60 }}>Установить фактический остаток на счёте</span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="hover:bg-ink-05"
                                        style={menuItemStyle}
                                        title="Начислить недельные кредиты за завершившуюся неделю (cron делает это автоматически по понедельникам)"
                                        onClick={() => { close(); void handleWeeklyRebate(); }}
                                    >
                                        Недельные кредиты
                                        <span style={{ display: 'block', fontSize: 12, color: GH.ink60 }}>Обычно начисляются сами по понедельникам</span>
                                    </button>
                                    <div style={{ padding: '8px 12px 4px', borderTop: `1px solid ${GH.ink10}`, marginTop: 4 }}>
                                        <div style={{ fontSize: 12, color: GH.ink60, marginBottom: 8 }}>Выгрузка для сверки (Excel за месяц)</div>
                                        <ReconciliationExport />
                                    </div>
                                </>
                            )}
                        </FinanceMoreMenu>
                    </>
                )}
            />

            {/* Вчерашняя смена не закрыта — заметно и с действием. */}
            {p.yesterdayShiftStatus === 'missed' && (
                <div
                    role="alert"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', marginBottom: 24,
                        background: STATUS.pending.bg, color: STATUS.pending.fg, fontSize: 14,
                    }}
                >
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span style={{ flex: 1, minWidth: 200 }}>Вчерашняя смена не закрыта{p.selectedBranch ? ` (${branchLabel})` : ''}.</span>
                    <Button variant="secondary" onClick={() => p.setShowCloseChecklist(true)}>Закрыть вчерашнюю смену</Button>
                </div>
            )}

            {/* ОДИН фильтр «Филиал · Период» — над всеми цифрами, которыми он управляет (G7-08). */}
            <div
                data-testid="cash-filter"
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, paddingBottom: 20, marginBottom: 24, borderBottom: `1px solid ${GH.ink10}` }}
            >
                <Segmented
                    aria-label="Филиал"
                    value={p.selectedBranch || 'all'}
                    onChange={(v) => p.setSelectedBranch(v === 'all' ? '' : v)}
                    options={[
                        { value: 'all', label: 'Все филиалы' },
                        ...BRANCHES.map(b => ({ value: b, label: BRANCH_SHORT[b] || b })),
                    ]}
                />
                <Segmented
                    aria-label="Период"
                    value={p.periodMode}
                    onChange={(v) => { p.setPeriodMode(v); p.setPeriodOffset(0); }}
                    options={periodTabs}
                />
                {p.periodMode !== 'custom' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Button
                            variant="quiet"
                            icon={<ChevronLeft size={16} />}
                            aria-label="Предыдущий период"
                            onClick={() => p.setPeriodOffset((o: number) => o - 1)}
                        />
                        <span className="num" style={{ fontSize: 14, fontWeight: 500, minWidth: 128, textAlign: 'center' }}>
                            {p.period.label.charAt(0).toUpperCase() + p.period.label.slice(1)}
                        </span>
                        <Button
                            variant="quiet"
                            icon={<ChevronRight size={16} />}
                            aria-label="Следующий период"
                            disabled={!p.canGoNext}
                            onClick={() => p.canGoNext && p.setPeriodOffset((o: number) => o + 1)}
                        />
                    </div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <CalendarDays size={14} color={GH.ink60} aria-hidden="true" />
                        <input
                            type="date"
                            aria-label="Начало периода"
                            value={p.customFrom}
                            onChange={e => p.setCustomFrom(e.target.value)}
                            style={{ ...hairlineInput, width: 140, fontFamily: GH_MONO, fontSize: 14 }}
                        />
                        <span style={{ fontSize: 14, color: GH.ink60 }}>—</span>
                        <input
                            type="date"
                            aria-label="Конец периода"
                            value={p.customTo}
                            onChange={e => p.setCustomTo(e.target.value)}
                            max={formatBatumi(new Date(), 'yyyy-MM-dd')}
                            style={{ ...hairlineInput, width: 140, fontFamily: GH_MONO, fontSize: 14 }}
                        />
                    </div>
                )}
            </div>

            {/* Сейчас (не зависит от периода) → Период (getPeriodSummary) */}
            <div style={{ marginBottom: 40 }}>
                <BalanceCard
                    filteredTransactions={p.periodTx}
                    periodLabel={p.period.label}
                    branchLabel={branchLabel}
                    summary={p.summary}
                    summaryFailed={p.summaryFailed}
                    truncated={p.totalsTruncated}
                />
            </div>

            {/* Журнал */}
            <section style={{ marginBottom: 40 }} aria-labelledby="cash-journal-title">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, borderTop: `1px solid ${GH.ink}`, paddingTop: 16, marginBottom: 16 }}>
                    <h2 id="cash-journal-title" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Журнал</h2>
                    <Segmented aria-label="Раздел журнала" value={p.tab} onChange={p.setTab} options={tabs} />
                    {p.tab === 'transactions' && (
                        <>
                            <Segmented aria-label="Тип операций" value={p.txType} onChange={p.setTxType} options={typeTabs} />
                            {p.filtered.length > 0 && (
                                <span style={{ fontSize: 14, color: GH.ink60, whiteSpace: 'nowrap' }}>
                                    {p.filtered.length} операций · {p.period.label}
                                </span>
                            )}
                        </>
                    )}
                </div>
                <div style={{ border: `1px solid ${GH.ink10}`, background: GH.paper }}>
                    {p.tab === 'transactions' && <CashboxTransactionTable filteredTransactions={p.filtered} onRefresh={p.refetchTransactions} />}
                    {/* Итоги дня — свой выбор дня (по Тбилиси), филиал — общий фильтр кассы. */}
                    {p.tab === 'day' && (
                        <div style={{ padding: 16 }}>
                            <DaySummary branch={p.selectedBranch || undefined} clientPath={k => `/admin/users/${encodeURIComponent(k)}`} />
                        </div>
                    )}
                    {p.tab === 'rebates' && (
                        <div style={{ padding: 16 }}>
                            <WeeklyRebates clientPath={k => `/admin/users/${encodeURIComponent(k)}`} />
                        </div>
                    )}
                    {p.tab === 'categories' && p.canManageCategories && <div style={{ padding: 16 }}><CategoryManager /></div>}
                    {p.tab === 'shifts' && <ShiftReportsTable />}
                </div>
            </section>

            {/* Аналитика — свёрнута; графики переехали сюда с /admin (волна 4). */}
            <section style={{ marginBottom: 40 }}>
                <button
                    type="button"
                    aria-expanded={p.analyticsOpen}
                    aria-controls="cash-analytics"
                    onClick={() => p.setAnalyticsOpen(!p.analyticsOpen)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        background: 'transparent', border: 'none', borderTop: `1px solid ${GH.ink}`, padding: '16px 0',
                        cursor: 'pointer', fontFamily: GH_SANS, color: GH.ink,
                    }}
                >
                    <span style={{ fontSize: 20, fontWeight: 600 }}>Аналитика</span>
                    <span style={{ fontSize: 14, color: GH.ink60 }}>за {p.period.label} · все филиалы</span>
                    <ChevronDown size={18} aria-hidden="true" style={{ marginLeft: 'auto', transform: p.analyticsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }} />
                </button>
                {p.analyticsOpen && (
                    <div id="cash-analytics" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        <CashboxAnalytics analytics={p.analytics} periodLabel={p.period.label} />
                        <AnalyticsCharts
                            bookings={p.bookings}
                            revenueDaily={p.analytics?.dailyData}
                            from={p.period.from}
                            to={p.period.to}
                            periodLabel={p.period.label}
                        />
                    </div>
                )}
            </section>

            {/* Modals */}
            <AddCashboxTransactionModal
                isOpen={p.showAddTx}
                onClose={() => { p.setShowAddTx(false); p.refetchTransactions(); }}
                // В5: «Вернуть» удалил операцию — обновить журнал, итоги и остатки.
                onUndone={() => { p.refetchTransactions(); p.fetchBalance(p.selectedBranch || undefined); }}
                defaultBranch={p.selectedBranch}
            />
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
                onClose={() => { p.setShowEndShift(false); p.setChecklistSkipReason(null); p.refetchShiftState(); }}
                branch={p.selectedBranch || undefined}
                checklistSkipReason={p.checklistSkipReason || undefined}
            />
            <OpenShiftModal
                isOpen={p.showOpenShift}
                onClose={() => p.setShowOpenShift(false)}
                onOpened={p.refetchShiftState}
                branch={p.selectedBranch || undefined}
            />

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
                                <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 6 }}>
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
                            <label style={{ display: 'block', fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 }}>
                                Счёт
                            </label>
                            <select
                                value={p.corrAccount}
                                onChange={e => p.setCorrAccount(e.target.value)}
                                style={{ ...hairlineInput, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}
                            >
                                <option value="cash">Наличные</option>
                                <option value="card_tbc">Карта TBC</option>
                                <option value="card_bog">Карта BOG</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: 20 }}>
                            <label style={{ display: 'block', fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 }}>
                                Филиал
                            </label>
                            <select
                                value={p.corrBranch}
                                onChange={e => p.setCorrBranch(e.target.value)}
                                style={{ ...hairlineInput, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}
                            >
                                <option value="">Общая касса (все филиалы)</option>
                                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>

                        <div style={{ marginBottom: 20 }}>
                            <label style={{ display: 'block', fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 }}>
                                Фактический остаток · ₾
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
                            <label style={{ display: 'block', fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 8 }}>
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
