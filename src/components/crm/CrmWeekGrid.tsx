/**
 * «Один календарь» Psy-CRM — неделя (этапы 4.1–4.3, владелец 10.10).
 *
 * Одна сетка по времени на 7 дней: CRM-сессии и ваши аренды кабинетов вместе.
 *   • сессия с арендой — сплошная плитка «Анна · Каб. 5»;
 *   • сессия без кабинета — пунктир «нет кабинета» (онлайн или забыли снять);
 *   • своя аренда без сессии — пунктир «нет сессии».
 * 4.2 — нажатие на пустое время: «Новая встреча» — сессия (+ событие в Google)
 *   и, по желанию, аренда кабинета одним действием.
 * 4.3 — перетаскивание плитки: сессия с арендой переносится переносом БРОНИ
 *   (сервер сам двигает сессию и событие в Google и считает доплату по
 *   обычным правилам переноса), сессия без кабинета — переносом сессии,
 *   аренда без сессии — переносом брони.
 * Своих денежных формул здесь нет: только готовые запросы (bookingsApi,
 * crmApi), как в шахматке CRM.
 *
 * Время: сессии в базе — UTC-naive, на запись сервер ждёт «наивную» строку
 * по Тбилиси (utils/crmNextSession). Брони — день + «HH:MM» по Тбилиси.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, addWeeks, eachDayOfInterval, endOfWeek, format, startOfWeek, subWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, MapPin, UserRound, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { useCrmStore } from '../../store/crmStore';
import { crmApi, type CrmClient, type CrmSession } from '../../api/crm';
import { bookingsApi } from '../../api/bookings';
import type { BookingHistoryItem } from '../../store/types';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import { parseUTC, tbilisiNow } from '../../utils/dateUtils';
import { toTbilisiNaive, utcNaiveToTbilisi } from '../../utils/crmNextSession';
import { createSessionResolvingCalendar } from '../../utils/crmCalendarConflict';
import { apiErrorMessage } from '../../utils/errors';
import { formatDateLabel, formatGel } from '../../utils/format';
import { useConfirmDialog } from '../ui/ConfirmDialogProvider';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field, Input } from '../ui/Field';
import { PickList, PickRow } from './CrmChessboardView';

const SLOT = 30;            // шаг сетки, мин
const ROW_H = 22;           // высота 30 минут, px
const DAY_MIN = 8 * 60;     // сетка не уже 08:00–22:00
const DAY_MAX = 22 * 60;
const SESSION_DURATIONS = [45, 50, 60, 90, 120];
const LIVE_BOOKING = new Set(['confirmed', 'completed', 'pending_approval']);
/** Занятость кабинета: ещё и пересданная бронь (как в шахматке CRM). */
const BUSY_BOOKING = new Set(['confirmed', 'completed', 'pending_approval', 're-rented']);
const CANCELLED_SESSION = new Set(['CANCELLED_CLIENT', 'CANCELLED_THERAPIST']);

type Item = {
    key: string;
    kind: 'session' | 'rental';
    day: string;            // YYYY-MM-DD по Тбилиси
    start: number;          // минуты от полуночи
    dur: number;
    session?: CrmSession;
    booking?: BookingHistoryItem;
    lane: number;
    lanes: number;
};

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const roomName = (id?: string | null) => (id ? (RESOURCES.find(r => r.id === id)?.name ?? id) : '');
const shortRoom = (id?: string | null) => roomName(id).replace('Кабинет', 'Каб.').replace('Капсула', 'Капс.');
// День брони — сама дата из базы (полночь дня по Тбилиси), без пояса браузера
// (ревизор 10.10: при VPN с отрицательным смещением бронь уезжала на вчера).
const bookingDay = (b: BookingHistoryItem) => {
    const raw = b.date as unknown;
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    try { return format(parseUTC(b.date), 'yyyy-MM-dd'); } catch { return ''; }
};
const durLabel = (min: number) => (min < 60 ? `${min} мин` : `${String(min / 60).replace('.', ',')} ч`);
/** Длительность аренды под сессию: полчасами, не меньше часа (50 мин → 1 ч). */
const rentalMinutes = (sessionMin: number) => Math.max(60, Math.ceil(sessionMin / SLOT) * SLOT);

/** Раскладка пересекающихся плиток дня по дорожкам. */
function layoutLanes(items: Omit<Item, 'lane' | 'lanes'>[]): Item[] {
    const sorted = [...items].sort((a, b) => a.start - b.start || b.dur - a.dur);
    const out: Item[] = [];
    let cluster: Item[] = [];
    let clusterEnd = -1;
    const flush = () => {
        const n = Math.max(1, ...cluster.map(i => i.lane + 1));
        cluster.forEach(i => { i.lanes = n; });
        out.push(...cluster);
        cluster = [];
    };
    for (const it of sorted) {
        if (cluster.length && it.start >= clusterEnd) { flush(); clusterEnd = -1; }
        const used = new Set(cluster.filter(c => c.start + c.dur > it.start).map(c => c.lane));
        let lane = 0;
        while (used.has(lane)) lane++;
        const placed: Item = { ...it, lane, lanes: 1 };
        cluster.push(placed);
        clusterEnd = Math.max(clusterEnd, it.start + it.dur);
    }
    if (cluster.length) flush();
    return out;
}

