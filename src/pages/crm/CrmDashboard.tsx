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
import { toast } from 'sonner';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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
    if (useDesignFlag()) {
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

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold mb-1">CRM Кабинет</h1>
                    <p className="text-unbox-dark/60">Управление клиентами и сессиями</p>
                </div>
                <div className="flex items-center gap-2 bg-white rounded-xl border border-unbox-light px-1 py-1 shadow-sm">
                    <button
                        onClick={() => setCurrentMonth(d => subMonths(d, 1))}
                        className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-medium text-sm w-32 text-center capitalize">
                        {format(currentMonth, 'LLLL yyyy', { locale: ru })}
                    </span>
                    <button
                        onClick={() => setCurrentMonth(d => addMonths(d, 1))}
                        className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                    {!isThisMonth && (
                        <button
                            onClick={() => setCurrentMonth(new Date())}
                            className="text-xs px-2 py-1 text-unbox-grey hover:text-unbox-dark transition-colors"
                        >
                            Сейчас
                        </button>
                    )}
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    icon={Users}
                    label="Активных клиентов"
                    value={dashboard?.activeClients ?? 0}
                    color="blue"
                    onClick={() => navigate('/crm/clients')}
                />
                <StatCard
                    icon={Calendar}
                    label="Сессий за месяц"
                    value={dashboard?.sessionsThisMonth ?? 0}
                    color="green"
                    onClick={() => navigate('/crm/sessions')}
                />
                <StatCard
                    icon={AlertCircle}
                    label="Неоплаченных"
                    value={dashboard?.unpaidSessions ?? 0}
                    color={dashboard?.unpaidSessions ? 'red' : 'gray'}
                    onClick={() => navigate('/crm/finances')}
                />
                <StatCard
                    icon={TrendingUp}
                    label="Доход за месяц"
                    value={dashboard?.revenueByCurrency && Object.keys(dashboard.revenueByCurrency).length > 0
                        ? `≈ ${totalInGel(dashboard.revenueByCurrency).toFixed(0)} ₾`
                        : `${(dashboard?.revenueThisMonth ?? 0).toFixed(0)} ₾`}
                    subtitle={dashboard?.revenueByCurrency && Object.keys(dashboard.revenueByCurrency).length > 1
                        ? Object.entries(dashboard.revenueByCurrency as Record<string, number>).map(([cur, val]) => `${val.toFixed(0)} ${cur}`).join(' · ')
                        : undefined}
                    color="emerald"
                    onClick={() => navigate('/crm/finances')}
                />
            </div>

            {/* Extended Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard
                    icon={BarChart3}
                    label="Средняя ставка/час"
                    value={`≈ ${(dashboard?.avgHourlyRate ?? 0).toFixed(0)} ₾`}
                    color="blue"
                />
                <StatCard
                    icon={Wallet}
                    label="Мин / Макс ставка"
                    value={`${dashboard?.minRate ?? 0} – ${dashboard?.maxRate ?? 0} ₾`}
                    color="blue"
                />
                <StatCard
                    icon={AlertCircle}
                    label="Общий долг"
                    value={dashboard?.debtByCurrency && Object.keys(dashboard.debtByCurrency).length > 0
                        ? `≈ ${totalInGel(dashboard.debtByCurrency).toFixed(0)} ₾`
                        : '0'}
                    subtitle={dashboard?.debtByCurrency && Object.keys(dashboard.debtByCurrency).length > 1
                        ? Object.entries(dashboard.debtByCurrency as Record<string, number>).map(([cur, val]) => `${val.toFixed(0)} ${cur}`).join(' · ')
                        : undefined}
                    color={(dashboard?.totalActiveDebt ?? 0) > 0 ? 'red' : 'gray'}
                    onClick={() => navigate('/crm/finances')}
                />
            </div>

            {/* Revenue Chart */}
            {dashboard?.monthlyStats && dashboard.monthlyStats.length > 0 && (
                <div className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="w-5 h-5 text-unbox-grey" />
                        <h2 className="font-bold text-lg">Доход по месяцам</h2>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={dashboard.monthlyStats} barCategoryGap="20%">
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                            <XAxis
                                dataKey="month"
                                tickFormatter={(v: string) => {
                                    const [, m] = v.split('-');
                                    const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
                                    return months[parseInt(m, 10) - 1] || m;
                                }}
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                            />
                            <YAxis fontSize={12} tickLine={false} axisLine={false} />
                            <Tooltip
                                content={({ active, payload, label }: any) => {
                                    if (!active || !payload?.length) return null;
                                    const parts = String(label).split('-');
                                    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
                                    const title = parts.length >= 2 ? `${months[parseInt(parts[1], 10) - 1]} ${parts[0]}` : label;
                                    const data = payload[0]?.payload || {};
                                    const formatByCur = (cur: Record<string, number> | undefined) => {
                                        if (!cur) return null;
                                        const entries = Object.entries(cur).filter(([, v]) => v > 0);
                                        if (entries.length <= 1) return null;
                                        return entries.map(([c, v]) => `${v.toFixed(0)} ${c}`).join(' · ');
                                    };
                                    return (
                                        <div className="bg-white rounded-xl border border-gray-200 shadow-lg p-3 text-sm">
                                            <div className="font-bold text-gray-800 mb-2">{title}</div>
                                            <div className="text-gray-500">Ожидалось : <span className="font-medium text-gray-700">≈ {Number(data.expected || 0).toFixed(0)} ₾</span></div>
                                            {formatByCur(data.expectedByCurrency) && (
                                                <div className="text-[11px] text-gray-400 ml-2 mb-1">{formatByCur(data.expectedByCurrency)}</div>
                                            )}
                                            <div className="text-unbox-green">Получено : <span className="font-medium">≈ {Number(data.received || 0).toFixed(0)} ₾</span></div>
                                            {formatByCur(data.receivedByCurrency) && (
                                                <div className="text-[11px] text-gray-400 ml-2 mb-1">{formatByCur(data.receivedByCurrency)}</div>
                                            )}
                                            <div className="text-gray-400 text-xs mt-1">{data.sessionCount || 0} сессий</div>
                                        </div>
                                    );
                                }}
                            />
                            <Bar dataKey="expected" name="expected" fill="#d4e2e1" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="received" name="received" fill="#2a8c7a" radius={[6, 6, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="flex items-center justify-center gap-6 mt-2 text-xs text-unbox-grey">
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#2a8c7a]" /> Получено</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#d4e2e1]" /> Ожидалось</span>
                    </div>
                </div>
            )}

            {/* Clients without future sessions */}
            {dashboard?.clientsWithoutFutureSessions && dashboard.clientsWithoutFutureSessions.length > 0 && (
                <div className="bg-white rounded-2xl border border-orange-200 shadow-sm">
                    <div className="flex items-center gap-2 p-5 border-b border-orange-100">
                        <UserX className="w-5 h-5 text-orange-500" />
                        <h2 className="font-bold text-lg text-orange-700">Клиенты без будущих сессий</h2>
                        <span className="text-xs text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full">{dashboard.clientsWithoutFutureSessions.length}</span>
                    </div>
                    <div className="divide-y divide-orange-50">
                        {dashboard.clientsWithoutFutureSessions.slice(0, 10).map(c => (
                            <div
                                key={c.id}
                                className="flex items-center justify-between px-5 py-3 hover:bg-orange-50/30 cursor-pointer transition-colors"
                                onClick={() => navigate(`/crm/clients/${c.id}`)}
                            >
                                <span className="font-medium text-sm text-unbox-dark">{c.name}</span>
                                <span className="text-xs text-unbox-grey">
                                    {c.lastSessionDate ? `Последняя: ${format(parseUTC(c.lastSessionDate), 'd MMM yyyy', { locale: ru })}` : 'Нет сессий'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Debt by client */}
            {dashboard?.debtByClient && dashboard.debtByClient.length > 0 && (
                <div className="bg-white rounded-2xl border border-red-200 shadow-sm">
                    <div className="flex items-center gap-2 p-5 border-b border-red-100">
                        <Wallet className="w-5 h-5 text-red-500" />
                        <h2 className="font-bold text-lg text-red-700">Долги клиентов</h2>
                    </div>
                    <div className="divide-y divide-red-50">
                        {dashboard.debtByClient.map(d => (
                            <div
                                key={d.clientId}
                                className="flex items-center justify-between px-5 py-3 hover:bg-red-50/30 cursor-pointer transition-colors"
                                onClick={() => navigate(`/crm/clients/${d.clientId}`)}
                            >
                                <div>
                                    <span className="font-medium text-sm text-unbox-dark">{d.clientName}</span>
                                    <span className="text-xs text-unbox-grey ml-2">{d.unpaidSessionsCount} сессий</span>
                                </div>
                                <span className="font-bold text-sm text-red-600">{d.totalDebt.toFixed(0)} {d.currency || 'GEL'}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Google Calendar — compact info (sync moved to Sessions tab) */}
            {calendarIdSaved && (
                <div className="bg-white rounded-2xl border border-unbox-light shadow-sm p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-unbox-green" />
                        <span className="text-sm font-medium text-unbox-dark">Google Calendar подключён</span>
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Активен</span>
                    </div>
                    <button
                        onClick={() => navigate('/crm/sessions')}
                        className="text-xs text-unbox-green hover:underline"
                    >
                        Синхронизация →
                    </button>
                </div>
            )}

            {/* Upcoming Sessions */}
            <div className="bg-white rounded-2xl border border-unbox-light shadow-sm">
                <div className="flex items-center justify-between p-5 border-b border-unbox-light">
                    <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-unbox-grey" />
                        <h2 className="font-bold text-lg">Ближайшие сессии</h2>
                    </div>
                    <button
                        onClick={() => navigate('/crm/sessions')}
                        className="text-sm text-unbox-green hover:text-unbox-dark font-medium flex items-center gap-1"
                    >
                        Все сессии
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {!dashboard?.upcomingSessions?.length ? (
                    <div className="p-8 text-center text-unbox-grey">
                        <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="font-medium">Нет предстоящих сессий</p>
                        <p className="text-sm mt-1">На ближайшие 7 дней нет запланированных сессий</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {dashboard.upcomingSessions.map((s) => {
                            const dt = parseUTC(s.date);
                            return (
                                <div
                                    key={s.id}
                                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-unbox-light/30 transition-colors cursor-pointer"
                                    onClick={() => navigate(`/crm/sessions`)}
                                >
                                    <div className="w-12 text-center">
                                        <div className="text-xs text-unbox-grey uppercase">
                                            {format(dt, 'EEE', { locale: ru })}
                                        </div>
                                        <div className="text-lg font-bold text-unbox-dark">
                                            {format(dt, 'd')}
                                        </div>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-unbox-dark truncate">
                                            {s.clientName}
                                        </div>
                                        <div className="text-sm text-unbox-grey">
                                            {format(dt, 'HH:mm')}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {s.isBooked ? (
                                            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                                                Кабинет
                                            </span>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigate('/dashboard/bookings', {
                                                        state: {
                                                            crmMode: {
                                                                sessionId: s.id,
                                                                clientId: s.clientId,
                                                                clientName: s.clientName,
                                                                date: /Z$|[+-]\d{2}:\d{2}$/.test(s.date) ? s.date : s.date + 'Z',
                                                            },
                                                        },
                                                    });
                                                }}
                                                className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors cursor-pointer"
                                                title="Нажмите, чтобы забронировать кабинет"
                                            >
                                                Без кабинета
                                            </button>
                                        )}
                                        <span
                                            className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[s.status] || 'bg-unbox-light/50 text-unbox-grey'}`}
                                        >
                                            {STATUS_LABELS[s.status] || s.status}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                    onClick={() => navigate('/crm/clients')}
                    className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-unbox-light shadow-sm hover:shadow-md transition-all text-left group"
                >
                    <div className="w-10 h-10 rounded-xl bg-unbox-light text-unbox-green flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Users className="w-5 h-5" />
                    </div>
                    <div>
                        <div className="font-medium text-unbox-dark">Добавить клиента</div>
                        <div className="text-sm text-unbox-grey">Создать карточку нового клиента</div>
                    </div>
                </button>
                <button
                    onClick={() => navigate('/crm/sessions')}
                    className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-unbox-light shadow-sm hover:shadow-md transition-all text-left group"
                >
                    <div className="w-10 h-10 rounded-xl bg-unbox-light text-unbox-green flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Calendar className="w-5 h-5" />
                    </div>
                    <div>
                        <div className="font-medium text-unbox-dark">Запланировать сессию</div>
                        <div className="text-sm text-unbox-grey">Добавить новую сессию</div>
                    </div>
                </button>
                <button
                    onClick={() => navigate('/')}
                    className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-unbox-light shadow-sm hover:shadow-md transition-all text-left group"
                >
                    <div className="w-10 h-10 rounded-xl bg-unbox-dark/10 text-unbox-dark flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Clock className="w-5 h-5" />
                    </div>
                    <div>
                        <div className="font-medium text-unbox-dark">Забронировать кабинет</div>
                        <div className="text-sm text-unbox-grey">Перейти к бронированию</div>
                    </div>
                </button>
            </div>
        </div>
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
                        { label: 'Забронировать кабинет', sub: 'Unbox One · Uni · Neo', path: '/dashboard' },
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
