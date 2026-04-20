import { Banknote, CreditCard, Landmark, Trash2, Loader2, Pencil, X, Check } from 'lucide-react';
import { ru } from 'date-fns/locale';
import { createPortal } from 'react-dom';
import { useCashboxStore } from '../../../store/cashboxStore';
import { useUserStore } from '../../../store/userStore';
import { toast } from 'sonner';
import { useState } from 'react';
import type { CashboxTransaction } from '../../../api/cashbox';
import { parseUTC, formatBatumi } from '../../../utils/dateUtils';

const BRANCHES = ['Unbox Uni', 'Unbox One', 'Neo School'];

const getMethodIcon = (m: string) => {
    switch (m) {
        case 'cash': return <Banknote size={14} />;
        case 'card_tbc': return <CreditCard size={14} />;
        case 'card_bog': return <Landmark size={14} />;
        case 'card_terminal': return <CreditCard size={14} />;
        case 'bank_transfer': return <Landmark size={14} />;
        default: return <Banknote size={14} />;
    }
};

const getMethodLabel = (m: string) => {
    switch (m) {
        case 'cash': return 'Нал';
        case 'card_tbc': return 'TBC';
        case 'card_bog': return 'BOG';
        case 'card_terminal': return 'Терм';
        case 'bank_transfer': return 'Перевод';
        default: return m;
    }
};

const getMethodLabelFull = (m: string) => {
    switch (m) {
        case 'cash': return 'Наличные';
        case 'card_tbc': return 'Карта TBC';
        case 'card_bog': return 'Карта BOG';
        case 'card_terminal': return 'Терминал';
        case 'bank_transfer': return 'Перевод';
        default: return m;
    }
};

interface Props {
    filteredTransactions: CashboxTransaction[];
    onRefresh?: () => void;
}

