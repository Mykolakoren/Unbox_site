import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, TrendingUp, TrendingDown, Wallet, Check, Lock, Trash2, ChevronLeft, ChevronRight, EyeOff, UserRound } from 'lucide-react';
import { MobileCloseShiftSheet } from './MobileCloseShiftSheet';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, addWeeks, addMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import { cashboxApi, type CashboxPeriodSummary } from '../../../api/cashbox';
import { Navigate } from 'react-router-dom';
import { useUserStore } from '../../../store/userStore';
import { userCanAccessFinance, hasPermission } from '../../../utils/permissions';
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
import type { User } from '../../../store/types';
import { branchLabel, humanizeMoneyText } from './branchLabel';
import { ClientPickSheet } from './ClientPickSheet';
import { TopupSheet } from './TopupSheet';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { SummaryCard } from '../../../components/ui/SummaryCard';
import { ListGroup, ListRow, ListIcon } from '../../../components/ui/ListRow';
import { PageTabs } from '../../../components/ui/PageTabs';

const BRANCHES = ['all', 'Unbox Uni', 'Unbox One', 'Neo School'] as const;
type Branch = typeof BRANCHES[number];
type Period = 'day' | 'week' | 'month';
/** Раздел кассы на телефоне: операции, «Итоги дня», «Недельные скидки» (02.10). */
type View = 'cash' | 'day' | 'rebates';

