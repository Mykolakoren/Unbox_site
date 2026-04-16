import { useState, useEffect, useRef } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { format } from 'date-fns';
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

const BRANCHES = ['Unbox Uni', 'Unbox One', 'Neo School'];

function flattenCategories(cats: ExpenseCategory[], txType?: 'income' | 'expense' | 'transfer'): { id: string; name: string; depth: number; icon?: string }[] {
    const result: { id: string; name: string; depth: number; icon?: string }[] = [];
    const filterType = txType === 'transfer' ? 'expense' : txType;
    for (const cat of cats) {
        if (!cat.isActive) continue;
        // Filter by category type: show matching + 'both'
        if (filterType && cat.categoryType && cat.categoryType !== 'both' && cat.categoryType !== filterType) continue;
        result.push({ id: cat.id, name: cat.name, depth: 0, icon: cat.icon });
        for (const child of cat.children ?? []) {
            if (!child.isActive) continue;
            if (filterType && child.categoryType && child.categoryType !== 'both' && child.categoryType !== filterType) continue;
            result.push({ id: child.id, name: child.name, depth: 1, icon: child.icon });
        }
    }
    return result;
}

const ACCOUNTS = [
    { id: 'cash', label: 'Наличные' },
    { id: 'card_tbc', label: 'Карта TBC' },
    { id: 'card_bog', label: 'Карта BOG' },
] as const;

const SUBSCRIPTION_PLANS = [
    { id: 'trial', name: 'Пробный', price: 70 },
    { id: 'warm-start', name: 'Тёплый старт', price: 180 },
    { id: 'regular', name: 'Регулярный практик', price: 350 },
    { id: 'pro', name: 'Профи+', price: 650 },
    { id: 'group', name: 'Групповой мастер', price: 450 },
];

