import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, Check, ChevronDown, RefreshCw, Plus, Plane, ChevronLeft, ChevronRight, CalendarOff } from 'lucide-react';
import { toast } from 'sonner';
import { crmApi, type CrmSession, type CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { useUserStore } from '../../../store/userStore';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { SessionActionSheet } from './SessionActionSheet';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import { useCrmCalendar, useCrmDataVersion } from './crmDataVersion';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ListAvatar, ListGroup, ListRow, ListTime } from '../../../components/ui/ListRow';
import { Money } from '../../../components/ui/Money';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import {
    formatDateLabel, formatDayMonth, formatMoney, formatStartsIn, formatTimeRange, formatWeekdayShort,
} from '../../../utils/format';
import { addDaysYmd, tbilisiToday, utcNaiveToTbilisi } from '../../../utils/crmNextSession';
import { linkCabinetPath, nextSessionLabel, useBookNext, useQuickPay } from './crmFlows';
import { usePullToRefresh } from '../usePullToRefresh';
import { RentalSessionSheet, rentalsWithoutSession } from '../../../components/crm/CrmWeekGrid';
import type { BookingHistoryItem } from '../../../store/types';
import { PullIndicator } from '../PullIndicator';
import { isBillableStatus, partialPayment, sessionDebt, sessionPriceOf } from '../../../utils/sessionMoney';
import { statusLabel } from '../../../design/statuses';

const NO_SESSIONS: CrmSession[] = [];
const CANCELLED = new Set(['CANCELLED_CLIENT', 'CANCELLED_THERAPIST']);

/** Прокручивается документ, а не <main> оболочки — его и проверяем. */
const docScroller = () => (document.scrollingElement as HTMLElement | null);

type ClientWithStats = CrmClient & { nextSessionDate?: string | null };

/**
 * Psy-CRM на телефоне — «Сегодня», вариант V2 «Три полки» (волна 3, пакет A,
 * макет scratchpad/wave3/variants/project/Today-V2.dc.html).
 *
 *  - Шапка: «Сегодня» / «Пн, 28 сентября», «+ Сессия» (NewSessionSheet с
 *    поиском клиента), синхронизация, календарь; под ней лента недели с
 *    точками на днях, где есть сессии (G6-24). День — в ?date=YYYY-MM-DD,
 *    свайп по списку листает дни.
 *  - «Дальше»: тёмная карточка ближайшей сессии («через 3 ч», время,
 *    клиент, кабинет · центр · цена), ниже — остальные будущие сессии дня.
 *  - «Закрыть день»: начавшиеся и прошедшие — неоплаченные с кнопкой
 *    «Оплата · 140 ₾» (1 тап, В5, тост «Вернуть»), оплаченные — с бейджем.
 *  - «Без следующей встречи»: у кого сегодня была сессия, а будущей нет —
 *    [Записать · вт, 7 окт., 11:00].
 *
 * День считается по Батуми: сервер фильтрует по UTC, поэтому берём два
 * дня и оставляем свой (utcNaiveToTbilisi) — сессия в 00:30 не теряется.
 * Шторки стор не обновляют — после записи/оплаты перечитываем день,
 * неделю и клиентов (со статистикой: nextSessionDate).
 */
