import { Wallet, TrendingUp, TrendingDown, ArrowRightLeft } from 'lucide-react';
import { useCashboxStore } from '../../../store/cashboxStore';
import { useMemo } from 'react';
import type { CashboxTransaction } from '../../../api/cashbox';

interface Props {
    filteredTransactions: CashboxTransaction[];
    periodLabel: string;
}

export function BalanceCard({ filteredTransactions, periodLabel }: Props) {
    const { balance } = useCashboxStore();

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

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Current Balance */}
            <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-5 flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-unbox-green/10 flex items-center justify-center">
                    <Wallet size={20} className="text-unbox-green" />
                </div>
                <div>
                    <div className="text-xs text-unbox-grey font-medium">Баланс кассы</div>
                    <div className="text-xl font-bold text-unbox-dark">{balance.toFixed(2)} <span className="text-sm font-normal text-unbox-grey">₾</span></div>
                </div>
            </div>

            {/* Period Income */}
            <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-5 flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center">
                    <TrendingUp size={20} className="text-green-600" />
                </div>
                <div>
                    <div className="text-xs text-unbox-grey font-medium">Приход · {periodLabel}</div>
                    <div className="text-xl font-bold text-green-700">+{stats.income.toFixed(2)} <span className="text-sm font-normal text-unbox-grey">₾</span></div>
                </div>
            </div>

            {/* Period Expense */}
            <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-5 flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center">
                    <TrendingDown size={20} className="text-red-500" />
                </div>
                <div>
                    <div className="text-xs text-unbox-grey font-medium">Расход · {periodLabel}</div>
                    <div className="text-xl font-bold text-red-600">-{stats.expense.toFixed(2)} <span className="text-sm font-normal text-unbox-grey">₾</span></div>
                </div>
            </div>

            {/* Net result */}
            <div className="bg-white rounded-2xl border border-unbox-light/50 shadow-sm p-5 flex items-center gap-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${stats.net >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
                    <ArrowRightLeft size={20} className={stats.net >= 0 ? 'text-blue-500' : 'text-orange-500'} />
                </div>
                <div>
                    <div className="text-xs text-unbox-grey font-medium">Фин. результат</div>
                    <div className={`text-xl font-bold ${stats.net >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                        {stats.net >= 0 ? '+' : ''}{stats.net.toFixed(2)} <span className="text-sm font-normal text-unbox-grey">₾</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
