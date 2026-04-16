import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import {
    Calendar,
    Plus,
    Check,
    X,
    Loader2,
    Banknote,
    ChevronLeft,
    ChevronRight,
    Pencil,
    Trash2,
    ChevronDown,
    LayoutGrid,
    List,
    RefreshCw,
} from 'lucide-react';
import {
    format, parseISO, startOfMonth, endOfMonth, addMonths, subMonths, addDays,
    startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isToday as isTodayFn,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { AccountSelect } from '../../components/crm/AccountSelect';
import { toast } from 'sonner';
import { crmApi } from '../../api/crm';
import type { CrmSession, CrmSessionCreate, CrmSessionUpdate, CrmClient, CrmPayment } from '../../api/crm';
import { CrmChessboardView } from '../../components/crm/CrmChessboardView';
import { toGel } from '../../utils/currency';
import { parseUTC } from '../../utils/dateUtils';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

const STATUS_COLORS: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-700 border-blue-200',
    COMPLETED: 'bg-green-100 text-green-700 border-green-200',
    CANCELLED_CLIENT: 'bg-red-100 text-red-600 border-red-200',
    CANCELLED_THERAPIST: 'bg-orange-100 text-orange-700 border-orange-200',
};

const STATUS_LABELS: Record<string, string> = {
    PLANNED: 'Запланирована',
    COMPLETED: 'Завершена',
    CANCELLED_CLIENT: 'Отмена (клиент)',
    CANCELLED_THERAPIST: 'Отмена (терапевт)',
};

/** Parse session date — backend stores UTC naive datetimes */
function parseSessionDate(dateStr: string): Date {
    return parseUTC(dateStr);
}

/** Сессия уже прошла по времени */
function isPastSession(session: CrmSession): boolean {
    return parseSessionDate(session.date) < new Date();
}

/** Эффективный статус: PLANNED + в прошлом → COMPLETED */
function getEffectiveStatus(session: CrmSession): string {
    if (session.status === 'PLANNED' && isPastSession(session)) return 'COMPLETED';
    return session.status;
}

type ViewMode = 'list' | 'week' | 'chess';

