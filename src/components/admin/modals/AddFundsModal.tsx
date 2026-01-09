import { useState } from 'react';
import { Button } from '../../ui/Button';
import { X, CreditCard } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

interface AddFundsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (amount: number, method: 'cash' | 'tbc' | 'bog') => void;
}

export function AddFundsModal({ isOpen, onClose, onConfirm }: AddFundsModalProps) {

    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState<'cash' | 'tbc' | 'bog'>('cash');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const value = parseFloat(amount);
        if (isNaN(value) || value <= 0) {
            toast.error('Введите корректную сумму');
            return;
        }
        onConfirm(value, method);
        setAmount('');
        onClose();
    };

    const PAYMENT_METHODS = [
        { id: 'cash', label: 'Наличные', icon: '💵' },
        { id: 'tbc', label: 'TBC Bank', icon: '🔵' },
        { id: 'bog', label: 'BOG (Ge)', icon: '🟠' },
    ] as const;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="mb-6 text-center">
                    <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center text-white mx-auto mb-4">
                        <CreditCard size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Пополнить баланс</h3>
                    <p className="text-gray-500 text-sm mt-1">
                        Введите сумму и способ оплаты
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Сумма (GEL)
                        </label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black transition-shadow text-lg font-medium"
                            autoFocus
                        />
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Способ оплаты
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {PAYMENT_METHODS.map((pm) => (
                                <button
                                    key={pm.id}
                                    type="button"
                                    onClick={() => setMethod(pm.id)}
                                    className={`p-2 rounded-lg border text-sm flex flex-col items-center gap-1 transition-all ${method === pm.id
                                        ? 'border-black bg-gray-50 text-black font-medium'
                                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                        }`}
                                >
                                    <span className="text-lg">{pm.icon}</span>
                                    {pm.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-3">
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
