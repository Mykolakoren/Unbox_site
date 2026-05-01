import { formatInTimeZone } from 'date-fns-tz';
import type { Locale } from 'date-fns';

/** The center is in Batumi, Georgia. We render every business-side date in this
 *  zone so the admin sees what they expect regardless of where their browser thinks
 *  it is. Asia/Tbilisi covers all of Georgia (no separate Batumi tz).
 */
export const BATUMI_TZ = 'Asia/Tbilisi';

/**
 * Parse a date string from the backend as UTC.
 * Backend stores naive datetimes in UTC — no timezone suffix.
 * This helper appends "Z" so JS Date treats them correctly.
 */
export function parseUTC(d: string | Date): Date {
    if (d instanceof Date) return d;
    const s = String(d);
    return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
}

/**
 * Format a date in Batumi (Asia/Tbilisi) timezone using a date-fns format string.
 *
 * Use this for any user-facing time/date display in finance, shifts, transactions,
 * audit logs — basically anywhere "what time did this happen at the centre" matters.
 * Don't use plain date-fns `format()` for those, it'll show whatever the browser's
 * local zone is (often London/UTC for admins on VPNs).
 *
 *   formatBatumi(parseUTC(tx.date), 'HH:mm')          // "14:30"
 *   formatBatumi(parseUTC(tx.date), 'd MMM yyyy', ru) // "20 янв 2026"
 */
export function formatBatumi(d: string | Date | null | undefined, fmt: string, locale?: Locale, fallback: string = ''): string {
    // Defensive: a null/undefined/invalid date is the most common cause
    // of "Invalid time value" RangeErrors in admin pages. Return a
    // fallback string instead of throwing, so one bad row in
    // transactions/timeline/etc doesn't blow up the whole page.
    if (d === null || d === undefined || d === '') return fallback;
    try {
        const date = typeof d === 'string' ? parseUTC(d) : d;
        if (!(date instanceof Date) || isNaN(date.getTime())) return fallback;
        return formatInTimeZone(date, BATUMI_TZ, fmt, locale ? { locale } : undefined);
    } catch {
        return fallback;
    }
}

/**
 * Format a date only if the input is present and valid. Returns fallback
 * otherwise — never throws "Invalid time value".
 *
 * Shipping data (merged users, imported bookings, CRM sessions from old
 * exports) regularly has null / undefined / empty-string date fields.
 * Calling `format(new Date(undefined), …)` throws RangeError and takes the
 * whole admin page down with an ErrorBoundary. Use this instead:
 *
 *   safeFormat(user.registrationDate, 'd.MM.yyyy')  // '' if missing
 *   safeFormat(booking.date, 'd MMM yyyy', ru, '—') // '—' if missing
 */
export function safeFormat(
    d: string | Date | null | undefined,
    fmt: string,
    locale?: Locale,
    fallback: string = '',
): string {
    if (d === null || d === undefined || d === '') return fallback;
    try {
        const date = typeof d === 'string' ? new Date(d) : d;
        if (isNaN(date.getTime())) return fallback;
        return formatInTimeZone(date, BATUMI_TZ, fmt, locale ? { locale } : undefined);
    } catch {
        return fallback;
    }
}
