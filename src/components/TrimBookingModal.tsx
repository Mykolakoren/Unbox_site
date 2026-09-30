import { useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../api/bookings';
import { formatGel } from '../utils/format';

/**
 * Partial cancellation ("trim") modal.
 *
 * Lets the user remove a contiguous range from the MIDDLE or an EDGE of a
 * booking. The backend (`POST /bookings/{id}/trim`) splits the booking into
 * the surviving remnant(s) and refunds the trimmed portion — the refund is
 * discount-adjusted server-side, so we never try to compute money here, we
 * only show the surviving ranges as a preview.
 *
 * Validation mirrors the backend so the user gets instant feedback:
 *   - each surviving part must be ≥ 1h (60 min), and
 *   - trimming the whole booking is rejected (use the regular cancel flow).
 */

/** minutes-since-midnight → "HH:MM" */
function fmt(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "HH:MM" → minutes-since-midnight */
function parse(t: string): number {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

export function TrimBookingModal({
    booking,
    onClose,
    onDone,
}: {
    booking: { id: string; startTime: string; duration: number; date?: string };
    onClose: () => void;
    onDone: () => void;
}) {
    const startMin = parse(booking.startTime);
    const endMin = startMin + booking.duration;

    // Default: remove the first hour from the start.
    const [removeFrom, setRemoveFrom] = useState(startMin);
    const [removeTo, setRemoveTo] = useState(Math.min(startMin + 60, endMin));
    const [busy, setBusy] = useState(false);

    // Every 30-min mark inside the booking window.
    const marks = useMemo(() => {
        const out: number[] = [];
        for (let m = startMin; m <= endMin; m += 30) out.push(m);
        return out;
    }, [startMin, endMin]);

    const fromOptions = marks.filter(m => m <= endMin - 30);
    const toOptions = marks.filter(m => m > removeFrom);

    // Keep removeTo valid whenever removeFrom moves past it.
    const effectiveTo = removeTo > removeFrom ? removeTo : removeFrom + 30;

    const left = removeFrom - startMin;       // surviving minutes before the cut
    const right = endMin - effectiveTo;       // surviving minutes after the cut

    const wholeBooking = left === 0 && right === 0;
    const remnantTooShort = (left > 0 && left < 60) || (right > 0 && right < 60);

    let error: string | null = null;
    if (wholeBooking) {
        error = 'Так отменяется вся бронь — используйте обычную отмену';
    } else if (remnantTooShort) {
        error = 'Каждая оставшаяся часть должна быть не короче 1 часа';
    }

    const valid = !error;

    // Surviving ranges, in order, for the preview.
    const remnantRanges: string[] = [];
    if (left > 0) remnantRanges.push(`${fmt(startMin)}–${fmt(removeFrom)}`);
    if (right > 0) remnantRanges.push(`${fmt(effectiveTo)}–${fmt(endMin)}`);

    const confirm = async () => {
        if (!valid || busy) return;
        setBusy(true);
        try {
            const res = await bookingsApi.trimBooking(booking.id, {
                remove_from: fmt(removeFrom),
                remove_to: fmt(effectiveTo),
            });
            if (typeof res.refunded_amount === 'number' && res.refunded_amount > 0) {
                toast.success(`Возвращено ${formatGel(res.refunded_amount)}`);
            } else if (typeof res.refunded_hours === 'number' && res.refunded_hours > 0) {
                toast.success(`Возвращено ${res.refunded_hours} ч`);
            } else {
                toast.success('Бронь обновлена');
            }
            onDone();
            onClose();
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast.error(typeof detail === 'string' ? detail : 'Не удалось отменить часть брони');
            // keep modal open so the user can adjust
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[1000] bg-ink/45 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
            <div className="bg-card rounded-2xl shadow-[var(--shadow-pop)] w-full max-w-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-ink-10">
                    <div className="font-semibold text-ink">Отменить часть брони</div>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Закрыть"
                        className="-m-2.5 w-11 h-11 flex items-center justify-center hover:bg-ink-05 rounded-lg disabled:opacity-30"
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>

                <div className="px-4 py-3 space-y-3">
                    <div className="text-sm text-ink-60">
                        Бронь: <span className="num font-medium text-ink">{fmt(startMin)}–{fmt(endMin)}</span>
                    </div>

                    {/* Range selectors */}
                    <div className="flex items-end gap-2">
                        <label className="flex-1">
                            <div className="text-caption text-ink-60 mb-1">Убрать с</div>
                            <select
                                value={removeFrom}
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setRemoveFrom(v);
                                    if (removeTo <= v) setRemoveTo(v + 30);
                                }}
                                disabled={busy}
                                className="w-full min-h-11 px-2 py-2 text-sm rounded-lg border border-ink-20 bg-card focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                            >
                                {fromOptions.map(m => (
                                    <option key={m} value={m}>{fmt(m)}</option>
                                ))}
                            </select>
                        </label>
                        <label className="flex-1">
                            <div className="text-caption text-ink-60 mb-1">по</div>
                            <select
                                value={effectiveTo}
                                onChange={(e) => setRemoveTo(Number(e.target.value))}
                                disabled={busy}
                                className="w-full min-h-11 px-2 py-2 text-sm rounded-lg border border-ink-20 bg-card focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                            >
                                {toOptions.map(m => (
                                    <option key={m} value={m}>{fmt(m)}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {/* Error / preview */}
                    {error ? (
                        <div className="text-sm text-[var(--status-danger-fg)]">{error}</div>
                    ) : (
                        <div className="space-y-1">
                            <div className="text-sm text-ink">
                                Останется: <span className="font-medium">{remnantRanges.join(' и ')}</span>
                            </div>
                            <div className="text-caption text-ink-60">
                                Сумма возврата и пересчёт скидки рассчитаются при подтверждении.
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-4 pb-4 space-y-2">
                    <button
                        onClick={confirm}
                        disabled={!valid || busy}
                        className="w-full min-h-11 py-2 text-sm font-medium rounded-lg bg-[var(--status-danger-solid)] hover:brightness-95 text-card disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                        {busy ? 'Отменяем…' : 'Отменить выбранное'}
                    </button>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="w-full min-h-11 py-2 text-sm font-medium rounded-lg border border-ink-20 bg-card hover:bg-ink-05 text-ink disabled:opacity-50"
                    >
                        Оставить как есть
                    </button>
                </div>
            </div>
        </div>
    );
}
