import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../api/bookings';

/**
 * Choice modal shown when an admin / specialist / user clicks "Удалить" on a
 * booking that belongs to a recurring series.
 *
 *   - "Только эту"            → DELETE /bookings/{id}
 *   - "Эту и все следующие"   → DELETE /bookings/recurring/{group_id}?from_booking_id=<this>
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
            toast.success(`Серия отменена (${res?.cancelled ?? 0} броней)`);
            onCompleted('series');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось отменить серию');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget && busy === null) onClose(); }}
        >
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-unbox-light">
                    <div className="font-semibold text-unbox-dark">Это серия броней</div>
                    <button
                        onClick={onClose}
                        disabled={busy !== null}
                        className="p-1 hover:bg-unbox-light rounded-lg disabled:opacity-30"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="px-4 py-3 text-sm text-unbox-grey">
                    Удалить только эту бронь или эту и все последующие в серии?
                    Более ранние брони серии останутся.
                </div>
                <div className="px-4 pb-4 space-y-2">
                    <button
                        onClick={cancelOne}
                        disabled={busy !== null}
                        className="w-full py-2 text-sm font-medium rounded-lg bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {busy === 'this' && <Loader2 size={14} className="animate-spin" />}
                        Только эту
                    </button>
                    <button
                        onClick={cancelSeries}
                        disabled={busy !== null}
                        className="w-full py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {busy === 'series' && <Loader2 size={14} className="animate-spin" />}
                        Эту и все последующие
                    </button>
                    <button
                        onClick={onClose}
                        disabled={busy !== null}
                        className="w-full py-2 text-sm font-medium rounded-lg bg-unbox-light hover:bg-unbox-light/70 text-unbox-dark disabled:opacity-50"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
}
