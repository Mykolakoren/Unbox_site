/**
 * Booking helpers — общие утилиты для MyBookingsPage и CrmBookings.
 *
 * Раньше каждый файл имел свои копии этих функций с расходящимися
 * реализациями (особенно safeFormat: один принимал raw-строку,
 * другой — Date). Это создавало риск двойного багфикса и тонких
 * отличий в форматировании дат между клиентским и спец-режимом.
 *
 * См. docs/REFACTOR-BOOKINGS-UNIFICATION.md — Фаза 1.
 *
 * Owner 2026-06-05.
 */

import {
    format as fmtDate,
    setHours, setMinutes, startOfToday, isBefore, addMinutes,
} from 'date-fns';
import type { BookingHistoryItem } from '../store/types';
// `parseUTC` живёт в dateUtils — здесь только реэкспорт, чтобы старый
// импорт `from '../utils/bookingHelpers'` продолжал работать.
export { parseUTC } from './dateUtils';
import { parseUTC } from './dateUtils';

/** Шахматка: 09:00–22:00 с шагом 30 мин — единственный набор слотов
 *  для всех ролей (Admin/Crm/Mobile). Раньше каждый файл строил тот же
 *  массив локально; в случае изменения часов работы пришлось бы править
 *  в трёх местах.
 *
 *  Owner 2026-06-06 (Фаза 3 — см. docs/REFACTOR-BOOKINGS-UNIFICATION.md). */
export const TIME_SLOTS: string[] = (() => {
    const slots: string[] = [];
    let t = setMinutes(setHours(startOfToday(), 9), 0);
    const end = setMinutes(setHours(startOfToday(), 22), 0);
    while (isBefore(t, end)) {
        slots.push(fmtDate(t, 'HH:mm'));
        t = addMinutes(t, 30);
    }
    return slots;
})();

/** «09:30» → 570. Защитная версия (раньше в CrmChessboardView была голая
 *  `[h,m] = t.split(':').map(Number)` которая взрывалась на пустых
 *  строках из drag-handlers). */
export function timeToMin(t: string | undefined | null): number {
    if (!t || typeof t !== 'string' || !t.includes(':')) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/** date-fns `format()` бросает RangeError на Invalid Date — и под
 *  ErrorBoundary падает весь tree. После массового merge'а архивных
 *  аккаунтов появились брони с null в `createdAt` / `date`. Эта обёртка
 *  ловит invalid input и возвращает fallback. Принимает либо raw-строку,
 *  либо Date — поведение обоих оригинальных хелперов.
 *
 *  ВАЖНО: форматирует в браузерном TZ, не в Batumi. Для админских
 *  страниц (финансы, аудит) используй `safeFormat` из dateUtils.ts —
 *  он Batumi-TZ-aware. Эта версия только для бронь-страниц, где
 *  оригинальный код всегда был browser-local. */
export function safeFormat(
    d: string | Date | null | undefined,
    fmt: string,
    opts?: any,
    fallback = '—',
): string {
    if (d === null || d === undefined || d === '') return fallback;
    try {
        const dt = typeof d === 'string' ? parseUTC(d) : d;
        if (!(dt instanceof Date) || isNaN(dt.getTime())) return fallback;
        return fmtDate(dt, fmt, opts);
    } catch {
        return fallback;
    }
}

/** Безопасное извлечение даты+времени из брони — устойчиво к мусорным
 *  строкам типа `"2025-12-25T... 12:00"`, которые иногда попадают из
 *  legacy кода. Возвращает оба: `dateStr` (yyyy-MM-dd) для группировки
 *  и `dateObj` для форматирования. */
export function getSafeBookingDate(
    booking: BookingHistoryItem,
): { dateStr: string; dateObj: Date | null } {
    try {
        const rawDate = booking.date as any;
        let dateStr: string;
        if (rawDate instanceof Date) {
            dateStr = rawDate.toISOString().split('T')[0];
        } else if (typeof rawDate === 'string') {
            // Drop corrupted ' 12:00' suffix (старый bug) и timezone offset.
            dateStr = rawDate.replace(' 12:00', '').split('T')[0].split(' ')[0];
        } else {
            return { dateStr: '', dateObj: null };
        }

        if (!dateStr || dateStr.length < 8) return { dateStr, dateObj: null };

        const timeStr = booking.startTime && /^\d{2}:\d{2}/.test(booking.startTime)
            ? booking.startTime
            : '00:00';
        const d = new Date(`${dateStr}T${timeStr}`);
        if (isNaN(d.getTime())) return { dateStr, dateObj: null };
        return { dateStr, dateObj: d };
    } catch {
        return { dateStr: '', dateObj: null };
    }
}

/** Прошедшая ли бронь — по концу слота, не по началу. Бронь 17:00-18:00
 *  считается «текущей» до 18:00, а не «прошедшей» с 17:01. */
export function isPastBooking(booking: BookingHistoryItem): boolean {
    const { dateObj } = getSafeBookingDate(booking);
    if (!dateObj) return false;
    const durationMin = booking.duration ?? 60;
    const end = new Date(dateObj.getTime() + durationMin * 60_000);
    return end.getTime() < Date.now();
}

/** Человекочитаемая длительность.
 *  - `<60` мин → «N мин»
 *  - точное кол-во часов → «N ч»
 *  - с половиной часа → «N.5 ч»
 *  - иначе → «N ч M мин» */
export function formatBookingDuration(min: number): string {
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (m === 0) return `${h} ч`;
    if (m === 30) return `${h}.5 ч`;
    return `${h} ч ${m} мин`;
}

/** Единый словарь статусов брони → русская подпись.
 *  Прошедшее время, ж.р. (бронь — она). Используется в карточках,
 *  фильтрах, бейджах. */
export const BOOKING_STATUS_LABELS: Record<string, string> = {
    confirmed: 'Подтверждена',
    pending_approval: 'Ожидает',
    completed: 'Завершена',
    cancelled: 'Отменена',
    rescheduled: 'Перенесена',
    're-rented': 'Пересдана',
    no_show: 'Не пришёл',
};

export function getStatusLabel(status: string): string {
    return BOOKING_STATUS_LABELS[status] ?? status;
}

/** Принадлежность статуса к «прошлому» (для дефолтного скрытия в
 *  списках). Завершённые, отменённые, перенесённые, пересданные,
 *  no-show — все «прошедшие». Активные — `confirmed` и
 *  `pending_approval`. */
export const PAST_STATUSES = new Set([
    'cancelled',
    'completed',
    'rescheduled',
    're-rented',
    'no_show',
]);

export function isPastStatus(status: string): boolean {
    return PAST_STATUSES.has(status);
}
