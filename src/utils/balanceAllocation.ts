import type { BookingHistoryItem } from '../store/types';
import type { DueInfo, CoverPart } from './dueAmounts';
import { formatGel } from './format';

/**
 * «Куда ушли деньги клиента» на экране (решение владельца 03.10).
 *
 * Сервер раскладывает ленту баланса: самые старые деньги — самым ранним броням
 * (backend/app/services/balance_allocation.py). Здесь — только применение этой
 * раскладки к значкам «к оплате» и тексты строк. Своих денежных формул нет:
 *
 *  • база — прежний расчёт computeDueByBooking (src/utils/dueAmounts.ts);
 *  • списанные брони: долг — тот, что сервер привязал к ЭТОЙ брони по ленте
 *    (а не «минус баланса на самые свежие брони из загруженных»). Так долг брони
 *    вне окна админки (последние 5000 броней) не переезжает на чужие брони и не
 *    теряется: он остаётся в сводке (debts) и показывается отдельно;
 *  • ещё не списанные: плюс на балансе покрывает ближайшие брони по порядку —
 *    те же суммы, что в базе, плюс «чем покрыто» (скидка за неделю, оплата…).
 *
 * Сводка устарела (баланс клиента в сторе другой) или лента не сходится с
 * балансом (consistent = false) — у этого клиента остаётся база, как раньше.
 *
 * Без побочных эффектов (format.ts тоже) — сторож гоняет файл через esbuild + node.
 */

export type AllocKind = 'topup' | 'weekly_rebate' | 'refund' | 'correction' | 'baseline' | 'other';

/** Партия денег (или её часть): «оплата 30.09», «скидка за неделю»… */
export interface AllocSource {
    rowId: string;
    kind: AllocKind | string;
    label: string;
    /** Способ оплаты («наличные», «TBC») или неделя скидки («21.09–27.09»). */
    detail?: string | null;
    date?: string | null;
    amount: number;
}

export interface AllocBooking {
    id: string;
    date: string;
    startTime: string;
    duration?: number;
    resourceId?: string | null;
    resourceName?: string | null;
    status?: string;
    paymentStatus?: string | null;
    paymentMethod?: string | null;
    finalPrice?: number;
    /** «05.10 14:00 Каб. 2» */
    label: string;
}

export interface AllocDebt {
    bookingId: string | null;
    rowIds: string[];
    amount: number;
    /** «05.10 14:00 Каб. 2» или «абонемент «Профи+»», «корректировка 15.09». */
    label: string;
    booking: AllocBooking | null;
    date?: string | null;
}

/** На что ушли деньги начисления / что вернул возврат. */
export interface AllocTarget {
    rowId: string;
    bookingId: string | null;
    label: string;
    booking?: AllocBooking | null;
    date?: string | null;
    amount: number;
    /** true — закрыло долг (деньги пришли позже списания). */
    closedDebt?: boolean;
}

/** Раскладка одной строки ленты (id — как в /balance-ledger). */
export interface AllocRowInfo {
    id: string;
    delta: number;
    reason: string;
    bookingId: string | null;
    // начисление
    spentOn: AllocTarget[];
    left: number;
    reversed: Array<AllocTarget | AllocSource>;
    // списание
    paidFrom: AllocSource[];
    debtClosed: AllocSource[];
    debtOpen: number;
    reversedBy: Array<{ rowId: string; label: string; date?: string | null; amount: number; kind?: string }>;
}

export interface ClientAllocSummary {
    userId: string;
    email: string | null;
    balance: number;
    consistent: boolean;
    ledgerSum?: number;
    /** Плюс на балансе: партии в порядке траты (первая — потратится первой). */
    batches: AllocSource[];
    /** Долги: по броням (в т.ч. вне окна админки) и по списаниям не за брони, от старых к новым. */
    debts: AllocDebt[];
}

export interface AllocSummaryResponse {
    generatedAt: string;
    clients: ClientAllocSummary[];
}

export interface AllocBookingMoney {
    bookingId: string;
    /** Сколько списано за бронь (нетто, после возвратов), ₾. */
    charged: number;
    debt: number;
    /** Чем оплачено (в т.ч. то, что закрыло долг позже). */
    sources: AllocSource[];
    booking: AllocBooking | null;
}

