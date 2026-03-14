import { useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import type { ExpenseCategory } from '../../../api/cashbox';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const PAYMENT_METHODS = [
    { id: 'cash', label: 'Наличные', icon: '💵' },
    { id: 'card_tbc', label: 'Карта TBC', icon: '💳' },
    { id: 'card_bog', label: 'Карта BOG', icon: '🏛️' },
] as const;

const BRANCHES = ['Uni', 'One'];

function flattenCategories(cats: ExpenseCategory[]): { id: string; name: string; depth: number }[] {
    const result: { id: string; name: string; depth: number }[] = [];
    for (const cat of cats) {
        if (!cat.isActive) continue;
        result.push({ id: cat.id, name: cat.name, depth: 0 });
        for (const child of cat.children ?? []) {
            if (!child.isActive) continue;
            result.push({ id: child.id, name: child.name, depth: 1 });
        }
    }
    return result;
}

export function AddCashboxTransactionModal({ isOpen, onClose }: Props) {
    const { createTransaction, categories } = useCashboxStore();
    const [type, setType] = useState<'income' | 'expense'>('income');
    const [amount, setAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [categoryId, setCategoryId] = useState('');
    const [description, setDescription] = useState('');
    const [branch, setBranch] = useState('');
    const [saving, setSaving] = useState(false);

    if (!isOpen) return null;

    const flatCats = flattenCategories(categories);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const value = parseFloat(amount);
        if (isNaN(value) || value <= 0) {
            toast.error('Введите корректную сумму');
            return;
        }
        setSaving(true);
        try {
            await createTransaction({
                type,
                amount: value,
                payment_method: paymentMethod,
                category_id: categoryId || undefined,
                description: description || undefined,
                branch: branch || undefined,
            });
            toast.success(type === 'income' ? 'Приход записан' : 'Расход записан');
            setAmount('');
            setDescription('');
            setCategoryId('');
            setBranch('');
            onClose();
        } catch {
            toast.error('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <h3 className="text-lg font-bold text-unbox-dark mb-5">Новая операция</h3>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Type toggle */}
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setType('income')}
                            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                type === 'income'
                                    ? 'bg-green-100 text-green-800 border-2 border-green-300'
                                    : 'bg-gray-50 text-gray-500 border-2 border-transparent hover:bg-gray-100'
                            }`}
                        >
                            <ArrowDownLeft size={16} />
                            Приход
                        </button>
                        <button
                            type="button"
                            onClick={() => setType('expense')}
                            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                type === 'expense'
                                    ? 'bg-red-100 text-red-800 border-2 border-red-300'
                                    : 'bg-gray-50 text-gray-500 border-2 border-transparent hover:bg-gray-100'
                            }`}
                        >
                            <ArrowUpRight size={16} />
                            Расход
                        </button>
                    </div>

                    {/* Amount */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Сумма (GEL)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green transition-shadow text-lg font-medium"
                            autoFocus
                        />
                    </div>

                    {/* Payment method */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Способ оплаты</label>
                        <div className="grid grid-cols-3 gap-2">
                            {PAYMENT_METHODS.map(pm => (
                                <button
                                    key={pm.id}
                                    type="button"
                                    onClick={() => setPaymentMethod(pm.id)}
                                    className={`p-2 rounded-lg border text-sm flex flex-col items-center gap-1 transition-all ${
                                        paymentMethod === pm.id
                                            ? 'border-unbox-green bg-gray-50 text-unbox-dark font-medium'
                                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                    }`}
                                >
                                    <span className="text-lg">{pm.icon}</span>
                                    {pm.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Category */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Категория</label>
                        <select
                            value={categoryId}
                            onChange={e => setCategoryId(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm bg-white"
                        >
                            <option value="">Без категории</option>
                            {flatCats.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.depth > 0 ? `  └ ${c.name}` : c.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Branch */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Филиал</label>
                        <select
                            value={branch}
                            onChange={e => setBranch(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm bg-white"
                        >
                            <option value="">Не указан</option>
                            {BRANCHES.map(b => (
                                <option key={b} value={b}>{b}</option>
                            ))}
                        </select>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Описание</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Комментарий к операции..."
                            rows={2}
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm resize-none"
                        />
                    </div>

                    {/* Submit */}
                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors disabled:opacity-60"
                        >
                            {saving ? 'Сохранение...' : 'Записать'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body,
    );
}
