import { useState, useEffect, useRef, useCallback } from 'react';
import { SUBSCRIPTION_PLANS } from '../../../utils/data';
import { X, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Banknote, CreditCard, Landmark, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import type { ExpenseCategory } from '../../../api/cashbox';
import { formatBatumi } from '../../../utils/dateUtils';
import { formatGel } from '../../../utils/format';
import { useConfirmDialog } from '../../ui/ConfirmDialogProvider';
import { undoToast } from '../../ui/undoToast';
import { cashboxApi } from '../../../api/cashbox';
import { useUserStore } from '../../../store/userStore';
import { canUndoCashTx } from './cashMoney';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** В5: операцию отменили кнопкой «Вернуть» — экрану обновить журнал и итоги. */
    onUndone?: () => void;
    /** Филиал из фильтра экрана — подставляем, чтобы не выбирать дважды. */
    defaultBranch?: string;
}

// Excel #64 — admins were confused by the difference between methods.
// Tooltip strings are shown as native `title` on each button.
const PAYMENT_METHODS = [
    {
        id: 'cash',
        label: 'Наличные',
        icon: Banknote,
        hint: 'Кэш в кассу. Бумажные деньги на руках у админа.',
    },
    {
        id: 'card_tbc',
        label: 'Карта TBC',
        icon: CreditCard,
        hint: 'Терминал TBC. Оплата банковской картой на месте — зачисляется на счёт TBC.',
    },
    {
        id: 'card_bog',
        label: 'Карта BOG',
        icon: Landmark,
        hint: 'Терминал Bank of Georgia. Оплата картой на месте — зачисляется на счёт BOG.',
    },
] as const;

// Два действующих филиала. Neo School убран (owner 2026-07-22) — операций
// по нему нет, а лишний пункт провоцировал промах. Значение — то, что
// уходит в базу; label — то, что видит админ.
const BRANCHES = [
    { id: 'Unbox Uni', label: 'Uni' },
    { id: 'Unbox One', label: 'One' },
];

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


