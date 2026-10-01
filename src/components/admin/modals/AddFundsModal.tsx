import { useState, useEffect, useRef } from 'react';
import { LegacyButton as Button } from '../../ui/LegacyButton';
import { X, CreditCard, Banknote, Landmark } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

interface AddFundsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (amount: number, method: 'cash' | 'tbc' | 'bog', branch?: string) => void;
    userName?: string;
    /** Подставить сумму при открытии (например, долг клиента или цена брони). */
    defaultAmount?: number;
    /** Пояснение под заголовком — откуда взялась подставленная сумма. */
    hint?: string;
    /** Филиал по брони («Unbox Uni» / «Unbox One») — подставить при открытии. */
    defaultBranch?: string;
    /** Без филиала не записывать: приход без филиала не попадает в остаток
     *  ни Uni, ни One. «Принять оплату» ставит true. */
    requireBranch?: boolean;
}

const PAYMENT_METHODS = [
    // Значки Lucide вместо эмодзи-кружков (wave 1).
    { id: 'cash', label: 'Наличные', icon: Banknote },
    { id: 'tbc', label: 'TBC Bank', icon: CreditCard },
    { id: 'bog', label: 'BOG (Ge)', icon: Landmark },
] as const;

// Филиалы кассы — только эти два (owner 2026-07-22). Neo School остаётся
// локацией для броней, но денег там не считают: операций по нему ноль.
const BRANCHES = ['Unbox Uni', 'Unbox One'];

export function AddFundsModal({ isOpen, onClose, onConfirm, userName, defaultAmount, hint, defaultBranch, requireBranch = false }: AddFundsModalProps) {
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState<'cash' | 'tbc' | 'bog'>('cash');
    const [branch, setBranch] = useState('');
    // Подсветка «выберите филиал» — после попытки записать без него.
    const [branchMissing, setBranchMissing] = useState(false);
    const branchRef = useRef<HTMLSelectElement>(null);

    // Сумма обнуляется при каждом открытии. Окно не пересоздаётся (ниже просто
    // return null), поэтому после «Отмены» введённая сумма оставалась в поле —
    // и следующему клиенту можно было записать чужие деньги. Способ оплаты и
    // филиал специально НЕ трогаем: за смену они одни и те же, их повторный
    // выбор — как раз лишняя работа.
    useEffect(() => {
        if (isOpen) setAmount(defaultAmount && defaultAmount > 0 ? String(Math.round(defaultAmount * 100) / 100) : '');
    }, [isOpen, defaultAmount]);

    // Филиал брони известен — подставляем его (как TopupSheet на телефоне).
    // Неизвестен — оставляем прошлый выбор за смену.
    useEffect(() => {
        if (!isOpen) return;
        setBranchMissing(false);
        if (defaultBranch && BRANCHES.includes(defaultBranch)) setBranch(defaultBranch);
    }, [isOpen, defaultBranch]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const value = parseFloat(amount);
        if (isNaN(value) || value <= 0) {
            toast.error('Введите корректную сумму');
            return;
        }
        if (requireBranch && !branch) {
            setBranchMissing(true);
            branchRef.current?.focus();
            return;
        }
        onConfirm(value, method, branch || undefined);
        setAmount('');
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    aria-label="Закрыть"
                    className="absolute top-4 right-4 text-ink-60 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="mb-6 text-center">
                    <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center text-white mx-auto mb-4">
                        <CreditCard size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Пополнить баланс</h3>
                    {hint && (
                        <p className="text-ink-60 text-xs mt-1">{hint}</p>
                    )}
                    {userName && (
                        <p className="text-unbox-green text-sm font-medium mt-1">{userName}</p>
                    )}
                    <p className="text-gray-500 text-sm mt-1">
                        Операция отразится в кассе автоматически
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Сумма, ₾
                        </label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green transition-shadow text-lg font-medium"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Способ оплаты
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {PAYMENT_METHODS.map((pm) => (
                                <button
                                    key={pm.id}
                                    type="button"
                                    onClick={() => setMethod(pm.id)}
                                    className={`p-2 rounded-lg border text-sm flex flex-col items-center gap-1 transition-all ${method === pm.id
                                        ? 'border-unbox-green bg-gray-50 text-unbox-dark font-medium'
                                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                        }`}
                                >
                                    <pm.icon size={20} aria-hidden="true" />
                                    {pm.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label htmlFor="add-funds-branch" className="block text-sm font-medium text-gray-700 mb-1.5">
                            Филиал
                        </label>
                        <select
                            id="add-funds-branch"
                            ref={branchRef}
                            value={branch}
                            onChange={e => { setBranch(e.target.value); setBranchMissing(false); }}
                            aria-invalid={branchMissing || undefined}
                            aria-describedby={branchMissing ? 'add-funds-branch-error' : undefined}
                            className={`w-full px-4 py-2.5 rounded-xl border focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm ${branchMissing
                                ? 'border-[var(--status-danger-fg)] bg-[var(--status-danger-bg)]'
                                : 'border-gray-200'}`}
                        >
                            <option value="">{requireBranch ? 'Выберите филиал' : 'Не указан'}</option>
                            {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                        {branchMissing && (
                            <p id="add-funds-branch-error" role="alert" className="mt-1.5 text-xs font-medium text-[var(--status-danger-fg)]">
                                Выберите филиал — иначе деньги не попадут в остаток кассы
                            </p>
                        )}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button variant="outline" type="button" onClick={onClose} className="flex-1">
                            Отмена
                        </Button>
                        <Button variant="primary" type="submit" className="flex-1">
                            Пополнить
                        </Button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
