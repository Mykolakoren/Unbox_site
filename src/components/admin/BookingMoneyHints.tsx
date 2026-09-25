import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { cashboxApi } from '../../api/cashbox';
import { useUserStore } from '../../store/userStore';
import type { BookingHistoryItem } from '../../store/types';
import { AddFundsModal } from './modals/AddFundsModal';

type Estimate = Awaited<ReturnType<typeof bookingsApi.getWeeklyEstimate>>;

const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace('.', ',');

/**
 * Денежные подсказки в попапе брони шахматки (просьба Егора 21.09):
 *  - ориентировочная цена с учётом недельной скидки за объём — она приходит
 *    кредитом в понедельник и в цене брони её не видно;
 *  - баланс клиента и кнопка «Принять оплату» — то же пополнение через кассу,
 *    что в карточке клиента, без перехода в неё.
 */
export function BookingMoneyHints({ booking }: { booking: BookingHistoryItem }) {
    const users = useUserStore(s => s.users);
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const client = users.find(u => u.email === booking.userId || u.id === booking.userId);
    const [est, setEst] = useState<Estimate | null>(null);
    const [payOpen, setPayOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setEst(null);
        // Абонемент/обслуживание — недельная скидка к ним не применяется.
        const pm = String(booking.paymentMethod || '');
        if (pm === 'subscription' || pm === 'service') return;
        bookingsApi.getWeeklyEstimate(booking.id)
            .then(r => { if (!cancelled) setEst(r); })
            .catch(() => { /* подсказка необязательная */ });
        return () => { cancelled = true; };
    }, [booking.id, booking.paymentMethod]);

    const balance = client?.balance ?? null;
    const debt = balance !== null && balance < 0 ? -balance : 0;
    const price = booking.finalPrice ?? 0;
    const suggested = debt > 0 ? debt : (booking.paymentStatus === 'pending' ? price : 0);
    const suggestedHint = debt > 0
        ? `Подставлен долг клиента: ${fmt(debt)} ₾`
        : booking.paymentStatus === 'pending' && price > 0
            ? `Подставлена цена брони: ${fmt(price)} ₾ (спишется с баланса за сутки до начала)`
            : undefined;

    const handleConfirm = async (amount: number, method: 'cash' | 'tbc' | 'bog', branch?: string) => {
        if (!client) return;
        const methodMap: Record<string, string> = { cash: 'cash', tbc: 'card_tbc', bog: 'card_bog' };
        try {
            await cashboxApi.createTransaction({
                type: 'income',
                amount,
                payment_method: methodMap[method] || 'cash',
                category_id: 'cat-topup',
                description: `Пополнение баланса: ${client.name}`,
                branch: branch || undefined,
                client_id: client.id || client.email,
                credit_user_balance: true,
            } as any);
            await fetchUsers();
            toast.success(`Оплата принята: ${fmt(amount)} ₾ на баланс ${client.name}`);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось принять оплату (нужен доступ к кассе)');
        }
    };

    let weeklyLine: string | null = null;
    if (est && est.applies) {
        if (est.tierPercent > 0 && est.bookingRebate > 0) {
            weeklyLine = `≈ ${fmt(est.bookingNetEstimate)} ₾ после недельной скидки ${est.tierPercent}% `
                + `(вернётся ${fmt(est.bookingRebate)} ₾ в понедельник; за неделю ${fmt(est.totalHours)} ч)`;
        } else if (est.tierPercent > 0) {
            weeklyLine = `Неделя ${fmt(est.totalHours)} ч — скидка ${est.tierPercent}%, по этой брони уже учтена`;
        } else if (est.nextTierPercent) {
            weeklyLine = `Недельной скидки пока нет: ${fmt(est.totalHours)} ч за неделю, `
                + `ещё ${fmt(est.hoursToNextTier ?? 0)} ч — и будет ${est.nextTierPercent}%`;
        }
        if (weeklyLine && est.tierPercent > 0 && est.nextTierPercent) {
            weeklyLine += `. До ${est.nextTierPercent}% — ещё ${fmt(est.hoursToNextTier ?? 0)} ч`;
        }
    }

    return (
        <>
            {weeklyLine && (
                <div className="flex justify-between gap-3">
                    <span className="text-unbox-grey shrink-0">С недельной</span>
                    <span className="font-medium text-unbox-dark text-right" title="Недельная скидка за объём начисляется кредитом на баланс в понедельник за прошлую неделю. Здесь — ориентир по уже записанным часам недели.">
                        {weeklyLine}
                    </span>
                </div>
            )}
            {client && balance !== null && (
                <div className="flex justify-between items-center gap-3">
                    <span className="text-unbox-grey shrink-0">Баланс</span>
                    <span className="flex items-center gap-2">
                        <span className={`font-medium ${balance < 0 ? 'text-red-600' : 'text-unbox-dark'}`}>{fmt(balance)} ₾</span>
                        <button
                            onClick={() => setPayOpen(true)}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-unbox-green/15 text-unbox-dark hover:bg-unbox-green/25 transition-colors"
                        >
                            Принять оплату
                        </button>
                    </span>
                </div>
            )}
            {/* Портал: попап брони маленький и анимируется (transform) —
                окно внутри него обрезалось бы и позиционировалось криво. */}
            {payOpen && createPortal(
                <div onClick={e => e.stopPropagation()}>
                    <AddFundsModal
                        isOpen={payOpen}
                        onClose={() => setPayOpen(false)}
                        onConfirm={handleConfirm}
                        userName={client?.name}
                        defaultAmount={suggested}
                        hint={suggestedHint}
                    />
                </div>,
                document.body,
            )}
        </>
    );
}
