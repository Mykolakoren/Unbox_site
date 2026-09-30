import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    ChevronLeft, ChevronRight, Calendar, Clock,
    RefreshCw, MapPin, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { addDays, format as fmtDate } from 'date-fns';
import { crmApi, type CrmSession, type CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { useUserStore } from '../../../store/userStore';
import { Plane } from 'lucide-react';
import { parseUTC, formatBatumi, BATUMI_TZ } from '../../../utils/dateUtils';
import { SessionActionSheet } from './SessionActionSheet';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import { useCrmDataVersion } from './crmDataVersion';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { formatDateLabel, formatDayMonth, formatMoney, formatTime } from '../../../utils/format';

const NO_SESSIONS: CrmSession[] = [];

/**
 * Mobile CRM — day view (the route is still `/m/crm/today` for back-compat,
 * but the page now navigates across days).
 *
 * Mechanics:
 *  - Selected date lives in `?date=YYYY-MM-DD`. Default = today (Tbilisi).
 *  - Header has prev/next chevrons, a "Сегодня" pill, and a native date
 *    picker for jump-to-date.
 *  - Horizontal swipe on the list area changes day ±1.
 *  - Tapping a session opens SessionActionSheet (full CRM controls).
 *  - Hard cap on the API range — only fetches one day at a time so the
 *    payload stays small on flaky phone networks.
 *
 * Wave 1: статусы и оплата — общий StatusBadge (слова из statuses.ts),
 * суммы — formatMoney («160 ₾», а не «₾ 160»), даты — formatDayMonth,
 * загрузка — скелетон, пусто — EmptyState, «Синхр» → понятные подписи.
 */
export function MobileCrmToday() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const todayStr = formatBatumi(new Date(), 'yyyy-MM-dd');
    const dateStr = searchParams.get('date') || todayStr;

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
    const { clients, fetchClients } = useCrmStore();
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    useEffect(() => {
        // Pull bookings once on mount so session→booking→cabinet lookup
        // works (the row badge shows e.g. "Каб. 5 · Unbox Uni" instead
        // of just "кабинет"). Cheap — store dedups.
        fetchBookings?.();
    }, [fetchBookings]);

    useEffect(() => {
        if (clients.length === 0) fetchClients(true).catch(() => {});
    }, [clients.length, fetchClients]);

    const reload = useCallback(async () => {
        // Номер запроса: при быстром листании ответ за промежуточный день
        // может прийти последним — такие ответы (и их ошибки) выбрасываем.
        const seq = ++reqSeq.current;
        setLoading(true);
        try {
            const list = await crmApi.getSessions({ dateFrom: dateStr, dateTo: dateStr });
            if (seq !== reqSeq.current) return;
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

    const dayLoaded = loaded?.date === dateStr;
    const sessions = dayLoaded ? loaded.list : NO_SESSIONS;
    const loadFailed = failedDate === dateStr;
    const patchSessions = (fn: (list: CrmSession[]) => CrmSession[]) =>
        setLoaded(prev => (prev ? { ...prev, list: fn(prev.list) } : prev));

    // ── Day navigation ────────────────────────────────────────────────
    const shiftDay = useCallback((delta: number) => {
        const current = parseISO(dateStr);
        const next = addDays(current, delta);
        const nextStr = fmtDate(next, 'yyyy-MM-dd');
        const sp = new URLSearchParams(searchParams);
        if (nextStr === todayStr) sp.delete('date');
        else sp.set('date', nextStr);
        setSearchParams(sp, { replace: true });
    }, [dateStr, searchParams, setSearchParams, todayStr]);

    const jumpToToday = () => {
        const sp = new URLSearchParams(searchParams);
        sp.delete('date');
        setSearchParams(sp, { replace: true });
    };

    const jumpToDate = (yyyymmdd: string) => {
        if (!yyyymmdd) return;
        const sp = new URLSearchParams(searchParams);
        if (yyyymmdd === todayStr) sp.delete('date');
        else sp.set('date', yyyymmdd);
        setSearchParams(sp, { replace: true });
    };

    // ── Swipe gesture ────────────────────────────────────────────────
    const swipeRef = useRef<HTMLDivElement | null>(null);
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
        // Mostly-horizontal swipe only — don't hijack vertical scrolls.
        if (Math.abs(dx) < SWIPE_PX) return;
        if (Math.abs(dy) > Math.abs(dx) * 0.8) return;
        shiftDay(dx > 0 ? -1 : +1);
    };

    // ── Sync ─────────────────────────────────────────────────────────
    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await crmApi.syncFromCalendar(false, 1, 2);
            const orphans = (result as unknown as { orphansCancelled?: number }).orphansCancelled ?? 0;
            toast.success(
                `Календарь: добавлено ${result.created || 0}, обновлено ${result.updated || 0}${orphans > 0 ? `, отменено ${orphans}` : ''}`,
                { duration: 4500 },
            );
            await reload();
        } catch (e: unknown) {
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof detail === 'string' ? detail : 'Не удалось синхронизировать с Google Календарём. Попробуйте ещё раз');
        } finally {
            setSyncing(false);
        }
    };

    const sorted = useMemo(() => {
        return [...sessions].sort((a, b) => parseUTC(a.date).getTime() - parseUTC(b.date).getTime());
    }, [sessions]);

    const clientById = useMemo(() => {
        const m = new Map<string, CrmClient>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    const isToday = dateStr === todayStr;
    const longDayLabel = formatDateLabel(dateStr, { capitalize: true, withYear: 'auto' });

    return (
        <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <VacationBanner />
            {/* ── Header ─────────────────────────────────────────────── */}
            <div style={{ padding: '0 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.15 }}>
                        {isToday ? 'Сегодня' : formatDayMonth(dateStr)}
                    </h1>
                    <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                        {longDayLabel}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    <Button
                        variant="secondary"
                        size="touch"
                        icon={<Calendar size={16} aria-hidden="true" />}
                        onClick={() => navigate('/m/crm/sessions')}
                    >
                        Все сессии
                    </Button>
                    <Button
                        variant="secondary"
                        size="touch"
                        disabled={syncing}
                        onClick={handleSync}
                        aria-label={syncing ? 'Синхронизируем с Google Календарём' : 'Синхронизировать с Google Календарём'}
                        icon={<RefreshCw size={16} aria-hidden="true" style={{ animation: syncing ? 'spin 1s linear infinite' : undefined }} />}
                    />
                </div>
            </div>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

            {/* ── Day pager ─────────────────────────────────────────── */}
            <div style={{ padding: '0 16px' }}>
                <div style={dayPagerStyle}>
                    <button onClick={() => shiftDay(-1)} style={navBtn} aria-label="Предыдущий день">
                        <ChevronLeft size={20} aria-hidden="true" />
                    </button>
                    {!isToday && (
                        <button onClick={jumpToToday} style={todayPill}>
                            Сегодня
                        </button>
                    )}
                    <label style={{ ...todayPill, position: 'relative' }}>
                        <Calendar size={16} aria-hidden="true" />
                        <span>{formatDayMonth(dateStr)}</span>
                        <input
                            type="date"
                            aria-label="Выбрать дату"
                            value={dateStr}
                            onChange={e => jumpToDate(e.target.value)}
                            style={{
                                position: 'absolute', inset: 0,
                                opacity: 0, cursor: 'pointer',
                            }}
                        />
                    </label>
                    <button onClick={() => shiftDay(1)} style={navBtn} aria-label="Следующий день">
                        <ChevronRight size={20} aria-hidden="true" />
                    </button>
                </div>
            </div>

            {/* ── List (swipable) ────────────────────────────────────── */}
            <div
                ref={swipeRef}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
                style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200 }}
            >
                {/* Скелетон — пока день ещё не загружен. При тихом обновлении
                    того же дня список остаётся на месте. */}
                {!dayLoaded && !loadFailed && (
                    <SkeletonList count={3} label="Загружаем сессии" cardHeight={96} />
                )}

                {loadFailed && !loading && (
                    <ErrorBar
                        message={dayLoaded ? 'Не удалось обновить день' : 'Не удалось загрузить день'}
                        onRetry={() => reload()}
                    />
                )}

                {dayLoaded && !loading && sorted.length === 0 && (
                    <EmptyState
                        compact
                        title="Сессий на эту дату нет"
                        hint="Листайте дни свайпом влево-вправо или стрелками сверху."
                    />
                )}

                {sorted.map(s => {
                    const client = clientById.get(s.clientId);
                    const time = formatTime(parseUTC(s.date), { timeZone: BATUMI_TZ });
                    const isPast = parseUTC(s.date).getTime() + (s.durationMinutes ?? 60) * 60000 < Date.now();
                    // 2026-05-14: CANCELLED_* status больше не используется
                    // (отмена = удаление). Если каким-то синком пришла стрый
                    // CANCELLED row — рендерим её как «отменена», но в новом
                    // потоке таких быть не должно.
                    const isLegacyCancelled = s.status === 'CANCELLED_CLIENT' || s.status === 'CANCELLED_THERAPIST';
                    // «Не отмечена» — не статус из базы, а подсказка: время
                    // прошло, а сессия всё ещё запланирована. Остальное —
                    // слова общего словаря (StatusBadge kind="session").
                    const isUnmarked = s.status === 'PLANNED' && isPast;

                    return (
                        <button
                            key={s.id}
                            onClick={() => setActiveSheet(s)}
                            style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 14,
                                padding: 14,
                                opacity: isLegacyCancelled ? 0.7 : 1,
                                textAlign: 'left',
                                fontFamily: 'inherit',
                                color: 'var(--color-ink)',
                                cursor: 'pointer',
                                width: '100%',
                                display: 'block',
                            }}
                        >
                            <div style={{ fontSize: 17, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Clock size={16} aria-hidden="true" /> <span className="num">{time}</span>
                                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-ink-60)' }}>
                                    · {s.durationMinutes ?? 60} мин
                                </span>
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
                                {client?.name ?? 'Клиент…'}
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                                {isUnmarked
                                    ? <Badge tone="warn"><AlertCircle size={14} aria-hidden="true" /> Не отмечена</Badge>
                                    : <StatusBadge kind="session" status={s.status} />}
                                {(() => {
                                    // Galina+owner 2026-06-02: цена была видна только
                                    // когда session.price явно задана. Падаем на
                                    // client.basePrice (дефолт клиента), чтобы цена
                                    // была видна везде где она известна, а не только
                                    // для уже отыгранных сессий.
                                    // Wave 1: сумма одним форматом («160 ₾»). Жёлтым —
                                    // только прошедшая неоплаченная (ждём оплату);
                                    // у будущей цена нейтральная (аудит G6-07/G6-15).
                                    const cur = s.currency || client?.currency || 'GEL';
                                    const effectivePrice = s.price ?? client?.basePrice ?? null;
                                    if (s.isPaid) return <StatusBadge kind="payment" status="paid" />;
                                    if (effectivePrice) {
                                        return (
                                            <Badge tone={isPast && !isLegacyCancelled ? 'warn' : 'normal'}>
                                                {isPast && !isLegacyCancelled ? 'Ждёт оплаты · ' : ''}
                                                <span className="num">{formatMoney(effectivePrice, { currency: cur })}</span>
                                            </Badge>
                                        );
                                    }
                                    return null;
                                })()}
                                {s.isBooked && (() => {
                                    // Show concrete cabinet + center instead of generic
                                    // "кабинет" badge. Lookup: session.bookingId →
                                    // bookings[] → resourceId → RESOURCES[].name +
                                    // LOCATIONS[].name. Falls back to plain label if
                                    // bookings haven't loaded or session has no link.
                                    const b = s.bookingId ? bookings.find(x => x.id === s.bookingId) : null;
                                    const res = b ? RESOURCES.find(r => r.id === b.resourceId) : null;
                                    const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
                                    const label = res
                                        ? (loc ? `${res.name} · ${loc.name}` : res.name)
                                        : 'кабинет';
                                    return <Badge tone="normal"><MapPin size={14} aria-hidden="true" /> {label}</Badge>;
                                })()}
                            </div>
                        </button>
                    );
                })}
            </div>

            {activeSheet && (
                <SessionActionSheet
                    session={activeSheet}
                    client={clientById.get(activeSheet.clientId)}
                    onClose={() => setActiveSheet(null)}
                    onChange={(updated) => {
                        patchSessions(list => list.map(x => x.id === updated.id ? updated : x));
                        setActiveSheet(updated);
                    }}
                    onDeleted={(id) => {
                        patchSessions(list => list.filter(x => x.id !== id));
                        setActiveSheet(null);
                    }}
                />
            )}
            {/* Keep navigate import live until we add a client-detail jump from sheet */}
            <span style={{ display: 'none' }} onClick={() => navigate('/m/crm/clients')} />
        </div>
    );
}

