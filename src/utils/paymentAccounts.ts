/**
 * Счета оплаты Psy-CRM: сопоставление того, что лежит в базе, со списком
 * счетов специалиста (crmStore.paymentAccounts).
 *
 * В базе счёт — просто строка, и написаний несколько: «Cash» (так писал сервер
 * по умолчанию), «cash», «tbc», «TBC». В списке счетов id — «cash», «tbc», «bog».
 * Прямое сравнение `a.id === p.account` не узнавало «Cash» и «TBC»: в оплатах
 * висело сырое «Cash», а выпадающий список молча показывал первый пункт.
 * Здесь счёт ищем без учёта регистра — сначала по id, потом по названию.
 * Новых написаний не плодим: в базу уходит только id из списка, который выбрал
 * человек, а нетронутое значение остаётся как было.
 */

export interface AccountLike {
    id: string;
    label: string;
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

/** Счёт из списка, которому соответствует значение из базы (регистр не важен). */
export function matchAccount<T extends AccountLike>(raw: string | null | undefined, accounts: readonly T[]): T | undefined {
    const key = norm(raw);
    if (!key) return undefined;
    return accounts.find(a => a.id === raw)
        ?? accounts.find(a => norm(a.id) === key)
        ?? accounts.find(a => norm(a.label) === key);
}

/** Человеческое название счёта: «Наличные», «TBC». Нет в списке — как записано. */
export function accountLabel(raw: string | null | undefined, accounts: readonly AccountLike[]): string {
    return matchAccount(raw, accounts)?.label || raw || '';
}

/** Что показать выбранным в списке: id из списка, а если счёта там нет — сырое значение. */
export function accountSelectValue(raw: string | null | undefined, accounts: readonly AccountLike[]): string {
    return matchAccount(raw, accounts)?.id ?? raw ?? '';
}

/**
 * Счёт по умолчанию для новой оплаты: счёт клиента «по умолчанию» → счёт его
 * последнего платежа → «Cash» (наличные). Возвращает id из списка счетов.
 */
export function defaultPaymentAccount(
    accounts: readonly AccountLike[],
    clientDefault?: string | null,
    lastPaymentAccount?: string | null,
): string {
    for (const raw of [clientDefault, lastPaymentAccount]) {
        if (norm(raw)) return accountSelectValue(raw, accounts);
    }
    return matchAccount('cash', accounts)?.id ?? accounts[0]?.id ?? 'cash';
}

/** Счёт самого свежего платежа (по дню оплаты), если платежи есть. */
export function lastPaymentAccountOf(payments: readonly { account?: string; date?: string; createdAt?: string }[]): string | undefined {
    let best: { account?: string; t: number } | undefined;
    for (const p of payments) {
        if (!norm(p.account)) continue;
        const t = Date.parse(p.date || p.createdAt || '') || 0;
        if (!best || t > best.t) best = { account: p.account, t };
    }
    return best?.account;
}
