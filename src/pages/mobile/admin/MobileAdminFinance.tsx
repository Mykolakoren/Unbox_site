import { useEffect, useMemo, useState } from 'react';
import { Plus, TrendingUp, TrendingDown, Wallet, ChevronDown, Loader2, X, Check, Lock } from 'lucide-react';
import { MobileCloseShiftSheet } from './MobileCloseShiftSheet';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, addWeeks, addMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import { formatBatumi } from '../../../utils/dateUtils';

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
};

function getRange(period: Period, offset: number): { from: Date; to: Date; label: string } {
    const now = new Date();
    if (period === 'day') {
        const base = addDays(now, offset);
        return {
            from: startOfDay(base),
            to: endOfDay(base),
            label: offset === 0 ? 'Сегодня' : offset === -1 ? 'Вчера' : formatBatumi(base, 'd MMM', ru),
        };
    }
    if (period === 'week') {
        const s = startOfWeek(addWeeks(now, offset), { locale: ru });
        const e = endOfWeek(addWeeks(now, offset), { locale: ru });
        return {
            from: s, to: e,
            label: offset === 0 ? 'Эта неделя' : offset === -1 ? 'Прошлая' : `${formatBatumi(s, 'd MMM', ru)}–${formatBatumi(e, 'd MMM', ru)}`,
        };
    }
    const s = startOfMonth(addMonths(now, offset));
    const e = endOfMonth(addMonths(now, offset));
    return {
        from: s, to: e,
        label: offset === 0 ? formatBatumi(now, 'LLLL', ru) : formatBatumi(s, 'LLLL', ru),
    };
}

/**
 * Mobile admin Финансы — compact one-pager.
 *
 * Sections (top to bottom):
 *   1. Branch chip + period selector
 *   2. Balance cards by method (cash / TBC / BOG) — branch-scoped
 *   3. Period totals (доход / расход / разница)
 *   4. Recent transactions list (last 50 in range)
 *   5. FAB → quick add transaction sheet
 *
 * No charts, no shifts, no categories management — those stay on desktop.
 * Goal is "глянул баланс, добавил расход на 5₾, ушёл" in under 30 seconds.
 */
