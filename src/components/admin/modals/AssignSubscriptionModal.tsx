import { useState } from 'react';
import { Button } from '../../ui/Button';
import { X, Ticket } from 'lucide-react';
import { createPortal } from 'react-dom';
import { SUBSCRIPTION_PLANS } from '../../../utils/data';
import clsx from 'clsx';

interface AssignSubscriptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (planIndex: number, method: 'cash' | 'tbc' | 'bog' | 'balance') => void;
    currentSubscriptionName?: string;
}

export function AssignSubscriptionModal({ isOpen, onClose, onConfirm, currentSubscriptionName }: AssignSubscriptionModalProps) {
    const [selectedPlanIndex, setSelectedPlanIndex] = useState<number | null>(null);
    const [method, setMethod] = useState<'cash' | 'tbc' | 'bog' | 'balance'>('cash');

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (selectedPlanIndex !== null) {
            onConfirm(selectedPlanIndex, method);
            onClose();
        }
    };

    const PAYMENT_METHODS = [
        { id: 'cash', label: 'Наличные', icon: '💵' },
        { id: 'tbc', label: 'TBC Bank', icon: '🔵' },
        { id: 'bog', label: 'BOG (Ge)', icon: '🟠' },
        { id: 'balance', label: 'С баланса', icon: '💰' },
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
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="mb-6 text-center">
                    <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 mx-auto mb-4">
                        <Ticket size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Назначить абонемент</h3>
                    {currentSubscriptionName && (
                        <p className="text-red-500 text-xs mt-1 bg-red-50 inline-block px-2 py-1 rounded">
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
                                    ? "border-purple-600 bg-purple-50"
                                    : "border-gray-100 hover:border-purple-200 hover:bg-gray-50"
                            )}
                        >
                            <div>
                                <div className={clsx("font-bold", selectedPlanIndex === index ? "text-purple-900" : "text-gray-900")}>
                                    {plan.name}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {plan.hours} часов
                                </div>
                            </div>
                            <div className="text-right">
                                <div className={clsx("font-bold text-lg", selectedPlanIndex === index ? "text-purple-700" : "text-gray-900")}>
                                    {plan.price} ₾
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
                                        ? 'border-purple-600 bg-purple-50 text-purple-900 font-medium'
                                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                        }`}
                                >
                                    <span>{pm.icon}</span>
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
                        disabled={selectedPlanIndex === null}
                        className={clsx("flex-1", selectedPlanIndex !== null ? "bg-purple-600 hover:bg-purple-700" : "")}
                    >
                        Назначить
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
}
