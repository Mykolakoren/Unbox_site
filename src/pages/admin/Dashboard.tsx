import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { startOfToday, startOfMonth, endOfMonth, isAfter, format } from 'date-fns';
import { Users, CreditCard, Calendar, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { AnalyticsCharts } from '../../components/admin/AnalyticsCharts';
import { useCashboxStore } from '../../store/cashboxStore';
import { cashboxApi, type CashboxAnalytics } from '../../api/cashbox';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { BookingHistoryItem, User as AppUser } from '../../store/types';


export function AdminDashboard() {
    const { bookings, users, fetchUsers, fetchAllBookings } = useUserStore();
    const { fetchBalance, balance } = useCashboxStore();

    // Local analytics state — avoids polluting the shared store used by Finance page
    const [monthAnalytics, setMonthAnalytics] = useState<CashboxAnalytics | null>(null);

    useEffect(() => {
        fetchUsers();
        fetchAllBookings();
        fetchBalance();

        // Fetch accurate server-side SUM for current month
        const now = new Date();
        const dateFrom = format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00");
        const dateTo = format(endOfMonth(now), "yyyy-MM-dd'T'23:59:59");
        cashboxApi.getAnalytics(dateFrom, dateTo)
            .then(setMonthAnalytics)
            .catch(() => {});
    }, [fetchUsers, fetchAllBookings, fetchBalance]);

    const now = new Date();
    const today = startOfToday();
    const todayStr = format(today, 'yyyy-MM-dd');

    // Server-side accurate totals
    const monthRevenue = monthAnalytics?.totalIncome ?? 0;

    // Today's income from daily breakdown
    const todayRevenue = monthAnalytics?.dailyData
        ?.filter(d => d.date === todayStr)
        ?.reduce((sum, d) => sum + (d.income || 0), 0) ?? 0;

    const confirmedBookings = bookings.filter(b => b.status === 'confirmed');
    const totalUsers = users.length;
    const activeBookingsCount = confirmedBookings.filter(b => isAfter(new Date(b.date), now)).length;
    const reRentedCount = bookings.filter(b => b.status === 're-rented').length;

    const stats = [
        {
            label: 'Выручка за сегодня',
            value: `${todayRevenue.toFixed(2)} ₾`,
            icon: TrendingUp,
            color: 'bg-unbox-light text-unbox-green',
        },
        {
            label: 'Выручка за месяц',
            value: `${monthRevenue.toFixed(2)} ₾`,
            icon: CreditCard,
            color: 'bg-unbox-light text-unbox-dark',
        },
        {
            label: 'Активных броней',
            value: activeBookingsCount,
            icon: Calendar,
            color: 'bg-unbox-light text-unbox-green',
        },
        {
            label: 'Всего клиентов',
            value: totalUsers,
            icon: Users,
            color: 'bg-unbox-light text-unbox-dark',
        },
    ];

    // Recent Bookings (Last 5 created)
    const recentBookings = [...bookings]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5);

    // Excel #12 — count of bookings created today + yesterday, for the
    // "Входящий поток" header. Covers weekend hand-offs where yesterday
    // matters as much as today. (Reuses `now` from above.)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
    const incomingCounts = bookings.reduce(
        (acc, b) => {
            const ts = new Date(b.createdAt).getTime();
            if (ts >= todayStart && ts < tomorrowStart) acc.today += 1;
            else if (ts >= yesterdayStart && ts < todayStart) acc.yesterday += 1;
            return acc;
        },
        { today: 0, yesterday: 0 },
    );

    // ── Grid House design flag — rollback-safe variant ──
    return (

            <GridHouseAdminDashboard
                todayRevenue={todayRevenue}
                monthRevenue={monthRevenue}
                activeBookingsCount={activeBookingsCount}
                totalUsers={totalUsers}
                reRentedCount={reRentedCount}
                balance={balance}
                recentBookings={recentBookings}
                allBookings={bookings}
                users={users}
                monthAnalytics={monthAnalytics}
                incomingCounts={incomingCounts}
            />
        );
}


// ═════════════════════════════════════════════════════════════════════════
// GRID HOUSE VARIANT
// Rollback: delete everything below + the early-return block above.
// ═════════════════════════════════════════════════════════════════════════

interface GHDashProps {
    todayRevenue: number;
    monthRevenue: number;
    activeBookingsCount: number;
    totalUsers: number;
    reRentedCount: number;
    balance: number;
    recentBookings: BookingHistoryItem[];
    allBookings: BookingHistoryItem[];
    users: AppUser[];
    monthAnalytics: CashboxAnalytics | null;
    /** Excel #12 — header counter "Сегодня N · Вчера M". */
    incomingCounts: { today: number; yesterday: number };
}

