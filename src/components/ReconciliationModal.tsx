import { X } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { useState, useEffect } from 'react';
import { LegacyButton as Button } from './ui/LegacyButton';
import { startOfWeek, endOfWeek } from 'date-fns';
import { toast } from 'sonner';
import { formatGel } from '../utils/format';

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
            toast.success(`На ваш баланс зачислено ${formatGel(result.amount)}`);
            onClose();
        } else {
            onClose();
        }
    };

    if (!isOpen || !analysis) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/45">
            <div className="bg-card rounded-2xl w-full max-w-md shadow-[var(--shadow-pop)] overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center p-4 border-b border-ink-10">
                    <h3 className="font-semibold text-lg">Сверка за неделю</h3>
                    <button onClick={onClose} aria-label="Закрыть" className="-m-2.5 w-11 h-11 flex items-center justify-center hover:bg-ink-05 rounded-full transition-colors">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-sunken p-3 rounded-xl">
                            <div className="text-xs text-ink-60 uppercase font-semibold mb-1">Всего часов</div>
                            <div className="text-2xl font-semibold">{analysis.totalHours.toFixed(1)} ч</div>
                        </div>
                        <div className="bg-sunken p-3 rounded-xl">
                            <div className="text-xs text-ink-60 uppercase font-semibold mb-1">Ваша скидка</div>
                            <div className="text-2xl font-semibold text-accent-ink">{analysis.discountPercent}%</div>
                        </div>
                    </div>

                    {/* Progress Bar for Next Tier */}
                    {analysis.nextTier && (
                        <div>
                            <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-ink-60">Прогресс до {analysis.nextTier.percent}%</span>
                                <span className="font-medium">{analysis.totalHours.toFixed(1)} / {analysis.nextTier.hours} ч</span>
                            </div>
                            <div className="h-2 bg-sunken rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-accent rounded-full transition-all duration-1000"
                                    style={{ width: `${Math.min(100, (analysis.totalHours / analysis.nextTier.hours) * 100)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Financials */}
                    <div className="space-y-3 pt-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-ink-60">Фактически оплачено:</span>
                            <span className="num font-medium line-through text-ink-60">{formatGel(analysis.totalPaidPrice)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-ink-60">Цена со скидкой:</span>
                            <span className="num font-semibold">{formatGel(analysis.idealPrice)}</span>
                        </div>
                        <div className="pt-3 border-t border-ink-10 flex justify-between items-center">
                            <span className="font-medium">К возврату:</span>
                            <span className={analysis.delta > 0.01 ? "num text-xl font-semibold text-[var(--status-ok-fg)]" : "num text-xl font-semibold text-ink-60"}>
                                {analysis.delta > 0.01 ? formatGel(analysis.delta, { sign: true }) : formatGel(0)}
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
                        <p className="text-xs text-center text-ink-60 mt-2">
                            Расчёт за последние 7 дней
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
