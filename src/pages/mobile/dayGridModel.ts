import { LOCATIONS, RESOURCES } from '../../utils/data';
import { isLocationOpenOn } from '../../utils/locationDates';
import type { BookingHistoryItem } from '../../store/types';
import type { Resource } from '../../types';

/* Сетка дня на «Свободно» (шаг 2 плана мобильной брони, 28.11.2026).
 *
 * Раньше день показывался списком «время → кнопки кабинетов»: занятого времени
 * в нём не было вовсе, и картину дня приходилось собирать в голове. С 30.11
 * в аренду три кабинета одного центра — они помещаются на экран тремя
 * колонками. Здесь только расчёт (без React): какие кабинеты показать, где у
 * каждого занято, сколько свободно подряд от выбранного начала.
 *
 * КТО РЕШАЕТ, МОЖНО ЛИ НАЧАТЬ В ЭТО ВРЕМЯ: по-прежнему buildFreeWindows в
 * MobileFind (те же правила, что были у списка: прошедшее время, «задним
 * числом» админа, срочные окна при переносе). Сетка только рисует день и
 * считает, на сколько можно растянуть бронь от выбранного начала. */

export const GRID_START_MIN = 9 * 60;
export const GRID_END_MIN = 22 * 60;
export const GRID_STEP_MIN = 30;

export type GridBlockKind = 'busy' | 'mine' | 'rerent';

export interface GridBlock {
    key: string;
    kind: GridBlockKind;
    /** Минуты от начала суток, обрезаны рабочим днём сетки (9:00–22:00). */
    startMin: number;
    endMin: number;
    /** Своя бронь, выставленная на пересдачу: остаётся «вашей» и открывается. */
    listed?: boolean;
    booking: BookingHistoryItem;
}

export interface GridColumn {
    room: Resource;
    blocks: GridBlock[];
    /** Начала получасовых ячеек, которые заняты. Пересдача сюда НЕ входит:
     *  такой слот можно забрать (сервер вернёт половину прежнему арендатору). */
    busy: Set<number>;
}

/** Кабинеты, которые сдаются в этот день: работающие центры, без Neo School и
 *  закрытых кабинетов. Тот же отбор, что у buildFreeWindows с «все центры и все
 *  типы». Порядок постоянный (центр, затем номер кабинета): колонки не должны
 *  меняться местами от дня ко дню. */
export function roomsOpenOn(dayKey: string, locationIds: readonly string[]): Resource[] {
    const locOrder = (id?: string) => {
        const i = LOCATIONS.findIndex(l => l.id === id);
        return i === -1 ? 99 : i;
    };
    return RESOURCES
        .filter(r => !!r.locationId
            && locationIds.includes(r.locationId)
            && r.isActive !== false
            && isLocationOpenOn(r.locationId, dayKey))
        .sort((a, b) => (locOrder(a.locationId) - locOrder(b.locationId))
            || ((a.sortOrder ?? 99) - (b.sortOrder ?? 99)));
}

/** Колонки дня. dayBookings — брони ЭТОГО дня, которые держат время
 *  (подтверждённые и «на подтверждении»); отбор по дню и статусу делает экран. */
export function buildDayColumns(
    dayBookings: BookingHistoryItem[],
    rooms: Resource[],
    isOwn: (b: BookingHistoryItem) => boolean,
): GridColumn[] {
    const byRoom = new Map<string, GridColumn>();
    for (const room of rooms) byRoom.set(room.id, { room, blocks: [], busy: new Set() });

    for (const b of dayBookings) {
        const col = b.resourceId ? byRoom.get(b.resourceId) : undefined;
        if (!col || !b.startTime) continue;
        const [h, m] = b.startTime.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        const rawStart = h * 60 + m;
        const rawEnd = rawStart + (b.duration ?? 60);
        const startMin = Math.max(GRID_START_MIN, rawStart);
        const endMin = Math.min(GRID_END_MIN, rawEnd);
        if (endMin <= startMin) continue;
        // Своя бронь — всегда «ваша», даже выставленная на пересдачу: её надо уметь
        // открыть (снять с пересдачи), а бронировать поверх собственной незачем.
        const kind: GridBlockKind = isOwn(b) ? 'mine' : b.isReRentListed ? 'rerent' : 'busy';
        col.blocks.push({ key: String(b.id), kind, startMin, endMin, listed: kind === 'mine' && !!b.isReRentListed, booking: b });
        // Чужая пересдача — не занято: слот можно забрать.
        if (kind === 'rerent') continue;
        // Занята каждая ячейка, которую бронь задевает, — в том числе бронь с
        // началом в :15 или :45 (их ставит админ): она закрывает обе соседние ячейки.
        for (let t = GRID_START_MIN; t < GRID_END_MIN; t += GRID_STEP_MIN) {
            if (t < rawEnd && t + GRID_STEP_MIN > rawStart) col.busy.add(t);
        }
    }
    for (const col of byRoom.values()) col.blocks.sort((a, b) => a.startMin - b.startMin);
    return rooms.map(r => byRoom.get(r.id)!);
}

/** Сколько минут подряд свободно от startMin: до ближайшей занятой ячейки или
 *  до закрытия, но не больше capMin. 0 — сама ячейка занята. */
export function freeRunMin(col: GridColumn, startMin: number, capMin: number): number {
    let t = startMin;
    while (t < GRID_END_MIN && t - startMin < capMin && !col.busy.has(t)) t += GRID_STEP_MIN;
    return Math.min(t - startMin, capMin);
}

/** Задевает ли отрезок [startMin, endMin) пересдаваемую бронь. */
export function touchesReRent(col: GridColumn, startMin: number, endMin: number): boolean {
    return col.blocks.some(b => b.kind === 'rerent' && b.startMin < endMin && b.endMin > startMin);
}
