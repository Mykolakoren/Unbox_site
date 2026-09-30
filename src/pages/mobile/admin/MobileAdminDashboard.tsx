import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, AlertTriangle, CheckCircle, Calendar, ArrowRight, Users as UsersIcon, ShieldCheck, BookOpen, DoorOpen, Plus } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useUserStore } from '../../../store/userStore';
import { bookingsApi } from '../../../api/bookings';
import type { BookingHistoryItem } from '../../../store/types';
import { RESOURCES } from '../../../utils/data';
import { AdminBookingSheets, getAdminUserName } from './bookingSheets';

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

    useEffect(() => {
        fetchAllBookings();
        if (!users || users.length === 0) fetchUsers();
        bookingsApi.getPendingApprovals().then(setPendingApprovals).catch(() => setPendingApprovals([]));
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

    return (
        <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Дашборд
                </h1>
                <p style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                    {fmtDate(new Date(), 'EEEE, d MMMM', { locale: ru })}
                </p>
            </div>

            {/* Pending approvals — most urgent */}
            {pendingApprovals && pendingApprovals.length > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <Link
                        to="/m/admin/inbox"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            background: '#FEF2F2',
                            border: '1px solid #FCA5A5',
                            borderRadius: 14,
                            padding: '14px 16px',
                            color: '#991B1B',
                            textDecoration: 'none',
                        }}
                    >
                        <AlertTriangle size={20} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>
                                Hot-booking на одобрении
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                                Ждут вашей реакции — {pendingApprovals.length} шт.
                            </div>
                        </div>
                        <span style={{
                            background: '#991B1B',
                            color: '#fff',
                            fontSize: 13,
                            fontWeight: 800,
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
                            background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 14,
                            padding: '14px 16px', color: '#92400E', textAlign: 'left', cursor: 'pointer',
                        }}
                    >
                        <AlertTriangle size={20} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>Риск превышения лимита</div>
                            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                                {forecast.count} клиент(ов) уйдут за лимит после будущих списаний
                            </div>
                        </div>
                        <span style={{
                            background: '#92400E', color: '#fff', fontSize: 13, fontWeight: 800,
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
                                        gap: 10, background: '#fff', border: '1px solid #F3E8C8',
                                        borderRadius: 12, padding: '10px 14px', textDecoration: 'none', color: 'inherit',
                                    }}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                                        <div style={{ fontSize: 11, color: '#92400E', marginTop: 2 }}>
                                            баланс {c.balance}₾ · лимит {c.creditLimit}₾ · pending {c.pendingTotal}₾ ({c.pendingCount})
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 800, color: '#B45309' }}>−{c.overLimitBy}₾</div>
                                        <div style={{ fontSize: 10, color: '#999' }}>за лимит</div>
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
                        label="Сегодня бронь"
                        value={today.length}
                        to="/m/admin/bookings"
                    />
                    <Stat
                        icon={<Calendar size={16} />}
                        label="Завтра бронь"
                        value={tomorrow.length}
                        to="/m/admin/bookings?day=tomorrow"
                    />
                    <Stat
                        icon={<CheckCircle size={16} />}
                        label="Hold pending"
                        value={pendingApprovals?.length ?? '…'}
                        to="/m/admin/inbox"
                    />
                    <Stat
                        icon={<Inbox size={16} />}
                        label="Предстоящие брони"
                        value={upcoming}
                        to="/m/admin/bookings"
                    />
                </div>
            </div>

            {/* Today list — at-a-glance who's where */}
            <div style={{ padding: '0 16px' }}>
                <SectionTitle>Сегодня · {today.length}</SectionTitle>
                {today.length === 0 ? (
                    <div style={{
                        background: '#F4F4F2',
                        borderRadius: 14,
                        padding: 18,
                        textAlign: 'center',
                        color: '#666',
                        fontSize: 14,
                    }}>
                        Сегодня пока пусто.
                    </div>
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
                                        background: '#fff',
                                        border: '1px solid rgba(0,0,0,0.08)',
                                        borderRadius: 10,
                                        padding: '8px 12px',
                                        display: 'flex',
                                        gap: 10,
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        textAlign: 'left',
                                        width: '100%',
                                    }}
                                >
                                    <div style={{ fontSize: 13, fontWeight: 700, minWidth: 50 }}>
                                        {b.startTime}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.25 }}>
                                            {RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#666', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {getAdminUserName(users, b.userId)}
                                        </div>
                                    </div>
                                    <ArrowRight size={14} style={{ color: '#bbb', flexShrink: 0 }} />
                                </button>
                            ))}
                        {today.length > 8 && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                <button
                                    onClick={() => setTodayExpanded(v => !v)}
                                    style={{
                                        flex: 1,
                                        background: '#F4F4F2', color: '#0E0E0E',
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        borderRadius: 10,
                                        padding: '8px 10px',
                                        fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {todayExpanded
                                        ? 'Свернуть'
                                        : `Показать ещё ${today.length - 8}`}
                                </button>
                                <Link
                                    to="/m/admin/bookings"
                                    style={{
                                        flex: 1,
                                        background: '#0E0E0E', color: '#fff',
                                        border: 'none', borderRadius: 10,
                                        padding: '8px 10px',
                                        fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                                        cursor: 'pointer',
                                        textAlign: 'center', textDecoration: 'none',
                                        lineHeight: 1.4,
                                    }}
                                >
                                    Открыть все →
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
                    <QuickLink to="/m/admin/specialists" icon={ShieldCheck} label="Специал." />
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
                    background: '#0E0E0E',
                    color: '#fff',
                    display: 'grid', placeItems: 'center',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
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
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 11,
                color: '#0E0E0E',
                textDecoration: 'none',
                fontSize: 11,
                fontWeight: 600,
            }}
        >
            <Icon size={18} style={{ color: '#1B7430' }} />
            <span>{label}</span>
        </Link>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: '#999',
            marginBottom: 8,
        }}>{children}</div>
    );
}

function Stat({ icon, label, value, to }: { icon: React.ReactNode; label: string; value: number | string; to?: string }) {
    const inner = (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink-60)' }}>
                {icon}
                <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
            </div>
            <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 6,
            }}>
                <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: 'var(--color-ink)' }}>
                    {value}
                </span>
                {to && <ArrowRight size={14} style={{ color: 'var(--color-ink-40)', flexShrink: 0 }} />}
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
