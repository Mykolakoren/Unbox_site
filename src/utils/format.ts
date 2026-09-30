/**
 * Общие форматтеры денег, дат и времени (wave 1, 30.09).
 *
 * Одна функция на каждый вид записи, чтобы сумма и дата выглядели одинаково
 * на всех экранах: «1 250 ₾», «вт, 29 сентября», «29 сентября», «14:05».
 * Раньше каждый экран писал по-своему: гривна вместо лари, «20.0 ₾», «16052.00₾»,
 * «85 GEL», «29 сентябрь», «September 2026».
 *
 * Модуль без побочных эффектов (в отличие от utils/currency.ts, который при
 * импорте ходит за курсами) — его можно тянуть откуда угодно.
 *
 * Часовой пояс. Строка «2026-09-29» — это календарная дата, она выводится
 * как есть, без сдвигов. Date и ISO-строки со временем по умолчанию
 * выводятся в поясе браузера — так брони строятся по всему коду
 * (new Date(`${date}T${start}`)). Для времени из базы (UTC — сессии CRM,
 * касса) передайте { timeZone: BATUMI_TZ }.
 */

/** Символы валют. Для незнакомого кода выводим сам код («UAH»). */
const CURRENCY_SYMBOLS: Record<string, string> = {
    GEL: '₾',
    USD: '$',
    EUR: '€',
    RUB: '₽',
    USDT: '₮',
};

const NBSP = ' ';
const MINUS = '−';

type NumLike = number | string | null | undefined;

function toNumber(v: NumLike): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

export interface MoneyOptions {
    /** Код валюты, по умолчанию GEL. */
    currency?: string;
    /** «+150 ₾» у положительных — для пополнений и возвратов. */
    sign?: boolean;
    /** Что показать, если суммы нет. По умолчанию «—». */
    fallback?: string;
    /** Дробная часть: 'auto' — только если нужна («31,5 ₾»), 0 — округлить. */
    fraction?: 'auto' | 0;
}

/**
 * Сумма денег: «1 250 ₾», «31,5 ₾», «−150 ₾», «+20 ₾».
 * Группировка разрядов по-русски (неразрывный пробел), без «.00», если
 * копеек нет; знак валюты через неразрывный пробел — не отрывается от числа.
 */
export function formatMoney(amount: NumLike, opts: MoneyOptions = {}): string {
    const n = toNumber(amount);
    if (n === null) return opts.fallback ?? '—';
    const code = (opts.currency || 'GEL').toUpperCase();
    const symbol = CURRENCY_SYMBOLS[code] ?? code;
    const abs = Math.abs(n);
    const digits = opts.fraction === 0 ? 0 : 2;
    // Округляем до копеек, чтобы 0.1 + 0.2 не превратилось в «0,30000000004».
    const rounded = Math.round(abs * 10 ** digits) / 10 ** digits;
    const body = new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    }).format(rounded);
    const isZero = rounded === 0;
    const signStr = n < 0 && !isZero ? MINUS : (opts.sign && n > 0 && !isZero ? '+' : '');
    return `${signStr}${body}${NBSP}${symbol}`;
}

/** Сумма в лари: formatGel(1250) → «1 250 ₾». */
export function formatGel(amount: NumLike, opts: Omit<MoneyOptions, 'currency'> = {}): string {
    return formatMoney(amount, { ...opts, currency: 'GEL' });
}

// ── Даты ────────────────────────────────────────────────────────────────

type DateLike = Date | string | number | null | undefined;