export interface AllocCoverage {
    bookingId: string;
    price: number;
    covered: number;
    due: number;
    sources: AllocSource[];
    booking: AllocBooking | null;
}

/** GET /users/{id}/balance-allocation */
export interface ClientAllocation extends ClientAllocSummary {
    allocatedBalance: number;
    rows: AllocRowInfo[];
    bookings: AllocBookingMoney[];
    coverage: AllocCoverage[];
}

/** userId и почта клиента → его сводка. */
export type AllocationIndex = Map<string, ClientAllocSummary>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round((Number(n) || 0) * 100);

export function indexAllocation(clients: ReadonlyArray<ClientAllocSummary> | null | undefined): AllocationIndex {
    const idx: AllocationIndex = new Map();
    for (const c of clients || []) {
        if (!c) continue;
        if (c.userId) idx.set(String(c.userId), c);
        if (c.email) idx.set(String(c.email), c);
    }
    return idx;
}

/** Статусы, у которых экран рисует «к оплате» (как DUE_STATUSES в dueAmounts.ts). */
const SHOWN_STATUSES = new Set<string>(['confirmed', 'pending_approval', 'completed']);

function startKey(b: BookingHistoryItem): string {
    const raw: any = b.date;
    const d = typeof raw === 'string' ? raw.slice(0, 10) : new Date(raw).toISOString().slice(0, 10);
    return `${d} ${b.startTime || '00:00'}`;
}

/**
 * Применить раскладку сервера к «к оплате».
 *
 *   base      — computeDueByBooking(bookings, balanceOf) (прежний расчёт);
 *   index     — indexAllocation(сводка) или null (нет сводки — остаётся база);
 *   balanceOf — тот же баланс, что для базы: сводка клиента берётся, только
 *               если её баланс совпадает с балансом в сторе (иначе устарела).
 */
export function applyAllocation(
    base: Map<string, DueInfo>,
    bookings: ReadonlyArray<BookingHistoryItem>,
    index: AllocationIndex | null | undefined,
    balanceOf: (userId: string) => number | null,
): Map<string, DueInfo> {
    if (!index || index.size === 0) return base;
    const out = new Map(base);
    const groups = new Map<ClientAllocSummary, BookingHistoryItem[]>();
    const fresh = new Map<ClientAllocSummary, boolean>();
    for (const b of bookings) {
        if (!b || !b.userId) continue;
        const entry = index.get(String(b.userId));
        if (!entry) continue;
        let ok = fresh.get(entry);
        if (ok === undefined) {
            const bal = balanceOf(String(b.userId));
            ok = !!entry.consistent && bal !== null && Math.abs(cents(bal) - cents(entry.balance)) === 0;
            fresh.set(entry, ok);
        }
        if (!ok) continue;
        const list = groups.get(entry) || [];
        list.push(b);
        groups.set(entry, list);
    }
    for (const [entry, list] of groups) {
        const debtBy = new Map<string, number>();
        for (const d of entry.debts || []) {
            if (d.bookingId) debtBy.set(d.bookingId, (debtBy.get(d.bookingId) || 0) + cents(d.amount));
        }
        // Списанные: долг — тот, что лента привязала к этой брони.
        for (const b of list) {
            const info = base.get(b.id);
            const debt = debtBy.get(b.id) || 0;
            if (info && info.charged) {
                const price = Math.max(cents(info.price), debt);
                out.set(b.id, { ...info, due: debt / 100, price: price / 100 });
            } else if (!info && debt > 0 && SHOWN_STATUSES.has(b.status)
                && !(b.status === 'completed' && b.paymentStatus === 'pending')) {
                // Долг на брони, которую база не считала (абонемент ушёл в баланс:
                // цена брони 0, а списаны деньги) — показываем на ней самой.
                const price = Math.max(cents(Number(b.finalPrice || 0)), debt);
                out.set(b.id, { due: debt / 100, price: price / 100, charged: true });
            }
        }
        // Несписанные: плюс баланса — по партиям, ближайшие брони первыми.
        const pending = list
            .filter(b => { const i = base.get(b.id); return !!i && !i.charged; })
            .sort((a, b) => startKey(a).localeCompare(startKey(b)));
        const queue = (entry.batches || []).map(s => ({ src: s, left: cents(s.amount) }));
        let qi = 0;
        for (const b of pending) {
            const info = base.get(b.id)!;
            const price = cents(info.price);
            let need = price;
            const parts: CoverPart[] = [];
            while (need > 0 && qi < queue.length) {
                const q = queue[qi];
                if (q.left <= 0) { qi++; continue; }
                const take = Math.min(need, q.left);
                q.left -= take;
                need -= take;
                const last = parts[parts.length - 1];
                if (last && last.rowId === q.src.rowId) last.amount = round2(last.amount + take / 100);
                else parts.push({ rowId: q.src.rowId, kind: String(q.src.kind), label: q.src.label, detail: q.src.detail ?? null, amount: take / 100 });
            }
            out.set(b.id, { ...info, due: need / 100, coveredBy: parts.length ? parts : undefined });
        }
    }
    return out;
}

