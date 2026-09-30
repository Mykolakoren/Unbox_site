import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Inbox, AlertTriangle, CheckCircle, Calendar, ArrowRight, Users as UsersIcon, ShieldCheck, BookOpen, DoorOpen, Plus } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { useUserStore } from '../../../store/userStore';
import { bookingsApi } from '../../../api/bookings';
import type { BookingHistoryItem } from '../../../store/types';
import { RESOURCES } from '../../../utils/data';
import { AdminBookingSheets, getAdminUserName } from './bookingSheets';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { formatDateLabel, formatGel } from '../../../utils/format';

/** 1 клиент, 2 клиента, 5 клиентов. */
function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

/**
 * Mobile admin dashboard — quick numbers for "what's happening today" plus
 * a count of hot-bookings waiting for approval.
 *
 * Counts are derived from already-loaded bookings (no extra API hits) for
 * snappy UX. The pending-approval count is a separate fetch since those
 * rows live in their own endpoint slice.
 */
export function MobileAdminDashboard() {
    // fetchAllBookings (/bookings, только админ) — как во вкладке «Брони».
    // Раньше тут был fetchBookings(): /me + обезличенный /public. В «Сегодня»
    // не было имён, шторка показывала «0 ₾», и этот урезанный список
    // затирал полные данные «Броней» в общем сторе.
    const { bookings, users, fetchAllBookings, fetchUsers } = useUserStore();
    const [pendingApprovals, setPendingApprovals] = useState<BookingHistoryItem[] | null>(null);
    // Wave 1: сбой проверки заявок — отдельное состояние. Раньше ошибка
    // превращалась в пустой список, и красный баннер молча пропадал.
    const [approvalsFailed, setApprovalsFailed] = useState(false);
    // Пока брони не пришли, не рисуем «0» и «Сегодня пусто».
    const [bookingsLoaded, setBookingsLoaded] = useState(false);
    // Owner asked 2026-05-25: today's booking list was inert. Tapping a row
    // now opens a bottom sheet with admin actions. Шторки те же, что во
    // вкладке «Брони» (bookingSheets.tsx): отмена 100/50/0, цена от настоящей.
    const [activeBooking, setActiveBooking] = useState<BookingHistoryItem | null>(null);
    // Owner 2026-06-02: «и ещё 20…» под списком был просто текстом, не
    // открывался. Делаю expand-toggle: тап → раскрывает остальные брони
    // (чтобы можно было быстро тапнуть, например, 19:00 без перехода
    // на /m/admin/bookings).
    const [todayExpanded, setTodayExpanded] = useState(false);
    // Прогноз должников: у кого будущие pending-списания уведут за лимит.
    const [forecast, setForecast] = useState<Awaited<ReturnType<typeof bookingsApi.getLimitForecast>> | null>(null);
    const [forecastExpanded, setForecastExpanded] = useState(false);

    const loadApprovals = () => {
        setApprovalsFailed(false);
        bookingsApi.getPendingApprovals()
            .then(setPendingApprovals)
            .catch(() => { setPendingApprovals(null); setApprovalsFailed(true); });
    };

    useEffect(() => {
        Promise.resolve(fetchAllBookings()).finally(() => setBookingsLoaded(true));
        if (!users || users.length === 0) fetchUsers();
        loadApprovals();
        bookingsApi.getLimitForecast().then(setForecast).catch(() => setForecast(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchAllBookings]);

    const today = useMemo(() => {
        const todayKey = fmtDate(new Date(), 'yyyy-MM-dd');
        return bookings.filter(b =>
            b.status === 'confirmed' && b.date && fmtDate(new Date(b.date as any), 'yyyy-MM-dd') === todayKey
        );
    }, [bookings]);

    // Предстоящие активные брони (с сегодняшнего дня). «Все брони в системе»
    // врали: список обрезан потолком (5000), а броней в базе больше.
    const upcoming = useMemo(() => {
        const todayKey = fmtDate(new Date(), 'yyyy-MM-dd');
        return bookings.filter(b =>
            (b.status === 'confirmed' || b.status === 'pending_approval')
            && b.date && fmtDate(new Date(b.date as any), 'yyyy-MM-dd') >= todayKey
        ).length;
    }, [bookings]);

    const tomorrow = useMemo(() => {
        const t = new Date();
        t.setDate(t.getDate() + 1);
        const tomKey = fmtDate(t, 'yyyy-MM-dd');
        return bookings.filter(b =>
            b.status === 'confirmed' && b.date && fmtDate(new Date(b.date as any), 'yyyy-MM-dd') === tomKey
        );
    }, [bookings]);

    // Брони могли уже лежать в сторе (открывали «Брони») — тогда показываем их.
    const bookingsPending = !bookingsLoaded && bookings.length === 0;

    return (
        <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                    Главная
                </h1>
                <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    {formatDateLabel(new Date(), { capitalize: true })}
                </p>
            </div>

            {approvalsFailed && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось проверить заявки" onRetry={loadApprovals} />
                </div>
            )}

            {/* Pending approvals — most urgent */}
            {pendingApprovals && pendingApprovals.length > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <Link
                        to="/m/admin/inbox"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            background: 'var(--status-pending-bg)',
                            border: '1px solid var(--color-ink-10)',
                            borderRadius: 14,
                            padding: '14px 16px',
                            color: 'var(--status-pending-fg)',
                            textDecoration: 'none',
                        }}
                    >
                        <AlertTriangle size={20} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>
                                Срочные брони ждут одобрения
                            </div>
                            <div style={{ fontSize: 12, marginTop: 2 }}>
                                Ждут вашего решения: {pendingApprovals.length}
                            </div>
                        </div>
                        <span style={{
                            background: 'var(--status-pending-fg)',
                            color: 'var(--color-on-ink)',
                            fontSize: 13,
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: 999,
                            minWidth: 28,
                            textAlign: 'center',
                        }}>{pendingApprovals.length}</span>
                    </Link>
                </div>
            )}

            {/* Прогноз должников — раннее предупреждение о превышении лимита */}
            {forecast && forecast.count > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <button
                        onClick={() => setForecastExpanded(v => !v)}
                        style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                            background: 'var(--status-pending-bg)', border: '1px solid var(--color-ink-10)', borderRadius: 14,
                            padding: '14px 16px', color: 'var(--status-pending-fg)', textAlign: 'left', cursor: 'pointer',
                        }}
                    >
                        <AlertTriangle size={20} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>Риск превышения лимита</div>
                            <div style={{ fontSize: 12, marginTop: 2 }}>
                                {forecast.count} {plural(forecast.count, 'клиент уйдёт', 'клиента уйдут', 'клиентов уйдут')} за лимит после будущих списаний
                            </div>
                        </div>
                        <span style={{
                            background: 'var(--status-pending-fg)', color: 'var(--color-on-ink)', fontSize: 13, fontWeight: 600,
                            padding: '4px 10px', borderRadius: 999, minWidth: 28, textAlign: 'center',
                        }}>{forecast.count}</span>
                    </button>
                    {forecastExpanded && (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {forecast.clients.map(c => (
                                <Link
                                    key={c.userId}
                                    to={`/m/admin/users/${encodeURIComponent(c.email)}`}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        gap: 10, background: 'var(--color-card)', border: '1px solid var(--color-ink-10)',
                                        borderRadius: 12, padding: '10px 14px', textDecoration: 'none', color: 'inherit',
                                    }}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                                        <div style={{ fontSize: 12, color: 'var(--status-pending-fg)', marginTop: 2 }}>
                                            баланс {formatGel(c.balance)} · лимит {formatGel(c.creditLimit)} · ждут списания {formatGel(c.pendingTotal)} ({c.pendingCount})
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--status-pending-fg)' }}>{formatGel(-c.overLimitBy)}</div>
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>за лимит</div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Today / tomorrow numbers — owner 2026-06-02: каждая метрика
                кликабельна, ведёт в /m/admin/bookings с предзаполненным
                фильтром (день и/или статус). Раньше карточки были немыми
                и админ не понимал куда дальше идти. */}
            <div style={{ padding: '0 16px' }}>
                <SectionTitle>Активность</SectionTitle>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                }}>
                    <Stat
                        icon={<Calendar size={16} />}
                        label="Брони сегодня"
                        value={bookingsPending ? '—' : today.length}
                        to="/m/admin/bookings"
                    />
                    <Stat
                        icon={<Calendar size={16} />}
                        label="Брони завтра"
                        value={bookingsPending ? '—' : tomorrow.length}
                        to="/m/admin/bookings?day=tomorrow"
                    />
                    <Stat
                        icon={<CheckCircle size={16} />}
                        label="Ждут одобрения"
                        value={pendingApprovals?.length ?? '—'}
                        to="/m/admin/inbox"
                    />
                    <Stat
                        icon={<Inbox size={16} />}
                        label="Предстоящие брони"
                        value={bookingsPending ? '—' : upcoming}
                        to="/m/admin/bookings"
                    />
                </div>
            </div>

            {/* Today list — at-a-glance who's where */}
            <div style={{ padding: '0 16px' }}>
                <SectionTitle>{bookingsPending ? 'Сегодня' : `Сегодня · ${today.length}`}</SectionTitle>
                {bookingsPending ? (
                    <SkeletonList count={3} label="Загружаем брони" cardHeight={56} />
                ) : today.length === 0 ? (
                    <EmptyState compact title="Сегодня броней нет" />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {today
                            .slice()
                            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
                            .slice(0, todayExpanded ? today.length : 8)
                            .map(b => (
                                <button
                                    key={b.id}
                                    onClick={() => setActiveBooking(b)}
                                    style={{
                                        background: 'var(--color-card)',
                                        border: '1px solid var(--color-ink-08)',
                                        borderRadius: 10,
                                        padding: '8px 12px',
                                        minHeight: 48,
                                        display: 'flex',
                                        gap: 10,
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        textAlign: 'left',
                                        width: '100%',
                                    }}
                                >
                                    <div style={{ fontSize: 13, fontWeight: 600, minWidth: 50 }}>
                                        {b.startTime}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.25 }}>
                                            {RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId}
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {getAdminUserName(users, b.userId)}
                                        </div>
                                    </div>
                                    <ArrowRight size={14} style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} />
                                </button>
                            ))}
                        {today.length > 8 && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                <Button
                                    variant="secondary"
                                    onClick={() => setTodayExpanded(v => !v)}
                                    style={{ flex: 1 }}
                                >
                                    {todayExpanded
                                        ? 'Свернуть'
                                        : `Показать ещё ${today.length - 8}`}
                                </Button>
                                <Link
                                    to="/m/admin/bookings"
                                    className="ui-btn ui-btn--primary"
                                    style={{ flex: 1 }}
                                >
                                    Все брони
                                </Link>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Quick links to admin sub-screens that don't fit the bottom
                nav (6 tabs is already cramped). Owner 2026-05-26: surface
                Команда / Специалисты / БЗ here so admins find them without
                falling back to desktop. */}
            <div style={{ padding: '8px 16px 0' }}>
                <SectionTitle>Управление</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <QuickLink to="/m/admin/cabinets" icon={DoorOpen} label="Кабинеты" />
                    <QuickLink to="/m/admin/team" icon={UsersIcon} label="Команда" />
                    <QuickLink to="/m/admin/specialists" icon={ShieldCheck} label="Специалисты" />
                    <QuickLink to="/m/admin/kb" icon={BookOpen} label="База знаний" />
                </div>
            </div>

            <AdminBookingSheets
                booking={activeBooking}
                getUserName={email => getAdminUserName(users, email)}
                onClose={() => setActiveBooking(null)}
            />

            {/* 2026-06-06 owner: тот же FAB что и на /m/admin/bookings — для
                консистентности «создать бронь» доступно с любого админ-
                экрана, не только из списка броней. */}
            <Link
                to="/m/find"
                aria-label="Новая бронь"
                style={{
                    position: 'fixed',
                    right: 16,
                    bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
                    width: 56, height: 56,
                    borderRadius: 28,
                    background: 'var(--color-ink)',
                    color: 'var(--color-on-ink)',
                    display: 'grid', placeItems: 'center',
                    boxShadow: 'var(--shadow-pop)',
                    textDecoration: 'none',
                    zIndex: 30,
                }}
            >
                <Plus size={24} strokeWidth={2.4} />
            </Link>
        </div>
    );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
        <Link
            to={to}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '14px 8px',
                background: 'var(--color-card)',
                border: '1px solid var(--color-ink-08)',
                borderRadius: 11,
                color: 'var(--color-ink)',
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 600,
            }}
        >
            <Icon size={18} style={{ color: 'var(--color-ink-60)' }} aria-hidden="true" />
            <span>{label}</span>
        </Link>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--color-ink-60)',
            marginBottom: 8,
        }}>{children}</div>
    );
}

function Stat({ icon, label, value, to }: { icon: React.ReactNode; label: string; value: number | string; to?: string }) {
    const inner = (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink-60)' }}>
                {icon}
                <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
            </div>
            <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 6,
            }}>
                <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, color: 'var(--color-ink)' }}>
                    {value}
                </span>
                {to && <ArrowRight size={14} aria-hidden="true" style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} />}
            </div>
        </>
    );
    const baseStyle: React.CSSProperties = {
        background: 'var(--color-card)',
        border: '1px solid var(--color-ink-08)',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        color: 'var(--color-ink)',
        textDecoration: 'none',
        fontFamily: 'inherit',
        textAlign: 'left',
    };
    if (to) {
        return <Link to={to} className="press" style={baseStyle}>{inner}</Link>;
    }
    return <div style={baseStyle}>{inner}</div>;
}
