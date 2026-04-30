import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { totalInGel } from '../../utils/currency';
import {
    Users,
    Calendar,
    AlertCircle,
    TrendingUp,
    Clock,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Wallet,
    BarChart3,
    UserX,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    CartesianGrid,
} from 'recharts';
import { format, addMonths, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { crmApi } from '../../api/crm';
import { parseUTC } from '../../utils/dateUtils';
import { useUserStore } from '../../store/userStore';
import { RESOURCES } from '../../utils/data';
import { isAfter, addDays } from 'date-fns';
import { toast } from 'sonner';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

const STATUS_COLORS: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED_CLIENT: 'bg-red-100 text-red-600',
    CANCELLED_THERAPIST: 'bg-orange-100 text-orange-700',
};

const STATUS_LABELS: Record<string, string> = {
    PLANNED: 'Запланирована',
    COMPLETED: 'Завершена',
    CANCELLED_CLIENT: 'Отмена (клиент)',
    CANCELLED_THERAPIST: 'Отмена (терапевт)',
};

export function CrmDashboard() {
    const { dashboard, fetchDashboard, loading } = useCrmStore();
    const navigate = useNavigate();
    const [calendarIdSaved, setCalendarIdSaved] = useState<string | null>(null);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const monthStr = format(currentMonth, 'yyyy-MM');
    const isThisMonth = format(new Date(), 'yyyy-MM') === monthStr;

    useEffect(() => {
        // Auto-complete past PLANNED sessions, then load dashboard
        crmApi.autoCompleteSessions().then((result) => {
            if (result.autoCompleted > 0) {
                toast.info(`${result.autoCompleted} ${result.autoCompleted === 1 ? 'сессия автозавершена' : 'сессий автозавершены'}`);
            }
        }).catch(() => {}).finally(() => {
            fetchDashboard(monthStr);
        });
        crmApi.getSettings().then((s) => {
            setCalendarIdSaved(s.calendarId);
        }).catch(() => {});
    }, [fetchDashboard, monthStr]);

    if (loading && !dashboard) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-unbox-grey" />
            </div>
        );
    }

    // ─── GRID HOUSE variant ───────────────────────────────────────────────
    return (

            <GridHouseDashboard
                dashboard={dashboard}
                currentMonth={currentMonth}
                setCurrentMonth={setCurrentMonth}
                isThisMonth={isThisMonth}
                navigate={navigate}
                calendarIdSaved={calendarIdSaved}
            />
        );
}


