/**
 * Дополнительный пул часов абонемента (владелец 01.10, шаг 4 «обещания тарифов»).
 *
 * Зеркало backend services/subscription_pool.py (extra_*): у абонемента кроме
 * основного пула есть второй —
 *   • «Капсула» — часы капсулы: Пробный 1, Тёплый старт 4, Регулярный практик 6,
 *     Профи+ 10 ч. Идут только на бронь капсулы;
 *   • «Индивидуально» — «4 ч индивидуально» у Группового мастера. Только кабинеты
 *     и только индивидуальный формат (не группы и не капсула).
 * Порядок списания: капсула — сначала часы капсулы, потом общий пул час за час,
 * потом деньги; индивидуальная бронь Группового мастера — сначала «4 ч
 * индивидуально», потом деньги. Решает и списывает сервер; здесь — только
 * показ и «хватит ли», чтобы экран не обещал не то, что сделает сервер.
 */
import type { Subscription } from '../store/types';
import { RESOURCES } from './data';

export type ExtraKind = 'capsule' | 'individual';
export type ResourceKind = 'capsule' | 'cabinet';

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

export interface ExtraPool {
    kind: ExtraKind;
    total: number;
    remaining: number;
}

/** Доп. пул абонемента или null, если у тарифа его нет. */
export function extraPool(sub: Subscription | null | undefined): ExtraPool | null {
    if (!sub) return null;
    const kind = sub.extraKind;
    if (kind !== 'capsule' && kind !== 'individual') return null;
    const total = Math.max(0, num(sub.extraHoursTotal));
    if (total <= 0) return null;
    return { kind, total, remaining: Math.max(0, num(sub.extraHoursRemaining)) };
}

/** «Капсула» / «Индивидуально» — название пула. */
export function extraKindLabel(kind: ExtraKind): string {
    return kind === 'capsule' ? 'Капсула' : 'Индивидуально';
}

const fmt = (h: number): string => String(Number(h.toFixed(1))).replace('.', ',');

/** «Капсула: осталось 4 из 6 ч» / «Индивидуально: осталось 4 из 4 ч». null — пула нет. */
export function extraPoolLabel(sub: Subscription | null | undefined): string | null {
    const p = extraPool(sub);
    if (!p) return null;
    return `${extraKindLabel(p.kind)}: осталось ${fmt(p.remaining)} из ${fmt(p.total)} ч`;
}

/** Тип помещения по id ресурса (по каталогу сайта). */
export function resourceKind(resourceId: string | null | undefined): ResourceKind | undefined {
    const r = RESOURCES.find(x => x.id === resourceId);
    if (!r) return undefined;
    return r.type === 'capsule' ? 'capsule' : 'cabinet';
}

/** Тип помещения всей корзины: капсула / кабинет, а если смешаны — undefined
 *  (тогда доп. пул не обещаем: сервер разложит по слотам сам). */
export function cartResourceKind(resourceIds: Array<string | null | undefined>): ResourceKind | undefined {
    const kinds = new Set(resourceIds.map(resourceKind));
    if (kinds.size !== 1) return undefined;
    const [k] = Array.from(kinds);
    return k;
}

/** Может ли доп. пул платить за такую бронь (зеркало subscription_pool.extra_applies). */
export function extraApplies(
    sub: Subscription | null | undefined,
    resource: ResourceKind | undefined,
    format: string,
): boolean {
    const p = extraPool(sub);
    if (!p || !resource) return false;
    if (p.kind === 'capsule') return resource === 'capsule';
    return resource === 'cabinet' && format === 'individual';
}

/** Сколько часов доп. пула реально доступно для такой брони (0, если не подходит). */
export function extraAvailable(
    sub: Subscription | null | undefined,
    resource: ResourceKind | undefined,
    format: string,
): number {
    return extraApplies(sub, resource, format) ? extraPool(sub)!.remaining : 0;
}
