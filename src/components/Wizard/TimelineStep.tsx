import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { addMinutes, format, isBefore, setHours, setMinutes, startOfToday } from 'date-fns';
import clsx from 'clsx';
import { useMemo } from 'react';

// Helpers
const timeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};
const minutesToTime = (total: number) => {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

import { googleCalendarService } from '../../services/googleCalendarMock';
import type { ExternalEvent } from '../../services/googleCalendarMock';
import { useState, useEffect } from 'react';

// ...

export function TimelineStep() {
    const { resourceId, startTime, duration, setTimeRange, date, editBookingId } = useBookingStore();
    const bookings = useUserStore(s => s.bookings);
    const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);

    useEffect(() => {
        if (resourceId) {
            setExternalEvents(googleCalendarService.getEvents(resourceId));
        }
    }, [resourceId]);

    // Generate slots 09:00 to 21:00 (last slot starts at 20:30)
    const slots = useMemo(() => {
        const result = [];
        let time = setMinutes(setHours(startOfToday(), 9), 0);
        const end = setMinutes(setHours(startOfToday(), 21), 0);

        while (isBefore(time, end)) {
            result.push(format(time, 'HH:mm'));
            time = addMinutes(time, 30);
        }
        return result;
    }, []);

    // Calculate blocked slots based on existing bookings AND external events
    const blockedSlots = useMemo(() => {
        if (!resourceId) return [];

        const busySlots: string[] = [];

        // 1. Internal Bookings
        const relevantBookings = bookings ? bookings.filter(b =>
            b.resourceId === resourceId &&
            format(new Date(b.date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd') &&
            b.status === 'confirmed'
        ) : [];

        console.log('[Timeline Debug] Relevant Bookings for', format(date, 'yyyy-MM-dd'), relevantBookings);

        relevantBookings.forEach(booking => {
            // If it's the booking we are currently editing, ignore it (don't block)
            if (booking.id === editBookingId) return;

            // If it is listed for Re-Rent, ignore it (don't block)
            // Note: We explicitly check for true to specificy intent
            if (booking.isReRentListed) {
                console.log('[Timeline Debug] Skipping Re-Rented Booking:', booking.id, booking.startTime);
                return;
            }

            if (booking.startTime) {
                const startMins = timeToMinutes(booking.startTime);
                const endMins = startMins + booking.duration;
                console.log('[Timeline Debug] Blocking Internal:', booking.startTime, 'to', minutesToTime(endMins));
                for (let m = startMins; m < endMins; m += 30) {
                    busySlots.push(minutesToTime(m));
                }
            }
        });

        // 2. External Google Calendar Events
        externalEvents.forEach(event => {
            const eventStart = new Date(event.start);
            const eventEnd = new Date(event.end);

            if (format(eventStart, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')) {
                const startMins = eventStart.getHours() * 60 + eventStart.getMinutes();
                const endMins = eventEnd.getHours() * 60 + eventEnd.getMinutes();

                // Check overlap with ANY Re-Rent listed booking
                const overlapsReRent = relevantBookings.some(b =>
                    b.isReRentListed &&
                    b.startTime &&
                    timeToMinutes(b.startTime) < endMins &&
                    (timeToMinutes(b.startTime) + b.duration) > startMins
                );

                if (!overlapsReRent) {
                    console.log('[Timeline Debug] Blocking External:', minutesToTime(startMins), 'to', minutesToTime(endMins));
                    for (let m = startMins; m < endMins; m += 30) {
                        const timeStr = minutesToTime(m);
                        if (!busySlots.includes(timeStr)) {
                            busySlots.push(timeStr);
                        }
                    }
                } else {
                    console.log('[Timeline Debug] Skipping External Event due to Re-Rent overlap');
                }
            }
        });

        return busySlots;
    }, [bookings, resourceId, date, editBookingId, externalEvents]);

    const handleSlotClick = (slotTime: string) => {
        if (blockedSlots.includes(slotTime)) return;

        // Logic: 
        // 1. If nothing selected -> select this as start (duration 60 min default? Or just start).
        // 2. If start selected -> select this as end (if valid).
        // 3. If range selected -> reset and select this as new start.

        // Current simplified logic for "Range":
        // Click -> Start. 
        // If clicking after start -> extend range.
        // If clicking before start -> new Start.
        // If clicking existing start -> deselect?

        // Let's implement: Click = Set/Update range. 
        // If we have no start, or we click an earlier slot -> New Start (1h duration default min).
        // If we click a later slot -> New End.

        // For T.Z.: "Минимальная длительность 1 час" -> selecting a slot implicitly means 2 slots (30+30).

        const slotMinutes = timeToMinutes(slotTime);
        const currentStartMinutes = startTime ? timeToMinutes(startTime) : null;

        // Reset if clicking before or too far new interaction
        if (currentStartMinutes === null || slotMinutes < currentStartMinutes || (duration > 0 && slotMinutes === currentStartMinutes)) {
            // New Start (min 1 hour = 2 slots)
            // Check if next slot is blocked
            const nextSlot = minutesToTime(slotMinutes + 30);
            if (blockedSlots.includes(slotTime) || blockedSlots.includes(nextSlot)) {
                // Cant select this as start if it overlaps block
                // Actually singular slot click just selects it as start? 
                // T.Z. says "Min duration 1 hour". So we need at least 2 slots free.
                // We will select 1h by default if possible.
            }

            // Try to set 1 hour range
            setTimeRange(slotTime, 60);
        } else {
            // Extend range
            // Calculate new duration
            // Check for blocks in between
            const newDuration = slotMinutes - currentStartMinutes + 30; // End of clicked slot

            // Validation: Check all slots in range
            let valid = true;
            for (let m = currentStartMinutes; m < currentStartMinutes + newDuration; m += 30) {
                if (blockedSlots.includes(minutesToTime(m))) {
                    valid = false;
                    break;
                }
            }

            if (valid) {
                setTimeRange(minutesToTime(currentStartMinutes), newDuration);
            } else {
                // Invalid range due to collision, treat as new start
                setTimeRange(slotTime, 60);
            }
        }
    };

    const isSlotSelected = (slot: string) => {
        if (!startTime) return false;
        const s = timeToMinutes(slot);
        const start = timeToMinutes(startTime);
        const end = start + duration;
        return s >= start && s < end;
    };

    // Check if slot is range start/end for styling
    const getSlotStyle = (slot: string) => {
        const isSelected = isSlotSelected(slot);
        if (!isSelected) return 'bg-white border-gray-200 hover:border-gray-300';

        if (blockedSlots.includes(slot)) return 'bg-gray-100 cursor-not-allowed opacity-50 stripe-bg';

        // It is selected
        return 'bg-blue-50 border-blue-500 text-blue-700 font-medium z-10';
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-bold mb-2">Выберите время</h2>
                <p className="text-gray-500">Минимальная длительность — 1 час. Рабочее время 09:00–21:00.</p>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                {slots.map((slot) => {
                    const isBusy = blockedSlots.includes(slot);
                    const selected = isSlotSelected(slot);

                    return (
                        <button
                            key={slot}
                            disabled={isBusy}
                            onClick={() => handleSlotClick(slot)}
                            className={clsx(
                                "relative py-3 rounded-lg border text-sm transition-all focus:outline-none",
                                isBusy
                                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                    : getSlotStyle(slot),
                                selected && !isBusy && "ring-1 ring-blue-500"
                            )}
                        >
                            {slot}
                            {isBusy && (
                                <span className="absolute inset-0 flex items-center justify-center opacity-20">
                                    /
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Legend */}
            <div className="flex gap-6 text-sm text-gray-500 justify-center pt-4">
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded border border-gray-200 bg-white"></div>
                    <span>Свободно</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded border border-gray-200 bg-gray-100"></div>
                    <span>Занято</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-blue-50 border border-blue-500"></div>
                    <span>Выбрано</span>
                </div>
            </div>
        </div>
    );
}
