import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, TrendingUp, TrendingDown, Wallet, X, Check, Lock, Trash2, ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react';
import { MobileCloseShiftSheet } from './MobileCloseShiftSheet';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, addWeeks, addMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import { cashboxApi, type CashboxPeriodSummary } from '../../../api/cashbox';
import { useUserStore } from '../../../store/userStore';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { Z_SHEET, SHEET_FOOTER, SHEET_MAX_HEIGHT } from './sheetLayers';
import { Button } from '../../../components/ui/Button';
import { Chip, Segmented } from '../../../components/ui/Chip';
import { Field, Input, Select } from '../../../components/ui/Field';
import { Money } from '../../../components/ui/Money';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { formatDayMonth, formatGel, formatMonthLabel, formatTime } from '../../../utils/format';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from './parseMoneyInput';

const BRANCHES = ['all', 'Unbox Uni', 'Unbox One', 'Neo School'] as const;
type Branch = typeof BRANCHES[number];
type Period = 'day' | 'week' | 'month';

const PERIOD_LABEL: Record<Period, string> = {
    day: 'Сегодня',
    week: 'Неделя',
    month: 'Месяц',
};

const METHOD_LABEL: Record<string, string> = {
    cash: 'Наличные',
    card_tbc: 'TBC',
    card_bog: 'BOG',
    // Недельная скидка, ручная правка баланса клиента: запись для истории,
    // из кассы ничего не приходит и не уходит.
    adjustment: 'Корректировка (не деньги)',
};

/** Лента — последние N операций периода. Итоги считает сервер по всем. */
const TX_LIMIT = 100;

function getRange(period: Period, offset: number): { from: Date; to: Date; label: string } {
    const now = new Date();
    if (period === 'day') {
        const base = addDays(now, offset);
        return {
            from: startOfDay(base),
            to: endOfDay(base),
            label: offset === 0 ? 'Сегодня' : offset === -1 ? 'Вчера' : formatDayMonth(base, { timeZone: BATUMI_TZ }),
        };
    }
    if (period === 'week') {
        const s = startOfWeek(addWeeks(now, offset), { locale: ru });
        const e = endOfWeek(addWeeks(now, offset), { locale: ru });
        return {
            from: s, to: e,
            label: offset === 0 ? 'Эта неделя' : offset === -1 ? 'Прошлая неделя' : `${formatDayMonth(s, { timeZone: BATUMI_TZ })} – ${formatDayMonth(e, { timeZone: BATUMI_TZ })}`,
        };
    }
    const s = startOfMonth(addMonths(now, offset));
    const e = endOfMonth(addMonths(now, offset));
    return {
        from: s, to: e,
        label: formatMonthLabel(s, { capitalize: true, timeZone: BATUMI_TZ }),
    };
}

/**
 * Mobile admin Финансы — compact one-pager.
 *
 * Sections (top to bottom):
 *   1. Branch chip + period selector
 *   2. Balance cards by method (cash / TBC / BOG) — branch-scoped
 *   3. Period totals (доход / расход / разница) — сервер, /cashbox/summary
 *   4. Recent transactions list (last 100 in range)
 *   5. FAB → quick add transaction sheet
 *
 * No charts, no shifts, no categories management — those stay on desktop.
 * Goal is "глянул баланс, добавил расход на 5₾, ушёл" in under 30 seconds.
 *
 * Wave 1: общие Chip/Segmented/Button/Field/Money, суммы — formatGel (было
 * toFixed(0): 94,5 ₾ показывались как 95), стрелки периода 44 px, удаление
 * операции — через окно подтверждения, а не confirm().
 */