export function CrmWeekGrid({ onChanged }: { onChanged?: () => void }) {
    const navigate = useNavigate();
    const { confirm } = useConfirmDialog();
    const { bookings, currentUser, fetchBookings } = useUserStore();
    const { resources, fetchResources } = useBookingStore();
    const { clients, fetchClients } = useCrmStore();

    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [newSlot, setNewSlot] = useState<{ day: string; time: string } | null>(null);
    const [openItem, setOpenItem] = useState<Item | null>(null);

    const days = useMemo(() => eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) })
        .map(d => format(d, 'yyyy-MM-dd')), [weekStart]);

    const loadSeq = useRef(0);
    const loadWeek = useCallback(async () => {
        const seq = ++loadSeq.current;
        setLoading(true);
        try {
            // С запасом в сутки: сессии в базе по UTC, неделя — по Тбилиси.
            const from = format(addDays(weekStart, -1), 'yyyy-MM-dd');
            const to = format(addDays(weekStart, 7), 'yyyy-MM-dd');
            const list = await crmApi.getSessions({ dateFrom: from, dateTo: to });
            if (seq === loadSeq.current) setSessions(list);   // ответ прошлой недели не затирает новую
        } catch (e) {
            if (seq === loadSeq.current) toast.error(apiErrorMessage(e, 'Не удалось загрузить неделю'));
        } finally {
            if (seq === loadSeq.current) setLoading(false);
        }
    }, [weekStart]);

    useEffect(() => { loadWeek(); }, [loadWeek]);
    useEffect(() => {
        fetchBookings();
        if (!resources.length) fetchResources();
        if (!clients.length) fetchClients();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const reloadAll = useCallback(async () => {
        await Promise.all([loadWeek(), fetchBookings()]);
        onChanged?.();
    }, [loadWeek, fetchBookings, onChanged]);

    const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
    const myEmail = currentUser?.email;
    const bookingById = useMemo(() => new Map(bookings.map(b => [b.id, b])), [bookings]);
    const myBookings = useMemo(
        () => bookings.filter(b => b.userId === myEmail && LIVE_BOOKING.has(b.status)),
        [bookings, myEmail],
    );

    const itemsByDay = useMemo(() => {
        const linked = new Set(sessions.filter(s => s.bookingId && !CANCELLED_SESSION.has(s.status)).map(s => s.bookingId as string));
        const raw: Omit<Item, 'lane' | 'lanes'>[] = [];
        for (const s of sessions) {
            if (s.status === 'CANCELLED_CLIENT' || s.status === 'CANCELLED_THERAPIST') continue;
            const wc = utcNaiveToTbilisi(s.date);
            if (!wc || !days.includes(wc.date)) continue;
            raw.push({
                key: `s-${s.id}`, kind: 'session', day: wc.date, start: toMin(wc.time),
                dur: s.durationMinutes || 60, session: s,
                booking: s.bookingId ? bookingById.get(s.bookingId) : undefined,
            });
        }
        for (const b of myBookings) {
            if (linked.has(b.id)) continue;
            const d = bookingDay(b);
            if (!days.includes(d) || !b.startTime) continue;
            raw.push({ key: `b-${b.id}`, kind: 'rental', day: d, start: toMin(b.startTime), dur: b.duration || 60, booking: b });
        }
        const map = new Map<string, Item[]>();
        for (const d of days) map.set(d, layoutLanes(raw.filter(i => i.day === d)));
        return map;
    }, [sessions, myBookings, bookingById, days]);

    // Границы сетки: 08–22, шире — если встречи выходят за них.
    const [gridFrom, gridTo] = useMemo(() => {
        let lo = DAY_MIN, hi = DAY_MAX;
        for (const list of itemsByDay.values()) for (const i of list) {
            lo = Math.min(lo, Math.floor(i.start / 60) * 60);
            hi = Math.max(hi, Math.ceil((i.start + i.dur) / 60) * 60);
        }
        return [Math.max(0, lo), Math.min(24 * 60, hi)];
    }, [itemsByDay]);
    const rows = (gridTo - gridFrom) / SLOT;

    const now = tbilisiNow();
    const isPast = (day: string, min: number) => day < now.ymd || (day === now.ymd && min < now.totalMins);
    /** Время по умолчанию для «+»: сегодня — ближайшие полчаса, иначе 10:00. */
    const defaultTime = (day: string) => day === now.ymd
        ? toHM(Math.min(21 * 60, Math.ceil((now.totalMins + 1) / SLOT) * SLOT))
        : '10:00';

    // ── Перетаскивание (4.3) ────────────────────────────────────────────
    // grab — на сколько слотов ниже начала плитки её схватили (двигаем верх, а не курсор).
    const drag = useRef<{ item: Item; x: number; y: number; moved: boolean; grab: number } | null>(null);
    // После перетаскивания браузер шлёт click в колонку дня — его гасим (ревизор 10.10).
    const justDragged = useRef(false);
    const [preview, setPreview] = useState<{ day: string; start: number } | null>(null);

    const slotAt = (clientX: number, clientY: number, grab = 0): { day: string; start: number } | null => {
        const el = document.elementFromPoint(clientX, clientY)?.closest('[data-week-day]') as HTMLElement | null;
        if (!el) return null;
        const day = el.getAttribute('data-week-day') || '';
        const rect = el.getBoundingClientRect();
        const y = clientY - rect.top;
        const idx = Math.max(0, Math.min(rows - 1, Math.floor(y / ROW_H) - grab));
        return { day, start: gridFrom + idx * SLOT };
    };

    useEffect(() => {
        const move = (e: PointerEvent) => {
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
            d.moved = true;
            // Планшет / длинная неделя: у края окна страница сама подкручивается.
            if (e.clientY > window.innerHeight - 48) window.scrollBy(0, 14);
            else if (e.clientY < 48) window.scrollBy(0, -14);
            const at = slotAt(e.clientX, e.clientY, d.grab);
            if (at) setPreview(at);
        };
        const up = (e: PointerEvent) => {
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            if (!d.moved) { setPreview(null); setOpenItem(d.item); return; }
            justDragged.current = true;
            window.setTimeout(() => { justDragged.current = false; }, 0);
            const at = slotAt(e.clientX, e.clientY, d.grab);
            setPreview(null);
            if (at && (at.day !== d.item.day || at.start !== d.item.start)) void moveItem(d.item, at.day, at.start);
        };
        // Отменённый жест (меню, долгое касание) и Esc — бросаем перетаскивание.
        const cancel = () => { if (drag.current) { drag.current = null; setPreview(null); } };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', esc);
        return () => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', esc);
        };
    });

    const moveItem = async (it: Item, day: string, start: number) => {
        const when = `${formatDateLabel(day)}, ${toHM(start)}`;
        const who = it.session ? (clientById.get(it.session.clientId)?.name ?? 'встречу') : `аренду ${shortRoom(it.booking?.resourceId)}`;
        const withBooking = !!it.booking;
        const startsMs = (() => {
            const [y, mo, dd] = it.day.split('-').map(Number);
            return Date.UTC(y, mo - 1, dd, 0, 0) + (it.start - 4 * 60) * 60000;     // Тбилиси → UTC
        })();
        const lateMove = withBooking && startsMs - Date.now() < 24 * 3600 * 1000;
        const ok = await confirm({
            title: `Перенести ${it.session ? `встречу «${who}»` : who} на ${when}?`,
            body: withBooking
                ? `Аренда ${shortRoom(it.booking?.resourceId)} переедет вместе с ней${it.session ? ', событие в Google тоже' : ''}. Если новое время дороже (пиковые часы), разницу спишет баланс — по обычным правилам переноса.${it.booking?.recurringGroupId ? ' Это встреча из серии — переносится только она; всю серию переносят в «Бронированиях».' : ''}${lateMove ? ' До встречи меньше суток: по правилам аренды перенос может быть недоступен или израсходует бесплатный перенос абонемента.' : ''}`
                : 'Событие в Google Календаре передвинется вслед за сессией. Кабинета у этой встречи нет.',
            confirmLabel: 'Перенести',
            cancelLabel: 'Оставить',
        });
        if (!ok) return;
        if (!it.booking && it.session?.bookingId) {
            // Аренда есть, но не в загруженном списке — переносом сессии бронь осталась бы на месте.
            toast.error('У встречи есть аренда кабинета — перенесите её в «Бронированиях», сессия переедет вместе с ней.');
            return;
        }
        setBusy(true);
        try {
            if (it.booking) {
                const before = Number(it.booking.finalPrice || 0);
                const res = await bookingsApi.rescheduleBooking(it.booking.id, {
                    newDate: day, newStartTime: toHM(start), newResourceId: it.booking.resourceId ?? undefined,
                });
                const after = Number((res as BookingHistoryItem | undefined)?.finalPrice ?? before);
                const diff = Math.round((after - before) * 100) / 100;
                toast.success(diff > 0 ? `Перенесено. Доплата за новое время: ${formatGel(diff)}`
                    : diff < 0 ? `Перенесено. Вернули на баланс: ${formatGel(-diff)}` : 'Перенесено');
            } else if (it.session) {
                await crmApi.updateSession(it.session.id, { date: toTbilisiNaive(day, toHM(start)) });
                toast.success('Встреча перенесена');
            }
            await reloadAll();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось перенести. Кабинет в это время может быть занят — проверьте в «Бронированиях»'));
        } finally {
            setBusy(false);
        }
    };

    // ── Рисунок ───────────────────────────────────────────────────────
    const tileStyle = (it: Item, past: boolean): CSSProperties => {
        const noCab = it.kind === 'session' && !it.booking && !it.session?.bookingId;
        const rental = it.kind === 'rental';
        return {
            position: 'absolute',
            top: ((it.start - gridFrom) / SLOT) * ROW_H + 1,
            height: Math.max(ROW_H - 2, (it.dur / SLOT) * ROW_H - 2),
            left: `calc(${(it.lane / it.lanes) * 100}% + 2px)`,
            width: `calc(${100 / it.lanes}% - 4px)`,
            borderRadius: 6,
            padding: '2px 6px',
            fontSize: 12, lineHeight: 1.25, overflow: 'hidden', textAlign: 'left',
            cursor: busy ? 'progress' : 'grab', touchAction: 'none', userSelect: 'none',
            border: rental ? '1.5px dashed var(--color-ink-30, #b9c2be)'
                : noCab ? '1.5px dashed var(--status-ok-fg)' : '1px solid var(--status-ok-fg)',
            background: rental ? 'var(--color-paper, #fff)' : noCab ? 'var(--color-paper, #fff)' : 'var(--status-ok-bg)',
            color: rental ? 'var(--color-ink-60)' : 'var(--color-ink)',
            opacity: past ? 0.6 : 1,
        };
    };

    const tileText = (it: Item) => {
        if (it.kind === 'rental') return { title: shortRoom(it.booking?.resourceId), sub: 'нет сессии' };
        const c = it.session ? clientById.get(it.session.clientId) : undefined;
        const name = c ? `${c.name}${c.aliasCode ? ` #${c.aliasCode}` : ''}` : 'Клиент';
        return { title: name, sub: it.booking ? shortRoom(it.booking.resourceId) : it.session?.bookingId ? 'кабинет снят' : 'нет кабинета' };
    };

    const counts = useMemo(() => {
        let noCab = 0, noSess = 0;
        for (const l of itemsByDay.values()) for (const i of l) {
            if (i.kind === 'rental') noSess++;
            else if (!i.booking && !i.session?.bookingId) noCab++;
        }
        return { noCab, noSess };
    }, [itemsByDay]);

    return (
        <div data-crm-week-grid>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <Button variant="secondary" aria-label="Предыдущая неделя" onClick={() => setWeekStart(d => subWeeks(d, 1))}><ChevronLeft size={16} /></Button>
                <span style={{ fontSize: 14, fontWeight: 600, minWidth: 150, textAlign: 'center' }}>
                    {formatDateLabel(days[0])} – {formatDateLabel(days[6])}
                </span>
                <Button variant="secondary" aria-label="Следующая неделя" onClick={() => setWeekStart(d => addWeeks(d, 1))}><ChevronRight size={16} /></Button>
                <Button variant="quiet" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Эта неделя</Button>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-ink-60)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <Legend kind="ok" label="Сессия с кабинетом" />
                    <Legend kind="nocab" label={`Нет кабинета${counts.noCab ? ` · ${counts.noCab}` : ''}`} />
                    <Legend kind="rental" label={`Аренда без сессии${counts.noSess ? ` · ${counts.noSess}` : ''}`} />
                </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-ink-60)', margin: '0 0 10px' }}>
                Нажмите на пустое время — новая встреча. Перетащите плитку — перенос вместе с кабинетом и событием в Google.
                {loading ? ' Загружаем…' : ''}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '48px repeat(7, minmax(96px, 1fr))', border: '1px solid var(--color-ink-10)', borderRadius: 8, overflowX: 'auto' }}>
                <div />
                {days.map(d => (
                    <div key={d} style={{ padding: '4px', fontSize: 12, fontWeight: d === now.ymd ? 700 : 600, textAlign: 'center',
                        borderLeft: '1px solid var(--color-ink-10)', borderBottom: '1px solid var(--color-ink-10)',
                        color: d === now.ymd ? 'var(--color-accent-ink, inherit)' : 'var(--color-ink)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span>{formatDateLabel(d)}</span>
                        {/* С клавиатуры и без мыши: новая встреча на этот день. */}
                        <button type="button" data-week-add={d} aria-label={`Новая встреча, ${formatDateLabel(d)}`} title="Новая встреча"
                            onClick={() => setNewSlot({ day: d, time: defaultTime(d) })}
                            style={{ minWidth: 24, minHeight: 24, border: '1px solid var(--color-ink-10)', borderRadius: 6, background: 'transparent',
                                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink-60)' }}>
                            <Plus size={12} aria-hidden="true" />
                        </button>
                    </div>
                ))}
                <div style={{ position: 'relative', height: rows * ROW_H }}>
                    {Array.from({ length: rows / 2 }, (_, i) => (
                        <div key={i} className="num" style={{ position: 'absolute', top: i * 2 * ROW_H - 6, right: 6, fontSize: 12, color: 'var(--color-ink-60)' }}>
                            {i > 0 ? toHM(gridFrom + i * 60) : ''}
                        </div>
                    ))}
                </div>
                {days.map(d => (
                    <div
                        key={d}
                        data-week-day={d}
                        role="group"
                        aria-label={formatDateLabel(d)}
                        onClick={(e) => {
                            if (justDragged.current || drag.current) return;
                            if ((e.target as HTMLElement).closest('[data-week-item]')) return;
                            const at = slotAt(e.clientX, e.clientY);
                            if (at) setNewSlot({ day: at.day, time: toHM(at.start) });
                        }}
                        style={{
                            position: 'relative', height: rows * ROW_H, borderLeft: '1px solid var(--color-ink-10)', cursor: 'cell',
                            backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${2 * ROW_H - 1}px, var(--color-ink-10, #e3e8e5) ${2 * ROW_H - 1}px, var(--color-ink-10, #e3e8e5) ${2 * ROW_H}px)`,
                            backgroundColor: d < now.ymd ? 'var(--color-sunken, #f6f8f7)' : undefined,
                        }}
                    >
                        {d === now.ymd && now.totalMins >= gridFrom && now.totalMins <= gridTo && (
                            <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: ((now.totalMins - gridFrom) / SLOT) * ROW_H, height: 2, background: 'var(--status-danger-fg)', zIndex: 2 }} />
                        )}
                        {(itemsByDay.get(d) || []).map(it => {
                            const t = tileText(it);
                            const past = isPast(it.day, it.start + it.dur);
                            return (
                                <button
                                    key={it.key}
                                    type="button"
                                    data-week-item={it.kind}
                                    title={`${t.title} · ${toHM(it.start)}–${toHM(it.start + it.dur)} · ${t.sub}`}
                                    onPointerDown={(e) => {
                                        if (busy || e.button !== 0) return;
                                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        drag.current = { item: it, x: e.clientX, y: e.clientY, moved: false, grab: Math.max(0, Math.floor((e.clientY - r.top) / ROW_H)) };
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenItem(it); } }}
                                    style={tileStyle(it, past)}
                                >
                                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        <span className="num">{toHM(it.start)}</span> {t.title}
                                    </div>
                                    {it.dur >= 45 && <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-ink-60)' }}>{t.sub}</div>}
                                </button>
                            );
                        })}
                        {preview && preview.day === d && drag.current && (
                            <div aria-hidden="true" style={{
                                position: 'absolute', left: 2, right: 2, top: ((preview.start - gridFrom) / SLOT) * ROW_H,
                                height: (drag.current.item.dur / SLOT) * ROW_H, border: '2px solid var(--color-accent, #2e7a5c)',
                                borderRadius: 6, background: 'var(--color-accent-soft, rgba(46,122,92,0.08))', pointerEvents: 'none', zIndex: 3,
                                fontSize: 12, padding: '2px 6px', fontWeight: 600,
                            }}>{toHM(preview.start)}</div>
                        )}
                    </div>
                ))}
            </div>

            {newSlot && (
                <NewMeetingSheet
                    slot={newSlot}
                    clients={clients.filter(c => c.isActive)}
                    bookings={bookings}
                    resources={resources}
                    past={isPast(newSlot.day, toMin(newSlot.time))}
                    onClose={() => setNewSlot(null)}
                    onDone={async () => { setNewSlot(null); await reloadAll(); }}
                />
            )}
            {openItem && (
                <ItemSheet
                    item={openItem}
                    client={openItem.session ? clientById.get(openItem.session.clientId) : undefined}
                    clients={clients.filter(c => c.isActive)}
                    bookings={bookings}
                    resources={resources}
                    past={isPast(openItem.day, openItem.start)}
                    onClose={() => setOpenItem(null)}
                    onOpenClient={(id) => navigate(`/crm/clients/${id}`)}
                    onOpenBookings={() => navigate('/crm/bookings')}
                    onDone={async () => { setOpenItem(null); await reloadAll(); }}
                    onMove={(day, start) => { const it = openItem; setOpenItem(null); void moveItem(it, day, start); }}
                />
            )}
        </div>
    );
}

