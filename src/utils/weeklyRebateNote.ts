import { formatGel } from './format';

/**
 * Недельная скидка уже на балансе — одна формулировка на всю админку
 * (решение владельца 02.10: Валя больше не считает скидку вручную).
 *
 * Скидку за прошлую неделю сервер начисляет в понедельник кредитом на баланс,
 * поэтому «к оплате» (считается из баланса) её уже учитывает. Метка говорит
 * об этом прямо, чтобы скидку не вычли из «к оплате» второй раз:
 *   «скидка за неделю +9 ₾ уже учтена в «к оплате»».
 * Её показывают «Сегодня» (компьютер и телефон) и попап брони в шахматке.
 *
 * Без побочных эффектов (format.ts тоже) — сторож гоняет файл через node.
 */
export function weeklyRebateNote(amount: number): string {
    return `скидка за неделю ${formatGel(amount, { sign: true })} уже учтена в «к оплате»`;
}

/**
 * Индекс «клиент → недельная скидка с последнего понедельника, ₾» по id и по
 * почте: брони в «Сегодня» бывают и по UUID, и по почте.
 * Источник — GET /cashbox/weekly-rebates/recent (лента баланса, weekly_rebate).
 */
export function rebateIndex(
    items: ReadonlyArray<{ userId?: string | null; email?: string | null; amount: number }>,
): Map<string, number> {
    const idx = new Map<string, number>();
    for (const it of items || []) {
        const amount = Number(it?.amount) || 0;
        if (amount <= 0) continue;
        for (const key of new Set([it.userId, it.email].filter(Boolean).map(String))) {
            idx.set(key, Math.round(((idx.get(key) || 0) + amount) * 100) / 100);
        }
    }
    return idx;
}

/** Скидка клиента по любому из его ключей (id брони, id клиента, почта). */
export function rebateFor(idx: Map<string, number>, ...keys: Array<string | null | undefined>): number {
    for (const k of keys) {
        if (k && idx.has(String(k))) return idx.get(String(k)) || 0;
    }
    return 0;
}

/**
 * Строки ленты «Сегодня», у которых показать метку: одна на клиента — у его
 * первой брони в списке (у клиента бывает несколько броней за день).
 * Возвращает bookingId → сумма скидки, ₾.
 */
export function rebateRowsOnce(
    rows: ReadonlyArray<{ bookingId: string; clientKey?: string | null; userId: string }>,
    idx: Map<string, number>,
): Map<string, number> {
    const out = new Map<string, number>();
    const seen = new Set<string>();
    for (const r of rows || []) {
        const who = String(r.clientKey || r.userId || '');
        const amount = rebateFor(idx, r.clientKey, r.userId);
        if (amount > 0 && who && !seen.has(who)) {
            seen.add(who);
            out.set(r.bookingId, amount);
        }
    }
    return out;
}
