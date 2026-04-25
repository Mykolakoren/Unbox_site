import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { WaitlistModal } from '../WaitlistModal';
import { RESOURCES } from '../../utils/data';
import { format, addMinutes, setHours, setMinutes, startOfToday, isBefore, isSameDay, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState, useMemo, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, AlertTriangle, Clock, X } from 'lucide-react';
import { googleCalendarService } from '../../services/googleCalendarMock';
import type { ExternalEvent } from '../../services/googleCalendarMock';
import { isPeakTime } from '../../utils/pricing';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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
    const isGH = true;

    // Refresh bookings on mount — admin sees ALL bookings, users see only their own
    useEffect(() => {
        setIsLoadingBookings(true);
        const fetchFn = isAdminBooking ? fetchAllBookings : fetchBookings;
        fetchFn().finally(() => setIsLoadingBookings(false));
    }, [fetchBookings, fetchAllBookings, isAdminBooking]);

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

    // Auto-expand to all locations when current location has no matching cabinets
    // (e.g. group/intervision is only available in Unbox Uni — rooms 7/8/9)
    const [autoExpanded, setAutoExpanded] = useState(false);
    useEffect(() => {
        if (!locationId || showAllLocations) { setAutoExpanded(false); return; }
        const inLocation = RESOURCES.filter(r => r.locationId === locationId);
        const matchInLocation = applyFormatSizeFilter(inLocation);
        if (matchInLocation.length === 0) {
            const globalMatch = applyFormatSizeFilter(RESOURCES);
            if (globalMatch.length > 0) {
                setShowAllLocations(true);
                setAutoExpanded(true);
            }
        } else {
            setAutoExpanded(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locationId, bookingFormat, groupSize]);

    // 1. Get Resources
    const resources = useMemo(() => {
        const inLocation = (showAllLocations || !locationId) ? RESOURCES : RESOURCES.filter(r => r.locationId === locationId);
        return applyFormatSizeFilter(inLocation);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locationId, showAllLocations, bookingFormat, groupSize]);

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

    // 3. Generate Time Slots (09:00 - 21:00)
    const timeSlots = useMemo(() => {
        const slots = [];
        let time = setMinutes(setHours(startOfToday(), 9), 0);
        const end = setMinutes(setHours(startOfToday(), 21), 0);

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

    // Overlap confirmation dialog state
    const [showOverlapWarning, setShowOverlapWarning] = useState(false);

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




    const getPrice = (resId: string) => {
        const resource = resources.find(r => r.id === resId);
        if (!resource) return '';
        const isCapsule = resource.type === 'capsule';
        const rate = isCapsule ? 10 : (
            bookingFormat === 'group' ? 35 :
            bookingFormat === 'intervision' ? 30 : 20
        );
        return `${rate} ₾`;
    };

    const handleNext = () => {
        if (hasTimeOverlap) {
            setShowOverlapWarning(true);
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
            <div style={isGH ? { paddingBottom: 128, padding: '16px 12px 128px', fontFamily: GH_SANS, position: 'relative' as const } : undefined}
                 className={isGH ? '' : "animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 px-3 pt-4 relative"}>
                {/* Loading overlay while bookings are being fetched */}
                {isLoadingBookings && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(250,250,247,0.85)', backdropFilter: 'blur(4px)' }}>
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                            <span style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink60 }}>Загрузка расписания...</span>
                        </div>
                    </div>
                )}
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 style={isGH ? { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: GH.ink, margin: 0 } : undefined}
                            className={isGH ? '' : "text-xl font-bold"}>Выберите время</h2>
                        <p style={isGH ? { fontSize: 13, color: GH.ink60, fontFamily: GH_MONO, marginTop: 4 } : undefined}
                           className={isGH ? '' : "text-unbox-grey text-sm"}>
                            {format(date, 'd MMMM yyyy', { locale: ru })}
                        </p>
                    </div>
                    <button onClick={() => setStep(1)}
                        style={isGH ? { padding: 8, border: `1px solid ${GH.ink10}`, borderRadius: 8, background: 'transparent', color: GH.ink60, cursor: 'pointer' } : undefined}
                        className={isGH ? '' : "p-2 rounded-xl border border-unbox-light text-unbox-grey"}>
                        <ArrowLeft size={18} />
                    </button>
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
                    background: '#fff',
                }}>
                    {([
                        { key: 'individual', label: 'Индивид.', price: '20' },
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
                                    fontWeight: active ? 700 : 500,
                                    background: active ? GH.ink : 'transparent',
                                    color: active ? '#fff' : GH.ink,
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
                                <span style={{ fontSize: 10, opacity: active ? 0.75 : 0.55, fontFamily: GH_MONO }}>
                                    {opt.price} ₾/ч
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Week Picker — compact mobile */}
                <div style={isGH ? { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16, padding: 4, borderRadius: 12, border: `1px solid ${GH.ink8}`, background: GH.ink5 } : { background: 'rgba(212,226,225,0.35)' }}
                     className={isGH ? '' : "flex items-center gap-1 mb-4 p-1 rounded-2xl border border-unbox-light/60"}>
                    <button onClick={handlePrevWeek}
                        style={isGH ? { padding: 6, borderRadius: 8, background: 'transparent', border: 'none', color: GH.ink60, cursor: 'pointer' } : undefined}
                        className={isGH ? '' : "p-1.5 rounded-lg hover:bg-white text-unbox-grey"}>
                        <ChevronLeft size={16} />
                    </button>
                    <div className={isGH ? '' : "flex-1 grid grid-cols-7 gap-1"} style={isGH ? { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 } : undefined}>
                        {weekDays.map(day => {
                            const isSelectedDate = isSameDay(day, date);
                            return (
                                <button
                                    key={day.toISOString()}
                                    onClick={() => setDate(day)}
                                    style={isGH ? {
                                        display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
                                        padding: '8px 0', borderRadius: 8, border: isSelectedDate ? 'none' : `1px solid ${GH.ink8}`,
                                        background: isSelectedDate ? GH.accent : '#fff',
                                        color: isSelectedDate ? '#fff' : GH.ink60,
                                        cursor: 'pointer', transition: 'all 0.15s',
                                    } : undefined}
                                    className={isGH ? '' : clsx(
                                        "flex flex-col items-center py-2 rounded-xl transition-all text-xs",
                                        isSelectedDate
                                            ? "bg-unbox-green text-white shadow-md"
                                            : "bg-white text-unbox-grey border border-unbox-light/50"
                                    )}
                                >
                                    <span style={isGH ? { fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, fontFamily: GH_MONO } : undefined}
                                          className={isGH ? '' : "text-[9px] font-bold uppercase"}>{format(day, 'EEEEEE', { locale: ru })}</span>
                                    <span style={isGH ? { fontSize: 14, fontWeight: 700 } : undefined}
                                          className={isGH ? '' : "text-sm font-bold"}>{format(day, 'd')}</span>
                                </button>
                            );
                        })}
                    </div>
                    <button onClick={handleNextWeek}
                        style={isGH ? { padding: 6, borderRadius: 8, background: 'transparent', border: 'none', color: GH.ink60, cursor: 'pointer' } : undefined}
                        className={isGH ? '' : "p-1.5 rounded-lg hover:bg-white text-unbox-grey"}>
                        <ChevronRight size={16} />
                    </button>
                </div>

                {/* Info banner — auto-expanded to all locations */}
                {autoExpanded && (bookingFormat === 'group' || bookingFormat === 'intervision') && (
                    <div style={{
                        padding: '10px 12px', marginBottom: 12,
                        background: '#FEF3C7', border: '1px solid #FDE68A',
                        borderRadius: 8, fontSize: 12, color: '#92400E', lineHeight: 1.4,
                    }}>
                        Для формата «{bookingFormat === 'group' ? 'Группа' : 'Интервизия'}» подходящие кабинеты есть только в <b>Unbox Uni</b> — показан расширенный список.
                    </div>
                )}

                {/* Empty state — no resources match */}
                {resources.length === 0 && (
                    <div style={{
                        padding: '24px 16px', marginBottom: 16, textAlign: 'center' as const,
                        background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8,
                        color: '#991B1B', fontSize: 13, lineHeight: 1.5,
                    }}>
                        <b>Нет подходящих кабинетов</b><br />
                        Попробуйте изменить формат{groupSize ? ' или размер группы' : ''}.
                    </div>
                )}

                {/* Resource selector — horizontal scroll */}
                <div style={isGH ? { display: 'flex', gap: 8, overflowX: 'auto' as const, paddingBottom: 8, marginBottom: 12 } : undefined}
                     className={isGH ? '' : "flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-hide"}>
                    {resources.map((r, idx) => (
                        <button
                            key={r.id}
                            onClick={() => setMobileResourceIdx(idx)}
                            style={isGH ? {
                                flexShrink: 0, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                                border: `1px solid ${mobileResourceIdx === idx ? GH.accent : GH.ink10}`,
                                background: mobileResourceIdx === idx ? GH.accent : '#fff',
                                color: mobileResourceIdx === idx ? '#fff' : GH.ink,
                                cursor: 'pointer', fontFamily: GH_SANS, transition: 'all 0.15s',
                            } : undefined}
                            className={isGH ? '' : clsx(
                                "shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border",
                                mobileResourceIdx === idx
                                    ? "bg-unbox-green text-white border-unbox-green shadow-sm"
                                    : "bg-white text-unbox-grey border-unbox-light hover:border-unbox-green/40"
                            )}
                        >
                            <div style={isGH ? { fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' as const } : undefined}
                                 className={isGH ? '' : "font-bold text-xs whitespace-nowrap"}>{r.name}</div>
                            <div style={isGH ? { fontSize: 10, opacity: 0.6, whiteSpace: 'nowrap' as const, fontFamily: GH_MONO } : undefined}
                                 className={isGH ? '' : "text-[10px] opacity-70 whitespace-nowrap"}>{r.capacity} чел. · {getPrice(r.id)}/ч</div>
                        </button>
                    ))}
                </div>

                {/* Selected block summary */}
                {mobileBlock && mobileResource && (
                    <div style={isGH ? {
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: `${GH.accent}12`, border: `1px solid ${GH.accent}30`,
                        borderRadius: 8, padding: '12px 16px', marginBottom: 12,
                    } : undefined}
                         className={isGH ? '' : "flex items-center justify-between bg-unbox-green/10 border border-unbox-green/20 rounded-xl px-4 py-3 mb-3"}>
                        <div>
                            <div style={isGH ? { fontSize: 14, fontWeight: 700, color: GH.ink } : undefined}
                                 className={isGH ? '' : "text-sm font-bold text-unbox-dark"}>{mobileBlockStart} — {mobileBlockEnd}</div>
                            <div style={isGH ? { fontSize: 12, color: GH.ink60, fontFamily: GH_MONO } : undefined}
                                 className={isGH ? '' : "text-xs text-unbox-grey"}>{mobileBlockDuration} мин · {mobileResource.name}</div>
                        </div>
                        <button
                            onClick={() => useBookingStore.getState().setSlotRange(mobileResource.id, [])}
                            style={isGH ? { padding: 6, borderRadius: 6, background: '#B84A2F18', color: GH.danger, border: 'none', cursor: 'pointer' } : undefined}
                            className={isGH ? '' : "p-1.5 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 transition-colors"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                    </div>
                )}

                {/* 2-column time grid: XX:00 | XX:30 */}
                <div style={isGH ? { borderRadius: 12, border: `1px solid ${GH.ink8}`, background: '#fff', padding: 8 } : undefined}
                     className={isGH ? '' : "rounded-2xl bg-white/60 backdrop-blur-sm border border-unbox-light/30 p-2 space-y-1.5"}>
                    {mobileResource && mobileHourPairs.map(([left, right]) => (
                        <div key={left} style={isGH ? { display: 'flex', gap: 6, marginBottom: 6 } : undefined} className={isGH ? '' : "flex gap-1.5"}>
                            {[left, right].map((time, colIdx) => {
                                if (!time) return <div key={`empty-${colIdx}`} className="flex-1" />;
                                const isHourCol = colIdx === 0;
                                const blocked = isSlotBlocked(mobileResource.id, time);
                                const selected = isSelected(mobileResource.id, time);
                                const bookerName = blocked ? getSlotBookerInfo(mobileResource.id, time) : null;

                                return (
                                    <button
                                        key={time}
                                        onClick={() => {
                                            if (blocked) {
                                                setWaitlistData({ resourceId: mobileResource.id, time });
                                                setIsWaitlistOpen(true);
                                            } else {
                                                handleMobileTap(mobileResource.id, time, isHourCol);
                                            }
                                        }}
                                        disabled={blocked && !bookerName}
                                        style={isGH ? {
                                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '12px 12px', borderRadius: 8, minHeight: 48, border: 'none',
                                            fontFamily: GH_MONO, fontSize: 13, cursor: blocked && !bookerName ? 'not-allowed' : 'pointer',
                                            background: blocked ? GH.cellDead : selected ? GH.accent : isPeakTime(time) ? '#FEF3C7' : '#fff',
                                            color: blocked ? GH.ink30 : selected ? '#fff' : GH.ink,
                                            outline: !blocked && !selected ? `1px solid ${GH.ink8}` : 'none',
                                            transition: 'all 0.15s',
                                        } : undefined}
                                        className={isGH ? '' : clsx(
                                            "flex-1 flex items-center justify-between px-3 py-3 rounded-xl transition-all min-h-[48px]",
                                            blocked
                                                ? "bg-gray-50 text-gray-300 cursor-not-allowed"
                                                : selected
                                                    ? "bg-unbox-green text-white shadow-sm"
                                                    : isPeakTime(time)
                                                        ? "bg-amber-50 text-amber-700 border border-amber-200/60 active:scale-[0.97]"
                                                        : "bg-white text-unbox-dark border border-unbox-light/40 active:scale-[0.97]"
                                        )}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span style={isGH ? { fontSize: 13, fontWeight: 600, fontFamily: GH_MONO, fontVariantNumeric: 'tabular-nums' as const } : undefined}
                                                  className={isGH ? '' : clsx(
                                                "text-sm font-bold tabular-nums",
                                                selected ? "text-white" : blocked ? "text-gray-300" : "text-unbox-dark"
                                            )}>
                                                {time}
                                            </span>
                                            {blocked && bookerName && (
                                                <span style={isGH ? { fontSize: 10, color: GH.ink30 } : undefined}
                                                      className={isGH ? '' : "text-[10px] text-gray-400 truncate"}>{bookerName}</span>
                                            )}
                                            {blocked && !bookerName && (
                                                <span style={isGH ? { fontSize: 10, color: GH.ink30, display: 'flex', alignItems: 'center', gap: 2 } : undefined}
                                                      className={isGH ? '' : "text-[10px] text-gray-400 flex items-center gap-0.5"}>
                                                    <Clock size={9} /> Занято
                                                </span>
                                            )}
                                        </div>
                                        {selected ? (
                                            <div style={isGH ? { width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' } : undefined}
                                                 className={isGH ? '' : "w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0"}>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                            </div>
                                        ) : !blocked ? (
                                            <div style={isGH ? { width: 20, height: 20, borderRadius: '50%', border: `2px solid ${GH.ink10}` } : undefined}
                                                 className={isGH ? '' : "w-5 h-5 rounded-full border-2 border-unbox-light shrink-0"} />
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Fixed bottom bar */}
                <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-3">
                    <div
                        style={isGH ? {
                            borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: GH.paper, borderTop: `1px solid ${GH.ink8}`,
                            boxShadow: '0 -2px 12px rgba(0,0,0,0.04)',
                        } : {
                            background: 'rgba(255,255,255,0.85)',
                            backdropFilter: 'blur(24px)',
                            WebkitBackdropFilter: 'blur(24px)',
                            border: '1px solid rgba(255,255,255,0.50)',
                            boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
                        }}
                        className={isGH ? '' : "rounded-2xl p-3.5 flex items-center justify-between"}
                    >
                        <div style={isGH ? { fontSize: 14, color: GH.ink, fontFamily: GH_SANS } : undefined} className={isGH ? '' : "text-sm text-unbox-dark"}>
                            {selectedSlots.length > 0 ? (
                                <span><span style={isGH ? { fontWeight: 700, color: GH.accent } : undefined} className={isGH ? '' : "font-bold text-unbox-green"}>{selectedSlots.length * 30}</span> мин выбрано</span>
                            ) : (
                                <span style={isGH ? { color: GH.ink30 } : undefined} className={isGH ? '' : "text-unbox-grey"}>Выберите слоты</span>
                            )}
                        </div>
                        {isGH ? (
                            <button
                                disabled={selectedSlots.length === 0}
                                onClick={handleNext}
                                style={{
                                    padding: '10px 24px', borderRadius: 8, border: 'none',
                                    background: selectedSlots.length === 0 ? GH.ink10 : GH.accent,
                                    color: selectedSlots.length === 0 ? GH.ink30 : '#fff',
                                    fontFamily: GH_SANS, fontSize: 14, fontWeight: 600,
                                    cursor: selectedSlots.length === 0 ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                            >
                                Далее <ArrowRight size={14} />
                            </button>
                        ) : (
                            <Button disabled={selectedSlots.length === 0} onClick={handleNext} size="sm" className="shadow-md px-6">
                                Далее <ArrowRight size={14} className="ml-1" />
                            </Button>
                        )}
                    </div>
                </div>

                {/* Waitlist modal */}
                <WaitlistModal
                    isOpen={isWaitlistOpen}
                    onClose={() => setIsWaitlistOpen(false)}
                    resourceId={waitlistData?.resourceId || ''}
                    startTime={waitlistData?.time || ''}
                    date={date}
                />
            </div>
        );
    }

    // ── DESKTOP VIEW (original) ──

    /* GH button helper */
    const ghBtn = (active: boolean): React.CSSProperties => ({
        padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
        fontFamily: GH_SANS, cursor: 'pointer', border: `1px solid ${active ? GH.accent : GH.ink10}`,
        background: active ? GH.accent : 'transparent', color: active ? '#fff' : GH.ink,
        display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
    });

    return (
        <div style={isGH ? { display: 'flex', flexDirection: 'column' as const, gap: 24, paddingBottom: 112, padding: '24px 24px 112px', fontFamily: GH_SANS, position: 'relative' as const } : undefined}
             className={isGH ? '' : "space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-28 px-6 pt-6 relative"}>
            {/* Excel #24 — banner when user clicked "+ Ещё период" in Summary */}
            {pendingAddResourceId && (
                <div style={{
                    background: '#FEF3C7',
                    border: `1px solid ${GH.ink10}`,
                    color: '#92400E',
                    padding: '12px 16px',
                    borderRadius: 8,
                    fontFamily: GH_SANS,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                }}>
                    <span>
                        <strong style={{ fontWeight: 700 }}>Добавление периода:</strong>
                        {' '}Выделите второй интервал в <em>{resources.find(r => r.id === pendingAddResourceId)?.name || pendingAddResourceId}</em>.
                        {' '}Первый период сохранится.
                    </span>
                    <button
                        type="button"
                        onClick={() => useBookingStore.getState().clearAddMore()}
                        style={{
                            fontSize: 13, fontWeight: 700, textDecoration: 'underline',
                            background: 'none', border: 'none', cursor: 'pointer', color: '#92400E',
                        }}
                    >
                        Отмена
                    </button>
                </div>
            )}
            {/* Loading overlay while bookings are being fetched */}
            {isLoadingBookings && (
                <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(250,250,247,0.85)', backdropFilter: 'blur(4px)' }}>
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                        <span style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink60 }}>Загрузка расписания...</span>
                    </div>
                </div>
            )}
            <div className={isGH ? '' : "flex flex-col md:flex-row justify-between items-start md:items-center gap-4"}
                 style={isGH ? { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const, gap: 16 } : undefined}>
                <div>
                    <h2 style={isGH ? { fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: GH.ink, margin: 0 } : undefined}
                        className={isGH ? '' : "text-2xl font-bold"}>Выберите время</h2>
                    <p style={isGH ? { fontSize: 14, color: GH.ink60, fontFamily: GH_MONO, marginTop: 4 } : undefined}
                       className={isGH ? '' : "text-unbox-grey"}>
                        {format(date, 'd MMMM yyyy', { locale: ru })} • {
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
                        background: '#fff',
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
                                        background: active ? GH.ink : '#fff',
                                        color: active ? '#fff' : GH.ink,
                                        border: 'none',
                                        borderLeft: i > 0 ? `1px solid ${GH.ink10}` : 'none',
                                        cursor: 'pointer',
                                        transition: 'background 150ms, color 150ms',
                                        whiteSpace: 'nowrap',
                                    }}
                                    title={`${opt.price} ₾/час`}
                                >
                                    {opt.label}
                                    <span style={{
                                        marginLeft: 6,
                                        fontSize: 11,
                                        opacity: active ? 0.75 : 0.5,
                                        fontFamily: GH_MONO,
                                    }}>
                                        {opt.price}₾
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div style={isGH ? { display: 'flex', flexWrap: 'wrap' as const, gap: 8 } : undefined}
                     className={isGH ? '' : "flex flex-wrap gap-2"}>
                    {!embedded && (
                        <>
                            {isGH ? (
                                <>
                                    <button style={ghBtn(showAllLocations)} onClick={() => setShowAllLocations(!showAllLocations)}>
                                        {showAllLocations ? 'Показать текущую локацию' : 'Показать все центры'}
                                    </button>
                                    <button style={ghBtn(false)} onClick={() => setStep(1)}>
                                        <ArrowLeft size={14} /> Назад
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Button
                                        variant={showAllLocations ? 'primary' : 'outline'}
                                        size="sm"
                                        onClick={() => setShowAllLocations(!showAllLocations)}
                                    >
                                        {showAllLocations ? 'Показать текущую локацию' : 'Показать все центры'}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                                        <ArrowLeft size={16} className="mr-2" /> Назад
                                    </Button>
                                </>
                            )}
                        </>
                    )}
                    {highlightedResourceId && locationId && (
                        isGH ? (
                            <button style={ghBtn(false)} onClick={() => { setHighlightedResourceId(null); window.history.back(); }}>
                                <ArrowLeft size={14} /> К выбору кабинетов
                            </button>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setHighlightedResourceId(null);
                                    window.history.back();
                                }}
                            >
                                <ArrowLeft size={16} className="mr-2" /> К выбору кабинетов
                            </Button>
                        )
                    )}
                </div>
            </div>

            {/* Week Picker */}
            <div style={isGH ? { display: 'flex', alignItems: 'center', gap: 8, padding: 6, borderRadius: 12, border: `1px solid ${GH.ink8}`, background: GH.ink5 } : { background: 'rgba(212,226,225,0.35)' }}
                 className={isGH ? '' : "flex items-center gap-2 p-1.5 rounded-2xl border border-unbox-light/60"}>
                <button onClick={handlePrevWeek}
                    style={isGH ? { padding: 8, borderRadius: 8, background: 'transparent', border: 'none', color: GH.ink60, cursor: 'pointer' } : undefined}
                    className={isGH ? '' : "p-2 hover:bg-white rounded-xl transition-all text-unbox-grey hover:text-unbox-dark hover:shadow-sm border border-transparent hover:border-unbox-light"}>
                    <ChevronLeft size={18} />
                </button>
                <div style={isGH ? { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 } : undefined}
                     className={isGH ? '' : "flex-1 grid grid-cols-7 gap-1.5"}>
                    {weekDays.map(day => {
                        const isSelectedDate = isSameDay(day, date);
                        return (
                            <button
                                key={day.toISOString()}
                                onClick={() => setDate(day)}
                                style={isGH ? {
                                    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center',
                                    padding: '10px 0', borderRadius: 8,
                                    border: isSelectedDate ? 'none' : `1px solid ${GH.ink8}`,
                                    background: isSelectedDate ? GH.accent : '#fff',
                                    color: isSelectedDate ? '#fff' : GH.ink60,
                                    cursor: 'pointer', transition: 'all 0.15s',
                                } : undefined}
                                className={isGH ? '' : clsx(
                                    "flex flex-col items-center justify-center py-2.5 rounded-xl transition-all duration-200 text-sm",
                                    isSelectedDate
                                        ? "bg-unbox-green text-white shadow-lg shadow-unbox-green/30 scale-[1.04] border border-unbox-green/20"
                                        : "bg-white text-unbox-grey border border-unbox-light hover:border-unbox-green/40 hover:text-unbox-dark hover:shadow-sm"
                                )}
                            >
                                <span style={isGH ? { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 4, fontFamily: GH_MONO, opacity: isSelectedDate ? 0.8 : 0.5 } : undefined}
                                      className={isGH ? '' : clsx("text-[10px] font-bold uppercase tracking-wider mb-1", isSelectedDate ? "opacity-80" : "opacity-50")}>
                                    {format(day, 'EEE', { locale: ru })}
                                </span>
                                <span style={isGH ? { fontSize: 16, fontWeight: 700, lineHeight: 1 } : undefined}
                                      className={isGH ? '' : "text-base font-bold leading-none"}>{format(day, 'd')}</span>
                            </button>
                        );
                    })}
                </div>
                <button onClick={handleNextWeek}
                    style={isGH ? { padding: 8, borderRadius: 8, background: 'transparent', border: 'none', color: GH.ink60, cursor: 'pointer' } : undefined}
                    className={isGH ? '' : "p-2 hover:bg-white rounded-xl transition-all text-unbox-grey hover:text-unbox-dark hover:shadow-sm border border-transparent hover:border-unbox-light"}>
                    <ChevronRight size={18} />
                </button>
            </div>



            {/* Info banner — auto-expanded to all locations */}
            {autoExpanded && (bookingFormat === 'group' || bookingFormat === 'intervision') && (
                <div style={{
                    padding: '12px 16px',
                    background: '#FEF3C7', border: '1px solid #FDE68A',
                    borderRadius: 10, fontSize: 13, color: '#92400E', lineHeight: 1.5,
                }}>
                    Для формата «{bookingFormat === 'group' ? 'Группа' : 'Интервизия'}» подходящие кабинеты есть только в <b>Unbox Uni</b> (Кабинеты 7, 8, 9) — показан расширенный список.
                </div>
            )}

            {/* Empty state — no resources match */}
            {resources.length === 0 && (
                <div style={{
                    padding: '32px 20px', textAlign: 'center' as const,
                    background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 12,
                    color: '#991B1B', fontSize: 14, lineHeight: 1.6,
                }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Нет подходящих кабинетов</div>
                    <div>Для выбранного формата{groupSize ? ' и размера группы' : ''} нет доступных кабинетов. Попробуйте изменить параметры.</div>
                </div>
            )}

            {/* The Grid - Refactored to Horizontal Layout */}
            {resources.length > 0 && (
            <div style={isGH ? { border: `1px solid ${GH.ink8}`, borderRadius: 12, overflowX: 'auto' as const, isolation: 'isolate' as const } : undefined}
                 className={isGH ? '' : "border border-white/40 rounded-2xl overflow-x-auto scrollbar-visible glass-card isolate"}>
                <table style={isGH ? { width: '100%', fontSize: 13, textAlign: 'left' as const, whiteSpace: 'nowrap' as const, borderCollapse: 'collapse' as const, fontFamily: GH_SANS } : undefined}
                       className={isGH ? '' : "w-full text-sm text-left whitespace-nowrap border-collapse"}>
                    <thead style={isGH ? { borderBottom: `1px solid ${GH.ink8}`, background: GH.ink5 } : { background: 'rgba(212,226,225,0.45)' }}
                           className={isGH ? '' : "text-unbox-dark font-medium border-b border-unbox-light/60"}>
                        <tr>
                            <th style={isGH ? {
                                position: 'sticky' as const, left: 0, padding: 12, borderRight: `1px solid ${GH.ink8}`,
                                zIndex: 20, width: 128, fontWeight: 700, fontSize: 11, color: GH.ink,
                                background: GH.paper, fontFamily: GH_MONO, textTransform: 'uppercase' as const, letterSpacing: '0.06em',
                            } : { background: 'rgba(212,226,225,0.60)' }}
                                className={isGH ? '' : "sticky left-0 backdrop-blur-sm p-3 border-r border-unbox-light/50 z-20 w-32 font-bold text-unbox-dark text-xs"}>
                                Кабинет
                            </th>
                            {timeSlots.map(time => (
                                <th key={time}
                                    style={isGH ? {
                                        padding: 6, textAlign: 'center' as const, minWidth: 48,
                                        borderRight: `1px solid ${GH.ink5}`, fontSize: 10, fontWeight: 700,
                                        textTransform: 'uppercase' as const, fontFamily: GH_MONO,
                                        color: isPeakTime(time) ? '#B45309' : GH.ink30,
                                        background: isPeakTime(time) ? '#FEF9C320' : 'transparent',
                                    } : undefined}
                                    className={isGH ? '' : clsx(
                                    "p-1.5 text-center min-w-[48px] border-r border-unbox-light/40 text-[10px] uppercase font-bold",
                                    isPeakTime(time) ? "text-amber-600 bg-amber-50/40" : "text-unbox-dark/60"
                                )}>
                                    {time}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {resources.map(r => {
                            const isHighlighted = highlightedResourceId === r.id;
                            return (
                            <tr key={r.id}
                                style={isGH ? { background: isHighlighted ? `${GH.accent}08` : 'transparent' } : undefined}
                                className={isGH ? '' : clsx("hover:bg-unbox-light/10 group", isHighlighted && "bg-unbox-green/[0.06]")}>
                                <td style={isGH ? {
                                    position: 'sticky' as const, left: 0, padding: 12,
                                    borderRight: `1px solid ${isHighlighted ? GH.accent + '40' : GH.ink8}`,
                                    zIndex: 10, width: 128,
                                    background: isHighlighted ? `${GH.accent}14` : GH.paper,
                                    boxShadow: '2px 0 5px rgba(0,0,0,0.02)',
                                } : { background: isHighlighted ? 'rgba(71,109,107,0.12)' : 'rgba(212,226,225,0.50)' }}
                                    className={isGH ? '' : clsx(
                                    "sticky left-0 backdrop-blur-sm p-3 border-r z-10 shadow-[2px_0_5px_rgba(71,109,107,0.04)] w-32",
                                    isHighlighted ? "border-r-unbox-green/40" : "border-r-unbox-light/40"
                                )}>
                                    <div style={isGH ? { fontWeight: 700, fontSize: 12, lineHeight: 1.3, color: isHighlighted ? GH.accent : GH.ink } : undefined}
                                         className={isGH ? '' : clsx("font-bold text-xs leading-tight", isHighlighted ? "text-unbox-green" : "text-unbox-dark")}>{r.name}</div>
                                    <div style={isGH ? { fontSize: 9, color: GH.ink30, lineHeight: 1.3, fontFamily: GH_MONO } : undefined}
                                         className={isGH ? '' : "text-[9px] text-unbox-grey leading-tight"}>{r.capacity} чел. • {getPrice(r.id)}/час</div>
                                </td>
                                {timeSlots.map(time => {
                                    const isBlocked = isSlotBlocked(r.id, time);
                                    const selected = isSelected(r.id, time);
                                    const isHovered = hoverSlot?.resId === r.id && hoverSlot?.timeStr === time;

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
                                            className={`absolute top-0 bottom-0 w-3 cursor-col-resize flex items-center justify-center z-20 hover:bg-white/20 transition-colors ${type === 'start' ? 'left-0 rounded-l-md' : 'right-0 rounded-r-md'}`}
                                            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); handlePointerDown(r.id, time, type === 'start' ? 'resize-start' : 'resize-end'); }}
                                        >
                                            <div className="w-1 h-3 bg-white/70 rounded-full" />
                                        </div>
                                    );

                                    return (
                                        <td key={`${r.id}-${time}`}
                                            style={isGH ? { padding: 0, borderRight: `1px solid ${GH.ink5}`, height: 56, position: 'relative' as const } : undefined}
                                            className={isGH ? '' : "p-0 border-r border-unbox-light/30 h-14 relative group/slot"}>
                                            <div
                                                data-resid={r.id}
                                                data-time={time}
                                                onPointerDown={(e) => {
                                                    if (e.pointerType === 'mouse' && (e.target as HTMLElement).tagName.toLowerCase() === 'button') {
                                                        return;
                                                    }
                                                    e.preventDefault();
                                                    if (selected) {
                                                        handlePointerDown(r.id, time, 'move');
                                                    } else {
                                                        handlePointerDown(r.id, time, 'new');
                                                    }
                                                }}
                                                onPointerEnter={() => handlePointerEnter(r.id, time)}
                                                style={isGH ? {
                                                    width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const,
                                                    alignItems: 'center', justifyContent: 'center', fontSize: 9, position: 'relative' as const,
                                                    userSelect: 'none' as const, touchAction: 'none' as const, transition: 'background 0.1s',
                                                    background: isBlocked ? GH.cellDead
                                                        : selected ? GH.accent
                                                        : isHovered ? `${GH.accent}14`
                                                        : isPeakTime(time) ? '#FEF9C340' : 'transparent',
                                                    color: isBlocked ? GH.ink30 : selected ? '#fff' : isHovered ? GH.ink : isPeakTime(time) ? '#B45309' : GH.ink30,
                                                    cursor: isBlocked ? 'pointer' : selected ? 'grab' : 'pointer',
                                                    borderRadius: isBlockStart && isBlockEnd ? 6
                                                        : isBlockStart ? '6px 0 0 6px'
                                                        : isBlockEnd ? '0 6px 6px 0' : 0,
                                                } : undefined}
                                                className={isGH ? '' : clsx(
                                                    "w-full h-full transition-colors flex flex-col items-center justify-center text-[9px] relative select-none touch-none",
                                                    isBlocked
                                                        ? "bg-striped text-unbox-grey/50 cursor-pointer border-none hover:bg-amber-50/60"
                                                        : selected
                                                            ? dragModeRef.current === 'move' ? "bg-unbox-green text-white z-10 cursor-grabbing shadow-md" : "bg-unbox-green text-white z-10 cursor-grab shadow-sm"
                                                            : isHovered
                                                                ? "bg-unbox-green/10 text-unbox-dark cursor-pointer slot-hover-lift font-bold"
                                                                : isPeakTime(time)
                                                                    ? "bg-amber-50/70 hover:bg-amber-100/60 text-amber-600/70 hover:text-amber-700 cursor-pointer transition-all"
                                                                    : "hover:bg-unbox-green/5 text-unbox-dark/50 hover:text-unbox-green cursor-pointer transition-all",
                                                    selected && !isSingleBlock && !isBlockStart && "border-l border-white/20",
                                                    isBlockStart && "rounded-l-lg",
                                                    isBlockEnd && "rounded-r-lg"
                                                )}
                                            >
                                                {selected ? (
                                                    <>
                                                        <div className="flex items-center justify-between w-full h-full px-1 relative">
                                                            {isBlockStart && !isSingleBlock && <ResizeHandle type="start" />}

                                                            {/* Start: show time label */}
                                                            {isBlockStart && (
                                                                <div className="flex flex-col items-center justify-center w-full">
                                                                    <div className="font-bold text-white text-xs">{time}</div>
                                                                </div>
                                                            )}

                                                            {isBlockEnd && !isSingleBlock && <ResizeHandle type="end" />}
                                                        </div>

                                                        {/* ✕ Delete button — anchored to TOP-RIGHT corner of THIS chunk's
                                                            end cell. Removes only this period, leaving other periods
                                                            in the same resource (and other resources) untouched. */}
                                                        {isBlockEnd && blockForThisCell && (
                                                            <button
                                                                onPointerDown={(e) => {
                                                                    e.stopPropagation(); e.preventDefault();
                                                                    const blk = blockForThisCell;
                                                                    const idsToRemove = new Set<string>();
                                                                    for (let i = blk.start; i <= blk.end; i++) {
                                                                        idsToRemove.add(`${r.id}|${timeSlots[i]}`);
                                                                    }
                                                                    useBookingStore.getState().replaceSlots(
                                                                        useBookingStore.getState().selectedSlots.filter(s => !idsToRemove.has(s))
                                                                    );
                                                                }}
                                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                                                className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-md hover:bg-red-600 hover:scale-110 transition-all z-50"
                                                                title="Убрать этот период"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                                            </button>
                                                        )}
                                                    </>
                                                ) : (
                                                    !isBlocked && <span>{time}</span>
                                                )}
                                                {isBlocked && (() => {
                                                    const bookerName = getSlotBookerInfo(r.id, time);
                                                    return bookerName ? (
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0">
                                                            <span className="text-[8px] font-bold text-unbox-dark/60 leading-none truncate max-w-[55px]">{bookerName}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover/slot:opacity-100 transition-opacity duration-300 gap-0.5">
                                                            <Clock size={10} className="text-amber-500" />
                                                            <span className="text-[8px] font-semibold text-amber-600 leading-none">Ожидание</span>
                                                        </div>
                                                    );
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

            {/* Overlap warning bar */}
            {hasTimeOverlap && (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle size={18} className="shrink-0 text-amber-500" />
                    <span>Выбранные блоки <strong>пересекаются по времени</strong>. Вы бронируете несколько кабинетов на одно время.</span>
                </div>
            )}

            <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4">
            <div className="max-w-[1920px] mx-auto">
            <div
                style={isGH ? {
                    borderRadius: 12, padding: 16, display: 'flex', justifyContent: 'center',
                    background: GH.paper, borderTop: `1px solid ${GH.ink8}`,
                    boxShadow: '0 -2px 12px rgba(0,0,0,0.04)',
                } : {
                    background: 'rgba(255,255,255,0.82)',
                    backdropFilter: 'blur(24px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                    border: '1px solid rgba(255,255,255,0.50)',
                    boxShadow: '0 -4px 24px rgba(0,0,0,0.08)',
                }}
                className={isGH ? '' : "rounded-2xl p-4 flex justify-center"}
            >
                <div style={isGH ? { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' } : undefined}
                     className={isGH ? '' : "w-full flex justify-between items-center gap-4 flex-wrap"}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1, minWidth: 0 }}>
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
                                return <span style={{ color: GH.ink30, fontFamily: GH_SANS, fontSize: 14 }}>Выберите слоты — можно несколько в разных кабинетах или несколько периодов в одном</span>;
                            }
                            return chunks.map((ch, i) => {
                                const res = resources.find(r => r.id === ch.resId);
                                const startT = timeSlots[ch.idxs[0]];
                                const endIdx = ch.idxs[ch.idxs.length - 1];
                                const endT = endIdx + 1 < timeSlots.length ? timeSlots[endIdx + 1] : '21:00';
                                const mins = ch.idxs.length * 30;
                                return (
                                    <div key={`${ch.resId}-${i}`}
                                         style={{
                                             display: 'inline-flex', alignItems: 'center', gap: 6,
                                             padding: '6px 8px 6px 12px', borderRadius: 6,
                                             background: GH.ink5, fontFamily: GH_MONO, fontSize: 11,
                                             letterSpacing: '0.04em',
                                         }}>
                                        <span style={{ color: GH.ink60 }}>{res?.name || ch.resId}</span>
                                        <span style={{ fontWeight: 700, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>{startT}–{endT}</span>
                                        <span style={{ color: GH.ink30 }}>· {mins >= 60 ? `${(mins/60).toString().replace(/\.0$/,'')}ч` : `${mins}м`}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const idsToRemove = new Set(ch.idxs.map(j => `${ch.resId}|${timeSlots[j]}`));
                                                useBookingStore.getState().replaceSlots(
                                                    selectedSlots.filter(s => !idsToRemove.has(s))
                                                );
                                            }}
                                            title="Убрать этот период"
                                            style={{
                                                width: 18, height: 18, borderRadius: '50%', border: 'none',
                                                background: GH.ink10, color: GH.ink60, cursor: 'pointer',
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            }}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                    {selectedSlots.length > 0 && (
                        <button
                            type="button"
                            onClick={() => useBookingStore.getState().clearCart()}
                            style={{
                                fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.1em',
                                background: 'none', border: 'none', color: GH.ink30,
                                cursor: 'pointer', textDecoration: 'underline',
                            }}
                        >
                            Очистить
                        </button>
                    )}
                    {isGH ? (
                        <button
                            disabled={selectedSlots.length === 0}
                            onClick={handleNext}
                            style={{
                                padding: '12px 32px', borderRadius: 8, border: 'none',
                                background: selectedSlots.length === 0 ? GH.ink10 : GH.accent,
                                color: selectedSlots.length === 0 ? GH.ink30 : '#fff',
                                fontFamily: GH_SANS, fontSize: 15, fontWeight: 600,
                                cursor: selectedSlots.length === 0 ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                            }}
                        >
                            Далее <ArrowRight size={16} />
                        </button>
                    ) : (
                        <Button disabled={selectedSlots.length === 0} onClick={handleNext} className="shadow-lg shadow-unbox-green/20 px-8">
                            Далее <ArrowRight size={16} className="ml-2" />
                        </Button>
                    )}
                </div>
            </div></div></div>

            {/* Overlap confirmation dialog */}
            {showOverlapWarning && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                        <div className="flex items-start gap-4 mb-5">
                            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                                <AlertTriangle size={24} className="text-amber-500" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-unbox-dark mb-1">Наложение времени</h3>
                                <p className="text-unbox-grey text-sm">
                                    Вы выбрали несколько кабинетов, которые <strong>пересекаются по времени</strong>. Это значит, вы планируете одновременно использовать несколько помещений.
                                </p>
                                <p className="text-unbox-grey text-sm mt-2">
                                    Вы уверены, что хотите продолжить?
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowOverlapWarning(false)}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-unbox-light text-unbox-dark font-medium hover:bg-unbox-light/30 transition-colors"
                            >
                                Изменить выбор
                            </button>
                            <button
                                onClick={() => { setShowOverlapWarning(false); setStep(3); }}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-unbox-green text-white font-medium hover:bg-unbox-green/90 transition-colors"
                            >
                                Да, продолжить
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <WaitlistModal
                isOpen={isWaitlistOpen}
                onClose={() => setIsWaitlistOpen(false)}
                resourceId={waitlistData?.resourceId || ''}
                startTime={waitlistData?.time || ''}
                date={date}
            />
        </div>
    );
}