export function AddCashboxTransactionModal({ isOpen, onClose }: Props) {
    const { createTransaction, categories } = useCashboxStore();
    const [type, setType] = useState<'income' | 'expense' | 'transfer'>('income');
    const [amount, setAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [categoryId, setCategoryId] = useState('');
    const [selectedPlan, setSelectedPlan] = useState('');
    const [description, setDescription] = useState('');
    const [branch, setBranch] = useState('');
    const [txDate, setTxDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    const [transferTo, setTransferTo] = useState('card_tbc');
    const [clientId, setClientId] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [showClientDropdown, setShowClientDropdown] = useState(false);
    const clientInputRef = useRef<HTMLInputElement>(null);
    const [bookingUsers, setBookingUsers] = useState<{id: string; name: string; email: string}[]>([]);

    // Fetch booking Users (not CRM clients — those are specialist-only)
    useEffect(() => {
        import('../../../api/users').then(({ usersApi }) => {
            usersApi.getUsers(0, 500).then(users => {
                setBookingUsers(users.map((u: any) => ({ id: u.id || u.email, name: u.name, email: u.email })));
            }).catch(() => {});
        });
    }, []);
    const [saving, setSaving] = useState(false);

    if (!isOpen) return null;

    const flatCats = flattenCategories(categories, type);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const value = parseFloat(amount);
        if (isNaN(value) || value <= 0) {
            toast.error('Введите корректную сумму');
            return;
        }
        if (type === 'transfer' && paymentMethod === transferTo) {
            toast.error('Счёт-источник и счёт-получатель должны отличаться');
            return;
        }
        setSaving(true);
        try {
            // Send local time as-is (no UTC conversion) — backend stores it verbatim
            const dateValue = txDate || undefined;
            if (type === 'transfer') {
                // Transfer = expense from source + income to target
                const fromLabel = ACCOUNTS.find(a => a.id === paymentMethod)?.label || paymentMethod;
                const toLabel = ACCOUNTS.find(a => a.id === transferTo)?.label || transferTo;
                const transferDesc = `Перевод: ${fromLabel} → ${toLabel}${description ? ` (${description})` : ''}`;
                await createTransaction({
                    type: 'expense',
                    amount: value,
                    payment_method: paymentMethod,
                    description: transferDesc,
                    branch: branch || undefined,
                    date: dateValue,
                });
                await createTransaction({
                    type: 'income',
                    amount: value,
                    payment_method: transferTo,
                    description: transferDesc,
                    branch: branch || undefined,
                    date: dateValue,
                });
                toast.success('Перевод записан');
            } else {
                await createTransaction({
                    type,
                    amount: value,
                    payment_method: paymentMethod,
                    category_id: categoryId || undefined,
                    description: description || undefined,
                    branch: branch || undefined,
                    date: dateValue,
                    client_id: (type === 'income' && clientId) ? clientId : undefined,
                    client_name: (type === 'income' && clientId) ? bookingUsers.find(c => c.id === clientId)?.name : undefined,
                } as any);
                toast.success(type === 'income' ? 'Приход записан' : 'Расход записан');
            }
            setAmount('');
            setDescription('');
            setCategoryId('');
            setBranch('');
            setTxDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
            onClose();
        } catch {
            toast.error('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md p-5 sm:p-6 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <h3 className="text-lg font-bold text-unbox-dark mb-5">Новая операция</h3>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Type toggle */}
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={() => { setType('income'); setCategoryId(''); }}
                            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
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
                            onClick={() => { setType('expense'); setCategoryId(''); }}
                            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                type === 'expense'
                                    ? 'bg-red-100 text-red-800 border-2 border-red-300'
                                    : 'bg-gray-50 text-gray-500 border-2 border-transparent hover:bg-gray-100'
                            }`}
                        >
                            <ArrowUpRight size={16} />
                            Расход
                        </button>
                        <button
                            type="button"
                            onClick={() => { setType('transfer'); setCategoryId(''); }}
                            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                type === 'transfer'
                                    ? 'bg-blue-100 text-blue-800 border-2 border-blue-300'
                                    : 'bg-gray-50 text-gray-500 border-2 border-transparent hover:bg-gray-100'
                            }`}
                        >
                            <ArrowLeftRight size={16} />
                            Перевод
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

                    {/* Date */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Дата операции</label>
                        <input
                            type="datetime-local"
                            value={txDate}
                            onChange={e => setTxDate(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm"
                        />
                    </div>

                    {/* Payment method / Source account */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            {type === 'transfer' ? 'Со счёта' : 'Способ оплаты'}
                        </label>
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

                    {/* Transfer target account */}
                    {type === 'transfer' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">На счёт</label>
                            <div className="grid grid-cols-3 gap-2">
                                {PAYMENT_METHODS.map(pm => (
                                    <button
                                        key={pm.id}
                                        type="button"
                                        onClick={() => setTransferTo(pm.id)}
                                        className={`p-2 rounded-lg border text-sm flex flex-col items-center gap-1 transition-all ${
                                            transferTo === pm.id
                                                ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium'
                                                : pm.id === paymentMethod
                                                    ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                        }`}
                                        disabled={pm.id === paymentMethod}
                                    >
                                        <span className="text-lg">{pm.icon}</span>
                                        {pm.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Category (not for transfers) */}
                    {type !== 'transfer' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Категория</label>
                            <select
                                value={categoryId}
                                onChange={e => {
                                    setCategoryId(e.target.value);
                                    setSelectedPlan('');
                                }}
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
                    )}

                    {/* Subscription plan selector */}
                    {(() => {
                        const selectedCat = flatCats.find(c => c.id === categoryId);
                        const isSubscriptionCat = selectedCat && selectedCat.name.toLowerCase().includes('абонемент');
                        if (!isSubscriptionCat) return null;
                        return (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Тариф</label>
                                <div className="grid grid-cols-1 gap-2">
                                    {SUBSCRIPTION_PLANS.map(plan => (
                                        <button
                                            key={plan.id}
                                            type="button"
                                            onClick={() => {
                                                setSelectedPlan(plan.id);
                                                setAmount(String(plan.price));
                                                setDescription(prev => prev || `Абонемент "${plan.name}"`);
                                            }}
                                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all cursor-pointer ${
                                                selectedPlan === plan.id
                                                    ? 'border-unbox-green bg-unbox-light/50 text-unbox-dark'
                                                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                                            }`}
                                        >
                                            <span>{plan.name}</span>
                                            <span className="font-bold">{plan.price} ₾</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Client (income only) — searchable autocomplete */}
                    {type === 'income' && (() => {
                        const sorted = [...bookingUsers].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
                        const filtered = clientSearch.trim()
                            ? sorted.filter(c => {
                                const q = clientSearch.toLowerCase();
                                return c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q);
                            })
                            : sorted;
                        const selectedUser = bookingUsers.find(c => c.id === clientId);

                        return (
                            <div className="relative">
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Клиент (необязательно)</label>
                                <input
                                    ref={clientInputRef}
                                    type="text"
                                    placeholder="Начните вводить имя или email..."
                                    value={clientSearch || (selectedUser ? `${selectedUser.name} (${selectedUser.email})` : '')}
                                    onChange={e => {
                                        setClientSearch(e.target.value);
                                        setClientId('');
                                        setShowClientDropdown(true);
                                    }}
                                    onFocus={() => setShowClientDropdown(true)}
                                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm"
                                />
                                {clientId && (
                                    <button
                                        type="button"
                                        onClick={() => { setClientId(''); setClientSearch(''); }}
                                        className="absolute right-3 top-[38px] text-gray-400 hover:text-gray-600"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                                {showClientDropdown && !clientId && (
                                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                                        <button
                                            type="button"
                                            onClick={() => { setClientId(''); setClientSearch(''); setShowClientDropdown(false); }}
                                            className="w-full text-left px-4 py-2 text-sm text-gray-400 hover:bg-gray-50"
                                        >
                                            — Без привязки к клиенту —
                                        </button>
                                        {filtered.map(c => (
                                            <button
                                                type="button"
                                                key={c.id}
                                                onClick={() => {
                                                    setClientId(c.id);
                                                    setClientSearch('');
                                                    setShowClientDropdown(false);
                                                }}
                                                className="w-full text-left px-4 py-2 text-sm hover:bg-unbox-light/50 transition-colors"
                                            >
                                                <span className="font-medium">{c.name}</span>
                                                <span className="text-gray-400 ml-1.5">({c.email})</span>
                                            </button>
                                        ))}
                                        {filtered.length === 0 && (
                                            <div className="px-4 py-2 text-sm text-gray-400">Не найдено</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

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
                    <div className="flex gap-3 pt-1 pb-2 sticky bottom-0 bg-white">
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
