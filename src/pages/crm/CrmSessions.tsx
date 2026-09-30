import React, { useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import {
    Plus,
    Check,
    X,
    Loader2,
    Banknote,
    Pencil,
    Trash2,
    LayoutGrid,
    RefreshCw,
    Unlink,
    AlertTriangle,
} from 'lucide-react';
import {
    format, startOfMonth, endOfMonth, addMonths, subMonths, addDays,
    startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isToday as isTodayFn,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { AccountSelect } from '../../components/crm/AccountSelect';
import { toast } from 'sonner';
import { crmApi } from '../../api/crm';
import type { CrmSession, CrmSessionCreate, CrmSessionUpdate, CrmClient, CrmPayment } from '../../api/crm';
import { CrmChessboardView } from '../../components/crm/CrmChessboardView';
import { DeleteSessionModal } from '../../components/crm/DeleteSessionModal';
import { toGel, CURRENCIES } from '../../utils/currency';
import { parseUTC } from '../../utils/dateUtils';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { statusLabel, getStatusDef } from '../../design/statuses';
import { STATUS } from '../../design/tokens';
import { formatMoney, formatGel, formatDayMonth, formatDateLabel, formatMonthLabel, formatTime } from '../../utils/format';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';

/** «GEL» → «₾» в подписях полей («Цена, ₾»). */
const currencySign = (code?: string) => CURRENCIES.find(c => c.code === (code || 'GEL'))?.symbol ?? code ?? '₾';

/** «1 сессия / 2 сессии / 5 сессий». */
function sessionsWord(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сессия';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сессии';
    return 'сессий';
}

/** «5 октября, 09:00» (год — только если не текущий). */
function dayTime(d: Date): string {
    return `${formatDayMonth(d, { withYear: 'auto' })}, ${formatTime(d)}`;
}

// Подписи сессий — из общего словаря статусов (src/design/statuses.ts).
const STATUS_LABELS: Record<string, string> = Object.fromEntries(
    ['PLANNED', 'COMPLETED', 'CANCELLED_CLIENT', 'CANCELLED_THERAPIST'].map(k => [k, statusLabel('session', k)]),
);

/** Parse a CRM session's date string.
 *
 *  Almost every session in the DB carries a UTC-naive timestamp:
 *  rows imported from Google Calendar were stored that way by
 *  `_parse_event_dt` (it strips tzinfo after astimezone(UTC)). The
 *  small minority created via /crm/sessions POST or recurring
 *  auto-create are normalized to UTC-naive at ingest, so we can
 *  treat the entire column as UTC-naive and lean on parseUTC +
 *  formatBatumi(Asia/Tbilisi) for display. */
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
    const navigate = useNavigate();
    const location = useLocation();
    const { sessions, clients, fetchSessions, fetchClients, createSession, updateSession, deleteSession, quickPaySession, loading, error } =
        useCrmStore();
    // Пока первый ответ не пришёл — скелетон, а не «Сессий нет» (rule 8).
    const [fetchedOnce, setFetchedOnce] = useState(false);
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
    // Предпросмотр синка: какие новые карточки клиентов НЕ создавать
    // (специалист снимает галочку). Сохраняется в настройках CRM, чтобы
    // и автосинк раз в 20 минут их не создавал.
    const [syncExcluded, setSyncExcluded] = useState<Set<string>>(new Set());

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
    const futureEnd = format(addDays(new Date(), 60), 'yyyy-MM-dd');
    // Always use full month range + extend to future for upcoming sessions
    const dateFrom = monthStart;
    const dateTo = monthEnd > futureEnd ? monthEnd : futureEnd;

    const handleBookCab = (session: CrmSession, clientName: string) => {
        // → /dashboard/bookings (MyBookingsPage): подсветка времени сессии
        // оранжевым + привязка брони к сессии. DashboardLayout пропускает
        // специалиста сюда без редиректа в /crm/bookings при наличии crmMode.
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

    // При заходе на «Сессии» — как и на Дашборде — авто-завершаем прошедшие PLANNED
    // сессии в БАЗЕ. Иначе их статус висит PLANNED, пока кто-то не откроет Дашборд,
    // и долг клиента на карточке / в общем долге недосчитывается (эффективный статус
    // «прошла → завершена» существует только на фронте). Идемпотентно, один раз на маунт;
    // если что-то завершилось — перечитываем сессии, чтобы счётчики отражали правду БД.
    useEffect(() => {
        crmApi.autoCompleteSessions()
            .then(res => { if (res.autoCompleted > 0) fetchSessions({ dateFrom, dateTo }); })
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch ALL sessions for the period (no status filter on API), filter on frontend by effective status
    useEffect(() => {
        fetchSessions({
            dateFrom,
            dateTo,
        }).finally(() => setFetchedOnce(true));
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
            ? debtEntries.map(([cur, val]) => formatMoney(val, { currency: cur, fraction: 0 })).join(' · ')
            : '';

        // «Заработано» — из ЗАВЕРШЁННЫХ ОПЛАЧЕННЫХ сессий этого месяца (по дате сессии).
        // Это то, что владелец интуитивно ждёт рядом с «N завершено». В отличие от
        // «кассы» ниже (все платежи месяца), сюда НЕ попадает оплата прошлых долгов и
        // пополнения без сессии. Цена/валюта — как в строке списка (session.price ?? client.basePrice).
        const earnedByCur: Record<string, number> = {};
        monthSessions.forEach(s => {
            if (getEffectiveStatus(s) !== 'COMPLETED' || !s.isPaid) return;
            const client = clientMap.get(s.clientId);
            const cur = client?.currency || 'GEL';
            const price = s.price ?? client?.basePrice ?? 0;
            if (price > 0) earnedByCur[cur] = (earnedByCur[cur] || 0) + price;
        });
        const earnedEntries = Object.entries(earnedByCur).filter(([, v]) => v > 0);
        const earnedLabel = earnedEntries.length > 0
            ? earnedEntries.map(([cur, val]) => formatMoney(val, { currency: cur, fraction: 0 })).join(' · ')
            : formatGel(0);
        const earnedGelTotal = earnedEntries.reduce((s, [cur, val]) => s + toGel(val, cur), 0);
        const earnedGel = earnedEntries.length > 1 ? `≈ ${formatGel(earnedGelTotal, { fraction: 0 })}` : '';

        // «Касса» — ВСЕ платежи, датированные месяцем (реальная валюта платежа).
        // Включает оплату прошлых долгов и пополнения без сессии → это кэш-флоу, НЕ
        // заработок за месяц. Отсюда бывает выше «Заработано».
        const revByCur: Record<string, number> = {};
        monthPayments.forEach(p => {
            const cur = p.currency || 'GEL';
            revByCur[cur] = (revByCur[cur] || 0) + p.amount;
        });
        const entries = Object.entries(revByCur).filter(([, v]) => v > 0);
        const revenueLabel = entries.length > 0
            ? entries.map(([cur, val]) => formatMoney(val, { currency: cur, fraction: 0 })).join(' · ')
            : formatGel(0);
        // GEL equivalent
        const gelTotal = entries.reduce((s, [cur, val]) => s + toGel(val, cur), 0);
        const revenueGel = entries.length > 1 ? `≈ ${formatGel(gelTotal, { fraction: 0 })}` : '';

        return { planned, completed, unpaidCount, debtLabel, revenueLabel, revenueGel, earnedLabel, earnedGel };
    }, [sessions, monthPayments, monthStart, monthEnd, clientMap]);

    const handleSync = async (dryRun = false) => {
        setSyncing(true);
        const previewNames: any[] = (syncResult?.dryRun && syncResult?.wouldCreateNames) || [];
        setSyncResult(null);
        try {
            if (!dryRun && previewNames.length > 0) {
                // Сохраняем выбор из предпросмотра: снятые галочки → «не клиент»,
                // возвращённые галочки убираем из списка исключений.
                const settings = await crmApi.getSettings();
                const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
                const reIncluded = new Set(previewNames.filter(n => n.ignored && !syncExcluded.has(n.name)).map(n => norm(n.name)));
                const next = (settings.syncIgnoreNames || []).filter(n => !reIncluded.has(norm(n)));
                for (const n of syncExcluded) if (!next.some(x => norm(x) === norm(n))) next.push(n);
                await crmApi.updateSettings({ syncIgnoreNames: next });
            }
            const result = await crmApi.syncFromCalendar(dryRun, syncMonthsBack, syncMonthsForward);
            setSyncResult(result);
            if (dryRun) {
                const names: any[] = result?.wouldCreateNames || [];
                setSyncExcluded(new Set(names.filter(n => n.ignored && !n.looksNonClient).map(n => n.name)));
            }
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
    return (
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
            syncExcluded={syncExcluded} setSyncExcluded={setSyncExcluded}
            stats={stats}
            upcomingGroups={upcomingGroups} pastGroups={pastGroups}
            sessions={sessions} clientMap={clientMap}
            clients={clients} loading={loading || !fetchedOnce}
            loadError={fetchedOnce && !loading ? error : null}
            onRetry={() => { fetchClients(); fetchSessions({ dateFrom, dateTo }); }}
            createSession={createSession} updateSession={updateSession}
            deleteSession={deleteSession} quickPaySession={quickPaySession}
            handleBookCab={handleBookCab}
            chessDate={chessDate} setChessDate={setChessDate}
            navigate={navigate}
        />
    );
}

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
                    <div key={dayStr} className={`bg-card/70 rounded-2xl border overflow-hidden ${today ? 'border-unbox-green/40' : 'border-white/80'}`}>
                        {/* Day header */}
                        <div className={`flex items-center justify-between px-4 py-2.5 ${today ? 'bg-unbox-green/5' : past ? 'bg-gray-50/60' : 'bg-card/50'}`}>
                            <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold capitalize ${today ? 'text-unbox-green' : past ? 'text-ink-60' : 'text-unbox-dark'}`}>
                                    {format(day, 'EEEE', { locale: ru })}
                                </span>
                                <span className={`text-xs ${today ? 'text-unbox-green font-medium' : 'text-ink-60'}`}>
                                    {formatDayMonth(day)}
                                    {today && ' · Сегодня'}
                                </span>
                                {daySessions.length > 0 && (
                                    <span className="text-xs bg-unbox-green/10 text-unbox-green px-1.5 py-0.5 rounded-md font-medium">
                                        {daySessions.length} {sessionsWord(daySessions.length)}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => onBookRoom(dayStr)}
                                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-unbox-light bg-card hover:bg-unbox-light/40 text-ink-60 hover:text-unbox-dark transition-colors"
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
                                                {/* Полоска — цвет статуса из общего словаря (--status-*). */}
                                                <div className="w-0.5 h-8 rounded-full shrink-0" style={{
                                                    background: STATUS[getStatusDef('session', effectiveStatus).tone].fg,
                                                }} />
                                                <div className="flex-1 min-w-0">
                                                    <div
                                                        className="text-sm font-medium text-unbox-dark hover:text-unbox-green cursor-pointer transition-colors"
                                                        onClick={(e) => { e.stopPropagation(); if (session.clientId) navigate(`/crm/clients/${session.clientId}`); }}
                                                    >{client?.name || 'Клиент'}</div>
                                                    <div className="text-xs text-ink-60">{session.durationMinutes} мин · {STATUS_LABELS[effectiveStatus]}</div>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {session.isBooked ? (
                                                        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]">
                                                            <Check className="w-3 h-3" aria-hidden="true" /> Кабинет
                                                        </span>
                                                    ) : !isCancelled && (
                                                        <button
                                                            onClick={() => onBookCab?.(session, client?.name || 'Клиент')}
                                                            className="text-xs px-1.5 py-0.5 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                                                        >+ Кабинет</button>
                                                    )}
                                                    <div className="font-semibold text-xs text-unbox-dark">{formatMoney(session.price ?? client?.basePrice, { currency: client?.currency })}</div>
                                                    {!session.isPaid && !isCancelled && (
                                                        <button
                                                            onClick={async () => {
                                                                try { await quickPaySession(session.id); toast.success('Оплата отмечена'); } catch { toast.error('Не удалось отметить оплату'); }
                                                            }}
                                                            className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                                                        >
                                                            <Banknote className="w-3.5 h-3.5" aria-hidden="true" />
                                                            Отметить оплату
                                                        </button>
                                                    )}
                                                    <button onClick={() => setEditingId(isEditing ? null : session.id)} aria-label="Изменить сессию" title="Изменить сессию" className="p-1 hover:bg-unbox-light/50 text-ink-60 hover:text-unbox-green rounded-lg transition-colors">
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
                                                    onQuickPay={async (acc) => { await quickPaySession(session.id, acc); toast.success('Оплата отмечена'); }}
                                                    onCancel={() => setEditingId(null)}
                                                    onBookCab={() => onBookCab(session, client?.name || 'Клиент')}
                                                    onRefresh={() => useCrmStore.getState().fetchSessions()}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="px-4 py-3 text-xs text-ink-60 italic">Нет сессий</div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// DayGroup / StatusBadgeDropdown / MiniStat — старый список сессий до Grid House.
// Нигде не рендерились (мёртвый код с системным окном браузера и цветами Tailwind), удалены в wave 1.

// ── Session Edit Panel ────────────────────────────────────────────────────────

function SessionEditPanel({
    session,
    clientCurrency,
    clientDefaultAccount,
    onSave,
    onQuickPay,
    onCancel,
    onBookCab,
    onDelete,
    onRefresh,
}: {
    session: import('../../api/crm').CrmSession;
    clientCurrency?: string;
    clientDefaultAccount?: string;
    onSave: (data: CrmSessionUpdate) => Promise<void>;
    onQuickPay?: (account: string) => Promise<void>;
    onCancel: () => void;
    /** Open the cabinet-booking flow for this session (already prefilled). */
    onBookCab?: () => void;
    /** Open the delete confirm modal — handles "this one vs whole series" itself. */
    onDelete?: () => void;
    /**
     * Refresh the parent's session list. Used after detach so the КАБ badge
     * disappears immediately without waiting for the next fetch.
     */
    onRefresh?: () => Promise<void> | void;
}) {
    const clients = useCrmStore(s => s.clients);
    const { confirm } = useConfirmDialog();
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

    // Quick-cancel: changes status to CANCELLED_CLIENT and saves immediately.
    // We default to "client cancelled" because that's the most common case;
    // the dropdown is still there for the rarer "therapist cancelled" path.
    const handleQuickCancel = async () => {
        setSaving(true);
        try {
            await onSave({ status: 'CANCELLED_CLIENT' });
            toast.success('Сессия отменена');
            onCancel();
        } catch (err: any) {
            toast.error(err?.message || 'Не удалось отменить');
        } finally {
            setSaving(false);
        }
    };

    // Detach cabinet: clears booking_id + is_booked on the session.
    // `cancelToo` also cancels the underlying cabinet booking (refunds the
    // owner). Default false = soft detach so the cabinet booking can be
    // re-attached to a different session (e.g. wrong client originally).
    const handleDetachCabinet = async (cancelToo: boolean) => {
        if (cancelToo) {
            const ok = await confirm({
                title: 'Отменить бронь кабинета?',
                body: 'Кабинет отвяжется от сессии, а деньги за бронь вернутся на баланс.',
                confirmLabel: 'Отменить бронь',
                cancelLabel: 'Оставить',
                tone: 'danger',
            });
            if (!ok) return;
        }
        setSaving(true);
        try {
            const { crmApi } = await import('../../api/crm');
            await crmApi.detachCabinet(session.id, cancelToo);
            toast.success(cancelToo ? 'Кабинет отвязан и бронь отменена' : 'Кабинет отвязан');
            if (onRefresh) await onRefresh();
            onCancel();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || err?.message || 'Не удалось отвязать кабинет');
        } finally {
            setSaving(false);
        }
    };

    // Change cabinet: detach old (keep booking row alive — user might want
    // to manage it separately) then immediately open the booking flow to
    // pick a new one. The new booking will re-link itself when created.
    const handleChangeCabinet = async () => {
        if (!onBookCab) return;
        const ok = await confirm({
            title: 'Поменять кабинет?',
            body: 'Отвяжем текущий кабинет и откроем выбор нового. Старая бронь останется — её можно отменить отдельно.',
            confirmLabel: 'Отвязать и выбрать новый',
            cancelLabel: 'Оставить',
        });
        if (!ok) return;
        setSaving(true);
        try {
            const { crmApi } = await import('../../api/crm');
            await crmApi.detachCabinet(session.id, false);
            if (onRefresh) await onRefresh();
            onBookCab();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || err?.message || 'Не удалось отвязать кабинет');
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
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card"
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Длительность</label>
                    <select
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card"
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
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card"
                    >
                        {/* Слова — из общего словаря статусов (statuses.ts). */}
                        {['PLANNED', 'COMPLETED', 'CANCELLED_CLIENT', 'CANCELLED_THERAPIST'].map(k => (
                            <option key={k} value={k}>{STATUS_LABELS[k]}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">
                        Цена, {currencySign(clientCurrency)}
                    </label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card"
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
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card max-w-xs"
                    >
                        {clients.map(c => (
                            <option key={c.id} value={c.id}>{c.name}{c.aliasCode ? ` #${c.aliasCode}` : ''}</option>
                        ))}
                    </select>
                    {clientId !== session.clientId && (
                        <p className="text-xs text-[var(--status-pending-fg)] mt-0.5">Клиент будет изменён</p>
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
                            className="px-2 py-1 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card"
                        />
                    )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/*
                      Quick actions, in order of escalation:
                       — book a cabinet (only when not yet booked) opens the
                         existing /dashboard/bookings flow with this session
                         pre-attached, so the new booking auto-links back.
                       — cancel = soft-cancel, status flips to
                         CANCELLED_CLIENT, session row stays in DB so reports
                         can still see "this hour was on the calendar".
                       — delete = hard delete via the shared modal (handles
                         "this one vs the whole recurring series" itself).
                    */}
                    {/* Cabinet controls — three-state:
                          • not booked yet  → "+ Кабинет"
                          • booked          → "Поменять кабинет" + "Отвязать кабинет"
                          • cancelled       → hidden
                       Hidden entirely when the session itself is cancelled because
                       attaching a cabinet to a cancelled session is meaningless. */}
                    {getEffectiveStatus(session) !== 'CANCELLED_CLIENT' && getEffectiveStatus(session) !== 'CANCELLED_THERAPIST' && (
                        session.isBooked ? (
                            <>
                                {onBookCab && (
                                    <button
                                        type="button"
                                        onClick={handleChangeCabinet}
                                        disabled={saving}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-400 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                                        title="Отвязать текущий кабинет и выбрать новый (старая бронь останется и её можно отдельно отменить)"
                                    >
                                        <RefreshCw className="w-3 h-3" aria-hidden="true" /> Поменять кабинет
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => handleDetachCabinet(false)}
                                    disabled={saving}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-400 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                                    title="Снять связь сессии с кабинетной бронью (сама бронь останется)"
                                >
                                    <Unlink className="w-3 h-3" aria-hidden="true" /> Отвязать кабинет
                                </button>
                            </>
                        ) : (
                            onBookCab && (
                                <button
                                    type="button"
                                    onClick={onBookCab}
                                    disabled={saving}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-unbox-green/40 text-unbox-green hover:bg-unbox-light/60 transition-colors disabled:opacity-50"
                                    title="Забронировать кабинет под эту сессию"
                                >
                                    + Кабинет
                                </button>
                            )
                        )
                    )}
                    {getEffectiveStatus(session) !== 'CANCELLED_CLIENT' && getEffectiveStatus(session) !== 'CANCELLED_THERAPIST' && (
                        <button
                            type="button"
                            onClick={handleQuickCancel}
                            disabled={saving}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-400 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                            title="Отметить сессию как отменённую (статус меняется, запись остаётся)"
                        >
                            <X className="w-3 h-3" aria-hidden="true" /> Отменить сессию
                        </button>
                    )}
                    {onDelete && (
                        <button
                            type="button"
                            onClick={onDelete}
                            disabled={saving}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--status-danger-fg)]/40 text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)] transition-colors disabled:opacity-50"
                            title="Удалить сессию полностью (с возможностью удалить всю серию)"
                        >
                            <Trash2 className="w-3 h-3" aria-hidden="true" /> Удалить
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-3 py-1.5 text-xs text-ink-60 hover:bg-unbox-light/50 rounded-lg transition-colors"
                    >
                        Закрыть
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
            className="bg-card rounded-2xl border border-unbox-light shadow-sm p-5 space-y-4 animate-in fade-in slide-in-from-top-2"
        >
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Новая сессия</h3>
                <button type="button" onClick={onCancel} className="p-1 hover:bg-unbox-light/50 rounded-lg">
                    <X className="w-5 h-5 text-ink-60" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Клиент <span className="text-[var(--status-danger-fg)]">*</span>
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
                        Дата и время <span className="text-[var(--status-danger-fg)]">*</span>
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
                        Стоимость{selectedClient && `, ${currencySign(selectedClient.currency)}`}
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
                    className="px-4 py-2 text-sm text-ink-60 hover:bg-unbox-light/50 rounded-xl transition-colors"
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
    syncExcluded: Set<string>; setSyncExcluded: (v: Set<string>) => void;
    stats: { planned: number; completed: number; unpaidCount: number; debtLabel: string; revenueLabel: string; revenueGel: string; earnedLabel: string; earnedGel: string };
    upcomingGroups: [string, CrmSession[]][];
    pastGroups: [string, CrmSession[]][];
    sessions: CrmSession[];
    clientMap: Map<string, CrmClient>;
    clients: CrmClient[];
    loading: boolean;
    loadError: string | null;
    onRetry: () => void;
    createSession: (data: CrmSessionCreate) => Promise<any>;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string, scope?: 'this' | 'future') => Promise<{ deleted: number; deletedGcal: number }>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string }>;
    handleBookCab: (session: CrmSession, clientName: string) => void;
    chessDate: Date | undefined; setChessDate: (d: Date | undefined) => void;
    navigate: ReturnType<typeof useNavigate>;
}

