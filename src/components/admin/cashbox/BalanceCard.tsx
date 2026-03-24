import { Wallet, TrendingUp, TrendingDown, Banknote, CreditCard, Landmark } from 'lucide-react';
import { useCashboxStore } from '../../../store/cashboxStore';
import { useMemo } from 'react';
import type { CashboxTransaction } from '../../../api/cashbox';
import clsx from 'clsx';

interface Props {
    filteredTransactions: CashboxTransaction[];
    periodLabel: string;
}

export function BalanceCard({ filteredTransactions, periodLabel }: Props) {
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
    // toCamelCase interceptor converts card_tbc → cardTbc, card_bog → cardBog
    const accounts = [
        { key: 'cash', label: 'Наличные', value: b.cash ?? 0, icon: Banknote, color: 'text-green-700', bg: 'bg-green-50' },
        { key: 'tbc', label: 'Карта TBC', value: b.cardTbc ?? b.card_tbc ?? 0, icon: CreditCard, color: 'text-blue-700', bg: 'bg-blue-50' },
        { key: 'bog', label: 'Карта BOG', value: b.cardBog ?? b.card_bog ?? 0, icon: Landmark, color: 'text-purple-700', bg: 'bg-purple-50' },
    ];

    return (
        <div className="space-y-4">
            {/* Account balances row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {accounts.map(acc => (
                    <div key={acc.key} className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-4 flex items-center gap-3">
                        <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center", acc.bg)}>
                            <acc.icon size={18} className={acc.color} />
                        </div>
                        <div className="min-w-0">
                            <div className="text-[11px] text-unbox-grey font-medium truncate">{acc.label}</div>
                            <div className={clsx(
                                "text-lg font-bold",
                                acc.value < 0 ? "text-red-600" : "text-unbox-dark"
                            )}>
                                {acc.value.toFixed(2)} <span className="text-xs font-normal text-unbox-grey">₾</span>
                            </div>
                        </div>
                    </div>
                ))}

                {/* Total */}
                <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-unbox-green/10 flex items-center justify-center">
                        <Wallet size={18} className="text-unbox-green" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-[11px] text-unbox-grey font-medium">Итого</div>
                        <div className={clsx(
                            "text-lg font-bold",
                            (b.balance ?? 0) < 0 ? "text-red-600" : "text-unbox-dark"
                        )}>
                            {(b.balance ?? 0).toFixed(2)} <span className="text-xs font-normal text-unbox-grey">₾</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Period stats row */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center">
                        <TrendingUp size={16} className="text-green-600" />
                    </div>
                    <div>
                        <div className="text-[11px] text-unbox-grey font-medium">Приход · {periodLabel}</div>
                        <div className="text-base font-bold text-green-700">+{stats.income.toFixed(2)} ₾</div>
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center">
                        <TrendingDown size={16} className="text-red-500" />
                    </div>
                    <div>
                        <div className="text-[11px] text-unbox-grey font-medium">Расход · {periodLabel}</div>
                        <div className="text-base font-bold text-red-600">-{stats.expense.toFixed(2)} ₾</div>
                    </div>
                </div>
                <div className={clsx(
                    "bg-white rounded-2xl border shadow-sm p-4 flex items-center gap-3",
                    stats.net >= 0 ? "border-blue-100" : "border-orange-100"
                )}>
                    <div className={clsx("w-9 h-9 rounded-lg flex items-center justify-center", stats.net >= 0 ? 'bg-blue-50' : 'bg-orange-50')}>
                        <Wallet size={16} className={stats.net >= 0 ? 'text-blue-500' : 'text-orange-500'} />
                    </div>
                    <div>
                        <div className="text-[11px] text-unbox-grey font-medium">Результат</div>
                        <div className={clsx("text-base font-bold", stats.net >= 0 ? 'text-blue-600' : 'text-orange-600')}>
                            {stats.net >= 0 ? '+' : ''}{stats.net.toFixed(2)} ₾
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