function Legend({ kind, label }: { kind: 'ok' | 'nocab' | 'rental'; label: string }) {
    const box: CSSProperties = {
        display: 'inline-block', width: 14, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1,
        border: kind === 'ok' ? '1px solid var(--status-ok-fg)' : kind === 'nocab' ? '1.5px dashed var(--status-ok-fg)' : '1.5px dashed var(--color-ink-30, #b9c2be)',
        background: kind === 'ok' ? 'var(--status-ok-bg)' : 'transparent',
    };
    return <span><i aria-hidden="true" style={box} />{label}</span>;
}

// ── Свободные кабинеты на время ────────────────────────────────────────────
type Res = { id: string; name: string; locationId?: string; isActive?: boolean; type?: string };

function freeRooms(resources: Res[], bookings: BookingHistoryItem[], day: string, start: number, minutes: number, location: string): Res[] {
    const end = start + minutes;
    const list = (resources.length ? resources : (RESOURCES as unknown as Res[]))
        .filter(r => r.isActive !== false && (location === 'all' || r.locationId === location));
    return list.filter(r => !bookings.some(b => {
        if (b.resourceId !== r.id || !BUSY_BOOKING.has(b.status) || !b.startTime) return false;
        if (bookingDay(b) !== day) return false;
        const bs = toMin(b.startTime), be = bs + (b.duration || 60);
        return bs < end && start < be;
    }));
}

