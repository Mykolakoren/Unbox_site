import { api } from '../api/client';

/**
 * Available currencies with display info.
 */
export const CURRENCIES = [
    { code: 'GEL', symbol: '\u20BE', label: 'GEL' },
    { code: 'USD', symbol: '$', label: 'USD' },
    { code: 'EUR', symbol: '\u20AC', label: 'EUR' },
    { code: 'RUB', symbol: '\u20BD', label: 'RUB' },
    { code: 'USDT', symbol: '\u20AE', label: 'USDT' },
];

/**
 * Exchange rates to GEL.
 * Loaded from backend on init, hardcoded as fallback.
 */
export let EXCHANGE_RATES: Record<string, number> = {
    GEL: 1,
    USD: 2.69,
    EUR: 3.11,
    RUB: 0.034,
    USDT: 2.69,
};

/** Известные символы для валют, добавляемых через настройки (07.09). */
const KNOWN_SYMBOLS: Record<string, string> = {
    UAH: '\u20B4', GBP: '\u00A3', TRY: '\u20BA', KZT: '\u20B8',
    BYN: 'Br', AMD: '\u058F', PLN: 'z\u0142', ILS: '\u20AA', AED: 'DH',
};

/** Валюты из настроек, которых нет в зашитом списке, добавляются на лету —
 *  все селекторы валют по приложению читают этот же массив. */
export function registerCurrenciesFromRates(rates: Record<string, number>): void {
    for (const code of Object.keys(rates)) {
        if (!CURRENCIES.some(c => c.code === code)) {
            CURRENCIES.push({ code, symbol: KNOWN_SYMBOLS[code] || code, label: code });
        }
    }
}

/** Fetch exchange rates from backend and update in-memory cache */
let _ratesFetched = false;
export async function fetchExchangeRates(): Promise<Record<string, number>> {
    if (_ratesFetched) return EXCHANGE_RATES;
    try {
        const res = await api.get('/settings/exchange_rates');
        if (res.data && typeof res.data === 'object') {
            EXCHANGE_RATES = { ...EXCHANGE_RATES, ...res.data };
            registerCurrenciesFromRates(EXCHANGE_RATES);
            _ratesFetched = true;
        }
    } catch {
        // Use hardcoded fallback
    }
    return EXCHANGE_RATES;
}

// Auto-fetch on module load (non-blocking)
fetchExchangeRates();

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
