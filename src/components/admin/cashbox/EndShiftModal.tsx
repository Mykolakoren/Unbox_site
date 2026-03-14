import { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export function EndShiftModal({ isOpen, onClose }: Props) {
    const { balance, endShift } = useCashboxStore();
    const [actualBalance, setActualBalance] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setActualBalance('');
            setNotes('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const actualValue = parseFloat(actualBalance);
    const hasAmount = !isNaN(actualValue) && actualValue >= 0;
    const discrepancy = hasAmount ? Math.round((actualValue - balance) * 100) / 100 : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!hasAmount) {
            toast.error('Введите сумму в кассе');
            return;
        }
        setSaving(true);
        try {
            const report = await endShift({
                actual_balance: actualValue,
                notes: notes || undefined,
            });
            const disc = report.discrepancy;
            if (Math.abs(disc) < 0.01) {
                toast.success('Смена закрыта — расхождений нет');
            } else {
                toast.warning(`Смена закрыта — расхождение: ${disc > 0 ? '+' : ''}${disc.toFixed(2)} ₾`);
            }
            onClose();
        } catch {
            toast.error('Ошибка закрытия смены');
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
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <h3 className="text-lg font-bold text-unbox-dark mb-1">Закрытие смены</h3>
                <p className="text-sm text-unbox-grey mb-5">Пересчитайте наличные в кассе</p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Expected balance */}
                    <div className="bg-gray-50 rounded-xl px-4 py-3">
                        <div className="text-xs text-gray-500 mb-0.5">Ожидаемый баланс (система)</div>
                        <div className="text-xl font-bold text-unbox-dark">{balance.toFixed(2)} ₾</div>
                    </div>

                    {/* Actual balance */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Фактически в кассе (₾)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={actualBalance}
                            onChange={e => setActualBalance(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green transition-shadow text-lg font-medium"
                            autoFocus
                        />
                    </div>

                    {/* Discrepancy indicator */}
                    {discrepancy !== null && (
                        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
                            Math.abs(discrepancy) < 0.01
                                ? 'bg-green-50 text-green-700'
                                : 'bg-amber-50 text-amber-700'
                        }`}>
                            {Math.abs(discrepancy) < 0.01
                                ? <CheckCircle size={16} />
                                : <AlertTriangle size={16} />}
                            {Math.abs(discrepancy) < 0.01
                                ? 'Расхождений нет'
                                : `Расхождение: ${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)} ₾`}
                        </div>
                    )}

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Комментарий</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Необязательно..."
                            rows={2}
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm resize-none"
                        />
                    </div>

                    {/* Actions */}
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
                            disabled={saving || !hasAmount}
                            className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors disabled:opacity-60"
                        >
                            {saving ? 'Сохранение...' : 'Закрыть смену'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body,
    );
}
