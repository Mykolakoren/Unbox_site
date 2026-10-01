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
