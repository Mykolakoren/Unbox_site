import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../api/bookings';
import { formatDayMonth } from '../utils/format';

/**
 * Choice modal shown when an admin / specialist / user has just picked
 * a new date+time for a booking that's part of a recurring series.
 *
 *   - «Перенести только эту» → PATCH /bookings/{id}/reschedule
 *                              The single booking moves; series intact.
 *   - «Перенести эту и следующие» → PATCH /bookings/{id}/reschedule-series
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
                const dates = res.skipped.map(s => formatDayMonth(s.date.slice(0, 10))).join(', ');
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
                <div className="px-4 py-3 text-sm text-ink-80 space-y-1">
                    <p>Перенести только эту бронь или эту и все следующие в серии?</p>
                    <p className="text-xs text-ink-60">
                        Новое время: <span className="num font-medium text-ink">{newStartTime}</span>
                        {newDate && <> · {formatDayMonth(newDate)}</>}
                    </p>
                </div>
                <div className="px-4 pb-4 space-y-2">
                    <button
                        onClick={moveOne}
                        disabled={busy !== null}
                        className="w-full min-h-11 py-2 text-sm font-medium rounded-lg border border-accent bg-card hover:bg-accent-soft text-accent-ink disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {busy === 'this' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                        Перенести только эту
                    </button>
                    <button
                        onClick={moveSeries}
                        disabled={busy !== null}
                        className="w-full min-h-11 py-2 text-sm font-medium rounded-lg bg-accent hover:bg-accent-hover text-on-accent disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {busy === 'series' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                        Перенести эту и следующие
                    </button>
                    <button
                        onClick={onClose}
                        disabled={busy !== null}
                        className="w-full min-h-11 py-2 text-sm font-medium rounded-lg border border-ink-20 bg-card hover:bg-ink-05 text-ink disabled:opacity-50"
                    >
                        Не переносить
                    </button>
                </div>
            </div>
        </div>
    );
}
