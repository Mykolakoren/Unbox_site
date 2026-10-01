/**
 * «Сегодня» в админке — кто придёт и кто должен (волна 4, шаг 0).
 *
 * Без импортов: сторож (backend/tests/guard_wave4_foundation.py) гоняет этот
 * файл прямо через node --experimental-strip-types. Поэтому только стираемый
 * TypeScript (типы, без enum) и глобальный Intl.
 *
 * Откуда данные — то, что админка уже держит в сторе, без новых запросов:
 *   bookings — fetchAllBookings (BookingHistoryItem: date, startTime, userId…);
 *   users    — список клиентов (id, email, name, phone, balance, creditLimit);
 *   dueMap   — computeDueByBooking(bookings, balanceOf) из utils/dueAmounts.ts.
 *
 * День. Booking.date в базе — календарный день по Тбилиси/Батуми (naive,
 * «2026-10-01T00:00:00»), время — startTime «HH:MM» по Батуми. Поэтому день
 * брони — первые 10 символов naive-строки (как startKey в dueAmounts.ts), а
 * строку с поясом («…Z») и Date переводим в день по Батуми. «Сегодня» —
 * batumiDayKey(), а не new Date().toISOString() (UTC: с 00:00 до 04:00 по
 * Батуми это ещё «вчера»).
 *
 * Что попадает: confirmed, pending_approval и completed (прошедшие сегодня
 * не пропадают из ленты). Отменённые, перенесённые, пересданные — нет.
 * Обслуживание (payment_method='service', «Закрыть кабинет») — никогда.
 */

export const ADMIN_TODAY_TZ = 'Asia/Tbilisi';

/** Статусы, которые показываем в «Сегодня». */
const TODAY_STATUSES = new Set<string>(['confirmed', 'pending_approval', 'completed']);

const NAIVE_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

// ── Входные формы (структурно совместимы со стором) ─────────────────────

export interface TodayBookingInput {
    id: string;
    userId: string;
    date: string | Date;
    startTime?: string | null;
    duration?: number | null;
    resourceId?: string | null;
    status: string;
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    finalPrice?: number | null;
}

export interface TodayUserInput {
    id?: string | null;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
    balance?: number | null;
    creditLimit?: number | null;
}

/** Совместимо с DueInfo из utils/dueAmounts.ts. */
export interface TodayDueInput {
    due: number;
    price: number;
    charged: boolean;
}

export interface TodayRow {
    bookingId: string;
    /** «10:00» */
    time: string;
    /** «11:30» */
    endTime: string;
    duration: number;
    userId: string;
    /** Один ключ на клиента: брони бывают и по почте, и по UUID — сводим к id из users. */
    clientKey: string;
    /** Имя клиента; нет — начало почты; совсем нет — «—». */
    client: string;
    phone: string | null;
    cabinetId: string;
    /** Название кабинета (если передали resources), иначе id. */
    cabinet: string;
    status: string;
    paymentStatus: string | null;
    price: number;
    /** Сколько взять за эту бронь, ₾. null — денежной записи нет (абонемент, прощённая…). */
    due: number | null;
    /** true — запись есть и взять нечего («✓ оплачено»). */
    paid: boolean;
    /** true — бронь уже списана с баланса (DueInfo.charged). */
    charged: boolean;
    /**
     * true — бронь прошла (completed), а с баланса так и не списана
     * (payment_status = 'pending', сбой крона). Записи в dueMap у неё нет
     * (dueAmounts.ts её нарочно пропускает), поэтому раньше строка была без
     * плашки. Только подпись «не списана» — в суммы «взять» не входит.
     */
    uncharged: boolean;
}

export interface TodaySummary {
    /** Σ due > 0 по сегодняшним броням, ₾. */
    amount: number;
    /** Сколько разных клиентов должны за сегодня. */
    clients: number;
    /** «взять 72 ₾ с 2 клиентов» / «сегодня брать не с кого». */
    label: string;
}

export interface TodayClient {
    /** TodayRow.clientKey (id клиента из users, иначе userId брони). */
    userId: string;
    client: string;
    phone: string | null;
    /** Сколько взять за сегодняшние брони, ₾ (Σ due > 0). */
    today: number;
    /** Минус на балансе, ₾ (0, если баланс ≥ 0). */
    debt: number;
    /** Весь долг к оплате сейчас: минус на балансе + ещё не списанные сегодняшние, ₾ (В3). */
    total: number;
    balance: number | null;
    /** Кредитный лимит клиента, ₾ (null — не задан). */
    creditLimit: number | null;
    /** Долг больше лимита. */
    overLimit: boolean;
    /** Сегодняшние брони клиента (по времени). */
    rows: TodayRow[];
}

