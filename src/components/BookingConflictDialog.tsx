import { useEffect, useState } from 'react';
import { AlertTriangle, X, ArrowRight, CalendarClock, Loader2 } from 'lucide-react';
import { RESOURCES, LOCATIONS } from '../utils/data';
import { bookingsApi } from '../api/bookings';
import type { BookingHistoryItem } from '../store/types';

/**
 * Branded conflict dialog — shown when a booking attempt hits an occupied
 * slot. Replaces the bare red toast with two actionable paths:
 *
 *   1. Conflict with SOMEONE ELSE'S booking → suggest free cabinets in the
 *      same centre at the same date/time (one tap re-books there).
 *   2. Conflict with the USER'S OWN booking → offer to open that booking
 *      so they can view / edit it instead of double-booking.
 *
 * The own-vs-other split is detected from the backend reason string
 * (`check_availability` returns "У вас уже есть бронь …" for own slots).
 */
export interface ConflictItem {
    date: string;    // YYYY-MM-DD
    reason: string;  // backend message
}

interface Props {
    conflicts: ConflictItem[];
    resourceId: string;
    time: string;        // HH:MM
    duration: number;    // minutes
    ownBookings: BookingHistoryItem[];
    onClose: () => void;
    onOpenBooking: (bookingId: string) => void;
    onPickCabinet: (resourceId: string, date: string) => void;
}

const isOwnConflict = (reason: string) =>
    /у вас уже есть/i.test(reason || '');

export function BookingConflictDialog({
    conflicts, resourceId, time, duration, ownBookings,
    onClose, onOpenBooking, onPickCabinet,
}: Props) {
    // Focus on the first conflict — recurring series usually hit one date.
    const primary = conflicts[0];
    const own = primary ? isOwnConflict(primary.reason) : false;

    const resource = RESOURCES.find(r => r.id === resourceId);
    const locationId = resource?.locationId;
    const location = LOCATIONS.find(l => l.id === locationId);

    const [alts, setAlts] = useState<Array<{ id: string; name: string }>>([]);
    const [loadingAlts, setLoadingAlts] = useState(false);

    // Resolve the user's own conflicting booking (same cabinet + date,
    // overlapping the requested window) so "open booking" has a target.
    const ownBooking = primary && own
        ? ownBookings.find(b => {
            // b.date is typed Date but the API often hands back an ISO
            // string — normalise either way to a YYYY-MM-DD prefix.
            const dayStr = String((b as { date?: unknown }).date ?? '').slice(0, 10);
            return b.resourceId === resourceId
                && b.status === 'confirmed'
                && dayStr === primary.date;
        })
        : undefined;

    useEffect(() => {
        // Only look for alternatives when the clash is someone else's slot.
        if (!primary || own || !locationId) return;
        const siblings = RESOURCES.filter(
            r => r.locationId === locationId && r.id !== resourceId && r.isActive !== false,
        );
        if (siblings.length === 0) return;
        setLoadingAlts(true);
        bookingsApi.checkAvailability(
            siblings.map(r => ({
                resourceId: r.id,
                date: primary.date,
                startTime: time,
                duration,
            })),
        )
            .then(results => {
                const free: Array<{ id: string; name: string }> = [];
                results.forEach((res, i) => {
                    if (res.available) {
                        free.push({ id: siblings[i].id, name: siblings[i].name });
                    }
                });
                setAlts(free);
            })
            .catch(() => setAlts([]))
            .finally(() => setLoadingAlts(false));
    }, [primary, own, locationId, resourceId, time, duration]);

    if (!primary) return null;

    const dateLabel = (() => {
        try {
            return new Date(primary.date + 'T00:00:00').toLocaleDateString('ru-RU', {
                day: 'numeric', month: 'long', weekday: 'short',
            });
        } catch { return primary.date; }
    })();

    return (
        <div
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header — amber for "your own", red for someone else's */}
                <div className={`px-5 py-4 flex items-start gap-3 ${own ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
                        own ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                    }`}>
                        <AlertTriangle size={18} />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-unbox-dark leading-tight">
                            {own ? 'Это ваша бронь' : 'Слот уже занят'}
                        </h3>
                        <p className="text-xs text-unbox-grey mt-0.5">
                            {resource?.name} · {dateLabel} · {time}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-black/5 rounded-lg shrink-0">
                        <X size={16} className="text-unbox-grey" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {conflicts.length > 1 && (
                        <div className="text-xs text-unbox-grey bg-unbox-light/60 rounded-lg px-3 py-2">
                            Конфликт в {conflicts.length} датах серии. Показана первая —
                            остальные решите после.
                        </div>
                    )}

                    {own ? (
                        /* ── Own booking — offer to open it ── */
                        <>
                            <p className="text-sm text-unbox-dark leading-relaxed">
                                На это время у вас уже есть бронь этого кабинета.
                                Откройте её, чтобы посмотреть детали или изменить.
                            </p>
                            {ownBooking ? (
                                <button
                                    onClick={() => onOpenBooking(ownBooking.id)}
                                    className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-unbox-green text-white font-semibold text-sm"
                                >
                                    <span className="flex items-center gap-2">
                                        <CalendarClock size={16} /> Открыть мою бронь
                                    </span>
                                    <ArrowRight size={16} />
                                </button>
                            ) : (
                                <div className="text-xs text-unbox-grey">
                                    Бронь не найдена в вашем списке — обновите страницу
                                    или проверьте «Мои брони».
                                </div>
                            )}
                        </>
                    ) : (
                        /* ── Someone else's slot — suggest free cabinets ── */
                        <>
                            <p className="text-sm text-unbox-dark leading-relaxed">
                                {primary.reason}
                            </p>
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-unbox-grey mb-2">
                                    Свободно в {location?.name ?? 'этом центре'} · {time}
                                </div>
                                {loadingAlts ? (
                                    <div className="flex items-center gap-2 text-sm text-unbox-grey py-2">
                                        <Loader2 size={14} className="animate-spin" /> Ищем свободные кабинеты…
                                    </div>
                                ) : alts.length > 0 ? (
                                    <div className="space-y-1.5">
                                        {alts.map(a => (
                                            <button
                                                key={a.id}
                                                onClick={() => onPickCabinet(a.id, primary.date)}
                                                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-unbox-light hover:border-unbox-green/60 hover:bg-unbox-green/5 transition-colors text-sm font-medium text-unbox-dark"
                                            >
                                                <span>{a.name}</span>
                                                <ArrowRight size={15} className="text-unbox-green" />
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-unbox-grey py-2">
                                        В это время все кабинеты центра заняты. Попробуйте
                                        другое время или дату.
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    <button
                        onClick={onClose}
                        className="w-full py-2.5 rounded-xl border border-unbox-light text-sm font-medium text-unbox-grey hover:bg-unbox-light/50"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
}
