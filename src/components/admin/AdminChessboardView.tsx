import { useState, useMemo, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { LOCATIONS } from '../../utils/data';
import {
    format, addMinutes, setHours, setMinutes, startOfToday, isBefore,
    addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval,
    isSameDay, isToday,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import clsx from 'clsx';
import type { BookingHistoryItem } from '../../store/types';

// ─── Time Slots: 09:00 – 20:30 (30-min steps) ───────────────────────────────
const TIME_SLOTS: string[] = (() => {
    const slots: string[] = [];
    let t = setMinutes(setHours(startOfToday(), 9), 0);
    const end = setMinutes(setHours(startOfToday(), 21), 0);
    while (isBefore(t, end)) {
        slots.push(format(t, 'HH:mm'));
        t = addMinutes(t, 30);
    }
    return slots;
})();

const timeToMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

const parseBookingDate = (d: string | Date): Date => {
    if (d instanceof Date) return d;
    const s = String(d);
    return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
};

// ─── Cell types ──────────────────────────────────────────────────────────────
type CellInfo =
    | { type: 'free'; slot: string; past: boolean }
    | { type: 'booking'; slot: string; booking: BookingHistoryItem; colspan: number };

// ─── Component ───────────────────────────────────────────────────────────────
export function AdminChessboardView() {
    const { bookings, users, fetchAllBookings, cancelBooking, listForReRent, setManualPrice } = useUserStore();
    const { resources, fetchResources } = useBookingStore();

    const [filterLocation, setFilterLocation] = useState<string>('all');
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [selectedBooking, setSelectedBooking] = useState<BookingHistoryItem | null>(null);

    useEffect(() => {
        fetchAllBookings();
        fetchResources();
    }, [fetchAllBookings, fetchResources]);

    // ── Week days ──────────────────────────────────────────────────────────────
    const weekDays = useMemo(() =>
        eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) }),
        [weekStart]
    );

    // ── Filtered resources ────────────────────────────────────────────────────
    const filteredResources = useMemo(() =>
        resources.filter(r =>
            r.isActive !== false &&
            (filterLocation === 'all' || r.locationId === filterLocation)
        ),
        [resources, filterLocation]
    );

    // ── User name helper ──────────────────────────────────────────────────────
    const getUserName = (userId: string) => {
        const u = users.find(u => u.email === userId || u.id === userId);
        return u?.name || userId.split('@')[0] || userId.slice(0, 10);
    };

    // ── Bookings on selected date ─────────────────────────────────────────────
    const bookingsOnDate = useMemo(() => {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        return bookings.filter(b => {
            if (!b.date) return false;
            const bd = parseBookingDate(b.date as string);
            return format(bd, 'yyyy-MM-dd') === dateStr &&
                (b.status === 'confirmed' || b.status === 're-rented' || b.status === 'completed');
        });
    }, [bookings, selectedDate]);

    // ── Slot map: `${resourceId}|${slot}` → {booking, isStart} ───────────────
    const slotMap = useMemo(() => {
        const map = new Map<string, { booking: BookingHistoryItem; isStart: boolean }>();
        bookingsOnDate.forEach(booking => {
            if (!booking.startTime || !booking.duration || !booking.resourceId) return;
            const startMin = timeToMin(booking.startTime);
            const dur = booking.duration;
            TIME_SLOTS.forEach(slot => {
                const sMin = timeToMin(slot);
                if (sMin >= startMin && sMin < startMin + dur) {
                    map.set(`${booking.resourceId}|${slot}`, {
                        booking,
                        isStart: sMin === startMin,
                    });
                }
            });
        });
        return map;
    }, [bookingsOnDate]);

    // ── Row cells (pre-processed, handles colspan/skip) ───────────────────────
    const rowCellsMap = useMemo(() => {
        const now = new Date();
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const nowStr = format(now, 'yyyy-MM-dd');

        const isPast = (slot: string): boolean => {
            if (dateStr < nowStr) return true;
            if (dateStr > nowStr) return false;
            return timeToMin(slot) < now.getHours() * 60 + now.getMinutes();
        };

        const map = new Map<string, CellInfo[]>();
        filteredResources.forEach(resource => {
            const cells: CellInfo[] = [];
            let i = 0;
            while (i < TIME_SLOTS.length) {
                const slot = TIME_SLOTS[i];
                const entry = slotMap.get(`${resource.id}|${slot}`);
                if (entry?.isStart) {
                    const colspan = Math.min(
                        Math.ceil((entry.booking.duration || 60) / 30),
                        TIME_SLOTS.length - i
                    );
                    cells.push({ type: 'booking', slot, booking: entry.booking, colspan });
                    i += colspan;
                } else {
                    cells.push({ type: 'free', slot, past: isPast(slot) });
                    i++;
                }
            }
            map.set(resource.id, cells);
        });
        return map;
    }, [filteredResources, slotMap, selectedDate]);

    // ── Booking block style ───────────────────────────────────────────────────
    const getBookingStyle = (b: BookingHistoryItem) => {
        if (b.status === 'completed')  return 'bg-gray-100 text-gray-500 border-gray-200';
        if (b.status === 're-rented')  return 'bg-orange-100 text-orange-700 border-orange-200';
        if (b.isReRentListed)          return 'bg-amber-50 text-amber-700 border-amber-300 border-dashed';
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    };

    // ── Popup status label ────────────────────────────────────────────────────
    const statusLabel = (b: BookingHistoryItem) => {
        if (b.status === 'confirmed')  return b.isReRentListed ? '📤 На переаренде' : '✅ Активно';
        if (b.status === 're-rented')  return '🔄 Пересдано';
        if (b.status === 'completed')  return '☑️ Завершено';
        return b.status;
    };

    // ── Actions ───────────────────────────────────────────────────────────────
    const handleCancel = (id: string) => {
        if (confirm('Отменить это бронирование?')) {
            cancelBooking(id);
            setSelectedBooking(null);
        }
    };
    const handleEditPrice = (b: BookingHistoryItem) => {
        const val = prompt('Новая цена (GEL):', String(b.finalPrice));
        if (val !== null) {
            const p = parseFloat(val);
            if (!isNaN(p)) { setManualPrice(b.id, p); setSelectedBooking(null); }
        }
    };
    const handleToggleReRent = (b: BookingHistoryItem) => {
        listForReRent(b.id);
        setSelectedBooking(null);
    };

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="space-y-4">

            {/* ── Controls row ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Location filter */}
                <div className="flex gap-1.5 flex-wrap">
                    {[{ id: 'all', name: 'Все' } as const, ...LOCATIONS].map(loc => (
                        <button
                            key={loc.id}
                            onClick={() => setFilterLocation(loc.id)}
                            className={clsx(
                                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                                filterLocation === loc.id
                                    ? 'bg-unbox-green text-white border-unbox-green'
                                    : 'bg-white text-unbox-grey border-unbox-light hover:bg-unbox-light/50'
                            )}
                        >
                            {loc.name}
                        </button>
                    ))}
                </div>

                {/* Week navigation */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setWeekStart(subWeeks(weekStart, 1))}
                        className="p-1.5 rounded-lg border border-unbox-light hover:bg-unbox-light transition-colors"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-medium min-w-[170px] text-center">
                        {format(weekStart, 'd MMM', { locale: ru })}
                        {' – '}
                        {format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'd MMM yyyy', { locale: ru })}
                    </span>
                    <button
                        onClick={() => setWeekStart(addWeeks(weekStart, 1))}
                        className="p-1.5 rounded-lg border border-unbox-light hover:bg-unbox-light transition-colors"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>

            {/* ── Day tabs ── */}
            <div className="flex gap-2 overflow-x-auto pb-1">
                {weekDays.map(day => (
                    <button
                        key={day.toISOString()}
                        onClick={() => setSelectedDate(day)}
                        className={clsx(
                            'flex flex-col items-center px-4 py-2 rounded-xl text-sm border min-w-[72px] transition-colors flex-shrink-0',
                            isSameDay(day, selectedDate)
                                ? 'bg-unbox-green text-white border-unbox-green shadow-sm'
                                : isToday(day)
                                    ? 'bg-unbox-light text-unbox-green border-unbox-green/40 font-semibold'
                                    : 'bg-white text-unbox-dark border-unbox-light hover:bg-unbox-light/30'
                        )}
                    >
                        <span className="font-bold text-base leading-tight">{format(day, 'd')}</span>
                        <span className="text-[11px] capitalize">{format(day, 'EEE', { locale: ru })}</span>
                    </button>
                ))}
            </div>

            {/* ── Grid ── */}
            <div className="overflow-x-auto rounded-xl border border-unbox-light shadow-sm bg-white">
                <table
                    className="border-collapse text-xs"
                    style={{ minWidth: `${130 + TIME_SLOTS.length * 44}px` }}
                >
                    {/* Column widths */}
                    <colgroup>
                        <col style={{ width: '130px', minWidth: '130px' }} />
                        {TIME_SLOTS.map(s => <col key={s} style={{ width: '44px', minWidth: '44px' }} />)}
                    </colgroup>

                    {/* Header: time labels */}
                    <thead>
                        <tr className="bg-unbox-light/40">
                            <th className="p-2 text-left font-semibold text-unbox-dark border-r border-b border-unbox-light">
                                Ресурс
                            </th>
                            {TIME_SLOTS.map(slot => (
                                <th
                                    key={slot}
                                    className="border-r border-b border-unbox-light/50 text-center py-1.5 px-0"
                                >
                                    {slot.endsWith(':00')
                                        ? <span className="font-semibold text-unbox-dark text-[11px]">{slot.slice(0, 2)}</span>
                                        : <span className="text-unbox-light/60 text-[10px]">·</span>
                                    }
                                </th>
                            ))}
                        </tr>
                    </thead>

                    {/* Body: one row per resource */}
                    <tbody>
                        {filteredResources.map(resource => {
                            const cells = rowCellsMap.get(resource.id) ?? [];
                            return (
                                <tr key={resource.id} className="border-b border-unbox-light/40 group">
                                    {/* Resource label */}
                                    <td className="border-r border-unbox-light p-2 bg-white group-hover:bg-unbox-light/10 transition-colors">
                                        <div className="font-semibold text-unbox-dark text-[12px] leading-tight truncate">
                                            {resource.name}
                                        </div>
                                        <div className="text-[10px] text-unbox-grey font-normal mt-0.5">
                                            {LOCATIONS.find(l => l.id === resource.locationId)?.name ?? ''}
                                        </div>
                                    </td>

                                    {/* Time cells */}
                                    {cells.map(cell => {
                                        if (cell.type === 'booking') {
                                            const b = cell.booking;
                                            const isSelected = selectedBooking?.id === b.id;
                                            return (
                                                <td
                                                    key={cell.slot}
                                                    colSpan={cell.colspan}
                                                    className="p-0.5 border-r border-unbox-light/40"
                                                >
                                                    <button
                                                        onClick={() => setSelectedBooking(isSelected ? null : b)}
                                                        className={clsx(
                                                            'w-full h-[38px] rounded border px-1 py-0.5 text-left overflow-hidden transition-all',
                                                            getBookingStyle(b),
                                                            isSelected
                                                                ? 'ring-2 ring-unbox-green ring-offset-1 shadow-sm'
                                                                : 'hover:brightness-95 hover:shadow-sm'
                                                        )}
                                                        title={`${getUserName(b.userId)} · ${b.startTime} (${(b.duration || 60) / 60}ч) · ${b.finalPrice}₾`}
                                                    >
                                                        <div className="font-semibold truncate text-[10px] leading-tight">
                                                            {getUserName(b.userId)}
                                                        </div>
                                                        {(cell.colspan ?? 1) >= 3 && (
                                                            <div className="text-[9px] opacity-60 truncate">
                                                                {b.startTime} · {b.finalPrice}₾
                                                            </div>
                                                        )}
                                                    </button>
                                                </td>
                                            );
                                        }

                                        // Free slot
                                        return (
                                            <td
                                                key={cell.slot}
                                                className={clsx(
                                                    'border-r border-unbox-light/40 p-0 h-[40px]',
                                                    cell.past ? 'bg-gray-50/60' : ''
                                                )}
                                            >
                                                {!cell.past && (
                                                    <div className="w-full h-full hover:bg-unbox-green/10 cursor-pointer transition-colors" />
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}

                        {filteredResources.length === 0 && (
                            <tr>
                                <td
                                    colSpan={TIME_SLOTS.length + 1}
                                    className="p-10 text-center text-unbox-grey"
                                >
                                    Нет ресурсов для отображения
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* ── Legend ── */}
            <div className="flex flex-wrap gap-4 text-xs text-unbox-grey pt-1">
                <LegendItem color="bg-emerald-100 border-emerald-200" label="Активное бронирование" />
                <LegendItem color="bg-amber-50 border-amber-300 border-dashed" label="На переаренде" />
                <LegendItem color="bg-orange-100 border-orange-200" label="Пересдано" />
                <LegendItem color="bg-gray-100 border-gray-200" label="Завершено" />
                <LegendItem color="bg-gray-50 border-gray-100" label="Прошедшее время" />
            </div>

            {/* ── Booking detail popup (bottom-right) ── */}
            {selectedBooking && (
                <div className="fixed bottom-6 right-6 z-50 w-72 bg-white rounded-2xl shadow-2xl border border-unbox-light/60 animate-in slide-in-from-bottom-2 duration-200">
                    {/* Header */}
                    <div className="px-4 py-3 flex justify-between items-start border-b border-unbox-light">
                        <div className="overflow-hidden">
                            <div className="font-bold text-unbox-dark text-sm leading-tight">
                                {getUserName(selectedBooking.userId)}
                            </div>
                            <div className="text-[11px] text-unbox-grey truncate">
                                {selectedBooking.userId}
                            </div>
                        </div>
                        <button
                            onClick={() => setSelectedBooking(null)}
                            className="p-1 hover:bg-unbox-light rounded-lg -mt-0.5 -mr-1 flex-shrink-0"
                        >
                            <X size={15} />
                        </button>
                    </div>

                    {/* Details */}
                    <div className="p-4 space-y-2.5 text-sm">
                        <InfoRow
                            label="Ресурс"
                            value={resources.find(r => r.id === selectedBooking.resourceId)?.name ?? selectedBooking.resourceId}
                        />
                        <InfoRow
                            label="Дата"
                            value={format(parseBookingDate(selectedBooking.date as string), 'd MMMM yyyy', { locale: ru })}
                        />
                        <InfoRow
                            label="Время"
                            value={`${selectedBooking.startTime} · ${(selectedBooking.duration ?? 0) / 60}ч`}
                        />
                        <InfoRow
                            label="Цена"
                            value={`${selectedBooking.finalPrice} ₾`}
                        />
                        <InfoRow
                            label="Статус"
                            value={statusLabel(selectedBooking)}
                        />
                    </div>

                    {/* Actions (only for active bookings) */}
                    {selectedBooking.status === 'confirmed' && (
                        <div className="px-3 pb-3 grid grid-cols-3 gap-1.5">
                            <button
                                onClick={() => handleEditPrice(selectedBooking)}
                                className="py-1.5 text-xs font-medium rounded-lg bg-unbox-light hover:bg-unbox-light/70 text-unbox-dark transition-colors"
                            >
                                Цена
                            </button>
                            <button
                                onClick={() => handleToggleReRent(selectedBooking)}
                                className="py-1.5 text-xs font-medium rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 transition-colors"
                            >
                                {selectedBooking.isReRentListed ? 'Снять' : 'Пересдать'}
                            </button>
                            <button
                                onClick={() => handleCancel(selectedBooking.id)}
                                className="py-1.5 text-xs font-medium rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                            >
                                Отмена
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function LegendItem({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className={clsx('w-3 h-3 rounded border inline-block flex-shrink-0', color)} />
            {label}
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between gap-3">
            <span className="text-unbox-grey shrink-0">{label}</span>
            <span className="font-medium text-unbox-dark text-right">{value}</span>
        </div>
    );
}