export function MobileAdminFinance() {
    const {
        balances, fetchBalance,
        transactions, fetchTransactions, isLoading,
        categories, fetchCategories,
        createTransaction, updateTransaction, deleteTransaction,
    } = useCashboxStore();
    const currentUser = useUserStore(s => s.currentUser);

    const [branch, setBranch] = useState<Branch>('all');
    const [period, setPeriod] = useState<Period>('day');
    const [offset, setOffset] = useState(0);
    // Редактирование транзакции — ТОЛЬКО владелец (owner 2026-06-28).
    const [editingTx, setEditingTx] = useState<import('../../../api/cashbox').CashboxTransaction | null>(null);
    const canEditTx = (_t: { date: string }) => currentUser?.role === 'owner';
    const [showAdd, setShowAdd] = useState(false);
    const [closeShiftOpen, setCloseShiftOpen] = useState(false);

    const range = useMemo(() => getRange(period, offset), [period, offset]);
    const branchParam = branch === 'all' ? undefined : branch;

    // Итоги за период — с сервера, по ВСЕМ операциям. Раньше считались
    // здесь по последним 100 строкам ленты (неделя/месяц молча занижались),
    // а недельные скидки и правки балансов шли как настоящие деньги.
    const [summary, setSummary] = useState<CashboxPeriodSummary | null>(null);
    const [summaryFailed, setSummaryFailed] = useState(false);
    const summarySeq = useRef(0);
    const loadSummary = useCallback(async () => {
        // Быстро листают период — поздний ответ старого запроса не должен
        // перезаписать итоги нового.
        const seq = ++summarySeq.current;
        setSummary(null);
        try {
            const s = await cashboxApi.getPeriodSummary({
                dateFrom: range.from.toISOString(),
                dateTo: range.to.toISOString(),
                branch: branchParam,
            });
            if (seq !== summarySeq.current) return;
            setSummary(s);
            setSummaryFailed(false);
        } catch {
            if (seq !== summarySeq.current) return;
            setSummaryFailed(true);
        }
    }, [range, branchParam]);

    const loadTransactions = useCallback(() => fetchTransactions({
        dateFrom: range.from.toISOString(),
        dateTo: range.to.toISOString(),
        branch: branchParam,
        limit: TX_LIMIT,
    }), [range, branchParam, fetchTransactions]);

    /** После записи/правки/закрытия смены — остатки, лента и итоги разом. */
    const reloadAll = () => Promise.all([
        fetchBalance(branchParam),
        loadTransactions(),
        loadSummary(),
    ]);

    useEffect(() => {
        fetchBalance(branchParam);
    }, [branchParam, fetchBalance]);

    useEffect(() => {
        loadTransactions();
    }, [loadTransactions]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    useEffect(() => {
        if (categories.length === 0) fetchCategories().catch(() => {});
    }, [categories.length, fetchCategories]);

    // Филиал фильтрует сервер (?branch=). Фильтр здесь — страховка на
    // случай старого бэкенда, который параметр ещё не знает.
    const scopedTransactions = useMemo(() => {
        if (branch === 'all') return transactions;
        return transactions.filter(t => (t.branch || '') === branch);
    }, [transactions, branch]);
    const listTruncated = transactions.length >= TX_LIMIT;

    // Запасной счёт по ленте — только если сервер сводку не отдал (бэкенд
    // ещё без /cashbox/summary). Корректировки и тут не деньги.
    const fallbackTotals = useMemo(() => {
        let income = 0, expense = 0;
        for (const t of scopedTransactions) {
            if (t.paymentMethod === 'adjustment') continue;
            if (t.type === 'income') income += t.amount;
            else expense += t.amount;
        }
        return { income, expense, net: income - expense };
    }, [scopedTransactions]);

    const totals = summary ?? (summaryFailed && !isLoading ? fallbackTotals : null);

    return (
        <div style={{ padding: '14px 14px 80px' }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '2px 2px 12px', color: 'var(--color-ink)' }}>
                Финансы
            </h1>

            {/* Branch chips */}
            <div role="group" aria-label="Филиал" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4 }}>
                {BRANCHES.map(b => (
                    <Chip
                        key={b}
                        selected={branch === b}
                        onClick={() => setBranch(b)}
                        style={{ flexShrink: 0 }}
                    >
                        {b === 'all' ? 'Все' : b}
                    </Chip>
                ))}
            </div>

            {/* Period segmented control + range label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                <Segmented<Period>
                    aria-label="Период"
                    className="flex-1"
                    options={(['day', 'week', 'month'] as Period[]).map(p => ({ value: p, label: PERIOD_LABEL[p] }))}
                    value={period}
                    onChange={p => { setPeriod(p); setOffset(0); }}
                />
                <Button
                    variant="quiet"
                    size="touch"
                    icon={<ChevronLeft size={20} aria-hidden="true" />}
                    aria-label="Предыдущий период"
                    onClick={() => setOffset(o => o - 1)}
                />
                <Button
                    variant="quiet"
                    size="touch"
                    icon={<CalendarCheck size={18} aria-hidden="true" />}
                    aria-label="К текущему периоду"
                    disabled={offset === 0}
                    onClick={() => setOffset(0)}
                />
                <Button
                    variant="quiet"
                    size="touch"
                    icon={<ChevronRight size={20} aria-hidden="true" />}
                    aria-label="Следующий период"
                    disabled={offset >= 0}
                    onClick={() => setOffset(o => o + 1)}
                />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', marginBottom: 12 }}>{range.label}</div>

            {/* Balance cards by method */}
            <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginBottom: 6 }}>Сейчас в кассе</div>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 6,
                marginBottom: 14,
            }}>
                {/* axios-интерсептор клиента конвертит snake_case → camelCase
                    автоматически (см. api/client.ts:59). Поэтому реально
                    прилетает cardTbc/cardBog, а не card_tbc/card_bog. Тип
                    CashboxBalances в api/cashbox.ts описан в snake_case
                    (отражает форму бэка), но рантайм-ключи camel.
                    Тот же fallback-паттерн использует десктопный
                    BalanceCard.tsx — оставляем оба варианта чтобы код
                    не сломался если/когда исправим тип. */}
                <BalanceTile label="Наличные" value={balances.cash} />
                <BalanceTile label="TBC" value={(balances as any).cardTbc ?? balances.card_tbc ?? 0} />
                <BalanceTile label="BOG" value={(balances as any).cardBog ?? balances.card_bog ?? 0} />
            </div>

            {/* Period totals strip. Wave 1: светлая полоса вместо чёрной —
                минус теперь красный токеном, а не коралловым #FF8B7A. */}
            <div style={{
                background: 'var(--color-sunken)',
                color: 'var(--color-ink)',
                borderRadius: 12,
                padding: '12px 14px',
                marginBottom: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
            }}>
                <TotalCell icon={<TrendingUp size={14} aria-hidden="true" />} label="Доход" value={totals?.income} positive />
                <TotalCell icon={<TrendingDown size={14} aria-hidden="true" />} label="Расход" value={totals?.expense} />
                <TotalCell icon={<Wallet size={14} aria-hidden="true" />} label="Разница" value={totals?.net} positive={!totals || totals.net >= 0} />
            </div>
            {summary && summary.adjustmentCount > 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: -8, marginBottom: 14, lineHeight: 1.4 }}>
                    Корректировки (не деньги):
                    {summary.adjustmentIncome > 0 && ` ${formatGel(summary.adjustmentIncome, { sign: true })}`}
                    {summary.adjustmentExpense > 0 && ` ${formatGel(-summary.adjustmentExpense)}`}
                    {' '}· в итоги не входят
                </div>
            )}
            {!summary && summaryFailed && listTruncated && (
                <div style={{ fontSize: 12, color: 'var(--status-pending-fg)', marginTop: -8, marginBottom: 14, lineHeight: 1.4 }}>
                    Итоги посчитаны по последним {TX_LIMIT} операциям — могут быть неполными.
                </div>
            )}

            {/* Close shift — только когда выбрана конкретная локация
                (нельзя закрыть «все» сразу — каждая локация = своя смена). */}
            {branch !== 'all' && (
                <Button
                    variant="secondary"
                    block
                    icon={<Lock size={16} aria-hidden="true" />}
                    onClick={() => setCloseShiftOpen(true)}
                    style={{ marginBottom: 14 }}
                >
                    Закрыть смену · {branch}
                </Button>
            )}

            {/* Transactions */}
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ink-60)', marginBottom: 8 }}>
                Операции · {listTruncated ? `последние ${scopedTransactions.length}` : scopedTransactions.length}
            </div>
            {isLoading ? (
                <SkeletonList count={4} label="Загружаем операции" cardHeight={56} />
            ) : scopedTransactions.length === 0 ? (
                <EmptyState compact title="В этом периоде операций нет" hint="Новую операцию можно добавить кнопкой «+»." />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {scopedTransactions.slice(0, TX_LIMIT).map(t => (
                        <TransactionRow
                            key={t.id}
                            tx={t}
                            onTap={canEditTx(t) ? () => setEditingTx(t) : undefined}
                        />
                    ))}
                </div>
            )}

            {/* FAB */}
            <button
                onClick={() => setShowAdd(true)}
                style={{
                    position: 'fixed',
                    bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
                    right: 'max(14px, calc((100vw - 480px) / 2 + 14px))',
                    width: 56, height: 56,
                    borderRadius: 28,
                    background: 'var(--color-ink)',
                    color: 'var(--color-on-ink)',
                    border: 'none',
                    display: 'grid', placeItems: 'center',
                    boxShadow: 'var(--shadow-pop)',
                    cursor: 'pointer',
                    zIndex: 50,
                }}
                aria-label="Добавить операцию"
            >
                <Plus size={22} aria-hidden="true" />
            </button>

            {showAdd && (
                <AddTransactionSheet
                    branch={branch === 'all' ? undefined : branch}
                    categories={categories}
                    onClose={() => setShowAdd(false)}
                    onSubmit={async (payload) => {
                        try {
                            await createTransaction(payload);
                            setShowAdd(false);
                            // Refresh balances + list + totals
                            await reloadAll();
                        } catch {
                            /* toast already shown by store */
                        }
                    }}
                />
            )}

            {/* Edit transaction (owner 2026-06-28) */}
            {editingTx && (
                <AddTransactionSheet
                    initial={editingTx}
                    branch={editingTx.branch}
                    categories={categories}
                    onClose={() => setEditingTx(null)}
                    onSubmit={async (payload) => {
                        try {
                            await updateTransaction(editingTx.id, payload);
                            setEditingTx(null);
                            await reloadAll();
                        } catch {
                            /* toast already shown by store */
                        }
                    }}
                    onDelete={async () => {
                        try {
                            await deleteTransaction(editingTx.id);
                            setEditingTx(null);
                            await reloadAll();
                        } catch {
                            /* toast already shown by store */
                        }
                    }}
                />
            )}

            {closeShiftOpen && branch !== 'all' && (
                <MobileCloseShiftSheet
                    branch={branch}
                    systemBalance={balances.cash}
                    onClose={() => setCloseShiftOpen(false)}
                    onClosed={async () => {
                        setCloseShiftOpen(false);
                        // После закрытия — рефреш балансов, транзакций и итогов.
                        await reloadAll();
                    }}
                />
            )}
        </div>
    );
}

