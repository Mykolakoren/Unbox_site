import { Wallet, TrendingUp, TrendingDown, Banknote, CreditCard, Landmark } from 'lucide-react';
import { useCashboxStore } from '../../../store/cashboxStore';
import { useMemo } from 'react';
import type { CashboxTransaction } from '../../../api/cashbox';
import clsx from 'clsx';
import { formatGel } from '../../../utils/format';

interface Props {
    /** Операции выбранного периода и филиала (без фильтра типа журнала). */
    filteredTransactions: CashboxTransaction[];
    periodLabel: string;
    /** Сервер отдал потолок операций — итоги за период могут быть неполными. */
    truncated?: boolean;
}

export function BalanceCard({ filteredTransactions, periodLabel, truncated }: Props) {
    const { balances } = useCashboxStore();

    const stats = useMemo(() => {
        let income = 0;
        let expense = 0;
        for (const tx of filteredTransactions) {
            // Корректировки (payment_method='adjustment': правка баланса клиента,
            // недельная скидка) — бухгалтерские проводки, а не деньги в кассе:
            // в остатки по счетам они тоже не входят. В журнале видны, в итогах — нет.
            if (tx.paymentMethod === 'adjustment') continue;
            if (tx.type === 'income') income += tx.amount;
            else expense += tx.amount;
        }
        return {
            income: Math.round(income * 100) / 100,
            expense: Math.round(expense * 100) / 100,
            net: Math.round((income - expense) * 100) / 100,
        };
    }, [filteredTransactions]);

    const b: any = balances || {};
    const accounts = [
        // Счета различаем значком, не цветом (wave 1: без зелёного/синего/фиолетового «для красоты»).
        { key: 'cash', label: 'Наличные', value: b.cash ?? 0, icon: Banknote, color: 'text-ink-60', bg: 'bg-sunken' },
        { key: 'tbc', label: 'Карта TBC', value: b.cardTbc ?? b.card_tbc ?? 0, icon: CreditCard, color: 'text-ink-60', bg: 'bg-sunken' },
        { key: 'bog', label: 'Карта BOG', value: b.cardBog ?? b.card_bog ?? 0, icon: Landmark, color: 'text-ink-60', bg: 'bg-sunken' },
    ];

    const allAccounts = [
        ...accounts,
        { key: 'total', label: 'Итого', value: b.balance ?? 0, icon: Wallet, color: 'text-ink', bg: 'bg-sunken' },
    ];

    return (
        <div className="space-y-4">
            {/* Account balances — 4 cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {allAccounts.map(acc => (
                    <div key={acc.key} className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-3 sm:p-4 flex items-center gap-2.5 sm:gap-3">
                        <div className={clsx("w-8 h-8 sm:w-10 sm:h-10 shrink-0 rounded-lg sm:rounded-xl flex items-center justify-center", acc.bg)}>
                            <acc.icon size={16} className={acc.color} aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-xs sm:text-xs text-ink-60 font-medium">{acc.label}</div>
                            <div className={clsx(
                                "text-sm sm:text-lg font-bold tabular-nums leading-tight",
                                acc.value < 0 ? "text-[var(--status-danger-fg)]" : "text-unbox-dark"
                            )}>
                                <span className="num">{formatGel(Number(acc.value ?? 0))}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Period stats row */}
            <div className="text-xs text-ink-60">
                За период: <span className="font-medium text-unbox-dark">{periodLabel}</span> · без корректировок баланса
                {truncated && (
                    <span className="block text-[var(--status-pending-fg)] font-medium mt-0.5">
                        Операций больше, чем загрузилось, — итог неполный. Выберите период короче.
                    </span>
                )}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="bg-white rounded-xl sm:rounded-2xl border border-unbox-light/50 shadow-sm p-2.5 sm:p-4 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3">
                    <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg bg-[var(--status-ok-bg)] flex items-center justify-center">
                        <TrendingUp size={14} className="text-[var(--status-ok-fg)]" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 text-center sm:text-left">
                        <div className="text-xs sm:text-xs text-ink-60 font-medium leading-tight">Приход</div>
                        <div className="text-xs sm:text-base font-bold text-[var(--status-ok-fg)] num leading-tight">{formatGel(stats.income, { sign: true, fraction: 0 })}</div>
                    </div>
                </div>
                <div className="bg-white rounded-xl sm:rounded-2xl border border-unbox-light/50 shadow-sm p-2.5 sm:p-4 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3">
                    <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg bg-[var(--status-danger-bg)] flex items-center justify-center">
                        <TrendingDown size={14} className="text-[var(--status-danger-fg)]" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 text-center sm:text-left">
                        <div className="text-xs sm:text-xs text-ink-60 font-medium leading-tight">Расход</div>
                        <div className="text-xs sm:text-base font-bold text-[var(--status-danger-fg)] num leading-tight">{formatGel(-stats.expense, { fraction: 0 })}</div>
                    </div>
                </div>
                <div className={clsx(
                    "bg-white rounded-xl sm:rounded-2xl border shadow-sm p-2.5 sm:p-4 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3",
                    "border-unbox-light/50"
                )}>
                    <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg flex items-center justify-center bg-sunken">
                        <Wallet size={14} className="text-ink-60" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 text-center sm:text-left">
                        {/* «Разница» за период — не путать с «Итого» по всем счетам выше. */}
                        <div className="text-xs sm:text-xs text-ink-60 font-medium leading-tight">Разница</div>
                        <div className="text-xs sm:text-base font-bold num leading-tight text-unbox-dark">
                            {formatGel(stats.net, { sign: true, fraction: 0 })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
