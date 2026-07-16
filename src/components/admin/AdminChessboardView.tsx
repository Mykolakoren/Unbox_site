import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { LOCATIONS, RESOURCES, availableExtrasForResource } from '../../utils/data';
import {
    format, addMinutes, setHours, setMinutes, startOfToday,
    addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval,
    isSameDay, isToday,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, Check, Loader2, Search, Plus, ArrowRight, Bell } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { isPeakTime } from '../../utils/pricing';
import type { BookingHistoryItem } from '../../store/types';
import type { Format } from '../../types';
import { ChessboardScroller } from '../ui/ChessboardScroller';
import { ExtendBookingModal, AddExtrasModal, MoveBookingModal } from './BookingTodayEditModals';
import { CancelBookingChoiceModal } from '../CancelBookingChoiceModal';
import { RescheduleScopeChoiceModal } from '../RescheduleScopeChoiceModal';
import { WaitlistSubscribeModal } from '../ui/WaitlistSubscribeModal';
import { parseUTC, tbilisiNow } from '../../utils/dateUtils';
// 2026-06-06 owner (Фаза 3 — см. docs/REFACTOR-BOOKINGS-UNIFICATION.md):
// TIME_SLOTS / timeToMin / parseBookingDate раньше дублировались в
// AdminChessboardView и CrmChessboardView. Теперь — общие. parseUTC
// заменяет локальный parseBookingDate (имя другое, тело идентичное).
import { TIME_SLOTS, timeToMin } from '../../utils/bookingHelpers';
import { BookingConflictDialog, type ConflictItem } from '../BookingConflictDialog';

const _adminMinToTime = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// TIME_SLOTS (09:00–21:30 шаг 30 мин) и timeToMin теперь из общего
// bookingHelpers — см. там же комментарий про peak_hours surcharge.

// ─── Cell types ──────────────────────────────────────────────────────────────
type CellInfo =
    | { type: 'free'; slot: string; past: boolean }
    | { type: 'booking'; slot: string; booking: BookingHistoryItem; colspan: number };