/** Долги клиента по броням, которых нет в загруженном списке (окно админки) и не за брони. */
export function debtsOutsideList(
    entry: ClientAllocSummary | null | undefined,
    shownIds: ReadonlySet<string>,
): AllocDebt[] {
    if (!entry || !entry.consistent) return [];
    return (entry.debts || []).filter(d => !d.bookingId || !shownIds.has(d.bookingId));
}

// ── Тексты ───────────────────────────────────────────────────────────────

const money = (n: number) => formatGel(round2(n));

/** «скидка за неделю 9 ₾ + оплата 30.09 11 ₾» */
export function sourcesText(parts: ReadonlyArray<{ label: string; amount: number }> | null | undefined): string {
    return (parts || []).filter(p => p && p.amount > 0).map(p => `${p.label} ${money(p.amount)}`).join(' + ');
}

const INSTRUMENTAL: Record<string, (label: string) => string> = {
    topup: l => l.replace(/^оплата/, 'оплатой'),
    weekly_rebate: () => 'скидкой за неделю',
    refund: l => l.replace(/^возврат/, 'возвратом').replace(/^пересчёт/, 'пересчётом'),
    correction: l => l.replace(/^корректировка/, 'корректировкой'),
    baseline: () => 'остатком на начало',
};

/** «закрыто оплатой 05.10» / «закрыто: оплата 05.10 15 ₾ + скидка за неделю 5 ₾» */
export function closedByText(parts: ReadonlyArray<AllocSource>): string {
    const list = (parts || []).filter(p => p && p.amount > 0);
    if (list.length === 1) {
        const p = list[0];
        const f = INSTRUMENTAL[String(p.kind)];
        return f ? `закрыто ${f(p.label)}` : `закрыто: ${p.label}`;
    }
    return `закрыто: ${sourcesText(list)}`;
}

function targetText(t: AllocTarget): string {
    return `${t.label} — ${money(t.amount)}`;
}

/**
 * Серая строка под строкой «Движений баланса».
 *   начисление: «ушло на: 05.10 14:00 Каб. 2 — 9 ₾; …» / «на балансе: 5 ₾»;
 *   списание:   «из: скидка за неделю 9 ₾ + оплата 30.09 11 ₾» /
 *               «в долг 20 ₾ → закрыто оплатой 05.10» / «в долг 20 ₾ — ещё не оплачено».
 */
export function ledgerRowLine(info: AllocRowInfo | null | undefined): string | null {
    if (!info) return null;
    const parts: string[] = [];
    if (info.delta > 0) {
        const rev = (info.reversed || []) as AllocTarget[];
        if (rev.length) parts.push(`вернуло списание: ${rev.map(targetText).join('; ')}`);
        const closed = (info.spentOn || []).filter(t => t.closedDebt);
        const spent = (info.spentOn || []).filter(t => !t.closedDebt);
        if (closed.length) parts.push(`закрыло долг: ${closed.map(targetText).join('; ')}`);
        if (spent.length) parts.push(`ушло на: ${spent.map(targetText).join('; ')}`);
        if (info.left > 0.004) parts.push(`на балансе: ${money(info.left)}`);
    } else if (info.delta < 0) {
        const total = Math.abs(info.delta);
        const revBy = info.reversedBy || [];
        const revSum = revBy.reduce((s, r) => s + (r.amount || 0), 0);
        if (revBy.length) {
            parts.push(revSum >= total - 0.004
                ? `снято: ${revBy.map(r => r.label).join(', ')}`
                : `снято ${money(revSum)}: ${revBy.map(r => r.label).join(', ')}`);
        }
        if ((info.paidFrom || []).length) parts.push(`из: ${sourcesText(info.paidFrom)}`);
        const closedSum = (info.debtClosed || []).reduce((s, p) => s + (p.amount || 0), 0);
        if (closedSum > 0.004) parts.push(`в долг ${money(closedSum)} → ${closedByText(info.debtClosed)}`);
        if (info.debtOpen > 0.004) parts.push(`в долг ${money(info.debtOpen)} — ещё не оплачено`);
    }
    return parts.length ? parts.join('; ') : null;
}

