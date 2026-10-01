/**
 * «Записать следующую» — чистые функции для шторок Psy-CRM (волна 3, шаг 0).
 *
 * Без импортов: сторож (backend/tests/guard_wave3_foundation.py) гоняет
 * этот файл прямо через node --experimental-strip-types. Поэтому здесь
 * только стираемый TypeScript (типы, без enum и т.п.) и глобальный Intl.
 *
 * Время. Сессии в базе лежат UTC-naive («2026-10-07T15:00:00» = 15:00 UTC).
 * Сервер на запись ждёт naive-строку по Тбилиси/Батуми и сам вычитает 4 ч
 * (tbilisi_naive_to_utc_naive в services/crm_calendar.py) — так же шлёт
 * перенос в мобильной шторке сессии: `${date}T${time}:00`. Поэтому:
 *   из базы  → utcNaiveToTbilisi()  → { date: 'YYYY-MM-DD', time: 'HH:mm' } по Батуми;
 *   на сервер → toTbilisiNaive(date, time) → 'YYYY-MM-DDTHH:mm:00' без пояса.
 * Никакого toISOString(): он даёт UTC и сдвинул бы сессию на 4 часа.
 */

export const CRM_TZ = 'Asia/Tbilisi';

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

export interface WallClock {
    /** Календарный день по Батуми, «2026-10-07». */
    date: string;
    /** Время по Батуми, «19:00». */
    time: string;
}

/** Момент → день и время по Батуми. */
export function tbilisiWallClock(d: Date): WallClock | null {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: CRM_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Дата сессии из базы (UTC-naive, как parseUTC) → день и время по Батуми. */
export function utcNaiveToTbilisi(value: string | Date | null | undefined): WallClock | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return tbilisiWallClock(value);
    const s = String(value).trim().replace(' ', 'T');
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
    return tbilisiWallClock(new Date(hasZone ? s : `${s}Z`));
}

/** Сегодня по Батуми, «2026-10-01». */
export function tbilisiToday(now: Date = new Date()): string {
    return tbilisiWallClock(now)?.date ?? '';
}

/** «2026-10-07» + n дней → «2026-10-14» (календарно, без поясов). */
export function addDaysYmd(ymd: string, days: number): string {
    const m = YMD_RE.exec(ymd);
    if (!m) return ymd;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days, 12));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * День + время по Батуми → строка для POST /crm/sessions: «2026-10-07T19:00:00»
 * без пояса (сервер сам переведёт в UTC). Неверный ввод — исключение.
 */
export function toTbilisiNaive(date: string, time: string): string {
    const d = YMD_RE.exec((date || '').trim());
    const t = HM_RE.exec((time || '').trim());
    if (!d) throw new Error('Выберите дату');
    if (!t || +t[1] > 23 || +t[2] > 59) throw new Error('Укажите время в формате 19:00');
    return `${d[1]}-${d[2]}-${d[3]}T${t[1].padStart(2, '0')}:${t[2]}:00`;
}

export interface NextSessionInput {
    /** Прошлая сессия клиента (дата из базы, UTC-naive). Нет — считаем от сегодня. */
    lastSession?: { date: string; durationMinutes?: number | null; price?: number | null } | null;
    client?: { basePrice?: number | null; currency?: string | null } | null;
    /** Длительность из анкеты (sessionDurationMin из /specialists/me). */
    profileDurationMin?: number | null;
    /** Через сколько недель: 1 — «+1 нед», 2 — «+2 нед». По умолчанию 1. */
    weeks?: number;
    /** «Сейчас» — для сторожа и одного «сейчас» на весь экран. */
    now?: Date;
}

export interface NextSessionSuggestion extends WallClock {
    durationMinutes: number;
    price: number;
    currency: string;
    /** true — день недели и время взяты из прошлой сессии. */
    fromLastSession: boolean;
}

function positive(n: unknown): number | null {
    const v = typeof n === 'number' ? n : Number(n);
    return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Следующая встреча: тот же день недели и то же время по Батуми через неделю
 * после прошлой сессии. Если прошлая была давно и «+7 дн.» уже в прошлом —
 * берём ближайший такой же день недели впереди. weeks=2 — ещё на неделю позже.
 * Длительность: прошлая сессия → анкета → 60 мин. Цена — ставка клиента
 * (нет ставки — цена прошлой сессии, иначе 0), валюта — клиента (или ₾).
 */
export function suggestNextSession(input: NextSessionInput): NextSessionSuggestion {
    const now = input.now ?? new Date();
    const nowWall = tbilisiWallClock(now) ?? { date: '1970-01-01', time: '00:00' };
    const weeks = Math.max(1, Math.round(input.weeks ?? 1));
    const last = input.lastSession ? utcNaiveToTbilisi(input.lastSession.date) : null;

    let date: string;
    let time: string;
    if (last) {
        time = last.time;
        date = addDaysYmd(last.date, 7);
        // Строки «YYYY-MM-DD HH:mm» сравниваются как даты.
        let guard = 0;
        while (`${date} ${time}` <= `${nowWall.date} ${nowWall.time}` && guard++ < 520) {
            date = addDaysYmd(date, 7);
        }
        date = addDaysYmd(date, 7 * (weeks - 1));
    } else {
        // Нет истории — через неделю от сегодня, ближайший целый час рабочего дня.
        const h = Math.min(20, Math.max(9, Number(nowWall.time.slice(0, 2)) + 1));
        time = `${String(h).padStart(2, '0')}:00`;
        date = addDaysYmd(nowWall.date, 7 * weeks);
    }

    const durationMinutes = Math.round(
        positive(input.lastSession?.durationMinutes) ?? positive(input.profileDurationMin) ?? 60,
    );
    const price = positive(input.client?.basePrice) ?? positive(input.lastSession?.price) ?? 0;
    const currency = (input.client?.currency || 'GEL').toUpperCase();

    return { date, time, durationMinutes, price, currency, fromLastSession: !!last };
}

/**
 * Свободный 4-значный код клиента для календаря («Анна #4821»).
 * Сервер код не проверяет на уникальность, а синк ищет клиента по «#XXXX»
 * (_extract_alias_code: ровно 4 цифры) — поэтому берём код, которого нет
 * ни у одного клиента специалиста (включая коды слитых карточек).
 * Код от 1000 до 9999, чтобы не начинался с нуля. Все заняты — ''.
 */
export function generateAliasCode(
    existing: Iterable<string | null | undefined>,
    random: () => number = Math.random,
): string {
    const taken = new Set<string>();
    for (const c of existing) {
        const v = String(c ?? '').replace(/^#/, '').trim();
        if (v) taken.add(v);
    }
    for (let i = 0; i < 60; i++) {
        const code = String(1000 + Math.floor(random() * 9000));
        if (!taken.has(code)) return code;
    }
    for (let n = 1000; n <= 9999; n++) {
        if (!taken.has(String(n))) return String(n);
    }
    return '';
}
