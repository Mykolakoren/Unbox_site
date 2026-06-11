import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    ChevronLeft, ChevronRight, Calendar, Check, Clock,
    RefreshCw, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { addDays, format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { crmApi, type CrmSession, type CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { useUserStore } from '../../../store/userStore';
import { Plane } from 'lucide-react';
import { parseUTC, formatBatumi } from '../../../utils/dateUtils';
import { SessionActionSheet } from './SessionActionSheet';
import { CURRENCIES } from '../../../utils/currency';
import { RESOURCES, LOCATIONS } from '../../../utils/data';

function symbolFor(code: string): string {
    return CURRENCIES.find(c => c.code === code)?.symbol ?? code;
}

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
 */
export function MobileCrmToday() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const todayStr = formatBatumi(new Date(), 'yyyy-MM-dd');
    const dateStr = searchParams.get('date') || todayStr;

    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [loading, setLoading] = useState(true);
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
        setLoading(true);
        try {
            const list = await crmApi.getSessions({ dateFrom: dateStr, dateTo: dateStr });
            setSessions(list);
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                || (e as Error)?.message || 'Не удалось загрузить';
            toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить');
        } finally {
            setLoading(false);
        }
    }, [dateStr]);

    useEffect(() => { reload(); }, [reload]);

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
                `Синхр: ${result.created || 0} новых, ${result.updated || 0} обнов.${orphans > 0 ? `, отмен. ${orphans}` : ''}`,
                { duration: 4500 },
            );
            await reload();
        } catch (e: unknown) {
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof detail === 'string' ? detail : 'Ошибка синхронизации');
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

    const dateObj = parseISO(dateStr);
    const isToday = dateStr === todayStr;
    const longDayLabel = fmtDate(dateObj, 'd MMMM, EEEE', { locale: ru });

    return (
        <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <VacationBanner />
            {/* ── Header ─────────────────────────────────────────────── */}
            <div style={{ padding: '0 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.15 }}>
                        {isToday ? 'Сегодня' : fmtDate(dateObj, 'd MMM', { locale: ru })}
                    </h1>
                    <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                        {longDayLabel}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <button
                        onClick={() => navigate('/m/crm/sessions')}
                        aria-label="Все сессии"
                        title="Все сессии · фильтры по периоду и статусу"
                        style={syncBtnStyle(false)}
                    >
                        <Calendar size={14} />
                        Все
                    </button>
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        aria-label="Синхр Google Calendar"
                        style={syncBtnStyle(syncing)}
                    >
                        <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : undefined }} />
                        {syncing ? 'Синхр…' : 'Синхр'}
                    </button>
                </div>
            </div>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

            {/* ── Day pager ─────────────────────────────────────────── */}
            <div style={{ padding: '0 16px' }}>
                <div style={dayPagerStyle}>
                    <button onClick={() => shiftDay(-1)} style={navBtn} aria-label="Предыдущий день">
                        <ChevronLeft size={18} />
                    </button>
                    {!isToday && (
                        <button onClick={jumpToToday} style={todayPill}>
                            Сегодня
                        </button>
                    )}
                    <label style={{ ...todayPill, position: 'relative' }}>
                        <Calendar size={14} />
                        <span>{fmtDate(dateObj, 'd MMM', { locale: ru })}</span>
                        <input
                            type="date"
                            value={dateStr}
                            onChange={e => jumpToDate(e.target.value)}
                            style={{
                                position: 'absolute', inset: 0,
                                opacity: 0, cursor: 'pointer',
                            }}
                        />
                    </label>
                    <button onClick={() => shiftDay(1)} style={navBtn} aria-label="Следующий день">
                        <ChevronRight size={18} />
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
                {loading && (
                    <div style={{ color: '#666', fontSize: 14 }}>Загружаю…</div>
                )}

                {!loading && sorted.length === 0 && (
                    <div style={emptyStyle}>
                        Сессий на эту дату нет.
                        <div style={{ marginTop: 6, fontSize: 12, color: '#aaa' }}>
                            Свайп ← → или стрелки сверху для других дат
                        </div>
                    </div>
                )}

                {sorted.map(s => {
                    const client = clientById.get(s.clientId);
                    const time = formatBatumi(s.date, 'HH:mm');
                    const isPast = parseUTC(s.date).getTime() + (s.durationMinutes ?? 60) * 60000 < Date.now();
                    // 2026-05-14: CANCELLED_* status больше не используется
                    // (отмена = удаление). Если каким-то синком пришла стрый
                    // CANCELLED row — рендерим её как «отменена», но в новом
                    // потоке таких быть не должно.
                    const isLegacyCancelled = s.status === 'CANCELLED_CLIENT' || s.status === 'CANCELLED_THERAPIST';
                    const statusLabel =
                        s.status === 'COMPLETED' ? 'Прошла'
                        : isLegacyCancelled ? 'Отменена'
                        : isPast ? 'Не отмечена' : 'Запланирована';
                    const statusTone =
                        s.status === 'COMPLETED' ? 'ok'
                        : isLegacyCancelled ? 'muted'
                        : isPast ? 'warn' : 'normal';

                    return (
                        <button
                            key={s.id}
                            onClick={() => setActiveSheet(s)}
                            style={{
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.08)',
                                borderRadius: 14,
                                padding: 14,
                                opacity: isLegacyCancelled ? 0.55 : 1,
                                textAlign: 'left',
                                fontFamily: 'inherit',
                                color: '#0E0E0E',
                                cursor: 'pointer',
                                width: '100%',
                                display: 'block',
                            }}
                        >
                            <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Clock size={16} /> {time}
                                <span style={{ fontSize: 12, fontWeight: 500, color: '#999' }}>
                                    · {s.durationMinutes ?? 60} мин
                                </span>
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
                                {client?.name ?? `ID ${s.clientId.slice(0, 6)}…`}
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                                <Badge tone={statusTone}>{statusLabel}</Badge>
                                {(() => {
                                    // Galina+owner 2026-06-02: цена была видна только
                                    // когда session.price явно задана. Падаем на
                                    // client.basePrice (дефолт клиента), чтобы цена
                                    // была видна везде где она известна, а не только
                                    // для уже отыгранных сессий.
                                    const cur = s.currency || client?.currency || 'GEL';
                                    const sym = symbolFor(cur);
                                    const effectivePrice = s.price ?? client?.basePrice ?? null;
                                    if (s.isPaid) return <Badge tone="ok"><Check size={10} /> Оплачено</Badge>;
                                    if (effectivePrice) return <Badge tone="warn">{sym} {effectivePrice.toFixed(0)}</Badge>;
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
                                    return <Badge tone="info"><MapPin size={10} /> {label}</Badge>;
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
                        setSessions(prev => prev.map(x => x.id === updated.id ? updated : x));
                        setActiveSheet(updated);
                    }}
                    onDeleted={(id) => {
                        setSessions(prev => prev.filter(x => x.id !== id));
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
    // Local midnight on the given calendar day. Used for label rendering.
    const [y, m, d] = yyyymmdd.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
    const colors: Record<string, { bg: string; fg: string }> = {
        ok: { bg: '#E6F4EA', fg: '#1B6E36' },
        warn: { bg: '#FEF3C7', fg: '#8A5A00' },
        muted: { bg: '#EEE', fg: '#666' },
        info: { bg: '#E0F2FE', fg: '#0369A1' },
        normal: { bg: '#F4F4F2', fg: '#0E0E0E' },
    };
    const c = colors[tone] || colors.normal;
    return (
        <span style={{
            background: c.bg, color: c.fg,
            fontSize: 11, fontWeight: 700,
            padding: '3px 8px', borderRadius: 999,
            whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>{children}</span>
    );
}

// ─── styles ──────────────────────────────────────────────────────────
function syncBtnStyle(syncing: boolean): React.CSSProperties {
    return {
        background: '#F4F4F2',
        border: 'none',
        borderRadius: 10,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: syncing ? 'wait' : 'pointer',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 700,
        color: '#0E0E0E',
        opacity: syncing ? 0.7 : 1,
        flexShrink: 0,
    };
}

const dayPagerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#F4F4F2',
    borderRadius: 14,
    padding: 6,
};

const navBtn: React.CSSProperties = {
    background: '#fff',
    border: 'none',
    borderRadius: 10,
    width: 38, height: 38,
    display: 'grid', placeItems: 'center',
    cursor: 'pointer',
    color: '#0E0E0E',
};

const todayPill: React.CSSProperties = {
    flex: 1,
    background: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 13, fontWeight: 700,
    fontFamily: 'inherit',
    color: '#0E0E0E',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};

const emptyStyle: React.CSSProperties = {
    background: '#F4F4F2',
    borderRadius: 14,
    padding: 20,
    textAlign: 'center',
    color: '#666',
    fontSize: 14,
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
                background: "rgba(255,138,76,0.10)",
                border: "1px solid rgba(255,138,76,0.40)",
                borderRadius: 10,
                color: "#C66019",
                fontSize: 13,
                gap: 10,
                alignItems: "center",
                textDecoration: "none",
            }}
        >
            <Plane size={16} />
            <span style={{ flex: 1 }}>
                Вы отметили <b>отпуск до {until}</b>. Тап — изменить.
            </span>
        </a>
    );
}