function GridHouseAdminDashboard({
    todayRevenue,
    monthRevenue,
    activeBookingsCount,
    totalUsers,
    reRentedCount,
    balance,
    recentBookings,
    allBookings,
    users,
    monthAnalytics,
    incomingCounts,
}: GHDashProps) {
    const navigate = useNavigate();
    const hairline = `1px solid ${GH.ink10}`;
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);
    const monoLabel: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: 10,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: GH.ink60,
    };
    const bigNumber: React.CSSProperties = {
        fontFamily: GH_SANS,
        fontSize: 44,
        fontWeight: 800,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
    };

    const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

    const kpi = [
        { label: 'Выручка · Сегодня', num: `${fmt(todayRevenue)} ₾`, sub: format(new Date(), 'dd MMMM') },
        { label: 'Выручка · Месяц', num: `${fmt(monthRevenue)} ₾`, sub: format(new Date(), 'LLLL yyyy') },
        { label: 'Броней · Активных', num: String(activeBookingsCount).padStart(2, '0'), sub: 'Впереди' },
        { label: 'Клиентов · Всего', num: String(totalUsers).padStart(2, '0'), sub: 'В базе' },
    ];

    const secondary = [
        { label: 'Касса', num: `${fmt(balance)} ₾`, sub: 'Текущий баланс' },
        { label: 'Пересдано', num: String(reRentedCount).padStart(2, '0'), sub: 'Возвратов' },
        { label: 'Средний день', num: monthAnalytics?.dailyData && monthAnalytics.dailyData.length > 0
            ? `${fmt(monthRevenue / Math.max(1, monthAnalytics.dailyData.length))} ₾`
            : '—', sub: 'Выручки за день' },
    ];

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* Header */}
            <div style={{ marginBottom: narrow ? 20 : 32 }}>
                <div style={{ ...monoLabel, marginBottom: narrow ? 6 : 10 }}>Админ · Обзор</div>
                <h1
                    style={{
                        fontSize: narrow ? 32 : 'clamp(32px, 5vw, 68px)',
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                        lineHeight: 0.95,
                        margin: 0,
                        textTransform: 'capitalize',
                    }}
                >
                    {format(new Date(), 'LLLL yyyy')}
                </h1>
            </div>

            {/* KPI strip 1 */}
            <div
                style={{
                    border: hairline,
                    display: 'grid',
                    gridTemplateColumns: narrow ? '1fr 1fr' : 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
                    marginBottom: 0,
                }}
            >
                {kpi.map((c, i) => (
                    <div
                        key={c.label}
                        style={{
                            padding: narrow ? '14px 12px' : 'clamp(16px, 2vw, 28px) clamp(14px, 2vw, 24px)',
                            borderRight: narrow
                                ? (i % 2 === 0 ? hairline : undefined)
                                : (i < kpi.length - 1 ? hairline : undefined),
                            borderBottom: hairline,
                        }}
                    >
                        <div style={{ ...monoLabel, marginBottom: narrow ? 8 : 14, fontSize: narrow ? 9 : 10 }}>{c.label}</div>
                        <div style={{ ...bigNumber, fontSize: narrow ? 20 : 'clamp(24px, 4vw, 44px)' }}>{c.num}</div>
                        <div style={{ fontSize: narrow ? 10 : 12, color: GH.ink60, marginTop: narrow ? 6 : 10, textTransform: 'capitalize' }}>{c.sub}</div>
                    </div>
                ))}
            </div>

            {/* KPI strip 2 */}
            <div
                style={{
                    border: hairline,
                    borderTop: 'none',
                    display: 'grid',
                    gridTemplateColumns: narrow ? '1fr 1fr 1fr' : 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
                    marginBottom: narrow ? 24 : 40,
                }}
            >
                {secondary.map((c, i) => (
                    <div
                        key={c.label}
                        style={{
                            padding: narrow ? '12px 10px' : 'clamp(14px, 2vw, 22px) clamp(14px, 2vw, 24px)',
                            borderRight: i < secondary.length - 1 ? hairline : undefined,
                            borderBottom: hairline,
                        }}
                    >
                        <div style={{ ...monoLabel, marginBottom: narrow ? 6 : 12, fontSize: narrow ? 8 : 10 }}>{c.label}</div>
                        <div style={{ ...bigNumber, fontSize: narrow ? 14 : 'clamp(20px, 3vw, 28px)' }}>{c.num}</div>
                        <div style={{ fontSize: narrow ? 9 : 12, color: GH.ink60, marginTop: narrow ? 4 : 8 }}>{c.sub}</div>
                    </div>
                ))}
            </div>

            {/* Analytics charts — wrapped in hairline frame (legacy internals) */}
            <div style={{ border: hairline, padding: narrow ? 14 : 28, marginBottom: narrow ? 24 : 40, overflowX: 'auto' }}>
                <div style={{ ...monoLabel, marginBottom: narrow ? 12 : 20 }}>Аналитика · Бронирования</div>
                <AnalyticsCharts bookings={allBookings} />
            </div>

            {/* Recent bookings */}
            <div style={{ marginBottom: 40 }}>
                <div style={{ ...monoLabel, marginBottom: narrow ? 8 : 14 }}>Последние бронирования</div>
                <h2
                    style={{
                        fontSize: narrow ? 20 : 28,
                        fontWeight: 800,
                        letterSpacing: '-0.01em',
                        margin: 0,
                        marginBottom: narrow ? 14 : 20,
                    }}
                >
                    Входящий поток
                </h2>
                {/* Excel #12 — counter of bookings CREATED today + yesterday. */}
                <div style={{ ...monoLabel, marginBottom: narrow ? 12 : 18, color: GH.ink60 }}>
                    Сегодня {String(incomingCounts.today).padStart(2, '0')}
                    {' · '}
                    Вчера {String(incomingCounts.yesterday).padStart(2, '0')}
                </div>
                <div style={{ border: hairline }}>
                    {/* Header */}
                    {!narrow && (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '64px 120px 1fr 140px 120px',
                                padding: '12px 20px',
                                borderBottom: hairline,
                                background: GH.ink5,
                                ...monoLabel,
                            }}
                        >
                            <div>№</div>
                            <div>Дата · Время</div>
                            <div>Клиент</div>
                            <div>Статус</div>
                            <div style={{ textAlign: 'right' }}>Сумма</div>
                        </div>
                    )}
                    {recentBookings.length === 0 && (
                        <div style={{ padding: 32, textAlign: 'center', color: GH.ink60, ...monoLabel }}>
                            Нет бронирований
                        </div>
                    )}
                    {recentBookings.map((b, i) => {
                        const clientName = users.find(u => u.email === b.userId)?.name || b.userId;
                        const statusColor = b.status === 'confirmed' ? GH.accent : b.status === 'cancelled' ? GH.ink30 : b.status === 're-rented' ? GH.ink : GH.ink60;
                        const statusText = b.status === 'confirmed' ? 'Подтв.' : b.status === 'cancelled' ? 'Отмен.' : b.status === 're-rented' ? 'Пересд.' : b.status;
                        if (narrow) {
                            return (
                                <button
                                    key={b.id}
                                    type="button"
                                    onClick={() => navigate(`/admin/bookings?view=grid&highlight=${b.id}`)}
                                    title="Открыть в шахматке"
                                    style={{
                                        padding: '12px 14px',
                                        borderBottom: i < recentBookings.length - 1 ? hairline : undefined,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 4,
                                        width: '100%',
                                        textAlign: 'left',
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                            <span style={{ fontFamily: GH_MONO, fontSize: 10, color: GH.ink30, fontVariantNumeric: 'tabular-nums' }}>
                                                {String(i + 1).padStart(2, '0')}
                                            </span>
                                            <span style={{
                                                fontSize: 13, fontWeight: 600, color: GH.ink,
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                                            }}>
                                                {clientName}
                                            </span>
                                        </div>
                                        <span style={{
                                            fontFamily: GH_MONO, fontSize: 13, fontWeight: 700, color: GH.ink,
                                            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' as const,
                                        }}>
                                            {b.paymentMethod === 'subscription' ? 'Абн.' : `${b.finalPrice}₾`}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontFamily: GH_MONO, fontSize: 10, color: GH.ink60, fontVariantNumeric: 'tabular-nums' }}>
                                            {format(new Date(b.date), 'dd.MM')} · {b.startTime}
                                        </span>
                                        <span style={{ ...monoLabel, color: statusColor, fontSize: 9 }}>{statusText}</span>
                                    </div>
                                </button>
                            );
                        }
                        return (
                            // Excel #12 — row is clickable, opens the booking
                            // in the chessboard with this booking highlighted.
                            <button
                                key={b.id}
                                type="button"
                                onClick={() => navigate(`/admin/bookings?view=grid&highlight=${b.id}`)}
                                title="Открыть в шахматке"
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '64px 120px 1fr 140px 120px',
                                    padding: '16px 20px',
                                    borderBottom: i < recentBookings.length - 1 ? hairline : undefined,
                                    alignItems: 'center',
                                    width: '100%',
                                    textAlign: 'left',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    transition: 'background 0.12s',
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = GH.ink5; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                            >
                                <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, fontVariantNumeric: 'tabular-nums' }}>
                                    {String(i + 1).padStart(2, '0')}
                                </div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 13, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>
                                    {format(new Date(b.date), 'dd.MM')} · {b.startTime}
                                </div>
                                <div style={{ fontSize: 14, color: GH.ink }}>{clientName}</div>
                                <div style={{ ...monoLabel, color: statusColor, fontSize: 10 }}>{statusText}</div>
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 14,
                                        fontWeight: 600,
                                        textAlign: 'right',
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {b.paymentMethod === 'subscription' ? 'Абн.' : `${b.finalPrice} ₾`}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