/** Аренда: создать бронь и вернуть её id (как CrmQuickBookModal — по свежему списку). */
async function createRental(roomId: string, day: string, time: string, minutes: number): Promise<string> {
    const res = RESOURCES.find(r => r.id === roomId);
    const out = await bookingsApi.createBooking({
        resourceId: roomId, date: day, startTime: time, duration: minutes,
        format: res?.formats?.[0] || 'individual', locationId: res?.locationId,
    } as never);
    const direct = (out as { id?: string } | undefined)?.id;
    if (direct) return direct;
    await useUserStore.getState().fetchBookings();
    const found = useUserStore.getState().bookings.find(b =>
        bookingDay(b) === day && b.startTime === time && b.resourceId === roomId && LIVE_BOOKING.has(b.status));
    if (!found) throw new Error('Бронь создана, но не нашлась в списке — обновите страницу');
    return found.id;
}

function RoomPicker({ rooms, value, onChange, location, setLocation }: {
    rooms: Res[]; value: string; onChange: (id: string) => void; location: string; setLocation: (l: string) => void;
}) {
    return (
        <div>
            <div className="ui-chip-row" role="group" aria-label="Филиал" style={{ marginBottom: 8 }}>
                {[{ id: 'all', name: 'Все' }, ...LOCATIONS].map(l => (
                    <Chip key={l.id} selected={location === l.id} onClick={() => setLocation(l.id)}>{l.name}</Chip>
                ))}
            </div>
            {rooms.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--color-ink-60)' }}>На это время свободных кабинетов нет — выберите другое время или «Без кабинета».</div>
            ) : (
                <div className="ui-chip-row" role="group" aria-label="Кабинет">
                    {rooms.map(r => (
                        <Chip key={r.id} selected={value === r.id} onClick={() => onChange(r.id)}>{shortRoom(r.id)}</Chip>
                    ))}
                </div>
            )}
        </div>
    );
}

