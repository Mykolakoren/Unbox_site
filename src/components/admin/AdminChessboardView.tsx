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
import { isPeakTime } from '../../utils/pricing';
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
    const getUserName = (userId: string | undefined | null) => {
        if (!userId) return 'Гость';
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
            // Admin can book up to 12 hours in the past
            const slotMin = timeToMin(slot);
            const slotDate = new Date(selectedDate);
            slotDate.setHours(Math.floor(slotMin / 60), slotMin % 60, 0, 0);
            const hoursAgo = (now.getTime() - slotDate.getTime()) / (1000 * 60 * 60);
            if (hoursAgo > 0 && hoursAgo <= 12) return false; // Allow recent past for admins
            if (dateStr < nowStr) return true;
            if (dateStr > nowStr) return false;
            return slotMin < now.getHours() * 60 + now.getMinutes();
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

    // ── Mobile detection ──
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    const [mobileResIdx, setMobileResIdx] = useState(0);
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);
    const mobileRes = filteredResources[mobileResIdx] ?? filteredResources[0] ?? null;

    // ── Mobile hour-pairs for 2-column grid ──
    const mobileHourPairs = useMemo(() => {
        const pairs: [string, string | null][] = [];
        for (let i = 0; i < TIME_SLOTS.length; i += 2) {
            pairs.push([TIME_SLOTS[i], TIME_SLOTS[i + 1] ?? null]);
        }
        return pairs;
    }, []);

    // ── Mobile tap handler ──
    const handleMobileTap = (resId: string, time: string, _isHourTap: boolean) => {
        if (isSlotOccupied(resId, time)) return;
        const slotIdx = TIME_SLOTS.indexOf(time);
        const block = getNewBlockForResource(resId);

        // Deselect if tapping selected slot
        if (newSlots.includes(`${resId}|${time}`)) {
            setNewSlotRange(resId, []);
            return;
        }

        if (block) {
            // Extending — always +1 slot at a time
            const newStart = Math.min(block.start, slotIdx);
            const newEnd = Math.max(block.end, slotIdx);
            const slots: string[] = [];
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) return;
                slots.push(TIME_SLOTS[i]);
            }
            setNewSlotRange(resId, slots);
        } else {
            // First selection — ALWAYS auto-select pair (1h minimum)
            const pairStart = slotIdx % 2 === 0 ? slotIdx : slotIdx - 1;
            const pairEnd = pairStart + 1;
            if (pairEnd >= TIME_SLOTS.length) return;
            const slots: string[] = [];
            for (let i = pairStart; i <= pairEnd; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) return;
                slots.push(TIME_SLOTS[i]);
            }
            setNewSlotRange(resId, slots);
        }
    };

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
        if (b.status === 'completed')  return 'bg-gray-200 text-gray-600 border-gray-300';
        if (b.status === 're-rented')  return 'bg-orange-200 text-orange-800 border-orange-400';
        if (b.isReRentListed)          return 'bg-amber-100 text-amber-800 border-amber-400 border-dashed';
        return 'bg-emerald-100 text-emerald-900 border-emerald-400';
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

    // ── MOBILE VIEW ──
    if (isMobile) {
        const mobileBlock = mobileRes ? getNewBlockForResource(mobileRes.id) : null;
        const mobileBlockStartTime = mobileBlock ? TIME_SLOTS[mobileBlock.start] : null;
        const mobileBlockEndTime = mobileBlock ? (() => {
            const [h, m] = TIME_SLOTS[mobileBlock.end].split(':').map(Number);
            return format(addMinutes(setMinutes(setHours(startOfToday(), h), m), 30), 'HH:mm');
        })() : null;
        const mobileBlockDuration = mobileBlock ? (mobileBlock.end - mobileBlock.start + 1) * 30 : 0;

        // Build slot lookup for current mobile resource
        const mobileCells = mobileRes ? (rowCellsMap.get(mobileRes.id) ?? []) : [];
        const mobileBookingBySlot = new Map<string, CellInfo>();
        const mobileConsumed = new Set<string>();
        mobileCells.forEach(cell => {
            if (cell.type === 'booking') {
                mobileBookingBySlot.set(cell.slot, cell);
                // Mark consumed slots
                const startIdx = TIME_SLOTS.indexOf(cell.slot);
                for (let i = 1; i < cell.colspan; i++) {
                    if (startIdx + i < TIME_SLOTS.length) {
                        mobileConsumed.add(TIME_SLOTS[startIdx + i]);
                    }
                }
            }
        });

        const renderMobileSlot = (slot: string | null, isHourCol: boolean) => {
            if (!slot || !mobileRes) return <div className="flex-1" />;
            if (mobileConsumed.has(slot)) return null;

            const bookingCell = mobileBookingBySlot.get(slot);
            if (bookingCell && bookingCell.type === 'booking') {
                const b = bookingCell.booking;
                const endSlotIdx = TIME_SLOTS.indexOf(slot) + bookingCell.colspan;
                const endTime = endSlotIdx < TIME_SLOTS.length ? TIME_SLOTS[endSlotIdx] : '21:00';
                return (
                    <button
                        onClick={() => setSelectedBooking(b)}
                        className={clsx(
                            'flex-1 flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-colors min-h-[48px] border',
                            getBookingStyle(b)
                        )}
                    >
                        <div className="min-w-0">
                            <div className="text-[10px] font-bold tabular-nums">{slot}–{endTime}</div>
                            <div className="text-[10px] truncate font-medium">{getUserName(b.userId)}</div>
                        </div>
                    </button>
                );
            }

            // Free slot
            const past = (() => {
                const cell = mobileCells.find(c => c.slot === slot);
                return cell?.type === 'free' ? cell.past : false;
            })();
            const selected = isNewSlotSelected(mobileRes.id, slot);

            return (
                <button
                    onClick={() => !past && handleMobileTap(mobileRes.id, slot, isHourCol)}
                    disabled={past}
                    className={clsx(
                        'flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl transition-all min-h-[48px]',
                        past
                            ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                            : selected
                                ? 'bg-unbox-green text-white shadow-sm'
                                : isPeakTime(slot)
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200/60 active:scale-[0.97]'
                                    : 'bg-white text-gray-700 border border-gray-100 active:scale-[0.97]'
                    )}
                >
                    <span className={clsx('text-sm font-bold tabular-nums', selected ? 'text-white' : past ? 'text-gray-300' : 'text-gray-700')}>
                        {slot}
                    </span>
                    {selected ? (
                        <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        </div>
                    ) : !past ? (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
                    ) : null}
                </button>
            );
        };

        return (
            <div className="space-y-3 pb-28">
                {/* Location filter */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                    {[{ id: 'all', name: 'Все' } as const, ...LOCATIONS].map(loc => (
                        <button
                            key={loc.id}
                            onClick={() => setFilterLocation(loc.id)}
                            className={clsx(
                                'shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                                filterLocation === loc.id
                                    ? 'bg-unbox-green text-white border-unbox-green'
                                    : 'bg-white text-unbox-grey border-unbox-light'
                            )}
                        >
                            {loc.name}
                        </button>
                    ))}
                </div>

                {/* Week nav */}
                <div className="flex items-center gap-1">
                    <button onClick={() => setWeekStart(subWeeks(weekStart, 1))} className="p-1.5 rounded-lg border border-unbox-light">
                        <ChevronLeft size={16} />
                    </button>
                    <div className="flex-1 text-center text-sm font-medium">
                        {format(weekStart, 'd MMM', { locale: ru })} – {format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'd MMM', { locale: ru })}
                    </div>
                    <button onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="p-1.5 rounded-lg border border-unbox-light">
                        <ChevronRight size={16} />
                    </button>
                </div>

                {/* Day selector */}
                <div className="grid grid-cols-7 gap-1">
                    {weekDays.map(day => (
                        <button
                            key={day.toISOString()}
                            onClick={() => setSelectedDate(day)}
                            className={clsx(
                                'flex flex-col items-center py-2 rounded-xl text-xs transition-all',
                                isSameDay(day, selectedDate)
                                    ? 'bg-unbox-green text-white shadow-md'
                                    : isToday(day)
                                        ? 'bg-unbox-light text-unbox-green border border-unbox-green/40'
                                        : 'bg-white text-unbox-grey border border-unbox-light/50'
                            )}
                        >
                            <span className="text-[9px] font-bold uppercase">{format(day, 'EEEEEE', { locale: ru })}</span>
                            <span className="text-sm font-bold">{format(day, 'd')}</span>
                        </button>
                    ))}
                </div>

                {/* Resource tabs */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                    {filteredResources.map((r, idx) => (
                        <button
                            key={r.id}
                            onClick={() => setMobileResIdx(idx)}
                            className={clsx(
                                'shrink-0 px-3 py-2 rounded-xl text-xs font-medium border transition-colors',
                                mobileResIdx === idx
                                    ? 'bg-unbox-green text-white border-unbox-green'
                                    : 'bg-white text-gray-500 border-gray-200'
                            )}
                        >
                            <div className="font-bold whitespace-nowrap">{r.name}</div>
                            <div className="text-[10px] opacity-70 whitespace-nowrap">
                                {LOCATIONS.find(l => l.id === r.locationId)?.name ?? ''}
                            </div>
                        </button>
                    ))}
                </div>

                {/* Selected block summary */}
                {mobileBlock && mobileRes && (
                    <div className="flex items-center justify-between bg-unbox-green/10 border border-unbox-green/20 rounded-xl px-4 py-3">
                        <div>
                            <div className="text-sm font-bold text-unbox-dark">{mobileBlockStartTime} — {mobileBlockEndTime}</div>
                            <div className="text-xs text-unbox-grey">{mobileBlockDuration} мин · {mobileRes.name}</div>
                        </div>
                        <button
                            onClick={() => setNewSlotRange(mobileRes.id, [])}
                            className="p-1.5 rounded-lg bg-red-100 text-red-500"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* 2-column time grid */}
                <div className="rounded-2xl bg-white border border-gray-100 p-2 space-y-1">
                    {mobileHourPairs.map(([left, right]) => {
                        const leftRendered = renderMobileSlot(left, true);
                        const rightRendered = right ? renderMobileSlot(right, false) : <div className="flex-1" />;
                        if (!leftRendered && !rightRendered) return null;
                        return (
                            <div key={left} className="flex gap-1.5">
                                {leftRendered || <div className="flex-1" />}
                                {rightRendered}
                            </div>
                        );
                    })}
                </div>

                {/* Bottom bar */}
                {mobileBlock && (
                    <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-3">
                        <div
                            className="rounded-2xl p-3.5 flex items-center justify-between"
                            style={{
                                background: 'rgba(255,255,255,0.85)',
                                backdropFilter: 'blur(24px)',
                                WebkitBackdropFilter: 'blur(24px)',
                                border: '1px solid rgba(255,255,255,0.50)',
                                boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
                            }}
                        >
                            <div className="text-sm text-unbox-dark">
                                <span className="font-bold text-unbox-green">{mobileBlockDuration} мин</span> выбрано
                            </div>
                            <button
                                onClick={handleContinueNewBooking}
                                className="bg-unbox-green text-white font-medium text-sm px-5 py-2.5 rounded-xl shadow-md flex items-center gap-1.5"
                            >
                                Продолжить <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Admin booking modal */}
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

                {/* Booking detail popup */}
                {selectedBooking && (
                    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-3" onClick={() => setSelectedBooking(null)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 animate-in slide-in-from-bottom-4 duration-200" onClick={e => e.stopPropagation()}>
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <div className="font-bold text-unbox-dark">{getUserName(selectedBooking.userId)}</div>
                                    <div className="text-xs text-unbox-grey">{selectedBooking.userId}</div>
                                </div>
                                <button onClick={() => setSelectedBooking(null)} className="p-1 hover:bg-unbox-light rounded-lg">
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="space-y-2 text-sm mb-4">
                                <InfoRow label="Ресурс" value={resources.find(r => r.id === selectedBooking.resourceId)?.name ?? ''} />
                                <InfoRow label="Дата" value={format(parseBookingDate(selectedBooking.date), 'd MMMM yyyy', { locale: ru })} />
                                <InfoRow label="Время" value={`${selectedBooking.startTime} · ${(selectedBooking.duration ?? 0) / 60}ч`} />
                                <InfoRow label="Цена" value={`${selectedBooking.finalPrice} ₾`} />
                                <InfoRow label="Статус" value={statusLabel(selectedBooking)} />
                            </div>
                            {selectedBooking.status === 'confirmed' && (
                                <div className="grid grid-cols-3 gap-1.5">
                                    <button onClick={() => handleEditPrice(selectedBooking)} className="py-2 text-xs font-medium rounded-lg bg-unbox-light text-unbox-dark">Цена</button>
                                    <button onClick={() => handleToggleReRent(selectedBooking)} className="py-2 text-xs font-medium rounded-lg bg-amber-50 text-amber-700">
                                        {selectedBooking.isReRentListed ? 'Снять' : 'Пересдать'}
                                    </button>
                                    <button onClick={() => handleCancel(selectedBooking.id)} className="py-2 text-xs font-medium rounded-lg bg-red-50 text-red-600">Отмена</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── DESKTOP VIEW ──
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
            <div className="overflow-x-auto scrollbar-visible rounded-xl border border-unbox-light shadow-sm bg-white">
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
                                    className={clsx(
                                        "border-r border-b border-unbox-light/50 text-center py-1.5 px-0",
                                        isPeakTime(slot) && "bg-amber-50/50"
                                    )}
                                >
                                    {slot.endsWith(':00')
                                        ? <span className={clsx("font-semibold text-[11px]", isPeakTime(slot) ? "text-amber-600" : "text-unbox-dark")}>{slot.slice(0, 2)}</span>
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
                                                                : isPeakTime(cell.slot)
                                                                    ? "bg-amber-50/60 hover:bg-amber-100/50 cursor-pointer"
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
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-gray-700 pt-2 pb-1 px-2 bg-white/60 rounded-lg backdrop-blur-sm border border-gray-100">
                <LegendItem color="bg-emerald-200 border-emerald-500" label="Активное бронирование" />
                <LegendItem color="bg-amber-100 border-amber-500 border-dashed" label="На переаренде" />
                <LegendItem color="bg-orange-200 border-orange-500" label="Пересдано" />
                <LegendItem color="bg-gray-200 border-gray-400" label="Завершено" />
                <LegendItem color="bg-gray-100 border-gray-300" label="Прошедшее время" />
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

                    {/* Actions */}
                    {selectedBooking.status === 'confirmed' && (() => {
                        const [bh, bm] = (selectedBooking.startTime || '00:00').split(':').map(Number);
                        const bookEnd = new Date(selectedBooking.date);
                        bookEnd.setHours(bh, bm + (selectedBooking.duration || 60), 0, 0);
                        const isPastB = bookEnd < new Date();

                        return isPastB ? (
                            <div className="px-3 pb-3">
                                <div className="py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-500 text-center border border-gray-200">
                                    ☑️ Завершено
                                </div>
                            </div>
                        ) : (
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
                        );
                    })()}
                </div>
            )}
        </div>
    );
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function LegendItem({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className={clsx('w-4 h-4 rounded border-2 inline-block flex-shrink-0', color)} />
            <span>{label}</span>
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
    const [recurringPattern, setRecurringPattern] = useState<'' | 'weekly' | 'biweekly' | 'monthly'>('');
    const [recurringOccurrences, setRecurringOccurrences] = useState(12);
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
            if (recurringPattern) {
                const result = await bookingsApi.createRecurringBooking({
                    resourceId: slot.resId,
                    locationId: resource?.locationId || 'unbox_one',
                    startTime: slot.time,
                    duration,
                    format: resource?.formats?.[0] || 'individual',
                    paymentMethod: 'balance',
                    firstDate: dateStr,
                    occurrences: recurringOccurrences,
                    pattern: recurringPattern,
                    targetUserId: selectedUser.email,
                });
                const patternLabel = recurringPattern === 'weekly' ? 'еженедельно' : recurringPattern === 'biweekly' ? 'раз в 2 нед.' : 'ежемесячно';
                toast.success(`Создано ${result.created} бронирований (${patternLabel}) на ${result.totalCost} ₾`);
            } else {
                await bookingsApi.createBooking({
                    resourceId: slot.resId,
                    date: dateStr,
                    startTime: slot.time,
                    duration,
                    format: resource?.formats?.[0] || 'individual',
                    locationId: resource?.locationId,
                    targetUserId: selectedUser.email,
                } as any);
                toast.success(`Бронирование создано для ${selectedUser.name}`);
            }
            onBooked();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (typeof detail === 'object' && detail?.conflicts) {
                const conflicts = detail.conflicts as Array<{ date: string; day: string }>;
                toast.error(`Конфликт: заняты ${conflicts.map((c: any) => c.date).join(', ')}`, { duration: 8000 });
            } else {
                const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(', ') : e.message || 'Ошибка бронирования';
                toast.error(msg);
            }
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

                {/* Recurring pattern */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-unbox-grey mb-1.5 block">Повторение</label>
                    <div className="grid grid-cols-4 gap-1.5">
                        {([
                            { id: '', label: 'Разово' },
                            { id: 'weekly', label: 'Еженед.' },
                            { id: 'biweekly', label: '2 нед.' },
                            { id: 'monthly', label: 'Ежемес.' },
                        ] as const).map(p => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => setRecurringPattern(p.id)}
                                className={`py-1.5 rounded-xl text-xs font-medium border transition-colors text-center ${
                                    recurringPattern === p.id
                                        ? 'bg-unbox-green text-white border-unbox-green'
                                        : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-green/50'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    {recurringPattern && (
                        <div className="flex items-center gap-2 pt-1">
                            <input
                                type="number"
                                value={recurringOccurrences}
                                onChange={e => {
                                    const max = recurringPattern === 'monthly' ? 24 : 52;
                                    setRecurringOccurrences(Math.max(2, Math.min(max, Number(e.target.value))));
                                }}
                                min={2}
                                max={recurringPattern === 'monthly' ? 24 : 52}
                                className="w-16 px-2 py-1.5 rounded-lg border border-unbox-light text-sm text-center focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            />
                            <span className="text-xs text-unbox-grey">
                                повторений · {recurringPattern === 'monthly'
                                    ? `≈ ${recurringOccurrences} мес.`
                                    : recurringPattern === 'biweekly'
                                        ? `≈ ${Math.round(recurringOccurrences / 2)} мес.`
                                        : `≈ ${Math.round(recurringOccurrences / 4.3)} мес.`}
                            </span>
                        </div>
                    )}
                </div>

                <button
                    onClick={handleBook}
                    disabled={saving || !selectedUser}
                    className="w-full py-3 bg-unbox-green text-white font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {recurringPattern ? `Создать серию · ${recurringOccurrences} броней` : 'Забронировать'}
                </button>
            </div>
        </div>
    );
}
