import { useMemo, useState, useEffect, useCallback } from 'react';
import { format, addMinutes, setHours, setMinutes, startOfToday, isBefore, isSameDay, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import clsx from 'clsx';
import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { googleCalendarService } from '../../services/googleCalendarMock';

export function InteractiveTimeline({ locationId }: { locationId: string }) {
    const {
        resources, fetchResources,
        date, setDate,
        selectedSlots, toggleSlot, replaceSlots
    } = useBookingStore();
    const { bookings, fetchBookings } = useUserStore();

    useEffect(() => {
        fetchResources();
        fetchBookings();
    }, [fetchResources, fetchBookings]);

    const locationResources = useMemo(() =>
        resources.filter(r => r.locationId === locationId || r.id.startsWith(locationId)),
        [resources, locationId]);

    // Generate timeslots from 09:00 to 21:00
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

    // --- Drag to Select / Resize / Move Logic ---
    const [interactionState, setInteractionState] = useState<{
        type: 'select' | 'resize' | 'move' | null;
        startResId: string | null;
        startIndex: number | null;
        currentIndex: number | null;
        edge?: 'left' | 'right';
        originalBlock?: { resId: string; startIndex: number; endIndex: number };
    }>({ type: null, startResId: null, startIndex: null, currentIndex: null });

    // Constants for rendering calculations
    const SLOT_WIDTH = 48; // w-12 = 3rem = 48px
    const SLOT_GAP = 4; // gap-1 = 0.25rem = 4px
    const TOTAL_SLOT_WIDTH = SLOT_WIDTH + SLOT_GAP;

    // --- Block Grouping ---
    // Group selected slots into contiguous blocks for rendering overlays
    type SelectionBlock = { resId: string; startIndex: number; endIndex: number };

    const selectionBlocks = useMemo(() => {
        const blocks: SelectionBlock[] = [];
        const slotsByRes: Record<string, number[]> = {};

        selectedSlots.forEach(slotId => {
            const [resId, timeStr] = slotId.split('|');
            const idx = timeSlots.indexOf(timeStr);
            if (idx !== -1) {
                if (!slotsByRes[resId]) slotsByRes[resId] = [];
                slotsByRes[resId].push(idx);
            }
        });

        Object.entries(slotsByRes).forEach(([resId, indices]) => {
            indices.sort((a, b) => a - b);
            let currentStart = indices[0];
            let currentEnd = indices[0];

            for (let i = 1; i < indices.length; i++) {
                if (indices[i] === currentEnd + 1) {
                    currentEnd = indices[i];
                } else {
                    blocks.push({ resId, startIndex: currentStart, endIndex: currentEnd });
                    currentStart = indices[i];
                    currentEnd = indices[i];
                }
            }
            blocks.push({ resId, startIndex: currentStart, endIndex: currentEnd });
        });
        return blocks;
    }, [selectedSlots, timeSlots]);


    // --- Interaction Handlers ---

    const handleSlotMouseDown = (resourceId: string, index: number) => {
        if (isSlotBlocked(resourceId, timeSlots[index])) return;
        setInteractionState({
            type: 'select',
            startResId: resourceId,
            startIndex: index,
            currentIndex: index
        });
    };

    const handleMouseEnter = (resourceId: string, index: number) => {
        if (interactionState.type && interactionState.startResId === resourceId) {
            setInteractionState(prev => ({ ...prev, currentIndex: index }));
        }
    };

    const handleResizeStart = (e: React.MouseEvent, block: SelectionBlock, edge: 'left' | 'right') => {
        e.stopPropagation();
        setInteractionState({
            type: 'resize',
            startResId: block.resId,
            startIndex: edge === 'left' ? block.endIndex : block.startIndex, // Anchor point is opposite edge
            currentIndex: edge === 'left' ? block.startIndex : block.endIndex,
            edge,
            originalBlock: block
        });
    };

    const handleMouseUp = useCallback(() => {
        if (!interactionState.type) return;

        if (interactionState.type === 'select' || interactionState.type === 'resize') {
            const { startResId, startIndex, currentIndex, originalBlock } = interactionState;
            if (startResId && startIndex !== null && currentIndex !== null) {

                const start = Math.min(startIndex, currentIndex);
                const end = Math.max(startIndex, currentIndex);

                let canApply = true;
                const newRange: string[] = [];
                for (let i = start; i <= end; i++) {
                    if (isSlotBlocked(startResId, timeSlots[i])) {
                        canApply = false;
                        break;
                    }
                    newRange.push(`${startResId}|${timeSlots[i]}`);
                }

                if (canApply) {
                    if (interactionState.type === 'select' && start === end) {
                        // Single click toggle logic
                        toggleSlot(startResId, timeSlots[start]);
                    } else {
                        // Apply range logic
                        // If replacing, remove the original block first
                        let currentSlots = [...selectedSlots];
                        if (originalBlock) {
                            currentSlots = currentSlots.filter(s => {
                                const [r, t] = s.split('|');
                                const idx = timeSlots.indexOf(t);
                                return !(r === originalBlock.resId && idx >= originalBlock.startIndex && idx <= originalBlock.endIndex);
                            });
                        }

                        // Add new range, but dedup
                        const finalSlots = Array.from(new Set([...currentSlots, ...newRange]));
                        replaceSlots(finalSlots);
                    }
                }
            }
        }

        setInteractionState({ type: null, startResId: null, startIndex: null, currentIndex: null });
    }, [interactionState, timeSlots, selectedSlots, replaceSlots, toggleSlot]);

    useEffect(() => {
        if (interactionState.type) {
            window.addEventListener('mouseup', handleMouseUp);
            return () => window.removeEventListener('mouseup', handleMouseUp);
        }
    }, [interactionState.type, handleMouseUp]);


    // --- Drag and Drop for Moving Blocks ---
    const handleDragStart = (e: React.DragEvent, block: SelectionBlock) => {
        e.dataTransfer.setData('text/plain', JSON.stringify(block));
        // Use a transparent ghost image
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);

        setInteractionState({
            type: 'move',
            startResId: block.resId,
            startIndex: block.startIndex,
            currentIndex: block.startIndex,
            originalBlock: block
        });
    };

    const handleDragOver = (e: React.DragEvent, destResId: string, destIndex: number) => {
        e.preventDefault(); // Necessary to allow dropping
        if (interactionState.type === 'move') {
            setInteractionState(prev => {
                if (prev.startResId !== destResId || prev.currentIndex !== destIndex) {
                    return { ...prev, startResId: destResId, currentIndex: destIndex };
                }
                return prev;
            });
        }
    };

    const handleDrop = (e: React.DragEvent, destResId: string, destIndex: number) => {
        e.preventDefault();
        try {
            const blockDataStr = e.dataTransfer.getData('text/plain');
            if (!blockDataStr) return;
            const block: SelectionBlock = JSON.parse(blockDataStr);

            const duration = block.endIndex - block.startIndex;
            const newStart = destIndex;
            const newEnd = destIndex + duration;

            if (newEnd >= timeSlots.length) return; // Dropped too close to the end of the day

            // Check if new range is free
            let canMove = true;
            const newRange: string[] = [];
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotBlocked(destResId, timeSlots[i])) {
                    canMove = false;
                    break;
                }
                newRange.push(`${destResId}|${timeSlots[i]}`);
            }

            if (canMove) {
                let currentSlots = [...selectedSlots];
                // Remove the old block
                currentSlots = currentSlots.filter(s => {
                    const [r, t] = s.split('|');
                    const idx = timeSlots.indexOf(t);
                    return !(r === block.resId && idx >= block.startIndex && idx <= block.endIndex);
                });

                // Add new block
                const finalSlots = Array.from(new Set([...currentSlots, ...newRange]));
                replaceSlots(finalSlots);
            }
        } catch (err) {
            console.error("Drop failed", err);
        } finally {
            setInteractionState({ type: null, startResId: null, startIndex: null, currentIndex: null });
        }
    };


    // Helpers for rendering active state previews
    const getActivePreviewBlock = (resId: string): SelectionBlock | null => {
        if (!interactionState.type || interactionState.startResId !== resId) return null;
        if (interactionState.startIndex === null || interactionState.currentIndex === null) return null;

        if (interactionState.type === 'select' || interactionState.type === 'resize') {
            const start = Math.min(interactionState.startIndex, interactionState.currentIndex);
            const end = Math.max(interactionState.startIndex, interactionState.currentIndex);
            return { resId, startIndex: start, endIndex: end };
        }

        if (interactionState.type === 'move' && interactionState.originalBlock) {
            const duration = interactionState.originalBlock.endIndex - interactionState.originalBlock.startIndex;
            const end = interactionState.currentIndex + duration;
            // Bound check
            if (end >= timeSlots.length) return { resId, startIndex: timeSlots.length - 1 - duration, endIndex: timeSlots.length - 1 };
            return { resId, startIndex: interactionState.currentIndex, endIndex: end };
        }

        return null;
    };

    const isSlotInPreview = (resId: string, index: number) => {
        const previewBlock = getActivePreviewBlock(resId);
        if (!previewBlock) return false;
        return index >= previewBlock.startIndex && index <= previewBlock.endIndex;
    };
    // --- End Interaction Logic ---

    // Helper: isSlotBlocked (simplified version from ChessboardStep)
    const isSlotBlocked = (resId: string, timeStr: string) => {
        const slotDate = new Date(date);
        const [h, m] = timeStr.split(':').map(Number);
        slotDate.setHours(h, m, 0, 0);

        // 3 Hour buffer
        if (isBefore(slotDate, addMinutes(new Date(), 180))) {
            return true;
        }

        // Internal Bookings
        const internalBooking = bookings.find(b =>
            b.resourceId === resId &&
            b.status === 'confirmed' &&
            !b.isReRentListed &&
            isSameDay(new Date(b.date), new Date(date)) &&
            b.startTime &&
            (() => {
                const bookingStart = Number(b.startTime.split(':')[0]) * 60 + Number(b.startTime.split(':')[1]);
                const bookingEnd = bookingStart + b.duration;
                const slotStart = Number(timeStr.split(':')[0]) * 60 + Number(timeStr.split(':')[1]);
                const slotEnd = slotStart + 30;
                return slotStart < bookingEnd && slotEnd > bookingStart;
            })()
        );
        if (internalBooking) return true;

        // External Events (Mock)
        const events = googleCalendarService.getEvents(resId);
        const externalEvent = events.find(e => {
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
            const isCoveredByReRent = bookings.some(b =>
                b.resourceId === resId &&
                b.status === 'confirmed' &&
                b.isReRentListed &&
                isSameDay(new Date(b.date), new Date(date)) &&
                b.startTime &&
                (() => {
                    const bookingStart = Number(b.startTime.split(':')[0]) * 60 + Number(b.startTime.split(':')[1]);
                    const bookingEnd = bookingStart + b.duration;
                    const slotStart = Number(timeStr.split(':')[0]) * 60 + Number(timeStr.split(':')[1]);
                    return slotStart >= bookingStart && slotStart < bookingEnd;
                })()
            );
            if (isCoveredByReRent) return false;
            return true;
        }

        return false;
    };


    // Date Picker Logic
    const dates = Array.from({ length: 7 }).map((_, i) => addDays(new Date(), i));

    return (
        <div className="space-y-6">
            <div className="flex overflow-x-auto pb-4 gap-2 no-scrollbar">
                {dates.map(d => {
                    const active = isSameDay(d, date);
                    return (
                        <button
                            key={d.toISOString()}
                            onClick={() => setDate(d)}
                            className={clsx(
                                "flex-shrink-0 flex flex-col items-center justify-center w-16 h-20 rounded-2xl transition-all border",
                                active ? "bg-unbox-green text-white border-unbox-green shadow-md" : "bg-white text-gray-600 border-gray-200 hover:border-unbox-green/50"
                            )}
                        >
                            <span className={clsx("text-xs font-medium uppercase", active ? "text-unbox-light" : "text-gray-400")}>
                                {format(d, 'EEE', { locale: ru })}
                            </span>
                            <span className="text-xl font-bold mt-1">{format(d, 'd')}</span>
                        </button>
                    );
                })}
            </div>

            <div className="space-y-4">
                {locationResources.map(res => (
                    <div key={res.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center gap-4">
                        <div className="w-full md:w-1/4">
                            <h3 className="font-semibold text-gray-900">{res.name}</h3>
                            <p className="text-sm text-gray-500">{res.capacity} чел. • {res.hourlyRate} ₾/ч</p>
                        </div>
                        <div className="flex-1 overflow-x-auto no-scrollbar pb-2 md:pb-0 relative">
                            <div className="flex gap-1 min-w-max relative custom-slots-container">
                                {/* Base Time Slots Layer */}
                                {timeSlots.map((time, index) => {
                                    const blocked = isSlotBlocked(res.id, time);

                                    // Visual cue for drag preview (only visual, actual overlay handles interaction later)
                                    const isPreview = isSlotInPreview(res.id, index);
                                    const isMovingOriginal = interactionState.type === 'move' &&
                                        interactionState.originalBlock?.resId === res.id &&
                                        index >= interactionState.originalBlock.startIndex &&
                                        index <= interactionState.originalBlock.endIndex;

                                    return (
                                        <button
                                            key={time}
                                            onMouseDown={() => handleSlotMouseDown(res.id, index)}
                                            onMouseEnter={() => handleMouseEnter(res.id, index)}
                                            onDragOver={(e) => handleDragOver(e, res.id, index)}
                                            onDrop={(e) => handleDrop(e, res.id, index)}
                                            disabled={blocked}
                                            className={clsx(
                                                "flex flex-col items-center justify-center w-12 h-14 rounded-lg transition-all text-xs font-medium relative border group select-none flex-shrink-0",
                                                isPreview
                                                    ? "bg-unbox-light border-unbox-green/50 border-dashed opacity-50"
                                                    : isMovingOriginal
                                                        ? "bg-gray-50 border-gray-200 opacity-20"
                                                        : blocked
                                                            ? "bg-gray-100 border-transparent text-transparent cursor-not-allowed opacity-60 styling-blocked"
                                                            : "bg-unbox-light/30 text-unbox-dark border-unbox-green/20 hover:bg-unbox-light hover:border-unbox-green/50 cursor-pointer"
                                            )}
                                        >
                                            {blocked && (
                                                <div className="absolute inset-x-0 mx-auto w-1 h-3/4 bg-gray-300 rounded-full transform rotate-45 pointer-events-none" />
                                            )}
                                            {!blocked && <span className={clsx("mb-1 pointer-events-none", isPreview ? "text-unbox-green/70" : "text-unbox-green/70")}>{time}</span>}
                                        </button>
                                    );
                                })}

                                {/* Selected Blocks Overlay Layer */}
                                {selectionBlocks.filter(b => b.resId === res.id).map((block, idx) => {
                                    // Hide original block if currently moving it
                                    if (interactionState.type === 'move' &&
                                        interactionState.originalBlock?.resId === block.resId &&
                                        interactionState.originalBlock?.startIndex === block.startIndex) {
                                        return null;
                                    }

                                    // Hide original block if resizing it (the preview handles reality)
                                    if (interactionState.type === 'resize' &&
                                        interactionState.originalBlock?.resId === block.resId &&
                                        interactionState.originalBlock?.startIndex === block.startIndex) {
                                        return null;
                                    }

                                    const leftPosition = block.startIndex * TOTAL_SLOT_WIDTH;
                                    const width = ((block.endIndex - block.startIndex) + 1) * SLOT_WIDTH + (block.endIndex - block.startIndex) * SLOT_GAP;

                                    return (
                                        <div
                                            key={`overlay-${res.id}-${idx}`}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, block)}
                                            style={{
                                                left: `${leftPosition}px`,
                                                width: `${width}px`
                                            }}
                                            className="absolute top-0 bottom-0 bg-unbox-green border-unbox-green shadow-md rounded-lg z-10 flex flex-col items-center justify-center cursor-move select-none group/overlay"
                                        >

                                            {/* Resize Handle - Left */}
                                            <div
                                                className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-20 group-hover/overlay:bg-unbox-green/30 rounded-l-lg flex items-center justify-center opacity-0 group-hover/overlay:opacity-100 transition-opacity"
                                                onMouseDown={(e) => handleResizeStart(e, block, 'left')}
                                            >
                                                <div className="w-[2px] h-4 bg-white/70 rounded-full" />
                                            </div>

                                            <span className="text-white text-xs font-bold pointer-events-none mb-1">
                                                {timeSlots[block.startIndex]}
                                                {block.startIndex !== block.endIndex ? ` - ${addMinutes(setMinutes(setHours(new Date(), Number(timeSlots[block.endIndex].split(':')[0])), Number(timeSlots[block.endIndex].split(':')[1])), 30).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}
                                            </span>
                                            <span className="text-[10px] text-unbox-light font-bold pointer-events-none">✓</span>

                                            {/* Resize Handle - Right */}
                                            <div
                                                className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-20 group-hover/overlay:bg-unbox-green/30 rounded-r-lg flex items-center justify-center opacity-0 group-hover/overlay:opacity-100 transition-opacity"
                                                onMouseDown={(e) => handleResizeStart(e, block, 'right')}
                                            >
                                                <div className="w-[2px] h-4 bg-white/70 rounded-full" />
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Active Preview Layer (Drag or Resize) */}
                                {(() => {
                                    const activeBlock = getActivePreviewBlock(res.id);
                                    if (!activeBlock) return null;

                                    const leftPosition = activeBlock.startIndex * TOTAL_SLOT_WIDTH;
                                    const width = ((activeBlock.endIndex - activeBlock.startIndex) + 1) * SLOT_WIDTH + (activeBlock.endIndex - activeBlock.startIndex) * SLOT_GAP;

                                    // Validate if preview is blocking
                                    let isConflict = false;
                                    for (let i = activeBlock.startIndex; i <= activeBlock.endIndex; i++) {
                                        if (isSlotBlocked(res.id, timeSlots[i])) isConflict = true;
                                    }

                                    return (
                                        <div
                                            style={{
                                                left: `${leftPosition}px`,
                                                width: `${width}px`
                                            }}
                                            className={clsx(
                                                "absolute top-0 bottom-0 rounded-lg z-20 flex flex-col items-center justify-center pointer-events-none transition-all duration-75",
                                                isConflict
                                                    ? "bg-red-500/50 border-2 border-red-500 shadow-sm"
                                                    : "bg-unbox-green/80 border-2 border-unbox-green/60 shadow-md backdrop-blur-[2px]"
                                            )}
                                        />
                                    );
                                })()}

                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