function ClientPicker({ clients, value, onChange }: { clients: CrmClient[]; value: string; onChange: (id: string) => void }) {
    const [q, setQ] = useState('');
    const list = useMemo(() => clients.filter(c =>
        c.name.toLowerCase().includes(q.toLowerCase()) || (c.aliasCode || '').includes(q.replace('#', '')) || (c.phone || '').includes(q),
    ), [clients, q]);
    return (
        <div>
            <Field label="Клиент">
                <Input kind="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Имя, телефон или код" />
            </Field>
            <PickList label="Клиенты">
                {list.slice(0, 8).map(c => (
                    <PickRow key={c.id} selected={value === c.id} onClick={() => onChange(c.id)} meta={c.aliasCode ? `#${c.aliasCode}` : undefined}>
                        {c.name}
                    </PickRow>
                ))}
                {list.length === 0 && <div style={{ fontSize: 13, color: 'var(--color-ink-60)', padding: '12px 4px' }}>Никого не нашли — проверьте имя или код</div>}
            </PickList>
        </div>
    );
}

// ── 4.2 Новая встреча ──────────────────────────────────────────────────────
function NewMeetingSheet({ slot, clients, bookings, resources, past, onClose, onDone }: {
    slot: { day: string; time: string }; clients: CrmClient[]; bookings: BookingHistoryItem[]; resources: Res[];
    past: boolean; onClose: () => void; onDone: () => Promise<void>;
}) {
    const { createSession, updateSession } = useCrmStore();
    const [clientId, setClientId] = useState('');
    const [dur, setDur] = useState(50);
    const [price, setPrice] = useState('');
    const [withRoom, setWithRoom] = useState(false);
    const [location, setLocation] = useState('all');
    const [roomId, setRoomId] = useState('');
    const [saving, setSaving] = useState(false);
    const client = clients.find(c => c.id === clientId);
    useEffect(() => { if (client) setPrice(String(client.basePrice || '')); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
    const rentMin = rentalMinutes(dur);
    const rooms = useMemo(() => freeRooms(resources, bookings, slot.day, toMin(slot.time), rentMin, location),
        [resources, bookings, slot, rentMin, location]);
    useEffect(() => { if (roomId && !rooms.some(r => r.id === roomId)) setRoomId(''); }, [rooms, roomId]);

    const submit = async () => {
        if (!clientId) { toast.error('Выберите клиента'); return; }
        if (withRoom && !roomId) { toast.error('Выберите кабинет или снимите галочку «Снять кабинет»'); return; }
        setSaving(true);
        try {
            let bookingId: string | undefined;
            if (withRoom) bookingId = await createRental(roomId, slot.day, slot.time, rentMin);
            let made: unknown = null;
            try {
                made = await createSessionResolvingCalendar(createSession, updateSession, {
                    clientId, date: toTbilisiNaive(slot.day, slot.time), durationMinutes: dur,
                    price: Number(price) || undefined, bookingId, isBooked: !!bookingId, pushToCalendar: true,
                });
            } catch (e) {
                if (!bookingId) throw e;
                toast.error(`${shortRoom(roomId)} снят, но сессия не записалась: ${apiErrorMessage(e, 'ошибка')}. Нажмите на аренду в сетке → «Записать сессию».`, { duration: 10000 });
                await onDone();
                return;
            }
            if (!made) {
                // Отказались в вопросе «у клиента уже есть встреча рядом».
                if (bookingId) toast.warning(`${shortRoom(roomId)} снят, сессию не записали — аренда видна в сетке как «нет сессии».`, { duration: 8000 });
                await onDone();
                return;
            }
            toast.success(bookingId ? `Встреча записана, ${shortRoom(roomId)} снят` : 'Встреча записана');
            await onDone();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось записать встречу'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            open onClose={onClose} dismissible={!saving} width={500}
            title="Новая встреча"
            description={`${formatDateLabel(slot.day)}, ${slot.time}–${toHM(toMin(slot.time) + dur)}`}
            footer={<>
                <Button variant="primary" loading={saving} onClick={submit}>
                    {withRoom ? 'Записать и снять кабинет' : 'Записать'}
                </Button>
                <Button variant="secondary" disabled={saving} onClick={onClose}>Отмена</Button>
            </>}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <ClientPicker clients={clients} value={clientId} onChange={setClientId} />
                <div>
                    <div style={{ fontSize: 13, color: 'var(--color-ink-60)', marginBottom: 8 }}>Длительность</div>
                    <div className="ui-chip-row" role="group" aria-label="Длительность">
                        {SESSION_DURATIONS.map(d => <Chip key={d} selected={dur === d} onClick={() => setDur(d)}>{durLabel(d)}</Chip>)}
                    </div>
                </div>
                {client && (
                    <Field label="Стоимость сессии">
                        <Input kind="money" type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder={String(client.basePrice || 0)} />
                    </Field>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: past ? 'not-allowed' : 'pointer', opacity: past ? 0.6 : 1 }}>
                    <input type="checkbox" checked={withRoom} disabled={past} onChange={e => setWithRoom(e.target.checked)} />
                    <MapPin size={14} aria-hidden="true" /> Снять кабинет на это время ({durLabel(rentMin)})
                </label>
                {past && <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>Время уже прошло — записываем только сессию, без кабинета.</div>}
                {withRoom && !past && (
                    <>
                        <RoomPicker rooms={rooms} value={roomId} onChange={setRoomId} location={location} setLocation={setLocation} />
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                            Аренда оплачивается по обычным правилам: бонусные часы → абонемент → баланс. Сессия и событие в Google появятся сразу.
                        </div>
                    </>
                )}
            </div>
        </Sheet>
    );
}

// ── Плитка: подробности и действия ─────────────────────────────────────────
function ItemSheet({ item, client, clients, bookings, resources, past, onClose, onOpenClient, onOpenBookings, onDone, onMove }: {
    item: Item; client?: CrmClient; clients: CrmClient[]; bookings: BookingHistoryItem[]; resources: Res[]; past: boolean;
    onClose: () => void; onOpenClient: (id: string) => void; onOpenBookings: () => void; onDone: () => Promise<void>;
    /** Перенос без мыши (клавиатура, планшет) — тот же путь, что перетаскивание. */
    onMove?: (day: string, start: number) => void;
}) {
    const [moveDay, setMoveDay] = useState(item.day);
    const [moveTime, setMoveTime] = useState(toHM(item.start));
    const { createSession, updateSession } = useCrmStore();
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<'main' | 'room' | 'link'>('main');
    const [location, setLocation] = useState('all');
    const [roomId, setRoomId] = useState('');
    const [linkClient, setLinkClient] = useState('');
    const s = item.session;
    const time = `${toHM(item.start)}–${toHM(item.start + item.dur)}`;
    const rentMin = rentalMinutes(item.dur);
    const rooms = useMemo(() => freeRooms(resources, bookings, item.day, item.start, rentMin, location),
        [resources, bookings, item, rentMin, location]);

    const run = async (fn: () => Promise<unknown>, ok: string) => {
        setBusy(true);
        try {
            const r = await fn();
            if (r === false) { await onDone(); return; }   // отказались в вопросе о встрече рядом
            toast.success(ok); await onDone();
        }
        catch (e) { toast.error(apiErrorMessage(e, 'Не получилось')); }
        finally { setBusy(false); }
    };

    const title = item.kind === 'rental' ? `Аренда · ${shortRoom(item.booking?.resourceId)}` : (client?.name ?? 'Сессия');
    return (
        <Sheet open onClose={onClose} dismissible={!busy} width={460} title={title}
            description={`${formatDateLabel(item.day)}, ${time}`}
            footer={mode === 'room' ? <>
                <Button variant="primary" loading={busy} disabled={!roomId} onClick={() => run(async () => {
                    const bid = await createRental(roomId, item.day, toHM(item.start), rentMin);
                    if (s) await crmApi.updateSession(s.id, { bookingId: bid, isBooked: true });
                }, `${shortRoom(roomId)} снят и привязан к встрече`)}>Снять {roomId ? shortRoom(roomId) : 'кабинет'}</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setMode('main')}>Назад</Button>
            </> : mode === 'link' ? <>
                <Button variant="primary" loading={busy} disabled={!linkClient} onClick={() => run(async () => {
                    const c = clients.find(x => x.id === linkClient);
                    const made = await createSessionResolvingCalendar(createSession, updateSession, {
                        clientId: linkClient, date: toTbilisiNaive(item.day, toHM(item.start)),
                        durationMinutes: item.booking?.duration || 60, price: c?.basePrice || undefined,
                        bookingId: item.booking?.id, isBooked: true, pushToCalendar: true,
                    });
                    return made ? true : false;
                }, 'Сессия записана на эту аренду')}>Записать сессию</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setMode('main')}>Назад</Button>
            </> : undefined}
        >
            {mode === 'main' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 14 }}>
                        {item.kind === 'rental'
                            ? <>Кабинет снят, а сессии на это время нет. Если это встреча с клиентом — запишите её, она появится и в Google Календаре.</>
                            : item.booking
                                ? <>Кабинет: <b>{roomName(item.booking.resourceId)}</b></>
                                : s?.bookingId ? <>Кабинет под эту встречу снят.</>
                                : <>Кабинет под эту встречу не снят. Если это онлайн-сессия — кабинет не нужен.</>}
                    </div>
                    {s && (
                        <div style={{ fontSize: 13, color: 'var(--color-ink-60)' }}>
                            {s.price ? `Цена ${s.price} ${s.currency || client?.currency || ''} · ` : ''}{s.isPaid ? 'оплачено' : (past ? 'не оплачено' : 'запланирована')}
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                        {s && client && <Button variant="secondary" icon={<UserRound size={16} aria-hidden="true" />} onClick={() => onOpenClient(client.id)}>Карточка клиента</Button>}
                        {s && !item.booking && !s.bookingId && !past && <Button variant="primary" icon={<MapPin size={16} aria-hidden="true" />} onClick={() => setMode('room')}>Снять кабинет на это время</Button>}
                        {s && past && !s.isPaid && (
                            <Button variant="secondary" icon={<Wallet size={16} aria-hidden="true" />} loading={busy}
                                onClick={() => run(() => crmApi.quickPaySession(s.id), 'Оплата отмечена')}>Отметить оплату</Button>
                        )}
                        {item.kind === 'rental' && <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setMode('link')}>Записать сессию на эту аренду</Button>}
                        {item.booking && <Button variant="quiet" onClick={onOpenBookings}>Открыть «Бронирования» (отмена, деление, серия)</Button>}
                    </div>
                    {onMove && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} data-move-form>
                            <Field label="Перенести на">
                                <Input type="date" value={moveDay} onChange={e => setMoveDay(e.target.value)} />
                            </Field>
                            <Field label="Время">
                                <select className="ui-input" value={moveTime} onChange={e => setMoveTime(e.target.value)} aria-label="Время">
                                    {Array.from({ length: 28 }, (_, i) => toHM(8 * 60 + i * SLOT)).map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </Field>
                            <Button variant="secondary" disabled={!moveDay || (moveDay === item.day && moveTime === toHM(item.start))}
                                onClick={() => onMove(moveDay, toMin(moveTime))}>Перенести</Button>
                        </div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 6 }}>Или перетащите плитку на сетке.</div>
                </div>
            )}
            {mode === 'room' && <RoomPicker rooms={rooms} value={roomId} onChange={setRoomId} location={location} setLocation={setLocation} />}
            {mode === 'link' && <ClientPicker clients={clients} value={linkClient} onChange={setLinkClient} />}
        </Sheet>
    );
}


