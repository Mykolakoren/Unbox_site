import { useUserStore } from '../store/userStore';
import { useBookingStore } from '../store/bookingStore';
import { useCrmStore } from '../store/crmStore';
import { SubscriptionCard } from '../components/SubscriptionCard';
import {
    BadgeCheck, XCircle, Clock, Calendar as CalendarIcon, Key, Wifi, Repeat,
    LayoutList, LayoutGrid, ChevronLeft, ChevronRight, X, RefreshCw, GripVertical,
    User as UserIcon, Check, Pencil, Loader2, Plus, ArrowRight, ArrowLeft, AlertTriangle, RotateCcw, Bell,
    Ticket, Gift, Wallet,
} from 'lucide-react';
import clsx from 'clsx';
import { format, addDays, addMinutes, setHours, setMinutes, startOfToday, isBefore,
    startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isToday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { RESOURCES, EXTRAS, LOCATIONS } from '../utils/data';
import { isPeakTime, calculatePrice } from '../utils/pricing';
import { BookingConflictDialog, type ConflictItem } from '../components/BookingConflictDialog';
import type { Format } from '../types';
import { generateGoogleCalendarUrl } from '../utils/calendar';
import { bookingsApi } from '../api/bookings';
import { toast } from 'sonner';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { CancelBookingChoiceModal } from '../components/CancelBookingChoiceModal';
import { TrimBookingModal } from '../components/TrimBookingModal';
import { RescheduleScopeChoiceModal } from '../components/RescheduleScopeChoiceModal';
import type { BookingHistoryItem } from '../store/types';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { EmptyState } from '../components/ui/EmptyState';
import { SpecialistGateCard } from '../components/SpecialistGate';
import { useSpecialistApplicationStatus } from '../hooks/useSpecialistApplication';
import { canBookCabinets } from '../utils/permissions';
import { ChessboardScroller } from '../components/ui/ChessboardScroller';
import { waitlistApi } from '../api/waitlist';
import { WaitlistSubscribeModal } from '../components/ui/WaitlistSubscribeModal';
import { tbilisiNow } from '../utils/dateUtils';
import { COLOR, SHADOW, STATUS } from '../design/tokens';

// 2026-06-05 owner: parseUTC + safeFormat вынесены в utils/bookingHelpers
// (Фаза 1 — см. docs/REFACTOR-BOOKINGS-UNIFICATION.md). Раньше каждая
// бронь-страница имела свою копию, что создавало риск тонких отличий.
import { parseUTC, safeFormat } from '../utils/bookingHelpers';
import { confirmAction } from '../components/ui/ConfirmDialogProvider';
import { Sheet } from '../components/ui/Sheet';
import { Button as UiButton } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/StatusBadge';
import { formatDateLabel, formatDayMonth, formatGel, formatRelativeDay, formatStartsIn, formatTime } from '../utils/format';
import { ruCountWord } from '../utils/plural';
import { clientCanModifyBooking, hoursUntilBookingStart, lateRescheduleLabel, lateRescheduleLeft } from '../utils/subscription';
import { extraPool, extraPoolLabel, resourceKind } from '../utils/subscriptionHours';
import { PAUSE_LIFT_NOTE, subscriptionHours } from '../utils/paymentPriority';
import { ADMIN_ROLES } from '../utils/permissions';

/** «На пересдаче» — подтверждённая бронь, которую клиент выставил на
 *  пересдачу (флаг isReRentListed, не отдельный статус). Вид — как у
 *  StatusBadge (ui-badge), тон «ждём»; слово утверждено владельцем. */
function ReRentListedBadge({ className }: { className?: string }) {
    return (
        <span className={clsx('ui-badge ui-badge--pending', className)}>
            <Repeat size={14} strokeWidth={2.25} aria-hidden="true" />
            На пересдаче
        </span>
    );
}

/** «30 мин», «1 ч», «1,5 ч» — длительность брони коротко (было «0.5ч»). */
const formatDurationShort = (min: number): string => {
    if (!Number.isFinite(min) || min <= 0) return '—';
    if (min < 60) return `${Math.round(min)}\u00A0мин`;
    const h = Math.round((min / 60) * 10) / 10;
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(h)}\u00A0ч`;
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
    canCreate = true,
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
    /** Ещё не специалист: новые брони только через /checkout, где карточка анкеты. */
    canCreate?: boolean;
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
    // Guard against double-tap on the "+30 мин" extend buttons (slow network
    // could otherwise fire extendBooking twice → double charge/extension).
    const [extending, setExtending] = useState(false);
    // Partial-cancel ("trim") target — opens TrimBookingModal for this booking.
    const [trimBooking, setTrimBooking] = useState<BookingHistoryItem | null>(null);
    // Waitlist subscribe target — set when user taps a busy slot, drives the
    // shared mobile-friendly modal (replaces native window.confirm). One state
    // serves both desktop and mobile chessboard renderings.
    const [waitlistTarget, setWaitlistTarget] = useState<{
        resourceId: string;
        resourceName: string;
        locationName?: string | null;
        date: Date;
        startTime: string;
        endTime: string;
    } | null>(null);
    const openWaitlistFor = useCallback((b: BookingHistoryItem) => {
        // Diagnostic: when the modal silently fails (missing fields, broken
        // render path, etc.) the user just sees a dead tap. Surface the
        // failure as a toast so admins can report the actual cause instead
        // of "ничего не происходит".
        if (!b.startTime || !b.duration || !b.resourceId) {
            toast.error(
                `Не удалось открыть подписку (нет данных): ` +
                `time=${b.startTime ?? '?'}, dur=${b.duration ?? '?'}, res=${b.resourceId ?? '?'}`,
            );
            return;
        }
        const res = RESOURCES.find(r => r.id === b.resourceId);
        const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
        const endTimeStr = minsToTime(timeToMins(b.startTime) + b.duration);
        setWaitlistTarget({
            resourceId: b.resourceId,
            resourceName: res?.name || b.resourceId,
            locationName: loc?.name ?? null,
            date: parseUTC(b.date),
            startTime: b.startTime,
            endTime: endTimeStr,
        });
    }, []);
    const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLDivElement>(null);

    // Drag state (rescheduling existing bookings)
    const [dragBooking, setDragBooking] = useState<BookingHistoryItem | null>(null);
    const [dragTarget, setDragTarget] = useState<{ resId: string; time: string } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ resId: string; time: string; offsetMins: number } | null>(null);
    // After a series booking is dropped on a new slot, hold the chosen
    // destination here and let the choice modal ask "this only" vs
    // "this + every later sibling" before hitting the API.
    const [seriesMoveTarget, setSeriesMoveTarget] = useState<{
        booking: BookingHistoryItem;
        newDate: string;
        newStartTime: string;
        newResourceId?: string;
    } | null>(null);

    // ── Drag-to-select NEW booking slots ──
    // Multi-period selection: same resource can hold several non-contiguous
    // chunks (e.g. cab 5: 10:00-11:00 AND 15:00-16:00). The chunks are
    // computed on the fly from `newSlots` via `selectedNewBlocks` below.
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
    // Snapshot of all selected slots at drag start. During a 'new' drag we
    // want to ADD slots without disturbing existing chunks (in the same or
    // other resources). For resize/move we restore from this snapshot and
    // replace ONLY the chunk being touched.
    const newDragInitialSlotsRef = useRef<string[]>([]);
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

    // Owner 2026-05-27: filter out admin-disabled cabinets from the user-
    // facing booking grid. Static data carries the same `isActive` flag,
    // so this works without a backend round-trip.
    const resources = RESOURCES.filter(r => r.isActive !== false);

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

    // Can cancel/reschedule? confirmed + >24h before start (Tbilisi wall-clock).
    // booking.date stores the Tbilisi calendar day; startTime is "HH:MM" Tbilisi.
    // Convert that to a real UTC instant (subtract 4h) before comparing with
    // Date.now() — without this we overestimated the gap by 4h and the cancel
    // button stayed visible too long.
    // Один расчёт с карточками «Моих броней» (utils/subscription).
    const canModify = (b: BookingHistoryItem) => clientCanModifyBooking(b);
    // Позже суток — перенос только бесплатным переносом абонемента (владелец
    // 01.10: Тёплый 1, Регулярный 2, Профи+ 3; не позже чем за 3 ч). Сколько
    // осталось — 0, если сейчас такой перенос недоступен.
    const lateSub = useUserStore(s => s.currentUser?.subscription);
    const lateFreeLeft = (b: BookingHistoryItem) =>
        b.status === 'confirmed' && !canModify(b) ? lateRescheduleLeft(lateSub, hoursUntilBookingStart(b)) : 0;

    // Is slot in the past? Compares Tbilisi wall-clock both sides — without
    // tbilisiNow() the previous `new Date().getHours()` returned the
    // browser's local hour, so admins on a UK VPN saw an evening slot as
    // "still bookable" 4 hours after Tbilisi closed.
    const isSlotPast = useCallback((time: string) => {
        if (!isToday(selectedDate)) return isBefore(selectedDate, startOfToday());
        const [h, m] = time.split(':').map(Number);
        const now = tbilisiNow();
        const slotMins = h * 60 + m;
        return slotMins <= now.totalMins;
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
    // Build CONTIGUOUS chunks per resource, so the same cabinet can hold
    // multiple independent periods (e.g. 10:00-11:00 AND 15:00-16:00).
    // Each chunk renders separately on the chessboard with its own resize
    // handles + summary chip with × button.
    const selectedNewBlocks = useMemo(() => {
        const byRes: Record<string, number[]> = {};
        for (const slot of newSlots) {
            const [resId, timeStr] = slot.split('|');
            const idx = timeSlots.indexOf(timeStr);
            if (idx === -1) continue;
            if (!byRes[resId]) byRes[resId] = [];
            byRes[resId].push(idx);
        }
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
    }, [newSlots, timeSlots]);

    /** Find the chunk that contains a (resource, slot-idx) pair. Used by
     *  cell rendering and resize/move to know "which chunk is this slot
     *  part of?" — so resizing chunk B doesn't silently delete chunk A. */
    const getNewBlockAt = (resId: string, idx: number) =>
        selectedNewBlocks.find(b => b.resId === resId && idx >= b.start && idx <= b.end) ?? null;

    /** Legacy helper — first chunk in a resource. Kept only for code paths
     *  that don't yet know about multi-period; new code should prefer
     *  `getNewBlockAt(resId, idx)` for slot-aware lookups. */
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

    /** Legacy helper — REPLACES all slots for a resource. Still used by the
     *  summary chip × button to drop a single chunk's slots; for chip
     *  removal we pass exactly the slots of the chunk to remove + survivors,
     *  via the new {@link removeNewBlock} helper below. */
    const setNewSlotRange = useCallback((resId: string, times: string[]) => {
        setNewSlots(prev => {
            const other = prev.filter(s => !s.startsWith(`${resId}|`));
            return [...other, ...times.map(t => `${resId}|${t}`)];
        });
    }, []);

    /** Drop just one chunk (block) from the selection. Other chunks in the
     *  same resource — and other resources — are untouched. Replaces the
     *  old "× chip" handler that wiped the entire resource. */
    const removeNewBlock = useCallback((block: { resId: string; start: number; end: number }) => {
        const idsToRemove = new Set<string>();
        for (let i = block.start; i <= block.end; i++) {
            idsToRemove.add(`${block.resId}|${timeSlots[i]}`);
        }
        setNewSlots(prev => prev.filter(s => !idsToRemove.has(s)));
    }, [timeSlots]);

    // ── New booking drag handlers ──
    const handleNewDragDown = (resId: string, time: string, mode: NewDragMode) => {
        if (isSlotOccupied(resId, time) && mode === 'new') return;

        const clickedIdx = timeSlots.indexOf(time);

        // If clicking on already-selected slot in 'new' mode → switch to 'move'
        // and capture the SPECIFIC chunk that contains this slot, not just the
        // first chunk in the resource. Otherwise dragging on the second period
        // would silently move the first one.
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
        // Snapshot full selection at drag start. 'new' drags ADD a fresh
        // chunk on top of this snapshot; resize/move replace ONE chunk in
        // this snapshot.
        newDragInitialSlotsRef.current = [...newSlots];

        if (mode === 'new') {
            // Start a brand-new chunk with just this single slot. ADDS to
            // the existing selection — does NOT wipe other chunks in this
            // resource (which the old `setNewSlotRange` did, and that's why
            // multi-period in one cabinet didn't work).
            setNewSlots(prev => {
                const slotId = `${resId}|${time}`;
                return prev.includes(slotId) ? prev : [...prev, slotId];
            });
        } else {
            // Resize handles capture the chunk containing the dragged slot,
            // not just the first chunk in the resource.
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

        const currentIdx = timeSlots.indexOf(time);
        const startIdx = timeSlots.indexOf(startSlot.time);
        if (currentIdx === -1 || startIdx === -1) return;

        if (mode === 'new') {
            // Extend the new chunk between the click point and the cursor.
            // Critical: do NOT touch slots in OTHER chunks (same or other
            // resources). Take the snapshot, drop only the slots of THIS
            // new chunk so far (drafts started at startIdx in startSlot.resId),
            // and re-add the new range.
            if (startSlot.resId !== resId) return;
            const minIdx = Math.min(startIdx, currentIdx);
            const maxIdx = Math.max(startIdx, currentIdx);
            const draftSlots: string[] = [];
            let blocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotOccupied(resId, timeSlots[i])) { blocked = true; break; }
                draftSlots.push(timeSlots[i]);
            }
            if (blocked) return;
            // Strip only the draft slots from the snapshot (anything between
            // minIdx..maxIdx that we MIGHT have added on a previous tick).
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
                if (isSlotOccupied(resId, timeSlots[i])) { blocked = true; break; }
                slots.push(timeSlots[i]);
            }
            if (blocked) return;
            // Replace ONLY the chunk being resized; survivors keep all
            // other chunks (in this resource and others) intact.
            const oldChunkIds = new Set<string>();
            for (let i = initBlock.start; i <= initBlock.end; i++) {
                oldChunkIds.add(`${resId}|${timeSlots[i]}`);
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
                if (isSlotOccupied(resId, timeSlots[i])) { blocked = true; break; }
                slots.push(timeSlots[i]);
            }
            if (blocked) return;
            const oldChunkIds = new Set<string>();
            for (let i = initBlock.start; i <= initBlock.end; i++) {
                oldChunkIds.add(`${resId}|${timeSlots[i]}`);
            }
            const survivors = initialSnapshot.filter(s => !oldChunkIds.has(s));
            const newIds = slots.map(t => `${resId}|${t}`);
            setNewSlots([...survivors, ...newIds]);
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
            if (blocked) return;
            const oldChunkIds = new Set<string>();
            for (let i = initBlock.start; i <= initBlock.end; i++) {
                oldChunkIds.add(`${resId}|${timeSlots[i]}`);
            }
            const survivors = initialSnapshot.filter(s => !oldChunkIds.has(s));
            const newIds = slots.map(t => `${resId}|${t}`);
            setNewSlots([...survivors, ...newIds]);
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
            // Was step 4 (skip straight to payment) — admins reported users
            // had no way to add extras. Now lands on OptionsStep so the
            // format + extras pickers are visible before checkout.
            step: 3,
        });

        setNewSlots([]);
        navigate('/checkout');
    };

    const handleRecurringBooking = async () => {
        if (newSlots.length === 0 || !recurringPattern) return;
        // Ещё не специалист: серия ушла бы прямо в API и упала 403 на последнем
        // шаге. Ведём через /checkout — там карточка «заполните анкету».
        if (!canCreate) {
            proceedToCheckout();
            return;
        }
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
            const patternLabel = recurringPattern === 'weekly' ? 'еженедельно' : recurringPattern === 'biweekly' ? 'раз в 2 нед.' : 'раз в 4 нед.';
            toast.success(`Серия создана: ${ruCountWord(result.created, ['бронь', 'брони', 'броней'])} (${patternLabel}), ${formatGel(result.totalCost ?? 0)}`);
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

        // Confirm — общее окно (кнопки называют действие), не системное confirm().
        const resName = RESOURCES.find(r => r.id === newRes)?.name || newRes;
        const confirmed = await confirmAction({
            title: 'Перенести бронь?',
            body: `${formatTime(oldTime)} → ${formatTime(newTime)}${oldRes !== newRes ? ` · ${RESOURCES.find(r => r.id === oldRes)?.name} → ${resName}` : ''}`,
            confirmLabel: 'Перенести',
            cancelLabel: 'Оставить как было',
        });

        if (confirmed) {
            const newDate = format(selectedDate, 'yyyy-MM-dd');
            // Series → defer to the choice modal so the user picks
            // "this only" vs "this + every later sibling". When CRM mode
            // is active we also need to sync the linked session, but
            // that happens after the modal completes (see seriesMoveTarget
            // render below).
            if (dragBooking.recurringGroupId) {
                setSeriesMoveTarget({
                    booking: dragBooking,
                    newDate,
                    newStartTime: newTime,
                    newResourceId: oldRes !== newRes ? newRes : undefined,
                });
                setDragBooking(null);
                setDragTarget(null);
                return;
            }
            try {
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
            // First selection — auto-select 2 adjacent 30-min slots (1h min)
            // STARTING from the tap. Used to snap pairStart down to an even
            // index ("снэп к началу часа") which forced 10:30 taps to become
            // 10:00–11:00 bookings — admins reported it as "не могу выбрать
            // 10:30–11:30, либо час с :00, либо никак". Respect the user's
            // chosen start slot; if it's the very last slot in the day, fall
            // back to start-1 so we still have a 60-min window.
            let pairStart = slotIdx;
            let pairEnd = pairStart + 1;
            if (pairEnd >= timeSlots.length) {
                pairStart = timeSlots.length - 2;
                pairEnd = timeSlots.length - 1;
                if (pairStart < 0) return;
            }
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
                <div className="rounded-none border border-ink-10 overflow-hidden" style={{ background: COLOR.card }}>
                    <div className="text-center text-xs font-semibold text-ink-60 pt-1.5 pb-0.5 capitalize">
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
                    <button onClick={() => { const n = subWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }} className="p-1.5 rounded-lg hover:bg-card text-ink-60">
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
                                        "flex flex-col items-center py-2 rounded-lg transition-all text-xs relative",
                                        isSelected
                                            ? "bg-accent text-on-accent shadow-md"
                                            : "bg-card text-ink-60 border border-ink-10"
                                    )}
                                >
                                    <span className="text-caption font-bold uppercase">{format(day, 'EEEEEE', { locale: ru })}</span>
                                    <span className="text-sm font-bold">
                                        {format(day, 'd')}
                                        <span className="ml-0.5 text-caption font-medium uppercase opacity-70">
                                            {format(day, 'MMM', { locale: ru })}
                                        </span>
                                    </span>
                                    {hasBooking && <span className={clsx("absolute bottom-1 w-1.5 h-1.5 rounded-full", isSelected ? "bg-on-accent/80" : "bg-accent")} />}
                                </button>
                            );
                        })}
                    </div>
                    <button onClick={() => { const n = addWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }} className="p-1.5 rounded-lg hover:bg-card text-ink-60">
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
                                <div key={loc.id} className="rounded-lg border border-ink-10 bg-card p-1.5">
                                    {mobileLocFilter === 'all' && (
                                        <div className="text-caption font-bold text-ink-60 uppercase tracking-wider px-2 pb-1">{loc.name}</div>
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
                                                            ? 'bg-accent text-on-accent border-accent'
                                                            : 'bg-card text-ink-60 border-ink-10'
                                                    )}
                                                >
                                                    <div className="font-bold whitespace-nowrap text-caption">{r.name}</div>
                                                    <div className="text-caption opacity-70">{r.capacity} чел.</div>
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
                    <div className="flex items-center justify-between bg-accent-soft border border-accent rounded-lg px-4 py-3">
                        <div>
                            <div className="text-sm font-bold text-ink">{mBlockStart} — {mBlockEnd}</div>
                            <div className="text-xs text-ink-60">{mBlockDur} мин · {mobileRes.name}</div>
                        </div>
                        <button onClick={() => setNewSlotRange(mobileRes.id, [])} className="p-1.5 rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]">
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* CRM mode hint */}
                {crmMode && (
                    <div className="flex items-center gap-2 bg-[var(--status-pending-bg)] border border-[var(--status-pending-fg)] rounded-lg px-3 py-2 text-sm">
                        <CalendarIcon className="w-4 h-4 text-[var(--status-pending-fg)] shrink-0" />
                        <span className="text-[var(--status-pending-fg)] text-xs">Выберите слот для <strong>{crmMode.clientName}</strong></span>
                    </div>
                )}

                {/* 2-column time grid.
                    Pre-compute rendered cells so мы можем пропустить целые
                    строки, где оба слота — это mid-cell брони (return null).
                    Без этого получались «пустые ряды» внутри длинной чужой
                    брони, и шахматка визуально казалась бесконечно занятой,
                    маскируя свободные окошки между бронями. */}
                <div className="rounded-none bg-card border border-ink-10 p-2 space-y-1.5">
                    {mobileRes && mobileHourPairs.map(([left, right]) => {
                        // Skip rows where both cells are mid-slots of bookings
                        // (both will return null below). Без этого внутри
                        // длинной брони (3+ часа) рендерилась цепочка пустых
                        // div'ов с gap, делая страницу визуально «занятой».
                        const leftIsMid = !!left && (() => {
                            const mB = findBookingAtSlot(dayUserBookings, mobileRes.id, left);
                            const pB = !mB ? findBookingAtSlot(dayPublicBookings, mobileRes.id, left) : null;
                            return !!mB || (!!pB && timeToMins(pB.startTime!) !== timeToMins(left));
                        })();
                        const rightIsMid = !!right && (() => {
                            const mB = findBookingAtSlot(dayUserBookings, mobileRes.id, right);
                            const pB = !mB ? findBookingAtSlot(dayPublicBookings, mobileRes.id, right) : null;
                            return !!mB || (!!pB && timeToMins(pB.startTime!) !== timeToMins(right));
                        })();
                        if (leftIsMid && (rightIsMid || !right)) return null;
                        return (
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
                                                'flex-1 flex flex-col justify-center px-2.5 py-2 rounded-lg text-left min-h-[48px] border',
                                                isCompleted
                                                    ? 'bg-sunken border-ink-10 text-ink-60'
                                                    : 'bg-accent-soft border-accent text-ink'
                                            )}
                                        >
                                            <div className="text-caption font-bold tabular-nums">{myB.startTime}–{endTime}</div>
                                            <div className="text-caption truncate">
                                                {clientInfo?.name || usersMap?.get(myB.userId) || myB.userId.split('@')[0]}
                                            </div>
                                        </button>
                                    );
                                }

                                // Skip mid-slots — they were briefly rendered as
                                // tappable "↑ продолжение" cells, but for длинных
                                // (2-3 ч) броней это превращало шахматку в
                                // сплошное серое полотно: 5 строк подряд
                                // "продолжение" визуально топили рядом стоящие
                                // свободные ячейки 12:00/20:00, и админы
                                // жаловались "всё занято, хотя есть окошки".
                                // Возвращаем null + позже row-с-обоих-null
                                // не рендерится — это даёт компактную картинку,
                                // как в CRM-шахматке. Тап по чужой брони
                                // нужно делать на её стартовой ячейке.
                                if (myB || (pubB && timeToMins(pubB.startTime!) !== timeToMins(time))) {
                                    return null;
                                }
                                // Other user's booking. On mobile we surface the
                                // "Следить за слотом" affordance: tapping the
                                // busy cell opens the same modal the desktop
                                // chessboard uses. Re-rentable slots show a
                                // dashed amber tint instead — those are
                                // available right now without subscribing.
                                if (pubB && timeToMins(pubB.startTime!) === timeToMins(time)) {
                                    const endTime = minsToTime(timeToMins(pubB.startTime!) + pubB.duration);
                                    const pubName = usersMap?.get(pubB.userId) || '';
                                    const isReRentAvail = pubB.isReRentListed;
                                    return (
                                        <button
                                            key={time}
                                            onClick={() => {
                                                if (isReRentAvail) {
                                                    toast.info('Это время пересдают — его можно занять прямо сейчас.');
                                                    return;
                                                }
                                                openWaitlistFor(pubB);
                                            }}
                                            title="Тап — следить за слотом"
                                            className={clsx(
                                                'flex-1 flex flex-col justify-center px-2.5 py-2 rounded-lg text-left min-h-[48px] active:scale-[0.97] transition-transform',
                                                isReRentAvail
                                                    ? 'bg-[var(--status-pending-bg)] border border-[var(--status-pending-fg)] border-dashed text-[var(--status-pending-fg)]'
                                                    : 'bg-sunken border border-ink-10 text-ink-60'
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-1">
                                                <div className="text-caption font-bold tabular-nums">{pubB.startTime}–{endTime}</div>
                                                {!isReRentAvail && <Bell size={11} className="text-[var(--status-pending-fg)] shrink-0" />}
                                            </div>
                                            <div className="text-caption truncate">
                                                {isReRentAvail ? '↻ можно занять' : (pubName || 'Занято — тап чтобы следить')}
                                            </div>
                                        </button>
                                    );
                                }

                                // Free slot. Mirror desktop's CRM-hint styling: when
                                // the user is booking a cabinet for an existing CRM
                                // session, paint slots inside the session's time
                                // window with the same orange diagonal-stripe hint
                                // so they can immediately see where the session
                                // sits — previously only desktop had this.
                                const isCrmHint = !isPast && !!crmMode &&
                                    crmHintDate === format(selectedDate, 'yyyy-MM-dd') &&
                                    timeToMins(time) >= crmHintStartMins &&
                                    timeToMins(time) < crmHintEndMins;
                                return (
                                    <button
                                        key={time}
                                        onClick={() => !isPast && handleMobileTap(mobileRes.id, time, isHourCol)}
                                        disabled={isPast}
                                        title={isCrmHint && crmMode ? `Время сессии: ${format(parseISO(crmMode.date), 'HH:mm')} (${crmMode.duration ?? 60} мин)` : undefined}
                                        className={clsx(
                                            'flex-1 flex items-center justify-between px-3 py-2.5 rounded-lg transition-all min-h-[48px]',
                                            isPast
                                                ? 'bg-sunken text-ink-30 cursor-not-allowed'
                                                : newSel
                                                    ? 'bg-accent text-on-accent shadow-sm'
                                                    : isCrmHint
                                                        ? 'text-ink active:scale-[0.97]'
                                                        : isPeakTime(time)
                                                            ? 'bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] border border-[var(--status-pending-fg)] active:scale-[0.97]'
                                                            : 'bg-card text-ink border border-ink-10 active:scale-[0.97]'
                                        )}
                                        style={(!newSel && isCrmHint) ? {
                                            background: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(138,90,0,0.16) 5px, rgba(138,90,0,0.16) 10px)',
                                            outline: `1.5px dashed ${STATUS.pending.fg}`,
                                            outlineOffset: '-1px',
                                        } : undefined}
                                    >
                                        <span className={clsx('text-sm font-bold tabular-nums', newSel ? 'text-on-accent' : isPast ? 'text-ink-30' : 'text-ink')}>
                                            {time}
                                        </span>
                                        {newSel ? (
                                            <div className="w-5 h-5 rounded-full bg-on-accent/20 flex items-center justify-center">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                            </div>
                                        ) : isCrmHint ? (
                                            <div className="w-5 h-5 rounded-full border-2 border-[var(--status-pending-fg)]" style={{ background: STATUS.pending.bg }} />
                                        ) : !isPast ? (
                                            <div className="w-5 h-5 rounded-full border-2 border-ink-10" />
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                        );
                    })}
                </div>

                {/* Bottom bar */}
                {(mBlock || hasTimeOverlap) && (
                    <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-3">
                        <div
                            className="p-3 space-y-2.5"
                            style={{
                                background: COLOR.paper,
                                borderTop: `1px solid ${COLOR.ink10}`,
                            }}
                        >
                            {/* Recurring pattern selector */}
                            <div className="flex gap-1">
                                {([
                                    { id: '' as const, label: 'Разово' },
                                    { id: 'weekly' as const, label: 'Кажд. нед.' },
                                    { id: 'biweekly' as const, label: '2 нед.' },
                                    { id: 'monthly' as const, label: '4 нед.' },
                                ]).map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setRecurringPattern(p.id)}
                                        className={clsx(
                                            'flex-1 py-1.5 rounded-lg text-caption font-semibold transition-colors border',
                                            recurringPattern === p.id
                                                ? 'bg-accent text-on-accent border-accent'
                                                : 'border-ink-10 text-ink-60 hover:border-accent'
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
                                        className="w-14 px-2 py-1 rounded-lg border border-ink-10 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
                                    />
                                    <span className="text-caption text-ink-60">
                                        повторений · {recurringPattern === 'monthly'
                                            ? `≈ ${Math.round(recurringOccurrences * 4 / 4.3)} мес.`
                                            : recurringPattern === 'biweekly'
                                                ? `≈ ${Math.round(recurringOccurrences / 2)} мес.`
                                                : `≈ ${Math.round(recurringOccurrences / 4.3)} мес.`}
                                    </span>
                                </div>
                            )}

                            {/* Action row */}
                            <div className="flex items-center justify-between">
                                <div className="text-sm text-ink">
                                    <span className="font-bold text-accent-ink">{newSlots.length * 30} мин</span> выбрано
                                </div>
                                <button
                                    onClick={handleConfirmNewBooking}
                                    disabled={newSlots.length === 0 || recurringSaving}
                                    className="bg-accent text-on-accent font-medium text-sm px-5 py-2.5 rounded-lg shadow-md flex items-center gap-1.5 disabled:opacity-50"
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
                    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45" onClick={() => setActiveBooking(null)}>
                        <div className="bg-card rounded-t-2xl shadow-2xl w-full max-w-md p-5 animate-in slide-in-from-bottom-4 duration-200" onClick={e => e.stopPropagation()}>
                            <div className="w-10 h-1 bg-ink-10 rounded-full mx-auto mb-4" />
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <div className="font-bold text-ink">
                                        {activeBooking.crmClientId && clientMap.get(activeBooking.crmClientId)?.name || usersMap?.get(activeBooking.userId) || activeBooking.userId}
                                    </div>
                                    <div className="text-xs text-ink-60">
                                        {activeBooking.startTime} · {formatDurationShort(activeBooking.duration)} · {resources.find(r => r.id === activeBooking.resourceId)?.name}
                                    </div>
                                </div>
                                <button onClick={() => setActiveBooking(null)} className="p-1"><X size={16} /></button>
                            </div>
                            <div className="text-sm mb-4">
                                {/* Статус — из общего словаря; «На пересдаче» — флаг
                                    подтверждённой брони, выставленной на пересдачу. */}
                                {activeBooking.status === 'confirmed' && activeBooking.isReRentListed
                                    ? <ReRentListedBadge />
                                    : <StatusBadge kind="booking" status={activeBooking.status} />}
                                <span className="ml-2 text-ink-60">{formatGel(activeBooking.finalPrice)}</span>
                            </div>
                            {canModify(activeBooking) ? (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-3 gap-2">
                                        <button onClick={() => { onReschedule(activeBooking); setActiveBooking(null); }} className="py-2.5 text-xs font-medium rounded-lg bg-sunken text-ink">Перенести</button>
                                        <button onClick={() => { onReRent(activeBooking.id); setActiveBooking(null); }} className="py-2.5 text-xs font-medium rounded-lg bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]">
                                            {activeBooking.isReRentListed ? 'Снять' : 'Пересдать'}
                                        </button>
                                        <button onClick={() => { onCancel(activeBooking.id); setActiveBooking(null); }} className="py-2.5 text-xs font-medium rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]">Отменить</button>
                                    </div>
                                    {activeBooking.duration >= 120 && !activeBooking.isReRentListed && (
                                        <button
                                            onClick={() => { setTrimBooking(activeBooking); setActiveBooking(null); }}
                                            className="w-full py-2 text-xs font-medium rounded-lg bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]"
                                        >
                                            Отменить часть
                                        </button>
                                    )}
                                    {/* Селектор «Клиент из CRM» — как в десктопном попапе
                                        (просьба владельца 16.09): привязать одного клиента
                                        ко всей брони прямо с телефона. */}
                                    {crmClients.length > 0 && activeBooking.status !== 'completed' && (
                                        <div className="flex items-center gap-2 pt-1">
                                            <span className="text-caption text-ink-60 uppercase tracking-wider font-semibold flex-shrink-0">Клиент CRM</span>
                                            <select
                                                value={activeBooking.crmClientId || ''}
                                                onChange={(e) => {
                                                    const val = e.target.value || null;
                                                    onLinkClient(activeBooking.id, val);
                                                    setActiveBooking(prev => prev ? { ...prev, crmClientId: val || undefined } : null);
                                                }}
                                                className="flex-1 min-w-0 text-xs border border-ink-10 rounded-lg px-2 py-2 bg-card text-ink focus:border-accent focus:outline-none"
                                            >
                                                <option value="">— Без клиента —</option>
                                                {crmClients.map(c => (
                                                    <option key={c.id} value={c.id}>
                                                        {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    {/* 15.09 (вопрос владельца): мобильная шторка не имела
                                        моста в разбивку по клиентам — он был только в
                                        десктопном попапе. Тот же переход: CRM → Бронирования
                                        с автооткрытием окна разбивки этой брони. */}
                                    {crmClients.length > 0 && activeBooking.duration > 60 && (
                                        <Link
                                            to={`/crm/bookings?link=${activeBooking.id}`}
                                            onClick={() => setActiveBooking(null)}
                                            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-lg border border-dashed border-accent text-accent-ink"
                                        >
                                            <Plus size={12} /> Разбить по клиентам ({formatDurationShort(activeBooking.duration)} → сессии)
                                        </Link>
                                    )}
                                </div>
                            ) : activeBooking.status === 'confirmed' && !(() => {
                                const [bh, bm] = (activeBooking.startTime || '00:00').split(':').map(Number);
                                const dp = parseUTC(activeBooking.date);
                                const endUTC = Date.UTC(dp.getUTCFullYear(), dp.getUTCMonth(), dp.getUTCDate(), bh - 4, bm + (activeBooking.duration || 60), 0, 0);
                                return endUTC < Date.now();
                            })() ? (
                                // Same UX as desktop: show why cancel is gone
                                // and offer «Пересдать» as the alternative the
                                // client actually has in this window.
                                <div className="space-y-2">
                                    {activeBooking.isReRentListed ? (
                                        <div className="bg-[var(--status-pending-bg)] border border-[var(--status-pending-fg)] rounded-lg p-2.5 text-xs text-center text-[var(--status-pending-fg)] flex items-center justify-center gap-1.5">
                                            <Repeat size={12} aria-hidden="true" /> На пересдаче
                                        </div>
                                    ) : (
                                        <>
                                            <div className="text-caption text-ink-60 text-center italic px-2">
                                                До начала меньше 24 часов — отменить уже нельзя. Можно пересдать время: если его займёт другой специалист, вернём 50 %. Или напишите администратору.
                                            </div>
                                            {lateFreeLeft(activeBooking) > 0 && (
                                                <button
                                                    onClick={() => { onReschedule(activeBooking); setActiveBooking(null); }}
                                                    className="w-full py-2.5 rounded-lg bg-sunken text-ink text-xs font-semibold"
                                                >
                                                    {lateRescheduleLabel(lateFreeLeft(activeBooking))}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => { onReRent(activeBooking.id); setActiveBooking(null); }}
                                                className="w-full py-2 rounded-lg border border-dashed border-accent text-accent-ink text-xs font-semibold hover:bg-ink-05 transition-all"
                                            >
                                                <span className="inline-flex items-center gap-1.5"><Repeat size={12} aria-hidden="true" /> Пересдать</span>
                                            </button>
                                        </>
                                    )}
                                </div>
                            ) : null}
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
                {/* Waitlist modal — копия desktop-mount'а, иначе на мобильном
                    ранний return закрывает компонент до того как мы дойдём до
                    единственного <WaitlistSubscribeModal> внизу — state
                    обновляется при тапе но окно нигде не рендерится. */}
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
                {trimBooking && (
                    <TrimBookingModal
                        booking={{
                            id: trimBooking.id,
                            startTime: trimBooking.startTime!,
                            duration: trimBooking.duration,
                            date: trimBooking.date as any,
                        }}
                        onClose={() => setTrimBooking(null)}
                        onDone={refreshBookings}
                    />
                )}
            </div>
        );
    }

    // ── DESKTOP VIEW ──
    return (
        <div className="space-y-4">
            {/* Week navigation */}
            <div className="flex items-center gap-2 p-1.5 rounded-none border border-ink-10"
                style={{ background: COLOR.card }}>
                <button
                    onClick={() => { const n = subWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }}
                    className="p-2 hover:bg-card rounded-lg transition-all text-ink-60 hover:text-ink border border-transparent hover:border-ink-20 hover:shadow-sm"
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
                                    "flex flex-col items-center justify-center py-2.5 rounded-lg transition-all duration-200 text-sm relative",
                                    isSelected
                                        ? "bg-accent text-on-accent shadow-lg  scale-[1.04]"
                                        : "bg-card text-ink-60 border border-ink-10 hover:border-accent hover:text-ink hover:shadow-sm"
                                )}
                            >
                                <span className={clsx("text-caption font-bold uppercase tracking-wider mb-1", isSelected ? "opacity-80" : "")}>
                                    {format(day, 'EEE', { locale: ru })}
                                </span>
                                {/* Day-number + month abbreviation so a week
                                    that straddles two months (29 апр → 1 мая)
                                    isn't ambiguous. */}
                                <span className="text-base font-bold leading-none">
                                    {format(day, 'd')}
                                    <span className="ml-1 text-caption font-medium uppercase tracking-wider opacity-70">
                                        {format(day, 'MMM', { locale: ru })}
                                    </span>
                                </span>
                                {hasBooking && (
                                    <span className={clsx(
                                        "absolute bottom-1 w-1.5 h-1.5 rounded-full",
                                        isSelected ? "bg-on-accent/80" : "bg-accent"
                                    )} />
                                )}
                            </button>
                        );
                    })}
                </div>
                <button
                    onClick={() => { const n = addWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }}
                    className="p-2 hover:bg-card rounded-lg transition-all text-ink-60 hover:text-ink border border-transparent hover:border-ink-20 hover:shadow-sm"
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
                scrollClassName="overflow-x-scroll border border-ink-10 bg-card select-none"
            >
            <div ref={tableRef}>
                <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
                    <thead className="text-ink font-medium border-b border-ink-10"
                        style={{ background: COLOR.sunken }}>
                        <tr>
                            <th className="sticky left-0 p-4 border-r border-ink-10 z-20 w-36 font-bold text-ink"
                                style={{ background: COLOR.paper }}>
                                Кабинет
                            </th>
                            {timeSlots.map(t => (
                                <th key={t} className={clsx(
                                    "p-2 text-center min-w-[56px] border-r border-ink-10 text-caption uppercase font-bold",
                                    isEveningSurcharge(t)
                                        ? "text-[var(--status-pending-fg)] bg-[var(--status-pending-bg)]"
                                        : isPeakTime(t) ? "text-[var(--status-pending-fg)] bg-[var(--status-pending-bg)]" : "text-ink-60"
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
                                            className="p-0 border-r border-ink-10 h-14 relative"
                                        >
                                            <div
                                                onPointerDown={canMod ? (e) => handleDragStart(myB, r.id, time, e) : undefined}
                                                className={clsx(
                                                    "absolute inset-[2px] rounded-lg flex flex-col items-start justify-center px-2 gap-0.5 transition-all shadow-sm group touch-none select-none overflow-hidden min-w-0",
                                                    isCompleted
                                                        ? "bg-ink-10 text-ink-60"
                                                        : isReRent
                                                            ? "bg-[var(--status-pending-bg)] border-2 border-dashed border-[var(--status-pending-fg)] text-[var(--status-pending-fg)]"
                                                            : canMod
                                                                ? "bg-accent hover:bg-accent-hover text-on-accent cursor-grab active:cursor-grabbing"
                                                                : "bg-ink hover:bg-ink-80 text-on-accent"
                                                )}
                                            >
                                                <span className="text-caption font-bold leading-none opacity-90 flex items-center gap-1 max-w-full min-w-0 whitespace-nowrap">
                                                    {/* Recurring marker — иконка «Серия» (раньше звёздочка-эмодзи).
                                                        Visible to both owner and admin. */}
                                                    {myB.recurringGroupId && <Repeat size={10} aria-label="Серия" className="shrink-0" />}
                                                    {/* Бронь на 30 мин — узкая клетка: строка обрезается, а не вылезает. */}
                                                    <span className="truncate min-w-0">{myB.startTime} · {formatDurationShort(myB.duration)}</span>
                                                    {isCompleted && <Check size={10} aria-label="Прошла" className="shrink-0" />}
                                                </span>
                                                {clientInfo ? (
                                                    <span className="text-caption opacity-80 leading-none flex items-center gap-0.5 max-w-full min-w-0 overflow-hidden">
                                                        <UserIcon size={8} className="shrink-0" />
                                                        <span className="truncate min-w-0">
                                                            {clientInfo.aliasCode ? `${clientInfo.aliasCode} · ${clientInfo.name}` : clientInfo.name}
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span className="text-caption opacity-70 leading-none flex items-center gap-0.5 max-w-full min-w-0 overflow-hidden">
                                                        <UserIcon size={8} className="shrink-0" />
                                                        <span className="truncate min-w-0">{usersMap?.get(myB.userId) || myB.userId}</span>
                                                    </span>
                                                )}
                                                {isReRent && <span className="text-caption opacity-80 leading-none truncate max-w-full">на пересдаче</span>}
                                                {!isCompleted && !isReRent && !canMod && <span className="text-caption opacity-90 leading-none truncate max-w-full">&lt; 24 ч</span>}
                                                {canMod && <GripVertical size={10} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 transition-opacity" />}
                                                {/* Edit button */}
                                                <button
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => { if (!isDragging) handleCellClick(myB, e, false); }}
                                                    className={clsx(
                                                        // Видна при наведении, фокусе с клавиатуры и всегда на сенсорных экранах.
                                                        "absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity",
                                                        isCompleted ? "hover:bg-ink-10" : "hover:bg-on-accent/20"
                                                    )}
                                                    title="Подробнее о брони"
                                                    aria-label={`Бронь ${myB.startTime}: подробнее`}
                                                >
                                                    <Pencil size={12} aria-hidden="true" />
                                                </button>
                                            </div>
                                        </td>
                                    );
                                } else if (isDragGhost) {
                                    // Drag ghost preview
                                    cells.push(
                                        <td key={`${r.id}-${time}`}
                                            className="p-0 border-r border-ink-10 h-14 relative"
                                            onPointerEnter={() => handleDragOver(r.id, time)}
                                        >
                                            <div className="absolute inset-[2px] rounded-lg bg-accent-soft border-2 border-dashed border-accent animate-pulse" />
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
                                        // Click on a busy slot opens the WaitlistSubscribeModal
                                        // (mobile-friendly bottom sheet, replaces window.confirm).
                                        // The modal POSTs /waitlist on confirm; backend's
                                        // notify_waitlist_for_freed_slot pings any subscriber
                                        // when the slot frees up — broadened to the whole
                                        // location, so subscribing to Кабинет 5 also fires
                                        // when Кабинет 6/7/8/9 in the same branch frees.
                                        const handleWaitlistClick = () => {
                                            if (isReRentAvailable) {
                                                toast.info('Это время пересдают — выберите его внизу шахматки.');
                                                return;
                                            }
                                            openWaitlistFor(pubB);
                                        };
                                        cells.push(
                                            <td
                                                key={`${r.id}-${time}`}
                                                colSpan={pubSpan}
                                                className="p-0 border-r border-ink-10 h-14 relative"
                                            >
                                                <div
                                                    className={clsx(
                                                        "absolute inset-[2px] rounded-lg flex flex-col items-start justify-center px-2 gap-0.5 cursor-pointer transition-colors group overflow-hidden min-w-0",
                                                        isReRentAvailable
                                                            ? "bg-[var(--status-pending-bg)] border border-dashed border-[var(--status-pending-fg)] text-[var(--status-pending-fg)] hover:bg-[var(--status-pending-bg)]"
                                                            : "bg-ink-10 text-ink-80 hover:bg-ink-10"
                                                    )}
                                                    title={isReRentAvailable
                                                        ? 'Время пересдают — его можно занять'
                                                        : 'Нажмите чтобы получить уведомление, когда слот освободится'}
                                                    onClick={handleWaitlistClick}
                                                >
                                                    <span className="text-caption font-bold leading-none truncate max-w-full">
                                                        {pubB.startTime} · {formatDurationShort(pubB.duration)}
                                                    </span>
                                                    <span className="text-caption opacity-80 leading-none truncate max-w-full">
                                                        Занято
                                                    </span>
                                                    {isReRentAvailable && <span className="text-caption font-medium leading-none truncate max-w-full">на пересдаче</span>}
                                                    {!isReRentAvailable && (
                                                        <span className="text-caption opacity-0 group-hover:opacity-90 leading-none transition-opacity">
                                                            <Bell size={10} className="inline" aria-hidden="true" /> подписаться
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
                                    // Find the SPECIFIC chunk this slot belongs to so the
                                    // cell's start/end edges line up with the chunk's
                                    // boundaries (previously we used the FIRST chunk in
                                    // the resource → second period inherited the wrong
                                    // styling and the resize handle anchored to the
                                    // wrong chunk).
                                    const newBlock = newSel ? getNewBlockAt(r.id, idx) : null;
                                    const isNewStart = newBlock ? newBlock.start === idx : false;
                                    const isNewEnd = newBlock ? newBlock.end === idx : false;
                                    const isNewSingle = newBlock ? newBlock.start === newBlock.end : false;

                                    const NewResizeHandle = ({ type }: { type: 'start' | 'end' }) => (
                                        <div
                                            className={`absolute top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center z-20 hover:bg-on-accent/20 transition-colors ${type === 'start' ? 'left-0 rounded-l-md' : 'right-0 rounded-r-md'}`}
                                            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handleNewDragDown(r.id, time, type === 'start' ? 'resize-start' : 'resize-end'); }}
                                        >
                                            <div className="w-1 h-3 bg-on-accent/70 rounded-full" />
                                        </div>
                                    );

                                    cells.push(
                                        <td key={`${r.id}-${time}`} className="p-0 border-r border-ink-10 h-14 relative">
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
                                                    "w-full h-full flex items-center justify-center text-caption relative select-none touch-none transition-colors",
                                                    isPast
                                                        ? "bg-black/[0.03]"
                                                        : newSel
                                                            ? "bg-accent text-on-accent z-10 cursor-grab shadow-sm"
                                                            : isPeakTime(time)
                                                                ? "bg-[var(--status-pending-bg)] hover:bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] hover:text-[var(--status-pending-fg)] cursor-pointer"
                                                                : "hover:bg-accent-soft text-ink-60 hover:text-accent-ink cursor-pointer",
                                                    newSel && !isNewSingle && !isNewStart && "border-l border-on-accent/20",
                                                    isNewStart && newSel && "rounded-l-lg",
                                                    isNewEnd && newSel && "rounded-r-lg"
                                                )}
                                                style={(!newSel && isCrmHint) ? { background: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(138,90,0,0.12) 5px, rgba(138,90,0,0.12) 10px)', outline: '1.5px dashed rgba(249,115,22,0.5)', outlineOffset: '-1px' } : undefined}
                                                title={isCrmHint ? `Время сессии: ${format(parseISO(crmMode!.date), 'HH:mm')} (${crmMode!.duration ?? 60} мин)` : undefined}
                                            >
                                                {newSel ? (
                                                    <>
                                                        <div className="flex items-center justify-between w-full h-full px-1 relative">
                                                            {isNewStart && !isNewSingle && <NewResizeHandle type="start" />}
                                                            {isNewStart && (
                                                                <div className="flex flex-col items-center justify-center w-full">
                                                                    <div className="font-bold text-on-accent text-xs">{time}</div>
                                                                </div>
                                                            )}
                                                            {isNewEnd && !isNewSingle && <NewResizeHandle type="end" />}
                                                        </div>
                                                        {isNewEnd && (
                                                            <button
                                                                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setNewSlotRange(r.id, []); }}
                                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setNewSlotRange(r.id, []); }}
                                                                className="absolute top-0.5 right-0.5 bg-[var(--status-danger-solid)] text-on-accent rounded-full w-4 h-4 flex items-center justify-center shadow-md hover:bg-[var(--status-danger-fg)] hover:scale-110 transition-all z-50"
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
                                <tr key={r.id} className="hover:bg-ink-05 group">
                                    <td className="sticky left-0 p-3 border-r border-ink-10 z-10"
                                        style={{ background: COLOR.paper }}>
                                        <div className="font-bold text-ink text-xs">{r.name}</div>
                                        <div className="text-caption text-ink-60">{r.capacity} чел.</div>
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
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-80 bg-card rounded-lg px-4 py-2.5 shadow-sm">
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-accent" />
                    <span>Ваша бронь (можно перетащить на другое время)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-ink" />
                    <span>До брони меньше 24 ч — можно пересдать</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded border-2 border-dashed border-[var(--status-pending-fg)] bg-[var(--status-pending-bg)]" />
                    <span>Время на пересдаче — его можно занять</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-ink-10" />
                    <span>Прошедшая</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-striped border border-ink-10" />
                    <span>Занято</span>
                </div>
            </div>

            {/* ── Floating booking bar ── */}
            {!crmMode && newSlots.length > 0 && (
                <div className="sticky bottom-0 z-30 -mx-1">
                    <div className="bg-card border border-ink-10 rounded-none shadow-lg px-5 py-3 space-y-2.5 animate-in slide-in-from-bottom-4 duration-200">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4 flex-wrap min-w-0">
                                {/* Summary chips — one per chunk. With multi-period
                                    selection, the same resource can appear here twice
                                    (e.g. cab 5 · 10:00-11:00 AND cab 5 · 15:00-16:00).
                                    The × button drops just THIS chunk, leaving any
                                    sibling chunks in the same resource untouched. */}
                                {selectedNewBlocks.map((block, blockIdx) => {
                                    const res = resources.find(r => r.id === block.resId);
                                    const slots = block.end - block.start + 1;
                                    const hours = (slots * 30) / 60;
                                    return (
                                        <div key={`${block.resId}-${block.start}-${blockIdx}`} className="flex items-center gap-1.5 bg-accent-soft text-accent-ink rounded-lg px-2.5 py-1.5 text-xs font-semibold">
                                            <span>{res?.name || block.resId}</span>
                                            <span className="opacity-60">·</span>
                                            <span>{timeSlots[block.start]}-{minsToTime(timeToMins(timeSlots[block.end]) + 30)}</span>
                                            <span className="opacity-60">·</span>
                                            <span>{hours}ч</span>
                                            <button
                                                onClick={() => removeNewBlock(block)}
                                                className="ml-1 hover:bg-[var(--status-danger-bg)] rounded-full p-0.5 transition-colors"
                                                title="Убрать этот период"
                                            >
                                                <X size={10} className="text-[var(--status-danger-fg)]" />
                                            </button>
                                        </div>
                                    );
                                })}
                                {/* Time overlap warning */}
                                {hasTimeOverlap && (
                                    <div className="flex items-center gap-1.5 text-[var(--status-pending-fg)] text-xs font-medium">
                                        <AlertTriangle size={14} className="shrink-0" />
                                        <span>Наложение по времени</span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleConfirmNewBooking}
                                disabled={bookingSaving || recurringSaving}
                                className="flex items-center gap-2 bg-accent text-on-accent text-sm font-bold px-5 py-2.5 rounded-lg shadow-md hover:bg-ink-80 active:scale-95 transition-all whitespace-nowrap shrink-0"
                            >
                                {recurringSaving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                                <span>{recurringPattern ? `Серия · ${recurringOccurrences}` : 'Продолжить'}</span>
                            </button>
                        </div>

                        {/* Recurring pattern row */}
                        <div className="flex items-center gap-2">
                            <Repeat size={14} className="text-ink-60 shrink-0" />
                            <div className="flex gap-1.5">
                                {([
                                    { id: '' as const, label: 'Разово' },
                                    { id: 'weekly' as const, label: 'Каждую неделю' },
                                    { id: 'biweekly' as const, label: 'Раз в 2 нед.' },
                                    { id: 'monthly' as const, label: 'Раз в 4 недели' },
                                ]).map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => setRecurringPattern(p.id)}
                                        className={clsx(
                                            'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border',
                                            recurringPattern === p.id
                                                ? 'bg-accent text-on-accent border-accent'
                                                : 'border-ink-10 text-ink-60 hover:border-accent hover:text-accent-ink'
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
                                        className="w-14 px-2 py-1 rounded-lg border border-ink-10 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
                                    />
                                    <span className="text-xs text-ink-60 whitespace-nowrap">
                                        {recurringPattern === 'monthly'
                                            ? `≈ ${Math.round(recurringOccurrences * 4 / 4.3)} мес.`
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
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-ink/45" onClick={() => setShowOverlapWarning(false)}>
                    <div className="bg-card rounded-none shadow-2xl w-full max-w-sm p-6 space-y-4 mx-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[var(--status-pending-bg)] flex items-center justify-center">
                                <AlertTriangle size={20} className="text-[var(--status-pending-fg)]" />
                            </div>
                            <h3 className="font-bold text-lg">Наложение по времени</h3>
                        </div>
                        <p className="text-sm text-ink-60">
                            Вы выбрали слоты, которые пересекаются по времени в разных кабинетах. Вы уверены, что хотите продолжить?
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowOverlapWarning(false)}
                                className="flex-1 px-4 py-2.5 rounded-lg border border-ink-10 text-sm font-medium hover:bg-ink-05 transition">
                                Отмена
                            </button>
                            <button onClick={() => { setShowOverlapWarning(false); proceedToCheckout(); }}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-accent text-on-accent text-sm font-bold hover:bg-ink-80 transition">
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
                    className="fixed z-[200] w-80 border border-ink-10 p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
                    style={{
                        top: popupPos.top,
                        left: Math.min(popupPos.left, window.innerWidth - 330),
                        background: COLOR.card,
                        // Всплывающее — единственное место с тенью (Grid House).
                        boxShadow: SHADOW.pop,
                    }}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="font-bold text-ink text-sm">
                                {RESOURCES.find(r => r.id === activeBooking.resourceId)?.name || 'Кабинет'}
                            </div>
                            <div className="text-xs text-ink-60 mt-0.5">
                                {format(parseUTC(activeBooking.date), 'd MMMM', { locale: ru })} · {activeBooking.startTime} – {minsToTime(timeToMins(activeBooking.startTime!) + activeBooking.duration)} · {formatDurationShort(activeBooking.duration)}
                            </div>
                            <div className="text-xs font-semibold mt-1">
                                {activeBooking.paymentSource === 'credit' ? (
                                    <span className="text-[var(--status-danger-fg)]">Долг: {formatGel(activeBooking.finalPrice)}</span>
                                ) : (
                                    <span className="text-accent-ink">Оплачено: {formatGel(activeBooking.finalPrice)}</span>
                                )}
                            </div>
                        </div>
                        <button onClick={() => setActiveBooking(null)} className="p-1 hover:bg-ink-05 rounded-lg transition-colors">
                            <X size={14} className="text-ink-60" />
                        </button>
                    </div>

                    {/* CRM Client selector */}
                    {activeBooking.status !== 'completed' && (
                        <div className="border-t border-ink-10 pt-3">
                            <div className="text-caption text-ink-60 uppercase tracking-wider mb-1.5 font-semibold">Клиент из CRM</div>
                            {crmClients.length > 0 ? (
                                <>
                                    <div className="flex items-center gap-2">
                                        <UserIcon size={12} className="text-ink-60 flex-shrink-0" />
                                        <select
                                            value={activeBooking.crmClientId || ''}
                                            onChange={(e) => {
                                                const val = e.target.value || null;
                                                onLinkClient(activeBooking.id, val);
                                                setActiveBooking(prev => prev ? { ...prev, crmClientId: val || undefined } : null);
                                            }}
                                            className="flex-1 text-xs border border-ink-10 rounded-lg px-2 py-1.5 bg-card text-ink focus:border-accent focus:outline-none"
                                        >
                                            <option value="">— Без клиента —</option>
                                            {crmClients.map(c => (
                                                <option key={c.id} value={c.id}>
                                                    {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    {/* Мост в CRM (02.09): длинную бронь можно разбить на
                                        сессии по часу с РАЗНЫМИ клиентами — это умеет окно
                                        привязки в CRM → Бронирования. Селектор выше вешает
                                        ОДНОГО клиента на всю бронь; для 2ч+ даём прямой
                                        переход в разбивку, чтобы не искать бронь заново. */}
                                    {activeBooking.duration > 60 && (
                                        <Link
                                            to={`/crm/bookings?link=${activeBooking.id}`}
                                            onClick={() => setActiveBooking(null)}
                                            className="mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-accent text-accent-ink text-xs font-semibold hover:bg-ink-05 transition-all"
                                        >
                                            <Plus size={12} /> Разбить по клиентам ({formatDurationShort(activeBooking.duration)} → сессии)
                                        </Link>
                                    )}
                                </>
                            ) : (
                                <Link to="/crm/clients" className="flex items-center gap-1.5 text-xs text-ink-60 hover:text-accent-ink transition-colors" onClick={() => setActiveBooking(null)}>
                                    <UserIcon size={12} />
                                    Добавьте клиентов в разделе «Мой CRM»
                                </Link>
                            )}
                        </div>
                    )}

                    {/* Actions */}
                    {activeBooking.status === 'completed' ? (
                        <div className="space-y-2 pt-1">
                            <div className="bg-sunken rounded-lg p-2.5 text-xs text-center text-ink-60 flex items-center justify-center gap-1.5">
                                <Check size={12} /> Бронирование завершено
                            </div>
                        </div>
                    ) : canModify(activeBooking) ? (
                        <div className="space-y-2 pt-1">
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setActiveBooking(null); onReschedule(activeBooking); }}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-ink-10 text-ink text-xs font-semibold hover:border-accent hover:text-accent-ink transition-all"
                                >
                                    <RefreshCw size={12} /> Перенести
                                </button>
                                <button
                                    onClick={() => { setActiveBooking(null); onCancel(activeBooking.id); }}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-ink-10 text-[var(--status-danger-fg)] text-xs font-semibold hover:bg-[var(--status-danger-bg)] transition-all"
                                >
                                    <X size={12} /> Отменить
                                </button>
                            </div>
                            <button
                                disabled={extending}
                                onClick={async () => {
                                    if (extending) return;
                                    setExtending(true);
                                    try {
                                        const updated = await bookingsApi.extendBooking(activeBooking.id, 30);
                                        setActiveBooking(null);
                                        refreshBookings?.();
                                        toast.success(`Продлено на 30 мин. Итого: ${updated.duration} мин`);
                                    } catch (err: any) {
                                        toast.error(err?.response?.data?.detail || 'Не удалось продлить');
                                    } finally {
                                        setExtending(false);
                                    }
                                }}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-sunken text-ink text-xs font-semibold hover:bg-accent-soft transition-all disabled:opacity-50"
                            >
                                <Plus size={12} /> Продлить +30 мин
                            </button>
                        </div>
                    ) : activeBooking.isReRentListed ? (
                        <div className="space-y-2 pt-1">
                            <div className="bg-[var(--status-pending-bg)] rounded-lg p-2.5 text-xs text-center text-[var(--status-pending-fg)] border border-[var(--status-pending-fg)] flex items-center justify-center gap-1.5">
                                <Repeat size={12} aria-hidden="true" /> На пересдаче
                            </div>
                            <button
                                onClick={() => { setActiveBooking(null); onCancelReRent(activeBooking.id); }}
                                className="w-full py-2 rounded-lg border border-ink-10 text-ink-60 text-xs font-semibold hover:bg-ink-05 transition-all"
                            >
                                Снять с пересдачи
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
                                <div className="bg-sunken rounded-lg p-2.5 text-xs text-center text-ink-60 border border-ink-10 font-medium">
                                    <span className="inline-flex items-center gap-1.5"><Check size={12} aria-hidden="true" /> Бронь прошла</span>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 pt-1">
                                <div className="text-caption text-ink-60 text-center italic">
                                    До начала меньше 24 часов — отменить уже нельзя. Можно пересдать время: если его займёт другой специалист, вернём 50 %. Или напишите администратору.
                                </div>
                                {lateFreeLeft(activeBooking) > 0 && (
                                    <button
                                        onClick={() => { setActiveBooking(null); onReschedule(activeBooking); }}
                                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-ink-10 text-ink text-xs font-semibold hover:border-accent hover:text-accent-ink transition-all"
                                    >
                                        <RefreshCw size={12} /> {lateRescheduleLabel(lateFreeLeft(activeBooking))}
                                    </button>
                                )}
                                <button
                                    disabled={extending}
                                    onClick={async () => {
                                        if (extending) return;
                                        const ok = await confirmAction({
                                            title: 'Продлить на 30 минут?',
                                            body: 'До начала меньше 24 часов. Отменить продление потом можно будет только через администратора, и это будет платно.',
                                            confirmLabel: 'Продлить на 30 мин',
                                            cancelLabel: 'Не продлевать',
                                        });
                                        if (!ok) return;
                                        setExtending(true);
                                        try {
                                            const updated = await bookingsApi.extendBooking(activeBooking.id, 30);
                                            setActiveBooking(null);
                                            refreshBookings?.();
                                            toast.success(`Продлено на 30 мин. Итого: ${updated.duration} мин`);
                                        } catch (err: any) {
                                            toast.error(err?.response?.data?.detail || 'Не удалось продлить');
                                        } finally {
                                            setExtending(false);
                                        }
                                    }}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-sunken text-ink text-xs font-semibold hover:bg-accent-soft transition-all disabled:opacity-50"
                                >
                                    <Plus size={12} /> Продлить +30 мин
                                </button>
                                <button
                                    onClick={() => { setActiveBooking(null); onReRent(activeBooking.id); }}
                                    className="w-full py-2 rounded-lg border border-dashed border-accent text-accent-ink text-xs font-semibold hover:bg-ink-05 transition-all"
                                >
                                    <span className="inline-flex items-center gap-1.5"><Repeat size={12} aria-hidden="true" /> Пересдать</span>
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

            {seriesMoveTarget && (
                <RescheduleScopeChoiceModal
                    // Клиенту позже суток «эту и следующие» не предлагаем —
                    // сервер даст 400 (бесплатный перенос — только для одной брони).
                    allowSeries={ADMIN_ROLES.includes(useUserStore.getState().currentUser?.role || '')
                        || clientCanModifyBooking(seriesMoveTarget.booking)}
                    bookingId={seriesMoveTarget.booking.id}
                    newDate={seriesMoveTarget.newDate}
                    newStartTime={seriesMoveTarget.newStartTime}
                    newResourceId={seriesMoveTarget.newResourceId}
                    onClose={() => setSeriesMoveTarget(null)}
                    onCompleted={async () => {
                        // CRM-mode drag: keep the linked session in sync
                        // with the new wall-clock the booking just landed
                        // on. Only the anchor's time matters here — the
                        // session was linked to that one row.
                        if (crmMode?.sessionId) {
                            try {
                                await updateSession(crmMode.sessionId, {
                                    date: `${seriesMoveTarget.newDate}T${seriesMoveTarget.newStartTime}:00`,
                                });
                            } catch (err: any) {
                                toast.error(err.response?.data?.detail || 'Не удалось обновить сессию');
                            }
                        }
                        setSeriesMoveTarget(null);
                        refreshBookings();
                    }}
                />
            )}

            {/* Waitlist subscribe — single modal instance shared by desktop
                and mobile slot taps. Opens via openWaitlistFor(). */}
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
// ─────────────────────────────────────────────────────────────────────────────

export function MyBookingsPage() {
        const navigate = useNavigate();
    const location = useLocation();
    const { currentUser, bookings, users, fetchUsers, cancelBooking, fetchBookings } = useUserStore();
    const startEditing = useBookingStore(s => s.startEditing);
    const { clients: crmClients, fetchClients } = useCrmStore();
    // Default to "Список" instead of "Шахматка" — Анна, Райская и Миша
    // жаловались, что шахматка с большим количеством броней (33+) на телефоне
    // нечитаема: нужно тыкать дату → кабинет → ползать пальцем по сетке.
    // Список сразу даёт хронологический обзор «вот ближайшие, вот прошедшие»
    // и кнопки переноса/отмены/продления для каждой брони. CRM-режим всё
    // равно переключает на сетку (см. effect ниже), так что воркфлоу
    // «забронировать кабинет под клиента» не страдает.
    // ?view=grid — один адрес «забронировать» для всех кнопок кабинета (X2-15):
    // сразу открывает сетку, а не список.
    const [viewMode, setViewMode] = useState<'list' | 'grid' | 'series'>(() => {
        const v = new URLSearchParams(location.search).get('view');
        return v === 'grid' || v === 'series' ? v : 'list';
    });
    const [mobileLocFilter, setMobileLocFilter] = useState<string>('all');
    // Deep-link from Telegram series-end reminder. When the URL has
    // ?series=<group_id>, the page jumps to list view, scrolls to the
    // next-upcoming booking of that series, and surfaces a banner with
    // "Продлить" + "ОК, не продлевать" buttons (the latter calls
    // dismissSeriesEndReminder so no more pings fire).
    const [searchParams, setSearchParams] = useSearchParams();
    // ?view=grid при переходе, когда страница уже открыта (меню «Забронировать
    // кабинет» с «Моих броней»): маршрут тот же, компонент не пересоздаётся,
    // поэтому реагируем на каждую навигацию (location.key меняется даже при
    // том же адресе), а не только на первый рендер.
    useEffect(() => {
        const v = new URLSearchParams(location.search).get('view');
        if (v === 'grid' || v === 'series') setViewMode(v);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key]);
    const highlightedSeriesId = searchParams.get('series');
    const clearHighlightedSeries = useCallback(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('series');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);
    useEffect(() => {
        if (!highlightedSeriesId) return;
        setViewMode('list');
        // Wait for cards to render before scrolling. 250 ms is long
        // enough for the bookings list to mount after a cold deep-link.
        const t = window.setTimeout(() => {
            const el = document.querySelector<HTMLElement>(`[data-series-anchor="${highlightedSeriesId}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 250);
        return () => window.clearTimeout(t);
    }, [highlightedSeriesId]);
    const [publicBookings, setPublicBookings] = useState<BookingHistoryItem[]>([]);

    // Recurring-series info, fetched ONCE per page mount instead of once per
    // BookingCard. Earlier the strip on each card hit /recurring-groups on
    // its own useEffect — for a specialist with 50+ active series this
    // exploded into 50+ parallel calls and tripped the 30/min rate limit.
    // Now we hit the endpoint once and pass a Map down to each card.
    const [seriesInfoMap, setSeriesInfoMap] = useState<Map<string, { futureCount: number; lastDate: string | null; pattern: string }>>(new Map());
    const refreshSeriesInfo = useCallback(async () => {
        try {
            const groups = await bookingsApi.getRecurringGroups();
            const m = new Map<string, { futureCount: number; lastDate: string | null; pattern: string }>();
            groups.forEach(g => {
                const lastDate = (g as any).lastDate ?? (g as any).last_date ?? null;
                m.set(g.recurringGroupId, {
                    futureCount: (g as any).futureCount ?? (g as any).future_count ?? 0,
                    lastDate,
                    pattern: g.pattern,
                });
            });
            setSeriesInfoMap(m);
        } catch {
            // Quiet — series strip just won't render the count, no toast spam.
        }
    }, []);
    useEffect(() => { refreshSeriesInfo(); }, [refreshSeriesInfo]);

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

    // Deep-link from /dashboard/waitlist "Забронировать" — when the user
    // taps that button, route state carries focusResourceId + forceView.
    // We jump straight to the chessboard, with the resource's location
    // already filtered, so the user doesn't have to hunt for the cabinet
    // after a slot-freed alert.
    useEffect(() => {
        const focusId = (location.state as any)?.focusResourceId as string | undefined;
        const forceView = (location.state as any)?.forceView as 'grid' | 'list' | 'series' | undefined;
        if (focusId) {
            const r = RESOURCES.find(x => x.id === focusId);
            if (r?.locationId) setMobileLocFilter(r.locationId);
        }
        if (forceView && forceView !== viewMode) {
            setViewMode(forceView);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state]);

    // Auto-refresh on mount + when the tab regains focus.
    // Why: App.tsx fires fetchBookings() once on initial app mount, but if
    // a user logs in in another tab, navigates from /login → /dashboard/bookings,
    // or comes back from a booking they just created in /booking, the store
    // can be stale or empty. Users were noticing they had to manually refresh
    // the page to see their bookings — this closes that gap.
    useEffect(() => {
        refreshBookings();
        const onFocus = () => {
            if (document.visibilityState === 'visible') {
                refreshBookings();
            }
        };
        document.addEventListener('visibilitychange', onFocus);
        window.addEventListener('focus', onFocus);
        return () => {
            document.removeEventListener('visibilitychange', onFocus);
            window.removeEventListener('focus', onFocus);
        };
        // refreshBookings is stable via useCallback — listed below for lint
    }, [refreshBookings]);

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

    // Recurring-series cancel choice. Set when the user clicks "Отменить
    // бронь" on a row that's part of a series; renders a 3-button modal
    // (this / future / cancel) instead of the single-row confirm above.
    const [seriesCancelTarget, setSeriesCancelTarget] = useState<BookingHistoryItem | null>(null);

    // Filter to "mine" — even for admins. /admin/bookings exists for admins
    // who want to see everything. Match by:
    //   • userUuid (every modern booking has it; unambiguous)
    //   • current email (legacy rows + manual entries)
    //   • any prior email recorded in this user's `commentHistory`
    //     (email_change events) — Anna's case: she had bookings under a
    //     synthetic/old email and the strict equality used to drop them
    //     even though the backend `/me` endpoint already returned them.
    const knownEmails = (() => {
        const set = new Set<string>();
        if (currentUser?.email) set.add(currentUser.email.toLowerCase());
        const ch: any[] = (currentUser as any)?.commentHistory || [];
        ch.forEach(e => {
            if (e?.type === 'email_change' && typeof e.old_email === 'string') {
                set.add(String(e.old_email).toLowerCase());
            }
        });
        return set;
    })();
    const userBookings = bookings.filter(b => {
        if (currentUser?.id && (b as any).userUuid === currentUser.id) return true;
        const uid = (b.userId || '').toLowerCase();
        return uid && knownEmails.has(uid);
    });

    // Sort key = booking start as a Date (date column + start_time). Used to
    // make "Ближайшие" list nearest-first instead of recent-first. Anna's
    // complaint: a freshly-created series of 12 weekly slots had the same
    // `createdAt`, so the list ordered by createdAt randomly within the
    // batch and the user landed on "29 июня, 15 июня, 1 июня" — far-future
    // dates she "до июня ещё не дожила".
    const startMs = (b: BookingHistoryItem) => {
        const d = parseUTC(b.date);
        if (b.startTime) {
            const [h, m] = b.startTime.split(':').map(Number);
            d.setUTCHours(h || 0, m || 0, 0, 0);
        }
        return d.getTime();
    };

    // Split into upcoming and past, each sorted in the direction that
    // surfaces "what matters next" first.
    // «Предстоящие» — и подтверждённые, и «Ждём подтверждения» (горячая бронь
    // на одобрении раньше не попадала никуда — G3-02). Отменённые брони на
    // будущие даты — отдельной группой, не в «Прошедших» (G3-client-desktop-M3).
    const nowMs = Date.now();
    const upcomingBookings = userBookings
        .filter(b => b.status === 'confirmed' || b.status === 'pending_approval')
        .sort((a, b) => startMs(a) - startMs(b)); // earliest upcoming first
    const cancelledUpcoming = userBookings
        .filter(b => b.status === 'cancelled' && startMs(b) >= nowMs)
        .sort((a, b) => startMs(a) - startMs(b));
    const pastBookings = userBookings
        .filter(b => b.status === 'completed' || b.status === 're-rented' || b.status === 'rescheduled'
            || b.status === 'no_show' || (b.status === 'cancelled' && startMs(b) < nowMs))
        .sort((a, b) => startMs(b) - startMs(a)); // most-recently-past first

    const handleEdit = (booking: any) => {
        startEditing(booking, 'reschedule');
        navigate('/checkout');
    };

    const handleCancel = (id: string) => {
        const booking = bookings.find(b => b.id === id);
        if (!booking) return;

        // Series → defer to choice modal instead of single-row confirm.
        if (booking.recurringGroupId) {
            setSeriesCancelTarget(booking);
            return;
        }

        const refundText = booking.paymentMethod === 'subscription'
            ? `${booking.hoursDeducted || (booking.duration / 60)} ч. будут возвращены на ваш абонемент.`
            : `${formatGel(booking.finalPrice)} вернём на ваш баланс.`;

        setModalConfig({
            isOpen: true,
            title: 'Отменить бронирование?',
            message: (
                <div className="space-y-2 text-sm text-ink-60">
                    <p>Отменённую бронь не вернуть — время сразу увидят другие.</p>
                    <p className="font-medium text-ink bg-sunken p-2">{refundText}</p>
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
                    const detail = error?.response?.data?.detail || 'Не удалось отменить бронирование';
                    // <24h hard-block: backend returns Russian text mentioning "24"
                    // and «пересдать / администратором». Surface a sonner action
                    // button so the user can hop straight into Telegram with admin.
                    if (typeof detail === 'string' && /24\s*час/i.test(detail)) {
                        toast.error(detail, {
                            duration: 10000,
                            action: {
                                label: 'Написать админу',
                                onClick: () => window.open('https://t.me/UnboxCenter', '_blank'),
                            },
                        });
                    } else {
                        toast.error(typeof detail === 'string' ? detail : 'Не удалось отменить бронирование');
                    }
                }
            }
        });
    };

    const handleReRent = (id: string) => {
        setModalConfig({
            isOpen: true,
            title: 'Пересдать бронь?',
            message: (
                <span>Если другой пользователь забронирует это время, вам вернется <b>50%</b> от стоимости бронирования на баланс.</span>
            ),
            confirmLabel: 'Пересдать',
            isDestructive: false,
            onConfirm: async () => {
                try {
                    await bookingsApi.toggleReRent(id);
                    toast.success('Бронь на пересдаче. Если время займут, вернём 50 % на баланс.');
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
            toast.success('Снято с пересдачи');
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
        <>
            <GridHouseMyBookings
                viewMode={viewMode} setViewMode={setViewMode}
                userBookings={userBookings} bookings={bookings}
                upcomingBookings={upcomingBookings} pastBookings={pastBookings}
                cancelledUpcoming={cancelledUpcoming}
                handleEdit={handleEdit} handleCancel={handleCancel}
                handleReRent={handleReRent} handleCancelReRent={handleCancelReRent}
                handleBookAgain={handleBookAgain} handleLinkClient={handleLinkClient}
                currentUser={currentUser} usersMap={usersMap}
                publicBookings={publicBookings} refreshBookings={refreshBookings}
                crmMode={crmMode} setCrmMode={setCrmMode}
                crmClients={crmClients} modalConfig={modalConfig} setModalConfig={setModalConfig}
                mobileLocFilter={mobileLocFilter} setMobileLocFilter={setMobileLocFilter}
                navigate={navigate} location={location}
                seriesInfoMap={seriesInfoMap} refreshSeriesInfo={refreshSeriesInfo}
                highlightedSeriesId={highlightedSeriesId}
                clearHighlightedSeries={clearHighlightedSeries}
            />

            {seriesCancelTarget && seriesCancelTarget.recurringGroupId && (
                <CancelBookingChoiceModal
                    bookingId={seriesCancelTarget.id}
                    groupId={seriesCancelTarget.recurringGroupId}
                    onClose={() => setSeriesCancelTarget(null)}
                    onCompleted={async () => {
                        setSeriesCancelTarget(null);
                        refreshBookings();
                    }}
                />
            )}
        </>
    );
}



// ─── Series View — group user's recurring bookings by group_id ───────────────
// Surfaces "Постоянные брони" on mobile so a regular client-specialist can
// find all their recurring slots in one place. Each group renders the
// upcoming occurrences as BookingCards (so all action buttons — перенести,
// отменить, продлить серию — keep working). Past occurrences are hidden;
// non-recurring bookings are filtered out entirely.
function SeriesView({
    bookings,
    seriesInfoMap,
    onSeriesChanged,
    onEdit, onCancel, onReRent, onBookAgain, onLinkClient,
    crmClients,
}: {
    bookings: BookingHistoryItem[];
    seriesInfoMap: Map<string, { futureCount: number; lastDate: string | null; pattern: string }>;
    onSeriesChanged: () => void | Promise<void>;
    onEdit: (b: BookingHistoryItem) => void;
    onCancel: (id: string) => void;
    onReRent: (id: string) => void;
    onBookAgain: (b: BookingHistoryItem) => void;
    onLinkClient: (id: string, clientId: string | null) => void;
    crmClients: any[];
}) {
    const grouped = useMemo(() => {
        const parseSort = (b: BookingHistoryItem): number => {
            try {
                const d = new Date(b.date as any);
                return d.getTime() || 0;
            } catch { return 0; }
        };
        const m = new Map<string, BookingHistoryItem[]>();
        const now = Date.now();
        bookings.forEach(b => {
            if (!b.recurringGroupId) return;
            if (b.status !== 'confirmed' && b.status !== 'completed') return;
            const t = parseSort(b);
            // Only future / today; past occurrences shown in normal List view.
            if (t && t < now - 12 * 3600 * 1000) return;
            const arr = m.get(b.recurringGroupId) || [];
            arr.push(b);
            m.set(b.recurringGroupId, arr);
        });
        m.forEach(arr => arr.sort((a, b) => parseSort(a) - parseSort(b)));
        return Array.from(m.entries()).sort(([, a], [, b]) => parseSort(a[0]) - parseSort(b[0]));
    }, [bookings]);

    if (grouped.length === 0) {
        return (
            <div style={{ padding: '64px 16px', textAlign: 'center', color: GH.ink60 }}>
                <div style={{ ...ghmbMono, marginBottom: 8 }}>ПОСТОЯННЫХ БРОНЕЙ НЕТ</div>
                <div style={{ fontSize: 13 }}>
                    Создайте серию из шахматки — несколько одинаковых слотов подряд по неделям
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: '16px' }}>
            {grouped.map(([groupId, items]) => {
                const head = items[0];
                const info = seriesInfoMap.get(groupId);
                const patternLabel = info?.pattern === 'monthly' ? '4 нед.'
                    : info?.pattern === 'biweekly' ? '2 нед.'
                    : 'Еженед.';
                const resource = RESOURCES.find(r => r.id === head.resourceId);
                return (
                    <div key={groupId} style={{ marginBottom: 24 }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                            paddingBottom: 6, borderBottom: `2px solid ${GH.ink}`,
                        }}>
                            <Repeat size={14} aria-label="Серия" style={{ color: GH.ink60, flexShrink: 0 }} />
                            <span style={{ fontSize: 14, fontWeight: 700 }}>
                                {resource?.name || head.resourceId}
                            </span>
                            <span style={{ ...ghmbMono, color: GH.ink60 }}>
                                {head.startTime} · {patternLabel} · {info?.futureCount ?? items.length} впереди
                            </span>
                        </div>
                        <SeriesControls
                            groupId={groupId}
                            currentPattern={(info?.pattern as 'weekly' | 'biweekly' | 'monthly') || 'weekly'}
                            onChanged={onSeriesChanged}
                            onCancelSeries={() => onCancel(head.id)}
                        />
                        {items.slice(0, 6).map(b => (
                            <BookingCard
                                key={b.id} booking={b}
                                onEdit={onEdit} onCancel={onCancel} onReRent={onReRent}
                                onBookAgain={onBookAgain}
                                onLinkClient={onLinkClient} crmClients={crmClients}
                                seriesInfoMap={seriesInfoMap}
                                onSeriesChanged={onSeriesChanged}
                            />
                        ))}
                        {items.length > 6 && (
                            <div style={{ ...ghmbMono, color: GH.ink60, padding: '8px 0' }}>
                                + ещё {items.length - 6} в этой серии
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}


// ─── Series controls: продлить (число / до даты, периодичность) + отменить ───
function SeriesControls({
    groupId, currentPattern, onChanged, onCancelSeries,
}: {
    groupId: string;
    currentPattern: 'weekly' | 'biweekly' | 'monthly';
    onChanged: () => void | Promise<void>;
    onCancelSeries: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [pattern, setPattern] = useState<'weekly' | 'biweekly' | 'monthly'>(currentPattern);
    const [mode, setMode] = useState<'count' | 'until'>('count');
    const [count, setCount] = useState(4);
    const [until, setUntil] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (mode === 'until' && !until) { toast.error('Укажите дату «до»'); return; }
        setBusy(true);
        try {
            const r = await bookingsApi.extendRecurringSeries(groupId,
                mode === 'until'
                    ? { untilDate: until, pattern }
                    : { addOccurrences: count, pattern });
            toast.success(`Добавлено ${ruCountWord(r.created, ['сессия', 'сессии', 'сессий'])}${r.totalCost ? ` (${formatGel(r.totalCost, { sign: true })})` : ''}`);
            setOpen(false);
            await onChanged();
        } catch (e: any) {
            const d = e?.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : (d?.message || 'Не удалось продлить серию'));
        } finally { setBusy(false); }
    };

    const PATTERNS: { id: 'weekly' | 'biweekly' | 'monthly'; label: string }[] = [
        { id: 'weekly', label: 'Еженед.' },
        { id: 'biweekly', label: 'Раз в 2 нед.' },
        { id: 'monthly', label: '4 нед.' },
    ];

    if (!open) {
        return (
            <div style={{ display: 'flex', gap: 8, margin: '8px 0 12px' }}>
                <button onClick={() => setOpen(true)} style={seriesBtnInk}>
                    + Продлить серию
                </button>
                <button onClick={onCancelSeries} style={seriesBtnGhost}>
                    Отменить серию
                </button>
            </div>
        );
    }

    return (
        <div style={{
            margin: '8px 0 14px', padding: 12, border: `1px solid ${GH.ink10}`,
            display: 'flex', flexDirection: 'column', gap: 10,
        }}>
            {/* Периодичность */}
            <div>
                <div style={{ ...ghmbMono, color: GH.ink60, marginBottom: 6 }}>ПЕРИОДИЧНОСТЬ</div>
                <div style={{ display: 'flex', gap: 6 }}>
                    {PATTERNS.map(p => (
                        <button key={p.id} onClick={() => setPattern(p.id)} style={{
                            ...seriesChip,
                            background: pattern === p.id ? GH.ink : 'transparent',
                            color: pattern === p.id ? GH.paper : GH.ink60,
                        }}>{p.label}</button>
                    ))}
                </div>
            </div>
            {/* Режим: число / до даты */}
            <div>
                <div style={{ ...ghmbMono, color: GH.ink60, marginBottom: 6 }}>СКОЛЬКО ДОБАВИТЬ</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {(['count', 'until'] as const).map(mo => (
                        <button key={mo} onClick={() => setMode(mo)} style={{
                            ...seriesChip,
                            background: mode === mo ? GH.ink : 'transparent',
                            color: mode === mo ? GH.paper : GH.ink60,
                        }}>{mo === 'count' ? 'По числу' : 'До даты'}</button>
                    ))}
                </div>
                {mode === 'count' ? (
                    <input type="number" min={1} max={52} value={count}
                        onChange={e => setCount(Math.max(1, Math.min(52, Number(e.target.value))))}
                        style={seriesInput} />
                ) : (
                    <input type="date" value={until} min={new Date().toISOString().slice(0, 10)}
                        onChange={e => setUntil(e.target.value)} style={seriesInput} />
                )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={submit} disabled={busy} style={{ ...seriesBtnInk, opacity: busy ? 0.6 : 1 }}>
                    {busy ? 'Добавляю…' : 'Добавить'}
                </button>
                <button onClick={() => setOpen(false)} style={seriesBtnGhost}>Отмена</button>
            </div>
        </div>
    );
}

const seriesBtnInk: React.CSSProperties = {
    padding: '8px 14px', background: GH.ink, color: GH.paper, border: 'none',
    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer',
};
const seriesBtnGhost: React.CSSProperties = {
    padding: '8px 14px', background: 'transparent', color: GH.ink60,
    border: `1px solid ${GH.ink10}`, fontFamily: GH_MONO, fontSize: 12,
    letterSpacing: '0.06em', cursor: 'pointer',
};
const seriesChip: React.CSSProperties = {
    padding: '6px 12px', border: `1px solid ${GH.ink10}`, fontFamily: GH_MONO,
    fontSize: 12, cursor: 'pointer',
};
const seriesInput: React.CSSProperties = {
    padding: '8px 10px', border: `1px solid ${GH.ink10}`, fontFamily: 'inherit',
    fontSize: 14, width: 160,
};

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
    seriesInfoMap,
    onSeriesChanged,
    highlightedSeriesId,
    clearHighlightedSeries,
}: {
    booking: BookingHistoryItem;
    crmClients: Array<{ id: string; name: string; aliasCode?: string }>;
    onCancel: (id: string) => void;
    onEdit: (booking: BookingHistoryItem) => void;
    onReRent: (id: string) => void;
    onBookAgain: (booking: BookingHistoryItem) => void;
    onLinkClient: (bookingId: string, clientId: string | null) => void;
    isPast?: boolean;
    // Series map is fetched once per page in MyBookingsPage and shared across
    // all cards. Earlier each card hit /recurring-groups on mount → 50 API
    // calls for a heavy specialist, tripping the rate limit.
    seriesInfoMap?: Map<string, { futureCount: number; lastDate: string | null; pattern: string }>;
    onSeriesChanged?: () => void;
    // Telegram series-end deep-link: when set, ALL cards of that group
    // render with a highlighted ring; the next-upcoming one (first in
    // DOM order with `data-series-anchor`) is the scroll anchor and
    // shows the action banner with Продлить / ОК.
    highlightedSeriesId?: string | null;
    clearHighlightedSeries?: () => void;
}) {
    const isHighlighted = !!highlightedSeriesId && booking.recurringGroupId === highlightedSeriesId;
    const [dismissing, setDismissing] = useState(false);
    const handleDismissSeriesReminder = async () => {
        if (!booking.recurringGroupId) return;
        setDismissing(true);
        try {
            await bookingsApi.dismissSeriesEndReminder(booking.recurringGroupId);
            toast.success('Серия завершится в срок — больше не напомним');
            clearHighlightedSeries?.();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось сохранить');
        } finally {
            setDismissing(false);
        }
    };
    // Больше суток до начала — по Батуми (UTC+4), тот же расчёт, что в
    // шахматке. Раньше тут не вычитали 4 ч, и в последние 4 ч суток клиент
    // видел обычный «Перенести» и молча тратил бесплатный перенос (ревью 01.10).
    const canMod = clientCanModifyBooking(booking);
    // Позже суток — бесплатный перенос абонемента (владелец 01.10).
    const cardSub = useUserStore(s => s.currentUser?.subscription);
    const lateLeft = booking.status === 'confirmed' && !canMod
        ? lateRescheduleLeft(cardSub, hoursUntilBookingStart(booking))
        : 0;

    const clientInfo = booking.crmClientId ? crmClients.find(c => c.id === booking.crmClientId) : null;

    // Pulled from the page-level Map (single source of truth). null when
    // the page hasn't fetched yet OR this booking isn't part of any
    // tracked series.
    const seriesInfo = booking.recurringGroupId
        ? (seriesInfoMap?.get(booking.recurringGroupId) ?? null)
        : null;
    const [extending, setExtending] = useState(false);
    // Продление серии: число встреч — полем в шторке, а не системным prompt().
    const [extendOpen, setExtendOpen] = useState(false);
    const [extendCount, setExtendCount] = useState('4');
    const [extendError, setExtendError] = useState<string | null>(null);

    const handleExtend = () => {
        if (!booking.recurringGroupId) return;
        setExtendCount('4');
        setExtendError(null);
        setExtendOpen(true);
    };

    const submitExtend = async () => {
        if (!booking.recurringGroupId) return;
        const n = parseInt(extendCount, 10);
        if (!Number.isFinite(n) || n < 1 || n > 52) {
            setExtendError('Введите число от 1 до 52');
            return;
        }
        setExtending(true);
        try {
            const res = await bookingsApi.extendRecurringSeries(booking.recurringGroupId, n);
            toast.success(`Серия продлена: +${res?.created ?? n}`);
            setExtendOpen(false);
            // Refresh the page-level map (one call) instead of refetching here.
            onSeriesChanged?.();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось продлить серию');
        } finally {
            setExtending(false);
        }
    };
    const extendN = parseInt(extendCount, 10);
    const extendSheet = (
        <Sheet
            open={extendOpen}
            onClose={() => { if (!extending) setExtendOpen(false); }}
            title="Продлить серию"
            description="Добавим встречи в тот же день недели и в то же время."
            width={420}
            footer={
                <>
                    <UiButton block loading={extending} onClick={submitExtend}>
                        {Number.isFinite(extendN) && extendN >= 1 && extendN <= 52
                            ? `Продлить на ${ruCountWord(extendN, ['встречу', 'встречи', 'встреч'])}`
                            : 'Продлить серию'}
                    </UiButton>
                    <UiButton variant="secondary" block disabled={extending} onClick={() => setExtendOpen(false)}>
                        Отмена
                    </UiButton>
                </>
            }
        >
            <Field label="Сколько встреч добавить" hint="От 1 до 52" error={extendError ?? undefined}>
                <Input
                    kind="integer"
                    value={extendCount}
                    onChange={e => { setExtendCount(e.target.value.replace(/\D/g, '')); setExtendError(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') submitExtend(); }}
                />
            </Field>
        </Sheet>
    );

    // ── Вид карточки (волна 2): строка Grid House вместо «стеклянной» Card ──
    // Слева — когда и где, чем оплачено; справа — статус и действия. Операции
    // (перенос, отмена, пересдача, продление) — те же обработчики, что были.
    const dayKey = String(booking.date ?? '').slice(0, 10);
    const endTime = booking.startTime ? minsToTime(timeToMins(booking.startTime) + (booking.duration || 0)) : null;
    const startAt = booking.startTime && /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? new Date(`${dayKey}T${booking.startTime}`) : null;
    const isUpcomingActive = !isPast && (booking.status === 'confirmed' || booking.status === 'pending_approval');
    const dayLabel = isUpcomingActive
        ? formatRelativeDay(dayKey, { fallback: safeFormat(booking.date, 'd MMMM', { locale: ru }) })
        : formatDateLabel(dayKey, { capitalize: true, withYear: 'auto', fallback: safeFormat(booking.date, 'd MMMM', { locale: ru }) });
    const startsIn = isUpcomingActive && startAt ? formatStartsIn(startAt) : '';
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const centerName = LOCATIONS.find(l => l.id === (resource?.locationId || booking.locationId))?.name
        || (booking.locationId === 'unbox_one' ? 'Unbox One' : 'Unbox Uni');
    const formatName = booking.format === 'individual' ? 'Индивидуально'
        : booking.format === 'intervision' ? 'Интервизия' : 'Группа';

    // Чем оплачено: «Бонус / Абонемент / С баланса» (было «Депозит 0 ₾» у бонусной брони — G3-14, X3-05).
    const hours = Number(booking.hoursDeducted) || (booking.duration || 0) / 60;
    const payment = booking.paymentMethod === 'bonus'
        ? { Icon: Gift, label: 'Бонус', value: fmtHoursShort(hours) }
        : booking.paymentMethod === 'subscription'
            ? { Icon: Ticket, label: 'Абонемент', value: Number(booking.finalPrice) > 0
                ? `${fmtHoursShort(hours)} + ${formatGel(booking.finalPrice)}` // пик/допуслуги с баланса
                : fmtHoursShort(hours) }
            : { Icon: Wallet, label: 'С баланса', value: formatGel(booking.finalPrice) };
    // payment_source='credit' ставится один раз при брони и не пересчитывается —
    // «в долг» только у будущей ещё не оплаченной брони (ревью денег 30.09).
    const inDebt = booking.paymentMethod !== 'bonus' && booking.paymentMethod !== 'subscription'
        && booking.paymentSource === 'credit' && !isPast
        && (booking.status === 'confirmed' || booking.status === 'pending_approval')
        && booking.paymentStatus === 'pending';

    const addToCalendar = () => {
        if (!startAt) return;
        const end = new Date(startAt.getTime() + booking.duration * 60000);
        const location = resource?.locationId === 'unbox_one' ? 'Unbox One, ул. Палиашвили 4, Батуми'
            : resource?.locationId === 'unbox_uni' ? 'Unbox Uni, ул. Тбел Абусеридзе 38, Батуми'
            : resource?.locationId === 'neo_school' ? 'Neo School, ул. Сулаберидзе 80, Батуми'
            : 'Unbox, Батуми';
        const userName = useUserStore.getState().currentUser?.name || '';
        window.open(generateGoogleCalendarUrl({
            title: `Unbox: ${resource?.name || 'Кабинет'}`,
            description: `${userName}\n${resource?.name || ''}, ${booking.duration} мин`,
            location,
            startTime: startAt,
            endTime: end,
        }), '_blank');
    };

    const isConfirmedUpcoming = booking.status === 'confirmed' && !isPast;

    return (
        <article
            className={clsx(
                'border bg-card',
                isHighlighted ? 'border-[var(--status-pending-fg)] ring-1 ring-[var(--status-pending-fg)]' : 'border-ink-10',
            )}
            aria-label={`${dayLabel}, ${booking.startTime ?? ''}, ${resource?.name || 'Кабинет'}`}
            data-series-anchor={isHighlighted ? booking.recurringGroupId : undefined}
        >
            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div className="min-w-0">
                    {/* Когда: день + время начала–конца (раньше «17:00 (1.5ч)») */}
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={clsx('text-title font-semibold', isPast ? 'text-ink-80' : 'text-ink')}>{dayLabel}</span>
                        <span className={clsx('num text-title font-semibold', isPast ? 'text-ink-80' : 'text-ink')}>
                            {booking.startTime}{endTime ? `–${endTime}` : ''}
                        </span>
                        {startsIn && startsIn !== 'идёт сейчас' && <span className="text-small text-ink-60">{startsIn}</span>}
                        {startsIn === 'идёт сейчас' && <span className="text-small font-medium text-accent-ink">идёт сейчас</span>}
                    </div>
                    {/* Где */}
                    <div className="mt-1 text-small text-ink-80">
                        {resource?.name || 'Кабинет'} · {centerName} · {formatName}
                    </div>
                    {/* Чем оплачено */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-80">
                        <payment.Icon size={16} className="text-ink-60 shrink-0" aria-hidden="true" />
                        <span>{payment.label}</span>
                        <span className="num font-medium text-ink">· {payment.value}</span>
                        {inDebt && <span className="text-[var(--status-danger-fg)]">· в долг</span>}
                        {isConfirmedUpcoming && booking.paymentStatus === 'pending' && booking.paymentMethod !== 'bonus' && (
                            <span className="text-ink-60">· спишем за сутки до начала</span>
                        )}
                    </div>
                    {clientInfo && (
                        <div className="mt-1 flex items-center gap-1 text-small text-accent-ink">
                            <UserIcon size={14} aria-hidden="true" /> {clientInfo.aliasCode ? `${clientInfo.aliasCode} · ${clientInfo.name}` : clientInfo.name}
                        </div>
                    )}
                    {booking.extras.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {booking.extras.map((extraId: string) => {
                                const extra = EXTRAS.find(e => e.id === extraId);
                                return extra ? (
                                    <span key={extraId} className="rounded-lg border border-ink-10 bg-sunken px-2 py-0.5 text-caption text-ink-80">
                                        + {extra.name}
                                    </span>
                                ) : null;
                            })}
                        </div>
                    )}

                    {/* Recurring-series strip — visible whenever this booking is part
                        of a series. Tells the user "this is recurring", how many slots
                        are still booked ahead, when the last one is, and offers a
                        Продлить button so they can extend before the tail runs out
                        (Anna's exact ask). */}
                    {booking.recurringGroupId && booking.status === 'confirmed' && !isPast && seriesInfo && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-10 pt-3 text-small text-ink-60">
                            <Repeat size={14} aria-hidden="true" className="shrink-0" />
                            <span>
                                Постоянная бронь · впереди&nbsp;
                                <span className="num font-medium text-ink">{seriesInfo.futureCount}</span>
                                {seriesInfo.lastDate && (
                                    <>
                                        {' · до '}
                                        <span className="font-medium text-ink">
                                            {formatDayMonth(seriesInfo.lastDate, { withYear: 'auto', fallback: '—' })}
                                        </span>
                                    </>
                                )}
                            </span>
                            {canMod && (
                                <UiButton variant="quiet" size="touch" onClick={handleExtend} disabled={extending} className="ml-auto">
                                    {extending ? 'Продлеваем…' : 'Продлить серию'}
                                </UiButton>
                            )}
                        </div>
                    )}

                    {/* Series-end deep-link banner — shown only when this card matches
                        the ?series=<group_id> param from the Telegram reminder. Gives
                        the user a clear choice: продлить или ОК (завершится в срок). */}
                    {isHighlighted && booking.recurringGroupId && booking.status === 'confirmed' && !isPast && (
                        <div className="mt-3 p-3 bg-[var(--status-pending-bg)]">
                            <div className="mb-1 flex items-center gap-1.5 text-small font-semibold text-[var(--status-pending-fg)]">
                                <Repeat size={14} aria-hidden="true" /> Серия подходит к концу
                            </div>
                            <div className="mb-2 text-small text-[var(--status-pending-fg)]">
                                Продлить или пусть завершится в срок?
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {canMod && (
                                    <UiButton size="touch" onClick={handleExtend} loading={extending}>
                                        Продлить серию
                                    </UiButton>
                                )}
                                <UiButton variant="secondary" size="touch" onClick={handleDismissSeriesReminder} loading={dismissing}>
                                    Пусть завершится
                                </UiButton>
                            </div>
                        </div>
                    )}

                    {booking.status === 'pending_approval' && !isPast && (
                        <p className="mt-3 text-small text-ink-80">
                            До начала меньше 12 часов — бронь подтверждает администратор. Пришлём уведомление, как только он ответит.
                        </p>
                    )}

                    {/* < 24 ч: отменить нельзя (так решает сервер) — одно правило
                        на компьютере и на телефоне (X3-21). */}
                    {isConfirmedUpcoming && !canMod && !booking.isReRentListed && (
                        <p className="mt-3 text-small text-ink-80">
                            До начала меньше 24 часов — отменить уже нельзя. Можно пересдать время: если его займёт другой специалист, вернём 50&nbsp;%. Или{' '}
                            <a href="https://t.me/UnboxCenter" target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">
                                напишите администратору
                            </a>.
                        </p>
                    )}
                    {/* Код двери и Wi-Fi — за сутки до встречи, когда они нужны. */}
                    {isConfirmedUpcoming && !canMod && !booking.isReRentListed && (
                        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-small">
                            <span className="inline-flex items-center gap-1.5 text-ink-60">
                                <Key size={14} aria-hidden="true" /> Код двери
                                <span className="num font-semibold text-ink">
                                    {booking.locationId === 'unbox_uni' ? '7777#'
                                        : booking.locationId === 'unbox_one' ? '0408#'
                                        : booking.locationId === 'neo_school' ? '1122#'
                                        : '—'}
                                </span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-ink-60">
                                <Wifi size={14} aria-hidden="true" /> Wi-Fi
                                <span className="num font-semibold text-ink">unboxyourself</span>
                            </span>
                        </div>
                    )}

                    {(() => {
                        // Show the «Пересдана» badge when:
                        //  • old status='re-rented' rows (legacy), OR
                        //  • status='cancelled' + cancellation_reason flags it as
                        //    auto-cancelled-due-to-rerent (current backend path).
                        const reason = (booking as any).cancellationReason || '';
                        const isAutoRerent = booking.status === 'cancelled'
                            // Сервер пишет причину по-старому (re-rent / «переаренд…») — ищем все слова.
                            && /re-rent|переаренд|пересда/i.test(reason);
                        if (booking.status !== 're-rented' && !isAutoRerent) return null;

                        // Refund amount: parse from reason string ("· 18.00GEL"),
                        // fall back to half of finalPrice if missing.
                        const m = /([0-9]+(?:\.[0-9]+)?)\s*GEL/i.exec(reason);
                        const refunded = m ? parseFloat(m[1]) : (booking.finalPrice || 0) * 0.5;
                        return (
                            <div className="mt-3 inline-flex flex-wrap items-center gap-2 bg-[var(--status-ok-bg)] px-3 py-1.5 text-small text-[var(--status-ok-fg)]">
                                <Repeat size={14} aria-hidden="true" />
                                <span className="font-semibold">Бронь пересдана</span>
                                <span>· вернули 50 % · <span className="num font-semibold">{formatGel(refunded, { sign: true })}</span></span>
                            </div>
                        );
                    })()}

                    {/* Дата создания брони — внизу, мелко: её путали с датой встречи. */}
                    <div className="mt-3 text-caption text-ink-60">
                        Бронь создана {safeFormat(booking.createdAt, 'd MMM yyyy, HH:mm', { locale: ru })}
                    </div>
                </div>

                {/* Справа: статус и действия */}
                <div className="flex flex-col gap-2 md:items-end md:min-w-[200px]">
                    {/* Статус — слова и цвета из общего словаря (statuses.ts). */}
                    {booking.status === 'confirmed' && booking.isReRentListed
                        ? <ReRentListedBadge className="shrink-0 self-start md:self-end" />
                        : <StatusBadge kind="booking" status={booking.status} className="shrink-0 self-start md:self-end" />}

                    {isConfirmedUpcoming && !booking.isReRentListed && (
                        <div className="flex flex-wrap gap-2 md:justify-end">
                            {canMod ? (
                                <>
                                    <UiButton variant="secondary" size="touch" onClick={() => onEdit(booking)}>
                                        Перенести
                                    </UiButton>
                                    <UiButton variant="quiet" size="touch" className="text-[var(--status-danger-fg)]" onClick={() => onCancel(booking.id)}>
                                        Отменить
                                    </UiButton>
                                </>
                            ) : (
                                <>
                                    {lateLeft > 0 && (
                                        <UiButton variant="secondary" size="touch" onClick={() => onEdit(booking)}>
                                            {lateRescheduleLabel(lateLeft)}
                                        </UiButton>
                                    )}
                                    <UiButton variant="secondary" size="touch" icon={<Repeat size={16} aria-hidden="true" />} onClick={() => onReRent(booking.id)}>
                                        Пересдать
                                    </UiButton>
                                </>
                            )}
                        </div>
                    )}
                    {isConfirmedUpcoming && (
                        <UiButton variant="quiet" size="touch" icon={<CalendarIcon size={16} aria-hidden="true" />} onClick={addToCalendar}>
                            В календарь
                        </UiButton>
                    )}
                    {(booking.status === 'completed' || booking.status === 'cancelled') && (
                        <UiButton variant="secondary" size="touch" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={() => onBookAgain(booking)}>
                            Забронировать снова
                        </UiButton>
                    )}
                </div>
            </div>
            {extendSheet}
        </article>
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
    const { currentUser, bookings } = useUserStore();
    const resource = RESOURCES.find(r => r.id === slot.resId);

    // Conflict dialog state — populated when a booking attempt hits an
    // occupied slot. Replaces the bare red toast (2026-05-22 spec).
    const [conflict, setConflict] = useState<ConflictItem[] | null>(null);

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
    // Extras section is now OPEN by default. Was collapsed earlier on the
    // assumption "most therapy sessions don't need add-ons", but admins kept
    // reporting that users couldn't find allowed extras (sandbox, projector,
    // couch, coffee) — the small "Доп. опции ▾" caret was easy to miss right
    // after slot pick. With only 4 short cards the visual noise is minimal,
    // and choosing-by-default beats a hidden option.
    const [extrasOpen, setExtrasOpen] = useState(true);
    // Recurring controls — off by default; opens periodicity inputs when on.
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurringPattern, setRecurringPattern] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
    const [recurringMode, setRecurringMode] = useState<'count' | 'until'>('count');
    const [recurringOccurrences, setRecurringOccurrences] = useState(8);
    const [recurringUntil, setRecurringUntil] = useState<string>(
        format(addDays(slot.date, 60), 'yyyy-MM-dd'),
    );
    const dateStr = format(slot.date, 'yyyy-MM-dd');

    /** Extras list — same prices as the public catalogue.
     *  The earlier `CRM_EXTRAS_PRICES` override was for an old discounting
     *  scheme that never went live; it pointed at extras IDs that no longer
     *  appear in the public list (flipchart) and missed the new ones (couch,
     *  coffee_meama). Just trusting EXTRAS keeps the spec UI in sync with
     *  whatever pricing the public-facing /checkout shows. */
    const crmExtras = EXTRAS;

    // Часы абонемента — основной пул + доп. (часы капсулы / «4 ч индивидуально»),
    // как в мастере брони и на сервере: иначе кнопка «абонементом» гасла бы у
    // клиента, у которого остались только капсульные часы.
    const hasSubscription = !!currentUser?.subscription?.planId
        && ((currentUser?.subscription?.remainingHours ?? 0) > 0
            || (extraPool(currentUser?.subscription)?.remaining ?? 0) > 0);

    const startDate = useMemo(() => {
        const [h, m] = slot.time.split(':').map(Number);
        return setMinutes(setHours(slot.date, h), m);
    }, [slot.date, slot.time]);
    const endDate = useMemo(() => addMinutes(startDate, duration), [startDate, duration]);
    const endTime = format(endDate, 'HH:mm');

    // Price preview — uses the same calculator as the main booking wizard.
    // Pass `crmExtras` (discounted variants) so the displayed total uses
    // the specialist pricing, not the public catalogue.
    const pricing = useMemo(() => {
        try {
            return calculatePrice({
                format: chosenFormat,
                startTime: startDate,
                endTime: endDate,
                extras: crmExtras.filter(e => chosenExtras.includes(e.id)),
                resourceId: slot.resId,
                paymentMethod: useSubscription ? 'subscription' : 'balance',
                personalDiscountPercent: currentUser?.personalDiscountPercent,
                pricingSystem: (currentUser as any)?.pricingSystem,
            });
        } catch {
            return null;
        }
    }, [chosenFormat, startDate, endDate, chosenExtras, slot.resId, useSubscription, currentUser, crmExtras]);

    /** When "Сделать регулярным" is on, walk the pattern interval to
     *  count occurrences (until-date mode) or just use the entered N
     *  (count mode). Capped to the same maxima as the public widget. */
    const effectiveOccurrences = useMemo(() => {
        if (!isRecurring) return 1;
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
    }, [isRecurring, recurringMode, recurringPattern, recurringOccurrences, recurringUntil, slot.date]);

    const hoursForSub = duration / 60;
    const subHours = useMemo(() => subscriptionHours(currentUser?.subscription, {
        format: chosenFormat,
        bookingDate: slot.date,
        bookings,
        ownerEmail: currentUser?.email,
        resourceKind: resourceKind(slot.resId),
        // Новая бронь снимает паузу абонемента, если пойдёт его часами (владелец 03.10).
        liftPause: true,
    }), [currentUser, chosenFormat, slot.date, slot.resId, bookings]);
    const enoughHoursOnSub = hasSubscription && subHours.ok && subHours.remaining >= hoursForSub - 0.01;

    const handleBook = async (resourceIdOverride?: string) => {
        const bookResId = resourceIdOverride || slot.resId;
        const bookResource = RESOURCES.find(r => r.id === bookResId) || resource;
        setSaving(true);
        try {
            if (isRecurring && effectiveOccurrences > 1) {
                // Recurring path — backend creates N bookings under one
                // recurring_group_id, GCal-syncs each, returns the created
                // count. Linking to the existing CRM session happens for
                // the FIRST booking only (the rest become standalone
                // sessions that the specialist can attach manually if
                // needed).
                const result = await bookingsApi.createRecurringBooking({
                    resourceId: bookResId,
                    locationId: bookResource?.locationId || 'unbox_one',
                    startTime: slot.time,
                    duration,
                    format: chosenFormat,
                    paymentMethod: useSubscription && enoughHoursOnSub ? 'subscription' : 'balance',
                    firstDate: dateStr,
                    occurrences: effectiveOccurrences,
                    pattern: recurringPattern,
                    crmClientId: crmMode.clientId,
                });
                if (crmMode.sessionId && result.bookingIds && result.bookingIds.length > 0) {
                    await updateSession(crmMode.sessionId, {
                        bookingId: result.bookingIds[0],
                        isBooked: true,
                    });
                }
                toast.success(`Серия из ${result.created} броней создана для ${crmMode.clientName}`);
                onBooked();
                return;
            }

            const booking = await bookingsApi.createBooking({
                resourceId: bookResId,
                date: dateStr, // Send as string 'YYYY-MM-DD' to avoid timezone shift
                startTime: slot.time,
                duration,
                format: chosenFormat,
                extras: chosenExtras,
                locationId: bookResource?.locationId,
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
            const status = e?.response?.status;
            const detail = e?.response?.data?.detail;
            // Conflict (409 / occupied-slot) → branded dialog with alternatives.
            // Two response shapes: recurring → {message, conflicts:[{date,reason}]};
            // single → a plain string reason.
            if (detail && typeof detail === 'object' && Array.isArray(detail.conflicts)) {
                setConflict(detail.conflicts.map((c: any) => ({
                    date: c.date,
                    reason: c.reason || detail.message || 'Слот занят',
                })));
                return;
            }
            if (typeof detail === 'string'
                && (status === 409 || /занят|уже есть бронь/i.test(detail))) {
                setConflict([{ date: dateStr, reason: detail }]);
                return;
            }
            const msg = typeof detail === 'string' ? detail
                : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(', ')
                    : e.message || 'Ошибка бронирования';
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    const fmtLabel = (f: Format) =>
        f === 'individual' ? 'Индивид.' : f === 'group' ? 'Группа' : 'Интервизия';

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/45 p-4" onClick={onClose}>
            <div
                className="bg-card rounded-none shadow-2xl w-full max-w-sm p-5 space-y-4 animate-in slide-in-from-bottom-4 duration-200 max-h-[92vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="font-bold text-lg">Забронировать кабинет</h3>
                        <p className="text-sm text-ink-60 mt-0.5">для сессии с <span className="font-medium text-ink">{crmMode.clientName}</span></p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-ink-05 rounded-lg">
                        <X className="w-5 h-5 text-ink-60" />
                    </button>
                </div>

                <div className="bg-sunken rounded-lg p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                        <span className="text-ink-60">Кабинет</span>
                        <span className="font-medium">{resource?.name || slot.resId}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-ink-60">Дата</span>
                        <span className="font-medium">{format(slot.date, 'd MMMM yyyy', { locale: ru })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-ink-60">Время</span>
                        <span className="font-medium">{slot.time} — {endTime}</span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-ink-60 mb-1.5 block">Длительность</label>
                    <div className="flex gap-2">
                        {/* 50-min option removed — was confusing alongside the
                            standard 60/90/120 set. Therapy sessions that need
                            50 min still use the SessionEditPanel dropdown which
                            keeps the full range (30/45/50/60/90/120). */}
                        {[60, 90, 120].map(d => (
                            <button
                                key={d}
                                onClick={() => setDuration(d)}
                                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                    duration === d
                                        ? 'bg-accent text-on-accent border-accent'
                                        : 'bg-card border-ink-10 text-ink-60 hover:border-accent'
                                }`}
                            >
                                {d === 120 ? '2ч' : `${d}м`}
                            </button>
                        ))}
                    </div>
                </div>

                {availableFormats.length > 1 && (
                    <div>
                        <label className="text-xs font-medium text-ink-60 mb-1.5 block">Формат</label>
                        <div className="flex gap-2">
                            {availableFormats.map(f => (
                                <button
                                    key={f}
                                    onClick={() => setChosenFormat(f)}
                                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                        chosenFormat === f
                                            ? 'bg-accent text-on-accent border-accent'
                                            : 'bg-card border-ink-10 text-ink-60 hover:border-accent'
                                    }`}
                                >
                                    {fmtLabel(f)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {crmExtras.length > 0 && (
                    <div>
                        <button
                            type="button"
                            onClick={() => setExtrasOpen(o => !o)}
                            className="w-full flex items-center justify-between text-xs font-medium text-ink-60 mb-1.5 hover:text-ink transition-colors"
                        >
                            <span>
                                Дополнительные услуги
                                {chosenExtras.length > 0 && (
                                    <span className="ml-1.5 text-accent-ink">· {chosenExtras.length} выбрано</span>
                                )}
                            </span>
                            <span style={{ display: 'inline-block', transition: 'transform 120ms', transform: extrasOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                        </button>
                        {extrasOpen && (
                        <div className="grid grid-cols-2 gap-2">
                            {crmExtras.map(e => {
                                const active = chosenExtras.includes(e.id);
                                return (
                                    <button
                                        key={e.id}
                                        onClick={() => setChosenExtras(prev =>
                                            active ? prev.filter(id => id !== e.id) : [...prev, e.id]
                                        )}
                                        className={`px-2.5 py-2 rounded-lg text-xs font-medium border text-left transition-colors ${
                                            active
                                                ? 'bg-accent text-on-accent border-accent'
                                                : 'bg-card border-ink-10 text-ink-60 hover:border-accent'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="truncate">{e.name}</span>
                                            <span className={`text-caption shrink-0 ${active ? 'text-on-accent' : e.price === 0 ? 'text-accent-ink' : 'text-ink-60'}`}>
                                                {e.price === 0 ? 'бесплатно' : formatGel(e.price, { sign: true })}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        )}
                    </div>
                )}

                {/* Recurring toggle — appears in CRM-from-session mode only.
                    On: shows pattern + count/until. Submitting fires
                    bookingsApi.createRecurringBooking; the first booking
                    of the series is back-linked to the originating
                    session, the rest stand on their own. */}
                <div className="border border-ink-10 rounded-lg p-3 space-y-2.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isRecurring}
                            onChange={e => setIsRecurring(e.target.checked)}
                            className="accent-accent"
                        />
                        <span className="text-sm font-medium text-ink">
                            Сделать регулярным бронированием
                        </span>
                    </label>
                    {isRecurring && (
                        <div className="space-y-2 pl-6">
                            <div className="flex gap-1.5">
                                {([
                                    { id: 'weekly' as const, label: 'Кажд. нед.' },
                                    { id: 'biweekly' as const, label: '2 нед.' },
                                    { id: 'monthly' as const, label: '4 нед.' },
                                ]).map(p => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setRecurringPattern(p.id)}
                                        className={`flex-1 py-1.5 rounded-lg text-caption font-medium border transition-colors ${
                                            recurringPattern === p.id
                                                ? 'bg-accent text-on-accent border-accent'
                                                : 'bg-card border-ink-10 text-ink-60 hover:border-accent'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-1.5">
                                {([
                                    { id: 'count' as const, label: 'По числу' },
                                    { id: 'until' as const, label: 'До даты' },
                                ]).map(m => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setRecurringMode(m.id)}
                                        className={`flex-1 py-1 rounded-lg text-caption font-medium border transition-colors ${
                                            recurringMode === m.id
                                                ? 'bg-ink text-on-accent border-ink'
                                                : 'bg-card border-ink-10 text-ink-60 hover:border-ink-40'
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
                                        className="w-16 px-2 py-1.5 rounded-lg border border-ink-10 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
                                    />
                                    <span className="text-xs text-ink-60">повторений</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        value={recurringUntil}
                                        min={dateStr}
                                        onChange={e => setRecurringUntil(e.target.value)}
                                        className="px-2 py-1.5 rounded-lg border border-ink-10 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                                    />
                                    <span className="text-xs text-ink-60">≈ {effectiveOccurrences} {effectiveOccurrences === 1 ? 'бронь' : 'броней'}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {hasSubscription && (
                    <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                        useSubscription && enoughHoursOnSub
                            ? 'bg-sunken border-accent'
                            : 'bg-card border-ink-10 hover:border-accent'
                    } ${!enoughHoursOnSub ? 'opacity-60' : ''}`}>
                        <input
                            type="checkbox"
                            checked={useSubscription && enoughHoursOnSub}
                            onChange={(e) => setUseSubscription(e.target.checked)}
                            disabled={!enoughHoursOnSub}
                            className="mt-0.5 accent-accent"
                        />
                        <div className="flex-1 text-sm">
                            <div className="font-medium text-ink">Списать из абонемента</div>
                            <div className="text-xs text-ink-60 mt-0.5">
                                {enoughHoursOnSub
                                    ? `Осталось ${currentUser?.subscription?.remainingHours ?? 0} ч · спишется ${hoursForSub} ч`
                                    : subHours.ok
                                        ? `Недостаточно часов (нужно ${hoursForSub} ч, осталось ${currentUser?.subscription?.remainingHours ?? 0} ч)`
                                        : subHours.reason
                                }
                            </div>
                            {enoughHoursOnSub && subHours.paused && (
                                <div className="text-xs text-[var(--status-info-fg)] mt-0.5">{PAUSE_LIFT_NOTE}</div>
                            )}
                        </div>
                    </label>
                )}

                {pricing && (
                    <div className="bg-sunken rounded-lg p-3 space-y-1 text-sm">
                        <div className="flex justify-between text-ink-60">
                            <span>Кабинет ({duration} мин, {fmtLabel(chosenFormat)})</span>
                            <span>{formatGel(pricing.basePrice)}</span>
                        </div>
                        {pricing.extrasPrice > 0 && (
                            <div className="flex justify-between text-ink-60">
                                <span>Доп. опции</span>
                                <span>{formatGel(pricing.extrasPrice, { sign: true })}</span>
                            </div>
                        )}
                        {pricing.discountAmount > 0 && (
                            <div className="flex justify-between text-accent-ink">
                                <span>Скидка</span>
                                <span>−{formatGel(pricing.discountAmount)}</span>
                            </div>
                        )}
                        {pricing.peakSlotCount > 0 && !useSubscription && (
                            <div className="text-caption text-[var(--status-pending-fg)] flex items-center gap-1"><Clock size={12} aria-hidden="true" /> Вечерний тариф применён</div>
                        )}
                        <div className="flex justify-between font-bold text-ink pt-1.5 border-t border-ink-10">
                            <span>Итого</span>
                            <span>
                                {useSubscription && enoughHoursOnSub
                                    ? <>{hoursForSub} ч из абонемента{pricing.subscriptionPeakDebt > 0 ? ` + ${formatGel(pricing.subscriptionPeakDebt)} за вечер` : ''}</>
                                    : formatGel(pricing.finalPrice)
                                }
                            </span>
                        </div>
                    </div>
                )}

                <button
                    onClick={() => handleBook()}
                    disabled={saving}
                    className="w-full py-3 bg-accent text-on-accent font-medium rounded-lg hover:bg-ink-80 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {isRecurring && effectiveOccurrences > 1
                        ? `Создать серию · ${effectiveOccurrences} броней`
                        : 'Забронировать'}
                </button>
            </div>

            {conflict && (
                <BookingConflictDialog
                    conflicts={conflict}
                    resourceId={slot.resId}
                    time={slot.time}
                    duration={duration}
                    ownBookings={bookings}
                    onClose={() => setConflict(null)}
                    onOpenBooking={() => {
                        // The conflicting booking lives in "Мои брони" on this
                        // same page — close the modals so the user sees it.
                        setConflict(null);
                        onClose();
                        toast.info('Откройте бронь в списке «Мои брони» ниже');
                    }}
                    onPickCabinet={(altResId) => {
                        setConflict(null);
                        handleBook(altResId);
                    }}
                />
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Grid House — MyBookingsPage
   ═══════════════════════════════════════════════════════════════ */

const ghmbMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const };

interface GridHouseMyBookingsProps {
    viewMode: 'list' | 'grid' | 'series';
    setViewMode: (v: 'list' | 'grid' | 'series') => void;
    userBookings: BookingHistoryItem[];
    bookings: BookingHistoryItem[];
    upcomingBookings: BookingHistoryItem[];
    pastBookings: BookingHistoryItem[];
    /** Отменённые брони на будущие даты — не «прошедшие» (G3-client-desktop-M3). */
    cancelledUpcoming: BookingHistoryItem[];
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
    seriesInfoMap: Map<string, { futureCount: number; lastDate: string | null; pattern: string }>;
    refreshSeriesInfo: () => void;
    highlightedSeriesId: string | null;
    clearHighlightedSeries: () => void;
}

/** Абонемент одной строкой — на вкладках «Шахматка» и «Серии» (G3-13):
 *  полная карточка там отодвигала сетку на пол-экрана. */
function SubscriptionStrip({ sub, onOpen }: { sub: any; onOpen: () => void }) {
    const total = (sub.totalHours || 0) + (sub.bonusHours || 0);
    const until = sub.expiryDate ? formatDayMonth(parseISO(sub.expiryDate), { withYear: 'auto' }) : null;
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-ink-10 bg-card px-4 py-2 text-small">
            <Ticket size={16} className="text-ink-60" aria-hidden="true" />
            <span className="text-ink">
                Абонемент «{sub.name}»: <span className="num font-semibold">{fmtHoursShort(sub.remainingHours)}</span> из <span className="num">{fmtHoursShort(total)}</span>
                {extraPoolLabel(sub) && <> · {extraPoolLabel(sub)}</>}
                {until && <> · до {until}</>}
                {sub.isFrozen && <> · на паузе</>}
            </span>
            <button type="button" onClick={onOpen} className="ml-auto min-h-11 px-2 font-medium text-ink underline underline-offset-2">
                Подробнее
            </button>
        </div>
    );
}

const fmtHoursShort = (h: number) =>
    `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(h) || 0)} ч`;

function GridHouseMyBookings({
    viewMode, setViewMode, userBookings, bookings, upcomingBookings, pastBookings, cancelledUpcoming,
    handleEdit, handleCancel, handleReRent, handleCancelReRent,
    handleBookAgain, handleLinkClient, currentUser, usersMap,
    publicBookings, refreshBookings, crmMode, setCrmMode,
    crmClients, modalConfig, setModalConfig, mobileLocFilter, setMobileLocFilter,
    navigate, location, seriesInfoMap, refreshSeriesInfo,
    highlightedSeriesId, clearHighlightedSeries,
}: GridHouseMyBookingsProps) {
    const totalBookings = upcomingBookings.length + pastBookings.length + cancelledUpcoming.length;
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    // Широкий экран: брони слева, абонемент справа (G3-13) — брони первым экраном.
    const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1180);
    useEffect(() => {
        const check = () => { setIsMobile(window.innerWidth < 768); setIsWide(window.innerWidth >= 1180); };
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);
    // Бронировать сервер даёт только специалистам и админам (require_can_book).
    // Остальным — карточка с анкетой сразу, а не отказ на кнопке «Оплатить».
    const canBook = canBookCabinets(currentUser);
    const applicationStatus = useSpecialistApplicationStatus(currentUser, !!currentUser && !canBook);
    const [pastLimit, setPastLimit] = useState(10);

    const cardProps = {
        onEdit: handleEdit, onCancel: handleCancel, onReRent: handleReRent,
        onBookAgain: handleBookAgain, onLinkClient: handleLinkClient, crmClients,
        seriesInfoMap, onSeriesChanged: refreshSeriesInfo, clearHighlightedSeries,
    };

    const TABS: { id: 'list' | 'grid' | 'series'; label: string }[] = [
        { id: 'list', label: 'Список' },
        { id: 'grid', label: 'Шахматка' },
        // «Серии» — постоянные брони, сгруппированные по серии.
        { id: 'series', label: 'Серии' },
    ];

    const sectionTitle = (text: string, count?: number) => (
        <h2 className="flex items-baseline gap-2 text-title font-semibold text-ink mb-3">
            {text}
            {count !== undefined && <span className="num text-small font-normal text-ink-60">{count}</span>}
        </h2>
    );

    const listContent = (
        <div className="min-w-0">
            {/* Предстоящие — включая брони «Ждём подтверждения» (G3-02). */}
            {upcomingBookings.length > 0 && (
                <section className="mb-8" aria-label="Предстоящие брони">
                    {sectionTitle('Предстоящие', upcomingBookings.length)}
                    <div className="flex flex-col gap-3">
                        {upcomingBookings.map(b => (
                            <BookingCard
                                key={b.id} booking={b} {...cardProps}
                                highlightedSeriesId={highlightedSeriesId}
                            />
                        ))}
                    </div>
                </section>
            )}
            {totalBookings === 0 && (canBook ? (
                <EmptyState
                    title="Пока нет броней"
                    hint="Выберите время в «Шахматке» — свободные часы видно сразу по всем кабинетам."
                    action={{
                        label: 'Забронировать кабинет',
                        onClick: () => setViewMode('grid'),
                    }}
                />
            ) : (
                <EmptyState
                    title="Пока нет броней"
                    hint="Бронирование откроется после проверки анкеты специалиста."
                />
            ))}
            {upcomingBookings.length === 0 && totalBookings > 0 && (
                <div className="mb-8">
                    <EmptyState
                        compact
                        title="Предстоящих броней нет"
                        hint={canBook ? 'Выберите время в «Шахматке».' : 'Бронирование откроется после проверки анкеты.'}
                        action={canBook ? { label: 'Забронировать кабинет', onClick: () => setViewMode('grid') } : undefined}
                    />
                </div>
            )}
            {/* Отменённые будущие — отдельно и свёрнуто: это не «прошедшие». */}
            {cancelledUpcoming.length > 0 && (
                <details className="mb-8 border-t border-ink-10 pt-3 group">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-title font-semibold text-ink">
                        Отменённые
                        <span className="num text-small font-normal text-ink-60">{cancelledUpcoming.length}</span>
                        <span className="ml-auto text-small font-normal text-ink-60 group-open:hidden">Показать</span>
                        <span className="ml-auto hidden text-small font-normal text-ink-60 group-open:inline">Скрыть</span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">
                        {cancelledUpcoming.map(b => (
                            <BookingCard key={b.id} booking={b} {...cardProps} isPast highlightedSeriesId={null} />
                        ))}
                    </div>
                </details>
            )}
            {pastBookings.length > 0 && (
                <section aria-label="Прошедшие брони">
                    {sectionTitle('Прошедшие', pastBookings.length)}
                    <div className="flex flex-col gap-3">
                        {pastBookings.slice(0, pastLimit).map(b => (
                            <BookingCard key={b.id} booking={b} {...cardProps} isPast highlightedSeriesId={null} />
                        ))}
                    </div>
                    {pastBookings.length > pastLimit && (
                        <div className="mt-4">
                            <UiButton variant="secondary" size="touch" onClick={() => setPastLimit(n => n + 20)}>
                                Показать ещё {Math.min(20, pastBookings.length - pastLimit)}
                            </UiButton>
                        </div>
                    )}
                </section>
            )}
        </div>
    );

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, paddingBottom: 80 }}>
            {/* Шапка: заголовок, счётчик и одна главная кнопка. Полосы промо-кнопок
                («Оформить абонемент», «Скидки и бонусы»…) здесь больше нет — они в
                меню кабинета, а брони поднялись на первый экран (G3-13). */}
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-10 pb-4 mb-0">
                <div>
                    <h1 className="text-heading font-semibold text-ink m-0">Мои брони</h1>
                    <p className="mt-1 text-small text-ink-60">
                        {upcomingBookings.length > 0
                            ? `Предстоящих: ${upcomingBookings.length}`
                            : 'Предстоящих броней нет'}
                    </p>
                </div>
                {viewMode === 'list' && canBook && (
                    <UiButton size="touch" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setViewMode('grid')}>
                        Забронировать кабинет
                    </UiButton>
                )}
            </header>

            {/* Вкладки */}
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-10" role="tablist" aria-label="Вид броней">
                {TABS.map(t => {
                    const active = viewMode === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setViewMode(t.id)}
                            className={clsx(
                                'min-h-11 px-4 -mb-px border-b-2 text-small font-medium transition-colors',
                                active ? 'border-ink text-ink' : 'border-transparent text-ink-60 hover:text-ink',
                            )}
                        >
                            {t.label}
                        </button>
                    );
                })}
                {viewMode === 'grid' && (
                    // Раньше тут был ряд chip-кнопок «Все / Unbox One / Unbox Uni /
                    // Neo School», который не влезал в ширину мобильного экрана —
                    // правый край обрезался. На мобильном собираем всё в один
                    // dropdown (по умолчанию «Все филиалы»), на десктопе оставляем
                    // chip-ряд — там места хватает.
                    <div className="ml-auto flex items-center gap-1 pb-1" role="group" aria-label="Центр">
                        {isMobile ? (
                            <select
                                value={mobileLocFilter}
                                onChange={(e) => setMobileLocFilter(e.target.value)}
                                aria-label="Центр"
                                className="min-h-11 max-w-[160px] rounded-lg border border-ink-20 bg-card px-2 text-small text-ink"
                            >
                                <option value="all">Все центры</option>
                                {LOCATIONS.map(loc => (
                                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                                ))}
                            </select>
                        ) : (
                            [{ id: 'all', name: 'Все центры' }, ...LOCATIONS].map(loc => {
                                const on = mobileLocFilter === loc.id;
                                return (
                                    <button
                                        key={loc.id}
                                        type="button"
                                        aria-pressed={on}
                                        onClick={() => setMobileLocFilter(loc.id)}
                                        className={clsx(
                                            'min-h-11 px-3 rounded-lg border text-small font-medium transition-colors',
                                            on ? 'border-ink bg-ink text-on-accent' : 'border-ink-10 text-ink-80 hover:border-ink-40',
                                        )}
                                    >
                                        {loc.name}
                                    </button>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* Ещё не специалист — объясняем до выбора слота в шахматке. */}
            {currentUser && !canBook && (
                <div className="pt-4">
                    <SpecialistGateCard variant="desktop" status={applicationStatus} />
                </div>
            )}

            {/* Абонемент: на «Шахматке» и «Серии» — одной строкой. */}
            {currentUser?.subscription && viewMode !== 'list' && (
                <div className="pt-4">
                    <SubscriptionStrip sub={currentUser.subscription} onOpen={() => setViewMode('list')} />
                </div>
            )}

            {/* Content */}
            {viewMode === 'series' ? (
                <SeriesView
                    bookings={userBookings}
                    seriesInfoMap={seriesInfoMap}
                    onSeriesChanged={refreshSeriesInfo}
                    onEdit={handleEdit}
                    onCancel={handleCancel}
                    onReRent={handleReRent}
                    onBookAgain={handleBookAgain}
                    onLinkClient={handleLinkClient}
                    crmClients={crmClients}
                />
            ) : viewMode === 'grid' ? (
                <div className="pt-4">
                    {crmMode && (
                        <div className="mb-3 flex flex-wrap items-center gap-2 border border-accent bg-accent-soft px-4 py-1 text-small">
                            {/* X2-14 (волна 3): дорога обратно в CRM — назад по истории
                                (фильтр «Сессий» сохранится), а если открыли по ссылке —
                                на «Сессии». */}
                            <button
                                type="button"
                                onClick={() => {
                                    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
                                    if (idx > 0) navigate(-1);
                                    else navigate('/crm/sessions', { replace: true });
                                }}
                                className="inline-flex h-11 items-center gap-1 pr-2 font-medium text-accent-ink hover:text-ink"
                            >
                                <ArrowLeft size={16} aria-hidden="true" />
                                Вернуться в CRM
                            </button>
                            <span className="h-5 w-px bg-ink-20" aria-hidden="true" />
                            <CalendarIcon size={16} className="text-accent-ink" aria-hidden="true" />
                            <span>Выберите время для сессии с <b>{crmMode.clientName}</b></span>
                            <button
                                type="button"
                                onClick={() => setCrmMode(null)}
                                aria-label="Выйти из режима брони под сессию"
                                className="ml-auto flex h-11 w-11 items-center justify-center text-ink-60 hover:text-ink"
                            >
                                <X size={16} aria-hidden="true" />
                            </button>
                        </div>
                    )}
                    <BookingsChessboard
                        canCreate={canBook}
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
                <div
                    className="pt-6"
                    style={isWide && currentUser?.subscription
                        ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 32, alignItems: 'start' }
                        : undefined}
                >
                    {listContent}
                    {currentUser?.subscription && (
                        <aside
                            aria-label="Абонемент"
                            className={isWide ? 'sticky top-24' : 'mt-8'}
                        >
                            <SubscriptionCard user={currentUser} />
                        </aside>
                    )}
                </div>
            )}

            {/* Подтверждение отмены / пересдачи — общая шторка вместо самодельного
                окна. Кнопки называют действие; «Оставить» — второе. */}
            <Sheet
                open={!!modalConfig.isOpen}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                title={modalConfig.title || ''}
                width={440}
                layer="dialog"
                role="alertdialog"
                footer={
                    <>
                        <UiButton
                            block
                            variant={modalConfig.isDestructive ? 'danger' : 'primary'}
                            onClick={() => { modalConfig.onConfirm(); setModalConfig({ ...modalConfig, isOpen: false }); }}
                        >
                            {modalConfig.confirmLabel || 'Подтвердить'}
                        </UiButton>
                        <UiButton block variant="secondary" onClick={() => setModalConfig({ ...modalConfig, isOpen: false })}>
                            {modalConfig.isDestructive ? 'Оставить бронь' : 'Не сейчас'}
                        </UiButton>
                    </>
                }
            >
                <div className="text-small text-ink-80">{modalConfig.message}</div>
            </Sheet>
        </div>
    );
}
