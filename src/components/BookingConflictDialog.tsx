import { useEffect, useState } from 'react';
import { AlertTriangle, X, ArrowRight, CalendarClock, Loader2 } from 'lucide-react';
import { RESOURCES, LOCATIONS } from '../utils/data';
import { bookingsApi } from '../api/bookings';
import type { BookingHistoryItem } from '../store/types';
import { formatDateLabel } from '../utils/format';

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

    // «вт, 29 сентября» — общий форматтер (календарная дата, без сдвига пояса).
    const dateLabel = formatDateLabel(primary.date, { fallback: primary.date });

    return (
        <div
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink/45 p-4"
            onClick={onClose}
        >
            <div
                className="bg-card rounded-2xl shadow-[var(--shadow-pop)] w-full max-w-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Шапка: «ждём» (янтарь) — своя бронь, «опасно» (красный) — чужая */}
                <div className={`px-5 py-4 flex items-start gap-3 ${own ? 'bg-[var(--status-pending-bg)]' : 'bg-[var(--status-danger-bg)]'}`}>
                    <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-card ${
                        own ? 'text-[var(--status-pending-fg)]' : 'text-[var(--status-danger-fg)]'
                    }`}>
                        <AlertTriangle size={18} aria-hidden="true" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-semibold text-ink leading-tight">
                            {own ? 'Это ваша бронь' : 'Время уже занято'}
                        </h3>
                        <p className="text-xs text-ink-60 mt-0.5">
                            {resource?.name} · {dateLabel} · {time}
                        </p>
                    </div>
                    <button onClick={onClose} aria-label="Закрыть" className="-m-2.5 w-11 h-11 flex items-center justify-center hover:bg-ink-05 rounded-lg shrink-0">
                        <X size={16} className="text-ink-60" aria-hidden="true" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {conflicts.length > 1 && (
                        <div className="text-xs text-ink-60 bg-sunken rounded-lg px-3 py-2">
                            Конфликт в {conflicts.length} датах серии. Показана первая —
                            остальные решите после.
                        </div>
                    )}

                    {own ? (
                        /* ── Own booking — offer to open it ── */
                        <>
                            <p className="text-sm text-ink leading-relaxed">
                                На это время у вас уже есть бронь этого кабинета.
                                Откройте её, чтобы посмотреть детали или изменить.
                            </p>
                            {ownBooking ? (
                                <button
                                    onClick={() => onOpenBooking(ownBooking.id)}
                                    className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-accent text-on-accent font-semibold text-sm"
                                >
                                    <span className="flex items-center gap-2">
                                        <CalendarClock size={16} aria-hidden="true" /> Открыть мою бронь
                                    </span>
                                    <ArrowRight size={16} aria-hidden="true" />
                                </button>
                            ) : (
                                <div className="text-xs text-ink-60">
                                    Бронь не найдена в вашем списке — обновите страницу
                                    или проверьте «Мои брони».
                                </div>
                            )}
                        </>
                    ) : (
                        /* ── Someone else's slot — suggest free cabinets ── */
                        <>
                            <p className="text-sm text-ink leading-relaxed">
                                {primary.reason}
                            </p>
                            <div>
                                <div className="text-caption font-semibold uppercase tracking-wide text-ink-60 mb-2">
                                    Свободно в {location?.name ?? 'этом центре'} · {time}
                                </div>
                                {loadingAlts ? (
                                    <div className="flex items-center gap-2 text-sm text-ink-60 py-2">
                                        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Ищем свободные кабинеты…
                                    </div>
                                ) : alts.length > 0 ? (
                                    <div className="space-y-1.5">
                                        {alts.map(a => (
                                            <button
                                                key={a.id}
                                                onClick={() => onPickCabinet(a.id, primary.date)}
                                                className="w-full min-h-11 flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-ink-20 hover:border-accent hover:bg-accent-soft transition-colors text-sm font-medium text-ink"
                                            >
                                                <span>{a.name}</span>
                                                <ArrowRight size={15} className="text-accent-ink" aria-hidden="true" />
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-ink-60 py-2">
                                        В это время все кабинеты центра заняты. Попробуйте
                                        другое время или дату.
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    <button
                        onClick={onClose}
                        className="w-full min-h-11 py-2.5 rounded-xl border border-ink-20 text-sm font-medium text-ink-80 hover:bg-ink-05"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
}
