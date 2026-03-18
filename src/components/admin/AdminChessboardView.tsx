import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import {
    format, addMinutes, setHours, setMinutes, startOfToday, isBefore,
    addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval,
    isSameDay, isToday,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, Check, Loader2, Search, Plus, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
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

    // Admin booking state
    const [adminBookSlot, setAdminBookSlot] = useState<{ resId: string; time: string; date: Date; duration?: number } | null>(null);

    // ── Drag-to-select NEW booking slots ──
    const [newSlots, setNewSlots] = useState<string[]>([]);
    type NewDragMode = 'new' | 'resize-start' | 'resize-end' | 'move' | null;
    const newDragModeRef = useRef<NewDragMode>(null);
    const newDragStartRef = useRef<{ resId: string; time: string } | null>(null);
    const newDragInitialBlockRef = useRef<{ resId: string; start: number; end: number } | null>(null);
    const newDragMoveOffsetRef = useRef<number>(0);
    const [, setNewDragTick] = useState(0);
    const forceNewDragUpdate = () => setNewDragTick(t => t + 1);

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
            const bd = parseBookingDate(b.date);
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

    // ── Drag-to-select helpers ────────────────────────────────────────────────
    const isSlotOccupied = useCallback((resId: string, time: string) => {
        // Check past
        const now = new Date();
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const nowStr = format(now, 'yyyy-MM-dd');
        if (dateStr < nowStr) return true;
        if (dateStr === nowStr && timeToMin(time) < now.getHours() * 60 + now.getMinutes()) return true;
        return slotMap.has(`${resId}|${time}`);
    }, [selectedDate, slotMap]);

    const selectedNewBlocks = useMemo(() => {
        const byRes: Record<string, number[]> = {};
        for (const slot of newSlots) {
            const [resId, timeStr] = slot.split('|');
            const idx = TIME_SLOTS.indexOf(timeStr);
            if (idx === -1) continue;
            if (!byRes[resId]) byRes[resId] = [];
            byRes[resId].push(idx);
        }
        return Object.entries(byRes).map(([resId, indices]) => {
            const sorted = [...indices].sort((a, b) => a - b);
            return { resId, start: sorted[0], end: sorted[sorted.length - 1] };
        });
    }, [newSlots]);

    const getNewBlockForResource = (resId: string) =>
        selectedNewBlocks.find(b => b.resId === resId) ?? null;

    const isNewSlotSelected = (resId: string, time: string) =>
        newSlots.includes(`${resId}|${time}`);

    const setNewSlotRange = useCallback((resId: string, times: string[]) => {
        setNewSlots(prev => {
            const other = prev.filter(s => !s.startsWith(`${resId}|`));
            return [...other, ...times.map(t => `${resId}|${t}`)];
        });
    }, []);

    // Drag handlers
    const handleNewDragDown = (resId: string, time: string, mode: NewDragMode) => {
        if (isSlotOccupied(resId, time) && mode === 'new') return;

        // If clicking on already-selected slot in 'new' mode → switch to 'move'
        if (mode === 'new' && isNewSlotSelected(resId, time)) {
            const block = getNewBlockForResource(resId);
            if (block) {
                newDragModeRef.current = 'move';
                newDragStartRef.current = { resId, time };
                newDragInitialBlockRef.current = block;
                const clickedIdx = TIME_SLOTS.indexOf(time);
                newDragMoveOffsetRef.current = clickedIdx - block.start;
                forceNewDragUpdate();
                return;
            }
        }

        newDragModeRef.current = mode;
        newDragStartRef.current = { resId, time };
        if (mode === 'new') {
            setNewSlotRange(resId, [time]);
        } else {
            const block = getNewBlockForResource(resId);
            if (block) newDragInitialBlockRef.current = block;
        }
        forceNewDragUpdate();
    };

    const handleNewDragEnter = useCallback((resId: string, time: string) => {
        const mode = newDragModeRef.current;
        const startSlot = newDragStartRef.current;
        const initBlock = newDragInitialBlockRef.current;
        if (!mode || !startSlot) return;
        const currentIdx = TIME_SLOTS.indexOf(time);
        const startIdx = TIME_SLOTS.indexOf(startSlot.time);
        if (currentIdx === -1 || startIdx === -1) return;

        if (mode === 'new') {
            if (startSlot.resId !== resId) return;
            const minIdx = Math.min(startIdx, currentIdx);
            const maxIdx = Math.max(startIdx, currentIdx);
            const slots: string[] = [];
            let blocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) { blocked = true; break; }
                slots.push(TIME_SLOTS[i]);
            }
            if (!blocked) setNewSlotRange(resId, slots);
        } else if (mode === 'resize-end' && initBlock) {
            if (initBlock.resId !== resId) return;
            const minIdx = initBlock.start;
            const maxIdx = Math.max(minIdx, currentIdx);
            const slots: string[] = [];
            let blocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) { blocked = true; break; }
                slots.push(TIME_SLOTS[i]);
            }
            if (!blocked) setNewSlotRange(resId, slots);
        } else if (mode === 'resize-start' && initBlock) {
            if (initBlock.resId !== resId) return;
            const maxIdx = initBlock.end;
            const minIdx = Math.min(maxIdx, currentIdx);
            const slots: string[] = [];
            let blocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) { blocked = true; break; }
                slots.push(TIME_SLOTS[i]);
            }
            if (!blocked) setNewSlotRange(resId, slots);
        } else if (mode === 'move' && initBlock) {
            if (initBlock.resId !== resId) return;
            const blockLen = initBlock.end - initBlock.start + 1;
            const newStart = currentIdx - newDragMoveOffsetRef.current;
            const newEnd = newStart + blockLen - 1;
            if (newStart < 0 || newEnd >= TIME_SLOTS.length) return;
            const slots: string[] = [];
            let blocked = false;
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) { blocked = true; break; }
                slots.push(TIME_SLOTS[i]);
            }
            if (!blocked) setNewSlotRange(resId, slots);
        }
    }, [isSlotOccupied]);

    const handleNewDragUp = useCallback(() => {
        if (!newDragModeRef.current) return;
        const dragResId = newDragStartRef.current?.resId ?? null;
        newDragModeRef.current = null;
        newDragStartRef.current = null;
        newDragInitialBlockRef.current = null;
        forceNewDragUpdate();
        // Min 1h per resource: if the just-dragged resource has only 1 slot, auto-add next
        setNewSlots(prev => {
            if (!dragResId) return prev;
            const resSlots = prev.filter(s => s.startsWith(`${dragResId}|`));
            if (resSlots.length !== 1) return prev;
            const timeStr = resSlots[0].split('|')[1];
            const idx = TIME_SLOTS.indexOf(timeStr);
            if (idx >= 0 && idx + 1 < TIME_SLOTS.length && !isSlotOccupied(dragResId, TIME_SLOTS[idx + 1])) {
                return [...prev, `${dragResId}|${TIME_SLOTS[idx + 1]}`];
            }
            return prev;
        });
    }, [isSlotOccupied]);

    // Global pointer events for drag
    useEffect(() => {
        const handleMove = (e: PointerEvent) => {
            if (!newDragModeRef.current) return;
            if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                const target = document.elementFromPoint(e.clientX, e.clientY);
                if (!target) return;
                const slotEl = target.closest('[data-adm-resid][data-adm-time]');
                if (slotEl) {
                    const rId = slotEl.getAttribute('data-adm-resid');
                    const tStr = slotEl.getAttribute('data-adm-time');
                    if (rId && tStr) handleNewDragEnter(rId, tStr);
                }
            }
        };
        window.addEventListener('pointerup', handleNewDragUp);
        window.addEventListener('pointermove', handleMove);
        return () => {
            window.removeEventListener('pointerup', handleNewDragUp);
            window.removeEventListener('pointermove', handleMove);
        };
    }, [handleNewDragUp, handleNewDragEnter]);

    // Clear selection when date changes
    useEffect(() => { setNewSlots([]); }, [selectedDate]);

    // Handle "Продолжить" — open admin booking modal with pre-filled duration
    const handleContinueNewBooking = () => {
        if (newSlots.length === 0) return;
        const block = selectedNewBlocks[0];
        if (!block) return;
        const startTime = TIME_SLOTS[block.start];
        const duration = (block.end - block.start + 1) * 30;
        setAdminBookSlot({ resId: block.resId, time: startTime, date: selectedDate, duration });
    };

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
                        <col style={{ width: '110px', minWidth: '110px' }} />
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
                            <th className="sticky right-0 bg-unbox-light/40 border-l border-b border-unbox-light/50 z-20 w-28 p-2" />
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
                                        const slotIdx = TIME_SLOTS.indexOf(cell.slot);
                                        const newSel = isNewSlotSelected(resource.id, cell.slot);
                                        const newBlock = newSel ? getNewBlockForResource(resource.id) : null;
                                        const isNewStart = newBlock ? newBlock.start === slotIdx : false;
                                        const isNewEnd = newBlock ? newBlock.end === slotIdx : false;
                                        const isNewSingle = newBlock ? newBlock.start === newBlock.end : false;

                                        const ResHandle = ({ type }: { type: 'start' | 'end' }) => (
                                            <div
                                                className={`absolute top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center z-20 hover:bg-white/20 transition-colors ${type === 'start' ? 'left-0 rounded-l-md' : 'right-0 rounded-r-md'}`}
                                                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handleNewDragDown(resource.id, cell.slot, type === 'start' ? 'resize-start' : 'resize-end'); }}
                                            >
                                                <div className="w-1 h-3 bg-white/70 rounded-full" />
                                            </div>
                                        );

                                        return (
                                            <td
                                                key={cell.slot}
                                                className="border-r border-unbox-light/40 p-0 h-[40px]"
                                            >
                                                <div
                                                    data-adm-resid={resource.id}
                                                    data-adm-time={cell.slot}
                                                    onPointerDown={(e) => {
                                                        if (cell.past) return;
                                                        if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
                                                        e.preventDefault();
                                                        handleNewDragDown(resource.id, cell.slot, 'new');
                                                    }}
                                                    onPointerEnter={() => handleNewDragEnter(resource.id, cell.slot)}
                                                    className={clsx(
                                                        "w-full h-full flex items-center justify-center text-[9px] relative select-none touch-none transition-colors",
                                                        cell.past
                                                            ? "bg-gray-50/60"
                                                            : newSel
                                                                ? "bg-unbox-green text-white z-10 cursor-grab shadow-sm"
                                                                : "hover:bg-unbox-green/10 cursor-pointer",
                                                        newSel && !isNewSingle && !isNewStart && "border-l border-white/20",
                                                        isNewStart && newSel && "rounded-l-lg",
                                                        isNewEnd && newSel && "rounded-r-lg"
                                                    )}
                                                >
                                                    {newSel ? (
                                                        <>
                                                            <div className="flex items-center justify-between w-full h-full px-1 relative">
                                                                {isNewStart && !isNewSingle && <ResHandle type="start" />}
                                                                {isNewStart && (
                                                                    <div className="flex flex-col items-center justify-center w-full">
                                                                        <div className="font-bold text-white text-xs">{cell.slot}</div>
                                                                    </div>
                                                                )}
                                                                {isNewEnd && !isNewSingle && <ResHandle type="end" />}
                                                            </div>
                                                            {isNewEnd && (
                                                                <button
                                                                    onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setNewSlotRange(resource.id, []); }}
                                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); setNewSlotRange(resource.id, []); }}
                                                                    className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-md hover:bg-red-600 hover:scale-110 transition-all z-50"
                                                                    title="Удалить"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                                                </button>
                                                            )}
                                                        </>
                                                    ) : (
                                                        !cell.past && <span className="text-unbox-dark/30">{cell.slot}</span>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    })}

                                    {/* Sticky right column */}
                                    <td className="sticky right-0 bg-white border-l border-unbox-light/40 z-10 h-[40px] p-1.5 shadow-[-4px_0_8px_rgba(71,109,107,0.05)]">
                                        {getNewBlockForResource(resource.id) ? (
                                            <button
                                                onClick={handleContinueNewBooking}
                                                className="flex items-center gap-1 bg-unbox-green text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg shadow-md hover:bg-unbox-dark active:scale-95 transition-all whitespace-nowrap animate-in fade-in zoom-in-90 duration-200 h-full"
                                            >
                                                <ArrowRight size={12} className="shrink-0" />
                                                <span>Продолжить</span>
                                            </button>
                                        ) : null}
                                    </td>
                                </tr>
                            );
                        })}

                        {filteredResources.length === 0 && (
                            <tr>
                                <td
                                    colSpan={TIME_SLOTS.length + 2}
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

            {/* ── Admin Quick Booking Modal ── */}
            {adminBookSlot && (
                <AdminQuickBookingModal
                    slot={adminBookSlot}
                    users={users}
                    onClose={() => { setAdminBookSlot(null); setNewSlots([]); }}
                    onBooked={() => {
                        setAdminBookSlot(null);
                        setNewSlots([]);
                        fetchAllBookings();
                    }}
                />
            )}

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
                            value={resources.find(r => r.id === selectedBooking.resourceId)?.name ?? (selectedBooking.resourceId ?? '')}
                        />
                        <InfoRow
                            label="Дата"
                            value={format(parseBookingDate(selectedBooking.date), 'd MMMM yyyy', { locale: ru })}
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

// ── Admin Quick Booking Modal ───────────────────────────────────────────────
function AdminQuickBookingModal({
    slot,
    users,
    onClose,
    onBooked,
}: {
    slot: { resId: string; time: string; date: Date; duration?: number };
    users: Array<{ id: string; email: string; name: string }>;
    onClose: () => void;
    onBooked: () => void;
}) {
    const resource = RESOURCES.find(r => r.id === slot.resId);
    const [duration, setDuration] = useState(slot.duration ?? 60);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedUser, setSelectedUser] = useState<{ id: string; email: string; name: string } | null>(null);
    const dateStr = format(slot.date, 'yyyy-MM-dd');

    const endTime = (() => {
        const [h, m] = slot.time.split(':').map(Number);
        const end = addMinutes(setMinutes(setHours(slot.date, h), m), duration);
        return format(end, 'HH:mm');
    })();

    const filteredUsers = searchQuery.length >= 1
        ? users.filter(u =>
            u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email?.toLowerCase().includes(searchQuery.toLowerCase())
        ).slice(0, 8)
        : [];

    const handleBook = async () => {
        if (!selectedUser) {
            toast.error('Выберите пользователя');
            return;
        }
        setSaving(true);
        try {
            await bookingsApi.createBooking({
                resourceId: slot.resId,
                date: dateStr, // Send as string 'YYYY-MM-DD' to avoid timezone shift
                startTime: slot.time,
                duration,
                format: resource?.formats?.[0] || 'individual',
                locationId: resource?.locationId,
                targetUserId: selectedUser.email,
            } as any);
            toast.success(`Бронирование создано для ${selectedUser.name}`);
            onBooked();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(', ') : e.message || 'Ошибка бронирования';
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 animate-in slide-in-from-bottom-4 duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <Plus size={18} className="text-unbox-green" />
                            Новое бронирование
                        </h3>
                        <p className="text-sm text-unbox-grey mt-0.5">от имени пользователя</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-unbox-light rounded-lg">
                        <X className="w-5 h-5 text-unbox-grey" />
                    </button>
                </div>

                {/* User search */}
                <div>
                    <label className="text-xs font-medium text-unbox-grey mb-1.5 block">Пользователь</label>
                    {selectedUser ? (
                        <div className="flex items-center justify-between bg-unbox-light/50 rounded-xl px-3 py-2.5">
                            <div>
                                <div className="font-medium text-sm">{selectedUser.name}</div>
                                <div className="text-xs text-unbox-grey">{selectedUser.email}</div>
                            </div>
                            <button
                                onClick={() => { setSelectedUser(null); setSearchQuery(''); }}
                                className="p-1 hover:bg-white rounded-lg"
                            >
                                <X size={14} className="text-unbox-grey" />
                            </button>
                        </div>
                    ) : (
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Поиск по имени или email..."
                                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                autoFocus
                            />
                            {filteredUsers.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-unbox-light shadow-lg max-h-48 overflow-y-auto z-10">
                                    {filteredUsers.map(u => (
                                        <button
                                            key={u.id}
                                            onClick={() => { setSelectedUser(u); setSearchQuery(''); }}
                                            className="w-full text-left px-3 py-2 hover:bg-unbox-light/30 transition-colors text-sm border-b border-unbox-light/30 last:border-0"
                                        >
                                            <div className="font-medium">{u.name}</div>
                                            <div className="text-xs text-unbox-grey">{u.email}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="bg-unbox-light/50 rounded-xl p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                        <span className="text-unbox-grey">Кабинет</span>
                        <span className="font-medium">{resource?.name || slot.resId}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-unbox-grey">Дата</span>
                        <span className="font-medium">{format(slot.date, 'd MMMM yyyy', { locale: ru })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-unbox-grey">Время</span>
                        <span className="font-medium">{slot.time} — {endTime}</span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-unbox-grey mb-1.5 block">Длительность</label>
                    <div className="flex gap-2">
                        {[60, 90, 120, 180].map(d => (
                            <button
                                key={d}
                                onClick={() => setDuration(d)}
                                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                                    duration === d
                                        ? 'bg-unbox-green text-white border-unbox-green'
                                        : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-green/50'
                                }`}
                            >
                                {d >= 120 ? `${d / 60}ч` : `${d}м`}
                            </button>
                        ))}
                    </div>
                </div>

                <button
                    onClick={handleBook}
                    disabled={saving || !selectedUser}
                    className="w-full py-3 bg-unbox-green text-white font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Забронировать
                </button>
            </div>
        </div>
    );
}
