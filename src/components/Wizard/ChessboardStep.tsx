import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { WaitlistSubscribeModal } from '../ui/WaitlistSubscribeModal';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { format, addMinutes, setHours, setMinutes, startOfToday, isBefore, isSameDay, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, AlertTriangle, Clock, X } from 'lucide-react';
import { googleCalendarService } from '../../services/googleCalendarMock';
import type { ExternalEvent } from '../../services/googleCalendarMock';
import { isPeakTime } from '../../utils/pricing';
import { PRICING_CONFIG } from '../../utils/pricingConfig';
import { getMyBookingsPath } from '../../utils/userPaths';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { COLOR, STATUS } from '../../design/tokens';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBar } from '../ui/ErrorBar';
import { useConfirmDialog } from '../ui/ConfirmDialogProvider';
import { formatDateLabel, formatDayMonthShort, formatGel } from '../../utils/format';

// Hook to detect mobile viewport
function useIsMobile(breakpoint = 768) {
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < breakpoint);
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < breakpoint);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, [breakpoint]);
    return isMobile;
}

/** «30 мин», «1 ч», «1,5 ч». */
function formatDurationMin(mins: number): string {
    if (mins < 60) return `${mins} мин`;
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(mins / 60)} ч`;
}

/** Доплата за пиковый час — из конфига цен (только подпись, расчёт не здесь). */
const PEAK_SURCHARGE = PRICING_CONFIG.peak_hours.surcharge_per_hour_gel;
/** «Занято» — штриховка поверх тёплого фона; «прошло» — ровный серый (sunken). */
const BUSY_BG = `repeating-linear-gradient(135deg, ${COLOR.ink10} 0 1px, transparent 1px 6px), ${GH.cellDead}`;

export function ChessboardStep({ embedded = false }: { embedded?: boolean }) {
    const {
        locationId, date, setDate, format: bookingFormat, groupSize, setFormat,
        selectedSlots,
        setStep,
        highlightedResourceId, setHighlightedResourceId,
        pendingAddResourceId,
    } = useBookingStore();

    const { bookings, fetchBookings, fetchAllBookings, currentUser } = useUserStore();
    const bookingForUser = useBookingStore(s => s.bookingForUser);
    const isAdminBooking = !!bookingForUser && !!currentUser?.isAdmin;
    // Admin / senior_admin / owner may book right up to the slot start (no 30-min buffer)
    const isPrivileged = currentUser?.isAdmin
        || currentUser?.role === 'admin'
        || currentUser?.role === 'senior_admin'
        || currentUser?.role === 'owner';
    const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
    const [isLoadingBookings, setIsLoadingBookings] = useState(true);
    const isMobile = useIsMobile();
    const navigate = useNavigate();

    // «Назад» с сетки — туда, откуда пришли (страница кабинета, «Мои брони»).
    // Раньше шёл setStep(1), а шаг 1 — это редирект на главную: клиент терял
    // выбор и оказывался на лендинге (G3-11). Выбор времени остаётся в сторе.
    const goBack = () => {
        setHighlightedResourceId(null);
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else navigate(currentUser ? getMyBookingsPath(currentUser) : '/', { replace: true });
    };

    // Прошедшее время (и то, что начнётся раньше, чем его можно забронировать) —
    // не «занято»: его не занять и на него не подписаться. Только для вида,
    // клавиатуры и окна «следить»; правила брони — в isSlotBlocked (не трогаем).
    const isSlotClosed = (timeStr: string) => {
        const slotDate = new Date(date);
        const [h, m] = timeStr.split(':').map(Number);
        slotDate.setHours(h, m, 0, 0);
        return isBefore(slotDate, addMinutes(new Date(), isPrivileged ? 0 : 30));
    };

    // Refresh bookings on mount — admin sees ALL bookings, users see only their own
    const reloadBookings = () => {
        setIsLoadingBookings(true);
        const fetchFn = isAdminBooking ? fetchAllBookings : fetchBookings;
        return fetchFn().finally(() => setIsLoadingBookings(false));
    };
    useEffect(() => {
        reloadBookings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchBookings, fetchAllBookings, isAdminBooking]);
    // Занятость не загрузилась → занятое время выглядит свободным. Не молчим
    // (wave 1: загрузка ≠ ошибка ≠ пусто), а говорим и даём повторить.
    const occupancyStatus = useUserStore(s => s.occupancyStatus);
    const occupancyFailed = !isAdminBooking && occupancyStatus === 'error';

    // Week View State
    const [weekStart, setWeekStart] = useState(() => startOfWeek(date, { weekStartsOn: 1 }));

    // Waitlist State
    const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
    const [waitlistData, setWaitlistData] = useState<{ resourceId: string; time: string } | null>(null);

    // Sync weekStart when date changes externally
    useEffect(() => {
        setWeekStart(startOfWeek(date, { weekStartsOn: 1 }));
    }, [date]);

    const weekDays = useMemo(() => {
        return eachDayOfInterval({
            start: weekStart,
            end: endOfWeek(weekStart, { weekStartsOn: 1 })
        });
    }, [weekStart]);

    const handlePrevWeek = () => {
        const newStart = subWeeks(weekStart, 1);
        setWeekStart(newStart);
        setDate(newStart); // auto-select Monday of new week
    };
    const handleNextWeek = () => {
        const newStart = addWeeks(weekStart, 1);
        setWeekStart(newStart);
        setDate(newStart); // auto-select Monday of new week
    };

    // Toggle for View Mode (Specific Location vs All)
    // Auto-show all locations when no location is selected (e.g. admin booking from client card)
    const [showAllLocations, setShowAllLocations] = useState(!locationId);

    // Reusable: apply format + group size filters to a resource list
    const applyFormatSizeFilter = (list: typeof RESOURCES) => {
        let res = list;
        if (bookingFormat) {
            res = res.filter(r => r.formats?.includes(bookingFormat));
        }
        if ((bookingFormat === 'group' || bookingFormat === 'intervision') && groupSize) {
            let minCapacity = 0;
            if (groupSize === '4-8') minCapacity = 8;
            else if (groupSize === '8-14') minCapacity = 14;
            else if (groupSize === '14-20') minCapacity = 20;
            else if (groupSize === '20-30') minCapacity = 30;
            else if (groupSize === '30+') minCapacity = 31;
            res = res.filter(r => r.capacity >= minCapacity);
        }
        return res;
    };

    // Active-only pool — owner 2026-05-27: cabinets / locations toggled off
    // in the admin panel must NEVER appear in the booking grid, even if the
    // static data list still has them. Treat `isActive: undefined` as
    // active (legacy rows without the flag set).
    const activeResources = useMemo(
        () => RESOURCES.filter(r => r.isActive !== false),
        [],
    );

    // Auto-expand to all locations when current location has no matching cabinets
    // (e.g. group/intervision is only available in Unbox Uni — rooms 7/8/9)
    const [autoExpanded, setAutoExpanded] = useState(false);
    useEffect(() => {
        if (!locationId || showAllLocations) { setAutoExpanded(false); return; }
        const inLocation = activeResources.filter(r => r.locationId === locationId);
        const matchInLocation = applyFormatSizeFilter(inLocation);
        if (matchInLocation.length === 0) {
            const globalMatch = applyFormatSizeFilter(activeResources);
            if (globalMatch.length > 0) {
                setShowAllLocations(true);
                setAutoExpanded(true);
            }
        } else {
            setAutoExpanded(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locationId, bookingFormat, groupSize, activeResources]);

    // 1. Get Resources
    const resources = useMemo(() => {
        const inLocation = (showAllLocations || !locationId)
            ? activeResources
            : activeResources.filter(r => r.locationId === locationId);
        return applyFormatSizeFilter(inLocation);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locationId, showAllLocations, bookingFormat, groupSize, activeResources]);

    // 2. Fetch External Events from Google Calendar (real pull, 5-min cached)
    useEffect(() => {
        let cancelled = false;
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const fromISO = new Date(dayStart); fromISO.setDate(fromISO.getDate() - 1);
        const toISO = new Date(dayStart); toISO.setDate(toISO.getDate() + 2);
        Promise.all(
            resources.map(r =>
                googleCalendarService.fetchEvents(r.id, fromISO.toISOString(), toISO.toISOString())
            )
        ).then(results => {
            if (cancelled) return;
            setExternalEvents(results.flat());
        });
        return () => { cancelled = true; };
    }, [resources, date]);

    // 3. Generate Time Slots (09:00 – 22:00).
    // Evening 21:00–22:00 carries the peak-hour surcharge automatically
    // via PRICING_CONFIG.peak_hours, no extra wiring needed.
    const timeSlots = useMemo(() => {
        const slots = [];
        let time = setMinutes(setHours(startOfToday(), 9), 0);
        const end = setMinutes(setHours(startOfToday(), 22), 0);

        while (isBefore(time, end)) {
            slots.push(format(time, 'HH:mm'));
            time = addMinutes(time, 30);
        }
        return slots;
    }, []);

    // Helper: parse backend date string as UTC (backend stores UTC without 'Z')
    const parseUTC = (d: string | Date) => {
        const s = String(d);
        return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
    };

    // 4. Helper: Is slot blocked?
    const isSlotBlocked = (resId: string, timeStr: string) => {
        const slotDate = new Date(date);
        const [h, m] = timeStr.split(':').map(Number);
        slotDate.setHours(h, m, 0, 0);

        // CHECK: Booking buffer — regular users can't book slots starting within 30 min;
        // admin/senior_admin/owner can book up to slot start (and even up to 12h in the past via AdminChessboardView).
        const bufferMinutes = isPrivileged ? 0 : 30;
        if (isBefore(slotDate, addMinutes(new Date(), bufferMinutes))) {
            return true;
        }

        // Check Internal Bookings
        const internalBooking = bookings.find(b =>
            b.resourceId === resId &&
            b.status === 'confirmed' &&
            !b.isReRentListed &&
            isSameDay(parseUTC(b.date), new Date(date)) &&
            b.startTime &&
            (() => {
                const bookingStart = Number(b.startTime.split(':')[0]) * 60 + Number(b.startTime.split(':')[1]);
                const bookingEnd = bookingStart + b.duration;
                const slotStart = Number(timeStr.split(':')[0]) * 60 + Number(timeStr.split(':')[1]);
                const slotEnd = slotStart + 30; // Assuming 0.5h granularity for the check

                // Strictly overlap: (StartA < EndB) and (EndA > StartB)
                return slotStart < bookingEnd && slotEnd > bookingStart;
            })()
        );

        if (internalBooking) return true;

        // Check External Events
        const externalEvent = externalEvents.find(e => {
            if (e.resourceId !== resId) return false;
            const eventStart = new Date(e.start);
            const eventEnd = new Date(e.end);

            if (!isSameDay(eventStart, new Date(date))) return false;

            const eventStartMins = eventStart.getHours() * 60 + eventStart.getMinutes();
            const eventEndMins = eventEnd.getHours() * 60 + eventEnd.getMinutes();

            const slotStart = Number(timeStr.split(':')[0]) * 60 + Number(timeStr.split(':')[1]);
            const slotEnd = slotStart + 30;

            return slotStart < eventEndMins && slotEnd > eventStartMins;
        });

        if (externalEvent) {
            // Check re-rent override logic...
            const isCoveredByReRent = bookings.some(b =>
                b.resourceId === resId &&
                b.status === 'confirmed' &&
                b.isReRentListed &&
                isSameDay(parseUTC(b.date), new Date(date)) &&
                b.startTime &&
                (() => {
                    const bookingStart = Number(b.startTime.split(':')[0]) * 60 + Number(b.startTime.split(':')[1]);
                    const bookingEnd = bookingStart + b.duration;
                    const slotStart = Number(timeStr.split(':')[0]) * 60 + Number(timeStr.split(':')[1]);
                    return slotStart >= bookingStart && slotStart < bookingEnd;
                })()
            );

            if (isCoveredByReRent) {
                return false;
            }
            return true;
        }

        return false;
    };

    // Get the booker name/email for a blocked slot (admin only)
    const getSlotBookerInfo = (resId: string, timeStr: string): string | null => {
        if (!isAdminBooking) return null;
        const booking = bookings.find(b =>
            b.resourceId === resId &&
            b.status === 'confirmed' &&
            !b.isReRentListed &&
            isSameDay(parseUTC(b.date), new Date(date)) &&
            b.startTime &&
            (() => {
                const bStart = Number(b.startTime!.split(':')[0]) * 60 + Number(b.startTime!.split(':')[1]);
                const bEnd = bStart + b.duration;
                const slotStart = Number(timeStr.split(':')[0]) * 60 + Number(timeStr.split(':')[1]);
                const slotEnd = slotStart + 30;
                return slotStart < bEnd && slotEnd > bStart;
            })()
        );
        if (!booking) return null;
        // Return short name: first name or email prefix
        const userId = booking.userId || '';
        if (userId.includes('@')) return userId.split('@')[0];
        return userId;
    };

    const isSelected = (resId: string, timeStr: string) => selectedSlots.includes(`${resId}|${timeStr}`);

    // Build CONTIGUOUS chunks per resource so each independent period in the
    // same resource (e.g. cab8: 12:30-13:30 AND 14:30-15:30) is its own
    // block — separate × button, separate resize handles, no cross-talk.
    const selectedBlocks = useMemo(() => {
        const byResource: Record<string, number[]> = {};
        for (const slot of selectedSlots) {
            const [resId, timeStr] = slot.split('|');
            const idx = timeSlots.indexOf(timeStr);
            if (idx === -1) continue;
            (byResource[resId] ||= []).push(idx);
        }
        const blocks: { resId: string; start: number; end: number }[] = [];
        for (const [resId, raw] of Object.entries(byResource)) {
            const sorted = [...raw].sort((a, b) => a - b);
            let cur: number[] = [];
            for (const i of sorted) {
                if (cur.length === 0 || i === cur[cur.length - 1] + 1) cur.push(i);
                else { blocks.push({ resId, start: cur[0], end: cur[cur.length - 1] }); cur = [i]; }
            }
            if (cur.length) blocks.push({ resId, start: cur[0], end: cur[cur.length - 1] });
        }
        return blocks;
    }, [selectedSlots, timeSlots]);

    /** Find the chunk for a (resource, time-index) pair. Used by the cell
     *  renderer to know "is this slot the start/end of its block?" */
    const getBlockAt = (resId: string, idx: number) =>
        selectedBlocks.find(b => b.resId === resId && idx >= b.start && idx <= b.end) ?? null;
    /** Legacy helper — first block of a resource. Only safe for resize ops
     *  that should target the chunk containing the dragged slot. */
    const getBlockForResource = (resId: string) => selectedBlocks.find(b => b.resId === resId) ?? null;

    // Overlap detection: two blocks overlap if any time slot appears in both
    const hasTimeOverlap = useMemo(() => {
        if (selectedBlocks.length < 2) return false;
        const blocks = selectedBlocks.map(b => {
            const slots = new Set<number>();
            for (let i = b.start; i <= b.end; i++) slots.add(i);
            return slots;
        });
        for (let i = 0; i < blocks.length; i++) {
            for (let j = i + 1; j < blocks.length; j++) {
                for (const idx of blocks[i]) {
                    if (blocks[j].has(idx)) return true;
                }
            }
        }
        return false;
    }, [selectedBlocks]);

    // Пересечение по времени подтверждаем общим окном (wave 1): кнопки
    // называют действие вместо «Да, продолжить».
    const { confirm } = useConfirmDialog();

    // Drag / Interaction State — using refs to avoid stale closures during fast pointer events
    type DragMode = 'new' | 'move' | 'resize-start' | 'resize-end' | null;
    const dragModeRef = useRef<DragMode>(null);
    const dragStartSlotRef = useRef<{ resId: string, timeStr: string } | null>(null);
    const dragInitialBlockRef = useRef<{ resId: string, start: number, end: number } | null>(null);
    // Snapshot of ALL selected slots at the moment drag starts — base for move calculations
    const dragInitialSlotsRef = useRef<string[]>([]);
    // Keep a single React state just to trigger re-renders during drag
    const [, setDragTick] = useState(0);
    const forceDragUpdate = () => setDragTick(t => t + 1);
    const [hoverSlot, setHoverSlot] = useState<{ resId: string, timeStr: string } | null>(null);

    const handlePointerDown = (resId: string, timeStr: string, mode: DragMode) => {
        if (isSlotBlocked(resId, timeStr) && mode === 'new') {
            setWaitlistData({ resourceId: resId, time: timeStr });
            setIsWaitlistOpen(true);
            return;
        }

        dragModeRef.current = mode;
        dragStartSlotRef.current = { resId, timeStr };
        // Snapshot ALL current slots at drag start — will be used as base for move diff
        dragInitialSlotsRef.current = [...useBookingStore.getState().selectedSlots];

        if (mode === 'new') {
            // Excel #24 — toggle behaviour for single clicks. Clicking on a
            // slot already in the cart removes it; clicking on a free slot
            // adds it. Drag-extends still adds via handlePointerEnter.
            const slotId = `${resId}|${timeStr}`;
            const store = useBookingStore.getState();
            if (store.selectedSlots.includes(slotId)) {
                store.replaceSlots(store.selectedSlots.filter(s => s !== slotId));
            } else {
                store.addSlotRange(resId, [timeStr]);
            }
        } else {
            // For move/resize, find the chunk that actually contains the
            // dragged slot — not just the first chunk in this resource.
            // Otherwise a resize on the second period would silently
            // reshape the first one.
            const idx = timeSlots.indexOf(timeStr);
            const block = getBlockAt(resId, idx) ?? getBlockForResource(resId);
            if (block) dragInitialBlockRef.current = block;
        }
        forceDragUpdate();
    };

    const handlePointerEnter = (resId: string, timeStr: string) => {
        setHoverSlot({ resId, timeStr });

        const dragMode = dragModeRef.current;
        const dragStartSlot = dragStartSlotRef.current;
        const dragInitialBlock = dragInitialBlockRef.current;

        if (!dragMode || !dragStartSlot) return;

        const setSlotRange = useBookingStore.getState().setSlotRange;
        const currentIdx = timeSlots.indexOf(timeStr);
        const startIdx = timeSlots.indexOf(dragStartSlot.timeStr);
        if (currentIdx === -1 || startIdx === -1) return;

        if (dragMode === 'new') {
            if (dragStartSlot.resId !== resId) return;

            const minIdx = Math.min(startIdx, currentIdx);
            const maxIdx = Math.max(startIdx, currentIdx);

            const newSlots: string[] = [];
            let hasBlocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotBlocked(resId, timeSlots[i])) {
                    hasBlocked = true;
                    break;
                }
                newSlots.push(timeSlots[i]);
            }

            if (!hasBlocked) {
                // Excel #24 — multi-period in one resource works natively now.
                // Every drag adds to the cart instead of replacing the
                // resource's selection. Effects:
                //   • Drag 10:00-12:00 in cab 5 → выделено
                //   • Drag 15:00-16:00 in cab 5 → ДОБАВЛЕНО (raньше сбрасывало)
                //   • Drag 14:00-15:00 in cab 7 → ДОБАВЛЕНО (multi-resource)
                // Removal: click on a selected slot toggles it off (handled
                // separately below in handleSlotClick).
                const addSlotRange = useBookingStore.getState().addSlotRange;
                const storeState = useBookingStore.getState();
                if (
                    storeState.pendingAddResourceId === resId &&
                    storeState.preservedResourceSlots.length > 0
                ) {
                    // Legacy "+ Ещё период" path from Summary — still supported,
                    // merges the preserved earlier range with the new drag.
                    const preservedTimes = storeState.preservedResourceSlots
                        .map(s => s.split('|')[1])
                        .filter(Boolean);
                    const merged = Array.from(new Set<string>([...preservedTimes, ...newSlots]));
                    setSlotRange(resId, merged);
                } else {
                    addSlotRange(resId, newSlots);
                }
            }
        }
        else if (dragMode === 'resize-end' && dragInitialBlock) {
            if (dragInitialBlock.resId !== resId) return;
            const minIdx = dragInitialBlock.start;
            const maxIdx = Math.max(minIdx, currentIdx);

            const newSlots: string[] = [];
            let hasBlocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotBlocked(resId, timeSlots[i])) { hasBlocked = true; break; }
                newSlots.push(timeSlots[i]);
            }
            // Replace ONLY the resized chunk's slots — keep other periods in
            // the same resource intact. Without this, resizing the second
            // period in cab8 would silently delete the first.
            if (!hasBlocked) {
                const oldChunkIds = new Set<string>();
                for (let i = dragInitialBlock.start; i <= dragInitialBlock.end; i++) {
                    oldChunkIds.add(`${resId}|${timeSlots[i]}`);
                }
                const survivors = useBookingStore.getState().selectedSlots.filter(s => !oldChunkIds.has(s));
                const newIds = newSlots.map(t => `${resId}|${t}`);
                useBookingStore.getState().replaceSlots([...survivors, ...newIds]);
            }
        }
        else if (dragMode === 'resize-start' && dragInitialBlock) {
            if (dragInitialBlock.resId !== resId) return;
            const maxIdx = dragInitialBlock.end;
            const minIdx = Math.min(maxIdx, currentIdx);

            const newSlots: string[] = [];
            let hasBlocked = false;
            for (let i = minIdx; i <= maxIdx; i++) {
                if (isSlotBlocked(resId, timeSlots[i])) { hasBlocked = true; break; }
                newSlots.push(timeSlots[i]);
            }
            if (!hasBlocked) {
                const oldChunkIds = new Set<string>();
                for (let i = dragInitialBlock.start; i <= dragInitialBlock.end; i++) {
                    oldChunkIds.add(`${resId}|${timeSlots[i]}`);
                }
                const survivors = useBookingStore.getState().selectedSlots.filter(s => !oldChunkIds.has(s));
                const newIds = newSlots.map(t => `${resId}|${t}`);
                useBookingStore.getState().replaceSlots([...survivors, ...newIds]);
            }
        }
        else if (dragMode === 'move' && dragInitialBlock) {
            const offset = currentIdx - startIdx;
            const newStart = dragInitialBlock.start + offset;
            const newEnd = dragInitialBlock.end + offset;

            if (newStart < 0 || newEnd >= timeSlots.length) return;

            const newSlots: string[] = [];
            let hasBlocked = false;
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotBlocked(resId, timeSlots[i])) { hasBlocked = true; break; }
                newSlots.push(timeSlots[i]);
            }
            if (!hasBlocked) {
                // Use the SNAPSHOT from drag start as base — never the live state.
                // This prevents accumulation of intermediate rows when dragging across resources.
                const otherSlots = dragInitialSlotsRef.current.filter(
                    s => !s.startsWith(`${dragInitialBlock.resId}|`)
                );
                const newSlotIds = newSlots.map(t => `${resId}|${t}`);
                useBookingStore.getState().replaceSlots([...otherSlots, ...newSlotIds]);
            }
        }
    };

    const handlePointerUp = () => {
        if (!dragModeRef.current) return;
        dragModeRef.current = null;
        dragStartSlotRef.current = null;
        dragInitialBlockRef.current = null;
        dragInitialSlotsRef.current = [];
        forceDragUpdate();

        // Excel #24 — "+ Ещё период" mode is one-shot: once the drag that
        // follows the click lands, we clear the pending state so the next
        // drag is a normal "replace resource" drag again.
        const stateAfterDrag = useBookingStore.getState();
        if (stateAfterDrag.pendingAddResourceId) {
            stateAfterDrag.clearAddMore();
        }

        // Min 1h logic Enforcement on release
        const state = useBookingStore.getState();
        if (state.selectedSlots.length === 1) {
            const [resId, timeStr] = state.selectedSlots[0].split('|');
            const [h, m] = timeStr.split(':').map(Number);
            const currentSlotDate = setMinutes(setHours(new Date(date), h), m);
            const nextSlotTime = format(addMinutes(currentSlotDate, 30), 'HH:mm');
            if (timeSlots.includes(nextSlotTime) && !isSlotBlocked(resId, nextSlotTime)) {
                state.toggleSlot(resId, nextSlotTime);
            }
        }
    };

    // Global listener for pointer up & move (for mobile touch drag)
    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (!dragModeRef.current) return;
            // Native pointerenter doesn't fire on sibling elements during touch drag
            if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                const target = document.elementFromPoint(e.clientX, e.clientY);
                if (!target) return;
                const slotEl = target.closest('[data-resid][data-time]');
                if (slotEl) {
                    const rId = slotEl.getAttribute('data-resid');
                    const tStr = slotEl.getAttribute('data-time');
                    if (rId && tStr && (hoverSlot?.resId !== rId || hoverSlot?.timeStr !== tStr)) {
                        handlePointerEnter(rId, tStr);
                    }
                }
            }
        };

        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointermove', handlePointerMove);
        return () => {
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointermove', handlePointerMove);
        };
    }, [selectedSlots, hoverSlot]);




    // ── Клавиатура (G3-10, X4-10) ──
    // Ячейка — role="button". В порядке Tab — одна ячейка (roving tabindex):
    // выбранная, а если выбора нет — первая, которую ещё можно забронировать.
    // Стрелки ходят по сетке, Home/End — к началу/концу дня, Enter/пробел —
    // то же, что клик мышью (выбор идёт через те же handlePointerDown/Up).
    const [focusKey, setFocusKey] = useState<string | null>(null);
    const tabStopKey = useMemo(() => {
        if (focusKey && resources.some(r => focusKey.startsWith(`${r.id}|`))) return focusKey;
        if (selectedSlots[0]) return selectedSlots[0];
        const first = resources[0];
        if (!first) return null;
        const t = timeSlots.find(ts => !isSlotClosed(ts)) ?? timeSlots[timeSlots.length - 1];
        return `${first.id}|${t}`;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusKey, resources, selectedSlots, timeSlots, date]);

    const removeBlock = (blk: { resId: string; start: number; end: number }) => {
        const idsToRemove = new Set<string>();
        for (let i = blk.start; i <= blk.end; i++) {
            idsToRemove.add(`${blk.resId}|${timeSlots[i]}`);
        }
        useBookingStore.getState().replaceSlots(
            useBookingStore.getState().selectedSlots.filter(s => !idsToRemove.has(s))
        );
    };

    const activateCell = (resId: string, timeStr: string) => {
        if (isSlotClosed(timeStr) && !isSelected(resId, timeStr)) return;
        if (isSelected(resId, timeStr)) {
            // Как «×» у периода: убираем весь период, куда входит ячейка.
            const blk = getBlockAt(resId, timeSlots.indexOf(timeStr));
            if (blk) removeBlock(blk);
            return;
        }
        // Тот же путь, что клик мышью: нажали и отпустили.
        handlePointerDown(resId, timeStr, 'new');
        handlePointerUp();
    };

    const focusCell = (resId: string, timeStr: string) => {
        const el = document.querySelector<HTMLElement>(`[data-resid="${resId}"][data-time="${timeStr}"]`);
        if (!el) return;
        el.focus();
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    const handleCellKeyDown = (e: React.KeyboardEvent, resId: string, timeStr: string) => {
        const ri = resources.findIndex(r => r.id === resId);
        const ti = timeSlots.indexOf(timeStr);
        let nr = ri;
        let nt = ti;
        switch (e.key) {
            case 'ArrowRight': nt = Math.min(timeSlots.length - 1, ti + 1); break;
            case 'ArrowLeft': nt = Math.max(0, ti - 1); break;
            case 'ArrowDown': nr = Math.min(resources.length - 1, ri + 1); break;
            case 'ArrowUp': nr = Math.max(0, ri - 1); break;
            case 'Home': nt = 0; break;
            case 'End': nt = timeSlots.length - 1; break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                activateCell(resId, timeStr);
                return;
            default:
                return;
        }
        e.preventDefault();
        e.stopPropagation();
        const target = resources[nr];
        if (target) focusCell(target.id, timeSlots[nt]);
    };

    const getPrice = (resId: string) => {
        const resource = resources.find(r => r.id === resId);
        if (!resource) return '';
        const isCapsule = resource.type === 'capsule';
        const rate = isCapsule ? 10 : (
            bookingFormat === 'group' ? 35 :
            bookingFormat === 'intervision' ? 30 : 20
        );
        return formatGel(rate);
    };

    // Пока открыто окно «Кабинеты пересекаются» — «Далее» заблокирована:
    // повторный тап открывал второе окно поверх первого.
    const [nextPending, setNextPending] = useState(false);
    const nextDisabled = selectedSlots.length === 0 || nextPending;
    const handleNext = async () => {
        if (nextPending) return;
        if (hasTimeOverlap) {
            setNextPending(true);
            try {
                const ok = await confirm({
                    title: 'Кабинеты пересекаются по времени',
                    body: 'Вы выбрали несколько кабинетов на одно и то же время — значит, будете занимать их одновременно.',
                    confirmLabel: 'Продолжить с пересечением',
                    cancelLabel: 'Изменить выбор',
                });
                if (ok) setStep(3);
            } finally {
                setNextPending(false);
            }
        } else {
            setStep(3);
        }
    };

    // ── Mobile: resource selector state ──
    const [mobileResourceIdx, setMobileResourceIdx] = useState(0);
    const mobileResource = resources[mobileResourceIdx] || resources[0];

    // Mobile: tap handler — hour tap selects pair (XX:00+XX:30), can extend further
    const handleMobileTap = (resId: string, timeStr: string, _isHourTap: boolean) => {
        if (isSlotBlocked(resId, timeStr)) {
            setWaitlistData({ resourceId: resId, time: timeStr });
            setIsWaitlistOpen(true);
            return;
        }

        const slotId = `${resId}|${timeStr}`;
        const currentBlock = getBlockForResource(resId);
        const slotIdx = timeSlots.indexOf(timeStr);
        const setSlotRange = useBookingStore.getState().setSlotRange;

        if (selectedSlots.includes(slotId)) {
            setSlotRange(resId, []);
            return;
        }

        if (currentBlock) {
            // Extending existing block — always +1 slot at a time
            const newStart = Math.min(currentBlock.start, slotIdx);
            const newEnd = Math.max(currentBlock.end, slotIdx);
            const slots: string[] = [];
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotBlocked(resId, timeSlots[i])) return;
                slots.push(timeSlots[i]);
            }
            setSlotRange(resId, slots);
        } else {
            // First selection — ALWAYS auto-select pair (1h minimum)
            const pairStart = slotIdx % 2 === 0 ? slotIdx : slotIdx - 1;
            const pairEnd = pairStart + 1;
            if (pairEnd >= timeSlots.length) return;
            const slots: string[] = [];
            for (let i = pairStart; i <= pairEnd; i++) {
                if (isSlotBlocked(resId, timeSlots[i])) return;
                slots.push(timeSlots[i]);
            }
            setSlotRange(resId, slots);
        }
    };

    // Group timeSlots into hour-pairs for mobile 2-column grid
    const mobileHourPairs = useMemo(() => {
        const pairs: [string, string | null][] = [];
        for (let i = 0; i < timeSlots.length; i += 2) {
            pairs.push([timeSlots[i], timeSlots[i + 1] ?? null]);
        }
        return pairs;
    }, [timeSlots]);

    // ── MOBILE VIEW ──
    if (isMobile) {
        const mobileBlock = mobileResource ? getBlockForResource(mobileResource.id) : null;
        const mobileBlockStart = mobileBlock ? timeSlots[mobileBlock.start] : null;
        const mobileBlockEnd = mobileBlock ? (() => {
            const [h, m] = timeSlots[mobileBlock.end].split(':').map(Number);
            return format(addMinutes(setMinutes(setHours(startOfToday(), h), m), 30), 'HH:mm');
        })() : null;
        const mobileBlockDuration = mobileBlock ? (mobileBlock.end - mobileBlock.start + 1) * 30 : 0;

        return (
            <div style={{ paddingBottom: 128, padding: '16px 12px 128px', fontFamily: GH_SANS, position: 'relative' as const }}>
                {/* Loading overlay while bookings are being fetched */}
                {isLoadingBookings && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: `${COLOR.paper}E6` }}>
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-2 border-ink-20 border-t-ink rounded-full animate-spin" />
                            <span style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink60 }}>Загружаем расписание…</span>
                        </div>
                    </div>
                )}
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: GH.ink, margin: 0 }}>Выберите время</h2>
                        <p style={{ fontSize: 13, color: GH.ink60, fontFamily: GH_MONO, marginTop: 4 }}>
                            {formatDateLabel(date, { capitalize: true, withYear: 'auto' })}
                        </p>
                    </div>
                    <Button variant="secondary" size="touch" onClick={goBack} aria-label="Назад" icon={<ArrowLeft size={18} aria-hidden="true" />} />
                </div>

                {/* Format switcher — mobile segmented control */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 0,
                    marginBottom: 12,
                    border: `1px solid ${GH.ink10}`,
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: GH.card,
                }}>
                    {([
                        { key: 'individual', label: 'Индивидуально', price: '20' },
                        { key: 'group', label: 'Группа', price: '35' },
                        { key: 'intervision', label: 'Интервизия', price: '30' },
                    ] as const).map((opt, i) => {
                        const active = bookingFormat === opt.key;
                        return (
                            <button
                                key={opt.key}
                                onClick={() => setFormat(opt.key)}
                                style={{
                                    padding: '10px 8px',
                                    fontFamily: GH_SANS,
                                    fontSize: 12,
                                    fontWeight: active ? 600 : 500,
                                    background: active ? GH.ink : 'transparent',
                                    color: active ? COLOR.onInk : GH.ink,
                                    border: 'none',
                                    borderLeft: i > 0 ? `1px solid ${GH.ink10}` : 'none',
                                    cursor: 'pointer',
                                    transition: 'background 150ms, color 150ms',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: 2,
                                }}
                            >
                                <span>{opt.label}</span>
                                <span className="num" style={{ fontSize: 12, color: active ? COLOR.onInk : GH.ink60, fontFamily: GH_MONO }}>
                                    {opt.price} ₾/ч
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Week Picker — compact mobile.
                    Стрелки недели — отдельной строкой над днями: в одну строку
                    с двумя стрелками по 44 px семь дней на 375 px сжимались до
                    ~32 px (мимо пальца). Так стрелки остаются 44×44, а дни
                    занимают всю ширину (~46 px на 375). */}
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 16, padding: 4, borderRadius: 12, border: `1px solid ${GH.ink8}`, background: GH.ink5 }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button onClick={handlePrevWeek}
                            aria-label="Предыдущая неделя"
                            style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'transparent', border: 'none', color: GH.ink60, cursor: 'pointer' }}>
                            <ChevronLeft size={18} />
                        </button>
                        <div style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 500, color: GH.ink60 }} aria-live="polite">
                            {weekDays.length > 0 && `${formatDayMonthShort(weekDays[0])} – ${formatDayMonthShort(weekDays[weekDays.length - 1])}`}
                        </div>
                        <button onClick={handleNextWeek}
                            aria-label="Следующая неделя"
                            style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'transparent', border: 'none', color: GH.ink60, cursor: 'pointer' }}>
                            <ChevronRight size={18} />
                        </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 }}>
                        {weekDays.map(day => {
                            const isSelectedDate = isSameDay(day, date);
                            return (
                                <button
                                    key={day.toISOString()}
                                    onClick={() => setDate(day)}
                                    aria-pressed={isSelectedDate}
                                    style={{
                                        display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center',
                                        minHeight: 44, minWidth: 0,
                                        padding: '8px 0', borderRadius: 8, border: isSelectedDate ? 'none' : `1px solid ${GH.ink8}`,
                                        background: isSelectedDate ? GH.accent : GH.card,
                                        color: isSelectedDate ? COLOR.onAccent : GH.ink60,
                                        cursor: 'pointer', transition: 'all 0.15s',
                                    }}
                                >
                                    <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' as const, fontFamily: GH_MONO }}>{format(day, 'EEEEEE', { locale: ru })}</span>
                                    <span style={{ fontSize: 14, fontWeight: 600 }}>{format(day, 'd')}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {occupancyFailed && (
                    <ErrorBar
                        className="mb-3"
                        message="Не удалось проверить занятость — часть времени может выглядеть свободной"
                        onRetry={() => { void reloadBookings(); }}
                        retrying={isLoadingBookings}
                    />
                )}

                {/* Info banner — auto-expanded to all locations */}
                {autoExpanded && (bookingFormat === 'group' || bookingFormat === 'intervision') && (
                    <div style={{
                        padding: '10px 12px', marginBottom: 12,
                        background: STATUS.pending.bg,
                        borderRadius: 8, fontSize: 12, color: STATUS.pending.fg, lineHeight: 1.4,
                    }}>
                        Для формата «{bookingFormat === 'group' ? 'Группа' : 'Интервизия'}» подходящие кабинеты есть только в <b>Unbox Uni</b> — показан расширенный список.
                    </div>
                )}

                {/* Empty state — no resources match */}
                {resources.length === 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <EmptyState
                            compact
                            title="Нет подходящих кабинетов"
                            hint={`Попробуйте изменить формат${groupSize ? ' или размер группы' : ''}.`}
                        />
                    </div>
                )}

                {/* Resource selector — horizontal scroll */}
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto' as const, paddingBottom: 8, marginBottom: 12 }}>
                    {resources.map((r, idx) => (
                        <button
                            key={r.id}
                            onClick={() => setMobileResourceIdx(idx)}
                            style={{
                                flexShrink: 0, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                                border: `1px solid ${mobileResourceIdx === idx ? GH.accent : GH.ink10}`,
                                background: mobileResourceIdx === idx ? GH.accent : GH.card,
                                color: mobileResourceIdx === idx ? COLOR.onAccent : GH.ink,
                                cursor: 'pointer', fontFamily: GH_SANS, transition: 'all 0.15s',
                            }}
                        >
                            <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' as const }}>{r.name}</div>
                            <div style={{ fontSize: 12, color: mobileResourceIdx === idx ? COLOR.onAccent : GH.ink60, whiteSpace: 'nowrap' as const, fontFamily: GH_MONO }}>{r.capacity} чел. · {getPrice(r.id)}/ч</div>
                        </button>
                    ))}
                </div>

                {/* Selected block summary */}
                {mobileBlock && mobileResource && (
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: `${GH.accent}12`, border: `1px solid ${GH.accent}30`,
                        borderRadius: 8, padding: '12px 16px', marginBottom: 12,
                    }}>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: GH.ink }}>{mobileBlockStart} — {mobileBlockEnd}</div>
                            <div style={{ fontSize: 12, color: GH.ink60, fontFamily: GH_MONO }}>{mobileBlockDuration} мин · {mobileResource.name}</div>
                        </div>
                        <button
                            onClick={() => useBookingStore.getState().setSlotRange(mobileResource.id, [])}
                            aria-label="Убрать выбранное время"
                            style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: STATUS.danger.bg, color: STATUS.danger.fg, border: 'none', cursor: 'pointer' }}
                        >
                            <X size={16} strokeWidth={2.5} aria-hidden="true" />
                        </button>
                    </div>
                )}

                {/* 2-column time grid: XX:00 | XX:30 */}
                <div style={{ borderRadius: 12, border: `1px solid ${GH.ink8}`, background: GH.card, padding: 8 }}>
                    {mobileResource && mobileHourPairs.map(([left, right]) => (
                        <div key={left} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                            {[left, right].map((time, colIdx) => {
                                if (!time) return <div key={`empty-${colIdx}`} className="flex-1" />;
                                const isHourCol = colIdx === 0;
                                const blocked = isSlotBlocked(mobileResource.id, time);
                                const selected = isSelected(mobileResource.id, time);
                                const bookerName = blocked ? getSlotBookerInfo(mobileResource.id, time) : null;
                                const closed = blocked && !selected && isSlotClosed(time);

                                return (
                                    <button
                                        key={time}
                                        aria-disabled={closed || undefined}
                                        onClick={() => {
                                            // Прошедшее время — без окна «следить» (G3-09).
                                            if (closed) return;
                                            if (blocked) {
                                                setWaitlistData({ resourceId: mobileResource.id, time });
                                                setIsWaitlistOpen(true);
                                            } else {
                                                handleMobileTap(mobileResource.id, time, isHourCol);
                                            }
                                        }}
                                        // disabled убран: раньше HTML-disable
                                        // блокировал tap'ы по занятым ячейкам у
                                        // не-админов, и onClick → waitlist никогда
                                        // не срабатывал. Теперь все занятые
                                        // ячейки кликабельны (открывается окно
                                        // подписки).
                                        style={{
                                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '12px 12px', borderRadius: 8, minHeight: 48, border: 'none',
                                            fontFamily: GH_MONO, fontSize: 13, cursor: 'pointer',
                                            background: blocked ? GH.cellDead : selected ? GH.accent : isPeakTime(time) ? STATUS.pending.bg : GH.card,
                                            color: blocked ? GH.ink60 : selected ? COLOR.onAccent : GH.ink,
                                            outline: !blocked && !selected ? `1px solid ${GH.ink8}` : 'none',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: GH_MONO, fontVariantNumeric: 'tabular-nums' as const }}>
                                                {time}
                                            </span>
                                            {blocked && bookerName && (
                                                <span style={{ fontSize: 12, color: GH.ink60 }}>{bookerName}</span>
                                            )}
                                            {blocked && !bookerName && (
                                                <span style={{ fontSize: 12, color: GH.ink60, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    {closed ? 'Прошло' : <><Clock size={12} aria-hidden="true" /> Занято · следить</>}
                                                </span>
                                            )}
                                        </div>
                                        {selected ? (
                                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: `${COLOR.onAccent}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                            </div>
                                        ) : !blocked ? (
                                            <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${GH.ink10}` }} />
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Fixed bottom bar */}
                <div className="fixed bottom-0 left-0 right-0 z-50">
                    <div
                        style={{
                            padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: GH.paper, borderTop: `1px solid ${GH.ink10}`,
                        }}
                    >
                        <div style={{ fontSize: 14, color: GH.ink, fontFamily: GH_SANS }}>
                            {selectedSlots.length > 0 ? (
                                <span><span style={{ fontWeight: 600, color: GH.accent }}>{selectedSlots.length * 30}</span> мин выбрано</span>
                            ) : (
                                <span style={{ color: GH.ink60 }}>Выберите время</span>
                            )}
                        </div>
                        <Button size="touch" disabled={nextDisabled} onClick={handleNext} iconRight={<ArrowRight size={16} aria-hidden="true" />}>
                            Далее
                        </Button>
                    </div>
                </div>

                {/* Waitlist modal — унифицирован с /dashboard/bookings и /crm.
                    Старый WaitlistModal с заголовком «Слот занят» заменён на
                    общий WaitlistSubscribeModal — у него лучший mobile UX
                    (sticky-кнопки, scrollable, слышимый sub-text "уведомим
                    когда любой кабинет в этом центре освободится"). */}
                {(() => {
                    const wlRes = waitlistData ? RESOURCES.find(r => r.id === waitlistData.resourceId) : null;
                    const wlLoc = wlRes ? LOCATIONS.find(l => l.id === wlRes.locationId) : null;
                    const wlEnd = (() => {
                        if (!waitlistData) return '';
                        const [h, m] = waitlistData.time.split(':').map(Number);
                        const eh = h + 1;
                        return `${eh.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    })();
                    return (
                        <WaitlistSubscribeModal
                            isOpen={isWaitlistOpen}
                            onClose={() => setIsWaitlistOpen(false)}
                            resourceId={waitlistData?.resourceId || ''}
                            resourceName={wlRes?.name || waitlistData?.resourceId || ''}
                            locationName={wlLoc?.name ?? null}
                            date={date}
                            startTime={waitlistData?.time || ''}
                            endTime={wlEnd}
                            extraNote="Уведомим, как только в этом филиале освободится любой кабинет в это же время."
                        />
                    );
                })()}
            </div>
        );
    }

    // ── DESKTOP VIEW (original) ──

    return (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 24, paddingBottom: 112, padding: '24px 24px 112px', fontFamily: GH_SANS, position: 'relative' as const }}>
            {/* Excel #24 — banner when user clicked "+ Ещё период" in Summary */}
            {pendingAddResourceId && (
                <div style={{
                    background: STATUS.pending.bg,
                    color: STATUS.pending.fg,
                    padding: '12px 16px',
                    borderRadius: 0,
                    fontFamily: GH_SANS,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                }}>
                    <span>
                        <strong style={{ fontWeight: 600 }}>Добавление периода:</strong>
                        {' '}Выделите второй интервал в <em>{resources.find(r => r.id === pendingAddResourceId)?.name || pendingAddResourceId}</em>.
                        {' '}Первый период сохранится.
                    </span>
                    <button
                        type="button"
                        onClick={() => useBookingStore.getState().clearAddMore()}
                        style={{
                            fontSize: 14, fontWeight: 600, textDecoration: 'underline',
                            background: 'none', border: 'none', cursor: 'pointer', color: STATUS.pending.fg,
                        }}
                    >
                        Не добавлять
                    </button>
                </div>
            )}
            {/* Loading overlay while bookings are being fetched */}
            {isLoadingBookings && (
                <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: `${COLOR.paper}E6` }}>
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-ink-20 border-t-ink rounded-full animate-spin" />
                        <span style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink60 }}>Загружаем расписание…</span>
                    </div>
                </div>
            )}
            <div
                 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const, gap: 16 }}>
                <div>
                    <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: GH.ink, margin: 0 }}>Выберите время</h2>
                    <p style={{ fontSize: 14, color: GH.ink60, fontFamily: GH_MONO, marginTop: 4 }}>
                        {formatDateLabel(date, { capitalize: true, withYear: 'auto' })} · {
                            bookingFormat === 'individual' ? 'Индивидуально · 20 ₾/ч' :
                            bookingFormat === 'intervision' ? 'Интервизия · 30 ₾/ч' : 'Группа · 35 ₾/ч'
                        }
                    </p>
                    {/* Format switcher (segmented control) */}
                    <div style={{
                        display: 'inline-flex',
                        marginTop: 12,
                        border: `1px solid ${GH.ink10}`,
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: GH.card,
                    }}>
                        {([
                            { key: 'individual', label: 'Индивидуально', price: '20' },
                            { key: 'group', label: 'Группа', price: '35' },
                            { key: 'intervision', label: 'Интервизия', price: '30' },
                        ] as const).map((opt, i) => {
                            const active = bookingFormat === opt.key;
                            return (
                                <button
                                    key={opt.key}
                                    onClick={() => setFormat(opt.key)}
                                    style={{
                                        padding: '8px 14px',
                                        fontFamily: GH_SANS,
                                        fontSize: 13,
                                        fontWeight: active ? 600 : 500,
                                        background: active ? GH.ink : GH.card,
                                        color: active ? COLOR.onInk : GH.ink,
                                        border: 'none',
                                        borderLeft: i > 0 ? `1px solid ${GH.ink10}` : 'none',
                                        cursor: 'pointer',
                                        transition: 'background 150ms, color 150ms',
                                        whiteSpace: 'nowrap',
                                    }}
                                    title={`${opt.price} ₾/час`}
                                >
                                    {opt.label}
                                    <span className="num" style={{
                                        marginLeft: 6,
                                        fontSize: 12,
                                        color: active ? COLOR.onInk : GH.ink60,
                                        fontFamily: GH_MONO,
                                    }}>
                                        {opt.price} ₾
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                {/* Одна «Назад» на шаг — в шапке мастера (MinimalLayout). Здесь
                    было ещё две: «Назад» (уводила на главную) и «К выбору кабинетов». */}
                {!embedded && (
                    <Button
                        variant="secondary"
                        size="touch"
                        aria-pressed={showAllLocations}
                        onClick={() => setShowAllLocations(!showAllLocations)}
                    >
                        {showAllLocations ? 'Показать текущий центр' : 'Показать все центры'}
                    </Button>
                )}
            </div>

            {/* Week Picker — Grid House: тонкие линии, без скруглений и подложек. */}
            <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${GH.ink10}`, background: GH.card }}>
                <button onClick={handlePrevWeek}
                    aria-label="Предыдущая неделя"
                    style={{ width: 44, minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRight: `1px solid ${GH.ink10}`, color: GH.ink, cursor: 'pointer' }}>
                    <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                    {weekDays.map((day, di) => {
                        const isSelectedDate = isSameDay(day, date);
                        return (
                            <button
                                key={day.toISOString()}
                                onClick={() => setDate(day)}
                                aria-pressed={isSelectedDate}
                                aria-label={formatDateLabel(day, { capitalize: true })}
                                style={{
                                    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center',
                                    minHeight: 56, padding: '8px 0',
                                    border: 'none', borderLeft: di > 0 ? `1px solid ${GH.ink10}` : 'none',
                                    background: isSelectedDate ? GH.accent : 'transparent',
                                    color: isSelectedDate ? COLOR.onAccent : GH.ink,
                                    cursor: 'pointer', transition: 'background 0.15s',
                                }}
                            >
                                <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 4, fontFamily: GH_MONO, color: isSelectedDate ? COLOR.onAccent : GH.ink60 }}>
                                    {format(day, 'EEE', { locale: ru })}
                                </span>
                                <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1 }}>{format(day, 'd')}</span>
                            </button>
                        );
                    })}
                </div>
                <button onClick={handleNextWeek}
                    aria-label="Следующая неделя"
                    style={{ width: 44, minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderLeft: `1px solid ${GH.ink10}`, color: GH.ink, cursor: 'pointer' }}>
                    <ChevronRight size={18} aria-hidden="true" />
                </button>
            </div>

            {occupancyFailed && (
                <ErrorBar
                    message="Не удалось проверить занятость — часть времени может выглядеть свободной"
                    onRetry={() => { void reloadBookings(); }}
                    retrying={isLoadingBookings}
                />
            )}

            {/* Info banner — auto-expanded to all locations */}
            {autoExpanded && (bookingFormat === 'group' || bookingFormat === 'intervision') && (
                <div style={{
                    padding: '12px 16px',
                    background: STATUS.pending.bg,
                    borderRadius: 0, fontSize: 14, color: STATUS.pending.fg, lineHeight: 1.5,
                }}>
                    Для формата «{bookingFormat === 'group' ? 'Группа' : 'Интервизия'}» подходящие кабинеты есть только в <b>Unbox Uni</b> (кабинеты 7 и 8) — показан расширенный список.
                </div>
            )}

            {/* Empty state — no resources match */}
            {resources.length === 0 && (
                <EmptyState
                    title="Нет подходящих кабинетов"
                    hint={`Для выбранного формата${groupSize ? ' и размера группы' : ''} свободных кабинетов нет. Попробуйте изменить параметры.`}
                />
            )}

            {/* Сетка. Ячейка — кнопка: мышью её жмут и тянут (как раньше),
                с клавиатуры — стрелки по сетке, Enter/пробел выбирает (G3-10).
                В порядке Tab — одна ячейка (roving tabindex), а не двести. */}
            {resources.length > 0 && (
            <div className="scrollbar-visible" style={{ border: `1px solid ${GH.ink10}`, overflowX: 'auto' as const, isolation: 'isolate' as const }}>
                <table
                    aria-label="Свободное время по кабинетам"
                    style={{ width: '100%', fontSize: 14, textAlign: 'left' as const, whiteSpace: 'nowrap' as const, borderCollapse: 'collapse' as const, fontFamily: GH_SANS }}>
                    <thead style={{ borderBottom: `1px solid ${GH.ink10}`, background: GH.card }}>
                        <tr>
                            <th scope="col" style={{
                                position: 'sticky' as const, left: 0, padding: 12, borderRight: `1px solid ${GH.ink10}`,
                                zIndex: 20, width: 128, fontWeight: 500, fontSize: 12, color: GH.ink60,
                                background: GH.paper, fontFamily: GH_MONO, textTransform: 'uppercase' as const, letterSpacing: '0.06em',
                            }}>
                                Кабинет
                            </th>
                            {timeSlots.map(time => {
                                const peak = isPeakTime(time);
                                return (
                                    <th key={time} scope="col"
                                        style={{
                                            padding: '6px 4px', textAlign: 'center' as const, minWidth: 48, verticalAlign: 'top' as const,
                                            borderRight: `1px solid ${GH.ink5}`, fontSize: 12, fontWeight: 500,
                                            fontFamily: GH_MONO,
                                            color: peak ? STATUS.pending.fg : GH.ink60,
                                            background: peak ? STATUS.pending.bg : 'transparent',
                                        }}>
                                        {time}
                                        {/* Пиковые часы подписаны прямо в шапке — раньше жёлтые
                                            колонки ничем не объяснялись (G3-09). */}
                                        {peak && time.endsWith(':00') && (
                                            <div style={{ fontFamily: GH_SANS, fontSize: 12, fontWeight: 500, lineHeight: 1.2 }}>
                                                +{PEAK_SURCHARGE} ₾
                                            </div>
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {resources.map(r => {
                            const isHighlighted = highlightedResourceId === r.id;
                            return (
                            <tr key={r.id}
                                style={{ background: isHighlighted ? COLOR.accentSoft : 'transparent', borderBottom: `1px solid ${GH.ink5}` }}>
                                <th scope="row" style={{
                                    position: 'sticky' as const, left: 0, padding: 12,
                                    borderRight: `1px solid ${isHighlighted ? GH.accent : GH.ink10}`,
                                    zIndex: 10, width: 128, textAlign: 'left' as const,
                                    background: isHighlighted ? COLOR.accentSoft : GH.paper,
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: isHighlighted ? COLOR.accentInk : GH.ink }}>{r.name}</div>
                                    <div style={{ fontSize: 12, fontWeight: 400, color: GH.ink60, lineHeight: 1.3, fontFamily: GH_MONO }}>{r.capacity} чел. · {getPrice(r.id)}/ч</div>
                                </th>
                                {timeSlots.map(time => {
                                    const isBlocked = isSlotBlocked(r.id, time);
                                    const selected = isSelected(r.id, time);
                                    const isHovered = hoverSlot?.resId === r.id && hoverSlot?.timeStr === time;
                                    // «Прошло» ≠ «занято»: прошлое не выбрать и на него
                                    // не подписаться. Занятое будущее — можно «следить».
                                    const closed = isBlocked && !selected && isSlotClosed(time);
                                    const busy = isBlocked && !closed;
                                    const peak = isPeakTime(time);
                                    const cellKey = `${r.id}|${time}`;
                                    const isFocused = focusKey === cellKey;

                                    // Look up the chunk containing THIS specific
                                    // slot, not just the first/biggest in the
                                    // resource. Required so multiple periods in
                                    // the same cabinet each get their own
                                    // start/end markers + delete button.
                                    const timeIdx = timeSlots.indexOf(time);
                                    const blockForThisCell = selected ? getBlockAt(r.id, timeIdx) : null;
                                    const isBlockStart = !!blockForThisCell && timeIdx === blockForThisCell.start;
                                    const isBlockEnd = !!blockForThisCell && timeIdx === blockForThisCell.end;
                                    const isSingleBlock = isBlockStart && isBlockEnd;

                                    // Handlers for resizing
                                    const ResizeHandle = ({ type }: { type: 'start' | 'end' }) => (
                                        <div
                                            className={`absolute top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center z-20 hover:bg-on-accent/20 transition-colors ${type === 'start' ? 'left-0' : 'right-0'}`}
                                            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handlePointerDown(r.id, time, type === 'start' ? 'resize-start' : 'resize-end'); }}
                                        >
                                            <div className="w-1 h-3 bg-on-accent/70 rounded-full" />
                                        </div>
                                    );

                                    const cellLabel = `${r.name}, ${time}, ${
                                        selected ? 'выбрано — Enter уберёт период'
                                        : closed ? 'уже не забронировать'
                                        : busy ? 'занято — Enter, чтобы следить за освобождением'
                                        : peak ? `свободно, пиковый час +${PEAK_SURCHARGE} ₾`
                                        : 'свободно'}`;

                                    return (
                                        <td key={cellKey}
                                            style={{ padding: 0, borderRight: `1px solid ${GH.ink5}`, height: 56, position: 'relative' as const }}>
                                            <div
                                                data-resid={r.id}
                                                data-time={time}
                                                role="button"
                                                tabIndex={cellKey === tabStopKey ? 0 : -1}
                                                aria-label={cellLabel}
                                                aria-pressed={selected}
                                                aria-disabled={closed || undefined}
                                                onFocus={() => setFocusKey(cellKey)}
                                                onBlur={() => setFocusKey(k => (k === cellKey ? null : k))}
                                                onKeyDown={(e) => handleCellKeyDown(e, r.id, time)}
                                                className="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                                                onPointerDown={(e) => {
                                                    if (e.pointerType === 'mouse' && (e.target as HTMLElement).tagName.toLowerCase() === 'button') {
                                                        return;
                                                    }
                                                    e.preventDefault();
                                                    // Прошедшее время: ни выбора, ни окна «следить» (G3-09).
                                                    if (closed) return;
                                                    if (selected) {
                                                        handlePointerDown(r.id, time, 'move');
                                                    } else {
                                                        handlePointerDown(r.id, time, 'new');
                                                    }
                                                }}
                                                onPointerEnter={() => handlePointerEnter(r.id, time)}
                                                style={{
                                                    width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const,
                                                    alignItems: 'center', justifyContent: 'center', fontSize: 12, position: 'relative' as const,
                                                    fontFamily: GH_MONO,
                                                    userSelect: 'none' as const, touchAction: 'none' as const, transition: 'background 0.1s',
                                                    background: closed ? GH.sunken
                                                        : busy ? BUSY_BG
                                                        : selected ? GH.accent
                                                        : isHovered ? COLOR.accentSoft
                                                        : peak ? STATUS.pending.bg : 'transparent',
                                                    color: selected ? COLOR.onAccent : peak && !isBlocked ? STATUS.pending.fg : GH.ink60,
                                                    cursor: closed ? 'default' : selected ? 'grab' : 'pointer',
                                                }}
                                            >
                                                {selected ? (
                                                    <>
                                                        <div className="flex items-center justify-between w-full h-full px-1 relative">
                                                            {isBlockStart && !isSingleBlock && <ResizeHandle type="start" />}

                                                            {/* Start: show time label */}
                                                            {isBlockStart && (
                                                                <div className="flex flex-col items-center justify-center w-full">
                                                                    <div className="font-semibold text-on-accent text-caption">{time}</div>
                                                                </div>
                                                            )}

                                                            {isBlockEnd && !isSingleBlock && <ResizeHandle type="end" />}
                                                        </div>

                                                        {/* ✕ Delete button — anchored to TOP-RIGHT corner of THIS chunk's
                                                            end cell. Removes only this period, leaving other periods
                                                            in the same resource (and other resources) untouched. */}
                                                        {isBlockEnd && blockForThisCell && (
                                                            <button
                                                                type="button"
                                                                tabIndex={-1}
                                                                onPointerDown={(e) => {
                                                                    e.stopPropagation(); e.preventDefault();
                                                                    removeBlock(blockForThisCell);
                                                                }}
                                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                                                className="absolute top-0.5 right-0.5 rounded-full w-6 h-6 flex items-center justify-center hover:brightness-90 transition-all z-50"
                                                                style={{ background: STATUS.dangerSolid, color: COLOR.card }}
                                                                title="Убрать этот период"
                                                                aria-label="Убрать этот период"
                                                            >
                                                                <X size={14} strokeWidth={2.5} aria-hidden="true" />
                                                            </button>
                                                        )}
                                                    </>
                                                ) : (
                                                    !isBlocked && <span>{time}</span>
                                                )}
                                                {busy && (() => {
                                                    const bookerName = getSlotBookerInfo(r.id, time);
                                                    return bookerName ? (
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0">
                                                            <span className="text-caption font-semibold text-ink-60 leading-none truncate max-w-[55px]">{bookerName}</span>
                                                        </div>
                                                    ) : (isHovered || isFocused) ? (
                                                        // Подсказка «Следить» — при наведении и при фокусе с клавиатуры
                                                        // (раньше только hover, и тот не срабатывал: X4-accessibility-M1).
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5" style={{ background: STATUS.pending.bg }}>
                                                            <Clock size={12} style={{ color: STATUS.pending.fg }} aria-hidden="true" />
                                                            <span className="text-caption font-semibold leading-none" style={{ color: STATUS.pending.fg, fontFamily: GH_SANS }}>Следить</span>
                                                        </div>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </td>
                                    );
                                })}
                                {/* no sticky right action cell */}
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            )}

            {/* Легенда: что значит каждый цвет. Прошедшее и занятое — разные. */}
            {resources.length > 0 && (
                <ul aria-label="Обозначения" style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '8px 20px', listStyle: 'none', margin: 0, padding: 0, fontSize: 14, color: GH.ink80 }}>
                    {([
                        { label: 'Свободно', bg: GH.card },
                        { label: 'Выбрано', bg: GH.accent },
                        { label: `Пиковый час · +${PEAK_SURCHARGE} ₾/ч`, bg: STATUS.pending.bg },
                        { label: 'Занято — можно следить', bg: BUSY_BG },
                        { label: 'Прошло', bg: GH.sunken },
                    ]).map(item => (
                        <li key={item.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span aria-hidden="true" style={{ width: 16, height: 16, background: item.bg, border: `1px solid ${GH.ink10}` }} />
                            {item.label}
                        </li>
                    ))}
                    <li style={{ color: GH.ink60 }}>С клавиатуры: стрелки — по сетке, Enter — выбрать</li>
                </ul>
            )}

            {/* Overlap warning bar */}
            {hasTimeOverlap && (
                <div className="flex items-center gap-3 px-4 py-3 text-sm" style={{ background: STATUS.pending.bg, color: STATUS.pending.fg }}>
                    <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
                    <span>Выбранные периоды <strong>пересекаются по времени</strong>. Вы бронируете несколько кабинетов на одно время.</span>
                </div>
            )}

            {/* Нижняя панель — прилипает к низу, отделена линией (без тени и
                скруглений: тень только у всплывающего). */}
            <div className="fixed bottom-0 left-0 right-0 z-50" style={{ background: GH.paper, borderTop: `1px solid ${GH.ink10}` }}>
            <div className="max-w-[1920px] mx-auto px-6 md:px-12" style={{ paddingTop: 12, paddingBottom: 12 }}>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1, minWidth: 0 }} aria-live="polite">
                        {(() => {
                            // Excel #24 — break the cart into contiguous chips
                            // per resource so each independent period shows
                            // separately with its own × remove button.
                            // E.g. cab5: [10,10:30,15,15:30] → "10:00–11:00"
                            //                                  "15:00–16:00"
                            type Chunk = { resId: string; idxs: number[] };
                            const byRes: Record<string, number[]> = {};
                            for (const s of selectedSlots) {
                                const [r, t] = s.split('|');
                                const i = timeSlots.indexOf(t);
                                if (i < 0) continue;
                                (byRes[r] ||= []).push(i);
                            }
                            const chunks: Chunk[] = [];
                            for (const [resId, raw] of Object.entries(byRes)) {
                                const sorted = [...raw].sort((a, b) => a - b);
                                let cur: number[] = [];
                                for (const i of sorted) {
                                    if (cur.length === 0 || i === cur[cur.length - 1] + 1) {
                                        cur.push(i);
                                    } else {
                                        chunks.push({ resId, idxs: cur });
                                        cur = [i];
                                    }
                                }
                                if (cur.length) chunks.push({ resId, idxs: cur });
                            }
                            if (chunks.length === 0) {
                                return <span style={{ color: GH.ink60, fontFamily: GH_SANS, fontSize: 14 }}>Выберите время — можно несколько периодов, в одном кабинете или в разных</span>;
                            }
                            return chunks.map((ch, i) => {
                                const res = resources.find(r => r.id === ch.resId);
                                const startT = timeSlots[ch.idxs[0]];
                                const endIdx = ch.idxs[ch.idxs.length - 1];
                                // Последний слот 21:30 заканчивается в 22:00 (было «21:00»).
                                const endT = endIdx + 1 < timeSlots.length ? timeSlots[endIdx + 1] : '22:00';
                                const mins = ch.idxs.length * 30;
                                return (
                                    <div key={`${ch.resId}-${i}`}
                                         style={{
                                             display: 'inline-flex', alignItems: 'center', gap: 8,
                                             padding: '4px 4px 4px 12px', border: `1px solid ${GH.ink10}`,
                                             background: GH.card, fontSize: 14,
                                         }}>
                                        <span style={{ color: GH.ink80 }}>{res?.name || ch.resId}</span>
                                        <span className="num" style={{ fontWeight: 600, color: GH.ink }}>{startT}–{endT}</span>
                                        <span style={{ color: GH.ink60 }}>· {formatDurationMin(mins)}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const idsToRemove = new Set(ch.idxs.map(j => `${ch.resId}|${timeSlots[j]}`));
                                                useBookingStore.getState().replaceSlots(
                                                    selectedSlots.filter(s => !idsToRemove.has(s))
                                                );
                                            }}
                                            title="Убрать этот период"
                                            aria-label={`Убрать ${res?.name || ''} ${startT}–${endT}`}
                                            style={{
                                                width: 32, height: 32, border: 'none',
                                                background: 'transparent', color: GH.ink60, cursor: 'pointer',
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            }}
                                        >
                                            <X size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                    {selectedSlots.length > 0 && (
                        <Button variant="quiet" size="touch" onClick={() => useBookingStore.getState().clearCart()}>
                            Очистить
                        </Button>
                    )}
                    <Button size="touch" disabled={nextDisabled} onClick={handleNext} iconRight={<ArrowRight size={18} aria-hidden="true" />}>
                        Далее
                    </Button>
                </div>
            </div></div>

            {(() => {
                const wlRes = waitlistData ? RESOURCES.find(r => r.id === waitlistData.resourceId) : null;
                const wlLoc = wlRes ? LOCATIONS.find(l => l.id === wlRes.locationId) : null;
                const wlEnd = (() => {
                    if (!waitlistData) return '';
                    const [h, m] = waitlistData.time.split(':').map(Number);
                    const eh = h + 1;
                    return `${eh.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                })();
                return (
                    <WaitlistSubscribeModal
                        isOpen={isWaitlistOpen}
                        onClose={() => setIsWaitlistOpen(false)}
                        resourceId={waitlistData?.resourceId || ''}
                        resourceName={wlRes?.name || waitlistData?.resourceId || ''}
                        locationName={wlLoc?.name ?? null}
                        date={date}
                        startTime={waitlistData?.time || ''}
                        endTime={wlEnd}
                        extraNote="Уведомим, как только в этом филиале освободится любой кабинет в это же время."
                    />
                );
            })()}
        </div>
    );
}
