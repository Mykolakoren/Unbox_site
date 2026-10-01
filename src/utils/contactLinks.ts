/**
 * Ссылки «Написать / Позвонить» по контактам клиента CRM.
 *
 * Одна проверка на все экраны (карточка и долги на компьютере, карточка и
 * список на телефоне): в поле telegram люди пишут что угодно — «@anna»,
 * «t.me/anna», «+995 599 …», «Анна в телеге». Слепое `t.me/${telegram}`
 * давало битые ссылки; здесь ник проверяется по правилам Telegram, номер —
 * по цифрам, а мусор ссылки не получает.
 */

interface ContactSource {
    telegram?: string | null;
    phone?: string | null;
}

/** https://t.me/<ник> или https://t.me/+<номер>; null, если поле не похоже ни на то, ни на другое. */
export function telegramHref(telegram?: string | null): string | null {
    const tg = (telegram || '').trim().replace(/^@/, '').replace(/^(?:https?:\/\/)?t\.me\//i, '');
    if (!tg) return null;
    if (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(tg)) return `https://t.me/${tg}`;
    const digits = tg.replace(/[^\d+]/g, '');
    if (/^\+?\d{7,}$/.test(digits)) return `https://t.me/+${digits.replace(/^\+/, '')}`;
    return null;
}

/** tel:+995599…; null, если цифр меньше семи. */
export function phoneHref(phone?: string | null): string | null {
    const clean = (phone || '').replace(/[^\d+]/g, '');
    return clean.replace(/\+/g, '').length >= 7 ? `tel:${clean}` : null;
}

/** Главная кнопка связи: Telegram, если он есть и корректный, иначе звонок. */
export function contactHref(client: ContactSource): { href: string; label: string } | null {
    const tg = telegramHref(client.telegram);
    if (tg) return { href: tg, label: 'Написать в Telegram' };
    const tel = phoneHref(client.phone);
    if (tel) return { href: tel, label: 'Позвонить' };
    return null;
}
