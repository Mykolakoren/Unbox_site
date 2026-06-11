import { useBookingStore } from '../../store/bookingStore';
import { RESOURCES } from '../../utils/data';
import type { BookingHistoryItem } from '../../store/types';

/**
 * Schedule a fresh booking on the next same-weekday occurrence of `source`.
 *
 * Loads the checkout wizard at OptionsStep with the cabinet, time, format,
 * and duration prefilled — user still confirms / can edit. Returns the
 * resolved target date so callers can show "забронируем на …" feedback.
 *
 * Returns null if the source booking lacks `resourceId` or `startTime`.
 */
export function prepareRepeat(source: BookingHistoryItem): Date | null {
    if (!source.resourceId || !source.startTime) return null;

    const sourceDt = bookingStartDate(source);
    const targetWeekday = sourceDt ? sourceDt.getDay() : new Date().getDay();

    let pick = new Date();
    pick.setDate(pick.getDate() + 1);
    pick.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
        if (pick.getDay() === targetWeekday) break;
        pick.setDate(pick.getDate() + 1);
    }

    const duration = source.duration ?? 60;
    const [h, m] = source.startTime.split(':').map(Number);
    const startMin = h * 60 + m;
    const slotStrs: string[] = [];
    for (let t = startMin; t < startMin + duration; t += 30) {
        const hh = Math.floor(t / 60).toString().padStart(2, '0');
        const mm = (t % 60).toString().padStart(2, '0');
        slotStrs.push(`${source.resourceId}|${hh}:${mm}`);
    }

    const resource = RESOURCES.find(r => r.id === source.resourceId);
    useBookingStore.getState().reset();
    useBookingStore.setState({
        locationId: resource?.locationId || 'unbox_one',
        date: pick,
        format: source.format || 'individual',
        selectedSlots: slotStrs,
        // OptionsStep — user reviews format/extras before confirming.
        step: 3,
    });
    return pick;
}

function bookingStartDate(b: BookingHistoryItem): Date | null {
    try {
        const d = b.date instanceof Date ? b.date : new Date(b.date as any);
        if (isNaN(d.getTime()) || !b.startTime) return null;
        const [h, m] = b.startTime.split(':').map(Number);
        const out = new Date(d);
        out.setHours(h, m, 0, 0);
        return out;
    } catch { return null; }
}
