import { useState, useEffect } from 'react';
import { Button } from '../../ui/Button';
import { X, Shield } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

interface EditCreditLimitModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentLimit: number;
    onConfirm: (limit: number) => void;
}

export function EditCreditLimitModal({ isOpen, onClose, currentLimit, onConfirm }: EditCreditLimitModalProps) {

    const [limit, setLimit] = useState('');

    useEffect(() => {
        if (isOpen) {
            setLimit(currentLimit.toString());
        }
    }, [isOpen, currentLimit]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const value = parseFloat(limit);
        if (isNaN(value) || value < 0) {
            toast.error('Введите корректную сумму');
            return;
        }
        onConfirm(value);
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
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="mb-6 text-center">
                    <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center text-white mx-auto mb-4">
                        <Shield size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Кредитный лимит</h3>
                    <p className="text-gray-500 text-sm mt-1">
                        Разрешенный минус на балансе
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Лимит (GEL)
                        </label>
                        <input
                            type="number"
                            value={limit}
                            onChange={(e) => setLimit(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black transition-shadow text-lg font-medium"
                            autoFocus
                        />
                        <p className="text-xs text-gray-400 mt-2">
                            Клиент сможет создавать бронирования при балансе до -{limit || 0} ₾
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <Button variant="outline" type="button" onClick={onClose} className="flex-1">
                            Отмена
                        </Button>
                        <Button variant="primary" type="submit" className="flex-1">
                            Сохранить
                        </Button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
