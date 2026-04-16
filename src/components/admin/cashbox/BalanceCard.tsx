import { Wallet, TrendingUp, TrendingDown, Banknote, CreditCard, Landmark } from 'lucide-react';
import { useCashboxStore } from '../../../store/cashboxStore';
import { useMemo } from 'react';
import type { CashboxTransaction } from '../../../api/cashbox';
import clsx from 'clsx';

interface Props {
    filteredTransactions: CashboxTransaction[];
    periodLabel: string;
}

export function BalanceCard({ filteredTransactions }: Props) {
    const { balances } = useCashboxStore();

    const stats = useMemo(() => {
        let income = 0;
        let expense = 0;
        for (const tx of filteredTransactions) {
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
        { key: 'cash', label: 'Наличные', value: b.cash ?? 0, icon: Banknote, color: 'text-green-700', bg: 'bg-green-50' },
        { key: 'tbc', label: 'Карта TBC', value: b.cardTbc ?? b.card_tbc ?? 0, icon: CreditCard, color: 'text-blue-700', bg: 'bg-blue-50' },
        { key: 'bog', label: 'Карта BOG', value: b.cardBog ?? b.card_bog ?? 0, icon: Landmark, color: 'text-purple-700', bg: 'bg-purple-50' },
    ];

    const allAccounts = [
        ...accounts,
        { key: 'total', label: 'Итого', value: b.balance ?? 0, icon: Wallet, color: 'text-unbox-green', bg: 'bg-unbox-green/10' },
    ];

    return (
        <div className="space-y-4">
            {/* Account balances — 4 cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {allAccounts.map(acc => (
                    <div key={acc.key} className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-3 sm:p-4 flex items-center gap-2.5 sm:gap-3">
                        <div className={clsx("w-8 h-8 sm:w-10 sm:h-10 shrink-0 rounded-lg sm:rounded-xl flex items-center justify-center", acc.bg)}>
                            <acc.icon size={16} className={acc.color} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-[10px] sm:text-[11px] text-unbox-grey font-medium">{acc.label}</div>
                            <div className={clsx(
                                "text-sm sm:text-lg font-bold tabular-nums leading-tight",
                                acc.value < 0 ? "text-red-600" : "text-unbox-dark"
                            )}>
                                {acc.value.toFixed(2)}<span className="text-[10px] sm:text-xs font-normal text-unbox-grey ml-0.5">₾</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Period stats row */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="bg-white rounded-xl sm:rounded-2xl border border-unbox-light/50 shadow-sm p-2.5 sm:p-4 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3">
                    <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg bg-green-50 flex items-center justify-center">
                        <TrendingUp size={14} className="text-green-600" />
                    </div>
                    <div className="min-w-0 text-center sm:text-left">
                        <div className="text-[9px] sm:text-[11px] text-unbox-grey font-medium leading-tight">Приход</div>
                        <div className="text-xs sm:text-base font-bold text-green-700 tabular-nums leading-tight">+{stats.income.toFixed(0)}<span className="text-[9px] sm:text-xs font-normal text-unbox-grey ml-0.5">₾</span></div>
                    </div>
                </div>
                <div className="bg-white rounded-xl sm:rounded-2xl border border-unbox-light/50 shadow-sm p-2.5 sm:p-4 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3">
                    <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg bg-red-50 flex items-center justify-center">
                        <TrendingDown size={14} className="text-red-500" />
                    </div>
                    <div className="min-w-0 text-center sm:text-left">
                        <div className="text-[9px] sm:text-[11px] text-unbox-grey font-medium leading-tight">Расход</div>
                        <div className="text-xs sm:text-base font-bold text-red-600 tabular-nums leading-tight">-{stats.expense.toFixed(0)}<span className="text-[9px] sm:text-xs font-normal text-unbox-grey ml-0.5">₾</span></div>
                    </div>
                </div>
                <div className={clsx(
                    "bg-white rounded-xl sm:rounded-2xl border shadow-sm p-2.5 sm:p-4 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3",
                    stats.net >= 0 ? "border-blue-100" : "border-orange-100"
                )}>
                    <div className={clsx("w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg flex items-center justify-center", stats.net >= 0 ? 'bg-blue-50' : 'bg-orange-50')}>
                        <Wallet size={14} className={stats.net >= 0 ? 'text-blue-500' : 'text-orange-500'} />
                    </div>
                    <div className="min-w-0 text-center sm:text-left">
                        <div className="text-[9px] sm:text-[11px] text-unbox-grey font-medium leading-tight">Итог</div>
                        <div className={clsx("text-xs sm:text-base font-bold tabular-nums leading-tight", stats.net >= 0 ? 'text-blue-600' : 'text-orange-600')}>
                            {stats.net >= 0 ? '+' : ''}{stats.net.toFixed(0)}<span className="text-[9px] sm:text-xs font-normal text-unbox-grey ml-0.5">₾</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