export function CashboxTransactionTable({ filteredTransactions, onRefresh }: Props) {
    const { isLoading, deleteTransaction, updateTransaction, categories } = useCashboxStore();
    const { currentUser } = useUserStore();
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [editingTx, setEditingTx] = useState<CashboxTransaction | null>(null);
    const isSeniorOrOwner = currentUser?.role === 'owner' || currentUser?.role === 'senior_admin';

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            await deleteTransaction(id);
            toast.success('Операция удалена');
            onRefresh?.();
        } catch {
            toast.error(isSeniorOrOwner
                ? 'Не удалось удалить операцию'
                : 'Удаление прошлых операций требует подтверждения старшего администратора');
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

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const canEditTx = (tx: CashboxTransaction) => {
        if (isSeniorOrOwner) return true;
        const txDateStr = tx.date?.slice(0, 10);
        return txDateStr === todayStr || txDateStr === yesterdayStr;
    };

    // Flatten categories for select
    const flatCategories: { id: string; name: string }[] = [];
    const flattenCats = (cats: typeof categories, prefix = '') => {
        for (const c of cats) {
            flatCategories.push({ id: c.id, name: prefix + c.name });
            if (c.children?.length) flattenCats(c.children, prefix + c.name + ' → ');
        }
    };
    flattenCats(categories);

    return (
        <>
            {/* Desktop table — hidden on mobile */}
            <div className="hidden md:block overflow-x-auto">
                {/* Доделки R1 — column widths increased + px-3 gutter on every cell.
                    Previous layout had py-only padding, so columns touched
                    on narrow viewports. minWidth bumped to match new widths. */}
                <table className="w-full text-left border-collapse" style={{ minWidth: 1100 }}>
                    <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-100">
                            <th className="font-medium py-3 pl-2 pr-3 whitespace-nowrap" style={{ width: 110 }}>Дата</th>
                            <th className="font-medium py-3 px-3 whitespace-nowrap" style={{ width: 110 }}>Сумма</th>
                            <th className="font-medium py-3 px-3 whitespace-nowrap" style={{ width: 130 }}>Способ</th>
                            <th className="font-medium py-3 px-3 whitespace-nowrap" style={{ width: 150 }}>Категория</th>
                            <th className="font-medium py-3 px-3 whitespace-nowrap" style={{ width: 100 }}>Филиал</th>
                            <th className="font-medium py-3 px-3 whitespace-nowrap" style={{ width: 150 }}>Клиент</th>
                            <th className="font-medium py-3 px-3 whitespace-nowrap">Описание</th>
                            <th className="font-medium py-3 px-3 whitespace-nowrap" style={{ width: 110 }}>Админ</th>
                            <th className="font-medium py-3 pr-2 pl-3 text-right" style={{ width: 60 }}></th>
                        </tr>
                    </thead>
                    <tbody className="text-sm">
                        {filteredTransactions.map(tx => {
                            const d = parseUTC(tx.date);
                            const formattedDate = formatBatumi(d, 'd MMM yyyy', ru);
                            const formattedTime = formatBatumi(d, 'HH:mm');
                            const isIncome = tx.type === 'income';
                            const canEdit = canEditTx(tx);
                            const canDelete = canEdit;

                            return (
                                <tr key={tx.id} className="group hover:bg-gray-50/50 border-b border-gray-50 last:border-0 transition-colors">
                                    <td className="py-3 pl-2 pr-3 align-top whitespace-nowrap">
                                        <div className="font-medium text-gray-900">{formattedDate}</div>
                                        <div className="text-xs text-gray-400">{formattedTime}</div>
                                    </td>
                                    <td className="py-3 px-3 align-top whitespace-nowrap">
                                        <div className={`font-bold ${isIncome ? 'text-green-700' : 'text-red-600'}`}>
                                            {isIncome ? '+' : '-'}{tx.amount.toFixed(2)} ₾
                                        </div>
                                    </td>
                                    <td className="py-3 px-3 align-top whitespace-nowrap">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center text-gray-500 shrink-0">
                                                {getMethodIcon(tx.paymentMethod)}
                                            </div>
                                            <span className="text-gray-600 text-xs">{getMethodLabelFull(tx.paymentMethod)}</span>
                                        </div>
                                    </td>
                                    <td className="py-3 px-3 align-top">
                                        <span className="text-gray-700 text-sm">{tx.categoryName || '—'}</span>
                                    </td>
                                    <td className="py-3 px-3 align-top whitespace-nowrap">
                                        <span className="text-gray-600 text-xs">{tx.branch || '—'}</span>
                                    </td>
                                    <td className="py-3 px-3 align-top whitespace-nowrap">
                                        <span className="text-gray-700 text-sm">{tx.clientName || '—'}</span>
                                    </td>
                                    <td className="py-3 px-3 align-top">
                                        <span className="text-gray-600 text-sm truncate max-w-[220px] block">{tx.description || '—'}</span>
                                    </td>
                                    <td className="py-3 px-3 align-top whitespace-nowrap">
                                        <span className="text-xs text-gray-400">{tx.adminName}</span>
                                    </td>
                                    <td className="py-3 pr-2 pl-3 align-top text-right">
                                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                            {canEdit && (
                                                <button
                                                    onClick={() => setEditingTx(tx)}
                                                    className="text-gray-300 hover:text-blue-500 transition-colors p-1"
                                                    title="Редактировать"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            )}
                                            {canDelete && (
                                                <button
                                                    onClick={() => handleDelete(tx.id)}
                                                    disabled={deletingId === tx.id}
                                                    className="text-gray-300 hover:text-red-500 transition-colors p-1"
                                                    title="Удалить"
                                                >
                                                    {deletingId === tx.id
                                                        ? <Loader2 size={14} className="animate-spin" />
                                                        : <Trash2 size={14} />}
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Mobile card list — hidden on desktop */}
            <div className="md:hidden space-y-2">
                {filteredTransactions.map(tx => {
                    const d = parseUTC(tx.date);
                    const formattedDate = formatBatumi(d, 'd MMM', ru);
                    const formattedTime = formatBatumi(d, 'HH:mm');
                    const isIncome = tx.type === 'income';
                    const canEdit = canEditTx(tx);
                    const canDelete = canEdit;

                    return (
                        <div
                            key={tx.id}
                            className={`rounded-xl p-3 border transition-colors ${
                                isIncome
                                    ? 'border-green-100 bg-green-50/30'
                                    : 'border-red-100 bg-red-50/30'
                            }`}
                        >
                            {/* Row 1: Amount + Date + Actions */}
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                    <span className={`text-lg font-bold ${isIncome ? 'text-green-700' : 'text-red-600'}`}>
                                        {isIncome ? '+' : '-'}{tx.amount.toFixed(0)} ₾
                                    </span>
                                    <span className="text-xs text-gray-400">{formattedDate}, {formattedTime}</span>
                                </div>
                                <div className="flex items-center gap-0.5">
                                    {canEdit && (
                                        <button
                                            onClick={() => setEditingTx(tx)}
                                            className="text-gray-300 active:text-blue-500 p-1.5"
                                        >
                                            <Pencil size={14} />
                                        </button>
                                    )}
                                    {canDelete && (
                                        <button
                                            onClick={() => handleDelete(tx.id)}
                                            disabled={deletingId === tx.id}
                                            className="text-gray-300 active:text-red-500 p-1.5 -mr-1"
                                        >
                                            {deletingId === tx.id
                                                ? <Loader2 size={14} className="animate-spin" />
                                                : <Trash2 size={14} />}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Row 2: Method + Category + Client + Branch */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-gray-200 text-xs text-gray-600">
                                    {getMethodIcon(tx.paymentMethod)}
                                    {getMethodLabel(tx.paymentMethod)}
                                </span>
                                {tx.categoryName && (
                                    <span className="text-xs text-gray-500">{tx.categoryName}</span>
                                )}
                                {tx.clientName && (
                                    <span className="text-xs text-gray-700 font-medium">· {tx.clientName}</span>
                                )}
                                {tx.branch && (
                                    <span className="text-xs text-gray-400">· {tx.branch}</span>
                                )}
                            </div>

                            {/* Row 3: Description (if exists) */}
                            {tx.description && (
                                <div className="text-xs text-gray-500 mt-1.5 line-clamp-1">
                                    {tx.description}
                                </div>
                            )}

                            {/* Admin name — subtle */}
                            {tx.adminName && (
                                <div className="text-[10px] text-gray-300 mt-1">{tx.adminName}</div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Edit Modal */}
            {editingTx && createPortal(
                <EditTransactionModal
                    tx={editingTx}
                    categories={flatCategories}
                    onClose={() => setEditingTx(null)}
                    onSave={async (data) => {
                        await updateTransaction(editingTx.id, data);
                        setEditingTx(null);
                        onRefresh?.();
                    }}
                />,
                document.body
            )}
        </>
    );
}

/* ═══ Edit Transaction Modal ═══ */

function EditTransactionModal({
    tx,
    categories,
    onClose,
    onSave,
}: {
    tx: CashboxTransaction;
    categories: { id: string; name: string }[];
    onClose: () => void;
    onSave: (data: Record<string, any>) => Promise<void>;
}) {
    const [type, setType] = useState(tx.type);
    const [amount, setAmount] = useState(String(tx.amount));
    const [paymentMethod, setPaymentMethod] = useState(tx.paymentMethod);
    const [categoryId, setCategoryId] = useState(tx.categoryId || '');
    const [description, setDescription] = useState(tx.description || '');
    const [branch, setBranch] = useState(tx.branch || '');
    const [date, setDate] = useState(tx.date?.slice(0, 16) || '');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (!amount || parseFloat(amount) <= 0) return;
        setSaving(true);
        try {
            await onSave({
                type,
                amount: parseFloat(amount),
                payment_method: paymentMethod,
                category_id: categoryId || null,
                description: description || null,
                branch: branch || null,
                date: date ? new Date(date).toISOString() : undefined,
            });
        } catch {
            // error handled in store
        } finally {
            setSaving(false);
        }
    };

    const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30";
    const labelCls = "block text-xs font-medium text-gray-500 mb-1";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-gray-900">Редактирование операции</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                </div>

                {/* Type */}
                <div>
                    <label className={labelCls}>Тип</label>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setType('income')}
                            className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                                type === 'income' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-white text-gray-500 border-gray-200'
                            }`}
                        >
                            Приход
                        </button>
                        <button
                            onClick={() => setType('expense')}
                            className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                                type === 'expense' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-white text-gray-500 border-gray-200'
                            }`}
                        >
                            Расход
                        </button>
                    </div>
                </div>

                {/* Amount */}
                <div>
                    <label className={labelCls}>Сумма (GEL)</label>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} step="0.01" min="0.01" className={inputCls} />
                </div>

                {/* Payment Method */}
                <div>
                    <label className={labelCls}>Способ оплаты</label>
                    <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={inputCls}>
                        <option value="cash">Наличные</option>
                        <option value="card_tbc">Карта TBC</option>
                        <option value="card_bog">Карта BOG</option>
                    </select>
                </div>

                {/* Category */}
                <div>
                    <label className={labelCls}>Категория</label>
                    <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={inputCls}>
                        <option value="">— Без категории —</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>

                {/* Branch */}
                <div>
                    <label className={labelCls}>Филиал</label>
                    <select value={branch} onChange={e => setBranch(e.target.value)} className={inputCls}>
                        <option value="">— Без филиала —</option>
                        {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                </div>

                {/* Date */}
                <div>
                    <label className={labelCls}>Дата и время</label>
                    <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
                </div>

                {/* Description */}
                <div>
                    <label className={labelCls}>Описание</label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Описание операции..." />
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
                        Отмена
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving || !amount || parseFloat(amount) <= 0}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </div>
            </div>
        </div>
    );
}