// ── День по Батуми ───────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/** «2026-10-01» — календарный день по Батуми для момента (по умолчанию — сейчас). */
export function batumiDayKey(d: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: ADMIN_TODAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

/** День брони по Батуми: naive-строка из базы — как есть, с поясом / Date — переводим. */
export function bookingDayKey(date: string | Date | null | undefined): string | null {
    if (date === null || date === undefined || date === '') return null;
    if (date instanceof Date) return isNaN(date.getTime()) ? null : batumiDayKey(date);
    const s = String(date).trim();
    const m = NAIVE_RE.exec(s);
    if (m) return m[1];
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : batumiDayKey(d);
}

function hm(t: string | null | undefined): number | null {
    const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function fromMinutes(total: number): string {
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/** «1 250» / «31,5» — без импортов, как formatGel, только число. */
function money(n: number): string {
    const r = round2(n);
    const [int, frac] = String(Math.abs(r)).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${r < 0 ? '−' : ''}${grouped}${frac ? ',' + frac : ''}`;
}

/** 1 клиента, 2 клиентов, 21 клиента (родительный падеж после «с»). */
function clientsWord(n: number): string {
    return n % 10 === 1 && n % 100 !== 11 ? 'клиента' : 'клиентов';
}

function userIndex(users: TodayUserInput[]): Map<string, TodayUserInput> {
    const idx = new Map<string, TodayUserInput>();
    for (const u of users || []) {
        if (!u) continue;
        if (u.id) idx.set(String(u.id), u);
        if (u.email) idx.set(String(u.email), u);
    }
    return idx;
}

function clientName(userId: string, u: TodayUserInput | undefined): string {
    if (u?.name) return u.name;
    if (userId && userId.includes('@')) return userId.split('@')[0];
    return userId ? userId.slice(0, 10) : '—';
}

// ── Лента дня ─────────────────────────────────────────────────────────────

export function todayRows({
    bookings, users, dueMap, dayKey, resources,
}: {
    bookings: TodayBookingInput[];
    users: TodayUserInput[];
    dueMap: Map<string, TodayDueInput> | { get(id: string): TodayDueInput | undefined };
    /** «2026-10-01» по Батуми — обычно batumiDayKey(). */
    dayKey: string;
    /** Названия кабинетов (по желанию). */
    resources?: { id: string; name?: string | null }[];
}): TodayRow[] {
    const idx = userIndex(users);
    const names = new Map<string, string>();
    for (const r of resources || []) if (r?.id) names.set(r.id, r.name || r.id);

    const rows: TodayRow[] = [];
    for (const b of bookings || []) {
        if (!b || !TODAY_STATUSES.has(b.status)) continue;
        if ((b.paymentMethod || '').toLowerCase() === 'service') continue; // обслуживание
        if (bookingDayKey(b.date) !== dayKey) continue;
        const start = hm(b.startTime) ?? 0;
        const duration = Number(b.duration) > 0 ? Number(b.duration) : 60;
        const u = idx.get(String(b.userId || ''));
        const info = dueMap.get(b.id);
        const due = info ? round2(Number(info.due) || 0) : null;
        const cabinetId = b.resourceId || '';
        rows.push({
            bookingId: b.id,
            time: fromMinutes(start),
            endTime: fromMinutes(start + duration),
            duration,
            userId: b.userId || '',
            clientKey: String(u?.id || u?.email || b.userId || ''),
            client: clientName(b.userId || '', u),
            phone: u?.phone || null,
            cabinetId,
            cabinet: names.get(cabinetId) || cabinetId,
            status: b.status,
            paymentStatus: b.paymentStatus ?? null,
            price: round2(Number(b.finalPrice) || 0),
            due,
            paid: !!info && due !== null && due <= 0,
            charged: !!info?.charged,
            uncharged: !info && b.status === 'completed' && b.paymentStatus === 'pending'
                && (Number(b.finalPrice) || 0) > 0,
        });
    }
    rows.sort((a, b) => a.time.localeCompare(b.time) || a.cabinet.localeCompare(b.cabinet) || a.client.localeCompare(b.client));
    return rows;
}

/** «взять 72 ₾ с 2 клиентов» — Σ due > 0 по строкам дня. */
export function todaySummary(rows: TodayRow[]): TodaySummary {
    let amount = 0;
    const who = new Set<string>();
    for (const r of rows || []) {
        if (r.due !== null && r.due > 0) {
            amount += r.due;
            who.add(r.clientKey ?? r.userId);
        }
    }
    amount = round2(amount);
    const clients = who.size;
    const label = amount > 0
        ? `взять ${money(amount)} ₾ с ${clients} ${clientsWord(clients)}`
        : 'сегодня брать не с кого';
    return { amount, clients, label };
}

/** Правая колонка «Взять сегодня»: по клиенту — за сегодня, весь долг, лимит. */
export function byClient(rows: TodayRow[], users: TodayUserInput[]): TodayClient[] {
    const idx = userIndex(users);
    const groups = new Map<string, TodayRow[]>();
    for (const r of rows || []) {
        const key = r.clientKey ?? r.userId;
        const list = groups.get(key) || [];
        list.push(r);
        groups.set(key, list);
    }
    const out: TodayClient[] = [];
    for (const [userId, list] of groups) {
        const u = idx.get(userId) || idx.get(list[0].userId);
        const today = round2(list.reduce((s, r) => s + (r.due !== null && r.due > 0 ? r.due : 0), 0));
        // Ещё не списанные сегодняшние брони — их на балансе пока нет.
        const notCharged = round2(list.reduce((s, r) => s + (!r.charged && r.due !== null && r.due > 0 ? r.due : 0), 0));
        const balance = u && u.balance !== null && u.balance !== undefined ? Number(u.balance) : null;
        const debt = balance !== null && balance < 0 ? round2(-balance) : 0;
        const limit = u && u.creditLimit !== null && u.creditLimit !== undefined ? Number(u.creditLimit) : null;
        out.push({
            userId,
            client: list[0].client,
            phone: list[0].phone,
            today,
            debt,
            total: round2(debt + notCharged),
            balance,
            creditLimit: limit,
            overLimit: limit !== null && debt > limit,
            rows: list,
        });
    }
    out.sort((a, b) => b.today - a.today || b.total - a.total || a.client.localeCompare(b.client));
    return out;
}