export function AddCashboxTransactionModal({ isOpen, onClose, onUndone, defaultBranch }: Props) {
    const { createTransaction, categories } = useCashboxStore();
    const role = useUserStore(s => s.currentUser?.role);
    const { confirm } = useConfirmDialog();
    const [type, setType] = useState<'income' | 'expense' | 'transfer'>('income');
    const [amount, setAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [categoryId, setCategoryId] = useState('');
    const [selectedPlan, setSelectedPlan] = useState('');
    const [description, setDescription] = useState('');
    const [branch, setBranch] = useState('');
    const [txDate, setTxDate] = useState(formatBatumi(new Date(), "yyyy-MM-dd'T'HH:mm"));
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

    const resetForm = useCallback(() => {
        setType('income');
        setAmount('');
        setPaymentMethod('cash');
        setCategoryId('');
        setSelectedPlan('');
        setDescription('');
        setBranch(defaultBranch && BRANCHES.some(b => b.id === defaultBranch) ? defaultBranch : '');
        setTransferTo('card_tbc');
        setClientId('');
        setClientSearch('');
        setShowClientDropdown(false);
        setTxDate(formatBatumi(new Date(), "yyyy-MM-dd'T'HH:mm"));
    }, [defaultBranch]);

    // Чистая карточка при каждом открытии (owner 2026-07-22).
    // Окно не пересоздаётся — при закрытии оно лишь возвращает null, а вся
    // введённая информация продолжает жить до перезагрузки страницы. Из-за
    // этого в поле клиента оставался тот, кого выбирали в прошлый раз, и его
    // приходилось стирать вручную; после «Отмены» так же залипали сумма и
    // описание. За день два прихода от одного клиента — редкость, поэтому
    // подставлять прошлого смысла нет: чаще мешает, чем помогает.
    useEffect(() => {
        if (isOpen) resetForm();
    }, [isOpen, resetForm]);

    if (!isOpen) return null;

    const flatCats = flattenCategories(categories, type);

    // В5: сводка на кнопке — что именно запишем, до нажатия.
    // «Записать расход 50 ₾ · Наличные · Uni».
    const submitLabel = (() => {
        const v = parseFloat(amount);
        const verb = type === 'income' ? 'приход' : type === 'expense' ? 'расход' : 'перевод';
        if (isNaN(v) || v <= 0) return `Записать ${verb}`;
        const method = ACCOUNTS.find(a => a.id === paymentMethod)?.label || paymentMethod;
        const where = type === 'transfer'
            ? `${method} → ${ACCOUNTS.find(a => a.id === transferTo)?.label || transferTo}`
            : method;
        const br = BRANCHES.find(b => b.id === branch)?.label || 'без филиала';
        return `Записать ${verb} ${formatGel(v)} · ${where} · ${br}`;
    })();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (saving) return; // двойной Enter не должен записать приход дважды
        const value = parseFloat(amount);
        if (isNaN(value) || value <= 0) {
            toast.error('Введите корректную сумму');
            return;
        }
        if (type === 'transfer' && paymentMethod === transferTo) {
            toast.error('Счёт-источник и счёт-получатель должны отличаться');
            return;
        }

        // ── Подстраховка от главной ошибки в балансах (owner 2026-07-18) ──
        // Приход без клиента не попадает ни на чью копилку — самая частая
        // причина расхождений. (Приход С клиентом теперь зачисляется всегда,
        // отключить это нельзя — см. комментарий у поля клиента.)
        if (type === 'income' && !clientId) {
            const ok = await confirm({
                title: 'Записать приход без клиента?',
                body: 'Деньги попадут только в кассу и не зачислятся ни на чей баланс. '
                    + 'Если это оплата клиента — выберите его в поле «Клиент», тогда сумма пойдёт на его баланс.',
                confirmLabel: 'Записать без клиента',
                cancelLabel: 'Выбрать клиента',
            });
            if (!ok) return;
        }

        // Продажа абонемента: касса сразу включает абонемент клиенту (29.09).
        // Раньше категория «Абонементы» только клала деньги на баланс, а сам
        // абонемент не включался — брони продолжали списываться деньгами.
        const selectedCatObj = flatCats.find(c => c.id === categoryId);
        const isSubscriptionSale = type === 'income' && !!selectedCatObj
            && selectedCatObj.name.toLowerCase().includes('абонемент');
        if (isSubscriptionSale) {
            if (!selectedPlan) { toast.error('Выберите тариф абонемента'); return; }
            if (!clientId) { toast.error('Выберите клиента — без клиента абонемент не включится'); return; }
            const plan = SUBSCRIPTION_PLANS.find(pl => pl.id === selectedPlan);
            if (plan && value !== plan.price) {
                const ok = await confirm({
                    title: 'Сумма не совпадает с ценой тарифа',
                    body: `Тариф «${plan.name}» стоит ${formatGel(plan.price)}, а в поле «Сумма» — ${formatGel(value)}.`,
                    confirmLabel: `Продать за ${formatGel(value)}`,
                    cancelLabel: 'Исправить сумму',
                });
                if (!ok) return;
            }
            setSaving(true);
            try {
                const { usersApi } = await import('../../../api/users');
                const r = await usersApi.sellSubscription(clientId, {
                    categoryId: categoryId || undefined,
                    planId: selectedPlan,
                    paymentMethod: paymentMethod as 'cash' | 'card_tbc' | 'card_bog',
                    amount: value,
                    branch: branch || undefined,
                });
                const who = bookingUsers.find(c => c.id === clientId)?.name || 'клиенту';
                toast.success(
                    `Абонемент «${r.plan}» включён: ${who}, ${r.remainingHours} ч`
                    + (r.carriedHours ? ` (из них ${r.carriedHours} ч перенесено)` : '')
                    + (r.convertedBookings?.length ? `. Броней переведено на часы: ${r.convertedBookings.length}` : ''),
                    { duration: 8000 },
                );
                try { await useCashboxStore.getState().fetchBalance(); } catch { /* обновится при следующем открытии */ }
                resetForm();
                onClose();
            } catch (err: any) {
                toast.error(err?.response?.data?.detail || 'Не удалось продать абонемент');
            } finally {
                setSaving(false);
            }
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
                // В5 (волна 4): то же тело запроса, что и раньше, но через
                // cashboxApi — нужен id новой операции для «Вернуть».
                const created = await cashboxApi.createTransaction({
                    type,
                    amount: value,
                    payment_method: paymentMethod,
                    category_id: categoryId || undefined,
                    description: description || undefined,
                    branch: branch || undefined,
                    date: dateValue,
                    client_id: (type === 'income' && clientId) ? clientId : undefined,
                    client_name: (type === 'income' && clientId) ? bookingUsers.find(c => c.id === clientId)?.name : undefined,
                    // Клиент выбран → деньги его, зачисляем всегда.
                    credit_user_balance: (type === 'income' && !!clientId),
                } as any);
                try { await useCashboxStore.getState().fetchBalance(); } catch { /* обновится при следующем открытии */ }
                const doneText = `${type === 'income' ? 'Приход' : 'Расход'} ${formatGel(value)} записан`;
                // «Вернуть» — только если сервер даст удалить: owner/senior —
                // любую операцию, админ — с сегодняшней датой (transactions.py,
                // DELETE /cashbox/transactions/{id}). Удаление прихода с клиентом
                // сервер сам откатывает с его баланса (topup_reversal).
                if (created?.id && canUndoCashTx(role, created.date)) {
                    undoToast(doneText, async () => {
                        try {
                            await cashboxApi.deleteTransaction(created.id);
                            try { await useCashboxStore.getState().fetchBalance(); } catch { /* ниже обновит экран */ }
                            toast.success('Операция отменена');
                            onUndone?.();
                        } catch (err: any) {
                            toast.error(err?.response?.data?.detail || 'Не удалось отменить операцию — удалите её в журнале');
                        }
                    });
                } else {
                    toast.success(doneText);
                }
            }
            resetForm();
            onClose();
        } catch {
            toast.error('Не удалось записать операцию. Проверьте интернет и нажмите «Записать» ещё раз.');
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
                    aria-label="Закрыть"
                    className="absolute top-4 right-4 text-ink-60 hover:text-gray-600 transition-colors"
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
                                    ? 'bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] border-2 border-[var(--status-ok-fg)]/40'
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
                                    ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] border-2 border-[var(--status-danger-fg)]/40'
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
                                    ? 'bg-accent-soft text-accent-ink border-2 border-accent'
                                    : 'bg-gray-50 text-gray-500 border-2 border-transparent hover:bg-gray-100'
                            }`}
                        >
                            <ArrowLeftRight size={16} />
                            Перевод
                        </button>
                    </div>

                    {/* Amount */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Сумма, ₾</label>
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
                                    title={pm.hint}
                                    className={`p-2 rounded-lg border text-sm flex flex-col items-center gap-1 transition-all ${
                                        paymentMethod === pm.id
                                            ? 'border-unbox-green bg-gray-50 text-unbox-dark font-medium'
                                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                    }`}
                                >
                                    <pm.icon size={20} aria-hidden="true" />
                                    {pm.label}
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-xs text-ink-60 leading-snug">
                            Наличные — кэш в кассу. TBC / BOG — оплата картой на терминале.
                        </p>
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
                                        title={pm.hint}
                                        className={`p-2 rounded-lg border text-sm flex flex-col items-center gap-1 transition-all ${
                                            transferTo === pm.id
                                                ? 'border-accent bg-accent-soft text-accent-ink font-medium'
                                                : pm.id === paymentMethod
                                                    ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                        }`}
                                        disabled={pm.id === paymentMethod}
                                    >
                                        <pm.icon size={20} aria-hidden="true" />
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
                                            <span className="font-bold num">{formatGel(plan.price)}</span>
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
                                        aria-label="Убрать клиента"
                                        className="absolute right-3 top-[38px] text-ink-60 hover:text-gray-600"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                                {/* Клиент выбран → сумма всегда идёт на его баланс.
                                    Галочка «зачислить» убрана (owner 2026-07-22): выбор
                                    клиента и означает, что деньги его. Возможность снять
                                    галочку была лишним шагом и главным источником
                                    расхождений — платёж вносили, копилка не пополнялась. */}
                                {type === 'income' && clientId && (
                                    <div className="mt-2 text-xs text-[var(--status-ok-fg)] bg-[var(--status-ok-bg)] rounded-lg px-2 py-1.5">
                                        Сумма зачислится на баланс клиента (копилку).
                                    </div>
                                )}
                                {/* Подсказка: приход без клиента не попадёт ни на чей баланс */}
                                {type === 'income' && !clientId && (
                                    <div className="mt-2 text-xs text-[var(--status-pending-fg)] bg-[var(--status-pending-bg)] rounded-lg px-2 py-1.5 flex gap-1.5">
                                        <AlertTriangle size={14} aria-hidden="true" className="shrink-0 mt-px" />
                                        <span>Клиент не выбран — деньги пойдут только в кассу, на баланс никому не зачислятся. Для оплаты клиента выберите его выше.</span>
                                    </div>
                                )}
                                {showClientDropdown && !clientId && (
                                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                                        <button
                                            type="button"
                                            onClick={() => { setClientId(''); setClientSearch(''); setShowClientDropdown(false); }}
                                            className="w-full text-left px-4 py-2 text-sm text-ink-60 hover:bg-gray-50"
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
                                                <span className="text-ink-60 ml-1.5">({c.email})</span>
                                            </button>
                                        ))}
                                        {filtered.length === 0 && (
                                            <div className="px-4 py-2 text-sm text-ink-60">Не найдено</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Филиал — две кнопки вместо выпадающего списка. Повторное
                        нажатие снимает выбор: операции без филиала бывают
                        (общие расходы по проекту), но теперь это видимое
                        решение, а не молчаливое значение по умолчанию. */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Филиал</label>
                        <div className="grid grid-cols-2 gap-2">
                            {BRANCHES.map(b => (
                                <button
                                    key={b.id}
                                    type="button"
                                    onClick={() => setBranch(branch === b.id ? '' : b.id)}
                                    className={`p-2 rounded-lg border text-sm transition-all ${
                                        branch === b.id
                                            ? 'border-unbox-green bg-gray-50 text-unbox-dark font-medium'
                                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                    }`}
                                >
                                    {b.label}
                                </button>
                            ))}
                        </div>
                        {!branch && (
                            <p className="mt-2 text-xs text-[var(--status-pending-fg)] leading-snug">
                                Филиал не выбран — операция не попадёт в остаток ни Uni, ни One.
                            </p>
                        )}
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
                            {saving ? 'Записываем…' : submitLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body,
    );
}