/**
 * Сводка над «Движениями баланса»:
 *   «На балансе 20 ₾: скидка за неделю 9 ₾ + оплата 30.09 11 ₾. Покроет: 05.10 14:00 Каб. 2 (20 ₾)»;
 *   «Долг 30 ₾: бронь 01.10 10:00 Каб. 1 (20 ₾), бронь 02.10 12:00 Каб. 2 (10 ₾)».
 */
export function allocationHeadline(a: ClientAllocation | null | undefined): string | null {
    if (!a || !a.consistent) return null;
    const plus = (a.batches || []).reduce((s, b) => s + cents(b.amount), 0) / 100;
    const minus = (a.debts || []).reduce((s, d) => s + cents(d.amount), 0) / 100;
    if (plus > 0.004) {
        let s = `На балансе ${money(plus)}: ${sourcesText(a.batches)}.`;
        const cover = (a.coverage || []).filter(c => c.covered > 0.004);
        if (cover.length) {
            s += ` Покроет: ${cover.map(c => {
                const what = c.booking?.label || 'бронь';
                return c.due > 0.004 ? `${what} (${money(c.covered)} из ${money(c.price)})` : `${what} (${money(c.covered)})`;
            }).join(', ')}`;
        }
        return s;
    }
    if (minus > 0.004) {
        return `Долг ${money(minus)}: ${(a.debts || []).map(d => `${d.bookingId ? 'бронь ' : ''}${d.label} (${money(d.amount)})`).join(', ')}`;
    }
    return 'Баланс 0 ₾: всё списанное оплачено';
}

/**
 * Строка «Оплата» в попапе брони по раскладке (или null — тогда прежняя
 * paymentSourceLine). Не называет «оплачено» бронь, списанную в долг.
 *   оплачена целиком:   «Оплачено: скидка за неделю 9 ₾ + оплата 30.09 11 ₾»
 *                       (+ «· спишется за 24 ч до начала» у ещё не списанной);
 *   покрыта частично:   «11 ₾ покрыто: скидка за неделю 9 ₾ + оплата 30.09 2 ₾».
 */
export function allocationPayLine(
    due: DueInfo | null | undefined,
    money_: AllocBookingMoney | null | undefined,
): string | null {
    if (!due) return null;
    const parts: ReadonlyArray<CoverPart | AllocSource> = due.charged ? (money_?.sources || []) : (due.coveredBy || []);
    const covered = parts.reduce((s, p) => s + cents(p.amount), 0) / 100;
    if (!(covered > 0.004)) return null;
    const text = sourcesText(parts);
    if (due.due <= 0) return `Оплачено: ${text}${due.charged ? '' : ' · спишется за 24 ч до начала'}`;
    return `${money(covered)} покрыто: ${text}`;
}

/** «M−N ₾ покрыто: скидка за неделю» под «к оплате N ₾ из M» (частичное покрытие). */
export function partialCoverLine(
    due: DueInfo | null | undefined,
    money_?: AllocBookingMoney | null,
): string | null {
    if (!due || !(due.due > 0) || !(due.due < due.price)) return null;
    const covered = round2(due.price - due.due);
    const parts: ReadonlyArray<CoverPart | AllocSource> = due.charged ? (money_?.sources || []) : (due.coveredBy || []);
    const kinds = [...new Set(parts.filter(p => p.amount > 0).map(p => p.label))];
    return kinds.length ? `${money(covered)} покрыто: ${kinds.join(' + ')}` : `${money(covered)} уже покрыто балансом`;
}