export interface DateOptions {
    /** IANA-пояс (например BATUMI_TZ из dateUtils). По умолчанию — браузера. */
    timeZone?: string;
    /** Что показать, если даты нет или она битая. По умолчанию «—». */
    fallback?: string;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Разбирает вход. Календарная «YYYY-MM-DD» → полдень UTC и пояс UTC,
 *  чтобы день не съехал ни в одном поясе браузера. */
function resolve(d: DateLike, timeZone?: string): { date: Date; timeZone?: string } | null {
    if (d === null || d === undefined || d === '') return null;
    if (typeof d === 'string') {
        const m = YMD_RE.exec(d.trim());
        if (m) {
            const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
            return { date, timeZone: 'UTC' };
        }
    }
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return null;
    return { date, timeZone };
}

function fmt(d: DateLike, parts: Intl.DateTimeFormatOptions, opts: DateOptions): string | null {
    const r = resolve(d, opts.timeZone);
    if (!r) return null;
    try {
        return new Intl.DateTimeFormat('ru-RU', { ...parts, timeZone: r.timeZone }).format(r.date);
    } catch {
        return null;
    }
}

/** Год нужен, только если дата не в текущем году. */
function needsYear(d: DateLike, opts: DateOptions): boolean {
    const y = fmt(d, { year: 'numeric' }, opts);
    const now = fmt(new Date(), { year: 'numeric' }, opts);
    return !!y && y !== now;
}

/**
 * «29 сентября» — день и месяц в родительном падеже (не «29 сентябрь»).
 * withYear: 'auto' — год только если не текущий («29 сентября 2025»).
 */
export function formatDayMonth(d: DateLike, opts: DateOptions & { withYear?: boolean | 'auto' } = {}): string {
    const withYear = opts.withYear === true || (opts.withYear === 'auto' && needsYear(d, opts));
    const s = fmt(d, withYear
        ? { day: 'numeric', month: 'long', year: 'numeric' }
        : { day: 'numeric', month: 'long' }, opts);
    if (s === null) return opts.fallback ?? '—';
    return s.replace(/\s?г\.$/, '');
}

/**
 * «3 окт.» — короткая дата для чипов и плотных списков (серии, полоса дней).
 * Месяц сокращённый, в родительном («3 мая», «3 сент.»), как в date-fns
 * 'd MMM' с ru-локалью, которым раньше писал каждый экран сам.
 * withYear: 'auto' — год только если не текущий («3 окт. 2027»).
 */
export function formatDayMonthShort(d: DateLike, opts: DateOptions & { withYear?: boolean | 'auto' } = {}): string {
    const withYear = opts.withYear === true || (opts.withYear === 'auto' && needsYear(d, opts));
    const s = fmt(d, withYear
        ? { day: 'numeric', month: 'short', year: 'numeric' }
        : { day: 'numeric', month: 'short' }, opts);
    if (s === null) return opts.fallback ?? '—';
    return s.replace(/\s?г\.$/, '');
}

/**
 * «Пт» — день недели коротко, с заглавной (для чипов дней).
 * capitalize: false — «пт».
 */
export function formatWeekdayShort(d: DateLike, opts: DateOptions & { capitalize?: boolean } = {}): string {
    const s = fmt(d, { weekday: 'short' }, opts);
    if (s === null) return opts.fallback ?? '—';
    return opts.capitalize === false ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * «вт, 29 сентября» — день недели коротко, день, месяц в родительном.
 * capitalize: «Вт, 29 сентября» — заглавная только у первой буквы строки.
 */
export function formatDateLabel(
    d: DateLike,
    opts: DateOptions & { capitalize?: boolean; withYear?: boolean | 'auto' } = {},
): string {
    const withYear = opts.withYear === true || (opts.withYear === 'auto' && needsYear(d, opts));
    const s = fmt(d, withYear
        ? { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }
        : { weekday: 'short', day: 'numeric', month: 'long' }, opts);
    if (s === null) return opts.fallback ?? '—';
    const clean = s.replace(/\s?г\.$/, '');
    return opts.capitalize ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

/** «сентябрь 2026» — подпись месяца (именительный падеж, для заголовков). */
export function formatMonthLabel(d: DateLike, opts: DateOptions & { capitalize?: boolean } = {}): string {
    const s = fmt(d, { month: 'long', year: 'numeric' }, opts);
    if (s === null) return opts.fallback ?? '—';
    const clean = s.replace(/\s?г\.$/, '');
    return opts.capitalize ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

const HHMM_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/**
 * «14:05». Принимает Date/ISO (выводит в поясе) или готовую строку
 * «14:05» / «14:05:00» из брони — её просто подрезает до часов и минут.
 */
export function formatTime(d: DateLike, opts: DateOptions = {}): string {
    if (typeof d === 'string') {
        const m = HHMM_RE.exec(d.trim());
        if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    }
    const s = fmt(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, opts);
    return s === null ? (opts.fallback ?? '—') : s;
}

/** «15:00–16:00» — интервал через короткое тире без пробелов.
 *  Нет конца (или он битый) — только начало «15:00», без «15:00–—». */
export function formatTimeRange(start: DateLike, end: DateLike, opts: DateOptions = {}): string {
    const from = formatTime(start, opts);
    const to = formatTime(end, { ...opts, fallback: '' });
    return to ? `${from}–${to}` : from;
}

// ── Относительные дни и «через сколько» (волна 2, шаг 0) ────────────────

/** Календарный день момента в поясе — «2026-09-30». Календарная строка
 *  «YYYY-MM-DD» остаётся своим днём (как в остальных форматтерах). */
function dayKey(d: DateLike, timeZone?: string): string | null {
    const r = resolve(d, timeZone);
    if (!r) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', timeZone: r.timeZone,
        }).formatToParts(r.date);
        const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
        return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
        return null;
    }
}

function daysBetween(fromKey: string, toKey: string): number {
    const a = YMD_RE.exec(fromKey);
    const b = YMD_RE.exec(toKey);
    if (!a || !b) return NaN;
    const ua = Date.UTC(+a[1], +a[2] - 1, +a[3]);
    const ub = Date.UTC(+b[1], +b[2] - 1, +b[3]);
    return Math.round((ub - ua) / 86_400_000);
}

export interface RelativeDayOptions extends DateOptions {
    /** «Сейчас» — для тестов и для одного «сейчас» на весь список. */
    now?: DateLike;
    /** По умолчанию «Сегодня» / «Завтра» с заглавной, дата — «ср, 30 сент.».
     *  true — заглавная и у даты («Ср, 30 сент.»), false — всё строчными
     *  («сегодня» — для середины фразы: «сегодня в 14:00»). */
    capitalize?: boolean;
    /** Год у даты: 'auto' (по умолчанию) — только если не текущий. */
    withYear?: boolean | 'auto';
}

/**
 * «Сегодня» / «Завтра» / «Вчера» / «ср, 30 сент.» — день относительно сегодня.
 * Пояс — как у остальных форматтеров: «YYYY-MM-DD» — календарный день как
 * есть, Date/ISO — в поясе браузера или в opts.timeZone (BATUMI_TZ для
 * времени из базы). «Сегодня» считается в том же поясе.
 */
export function formatRelativeDay(d: DateLike, opts: RelativeDayOptions = {}): string {
    const key = dayKey(d, opts.timeZone);
    if (!key) return opts.fallback ?? '—';
    const nowKey = dayKey(opts.now ?? new Date(), opts.timeZone);
    const diff = nowKey ? daysBetween(nowKey, key) : NaN;
    const word = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчера' : null;
    if (word) return opts.capitalize === false ? word.toLowerCase() : word;

    const withYear = opts.withYear === true || ((opts.withYear ?? 'auto') === 'auto' && needsYear(d, opts));
    const s = fmt(d, withYear
        ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
        : { weekday: 'short', day: 'numeric', month: 'short' }, opts);
    if (s === null) return opts.fallback ?? '—';
    const clean = s.replace(/\s?г\.$/, '');
    return opts.capitalize === true ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

function pluralDays(n: number): string {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'день';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
    return 'дней';
}

export interface StartsInOptions {
    /** Конец встречи. Без него после начала всегда «идёт сейчас». */
    end?: DateLike;
    /** «Сейчас» — для тестов и для одного «сейчас» на весь список. */
    now?: DateLike;
    /** Что показать, если начала нет или оно битое. По умолчанию «». */
    fallback?: string;
}

/**
 * Сколько осталось до начала: «через 20 мин», «через 1 ч 30 мин», «через 3 ч»,
 * «через 2 дня»; уже началась — «идёт сейчас»; прошла (есть end) — «закончилась».
 * Считает разницу моментов, поэтому пояс не важен: передайте Date или ISO
 * со временем (бронь — new Date(`${date}T${startTime}`), как везде в коде).
 */
export function formatStartsIn(start: DateLike, opts: StartsInOptions = {}): string {
    const s = resolve(start);
    const n = resolve(opts.now ?? new Date());
    if (!s || !n) return opts.fallback ?? '';
    const diffMs = s.date.getTime() - n.date.getTime();
    if (diffMs > 0) {
        const mins = Math.ceil(diffMs / 60_000);
        if (mins < 60) return `через ${mins} мин`;
        if (mins < 24 * 60) {
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            // До трёх часов минуты важны («через 1 ч 20 мин»), дальше — округляем.
            if (h < 3 && m >= 5) return `через ${h} ч ${m} мин`;
            return `через ${Math.round(mins / 60)} ч`;
        }
        const days = Math.round(mins / (24 * 60));
        return `через ${days} ${pluralDays(days)}`;
    }
    const e = opts.end !== undefined ? resolve(opts.end) : null;
    if (e && n.date.getTime() >= e.date.getTime()) return 'закончилась';
    return 'идёт сейчас';
}
