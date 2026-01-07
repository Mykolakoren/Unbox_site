import { addMinutes, format, parse } from 'date-fns';

export interface CartBooking {
    id: string; // generated temp id
    resourceId: string;
    date: Date; // base date from store
    startTime: string;
    endTime: string;
    duration: number;
}

export function groupSlotsIntoBookings(selectedSlots: string[], baseDate: Date): CartBooking[] {
    if (selectedSlots.length === 0) return [];

    // 1. Group by Resource
    const slotsByResource: Record<string, string[]> = {};
    selectedSlots.forEach(slot => {
        const [resId, time] = slot.split('|');
        if (!slotsByResource[resId]) slotsByResource[resId] = [];
        slotsByResource[resId].push(time);
    });

    const bookings: CartBooking[] = [];

    // 2. Process each resource
    Object.entries(slotsByResource).forEach(([resId, times]) => {
        // Sort times
        const sortedTimes = times.sort();

        // Group adjacent
        let currentStart = sortedTimes[0];
        let currentDuration = 30;
        let lastTime = sortedTimes[0];

        for (let i = 1; i < sortedTimes.length; i++) {
            const time = sortedTimes[i];

            // Check if adjacent (current time == last time + 30m)
            const prevDate = parse(lastTime, 'HH:mm', baseDate);
            const currDate = parse(time, 'HH:mm', baseDate);
            const expectedDate = addMinutes(prevDate, 30);

            if (currDate.getTime() === expectedDate.getTime()) {
                // Adjacent -> Extend
                currentDuration += 30;
                lastTime = time;
            } else {
                // Gap -> Push current and start new
                bookings.push(createBooking(resId, currentStart, currentDuration, baseDate));

                currentStart = time;
                currentDuration = 30;
                lastTime = time;
            }
        }
        // Push last one
        bookings.push(createBooking(resId, currentStart, currentDuration, baseDate));
    });

    return bookings;
}

function createBooking(resourceId: string, startTime: string, duration: number, baseDate: Date): CartBooking {
    const start = parse(startTime, 'HH:mm', baseDate);
    const end = addMinutes(start, duration);
    return {
        id: `${resourceId}-${startTime}-${duration}`,
        resourceId,
        date: baseDate,
        startTime,
        endTime: format(end, 'HH:mm'),
        duration
    };
}
