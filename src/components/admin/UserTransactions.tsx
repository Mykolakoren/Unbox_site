import { useEffect } from 'react';
import { Receipt, CreditCard, Banknote, Landmark } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { useCashboxStore } from '../../store/cashboxStore';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { parseUTC, formatBatumi } from '../../utils/dateUtils';

interface UserTransactionsProps {
    email: string;
}

/**
 * Excel #60 — admins reported "paid but nothing shows in the client card".
 *
 * The root cause: legacy userStore.transactions is a local Zustand slice
 * that's not populated from the real source of truth anymore. Real money
 * movements live in cashboxStore.transactions (API-backed). We now merge
 * both sources and dedupe by id, so any cashbox transaction linked to
 * this user — either via client_id (booked-for-client) or via
 * credited_user_id (balance top-up) — appears in the card.
 */
export function UserTransactions({ email }: UserTransactionsProps) {
    const { users, getTransactionsByUser } = useUserStore();
    const { transactions: cashboxTxs, fetchTransactions } = useCashboxStore();

    const user = users.find(u => u.email === email);
    const userUuid = user?.id;

    // Fetch cashbox history on mount; fine to refetch, store dedupes by id.
    useEffect(() => {
        fetchTransactions();
    }, [fetchTransactions]);

    // Legacy source (kept for older manually-added test rows).
    const legacyTransactions = getTransactionsByUser(email);

    // Cashbox source, filtered to this user. We check both client_id
    // (admin picked this client when recording the tx) and
    // credited_user_id (balance-top-up marker from create_transaction).
    const cashboxForUser = cashboxTxs.filter(t =>
        (userUuid && (t.clientId === userUuid || (t as any).creditedUserId === userUuid))
    );

    // Normalise cashbox rows into the same shape as legacy rows so the
    // render loop below stays unchanged.
    const normalisedCashbox = cashboxForUser.map(t => ({
        id: t.id,
        date: t.date,
        amount: t.type === 'expense' ? -t.amount : t.amount,
        currency: t.currency,
        paymentMethod: t.paymentMethod === 'card_tbc' ? 'tbc'
            : t.paymentMethod === 'card_bog' ? 'bog'
            : t.paymentMethod === 'card_terminal' ? 'card'
            : t.paymentMethod === 'bank_transfer' ? 'transfer'
            : t.paymentMethod,
        description: t.description || t.categoryName || '',
        category: t.type === 'income' ? 'deposit' : 'shop',
        type: t.type === 'income' ? 'deposit' : 'manual_correction',
        status: 'completed' as const,
        adminName: t.adminName,
        source: 'cashbox' as const,
    }));

    // Dedupe: if a legacy tx happens to share an id with cashbox, prefer cashbox.
    const seen = new Set(normalisedCashbox.map(t => t.id));
    const legacyUnique = legacyTransactions.filter(t => !seen.has(t.id));
    const transactions = [...normalisedCashbox, ...legacyUnique]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (transactions.length === 0) {
        return (
            <div className="bg-white p-6 rounded-2xl border border-gray-200">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                    <Receipt size={20} className="text-gray-400" />
                    История платежей
                </h3>
                <div className="text-center py-8 bg-gray-50 rounded-xl text-gray-500 text-sm">
                    Операций по счету не найдено
                </div>
            </div>
        );
    }

    const getPaymentIcon = (method: string) => {
        switch (method) {
            case 'cash': return <Banknote size={14} />;
            case 'tbc': return <div className="text-[10px] font-bold text-blue-600">TBC</div>;
            case 'bog': return <div className="text-[10px] font-bold text-orange-600">BOG</div>;
            case 'card': return <CreditCard size={14} />;
            case 'transfer': return <Landmark size={14} />;
            case 'balance': return <div className="text-[10px] font-bold">BAL</div>;
            default: return <CreditCard size={14} />;
        }
    };

    const getPaymentLabel = (method: string) => {
        switch (method) {
            case 'cash': return 'Наличные';
            case 'tbc': return 'TBC Bank';
            case 'bog': return 'Bank of Georgia';
            case 'card': return 'Карта';
            case 'transfer': return 'Перевод';
            case 'balance': return 'С баланса';
            default: return method;
        }
    };

    const getPurposeLabel = (t: any) => {
        if (!t.category) {
            if (t.type === 'subscription_purchase') return 'Абонемент';
            if (t.type === 'booking_payment') return 'Разовая бронь';
            if (t.type === 'deposit') return 'Пополнение';
            return 'Прочее';
        }

        switch (t.category) {
            case 'subscription': return 'Абонемент';
            case 'booking': return 'Разовая бронь';
            case 'shop': return 'Допы';
            case 'deposit': return 'Пополнение';
            default: return 'Прочее';
        }
    };

    const getStatusBadge = (status?: string) => {
        const s = status || 'completed';
        const styles = {
            completed: 'bg-green-100 text-green-700',
            pending: 'bg-yellow-100 text-yellow-700',
            failed: 'bg-red-100 text-red-700',
            refunded: 'bg-gray-100 text-gray-600 line-through'
        };
        const labels = {
            completed: 'Оплачен',
            pending: 'Ожидает',
            failed: 'Ошибка',
            refunded: 'Возврат'
        };

        return (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${styles[s as keyof typeof styles] || styles.completed}`}>
                {labels[s as keyof typeof labels] || s}
            </span>
        );
    };

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-200">
            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                <Receipt size={20} className="text-gray-400" />
                История платежей и операций
                <span className="text-xs font-normal text-gray-400 ml-2">
                    {transactions.length} {transactions.length === 1 ? 'запись' : 'записей'}
                </span>
            </h3>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="font-medium py-3 pl-2">Дата</th>
                            <th className="font-medium py-3">Сумма</th>
                            <th className="font-medium py-3">Способ</th>
                            <th className="font-medium py-3">Назначение</th>
                            <th className="font-medium py-3">Статус</th>
                            <th className="font-medium py-3 pr-2 text-right">Инфо</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm">
                        {transactions.map((txn: any) => {
                            const d = parseUTC(txn.date);
                            const formattedDate = formatBatumi(d, 'd MMM yyyy', ru);
                            const formattedTime = formatBatumi(d, 'HH:mm');
                            const amountNum = Number(txn.amount);
                            const isNegative = amountNum < 0;

                            return (
                                <tr key={txn.id} className="group hover:bg-gray-50/50 border-b border-gray-50 last:border-0 transition-colors">
                                    <td className="py-3 pl-2 align-top">
                                        <div className="font-medium text-gray-900">{formattedDate}</div>
                                        <div className="text-xs text-gray-400">{formattedTime}</div>
                                    </td>
                                    <td className="py-3 align-top">
                                        <div className={`font-bold ${isNegative ? 'text-red-600' : 'text-green-700'}`}>
                                            {isNegative ? '' : '+'}{amountNum} {txn.currency === 'USD' ? '$' : txn.currency === 'EUR' ? '€' : '₾'}
                                        </div>
                                    </td>
                                    <td className="py-3 align-top">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center text-gray-500">
                                                {getPaymentIcon(txn.paymentMethod)}
                                            </div>
                                            <span className="text-gray-600 text-xs">{getPaymentLabel(txn.paymentMethod)}</span>
                                        </div>
                                    </td>
                                    <td className="py-3 align-top">
                                        <div className="text-gray-900">{getPurposeLabel(txn)}</div>
                                        {txn.description && txn.description !== getPurposeLabel(txn) && (
                                            <div className="text-xs text-gray-400 truncate max-w-[200px]">{txn.description}</div>
                                        )}
                                    </td>
                                    <td className="py-3 align-top">
                                        {getStatusBadge(txn.status)}
                                    </td>
                                    <td className="py-3 pr-2 align-top text-right">
                                        {txn.adminName && (
                                            <div className="text-[10px] text-gray-400">
                                                by {txn.adminName}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-50 text-right">
                <div className="text-xs text-gray-400">
                    * Платёж может покрывать несколько бронирований. Минусовые суммы — возвраты или списания.
                </div>
            </div>
        </div>
    );
}
