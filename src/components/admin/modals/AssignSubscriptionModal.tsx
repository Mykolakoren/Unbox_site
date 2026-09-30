import { useState } from 'react';
import { LegacyButton as Button } from '../../ui/LegacyButton';
import { X, Ticket } from 'lucide-react';
import { createPortal } from 'react-dom';
import { SUBSCRIPTION_PLANS } from '../../../utils/data';
import clsx from 'clsx';
import { formatGel } from '../../../utils/format';
import { ruCountWord } from '../../../utils/plural';

interface AssignSubscriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (planIndex: number, method: 'cash' | 'tbc' | 'bog' | 'balance') => Promise<void> | void;
    currentSubscriptionName?: string;
}

export function AssignSubscriptionModal({ isOpen, onClose, onConfirm, currentSubscriptionName }: AssignSubscriptionModalProps) {
    const [selectedPlanIndex, setSelectedPlanIndex] = useState<number | null>(null);
    const [method, setMethod] = useState<'cash' | 'tbc' | 'bog' | 'balance'>('cash');
    const [busy, setBusy] = useState(false);

    if (!isOpen) return null;

    // Ждём ответа сервера и блокируем кнопку: продажа — это деньги в кассе,
    // двойной клик не должен провести её дважды (ревизия 29.09).
    const handleSubmit = async () => {
        if (selectedPlanIndex === null || busy) return;
        setBusy(true);
        try {
            await onConfirm(selectedPlanIndex, method);
            onClose();
        } finally {
            setBusy(false);
        }
    };

    const PAYMENT_METHODS = [
        // Способы различаем буквой, не цветом (wave 1: без зелёного/синего/оранжевого).
        { id: 'cash', label: 'Наличные', color: 'bg-sunken text-ink' },
        { id: 'tbc', label: 'TBC Bank', color: 'bg-sunken text-ink' },
        { id: 'bog', label: 'BOG (Ge)', color: 'bg-sunken text-ink' },
        { id: 'balance', label: 'С баланса', color: 'bg-sunken text-ink' },
    ] as const;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                <button
                    onClick={onClose}
                    aria-label="Закрыть"
                    className="absolute top-4 right-4 text-ink-60 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="mb-6 text-center">
                    <div className="w-12 h-12 bg-sunken rounded-full flex items-center justify-center text-ink mx-auto mb-4">
                        <Ticket size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Назначить абонемент</h3>
                    {currentSubscriptionName && (
                        <p className="text-[var(--status-pending-fg)] text-xs mt-1 bg-[var(--status-pending-bg)] inline-block px-2 py-1 rounded">
                            Заменит текущий: {currentSubscriptionName}
                        </p>
                    )}
                </div>

                <div className="space-y-3 mb-6">
                    {SUBSCRIPTION_PLANS.map((plan, index) => (
                        <div
                            key={plan.id}
                            onClick={() => setSelectedPlanIndex(index)}
                            className={clsx(
                                "p-4 rounded-xl border-2 cursor-pointer transition-all flex justify-between items-center group",
                                selectedPlanIndex === index
                                    ? "border-accent bg-accent-soft"
                                    : "border-gray-100 hover:border-accent/40 hover:bg-gray-50"
                            )}
                        >
                            <div>
                                <div className={clsx("font-bold", selectedPlanIndex === index ? "text-accent-ink" : "text-gray-900")}>
                                    {plan.name}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {plan.hours}{plan.bonusHours ? ` + ${plan.bonusHours}` : ''} ч · {ruCountWord(plan.durationDays, ['день', 'дня', 'дней'])}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className={clsx("font-bold text-lg num", selectedPlanIndex === index ? "text-accent-ink" : "text-gray-900")}>
                                    {formatGel(plan.price)}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {selectedPlanIndex !== null && (
                    <div className="mb-6 animate-in fade-in slide-in-from-top-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Способ оплаты
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {PAYMENT_METHODS.map((pm) => (
                                <button
                                    key={pm.id}
                                    type="button"
                                    onClick={() => setMethod(pm.id)}
                                    className={`p-2 rounded-lg border text-sm flex items-center justify-center gap-2 transition-all ${method === pm.id
                                        ? 'border-accent bg-accent-soft text-accent-ink font-medium'
                                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                        }`}
                                >
                                    <span aria-hidden="true" className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-xs font-bold ${pm.color}`}>{pm.label[0]}</span>
                                    {pm.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex gap-3">
                    <Button variant="outline" onClick={onClose} className="flex-1">
                        Отмена
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={selectedPlanIndex === null || busy}
                        className="flex-1"
                    >
                        {busy ? 'Назначаем…' : 'Назначить абонемент'}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
}