function parseISO(yyyymmdd: string): Date {
    // Local midnight on the given calendar day. Used for day navigation.
    const [y, m, d] = yyyymmdd.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
    // Только два тона: «ждём» (янтарный) и нейтральный. Статусы брони,
    // оплаты и сессии — через общий StatusBadge.
    const colors: Record<string, { bg: string; fg: string }> = {
        warn: { bg: 'var(--status-pending-bg)', fg: 'var(--status-pending-fg)' },
        normal: { bg: 'var(--color-sunken)', fg: 'var(--color-ink-80)' },
    };
    const c = colors[tone] || colors.normal;
    return (
        <span style={{
            background: c.bg, color: c.fg,
            fontSize: 12, fontWeight: 600,
            minHeight: 24,
            padding: '0 8px', borderRadius: 8,
            whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>{children}</span>
    );
}

// ─── styles ──────────────────────────────────────────────────────────
const dayPagerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--color-sunken)',
    borderRadius: 14,
    padding: 6,
};

const navBtn: React.CSSProperties = {
    background: 'var(--color-card)',
    border: 'none',
    borderRadius: 10,
    width: 44, height: 44,
    display: 'grid', placeItems: 'center',
    cursor: 'pointer',
    color: 'var(--color-ink)',
};

const todayPill: React.CSSProperties = {
    flex: 1,
    background: 'var(--color-card)',
    border: 'none',
    borderRadius: 10,
    padding: '0 12px',
    minHeight: 44,
    fontSize: 14, fontWeight: 600,
    fontFamily: 'inherit',
    color: 'var(--color-ink)',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};