function BalanceTile({ label, value }: { label: string; value: number | undefined | null }) {
    // Defensive: backend may return partial balance object on auth/permission
    // edge cases (e.g. role has read but a column-level filter). Coercing to
    // 0 here keeps the page rendering instead of crashing on `undefined.toFixed`.
    const n = typeof value === 'number' ? value : 0;
    const negative = n < 0;
    return (
        <div style={{
            background: 'var(--color-card)',
            border: '1px solid var(--color-ink-08)',
            borderRadius: 12,
            padding: '10px 10px 12px',
        }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink-60)', marginBottom: 4 }}>
                {label}
            </div>
            <div style={{
                fontSize: 18,
                fontWeight: 600,
                color: negative ? 'var(--status-danger-fg)' : 'var(--color-ink)',
            }}>
                <Money value={n} />
            </div>
        </div>
    );
}

function TotalCell({ icon, label, value, positive }: { icon: React.ReactNode; label: string; value: number | undefined | null; positive?: boolean }) {
    // Нет числа (итоги ещё грузятся) — «…», а не ложный «0 ₾».
    const loaded = typeof value === 'number';
    const n = loaded ? value : 0;
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-ink-60)', marginBottom: 3 }}>
                {icon} {label}
            </div>
            <div className="num" style={{
                fontSize: 16,
                fontWeight: 600,
                color: positive === false ? 'var(--status-danger-fg)' : 'var(--color-ink)',
            }}>
                {loaded ? formatGel(n) : '…'}
            </div>
        </div>
    );
}

