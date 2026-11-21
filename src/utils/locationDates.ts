import { LOCATIONS, RESOURCES } from './data';
import { useBookingStore } from '../store/bookingStore';
import type { Location } from '../types';

/**
 * Даты работы филиала (переезд, владелец 21.11.2026).
 *
 * Палиашвили работает по 29.11, Абусеридзе по 30.11, UNBOX 99 — с 30.11. Раньше
 * экраны не знали «филиал закрыт с такого-то числа» и предлагали старые
 * кабинеты на декабрь. Решает сервер (services/location_dates.py), здесь —
 * чтобы закрытый кабинет вообще не предлагался на этот день.
 *
 * Источник дат: список филиалов с сервера (store), а пока он не загрузился —
 * запасная копия в utils/data.ts.
 */

function ymd(day: string | Date): string {
    if (typeof day === 'string') return day.slice(0, 10);
    const y = day.getFullYear();
    const m = String(day.getMonth() + 1).padStart(2, '0');
    const d = String(day.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function findLocation(locationId: string): Location | undefined {
    const loaded = useBookingStore.getState().locations.find(l => l.id === locationId);
    const fallback = LOCATIONS.find(l => l.id === locationId);
    if (!loaded) return fallback;
    // Сервер дат не отдал (он старше экрана или в базе их ещё нет) — берём
    // запасные из data.ts. Сравнение с null нестрогое: сервер шлёт null, а не «нет поля».
    if (loaded.openFrom == null && loaded.openUntil == null) return fallback ?? loaded;
    return loaded;
}

/** Работает ли филиал в этот день. Неизвестный филиал считаем работающим. */
export function isLocationOpenOn(locationId: string | undefined | null, day: string | Date): boolean {
    if (!locationId) return true;
    const loc = findLocation(locationId);
    if (!loc) return true;
    const d = ymd(day);
    if (loc.openFrom && d < loc.openFrom.slice(0, 10)) return false;
    if (loc.openUntil && d > loc.openUntil.slice(0, 10)) return false;
    return true;
}

/** То же по кабинету. Принимает сам кабинет или его id. */
export function isResourceOpenOn(
    resource: { locationId?: string } | string | undefined | null,
    day: string | Date,
): boolean {
    if (!resource) return true;
    const locationId = typeof resource === 'string'
        ? (useBookingStore.getState().resources.find(r => r.id === resource)
            ?? RESOURCES.find(r => r.id === resource))?.locationId
        : resource.locationId;
    return isLocationOpenOn(locationId, day);
}

/** Филиалы, которые ещё не закрылись насовсем к этому дню (для списков выбора). */
export function isLocationStillRunning(locationId: string | undefined | null, today: string | Date = new Date()): boolean {
    if (!locationId) return true;
    const loc = findLocation(locationId);
    if (!loc?.openUntil) return true;
    return ymd(today) <= loc.openUntil.slice(0, 10);
}

function ru(iso: string): string {
    const [, m, d] = iso.slice(0, 10).split('-');
    return `${d}.${m}`;
}

/** Короткое объяснение для человека, почему филиал в этот день недоступен; null — доступен. */
export function locationClosedReason(locationId: string | undefined | null, day: string | Date): string | null {
    if (!locationId || isLocationOpenOn(locationId, day)) return null;
    const loc = findLocation(locationId);
    if (!loc) return null;
    const d = ymd(day);
    if (loc.openFrom && d < loc.openFrom.slice(0, 10)) return `${loc.name} открывается ${ru(loc.openFrom)}`;
    if (loc.openUntil) return `${loc.name} работает по ${ru(loc.openUntil)} — дальше бронируйте UNBOX 99`;
    return null;
}
