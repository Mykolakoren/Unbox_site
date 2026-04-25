import { useUserStore } from '../store/userStore';
import { useBookingStore } from '../store/bookingStore';
import { useCrmStore } from '../store/crmStore';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
    BadgeCheck, XCircle, Clock, Calendar as CalendarIcon, Key, Wifi, Repeat,
    LayoutList, LayoutGrid, ChevronLeft, ChevronRight, X, RefreshCw, GripVertical,
    User as UserIcon, Check, Pencil, Loader2, Plus, ArrowRight, AlertTriangle, RotateCcw
} from 'lucide-react';
import clsx from 'clsx';
import { format, addMinutes, setHours, setMinutes, startOfToday, isBefore,
    startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isToday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { RESOURCES, EXTRAS, LOCATIONS } from '../utils/data';
import { isPeakTime, calculatePrice } from '../utils/pricing';
import type { Format } from '../types';
import { generateGoogleCalendarUrl } from '../utils/calendar';
import { bookingsApi } from '../api/bookings';
import { toast } from 'sonner';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';
import type { BookingHistoryItem } from '../store/types';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { EmptyState } from '../components/ui/EmptyState';
import { ChessboardScroller } from '../components/ui/ChessboardScroller';
import { waitlistApi } from '../api/waitlist';

// Parse backend UTC date string (no 'Z' suffix) correctly
const parseUTC = (d: string | Date) => {
    const s = String(d);
    return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
};

const timeToMins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

const minsToTime = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ─── Chess board sub-component ───────────────────────────────────────────────
function BookingsChessboard({
    userBookings,
    allBookings: _allBookings,
    publicBookings,
    onCancel,
    onReschedule,
    onReRent,
    onCancelReRent,
    onLinkClient,
    crmClients,
    refreshBookings,
    crmMode,
    onCrmBooked,
    usersMap,
    mobileLocFilter: mobileLocFilterProp,
}: {
    userBookings: BookingHistoryItem[];
    allBookings: BookingHistoryItem[];
    publicBookings: BookingHistoryItem[];
    onCancel: (id: string) => void;
    onReschedule: (booking: BookingHistoryItem) => void;
    onReRent: (id: string) => void;
    onCancelReRent: (id: string) => void;
    onLinkClient: (bookingId: string, clientId: string | null) => void;
    crmClients: Array<{ id: string; name: string; aliasCode?: string }>;
    refreshBookings: () => void;
    crmMode?: { sessionId: string; clientId: string; clientName: string; date: string; duration?: number } | null;
    onCrmBooked?: () => void;
    usersMap?: Map<string, string>;
    mobileLocFilter?: string;
}) {
    const { updateSession } = useCrmStore();
    const navigate = useNavigate();
    const bookingStoreActions = useBookingStore();
    const location = useLocation();
    const crmTargetDate = crmMode ? new Date(crmMode.date) : null;
    const navTargetDate = location.state?.targetDate ? new Date(location.state.targetDate) : null;
    const initialDate = crmTargetDate ?? navTargetDate ?? new Date();
    const [selectedDate, setSelectedDate] = useState(initialDate);
    const [weekStart, setWeekStart] = useState(() =>
        startOfWeek(initialDate, { weekStartsOn: 1 })
    );

    // Update selected date when navigating back with targetDate in state
    useEffect(() => {
        if (navTargetDate && !isSameDay(selectedDate, navTargetDate)) {
            setSelectedDate(navTargetDate);
            setWeekStart(startOfWeek(navTargetDate, { weekStartsOn: 1 }));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state?.targetDate]);

    // Quick booking slot for CRM mode
    const [crmSlot, setCrmSlot] = useState<{ resId: string; time: string; date: Date } | null>(null);
    const [activeBooking, setActiveBooking] = useState<BookingHistoryItem | null>(null);
    const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLDivElement>(null);

    // Drag state (rescheduling existing bookings)
    const [dragBooking, setDragBooking] = useState<BookingHistoryItem | null>(null);
    const [dragTarget, setDragTarget] = useState<{ resId: string; time: string } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ resId: string; time: string; offsetMins: number } | null>(null);

    // ── Drag-to-select NEW booking slots ──
    const [newSlots, setNewSlots] = useState<string[]>([]); // "resId|time" format
    const [recurringPattern, setRecurringPattern] = useState<'' | 'weekly' | 'biweekly' | 'monthly'>('');
    const [recurringOccurrences, setRecurringOccurrences] = useState(12);
    const [recurringSaving, setRecurringSaving] = useState(false);
    const bookingSaving = false; // sync navigation, no async state needed
    type NewDragMode = 'new' | 'resize-start' | 'resize-end' | 'move' | null;
    const newDragModeRef = useRef<NewDragMode>(null);
    const newDragStartRef = useRef<{ resId: string; time: string } | null>(null);
    const newDragInitialBlockRef = useRef<{ resId: string; start: number; end: number } | null>(null);
    const newDragMoveOffsetRef = useRef<number>(0); // slot offset within block for move mode
    const [, setNewDragTick] = useState(0);
    const forceNewDragUpdate = () => setNewDragTick(t => t + 1);

    // CRM session time hint (dashed overlay on chessboard)
    const crmHintDate = crmMode?.date ? format(parseISO(crmMode.date), 'yyyy-MM-dd') : null;
    const crmHintStartMins = crmMode?.date ? timeToMins(format(parseISO(crmMode.date), 'HH:mm')) : -1;
    const crmHintEndMins = crmHintStartMins >= 0 ? crmHintStartMins + (crmMode?.duration ?? 60) : -1;

    const weekDays = useMemo(() => eachDayOfInterval({
        start: weekStart,
        end: endOfWeek(weekStart, { weekStartsOn: 1 })
    }), [weekStart]);

    // Close popup on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                setActiveBooking(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // 30-min time slots 09:00–22:00. Slots from 21:00 onward are billed
    // at the evening surcharge rate (see isEveningSurcharge) — admins asked
    // to make after-hours bookings reachable without filing a request.
    const timeSlots = useMemo(() => {
        const slots: string[] = [];
        let t = setMinutes(setHours(startOfToday(), 9), 0);
        const end = setMinutes(setHours(startOfToday(), 22), 0);
        while (isBefore(t, end)) {
            slots.push(format(t, 'HH:mm'));
            t = addMinutes(t, 30);
        }
        return slots;
    }, []);

    // Everything at or after 21:00 is "вечерняя надбавка" — marked visually
    // on the chessboard header so the admin / client sees it's premium.
    const isEveningSurcharge = (slot: string) => {
        const [h] = slot.split(':').map(Number);
        return h >= 21;
    };

    const resources = RESOURCES;

    // Build day's booking map — include completed bookings
    const dayUserBookings = useMemo(() =>
        userBookings.filter(b =>
            (b.status === 'confirmed' || b.status === 'completed') &&
            isSameDay(parseUTC(b.date), selectedDate)
        ), [userBookings, selectedDate]);

    // Public bookings for other users' occupancy
    const dayPublicBookings = useMemo(() =>
        publicBookings.filter(b =>
            (b.status === 'confirmed' || b.status === 'completed') &&
            isSameDay(parseUTC(b.date), selectedDate)
        ), [publicBookings, selectedDate]);

    // Find booking at a specific slot
    const findBookingAtSlot = (bookings: BookingHistoryItem[], resId: string, time: string) =>
        bookings.find(b => {
            if (b.resourceId !== resId || !b.startTime) return false;
            const bStart = timeToMins(b.startTime);
            const bEnd = bStart + b.duration;
            const s = timeToMins(time);
            return s >= bStart && s < bEnd;
        }) ?? null;

    // Can cancel/reschedule? confirmed + >24h before start
    const canModify = (b: BookingHistoryItem) => {
        if (b.status !== 'confirmed' || !b.startTime) return false;
        const [h, m] = b.startTime.split(':').map(Number);
        const start = parseUTC(b.date);
        start.setUTCHours(h, m, 0, 0);
        return (start.getTime() - Date.now()) > 24 * 60 * 60 * 1000;
    };

    // Is slot in the past?
    const isSlotPast = useCallback((time: string) => {
        if (!isToday(selectedDate)) return isBefore(selectedDate, startOfToday());
        const [h, m] = time.split(':').map(Number);
        const now = new Date();
        return h < now.getHours() || (h === now.getHours() && m <= now.getMinutes());
    }, [selectedDate]);

    // Days that have bookings (for dot indicators)
    const daysWithBookings = useMemo(() => {
        const set = new Set<string>();
        userBookings.filter(b => b.status === 'confirmed' || b.status === 'completed').forEach(b =>
            set.add(format(parseUTC(b.date), 'yyyy-MM-dd'))
        );
        return set;
    }, [userBookings]);

    // CRM client lookup
    const clientMap = useMemo(() => {
        const map = new Map<string, { name: string; aliasCode?: string }>();
        crmClients.forEach(c => map.set(c.id, c));
        return map;
    }, [crmClients]);

    // ── Is slot occupied (blocked for new booking)? ──
    const isSlotOccupied = useCallback((resId: string, time: string) => {
        if (isSlotPast(time)) return true;
        return !!findBookingAtSlot(dayUserBookings, resId, time) ||
            !!findBookingAtSlot(dayPublicBookings, resId, time);
    }, [isSlotPast, dayUserBookings, dayPublicBookings]);

    // ── Selected new block info ──
    const selectedNewBlocks = useMemo(() => {
        const byRes: Record<string, number[]> = {};
        for (const slot of newSlots) {
            const [resId, timeStr] = slot.split('|');
            const idx = timeSlots.indexOf(timeStr);
            if (idx === -1) continue;
            if (!byRes[resId]) byRes[resId] = [];
            byRes[resId].push(idx);
        }
        return Object.entries(byRes).map(([resId, indices]) => {
            const sorted = [...indices].sort((a, b) => a - b);
            return { resId, start: sorted[0], end: sorted[sorted.length - 1] };
        });
    }, [newSlots, timeSlots]);

    const getNewBlockForResource = (resId: string) =>
        selectedNewBlocks.find(b => b.resId === resId) ?? null;

    // Overlap detection: warn when new slots overlap with each other OR with existing user bookings
    const hasTimeOverlap = useMemo(() => {
        if (selectedNewBlocks.length === 0) return false;

        // Build time-index sets for each new block
        const newBlockSets = selectedNewBlocks.map(b => {
            const slots = new Set<number>();
            for (let i = b.start; i <= b.end; i++) slots.add(i);
            return slots;
        });

        // Check new blocks against each other
        for (let i = 0; i < newBlockSets.length; i++) {
            for (let j = i + 1; j < newBlockSets.length; j++) {
                for (const idx of newBlockSets[i]) {
                    if (newBlockSets[j].has(idx)) return true;
                }
            }
        }

        // Check new blocks against existing user bookings (different rooms only)
        for (const block of selectedNewBlocks) {
            const blockStartMins = timeToMins(timeSlots[block.start]);
            const blockEndMins = timeToMins(timeSlots[block.end]) + 30; // +30 because slot end is exclusive
            for (const booking of dayUserBookings) {
                if (booking.resourceId === block.resId) continue; // same room — not an overlap concern
                if (!booking.startTime) continue;
                const bStart = timeToMins(booking.startTime);
                const bEnd = bStart + booking.duration;
                if (blockStartMins < bEnd && blockEndMins > bStart) return true;
            }
        }

        return false;
    }, [selectedNewBlocks, dayUserBookings, timeSlots]);

    const isNewSlotSelected = (resId: string, time: string) =>
        newSlots.includes(`${resId}|${time}`);

    const setNewSlotRange = useCallback((resId: string, times: string[]) => {
        setNewSlots(prev => {
            const other = prev.filter(s => !s.startsWith(`${resId}|`));
            return [...other, ...times.map(t => `${resId}|${t}`)];
        });
    }, []);

    // ── New booking drag handlers ──
    const handleNewDragDown = (resId: string, time: string, mode: NewDragMode) => {
        if (isSlotOccupied(resId, time) && mode === 'new') return;

        // If clicking on already-selected slot in 'new' mode → switch to 'move'
        if (mode === 'new' && isNewSlotSelected(resId, time)) {
            const block = getNewBlockForResource(resId);
            if (block) {
                newDragModeRef.current = 'move';
                newDragStartRef.current = { resId, time };
                newDragInitialBlockRef.current = block;
                const clickedIdx = timeSlots.indexOf(time);
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

        const currentIdx = timeSlots.indexOf(time);
        const startIdx = timeSlots.indexOf(startSlot.time);
        if (currentIdx === -1 || startIdx === -1) return;

        if (mode === 'new') {
            if (startSlot.resId !== resId) return;
            const minIdx = Math.min(startIdx, currentIdx);
            const maxIdx = Math.max(startIdx, currentIdx);
            const slots: string[] = [];
            let blocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotOccupied(resId, timeSlots[i])) { blocked = true; break; }
                slots.push(timeSlots[i]);
            }
            if (!blocked) setNewSlotRange(resId, slots);
        } else if (mode === 'resize-end' && initBlock) {
            if (initBlock.resId !== resId) return;
            const minIdx = initBlock.start;
            const maxIdx = Math.max(minIdx, currentIdx);
            const slots: string[] = [];
            let blocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotOccupied(resId, timeSlots[i])) { blocked = true; break; }
                slots.push(timeSlots[i]);
            }
            if (!blocked) setNewSlotRange(resId, slots);
        } else if (mode === 'resize-start' && initBlock) {
            if (initBlock.resId !== resId) return;
            const maxIdx = initBlock.end;
            const minIdx = Math.min(maxIdx, currentIdx);
            const slots: string[] = [];
            let blocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotOccupied(resId, timeSlots[i])) { blocked = true; break; }
                slots.push(timeSlots[i]);
            }
            if (!blocked) setNewSlotRange(resId, slots);
        } else if (mode === 'move' && initBlock) {
            if (initBlock.resId !== resId) return;
            const blockLen = initBlock.end - initBlock.start + 1;
            const newStart = currentIdx - newDragMoveOffsetRef.current;
            const newEnd = newStart + blockLen - 1;
            if (newStart < 0 || newEnd >= timeSlots.length) return;
            const slots: string[] = [];
            let blocked = false;
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotOccupied(resId, timeSlots[i])) { blocked = true; break; }
                slots.push(timeSlots[i]);
            }
            if (!blocked) setNewSlotRange(resId, slots);
        }
    }, [timeSlots, isSlotOccupied]);

    const handleNewDragUp = useCallback(() => {
        if (!newDragModeRef.current) return;
        const dragResId = newDragStartRef.current?.resId ?? null;
        newDragModeRef.current = null;
        newDragStartRef.current = null;
        newDragInitialBlockRef.current = null;
        forceNewDragUpdate();

        // Min 1h per resource: if the just-dragged resource has only 1 slot, auto-add pair
        setNewSlots(prev => {
            if (!dragResId) return prev;
            const resSlots = prev.filter(s => s.startsWith(`${dragResId}|`));
            if (resSlots.length !== 1) return prev;
            const timeStr = resSlots[0].split('|')[1];
            const idx = timeSlots.indexOf(timeStr);
            // Try adding next slot first
            if (idx >= 0 && idx + 1 < timeSlots.length && !isSlotOccupied(dragResId, timeSlots[idx + 1])) {
                return [...prev, `${dragResId}|${timeSlots[idx + 1]}`];
            }
            // If next is occupied, try previous slot
            if (idx > 0 && !isSlotOccupied(dragResId, timeSlots[idx - 1])) {
                return [...prev, `${dragResId}|${timeSlots[idx - 1]}`];
            }
            // Both neighbors occupied — can't make 1h block, clear selection
            return prev.filter(s => !s.startsWith(`${dragResId}|`));
        });
    }, [timeSlots, isSlotOccupied]);

    // Global pointer events for new drag
    useEffect(() => {
        const handleMove = (e: PointerEvent) => {
            if (!newDragModeRef.current) return;
            if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                const target = document.elementFromPoint(e.clientX, e.clientY);
                if (!target) return;
                const slotEl = target.closest('[data-newresid][data-newtime]');
                if (slotEl) {
                    const rId = slotEl.getAttribute('data-newresid');
                    const tStr = slotEl.getAttribute('data-newtime');
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
    useEffect(() => { setNewSlots([]); setRecurringPattern(''); }, [selectedDate]);

    // Overlap warning state
    const [showOverlapWarning, setShowOverlapWarning] = useState(false);

    // ── Handle "Продолжить" — navigate to checkout wizard ──
    const proceedToCheckout = () => {
        if (newSlots.length === 0) return;
        const block = selectedNewBlocks[0];
        if (!block) return;

        const resource = RESOURCES.find(r => r.id === block.resId);

        // Sync selection into bookingStore for the checkout wizard.
        bookingStoreActions.reset();
        useBookingStore.setState({
            locationId: resource?.locationId || 'unbox_one',
            date: selectedDate,
            format: (resource?.formats?.[0] as any) || 'individual',
            selectedSlots: [...newSlots],
            step: 4, // confirmation: cost calculation + payment method + CRM client
        });

        setNewSlots([]);
        navigate('/checkout');
    };

    const handleRecurringBooking = async () => {
        if (newSlots.length === 0 || !recurringPattern) return;
        const block = selectedNewBlocks[0];
        if (!block) return;

        const resource = RESOURCES.find(r => r.id === block.resId);
        const startTime = timeSlots[block.start];
        const duration = (block.end - block.start + 1) * 30;

        setRecurringSaving(true);
        try {
            const result = await bookingsApi.createRecurringBooking({
                resourceId: block.resId,
                locationId: resource?.locationId || 'unbox_one',
                startTime,
                duration,
                format: (resource?.formats?.[0] as string) || 'individual',
                paymentMethod: 'balance',
                firstDate: format(selectedDate, 'yyyy-MM-dd'),
                occurrences: recurringOccurrences,
                pattern: recurringPattern,
            });
            const patternLabel = recurringPattern === 'weekly' ? 'еженедельно' : recurringPattern === 'biweekly' ? 'раз в 2 нед.' : 'ежемесячно';
            toast.success(`Серия создана: ${result.created} бронирований (${patternLabel}), ${result.totalCost?.toFixed(0) ?? 0} ₾`);
            setNewSlots([]);
            setRecurringPattern('');
            await useUserStore.getState().fetchBookings();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (typeof detail === 'object' && detail?.conflicts) {
                toast.error(`Конфликт: заняты ${detail.conflicts.map((c: any) => c.date).join(', ')}`, { duration: 8000 });
            } else {
                const msg = typeof detail === 'string' ? detail : e.message || 'Ошибка создания серии';
                toast.error(msg);
            }
        } finally {
            setRecurringSaving(false);
        }
    };

    const handleConfirmNewBooking = () => {
        if (recurringPattern) {
            handleRecurringBooking();
            return;
        }
        if (hasTimeOverlap) {
            setShowOverlapWarning(true);
        } else {
            proceedToCheckout();
        }
    };

    // ─── Drag handlers (rescheduling) ──────────────────────────────────────────
    const handleDragStart = (booking: BookingHistoryItem, resId: string, time: string, e: React.PointerEvent) => {
        if (!canModify(booking)) return;
        // Admins cannot drag other users' bookings to prevent accidental reschedules
        const cu = useUserStore.getState().currentUser;
        if (cu?.isAdmin && booking.userId !== cu?.email) return;
        e.preventDefault();
        const offsetMins = timeToMins(time) - timeToMins(booking.startTime!);
        dragStartRef.current = { resId, time, offsetMins };
        setDragBooking(booking);
        setDragTarget({ resId, time: booking.startTime! });
        setIsDragging(true);
    };

    const handleDragOver = useCallback((resId: string, time: string) => {
        if (!isDragging || !dragBooking || !dragStartRef.current) return;
        const offset = dragStartRef.current.offsetMins;
        const targetMins = timeToMins(time) - offset;
        const snapped = Math.round(targetMins / 30) * 30;
        const clampedStart = Math.max(9 * 60, Math.min(snapped, 21 * 60 - dragBooking.duration));
        setDragTarget({ resId, time: minsToTime(clampedStart) });
    }, [isDragging, dragBooking]);

    const handleDragEnd = useCallback(async () => {
        if (!isDragging || !dragBooking || !dragTarget) {
            setIsDragging(false);
            setDragBooking(null);
            setDragTarget(null);
            return;
        }
        setIsDragging(false);

        const oldTime = dragBooking.startTime!;
        const oldRes = dragBooking.resourceId;
        const newTime = dragTarget.time;
        const newRes = dragTarget.resId;

        // No change
        if (oldTime === newTime && oldRes === newRes) {
            setDragBooking(null);
            setDragTarget(null);
            return;
        }

        // Confirm
        const resName = RESOURCES.find(r => r.id === newRes)?.name || newRes;
        const confirmed = window.confirm(
            `Перенести бронь?\n${oldTime} → ${newTime}${oldRes !== newRes ? `\n${RESOURCES.find(r => r.id === oldRes)?.name} → ${resName}` : ''}`
        );

        if (confirmed) {
            try {
                const newDate = format(selectedDate, 'yyyy-MM-dd');
                await bookingsApi.rescheduleBooking(dragBooking.id, {
                    newDate,
                    newStartTime: newTime,
                    newResourceId: oldRes !== newRes ? newRes : undefined,
                });
                // If dragging in CRM mode, sync new time back to the linked session
                if (crmMode?.sessionId) {
                    await updateSession(crmMode.sessionId, { date: `${newDate}T${newTime}:00` });
                }
                toast.success('Бронирование перенесено');
                refreshBookings();
            } catch (err: any) {
                toast.error(err.response?.data?.detail || 'Не удалось перенести');
            }
        }

        setDragBooking(null);
        setDragTarget(null);
    }, [isDragging, dragBooking, dragTarget, selectedDate, refreshBookings]);

    // Global pointer up listener for drag
    useEffect(() => {
        if (!isDragging) return;
        const handler = () => handleDragEnd();
        window.addEventListener('pointerup', handler);
        return () => window.removeEventListener('pointerup', handler);
    }, [isDragging, handleDragEnd]);

    const handleCellClick = (booking: BookingHistoryItem | null, e: React.MouseEvent, isOther: boolean) => {
        if (isDragging) return;
        if (!booking || isOther) return;
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        // fixed positioning — viewport coords only, no scrollY
        const top = rect.bottom + 6;
        const left = Math.min(rect.left, window.innerWidth - 336);
        setPopupPos({ top, left });
        setActiveBooking(booking);
    };

    // ── Mobile detection ──
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    const [mobileResIdx, setMobileResIdx] = useState(0);
    const mobileLocFilter = mobileLocFilterProp ?? 'all';
    const mobileFilteredResources = useMemo(() =>
        mobileLocFilter === 'all' ? resources : resources.filter(r => r.locationId === mobileLocFilter),
        [resources, mobileLocFilter]
    );
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);
    const mobileRes = mobileFilteredResources[mobileResIdx] ?? mobileFilteredResources[0] ?? null;

    // ── Mobile hour-pairs ──
    const mobileHourPairs = useMemo(() => {
        const pairs: [string, string | null][] = [];
        for (let i = 0; i < timeSlots.length; i += 2) {
            pairs.push([timeSlots[i], timeSlots[i + 1] ?? null]);
        }
        return pairs;
    }, [timeSlots]);

    // ── Mobile tap handler ──
    const handleMobileTap = (resId: string, time: string, _isHourTap: boolean) => {
        if (isSlotOccupied(resId, time)) return;
        const slotIdx = timeSlots.indexOf(time);
        const block = getNewBlockForResource(resId);

        if (newSlots.includes(`${resId}|${time}`)) {
            setNewSlotRange(resId, []);
            return;
        }

        if (crmMode) {
            setCrmSlot({ resId, time, date: selectedDate });
            return;
        }

        if (block) {
            // Extending — always +1 slot
            const newStart = Math.min(block.start, slotIdx);
            const newEnd = Math.max(block.end, slotIdx);
            const slots: string[] = [];
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotOccupied(resId, timeSlots[i])) return;
                slots.push(timeSlots[i]);
            }
            setNewSlotRange(resId, slots);
        } else {
            // First selection — ALWAYS auto-select pair (1h minimum)
            const pairStart = slotIdx % 2 === 0 ? slotIdx : slotIdx - 1;
            const pairEnd = pairStart + 1;
            if (pairEnd >= timeSlots.length) return; // not enough slots
            const slots: string[] = [];
            for (let i = pairStart; i <= pairEnd; i++) {
                if (isSlotOccupied(resId, timeSlots[i])) return; // both must be free
                slots.push(timeSlots[i]);
            }
            setNewSlotRange(resId, slots);
        }
    };

    // Mobile uses the same proceedToCheckout as desktop

    // ── MOBILE VIEW ──
    if (isMobile) {
        const mBlock = mobileRes ? getNewBlockForResource(mobileRes.id) : null;
        const mBlockStart = mBlock ? timeSlots[mBlock.start] : null;
        const mBlockEnd = mBlock ? (() => {
            const [h, m] = timeSlots[mBlock.end].split(':').map(Number);
            return format(addMinutes(setMinutes(setHours(startOfToday(), h), m), 30), 'HH:mm');
        })() : null;
        const mBlockDur = mBlock ? (mBlock.end - mBlock.start + 1) * 30 : 0;

        return (
            <div className="space-y-3 pb-28">
                {/* Week nav */}
                <div className="rounded-2xl border border-unbox-light/60 overflow-hidden" style={{ background: 'rgba(212,226,225,0.35)' }}>
                    <div className="text-center text-xs font-semibold text-unbox-dark/60 pt-1.5 pb-0.5 capitalize">
                        {(() => {
                            const first = weekDays[0];
                            const last = weekDays[weekDays.length - 1];
                            const m1 = format(first, 'LLLL', { locale: ru });
                            const m2 = format(last, 'LLLL', { locale: ru });
                            const y = format(last, 'yyyy');
                            return m1 === m2 ? `${m1} ${y}` : `${m1} – ${m2} ${y}`;
                        })()}
                    </div>
                    <div className="flex items-center gap-1 p-1 pt-0">
                    <button onClick={() => { const n = subWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }} className="p-1.5 rounded-lg hover:bg-white text-unbox-grey">
                        <ChevronLeft size={16} />
                    </button>
                    <div className="flex-1 grid grid-cols-7 gap-1">
                        {weekDays.map(day => {
                            const isSelected = isSameDay(day, selectedDate);
                            const hasBooking = daysWithBookings.has(format(day, 'yyyy-MM-dd'));
                            return (
                                <button
                                    key={day.toISOString()}
                                    onClick={() => setSelectedDate(day)}
                                    className={clsx(
                                        "flex flex-col items-center py-2 rounded-xl transition-all text-xs relative",
                                        isSelected
                                            ? "bg-unbox-green text-white shadow-md"
                                            : "bg-white text-unbox-grey border border-unbox-light/50"
                                    )}
                                >
                                    <span className="text-[9px] font-bold uppercase">{format(day, 'EEEEEE', { locale: ru })}</span>
                                    <span className="text-sm font-bold">{format(day, 'd')}</span>
                                    {hasBooking && <span className={clsx("absolute bottom-1 w-1.5 h-1.5 rounded-full", isSelected ? "bg-white/80" : "bg-unbox-green")} />}
                                </button>
                            );
                        })}
                    </div>
                    <button onClick={() => { const n = addWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }} className="p-1.5 rounded-lg hover:bg-white text-unbox-grey">
                        <ChevronRight size={16} />
                    </button>
                    </div>
                </div>

                {/* Resource tabs grouped by location */}
                {(() => {
                    const locGroups = mobileLocFilter === 'all'
                        ? LOCATIONS.map(loc => ({
                            loc,
                            rooms: mobileFilteredResources.filter(r => r.locationId === loc.id),
                        })).filter(g => g.rooms.length > 0)
                        : [{ loc: LOCATIONS.find(l => l.id === mobileLocFilter)!, rooms: mobileFilteredResources }];

                    return (
                        <div className="space-y-2">
                            {locGroups.map(({ loc, rooms }) => (
                                <div key={loc.id} className="rounded-xl border border-unbox-light/40 bg-white/30 backdrop-blur-sm p-1.5">
                                    {mobileLocFilter === 'all' && (
                                        <div className="text-[10px] font-bold text-unbox-grey uppercase tracking-wider px-2 pb-1">{loc.name}</div>
                                    )}
                                    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                                        {rooms.map(r => {
                                            const globalIdx = mobileFilteredResources.indexOf(r);
                                            return (
                                                <button
                                                    key={r.id}
                                                    onClick={() => setMobileResIdx(globalIdx)}
                                                    className={clsx(
                                                        'shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                                                        mobileResIdx === globalIdx
                                                            ? 'bg-unbox-green text-white border-unbox-green'
                                                            : 'bg-white text-gray-500 border-gray-100'
                                                    )}
                                                >
                                                    <div className="font-bold whitespace-nowrap text-[11px]">{r.name}</div>
                                                    <div className="text-[9px] opacity-70">{r.capacity} чел.</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })()}

                {/* Selected block summary */}
                {mBlock && mobileRes && (
                    <div className="flex items-center justify-between bg-unbox-green/10 border border-unbox-green/20 rounded-xl px-4 py-3">
                        <div>
                            <div className="text-sm font-bold text-unbox-dark">{mBlockStart} — {mBlockEnd}</div>
                            <div className="text-xs text-unbox-grey">{mBlockDur} мин · {mobileRes.name}</div>
                        </div>
                        <button onClick={() => setNewSlotRange(mobileRes.id, [])} className="p-1.5 rounded-lg bg-red-100 text-red-500">
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* CRM mode hint */}
                {crmMode && (
                    <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-sm">
                        <CalendarIcon className="w-4 h-4 text-orange-500 shrink-0" />
                        <span className="text-orange-800 text-xs">Выберите слот для <strong>{crmMode.clientName}</strong></span>
                    </div>
                )}

                {/* 2-column time grid */}
                <div className="rounded-2xl bg-white/60 backdrop-blur-sm border border-unbox-light/30 p-2 space-y-1.5">
                    {mobileRes && mobileHourPairs.map(([left, right]) => (
                        <div key={left} className="flex gap-1.5">
                            {[left, right].map((time, colIdx) => {
                                if (!time) return <div key={`empty-${colIdx}`} className="flex-1" />;
                                const isHourCol = colIdx === 0;
                                const isPast = isSlotPast(time);
                                const myB = findBookingAtSlot(dayUserBookings, mobileRes.id, time);
                                const pubB = !myB ? findBookingAtSlot(dayPublicBookings, mobileRes.id, time) : null;
                                const newSel = isNewSlotSelected(mobileRes.id, time);

                                // Show booking cell
                                if (myB && timeToMins(myB.startTime!) === timeToMins(time)) {
                                    const clientInfo = myB.crmClientId ? clientMap.get(myB.crmClientId) : null;
                                    const endTime = minsToTime(timeToMins(myB.startTime!) + myB.duration);
                                    const isCompleted = myB.status === 'completed';
                                    return (
                                        <button
                                            key={time}
                                            onClick={() => setActiveBooking(myB)}
                                            className={clsx(
                                                'flex-1 flex flex-col justify-center px-2.5 py-2 rounded-xl text-left min-h-[48px] border',
                                                isCompleted
                                                    ? 'bg-gray-100 border-gray-200 text-gray-500'
                                                    : 'bg-unbox-green/10 border-unbox-green/30 text-unbox-dark'
                                            )}
                                        >
                                            <div className="text-[10px] font-bold tabular-nums">{myB.startTime}–{endTime}</div>
                                            <div className="text-[10px] truncate">
                                                {clientInfo?.name || usersMap?.get(myB.userId) || myB.userId.split('@')[0]}
                                            </div>
                                        </button>
                                    );
                                }

                                // Skip mid-slots of bookings
                                if (myB || (pubB && timeToMins(pubB.startTime!) !== timeToMins(time))) {
                                    return null;
                                }

                                // Other user's booking
                                if (pubB && timeToMins(pubB.startTime!) === timeToMins(time)) {
                                    const endTime = minsToTime(timeToMins(pubB.startTime!) + pubB.duration);
                                    const pubName = usersMap?.get(pubB.userId) || '';
                                    return (
                                        <button
                                            key={time}
                                            className="flex-1 flex flex-col justify-center px-2.5 py-2 rounded-xl text-left min-h-[48px] bg-gray-100 border border-gray-200 text-gray-400"
                                        >
                                            <div className="text-[10px] font-bold tabular-nums">{pubB.startTime}–{endTime}</div>
                                            <div className="text-[10px] truncate">{pubName || 'Занято'}</div>
                                        </button>
                                    );
                                }

                                // Free slot
                                return (
                                    <button
                                        key={time}
                                        onClick={() => !isPast && handleMobileTap(mobileRes.id, time, isHourCol)}
                                        disabled={isPast}
                                        className={clsx(
                                            'flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl transition-all min-h-[48px]',
                                            isPast
                                                ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                                                : newSel
                                                    ? 'bg-unbox-green text-white shadow-sm'
                                                    : isPeakTime(time)
                                                        ? 'bg-amber-50 text-amber-700 border border-amber-200/60 active:scale-[0.97]'
                                                        : 'bg-white text-unbox-dark border border-unbox-light/40 active:scale-[0.97]'
                                        )}
                                    >
                                        <span className={clsx('text-sm font-bold tabular-nums', newSel ? 'text-white' : isPast ? 'text-gray-300' : 'text-unbox-dark')}>
                                            {time}
                                        </span>
                                        {newSel ? (
                                            <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                            </div>
                                        ) : !isPast ? (
                                            <div className="w-5 h-5 rounded-full border-2 border-unbox-light" />
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Bottom bar */}
                {(mBlock || hasTimeOverlap) && (
                    <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-3">
                        <div
                            className="rounded-2xl p-3 space-y-2.5"
                            style={{
                                background: 'rgba(255,255,255,0.90)',
                                backdropFilter: 'blur(24px)',
                                WebkitBackdropFilter: 'blur(24px)',
                                border: '1px solid rgba(255,255,255,0.50)',
                                boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
                            }}
                        >
                            {/* Recurring pattern selector */}
                            <div className="flex gap-1">
                                {([
                                    { id: '' as const, label: 'Разово' },
                                    { id: 'weekly' as const, label: 'Кажд. нед.' },
                                    { id: 'biweekly' as const, label: '2 нед.' },
                                    { id: 'monthly' as const, label: 'Месяц' },
                                ]).map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setRecurringPattern(p.id)}
                                        className={clsx(
                                            'flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border',
                                            recurringPattern === p.id
                                                ? 'bg-unbox-green text-white border-unbox-green'
                                                : 'border-gray-200 text-gray-500 hover:border-unbox-green'
                                        )}
                                    >
                                        {p.id === '' ? p.label : <span className="flex items-center justify-center gap-0.5"><Repeat size={10} />{p.label}</span>}
                                    </button>
                                ))}
                            </div>

                            {/* Occurrences input */}
                            {recurringPattern && (
                                <div className="flex items-center gap-2 px-1">
                                    <input
                                        type="number"
                                        value={recurringOccurrences}
                                        onChange={e => {
                                            const max = recurringPattern === 'monthly' ? 24 : 52;
                                            setRecurringOccurrences(Math.max(2, Math.min(max, Number(e.target.value))));
                                        }}
                                        min={2}
                                        max={recurringPattern === 'monthly' ? 24 : 52}
                                        className="w-14 px-2 py-1 rounded-lg border border-unbox-light text-sm text-center focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                    />
                                    <span className="text-[11px] text-gray-500">
                                        повторений · {recurringPattern === 'monthly'
                                            ? `≈ ${recurringOccurrences} мес.`
                                            : recurringPattern === 'biweekly'
                                                ? `≈ ${Math.round(recurringOccurrences / 2)} мес.`
                                                : `≈ ${Math.round(recurringOccurrences / 4.3)} мес.`}
                                    </span>
                                </div>
                            )}

                            {/* Action row */}
                            <div className="flex items-center justify-between">
                                <div className="text-sm text-unbox-dark">
                                    <span className="font-bold text-unbox-green">{newSlots.length * 30} мин</span> выбрано
                                </div>
                                <button
                                    onClick={handleConfirmNewBooking}
                                    disabled={newSlots.length === 0 || recurringSaving}
                                    className="bg-unbox-green text-white font-medium text-sm px-5 py-2.5 rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    {recurringSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                                    {recurringPattern ? `Серия · ${recurringOccurrences}` : 'Забронировать'} <ArrowRight size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Booking detail popup (mobile: bottom sheet) */}
                {activeBooking && (
                    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={() => setActiveBooking(null)}>
                        <div className="bg-white rounded-t-2xl shadow-2xl w-full max-w-md p-5 animate-in slide-in-from-bottom-4 duration-200" onClick={e => e.stopPropagation()}>
                            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <div className="font-bold text-unbox-dark">
                                        {activeBooking.crmClientId && clientMap.get(activeBooking.crmClientId)?.name || usersMap?.get(activeBooking.userId) || activeBooking.userId}
                                    </div>
                                    <div className="text-xs text-unbox-grey">
                                        {activeBooking.startTime} · {activeBooking.duration / 60}ч · {resources.find(r => r.id === activeBooking.resourceId)?.name}
                                    </div>
                                </div>
                                <button onClick={() => setActiveBooking(null)} className="p-1"><X size={16} /></button>
                            </div>
                            <div className="text-sm mb-4">
                                <span className={clsx(
                                    'px-2 py-0.5 rounded-full text-xs font-medium',
                                    activeBooking.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                )}>
                                    {activeBooking.status === 'confirmed' ? (activeBooking.isReRentListed ? '♻️ Переаренда' : '✅ Активно') : '☑️ Завершено'}
                                </span>
                                <span className="ml-2 text-unbox-grey">{activeBooking.finalPrice} ₾</span>
                            </div>
                            {canModify(activeBooking) && (
                                <div className="grid grid-cols-3 gap-2">
                                    <button onClick={() => { onReschedule(activeBooking); setActiveBooking(null); }} className="py-2.5 text-xs font-medium rounded-xl bg-unbox-light text-unbox-dark">Перенести</button>
                                    <button onClick={() => { onReRent(activeBooking.id); setActiveBooking(null); }} className="py-2.5 text-xs font-medium rounded-xl bg-amber-50 text-amber-700">
                                        {activeBooking.isReRentListed ? 'Снять' : 'Пересдать'}
                                    </button>
                                    <button onClick={() => { onCancel(activeBooking.id); setActiveBooking(null); }} className="py-2.5 text-xs font-medium rounded-xl bg-red-50 text-red-600">Отменить</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* CRM Quick Booking Modal */}
                {crmMode && crmSlot && (
                    <CrmQuickBookingModal
                        crmMode={crmMode}
                        slot={crmSlot}
                        onClose={() => setCrmSlot(null)}
                        onBooked={() => {
                            setCrmSlot(null);
                            refreshBookings();
                            onCrmBooked?.();
                        }}
                    />
                )}
            </div>
        );
    }

    // ── DESKTOP VIEW ──
    return (
        <div className="space-y-4">
            {/* Week navigation */}
            <div className="flex items-center gap-2 p-1.5 rounded-2xl border border-unbox-light/60"
                style={{ background: 'rgba(212,226,225,0.35)' }}>
                <button
                    onClick={() => { const n = subWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }}
                    className="p-2 hover:bg-white rounded-xl transition-all text-unbox-grey hover:text-unbox-dark border border-transparent hover:border-unbox-light hover:shadow-sm"
                >
                    <ChevronLeft size={18} />
                </button>
                <div className="flex-1 grid grid-cols-7 gap-1.5">
                    {weekDays.map(day => {
                        const isSelected = isSameDay(day, selectedDate);
                        const hasBooking = daysWithBookings.has(format(day, 'yyyy-MM-dd'));
                        return (
                            <button
                                key={day.toISOString()}
                                onClick={() => setSelectedDate(day)}
                                className={clsx(
                                    "flex flex-col items-center justify-center py-2.5 rounded-xl transition-all duration-200 text-sm relative",
                                    isSelected
                                        ? "bg-unbox-green text-white shadow-lg shadow-unbox-green/30 scale-[1.04]"
                                        : "bg-white text-unbox-grey border border-unbox-light hover:border-unbox-green/40 hover:text-unbox-dark hover:shadow-sm"
                                )}
                            >
                                <span className={clsx("text-[10px] font-bold uppercase tracking-wider mb-1", isSelected ? "opacity-80" : "opacity-50")}>
                                    {format(day, 'EEE', { locale: ru })}
                                </span>
                                <span className="text-base font-bold leading-none">{format(day, 'd')}</span>
                                {hasBooking && (
                                    <span className={clsx(
                                        "absolute bottom-1 w-1.5 h-1.5 rounded-full",
                                        isSelected ? "bg-white/80" : "bg-unbox-green"
                                    )} />
                                )}
                            </button>
                        );
                    })}
                </div>
                <button
                    onClick={() => { const n = addWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }}
                    className="p-2 hover:bg-white rounded-xl transition-all text-unbox-grey hover:text-unbox-dark border border-transparent hover:border-unbox-light hover:shadow-sm"
                >
                    <ChevronRight size={18} />
                </button>
            </div>

            {/* Grid. Excel #9/#77 — wrapped in ChessboardScroller for the
                always-visible bar AND the floating ←/→ chevron buttons. Glass
                styling preserved through scrollClassName so the dashboard
                look stays. */}
            <ChessboardScroller
                minGridWidth={144 + timeSlots.length * 56}
                scrollClassName="overflow-x-scroll border border-white/30 rounded-2xl bg-white/70 backdrop-blur-md shadow-sm select-none"
            >
            <div ref={tableRef}>
                <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
                    <thead className="text-unbox-dark font-medium border-b border-unbox-light/60"
                        style={{ background: 'rgba(212,226,225,0.45)' }}>
                        <tr>
                            <th className="sticky left-0 backdrop-blur-sm p-4 border-r border-unbox-light/50 z-20 w-36 font-bold text-unbox-dark"
                                style={{ background: 'rgba(212,226,225,0.60)' }}>
                                Кабинет
                            </th>
                            {timeSlots.map(t => (
                                <th key={t} className={clsx(
                                    "p-2 text-center min-w-[56px] border-r border-unbox-light/40 text-[10px] uppercase font-bold",
                                    isEveningSurcharge(t)
                                        ? "text-violet-600 bg-violet-50/60"
                                        : isPeakTime(t) ? "text-amber-600 bg-amber-50/40" : "text-unbox-dark/60"
                                )}
                                title={isEveningSurcharge(t) ? 'Вечерний тариф — повышенная ставка' : undefined}
                                >
                                    {t}
                                </th>
                            ))}
                            {/* Right column removed — single floating "Продолжить" bar below grid */}
                        </tr>
                    </thead>
                    <tbody>
                        {/* Excel #82 — filter chessboard rows by the selected
                            branch. The filter tabs at the top set
                            mobileLocFilter, but desktop tbody used unfiltered
                            `resources` and silently ignored the choice. */}
                        {mobileFilteredResources.map(r => {
                            const cells: React.ReactNode[] = [];
                            let skipUntilIdx = -1;

                            timeSlots.forEach((time, idx) => {
                                if (idx <= skipUntilIdx) return;

                                const myB = findBookingAtSlot(dayUserBookings, r.id, time);
                                const pubB = !myB ? findBookingAtSlot(dayPublicBookings, r.id, time) : null;
                                const isPast = isSlotPast(time);

                                // Drag ghost: is this slot the drag target?
                                const isDragGhost = isDragging && dragBooking && dragTarget &&
                                    dragTarget.resId === r.id &&
                                    timeToMins(time) >= timeToMins(dragTarget.time) &&
                                    timeToMins(time) < timeToMins(dragTarget.time) + dragBooking.duration;

                                // Is this slot the original position of the dragged booking?
                                const isDragSource = isDragging && dragBooking &&
                                    dragBooking.resourceId === r.id &&
                                    myB?.id === dragBooking.id;

                                if (myB && timeToMins(myB.startTime!) === timeToMins(time) && !isDragSource) {
                                    // START of user's booking — colSpan block
                                    const span = Math.max(1, Math.round(myB.duration / 30));
                                    skipUntilIdx = idx + span - 1;
                                    const isCompleted = myB.status === 'completed';
                                    const isReRent = myB.isReRentListed && !isCompleted;
                                    const canMod = canModify(myB);
                                    const clientInfo = myB.crmClientId ? clientMap.get(myB.crmClientId) : null;

                                    cells.push(
                                        <td
                                            key={`${r.id}-${time}`}
                                            colSpan={span}
                                            className="p-0 border-r border-unbox-light/30 h-14 relative"
                                        >
                                            <div
                                                onPointerDown={canMod ? (e) => handleDragStart(myB, r.id, time, e) : undefined}
                                                className={clsx(
                                                    "absolute inset-[2px] rounded-xl flex flex-col items-start justify-center px-2 gap-0.5 transition-all shadow-sm group touch-none select-none",
                                                    isCompleted
                                                        ? "bg-gray-200/80 text-gray-500"
                                                        : isReRent
                                                            ? "bg-amber-50 border-2 border-dashed border-amber-400 text-amber-700"
                                                            : canMod
                                                                ? "bg-unbox-green hover:bg-unbox-green/90 text-white cursor-grab active:cursor-grabbing"
                                                                : "bg-unbox-dark hover:bg-unbox-dark/90 text-white"
                                                )}
                                            >
                                                <span className="text-[10px] font-bold leading-none opacity-90">
                                                    {myB.startTime} · {myB.duration / 60}ч
                                                    {isCompleted && ' ✓'}
                                                </span>
                                                {clientInfo ? (
                                                    <span className="text-[9px] opacity-80 leading-none flex items-center gap-0.5 truncate max-w-full">
                                                        <UserIcon size={8} className="shrink-0" />
                                                        <span className="truncate">
                                                            {clientInfo.aliasCode ? `${clientInfo.aliasCode} · ${clientInfo.name}` : clientInfo.name}
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] opacity-70 leading-none flex items-center gap-0.5 truncate max-w-full">
                                                        <UserIcon size={8} className="shrink-0" />
                                                        <span className="truncate">{usersMap?.get(myB.userId) || myB.userId}</span>
                                                    </span>
                                                )}
                                                {isReRent && <span className="text-[8px] opacity-80 leading-none">♻️ переаренда</span>}
                                                {!isCompleted && !isReRent && !canMod && <span className="text-[8px] opacity-60 leading-none">≤24ч</span>}
                                                {canMod && <GripVertical size={10} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 transition-opacity" />}
                                                {/* Edit button */}
                                                <button
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => { if (!isDragging) handleCellClick(myB, e, false); }}
                                                    className={clsx(
                                                        "absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity",
                                                        isCompleted ? "hover:bg-gray-300/50" : "hover:bg-white/20"
                                                    )}
                                                    title="Редактировать"
                                                >
                                                    <Pencil size={10} />
                                                </button>
                                            </div>
                                        </td>
                                    );
                                } else if (isDragGhost) {
                                    // Drag ghost preview
                                    cells.push(
                                        <td key={`${r.id}-${time}`}
                                            className="p-0 border-r border-unbox-light/30 h-14 relative"
                                            onPointerEnter={() => handleDragOver(r.id, time)}
                                        >
                                            <div className="absolute inset-[2px] rounded-xl bg-unbox-green/30 border-2 border-dashed border-unbox-green animate-pulse" />
                                        </td>
                                    );
                                } else if (pubB && !isDragSource) {
                                    // Other user's booking
                                    const isReRentAvailable = pubB.isReRentListed;
                                    const isPubStart = timeToMins(pubB.startTime!) === timeToMins(time);
                                    if (isPubStart) {
                                        const pubSpan = Math.max(1, Math.round(pubB.duration / 30));
                                        skipUntilIdx = idx + pubSpan - 1;
                                        // Excel #14 — "поставить слот на отслеживание".
                                        // Click on a busy slot opens a confirm dialog, then
                                        // POSTs /waitlist with this resource+date+time.
                                        // When the booking is cancelled / rescheduled,
                                        // backend's notify_waitlist_for_freed_slot pings
                                        // the subscriber via in-app + Telegram (if linked).
                                        const handleWaitlistClick = async () => {
                                            if (isReRentAvailable) {
                                                toast.info('Слот доступен для переаренды — выберите его внизу шахматки.');
                                                return;
                                            }
                                            const endTimeStr = minsToTime(timeToMins(pubB.startTime!) + pubB.duration);
                                            const dayLabel = format(selectedDate, 'd MMMM', { locale: ru });
                                            const ok = window.confirm(
                                                `Подписаться на этот слот?\n\n` +
                                                `${r.name} · ${dayLabel}, ${pubB.startTime}–${endTimeStr}\n\n` +
                                                `Если бронь отменят, пришлём уведомление, чтобы успели занять.`
                                            );
                                            if (!ok) return;
                                            try {
                                                await waitlistApi.addToWaitlist({
                                                    resourceId: r.id,
                                                    date: format(selectedDate, "yyyy-MM-dd'T'00:00:00"),
                                                    startTime: pubB.startTime!,
                                                    endTime: endTimeStr,
                                                });
                                                toast.success('Подписка оформлена. Сообщим, как только освободится.');
                                            } catch (err: any) {
                                                toast.error(err?.response?.data?.detail || 'Не удалось подписаться');
                                            }
                                        };
                                        cells.push(
                                            <td
                                                key={`${r.id}-${time}`}
                                                colSpan={pubSpan}
                                                className="p-0 border-r border-unbox-light/30 h-14 relative"
                                            >
                                                <div
                                                    className={clsx(
                                                        "absolute inset-[2px] rounded-xl flex flex-col items-start justify-center px-2 gap-0.5 cursor-pointer transition-colors group",
                                                        isReRentAvailable
                                                            ? "bg-amber-50 border border-dashed border-amber-400 text-amber-800 hover:bg-amber-100"
                                                            : "bg-gray-300/90 text-gray-600 hover:bg-gray-400/90"
                                                    )}
                                                    title={isReRentAvailable
                                                        ? 'Доступно для переаренды'
                                                        : 'Нажмите чтобы получить уведомление, когда слот освободится'}
                                                    onClick={handleWaitlistClick}
                                                >
                                                    <span className="text-[10px] font-bold leading-none">
                                                        {pubB.startTime} · {pubB.duration / 60}ч
                                                    </span>
                                                    <span className="text-[9px] opacity-80 leading-none">
                                                        Занято
                                                    </span>
                                                    {isReRentAvailable && <span className="text-[8px] font-medium leading-none">♻️ переаренда</span>}
                                                    {!isReRentAvailable && (
                                                        <span className="text-[8px] opacity-0 group-hover:opacity-90 leading-none transition-opacity">
                                                            🔔 подписаться
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    } else {
                                        // Mid-slot of pub booking already covered by colSpan — skip
                                    }
                                } else {
                                    // Free or past slot
                                    const isCrmHint = !isPast && crmMode && crmHintDate === format(selectedDate, 'yyyy-MM-dd') &&
                                        timeToMins(time) >= crmHintStartMins &&
                                        timeToMins(time) < crmHintEndMins;
                                    const newSel = isNewSlotSelected(r.id, time);
                                    const newBlock = newSel ? getNewBlockForResource(r.id) : null;
                                    const isNewStart = newBlock ? newBlock.start === idx : false;
                                    const isNewEnd = newBlock ? newBlock.end === idx : false;
                                    const isNewSingle = newBlock ? newBlock.start === newBlock.end : false;

                                    const NewResizeHandle = ({ type }: { type: 'start' | 'end' }) => (
                                        <div
                                            className={`absolute top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center z-20 hover:bg-white/20 transition-colors ${type === 'start' ? 'left-0 rounded-l-md' : 'right-0 rounded-r-md'}`}
                                            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handleNewDragDown(r.id, time, type === 'start' ? 'resize-start' : 'resize-end'); }}
                                        >
                                            <div className="w-1 h-3 bg-white/70 rounded-full" />
                                        </div>
                                    );

                                    cells.push(
                                        <td key={`${r.id}-${time}`} className="p-0 border-r border-unbox-light/30 h-14 relative">
                                            <div
                                                data-newresid={r.id}
                                                data-newtime={time}
                                                onPointerDown={(e) => {
                                                    if (isPast || isDragging) return;
                                                    if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
                                                    e.preventDefault();
                                                    if (crmMode) {
                                                        setCrmSlot({ resId: r.id, time, date: selectedDate });
                                                        return;
                                                    }
                                                    handleNewDragDown(r.id, time, 'new');
                                                }}
                                                onPointerEnter={() => {
                                                    if (isDragging) handleDragOver(r.id, time);
                                                    else handleNewDragEnter(r.id, time);
                                                }}
                                                className={clsx(
                                                    "w-full h-full flex items-center justify-center text-[9px] relative select-none touch-none transition-colors",
                                                    isPast
                                                        ? "bg-black/[0.03]"
                                                        : newSel
                                                            ? "bg-unbox-green text-white z-10 cursor-grab shadow-sm"
                                                            : isPeakTime(time)
                                                                ? "bg-amber-50/70 hover:bg-amber-100/60 text-amber-600/70 hover:text-amber-700 cursor-pointer"
                                                                : "hover:bg-unbox-green/5 text-unbox-dark/50 hover:text-unbox-green cursor-pointer",
                                                    newSel && !isNewSingle && !isNewStart && "border-l border-white/20",
                                                    isNewStart && newSel && "rounded-l-lg",
                                                    isNewEnd && newSel && "rounded-r-lg"
                                                )}
                                                style={(!newSel && isCrmHint) ? { background: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(249,115,22,0.12) 5px, rgba(249,115,22,0.12) 10px)', outline: '1.5px dashed rgba(249,115,22,0.5)', outlineOffset: '-1px' } : undefined}
                                                title={isCrmHint ? `Время сессии: ${format(parseISO(crmMode!.date), 'HH:mm')} (${crmMode!.duration ?? 60} мин)` : undefined}
                                            >
                                                {newSel ? (
                                                    <>
                                                        <div className="flex items-center justify-between w-full h-full px-1 relative">
                                                            {isNewStart && !isNewSingle && <NewResizeHandle type="start" />}
                                                            {isNewStart && (
                                                                <div className="flex flex-col items-center justify-center w-full">
                                                                    <div className="font-bold text-white text-xs">{time}</div>
                                                                </div>
                                                            )}
                                                            {isNewEnd && !isNewSingle && <NewResizeHandle type="end" />}
                                                        </div>
                                                        {isNewEnd && (
                                                            <button
                                                                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setNewSlotRange(r.id, []); }}
                                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setNewSlotRange(r.id, []); }}
                                                                className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-md hover:bg-red-600 hover:scale-110 transition-all z-50"
                                                                title="Удалить"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                                            </button>
                                                        )}
                                                    </>
                                                ) : (
                                                    !isPast && <span>{time}</span>
                                                )}
                                            </div>
                                        </td>
                                    );
                                }
                            });

                            return (
                                <tr key={r.id} className="hover:bg-unbox-light/10 group">
                                    <td className="sticky left-0 backdrop-blur-sm p-3 border-r border-unbox-light/40 z-10"
                                        style={{ background: 'rgba(212,226,225,0.50)' }}>
                                        <div className="font-bold text-unbox-dark text-xs">{r.name}</div>
                                        <div className="text-[10px] text-unbox-grey">{r.capacity} чел.</div>
                                    </td>
                                    {cells}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            </ChessboardScroller>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-unbox-dark/80 bg-white/70 backdrop-blur-md rounded-xl px-4 py-2.5 shadow-sm">
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-unbox-green" />
                    <span>Ваша бронь (можно перетащить на другое время)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-unbox-dark/80" />
                    <span>До брони менее 24ч — можно выставить на переаренду</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded border-2 border-dashed border-amber-400 bg-amber-50" />
                    <span>Кабинет открыт для переаренды другим специалистам</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-gray-200/80" />
                    <span>Прошедшая</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-striped border border-unbox-light/50" />
                    <span>Занято</span>
                </div>
            </div>

            {/* ── Floating booking bar ── */}
            {!crmMode && newSlots.length > 0 && (
                <div className="sticky bottom-0 z-30 -mx-1">
                    <div className="bg-white/95 backdrop-blur-md border border-unbox-light/50 rounded-2xl shadow-lg px-5 py-3 space-y-2.5 animate-in slide-in-from-bottom-4 duration-200">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4 flex-wrap min-w-0">
                                {/* Summary chips */}
                                {selectedNewBlocks.map(block => {
                                    const res = resources.find(r => r.id === block.resId);
                                    const slots = block.end - block.start + 1;
                                    const hours = (slots * 30) / 60;
                                    return (
                                        <div key={block.resId} className="flex items-center gap-1.5 bg-unbox-green/10 text-unbox-green rounded-lg px-2.5 py-1.5 text-xs font-semibold">
                                            <span>{res?.name || block.resId}</span>
                                            <span className="opacity-60">·</span>
                                            <span>{timeSlots[block.start]}-{minsToTime(timeToMins(timeSlots[block.end]) + 30)}</span>
                                            <span className="opacity-60">·</span>
                                            <span>{hours}ч</span>
                                            <button
                                                onClick={() => setNewSlotRange(block.resId, [])}
                                                className="ml-1 hover:bg-red-100 rounded-full p-0.5 transition-colors"
                                                title="Убрать"
                                            >
                                                <X size={10} className="text-red-500" />
                                            </button>
                                        </div>
                                    );
                                })}
                                {/* Time overlap warning */}
                                {hasTimeOverlap && (
                                    <div className="flex items-center gap-1.5 text-amber-600 text-xs font-medium">
                                        <AlertTriangle size={14} className="shrink-0" />
                                        <span>Наложение по времени</span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleConfirmNewBooking}
                                disabled={bookingSaving || recurringSaving}
                                className="flex items-center gap-2 bg-unbox-green text-white text-sm font-bold px-5 py-2.5 rounded-xl shadow-md hover:bg-unbox-dark active:scale-95 transition-all whitespace-nowrap shrink-0"
                            >
                                {recurringSaving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                                <span>{recurringPattern ? `Серия · ${recurringOccurrences}` : 'Продолжить'}</span>
                            </button>
                        </div>

                        {/* Recurring pattern row */}
                        <div className="flex items-center gap-2">
                            <Repeat size={14} className="text-gray-400 shrink-0" />
                            <div className="flex gap-1.5">
                                {([
                                    { id: '' as const, label: 'Разово' },
                                    { id: 'weekly' as const, label: 'Каждую неделю' },
                                    { id: 'biweekly' as const, label: 'Раз в 2 нед.' },
                                    { id: 'monthly' as const, label: 'Ежемесячно' },
                                ]).map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setRecurringPattern(p.id)}
                                        className={clsx(
                                            'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border',
                                            recurringPattern === p.id
                                                ? 'bg-unbox-green text-white border-unbox-green'
                                                : 'border-gray-200 text-gray-500 hover:border-unbox-green hover:text-unbox-green'
                                        )}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            {recurringPattern && (
                                <div className="flex items-center gap-1.5 ml-2">
                                    <input
                                        type="number"
                                        value={recurringOccurrences}
                                        onChange={e => {
                                            const max = recurringPattern === 'monthly' ? 24 : 52;
                                            setRecurringOccurrences(Math.max(2, Math.min(max, Number(e.target.value))));
                                        }}
                                        min={2}
                                        max={recurringPattern === 'monthly' ? 24 : 52}
                                        className="w-14 px-2 py-1 rounded-lg border border-unbox-light text-sm text-center focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                    />
                                    <span className="text-xs text-gray-400 whitespace-nowrap">
                                        {recurringPattern === 'monthly'
                                            ? `≈ ${recurringOccurrences} мес.`
                                            : recurringPattern === 'biweekly'
                                                ? `≈ ${Math.round(recurringOccurrences / 2)} мес.`
                                                : `≈ ${Math.round(recurringOccurrences / 4.3)} мес.`}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Overlap confirmation modal */}
            {showOverlapWarning && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowOverlapWarning(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 mx-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                                <AlertTriangle size={20} className="text-amber-600" />
                            </div>
                            <h3 className="font-bold text-lg">Наложение по времени</h3>
                        </div>
                        <p className="text-sm text-unbox-grey">
                            Вы выбрали слоты, которые пересекаются по времени в разных кабинетах. Вы уверены, что хотите продолжить?
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowOverlapWarning(false)}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-unbox-light text-sm font-medium hover:bg-gray-50 transition">
                                Отмена
                            </button>
                            <button onClick={() => { setShowOverlapWarning(false); proceedToCheckout(); }}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-bold hover:bg-unbox-dark transition">
                                Продолжить
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Booking action popup */}
            {activeBooking && popupPos && (
                <div
                    ref={popupRef}
                    className="fixed z-[200] w-80 rounded-2xl shadow-2xl border border-white/60 p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
                    style={{
                        top: popupPos.top,
                        left: Math.min(popupPos.left, window.innerWidth - 330),
                        background: 'rgba(255,255,255,0.95)',
                        backdropFilter: 'blur(20px)',
                    }}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="font-bold text-unbox-dark text-sm">
                                {RESOURCES.find(r => r.id === activeBooking.resourceId)?.name || 'Кабинет'}
                            </div>
                            <div className="text-xs text-unbox-grey mt-0.5">
                                {format(parseUTC(activeBooking.date), 'd MMMM', { locale: ru })} · {activeBooking.startTime} – {minsToTime(timeToMins(activeBooking.startTime!) + activeBooking.duration)} · {activeBooking.duration / 60}ч
                            </div>
                            <div className="text-xs font-semibold mt-1">
                                {activeBooking.paymentSource === 'credit' ? (
                                    <span className="text-amber-600">Долг: {activeBooking.finalPrice} ₾</span>
                                ) : (
                                    <span className="text-unbox-green">Оплачено: {activeBooking.finalPrice} ₾</span>
                                )}
                            </div>
                        </div>
                        <button onClick={() => setActiveBooking(null)} className="p-1 hover:bg-unbox-light rounded-lg transition-colors">
                            <X size={14} className="text-unbox-grey" />
                        </button>
                    </div>

                    {/* CRM Client selector */}
                    {activeBooking.status !== 'completed' && (
                        <div className="border-t border-unbox-light/50 pt-3">
                            <div className="text-[10px] text-unbox-grey uppercase tracking-wider mb-1.5 font-semibold">Клиент из CRM</div>
                            {crmClients.length > 0 ? (
                                <div className="flex items-center gap-2">
                                    <UserIcon size={12} className="text-unbox-grey flex-shrink-0" />
                                    <select
                                        value={activeBooking.crmClientId || ''}
                                        onChange={(e) => {
                                            const val = e.target.value || null;
                                            onLinkClient(activeBooking.id, val);
                                            setActiveBooking(prev => prev ? { ...prev, crmClientId: val || undefined } : null);
                                        }}
                                        className="flex-1 text-xs border border-unbox-light rounded-lg px-2 py-1.5 bg-white/80 text-unbox-dark focus:border-unbox-green focus:outline-none"
                                    >
                                        <option value="">— Без клиента —</option>
                                        {crmClients.map(c => (
                                            <option key={c.id} value={c.id}>
                                                {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <Link to="/crm/clients" className="flex items-center gap-1.5 text-xs text-unbox-grey hover:text-unbox-green transition-colors" onClick={() => setActiveBooking(null)}>
                                    <UserIcon size={12} />
                                    Добавьте клиентов в разделе «Мой CRM»
                                </Link>
                            )}
                        </div>
                    )}

                    {/* Actions */}
                    {activeBooking.status === 'completed' ? (
                        <div className="space-y-2 pt-1">
                            <div className="bg-gray-100 rounded-xl p-2.5 text-xs text-center text-gray-500 flex items-center justify-center gap-1.5">
                                <Check size={12} /> Бронирование завершено
                            </div>
                        </div>
                    ) : canModify(activeBooking) ? (
                        <div className="space-y-2 pt-1">
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setActiveBooking(null); onReschedule(activeBooking); }}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-unbox-light text-unbox-dark text-xs font-semibold hover:border-unbox-green hover:text-unbox-green transition-all"
                                >
                                    <RefreshCw size={12} /> Перенести
                                </button>
                                <button
                                    onClick={() => { setActiveBooking(null); onCancel(activeBooking.id); }}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-100 text-red-500 text-xs font-semibold hover:bg-red-50 transition-all"
                                >
                                    <X size={12} /> Отменить
                                </button>
                            </div>
                            <button
                                onClick={async () => {
                                    try {
                                        const updated = await bookingsApi.extendBooking(activeBooking.id, 30);
                                        setActiveBooking(null);
                                        refreshBookings?.();
                                        toast.success(`Продлено на 30 мин. Итого: ${updated.duration} мин`);
                                    } catch (err: any) {
                                        toast.error(err?.response?.data?.detail || 'Не удалось продлить');
                                    }
                                }}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-unbox-light text-unbox-dark text-xs font-semibold hover:bg-unbox-green/20 transition-all"
                            >
                                <Plus size={12} /> Продлить +30 мин
                            </button>
                        </div>
                    ) : activeBooking.isReRentListed ? (
                        <div className="space-y-2 pt-1">
                            <div className="bg-amber-50/80 rounded-xl p-2.5 text-xs text-center text-amber-700 border border-amber-200">
                                ♻️ Выставлено на переаренду
                            </div>
                            <button
                                onClick={() => { setActiveBooking(null); onCancelReRent(activeBooking.id); }}
                                className="w-full py-2 rounded-xl border border-unbox-light text-unbox-grey text-xs font-semibold hover:bg-unbox-light transition-all"
                            >
                                Убрать с переаренды
                            </button>
                        </div>
                    ) : (() => {
                        // Check if booking is in the past
                        const [bh, bm] = (activeBooking.startTime || '00:00').split(':').map(Number);
                        const bookStart = new Date(activeBooking.date);
                        bookStart.setHours(bh, bm + (activeBooking.duration || 60), 0, 0);
                        const isPastBooking = bookStart < new Date();

                        return isPastBooking ? (
                            <div className="pt-1">
                                <div className="bg-gray-50 rounded-xl p-2.5 text-xs text-center text-gray-500 border border-gray-200 font-medium">
                                    ☑️ Бронирование завершено
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 pt-1">
                                <div className="text-[11px] text-unbox-grey text-center italic">
                                    Менее 24ч до начала — бесплатная отмена недоступна
                                </div>
                                <button
                                    onClick={async () => {
                                        if (!confirm('Продление менее чем за 24ч. Отмена этого действия будет платной и только через администратора. Продолжить?')) return;
                                        try {
                                            const updated = await bookingsApi.extendBooking(activeBooking.id, 30);
                                            setActiveBooking(null);
                                            refreshBookings?.();
                                            toast.success(`Продлено на 30 мин. Итого: ${updated.duration} мин`);
                                        } catch (err: any) {
                                            toast.error(err?.response?.data?.detail || 'Не удалось продлить');
                                        }
                                    }}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-unbox-light text-unbox-dark text-xs font-semibold hover:bg-unbox-green/20 transition-all"
                                >
                                    <Plus size={12} /> Продлить +30 мин
                                </button>
                                <button
                                    onClick={() => { setActiveBooking(null); onReRent(activeBooking.id); }}
                                    className="w-full py-2 rounded-xl border border-dashed border-unbox-green text-unbox-green text-xs font-semibold hover:bg-unbox-light transition-all"
                                >
                                    ♻️ Выставить на переаренду
                                </button>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* CRM Quick Booking Modal */}
            {crmMode && crmSlot && (
                <CrmQuickBookingModal
                    crmMode={crmMode}
                    slot={crmSlot}
                    onClose={() => setCrmSlot(null)}
                    onBooked={() => {
                        setCrmSlot(null);
                        refreshBookings();
                        onCrmBooked?.();
                    }}
                />
            )}
        </div>
    );
}
// ─────────────────────────────────────────────────────────────────────────────

export function MyBookingsPage() {
        const navigate = useNavigate();
    const location = useLocation();
    const { currentUser, bookings, users, fetchUsers, cancelBooking, fetchBookings } = useUserStore();
    const startEditing = useBookingStore(s => s.startEditing);
    const { clients: crmClients, fetchClients } = useCrmStore();
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
    const [mobileLocFilter, setMobileLocFilter] = useState<string>('all');
    const [publicBookings, setPublicBookings] = useState<BookingHistoryItem[]>([]);

    // CRM booking mode: passed from CRM Dashboard "Без кабинета"
    const [crmMode, setCrmMode] = useState<{
        sessionId: string;
        clientId: string;
        clientName: string;
        date: string;
        duration?: number;
    } | null>(location.state?.crmMode ?? null);

    // Fetch public bookings + users for chessboard occupancy display
    useEffect(() => {
        bookingsApi.getPublicBookings().then(setPublicBookings).catch(() => {});
        if (currentUser?.isAdmin) fetchUsers();
    }, []);

    // Auto-switch to grid and jump to date when entering CRM mode
    useEffect(() => {
        if (crmMode) {
            setViewMode('grid');
        }
    }, [crmMode]);

    // Fetch CRM clients if user might be a specialist
    useEffect(() => {
        if (currentUser) {
            fetchClients(true).catch(() => {});
        }
    }, [currentUser, fetchClients]);

    const refreshBookings = useCallback(() => {
        fetchBookings?.();
        bookingsApi.getPublicBookings().then(setPublicBookings).catch(() => {});
    }, [fetchBookings]);

    const usersMap = useMemo(() => {
        const m = new Map<string, string>();
        users.forEach(u => { m.set(u.email, u.name); m.set(u.id, u.name); });
        return m;
    }, [users]);

    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: React.ReactNode;
        onConfirm: () => void;
        isDestructive?: boolean;
        confirmLabel?: string;
    }>({ isOpen: false, title: '', message: null, onConfirm: () => {} });

    // Always filter by the logged-in user's own email — even for admins. Previously
    // admins saw ALL bookings in /dashboard/bookings which (a) made bookings they'd
    // created on behalf of clients appear as "theirs", and (b) caused false conflict
    // warnings on the personal chessboard when creating parallel bookings for clients.
    // Admins have a dedicated /admin/bookings page to see all bookings.
    const userBookings = bookings
        .filter(b => b.userId === currentUser?.email)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Split into upcoming and past
    const upcomingBookings = userBookings.filter(b => b.status === 'confirmed');
    const pastBookings = userBookings.filter(b => b.status === 'completed' || b.status === 'cancelled' || b.status === 're-rented' || b.status === 'rescheduled');

    const handleEdit = (booking: any) => {
        startEditing(booking, 'reschedule');
        navigate('/checkout');
    };

    const handleCancel = (id: string) => {
        const booking = bookings.find(b => b.id === id);
        if (!booking) return;
        const refundText = booking.paymentMethod === 'subscription'
            ? `${booking.hoursDeducted || (booking.duration / 60)} ч. будут возвращены на ваш абонемент.`
            : `${booking.finalPrice} ₾ будут возвращены на ваш баланс.`;

        setModalConfig({
            isOpen: true,
            title: 'Отменить бронирование?',
            message: (
                <div className="space-y-2 text-sm text-unbox-grey">
                    <p>Это действие необратимо.</p>
                    <p className="font-medium text-unbox-dark bg-unbox-light/30 p-2 rounded-lg border border-unbox-light">{refundText}</p>
                </div>
            ),
            confirmLabel: 'Отменить бронь',
            isDestructive: true,
            onConfirm: async () => {
                try {
                    await cancelBooking(id);
                    toast.success('Бронирование отменено');
                    refreshBookings();
                } catch (error: any) {
                    toast.error(error.response?.data?.detail || 'Не удалось отменить бронирование');
                }
            }
        });
    };

    const handleReRent = (id: string) => {
        setModalConfig({
            isOpen: true,
            title: 'Выставить на переаренду?',
            message: (
                <span>Если другой пользователь забронирует это время, вам вернется <b>50%</b> от стоимости бронирования на баланс.</span>
            ),
            confirmLabel: 'Выставить',
            isDestructive: false,
            onConfirm: async () => {
                try {
                    await bookingsApi.toggleReRent(id);
                    toast.success('Время выставлено на переаренду.');
                    refreshBookings();
                } catch (err: any) {
                    toast.error(err.response?.data?.detail || 'Ошибка');
                }
            }
        });
    };

    const handleCancelReRent = async (id: string) => {
        try {
            await bookingsApi.toggleReRent(id);
            toast.success('Убрано с переаренды');
            refreshBookings();
        } catch (err: any) {
            toast.error(err.response?.data?.detail || 'Ошибка');
        }
    };

    const handleLinkClient = async (bookingId: string, clientId: string | null) => {
        try {
            await bookingsApi.linkCrmClient(bookingId, clientId);
            toast.success(clientId ? 'Клиент привязан' : 'Клиент отвязан');
            refreshBookings();
        } catch (err: any) {
            toast.error(err.response?.data?.detail || 'Ошибка привязки');
        }
    };

    const handleBookAgain = (_booking: any) => {
        setViewMode('grid');
    };

    return (

        <GridHouseMyBookings
            viewMode={viewMode} setViewMode={setViewMode}
            userBookings={userBookings} bookings={bookings}
            upcomingBookings={upcomingBookings} pastBookings={pastBookings}
            handleEdit={handleEdit} handleCancel={handleCancel}
            handleReRent={handleReRent} handleCancelReRent={handleCancelReRent}
            handleBookAgain={handleBookAgain} handleLinkClient={handleLinkClient}
            currentUser={currentUser} usersMap={usersMap}
            publicBookings={publicBookings} refreshBookings={refreshBookings}
            crmMode={crmMode} setCrmMode={setCrmMode}
            crmClients={crmClients} modalConfig={modalConfig} setModalConfig={setModalConfig}
            mobileLocFilter={mobileLocFilter} setMobileLocFilter={setMobileLocFilter}
            navigate={navigate} location={location}
        />
    );
}



// ─── Booking Card (List view) ────────────────────────────────────────────────
function BookingCard({
    booking,
    crmClients,
    onCancel,
    onEdit,
    onReRent,
    onBookAgain,
    onLinkClient: _onLinkClient,
    isPast = false,
}: {
    booking: BookingHistoryItem;
    crmClients: Array<{ id: string; name: string; aliasCode?: string }>;
    onCancel: (id: string) => void;
    onEdit: (booking: BookingHistoryItem) => void;
    onReRent: (id: string) => void;
    onBookAgain: (booking: BookingHistoryItem) => void;
    onLinkClient: (bookingId: string, clientId: string | null) => void;
    isPast?: boolean;
}) {
    const canMod = (() => {
        if (booking.status !== 'confirmed' || !booking.startTime) return false;
        const [h, m] = booking.startTime.split(':').map(Number);
        const start = parseUTC(booking.date);
        start.setUTCHours(h, m, 0, 0);
        return (start.getTime() - Date.now()) > 24 * 60 * 60 * 1000;
    })();

    const clientInfo = booking.crmClientId ? crmClients.find(c => c.id === booking.crmClientId) : null;

    return (
        <Card className={clsx("p-4 sm:p-6", isPast && "opacity-70")}>
            <div className="flex justify-between items-start mb-3 gap-2">
                <div className="min-w-0">
                    <div className="text-[10px] sm:text-xs text-unbox-grey mb-0.5">
                        {format(new Date(booking.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })}
                    </div>
                    <h3 className="font-bold text-base sm:text-lg mb-0.5">
                        {RESOURCES.find(r => r.id === booking.resourceId)?.name || 'Кабинет'}
                    </h3>
                    <div className="text-xs sm:text-sm text-unbox-grey mb-1">
                        {booking.locationId === 'unbox_one' ? 'Unbox One' : 'Unbox Uni'} · {
                            booking.format === 'individual' ? 'Индивидуальный' :
                            booking.format === 'intervision' ? 'Интервизия' : 'Групповой'
                        }
                    </div>
                    <div className="text-sm text-unbox-dark flex items-center gap-1.5 font-medium">
                        <Clock size={14} />
                        {format(parseUTC(booking.date), 'd MMMM', { locale: ru })}, {booking.startTime} ({booking.duration / 60}ч)
                    </div>
                    {clientInfo && (
                        <div className="text-xs text-unbox-green flex items-center gap-1 mt-1">
                            <UserIcon size={12} /> {clientInfo.aliasCode ? `${clientInfo.aliasCode} · ${clientInfo.name}` : clientInfo.name}
                        </div>
                    )}
                    {booking.status === 'confirmed' && !isPast && (
                        <button
                            onClick={() => {
                                if (!booking.startTime) return;
                                const [h, m] = booking.startTime.split(':').map(Number);
                                const start = parseUTC(booking.date);
                                start.setHours(h, m, 0, 0);
                                const end = new Date(start.getTime() + booking.duration * 60000);
                                const resource = RESOURCES.find(r => r.id === booking.resourceId);
                                const location = resource?.locationId === 'unbox_one' ? 'Unbox One, ул. Палиашвили 4, Батуми'
                                    : resource?.locationId === 'unbox_uni' ? 'Unbox Uni, ул. Тбел Абусеридзе 38, Батуми'
                                    : resource?.locationId === 'neo_school' ? 'Neo School, ул. Сулаберидзе 80, Батуми'
                                    : 'Unbox, Батуми';
                                const userName = useUserStore.getState().currentUser?.name || '';
                                window.open(generateGoogleCalendarUrl({
                                    title: `Unbox: ${resource?.name || 'Кабинет'}`,
                                    description: `${userName}\n${resource?.name || ''}, ${booking.duration} мин`,
                                    location,
                                    startTime: start,
                                    endTime: end,
                                }), '_blank');
                            }}
                            className="text-xs text-unbox-green hover:underline flex items-center gap-1 mt-1"
                        >
                            <CalendarIcon size={12} /> Добавить в календарь
                        </button>
                    )}
                    {booking.extras.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {booking.extras.map((extraId: string) => {
                                const extra = EXTRAS.find(e => e.id === extraId);
                                return extra ? (
                                    <span key={extraId} className="text-xs bg-unbox-light/50 px-2 py-1 rounded-md text-unbox-grey border border-unbox-light">
                                        + {extra.name}
                                    </span>
                                ) : null;
                            })}
                        </div>
                    )}
                </div>
                <div className={clsx(
                    "px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1",
                    {
                        'bg-unbox-light text-unbox-dark': booking.status === 'confirmed' && !booking.isReRentListed,
                        'bg-amber-50 text-amber-700 border border-amber-200': booking.isReRentListed && booking.status === 'confirmed',
                        'bg-gray-100 text-gray-500': booking.status === 'completed',
                        'bg-red-50 text-red-400': booking.status === 'cancelled',
                        'bg-white border border-unbox-green text-unbox-green': booking.status === 're-rented',
                        'bg-yellow-50 text-yellow-700 border border-yellow-200': booking.status === 'pending_approval',
                    }
                )}>
                    {booking.status === 'confirmed' && booking.isReRentListed && <><RotateCcw size={12} /> На переаренде</>}
                    {booking.status === 'confirmed' && !booking.isReRentListed && <><BadgeCheck size={12} /> Подтверждено</>}
                    {booking.status === 'cancelled' && <><XCircle size={12} /> Отменено</>}
                    {booking.status === 'completed' && <><Check size={12} /> Завершено</>}
                    {booking.status === 're-rented' && '♻️ Пересдано'}
                    {booking.status === 'pending_approval' && <><Clock size={12} /> Ожидает</>}
                </div>
            </div>

            {/* Payment info */}
            <div className="flex items-center gap-3 pt-3 border-t border-unbox-light text-sm">
                <div className="flex items-center gap-1.5 text-unbox-dark font-medium">
                    {booking.paymentMethod === 'subscription' ? (
                        <><span className="w-2 h-2 rounded-full bg-unbox-dark" />Абонемент</>
                    ) : booking.paymentSource === 'credit' ? (
                        <><span className="w-2 h-2 rounded-full bg-unbox-grey" />Кредит</>
                    ) : (
                        <><span className="w-2 h-2 rounded-full bg-unbox-green" />Депозит</>
                    )}
                </div>
                <div className="text-unbox-grey">
                    {booking.paymentMethod === 'subscription' ? (
                        <span>{booking.hoursDeducted || (booking.duration / 60)} ч</span>
                    ) : (
                        <span>
                            {booking.paymentSource === 'credit' ? 'Долг: ' : ''}
                            <span className="font-bold text-unbox-dark">{booking.finalPrice} ₾</span>
                        </span>
                    )}
                </div>
            </div>

            {/* Actions for confirmed bookings */}
            {booking.status === 'confirmed' && !isPast && (
                <div className="mt-3 pt-3 border-t border-unbox-light">
                    {booking.isReRentListed ? (
                        <div className="text-center text-sm text-amber-600 font-medium py-1">
                            ✨ На переаренде
                        </div>
                    ) : canMod ? (
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(booking)}>
                                Перенести
                            </Button>
                            <Button variant="ghost" size="sm" className="flex-1 text-unbox-grey hover:text-red-600 hover:bg-red-50" onClick={() => onCancel(booking.id)}>
                                Отменить
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="bg-unbox-light border border-unbox-green/20 rounded-xl p-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="flex items-center gap-1.5">
                                        <Key className="w-3.5 h-3.5 text-unbox-green shrink-0" />
                                        <div>
                                            <div className="text-[9px] uppercase font-bold text-unbox-green">Код двери</div>
                                            <div className="text-xs font-mono font-bold text-unbox-dark">#{booking.id.slice(-4).toUpperCase()}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <Wifi className="w-3.5 h-3.5 text-unbox-green shrink-0" />
                                        <div>
                                            <div className="text-[9px] uppercase font-bold text-unbox-green">Wi-Fi</div>
                                            <div className="text-xs font-mono font-bold text-unbox-dark">unbox2024</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="text-[10px] text-center text-unbox-grey italic">
                                Менее 24ч до начала. Бесплатная отмена недоступна.
                            </div>
                            {booking.isReRentListed ? (
                                <div className="bg-unbox-light text-unbox-dark border border-unbox-green/30 p-3 rounded-lg text-sm text-center font-medium">
                                    ♻️ Выставлено на переаренду
                                </div>
                            ) : (
                                <Button variant="outline" size="sm" className="w-full border-dashed border-unbox-green text-unbox-green hover:bg-unbox-light" onClick={() => onReRent(booking.id)}>
                                    ♻️ Выставить на переаренду
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {booking.status === 're-rented' && (
                <div className="mt-4 pt-4 border-t border-unbox-light">
                    <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm text-center font-medium border border-green-100 flex flex-col items-center">
                        <span>Средства возвращены на баланс</span>
                        <span className="text-lg font-bold text-green-800">+{(booking.finalPrice * 0.5).toFixed(1)} ₾</span>
                    </div>
                </div>
            )}

            {(booking.status === 'completed' || booking.status === 'cancelled') && (
                <div className="mt-4 pt-4 border-t border-unbox-light">
                    <Button variant="outline" size="sm" className="w-full text-unbox-green border-unbox-green/30 hover:bg-unbox-light gap-2" onClick={() => onBookAgain(booking)}>
                        <Repeat size={16} /> Повторить бронирование
                    </Button>
                </div>
            )}
        </Card>
    );
}

// ── CRM Quick Booking Modal ───────────────────────────────────────────────────

function CrmQuickBookingModal({
    crmMode,
    slot,
    onClose,
    onBooked,
}: {
    crmMode: { sessionId: string; clientId: string; clientName: string; date: string; duration?: number };
    slot: { resId: string; time: string; date: Date };
    onClose: () => void;
    onBooked: () => void;
}) {
    const { updateSession } = useCrmStore();
    const { currentUser } = useUserStore();
    const resource = RESOURCES.find(r => r.id === slot.resId);

    // Available formats (fallback to 'individual' for CRM — therapy is 1-on-1 by default)
    const availableFormats = (resource?.formats && resource.formats.length > 0)
        ? resource.formats
        : (['individual'] as Format[]);

    const [duration, setDuration] = useState(crmMode.duration ?? 60);
    const [chosenFormat, setChosenFormat] = useState<Format>(
        availableFormats.includes('individual') ? 'individual' : availableFormats[0]
    );
    const [chosenExtras, setChosenExtras] = useState<string[]>([]);
    const [useSubscription, setUseSubscription] = useState(false);
    const [saving, setSaving] = useState(false);
    const dateStr = format(slot.date, 'yyyy-MM-dd');

    const hasSubscription = !!currentUser?.subscription?.planId && (currentUser?.subscription?.remainingHours ?? 0) > 0;

    const startDate = useMemo(() => {
        const [h, m] = slot.time.split(':').map(Number);
        return setMinutes(setHours(slot.date, h), m);
    }, [slot.date, slot.time]);
    const endDate = useMemo(() => addMinutes(startDate, duration), [startDate, duration]);
    const endTime = format(endDate, 'HH:mm');

    // Price preview — uses the same calculator as the main booking wizard
    const pricing = useMemo(() => {
        try {
            return calculatePrice({
                format: chosenFormat,
                startTime: startDate,
                endTime: endDate,
                extras: EXTRAS.filter(e => chosenExtras.includes(e.id)),
                resourceId: slot.resId,
                paymentMethod: useSubscription ? 'subscription' : 'balance',
                personalDiscountPercent: currentUser?.personalDiscountPercent,
                pricingSystem: (currentUser as any)?.pricingSystem,
            });
        } catch {
            return null;
        }
    }, [chosenFormat, startDate, endDate, chosenExtras, slot.resId, useSubscription, currentUser]);

    const hoursForSub = duration / 60;
    const enoughHoursOnSub = hasSubscription && (currentUser?.subscription?.remainingHours ?? 0) >= hoursForSub;

    const handleBook = async () => {
        setSaving(true);
        try {
            const booking = await bookingsApi.createBooking({
                resourceId: slot.resId,
                date: dateStr, // Send as string 'YYYY-MM-DD' to avoid timezone shift
                startTime: slot.time,
                duration,
                format: chosenFormat,
                extras: chosenExtras,
                locationId: resource?.locationId,
                paymentMethod: useSubscription && enoughHoursOnSub ? 'subscription' : 'balance',
            } as any);
            await bookingsApi.linkCrmClient(booking.id, crmMode.clientId);
            // Link booking to CRM session and sync time
            if (crmMode.sessionId) {
                const sessionUpdate: Record<string, any> = {
                    bookingId: booking.id,
                    isBooked: true,
                };
                // Also sync time if it changed
                const sessionDateStr = crmMode.date ? format(parseISO(crmMode.date), 'yyyy-MM-dd') : null;
                const sessionTime = crmMode.date ? format(parseISO(crmMode.date), 'HH:mm') : null;
                if (dateStr !== sessionDateStr || slot.time !== sessionTime) {
                    sessionUpdate.date = `${dateStr}T${slot.time}:00`;
                }
                await updateSession(crmMode.sessionId, sessionUpdate);
            }
            toast.success(`Кабинет забронирован для ${crmMode.clientName}`);
            onBooked();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(', ') : e.message || 'Ошибка бронирования';
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    const fmtLabel = (f: Format) =>
        f === 'individual' ? 'Индивид.' : f === 'group' ? 'Группа' : 'Интервизия';

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4 animate-in slide-in-from-bottom-4 duration-200 max-h-[92vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="font-bold text-lg">Забронировать кабинет</h3>
                        <p className="text-sm text-unbox-grey mt-0.5">для сессии с <span className="font-medium text-unbox-dark">{crmMode.clientName}</span></p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-unbox-light rounded-lg">
                        <X className="w-5 h-5 text-unbox-grey" />
                    </button>
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
                        {[50, 60, 90, 120].map(d => (
                            <button
                                key={d}
                                onClick={() => setDuration(d)}
                                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                                    duration === d
                                        ? 'bg-unbox-green text-white border-unbox-green'
                                        : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-green/50'
                                }`}
                            >
                                {d === 120 ? '2ч' : `${d}м`}
                            </button>
                        ))}
                    </div>
                </div>

                {availableFormats.length > 1 && (
                    <div>
                        <label className="text-xs font-medium text-unbox-grey mb-1.5 block">Формат</label>
                        <div className="flex gap-2">
                            {availableFormats.map(f => (
                                <button
                                    key={f}
                                    onClick={() => setChosenFormat(f)}
                                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                                        chosenFormat === f
                                            ? 'bg-unbox-green text-white border-unbox-green'
                                            : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-green/50'
                                    }`}
                                >
                                    {fmtLabel(f)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {EXTRAS.length > 0 && (
                    <div>
                        <label className="text-xs font-medium text-unbox-grey mb-1.5 block">Доп. опции</label>
                        <div className="grid grid-cols-2 gap-2">
                            {EXTRAS.map(e => {
                                const active = chosenExtras.includes(e.id);
                                return (
                                    <button
                                        key={e.id}
                                        onClick={() => setChosenExtras(prev =>
                                            active ? prev.filter(id => id !== e.id) : [...prev, e.id]
                                        )}
                                        className={`px-2.5 py-2 rounded-xl text-xs font-medium border text-left transition-colors ${
                                            active
                                                ? 'bg-unbox-green text-white border-unbox-green'
                                                : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-green/50'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="truncate">{e.name}</span>
                                            {e.price > 0 && (
                                                <span className={`text-[10px] shrink-0 ${active ? 'text-white/80' : 'text-unbox-grey'}`}>
                                                    +{e.price}₾
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {hasSubscription && (
                    <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                        useSubscription && enoughHoursOnSub
                            ? 'bg-unbox-light border-unbox-green'
                            : 'bg-white border-unbox-light hover:border-unbox-green/50'
                    } ${!enoughHoursOnSub ? 'opacity-60' : ''}`}>
                        <input
                            type="checkbox"
                            checked={useSubscription && enoughHoursOnSub}
                            onChange={(e) => setUseSubscription(e.target.checked)}
                            disabled={!enoughHoursOnSub}
                            className="mt-0.5 accent-unbox-green"
                        />
                        <div className="flex-1 text-sm">
                            <div className="font-medium text-unbox-dark">Списать из абонемента</div>
                            <div className="text-xs text-unbox-grey mt-0.5">
                                {enoughHoursOnSub
                                    ? `Осталось ${currentUser?.subscription?.remainingHours ?? 0} ч · спишется ${hoursForSub} ч`
                                    : `Недостаточно часов (нужно ${hoursForSub} ч, осталось ${currentUser?.subscription?.remainingHours ?? 0} ч)`
                                }
                            </div>
                        </div>
                    </label>
                )}

                {pricing && (
                    <div className="bg-unbox-light/70 rounded-xl p-3 space-y-1 text-sm">
                        <div className="flex justify-between text-unbox-grey">
                            <span>Кабинет ({duration} мин, {fmtLabel(chosenFormat)})</span>
                            <span>{pricing.basePrice.toFixed(0)} ₾</span>
                        </div>
                        {pricing.extrasPrice > 0 && (
                            <div className="flex justify-between text-unbox-grey">
                                <span>Доп. опции</span>
                                <span>+{pricing.extrasPrice.toFixed(0)} ₾</span>
                            </div>
                        )}
                        {pricing.discountAmount > 0 && (
                            <div className="flex justify-between text-unbox-green">
                                <span>Скидка</span>
                                <span>−{pricing.discountAmount.toFixed(0)} ₾</span>
                            </div>
                        )}
                        {pricing.peakSlotCount > 0 && !useSubscription && (
                            <div className="text-[11px] text-amber-600">⏱ Вечерний тариф применён</div>
                        )}
                        <div className="flex justify-between font-bold text-unbox-dark pt-1.5 border-t border-unbox-light">
                            <span>Итого</span>
                            <span>
                                {useSubscription && enoughHoursOnSub
                                    ? <>{hoursForSub} ч из абонемента{pricing.subscriptionPeakDebt > 0 ? ` + ${pricing.subscriptionPeakDebt.toFixed(0)} ₾ за вечер` : ''}</>
                                    : `${pricing.finalPrice.toFixed(0)} ₾`
                                }
                            </span>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleBook}
                    disabled={saving}
                    className="w-full py-3 bg-unbox-green text-white font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Забронировать
                </button>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Grid House — MyBookingsPage
   ═══════════════════════════════════════════════════════════════ */

const ghmbMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghmbHairline = `1px solid ${GH.ink10}`;

interface GridHouseMyBookingsProps {
    viewMode: 'list' | 'grid';
    setViewMode: (v: 'list' | 'grid') => void;
    userBookings: BookingHistoryItem[];
    bookings: BookingHistoryItem[];
    upcomingBookings: BookingHistoryItem[];
    pastBookings: BookingHistoryItem[];
    handleEdit: (b: any) => void;
    handleCancel: (id: string) => void;
    handleReRent: (id: string) => void;
    handleCancelReRent: (id: string) => void;
    handleBookAgain: (b: any) => void;
    handleLinkClient: (bookingId: string, clientId: string | null) => void;
    currentUser: any;
    usersMap: Map<string, string>;
    publicBookings: BookingHistoryItem[];
    refreshBookings: () => void;
    crmMode: any;
    setCrmMode: (v: any) => void;
    crmClients: any[];
    modalConfig: any;
    setModalConfig: (v: any) => void;
    mobileLocFilter: string;
    setMobileLocFilter: (v: string) => void;
    navigate: ReturnType<typeof useNavigate>;
    location: ReturnType<typeof useLocation>;
}

function GridHouseMyBookings({
    viewMode, setViewMode, userBookings, bookings, upcomingBookings, pastBookings,
    handleEdit, handleCancel, handleReRent, handleCancelReRent,
    handleBookAgain, handleLinkClient, currentUser, usersMap,
    publicBookings, refreshBookings, crmMode, setCrmMode,
    crmClients, modalConfig, setModalConfig, mobileLocFilter, setMobileLocFilter,
    navigate, location,
}: GridHouseMyBookingsProps) {
    const totalBookings = upcomingBookings.length + pastBookings.length;

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ padding: '24px 16px 0' }}>
                <div style={{ ...ghmbMono, color: GH.ink30, marginBottom: 8 }}>МОИ БРОНИРОВАНИЯ</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div>
                        <h1 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                            Бронирования
                        </h1>
                        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                            <span style={{ fontFamily: GH_MONO, fontSize: 13, color: GH.ink60 }}>
                                {upcomingBookings.length} активных
                            </span>
                            <span style={{ fontFamily: GH_MONO, fontSize: 13, color: GH.ink30 }}>
                                {pastBookings.length} прошедших
                            </span>
                        </div>
                    </div>
                    {viewMode === 'list' && (
                        <button
                            onClick={() => setViewMode('grid')}
                            style={{ padding: '8px 16px', background: GH.ink, color: GH.paper, fontWeight: 700, fontSize: 12, fontFamily: GH_SANS, border: 'none', cursor: 'pointer' }}
                        >
                            + Новая бронь
                        </button>
                    )}
                </div>

                {/* Excel #19 — quick actions strip on the bookings page (the
                    /dashboard hub for clients). Three shortcuts: subscriptions,
                    bonuses/discounts info, become a specialist. Sticks below
                    the header on desktop, scrolls into view on mobile. */}
                <div style={{
                    display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16,
                    padding: '10px 12px', background: GH.ink5,
                    borderRadius: 8,
                }}>
                    <button
                        onClick={() => navigate('/subscriptions')}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '8px 14px', borderRadius: 6,
                            border: `1px solid ${GH.ink10}`, background: GH.paper,
                            fontFamily: GH_SANS, fontSize: 13, fontWeight: 600, color: GH.ink,
                            cursor: 'pointer',
                        }}
                    >
                        🎫 Оформить абонемент
                    </button>
                    <button
                        onClick={() => navigate('/dashboard/bonuses')}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '8px 14px', borderRadius: 6,
                            border: `1px solid ${GH.ink10}`, background: GH.paper,
                            fontFamily: GH_SANS, fontSize: 13, fontWeight: 600, color: GH.ink,
                            cursor: 'pointer',
                        }}
                    >
                        🎁 Скидки и бонусы
                    </button>
                    <button
                        onClick={() => navigate('/crm/apply')}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '8px 14px', borderRadius: 6,
                            border: `1px solid ${GH.ink10}`, background: GH.paper,
                            fontFamily: GH_SANS, fontSize: 13, fontWeight: 600, color: GH.ink,
                            cursor: 'pointer',
                        }}
                    >
                        ✨ Стать специалистом Unbox
                    </button>
                </div>

                {/* View toggle tabs */}
                <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${GH.ink}`, marginBottom: 0 }}>
                    <button
                        onClick={() => setViewMode('list')}
                        style={{
                            padding: '10px 20px', fontWeight: 600, fontSize: 13, fontFamily: GH_SANS,
                            border: 'none', cursor: 'pointer',
                            borderBottom: viewMode === 'list' ? `2px solid ${GH.ink}` : '2px solid transparent',
                            color: viewMode === 'list' ? GH.ink : GH.ink30,
                            background: 'transparent', marginBottom: -2,
                        }}
                    >
                        Список
                    </button>
                    <button
                        onClick={() => setViewMode('grid')}
                        style={{
                            padding: '10px 20px', fontWeight: 600, fontSize: 13, fontFamily: GH_SANS,
                            border: 'none', cursor: 'pointer',
                            borderBottom: viewMode === 'grid' ? `2px solid ${GH.ink}` : '2px solid transparent',
                            color: viewMode === 'grid' ? GH.ink : GH.ink30,
                            background: 'transparent', marginBottom: -2,
                        }}
                    >
                        Шахматка
                    </button>
                    {viewMode === 'grid' && (
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', paddingBottom: 2 }}>
                            {[{ id: 'all', name: 'Все' }, ...LOCATIONS].map(loc => (
                                <button
                                    key={loc.id}
                                    onClick={() => setMobileLocFilter(loc.id)}
                                    style={{
                                        padding: '4px 10px', fontSize: 10, fontWeight: 600, fontFamily: GH_MONO,
                                        letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                                        border: mobileLocFilter === loc.id ? `1px solid ${GH.ink}` : ghmbHairline,
                                        background: mobileLocFilter === loc.id ? GH.ink : 'transparent',
                                        color: mobileLocFilter === loc.id ? GH.paper : GH.ink30, cursor: 'pointer',
                                    }}
                                >
                                    {loc.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Subscription card */}
            {currentUser?.subscription && (
                <div style={{ padding: '16px 16px 0' }}>
                    <SubscriptionCard user={currentUser} />
                </div>
            )}

            {/* Content */}
            {viewMode === 'grid' ? (
                <div style={{ padding: '16px' }}>
                    {crmMode && (
                        <div style={{ marginBottom: 12, padding: '10px 16px', border: `1px solid ${GH.accent}30`, background: 'rgba(71,109,107,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CalendarIcon size={14} style={{ color: GH.accent }} />
                            <span style={{ fontSize: 13 }}>Выберите слот для сессии с <b>{crmMode.clientName}</b></span>
                            <button onClick={() => setCrmMode(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: GH.ink30 }}>
                                <X size={14} />
                            </button>
                        </div>
                    )}
                    <BookingsChessboard
                        userBookings={userBookings}
                        allBookings={bookings}
                        publicBookings={publicBookings}
                        onCancel={handleCancel}
                        onReschedule={handleEdit}
                        onReRent={handleReRent}
                        onCancelReRent={handleCancelReRent}
                        onLinkClient={handleLinkClient}
                        crmClients={crmClients.map((c: any) => ({ id: c.id, name: c.name, aliasCode: c.aliasCode }))}
                        refreshBookings={refreshBookings}
                        crmMode={crmMode}
                        onCrmBooked={() => { setCrmMode(null); navigate('/crm/sessions', { replace: true, state: { statusFilter: location.state?.returnFilter } }); }}
                        usersMap={usersMap}
                        mobileLocFilter={mobileLocFilter}
                    />
                </div>
            ) : (
                <div style={{ padding: '16px' }}>
                    {upcomingBookings.length > 0 && (
                        <div style={{ marginBottom: 32 }}>
                            <div style={{ ...ghmbMono, color: GH.ink30, marginBottom: 12 }}>АКТИВНЫЕ</div>
                            {upcomingBookings.map(b => (
                                <BookingCard
                                    key={b.id} booking={b}
                                    onEdit={handleEdit} onCancel={handleCancel} onReRent={handleReRent}
                                    onBookAgain={handleBookAgain}
                                    onLinkClient={handleLinkClient} crmClients={crmClients}
                                />
                            ))}
                        </div>
                    )}
                    {pastBookings.length > 0 && (
                        <div>
                            <div style={{ ...ghmbMono, color: GH.ink30, marginBottom: 12 }}>ПРОШЕДШИЕ</div>
                            {pastBookings.map(b => (
                                <BookingCard
                                    key={b.id} booking={b}
                                    onEdit={handleEdit} onCancel={handleCancel} onReRent={handleReRent}
                                    onBookAgain={handleBookAgain}
                                    onLinkClient={handleLinkClient} crmClients={crmClients}
                                    isPast
                                />
                            ))}
                        </div>
                    )}
                    {totalBookings === 0 && (
                        <EmptyState
                            title="Пока нет бронирований"
                            hint="Забронируйте кабинет в один клик, шахматка сверху покажет свободное время."
                            action={{
                                label: '+ Забронировать кабинет',
                                onClick: () => navigate('/dashboard/bookings'),
                            }}
                        />
                    )}
                </div>
            )}

            {/* Confirm modal */}
            {modalConfig.isOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
                    <div style={{ background: GH.paper, border: `1px solid ${GH.ink10}`, padding: 32, maxWidth: 400, width: '90%' }}>
                        <h3 style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}>{modalConfig.title}</h3>
                        <div style={{ fontSize: 14, color: GH.ink60, marginBottom: 24 }}>{modalConfig.message}</div>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button
                                onClick={() => setModalConfig({ ...modalConfig, isOpen: false })}
                                style={{ flex: 1, padding: '10px 0', border: ghmbHairline, background: 'transparent', fontWeight: 600, fontSize: 13, fontFamily: GH_SANS, cursor: 'pointer', color: GH.ink }}
                            >
                                Отмена
                            </button>
                            <button
                                onClick={() => { modalConfig.onConfirm(); setModalConfig({ ...modalConfig, isOpen: false }); }}
                                style={{ flex: 1, padding: '10px 0', border: 'none', fontWeight: 700, fontSize: 13, fontFamily: GH_SANS, cursor: 'pointer', background: modalConfig.isDestructive ? GH.danger : GH.ink, color: GH.paper }}
                            >
                                {modalConfig.confirmLabel || 'Подтвердить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Footer */}
            <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px', margin: '32px 16px 0', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...ghmbMono, color: GH.ink30 }}>UNBOX · 2026</span>
                <span style={{ ...ghmbMono, color: GH.ink10 }}>GRID HOUSE</span>
            </footer>
        </div>
    );
}
