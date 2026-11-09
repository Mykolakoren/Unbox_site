/**
 * Филиал по-человечески — одной функцией для всей мобильной админки
 * (ревью 09.11, admin-ux №12, admin-design №10).
 *
 * В данных филиал бывает и названием («Unbox Uni»), и служебным кодом локации
 * («unbox_uni»). На экран код не выводим никогда: «unbox_uni» → «Uni»,
 * «Unbox One» → «One», «neo_school» → «Neo School». Неизвестное — без
 * подчёркиваний и с заглавной, но не сырым кодом.
 */
const KNOWN: Record<string, string> = {
    'unbox uni': 'Uni',
    unbox_uni: 'Uni',
    uni: 'Uni',
    'unbox one': 'One',
    unbox_one: 'One',
    one: 'One',
    'neo school': 'Neo School',
    neo_school: 'Neo School',
    neo: 'Neo School',
};

export function branchLabel(code: string | null | undefined): string {
    const raw = (code || '').trim();
    if (!raw) return '';
    const known = KNOWN[raw.toLowerCase()];
    if (known) return known;
    const words = raw.replace(/[_-]+/g, ' ').replace(/^unbox\s+/i, '').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : raw;
}

/** Способ оплаты кассы по-русски — без «(cash)» и других кодов. */
export const CASH_METHOD_LABEL: Record<string, string> = {
    cash: 'Наличные',
    card_tbc: 'Карта TBC',
    card_bog: 'Карта BOG',
    card: 'Карта',
    transfer: 'Перевод',
    balance: 'С баланса',
    adjustment: 'Корректировка (не деньги)',
};

/**
 * Убрать служебные коды способа оплаты из текста с сервера:
 * «Пополнение через кассу (cash)» → «Пополнение через кассу · наличные».
 */
export function humanizeMoneyText(text: string | null | undefined): string {
    if (!text) return '';
    return text
        .replace(/\s*\((cash|card_tbc|card_bog|card|transfer|balance|adjustment)\)/gi,
            (_m, code: string) => ` · ${(CASH_METHOD_LABEL[code.toLowerCase()] || code).toLowerCase()}`)
        .replace(/\b(unbox_uni|unbox_one|neo_school)\b/gi, m => branchLabel(m));
}