export function MobileAdminFinance() {
    const {
        balances, fetchBalance,
        transactions, fetchTransactions, isLoading,
        categories, fetchCategories,
        createTransaction,
    } = useCashboxStore();

    const [branch, setBranch] = useState<Branch>('all');
    const [period, setPeriod] = useState<Period>('day');
    const [offset, setOffset] = useState(0);
    const [showAdd, setShowAdd] = useState(false);
    const [closeShiftOpen, setCloseShiftOpen] = useState(false);

    const range = useMemo(() => getRange(period, offset), [period, offset]);

    useEffect(() => {
        fetchBalance(branch === 'all' ? undefined : branch);
    }, [branch, fetchBalance]);

    useEffect(() => {
        fetchTransactions({
            dateFrom: range.from.toISOString(),
            dateTo: range.to.toISOString(),
            limit: 100,
        });
    }, [range, fetchTransactions]);

    useEffect(() => {
        if (categories.length === 0) fetchCategories().catch(() => {});
    }, [categories.length, fetchCategories]);

    // Branch-scoped client-side filter on transactions — backend route does
    // not yet accept ?branch=, so we narrow here. Keeping the same shape as
    // the server response so totals stay aligned with the balance card.
    const scopedTransactions = useMemo(() => {
        if (branch === 'all') return transactions;
        return transactions.filter(t => (t.branch || '') === branch);
    }, [transactions, branch]);

    const totals = useMemo(() => {
        let income = 0, expense = 0;
        for (const t of scopedTransactions) {
            if (t.type === 'income') income += t.amount;
            else expense += t.amount;
        }
        return { income, expense, net: income - expense };
    }, [scopedTransactions]);

    return (
        <div style={{ padding: '14px 14px 80px' }}>
            {/* Branch chips */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4 }}>
                {BRANCHES.map(b => (
                    <button
                        key={b}
                        onClick={() => setBranch(b)}
                        style={{
                            flexShrink: 0,
                            padding: '7px 12px',
                            borderRadius: 999,
                            border: branch === b ? '1px solid #0E0E0E' : '1px solid rgba(0,0,0,0.12)',
                            background: branch === b ? '#0E0E0E' : '#fff',
                            color: branch === b ? '#fff' : '#0E0E0E',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {b === 'all' ? 'Все' : b}
                    </button>
                ))}
            </div>

            {/* Period segmented control + range label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 4,
                    padding: 3,
                    borderRadius: 10,
                    background: 'rgba(0,0,0,0.04)',
                }}>
                    {(['day', 'week', 'month'] as Period[]).map(p => (
                        <button
                            key={p}
                            onClick={() => { setPeriod(p); setOffset(0); }}
                            style={{
                                padding: '7px 0',
                                borderRadius: 8,
                                border: 'none',
                                background: period === p ? '#fff' : 'transparent',
                                fontWeight: period === p ? 700 : 500,
                                color: '#0E0E0E',
                                fontSize: 12,
                                cursor: 'pointer',
                                boxShadow: period === p ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                            }}
                        >
                            {PERIOD_LABEL[p]}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                    <button onClick={() => setOffset(o => o - 1)} style={navBtn}>‹</button>
                    <button onClick={() => setOffset(0)} disabled={offset === 0} style={{ ...navBtn, opacity: offset === 0 ? 0.3 : 1, fontSize: 10 }}>•</button>
                    <button onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} style={{ ...navBtn, opacity: offset >= 0 ? 0.3 : 1 }}>›</button>
                </div>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>{range.label}</div>

            {/* Balance cards by method */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 6,
                marginBottom: 14,
            }}>
                <BalanceTile label="Наличные" value={balances.cash} />
                <BalanceTile label="TBC" value={balances.card_tbc} />
                <BalanceTile label="BOG" value={balances.card_bog} />
            </div>

            {/* Period totals strip */}
            <div style={{
                background: '#0E0E0E',
                color: '#fff',
                borderRadius: 12,
                padding: '12px 14px',
                marginBottom: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
            }}>
                <TotalCell icon={<TrendingUp size={12} />} label="Доход" value={totals.income} positive />
                <TotalCell icon={<TrendingDown size={12} />} label="Расход" value={totals.expense} />
                <TotalCell icon={<Wallet size={12} />} label="Разница" value={totals.net} positive={totals.net >= 0} />
            </div>

            {/* Close shift — только когда выбрана конкретная локация
                (нельзя закрыть «все» сразу — каждая локация = своя смена). */}
            {branch !== 'all' && (
                <button
                    onClick={() => setCloseShiftOpen(true)}
                    style={{
                        width: '100%',
                        padding: '12px 16px',
                        background: '#fff',
                        border: '1px dashed rgba(0,0,0,0.20)',
                        borderRadius: 12,
                        marginBottom: 14,
                        fontSize: 14, fontWeight: 700,
                        fontFamily: 'inherit',
                        color: '#0E0E0E',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                >
                    <Lock size={15} />
                    Закрыть смену · {branch}
                </button>
            )}

            {/* Transactions */}
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 8 }}>
                Транзакции · {scopedTransactions.length}
            </div>
            {isLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                    <Loader2 size={20} className="animate-spin" style={{ color: '#888' }} />
                </div>
            ) : scopedTransactions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#888', fontSize: 13 }}>
                    Нет операций в этом периоде
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {scopedTransactions.slice(0, 100).map(t => (
                        <TransactionRow key={t.id} tx={t} />
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
                    width: 52, height: 52,
                    borderRadius: 26,
                    background: '#0E0E0E',
                    color: '#fff',
                    border: 'none',
                    display: 'grid', placeItems: 'center',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                    cursor: 'pointer',
                    zIndex: 50,
                }}
                aria-label="Добавить транзакцию"
            >
                <Plus size={22} />
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
                            // Refresh both totals + list
                            await Promise.all([
                                fetchBalance(branch === 'all' ? undefined : branch),
                                fetchTransactions({
                                    dateFrom: range.from.toISOString(),
                                    dateTo: range.to.toISOString(),
                                    limit: 100,
                                }),
                            ]);
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
                        // После закрытия — рефреш балансов и транзакций.
                        await Promise.all([
                            fetchBalance(branch === 'all' ? undefined : branch),
                            fetchTransactions({
                                dateFrom: range.from.toISOString(),
                                dateTo: range.to.toISOString(),
                                limit: 100,
                            }),
                        ]);
                    }}
                />
            )}
        </div>
    );
}

const navBtn: React.CSSProperties = {
    width: 28, height: 28,
    border: '1px solid rgba(0,0,0,0.12)',
    background: '#fff',
    borderRadius: 7,
    fontSize: 14,
    fontWeight: 700,
    color: '#0E0E0E',
    cursor: 'pointer',
    display: 'grid', placeItems: 'center',
};

function BalanceTile({ label, value }: { label: string; value: number | undefined | null }) {
    // Defensive: backend may return partial balance object on auth/permission
    // edge cases (e.g. role has read but a column-level filter). Coercing to
    // 0 here keeps the page rendering instead of crashing on `undefined.toFixed`.
    const n = typeof value === 'number' ? value : 0;
    const negative = n < 0;
    return (
        <div style={{
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 12,
            padding: '10px 10px 12px',
        }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>
                {label}
            </div>
            <div style={{
                fontSize: 18,
                fontWeight: 700,
                fontFamily: 'ui-monospace, "SF Mono", monospace',
                color: negative ? '#C53030' : '#0E0E0E',
                letterSpacing: '-0.02em',
            }}>
                {n.toFixed(0)} <span style={{ fontSize: 11, color: '#888' }}>₾</span>
            </div>
        </div>
    );
}

function TotalCell({ icon, label, value, positive }: { icon: React.ReactNode; label: string; value: number | undefined | null; positive?: boolean }) {
    const n = typeof value === 'number' ? value : 0;
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, opacity: 0.65, marginBottom: 3 }}>
                {icon} {label}
            </div>
            <div style={{
                fontSize: 16,
                fontWeight: 700,
                fontFamily: 'ui-monospace, "SF Mono", monospace',
                color: positive === false ? '#FF8B7A' : '#fff',
                letterSpacing: '-0.02em',
            }}>
                {n >= 0 ? '' : '-'}{Math.abs(n).toFixed(0)} ₾
            </div>
        </div>
    );
}