const PERIOD_LABEL: Record<Period, string> = {
    // «День», а не «Сегодня»: рядом подпись периода «Сегодня» — слово шло дважды подряд.
    day: 'День',
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
    // Чек-лист смены на телефоне — карточкой «Утро: 2 из 6» на «Сегодня»
    // (MorningChecklistCard), а не окном поверх «Кассы» (ревью 09.11, №17):
    // клиент у стойки не должен ждать, пока админ закроет окно.
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
    // «Итоги дня» и «Скидки» — отчёты по всем клиентам: только с правом отчётов.
    const canReports = hasPermission(currentUser, 'finance.view_reports');
    // Ключ перезагрузки «Итогов дня»: после своей операции цифры должны обновиться.
    const [dayReload, setDayReload] = useState(0);
    const [period, setPeriod] = useState<Period>('day');
    const [offset, setOffset] = useState(0);
    // Редактирование транзакции — ТОЛЬКО владелец (owner 2026-06-28).
    const [editingTx, setEditingTx] = useState<import('../../../api/cashbox').CashboxTransaction | null>(null);
    const canEditTx = (_t: { date: string }) => currentUser?.role === 'owner';
    const [showAdd, setShowAdd] = useState(false);
    const [closeShiftOpen, setCloseShiftOpen] = useState(false);
    // Операция не-владельца — только просмотр (ревью 09.11, №22).
    const [viewingTx, setViewingTx] = useState<import('../../../api/cashbox').CashboxTransaction | null>(null);
    // «Деньги от клиента?» → поиск клиента → «Пополнить баланс» (ревью 09.11, №13).
    const [pickClient, setPickClient] = useState(false);
    const [topupUser, setTopupUser] = useState<User | null>(null);
    // Решение владельца 3 (09.11): сумму наличных до закрытия смены роль admin не
    // видит — сначала пересчитывает сама («слепое» закрытие). Старший и владелец видят.
    const hideCash = currentUser?.role === 'admin' || !!balances.cashHidden || balances.cash === null;
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
    const reloadAll = () => {
        setDayReload(n => n + 1);
        return Promise.all([
            fetchBalance(branchParam),
            loadTransactions(),
            loadSummary(),
        ]);
    };

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

    // 09.11 фаза 3 (admin-design №7, №8): «+ Операция» — главная кнопка в шапке
    // (круглый плавающий «+» закрывал колонку сумм); «Сейчас в кассе» сразу под
    // разделами, «Закрыть смену» — тихой кнопкой в той же карточке; период и
    // итоги — одной карточкой. Меньше рядов переключателей до первой операции.
    return (
        <div style={{ paddingTop: 8, paddingBottom: 96 }}>
            <MobilePageHeader
                variant="large"
                className="pb-0"
                title="Касса"
                action={
                    <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setShowAdd(true)} aria-label="Добавить операцию">
                        Операция
                    </Button>
                }
            />
            <div style={{ padding: '16px 16px 0' }}>

            {/* Раздел: операции / итоги дня / недельные скидки (решение владельца 02.10).
                Вкладки страницы — подчёркиванием, а не вторым таким же сегментом, как
                период ниже: раздел экрана и фильтр выглядят по-разному. */}
            {canReports && (
                <PageTabs<View>
                    aria-label="Раздел кассы"
                    options={[
                        { value: 'cash', label: 'Операции' },
                        { value: 'day', label: 'Итоги дня' },
                        { value: 'rebates', label: 'Скидки' },
                    ]}
                    value={view}
                    onChange={setView}
                />
            )}

            {/* Филиал — один фильтр на весь экран (недельные скидки — по всем филиалам). */}
            {view !== 'rebates' && (
            <div role="group" aria-label="Филиал" className="ui-chip-row ui-chip-row--scroll" style={{ marginBottom: 12, paddingBottom: 4 }}>
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

            {view === 'day' && canReports && (
                <DaySummary branch={branchParam} compact reloadKey={dayReload} clientPath={k => `/m/admin/users/${encodeURIComponent(k)}`} />
            )}
            {view === 'rebates' && canReports && (
                <WeeklyRebates compact clientPath={k => `/m/admin/users/${encodeURIComponent(k)}`} />
            )}

            {(view === 'cash' || !canReports) && (<>
            {/* 1. Сейчас в кассе — не зависит от периода. 4. «Закрыть смену» —
                всегда видна (G9-10), тихой кнопкой здесь же; при «Все» — сначала филиал. */}
            <section aria-label="Сейчас в кассе" style={{ marginBottom: 16 }}>
                <SummaryCard
                    label={`Сейчас в кассе · ${branch === 'all' ? 'все филиалы' : shortBranch(branch)}`}
                    aside={
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<Lock size={14} aria-hidden="true" />}
                            onClick={() => {
                                if (branch === 'all') setPickShiftBranch(true);
                                else setCloseShiftOpen(true);
                            }}
                            aria-label={branch === 'all' ? 'Закрыть смену' : `Закрыть смену · ${branch}`}
                        >
                            Закрыть смену
                        </Button>
                    }
                >
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: 8,
                    }}>
                        {/* axios-интерсептор клиента конвертит snake_case → camelCase
                            автоматически (см. api/client.ts). Поэтому реально
                            прилетает cardTbc/cardBog, а не card_tbc/card_bog. */}
                        {hideCash
                            ? <HiddenCashTile />
                            : <BalanceTile label="Наличные" value={balances.cash} />}
                        <BalanceTile label="TBC" value={(balances as any).cardTbc ?? balances.card_tbc ?? 0} />
                        <BalanceTile label="BOG" value={(balances as any).cardBog ?? balances.card_bog ?? 0} />
                    </div>
                </SummaryCard>
            </section>

            {/* 2–3. Период и «доход / расход / разница» — одной карточкой. */}
            <section aria-label="Итоги периода" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Segmented<Period>
                    aria-label="Период"
                    options={(['day', 'week', 'month'] as Period[]).map(p => ({ value: p, label: PERIOD_LABEL[p] }))}
                    value={period}
                    onChange={p => { setPeriod(p); setOffset(0); }}
                />
                <SummaryCard>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '-8px -8px 0' }}>
                        <Button
                            variant="quiet"
                            size="touch"
                            icon={<ChevronLeft size={20} aria-hidden="true" />}
                            aria-label="Предыдущий период"
                            onClick={() => setOffset(o => o - 1)}
                        />
                        <div style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 16, fontWeight: 600, color: 'var(--color-ink)' }} aria-live="polite">
                            {range.label}
                            {offset !== 0 && (
                                <button
                                    type="button"
                                    onClick={() => setOffset(0)}
                                    style={{
                                        display: 'block', margin: '0 auto', background: 'none', border: 'none', padding: '2px 4px',
                                        fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--color-accent-ink)', cursor: 'pointer',
                                    }}
                                >
                                    {period === 'day' ? 'К сегодня' : period === 'week' ? 'К этой неделе' : 'К этому месяцу'}
                                </button>
                            )}
                        </div>
                        <Button
                            variant="quiet"
                            size="touch"
                            icon={<ChevronRight size={20} aria-hidden="true" />}
                            aria-label="Следующий период"
                            disabled={offset >= 0}
                            onClick={() => setOffset(o => o + 1)}
                        />
                    </div>

                    {/* + доход / − расход / = разница: знак в числе, цвет — Money tone="flow"
                        (приход зелёный, расход чернилами, ноль серый; красный — только у долга). */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                        <TotalCell icon={<TrendingUp size={14} aria-hidden="true" />} label="Доход" value={totals?.income} />
                        <TotalCell icon={<TrendingDown size={14} aria-hidden="true" />} label="Расход" value={totals ? -totals.expense : undefined} />
                        <TotalCell icon={<Wallet size={14} aria-hidden="true" />} label="Разница" value={totals?.net} />
                    </div>
                    <div className="num-inline" style={{ fontSize: 14, color: 'var(--color-ink-60)', lineHeight: 1.45 }}>
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
                        <div style={{ fontSize: 14, color: 'var(--status-pending-fg)', lineHeight: 1.45 }}>
                            Итоги посчитаны по последним {TX_LIMIT} операциям — могут быть неполными.
                        </div>
                    )}
                </SummaryCard>
            </section>

            {/* 5. Операции. */}
            {isLoading ? (
                <SkeletonList count={4} label="Загружаем операции" cardHeight={56} />
            ) : scopedTransactions.length === 0 ? (
                <EmptyState compact title="В этом периоде операций нет" hint="Новую операцию можно добавить кнопкой «Операция» вверху." />
            ) : (
                <ListGroup
                    title="Операции"
                    aside={<span className="num">{listTruncated ? `последние ${scopedTransactions.length}` : scopedTransactions.length}</span>}
                >
                    {scopedTransactions.slice(0, TX_LIMIT).map(t => (
                        <TransactionRow
                            key={t.id}
                            tx={t}
                            onTap={canEditTx(t) ? () => setEditingTx(t) : () => setViewingTx(t)}
                        />
                    ))}
                </ListGroup>
            )}
            </>)}
            </div>

            {showAdd && (
                <AddTransactionSheet
                    branch={branch === 'all' ? undefined : branch}
                    categories={categories}
                    onClose={() => setShowAdd(false)}
                    onClientPayment={() => { setShowAdd(false); setPickClient(true); }}
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

            {viewingTx && <TransactionViewSheet tx={viewingTx} onClose={() => setViewingTx(null)} />}

            {pickClient && (
                <ClientPickSheet
                    onClose={() => setPickClient(false)}
                    onPick={u => { setPickClient(false); setTopupUser(u); }}
                />
            )}
            {topupUser && (
                <TopupSheet
                    user={topupUser}
                    defaultBranch={branch === 'all' ? undefined : branch}
                    onClose={() => setTopupUser(null)}
                    onDone={async () => { setTopupUser(null); await reloadAll(); }}
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
                    systemBalance={balances.cash ?? 0}
                    blind={hideCash}
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

/** Ячейка «Сейчас в кассе» — как ячейки SummaryCard (sunken, радиус 8); минус — красным (Money tone="balance"). */
function BalanceTile({ label, value }: { label: string; value: number | undefined | null }) {
    // Defensive: backend may return partial balance object on auth/permission
    // edge cases (e.g. role has read but a column-level filter). Coercing to
    // 0 here keeps the page rendering instead of crashing on `undefined.toFixed`.
    const n = typeof value === 'number' ? value : 0;
    return (
        <div className="ui-summary__stat">
            <span className="ui-summary__stat-label">{label}</span>
            <span className="ui-summary__stat-value"><Money value={n} tone="balance" /></span>
        </div>
    );
}

/** Наличные для роли admin до закрытия смены — скрыты (решение владельца 3, 09.11). */
function HiddenCashTile() {
    return (
        <div data-cash-hidden className="ui-summary__stat">
            <span className="ui-summary__stat-label">Наличные</span>
            <span style={{ fontSize: 12, color: 'var(--color-ink-60)', display: 'flex', gap: 4, alignItems: 'flex-start', lineHeight: 1.3 }}>
                <EyeOff size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                скрыто до закрытия смены
            </span>
        </div>
    );
}

function TotalCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | undefined | null }) {
    // Нет числа (итоги ещё грузятся) — «…», а не ложный «0 ₾».
    const loaded = typeof value === 'number';
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-ink-60)', marginBottom: 2 }}>
                {icon} {label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {loaded ? <Money value={value} tone="flow" /> : <span className="num">…</span>}
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
    // Филиал — названием, не кодом «unbox_uni»; способ — по-русски (ревью 09.11, №12).
    const meta = [
        METHOD_LABEL[tx.paymentMethod] || 'Другой способ',
        branchLabel(tx.branch),
        `${formatDayMonth(when, { timeZone: BATUMI_TZ })}, ${formatTime(when, { timeZone: BATUMI_TZ })}`,
    ].filter(Boolean).join(' · ');
    // От кого деньги и кто записал — чтобы в конце смены сверить без компьютера.
    const who = [
        txClient(tx),
        tx.adminName ? `записал(а) ${tx.adminName}` : '',
    ].filter(Boolean).join(' · ');
    // 09.11 фаза 3: строка — общий ListRow; сумма — Money tone="flow" (приход
    // зелёный, расход чернилами — красный только у долга); значок без цветной плитки.
    return (
        <ListRow
            onClick={onTap}
            chevron={false}
            lead={<ListIcon>{isIncome ? <TrendingUp size={18} /> : <TrendingDown size={18} />}</ListIcon>}
            title={<span style={{ fontWeight: 500 }}>{tx.categoryName || humanizeMoneyText(tx.description) || (isIncome ? 'Доход' : 'Расход')}</span>}
            subtitle={<>
                {who && <span data-tx-who style={{ display: 'block', color: 'var(--color-ink-80)' }}>{who}</span>}
                <span className="num-inline">{meta}</span>
            </>}
            trail={<Money value={isIncome ? (tx.amount ?? 0) : -(tx.amount ?? 0)} tone="flow" />}
        />
    );
}
/** Имя клиента операции: client_name, иначе из описания «Пополнение баланса: Имя». */
function txClient(tx: { clientName?: string; description?: string; clientId?: string }): string {
    if (tx.clientName) return tx.clientName;
    const m = /:\s*(.+)$/.exec(tx.description || '');
    if (tx.clientId && m) return m[1].trim();
    return '';
}

/** Просмотр операции для не-владельца: менять может только владелец (ревью 09.11, №22). */
function TransactionViewSheet({ tx, onClose }: {
    tx: import('../../../api/cashbox').CashboxTransaction;
    onClose: () => void;
}) {
    const when = parseUTC(tx.date);
    const isIncome = tx.type === 'income';
    const rows: Array<[string, string]> = [
        ['Сумма', formatGel(isIncome ? tx.amount : -tx.amount, { sign: true })],
        ['Статья', tx.categoryName || (isIncome ? 'Доход' : 'Расход')],
        ['Способ', METHOD_LABEL[tx.paymentMethod] || 'Другой способ'],
        ['Филиал', branchLabel(tx.branch) || 'не указан'],
        ['Когда', `${formatDayMonth(when, { timeZone: BATUMI_TZ })}, ${formatTime(when, { timeZone: BATUMI_TZ })}`],
        ['Клиент', txClient(tx) || '—'],
        ['Записал(а)', tx.adminName || '—'],
        ['Комментарий', humanizeMoneyText(tx.description) || '—'],
    ];
    return (
        <Sheet open onClose={onClose} title={isIncome ? 'Доход' : 'Расход'} description="Изменить или удалить операцию может только владелец. Своя ошибка сегодня — кнопкой «Вернуть» сразу после записи или через старшего админа.">
            <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                {rows.map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-ink-08)' }}>
                        <dt style={{ width: 110, flexShrink: 0, fontSize: 14, color: 'var(--color-ink-60)' }}>{k}</dt>
                        <dd style={{ margin: 0, fontSize: 14, color: 'var(--color-ink)', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</dd>
                    </div>
                ))}
            </dl>
        </Sheet>
    );
}

/** Статьи дохода, которые обычно платит клиент: без клиента спросим «Кто платит?». */
const CLIENT_INCOME_CATEGORY_IDS = new Set(['cat-rent', 'cat-subscription']);
const CLIENT_INCOME_CATEGORY_NAMES = new Set(['аренда кабинетов', 'абонементы']);

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
    onClientPayment,
}: {
    branch?: string;
    categories: ReturnType<typeof useCashboxStore.getState>['categories'];
    onClose: () => void;
    onSubmit: (p: AddPayload) => Promise<void>;
    /** «Деньги от клиента?» → поиск клиента и «Пополнить баланс». Нет — подсказки нет (правка). */
    onClientPayment?: () => void;
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
    // «Аренда кабинетов» / «Абонементы» без клиента — сначала «Кто платит?» (№13):
    // так оплату клиента записывали простым доходом, долг оставался, и деньги брали дважды.
    const [notClientConfirmed, setNotClientConfirmed] = useState(false);
    const categoryName = useMemo(() => {
        const walk = (nodes: typeof categories): string => {
            for (const n of nodes) {
                if (n.id === categoryId) return n.name;
                const inner = n.children?.length ? walk(n.children) : '';
                if (inner) return inner;
            }
            return '';
        };
        return walk(categories);
    }, [categories, categoryId]);
    const clientCategory = !isEdit && type === 'income'
        && (CLIENT_INCOME_CATEGORY_IDS.has(categoryId) || CLIENT_INCOME_CATEGORY_NAMES.has(categoryName.trim().toLowerCase()));
    const askWhoPays = clientCategory && !notClientConfirmed;

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
        if (askWhoPays) {
            toast.error('Сначала ответьте «Кто платит?»');
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
                        disabled={!parsedAmount || needBranch || askWhoPays}
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
                    {!needBranch && askWhoPays && !!parsedAmount && (
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', textAlign: 'center' }}>
                            Ответьте «Кто платит?»
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
                    onChange={t => { setType(t); setCategoryId(''); setNotClientConfirmed(false); }}
                />

                {/* «Доход» — первым делом про клиента (ревью 09.11, №13): оплата клиента
                    здесь не закрывает его долг, её надо вносить на баланс. */}
                {!isEdit && type === 'income' && onClientPayment && (
                    <button
                        type="button"
                        data-client-payment-hint
                        onClick={onClientPayment}
                        className="press"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '10px 12px',
                            borderRadius: 8, border: '1px solid var(--color-ink-10)', background: 'var(--color-sunken)',
                            fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--color-ink)',
                        }}
                    >
                        <UserRound size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>Деньги от клиента? → Пополнить баланс клиента</span>
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--color-ink-60)' }}>
                                Тогда долг клиента закроется, и следующий админ не возьмёт деньги второй раз
                            </span>
                        </span>
                        <ChevronRight size={18} aria-hidden="true" />
                    </button>
                )}

                <Field label="Сумма" error={amountError}>
                    <Input
                        kind="money"
                        suffix="₾"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        autoFocus
                        size="hero"
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
                        {/* Старое значение кодом («unbox_uni») — показываем названием. */}
                        {branch && !['Unbox One', 'Unbox Uni', 'Neo School'].includes(branch) && (
                            <option value={branch}>{branchLabel(branch)}</option>
                        )}
                    </Select>
                </Field>

                <Field label="Категория">
                    <Select value={categoryId} onChange={e => { setCategoryId(e.target.value); setNotClientConfirmed(false); }}>
                        <option value="">Без категории</option>
                        {flatCats.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </Select>
                </Field>

                {askWhoPays && (
                    <div data-who-pays role="group" aria-label="Кто платит?" style={{
                        background: 'var(--status-pending-bg)', color: 'var(--status-pending-fg)',
                        borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Кто платит?</div>
                        <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                            «{categoryName || 'Эта статья'}» обычно платит клиент. Его деньги нужно вносить на баланс — иначе долг останется.
                        </div>
                        {onClientPayment && (
                            <Button block onClick={onClientPayment} icon={<UserRound size={16} aria-hidden="true" />}>
                                Клиент — пополнить его баланс
                            </Button>
                        )}
                        <Button block variant="secondary" onClick={() => setNotClientConfirmed(true)}>
                            Не клиент — записать доход в кассу
                        </Button>
                    </div>
                )}

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
