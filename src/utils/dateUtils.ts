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

// NOTE: A `parseLocal` helper used to live here that interpreted naive
// timestamps as browser-local. It was removed once the backend was made
// to normalise every TherapySession.date to UTC-naive at ingest — the
// rest of the table was already UTC-naive (sync_from_calendar produces
// UTC-naive). Use `parseUTC` for any DB-sourced timestamp; never reach
// for browser-local interpretation, the result depends on the user's
// machine TZ which is not always Tbilisi (e.g. admin on a UK VPN).

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

/** Tbilisi wall-clock "right now" — independent of the browser's timezone.
 *
 *  Returns `{ h, m, totalMins, ymd }` where:
 *    - h:    Tbilisi hour 0–23
 *    - m:    Tbilisi minute 0–59
 *    - totalMins: h*60 + m, handy for "is this slot in the past" comparisons
 *    - ymd:  Tbilisi calendar date as "YYYY-MM-DD"
 *
 *  Use this anywhere we previously called `new Date().getHours()` to decide
 *  if a Tbilisi-labelled slot is past — that pattern silently broke for
 *  admins/clients on a non-Tbilisi browser zone (UK VPN, traveller phone).
 */
export function tbilisiNow(): { h: number; m: number; totalMins: number; ymd: string } {
    const now = new Date();
    // Intl gives us the wall-clock hour/minute in Tbilisi regardless of
    // the host TZ. en-GB locale to guarantee 24h numeric format.
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: BATUMI_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    const y = get('year'), mo = get('month'), d = get('day');
    let h = parseInt(get('hour'), 10);
    if (Number.isNaN(h)) h = 0;
    if (h === 24) h = 0; // Some engines render "24:00" — normalise to 00:00.
    const m = parseInt(get('minute'), 10) || 0;
    return { h, m, totalMins: h * 60 + m, ymd: `${y}-${mo}-${d}` };
}