const ghsMono = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: GH.ink60 };
const ghsHairline = `1px solid ${GH.ink10}`;
// Колонки таблицы сессий: шапка и строки — одна сетка. Кнопки в строке —
// 12 px (раньше «Pay / +Каб / Ред. / Уд.» 8 px в 120 px).
// Минимум сетки: 52 + 140 (клиент) + 44 + 84 + 130 + 236 + 5×8 зазоров = 726 px.
// Уже GH_TABLE_MIN — строки складываются в карточки (меряем контейнер, а не
// окно: сайдбар CRM съедает 260 px, и на окнах 960–1200 таблица не влезала).
const GH_ROW_COLUMNS = '52px minmax(140px, 1fr) 44px 84px 130px 236px';
const GH_ROW_GAP = 8;
const GH_TABLE_MIN = 760;

/** Ширина элемента через ResizeObserver. Первый замер — до отрисовки
 *  (useLayoutEffect), чтобы таблица не мигала карточками. */
function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
    const [el, setEl] = useState<T | null>(null);
    const [w, setW] = useState(0);
    useLayoutEffect(() => {
        if (!el) return;
        setW(el.getBoundingClientRect().width);
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(entries => setW(entries[0].contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return [setEl, w];
}

function useGHNarrow(bp = 768) {
    const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth < bp);
    useEffect(() => { const h = () => setN(window.innerWidth < bp); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [bp]);
    return n;
}

function GridHouseCrmSessions(p: GHSessionsProps) {
    const ghNarrow = useGHNarrow();
    const [listRef, listW] = useElementWidth<HTMLDivElement>();
    // Карточки вместо таблицы, если контейнер списка уже минимума сетки.
    const tableNarrow = ghNarrow || listW < GH_TABLE_MIN;
    const VIEW_MODES: { key: ViewMode; label: string }[] = [
        { key: 'list', label: 'Список' },
        { key: 'week', label: 'Неделя' },
        { key: 'chess', label: 'Шахматка' },
    ];

    const STATUS_TABS: { key: string; label: string }[] = [
        { key: 'all', label: 'Все' },
        { key: 'PLANNED', label: 'Запланированы' },
        { key: 'COMPLETED', label: 'Прошли' },
        { key: 'CANCELLED_CLIENT', label: 'Отменены' },
    ];

    const allRows = [...p.upcomingGroups, ...p.pastGroups];

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper, minHeight: '100vh', overflowX: 'hidden' }}>
            {/* ── Compact head: breadcrumb + title + KPIs all on one row ──
                Was three padded sections eating ~280px before any
                content. Mirrored the CrmBookings tightening: title left
                with the big "Завершено" number inline, secondary KPIs +
                action buttons on the right. */}
            <div style={{
                padding: '20px clamp(16px, 4vw, 32px) 0',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 16,
            }}>
                <div style={{ minWidth: 0 }}>
                    <div style={ghsMono}>CRM · Сессии</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
                        <h1 style={{
                            fontFamily: GH_SANS,
                            fontSize: 'clamp(24px, 3vw, 36px)',
                            fontWeight: 800,
                            letterSpacing: '-0.02em',
                            lineHeight: 1,
                            margin: 0,
                        }}>
                            Сессии.
                        </h1>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                                {p.stats.completed}
                            </span>
                            <span style={{ ...ghsMono, fontSize: 12 }}>
                                прошло · {formatMonthLabel(p.currentMonth)}
                            </span>
                        </span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {[
                            { label: 'Запланировано', value: String(p.stats.planned), color: undefined as string | undefined, sub: undefined as string | undefined, multiline: false, hint: 'Сессии этого месяца, которые ещё впереди' },
                            { label: 'Не оплачено', value: String(p.stats.unpaidCount), color: p.stats.unpaidCount > 0 ? GH.danger : undefined, sub: p.stats.debtLabel, multiline: false, hint: 'Прошедшие сессии без оплаты — долг клиентов за всё время' },
                            { label: 'Заработано', value: p.stats.earnedLabel, color: undefined, sub: p.stats.earnedGel, multiline: true, hint: 'Проведённые и оплаченные сессии этого месяца — по дате сессии' },
                            { label: 'Касса · с долгами', value: p.stats.revenueLabel, color: GH.ink60, sub: p.stats.revenueGel, multiline: true, hint: 'Все деньги, полученные в этом месяце, включая оплату старых долгов. Бывает больше или меньше «Заработано»' },
                        ].map(kpi => (
                            <div key={kpi.label} title={kpi.hint} style={{ textAlign: 'right' as const, minWidth: 0, cursor: 'help' }}>
                                <div style={{
                                    fontSize: kpi.multiline && ghNarrow ? 13 : 16,
                                    fontWeight: 700,
                                    fontVariantNumeric: 'tabular-nums',
                                    color: kpi.color || GH.ink,
                                    whiteSpace: kpi.multiline && ghNarrow ? ('pre-line' as const) : ('normal' as const),
                                    wordBreak: 'break-word' as const,
                                    lineHeight: 1.25,
                                }}>
                                    {kpi.multiline && ghNarrow ? kpi.value.split(' · ').join('\n') : kpi.value}
                                </div>
                                <div style={{ ...ghsMono, fontSize: 12 }}>{kpi.label}</div>
                                {kpi.sub && <div style={{ ...ghsMono, fontSize: 12, color: kpi.color || GH.ink60 }}>{kpi.sub}</div>}
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={() => p.setShowSyncModal(true)}
                            style={{ ...ghsMono, padding: '8px 14px', background: 'transparent', border: ghsHairline, cursor: 'pointer', color: GH.ink60 }}
                        >
                            Синхронизация
                        </button>
                        <button
                            onClick={() => { p.setPrefillDate(null); p.setShowForm(true); }}
                            style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, padding: '8px 16px', background: GH.ink, color: GH.paper, border: 'none', cursor: 'pointer' }}
                        >
                            + Новая
                        </button>
                    </div>
                </div>
            </div>

            {/* ── View mode tabs ── */}
            <div style={{ display: 'flex', margin: '12px clamp(16px, 4vw, 32px) 0', borderBottom: `2px solid ${GH.ink}` }}>
                {VIEW_MODES.map(v => (
                    <button
                        key={v.key}
                        onClick={() => p.setView(v.key)}
                        style={{
                            fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                            padding: '8px 18px',
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
                    // marginTop trimmed 24 → 12 — visual breathing room
                    // doesn't need to be cavernous between tab strip and grid.
                    <div style={{ marginTop: 12 }}><CrmChessboardView initialDate={p.chessDate} /></div>
                ) : p.view === 'week' ? (
                    <div style={{ marginTop: 12 }}>
                        {/* Week nav */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                            <button onClick={() => p.setWeekAnchor(d => subWeeks(d, 1))}
                                aria-label="Предыдущая неделя"
                                style={{ ...ghsMono, padding: '8px 12px', background: 'transparent', border: ghsHairline, cursor: 'pointer' }}>
                                &larr;
                            </button>
                            <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em' }}>
                                {formatDayMonth(startOfWeek(p.weekAnchor, { weekStartsOn: 1 }))} &ndash;{' '}
                                {formatDayMonth(endOfWeek(p.weekAnchor, { weekStartsOn: 1 }), { withYear: 'auto' })}
                            </span>
                            <button onClick={() => p.setWeekAnchor(d => addWeeks(d, 1))}
                                aria-label="Следующая неделя"
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
                    <div ref={listRef}>
                        {/* Month nav + status filters */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 24, paddingBottom: 12, borderBottom: ghsHairline }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button onClick={() => p.setCurrentMonth(subMonths(p.currentMonth, 1))}
                                    aria-label="Предыдущий месяц"
                                    style={{ ...ghsMono, padding: '6px 10px', background: 'transparent', border: ghsHairline, cursor: 'pointer' }}>
                                    &larr;
                                </button>
                                <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'capitalize', minWidth: 120, textAlign: 'center' as const }}>
                                    {formatMonthLabel(p.currentMonth, { capitalize: true })}
                                </span>
                                <button onClick={() => p.setCurrentMonth(addMonths(p.currentMonth, 1))}
                                    aria-label="Следующий месяц"
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
                                            fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
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
                        {p.loadError && (
                            <ErrorBar
                                message="Не удалось загрузить сессии"
                                onRetry={p.onRetry}
                                retrying={p.loading}
                                className="mt-3"
                            />
                        )}

                        {!p.loading && allRows.length > 0 && !tableNarrow && (
                            <div style={{
                                display: 'grid', gridTemplateColumns: GH_ROW_COLUMNS, columnGap: GH_ROW_GAP,
                                padding: '8px 0', borderBottom: ghsHairline,
                            }}>
                                {['Время', 'Клиент', 'Длит.', 'Цена', 'Статус', ''].map(h => (
                                    <div key={h || 'act'} style={{ ...ghsMono, fontSize: 12 }}>{h}</div>
                                ))}
                            </div>
                        )}

                        {/* Session rows. Загрузка ≠ ошибка ≠ пусто (rule 8). */}
                        {p.loading && !allRows.length ? (
                            <div role="status" aria-busy="true" style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <span className="sr-only">Загружаем сессии…</span>
                                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={20} radius={0} />)}
                            </div>
                        ) : allRows.length === 0 ? (
                            p.loadError ? null : (
                                <EmptyState
                                    title={p.statusFilter === 'all' ? 'В этом месяце сессий нет' : 'Сессий с таким статусом нет'}
                                    hint={p.statusFilter === 'all'
                                        ? 'Добавьте сессию или подтяните её из Google Calendar.'
                                        : 'Новые сессии попадают во «Все» и «Запланированы».'}
                                    action={p.statusFilter === 'all'
                                        ? { label: 'Новая сессия', onClick: () => { p.setPrefillDate(null); p.setShowForm(true); } }
                                        : { label: 'Показать все', onClick: () => p.setStatusFilter('all') }}
                                />
                            )
                        ) : (
                            <div>
                                {allRows.map(([day, daySessions]) => (
                                    <div key={day}>
                                        {/* Day header */}
                                        <div style={{ padding: '16px 0 6px', borderBottom: ghsHairline }}>
                                            <span style={{ fontFamily: GH_SANS, fontSize: 13, fontWeight: 600 }}>
                                                {formatDateLabel(day, { capitalize: true })}
                                            </span>
                                            <span style={{ ...ghsMono, marginLeft: 12, fontSize: 12 }}>
                                                {daySessions.length} {sessionsWord(daySessions.length)}
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
                                                    narrow={tableNarrow}
                                                    touch={ghNarrow}
                                                />
                                            ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div style={{ borderTop: ghsHairline, padding: '16px clamp(16px, 4vw, 32px)', textAlign: 'center' }}>
                <span style={ghsMono}>Unbox · CRM · Сессии · {new Date().getFullYear()}</span>
            </div>

            {/* Legacy sync modal */}
            {p.showSyncModal && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => p.setShowSyncModal(false)}>
                    <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-6 space-y-5">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-unbox-dark flex items-center gap-2">
                                    <RefreshCw className="w-5 h-5 text-unbox-green" />
                                    Синхронизация с Google Calendar
                                </h3>
                                <button onClick={() => p.setShowSyncModal(false)} aria-label="Закрыть" className="text-ink-60 hover:text-gray-600">
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
                                    <div className="font-medium mb-2">{p.syncResult.dryRun ? 'Предпросмотр (ничего не изменено):' : 'Результат:'}</div>
                                    <div className="flex justify-between"><span className="text-gray-500">Событий в календаре</span><span className="font-medium">{p.syncResult.totalEvents ?? 0}</span></div>
                                    {p.syncResult.dryRun ? (
                                        <>
                                            <div className="flex justify-between"><span className="text-gray-500">Узнали клиента</span><span className="font-medium">{p.syncResult.matched ?? 0}</span></div>
                                            <div className="flex justify-between"><span className="text-gray-500">Новых карточек клиентов</span><span className="font-medium text-[var(--status-ok-fg)]">{(p.syncResult.wouldCreateNames || []).filter((n: any) => !n.looksNonClient && !p.syncExcluded.has(n.name)).length}</span></div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex justify-between"><span className="text-gray-500">Создано</span><span className="font-medium text-[var(--status-ok-fg)]">{p.syncResult.created ?? 0}</span></div>
                                            <div className="flex justify-between"><span className="text-gray-500">Обновлено</span><span className="font-medium">{p.syncResult.updated ?? 0}</span></div>
                                        </>
                                    )}
                                    {p.syncResult.dryRun && (p.syncResult.wouldCreateNames || []).length > 0 && (
                                        <div className="mt-2 p-2.5 rounded-lg bg-card border border-gray-200">
                                            <div className="font-semibold text-unbox-dark">Кто станет новой карточкой клиента</div>
                                            <div className="text-xs text-gray-500 mt-0.5 mb-1.5">
                                                Снимите галочку, если это не клиент — такие события не будут превращаться в карточки и при автосинке.
                                            </div>
                                            {(p.syncResult.wouldCreateNames || []).map((n: any) => (
                                                n.looksNonClient ? (
                                                    <div key={n.name} className="text-xs text-ink-60 py-1" title="Похоже на личное дело — карточку не создадим">
                                                        — {n.name} <span className="italic">(похоже не клиент, пропустим)</span>
                                                    </div>
                                                ) : (
                                                    <label key={n.name} className="flex items-center gap-2 py-1.5 text-sm cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={!p.syncExcluded.has(n.name)}
                                                            onChange={e => {
                                                                const next = new Set(p.syncExcluded);
                                                                if (e.target.checked) next.delete(n.name); else next.add(n.name);
                                                                p.setSyncExcluded(next);
                                                            }}
                                                            className="w-4 h-4 accent-unbox-green"
                                                        />
                                                        <span className={p.syncExcluded.has(n.name) ? 'text-ink-60 line-through' : ''}>{n.name}</span>
                                                    </label>
                                                )
                                            ))}
                                        </div>
                                    )}
                                    {(p.syncResult.calendarDuplicatesCount ?? 0) > 0 && (
                                        <div className="mt-2 p-2.5 rounded-lg bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]">
                                            <div className="font-semibold flex items-center gap-1.5">
                                                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                                                Дубли в календаре: {p.syncResult.calendarDuplicatesCount}
                                            </div>
                                            <div className="text-xs mt-1">
                                                На одну встречу стоит несколько событий — удалите лишнее в Google Calendar:
                                            </div>
                                            {(p.syncResult.calendarDuplicates ?? []).slice(0, 6).map((d: any, i: number) => (
                                                <div key={i} className="text-xs mt-0.5">
                                                    • {d.summary} — {d.date ? `${formatDayMonth(d.date)}, ${formatTime(d.date)}` : '—'} (×{d.count})
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="flex gap-3">
                                <button onClick={() => p.handleSync(true)} disabled={p.syncing}
                                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
                                    {p.syncing ? 'Проверяем…' : 'Предпросмотр'}
                                </button>
                                <button onClick={() => p.handleSync(false)} disabled={p.syncing}
                                    className="flex-1 px-4 py-2.5 bg-unbox-green text-white rounded-xl text-sm font-medium hover:bg-unbox-dark disabled:opacity-50 transition-colors">
                                    {p.syncing ? 'Синхронизируем…' : 'Синхронизировать'}
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

function GHSessionRow({ session, client, isEditing, setEditingId, updateSession, deleteSession, quickPaySession, onBookCab, navigate, narrow, touch: touchScreen }: {
    session: CrmSession; client?: CrmClient;
    isEditing: boolean; setEditingId: (id: string | null) => void;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string, scope?: 'this' | 'future') => Promise<{ deleted: number; deletedGcal: number }>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string }>;
    onBookCab: (session: CrmSession, clientName: string) => void;
    navigate: ReturnType<typeof useNavigate>;
    /** Карточка вместо строки таблицы (узкий контейнер). */
    narrow?: boolean;
    /** Телефон: цели касания 44 px. */
    touch?: boolean;
}) {
    const dt = parseSessionDate(session.date);
    const effectiveStatus = getEffectiveStatus(session);
    const isCancelled = effectiveStatus === 'CANCELLED_CLIENT' || effectiveStatus === 'CANCELLED_THERAPIST';
    // Одни слова для оплаты во всей CRM (G5-06): «Оплачено» — статус,
    // «Отметить оплату» — действие.
    // В узкой колонке таблицы длинный статус («Отменил специалист») переносится.
    const badgeClass = narrow ? undefined : 'whitespace-normal';
    const statusBadge = session.isPaid
        ? <StatusBadge kind="payment" status="paid" audience="staff" variant="dot" className={badgeClass} />
        : <StatusBadge kind="session" status={effectiveStatus} audience="staff" variant="dot" className={badgeClass} />;
    const price = formatMoney(session.price ?? client?.basePrice, { currency: client?.currency });

    // Кнопки строки: Plex Sans 12 px, без капса; на узком экране — 44 px (rule 9).
    const touch = touchScreen ? 44 : 32;
    const textBtnStyle: React.CSSProperties = {
        fontFamily: GH_SANS, fontSize: 12, fontWeight: 500, minHeight: touch, padding: '0 10px',
        display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
        background: 'transparent', border: ghsHairline, cursor: 'pointer', color: GH.ink,
    };
    const iconBtnStyle: React.CSSProperties = {
        width: touch, height: touch, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: ghsHairline, cursor: 'pointer', color: GH.ink60,
    };

    const handleQuickPay = async () => {
        try { await quickPaySession(session.id); toast.success('Оплата отмечена'); } catch { toast.error('Не удалось отметить оплату'); }
    };

    const [deleteOpen, setDeleteOpen] = React.useState(false);
    const handleDelete = async (scope: 'this' | 'future') => {
        try {
            const res = await deleteSession(session.id, scope);
            toast.success(
                scope === 'future' && res.deleted > 1
                    ? `Удалено сессий: ${res.deleted}`
                    : 'Сессия удалена',
            );
        } catch {
            toast.error('Не удалось удалить сессию');
        }
    };

    const actions = (
        <>
            {!session.isPaid && !isCancelled && (
                <button onClick={handleQuickPay} title="Отметить оплату" style={{ ...textBtnStyle, background: GH.ink, color: GH.paper, border: 'none' }}>
                    {/* В таблице — без значка, чтобы колонка действий влезала в 236 px. */}
                    {narrow && <Banknote size={14} aria-hidden="true" />} Отметить оплату
                </button>
            )}
            {!session.isBooked && !isCancelled && (
                <button onClick={() => onBookCab(session, client?.name || 'Клиент')} style={iconBtnStyle}
                    title="Забронировать кабинет" aria-label="Забронировать кабинет">
                    <LayoutGrid size={14} aria-hidden="true" />
                </button>
            )}
            <button onClick={() => setEditingId(isEditing ? null : session.id)}
                title="Изменить" aria-label="Изменить сессию" aria-pressed={isEditing}
                style={{ ...iconBtnStyle, background: isEditing ? GH.ink : 'transparent', color: isEditing ? GH.paper : GH.ink60, border: isEditing ? 'none' : ghsHairline }}>
                <Pencil size={14} aria-hidden="true" />
            </button>
            {/* Удаление — через общее окно (серия: «только эту / эту и будущие»),
                как на телефоне; раньше тут было системное окно браузера. */}
            <button onClick={() => setDeleteOpen(true)} title="Удалить" aria-label="Удалить сессию"
                style={{ ...iconBtnStyle, color: GH.danger }}>
                <Trash2 size={14} aria-hidden="true" />
            </button>
        </>
    );

    return (
        <>
            {narrow ? (
                /* ── Mobile: stacked card ── */
                // Отменённые — приглушаем цветом, не прозрачностью (текст не бледнее ink-60).
                <div style={{ padding: '12px 0', borderBottom: ghsHairline, color: isCancelled ? GH.ink60 : undefined }}>
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
                                {session.isBooked && <BookedMark />}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>{session.durationMinutes}′</span>
                                <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{price}</span>
                                {statusBadge}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 196 }}>
                            {actions}
                        </div>
                    </div>
                </div>
            ) : (
                /* ── Desktop: grid row ── */
                <div
                    style={{
                        display: 'grid', gridTemplateColumns: GH_ROW_COLUMNS, columnGap: GH_ROW_GAP,
                        alignItems: 'center', padding: '8px 0', borderBottom: ghsHairline,
                        color: isCancelled ? GH.ink60 : undefined, transition: 'background 120ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = GH.ink5)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                    <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{format(dt, 'HH:mm')}</div>
                    <div>
                        <span style={{ fontSize: 13, fontWeight: 600, cursor: session.clientId ? 'pointer' : 'default' }}
                            onClick={() => session.clientId && navigate(`/crm/clients/${session.clientId}`)}
                            onMouseEnter={e => (e.currentTarget.style.color = GH.accent)} onMouseLeave={e => (e.currentTarget.style.color = isCancelled ? GH.ink60 : GH.ink)}>
                            {client?.name || 'Клиент'}
                        </span>
                        {session.isBooked && <BookedMark style={{ marginLeft: 8 }} />}
                    </div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>{session.durationMinutes}′</div>
                    <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{price}</div>
                    <div>{statusBadge}</div>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        {actions}
                    </div>
                </div>
            )}
            {/* Legacy edit panel */}
            {isEditing && (
                <SessionEditPanel
                    session={session}
                    clientCurrency={client?.currency}
                    clientDefaultAccount={client?.defaultAccount}
                    onSave={async (data) => { await updateSession(session.id, data); setEditingId(null); toast.success('Сессия обновлена'); }}
                    onQuickPay={async (acc) => { await quickPaySession(session.id, acc); toast.success('Оплата отмечена'); }}
                    onCancel={() => setEditingId(null)}
                    onBookCab={() => onBookCab(session, client?.name || 'Клиент')}
                    onDelete={() => { setEditingId(null); setDeleteOpen(true); }}
                    onRefresh={() => useCrmStore.getState().fetchSessions({ dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'), dateTo: format(addDays(new Date(), 60), 'yyyy-MM-dd') })}
                />
            )}
            <DeleteSessionModal
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onConfirm={handleDelete}
                isRecurring={Boolean(session.recurringGroupId)}
                label={`${client?.name || 'Клиент'} — ${dayTime(dt)}`}
            />
        </>
    );
}

/** «С кабинетом» — у сессии есть бронь кабинета (статус ok, не бирюза). */
function BookedMark({ style }: { style?: React.CSSProperties }) {
    return (
        <span
            title="Кабинет забронирован"
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 500,
                color: STATUS.ok.fg, whiteSpace: 'nowrap', ...style,
            }}
        >
            <Check size={12} aria-hidden="true" /> Кабинет
        </span>
    );
}
