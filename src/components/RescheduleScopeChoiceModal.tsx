import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../api/bookings';

/**
 * Choice modal shown when an admin / specialist / user has just picked
 * a new date+time for a booking that's part of a recurring series.
 *
 *   - "Только эту"          → PATCH /bookings/{id}/reschedule
 *                              The single booking moves; series intact.
 *   - "Эту и все последующие" → PATCH /bookings/{id}/reschedule-series
 *                              Anchor takes the full date/time/resource
 *                              change; every later sibling keeps its own
 *                              date but adopts the new start_time and
 *                              resource. Earlier siblings are untouched
 *                              (same Google Calendar "this and following"
 *                              semantics we use for cancel).
 *   - X / esc / outside     → close, do nothing (caller's "saved" callback
 *                              is not invoked).
 *
 * The component owns the network call. The parent drag/move flow already
 * computed ``newDate``, ``newStartTime``, optionally ``newResourceId`` —
 * pass those in. The modal closes itself once a button completes.
 */
export function RescheduleScopeChoiceModal({
    bookingId,
    newDate,
    newStartTime,
    newResourceId,
    onClose,
    onCompleted,
}: {
    bookingId: string;
    newDate: string;
    newStartTime: string;
    newResourceId?: string;
    onClose: () => void;
    onCompleted: (mode: 'this' | 'series') => void;
}) {
    const [busy, setBusy] = useState<null | 'this' | 'series'>(null);

    const moveOne = async () => {
        setBusy('this');
        try {
            await bookingsApi.rescheduleBooking(bookingId, { newDate, newStartTime, newResourceId });
            toast.success('Бронь перенесена');
            onCompleted('this');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось перенести');
        } finally {
            setBusy(null);
        }
    };

    const moveSeries = async () => {
        setBusy('series');
        try {
            const res = await bookingsApi.rescheduleBookingSeries(bookingId, { newDate, newStartTime, newResourceId });
            const skipped = res?.skipped?.length ?? 0;
            if (skipped > 0) {
                // Use a longer toast so the admin sees which dates didn't move
                // (e.g. because somebody else booked over the new time on a
                // particular week). Keep the message single-line so it fits
                // the toast width.
                const dates = res.skipped.map(s => s.date.slice(0, 10)).join(', ');
                toast.warning(
                    `Перенесено: эта + ${res.propagated}. Не перенесено (${skipped}): ${dates}`,
                    { duration: 8000 },
                );
            } else {
                toast.success(`Перенесена эта бронь и ${res?.propagated ?? 0} последующих`);
            }
            onCompleted('series');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось перенести серию');
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
                <div className="px-4 py-3 text-sm text-unbox-grey space-y-1">
                    <p>Перенести только эту бронь или эту и все последующие в серии?</p>
                    <p className="text-xs text-unbox-grey/80">
                        Новое время: <span className="font-medium text-unbox-dark">{newStartTime}</span>
                        {newDate && <> · {newDate}</>}
                    </p>
                </div>
                <div className="px-4 pb-4 space-y-2">
                    <button
                        onClick={moveOne}
                        disabled={busy !== null}
                        className="w-full py-2 text-sm font-medium rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {busy === 'this' && <Loader2 size={14} className="animate-spin" />}
                        Только эту
                    </button>
                    <button
                        onClick={moveSeries}
                        disabled={busy !== null}
                        className="w-full py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center justify-center gap-2"
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
