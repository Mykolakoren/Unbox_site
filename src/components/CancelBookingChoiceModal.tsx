import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../api/bookings';
import { ruCountWord } from '../utils/plural';

/**
 * Choice modal shown when an admin / specialist / user clicks "Удалить" on a
 * booking that belongs to a recurring series.
 *
 *   - «Отменить только эту»      → DELETE /bookings/{id}
 *   - «Отменить эту и следующие» → DELETE /bookings/recurring/{group_id}?from_booking_id=<this>
 *                                Cancels the clicked booking + every later
 *                                sibling on the same calendar day or after.
 *                                Earlier siblings (incl. completed ones in
 *                                the past) are preserved — same semantics
 *                                Google Calendar offers for "this and
 *                                following".
 *   - X / esc / outside       → close, do nothing
 *
 * Earlier we used "Всю серию" without an anchor and the backend cancelled
 * every still-future booking in the group. Egoriy hit that: he was
 * looking at a mid-series occurrence, hit "delete series", and bookings
 * earlier in the series got cancelled too. Now the anchor is always
 * passed so the cancel scope matches what the user is looking at.
 */
export function CancelBookingChoiceModal({
    bookingId,
    groupId,
    onClose,
    onCompleted,
}: {
    bookingId: string;
    groupId: string;
    onClose: () => void;
    onCompleted: (mode: 'this' | 'series') => void;
}) {
    const [busy, setBusy] = useState<null | 'this' | 'series'>(null);

    const cancelOne = async () => {
        setBusy('this');
        try {
            await bookingsApi.cancelBooking(bookingId);
            toast.success('Бронь отменена');
            onCompleted('this');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось отменить');
        } finally {
            setBusy(null);
        }
    };

    const cancelSeries = async () => {
        setBusy('series');
        try {
            // Always pass the anchor — backend uses it as cutoff so only
            // this booking and later siblings get cancelled, never the
            // earlier ones in the series.
            const res = await bookingsApi.cancelRecurringSeries(groupId, bookingId);
            toast.success(`Серия отменена: ${ruCountWord(res?.cancelled ?? 0, ['бронь', 'брони', 'броней'])}`);
            onCompleted('series');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось отменить серию');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[1000] bg-ink/45 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget && busy === null) onClose(); }}
        >
            <div className="bg-card rounded-2xl shadow-[var(--shadow-pop)] w-full max-w-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-ink-10">
                    <div className="font-semibold text-ink">Это серия броней</div>
                    <button
                        onClick={onClose}
                        disabled={busy !== null}
                        aria-label="Закрыть"
                        className="-m-2.5 w-11 h-11 flex items-center justify-center hover:bg-ink-05 rounded-lg disabled:opacity-30"
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
                <div className="px-4 py-3 text-sm text-ink-80">
                    Отменить только эту бронь или эту и все следующие в серии?
                    Более ранние брони серии останутся.
                </div>
                <div className="px-4 pb-4 space-y-2">
                    <button
                        onClick={cancelOne}
                        disabled={busy !== null}
                        className="w-full min-h-11 py-2 text-sm font-medium rounded-lg bg-[var(--status-danger-bg)] hover:brightness-95 text-[var(--status-danger-fg)] disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {busy === 'this' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                        Отменить только эту
                    </button>
                    <button
                        onClick={cancelSeries}
                        disabled={busy !== null}
                        className="w-full min-h-11 py-2 text-sm font-medium rounded-lg bg-[var(--status-danger-solid)] hover:brightness-95 text-card disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {busy === 'series' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                        Отменить эту и следующие
                    </button>
                    <button
                        onClick={onClose}
                        disabled={busy !== null}
                        className="w-full min-h-11 py-2 text-sm font-medium rounded-lg border border-ink-20 bg-card hover:bg-ink-05 text-ink disabled:opacity-50"
                    >
                        Оставить
                    </button>
                </div>
            </div>
        </div>
    );
}
