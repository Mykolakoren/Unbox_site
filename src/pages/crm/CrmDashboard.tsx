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
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { crmApi } from '../../api/crm';
import { toast } from 'sonner';

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

    useEffect(() => {
        // Auto-complete past PLANNED sessions, then load dashboard
        crmApi.autoCompleteSessions().then((result) => {
            if (result.autoCompleted > 0) {
                toast.info(`${result.autoCompleted} ${result.autoCompleted === 1 ? 'сессия автозавершена' : 'сессий автозавершены'}`);
            }
        }).catch(() => {}).finally(() => {
            fetchDashboard();
        });
        crmApi.getSettings().then((s) => {
            setCalendarIdSaved(s.calendarId);
        }).catch(() => {});
    }, [fetchDashboard]);

    if (loading && !dashboard) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-unbox-grey" />
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h1 className="text-2xl font-bold mb-1">CRM Кабинет</h1>
                <p className="text-unbox-grey">Управление клиентами и сессиями</p>
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
                    icon={Wallet}
                    label="Средний чек"
                    value={`${(dashboard?.avgCheck ?? 0).toFixed(0)} ₾`}
                    color="blue"
                />
                <StatCard
                    icon={BarChart3}
                    label="Ставка / час"
                    value={`${(dashboard?.avgHourlyRate ?? 0).toFixed(0)} ₾`}
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
                                    {c.lastSessionDate ? `Последняя: ${format(parseISO(c.lastSessionDate), 'd MMM yyyy', { locale: ru })}` : 'Нет сессий'}
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
                            const dt = parseISO(s.date);
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
                                                                date: s.date,
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
