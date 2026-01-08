import { X } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useState, useEffect } from 'react';
import { Button } from './ui/Button';
import { startOfWeek, endOfWeek } from 'date-fns';

interface ReconciliationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ReconciliationModal({ isOpen, onClose }: ReconciliationModalProps) {
    const [analysis, setAnalysis] = useState<any>(null);
    const { bookings, currentUser, runWeeklyReconciliation } = useUserStore();

    useEffect(() => {
        if (isOpen && currentUser) {
            // We need a "Dry Run" or just calculate it locally here.
            // Since `runWeeklyReconciliation` in store currently *applies* the change, 
            // we should probably refactor the store to separate "get stats" from "apply".
            // For now, let's duplicate the calc logic here for "Preview" to avoid side-effects opening the window
            // OR we assume the user clicked "Check".

            // Let's implement the logic here for display purposes
            const now = new Date();
            const start = startOfWeek(now, { weekStartsOn: 1 });
            const end = endOfWeek(now, { weekStartsOn: 1 });

            const weekBookings = bookings.filter(b => {
                if (b.userId !== currentUser.email || b.status !== 'confirmed') return false;
                const bookingDate = new Date(b.date);
                return bookingDate >= start && bookingDate <= end;
            });

            let totalBasePrice = 0;
            let totalPaidPrice = 0;
            let totalMinutes = 0;

            weekBookings.forEach(b => {
                const final = b.finalPrice || 0;
                const base = b.price?.basePrice || final;
                totalPaidPrice += final;
                totalBasePrice += base;
                totalMinutes += b.duration;
            });

            const totalHours = totalMinutes / 60;

            let discountPercent = 0;
            let nextTier = null;

            if (totalHours >= 16) {
                discountPercent = 50;
            } else if (totalHours >= 11) {
                discountPercent = 25;
                nextTier = { hours: 16, percent: 50 };
            } else if (totalHours >= 5) {
                discountPercent = 10;
                nextTier = { hours: 11, percent: 25 };
            } else {
                nextTier = { hours: 5, percent: 10 };
            }

            const idealPrice = totalBasePrice * (1 - discountPercent / 100);
            const delta = totalPaidPrice - idealPrice;

            setAnalysis({
                totalHours,
                totalPaidPrice,
                idealPrice,
                discountPercent,
                delta,
                count: weekBookings.length,
                nextTier
            });
        }
    }, [isOpen, bookings, currentUser]);

    const handleApply = () => {
        const result = runWeeklyReconciliation();
        if (result && result.amount > 0) {
            alert(`Успешно! На ваш баланс зачислено ${result.amount} GEL.`);
            onClose();
        } else {
            onClose();
        }
    };

    if (!isOpen || !analysis) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center p-4 border-b border-gray-100">
                    <h3 className="font-bold text-lg">Сверка за неделю</h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-3 rounded-xl">
                            <div className="text-xs text-gray-500 uppercase font-bold mb-1">Всего часов</div>
                            <div className="text-2xl font-bold">{analysis.totalHours.toFixed(1)} ч</div>
                        </div>
                        <div className="bg-gray-50 p-3 rounded-xl">
                            <div className="text-xs text-gray-500 uppercase font-bold mb-1">Ваша скидка</div>
                            <div className="text-2xl font-bold text-blue-600">{analysis.discountPercent}%</div>
                        </div>
                    </div>

                    {/* Progress Bar for Next Tier */}
                    {analysis.nextTier && (
                        <div>
                            <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-gray-500">Прогресс до {analysis.nextTier.percent}%</span>
                                <span className="font-medium">{analysis.totalHours.toFixed(1)} / {analysis.nextTier.hours} ч</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                                    style={{ width: `${Math.min(100, (analysis.totalHours / analysis.nextTier.hours) * 100)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Financials */}
                    <div className="space-y-3 pt-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-500">Фактически оплачено:</span>
                            <span className="font-medium line-through text-gray-400">{analysis.totalPaidPrice.toFixed(2)} ₾</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-500">Цена со скидкой (Идеал):</span>
                            <span className="font-bold">{analysis.idealPrice.toFixed(2)} ₾</span>
                        </div>
                        <div className="pt-3 border-t border-gray-100 flex justify-between items-center">
                            <span className="font-medium">К возврату:</span>
                            <span className={analysis.delta > 0.01 ? "text-xl font-bold text-green-600" : "text-xl font-bold text-gray-400"}>
                                {analysis.delta > 0.01 ? `+${analysis.delta.toFixed(2)} ₾` : '0 ₾'}
                            </span>
                        </div>
                    </div>

                    {/* Action */}
                    <div className="pt-2">
                        {analysis.delta > 0.01 ? (
                            <Button onClick={handleApply} className="w-full">
                                Зачислить кешбэк на баланс
                            </Button>
                        ) : (
                            <Button variant="outline" onClick={onClose} className="w-full">
                                Корректировка не требуется
                            </Button>
                        )}
                        <p className="text-xs text-center text-gray-400 mt-2">
                            Расчет за последние 7 дней
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
