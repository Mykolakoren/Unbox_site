import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, TrendingUp, TrendingDown, Wallet, Check, Lock, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { MobileCloseShiftSheet } from './MobileCloseShiftSheet';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, addWeeks, addMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import { cashboxApi, type CashboxPeriodSummary } from '../../../api/cashbox';
import { Navigate } from 'react-router-dom';
import { useUserStore } from '../../../store/userStore';
import { userCanAccessFinance } from '../../../utils/permissions';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { Sheet } from '../../../components/ui/Sheet';
import { undoToast } from '../../../components/ui/undoToast';
import { claimCashUndo, releaseCashUndo } from '../../../components/admin/cashbox/cashMoney';
import { toastApiError } from '../../../utils/errors';
import { Button } from '../../../components/ui/Button';
import { Chip, Segmented } from '../../../components/ui/Chip';
import { Field, Input, Select } from '../../../components/ui/Field';
import { Money } from '../../../components/ui/Money';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { formatDayMonth, formatGel, formatMonthLabel, formatTime } from '../../../utils/format';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from './parseMoneyInput';
import { DaySummary } from '../../../components/admin/cashbox/DaySummary';
import { WeeklyRebates } from '../../../components/admin/cashbox/WeeklyRebates';

const BRANCHES = ['all', 'Unbox Uni', 'Unbox One', 'Neo School'] as const;
type Branch = typeof BRANCHES[number];
type Period = 'day' | 'week' | 'month';
/** Раздел кассы на телефоне: операции, «Итоги дня», «Недельные скидки» (02.10). */
type View = 'cash' | 'day' | 'rebates';

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
 * Mobile admin «Касса» — compact one-pager.
 *
 * Волна 4 (G9-10, решения В4/В5): порядок экрана —
 *   1. «Сейчас в кассе» — остатки выбранного филиала. От периода НЕ зависят,
 *      поэтому стоят выше переключателя периода (раньше «9065 ₾ наличными»
 *      под подписью «Сегодня» читали как «пришло сегодня»);
 *   2. период «‹ 29 сентября ›» + «Сегодня» (возврат к текущему);
 *   3. «+ доход / − расход / = разница» с подписью периода — сервер,
 *      /cashbox/summary (getPeriodSummary, по всем операциям);
 *   4. «Закрыть смену» — всегда видна; при «Все» сначала спросим филиал;
 *   5. операции периода (последние 100), «+» — новая операция.
 * Филиал по умолчанию в новой операции — выбранный фильтр кассы, иначе не
 * предвыбран (раньше было 'Unbox One' даже при «Все», а в пополнении — Uni).
 * После записи своей операции — тост «Вернуть» на 5 с (В5): сервер даёт
 * админу удалить сегодняшнюю операцию (DELETE /cashbox/transactions/{id};
 * старое — только senior/owner).
 */
/**
 * Волна 4 (доработка): вкладка «Касса» спрятана без права на кассу
 * (userCanAccessFinance, как пункт «Финансы» на компьютере) — и по прямой
 * ссылке /m/admin/finance без права уводим в «Сегодня».
 */
export function MobileAdminFinance() {
    const currentUser = useUserStore(s => s.currentUser);
    if (!currentUser) return null;
    if (!userCanAccessFinance(currentUser)) return <Navigate to="/m/admin/dashboard" replace />;
    return <MobileAdminFinanceScreen />;
}

