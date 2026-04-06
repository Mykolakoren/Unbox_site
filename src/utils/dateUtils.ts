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