/** Телефон (этап 4.4): своя аренда без сессии на выбранный день — то же окно,
 *  что в неделе на компьютере («Записать сессию на эту аренду»). */
export function RentalSessionSheet({ booking, onClose, onDone, onOpenBookings }: {
    booking: BookingHistoryItem; onClose: () => void; onDone: () => Promise<void>; onOpenBookings: () => void;
}) {
    const navigate = useNavigate();
    const { bookings } = useUserStore();
    const { resources } = useBookingStore();
    const { clients } = useCrmStore();
    const day = bookingDay(booking);
    const start = toMin(booking.startTime || '00:00');
    const now = tbilisiNow();
    const item: Item = { key: `b-${booking.id}`, kind: 'rental', day, start, dur: booking.duration || 60, booking, lane: 0, lanes: 1 };
    return (
        <ItemSheet
            item={item} clients={clients.filter(c => c.isActive)} bookings={bookings} resources={resources}
            past={day < now.ymd || (day === now.ymd && start < now.totalMins)}
            onClose={onClose} onOpenClient={(id) => navigate(`/crm/clients/${id}`)} onOpenBookings={onOpenBookings}
            onDone={onDone}
        />
    );
}

/** Свои аренды дня без сессии (телефон). */
export function rentalsWithoutSession(bookings: BookingHistoryItem[], email: string | undefined, day: string, sessions: CrmSession[]): BookingHistoryItem[] {
    const linked = new Set(sessions.filter(x => x.bookingId && !CANCELLED_SESSION.has(x.status)).map(x => x.bookingId as string));
    return bookings
        .filter(b => b.userId === email && LIVE_BOOKING.has(b.status) && bookingDay(b) === day && !linked.has(b.id))
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}
