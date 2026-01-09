import { Receipt, CreditCard, Banknote, Landmark } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface UserTransactionsProps {
    email: string;
}

export function UserTransactions({ email }: UserTransactionsProps) {
    const { getTransactionsByUser } = useUserStore();
    const transactions = getTransactionsByUser(email);

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
        // Fallback for old data
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
        const s = status || 'completed'; // Default to completed for old data
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
                        {transactions.map((txn) => {
                            const formattedDate = format(new Date(txn.date), 'd MMM yyyy', { locale: ru });
                            const formattedTime = format(new Date(txn.date), 'HH:mm');

                            return (
                                <tr key={txn.id} className="group hover:bg-gray-50/50 border-b border-gray-50 last:border-0 transition-colors">
                                    <td className="py-3 pl-2 align-top">
                                        <div className="font-medium text-gray-900">{formattedDate}</div>
                                        <div className="text-xs text-gray-400">{formattedTime}</div>
                                    </td>
                                    <td className="py-3 align-top">
                                        <div className="font-bold text-gray-900">
                                            {txn.amount} {txn.currency === 'USD' ? '$' : txn.currency === 'EUR' ? '€' : '₾'}
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
                                            <div className="text-xs text-gray-400 truncate max-w-[150px]">{txn.description}</div>
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
                                        {/* Future: Link to bookings */}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-50 text-right">
                <div className="text-xs text-gray-400">
                    * Платеж может покрывать несколько бронирований
                </div>
            </div>
        </div>
    );
}