/** Banner — shown at top of /m/crm/today when the specialist has set
 *  vacation_until on their profile. Reminds them (and any admin in their
 *  account) that they marked themselves as out so they do not accidentally
 *  schedule new sessions. Click → /m/crm/profile to edit / clear. */
function VacationBanner() {
    const cu = useUserStore(s => s.currentUser) as any;
    const until: string | null = cu?.crmData?.vacationUntil
        ?? cu?.crm_data?.vacation_until
        ?? null;
    if (!until) return null;
    const untilDate = new Date(until);
    if (untilDate < new Date(new Date().toDateString())) return null;
    return (
        <a
            href="/m/crm/profile"
            style={{
                display: "flex",
                margin: "0 16px",
                padding: "10px 12px",
                minHeight: 44,
                background: "var(--status-pending-bg)",
                border: "1px solid var(--color-ink-10)",
                borderRadius: 10,
                color: "var(--status-pending-fg)",
                fontSize: 14,
                gap: 10,
                alignItems: "center",
                textDecoration: "none",
            }}
        >
            <Plane size={16} aria-hidden="true" />
            <span style={{ flex: 1 }}>
                Вы отметили <b>отпуск до {formatDayMonth(until, { withYear: 'auto' })}</b>. Нажмите, чтобы изменить.
            </span>
        </a>
    );
}
