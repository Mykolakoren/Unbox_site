import { LOCATIONS, RESOURCES } from './data';

/**
 * Филиал кассы по брони (волна 4, доработка 01.10).
 *
 * Приход «Принять оплату» должен попасть в остаток своего филиала. Если
 * филиал не указан, деньги в кассе есть, а в остатке ни Uni, ни One их нет.
 * Поэтому и телефон (TopupSheet), и компьютер (AddFundsModal) подставляют
 * филиал по кабинету брони — одной функцией.
 */

/** Филиалы кассы — только эти два (owner 2026-07-22). Neo School — локация
 *  для броней, но денег там не считают. */
export const CASH_BRANCHES = ['Unbox Uni', 'Unbox One'] as const;

/** Название локации брони по кабинету: «Unbox One» / «Unbox Uni» / «Neo School». */
export function branchOfBooking(b: { resourceId?: string | null }): string | undefined {
    const locId = RESOURCES.find(r => r.id === b.resourceId)?.locationId;
    return LOCATIONS.find(l => l.id === locId)?.name;
}

/** Филиал КАССЫ по брони: только Uni/One; иначе undefined — пусть админ выберет сам. */
export function cashBranchOfBooking(b: { resourceId?: string | null }): string | undefined {
    const name = branchOfBooking(b);
    return name && (CASH_BRANCHES as readonly string[]).includes(name) ? name : undefined;
}

/** Брони, которых не было и не будет: по ним филиал клиента не угадываем. */
const NOT_HELD = new Set(['cancelled', 'rescheduled', 're-rented']);

/** Ключ «дата время» для сравнения: yyyy-MM-dd HH:mm (дата бывает строкой и Date). */
function whenKey(b: { date?: string | Date | null; startTime?: string | null }): string {
    const d = b.date as unknown;
    let day = '';
    if (typeof d === 'string') day = d.slice(0, 10);
    else if (d instanceof Date && Number.isFinite(d.getTime())) {
        const p = (n: number) => String(n).padStart(2, '0');
        day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    return `${day} ${b.startTime || ''}`;
}

/**
 * Филиал КАССЫ по последней брони клиента — для пополнения из карточки
 * клиента на компьютере (доработка 01.10). Последняя — по дате и времени
 * брони, без отменённых и перенесённых. Её кабинет не Uni/One или броней
 * нет — undefined: окно потребует выбрать филиал вручную.
 */
export function cashBranchOfLastBooking(
    bookings: ReadonlyArray<{ resourceId?: string | null; date?: string | Date | null; startTime?: string | null; status?: string | null }>,
): string | undefined {
    let last: (typeof bookings)[number] | undefined;
    let lastKey = '';
    for (const b of bookings || []) {
        if (b.status && NOT_HELD.has(b.status)) continue;
        const key = whenKey(b);
        if (!last || key > lastKey) { last = b; lastKey = key; }
    }
    return last ? cashBranchOfBooking(last) : undefined;
}