function MobileAdminFinanceScreen() {
    const {
        balances, fetchBalance,
        transactions, fetchTransactions, isLoading,
        categories, fetchCategories,
        updateTransaction, deleteTransaction,
    } = useCashboxStore();
    const currentUser = useUserStore(s => s.currentUser);

    const [branch, setBranch] = useState<Branch>('all');
    const [view, setView] = useState<View>('cash');
    const [period, setPeriod] = useState<Period>('day');
    const [offset, setOffset] = useState(0);
    // Редактирование транзакции — ТОЛЬКО владелец (owner 2026-06-28).
    const [editingTx, setEditingTx] = useState<import('../../../api/cashbox').CashboxTransaction | null>(null);
    const canEditTx = (_t: { date: string }) => currentUser?.role === 'owner';
    const [showAdd, setShowAdd] = useState(false);
    const [closeShiftOpen, setCloseShiftOpen] = useState(false);
    // «Закрыть смену» при «Все» — сначала выбрать филиал (каждый филиал — своя смена).
    const [pickShiftBranch, setPickShiftBranch] = useState(false);

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
    const periodCaption = period === 'day'
        ? (offset === 0 ? 'за сегодня' : offset === -1 ? 'за вчера' : `за ${range.label}`)
        : period === 'week'
            ? (offset === 0 ? 'за эту неделю' : offset === -1 ? 'за прошлую неделю' : `за ${range.label}`)
            : `за ${range.label.toLowerCase()}`;

    /** Своя операция: запись + тост «Вернуть» 5 с (В5). Поля — как раньше. */
    const createWithUndo = async (payload: AddPayload) => {
        let created: { id: string } | null = null;
        try {
            created = await cashboxApi.createTransaction(payload);
        } catch (e) {
            toastApiError(e, 'Не удалось записать операцию');
            throw e;
        }
        setShowAdd(false);
        await reloadAll();
        const id = created?.id;
        const what = `${payload.type === 'income' ? 'Доход' : 'Расход'} ${formatGel(payload.amount)} записан`;
        if (!id) { toast.success(what); return; }
        undoToast(what, async () => {
            // Двойной тап по «Вернуть» — второй вызов ничего не делает (флаг по id).
            if (!claimCashUndo(id)) return;
            try {
                await cashboxApi.deleteTransaction(id);
                toast.success('Операция удалена');
            } catch (e) {
                releaseCashUndo(id);
                toastApiError(e, 'Не получилось вернуть — попросите старшего админа удалить операцию');
            } finally {
                await reloadAll();
            }
        });
    };

    return (
        <div style={{ padding: '14px 16px 96px' }}>
            <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: '2px 0 12px', color: 'var(--color-ink)' }}>
                Касса
            </h1>

            {/* Раздел: операции / итоги дня / недельные скидки (решение владельца 02.10). */}
            <Segmented<View>
                aria-label="Раздел кассы"
                options={[
                    { value: 'cash', label: 'Операции' },
                    { value: 'day', label: 'Итоги дня' },
                    { value: 'rebates', label: 'Скидки' },
                ]}
                value={view}
                onChange={setView}
                className="mb-3"
            />

            {/* Филиал — один фильтр на весь экран (недельные скидки — по всем филиалам). */}
            {view !== 'rebates' && (
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
            )}

            {view === 'day' && (
                <DaySummary branch={branchParam} compact clientPath={k => `/m/admin/users/${encodeURIComponent(k)}`} />
            )}
            {view === 'rebates' && (
                <WeeklyRebates compact clientPath={k => `/m/admin/users/${encodeURIComponent(k)}`} />
            )}

            {view === 'cash' && (<>
            {/* 1. Сейчас в кассе — не зависит от периода. */}
            <section aria-label="Сейчас в кассе" style={{ marginBottom: 16 }}>
                <SectionTitle>Сейчас в кассе · {branch === 'all' ? 'все филиалы' : branch}</SectionTitle>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                }}>
                    {/* axios-интерсептор клиента конвертит snake_case → camelCase
                        автоматически (см. api/client.ts). Поэтому реально
                        прилетает cardTbc/cardBog, а не card_tbc/card_bog. */}
                    <BalanceTile label="Наличные" value={balances.cash} />
                    <BalanceTile label="TBC" value={(balances as any).cardTbc ?? balances.card_tbc ?? 0} />
                    <BalanceTile label="BOG" value={(balances as any).cardBog ?? balances.card_bog ?? 0} />
                </div>
            </section>

            {/* 2. Период. */}
            <section aria-label="Итоги периода" style={{ marginBottom: 14 }}>
                <SectionTitle>Итоги периода</SectionTitle>
                <Segmented<Period>
                    aria-label="Период"
                    options={(['day', 'week', 'month'] as Period[]).map(p => ({ value: p, label: PERIOD_LABEL[p] }))}
                    value={period}
                    onChange={p => { setPeriod(p); setOffset(0); }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '8px 0' }}>
                    <Button
                        variant="quiet"
                        size="touch"
                        icon={<ChevronLeft size={20} aria-hidden="true" />}
                        aria-label="Предыдущий период"
                        onClick={() => setOffset(o => o - 1)}
                    />
                    <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 600, color: 'var(--color-ink)' }} aria-live="polite">
                        {range.label}
                    </div>
                    <Button
                        variant="quiet"
                        size="touch"
                        icon={<ChevronRight size={20} aria-hidden="true" />}
                        aria-label="Следующий период"
                        disabled={offset >= 0}
                        onClick={() => setOffset(o => o + 1)}
                    />
                    {offset !== 0 && (
                        <Button variant="secondary" size="touch" onClick={() => setOffset(0)}>
                            {period === 'day' ? 'Сегодня' : period === 'week' ? 'Эта неделя' : 'Этот месяц'}
                        </Button>
                    )}
                </div>

                {/* 3. + доход / − расход / = разница. */}
                <div style={{
                    background: 'var(--color-sunken)',
                    color: 'var(--color-ink)',
                    borderRadius: 12,
                    padding: '12px 14px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                }}>
                    <TotalCell icon={<TrendingUp size={14} aria-hidden="true" />} label="+ доход" value={totals?.income} positive />
                    <TotalCell icon={<TrendingDown size={14} aria-hidden="true" />} label="− расход" value={totals?.expense} />
                    <TotalCell icon={<Wallet size={14} aria-hidden="true" />} label="= разница" value={totals?.net} positive={!totals || totals.net >= 0} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 6, lineHeight: 1.4 }}>
                    {periodCaption}{branch === 'all' ? ', все филиалы' : `, ${branch}`}
                    {summary && summary.adjustmentCount > 0 && (
                        <>
                            {' '}· корректировки (не деньги):
                            {summary.adjustmentIncome > 0 && ` ${formatGel(summary.adjustmentIncome, { sign: true })}`}
                            {summary.adjustmentExpense > 0 && ` ${formatGel(-summary.adjustmentExpense)}`}
                            {' '}— в итоги не входят
                        </>
                    )}
                </div>
                {!summary && summaryFailed && listTruncated && (
                    <div style={{ fontSize: 12, color: 'var(--status-pending-fg)', marginTop: 4, lineHeight: 1.4 }}>
                        Итоги посчитаны по последним {TX_LIMIT} операциям — могут быть неполными.
                    </div>
                )}
            </section>

            {/* 4. Закрыть смену — всегда видна (G9-10). При «Все» — сначала филиал. */}
            <Button
                variant="secondary"
                block
                icon={<Lock size={16} aria-hidden="true" />}
                onClick={() => {
                    if (branch === 'all') setPickShiftBranch(true);
                    else setCloseShiftOpen(true);
                }}
                style={{ marginBottom: 16 }}
            >
                {branch === 'all' ? 'Закрыть смену' : `Закрыть смену · ${branch}`}
            </Button>

            {/* 5. Операции. */}
            <SectionTitle>
                Операции · {listTruncated ? `последние ${scopedTransactions.length}` : scopedTransactions.length}
            </SectionTitle>
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
            </>)}

            {/* FAB */}
            <button
                onClick={() => setShowAdd(true)}
                style={{
                    position: 'fixed',
                    bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
                    right: 'max(16px, calc((100vw - 480px) / 2 + 16px))',
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
                            await createWithUndo(payload);
                        } catch {
                            /* тост уже показан */
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

            <Sheet
                open={pickShiftBranch}
                onClose={() => setPickShiftBranch(false)}
                title="Какой филиал закрываем?"
                description="У каждого филиала своя смена и своя касса."
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {BRANCHES.filter(b => b !== 'all').map(b => (
                        <Button
                            key={b}
                            variant="secondary"
                            block
                            onClick={() => {
                                setPickShiftBranch(false);
                                setBranch(b);
                                setCloseShiftOpen(true);
                            }}
                        >
                            {b}
                        </Button>
                    ))}
                </div>
            </Sheet>

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

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ink-60)', marginBottom: 8 }}>
            {children}
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

/** «Uni» / «One» / «Neo School» — коротко для кнопки. */
const shortBranch = (b: string) => b.replace(/^Unbox\s+/, '');

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
    // Одно умолчание филиала (G9-12): выбранный фильтр кассы, иначе не
    // предвыбран — раньше подставлялся 'Unbox One' даже при «Все».
    const [branch, setBranch] = useState<string>(initial?.branch || initialBranch || '');
    const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const isEdit = !!initial;
    const { confirm } = useConfirmDialog();
    // Сумма — общий разбор («1 280,50» → 1280.5; «12abc» — ошибка под полем).
    const parsedAmount = parseMoneyInput(amount);
    const amountError = !isMoneyInputBlank(amount) && parsedAmount === null ? MONEY_INPUT_ERROR : undefined;
    const needBranch = !isEdit && !branch;

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
        if (needBranch) {
            toast.error('Выберите филиал — иначе операция не попадёт в остаток кассы');
            return;
        }
        setSaving(true);
        try {
            await onSubmit({
                type,
                amount: n,
                payment_method: method,
                branch: branch || undefined,
                category_id: categoryId || undefined,
                description: description.trim() || undefined,
            });
        } finally {
            // Сбой запроса не должен оставлять кнопку в вечном «сохраняем».
            setSaving(false);
        }
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
    // Сводка на главной кнопке (В5): «Записать расход 50 ₾ · Наличные · Uni».
    const ctaLabel = isEdit
        ? 'Сохранить'
        : [
            `Записать ${type === 'income' ? 'доход' : 'расход'}${parsedAmount ? ` ${formatGel(parsedAmount)}` : ''}`,
            METHOD_LABEL[method] || method,
            branch ? shortBranch(branch) : '',
        ].filter(Boolean).join(' · ');

    return (
        <Sheet
            open
            onClose={onClose}
            title={title}
            footer={
                <>
                    <Button
                        block
                        loading={saving}
                        disabled={!parsedAmount || needBranch}
                        icon={<Check size={16} aria-hidden="true" />}
                        onClick={handleSave}
                    >
                        {ctaLabel}
                    </Button>
                    {needBranch && !!parsedAmount && (
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', textAlign: 'center' }}>
                            Выберите филиал
                        </div>
                    )}

                    {/* Удаление — только в режиме редактирования */}
                    {isEdit && onDelete && (
                        <Button
                            variant="quiet"
                            block
                            loading={deleting}
                            disabled={saving}
                            icon={<Trash2 size={16} aria-hidden="true" />}
                            onClick={handleDelete}
                            style={{ color: 'var(--status-danger-fg)' }}
                        >
                            Удалить операцию
                        </Button>
                    )}
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                        {!branch && <option value="">Выберите филиал</option>}
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
        </Sheet>
    );
}