export function CrmSessions() {
    const gridHouse = useDesignFlag();
    const navigate = useNavigate();
    const location = useLocation();
    const { sessions, clients, fetchSessions, fetchClients, createSession, updateSession, deleteSession, quickPaySession, loading } =
        useCrmStore();
    const [view, setView] = useState<ViewMode>('list');
    const [chessDate, setChessDate] = useState<Date | undefined>();
    // Default: show previous month with COMPLETED filter so history is visible on first open
    const [currentMonth, setCurrentMonth] = useState(() => new Date());
    const [weekAnchor, setWeekAnchor] = useState(new Date());
    const [statusFilter, setStatusFilter] = useState<string>(
        (location.state as any)?.statusFilter || 'COMPLETED'
    );
    const [showForm, setShowForm] = useState(false);
    const [prefillDate, setPrefillDate] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showSyncModal, setShowSyncModal] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncMonthsBack, setSyncMonthsBack] = useState(0); // 0 = current month only
    const [syncMonthsForward, setSyncMonthsForward] = useState(1);
    const [syncResult, setSyncResult] = useState<any>(null);

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
    const futureEnd = format(addDays(new Date(), 60), 'yyyy-MM-dd');
    // Always use full month range + extend to future for upcoming sessions
    const dateFrom = monthStart;
    const dateTo = monthEnd > futureEnd ? monthEnd : futureEnd;

    const handleBookCab = (session: CrmSession, clientName: string) => {
        navigate('/dashboard/bookings', {
            state: {
                crmMode: {
                    sessionId: session.id,
                    clientId: session.clientId,
                    clientName: clientName,
                    date: parseSessionDate(session.date).toISOString(),
                    duration: session.durationMinutes,
                },
                returnFilter: statusFilter,
            },
        });
    };

    // Local payments state for accurate revenue by real payment currency
    const [monthPayments, setMonthPayments] = useState<CrmPayment[]>([]);

    useEffect(() => {
        fetchClients();
    }, [fetchClients]);

    // Fetch ALL sessions for the period (no status filter on API), filter on frontend by effective status
    useEffect(() => {
        fetchSessions({
            dateFrom,
            dateTo,
        });
    }, [fetchSessions, dateFrom, dateTo]);

    // Fetch payments for the month independently (local state, no store collision)
    useEffect(() => {
        crmApi.getPayments({ dateFrom: monthStart, dateTo: monthEnd })
            .then(data => {
                // Extra safeguard: filter by date on frontend in case backend returns wider range
                const filtered = data.filter((p: CrmPayment) => {
                    const d = p.date?.slice(0, 10);
                    return d && d >= monthStart && d <= monthEnd;
                });
                setMonthPayments(filtered);
            })
            .catch(() => {});
    }, [monthStart, monthEnd]);

    const clientMap = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach((c) => map.set(c.id, c));
        return map;
    }, [clients]);

    // Filter sessions by effective status on frontend (handles PLANNED→COMPLETED auto-transition)
    const filteredSessions = useMemo(() => {
        if (statusFilter === 'all') return sessions;
        return sessions.filter(s => getEffectiveStatus(s) === statusFilter);
    }, [sessions, statusFilter]);

    // Upcoming groups: days >= today, sorted ascending
    const upcomingGroups = useMemo(() => {
        const groups: Record<string, typeof sessions> = {};
        filteredSessions.forEach((s) => {
            const day = format(parseSessionDate(s.date), 'yyyy-MM-dd');
            if (day >= todayStr) {
                if (!groups[day]) groups[day] = [];
                groups[day].push(s);
            }
        });
        const sorted = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
        return sorted;
    }, [filteredSessions, todayStr]);

    // Past groups: days < today within selected month
    const pastGroups = useMemo(() => {
        const groups: Record<string, typeof sessions> = {};
        filteredSessions.forEach((s) => {
            const day = format(parseSessionDate(s.date), 'yyyy-MM-dd');
            if (day < todayStr && day >= monthStart && day <= monthEnd) {
                if (!groups[day]) groups[day] = [];
                groups[day].push(s);
            }
        });
        return statusFilter === 'all'
            ? Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
            : Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
    }, [filteredSessions, todayStr, monthStart, monthEnd, statusFilter]);

    const stats = useMemo(() => {
        const monthSessions = sessions.filter((s) => {
            const day = format(parseSessionDate(s.date), 'yyyy-MM-dd');
            return day >= monthStart && day <= monthEnd;
        });

        // Planned = PLANNED sessions this month (not cancelled)
        const planned = monthSessions.filter((s) => {
            const eff = getEffectiveStatus(s);
            return eff === 'PLANNED';
        }).length;

        // Completed = effectively completed sessions
        const completed = monthSessions.filter((s) => getEffectiveStatus(s) === 'COMPLETED').length;

        // Unpaid = completed but not paid (only completed, not planned/cancelled)
        const unpaidSessions = monthSessions.filter((s) => {
            const eff = getEffectiveStatus(s);
            return eff === 'COMPLETED' && !s.isPaid;
        });
        const unpaidCount = unpaidSessions.length;

        // Debt by currency — sum prices of unpaid completed sessions
        const debtByCur: Record<string, number> = {};
        unpaidSessions.forEach(s => {
            const client = clientMap.get(s.clientId);
            const cur = client?.currency || 'GEL';
            const price = s.price ?? client?.basePrice ?? 0;
            if (price > 0) debtByCur[cur] = (debtByCur[cur] || 0) + price;
        });
        const debtEntries = Object.entries(debtByCur).filter(([, v]) => v > 0);
        const debtLabel = debtEntries.length > 0
            ? debtEntries.map(([cur, val]) => `${val.toFixed(0)} ${cur}`).join(' · ')
            : '';

        // Revenue grouped by currency — from real payments with actual currency
        const revByCur: Record<string, number> = {};
        monthPayments.forEach(p => {
            const cur = p.currency || 'GEL';
            revByCur[cur] = (revByCur[cur] || 0) + p.amount;
        });
        const entries = Object.entries(revByCur).filter(([, v]) => v > 0);
        const revenueLabel = entries.length > 0
            ? entries.map(([cur, val]) => `${val.toFixed(0)} ${cur}`).join(' · ')
            : '0';
        // GEL equivalent
        const gelTotal = entries.reduce((s, [cur, val]) => s + toGel(val, cur), 0);
        const revenueGel = entries.length > 1 ? `≈ ${gelTotal.toFixed(0)} ₾` : '';

        return { planned, completed, unpaidCount, debtLabel, revenueLabel, revenueGel };
    }, [sessions, monthPayments, monthStart, monthEnd, clientMap]);

    const handleSync = async (dryRun = false) => {
        setSyncing(true);
        setSyncResult(null);
        try {
            const result = await crmApi.syncFromCalendar(dryRun, syncMonthsBack, syncMonthsForward);
            setSyncResult(result);
            if (!dryRun) {
                toast.success(`Синхронизировано: ${result.created || 0} новых, ${result.updated || 0} обновлённых`);
                fetchSessions({ dateFrom, dateTo });
            }
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Ошибка синхронизации');
        } finally {
            setSyncing(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (gridHouse) return (
        <GridHouseCrmSessions
            view={view} setView={setView}
            currentMonth={currentMonth} setCurrentMonth={setCurrentMonth}
            weekAnchor={weekAnchor} setWeekAnchor={setWeekAnchor}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            showForm={showForm} setShowForm={setShowForm}
            prefillDate={prefillDate} setPrefillDate={setPrefillDate}
            editingId={editingId} setEditingId={setEditingId}
            showSyncModal={showSyncModal} setShowSyncModal={setShowSyncModal}
            syncing={syncing}
            syncMonthsBack={syncMonthsBack} setSyncMonthsBack={setSyncMonthsBack}
            syncMonthsForward={syncMonthsForward} setSyncMonthsForward={setSyncMonthsForward}
            syncResult={syncResult} handleSync={handleSync}
            stats={stats}
            upcomingGroups={upcomingGroups} pastGroups={pastGroups}
            sessions={sessions} clientMap={clientMap}
            clients={clients} loading={loading}
            createSession={createSession} updateSession={updateSession}
            deleteSession={deleteSession} quickPaySession={quickPaySession}
            handleBookCab={handleBookCab}
            chessDate={chessDate} setChessDate={setChessDate}
            navigate={navigate}
        />
    );

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Сессии</h1>
                    <p className="text-unbox-dark/60 text-sm">Управление расписанием и оплатой</p>
                </div>
                <div className="flex items-center gap-2">
                    {/* View toggle */}
                    <div className="flex gap-1 bg-white border border-unbox-light rounded-xl p-1 shadow-sm">
                        <button
                            onClick={() => setView('list')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'list' ? 'bg-unbox-green text-white' : 'text-unbox-grey hover:text-unbox-dark'}`}
                        >
                            <List className="w-3.5 h-3.5" />
                            Список
                        </button>
                        <button
                            onClick={() => setView('week')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'week' ? 'bg-unbox-green text-white' : 'text-unbox-grey hover:text-unbox-dark'}`}
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                            Неделя
                        </button>
                        <button
                            onClick={() => setView('chess')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'chess' ? 'bg-unbox-green text-white' : 'text-unbox-grey hover:text-unbox-dark'}`}
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="1" y="1" width="6" height="6" rx="1" />
                                <rect x="9" y="1" width="6" height="6" rx="1" />
                                <rect x="1" y="9" width="6" height="6" rx="1" />
                                <rect x="9" y="9" width="6" height="6" rx="1" />
                            </svg>
                            Шахматка
                        </button>
                    </div>
                    <button
                        onClick={() => setShowSyncModal(true)}
                        className="flex items-center gap-2 px-3 py-2.5 border border-unbox-light text-unbox-dark rounded-xl font-medium text-sm hover:bg-unbox-light/50 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        <span className="hidden sm:inline">Синхронизация</span>
                    </button>
                    <button
                        onClick={() => { setPrefillDate(null); setShowForm(true); }}
                        className="flex items-center gap-2 px-4 py-2.5 bg-unbox-green text-white rounded-xl font-medium text-sm hover:bg-unbox-dark transition-colors shadow-md"
                    >
                        <Plus className="w-4 h-4" />
                        Новая сессия
                    </button>
                </div>
            </div>

            {/* Navigation + Filters (List view only) */}
            {view === 'list' && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-2 bg-white rounded-xl border border-unbox-light px-1 py-1 shadow-sm">
                        <button
                            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                            className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="font-medium text-sm w-32 text-center capitalize">
                            {format(currentMonth, 'LLLL yyyy', { locale: ru })}
                        </span>
                        <button
                            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                            className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {['all', 'PLANNED', 'COMPLETED', 'CANCELLED_CLIENT'].map((s) => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                                    statusFilter === s
                                        ? 'bg-unbox-green text-white border-unbox-green'
                                        : 'bg-white text-unbox-grey border-unbox-light hover:bg-unbox-light/30'
                                }`}
                            >
                                {s === 'all' ? 'Все' : STATUS_LABELS[s]}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Week navigation (Week view only) */}
            {view === 'week' && (
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-white rounded-xl border border-unbox-light px-1 py-1 shadow-sm">
                        <button
                            onClick={() => setWeekAnchor(d => subWeeks(d, 1))}
                            className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="font-medium text-sm w-48 text-center">
                            {format(startOfWeek(weekAnchor, { weekStartsOn: 1 }), 'd MMM', { locale: ru })} –{' '}
                            {format(endOfWeek(weekAnchor, { weekStartsOn: 1 }), 'd MMM yyyy', { locale: ru })}
                        </span>
                        <button
                            onClick={() => setWeekAnchor(d => addWeeks(d, 1))}
                            className="p-2 hover:bg-unbox-light/50 rounded-lg transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    {!isTodayFn(weekAnchor) && (
                        <button
                            onClick={() => setWeekAnchor(new Date())}
                            className="px-3 py-2 text-xs text-unbox-grey bg-white border border-unbox-light rounded-xl hover:text-unbox-dark transition-colors shadow-sm"
                        >
                            Эта неделя
                        </button>
                    )}
                </div>
            )}

            {/* Stats (list view only) */}
            {view === 'list' && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <MiniStat label="Запланировано" value={stats.planned} />
                    <MiniStat label="Проведено" value={stats.completed} />
                    <MiniStat label="Не оплачено" value={stats.unpaidCount} color={stats.unpaidCount > 0 ? 'red' : undefined} subtitle={stats.debtLabel} />
                    <MiniStat label={stats.revenueGel ? `Получено (${stats.revenueGel})` : 'Получено'} value={stats.revenueLabel} color="green" className="sm:col-span-2" />
                </div>
            )}

            {/* New Session Form */}
            {showForm && (
                <SessionForm
                    clients={clients.filter((c) => c.isActive)}
                    prefillDate={prefillDate ?? undefined}
                    onSave={async (data) => {
                        await createSession(data);
                        setShowForm(false);
                        setPrefillDate(null);
                        toast.success('Сессия создана');
                    }}
                    onCancel={() => { setShowForm(false); setPrefillDate(null); }}
                />
            )}

            {/* Week Calendar View */}
            {view === 'week' && (
                <WeekCalendar
                    weekAnchor={weekAnchor}
                    sessions={sessions}
                    clientMap={clientMap}
                    navigate={navigate}
                    onAddSession={(dateStr) => {
                        setPrefillDate(dateStr);
                        setShowForm(true);
                    }}
                    onBookRoom={(d) => { setChessDate(new Date(d)); setView('chess'); }}
                    onBookCab={handleBookCab}
                    updateSession={updateSession}
                    quickPaySession={quickPaySession}
                />
            )}

            {/* Chessboard view */}
            {view === 'chess' && <CrmChessboardView initialDate={chessDate} />}

            {/* Sessions by Date (list view) */}
            {view === 'list' && (loading && !sessions.length ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-unbox-grey" />
                </div>
            ) : upcomingGroups.length === 0 && pastGroups.length === 0 ? (
                <div className="text-center py-12 text-unbox-grey">
                    <Calendar className="w-16 h-16 mx-auto mb-3 opacity-40" />
                    <p className="font-medium text-lg">Нет сессий</p>
                    <p className="text-sm mt-1">За выбранный период сессий не найдено</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Upcoming: today + next day */}
                    {upcomingGroups.length > 0 && (
                        <div className="space-y-6">
                            {statusFilter !== 'COMPLETED' && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-unbox-green bg-white/60 backdrop-blur-sm px-3 py-1 rounded-lg">Предстоящие</span>
                                    <div className="flex-1 h-px bg-unbox-green/30" />
                                </div>
                            )}
                            {upcomingGroups.map(([day, daySessions]) => (
                                <DayGroup key={day} day={day} daySessions={daySessions} clientMap={clientMap} editingId={editingId} setEditingId={setEditingId} updateSession={updateSession} deleteSession={deleteSession} quickPaySession={quickPaySession} onBookRoom={(d) => { setChessDate(new Date(d)); setView('chess'); }} onBookCab={handleBookCab} />
                            ))}
                        </div>
                    )}
                    {/* Past: days in selected month */}
                    {pastGroups.length > 0 && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-unbox-dark/70 bg-white/60 backdrop-blur-sm px-3 py-1 rounded-lg">История</span>
                                <div className="flex-1 h-px bg-unbox-dark/15" />
                            </div>
                            {pastGroups.map(([day, daySessions]) => (
                                <DayGroup key={day} day={day} daySessions={daySessions} clientMap={clientMap} editingId={editingId} setEditingId={setEditingId} updateSession={updateSession} deleteSession={deleteSession} quickPaySession={quickPaySession} onBookRoom={(d) => { setChessDate(new Date(d)); setView('chess'); }} onBookCab={handleBookCab} />
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {/* Sync Modal */}
            {showSyncModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowSyncModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <div className="p-6 space-y-5">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-unbox-dark flex items-center gap-2">
                                    <RefreshCw className="w-5 h-5 text-unbox-green" />
                                    Синхронизация с Google Calendar
                                </h3>
                                <button onClick={() => setShowSyncModal(false)} className="text-gray-400 hover:text-gray-600">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Период назад (месяцев)</label>
                                    <select
                                        value={syncMonthsBack}
                                        onChange={e => setSyncMonthsBack(Number(e.target.value))}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                    >
                                        <option value={0}>Только текущий месяц</option>
                                        <option value={1}>1 месяц назад</option>
                                        <option value={3}>3 месяца назад</option>
                                        <option value={6}>6 месяцев назад</option>
                                        <option value={12}>1 год назад</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Период вперёд (месяцев)</label>
                                    <select
                                        value={syncMonthsForward}
                                        onChange={e => setSyncMonthsForward(Number(e.target.value))}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                    >
                                        <option value={1}>1 месяц вперёд</option>
                                        <option value={2}>2 месяца вперёд</option>
                                        <option value={3}>3 месяца вперёд</option>
                                        <option value={6}>6 месяцев вперёд</option>
                                    </select>
                                </div>
                            </div>

                            {syncResult && (
                                <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                                    <div className="font-medium text-unbox-dark mb-2">Результат:</div>
                                    <div className="flex justify-between"><span className="text-gray-500">Всего событий</span><span className="font-medium">{syncResult.totalEvents ?? 0}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Сопоставлено</span><span className="font-medium">{syncResult.matched ?? 0}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Создано новых</span><span className="font-medium text-green-600">{syncResult.created ?? 0}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Обновлено</span><span className="font-medium">{syncResult.updated ?? 0}</span></div>
                                    {(syncResult.autoCreatedClients ?? 0) > 0 && (
                                        <div className="flex justify-between"><span className="text-gray-500">Новых клиентов</span><span className="font-medium text-blue-600">{syncResult.autoCreatedClients}</span></div>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={() => handleSync(true)}
                                    disabled={syncing}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-unbox-light text-unbox-dark rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                                >
                                    {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    Предпросмотр
                                </button>
                                <button
                                    onClick={() => handleSync(false)}
                                    disabled={syncing}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-unbox-green text-white rounded-xl text-sm font-medium hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                                >
                                    {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                    Синхронизировать
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Week Calendar View ────────────────────────────────────────────────────────

function WeekCalendar({
    weekAnchor,
    sessions,
    clientMap,
    navigate,
    onAddSession,
    onBookRoom,
    onBookCab,
    updateSession,
    quickPaySession,
}: {
    weekAnchor: Date;
    sessions: CrmSession[];
    clientMap: Map<string, CrmClient>;
    navigate: ReturnType<typeof useNavigate>;
    onAddSession: (dateStr: string) => void;
    onBookRoom: (dateStr: string) => void;
    onBookCab: (session: CrmSession, clientName: string) => void;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string }>;
}) {
    const weekStart = startOfWeek(weekAnchor, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(weekAnchor, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
    const [editingId, setEditingId] = useState<string | null>(null);

    return (
        <div className="space-y-2">
            {days.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const daySessions = sessions.filter(s => {
                    const sDay = format(parseSessionDate(s.date), 'yyyy-MM-dd');
                    return sDay === dayStr;
                }).sort((a, b) => a.date.localeCompare(b.date));

                const today = isTodayFn(day);
                const past = day < new Date() && !today;

                return (
                    <div key={dayStr} className={`bg-white/70 rounded-2xl border overflow-hidden ${today ? 'border-unbox-green/40' : 'border-white/80'}`}>
                        {/* Day header */}
                        <div className={`flex items-center justify-between px-4 py-2.5 ${today ? 'bg-unbox-green/5' : past ? 'bg-gray-50/60' : 'bg-white/50'}`}>
                            <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold capitalize ${today ? 'text-unbox-green' : past ? 'text-unbox-grey' : 'text-unbox-dark'}`}>
                                    {format(day, 'EEEE', { locale: ru })}
                                </span>
                                <span className={`text-xs ${today ? 'text-unbox-green font-medium' : 'text-unbox-grey'}`}>
                                    {format(day, 'd MMMM', { locale: ru })}
                                    {today && ' · Сегодня'}
                                </span>
                                {daySessions.length > 0 && (
                                    <span className="text-xs bg-unbox-green/10 text-unbox-green px-1.5 py-0.5 rounded-md font-medium">
                                        {daySessions.length} сессий
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => onBookRoom(dayStr)}
                                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-unbox-light bg-white hover:bg-unbox-light/40 text-unbox-grey hover:text-unbox-dark transition-colors"
                                >
                                    <LayoutGrid className="w-3 h-3" />
                                    Кабинеты
                                </button>
                                <button
                                    onClick={() => onAddSession(format(day, "yyyy-MM-dd'T'10:00"))}
                                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-unbox-green/30 bg-unbox-green/5 text-unbox-green hover:bg-unbox-green/10 transition-colors"
                                >
                                    <Plus className="w-3 h-3" />
                                    Сессия
                                </button>
                            </div>
                        </div>

                        {/* Sessions */}
                        {daySessions.length > 0 ? (
                            <div className="divide-y divide-unbox-light/50">
                                {daySessions.map(session => {
                                    const client = clientMap.get(session.clientId);
                                    const dt = parseSessionDate(session.date);
                                    const isEditing = editingId === session.id;
                                    const effectiveStatus = getEffectiveStatus(session);
                                    const isCancelled = effectiveStatus === 'CANCELLED_CLIENT' || effectiveStatus === 'CANCELLED_THERAPIST';
                                    return (
                                        <div key={session.id}>
                                            <div className="flex items-center gap-3 px-4 py-2.5">
                                                <div className="text-sm font-bold text-unbox-dark w-12 shrink-0">{format(dt, 'HH:mm')}</div>
                                                <div className="w-0.5 h-8 rounded-full shrink-0" style={{
                                                    background: effectiveStatus === 'COMPLETED' ? '#22c55e' : effectiveStatus.startsWith('CANCELLED') ? '#f97316' : '#476D6B',
                                                }} />
                                                <div className="flex-1 min-w-0">
                                                    <div
                                                        className="text-sm font-medium text-unbox-dark hover:text-unbox-green cursor-pointer transition-colors"
                                                        onClick={(e) => { e.stopPropagation(); if (session.clientId) navigate(`/crm/clients/${session.clientId}`); }}
                                                    >{client?.name || 'Клиент'}</div>
                                                    <div className="text-xs text-unbox-grey">{session.durationMinutes} мин · {STATUS_LABELS[effectiveStatus]}</div>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {session.isBooked ? (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">Каб ✓</span>
                                                    ) : !isCancelled && (
                                                        <button
                                                            onClick={() => onBookCab?.(session, client?.name || 'Клиент')}
                                                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-colors"
                                                        >+Каб</button>
                                                    )}
                                                    <div className="font-semibold text-xs text-unbox-dark">{session.price ?? client?.basePrice ?? '—'} ₾</div>
                                                    {!session.isPaid && !isCancelled && (
                                                        <button
                                                            onClick={async () => {
                                                                try { await quickPaySession(session.id); toast.success('Оплачено'); } catch { toast.error('Ошибка'); }
                                                            }}
                                                            className="p-1 bg-green-50 hover:bg-green-100 text-green-600 rounded-lg transition-colors"
                                                            title="Быстрая оплата"
                                                        >
                                                            <Banknote className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <button onClick={() => setEditingId(isEditing ? null : session.id)} className="p-1 hover:bg-unbox-light/50 text-unbox-grey hover:text-unbox-green rounded-lg transition-colors">
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                            {isEditing && (
                                                <SessionEditPanel
                                                    session={session}
                                                    clientCurrency={client?.currency}
                                                    clientDefaultAccount={client?.defaultAccount}
                                                    onSave={async (data) => { await updateSession(session.id, data); setEditingId(null); toast.success('Сессия обновлена'); }}
                                                    onQuickPay={async (acc) => { await quickPaySession(session.id, acc); toast.success('Оплачено'); }}
                                                    onCancel={() => setEditingId(null)}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="px-4 py-3 text-xs text-unbox-grey/60 italic">Нет сессий</div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ── Day Group ─────────────────────────────────────────────────────────────────

function DayGroup({
    day,
    daySessions,
    clientMap,
    editingId,
    setEditingId,
    updateSession,
    deleteSession,
    quickPaySession,
    onBookRoom,
    onBookCab,
}: {
    day: string;
    daySessions: CrmSession[];
    clientMap: Map<string, CrmClient>;
    editingId: string | null;
    setEditingId: (id: string | null) => void;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string) => Promise<void>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string }>;
    onBookRoom?: (day: string) => void;
    onBookCab?: (session: CrmSession, clientName: string) => void;
}) {
    const navigate = useNavigate();
    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-unbox-dark capitalize bg-white/80 backdrop-blur-sm px-3 py-1 rounded-lg shadow-sm">
                    {format(parseISO(day), 'EEEE, d MMMM', { locale: ru })}
                </div>
                {onBookRoom && (
                    <button
                        onClick={() => onBookRoom(day)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-unbox-light bg-white hover:bg-unbox-light/40 text-unbox-grey hover:text-unbox-dark transition-colors"
                    >
                        <Calendar className="w-3.5 h-3.5" />
                        Забронировать кабинет
                    </button>
                )}
            </div>
            <div className="space-y-2">
                {daySessions
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((session) => {
                        const client = clientMap.get(session.clientId);
                        const dt = parseSessionDate(session.date);
                        const isEditing = editingId === session.id;
                        const effectiveStatus = getEffectiveStatus(session);
                        const isCancelled = effectiveStatus === 'CANCELLED_CLIENT' || effectiveStatus === 'CANCELLED_THERAPIST';
                        return (
                            <div key={session.id} className="space-y-0">
                                <div
                                    className={`glass-card rounded-xl p-4 flex items-center gap-4 transition-all cursor-pointer ${
                                        isEditing
                                            ? 'border-unbox-green rounded-b-none ring-1 ring-unbox-green/20'
                                            : !session.isPaid && !isCancelled
                                            ? 'border-orange-200/80'
                                            : ''
                                    }`}
                                >
                                    <div className="w-14 text-center shrink-0">
                                        <div className="text-lg font-bold text-unbox-dark">{format(dt, 'HH:mm')}</div>
                                        <div className="text-xs text-unbox-grey">{session.durationMinutes} мин</div>
                                    </div>
                                    <div className="w-px h-10 bg-unbox-light shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div
                                            className="font-medium text-unbox-dark truncate hover:text-unbox-green cursor-pointer transition-colors"
                                            onClick={(e) => { e.stopPropagation(); if (session.clientId) navigate(`/crm/clients/${session.clientId}`); }}
                                        >
                                            {client?.name || 'Неизвестный клиент'}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            <StatusBadgeDropdown
                                                session={session}
                                                onUpdate={async (status) => {
                                                    await updateSession(session.id, { status });
                                                    toast.success('Статус обновлён');
                                                }}
                                            />
                                            {session.isBooked ? (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">
                                                    Кабинет ✓
                                                </span>
                                            ) : !isCancelled && (
                                                <button
                                                    onClick={() => onBookCab?.(session, client?.name || 'Клиент')}
                                                    className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-colors"
                                                >
                                                    + Кабинет
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0 flex items-center gap-2">
                                        <div>
                                            <div className="font-semibold text-unbox-dark">
                                                {session.price ?? client?.basePrice ?? '—'} {client?.currency || '₾'}
                                            </div>
                                            {session.isPaid ? (
                                                <span className="text-xs text-green-600">Оплачено</span>
                                            ) : (
                                                <span className="text-xs text-orange-500">Не оплачено</span>
                                            )}
                                        </div>
                                        {!session.isPaid && !isCancelled && (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const result = await quickPaySession(session.id);
                                                        toast.success(`Оплачено: ${result.amount} ${result.currency}`);
                                                    } catch (e: any) {
                                                        toast.error(e.message || 'Ошибка');
                                                    }
                                                }}
                                                className="p-2 bg-green-50 hover:bg-green-100 text-green-600 rounded-lg transition-colors"
                                                title="Быстрая оплата"
                                            >
                                                <Banknote className="w-4 h-4" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setEditingId(isEditing ? null : session.id)}
                                            className={`p-2 rounded-lg transition-colors ${
                                                isEditing
                                                    ? 'bg-unbox-light text-unbox-green'
                                                    : 'hover:bg-unbox-light/50 text-unbox-grey hover:text-unbox-green'
                                            }`}
                                            title="Редактировать"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (!confirm('Удалить сессию?')) return;
                                                try {
                                                    await deleteSession(session.id);
                                                    toast.success('Сессия удалена');
                                                } catch (e: any) {
                                                    toast.error(e.message || 'Ошибка');
                                                }
                                            }}
                                            className="p-2 hover:bg-red-50 text-unbox-grey hover:text-red-500 rounded-lg transition-colors"
                                            title="Удалить"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                {isEditing && (
                                    <SessionEditPanel
                                        session={session}
                                        clientCurrency={client?.currency}
                                        clientDefaultAccount={client?.defaultAccount}
                                        onSave={async (data) => {
                                            await updateSession(session.id, data);
                                            setEditingId(null);
                                            toast.success('Сессия обновлена');
                                        }}
                                        onQuickPay={async (acc) => { await quickPaySession(session.id, acc); toast.success('Оплачено'); }}
                                        onCancel={() => setEditingId(null)}
                                    />
                                )}
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}

// ── Status Badge Dropdown ─────────────────────────────────────────────────────

function StatusBadgeDropdown({
    session,
    onUpdate,
}: {
    session: CrmSession;
    onUpdate: (status: string) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const effectiveStatus = getEffectiveStatus(session);
    const past = isPastSession(session);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const options = past
        ? ['COMPLETED', 'CANCELLED_CLIENT', 'CANCELLED_THERAPIST']
        : ['PLANNED', 'COMPLETED', 'CANCELLED_CLIENT', 'CANCELLED_THERAPIST'];

    const handleSelect = async (status: string) => {
        setOpen(false);
        if (status === effectiveStatus && !(session.status === 'PLANNED' && status === 'COMPLETED')) return;
        setSaving(true);
        try {
            await onUpdate(status);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                disabled={saving}
                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    STATUS_COLORS[effectiveStatus] || 'bg-unbox-light/50'
                } ${past ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            >
                {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                    STATUS_LABELS[effectiveStatus] || effectiveStatus
                )}
                {past && <ChevronDown className="w-3 h-3 opacity-60" />}
            </button>
            {open && (
                <div className="absolute left-0 top-full mt-1 z-10 bg-white border border-unbox-light rounded-xl shadow-lg py-1 min-w-[160px]">
                    {options.map((s) => (
                        <button
                            key={s}
                            onClick={() => handleSelect(s)}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-unbox-light/40 transition-colors flex items-center gap-2 ${
                                s === effectiveStatus ? 'font-medium' : ''
                            }`}
                        >
                            <span
                                className={`w-2 h-2 rounded-full ${
                                    s === 'COMPLETED'
                                        ? 'bg-green-500'
                                        : s === 'CANCELLED_CLIENT'
                                        ? 'bg-red-500'
                                        : s === 'CANCELLED_THERAPIST'
                                        ? 'bg-orange-500'
                                        : 'bg-blue-500'
                                }`}
                            />
                            {STATUS_LABELS[s]}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Mini Stat ────────────────────────────────────────────────────────────────

function MiniStat({ label, value, color, subtitle, className }: { label: string; value: number | string; color?: string; subtitle?: string; className?: string }) {
    const textColor = color === 'red' ? 'text-red-600' : color === 'green' ? 'text-green-600' : 'text-unbox-dark';
    const accentClass = color === 'red' ? 'stat-accent-red' : color === 'green' ? 'stat-accent-green' : 'stat-accent';
    return (
        <div className={`glass-card rounded-xl p-4 ${accentClass} ${className || ''}`}>
            <div className={`text-2xl font-bold tracking-tight ${textColor}`}>{value}</div>
            <div className="text-xs text-unbox-grey mt-0.5 font-medium">{label}</div>
            {subtitle && <div className={`text-[11px] mt-1 font-medium ${textColor} opacity-70`}>{subtitle}</div>}
        </div>
    );
}

// ── Session Edit Panel ────────────────────────────────────────────────────────

function SessionEditPanel({
    session,
    clientCurrency,
    clientDefaultAccount,
    onSave,
    onQuickPay,
    onCancel,
}: {
    session: import('../../api/crm').CrmSession;
    clientCurrency?: string;
    clientDefaultAccount?: string;
    onSave: (data: CrmSessionUpdate) => Promise<void>;
    onQuickPay?: (account: string) => Promise<void>;
    onCancel: () => void;
}) {
    const clients = useCrmStore(s => s.clients);
    const [date, setDate] = useState(format(parseSessionDate(session.date), "yyyy-MM-dd'T'HH:mm"));
    const [duration, setDuration] = useState(String(session.durationMinutes));
    const [status, setStatus] = useState(getEffectiveStatus(session));
    const [price, setPrice] = useState(String(session.price ?? ''));
    const [clientId, setClientId] = useState(session.clientId);
    const [isPaid, setIsPaid] = useState(session.isPaid);
    const [account, setAccount] = useState(clientDefaultAccount || 'cash');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            // If marking as paid and it wasn't paid before, use quickPay with account
            const updateData: CrmSessionUpdate = {
                date: new Date(date).toISOString(),
                durationMinutes: Number(duration),
                status,
                price: price ? Number(price) : undefined,
            };
            if (clientId !== session.clientId) {
                updateData.clientId = clientId;
            }
            if (isPaid && !session.isPaid && onQuickPay) {
                await onSave(updateData);
                await onQuickPay(account);
            } else {
                updateData.isPaid = isPaid;
                await onSave(updateData);
            }
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="bg-unbox-light/40 border border-unbox-green border-t-0 rounded-b-xl px-4 py-3 space-y-3 animate-in fade-in slide-in-from-top-1"
        >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Дата и время</label>
                    <input
                        type="datetime-local"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Длительность</label>
                    <select
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    >
                        <option value="30">30 мин</option>
                        <option value="45">45 мин</option>
                        <option value="50">50 мин</option>
                        <option value="60">60 мин</option>
                        <option value="90">90 мин</option>
                        <option value="120">2 часа</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Статус</label>
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as typeof status)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    >
                        <option value="PLANNED">Запланирована</option>
                        <option value="COMPLETED">Завершена</option>
                        <option value="CANCELLED_CLIENT">Отмена (клиент)</option>
                        <option value="CANCELLED_THERAPIST">Отмена (терапевт)</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">
                        Цена {clientCurrency ? `(${clientCurrency})` : ''}
                    </label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    />
                </div>
            </div>

            {/* Client selector */}
            {clients && clients.length > 0 && (
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Клиент</label>
                    <select
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white max-w-xs"
                    >
                        {clients.map(c => (
                            <option key={c.id} value={c.id}>{c.name}{c.aliasCode ? ` #${c.aliasCode}` : ''}</option>
                        ))}
                    </select>
                    {clientId !== session.clientId && (
                        <p className="text-[10px] text-orange-500 mt-0.5">Клиент будет изменён</p>
                    )}
                </div>
            )}

            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-unbox-dark cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isPaid}
                            onChange={(e) => setIsPaid(e.target.checked)}
                            className="rounded"
                        />
                        Оплачено
                    </label>
                    {isPaid && !session.isPaid && (
                        <AccountSelect
                            value={account}
                            onChange={setAccount}
                            className="px-2 py-1 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                        />
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-3 py-1.5 text-xs text-unbox-grey hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        Отмена
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-unbox-green text-white text-xs font-medium rounded-lg hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                    >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Сохранить
                    </button>
                </div>
            </div>
        </form>
    );
}

// ── Session Form ─────────────────────────────────────────────────────────────

function SessionForm({
    clients,
    onSave,
    onCancel,
    prefillDate,
}: {
    clients: CrmClient[];
    onSave: (data: CrmSessionCreate) => Promise<void>;
    onCancel: () => void;
    prefillDate?: string;
}) {
    const [clientId, setClientId] = useState('');
    const [date, setDate] = useState(prefillDate ?? format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    const [duration, setDuration] = useState('60');
    const [price, setPrice] = useState('');
    const [saving, setSaving] = useState(false);

    const selectedClient = clients.find((c) => c.id === clientId);

    useEffect(() => {
        if (selectedClient) {
            setPrice(String(selectedClient.basePrice));
        }
    }, [selectedClient]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clientId) return;
        setSaving(true);
        try {
            await onSave({
                clientId,
                date: new Date(date).toISOString(),
                durationMinutes: Number(duration),
                price: price ? Number(price) : undefined,
            });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5 space-y-4 animate-in fade-in slide-in-from-top-2"
        >
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Новая сессия</h3>
                <button type="button" onClick={onCancel} className="p-1 hover:bg-unbox-light/50 rounded-lg">
                    <X className="w-5 h-5 text-unbox-grey" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Клиент <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        required
                    >
                        <option value="">Выберите клиента</option>
                        {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name} {c.aliasCode ? `#${c.aliasCode}` : ''}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Дата и время <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="datetime-local"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        required
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Длительность (мин)</label>
                    <select
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    >
                        <option value="30">30 минут</option>
                        <option value="45">45 минут</option>
                        <option value="50">50 минут</option>
                        <option value="60">60 минут</option>
                        <option value="90">90 минут</option>
                        <option value="120">2 часа</option>
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Стоимость {selectedClient && `(${selectedClient.currency})`}
                    </label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder={selectedClient ? String(selectedClient.basePrice) : '0'}
                    />
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-sm text-unbox-grey hover:bg-unbox-light/50 rounded-xl transition-colors"
                >
                    Отмена
                </button>
                <button
                    type="submit"
                    disabled={saving || !clientId}
                    className="flex items-center gap-2 px-5 py-2 bg-unbox-green text-white text-sm font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Создать
                </button>
            </div>
        </form>
    );
}

// ─── Grid House: CrmSessions ─────────────────────────────────────────────────

interface GHSessionsProps {
    view: ViewMode; setView: (v: ViewMode) => void;
    currentMonth: Date; setCurrentMonth: (d: Date) => void;
    weekAnchor: Date; setWeekAnchor: React.Dispatch<React.SetStateAction<Date>>;
    statusFilter: string; setStatusFilter: (s: string) => void;
    showForm: boolean; setShowForm: (v: boolean) => void;
    prefillDate: string | null; setPrefillDate: (d: string | null) => void;
    editingId: string | null; setEditingId: (id: string | null) => void;
    showSyncModal: boolean; setShowSyncModal: (v: boolean) => void;
    syncing: boolean;
    syncMonthsBack: number; setSyncMonthsBack: (v: number) => void;
    syncMonthsForward: number; setSyncMonthsForward: (v: number) => void;
    syncResult: any; handleSync: (dryRun?: boolean) => Promise<void>;
    stats: { planned: number; completed: number; unpaidCount: number; debtLabel: string; revenueLabel: string; revenueGel: string };
    upcomingGroups: [string, CrmSession[]][];
    pastGroups: [string, CrmSession[]][];
    sessions: CrmSession[];
    clientMap: Map<string, CrmClient>;
    clients: CrmClient[];
    loading: boolean;
    createSession: (data: CrmSessionCreate) => Promise<any>;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string) => Promise<void>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string }>;
    handleBookCab: (session: CrmSession, clientName: string) => void;
    chessDate: Date | undefined; setChessDate: (d: Date | undefined) => void;
    navigate: ReturnType<typeof useNavigate>;
}

const ghsMono = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: GH.ink60 };
const ghsHairline = `1px solid ${GH.ink10}`;

function useGHNarrow(bp = 768) {
    const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth < bp);
    useEffect(() => { const h = () => setN(window.innerWidth < bp); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [bp]);
    return n;
}

function GridHouseCrmSessions(p: GHSessionsProps) {
    const ghNarrow = useGHNarrow();
    const VIEW_MODES: { key: ViewMode; label: string }[] = [
        { key: 'list', label: 'Список' },
        { key: 'week', label: 'Неделя' },
        { key: 'chess', label: 'Шахматка' },
    ];

    const STATUS_TABS: { key: string; label: string }[] = [
        { key: 'all', label: 'Все' },
        { key: 'PLANNED', label: 'Запланированы' },
        { key: 'COMPLETED', label: 'Завершены' },
        { key: 'CANCELLED_CLIENT', label: 'Отменены' },
    ];

    const allRows = [...p.upcomingGroups, ...p.pastGroups];

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper, minHeight: '100vh', overflowX: 'hidden' }}>
            {/* ── Head ── */}
            <div style={{ padding: '48px clamp(16px, 4vw, 32px) 0' }}>
                <div style={ghsMono}>CRM · Сессии</div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
                    <h1 style={{ fontFamily: GH_SANS, fontSize: 'clamp(36px, 4.5vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, margin: 0 }}>
                        Сессии.
                    </h1>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                            onClick={() => p.setShowSyncModal(true)}
                            style={{ ...ghsMono, padding: '10px 16px', background: 'transparent', border: ghsHairline, cursor: 'pointer', color: GH.ink60 }}
                        >
                            Синхронизация
                        </button>
                        <button
                            onClick={() => { p.setPrefillDate(null); p.setShowForm(true); }}
                            style={{ fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, padding: '10px 20px', background: GH.ink, color: GH.paper, border: 'none', cursor: 'pointer' }}
                        >
                            + Новая сессия
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Anchor KPI + secondary ── */}
            <div style={{
                display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                padding: '24px clamp(16px, 4vw, 32px) 24px', flexWrap: 'wrap', gap: 16,
            }}>
                <div>
                    <div style={{ fontSize: 'clamp(48px, 5vw, 72px)', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                        {p.stats.completed}
                    </div>
                    <div style={{ ...ghsMono, marginTop: 4 }}>
                        завершено · {format(p.currentMonth, 'LLLL', { locale: ru })}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%', minWidth: 0 }}>
                    {[
                        { label: 'Запланировано', value: String(p.stats.planned), color: undefined as string | undefined, sub: undefined as string | undefined, multiline: false },
                        { label: 'Не оплачено', value: String(p.stats.unpaidCount), color: p.stats.unpaidCount > 0 ? GH.danger : undefined, sub: p.stats.debtLabel, multiline: false },
                        { label: 'Получено', value: p.stats.revenueLabel, color: GH.accent, sub: p.stats.revenueGel, multiline: true },
                    ].map(kpi => (
                        <div key={kpi.label} style={{ textAlign: 'right' as const, minWidth: 0, maxWidth: '100%' }}>
                            <div style={{
                                fontSize: kpi.multiline && ghNarrow ? 14 : 18,
                                fontWeight: 700,
                                fontVariantNumeric: 'tabular-nums',
                                color: kpi.color || GH.ink,
                                // On narrow screens let the multi-currency label wrap each currency to its own line
                                whiteSpace: kpi.multiline && ghNarrow ? ('pre-line' as const) : ('normal' as const),
                                wordBreak: 'break-word' as const,
                                lineHeight: 1.25,
                            }}>
                                {kpi.multiline && ghNarrow ? kpi.value.split(' · ').join('\n') : kpi.value}
                            </div>
                            <div style={{ ...ghsMono, fontSize: 9 }}>{kpi.label}</div>
                            {kpi.sub && <div style={{ ...ghsMono, fontSize: 9, color: kpi.color || GH.ink30 }}>{kpi.sub}</div>}
                        </div>
                    ))}
                </div>
            </div>

            {/* ── View mode tabs ── */}
            <div style={{ display: 'flex', margin: '0 clamp(16px, 4vw, 32px)', borderBottom: `2px solid ${GH.ink}` }}>
                {VIEW_MODES.map(v => (
                    <button
                        key={v.key}
                        onClick={() => p.setView(v.key)}
                        style={{
                            fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                            padding: '10px 20px',
                            background: p.view === v.key ? GH.ink : 'transparent',
                            color: p.view === v.key ? GH.paper : GH.ink60,
                            border: 'none', cursor: 'pointer',
                            marginBottom: -2,
                            borderBottom: p.view === v.key ? `2px solid ${GH.ink}` : '2px solid transparent',
                            transition: 'all 120ms',
                        }}
                    >
                        {v.label}
                    </button>
                ))}
            </div>

            {/* ── Content ── */}
            <div style={{ padding: '0 clamp(16px, 4vw, 32px) 64px' }}>
                {/* Legacy session form */}
                {p.showForm && (
                    <div style={{ marginTop: 24 }}>
                        <SessionForm
                            clients={p.clients.filter(c => c.isActive)}
                            prefillDate={p.prefillDate ?? undefined}
                            onSave={async (data) => {
                                await p.createSession(data);
                                p.setShowForm(false);
                                p.setPrefillDate(null);
                                toast.success('Сессия создана');
                            }}
                            onCancel={() => { p.setShowForm(false); p.setPrefillDate(null); }}
                        />
                    </div>
                )}

                {p.view === 'chess' ? (
                    <div style={{ marginTop: 24 }}><CrmChessboardView initialDate={p.chessDate} /></div>
                ) : p.view === 'week' ? (
                    <div style={{ marginTop: 24 }}>
                        {/* Week nav */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                            <button onClick={() => p.setWeekAnchor(d => subWeeks(d, 1))}
                                style={{ ...ghsMono, padding: '8px 12px', background: 'transparent', border: ghsHairline, cursor: 'pointer' }}>
                                &larr;
                            </button>
                            <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.08em' }}>
                                {format(startOfWeek(p.weekAnchor, { weekStartsOn: 1 }), 'd MMM', { locale: ru })} &ndash;{' '}
                                {format(endOfWeek(p.weekAnchor, { weekStartsOn: 1 }), 'd MMM yyyy', { locale: ru })}
                            </span>
                            <button onClick={() => p.setWeekAnchor(d => addWeeks(d, 1))}
                                style={{ ...ghsMono, padding: '8px 12px', background: 'transparent', border: ghsHairline, cursor: 'pointer' }}>
                                &rarr;
                            </button>
                            {!isTodayFn(p.weekAnchor) && (
                                <button onClick={() => p.setWeekAnchor(new Date())}
                                    style={{ ...ghsMono, padding: '8px 12px', background: GH.ink, color: GH.paper, border: 'none', cursor: 'pointer' }}>
                                    Сейчас
                                </button>
                            )}
                        </div>
                        <WeekCalendar
                            weekAnchor={p.weekAnchor} sessions={p.sessions} clientMap={p.clientMap}
                            navigate={p.navigate}
                            onAddSession={(d) => { p.setPrefillDate(d); p.setShowForm(true); }}
                            onBookRoom={(d) => { p.setChessDate(new Date(d)); p.setView('chess'); }}
                            onBookCab={p.handleBookCab}
                            updateSession={p.updateSession} quickPaySession={p.quickPaySession}
                        />
                    </div>
                ) : (
                    <>
                        {/* Month nav + status filters */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 24, paddingBottom: 12, borderBottom: ghsHairline }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button onClick={() => p.setCurrentMonth(subMonths(p.currentMonth, 1))}
                                    style={{ ...ghsMono, padding: '6px 10px', background: 'transparent', border: ghsHairline, cursor: 'pointer' }}>
                                    &larr;
                                </button>
                                <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.08em', textTransform: 'capitalize', minWidth: 120, textAlign: 'center' as const }}>
                                    {format(p.currentMonth, 'LLLL yyyy', { locale: ru })}
                                </span>
                                <button onClick={() => p.setCurrentMonth(addMonths(p.currentMonth, 1))}
                                    style={{ ...ghsMono, padding: '6px 10px', background: 'transparent', border: ghsHairline, cursor: 'pointer' }}>
                                    &rarr;
                                </button>
                            </div>
                            <div style={{ display: 'flex', gap: 0 }}>
                                {STATUS_TABS.map(s => (
                                    <button
                                        key={s.key}
                                        onClick={() => p.setStatusFilter(s.key)}
                                        style={{
                                            fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                                            padding: '8px 14px', background: 'transparent',
                                            color: p.statusFilter === s.key ? GH.ink : GH.ink60,
                                            border: 'none',
                                            borderBottom: p.statusFilter === s.key ? `2px solid ${GH.ink}` : '2px solid transparent',
                                            cursor: 'pointer', transition: 'color 120ms',
                                        }}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Table header */}
                        {!p.loading && allRows.length > 0 && !ghNarrow && (
                            <div style={{
                                display: 'grid', gridTemplateColumns: '70px 1fr 80px 100px 100px 120px',
                                padding: '8px 0', borderBottom: ghsHairline,
                            }}>
                                {['Время', 'Клиент', 'Длит.', 'Цена', 'Статус', ''].map(h => (
                                    <div key={h || 'act'} style={{ ...ghsMono, fontSize: 9 }}>{h}</div>
                                ))}
                            </div>
                        )}

                        {/* Session rows */}
                        {p.loading && !allRows.length ? (
                            <div style={{ padding: '80px 0', textAlign: 'center' }}>
                                <div style={ghsMono}>Загрузка...</div>
                            </div>
                        ) : allRows.length === 0 ? (
                            <div style={{ padding: '80px 0', textAlign: 'center' }}>
                                <h2 style={{ fontFamily: GH_SANS, fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: GH.ink30 }}>
                                    Сессий нет.
                                </h2>
                            </div>
                        ) : (
                            <div>
                                {allRows.map(([day, daySessions]) => (
                                    <div key={day}>
                                        {/* Day header */}
                                        <div style={{ padding: '16px 0 6px', borderBottom: ghsHairline }}>
                                            <span style={{ fontFamily: GH_SANS, fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                                                {format(parseISO(day), 'EEEE, d MMMM', { locale: ru })}
                                            </span>
                                            <span style={{ ...ghsMono, marginLeft: 12, fontSize: 9 }}>
                                                {daySessions.length} сесс.
                                            </span>
                                        </div>
                                        {/* Sessions */}
                                        {daySessions
                                            .sort((a, b) => a.date.localeCompare(b.date))
                                            .map(session => (
                                                <GHSessionRow
                                                    key={session.id}
                                                    session={session}
                                                    client={p.clientMap.get(session.clientId)}
                                                    isEditing={p.editingId === session.id}
                                                    setEditingId={p.setEditingId}
                                                    updateSession={p.updateSession}
                                                    deleteSession={p.deleteSession}
                                                    quickPaySession={p.quickPaySession}
                                                    onBookCab={p.handleBookCab}
                                                    navigate={p.navigate}
                                                    narrow={ghNarrow}
                                                />
                                            ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Footer */}
            <div style={{ borderTop: ghsHairline, padding: '16px clamp(16px, 4vw, 32px)', textAlign: 'center' }}>
                <span style={ghsMono}>Unbox · CRM · Сессии · {new Date().getFullYear()}</span>
            </div>

            {/* Legacy sync modal */}
            {p.showSyncModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => p.setShowSyncModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <div className="p-6 space-y-5">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-unbox-dark flex items-center gap-2">
                                    <RefreshCw className="w-5 h-5 text-unbox-green" />
                                    Синхронизация с Google Calendar
                                </h3>
                                <button onClick={() => p.setShowSyncModal(false)} className="text-gray-400 hover:text-gray-600">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Период назад (месяцев)</label>
                                    <select value={p.syncMonthsBack} onChange={e => p.setSyncMonthsBack(Number(e.target.value))}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green">
                                        <option value={0}>Только текущий</option>
                                        <option value={1}>1 мес.</option>
                                        <option value={3}>3 мес.</option>
                                        <option value={6}>6 мес.</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Период вперёд (месяцев)</label>
                                    <select value={p.syncMonthsForward} onChange={e => p.setSyncMonthsForward(Number(e.target.value))}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green">
                                        <option value={1}>1 мес.</option>
                                        <option value={2}>2 мес.</option>
                                        <option value={3}>3 мес.</option>
                                    </select>
                                </div>
                            </div>
                            {p.syncResult && (
                                <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                                    <div className="font-medium mb-2">Результат:</div>
                                    <div className="flex justify-between"><span className="text-gray-500">Всего</span><span className="font-medium">{p.syncResult.totalEvents ?? 0}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Создано</span><span className="font-medium text-green-600">{p.syncResult.created ?? 0}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Обновлено</span><span className="font-medium">{p.syncResult.updated ?? 0}</span></div>
                                </div>
                            )}
                            <div className="flex gap-3">
                                <button onClick={() => p.handleSync(true)} disabled={p.syncing}
                                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
                                    {p.syncing ? '...' : 'Предпросмотр'}
                                </button>
                                <button onClick={() => p.handleSync(false)} disabled={p.syncing}
                                    className="flex-1 px-4 py-2.5 bg-unbox-green text-white rounded-xl text-sm font-medium hover:bg-unbox-dark disabled:opacity-50 transition-colors">
                                    {p.syncing ? '...' : 'Синхронизировать'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── GH: Строка сессии ───────────────────────────────────────────────────────

function GHSessionRow({ session, client, isEditing, setEditingId, updateSession, deleteSession, quickPaySession, onBookCab, navigate, narrow }: {
    session: CrmSession; client?: CrmClient;
    isEditing: boolean; setEditingId: (id: string | null) => void;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string) => Promise<void>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string }>;
    onBookCab: (session: CrmSession, clientName: string) => void;
    navigate: ReturnType<typeof useNavigate>;
    narrow?: boolean;
}) {
    const dt = parseSessionDate(session.date);
    const effectiveStatus = getEffectiveStatus(session);
    const isCancelled = effectiveStatus === 'CANCELLED_CLIENT' || effectiveStatus === 'CANCELLED_THERAPIST';
    const statusColor: string = isCancelled ? GH.danger : effectiveStatus === 'COMPLETED' ? GH.accent : GH.ink60;

    const actionBtnStyle: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '4px 8px', background: 'transparent', border: ghsHairline, cursor: 'pointer', color: GH.ink60 };

    return (
        <>
            {narrow ? (
                /* ── Mobile: stacked card ── */
                <div style={{ padding: '12px 0', borderBottom: ghsHairline, opacity: isCancelled ? 0.4 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{format(dt, 'HH:mm')}</span>
                                <span
                                    style={{ fontSize: 13, fontWeight: 600, cursor: session.clientId ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    onClick={() => session.clientId && navigate(`/crm/clients/${session.clientId}`)}
                                >
                                    {client?.name || 'Клиент'}
                                </span>
                                {session.isBooked && <span style={{ fontFamily: GH_MONO, fontSize: 8, letterSpacing: '0.14em', color: GH.accent, textTransform: 'uppercase' }}>Каб</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                                <span style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink60 }}>{session.durationMinutes}′</span>
                                <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{session.price ?? client?.basePrice ?? '—'} {client?.currency || '₾'}</span>
                                <span style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: statusColor }}>
                                    {session.isPaid ? 'Оплачено' : STATUS_LABELS[effectiveStatus] || effectiveStatus}
                                </span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 3, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 120 }}>
                            {!session.isPaid && !isCancelled && (
                                <button onClick={async () => { try { await quickPaySession(session.id); toast.success('Оплачено'); } catch { toast.error('Ошибка'); } }}
                                    style={{ ...actionBtnStyle, background: GH.accent, color: GH.paper, border: 'none' }}>Pay</button>
                            )}
                            {!session.isBooked && !isCancelled && (
                                <button onClick={() => onBookCab(session, client?.name || 'Клиент')} style={actionBtnStyle}>+Каб</button>
                            )}
                            <button onClick={() => setEditingId(isEditing ? null : session.id)}
                                style={{ ...actionBtnStyle, background: isEditing ? GH.ink : 'transparent', color: isEditing ? GH.paper : GH.ink60, border: isEditing ? 'none' : ghsHairline }}>Ред.</button>
                            <button onClick={async () => { if (!confirm('Удалить сессию?')) return; try { await deleteSession(session.id); toast.success('Удалена'); } catch { toast.error('Ошибка'); } }}
                                style={{ ...actionBtnStyle, border: `1px solid ${GH.danger}`, color: GH.danger }}>Уд.</button>
                        </div>
                    </div>
                </div>
            ) : (
                /* ── Desktop: grid row ── */
                <div
                    style={{
                        display: 'grid', gridTemplateColumns: '70px 1fr 80px 100px 100px 120px',
                        alignItems: 'center', padding: '10px 0', borderBottom: ghsHairline,
                        opacity: isCancelled ? 0.4 : 1, transition: 'background 120ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = GH.ink5)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                    <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{format(dt, 'HH:mm')}</div>
                    <div>
                        <span style={{ fontSize: 13, fontWeight: 600, cursor: session.clientId ? 'pointer' : 'default' }}
                            onClick={() => session.clientId && navigate(`/crm/clients/${session.clientId}`)}
                            onMouseEnter={e => (e.currentTarget.style.color = GH.accent)} onMouseLeave={e => (e.currentTarget.style.color = GH.ink)}>
                            {client?.name || 'Клиент'}
                        </span>
                        {session.isBooked && <span style={{ fontFamily: GH_MONO, fontSize: 8, letterSpacing: '0.14em', color: GH.accent, marginLeft: 8, textTransform: 'uppercase' as const }}>Каб</span>}
                    </div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink60 }}>{session.durationMinutes}′</div>
                    <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{session.price ?? client?.basePrice ?? '—'} {client?.currency || '₾'}</div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: statusColor }}>
                        {session.isPaid ? 'Оплачено' : STATUS_LABELS[effectiveStatus] || effectiveStatus}
                    </div>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        {!session.isPaid && !isCancelled && (
                            <button onClick={async () => { try { await quickPaySession(session.id); toast.success('Оплачено'); } catch { toast.error('Ошибка'); } }}
                                style={{ ...actionBtnStyle, background: GH.accent, color: GH.paper, border: 'none' }}>Pay</button>
                        )}
                        {!session.isBooked && !isCancelled && (
                            <button onClick={() => onBookCab(session, client?.name || 'Клиент')} style={actionBtnStyle}>+Каб</button>
                        )}
                        <button onClick={() => setEditingId(isEditing ? null : session.id)}
                            style={{ ...actionBtnStyle, background: isEditing ? GH.ink : 'transparent', color: isEditing ? GH.paper : GH.ink60, border: isEditing ? 'none' : ghsHairline }}>Ред.</button>
                        <button onClick={async () => { if (!confirm('Удалить сессию?')) return; try { await deleteSession(session.id); toast.success('Удалена'); } catch { toast.error('Ошибка'); } }}
                            style={{ ...actionBtnStyle, border: `1px solid ${GH.danger}`, color: GH.danger }}>Уд.</button>
                    </div>
                </div>
            )}
            {/* Legacy edit panel */}
            {isEditing && (
                <SessionEditPanel
                    session={session}
                    clientCurrency={client?.currency}
                    clientDefaultAccount={client?.defaultAccount}
                    onSave={async (data) => { await updateSession(session.id, data); setEditingId(null); toast.success('Обновлена'); }}
                    onQuickPay={async (acc) => { await quickPaySession(session.id, acc); toast.success('Оплачено'); }}
                    onCancel={() => setEditingId(null)}
                />
            )}
        </>
    );
}