// ─── Component ───────────────────────────────────────────────────────────────
export function AdminChessboardView() {
    const { bookings, users, fetchAllBookings, cancelBooking, listForReRent, setManualPrice } = useUserStore();
    const { resources, fetchResources } = useBookingStore();
    const [searchParams, setSearchParams] = useSearchParams();

    const [filterLocation, setFilterLocation] = useState<string>('all');
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [selectedBooking, setSelectedBooking] = useState<BookingHistoryItem | null>(null);
    // Правки сегодняшней брони (в т.ч. завершившейся): продление с выбором
    // времени и дозаказ допов — общие модалки со списком броней.
    const [extendModalId, setExtendModalId] = useState<string | null>(null);
    const [extrasModalId, setExtrasModalId] = useState<string | null>(null);
    const [moveModalBooking, setMoveModalBooking] = useState<BookingHistoryItem | null>(null);
    const bookingIsToday = (b: BookingHistoryItem | null): boolean => {
        if (!b?.date) return false;
        const raw: any = b.date;
        const day = typeof raw === 'string'
            ? raw.split('T')[0].split(' ')[0]
            : new Date(raw).toISOString().split('T')[0];
        const n = new Date();
        const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
        return day === today;
    };
    // Slot-watch — admin can subscribe themselves to a slot (e.g. monitor
    // when a busy room frees up so they can offer it to a walk-in client).
    const [waitlistTarget, setWaitlistTarget] = useState<{
        resourceId: string;
        resourceName: string;
        locationName?: string | null;
        date: Date;
        startTime: string;
        endTime: string;
    } | null>(null);
    const openWaitlistFor = useCallback((b: BookingHistoryItem) => {
        if (!b.startTime || !b.duration || !b.resourceId) return;
        const res = RESOURCES.find(r => r.id === b.resourceId);
        const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
        const endTimeStr = _adminMinToTime(timeToMin(b.startTime) + b.duration);
        setWaitlistTarget({
            resourceId: b.resourceId,
            resourceName: res?.name || b.resourceId,
            locationName: loc?.name ?? null,
            date: parseUTC(b.date),
            startTime: b.startTime,
            endTime: endTimeStr,
        });
    }, []);
    // When the admin clicks "Удалить" on a booking that's part of a recurring
    // series, we show a 3-button choice (this / series / cancel) instead of
    // a plain confirm() so they don't have to delete N rows one-by-one.
    const [seriesCancelTarget, setSeriesCancelTarget] = useState<BookingHistoryItem | null>(null);

    // Same idea for "Перенести": when the moved booking lives in a series we
    // ask whether the new time/resource should propagate to every later
    // sibling. ``Move`` collected the desired new date+time into this
    // state and the modal renders below.
    const [seriesMoveTarget, setSeriesMoveTarget] = useState<{
        booking: BookingHistoryItem;
        newDate: string;
        newStartTime: string;
        newResourceId?: string;
    } | null>(null);

    // Excel #59 — "Перенести бронь" in a client's history deep-links here with
    // ?highlight=<bookingId>. We jump the week/day to the booking's date,
    // select it (so the detail card opens), and scroll its row into view.
    // Then we strip the query param so a later reload doesn't re-trigger.
    const highlightId = searchParams.get('highlight');
    useEffect(() => {
        if (!highlightId || bookings.length === 0) return;
        const booking = bookings.find(b => b.id === highlightId);
        if (!booking) return;
        try {
            const d = parseUTC(booking.date);
            setSelectedDate(d);
            setWeekStart(startOfWeek(d, { weekStartsOn: 1 }));
            setSelectedBooking(booking);
            // Scroll the resource row into view on next paint.
            setTimeout(() => {
                const el = document.querySelector(`[data-resource-row="${booking.resourceId}"]`);
                if (el && 'scrollIntoView' in el) {
                    (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 250);
        } finally {
            // Clean the param so refresh doesn't re-jump.
            const next = new URLSearchParams(searchParams);
            next.delete('highlight');
            setSearchParams(next, { replace: true });
        }
    }, [highlightId, bookings, searchParams, setSearchParams]);

    // Admin booking state
    const [adminBookSlot, setAdminBookSlot] = useState<{ resId: string; time: string; date: Date; duration?: number } | null>(null);

    // ── Drag-to-select NEW booking slots ──
    // Multi-period selection: same resource can hold several non-contiguous
    // chunks (e.g. cab 5: 10:00-11:00 AND 15:00-16:00). Chunks computed
    // lazily from `newSlots` via `selectedNewBlocks` below.
    const [newSlots, setNewSlots] = useState<string[]>([]);
    type NewDragMode = 'new' | 'resize-start' | 'resize-end' | 'move' | null;
    const newDragModeRef = useRef<NewDragMode>(null);
    const newDragStartRef = useRef<{ resId: string; time: string } | null>(null);
    const newDragInitialBlockRef = useRef<{ resId: string; start: number; end: number } | null>(null);
    const newDragMoveOffsetRef = useRef<number>(0);
    // Snapshot at drag-start. 'new' drags add a draft chunk on top of this;
    // resize/move replace ONLY the dragged chunk in this snapshot.
    const newDragInitialSlotsRef = useRef<string[]>([]);
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
        if (!userId || typeof userId !== 'string') return 'Гость';
        const u = users.find(u => u.email === userId || u.id === userId);
        if (u?.name) return u.name;
        if (userId.includes('@')) return userId.split('@')[0];
        return userId.slice(0, 10);
    };

    // ── Bookings on selected date ─────────────────────────────────────────────
    const bookingsOnDate = useMemo(() => {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        return bookings.filter(b => {
            if (!b || !b.date) return false;
            try {
                const bd = parseUTC(b.date);
                if (isNaN(bd.getTime())) return false;
                return format(bd, 'yyyy-MM-dd') === dateStr &&
                    (b.status === 'confirmed' || b.status === 're-rented' || b.status === 'completed' || b.status === 'pending_approval');
            } catch {
                return false;
            }
        });
    }, [bookings, selectedDate]);

    // ── Slot map: `${resourceId}|${slot}` → {booking, isStart} ───────────────
    const slotMap = useMemo(() => {
        const map = new Map<string, { booking: BookingHistoryItem; isStart: boolean }>();
        bookingsOnDate.forEach(booking => {
            if (
                !booking.startTime ||
                typeof booking.startTime !== 'string' ||
                !booking.startTime.includes(':') ||
                !booking.duration ||
                !booking.resourceId
            ) return;
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
    // Use Tbilisi-aware "now" + Tbilisi-aware slot instant (Date.UTC with h-4)
    // so admins on a non-Tbilisi browser TZ see the same boundary as locals.
    // The 12h backdate window for admins is preserved.
    const rowCellsMap = useMemo(() => {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const [y, mo, d] = dateStr.split('-').map(Number);

        const isPast = (slot: string): boolean => {
            const [h, m] = slot.split(':').map(Number);
            // Slot instant in true UTC ms: Tbilisi h:m on (y,mo,d) = UTC (h-4):m on same date
            const slotMs = Date.UTC(y, mo - 1, d, h - 4, m, 0);
            const hoursAgo = (Date.now() - slotMs) / 3_600_000;
            if (hoursAgo > 0 && hoursAgo <= 12) return false; // 12h admin backdate window
            return hoursAgo > 0;
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
        // Tbilisi-aware past check (see rowCellsMap for rationale).
        const now = tbilisiNow();
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        if (dateStr < now.ymd) return true;
        if (dateStr === now.ymd && timeToMin(time) < now.totalMins) return true;
        return slotMap.has(`${resId}|${time}`);
    }, [selectedDate, slotMap]);

    const selectedNewBlocks = useMemo(() => {
        const byRes: Record<string, number[]> = {};
        for (const slot of newSlots) {
            if (!slot || typeof slot !== 'string' || !slot.includes('|')) continue;
            const [resId, timeStr] = slot.split('|');
            if (!resId || !timeStr) continue;
            const idx = TIME_SLOTS.indexOf(timeStr);
            if (idx === -1) continue;
            if (!byRes[resId]) byRes[resId] = [];
            byRes[resId].push(idx);
        }
        // Split each resource's slots into CONTIGUOUS chunks so multiple
        // periods in one cabinet render & resize independently.
        const blocks: { resId: string; start: number; end: number }[] = [];
        for (const [resId, raw] of Object.entries(byRes)) {
            const sorted = [...raw].sort((a, b) => a - b);
            let cur: number[] = [];
            for (const i of sorted) {
                if (cur.length === 0 || i === cur[cur.length - 1] + 1) cur.push(i);
                else { blocks.push({ resId, start: cur[0], end: cur[cur.length - 1] }); cur = [i]; }
            }
            if (cur.length) blocks.push({ resId, start: cur[0], end: cur[cur.length - 1] });
        }
        return blocks;
    }, [newSlots]);

    /** Find the chunk that contains a (resource, slot-idx) pair. */
    const getNewBlockAt = (resId: string, idx: number) =>
        selectedNewBlocks.find(b => b.resId === resId && idx >= b.start && idx <= b.end) ?? null;

    /** Legacy helper — first chunk in a resource. New code prefers
     *  `getNewBlockAt(resId, idx)` so resize on the second period
     *  doesn't silently delete the first. */
    const getNewBlockForResource = (resId: string) =>
        selectedNewBlocks.find(b => b.resId === resId) ?? null;

    const isNewSlotSelected = (resId: string, time: string) =>
        newSlots.includes(`${resId}|${time}`);

    /** Legacy "set per resource" helper — replaces the resource's slots.
     *  Kept for compatibility; new chip removal uses {@link removeNewBlock}. */
    const setNewSlotRange = useCallback((resId: string, times: string[]) => {
        setNewSlots(prev => {
            const other = prev.filter(s => !s.startsWith(`${resId}|`));
            return [...other, ...times.map(t => `${resId}|${t}`)];
        });
    }, []);

    /** Drop a single chunk; siblings in the same resource untouched. */
    const removeNewBlock = useCallback((block: { resId: string; start: number; end: number }) => {
        const idsToRemove = new Set<string>();
        for (let i = block.start; i <= block.end; i++) {
            idsToRemove.add(`${block.resId}|${TIME_SLOTS[i]}`);
        }
        setNewSlots(prev => prev.filter(s => !idsToRemove.has(s)));
    }, []);

    // Drag handlers
    const handleNewDragDown = (resId: string, time: string, mode: NewDragMode) => {
        if (isSlotOccupied(resId, time) && mode === 'new') return;
        const clickedIdx = TIME_SLOTS.indexOf(time);

        // If clicking on already-selected slot in 'new' mode → switch to 'move'
        // Capture the SPECIFIC chunk under the cursor, not the first chunk.
        if (mode === 'new' && isNewSlotSelected(resId, time)) {
            const block = getNewBlockAt(resId, clickedIdx);
            if (block) {
                newDragModeRef.current = 'move';
                newDragStartRef.current = { resId, time };
                newDragInitialBlockRef.current = block;
                newDragInitialSlotsRef.current = [...newSlots];
                newDragMoveOffsetRef.current = clickedIdx - block.start;
                forceNewDragUpdate();
                return;
            }
        }

        newDragModeRef.current = mode;
        newDragStartRef.current = { resId, time };
        newDragInitialSlotsRef.current = [...newSlots];
        if (mode === 'new') {
            // ADD a fresh chunk; do not wipe other chunks in this resource.
            setNewSlots(prev => {
                const slotId = `${resId}|${time}`;
                return prev.includes(slotId) ? prev : [...prev, slotId];
            });
        } else {
            const block = getNewBlockAt(resId, clickedIdx) ?? getNewBlockForResource(resId);
            if (block) newDragInitialBlockRef.current = block;
        }
        forceNewDragUpdate();
    };

    const handleNewDragEnter = useCallback((resId: string, time: string) => {
        const mode = newDragModeRef.current;
        const startSlot = newDragStartRef.current;
        const initBlock = newDragInitialBlockRef.current;
        const initialSnapshot = newDragInitialSlotsRef.current;
        if (!mode || !startSlot) return;
        const currentIdx = TIME_SLOTS.indexOf(time);
        const startIdx = TIME_SLOTS.indexOf(startSlot.time);
        if (currentIdx === -1 || startIdx === -1) return;

        if (mode === 'new') {
            if (startSlot.resId !== resId) return;
            const minIdx = Math.min(startIdx, currentIdx);
            const maxIdx = Math.max(startIdx, currentIdx);
            const draftSlots: string[] = [];
            let blocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) { blocked = true; break; }
                draftSlots.push(TIME_SLOTS[i]);
            }
            if (blocked) return;
            // Strip only the draft slots (might have been added on a prior
            // tick) from the snapshot, then re-add. Existing chunks in this
            // and other resources stay intact → multi-period works.
            const draftIds = new Set(draftSlots.map(t => `${resId}|${t}`));
            const survivors = initialSnapshot.filter(s => !draftIds.has(s));
            setNewSlots([...survivors, ...draftIds]);
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
            if (blocked) return;
            // Replace ONLY the chunk being resized.
            const oldChunkIds = new Set<string>();
            for (let i = initBlock.start; i <= initBlock.end; i++) {
                oldChunkIds.add(`${resId}|${TIME_SLOTS[i]}`);
            }
            const survivors = initialSnapshot.filter(s => !oldChunkIds.has(s));
            const newIds = slots.map(t => `${resId}|${t}`);
            setNewSlots([...survivors, ...newIds]);
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
            if (blocked) return;
            const oldChunkIds = new Set<string>();
            for (let i = initBlock.start; i <= initBlock.end; i++) {
                oldChunkIds.add(`${resId}|${TIME_SLOTS[i]}`);
            }
            const survivors = initialSnapshot.filter(s => !oldChunkIds.has(s));
            const newIds = slots.map(t => `${resId}|${t}`);
            setNewSlots([...survivors, ...newIds]);
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
            if (blocked) return;
            const oldChunkIds = new Set<string>();
            for (let i = initBlock.start; i <= initBlock.end; i++) {
                oldChunkIds.add(`${resId}|${TIME_SLOTS[i]}`);
            }
            const survivors = initialSnapshot.filter(s => !oldChunkIds.has(s));
            const newIds = slots.map(t => `${resId}|${t}`);
            setNewSlots([...survivors, ...newIds]);
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
            const timeStr = resSlots[0]?.split('|')[1];
            if (!timeStr) return prev;
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

    // Queue of chunks waiting for the booking modal. When the admin
    // selects N periods (same or different cabinet) and clicks
    // "Продолжить", we open the modal for the first chunk and on each
    // success pull the next one off this queue. Empty queue → close
    // modal & clear selection. Without this only the first chunk got
    // booked and the rest silently disappeared — admins reported this.
    const [pendingChunks, setPendingChunks] = useState<{ resId: string; time: string; duration: number }[]>([]);

    // Handle "Продолжить" — open admin booking modal with pre-filled duration
    const handleContinueNewBooking = () => {
        if (newSlots.length === 0 || selectedNewBlocks.length === 0) return;
        const queue = selectedNewBlocks.map(b => ({
            resId: b.resId,
            time: TIME_SLOTS[b.start],
            duration: (b.end - b.start + 1) * 30,
        }));
        const [first, ...rest] = queue;
        setPendingChunks(rest);
        setAdminBookSlot({ resId: first.resId, time: first.time, date: selectedDate, duration: first.duration });
    };

    /** Called from the modal's onBooked. Pops the just-booked chunk's
     *  slots out of the selection, then either advances to the next
     *  chunk in the queue or closes the modal entirely. */
    const advanceBookingQueue = () => {
        // Drop the slots that just got booked from the visual selection.
        if (adminBookSlot) {
            const idx = TIME_SLOTS.indexOf(adminBookSlot.time);
            const slotCount = Math.max(1, Math.round((adminBookSlot.duration || 60) / 30));
            const idsToRemove = new Set<string>();
            for (let i = 0; i < slotCount; i++) {
                const t = TIME_SLOTS[idx + i];
                if (t) idsToRemove.add(`${adminBookSlot.resId}|${t}`);
            }
            setNewSlots(prev => prev.filter(s => !idsToRemove.has(s)));
        }
        if (pendingChunks.length > 0) {
            const [next, ...rest] = pendingChunks;
            setPendingChunks(rest);
            setAdminBookSlot({ resId: next.resId, time: next.time, date: selectedDate, duration: next.duration });
        } else {
            setAdminBookSlot(null);
            setNewSlots([]);
        }
        fetchAllBookings();
    };

    // ── Booking block style ───────────────────────────────────────────────────
    const getBookingStyle = (b: BookingHistoryItem) => {
        // Срочная бронь, ожидающая решения админа — красная рамка-пунктир,
        // чтобы её было видно прямо на сетке без перехода в фильтр «Ожидает».
        if (b.status === 'pending_approval') return 'bg-red-50 text-red-800 border-red-500 border-dashed';
        if (b.status === 'completed')  return 'bg-gray-200 text-gray-600 border-gray-300';
        if (b.status === 're-rented')  return 'bg-orange-200 text-orange-800 border-orange-400';
        if (b.isReRentListed)          return 'bg-amber-100 text-amber-800 border-amber-400 border-dashed';
        return 'bg-emerald-100 text-emerald-900 border-emerald-400';
    };

    // ── Popup status label ────────────────────────────────────────────────────
    const statusLabel = (b: BookingHistoryItem) => {
        if (b.status === 'pending_approval') return '⏳ Ожидает подтверждения';
        if (b.status === 'confirmed')  return b.isReRentListed ? '📤 На переаренде' : '✅ Активно';
        if (b.status === 're-rented')  return '🔄 Пересдано';
        if (b.status === 'completed')  return '☑️ Завершено';
        return b.status;
    };

    // ── Discount label — translates the rule code stored on the booking
    // into something an admin can read at a glance. Useful in the popup so
    // they don't have to remember what WEEKLY_PROGRESSIVE vs CONSECUTIVE_HOURS
    // means; date+role+state-of-week becomes obvious.
    const discountRuleLabel = (rule: string | undefined | null): string => {
        switch (rule) {
            case 'PERSONAL_DISCOUNT':     return 'Личная скидка';
            case 'WEEKLY_PROGRESSIVE':    return 'Недельная (накопленные часы)';
            case 'CONSECUTIVE_HOURS':     return 'За длительность брони';
            case 'MANUAL_OVERRIDE':       return 'Ручная корректировка';
            case 'SUBSCRIPTION':          return 'Абонемент';
            case 'SUBSCRIPTION_DISCOUNT': return 'Скидка по абонементу';
            case 'HOT_BOOKING':           return 'Горячая бронь';
            default:                      return rule || '';
        }
    };

    // ── Actions ───────────────────────────────────────────────────────────────
    const handleCancel = (id: string) => {
        // If the booking belongs to a series, give the admin the same
        // "this / series" choice Google Calendar offers — otherwise admins
        // had to click N times to clean up a recurring weekly slot.
        const target = selectedBooking && selectedBooking.id === id ? selectedBooking : bookings.find(b => b.id === id) || null;
        if (target?.recurringGroupId) {
            setSeriesCancelTarget(target);
            return;
        }
        if (confirm('Отменить это бронирование?')) {
            cancelBooking(id);
            setSelectedBooking(null);
        }
    };
    const handleEditPrice = async (b: BookingHistoryItem) => {
        // Replaces the legacy local-only setManualPrice — that one mutated
        // the Zustand store and never hit the server, so the value reverted
        // on reload. Now persists via PATCH /bookings/{id}/price; server
        // adjusts the owner's balance/sub by the delta if the row was paid.
        const val = prompt(`Новая цена (GEL). Текущая: ${b.finalPrice}₾.`, String(b.finalPrice));
        if (val === null) return;
        const p = parseFloat(val);
        if (isNaN(p) || p < 0) {
            toast.error('Введите неотрицательное число');
            return;
        }
        if (Math.abs(p - (b.finalPrice || 0)) < 0.005) {
            toast.error('Новая цена совпадает со старой');
            return;
        }
        const reason = prompt('Причина (необязательно — для аудита):', '') || undefined;
        try {
            await bookingsApi.setPrice(b.id, p, reason);
            toast.success(`Цена изменена: ${b.finalPrice}₾ → ${p}₾`);
            setSelectedBooking(null);
            await fetchAllBookings();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось изменить цену');
        }
    };
    // Excel #67: previously this fired listForReRent and dropped the dialog
    // immediately — if the request errored or was slow, the admin saw "nothing
    // happened" with no feedback. Now we await so the toast (success or
    // failure, raised inside listForReRent) lines up with the action, and we
    // pull fresh state to keep the chessboard's own copy of the booking
    // honest.
    const handleToggleReRent = async (b: BookingHistoryItem) => {
        try {
            await listForReRent(b.id);
            await fetchAllBookings();
        } finally {
            setSelectedBooking(null);
        }
    };

    /** "Продлить +30 мин" — admins reported the menu disappeared. Restored
     *  here on the chessboard popup. PATCH /bookings/{id}/extend; backend
     *  checks the next slot is free and bills the delta if applicable. */
    const handleExtend = async (b: BookingHistoryItem) => {
        if (!confirm('Продлить бронь на 30 минут?')) return;
        try {
            await bookingsApi.extendBooking(b.id, 30);
            toast.success('Бронь продлена на 30 минут');
            await fetchAllBookings();
            setSelectedBooking(null);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось продлить — возможно, следующий слот занят');
        }
    };

    /** Сократить бронь — для броней >60 мин. Спрашивает сколько и с какой
     *  стороны (начало/конец). Минимальный итог — 60 мин. */
    const handleShorten = async (b: BookingHistoryItem) => {
        const dur = b.duration || 60;
        if (dur <= 60) {
            toast.error('Бронь уже минимальная (60 мин), сократить нельзя');
            return;
        }
        const removeRaw = window.prompt(
            `На сколько минут сократить? (кратно 30, максимум ${dur - 60})`,
            '60',
        );
        if (removeRaw === null) return;
        const remove = parseInt(removeRaw, 10);
        if (!Number.isFinite(remove) || remove < 30 || remove % 30 !== 0) {
            toast.error('Введите число кратное 30');
            return;
        }
        const sideRaw = window.prompt('С какой стороны убрать? "конец" (по умолчанию) или "начало":', 'конец');
        if (sideRaw === null) return;
        const side: 'start' | 'end' = sideRaw.trim().toLowerCase().startsWith('нач') ? 'start' : 'end';
        if (!confirm(`Сократить на ${remove} мин с ${side === 'start' ? 'начала' : 'конца'}? Деньги/часы вернутся пропорционально.`)) return;
        try {
            await bookingsApi.shortenBooking(b.id, { removeMinutes: remove, side });
            toast.success(`Бронь сокращена на ${remove} мин, средства возвращены`);
            await fetchAllBookings();
            setSelectedBooking(null);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось сократить');
        }
    };

    /** "Перенести" — открывает модалку выбора даты, времени И КАБИНЕТА.
     *  Бэкенд reschedule принимает new_resource_id и переносит бронь в другой
     *  кабинет (проверяет, что целевой слот свободен). Раньше кабинет сменить
     *  было нельзя — только время в рамках того же кабинета. */
    const handleMove = (b: BookingHistoryItem) => {
        setMoveModalBooking(b);
    };

    /** Собственно перенос — вызывается из MoveBookingModal с выбранными
     *  датой/временем/кабинетом. Серия → отдельная модалка (this vs +будущие). */
    const doMove = async (b: BookingHistoryItem, newDate: string, newStartTime: string, newResourceId: string) => {
        if (b.recurringGroupId) {
            setSeriesMoveTarget({ booking: b, newDate, newStartTime, newResourceId });
            setSelectedBooking(null);
            setMoveModalBooking(null);
            return;
        }
        try {
            await bookingsApi.rescheduleBooking(b.id, { newDate, newStartTime, newResourceId });
            const movedRoom = newResourceId !== b.resourceId;
            toast.success(movedRoom ? 'Бронь перенесена в другой кабинет' : `Бронь перенесена на ${newDate} ${newStartTime}`);
            await fetchAllBookings();
            setSelectedBooking(null);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось перенести — возможно, слот занят');
        }
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    // ── MOBILE VIEW ──
    if (isMobile) {
        const mobileBlock = mobileRes ? getNewBlockForResource(mobileRes.id) : null;
        const mobileBlockStartTime = mobileBlock ? (TIME_SLOTS[mobileBlock.start] ?? null) : null;
        const mobileBlockEndTime = mobileBlock ? (() => {
            const endSlot = TIME_SLOTS[mobileBlock.end];
            if (!endSlot || !endSlot.includes(':')) return null;
            const [h, m] = endSlot.split(':').map(Number);
            return format(addMinutes(setMinutes(setHours(startOfToday(), h || 0), m || 0), 30), 'HH:mm');
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
                        onClose={() => {
                            // Cancel mid-queue → drop remaining chunks; selection
                            // is already shown in the chips so admin can retry
                            // without re-selecting from scratch.
                            setAdminBookSlot(null);
                            setPendingChunks([]);
                        }}
                        onBooked={advanceBookingQueue}
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
                                <InfoRow label="Дата" value={format(parseUTC(selectedBooking.date), 'd MMMM yyyy', { locale: ru })} />
                                <InfoRow label="Время" value={`${selectedBooking.startTime} · ${(selectedBooking.duration ?? 0) / 60}ч`} />
                                {/* Цена + Скидка — две строки. Раньше админам приходилось
                                    лазить в /admin/bookings или гадать «почему 18 а не 20»;
                                    теперь правило и процент видно прямо в попапе. */}
                                {selectedBooking.appliedRule && selectedBooking.appliedRule !== 'NONE'
                                    && selectedBooking.appliedRule !== 'SUBSCRIPTION'
                                    && (selectedBooking.discountPercent || selectedBooking.discountAmount) ? (
                                    <>
                                        <InfoRow
                                            label="Цена"
                                            value={`${selectedBooking.finalPrice} ₾  (база ${(selectedBooking.basePrice ?? selectedBooking.finalPrice ?? 0)} ₾ − ${selectedBooking.discountAmount?.toFixed(0) ?? 0} ₾)`}
                                        />
                                        <InfoRow
                                            label="Скидка"
                                            value={`${discountRuleLabel(selectedBooking.appliedRule)} · −${selectedBooking.discountPercent ?? 0}%`}
                                        />
                                    </>
                                ) : (
                                    <InfoRow
                                        label="Цена"
                                        value={
                                            selectedBooking.appliedRule === 'SUBSCRIPTION'
                                                ? `${selectedBooking.finalPrice ?? 0} ₾  (по абонементу)`
                                                : `${selectedBooking.finalPrice ?? 0} ₾`
                                        }
                                    />
                                )}
                                <InfoRow label="Статус" value={statusLabel(selectedBooking)} />
                                {/* Deferred-billing payment status — only show if explicitly set
                                    (legacy rows = NULL = silent). Keeps the panel uncluttered for
                                    bookings created before the 24h-defer rollout. */}
                                {selectedBooking.paymentStatus && (
                                    <InfoRow
                                        label="Оплата"
                                        value={
                                            selectedBooking.paymentStatus === 'pending'
                                                ? 'Ожидает (списание за 24ч до начала)'
                                                : selectedBooking.paymentStatus === 'waived'
                                                    ? `Штраф снят${selectedBooking.waiverReason ? ` · ${selectedBooking.waiverReason}` : ''}`
                                                    : selectedBooking.chargedAt
                                                        ? `Оплачено ${format(new Date(selectedBooking.chargedAt), 'd MMM HH:mm', { locale: ru })}`
                                                        : 'Оплачено'
                                        }
                                    />
                                )}
                            </div>
                            {/* Pending hot-booking — Approve / Reject inline в попапе.
                                Раньше эти кнопки были только в списке /admin/bookings,
                                и админу приходилось переключаться между шахматкой и
                                списком. Теперь можно решить прямо из шахматки. */}
                            {selectedBooking.status === 'pending_approval' && (
                                <div className="space-y-1.5 mb-3">
                                    <div className="text-[11px] text-red-700 font-medium">Срочная бронь — клиент ждёт решения</div>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <button
                                            onClick={async () => {
                                                try {
                                                    await bookingsApi.approveBooking(selectedBooking.id);
                                                    toast.success('Бронь подтверждена, клиент уведомлён');
                                                    setSelectedBooking(null);
                                                    await fetchAllBookings();
                                                } catch (e: any) {
                                                    toast.error(e?.response?.data?.detail || 'Ошибка');
                                                }
                                            }}
                                            className="py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white"
                                        >
                                            ✓ Подтвердить
                                        </button>
                                        <button
                                            onClick={async () => {
                                                const reason = window.prompt('Причина отклонения (будет отправлена клиенту):', '');
                                                if (reason === null) return;
                                                try {
                                                    await bookingsApi.rejectBooking(selectedBooking.id, reason.trim() || undefined);
                                                    toast.success('Бронь отклонена, клиент уведомлён');
                                                    setSelectedBooking(null);
                                                    await fetchAllBookings();
                                                } catch (e: any) {
                                                    toast.error(e?.response?.data?.detail || 'Ошибка');
                                                }
                                            }}
                                            className="py-2 text-xs font-bold rounded-lg bg-red-50 text-red-700 border border-red-200"
                                        >
                                            ✕ Отклонить
                                        </button>
                                    </div>
                                </div>
                            )}
                            {selectedBooking.status === 'confirmed' && (
                                <div className="space-y-1.5">
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <button onClick={() => handleMove(selectedBooking)} className="py-2 text-xs font-medium rounded-lg bg-blue-50 text-blue-700">Перенести</button>
                                        <button onClick={() => setExtendModalId(selectedBooking.id)} className="py-2 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700">Продлить</button>
                                        {bookingIsToday(selectedBooking) && (
                                            <button onClick={() => setExtrasModalId(selectedBooking.id)} className="col-span-2 py-2 text-xs font-medium rounded-lg bg-teal-50 text-teal-700">+ Доп (кофе и т.п.)</button>
                                        )}
                                        {(selectedBooking.duration || 60) > 60 && (
                                            <button onClick={() => handleShorten(selectedBooking)} className="col-span-2 py-2 text-xs font-medium rounded-lg bg-orange-50 text-orange-700">Сократить (— минут)</button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        <button onClick={() => handleEditPrice(selectedBooking)} className="py-2 text-xs font-medium rounded-lg bg-unbox-light text-unbox-dark">Цена</button>
                                        <button onClick={() => handleToggleReRent(selectedBooking)} className="py-2 text-xs font-medium rounded-lg bg-amber-50 text-amber-700">
                                            {selectedBooking.isReRentListed ? 'Снять' : 'Пересдать'}
                                        </button>
                                        <button onClick={() => handleCancel(selectedBooking.id)} className="py-2 text-xs font-medium rounded-lg bg-red-50 text-red-600">Удалить</button>
                                    </div>
                                    {/* Format change — useful when client picked the wrong rate
                                        at checkout. Only shown for cabinets that actually have a
                                        group rate (7/8 — see RESOURCES). For others the toggle
                                        would be a no-op. */}
                                    {(() => {
                                        // Cab 2 in One ("мини-группы" — до 4 чел) добавлен по запросу
                                        // админа: помещение хоть и небольшое, но позволяет вести группу
                                        // или семью. Кабинеты 7/8 — большие групповые залы (20 чел).
                                        const groupCapable = ['unbox_uni_room_7', 'unbox_uni_room_8', 'unbox_one_room_2'].includes(selectedBooking.resourceId || '');
                                        if (!groupCapable) return null;
                                        const target: 'individual' | 'group' =
                                            (selectedBooking.format === 'group') ? 'individual' : 'group';
                                        const targetLabel = target === 'group' ? 'Групповой' : 'Индивид.';
                                        return (
                                            <button
                                                onClick={async () => {
                                                    if (!window.confirm(`Сменить формат на «${targetLabel}»? Цена пересчитается, разница спишется/вернётся.`)) return;
                                                    try {
                                                        await bookingsApi.changeFormat(selectedBooking.id, target);
                                                        toast.success(`Формат изменён на «${targetLabel}»`);
                                                        setSelectedBooking(null);
                                                        await fetchAllBookings();
                                                    } catch (e: any) {
                                                        toast.error(e?.response?.data?.detail || 'Не удалось сменить формат');
                                                    }
                                                }}
                                                className="w-full py-2 text-xs font-medium rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center gap-1.5"
                                            >
                                                🔄 Сменить формат: → {targetLabel}
                                            </button>
                                        );
                                    })()}
                                    {/* Waive — only relevant while charge is still on the table.
                                        For `waived` rows the panel above already shows the reason. */}
                                    {(selectedBooking.paymentStatus === 'pending' || selectedBooking.paymentStatus === 'paid') && (
                                        <button
                                            onClick={async () => {
                                                const reason = window.prompt('Причина снятия штрафа (обязательно):', '');
                                                if (!reason || !reason.trim()) return;
                                                try {
                                                    const res = await bookingsApi.waiveCharge(selectedBooking.id, reason.trim());
                                                    toast.success(
                                                        res.scenario === 'waived_paid_refunded'
                                                            ? 'Штраф снят, средства возвращены'
                                                            : 'Штраф снят (списание не произойдёт)'
                                                    );
                                                    setSelectedBooking(null);
                                                    await fetchAllBookings();
                                                } catch (e: any) {
                                                    toast.error(e?.response?.data?.detail || 'Не удалось снять штраф');
                                                }
                                            }}
                                            className="w-full py-2 text-xs font-medium rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center gap-1.5"
                                        >
                                            🩹 Снять штраф (с причиной)
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { const b = selectedBooking; setSelectedBooking(null); openWaitlistFor(b); }}
                                        className="w-full py-2 text-xs font-medium rounded-lg bg-orange-50 text-orange-700 flex items-center justify-center gap-1.5"
                                    >
                                        <Bell size={12} /> Следить за слотом
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                <ExtendBookingModal
                    bookingId={extendModalId}
                    onClose={() => setExtendModalId(null)}
                    onDone={() => { fetchAllBookings(); setSelectedBooking(null); }}
                />
                <AddExtrasModal
                    bookingId={extrasModalId}
                    onClose={() => setExtrasModalId(null)}
                    onDone={() => { fetchAllBookings(); setSelectedBooking(null); }}
                />
                <MoveBookingModal
                    booking={moveModalBooking}
                    onClose={() => setMoveModalBooking(null)}
                    onSubmit={(d, t, r) => moveModalBooking ? doMove(moveModalBooking, d, t, r) : undefined}
                />
            </div>
        );
    }

    // ── DESKTOP VIEW ──
    return (
        // Tighter vertical rhythm — was space-y-4 (16px); 8px keeps the
        // sections distinct without the hollow gaps between filter row,
        // day strip, and grid that the user flagged as wasted space.
        <div className="space-y-2">

            {/* ── Top row: week-nav LEFT, location filter RIGHT.
                Two formerly-separate rows (filter; day-picker+nav)
                collapsed into this one shared row so the global controls
                live in the same horizontal band. The day picker keeps
                its own row below where it can still grow to fit all
                seven days without crowding. */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 shrink-0">
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

                <div className="flex gap-1.5 flex-wrap ml-auto">
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
            </div>

            {/* Day strip on its own row so day buttons can still grow
                horizontally and stay tappable on narrower viewports. */}
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
            <ChessboardScroller minGridWidth={130 + TIME_SLOTS.length * 44 + 110}>
                <table
                    className="border-collapse text-xs"
                    // table-layout:fixed — колонки строго по colgroup (44px/слот),
                    // длинное имя клиента больше НЕ расширяет колонку часа
                    // (обрезается ellipsis). Owner 2026-07-03: разъезжающиеся
                    // столбцы сбивали при чтении диапазона времени.
                    style={{
                        tableLayout: 'fixed',
                        width: `${130 + TIME_SLOTS.length * 44 + 110}px`,
                        minWidth: `${130 + TIME_SLOTS.length * 44 + 110}px`,
                    }}
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
                            {/* Sticky first column (Excel #71) — keeps resource
                                names visible while admin scrolls time to the right. */}
                            <th className="sticky left-0 z-30 bg-unbox-light/40 p-2 text-left font-semibold text-unbox-dark border-r border-b border-unbox-light shadow-[2px_0_4px_rgba(0,0,0,0.04)]">
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
                                <tr key={resource.id} data-resource-row={resource.id} className="border-b border-unbox-light/40 group">
                                    {/* Resource label — sticky (R71) */}
                                    <td className="sticky left-0 z-10 border-r border-unbox-light p-2 bg-white group-hover:bg-unbox-light/10 transition-colors shadow-[2px_0_4px_rgba(0,0,0,0.04)]">
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
                                                        <div className="font-semibold truncate text-[10px] leading-tight flex items-center gap-0.5">
                                                            {/* Recurring marker — orange star for series. */}
                                                            {b.recurringGroupId && <span className="text-orange-500 shrink-0" title="Постоянная бронь (серия)">⭐</span>}
                                                            <span className="truncate">{getUserName(b.userId)}</span>
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
                                        // Chunk-aware lookup: same cabinet can hold
                                        // multiple periods; use the chunk that contains
                                        // THIS slot, not the first chunk in the resource.
                                        const newBlock = newSel ? getNewBlockAt(resource.id, slotIdx) : null;
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
            </ChessboardScroller>

            {/* ── Legend ── */}
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-gray-700 pt-2 pb-1 px-2 bg-white/60 rounded-lg backdrop-blur-sm border border-gray-100">
                <LegendItem color="bg-emerald-200 border-emerald-500" label="Активное бронирование" />
                <LegendItem color="bg-amber-100 border-amber-500 border-dashed" label="На переаренде" />
                <LegendItem color="bg-orange-200 border-orange-500" label="Пересдано" />
                <LegendItem color="bg-gray-200 border-gray-400" label="Завершено" />
                <LegendItem color="bg-gray-100 border-gray-300" label="Прошедшее время" />
            </div>

            {/* ── Admin Quick Booking Modal ──
                Uses the same queue logic as the mobile branch so multi-
                period selections (e.g. cab 5 at 10:00–11:00 AND 13:00–14:00)
                walk the modal through every chunk. Earlier desktop just
                wiped state on first onBooked, so admins reported "только
                первый слот сохранился, остальные пропали". */}
            {adminBookSlot && (
                <AdminQuickBookingModal
                    slot={adminBookSlot}
                    users={users}
                    onClose={() => {
                        // Cancelling mid-queue drops the remaining chunks but
                        // keeps the selection visible in the chips so the
                        // admin can retry without re-clicking the cells.
                        setAdminBookSlot(null);
                        setPendingChunks([]);
                    }}
                    onBooked={advanceBookingQueue}
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
                            value={format(parseUTC(selectedBooking.date), 'd MMMM yyyy', { locale: ru })}
                        />
                        <InfoRow
                            label="Время"
                            value={`${selectedBooking.startTime} · ${(selectedBooking.duration ?? 0) / 60}ч`}
                        />
                        {/* Цена + Скидка — мобильный попап получает ту же
                            раскладку, что и десктоп выше: если применилась
                            скидка (или peak-наценка), правило и процент
                            видны рядом с ценой, чтобы админ не гадал
                            «почему N а не 20». */}
                        {selectedBooking.appliedRule && selectedBooking.appliedRule !== 'NONE'
                            && selectedBooking.appliedRule !== 'SUBSCRIPTION'
                            && (selectedBooking.discountPercent || selectedBooking.discountAmount) ? (
                            <>
                                <InfoRow
                                    label="Цена"
                                    value={`${selectedBooking.finalPrice} ₾  (база ${selectedBooking.basePrice ?? selectedBooking.finalPrice ?? 0} ₾ − ${selectedBooking.discountAmount?.toFixed(0) ?? 0} ₾)`}
                                />
                                <InfoRow
                                    label="Скидка"
                                    value={`${discountRuleLabel(selectedBooking.appliedRule)} · −${selectedBooking.discountPercent ?? 0}%`}
                                />
                            </>
                        ) : (
                            <InfoRow
                                label="Цена"
                                value={
                                    selectedBooking.appliedRule === 'SUBSCRIPTION'
                                        ? `${selectedBooking.finalPrice ?? 0} ₾  (по абонементу)`
                                        : `${selectedBooking.finalPrice ?? 0} ₾`
                                }
                            />
                        )}
                        <InfoRow
                            label="Статус"
                            value={statusLabel(selectedBooking)}
                        />
                        {/* Recurring series banner — shows "Постоянная бронь · осталось N
                            сессий" plus a [Продлить] button when this booking is part
                            of a series. Future-count comes from /recurring-groups. */}
                        {selectedBooking.recurringGroupId && <RecurringSeriesInfo groupId={selectedBooking.recurringGroupId} onExtended={() => fetchAllBookings()} />}
                    </div>

                    {/* Actions */}
                    {selectedBooking.status === 'confirmed' && (() => {
                        const rawTime = (typeof selectedBooking.startTime === 'string' && selectedBooking.startTime.includes(':'))
                            ? selectedBooking.startTime
                            : '00:00';
                        const [bh, bm] = rawTime.split(':').map(Number);
                        const bookEnd = new Date(selectedBooking.date);
                        bookEnd.setHours(bh || 0, (bm || 0) + (selectedBooking.duration || 60), 0, 0);
                        const isPastB = bookEnd < new Date();

                        return isPastB ? (
                            // Завершившаяся бронь. Для СЕГОДНЯШНЕЙ админ всё ещё может
                            // добить время по факту, дозаказать допы и поправить цену
                            // (в базе статус ещё confirmed — бэкенд эти правки принимает).
                            <div className="px-3 pb-3 space-y-1.5">
                                <div className="py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-500 text-center border border-gray-200">
                                    ☑️ Завершено
                                </div>
                                {bookingIsToday(selectedBooking) && (
                                    <div className="grid grid-cols-3 gap-1.5">
                                        <button
                                            onClick={() => setExtendModalId(selectedBooking.id)}
                                            className="py-1.5 text-xs font-medium rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors"
                                        >
                                            Продлить
                                        </button>
                                        <button
                                            onClick={() => setExtrasModalId(selectedBooking.id)}
                                            className="py-1.5 text-xs font-medium rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 transition-colors"
                                        >
                                            + Доп
                                        </button>
                                        <button
                                            onClick={() => handleEditPrice(selectedBooking)}
                                            className="py-1.5 text-xs font-medium rounded-lg bg-unbox-light hover:bg-unbox-light/70 text-unbox-dark transition-colors"
                                        >
                                            Цена
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            // Restored full action menu (Excel #28).
                            // Layout: 2 wide buttons on top (Перенести, Продлить —
                            // primary "fix the time" actions admins use most), then a
                            // 3-button row for Цена / Пересдать / Удалить.
                            <div className="px-3 pb-3 space-y-1.5">
                                <div className="grid grid-cols-2 gap-1.5">
                                    <button
                                        onClick={() => handleMove(selectedBooking)}
                                        className="py-1.5 text-xs font-medium rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
                                    >
                                        Перенести
                                    </button>
                                    <button
                                        onClick={() => setExtendModalId(selectedBooking.id)}
                                        className="py-1.5 text-xs font-medium rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors"
                                    >
                                        Продлить
                                    </button>
                                </div>
                                {bookingIsToday(selectedBooking) && (
                                    <button
                                        onClick={() => setExtrasModalId(selectedBooking.id)}
                                        className="w-full py-1.5 text-xs font-medium rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 transition-colors"
                                    >
                                        + Доп (кофе и т.п.)
                                    </button>
                                )}
                                <div className="grid grid-cols-3 gap-1.5">
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
                                        Удалить
                                    </button>
                                </div>
                                <button
                                    onClick={() => { const b = selectedBooking; setSelectedBooking(null); openWaitlistFor(b); }}
                                    className="w-full py-1.5 text-xs font-medium rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 flex items-center justify-center gap-1.5 transition-colors"
                                >
                                    <Bell size={12} /> Следить за слотом
                                </button>
                            </div>
                        );
                    })()}
                </div>
            )}

            <ExtendBookingModal
                bookingId={extendModalId}
                onClose={() => setExtendModalId(null)}
                onDone={() => { fetchAllBookings(); setSelectedBooking(null); }}
            />
            <AddExtrasModal
                bookingId={extrasModalId}
                onClose={() => setExtrasModalId(null)}
                onDone={() => { fetchAllBookings(); setSelectedBooking(null); }}
            />
            <MoveBookingModal
                booking={moveModalBooking}
                onClose={() => setMoveModalBooking(null)}
                onSubmit={(d, t, r) => moveModalBooking ? doMove(moveModalBooking, d, t, r) : undefined}
            />
            {seriesCancelTarget && seriesCancelTarget.recurringGroupId && (
                <CancelBookingChoiceModal
                    bookingId={seriesCancelTarget.id}
                    groupId={seriesCancelTarget.recurringGroupId}
                    onClose={() => setSeriesCancelTarget(null)}
                    onCompleted={async () => {
                        setSeriesCancelTarget(null);
                        setSelectedBooking(null);
                        await fetchAllBookings();
                    }}
                />
            )}

            {seriesMoveTarget && (
                <RescheduleScopeChoiceModal
                    bookingId={seriesMoveTarget.booking.id}
                    newDate={seriesMoveTarget.newDate}
                    newStartTime={seriesMoveTarget.newStartTime}
                    newResourceId={seriesMoveTarget.newResourceId}
                    onClose={() => setSeriesMoveTarget(null)}
                    onCompleted={async () => {
                        setSeriesMoveTarget(null);
                        await fetchAllBookings();
                    }}
                />
            )}

            {/* Slot-watch — opened from "Следить за слотом" in either popup. */}
            <WaitlistSubscribeModal
                isOpen={!!waitlistTarget}
                onClose={() => setWaitlistTarget(null)}
                resourceId={waitlistTarget?.resourceId ?? ''}
                resourceName={waitlistTarget?.resourceName ?? ''}
                locationName={waitlistTarget?.locationName}
                date={waitlistTarget?.date ?? new Date()}
                startTime={waitlistTarget?.startTime ?? ''}
                endTime={waitlistTarget?.endTime ?? ''}
                extraNote="Уведомим, как только в этом филиале освободится любой кабинет в это же время."
            />
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

/** Series detail block shown inside the booking-detail popup when the
 *  booking has a recurring_group_id. Pulls /recurring-groups, finds
 *  this group, displays "Постоянная бронь · осталось N сессий" with a
 *  [Продлить серию] button. Click prompts how many extra occurrences
 *  to add, then POSTs /bookings/recurring/{group_id}/extend. */
function RecurringSeriesInfo({ groupId, onExtended }: { groupId: string; onExtended: () => void }) {
    const [groupInfo, setGroupInfo] = useState<{ futureCount: number; totalCount: number; pattern: string } | null>(null);
    const [extending, setExtending] = useState(false);

    useEffect(() => {
        let cancelled = false;
        bookingsApi.getRecurringGroups()
            .then(groups => {
                if (cancelled) return;
                const g = groups.find(x => x.recurringGroupId === groupId);
                if (g) setGroupInfo({ futureCount: g.futureCount, totalCount: g.totalCount, pattern: g.pattern });
            })
            .catch(() => { if (!cancelled) setGroupInfo(null); });
        return () => { cancelled = true; };
    }, [groupId]);

    const handleExtend = async () => {
        const raw = prompt('На сколько повторений продлить серию?', '8');
        if (!raw) return;
        const n = parseInt(raw, 10);
        if (!n || n < 1 || n > 52) {
            toast.error('От 1 до 52');
            return;
        }
        setExtending(true);
        try {
            const res = await bookingsApi.extendRecurringSeries(groupId, n);
            toast.success(`Серия продлена на ${res.created} броней`);
            onExtended();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (typeof detail === 'object' && detail?.conflicts) {
                toast.error(`Конфликт: заняты ${detail.conflicts.map((c: any) => c.date).join(', ')}`, { duration: 8000 });
            } else {
                toast.error(typeof detail === 'string' ? detail : 'Не удалось продлить серию');
            }
        } finally {
            setExtending(false);
        }
    };

    if (!groupInfo) return null;
    const patternLabel = groupInfo.pattern === 'weekly' ? 'еженедельно'
        : groupInfo.pattern === 'biweekly' ? 'раз в 2 нед.'
        : 'ежемесячно';

    return (
        <div className="mt-2 pt-2 border-t border-unbox-light/50">
            <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-orange-500">⭐</span>
                <span className="text-xs font-semibold text-unbox-dark">Постоянная бронь</span>
                <span className="text-[10px] text-unbox-grey">· {patternLabel}</span>
            </div>
            <div className="text-[11px] text-unbox-grey mb-2">
                Осталось <span className="font-semibold text-unbox-dark">{groupInfo.futureCount}</span> из {groupInfo.totalCount} сессий
            </div>
            {groupInfo.futureCount <= 3 && (
                <button
                    onClick={handleExtend}
                    disabled={extending}
                    className="w-full py-1.5 text-xs font-medium rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 transition-colors disabled:opacity-60"
                >
                    {extending ? '…' : 'Продлить серию'}
                </button>
            )}
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
    // 2026-06-06 owner: формат и допы раньше были захардкожены
    // (`format = formats[0]`, `extras` не передавались). Теперь
    // выбор формата показывается если кабинет поддерживает >1
    // (кабинеты 7/8 — individual/group/intervision). Допы — из
    // availableExtrasForResource(resource) (кушетка, песочница,
    // проектор, кофе, флипчарт, столик — каждый для своих кабинетов).
    const [bookingFormat, setBookingFormat] = useState<string>(resource?.formats?.[0] || 'individual');
    const [extras, setExtras] = useState<string[]>([]);
    const availableExtras = availableExtrasForResource(resource);
    const [conflictState, setConflictState] = useState<null | {
        conflicts: ConflictItem[];
        resourceId: string;
        time: string;
        duration: number;
    }>(null);
    const allBookings = useUserStore(s => s.bookings);
    // Egor's request: let admins specify recurring as either "N occurrences"
    // or "until a specific date". The first is the default, the second is
    // a toggle. When in "until" mode we compute occurrences from firstDate
    // → untilDate based on the pattern interval.
    const [recurringMode, setRecurringMode] = useState<'count' | 'until'>('count');
    const [recurringUntil, setRecurringUntil] = useState<string>(
        format(addMinutes(slot.date, 90 * 24 * 60), 'yyyy-MM-dd'),
    );
    const dateStr = format(slot.date, 'yyyy-MM-dd');

    /** Compute the actual occurrence count to send to the backend. In
     *  "count" mode it's just the input value; in "until" mode we walk
     *  the interval (7/14/30 days) from firstDate until the chosen
     *  end date and count how many occurrences fit. Inclusive on both
     *  ends so "до 31 августа" includes 31 августа if it lands on the
     *  weekday. Capped at the same max as the "count" input (52 weekly
     *  / 24 monthly) so a fat-fingered "until 2099" can't bring down
     *  the world. */
    const effectiveOccurrences = (() => {
        if (!recurringPattern) return recurringOccurrences;
        if (recurringMode === 'count') return recurringOccurrences;
        const start = slot.date;
        const end = recurringUntil ? new Date(recurringUntil + 'T23:59:59') : start;
        if (end < start) return 1;
        const stepDays = recurringPattern === 'weekly' ? 7
            : recurringPattern === 'biweekly' ? 14
            : 30;
        const diffDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        const max = recurringPattern === 'monthly' ? 24 : 52;
        return Math.max(1, Math.min(max, Math.floor(diffDays / stepDays) + 1));
    })();

    const endTime = (() => {
        if (!slot?.time || typeof slot.time !== 'string' || !slot.time.includes(':')) return '';
        const [h, m] = slot.time.split(':').map(Number);
        const end = addMinutes(setMinutes(setHours(slot.date, h || 0), m || 0), duration);
        return format(end, 'HH:mm');
    })();

    const filteredUsers = searchQuery.length >= 1
        ? users.filter(u =>
            u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email?.toLowerCase().includes(searchQuery.toLowerCase())
        ).slice(0, 8)
        : [];

    const handleBook = async (overrideResourceId?: string) => {
        if (!selectedUser) {
            toast.error('Выберите пользователя');
            return;
        }
        setSaving(true);
        const bookResId = overrideResourceId || slot.resId;
        const bookResource = RESOURCES.find(r => r.id === bookResId) || resource;
        try {
            // Если админ выбрал альтернативный кабинет (overrideResourceId)
            // — fallback на первый разрешённый формат этого кабинета,
            // чтобы не уронить запрос если original format не поддерживается
            // (например админ кликнул в группового кабинете 7, выбрал
            // 'group', а конфликт-диалог предложил кабинет 1 где только
            // 'individual').
            const effectiveFormat = (bookResource?.formats?.includes(bookingFormat as Format)
                ? bookingFormat
                : (bookResource?.formats?.[0] || 'individual')) as Format;
            // Допы — фильтр по тем что доступны в выбранном bookResource
            // (для override-кабинета может быть меньше или больше).
            const allowed = new Set(availableExtrasForResource(bookResource).map(e => e.id));
            const effectiveExtras = extras.filter(eid => allowed.has(eid));

            if (recurringPattern) {
                const result = await bookingsApi.createRecurringBooking({
                    resourceId: bookResId,
                    locationId: bookResource?.locationId || 'unbox_one',
                    startTime: slot.time,
                    duration,
                    format: effectiveFormat,
                    paymentMethod: 'balance',
                    firstDate: dateStr,
                    occurrences: effectiveOccurrences,
                    pattern: recurringPattern,
                    targetUserId: selectedUser.email,
                    extras: effectiveExtras.length ? effectiveExtras : undefined,
                } as any);
                const patternLabel = recurringPattern === 'weekly' ? 'еженедельно' : recurringPattern === 'biweekly' ? 'раз в 2 нед.' : 'ежемесячно';
                toast.success(`Создано ${result.created} бронирований (${patternLabel}) на ${result.totalCost} ₾`);
            } else {
                await bookingsApi.createBooking({
                    resourceId: bookResId,
                    date: dateStr,
                    startTime: slot.time,
                    duration,
                    format: effectiveFormat,
                    extras: effectiveExtras,
                    locationId: bookResource?.locationId,
                    targetUserId: selectedUser.email,
                } as any);
                toast.success(`Бронирование создано для ${selectedUser.name}`);
            }
            onBooked();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            const message = typeof detail === 'string'
                ? detail
                : (detail?.message || e.message || 'Ошибка бронирования');
            const hasStructuredConflicts = typeof detail === 'object' && Array.isArray(detail?.conflicts);
            const isConflict = hasStructuredConflicts
                || message.includes('Time slot is already booked')
                || message.includes('Conflict');

            if (isConflict) {
                const conflicts: ConflictItem[] = hasStructuredConflicts
                    ? detail.conflicts.map((c: any) => ({
                        date: String(c.date || dateStr).slice(0, 10),
                        reason: c.reason || c.message || `${c.date}${c.start_time ? ' ' + c.start_time : ''} занято`,
                    }))
                    : [{ date: dateStr, reason: message }];
                setConflictState({
                    conflicts,
                    resourceId: slot.resId,
                    time: slot.time,
                    duration,
                });
            } else if (Array.isArray(detail)) {
                toast.error(detail.map((d: any) => d.msg).join(', '));
            } else {
                toast.error(message);
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

                {/* Формат — показываем только если кабинет поддерживает >1.
                    Для индивидуальных (кабинеты 1, 2, 5, 6, 9, капсулы) этот
                    блок скрыт, чтобы не загромождать форму. */}
                {(resource?.formats?.length ?? 0) > 1 && (
                    <div>
                        <label className="text-xs font-medium text-unbox-grey mb-1.5 block">Формат</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {(resource?.formats || []).map(f => {
                                const labels: Record<string, string> = {
                                    individual: 'Индивид.',
                                    group: 'Группа',
                                    intervision: 'Интервиз.',
                                };
                                return (
                                    <button
                                        key={f}
                                        type="button"
                                        onClick={() => setBookingFormat(f)}
                                        className={`py-2 rounded-xl text-xs font-medium border transition-colors ${
                                            bookingFormat === f
                                                ? 'bg-unbox-green text-white border-unbox-green'
                                                : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-green/50'
                                        }`}
                                    >
                                        {labels[f] || f}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Допы — фильтрованы по доступным для этого кабинета.
                    Бесплатные (flipchart_free, table_free) идут без цены.
                    Платные показывают `+N₾` рядом. Пустой массив — кабинет
                    не предлагает никаких допов, блок скрывается. */}
                {availableExtras.length > 0 && (
                    <div>
                        <label className="text-xs font-medium text-unbox-grey mb-1.5 block">Допы</label>
                        <div className="flex flex-wrap gap-1.5">
                            {availableExtras.map(extra => {
                                const checked = extras.includes(extra.id);
                                return (
                                    <button
                                        key={extra.id}
                                        type="button"
                                        onClick={() => setExtras(prev =>
                                            checked
                                                ? prev.filter(x => x !== extra.id)
                                                : [...prev, extra.id]
                                        )}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                                            checked
                                                ? 'bg-unbox-green text-white border-unbox-green'
                                                : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-green/50'
                                        }`}
                                    >
                                        {extra.name}
                                        {extra.price > 0 && <span className="opacity-80 ml-1">+{extra.price}₾</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

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
                        <div className="space-y-2 pt-1">
                            {/* Mode toggle: by count vs until date. Both
                                eventually compute occurrences for the
                                backend; "until" walks step intervals from
                                firstDate to the picked date. */}
                            <div className="flex gap-1.5">
                                {([
                                    { id: 'count' as const, label: 'По числу' },
                                    { id: 'until' as const, label: 'До даты' },
                                ]).map(m => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setRecurringMode(m.id)}
                                        className={`flex-1 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                            recurringMode === m.id
                                                ? 'bg-unbox-dark text-white border-unbox-dark'
                                                : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-dark/50'
                                        }`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                            {recurringMode === 'count' ? (
                                <div className="flex items-center gap-2">
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
                            ) : (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        value={recurringUntil}
                                        min={dateStr}
                                        onChange={e => setRecurringUntil(e.target.value)}
                                        className="px-2 py-1.5 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                    />
                                    <span className="text-xs text-unbox-grey">
                                        ≈ {effectiveOccurrences} {effectiveOccurrences === 1 ? 'бронь' : 'броней'}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <button
                    onClick={() => handleBook()}
                    disabled={saving || !selectedUser}
                    className="w-full py-3 bg-unbox-green text-white font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {recurringPattern ? `Создать серию · ${effectiveOccurrences} броней` : 'Забронировать'}
                </button>
            </div>

            {conflictState && (
                <BookingConflictDialog
                    conflicts={conflictState.conflicts}
                    resourceId={conflictState.resourceId}
                    time={conflictState.time}
                    duration={conflictState.duration}
                    ownBookings={allBookings}
                    onClose={() => setConflictState(null)}
                    onOpenBooking={() => {
                        // Admin context: the dialog reaches this branch only if
                        // the conflict reason mentions "у вас уже есть", which
                        // shouldn't normally trigger when booking for a third
                        // party. Just close — the admin can pick the user from
                        // the bookings list manually if they want.
                        setConflictState(null);
                    }}
                    onPickCabinet={(altResourceId) => {
                        setConflictState(null);
                        handleBook(altResourceId);
                    }}
                />
            )}
        </div>
    );
}