export function MobileCrmToday() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const todayStr = tbilisiToday();
    const dateStr = searchParams.get('date') || todayStr;
    useDocumentTitle('Сегодня · Psy-CRM');

    // Список хранится вместе с датой, за которую он загружен. Под заголовком
    // показываем его, только если дата совпадает с выбранной: раньше при
    // листании под «10 окт.» висели клиенты прошлого дня, пока шёл запрос,
    // а при сбое сети — насовсем.
    const [loaded, setLoaded] = useState<{ date: string; list: CrmSession[] } | null>(null);
    const [failedDate, setFailedDate] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const reqSeq = useRef(0);
    const dataVersion = useCrmDataVersion();
    const [syncing, setSyncing] = useState(false);
    const [activeSheet, setActiveSheet] = useState<CrmSession | null>(null);
    // 09.11: открыть шторку сразу на «Сколько заплатили?» (у сессии нет цены).
    const [sheetPay, setSheetPay] = useState(false);
    const openSheet = (s: CrmSession, pay = false) => { setSheetPay(pay); setActiveSheet(s); };
    // 09.11 (ревью п. 6): без календаря кнопка ⟳ — тупик; вместо неё плашка «Как подключить».
    const calendar = useCrmCalendar();
    const clients = useCrmStore(s => s.clients) as ClientWithStats[];
    const fetchClients = useCrmStore(s => s.fetchClients);
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    const myEmail = useUserStore(s => s.currentUser?.email);
    // 10.10 «Один календарь», этап 4.4: своя аренда без сессии на этот день.
    const [rentalTarget, setRentalTarget] = useState<BookingHistoryItem | null>(null);

    useEffect(() => {
        // Брони — чтобы у сессии было «Кабинет 5 · Unbox Uni», а не «кабинет».
        fetchBookings?.();
    }, [fetchBookings]);

    // Клиенты со статистикой: nextSessionDate нужен полке «Без следующей встречи».
    const reloadClients = useCallback(() => fetchClients(false, true).catch(() => {}), [fetchClients]);
    useEffect(() => { reloadClients(); }, [reloadClients, dataVersion]);

    const reload = useCallback(async () => {
        // Номер запроса: при быстром листании ответ за промежуточный день
        // может прийти последним — такие ответы (и их ошибки) выбрасываем.
        const seq = ++reqSeq.current;
        setLoading(true);
        try {
            const raw = await crmApi.getSessions({ dateFrom: addDaysYmd(dateStr, -1), dateTo: dateStr });
            if (seq !== reqSeq.current) return;
            const list = raw.filter(s => utcNaiveToTbilisi(s.date)?.date === dateStr);
            setLoaded({ date: dateStr, list });
            setFailedDate(null);
        } catch {
            if (seq !== reqSeq.current) return;
            setFailedDate(dateStr);
        } finally {
            if (seq === reqSeq.current) setLoading(false);
        }
    }, [dateStr]);

    useEffect(() => { reload(); }, [reload, dataVersion]);

    // ── Неделя: точки на днях с сессиями (без ошибок на экране — это подсказка)
    const monday = useMemo(() => mondayOf(dateStr), [dateStr]);
    const [weekDots, setWeekDots] = useState<{ monday: string; days: Set<string> } | null>(null);
    const [weekTick, setWeekTick] = useState(0);
    useEffect(() => {
        let alive = true;
        crmApi.getSessions({ dateFrom: addDaysYmd(monday, -1), dateTo: addDaysYmd(monday, 6) })
            .then(list => {
                if (!alive) return;
                const days = new Set<string>();
                for (const s of list) {
                    if (CANCELLED.has(s.status)) continue;
                    const d = utcNaiveToTbilisi(s.date)?.date;
                    if (d) days.add(d);
                }
                setWeekDots({ monday, days });
            })
            .catch(() => { /* точки — не главное, без них лента работает */ });
        return () => { alive = false; };
    }, [monday, weekTick, dataVersion]);

    /** После записи/оплаты/правок: день, неделя и клиенты. */
    const reloadAll = useCallback(async () => {
        setWeekTick(t => t + 1);
        reloadClients();
        await reload();
    }, [reload, reloadClients]);

    const dayLoaded = loaded?.date === dateStr;
    const sessions = dayLoaded ? loaded.list : NO_SESSIONS;
    const loadFailed = failedDate === dateStr;
    const patchSessions = (fn: (list: CrmSession[]) => CrmSession[]) =>
        setLoaded(prev => (prev ? { ...prev, list: fn(prev.list) } : prev));
    const patchOne = (updated: CrmSession) => {
        patchSessions(list => list.map(x => x.id === updated.id ? updated : x));
        setActiveSheet(cur => (cur && cur.id === updated.id ? updated : cur));
    };

    // ── Записать / оплатить ──────────────────────────────────────────
    const bookNext = useBookNext(() => { reloadAll(); }, clients);
    const quickPay = useQuickPay(patchOne, () => { reloadAll(); });

    // ── Навигация по дням ────────────────────────────────────────────
    const goTo = useCallback((ymd: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
        const sp = new URLSearchParams(searchParams);
        if (ymd === todayStr) sp.delete('date');
        else sp.set('date', ymd);
        setSearchParams(sp, { replace: true });
    }, [searchParams, setSearchParams, todayStr]);
    const shiftDay = (delta: number) => goTo(addDaysYmd(dateStr, delta));

    // ── Свайп по списку: ±1 день ─────────────────────────────────────
    const startX = useRef<number | null>(null);
    const startY = useRef<number | null>(null);
    const SWIPE_PX = 70;
    const onTouchStart = (e: React.TouchEvent) => {
        startX.current = e.touches[0].clientX;
        startY.current = e.touches[0].clientY;
    };
    const onTouchEnd = (e: React.TouchEvent) => {
        if (startX.current == null || startY.current == null) return;
        const dx = e.changedTouches[0].clientX - startX.current;
        const dy = e.changedTouches[0].clientY - startY.current;
        startX.current = null;
        startY.current = null;
        // Только горизонтальный жест — вертикальную прокрутку не перехватываем.
        if (Math.abs(dx) < SWIPE_PX) return;
        if (Math.abs(dy) > Math.abs(dx) * 0.8) return;
        shiftDay(dx > 0 ? -1 : +1);
    };

    // ── Синхронизация ────────────────────────────────────────────────
    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await crmApi.syncFromCalendar(false, 1, 2);
            const orphans = (result as unknown as { orphansCancelled?: number }).orphansCancelled ?? 0;
            toast.success(
                `Календарь: добавлено ${result.created || 0}, обновлено ${result.updated || 0}${orphans > 0 ? `, отменено ${orphans}` : ''}`,
                { duration: 4500 },
            );
            await reloadAll();
        } catch (e: unknown) {
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof detail === 'string' ? detail : 'Не удалось синхронизировать с Google Календарём. Попробуйте ещё раз');
        } finally {
            setSyncing(false);
        }
    };

    // ── Потянуть вниз — обновить ─────────────────────────────────────
    const [refreshing, setRefreshing] = useState(false);
    const pull = usePullToRefresh(async () => {
        setRefreshing(true);
        try { await reloadAll(); } finally { setRefreshing(false); }
    }, 70, docScroller);

    // ── Три полки ────────────────────────────────────────────────────
    const clientById = useMemo(() => {
        const m = new Map<string, ClientWithStats>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    const shelves = useMemo(() => {
        const now = Date.now();
        const sorted = [...sessions].sort((a, b) => parseUTC(a.date).getTime() - parseUTC(b.date).getTime());
        const live = sorted.filter(s => !CANCELLED.has(s.status));
        // «Неявка · оплачивается» (NO_SHOW) — не «дальше», даже если время впереди
        // (поздняя отмена): это долг, его закрывают на полке «Закрыть день».
        const upcoming = live.filter(s => parseUTC(s.date).getTime() > now && s.status !== 'NO_SHOW');
        const started = live.filter(s => parseUTC(s.date).getTime() <= now || s.status === 'NO_SHOW');
        const cancelled = sorted.filter(s => CANCELLED.has(s.status));
        // «Без следующей встречи»: была сессия в этот день, а будущей нет.
        // Только когда клиенты пришли со статистикой (nextSessionDate есть
        // в ответе, хотя бы null) — иначе показали бы всех подряд.
        const noNext: { client: ClientWithStats; last: CrmSession }[] = [];
        if (dateStr <= todayStr) {
            const seen = new Set<string>();
            for (let i = started.length - 1; i >= 0; i--) {
                const s = started[i];
                if (seen.has(s.clientId)) continue;
                seen.add(s.clientId);
                const c = clientById.get(s.clientId);
                if (!c || c.isActive === false || c.nextSessionDate === undefined) continue;
                const hasFuture = !!c.nextSessionDate && parseUTC(c.nextSessionDate).getTime() > now;
                if (!hasFuture && !upcoming.some(u => u.clientId === s.clientId)) noNext.push({ client: c, last: s });
            }
        }
        return { upcoming, started, cancelled, noNext, total: live.length };
    }, [sessions, clientById, dateStr, todayStr]);

    const cabinetOf = (s: CrmSession): string | null => {
        if (!s.isBooked) return null;
        const b = s.bookingId ? bookings.find(x => x.id === s.bookingId) : null;
        const res = b ? RESOURCES.find(r => r.id === b.resourceId) : null;
        const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
        return res ? (loc ? `${res.name} · ${loc.name}` : res.name) : 'Кабинет забронирован';
    };
    const priceOf = (s: CrmSession): { amount: number; currency: string } | null => {
        const c = clientById.get(s.clientId);
        // Неоплаченная — остаток (цена минус внесённое); оплаченная/будущая — цена как есть.
        const d = sessionDebt(s, c);
        const amount = s.isPaid ? (Number(s.price ?? c?.basePrice ?? 0) || 0) : d.amount;
        return amount > 0 ? { amount, currency: d.currency } : null;
    };
    const timeRange = (s: CrmSession) => {
        const start = parseUTC(s.date);
        const end = new Date(start.getTime() + (s.durationMinutes || 60) * 60000);
        return formatTimeRange(start, end, { timeZone: BATUMI_TZ });
    };
    const startTime = (s: CrmSession) => utcNaiveToTbilisi(s.date)?.time ?? '';
    const nameOf = (s: CrmSession) => clientById.get(s.clientId)?.name ?? 'Клиент…';

    const isToday = dateStr === todayStr;
    const dayLabel = formatDateLabel(dateStr, { capitalize: true, withYear: 'auto' });
    const countLabel = dayLoaded ? `${shelves.total} ${pluralSessions(shelves.total)}` : '';
    const [next, ...later] = shelves.upcoming;

    return (
        <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />
            <VacationBanner />

            {/* ── Шапка (09.11 фаза 3): общая крупная шапка 28/14/16. Дата — один раз:
                подзаголовок «Пн, 9 ноября · 5 сессий» сам открывает выбор другой даты
                (раньше дата стояла ещё и на широкой кнопке «Другая дата · 9 ноября»). */}
            <MobilePageHeader
                variant="large"
                title={isToday ? 'Сегодня' : dayLabel}
                subtitle={(
                    <label className="press" style={datePickerLabel}>
                        <Calendar size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
                        <span>{[isToday ? dayLabel : 'Другая дата', countLabel].filter(Boolean).join(' · ')}</span>
                        <ChevronDown size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
                        <input
                            type="date"
                            aria-label="Выбрать дату"
                            value={dateStr}
                            onChange={e => goTo(e.target.value)}
                            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
                        />
                    </label>
                )}
                action={(
                    <>
                        {!viewingOther && (
                            <Button
                                icon={<Plus size={16} aria-hidden="true" />}
                                onClick={() => bookNext.open(undefined, undefined, isToday ? undefined : dateStr)}
                            >
                                Сессия
                            </Button>
                        )}
                        {calendar.connected !== false && (
                            <Button
                                variant="secondary"
                                disabled={syncing}
                                onClick={handleSync}
                                aria-label={syncing ? 'Синхронизируем с Google Календарём' : 'Синхронизировать с Google Календарём'}
                                icon={<RefreshCw size={16} aria-hidden="true" style={{ animation: syncing ? 'spin 1s linear infinite' : undefined }} />}
                            />
                        )}
                    </>
                )}
                className="crm-today-header"
            />

            {calendar.connected === false && !viewingOther && (
                <button
                    type="button"
                    onClick={() => calendar.openSetup?.()}
                    className="press"
                    data-calendar-plate
                    style={calendarPlate}
                >
                    <CalendarOff size={20} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-ink-60)', marginTop: 2 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 600, fontSize: 16 }}>Календарь не подключён</span>
                        <span style={{ display: 'block', fontSize: 14, color: 'var(--color-ink-60)', marginTop: 2 }}>
                            Встречи из Google Календаря будут появляться здесь сами
                        </span>
                        <span style={{ display: 'block', fontWeight: 600, color: 'var(--color-accent-ink)', marginTop: 6 }}>Как подключить</span>
                    </span>
                </button>
            )}

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.crm-today-header { padding-top: 0; padding-bottom: 0; }`}</style>

            {/* ── Лента недели (G6-24) ──────────────────────────────── */}
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 2 }}>
                <button
                    type="button"
                    onClick={() => shiftDay(-7)}
                    aria-label="Предыдущая неделя"
                    className="press"
                    style={weekArrow}
                >
                    <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <div role="group" aria-label="Дни недели" style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
                    {Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i)).map(ymd => {
                        const selected = ymd === dateStr;
                        const hasDot = weekDots?.monday === monday && weekDots.days.has(ymd);
                        const isTodayCell = ymd === todayStr;
                        return (
                            <button
                                key={ymd}
                                type="button"
                                onClick={() => goTo(ymd)}
                                aria-pressed={selected}
                                aria-label={`${formatDateLabel(ymd, { capitalize: true })}${hasDot ? ', есть сессии' : ''}`}
                                className="press"
                                style={{
                                    // 09.11 фаза 3: выбранный день — общий язык «выбрано»
                                    // (accent-soft + рамка accent), а не чёрная плитка: в тёмной
                                    // теме она была светлым пятном. Сегодня — тонкая обводка.
                                    minHeight: 56, borderRadius: 8, border: 'none', cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    background: selected ? 'var(--color-accent-soft)' : 'transparent',
                                    color: selected ? 'var(--color-accent-ink)' : 'var(--color-ink)',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                                    boxShadow: selected
                                        ? 'inset 0 0 0 1.5px var(--color-accent)'
                                        : isTodayCell ? 'inset 0 0 0 1px var(--color-ink-20)' : undefined,
                                }}
                            >
                                <span style={{ fontSize: 12, fontWeight: selected ? 600 : 500, color: selected ? undefined : 'var(--color-ink-60)' }}>{formatWeekdayShort(ymd)}</span>
                                <span className="num" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1 }}>{Number(ymd.slice(8))}</span>
                                <span aria-hidden="true" style={{
                                    width: 4, height: 4, borderRadius: 999,
                                    background: hasDot ? (selected ? 'var(--color-accent)' : 'var(--color-ink-60)') : 'transparent',
                                }} />
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    onClick={() => shiftDay(7)}
                    aria-label="Следующая неделя"
                    className="press"
                    style={weekArrow}
                >
                    <ChevronRight size={18} aria-hidden="true" />
                </button>
                </div>
                {!isToday && (
                    <div>
                        <Button variant="secondary" size="sm" onClick={() => goTo(todayStr)}>
                            К сегодня
                        </Button>
                    </div>
                )}
            </div>

            {/* ── Полки (свайп — соседний день) ─────────────────────── */}
            <div
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
                style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 24, minHeight: 200 }}
            >
                {/* Скелетон — пока день ещё не загружен. При тихом обновлении
                    того же дня полки остаются на месте. */}
                {!dayLoaded && !loadFailed && (
                    <SkeletonList count={3} label="Загружаем сессии" cardHeight={96} />
                )}

                {loadFailed && !loading && (
                    <ErrorBar
                        message={dayLoaded ? 'Не удалось обновить день' : 'Не удалось загрузить день'}
                        onRetry={() => reload()}
                    />
                )}

                {dayLoaded && !loading && shelves.total === 0 && shelves.cancelled.length === 0
                    && (viewingOther || rentalsWithoutSession(bookings, myEmail, dateStr, sessions).length === 0) && (
                    <EmptyState
                        compact
                        title="Сессий на эту дату нет"
                        hint="Листайте дни свайпом или выберите день в ленте недели."
                        action={viewingOther ? undefined : { label: 'Записать сессию', variant: 'secondary', onClick: () => bookNext.open(undefined, undefined, isToday ? undefined : dateStr) }}
                    />
                )}

                {/* 1. Дальше */}
                {dayLoaded && next && (
                    <section aria-labelledby="crm-shelf-next" style={shelfStyle}>
                        <h2 id="crm-shelf-next" style={shelfTitle}>Дальше</h2>
                        <div style={nextCard}>
                            <button type="button" onClick={() => openSheet(next)} className="press" style={nextCardButton}>
                                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8 }}>
                                    {formatStartsIn(parseUTC(next.date), {
                                        end: new Date(parseUTC(next.date).getTime() + (next.durationMinutes || 60) * 60000),
                                    })}
                                </span>
                                <span className="num" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{timeRange(next)}</span>
                                <span style={{ fontSize: 16, fontWeight: 600 }}>{nameOf(next)}</span>
                                <span style={{ fontSize: 14, opacity: 0.8 }}>
                                    {cabinetOf(next) ?? 'Без кабинета'}
                                    {priceOf(next) && <>{' · '}<Money value={priceOf(next)!.amount} currency={priceOf(next)!.currency} inline /></>}
                                </span>
                            </button>
                            {!next.isBooked && !viewingOther && (
                                <button
                                    type="button"
                                    onClick={() => { const p = linkCabinetPath(next); if (p) navigate(p); }}
                                    style={onInkButton}
                                >
                                    Забронировать кабинет
                                </button>
                            )}
                        </div>
                        {later.length > 0 && (
                            <ListGroup aria-label="Позже сегодня">
                                {later.map(s => {
                                    const p = priceOf(s);
                                    return (
                                        <ListRow
                                            key={s.id}
                                            lead={<ListTime start={startTime(s)} />}
                                            title={nameOf(s)}
                                            subtitle={cabinetOf(s) ?? undefined}
                                            onClick={() => openSheet(s)}
                                            // Будущая — цена нейтрально, без «ждёт оплаты» (G6-07/G6-15).
                                            trail={p ? <span style={{ color: 'var(--color-ink-60)', fontWeight: 500 }}><Money value={p.amount} currency={p.currency} /></span> : undefined}
                                        />
                                    );
                                })}
                            </ListGroup>
                        )}
                    </section>
                )}

                {/* 2. Закрыть день — оплата в строке тихой кнопкой (secondary sm):
                    главная бирюзовая на экране одна — «+ Сессия» (09.11 фаза 3). */}
                {dayLoaded && shelves.started.length > 0 && (
                    <div>
                        <ListGroup title="Закрыть день">
                            {shelves.started.map(s => {
                                const p = priceOf(s);
                                const busy = quickPay.busyIds.has(s.id);
                                const priceless = !p && !viewingOther && isBillableStatusOrPast(s)
                                    && sessionPriceOf(s, clientById.get(s.clientId)) <= 0;
                                return (
                                    <ListRow
                                        key={s.id}
                                        lead={<ListTime start={startTime(s)} />}
                                        title={nameOf(s)}
                                        subtitle={s.status === 'NO_SHOW'
                                            ? <span style={{ color: 'var(--status-danger-fg)', fontWeight: 600 }}>{statusLabel('session', 'NO_SHOW')}</span>
                                            : undefined}
                                        onClick={() => openSheet(s)}
                                        trail={s.isPaid ? (
                                            <StatusBadge kind="payment" status="paid" variant="dot" />
                                        ) : priceless || (p && !viewingOther) ? undefined : (
                                            <StatusBadge kind="session" status={s.status} variant="dot" />
                                        )}
                                        action={s.isPaid ? undefined : priceless ? (
                                            // 09.11 (решение 2): цены нет — оплата через «Сколько заплатили?».
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => openSheet(s, true)}
                                                aria-label={`Отметить оплату: ${nameOf(s)} — указать сумму`}
                                            >
                                                Оплата…
                                            </Button>
                                        ) : p && !viewingOther ? (
                                            // В5: оплата в один тап — на счёт клиента по умолчанию,
                                            // тост на 5 с «Вернуть». Защита от двойного тапа — в useQuickPay.
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                loading={busy}
                                                icon={partialPayment(s, clientById.get(s.clientId)) ? undefined : <Check size={16} aria-hidden="true" />}
                                                onClick={() => quickPay.pay(s)}
                                                aria-label={`Отметить оплату: ${nameOf(s)}, ${formatMoney(p.amount, { currency: p.currency })}`}
                                            >
                                                {/* Коротко «✓ 120 ₾» — имя рядом не обрезается (полный текст — в aria-label). */}
                                                {partialPayment(s, clientById.get(s.clientId))
                                                    ? <span>Доплата · <Money value={p.amount} currency={p.currency} inline /></span>
                                                    : <Money value={p.amount} currency={p.currency} inline />}
                                            </Button>
                                        ) : undefined}
                                    />
                                );
                            })}
                        </ListGroup>
                    </div>
                )}

                {/* Аренды без сессии (4.4): кабинет снят, а встречи в CRM нет. */}
                {dayLoaded && !viewingOther && (() => {
                    const rentals = rentalsWithoutSession(bookings, myEmail, dateStr, sessions);
                    if (!rentals.length) return null;
                    return (
                        <div data-rentals-shelf>
                            <ListGroup title="Аренда без сессии">
                                {rentals.map(b => (
                                    <ListRow
                                        key={b.id}
                                        lead={<ListTime start={b.startTime || ''} />}
                                        title={RESOURCES.find(r => r.id === b.resourceId)?.name ?? 'Кабинет'}
                                        onClick={() => setRentalTarget(b)}
                                        action={<Button variant="secondary" size="sm" onClick={() => setRentalTarget(b)}>Записать сессию</Button>}
                                    />
                                ))}
                            </ListGroup>
                        </div>
                    );
                })()}

                {/* 3. Без следующей встречи */}
                {dayLoaded && shelves.noNext.length > 0 && !viewingOther && (
                    <div>
                        <ListGroup title="Без следующей встречи">
                            {shelves.noNext.map(({ client, last }) => (
                                <ListRow
                                    key={client.id}
                                    lead={<ListAvatar name={client.name} />}
                                    title={client.name}
                                    subtitle={nextSessionLabel(last, client)}
                                    action={(
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => bookNext.open(client, last)}
                                            aria-label={`Записать · ${nextSessionLabel(last, client)}`}
                                        >
                                            Записать
                                        </Button>
                                    )}
                                />
                            ))}
                        </ListGroup>
                    </div>
                )}

                {/* Старые отменённые (до 14.05 отмена была статусом) */}
                {dayLoaded && shelves.cancelled.length > 0 && (
                    <div>
                        <ListGroup title="Отменённые">
                            {shelves.cancelled.map(s => (
                                <ListRow
                                    key={s.id}
                                    dimmed
                                    lead={<ListTime start={startTime(s)} />}
                                    title={nameOf(s)}
                                    onClick={() => openSheet(s)}
                                    trail={<StatusBadge kind="session" status={s.status} variant="dot" />}
                                />
                            ))}
                        </ListGroup>
                    </div>
                )}
            </div>

            {rentalTarget && (
                <RentalSessionSheet
                    booking={rentalTarget}
                    onClose={() => setRentalTarget(null)}
                    onOpenBookings={() => navigate('/m/bookings')}
                    onDone={async () => { setRentalTarget(null); await fetchBookings?.(); await reloadAll(); }}
                />
            )}
            {activeSheet && (
                <SessionActionSheet
                    key={`${activeSheet.id}-${sheetPay ? 'pay' : 'main'}`}
                    session={activeSheet}
                    initialMode={sheetPay ? 'pay' : undefined}
                    client={clientById.get(activeSheet.clientId)}
                    onClose={() => { setActiveSheet(null); setSheetPay(false); }}
                    onChange={(updated) => {
                        patchOne(updated);
                        reloadClients();
                    }}
                    onDeleted={(id) => {
                        patchSessions(list => list.filter(x => x.id !== id));
                        setActiveSheet(null);
                        reloadAll();
                    }}
                    onBookNext={(s) => {
                        setActiveSheet(null);
                        bookNext.open(clientById.get(s.clientId) ?? null, s);
                    }}
                />
            )}
            {bookNext.sheet}
        </div>
    );
}

/** Понедельник недели, в которую попадает день (календарно, без поясов). */
function mondayOf(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12)).getUTCDay();
    return addDaysYmd(ymd, -((dow + 6) % 7));
}

/** 1 сессия, 2 сессии, 5 сессий. */
function pluralSessions(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сессия';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сессии';
    return 'сессий';
}

// ─── styles ──────────────────────────────────────────────────────────
const shelfStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };

// Как подпись ListGroup («ЗАКРЫТЬ ДЕНЬ»): отступ 4, чтобы подписи полок стояли ровно.
const shelfTitle: React.CSSProperties = {
    margin: 0, padding: '0 4px', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: 'var(--color-ink-60)',
};

// Дизайн-ревью п. 1: большой тёмный блок — panel (в тёмной теме не становится светлым пятном, как ink).
const nextCard: React.CSSProperties = {
    background: 'var(--color-panel)', color: 'var(--color-on-panel)',
    borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
};

const nextCardButton: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, margin: 0, textAlign: 'left',
    color: 'inherit', fontFamily: 'inherit', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 6, width: '100%',
};

const onInkButton: React.CSSProperties = {
    alignSelf: 'flex-start', minHeight: 44, padding: '0 14px', borderRadius: 8,
    background: 'var(--color-on-panel)', color: 'var(--color-panel)', border: 'none',
    fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};


/** Подзаголовок шапки — он же выбор даты (дата на экране один раз). Зона нажатия 44 px. */
const datePickerLabel: React.CSSProperties = {
    position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
    minHeight: 44, margin: '-10px 0', cursor: 'pointer', color: 'var(--color-ink-60)',
};

const weekArrow: React.CSSProperties = {
    width: 36, minHeight: 56, flexShrink: 0, border: 'none', borderRadius: 8, padding: 0,
    background: 'transparent', color: 'var(--color-ink-60)', cursor: 'pointer',
    display: 'grid', placeItems: 'center',
};

const calendarPlate: React.CSSProperties = {
    margin: '0 16px', padding: '12px 16px', minHeight: 56, borderRadius: 16,
    background: 'var(--color-card)', border: '1px solid var(--color-ink-10)',
    color: 'var(--color-ink)', fontFamily: 'inherit', fontSize: 14, textAlign: 'left',
    display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
};

/** Прошла (или отмечена «неявка») — значит, по ней ждём оплату. */
function isBillableStatusOrPast(s: CrmSession): boolean {
    return isBillableStatus(s.status) || (s.status === 'PLANNED' && parseUTC(s.date).getTime() <= Date.now());
}





/** Баннер «Вы в отпуске до …» — тап открывает анкету, где отпуск снимают. */
function VacationBanner() {
    const cu = useUserStore(s => s.currentUser) as unknown as
        { crmData?: { vacationUntil?: string | null }; crm_data?: { vacation_until?: string | null } } | null;
    const until: string | null = cu?.crmData?.vacationUntil ?? cu?.crm_data?.vacation_until ?? null;
    if (!until) return null;
    // Сравниваем календарные дни по Батуми, без поясов браузера.
    if (until.slice(0, 10) < tbilisiToday()) return null;
    return (
        <a
            href="/m/crm/profile"
            style={{
                display: 'flex',
                margin: '0 16px',
                padding: '10px 12px',
                minHeight: 44,
                background: 'var(--status-pending-bg)',
                border: '1px solid var(--color-ink-10)',
                borderRadius: 16,
                color: 'var(--status-pending-fg)',
                fontSize: 14,
                gap: 10,
                alignItems: 'center',
                textDecoration: 'none',
            }}
        >
            <Plane size={16} aria-hidden="true" />
            <span style={{ flex: 1 }}>
                Вы отметили <b>отпуск до {formatDayMonth(until, { withYear: 'auto' })}</b>. Нажмите, чтобы изменить.
            </span>
        </a>
    );
}