function TransactionRow({ tx, onTap }: {
    tx: ReturnType<typeof useCashboxStore.getState>['transactions'][number];
    onTap?: () => void;
}) {
    const isIncome = tx.type === 'income';
    // Дата из базы — UTC; показываем по Батуми, как десктопная касса.
    const when = parseUTC(tx.date);
    const meta = [
        METHOD_LABEL[tx.paymentMethod] || tx.paymentMethod,
        tx.branch,
        `${formatDayMonth(when, { timeZone: BATUMI_TZ })}, ${formatTime(when, { timeZone: BATUMI_TZ })}`,
    ].filter(Boolean).join(' · ');
    return (
        <div
            onClick={onTap}
            role={onTap ? 'button' : undefined}
            tabIndex={onTap ? 0 : undefined}
            onKeyDown={onTap ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }) : undefined}
            className={onTap ? 'press' : undefined}
            style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: 'var(--color-card)',
            borderRadius: 10,
            border: '1px solid var(--color-ink-08)',
            cursor: onTap ? 'pointer' : 'default',
        }}>
            <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: isIncome ? 'var(--status-ok-bg)' : 'var(--status-danger-bg)',
                color: isIncome ? 'var(--status-ok-fg)' : 'var(--status-danger-fg)',
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>
                {isIncome ? <TrendingUp size={14} aria-hidden="true" /> : <TrendingDown size={14} aria-hidden="true" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tx.categoryName || tx.description || (isIncome ? 'Доход' : 'Расход')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {meta}
                </div>
            </div>
            <div className="num" style={{
                fontSize: 14,
                fontWeight: 600,
                color: isIncome ? 'var(--status-ok-fg)' : 'var(--status-danger-fg)',
                whiteSpace: 'nowrap',
            }}>
                {formatGel(isIncome ? (tx.amount ?? 0) : -(tx.amount ?? 0), { sign: true })}
            </div>
        </div>
    );
}

