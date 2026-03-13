import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { WaitlistModal } from '../WaitlistModal';
import { RESOURCES } from '../../utils/data';
import { format, addMinutes, setHours, setMinutes, startOfToday, isBefore, isSameDay, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState, useMemo, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, AlertTriangle, Clock } from 'lucide-react';
import { googleCalendarService } from '../../services/googleCalendarMock';
import type { ExternalEvent } from '../../services/googleCalendarMock';

export function ChessboardStep() {
    const {
        locationId, date, setDate, format: bookingFormat, groupSize,
        selectedSlots,
        setStep
    } = useBookingStore();

    const { bookings, fetchBookings } = useUserStore();
    const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);

    // Refresh bookings on mount to ensure availability is up to date
    useEffect(() => {
        fetchBookings();
    }, [fetchBookings]);

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
    const [showAllLocations, setShowAllLocations] = useState(false);

    // 1. Get Resources
    const resources = useMemo(() => {
        let res = showAllLocations ? RESOURCES : RESOURCES.filter(r => r.locationId === locationId);

        // Filter by format
        if (bookingFormat) {
            res = res.filter(r => r.formats?.includes(bookingFormat));
        }

        // Filter by group capacity
        if (bookingFormat === 'group' && groupSize) {
            let minCapacity = 0;
            if (groupSize === '4-8') minCapacity = 8;
            else if (groupSize === '8-14') minCapacity = 14;
            else if (groupSize === '14-20') minCapacity = 20;
            else if (groupSize === '20-30') minCapacity = 30;
            else if (groupSize === '30+') minCapacity = 31;

            res = res.filter(r => r.capacity >= minCapacity);
        }

        return res;
    }, [locationId, showAllLocations, bookingFormat, groupSize]);

    // 2. Fetch External Events (Mock)
    useEffect(() => {
        // Collect events for all visible resources
        let allEvents: ExternalEvent[] = [];
        resources.forEach(r => {
            const events = googleCalendarService.getEvents(r.id);
            allEvents = [...allEvents, ...events];
        });
        setExternalEvents(allEvents);
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

        // CHECK: Booking buffer — can't book slots starting in the past or within 30 min
        if (isBefore(slotDate, addMinutes(new Date(), 30))) {
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

    const isSelected = (resId: string, timeStr: string) => selectedSlots.includes(`${resId}|${timeStr}`);

    // Build per-resource block info (supports multiple blocks across different resources)
    const selectedBlocks = useMemo(() => {
        const byResource: Record<string, number[]> = {};
        for (const slot of selectedSlots) {
            const [resId, timeStr] = slot.split('|');
            const idx = timeSlots.indexOf(timeStr);
            if (idx === -1) continue;
            if (!byResource[resId]) byResource[resId] = [];
            byResource[resId].push(idx);
        }
        return Object.entries(byResource).map(([resId, indices]) => {
            const sorted = [...indices].sort((a, b) => a - b);
            return { resId, start: sorted[0], end: sorted[sorted.length - 1] };
        });
    }, [selectedSlots, timeSlots]);

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
            // Add/replace slots for THIS resource only — other resources keep their blocks
            const setSlotRange = useBookingStore.getState().setSlotRange;
            setSlotRange(resId, [timeStr]);
        } else {
            // For move/resize, find the block for exactly this resource
            const block = getBlockForResource(resId);
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
                setSlotRange(resId, newSlots);
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
            if (!hasBlocked) setSlotRange(resId, newSlots);
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
            if (!hasBlocked) setSlotRange(resId, newSlots);
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
        const rate = isCapsule ? 10 : (bookingFormat === 'group' ? 35 : 20);
        return `${rate} ₾`;
    };

    const handleNext = () => {
        if (hasTimeOverlap) {
            setShowOverlapWarning(true);
        } else {
            setStep(3);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-28 px-6 pt-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold">Выберите время</h2>
                    <p className="text-unbox-grey">
                        {format(date, 'd MMMM yyyy', { locale: ru })} • {bookingFormat === 'individual' ? 'Индивидуально' : 'Группа'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
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
                </div>
            </div>

            {/* Week Picker */}
            <div className="flex items-center gap-2 p-1.5 rounded-2xl border border-unbox-light/60"
                style={{ background: 'rgba(212,226,225,0.35)' }}>
                <button onClick={handlePrevWeek} className="p-2 hover:bg-white rounded-xl transition-all text-unbox-grey hover:text-unbox-dark hover:shadow-sm border border-transparent hover:border-unbox-light">
                    <ChevronLeft size={18} />
                </button>
                <div className="flex-1 grid grid-cols-7 gap-1.5">
                    {weekDays.map(day => {
                        const isSelectedDate = isSameDay(day, date);
                        return (
                            <button
                                key={day.toISOString()}
                                onClick={() => setDate(day)}
                                className={clsx(
                                    "flex flex-col items-center justify-center py-2.5 rounded-xl transition-all duration-200 text-sm",
                                    isSelectedDate
                                        ? "bg-unbox-green text-white shadow-lg shadow-unbox-green/30 scale-[1.04] border border-unbox-green/20"
                                        : "bg-white text-unbox-grey border border-unbox-light hover:border-unbox-green/40 hover:text-unbox-dark hover:shadow-sm"
                                )}
                            >
                                <span className={clsx("text-[10px] font-bold uppercase tracking-wider mb-1", isSelectedDate ? "opacity-80" : "opacity-50")}>
                                    {format(day, 'EEE', { locale: ru })}
                                </span>
                                <span className="text-base font-bold leading-none">{format(day, 'd')}</span>
                            </button>
                        );
                    })}
                </div>
                <button onClick={handleNextWeek} className="p-2 hover:bg-white rounded-xl transition-all text-unbox-grey hover:text-unbox-dark hover:shadow-sm border border-transparent hover:border-unbox-light">
                    <ChevronRight size={18} />
                </button>
            </div>



            {/* The Grid - Refactored to Horizontal Layout */}
            <div className="border border-white/30 rounded-2xl overflow-x-auto bg-white/40 backdrop-blur-sm shadow-sm isolate">
                <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
                    <thead className="text-unbox-dark font-medium border-b border-unbox-light/60"
                        style={{ background: 'rgba(212,226,225,0.45)' }}>
                        <tr>
                            <th className="sticky left-0 backdrop-blur-sm p-4 border-r border-unbox-light/50 z-20 w-40 font-bold text-unbox-dark"
                                style={{ background: 'rgba(212,226,225,0.60)' }}>
                                Кабинет
                            </th>
                            {timeSlots.map(time => (
                                <th key={time} className="p-2 text-center min-w-[60px] border-r border-unbox-light/40 text-[10px] uppercase font-bold text-unbox-dark/60">
                                    {time}
                                </th>
                            ))}
                            <th className="sticky right-0 backdrop-blur-sm border-l border-unbox-light/50 z-20 w-40 p-2"
                                style={{ background: 'rgba(212,226,225,0.60)' }} />
                        </tr>
                    </thead>
                    <tbody>
                        {resources.map(r => (
                            <tr key={r.id} className="hover:bg-unbox-light/10 group">
                                <td className="sticky left-0 backdrop-blur-sm p-4 border-r border-unbox-light/40 z-10 shadow-[2px_0_5px_rgba(71,109,107,0.04)]"
                                    style={{ background: 'rgba(212,226,225,0.50)' }}>
                                    <div className="font-bold text-unbox-dark">{r.name}</div>
                                    <div className="text-[10px] text-unbox-grey">{r.capacity} чел. • {getPrice(r.id)}/час</div>
                                </td>
                                {timeSlots.map(time => {
                                    const isBlocked = isSlotBlocked(r.id, time);
                                    const selected = isSelected(r.id, time);
                                    const isHovered = hoverSlot?.resId === r.id && hoverSlot?.timeStr === time;

                                    // Use per-resource block info
                                    const blockInfo = getBlockForResource(r.id);
                                    const blockForThisCell = blockInfo && selected ? blockInfo : null;
                                    const isBlockStart = blockForThisCell && timeSlots.indexOf(time) === blockForThisCell.start;
                                    const isBlockEnd = blockForThisCell && timeSlots.indexOf(time) === blockForThisCell.end;
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
                                        <td key={`${r.id}-${time}`} className="p-0 border-r border-unbox-light/30 h-14 relative group/slot">
                                            <div
                                                data-resid={r.id}
                                                data-time={time}
                                                onPointerDown={(e) => {
                                                    // Only prevent default on touch to stop scrolling, but let mouse click pass (or just prevent default on drag)
                                                    if (e.pointerType === 'mouse' && (e.target as HTMLElement).tagName.toLowerCase() === 'button') {
                                                        return;
                                                    }
                                                    e.preventDefault();

                                                    // Set touch pointer capture so we get global move events reliably (or handle globally)
                                                    if (selected) {
                                                        handlePointerDown(r.id, time, 'move');
                                                    } else {
                                                        handlePointerDown(r.id, time, 'new');
                                                    }
                                                }}
                                                onPointerEnter={() => handlePointerEnter(r.id, time)}
                                                className={clsx(
                                                    "w-full h-full transition-colors flex flex-col items-center justify-center text-[9px] relative select-none touch-none",
                                                    isBlocked
                                                        ? "bg-striped text-unbox-grey/50 cursor-pointer border-none hover:bg-amber-50/60"
                                                        : selected
                                                            ? dragModeRef.current === 'move' ? "bg-unbox-green text-white z-10 cursor-grabbing shadow-md" : "bg-unbox-green text-white z-10 cursor-grab shadow-sm"
                                                            : isHovered
                                                                ? "bg-unbox-green/10 text-unbox-dark cursor-pointer slot-hover-lift font-bold"
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

                                                        {/* ✕ Delete button — anchored to TOP-RIGHT corner of the end cell */}
                                                        {isBlockEnd && (
                                                            <button
                                                                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); useBookingStore.getState().setSlotRange(r.id, []); }}
                                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); useBookingStore.getState().setSlotRange(r.id, []); }}
                                                                className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-md hover:bg-red-600 hover:scale-110 transition-all z-50"
                                                                title="Удалить"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                                            </button>
                                                        )}
                                                    </>
                                                ) : (
                                                    !isBlocked && <span>{time}</span>
                                                )}
                                                {isBlocked && (
                                                    <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover/slot:opacity-100 transition-opacity duration-300 gap-0.5">
                                                        <Clock size={10} className="text-amber-500" />
                                                        <span className="text-[8px] font-semibold text-amber-600 leading-none">Ожидание</span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    );
                                })}
                                {/* Sticky right action cell */}
                                <td className="sticky right-0 backdrop-blur-sm border-l border-unbox-light/40 z-10 h-14 p-2 shadow-[-4px_0_8px_rgba(71,109,107,0.05)]"
                                    style={{ background: 'rgba(212,226,225,0.50)' }}>
                                    {getBlockForResource(r.id) ? (
                                        <button
                                            onClick={handleNext}
                                            className="flex items-center gap-1.5 bg-unbox-green text-white text-xs font-bold px-3 py-2 rounded-xl shadow-md hover:bg-unbox-dark active:scale-95 transition-all whitespace-nowrap animate-in fade-in zoom-in-90 duration-200 h-full"
                                        >
                                            <ArrowRight size={14} className="shrink-0" />
                                            <span>Продолжить</span>
                                        </button>
                                    ) : null}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

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
                className="rounded-2xl p-4 flex justify-center"
                style={{
                    background: 'rgba(255,255,255,0.18)',
                    backdropFilter: 'blur(24px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                    border: '1px solid rgba(255,255,255,0.30)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
                }}
            >
                <div className="w-full flex justify-between items-center">
                    <div className="text-sm font-medium text-unbox-dark">
                        Выбрано: <span className="font-bold text-unbox-green">{selectedSlots.length}</span> слотов
                        {selectedBlocks.length > 1 && <span className="ml-2 text-unbox-grey">({selectedBlocks.length} кабинета)</span>}
                    </div>
                    <Button disabled={selectedSlots.length === 0} onClick={handleNext} className="shadow-lg px-8">
                        Далее <ArrowRight size={16} className="ml-2" />
                    </Button>
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
