import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import {
    Users,
    Calendar,
    AlertCircle,
    TrendingUp,
    Clock,
    ChevronRight,
    Loader2,
    RefreshCw,
    Settings,
    Check,
    X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { crmApi, type CrmSyncResult } from '../../api/crm';
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
    const [calendarId, setCalendarId] = useState<string>('');
    const [calendarIdSaved, setCalendarIdSaved] = useState<string | null>(null);
    const [showCalendarSettings, setShowCalendarSettings] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<CrmSyncResult | null>(null);
    const [savingSettings, setSavingSettings] = useState(false);

    useEffect(() => {
        fetchDashboard();
        crmApi.getSettings().then((s) => {
            setCalendarIdSaved(s.calendarId);
            setCalendarId(s.calendarId ?? '');
        }).catch(() => {});
    }, [fetchDashboard]);

    const handleSaveCalendarId = async () => {
        setSavingSettings(true);
        try {
            await crmApi.updateSettings(calendarId || null);
            setCalendarIdSaved(calendarId || null);
            toast.success('Календарь сохранён');
            setShowCalendarSettings(false);
        } catch {
            toast.error('Ошибка сохранения');
        } finally {
            setSavingSettings(false);
        }
    };

    const handleSync = async () => {
        if (!calendarIdSaved) {
            setShowCalendarSettings(true);
            return;
        }
        setSyncing(true);
        setSyncResult(null);
        try {
            const result = await crmApi.syncFromCalendar(false);
            setSyncResult(result);
            if (result.created > 0) fetchDashboard();
            toast.success(`Синхронизировано: ${result.created} новых сессий`);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Ошибка синхронизации');
        } finally {
            setSyncing(false);
        }
    };

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
                    onClick={() => navigate('/crm/sessions')}
                />
                <StatCard
                    icon={TrendingUp}
                    label="Доход за месяц"
                    value={`${(dashboard?.revenueThisMonth ?? 0).toFixed(0)} ₾`}
                    color="emerald"
                    onClick={() => navigate('/crm/finances')}
                />
            </div>

            {/* Google Calendar Sync */}
            <div className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-unbox-grey" />
                        <h2 className="font-bold">Синхронизация с Google Calendar</h2>
                        {calendarIdSaved && (
                            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Настроен</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowCalendarSettings(!showCalendarSettings)}
                            className="p-1.5 hover:bg-unbox-light/50 rounded-lg text-unbox-grey transition-colors"
                            title="Настройки календаря"
                        >
                            <Settings className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className="flex items-center gap-2 px-3 py-1.5 bg-unbox-green text-white text-sm font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-60 transition-colors"
                        >
                            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                            Синхронизировать
                        </button>
                    </div>
                </div>

                {showCalendarSettings && (
                    <div className="mb-4 p-4 bg-unbox-light/30 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2">
                        <p className="text-sm text-unbox-grey">
                            Укажи ID своего Google Calendar. Найти можно в настройках календаря → «Интеграция с другими приложениями».
                            Сервис-аккаунт <code className="text-xs bg-white px-1 py-0.5 rounded">psycrm-bot@psycrm-calendar.iam.gserviceaccount.com</code> уже имеет доступ к твоему календарю.
                        </p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={calendarId}
                                onChange={(e) => setCalendarId(e.target.value)}
                                placeholder="koren.nikolas@gmail.com или ID@group.calendar.google.com"
                                className="flex-1 px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                            />
                            <button
                                onClick={handleSaveCalendarId}
                                disabled={savingSettings}
                                className="flex items-center gap-1 px-3 py-2 bg-unbox-green text-white text-sm rounded-xl hover:bg-unbox-dark disabled:opacity-60 transition-colors"
                            >
                                {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                Сохранить
                            </button>
                            <button
                                onClick={() => setShowCalendarSettings(false)}
                                className="p-2 hover:bg-unbox-light/50 rounded-xl text-unbox-grey"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {syncResult && (
                    <div className="p-3 bg-green-50 rounded-xl text-sm animate-in fade-in">
                        <div className="flex items-center gap-2 font-medium text-green-700 mb-1">
                            <Check className="w-4 h-4" /> Синхронизация завершена
                        </div>
                        <div className="text-green-600 space-y-0.5">
                            <div>Всего событий в календаре: <b>{syncResult.totalEvents}</b></div>
                            <div>Совпало с клиентами: <b>{syncResult.matched}</b></div>
                            <div>Создано новых сессий: <b>{syncResult.created}</b></div>
                            {syncResult.updated > 0 && <div>Обновлено (перенос): <b>{syncResult.updated}</b></div>}
                            {syncResult.unmatched > 0 && (
                                <div className="text-orange-600">
                                    Не распознано: <b>{syncResult.unmatched}</b>
                                    {syncResult.unmatchedSummaries.length > 0 && (
                                        <span className="ml-1 text-xs">({syncResult.unmatchedSummaries.slice(0, 3).join(', ')}…)</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {!calendarIdSaved && !showCalendarSettings && (
                    <p className="text-sm text-unbox-grey">
                        Настрой ID календаря чтобы импортировать сессии из Google Calendar.
                        <button onClick={() => setShowCalendarSettings(true)} className="ml-1 text-unbox-green hover:underline">
                            Настроить →
                        </button>
                    </p>
                )}
            </div>

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
    color,
    onClick,
}: {
    icon: React.ElementType;
    label: string;
    value: number | string;
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
            <div className="text-sm text-unbox-grey mt-0.5">{label}</div>
        </div>
    );
}