function TransactionRow({ tx }: { tx: ReturnType<typeof useCashboxStore.getState>['transactions'][number] }) {
    const isIncome = tx.type === 'income';
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: '#fff',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.04)',
        }}>
            <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: isIncome ? '#E6F4EA' : '#FCE9E9',
                color: isIncome ? '#1B7430' : '#B3261E',
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>
                {isIncome ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0E0E0E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tx.categoryName || tx.description || (isIncome ? 'Доход' : 'Расход')}
                </div>
                <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
                    <span>{METHOD_LABEL[tx.paymentMethod] || tx.paymentMethod}</span>
                    {tx.branch && <><span>·</span><span>{tx.branch}</span></>}
                    <span>·</span>
                    <span>{format(new Date(tx.date), 'd MMM HH:mm', { locale: ru })}</span>
                </div>
            </div>
            <div style={{
                fontSize: 14,
                fontWeight: 700,
                fontFamily: 'ui-monospace, "SF Mono", monospace',
                color: isIncome ? '#1B7430' : '#B3261E',
            }}>
                {isIncome ? '+' : '−'}{(tx.amount ?? 0).toFixed(0)}
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
}: {
    branch?: string;
    categories: ReturnType<typeof useCashboxStore.getState>['categories'];
    onClose: () => void;
    onSubmit: (p: AddPayload) => Promise<void>;
}) {
    const [type, setType] = useState<'income' | 'expense'>('expense');
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('cash');
    const [branch, setBranch] = useState<string>(initialBranch || 'Unbox One');
    const [categoryId, setCategoryId] = useState<string>('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);

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
        const n = parseFloat(amount);
        if (!n || n <= 0) {
            toast.error('Введите сумму');
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

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.5)',
                zIndex: 100,
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
                    background: '#fff',
                    borderTopLeftRadius: 18,
                    borderTopRightRadius: 18,
                    padding: '14px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
                    boxShadow: '0 -8px 24px rgba(0,0,0,0.18)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Новая операция</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888' }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Type toggle */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                    {(['expense', 'income'] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => { setType(t); setCategoryId(''); }}
                            style={{
                                padding: '10px',
                                borderRadius: 10,
                                border: type === t ? `1px solid ${t === 'income' ? '#1B7430' : '#B3261E'}` : '1px solid rgba(0,0,0,0.1)',
                                background: type === t ? (t === 'income' ? '#E6F4EA' : '#FCE9E9') : '#fff',
                                color: type === t ? (t === 'income' ? '#1B7430' : '#B3261E') : '#888',
                                fontWeight: 700,
                                fontSize: 13,
                                cursor: 'pointer',
                            }}
                        >
                            {t === 'income' ? 'Доход' : 'Расход'}
                        </button>
                    ))}
                </div>

                {/* Amount */}
                <div style={{ marginBottom: 10 }}>
                    <Label>Сумма (₾)</Label>
                    <input
                        type="number"
                        inputMode="decimal"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        autoFocus
                        placeholder="0"
                        style={inputStyle}
                    />
                </div>

                {/* Method */}
                <div style={{ marginBottom: 10 }}>
                    <Label>Способ оплаты</Label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                        {['cash', 'card_tbc', 'card_bog'].map(m => (
                            <button
                                key={m}
                                onClick={() => setMethod(m)}
                                style={{
                                    padding: '9px',
                                    borderRadius: 8,
                                    border: method === m ? '1px solid #0E0E0E' : '1px solid rgba(0,0,0,0.1)',
                                    background: method === m ? '#0E0E0E' : '#fff',
                                    color: method === m ? '#fff' : '#0E0E0E',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }}
                            >
                                {METHOD_LABEL[m]}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Branch */}
                <div style={{ marginBottom: 10 }}>
                    <Label>Точка</Label>
                    <select value={branch} onChange={e => setBranch(e.target.value)} style={inputStyle}>
                        {['Unbox One', 'Unbox Uni', 'Neo School'].map(b => (
                            <option key={b} value={b}>{b}</option>
                        ))}
                    </select>
                </div>

                {/* Category */}
                <div style={{ marginBottom: 10 }}>
                    <Label>Категория</Label>
                    <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={inputStyle}>
                        <option value="">— без категории —</option>
                        {flatCats.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                {/* Description */}
                <div style={{ marginBottom: 16 }}>
                    <Label>Комментарий</Label>
                    <input
                        type="text"
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="необязательно"
                        style={inputStyle}
                    />
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving || !amount}
                    style={{
                        width: '100%',
                        padding: '13px',
                        background: '#0E0E0E',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 10,
                        fontWeight: 700,
                        fontSize: 14,
                        cursor: 'pointer',
                        opacity: (saving || !amount) ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                    }}
                >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    Сохранить
                </button>
            </div>
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    color: '#0E0E0E',
    outline: 'none',
};

function Label({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 5 }}>
            {children}
        </div>
    );
}
