import type { CrmSession } from '../api/crm';
import { EXCHANGE_RATES } from './currency';

/**
 * Деньги по сессии Psy-CRM: цена, внесённое, остаток (этап А, 02.10).
 *
 * Считает сервер (services/session_balance.py): он кладёт в каждую сессию
 * `paidAmount` (внесено) и `remaining` (долг) — оба в ВАЛЮТЕ СЕССИИ. Здесь
 * только читаем их и подставляем запасной вариант, если сервер их не прислал
 * (ответ создания сессии, старый кэш): тогда долг — вся цена, как раньше.
 *
 * Долг по сессии = цена МИНУС внесённое. Раньше частично оплаченная сессия
 * (100 из 185) висела в долге целиком — 185.
 */

/** Допуск в копейку — как на сервере. */
const EPS = 0.01;

type ClientMoney = { basePrice?: number | null; currency?: string | null };

export function sessionPriceOf(s: Pick<CrmSession, 'price'>, client?: ClientMoney | null): number {
    return Number(s.price ?? client?.basePrice ?? 0) || 0;
}

/** Валюта сессии: замороженная на сессии, иначе валюта клиента. */
export function sessionCurrencyOf(s: Pick<CrmSession, 'currency'>, client?: ClientMoney | null): string {
    return (s.currency || client?.currency || 'GEL').toUpperCase();
}

/** Курс «1 единица валюты → лари». Неизвестная валюта — 1, как на сервере. */
function rate(code: string): number {
    return EXCHANGE_RATES[code.toUpperCase()] ?? 1;
}

/** Сумма из одной валюты в другую через лари (те же курсы, что у сервера). */
export function convertMoney(amount: number, from: string, to: string): number {
    if (from.toUpperCase() === to.toUpperCase()) return amount;
    return (amount * rate(from)) / rate(to);
}

/** Долг по одной сессии в её валюте: остаток, а не вся цена. У оплаченной — 0. */
export function sessionDebt(
    s: CrmSession,
    client?: ClientMoney | null,
): { amount: number; currency: string } {
    const currency = sessionCurrencyOf(s, client);
    if (s.isPaid) return { amount: 0, currency };
    // Остатку верим, только если сервер прислал ОБА числа и они не противоречат
    // «не оплачено»: после «Снять оплату» на экране может остаться remaining: 0
    // от прежней оплаты — тогда долг, как раньше, вся цена.
    const price = sessionPriceOf(s, client);
    const trusted = s.remaining != null && s.paidAmount != null
        && !(s.remaining <= EPS && s.paidAmount <= EPS && price > EPS);
    const amount = trusted ? (s.remaining as number) : price;
    return { amount: Math.max(0, Math.round(amount * 100) / 100), currency };
}

/** То же, но пересчитанное в валюту `into` (долги разных сессий клиента — в одно число). */
export function sessionDebtIn(s: CrmSession, client: ClientMoney | null | undefined, into: string): number {
    const d = sessionDebt(s, client);
    return Math.round(convertMoney(d.amount, d.currency, into) * 100) / 100;
}

/** Частичная оплата: внесено что-то, но не всё. Нет — null. */
export function partialPayment(
    s: CrmSession,
    client?: ClientMoney | null,
): { paid: number; price: number; remaining: number; currency: string } | null {
    if (s.isPaid) return null;
    const paid = Number(s.paidAmount ?? 0) || 0;
    const remaining = Number(s.remaining ?? 0) || 0;
    if (paid <= EPS || remaining <= EPS) return null;
    return { paid, price: sessionPriceOf(s, client), remaining, currency: sessionCurrencyOf(s, client) };
}

/** Цена и платёж разошлись у ОПЛАЧЕННОЙ сессии (например, цену подняли после оплаты). */
export function paymentMismatch(
    s: CrmSession,
    client?: ClientMoney | null,
    /** Валюта платежа: если она не валюта сессии, допуск шире — как на сервере. */
    paymentCurrency?: string | null,
): { paid: number; price: number; currency: string; shortfall: number } | null {
    if (!s.isPaid) return null;
    const paid = Number(s.paidAmount ?? 0) || 0;
    if (paid <= EPS) return null; // платежа нет — оплату отметили руками, сравнивать не с чем
    const price = sessionPriceOf(s, client);
    // Допуск как у сервера (session_balance.slack): копейка плюс половина минимальной единицы
    // валюты платежа в валюте сессии — сумму в долларах пишут с точностью до цента, и
    // «Доплатить 0,02 ₾» по такой оплате быть не должно.
    const cur = sessionCurrencyOf(s, client);
    const slack = paymentCurrency && paymentCurrency.toUpperCase() !== cur
        ? 0.005 * convertMoney(1, paymentCurrency, cur) : 0;
    if (Math.abs(price - paid) <= EPS + slack) return null;
    return {
        paid, price, currency: sessionCurrencyOf(s, client),
        shortfall: Math.max(0, Math.round((price - paid) * 100) / 100),
    };
}
