/**
 * Поиск человека в мобильной админке — один для «Клиентов», CRM-воронки и
 * «Броней» (ревью 09.11, admin-ux №6).
 *
 * Раньше «599123456» (номер без пробелов, как копируют из WhatsApp/Telegram) не
 * находил «+995 599 12 34 56», а «Миронова Елена» не находил «Елена Миронова» —
 * админ думал, что клиента нет, и заводил дубль.
 *  • телефон сравниваем только по цифрам (и в запросе, и в номере);
 *  • имя — по словам в любом порядке: каждое слово запроса должно встретиться
 *    (в имени, почте, телефоне или доп. полях); «ё» = «е».
 * Без импортов — сторож гоняет файл через node.
 */
export interface PersonFields {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    /** Что ещё искать (кабинет, слоган…). */
    extra?: Array<string | null | undefined>;
}

function norm(s: string): string {
    return s.toLowerCase().replace(/ё/g, 'е');
}

export function matchesPerson(query: string, f: PersonFields): boolean {
    const q = norm((query || '').trim());
    if (!q) return true;
    const phoneDigits = (f.phone || '').replace(/\D/g, '');
    const qDigits = q.replace(/\D/g, '');
    // Запрос похож на номер («+995 599-12-34», «599123456») — сравниваем цифры.
    if (/^[\d\s+()\-.]+$/.test(q) && qDigits.length >= 3 && phoneDigits.includes(qDigits)) return true;
    const hay = norm([f.name, f.email, f.phone, ...(f.extra || [])].filter(Boolean).join(' '));
    const words = q.split(/\s+/).filter(Boolean);
    return words.every(w => hay.includes(w) || (/^\d+$/.test(w) && w.length >= 3 && phoneDigits.includes(w)));
}
