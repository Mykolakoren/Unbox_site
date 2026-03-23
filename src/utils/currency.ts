/**
 * Fixed exchange rates to GEL.
 * Can be updated in CRM Settings in the future.
 */
export const EXCHANGE_RATES: Record<string, number> = {
    GEL: 1,
    USD: 2.7,
    EUR: 2.95,
    RUB: 0.03,
};

/** Convert amount to GEL equivalent */
export function toGel(amount: number, currency: string): number {
    const rate = EXCHANGE_RATES[currency] ?? 1;
    return amount * rate;
}

/** Format multi-currency map as string with GEL equivalent */
export function formatMultiCurrency(
    byCurrency: Record<string, number>,
    options?: { showEquivalent?: boolean; equivalentLabel?: string }
): string {
    const entries = Object.entries(byCurrency).filter(([, v]) => v > 0);
    if (entries.length === 0) return '0';

    const parts = entries.map(([cur, val]) => `${val.toFixed(0)} ${cur}`);
    const main = parts.join(' · ');

    if (options?.showEquivalent && entries.length > 1) {
        const totalGel = entries.reduce((sum, [cur, val]) => sum + toGel(val, cur), 0);
        return `${main}\n${options.equivalentLabel || '≈'} ${totalGel.toFixed(0)} GEL`;
    }

    return main;
}

/** Calculate GEL equivalent total from multi-currency map */
export function totalInGel(byCurrency: Record<string, number>): number {
    return Object.entries(byCurrency).reduce((sum, [cur, val]) => sum + toGel(val, cur), 0);
}