function StatCard({
    icon: Icon,
    label,
    value,
    subtitle,
    color,
    onClick,
}: {
    icon: React.ElementType;
    label: string;
    value: number | string;
    subtitle?: string;
    color: string;
    onClick?: () => void;
}) {
    const colorClasses: Record<string, { bg: string; icon: string; text: string }> = {
        blue: { bg: 'bg-unbox-light', icon: 'text-unbox-green', text: 'text-unbox-dark' },
        green: { bg: 'bg-unbox-light', icon: 'text-unbox-green', text: 'text-unbox-green' },
        red: { bg: 'bg-red-50', icon: 'text-red-500', text: 'text-red-600' },
        emerald: { bg: 'bg-unbox-light', icon: 'text-unbox-green', text: 'text-unbox-dark' },
        gray: { bg: 'bg-unbox-light/30', icon: 'text-unbox-grey', text: 'text-unbox-grey' },
    };

    const c = colorClasses[color] || colorClasses.gray;

    return (
        <div
            className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5 cursor-pointer hover:shadow-md transition-all group"
            onClick={onClick}
        >
            <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                <Icon className={`w-5 h-5 ${c.icon}`} />
            </div>
            <div className={`text-2xl font-bold ${c.text}`}>{value}</div>
            {subtitle && <div className="text-xs text-unbox-grey mt-0.5 leading-snug">{subtitle}</div>}
            <div className="text-sm text-unbox-grey mt-0.5">{label}</div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// GRID HOUSE — Dashboard variant.
// Uses the same data (useCrmStore) but renders in the Grid House language:
// hairlines, IBM Plex Sans/Mono, KPI strip, flat tables, no shadows/rounds.
// Rollback: delete this function + the `if (useDesignFlag())` early return above.
// ────────────────────────────────────────────────────────────────────────

interface GHDashProps {
    dashboard: ReturnType<typeof useCrmStore.getState>['dashboard'];
    currentMonth: Date;
    setCurrentMonth: (d: Date) => void;
    isThisMonth: boolean;
    navigate: (path: string, state?: any) => void;
    calendarIdSaved: string | null;
}

function GridHouseDashboard({ dashboard, currentMonth, setCurrentMonth, isThisMonth, navigate, calendarIdSaved }: GHDashProps) {
    // Excel #33 — show specialist's own coworking bookings (the cabinets
    // they've reserved as a renter) on the CRM dashboard alongside their
    // therapy sessions. Two separate worlds, but admins want one screen
    // to plan their week.
    const { bookings, fetchBookings, currentUser } = useUserStore();
    useEffect(() => { fetchBookings(); }, [fetchBookings]);

    // Merge-suggestion banner — when a CRM session and a cabinet booking
    // share the same date+time, the specialist usually wants them treated
    // as one event. Pull the list on mount and surface a banner when ≥1
    // pair is unlinked.
    type MergePair = {
        sessionId: string; sessionDate: string; sessionDuration: number;
        clientId: string; clientName?: string | null;
        bookingId: string; bookingResourceId: string;
        bookingStartTime: string; bookingDuration: number;
    };
    const [mergePairs, setMergePairs] = useState<MergePair[]>([]);
    const [mergeOpen, setMergeOpen] = useState(false);
    const [mergingId, setMergingId] = useState<string | null>(null);
    const refreshMergeSuggestions = async () => {
        try {
            const res = await crmApi.getMergeSuggestions();
            setMergePairs(res.pairs);
        } catch {
            setMergePairs([]);
        }
    };
    useEffect(() => { refreshMergeSuggestions(); }, []);

    const handleAcceptMerge = async (pair: MergePair) => {
        setMergingId(pair.sessionId);
        try {
            await crmApi.acceptMergeSuggestion(pair.sessionId, pair.bookingId);
            // Drop the pair locally so the user sees instant feedback.
            setMergePairs(prev => prev.filter(p => p.sessionId !== pair.sessionId || p.bookingId !== pair.bookingId));
            toast.success(`Объединено: ${pair.clientName || 'клиент'} и кабинет`);
        } catch {
            toast.error('Не удалось объединить');
        } finally {
            setMergingId(null);
        }
    };
    const handleSkipMerge = (pair: MergePair) => {
        // "Пропустить" — just hide locally for this session. We don't
        // persist a server-side dismissal because the pair will return
        // next pageload, but if the specialist genuinely doesn't want to
        // merge they can detach manually or ignore the banner.
        setMergePairs(prev => prev.filter(p => p.sessionId !== pair.sessionId || p.bookingId !== pair.bookingId));
    };
    const upcomingMyBookings = (() => {
        const now = new Date();
        const horizon = addDays(now, 7);
        const myEmail = currentUser?.email;
        return (bookings || [])
            // Only OUR confirmed bookings — `bookings` in the store mixes
            // /bookings/me with /bookings/public, so without this guard the
            // dashboard would surface everyone-else's confirmed cabinet
            // bookings (and miss our own when /me was momentarily slow).
            .filter(b => (b.status === 'confirmed' || b.status === 'completed') && b.userId === myEmail)
            .map(b => {
                // Combine the booking's date column with its start_time to
                // get the actual moment the booking starts. Earlier code
                // used parseUTC(b.date) which always returned 00:00 UTC =
                // 04:00 Tbilisi → today's evening bookings looked "past"
                // and got dropped from the list.
                const baseDate = parseUTC(b.date);
                const [hh, mm] = (b.startTime || '00:00').split(':').map(Number);
                const dt = new Date(baseDate);
                dt.setHours(hh || 0, mm || 0, 0, 0);
                return { ...b, _dt: dt };
            })
            .filter(b => isAfter(b._dt, now) && b._dt < horizon)
            .sort((a, b) => a._dt.getTime() - b._dt.getTime())
            .slice(0, 8);
    })();
    const monoLabel: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: '10px',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: GH.ink60,
        fontWeight: 500,
    };
    const bigNumber: React.CSSProperties = {
        fontFamily: GH_SANS,
        fontSize: '44px',
        fontWeight: 700,
        letterSpacing: '-0.03em',
        lineHeight: 1,
        color: GH.ink,
        fontVariantNumeric: 'tabular-nums',
    };
    const sectionHead: React.CSSProperties = {
        fontFamily: GH_SANS,
        fontSize: '24px',
        fontWeight: 600,
        letterSpacing: '-0.015em',
        margin: 0,
        color: GH.ink,
    };

    const monthLabel = format(currentMonth, 'LLLL yyyy', { locale: ru });
    const revenueByCurrency = dashboard?.revenueByCurrency;
    const hasMultiCurrency = revenueByCurrency && Object.keys(revenueByCurrency).length > 1;
    const revenueValue = revenueByCurrency && Object.keys(revenueByCurrency).length > 0
        ? totalInGel(revenueByCurrency).toFixed(0)
        : (dashboard?.revenueThisMonth ?? 0).toFixed(0);
    const debtByCurrency = dashboard?.debtByCurrency;
    const hasDebt = (dashboard?.totalActiveDebt ?? 0) > 0 || (debtByCurrency && Object.keys(debtByCurrency).length > 0);
    const debtTotal = debtByCurrency && Object.keys(debtByCurrency).length > 0
        ? totalInGel(debtByCurrency).toFixed(0)
        : '0';

    const kpiCells = [
        {
            label: 'Активных клиентов',
            value: dashboard?.activeClients ?? 0,
            href: () => navigate('/crm/clients'),
        },
        {
            label: 'Сессий за месяц',
            value: dashboard?.sessionsThisMonth ?? 0,
            href: () => navigate('/crm/sessions'),
        },
        {
            label: 'Неоплаченных',
            value: dashboard?.unpaidSessions ?? 0,
            href: () => navigate('/crm/finances'),
            warn: (dashboard?.unpaidSessions ?? 0) > 0,
        },
        {
            label: 'Доход за месяц',
            value: `${revenueValue} ₾`,
            href: () => navigate('/crm/finances'),
            sub: hasMultiCurrency
                ? Object.entries(revenueByCurrency!).map(([c, v]) => `${(v as number).toFixed(0)} ${c}`).join(' · ')
                : undefined,
        },
    ];

    const kpiExtras = [
        {
            label: 'Средняя ставка/час',
            value: `${(dashboard?.avgHourlyRate ?? 0).toFixed(0)} ₾`,
        },
        {
            label: 'Мин — Макс ставка',
            value: `${dashboard?.minRate ?? 0} — ${dashboard?.maxRate ?? 0} ₾`,
        },
        {
            label: 'Общий долг',
            value: `${debtTotal} ₾`,
            warn: hasDebt,
            sub: hasMultiCurrency && debtByCurrency && Object.keys(debtByCurrency).length > 1
                ? Object.entries(debtByCurrency!).map(([c, v]) => `${(v as number).toFixed(0)} ${c}`).join(' · ')
                : undefined,
            href: hasDebt ? () => navigate('/crm/finances') : undefined,
        },
    ];

    const STATUS_GH: Record<string, { label: string; color: string }> = {
        PLANNED:             { label: 'ЗАПЛАНИРОВАНА', color: GH.ink },
        COMPLETED:           { label: 'ЗАВЕРШЕНА',     color: GH.accent },
        CANCELLED_CLIENT:    { label: 'ОТМЕНА · КЛ.',  color: GH.danger },
        CANCELLED_THERAPIST: { label: 'ОТМЕНА · ТЕР.', color: GH.danger },
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '72px' }}>

            {/* Merge-suggestions banner — appears only when there's at
                least one unlinked (session, booking) pair at the same
                time. Click "Объединить" applies the link; click
                "Пропустить" hides this pair until the next page load. */}
            {mergePairs.length > 0 && (
                <div style={{
                    border: `1px solid ${GH.accent}`,
                    background: 'rgba(71,109,107,0.06)',
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                    marginBottom: -56,
                }}>
                    <div>
                        <div style={{ ...monoLabel, color: GH.accent, marginBottom: 4 }}>СОВПАДЕНИЯ ПО ВРЕМЕНИ</div>
                        <div style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink }}>
                            Найдено <b>{mergePairs.length}</b> {mergePairs.length === 1 ? 'пара' : mergePairs.length < 5 ? 'пары' : 'пар'} «бронь+сессия» в одно время. Объединить в одно событие?
                        </div>
                    </div>
                    <button
                        onClick={() => setMergeOpen(true)}
                        style={{
                            background: GH.accent,
                            color: GH.paper,
                            fontFamily: GH_MONO,
                            fontSize: 11,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            padding: '10px 18px',
                            border: 'none',
                            cursor: 'pointer',
                        }}
                    >
                        Просмотреть
                    </button>
                </div>
            )}

            {/* Merge dialog — list of pairs with per-row Объединить /
                Пропустить buttons. Closes itself when the list is empty. */}
            {mergeOpen && (
                <div
                    onClick={() => setMergeOpen(false)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 100,
                        background: 'rgba(0,0,0,0.45)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 20,
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: GH.paper, border: `1px solid ${GH.ink}`,
                            maxWidth: 640, width: '100%', maxHeight: '80vh',
                            overflowY: 'auto', padding: 24,
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
                            <h2 style={{ fontFamily: GH_SANS, fontSize: 22, fontWeight: 700, margin: 0, color: GH.ink }}>
                                Объединить бронь и сессию
                            </h2>
                            <button
                                onClick={() => setMergeOpen(false)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}
                            >
                                ЗАКРЫТЬ
                            </button>
                        </div>
                        {mergePairs.length === 0 ? (
                            <div style={{ ...monoLabel, padding: '32px 0', textAlign: 'center', color: GH.ink30 }}>
                                ВСЕ ОБЪЕДИНЕНО · ХОРОШО
                            </div>
                        ) : (
                            <div>
                                {mergePairs.map(pair => {
                                    const dt = parseUTC(pair.sessionDate);
                                    const resName = RESOURCES.find(r => r.id === pair.bookingResourceId)?.name || pair.bookingResourceId;
                                    return (
                                        <div
                                            key={`${pair.sessionId}-${pair.bookingId}`}
                                            style={{
                                                borderTop: `1px solid ${GH.ink10}`,
                                                padding: '14px 0',
                                                display: 'grid',
                                                gridTemplateColumns: '1fr auto',
                                                gap: 12,
                                                alignItems: 'center',
                                            }}
                                        >
                                            <div>
                                                <div style={{ fontFamily: GH_SANS, fontSize: 15, fontWeight: 700, color: GH.ink }}>
                                                    {pair.clientName || 'Клиент'} · {format(dt, 'd MMM, HH:mm', { locale: ru })}
                                                </div>
                                                <div style={{ ...monoLabel, marginTop: 4 }}>
                                                    {resName} · {pair.bookingDuration} МИН
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button
                                                    onClick={() => handleSkipMerge(pair)}
                                                    style={{
                                                        background: 'transparent', border: `1px solid ${GH.ink10}`,
                                                        fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em',
                                                        textTransform: 'uppercase', padding: '8px 12px',
                                                        cursor: 'pointer', color: GH.ink60,
                                                    }}
                                                >
                                                    Пропустить
                                                </button>
                                                <button
                                                    onClick={() => handleAcceptMerge(pair)}
                                                    disabled={mergingId === pair.sessionId}
                                                    style={{
                                                        background: GH.ink, border: 'none',
                                                        fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em',
                                                        textTransform: 'uppercase', padding: '8px 14px',
                                                        cursor: mergingId === pair.sessionId ? 'default' : 'pointer',
                                                        color: GH.paper,
                                                        opacity: mergingId === pair.sessionId ? 0.5 : 1,
                                                    }}
                                                >
                                                    {mergingId === pair.sessionId ? '…' : 'Объединить'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Page header ── */}
            <header>
                <div style={monoLabel}>CRM · КАБИНЕТ</div>
                <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginTop: '14px',
                    gap: '24px',
                    flexWrap: 'wrap',
                }}>
                    <h1 style={{
                        fontFamily: GH_SANS,
                        fontSize: 'clamp(44px, 5vw, 64px)',
                        fontWeight: 700,
                        letterSpacing: '-0.035em',
                        lineHeight: 0.95,
                        margin: 0,
                        color: GH.ink,
                        textTransform: 'capitalize',
                    }}>
                        {monthLabel}
                    </h1>
                    <div style={{
                        display: 'flex',
                        alignItems: 'stretch',
                        border: `1px solid ${GH.ink}`,
                        background: GH.paper,
                    }}>
                        <button
                            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                            style={{
                                background: 'none',
                                border: 'none',
                                borderRight: `1px solid ${GH.ink10}`,
                                padding: '12px 16px',
                                cursor: 'pointer',
                                fontFamily: GH_MONO,
                                fontSize: '14px',
                                color: GH.ink,
                            }}
                        >
                            ←
                        </button>
                        <button
                            onClick={() => setCurrentMonth(new Date())}
                            disabled={isThisMonth}
                            style={{
                                background: 'none',
                                border: 'none',
                                borderRight: `1px solid ${GH.ink10}`,
                                padding: '12px 18px',
                                fontFamily: GH_MONO,
                                fontSize: '10px',
                                letterSpacing: '0.2em',
                                textTransform: 'uppercase',
                                color: isThisMonth ? GH.ink30 : GH.ink,
                                cursor: isThisMonth ? 'default' : 'pointer',
                            }}
                        >
                            Сейчас
                        </button>
                        <button
                            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: '12px 16px',
                                cursor: 'pointer',
                                fontFamily: GH_MONO,
                                fontSize: '14px',
                                color: GH.ink,
                            }}
                        >
                            →
                        </button>
                    </div>
                </div>
            </header>

            {/* ── KPI strip ── */}
            <section>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    borderTop: `1px solid ${GH.ink}`,
                    borderBottom: `1px solid ${GH.ink}`,
                }}>
                    {kpiCells.map((cell, idx) => (
                        <div
                            key={idx}
                            onClick={cell.href}
                            style={{
                                padding: '24px',
                                borderRight: idx < kpiCells.length - 1 ? `1px solid ${GH.ink10}` : 'none',
                                cursor: 'pointer',
                                transition: 'background 0.12s',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = GH.ink5; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                        >
                            <div style={monoLabel}>{cell.label}</div>
                            <div style={{
                                ...bigNumber,
                                marginTop: '12px',
                                display: 'flex',
                                alignItems: 'baseline',
                                gap: '10px',
                            }}>
                                {cell.warn && (
                                    <span style={{
                                        width: '10px',
                                        height: '10px',
                                        background: GH.danger,
                                        borderRadius: '50%',
                                        display: 'inline-block',
                                        flexShrink: 0,
                                    }} />
                                )}
                                <span>{cell.value}</span>
                            </div>
                            {cell.sub && (
                                <div style={{
                                    ...monoLabel,
                                    marginTop: '8px',
                                    letterSpacing: '0.12em',
                                }}>
                                    {cell.sub}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Secondary KPI strip ── */}
            <section>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    borderTop: `1px solid ${GH.ink10}`,
                    borderBottom: `1px solid ${GH.ink10}`,
                }}>
                    {kpiExtras.map((cell, idx) => (
                        <div
                            key={idx}
                            onClick={cell.href}
                            style={{
                                padding: '22px 24px',
                                borderRight: idx < kpiExtras.length - 1 ? `1px solid ${GH.ink10}` : 'none',
                                cursor: cell.href ? 'pointer' : 'default',
                            }}
                        >
                            <div style={monoLabel}>{cell.label}</div>
                            <div style={{
                                fontFamily: GH_SANS,
                                fontSize: '28px',
                                fontWeight: 700,
                                letterSpacing: '-0.02em',
                                marginTop: '8px',
                                color: GH.ink,
                                fontVariantNumeric: 'tabular-nums',
                                display: 'flex',
                                alignItems: 'baseline',
                                gap: '10px',
                            }}>
                                {cell.warn && (
                                    <span style={{
                                        width: '8px',
                                        height: '8px',
                                        background: GH.danger,
                                        borderRadius: '50%',
                                        display: 'inline-block',
                                    }} />
                                )}
                                <span>{cell.value}</span>
                            </div>
                            {cell.sub && (
                                <div style={{ ...monoLabel, marginTop: '6px' }}>{cell.sub}</div>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Revenue chart ── */}
            {dashboard?.monthlyStats && dashboard.monthlyStats.length > 0 && (
                <section>
                    <div style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        borderBottom: `1px solid ${GH.ink}`,
                        paddingBottom: '14px',
                        marginBottom: '24px',
                        flexWrap: 'wrap',
                        gap: '16px',
                    }}>
                        <h2 style={sectionHead}>Доход по месяцам</h2>
                        <div style={{ display: 'flex', gap: '20px' }}>
                            <span style={{ ...monoLabel, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ width: '14px', height: '10px', background: GH.ink, display: 'inline-block' }} />
                                ПОЛУЧЕНО
                            </span>
                            <span style={{ ...monoLabel, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ width: '14px', height: '10px', background: GH.ink10, display: 'inline-block' }} />
                                ОЖИДАЛОСЬ
                            </span>
                        </div>
                    </div>
                    <div style={{ border: `1px solid ${GH.ink10}`, padding: '20px', background: GH.paper }}>
                        <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={dashboard.monthlyStats} barCategoryGap="24%">
                                <CartesianGrid strokeDasharray="0" vertical={false} stroke={GH.ink10} />
                                <XAxis
                                    dataKey="month"
                                    tickFormatter={(v: string) => {
                                        const [, m] = v.split('-');
                                        const months = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
                                        return months[parseInt(m, 10) - 1] || m;
                                    }}
                                    tick={{ fontSize: 10, fontFamily: GH_MONO, fill: GH.ink60, letterSpacing: '0.1em' }}
                                    tickLine={false}
                                    axisLine={{ stroke: GH.ink }}
                                />
                                <YAxis
                                    tick={{ fontSize: 10, fontFamily: GH_MONO, fill: GH.ink60 }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    cursor={{ fill: GH.ink5 }}
                                    content={({ active, payload, label }: any) => {
                                        if (!active || !payload?.length) return null;
                                        const parts = String(label).split('-');
                                        const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
                                        const title = parts.length >= 2 ? `${months[parseInt(parts[1], 10) - 1]} ${parts[0]}` : label;
                                        const data = payload[0]?.payload || {};
                                        return (
                                            <div style={{
                                                background: GH.paper,
                                                border: `1px solid ${GH.ink}`,
                                                padding: '14px 16px',
                                                fontFamily: GH_SANS,
                                                fontSize: '12px',
                                                color: GH.ink,
                                                minWidth: '180px',
                                            }}>
                                                <div style={{ ...monoLabel, marginBottom: '8px', color: GH.ink }}>{title}</div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <span style={{ color: GH.ink60 }}>Ожидалось</span>
                                                    <span style={{ fontFamily: GH_MONO, fontWeight: 600 }}>{Number(data.expected || 0).toFixed(0)} ₾</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                    <span style={{ color: GH.ink60 }}>Получено</span>
                                                    <span style={{ fontFamily: GH_MONO, fontWeight: 600 }}>{Number(data.received || 0).toFixed(0)} ₾</span>
                                                </div>
                                                <div style={{ ...monoLabel, color: GH.ink30, paddingTop: '6px', borderTop: `1px solid ${GH.ink10}` }}>
                                                    {data.sessionCount || 0} СЕССИЙ
                                                </div>
                                            </div>
                                        );
                                    }}
                                />
                                <Bar dataKey="expected" fill={GH.ink10} radius={[0, 0, 0, 0]} />
                                <Bar dataKey="received" fill={GH.ink} radius={[0, 0, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </section>
            )}

            {/* ── Upcoming sessions table ── */}
            <section>
                <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    borderBottom: `1px solid ${GH.ink}`,
                    paddingBottom: '14px',
                    marginBottom: '0',
                    flexWrap: 'wrap',
                    gap: '16px',
                }}>
                    <h2 style={sectionHead}>Ближайшие сессии</h2>
                    <button
                        onClick={() => navigate('/crm/sessions')}
                        style={{
                            ...monoLabel,
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: GH.ink,
                        }}
                    >
                        ВСЕ СЕССИИ →
                    </button>
                </div>
                {!dashboard?.upcomingSessions?.length ? (
                    <div style={{
                        padding: '48px 24px',
                        textAlign: 'center',
                        borderBottom: `1px solid ${GH.ink10}`,
                    }}>
                        <div style={monoLabel}>НЕТ ПРЕДСТОЯЩИХ СЕССИЙ</div>
                        <div style={{
                            fontFamily: GH_SANS,
                            fontSize: '14px',
                            color: GH.ink60,
                            marginTop: '8px',
                        }}>
                            На ближайшие 7 дней ничего не запланировано.
                        </div>
                    </div>
                ) : (
                    <div>
                        {/* Header row */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '80px 72px 1fr auto 120px',
                            gap: '20px',
                            padding: '14px 4px',
                            borderBottom: `1px solid ${GH.ink10}`,
                            ...monoLabel,
                        }}>
                            <span>ДАТА</span>
                            <span>ВРЕМЯ</span>
                            <span>КЛИЕНТ</span>
                            <span style={{ textAlign: 'right' }}>КАБИНЕТ</span>
                            <span style={{ textAlign: 'right' }}>СТАТУС</span>
                        </div>
                        {dashboard.upcomingSessions.map((s) => {
                            const dt = parseUTC(s.date);
                            const status = STATUS_GH[s.status] || { label: s.status, color: GH.ink60 };
                            return (
                                <div
                                    key={s.id}
                                    onClick={() => navigate('/crm/sessions')}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '80px 72px 1fr auto 120px',
                                        gap: '20px',
                                        alignItems: 'baseline',
                                        padding: '18px 4px',
                                        borderBottom: `1px solid ${GH.ink10}`,
                                        cursor: 'pointer',
                                        transition: 'background 0.12s',
                                    }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = GH.ink5; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                                >
                                    <div>
                                        <div style={{ ...monoLabel, color: GH.ink30 }}>
                                            {format(dt, 'EEE', { locale: ru }).toUpperCase()}
                                        </div>
                                        <div style={{
                                            fontFamily: GH_MONO,
                                            fontSize: '18px',
                                            fontWeight: 600,
                                            color: GH.ink,
                                            marginTop: '2px',
                                            fontVariantNumeric: 'tabular-nums',
                                        }}>
                                            {format(dt, 'd MMM', { locale: ru })}
                                        </div>
                                    </div>
                                    <div style={{
                                        fontFamily: GH_MONO,
                                        fontSize: '16px',
                                        fontWeight: 500,
                                        color: GH.ink,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}>
                                        {format(dt, 'HH:mm')}
                                    </div>
                                    <div style={{
                                        fontFamily: GH_SANS,
                                        fontSize: '15px',
                                        fontWeight: 500,
                                        color: GH.ink,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {s.clientName}
                                    </div>
                                    <div style={{
                                        ...monoLabel,
                                        textAlign: 'right',
                                        color: s.isBooked ? GH.ink : GH.danger,
                                    }}>
                                        {s.isBooked ? '✓ КАБИНЕТ' : '○ НЕ БРОН.'}
                                    </div>
                                    <div style={{
                                        ...monoLabel,
                                        textAlign: 'right',
                                        color: status.color,
                                    }}>
                                        {status.label}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ── My coworking bookings (Excel #33) ── */}
            <section style={{ marginBottom: '40px' }}>
                <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    borderBottom: `1px solid ${GH.ink}`, paddingBottom: '14px', flexWrap: 'wrap', gap: 16,
                }}>
                    <h2 style={sectionHead}>Мои бронирования кабинетов</h2>
                    <button
                        onClick={() => navigate('/dashboard/bookings')}
                        style={{ ...monoLabel, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: GH.ink }}
                    >
                        ВСЕ БРОНИ →
                    </button>
                </div>
                {upcomingMyBookings.length === 0 ? (
                    <div style={{ padding: '32px 24px', textAlign: 'center', borderBottom: `1px solid ${GH.ink10}` }}>
                        <div style={monoLabel}>НЕТ ПРЕДСТОЯЩИХ БРОНЕЙ</div>
                        <div style={{ fontFamily: GH_SANS, fontSize: '14px', color: GH.ink60, marginTop: '8px' }}>
                            На ближайшие 7 дней вы не арендовали ни одного кабинета.{' '}
                            <button
                                onClick={() => navigate('/dashboard/bookings')}
                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: GH.ink, textDecoration: 'underline' }}
                            >
                                Забронировать
                            </button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '80px 110px 1fr 100px',
                            gap: '20px', padding: '14px 4px', borderBottom: `1px solid ${GH.ink10}`,
                            ...monoLabel,
                        }}>
                            <span>ДАТА</span>
                            <span>ВРЕМЯ</span>
                            <span>КАБИНЕТ</span>
                            <span style={{ textAlign: 'right' }}>ЦЕНА</span>
                        </div>
                        {upcomingMyBookings.map(b => {
                            const res = RESOURCES.find(r => r.id === b.resourceId);
                            const startT = b.startTime || '';
                            const dur = b.duration || 60;
                            const [hh, mm] = startT.split(':').map(Number);
                            const endMins = (hh || 0) * 60 + (mm || 0) + dur;
                            const endStr = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
                            return (
                                <div
                                    key={b.id}
                                    onClick={() => navigate('/dashboard/bookings')}
                                    style={{
                                        display: 'grid', gridTemplateColumns: '80px 110px 1fr 100px',
                                        gap: '20px', alignItems: 'baseline',
                                        padding: '16px 4px', borderBottom: `1px solid ${GH.ink10}`,
                                        cursor: 'pointer', transition: 'background 0.12s',
                                    }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = GH.ink5; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                                >
                                    <div>
                                        <div style={{ ...monoLabel, color: GH.ink30 }}>{format(b._dt, 'EEE', { locale: ru }).toUpperCase()}</div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 18, fontWeight: 600 }}>{format(b._dt, 'd MMM', { locale: ru })}</div>
                                    </div>
                                    <div style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                        {startT}–{endStr}
                                    </div>
                                    <div style={{ fontFamily: GH_SANS, fontSize: 14 }}>{res?.name || b.resourceId}</div>
                                    <div style={{ textAlign: 'right', fontFamily: GH_MONO, fontSize: 13, fontWeight: 600 }}>
                                        {b.finalPrice ? `${b.finalPrice} ₾` : '—'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ── Debts table ── */}
            {dashboard?.debtByClient && dashboard.debtByClient.length > 0 && (
                <section>
                    <div style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        borderBottom: `1px solid ${GH.ink}`,
                        paddingBottom: '14px',
                        flexWrap: 'wrap',
                        gap: '16px',
                    }}>
                        <h2 style={sectionHead}>Долги клиентов</h2>
                        <span style={monoLabel}>
                            {String(dashboard.debtByClient.length).padStart(2, '0')} ЗАПИСЕЙ
                        </span>
                    </div>
                    <div>
                        {dashboard.debtByClient.map((d) => (
                            <div
                                key={d.clientId}
                                onClick={() => navigate(`/crm/clients/${d.clientId}`)}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '24px 1fr auto auto',
                                    gap: '20px',
                                    alignItems: 'baseline',
                                    padding: '18px 4px',
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    cursor: 'pointer',
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = GH.ink5; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                            >
                                <span style={{
                                    width: '8px',
                                    height: '8px',
                                    background: GH.danger,
                                    borderRadius: '50%',
                                    marginTop: '8px',
                                }} />
                                <div style={{
                                    fontFamily: GH_SANS,
                                    fontSize: '15px',
                                    fontWeight: 500,
                                    color: GH.ink,
                                }}>
                                    {d.clientName}
                                </div>
                                <div style={{ ...monoLabel, color: GH.ink30 }}>
                                    {d.unpaidSessionsCount} СЕССИЙ
                                </div>
                                <div style={{
                                    fontFamily: GH_MONO,
                                    fontSize: '16px',
                                    fontWeight: 600,
                                    color: GH.ink,
                                    textAlign: 'right',
                                    fontVariantNumeric: 'tabular-nums',
                                }}>
                                    {d.totalDebt.toFixed(0)} {d.currency || 'GEL'}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* ── Clients without future sessions ── */}
            {dashboard?.clientsWithoutFutureSessions && dashboard.clientsWithoutFutureSessions.length > 0 && (
                <section>
                    <div style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        borderBottom: `1px solid ${GH.ink}`,
                        paddingBottom: '14px',
                        flexWrap: 'wrap',
                        gap: '16px',
                    }}>
                        <h2 style={sectionHead}>Клиенты без будущих сессий</h2>
                        <span style={monoLabel}>
                            {String(dashboard.clientsWithoutFutureSessions.length).padStart(2, '0')} КЛИЕНТОВ
                        </span>
                    </div>
                    <div>
                        {dashboard.clientsWithoutFutureSessions.slice(0, 10).map((c, idx) => (
                            <div
                                key={c.id}
                                onClick={() => navigate(`/crm/clients/${c.id}`)}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '32px 1fr auto',
                                    gap: '20px',
                                    alignItems: 'baseline',
                                    padding: '16px 4px',
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    cursor: 'pointer',
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = GH.ink5; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                            >
                                <span style={{ ...monoLabel, color: GH.ink30 }}>
                                    {String(idx + 1).padStart(2, '0')}
                                </span>
                                <div style={{
                                    fontFamily: GH_SANS,
                                    fontSize: '15px',
                                    fontWeight: 500,
                                    color: GH.ink,
                                }}>
                                    {c.name}
                                </div>
                                <div style={{ ...monoLabel, color: GH.ink60 }}>
                                    {c.lastSessionDate
                                        ? `ПОСЛЕДНЯЯ · ${format(parseUTC(c.lastSessionDate), 'd MMM yyyy', { locale: ru }).toUpperCase()}`
                                        : 'НЕТ СЕССИЙ'}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* ── Google Calendar strip ── */}
            {calendarIdSaved && (
                <section>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderTop: `1px solid ${GH.ink10}`,
                        borderBottom: `1px solid ${GH.ink10}`,
                        padding: '18px 4px',
                        gap: '16px',
                        flexWrap: 'wrap',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                            <span style={{
                                width: '8px',
                                height: '8px',
                                background: GH.accent,
                                borderRadius: '50%',
                            }} />
                            <span style={{ ...monoLabel, color: GH.ink }}>GOOGLE CALENDAR · ПОДКЛЮЧЁН</span>
                        </div>
                        <button
                            onClick={() => navigate('/crm/sessions')}
                            style={{
                                ...monoLabel,
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                color: GH.accent,
                            }}
                        >
                            СИНХРОНИЗАЦИЯ →
                        </button>
                    </div>
                </section>
            )}

            {/* ── Quick actions ── */}
            <section>
                <div style={{
                    borderBottom: `1px solid ${GH.ink}`,
                    paddingBottom: '14px',
                    marginBottom: '24px',
                }}>
                    <h2 style={sectionHead}>Быстрые действия</h2>
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '0',
                    border: `1px solid ${GH.ink10}`,
                }}>
                    {([
                        { label: 'Добавить клиента', sub: 'Создать новую карточку', path: '/crm/clients' },
                        { label: 'Запланировать сессию', sub: 'Новая запись', path: '/crm/sessions' },
                        { label: 'Забронировать кабинет', sub: 'Unbox One · Uni · Neo', path: '/dashboard/bookings' },
                        // Excel #19 — кнопка "Купить абонемент" внутри CRM
                        // (специалисты часто хотят оформить себе абонемент
                        // прямо отсюда, не уходя в клиентский кабинет).
                        { label: 'Купить абонемент', sub: 'Скидка 10–20% на аренду', path: '/subscriptions' },
                        {
                            label: 'Открыть Google Calendar',
                            sub: calendarIdSaved ? 'Ваш личный календарь' : 'Google Calendar',
                            // If the specialist has set their own calendarId, open it directly;
                            // otherwise open the generic Google Calendar landing page.
                            href: calendarIdSaved
                                ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarIdSaved)}`
                                : 'https://calendar.google.com/calendar/u/0/r',
                        },
                    ] as Array<{ label: string; sub: string; path?: string; href?: string }>).map((action, idx, arr) => (
                        <button
                            key={action.path ?? action.href ?? idx}
                            onClick={() => {
                                if (action.href) {
                                    window.open(action.href, '_blank', 'noopener,noreferrer');
                                } else if (action.path) {
                                    navigate(action.path);
                                }
                            }}
                            style={{
                                padding: '28px 24px',
                                background: GH.paper,
                                border: 'none',
                                borderRight: idx < arr.length - 1 ? `1px solid ${GH.ink10}` : 'none',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'background 0.12s',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = GH.ink; (e.currentTarget as HTMLButtonElement).style.color = GH.paper; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = GH.paper; (e.currentTarget as HTMLButtonElement).style.color = GH.ink; }}
                        >
                            <span style={{
                                fontFamily: GH_MONO,
                                fontSize: '10px',
                                letterSpacing: '0.2em',
                                textTransform: 'uppercase',
                                opacity: 0.55,
                            }}>
                                → ДЕЙСТВИЕ · {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span style={{
                                fontFamily: GH_SANS,
                                fontSize: '18px',
                                fontWeight: 600,
                                letterSpacing: '-0.01em',
                            }}>
                                {action.label}
                            </span>
                            <span style={{
                                fontFamily: GH_MONO,
                                fontSize: '10px',
                                letterSpacing: '0.12em',
                                opacity: 0.6,
                            }}>
                                {action.sub}
                            </span>
                        </button>
                    ))}
                </div>
            </section>

        </div>
    );
}
