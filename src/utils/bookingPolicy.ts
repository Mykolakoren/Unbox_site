import { tbilisiNow } from './dateUtils';

/**
 * Зеркало backend services/booking_policy.is_hot_start — «срочное» окно брони:
 *   • до начала не больше 12 ч (в субботу и воскресенье — 24 ч);
 *   • или сейчас после 21:00 по Тбилиси, а бронь — на завтра до 12:00.
 * Время — Тбилиси (UTC+4). `ymd` — день брони «ГГГГ-ММ-ДД», `startMin` —
 * минуты от полуночи. Сервер переносит не-админа в такое окно только через
 * администратора (HOT_MOVE_REFUSAL), если старое время не было срочным.
 */
export function isHotStart(ymd: string, startMin: number, nowMs: number = Date.now()): boolean {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const startUtcMs = Date.UTC(y, mo - 1, d, 0, startMin) - 4 * 3600_000;
    const diffH = (startUtcMs - nowMs) / 3600_000;
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 — вс, 6 — сб
    const threshold = dow === 0 || dow === 6 ? 24 : 12;
    const now = tbilisiNow();
    const [ny, nm, nd] = now.ymd.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(ny, nm - 1, nd + 1));
    const isTomorrow = tomorrow.getUTCFullYear() === y && tomorrow.getUTCMonth() === mo - 1 && tomorrow.getUTCDate() === d;
    const eveningNextMorning = now.h >= 21 && isTomorrow && startMin < 12 * 60;
    return (diffH > 0 && diffH <= threshold) || (diffH > 0 && eveningNextMorning);
}

/** «ГГГГ-ММ-ДД» локальной даты (день брони в сторе хранится полуночью). */
export function ymdOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