// ── Add Transaction Sheet ──────────────────────────────────────────────────

interface AddPayload {
    type: 'income' | 'expense';
    amount: number;
    payment_method: string;
    branch?: string;
    category_id?: string;
    description?: string;
}

function AddTransactionSheet({
    branch: initialBranch,
    categories,
    onClose,
    onSubmit,
    initial,
    onDelete,
}: {
    branch?: string;
    categories: ReturnType<typeof useCashboxStore.getState>['categories'];
    onClose: () => void;
    onSubmit: (p: AddPayload) => Promise<void>;
    /** Если задано — режим редактирования: поля пред-заполнены, кнопка
     *  «Сохранить», доступно удаление (owner 2026-06-28). */
    initial?: import('../../../api/cashbox').CashboxTransaction;
    onDelete?: () => Promise<void>;
}) {
    const [type, setType] = useState<'income' | 'expense'>(initial?.type ?? 'expense');
    const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
    const [method, setMethod] = useState(initial?.paymentMethod ?? 'cash');
    const [branch, setBranch] = useState<string>(initial?.branch || initialBranch || 'Unbox One');
    const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const isEdit = !!initial;
    const { confirm } = useConfirmDialog();
    // Сумма — общий разбор («1 280,50» → 1280.5; «12abc» — ошибка под полем).
    const parsedAmount = parseMoneyInput(amount);
    const amountError = !isMoneyInputBlank(amount) && parsedAmount === null ? MONEY_INPUT_ERROR : undefined;

    // Flatten categories for the picker, scoped to the chosen type.
    const flatCats = useMemo(() => {
        const out: { id: string; name: string }[] = [];
        const walk = (nodes: typeof categories, prefix = '') => {
            for (const n of nodes) {
                if (!n.isActive) continue;
                const t = n.categoryType || 'both';
                if (t === 'both' || t === type) {
                    out.push({ id: n.id, name: prefix + n.name });
                }
                if (n.children?.length) walk(n.children, prefix + n.name + ' / ');
            }
        };
        walk(categories);
        return out;
    }, [categories, type]);

    const handleSave = async () => {
        const n = parsedAmount;
        if (n === null || n <= 0) {
            toast.error('Введите сумму больше 0');
            return;
        }
        setSaving(true);
        await onSubmit({
            type,
            amount: n,
            payment_method: method,
            branch: branch || undefined,
            category_id: categoryId || undefined,
            description: description.trim() || undefined,
        });
        setSaving(false);
    };

    const handleDelete = async () => {
        if (!onDelete) return;
        const ok = await confirm({
            title: 'Удалить операцию?',
            body: 'Если она пополняла баланс клиента — баланс скорректируем.',
            confirmLabel: 'Удалить операцию',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        setDeleting(true);
        try { await onDelete(); } finally { setDeleting(false); }
    };

    const title = isEdit ? 'Изменить операцию' : 'Новая операция';

    return (
        <div
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(15,15,16,0.45)',
                // Было 100 — как у нижнего меню, и меню (оно в DOM позже)
                // закрывало кнопку «Сохранить».
                zIndex: Z_SHEET,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%',
                    maxWidth: 480,
                    background: 'var(--color-card)',
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    // Низ с отступом под «домашнюю полоску» несёт SHEET_FOOTER.
                    padding: '8px 16px 0',
                    boxShadow: 'var(--shadow-pop)',
                    // Форма длинная: на коротком экране прокручивается внутри,
                    // а кнопки прилипают к низу.
                    maxHeight: SHEET_MAX_HEIGHT,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h2 style={{ fontWeight: 600, fontSize: 20, margin: 0 }}>{title}</h2>
                    <button
                        onClick={onClose}
                        aria-label="Закрыть"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-60)', width: 44, height: 44, display: 'grid', placeItems: 'center' }}
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
                    {/* Type toggle */}
                    <Segmented<'income' | 'expense'>
                        aria-label="Тип операции"
                        options={[
                            { value: 'expense', label: 'Расход' },
                            { value: 'income', label: 'Доход' },
                        ]}
                        value={type}
                        onChange={t => { setType(t); setCategoryId(''); }}
                    />

                    <Field label="Сумма" error={amountError}>
                        <Input
                            kind="money"
                            suffix="₾"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            autoFocus
                            placeholder="0"
                        />
                    </Field>

                    <div>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Способ оплаты</div>
                        <Segmented
                            aria-label="Способ оплаты"
                            options={['cash', 'card_tbc', 'card_bog'].map(m => ({ value: m, label: METHOD_LABEL[m] }))}
                            value={method}
                            onChange={setMethod}
                        />
                    </div>

                    <Field label="Филиал">
                        <Select value={branch} onChange={e => setBranch(e.target.value)}>
                            {['Unbox One', 'Unbox Uni', 'Neo School'].map(b => (
                                <option key={b} value={b}>{b}</option>
                            ))}
                        </Select>
                    </Field>

                    <Field label="Категория">
                        <Select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                            <option value="">Без категории</option>
                            {flatCats.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </Select>
                    </Field>

                    <Field label="Комментарий" optional>
                        <Input
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />
                    </Field>
                </div>

                <div style={SHEET_FOOTER}>
                    <Button
                        block
                        loading={saving}
                        disabled={!parsedAmount}
                        icon={<Check size={16} aria-hidden="true" />}
                        onClick={handleSave}
                    >
                        Сохранить
                    </Button>

                    {/* Удаление — только в режиме редактирования */}
                    {isEdit && onDelete && (
                        <Button
                            variant="quiet"
                            block
                            loading={deleting}
                            disabled={saving}
                            icon={<Trash2 size={16} aria-hidden="true" />}
                            onClick={handleDelete}
                            style={{ marginTop: 8, color: 'var(--status-danger-fg)' }}
                        >
                            Удалить операцию
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
