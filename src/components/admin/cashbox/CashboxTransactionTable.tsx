// v2
import { Banknote, CreditCard, Landmark, Trash2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCashboxStore } from '../../../store/cashboxStore';
import { toast } from 'sonner';
import { useState } from 'react';
import type { CashboxTransaction } from '../../../api/cashbox';

const getMethodIcon = (m: string) => {
    switch (m) {
        case 'cash': return <Banknote size={14} />;
        case 'card_tbc': return <CreditCard size={14} />;
        case 'card_bog': return <Landmark size={14} />;
        // Legacy
        case 'card_terminal': return <CreditCard size={14} />;
        case 'bank_transfer': return <Landmark size={14} />;
        default: return <Banknote size={14} />;
    }
};

const getMethodLabel = (m: string) => {
    switch (m) {
        case 'cash': return 'Наличные';
        case 'card_tbc': return 'Карта TBC';
        case 'card_bog': return 'Карта BOG';
        // Legacy
        case 'card_terminal': return 'Терминал';
        case 'bank_transfer': return 'Перевод';
        default: return m;
    }
};

interface Props {
    filteredTransactions: CashboxTransaction[];
}

export function CashboxTransactionTable({ filteredTransactions }: Props) {
    const { isLoading, deleteTransaction } = useCashboxStore();
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            await deleteTransaction(id);
            toast.success('Операция удалена');
        } catch {
            toast.error('Не удалось удалить (только сегодняшние операции)');
        } finally {
            setDeletingId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16 text-unbox-grey">
                <Loader2 size={20} className="animate-spin mr-2" />
                Загрузка...
            </div>
        );
    }

    if (filteredTransactions.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-50 rounded-xl text-gray-500 text-sm">
                Операций не найдено
            </div>
        );
    }

    const today = new Date().toISOString().slice(0, 10);

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                        <th className="font-medium py-3 pl-2">Дата</th>
                        <th className="font-medium py-3">Сумма</th>
                        <th className="font-medium py-3">Способ</th>
                        <th className="font-medium py-3">Категория</th>
                        <th className="font-medium py-3">Филиал</th>
                        <th className="font-medium py-3">Описание</th>
                        <th className="font-medium py-3">Админ</th>
                        <th className="font-medium py-3 pr-2 text-right w-10"></th>
                    </tr>
                </thead>
                <tbody className="text-sm">
                    {filteredTransactions.map(tx => {
                        const d = new Date(tx.date);
                        const formattedDate = format(d, 'd MMM yyyy', { locale: ru });
                        const formattedTime = format(d, 'HH:mm');
                        const isIncome = tx.type === 'income';
                        const canDelete = tx.date?.slice(0, 10) === today;

                        return (
                            <tr key={tx.id} className="group hover:bg-gray-50/50 border-b border-gray-50 last:border-0 transition-colors">
                                <td className="py-3 pl-2 align-top">
                                    <div className="font-medium text-gray-900">{formattedDate}</div>
                                    <div className="text-xs text-gray-400">{formattedTime}</div>
                                </td>
                                <td className="py-3 align-top">
                                    <div className={`font-bold ${isIncome ? 'text-green-700' : 'text-red-600'}`}>
                                        {isIncome ? '+' : '-'}{tx.amount.toFixed(2)} ₾
                                    </div>
                                </td>
                                <td className="py-3 align-top">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center text-gray-500">
                                            {getMethodIcon(tx.paymentMethod)}
                                        </div>
                                        <span className="text-gray-600 text-xs">{getMethodLabel(tx.paymentMethod)}</span>
                                    </div>
                                </td>
                                <td className="py-3 align-top">
                                    <span className="text-gray-700">{tx.categoryName || '—'}</span>
                                </td>
                                <td className="py-3 align-top">
                                    <span className="text-gray-600 text-xs">{tx.branch || '—'}</span>
                                </td>
                                <td className="py-3 align-top">
                                    <span className="text-gray-600 truncate max-w-[200px] block">{tx.description || '—'}</span>
                                </td>
                                <td className="py-3 align-top">
                                    <span className="text-xs text-gray-400">{tx.adminName}</span>
                                </td>
                                <td className="py-3 pr-2 align-top text-right">
                                    {canDelete && (
                                        <button
                                            onClick={() => handleDelete(tx.id)}
                                            disabled={deletingId === tx.id}
                                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all p-1"
                                            title="Удалить"
                                        >
                                            {deletingId === tx.id
                                                ? <Loader2 size={14} className="animate-spin" />
                                                : <Trash2 size={14} />}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
