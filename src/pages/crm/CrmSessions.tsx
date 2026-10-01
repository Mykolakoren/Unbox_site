import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import {
    Plus,
    Check,
    X,
    Loader2,
    Banknote,
    LayoutGrid,
    RefreshCw,
    Unlink,
    AlertTriangle,
    MoreHorizontal,
    Pencil,
    Trash2,
} from 'lucide-react';
import {
    format, startOfMonth, endOfMonth, addMonths, subMonths, addDays,
    startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isToday as isTodayFn,
} from 'date-fns';
import { AccountSelect } from '../../components/crm/AccountSelect';
import { toast } from 'sonner';
import { crmApi } from '../../api/crm';
import type { CrmSession, CrmSessionUpdate, CrmClient, CrmPayment } from '../../api/crm';
import { DeleteSessionModal } from '../../components/crm/DeleteSessionModal';
import { NewSessionSheet } from '../../components/crm/NewSessionSheet';
import { toGel, CURRENCIES } from '../../utils/currency';
import { parseUTC } from '../../utils/dateUtils';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { statusLabel } from '../../design/statuses';
import { STATUS, SHADOW, Z } from '../../design/tokens';
import { formatMoney, formatGel, formatDayMonth, formatDateLabel, formatMonthLabel, formatTime } from '../../utils/format';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { undoToast } from '../../components/ui/undoToast';
import { toastApiError } from '../../utils/errors';
import { defaultPaymentAccount } from '../../utils/paymentAccounts';
import { utcNaiveToTbilisi } from '../../utils/crmNextSession';
import { sessionDebt, sessionCurrencyOf, partialPayment, quickPayUndoable } from '../../utils/sessionMoney';

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

/** Оплата в один клик (решение В5): «Отметить оплату · 140 ₾» пишет платёж
 *  на счёт клиента по умолчанию (ТОЛЬКО quickPaySession — стор ловит двойной
 *  клик), затем тост «Отмечено · 140 ₾» с «Вернуть» на 5 с. «Вернуть» —
 *  тот же путь, что снятие оплаты в шторке сессии: unmarkPaidSession
 *  снимает отметку и удаляет платёж. */
async function payWithUndo(
    sessionId: string,
    quickPay: (id: string, account?: string) => Promise<{ amount: number; currency: string; added?: number; created?: boolean }>,
    onChanged: () => void,
): Promise<void> {
    let res: { amount: number; currency: string; added?: number; created?: boolean };
    try {
        res = await quickPay(sessionId);
    } catch {
        // Стор уже показал «Не удалось отметить оплату».
        return;
    }
    onChanged();
    const added = res.added ?? res.amount;
    const sum = added ? ` · ${formatMoney(added, { currency: res.currency || 'GEL' })}` : '';
    if (!quickPayUndoable(res)) {
        // Доплата к уже внесённому: «Вернуть» стёрло бы всю оплату сессии — не предлагаем.
        toast.success(`Доплата принята${sum}`);
        return;
    }
    undoToast(`Отмечено${sum}`, async () => {
        try {
            await crmApi.unmarkPaidSession(sessionId);
            toast.success('Отметка об оплате снята');
        } catch (e) {
            toastApiError(e, 'Не удалось снять отметку об оплате. Обновите страницу и попробуйте ещё раз');
        } finally {
            onChanged();
        }
    });
}

type ViewMode = 'list' | 'week';

export function CrmSessions() {
    useDocumentTitle('Сессии · Psy-CRM');
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const { sessions, clients, fetchSessions, fetchClients, updateSession, deleteSession, quickPaySession, loading, error } =
        useCrmStore();
    // Админ смотрит чужой кабинет — создавать сессии отсюда нельзя.
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    // Пока первый ответ не пришёл — скелетон, а не «Сессий нет» (rule 8).
    const [fetchedOnce, setFetchedOnce] = useState(false);
    const [view, setView] = useState<ViewMode>('list');
    // Default: show previous month with COMPLETED filter so history is visible on first open
    const [currentMonth, setCurrentMonth] = useState(() => new Date());
    const [weekAnchor, setWeekAnchor] = useState(new Date());
    const [statusFilter, setStatusFilter] = useState<string>(
        (location.state as any)?.statusFilter || 'COMPLETED'
    );
    // «Новая сессия» — общая шторка (волна 3): «+ Новая», «+ Сессия» в
    // неделе, кнопка быстрых действий и ссылка /crm/sessions?new=1.
    const [newOpen, setNewOpen] = useState(false);
    // Только что созданная сессия: прокрутить к ней и подсветить (G5-M1).
    const [highlightId, setHighlightId] = useState<string | null>(null);
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

    // /crm/sessions?new=1 — сразу открыть «Новую сессию», а параметр убрать,
    // чтобы «назад» и обновление страницы не открывали её снова.
    useEffect(() => {
        if (searchParams.get('new') !== '1') return;
        if (!viewingOther) setNewOpen(true);
        const next = new URLSearchParams(searchParams);
        next.delete('new');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams, viewingOther]);

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
    // Отметили/сняли оплату — перечитать платежи месяца (иначе «Касса» стоит).
    const [paymentsVersion, setPaymentsVersion] = useState(0);

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
    }, [monthStart, monthEnd, paymentsVersion]);

    /** Перечитать сессии и платежи (после оплаты, «Вернуть», отвязки кабинета). */
    const reload = () => {
        fetchSessions({ dateFrom, dateTo });
        setPaymentsVersion(v => v + 1);
    };

    /** Сессию записали в шторке: шторка стор не трогает — перечитываем сами,
     *  включаем «Все» (новая — запланированная, в «Прошли» её не видно),
     *  листаем к ней и подсвечиваем (G5-M1). */
    const handleCreated = (session: CrmSession) => {
        setStatusFilter('all');
        setEditingId(null);
        setHighlightId(session.id);
        const ymd = utcNaiveToTbilisi(session.date)?.date;
        if (ymd) setWeekAnchor(new Date(`${ymd}T12:00:00`));
        if (ymd && (ymd < dateFrom || ymd > dateTo)) {
            // Другой месяц — смена месяца сама перечитает список.
            setCurrentMonth(new Date(`${ymd}T12:00:00`));
        } else {
            fetchSessions({ dateFrom, dateTo });
        }
    };

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

        // Debt by currency — остаток по неоплаченным завершённым сессиям (цена минус
        // внесённое), а не вся цена: частично оплаченная сессия не висит в долге целиком.
        const debtByCur: Record<string, number> = {};
        unpaidSessions.forEach(s => {
            const d = sessionDebt(s, clientMap.get(s.clientId));
            if (d.amount > 0) debtByCur[d.currency] = (debtByCur[d.currency] || 0) + d.amount;
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
            toastApiError(err, 'Не удалось синхронизировать с Google Календарём. Попробуйте ещё раз');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <>
            <GridHouseCrmSessions
                view={view} setView={setView}
                currentMonth={currentMonth} setCurrentMonth={setCurrentMonth}
                weekAnchor={weekAnchor} setWeekAnchor={setWeekAnchor}
                statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                onNewSession={viewingOther ? undefined : () => setNewOpen(true)}
                highlightId={highlightId} setHighlightId={setHighlightId}
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
                loading={loading || !fetchedOnce}
                loadError={fetchedOnce && !loading ? error : null}
                onRetry={() => { fetchClients(); fetchSessions({ dateFrom, dateTo }); }}
                onReload={reload}
                updateSession={updateSession}
                deleteSession={deleteSession} quickPaySession={quickPaySession}
                handleBookCab={handleBookCab}
                navigate={navigate}
            />
            <NewSessionSheet
                open={newOpen}
                onClose={() => setNewOpen(false)}
                onCreated={handleCreated}
                clients={clients.filter(c => c.isActive)}
            />
        </>
    );
}

/** Неделя — дни по Grid House: заголовок дня и те же строки сессий, что в
 *  списке (одно главное действие + «⋯ Ещё»). Раньше тут были скруглённые
 *  карточки, зелёные значки кабинета и серые кнопки Tailwind (G5-11). */
function WeekCalendar({
    weekAnchor,
    sessions,
    clientMap,
    navigate,
    onAddSession,
    rowProps,
}: {
    weekAnchor: Date;
    sessions: CrmSession[];
    clientMap: Map<string, CrmClient>;
    navigate: ReturnType<typeof useNavigate>;
    /** Нет — создание скрыто (просмотр чужого кабинета). */
    onAddSession?: () => void;
    rowProps: Omit<GHSessionRowProps, 'session' | 'client' | 'narrow'>;
}) {
    const weekStart = startOfWeek(weekAnchor, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(weekAnchor, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
    const quietBtn: React.CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32, padding: '0 10px',
        fontFamily: GH_SANS, fontSize: 12, fontWeight: 500, background: 'transparent',
        border: ghsHairline, color: GH.ink, cursor: 'pointer',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {days.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const daySessions = sessions.filter(s => {
                    const sDay = format(parseSessionDate(s.date), 'yyyy-MM-dd');
                    return sDay === dayStr;
                }).sort((a, b) => a.date.localeCompare(b.date));

                const today = isTodayFn(day);

                return (
                    <section key={dayStr} aria-label={formatDateLabel(dayStr)} style={{ borderTop: `1px solid ${today ? GH.ink : GH.ink10}` }}>
                        {/* Day header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                                <span style={{ fontFamily: GH_SANS, fontSize: 14, fontWeight: 600, color: GH.ink }}>
                                    {formatDateLabel(dayStr, { capitalize: true })}
                                    {today && ' · сегодня'}
                                </span>
                                {daySessions.length > 0 && (
                                    <span style={{ ...ghsMono }}>
                                        {daySessions.length} {sessionsWord(daySessions.length)}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {/* Шахматка — только в «Бронированиях» (В4). */}
                                <button type="button" onClick={() => navigate('/crm/bookings')} style={quietBtn}>
                                    <LayoutGrid size={14} aria-hidden="true" />
                                    Кабинеты
                                </button>
                                {onAddSession && (
                                    <button type="button" onClick={onAddSession} style={quietBtn}>
                                        <Plus size={14} aria-hidden="true" />
                                        Сессия
                                    </button>
                                )}
                            </div>
                        </div>

                        {daySessions.length > 0 ? (
                            <div style={{ borderTop: ghsHairline }}>
                                {daySessions.map(session => (
                                    <GHSessionRow
                                        key={session.id}
                                        session={session}
                                        client={clientMap.get(session.clientId)}
                                        narrow
                                        {...rowProps}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div style={{ padding: '4px 0 8px', fontSize: 14, color: GH.ink60 }}>Нет сессий</div>
                        )}
                    </section>
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
    // Валюта сессии (замороженная, иначе клиента): раньше здесь правилась одна цена,
    // а валюта терялась. Шлём её, только если её поменяли.
    const startCurrency = sessionCurrencyOf(session, { currency: clientCurrency });
    const [currency, setCurrency] = useState(startCurrency);
    const [clientId, setClientId] = useState(session.clientId);
    const [isPaid, setIsPaid] = useState(session.isPaid);
    // Счёт оплаты: уже стоящий на сессии, иначе счёт клиента по умолчанию, иначе наличные.
    // Это значение уходит в «Отметить оплату» явно и главнее всего, поэтому берём не только
    // счёт клиента — иначе сессия со своим счётом платилась бы на клиентский.
    const [account, setAccount] = useState(
        () => defaultPaymentAccount(useCrmStore.getState().paymentAccounts, session.account ?? clientDefaultAccount),
    );
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
            if (currency !== startCurrency) updateData.currency = currency;
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
            // Ошибки запроса стор уже показал («Не удалось обновить сессию» /
            // «…отметить оплату»); здесь — только наши (например, кривая дата).
            if (!err?.isAxiosError) toast.error('Не удалось сохранить сессию. Проверьте дату и время');
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
            // Ошибку запроса стор уже показал («Не удалось обновить сессию»).
            if (!err?.isAxiosError) toast.error('Не удалось отменить сессию. Попробуйте ещё раз');
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
            toastApiError(err, 'Не удалось отвязать кабинет. Попробуйте ещё раз');
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
            toastApiError(err, 'Не удалось отвязать кабинет. Попробуйте ещё раз');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            aria-label="Правка сессии"
            className="px-4 py-3 space-y-3"
            style={{ background: GH.sunken, borderBottom: `1px solid ${GH.ink}`, borderLeft: `2px solid ${GH.ink}` }}
        >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Дата и время</label>
                    <input
                        type="datetime-local"
                        lang="ru"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card"
                    />
                    {/* Поле браузер рисует на языке системы («10/07/2026, 02:00 PM») —
                        ниже та же дата по-русски из format.ts. */}
                    {date && (
                        <div className="text-xs mt-1" style={{ color: GH.ink60 }}>
                            {formatDateLabel(new Date(date), { capitalize: true, withYear: 'auto' })}, {formatTime(new Date(date))}
                        </div>
                    )}
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
                        Цена, {currencySign(currency)}
                    </label>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card"
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-unbox-dark mb-1 block">Валюта</label>
                    <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-card"
                    >
                        {(CURRENCIES.some(c => c.code === currency) ? CURRENCIES : [...CURRENCIES, { code: currency, symbol: currency, label: currency }])
                            .map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                    </select>
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

// ─── Grid House: CrmSessions ─────────────────────────────────────────────────

interface GHSessionsProps {
    view: ViewMode; setView: (v: ViewMode) => void;
    currentMonth: Date; setCurrentMonth: (d: Date) => void;
    weekAnchor: Date; setWeekAnchor: React.Dispatch<React.SetStateAction<Date>>;
    statusFilter: string; setStatusFilter: (s: string) => void;
    /** Нет — создание скрыто (просмотр чужого кабинета). */
    onNewSession?: () => void;
    highlightId: string | null; setHighlightId: (id: string | null) => void;
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
    loading: boolean;
    loadError: string | null;
    onRetry: () => void;
    onReload: () => void;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string, scope?: 'this' | 'future') => Promise<{ deleted: number; deletedGcal: number }>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string; added?: number; created?: boolean }>;
    handleBookCab: (session: CrmSession, clientName: string) => void;
    navigate: ReturnType<typeof useNavigate>;
}

const ghsMono = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: GH.ink60 };
const ghsHairline = `1px solid ${GH.ink10}`;
// Колонки таблицы сессий: шапка и строки — одна сетка. В строке одно главное
// действие («Отметить оплату · 140 ₾» или «Кабинет») и «⋯ Ещё» (G5-08).
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
    // «Шахматка» отсюда убрана: она живёт в «Бронированиях» (В4).
    const VIEW_MODES: { key: ViewMode; label: string }[] = [
        { key: 'list', label: 'Список' },
        { key: 'week', label: 'Неделя' },
    ];

    const STATUS_TABS: { key: string; label: string }[] = [
        { key: 'all', label: 'Все' },
        { key: 'PLANNED', label: 'Запланированы' },
        { key: 'COMPLETED', label: 'Прошли' },
        { key: 'CANCELLED_CLIENT', label: 'Отменены' },
    ];

    const allRows = [...p.upcomingGroups, ...p.pastGroups];

    // Новая сессия появилась в списке — листаем к ней и подсвечиваем (G5-M1).
    const { highlightId, setHighlightId } = p;
    useEffect(() => {
        if (!highlightId) return;
        const el = document.getElementById(`crm-session-${highlightId}`);
        if (!el) return;
        const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        el.focus({ preventScroll: true });
        const t = window.setTimeout(() => setHighlightId(null), 4000);
        return () => window.clearTimeout(t);
    }, [highlightId, setHighlightId, p.sessions, p.view]);

    const rowProps: Omit<GHSessionRowProps, 'session' | 'client' | 'narrow'> = {
        editingId: p.editingId,
        setEditingId: p.setEditingId,
        highlightId: p.highlightId,
        updateSession: p.updateSession,
        deleteSession: p.deleteSession,
        quickPaySession: p.quickPaySession,
        onBookCab: p.handleBookCab,
        onReload: p.onReload,
        touch: ghNarrow,
    };

    const tabStyle = (active: boolean): React.CSSProperties => ({
        fontFamily: GH_SANS, fontSize: 14, fontWeight: active ? 600 : 500,
        minHeight: 40, padding: '0 16px',
        background: active ? GH.ink : 'transparent',
        color: active ? GH.paper : GH.ink60,
        border: 'none', cursor: 'pointer',
        marginBottom: -2,
        borderBottom: active ? `2px solid ${GH.ink}` : '2px solid transparent',
        transition: 'background 120ms, color 120ms',
    });

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* ── Шапка: общий PageHeader (G5-22) — тот же размер заголовка
                и левый край, что у остальных экранов CRM. ── */}
            <PageHeader
                title="Сессии"
                description={`Прошло ${p.stats.completed} · ${formatMonthLabel(p.currentMonth)}`}
                actions={(
                    <>
                        <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => p.setShowSyncModal(true)}>
                            Синхронизация
                        </Button>
                        {p.onNewSession && (
                            <Button icon={<Plus size={16} aria-hidden="true" />} onClick={p.onNewSession}>
                                Новая
                            </Button>
                        )}
                    </>
                )}
            />

            {/* ── Деньги и счётчики месяца. Формулы — в CrmSessions (stats). ── */}
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 24 }}>
                {[
                    { label: 'Запланировано', value: String(p.stats.planned), color: undefined as string | undefined, sub: undefined as string | undefined, multiline: false, hint: 'Сессии этого месяца, которые ещё впереди' },
                    { label: 'Не оплачено', value: String(p.stats.unpaidCount), color: p.stats.unpaidCount > 0 ? GH.danger : undefined, sub: p.stats.debtLabel, multiline: false, hint: 'Прошедшие сессии без оплаты — долг клиентов за всё время' },
                    { label: 'Заработано', value: p.stats.earnedLabel, color: undefined, sub: p.stats.earnedGel, multiline: true, hint: 'Проведённые и оплаченные сессии этого месяца — по дате сессии' },
                    { label: 'Касса · с долгами', value: p.stats.revenueLabel, color: GH.ink60, sub: p.stats.revenueGel, multiline: true, hint: 'Все деньги, полученные в этом месяце, включая оплату старых долгов. Бывает больше или меньше «Заработано»' },
                ].map(kpi => (
                    <div key={kpi.label} title={kpi.hint} style={{ minWidth: 0, cursor: 'help' }}>
                        <div style={{ ...ghsMono }}>{kpi.label}</div>
                        <div style={{
                            fontSize: 20,
                            fontWeight: 600,
                            marginTop: 4,
                            fontVariantNumeric: 'tabular-nums',
                            color: kpi.color || GH.ink,
                            whiteSpace: kpi.multiline && ghNarrow ? ('pre-line' as const) : ('normal' as const),
                            wordBreak: 'break-word' as const,
                            lineHeight: 1.25,
                        }}>
                            {kpi.multiline && ghNarrow ? kpi.value.split(' · ').join('\n') : kpi.value}
                        </div>
                        {kpi.sub && <div style={{ fontSize: 12, color: kpi.color || GH.ink60, marginTop: 2 }}>{kpi.sub}</div>}
                    </div>
                ))}
            </div>

            {/* ── View mode tabs ── */}
            <div role="tablist" aria-label="Вид" style={{ display: 'flex', borderBottom: `2px solid ${GH.ink}` }}>
                {VIEW_MODES.map(v => (
                    <button
                        key={v.key}
                        type="button"
                        role="tab"
                        aria-selected={p.view === v.key}
                        onClick={() => p.setView(v.key)}
                        style={tabStyle(p.view === v.key)}
                    >
                        {v.label}
                    </button>
                ))}
            </div>

            {/* ── Content ── */}
            <div style={{ paddingBottom: 64 }}>
                {p.view === 'week' ? (
                    <div style={{ marginTop: 16 }}>
                        {/* Week nav */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                            <Button variant="secondary" aria-label="Предыдущая неделя" onClick={() => p.setWeekAnchor(d => subWeeks(d, 1))}>
                                &larr;
                            </Button>
                            <span style={{ fontFamily: GH_SANS, fontSize: 14, fontWeight: 500 }}>
                                {formatDayMonth(startOfWeek(p.weekAnchor, { weekStartsOn: 1 }))} &ndash;{' '}
                                {formatDayMonth(endOfWeek(p.weekAnchor, { weekStartsOn: 1 }), { withYear: 'auto' })}
                            </span>
                            <Button variant="secondary" aria-label="Следующая неделя" onClick={() => p.setWeekAnchor(d => addWeeks(d, 1))}>
                                &rarr;
                            </Button>
                            {!isTodayFn(p.weekAnchor) && (
                                <Button variant="quiet" onClick={() => p.setWeekAnchor(new Date())}>
                                    Эта неделя
                                </Button>
                            )}
                        </div>
                        {p.loadError && (
                            <ErrorBar message="Не удалось загрузить сессии" onRetry={p.onRetry} retrying={p.loading} className="mb-3" />
                        )}
                        <WeekCalendar
                            weekAnchor={p.weekAnchor} sessions={p.sessions} clientMap={p.clientMap}
                            navigate={p.navigate}
                            onAddSession={p.onNewSession}
                            rowProps={rowProps}
                        />
                    </div>
                ) : (
                    <div ref={listRef}>
                        {/* Month nav + status filters */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 16, paddingBottom: 12, borderBottom: ghsHairline }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Button variant="secondary" aria-label="Предыдущий месяц" onClick={() => p.setCurrentMonth(subMonths(p.currentMonth, 1))}>
                                    &larr;
                                </Button>
                                <span style={{ fontFamily: GH_SANS, fontSize: 14, fontWeight: 500, minWidth: 120, textAlign: 'center' as const }}>
                                    {formatMonthLabel(p.currentMonth, { capitalize: true })}
                                </span>
                                <Button variant="secondary" aria-label="Следующий месяц" onClick={() => p.setCurrentMonth(addMonths(p.currentMonth, 1))}>
                                    &rarr;
                                </Button>
                            </div>
                            <div role="group" aria-label="Статус" style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
                                {STATUS_TABS.map(s => (
                                    <button
                                        key={s.key}
                                        type="button"
                                        aria-pressed={p.statusFilter === s.key}
                                        onClick={() => p.setStatusFilter(s.key)}
                                        style={{
                                            fontFamily: GH_SANS, fontSize: 14, fontWeight: p.statusFilter === s.key ? 600 : 500,
                                            minHeight: 40, padding: '0 14px', background: 'transparent',
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
                            <div aria-hidden="true" style={{
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
                                        ? 'Добавьте сессию или подтяните её из Google Календаря.'
                                        : 'Новые сессии попадают во «Все» и «Запланированы».'}
                                    action={p.statusFilter === 'all'
                                        ? (p.onNewSession ? { label: 'Новая сессия', onClick: p.onNewSession } : undefined)
                                        : { label: 'Показать все', onClick: () => p.setStatusFilter('all') }}
                                />
                            )
                        ) : (
                            <div>
                                {allRows.map(([day, daySessions]) => (
                                    <section key={day} aria-label={formatDateLabel(day)}>
                                        {/* Day header */}
                                        <div style={{ padding: '16px 0 6px', borderBottom: ghsHairline }}>
                                            <span style={{ fontFamily: GH_SANS, fontSize: 14, fontWeight: 600 }}>
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
                                                    narrow={tableNarrow}
                                                    {...rowProps}
                                                />
                                            ))}
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Синхронизация с Google — на общей шторке (X4-04): Esc, фокус
                внутри, кнопки в подвале. Логика синка и исключений прежняя. */}
            <Sheet
                open={p.showSyncModal}
                onClose={() => { if (!p.syncing) p.setShowSyncModal(false); }}
                title="Синхронизация с Google Календарём"
                width={480}
                footer={(
                    <>
                        <Button block loading={p.syncing} onClick={() => p.handleSync(false)}>
                            {p.syncing ? 'Синхронизируем…' : 'Синхронизировать'}
                        </Button>
                        <Button block variant="secondary" disabled={p.syncing} onClick={() => p.handleSync(true)}>
                            Предпросмотр
                        </Button>
                    </>
                )}
            >
                <div className="space-y-5">
                    <div className="space-y-3">
                        <label className="block">
                            <span className="block text-sm font-medium mb-1" style={{ color: GH.ink }}>Период назад</span>
                            <select value={p.syncMonthsBack} onChange={e => p.setSyncMonthsBack(Number(e.target.value))}
                                className="w-full px-3 text-sm"
                                style={{ minHeight: 'var(--control-h)', border: `1px solid ${GH.ink20}`, borderRadius: 'var(--radius-control)', background: GH.card, color: GH.ink }}>
                                <option value={0}>Только текущий месяц</option>
                                <option value={1}>1 месяц</option>
                                <option value={3}>3 месяца</option>
                                <option value={6}>6 месяцев</option>
                            </select>
                        </label>
                        <label className="block">
                            <span className="block text-sm font-medium mb-1" style={{ color: GH.ink }}>Период вперёд</span>
                            <select value={p.syncMonthsForward} onChange={e => p.setSyncMonthsForward(Number(e.target.value))}
                                className="w-full px-3 text-sm"
                                style={{ minHeight: 'var(--control-h)', border: `1px solid ${GH.ink20}`, borderRadius: 'var(--radius-control)', background: GH.card, color: GH.ink }}>
                                <option value={1}>1 месяц</option>
                                <option value={2}>2 месяца</option>
                                <option value={3}>3 месяца</option>
                            </select>
                        </label>
                    </div>
                    {p.syncResult && (
                        <div className="p-4 text-sm space-y-1" style={{ background: GH.sunken, borderRadius: 'var(--radius-control)' }}>
                            <div className="font-medium mb-2">{p.syncResult.dryRun ? 'Предпросмотр (ничего не изменено):' : 'Результат:'}</div>
                            <div className="flex justify-between"><span style={{ color: GH.ink60 }}>Событий в календаре</span><span className="font-medium">{p.syncResult.totalEvents ?? 0}</span></div>
                            {p.syncResult.dryRun ? (
                                <>
                                    <div className="flex justify-between"><span style={{ color: GH.ink60 }}>Узнали клиента</span><span className="font-medium">{p.syncResult.matched ?? 0}</span></div>
                                    <div className="flex justify-between"><span style={{ color: GH.ink60 }}>Новых карточек клиентов</span><span className="font-medium text-[var(--status-ok-fg)]">{(p.syncResult.wouldCreateNames || []).filter((n: any) => !n.looksNonClient && !p.syncExcluded.has(n.name)).length}</span></div>
                                </>
                            ) : (
                                <>
                                    <div className="flex justify-between"><span style={{ color: GH.ink60 }}>Создано</span><span className="font-medium text-[var(--status-ok-fg)]">{p.syncResult.created ?? 0}</span></div>
                                    <div className="flex justify-between"><span style={{ color: GH.ink60 }}>Обновлено</span><span className="font-medium">{p.syncResult.updated ?? 0}</span></div>
                                </>
                            )}
                            {p.syncResult.dryRun && (p.syncResult.wouldCreateNames || []).length > 0 && (
                                <div className="mt-2 p-2.5" style={{ background: GH.card, border: `1px solid ${GH.ink10}`, borderRadius: 'var(--radius-control)' }}>
                                    <div className="font-semibold" style={{ color: GH.ink }}>Кто станет новой карточкой клиента</div>
                                    <div className="text-xs mt-0.5 mb-1.5" style={{ color: GH.ink60 }}>
                                        Снимите галочку, если это не клиент — такие события не будут превращаться в карточки и при автосинке.
                                    </div>
                                    {(p.syncResult.wouldCreateNames || []).map((n: any) => (
                                        n.looksNonClient ? (
                                            <div key={n.name} className="text-xs py-1" style={{ color: GH.ink60 }} title="Похоже на личное дело — карточку не создадим">
                                                — {n.name} <span className="italic">(похоже не клиент, пропустим)</span>
                                            </div>
                                        ) : (
                                            <label key={n.name} className="flex items-center gap-2 py-1.5 text-sm cursor-pointer" style={{ minHeight: 36 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={!p.syncExcluded.has(n.name)}
                                                    onChange={e => {
                                                        const next = new Set(p.syncExcluded);
                                                        if (e.target.checked) next.delete(n.name); else next.add(n.name);
                                                        p.setSyncExcluded(next);
                                                    }}
                                                    className="w-4 h-4"
                                                    style={{ accentColor: GH.accent }}
                                                />
                                                <span className={p.syncExcluded.has(n.name) ? 'line-through' : ''} style={p.syncExcluded.has(n.name) ? { color: GH.ink60 } : undefined}>{n.name}</span>
                                            </label>
                                        )
                                    ))}
                                </div>
                            )}
                            {(p.syncResult.calendarDuplicatesCount ?? 0) > 0 && (
                                <div className="mt-2 p-2.5 bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]" style={{ borderRadius: 'var(--radius-control)' }}>
                                    <div className="font-semibold flex items-center gap-1.5">
                                        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                                        Дубли в календаре: {p.syncResult.calendarDuplicatesCount}
                                    </div>
                                    <div className="text-xs mt-1">
                                        На одну встречу стоит несколько событий — удалите лишнее в Google Календаре:
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
                </div>
            </Sheet>
        </div>
    );
}

// ─── «⋯ Ещё» — меню строки сессии ────────────────────────────────────────────

/** Пункт меню «⋯ Ещё». Подпись — действие («Изменить», «Удалить»). */
function MenuItem({ onSelect, danger, children, ...rest }: {
    onSelect: () => void; danger?: boolean; children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'>) {
    return (
        <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={onSelect}
            style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 'var(--control-h)',
                padding: '0 14px', background: 'transparent', border: 'none', textAlign: 'left',
                fontFamily: GH_SANS, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap',
                color: danger ? GH.danger : GH.ink, cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = GH.ink5)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onFocus={e => (e.currentTarget.style.background = GH.ink5)}
            onBlur={e => (e.currentTarget.style.background = 'transparent')}
            {...rest}
        >
            {children}
        </button>
    );
}

/** Кнопка «⋯» и выпадающее меню: Esc и клик мимо закрывают, стрелки
 *  ходят по пунктам, фокус возвращается на кнопку. */
function RowMenu({ size, children }: { size: number; children: (close: () => void) => React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const btnRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const close = (focusBack = true) => {
        setOpen(false);
        if (focusBack) btnRef.current?.focus();
    };

    useEffect(() => {
        if (!open) return;
        const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        items()[0]?.focus();
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); return; }
            if (e.key === 'Tab') { setOpen(false); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const list = items();
                const i = list.indexOf(document.activeElement as HTMLButtonElement);
                const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
                list[next]?.focus();
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
                ref={btnRef}
                type="button"
                aria-label="Ещё действия"
                title="Ещё"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                style={{
                    width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: open ? GH.ink5 : 'transparent', border: ghsHairline, cursor: 'pointer', color: GH.ink,
                }}
            >
                <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {open && (
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label="Действия с сессией"
                    style={{
                        position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 220,
                        background: GH.card, border: `1px solid ${GH.ink}`, boxShadow: SHADOW.pop,
                        zIndex: Z.dropdown, padding: '4px 0',
                    }}
                >
                    {children(() => close())}
                </div>
            )}
        </div>
    );
}

// ─── GH: Строка сессии ───────────────────────────────────────────────────────

interface GHSessionRowProps {
    session: CrmSession; client?: CrmClient;
    editingId: string | null; setEditingId: (id: string | null) => void;
    /** Только что созданная — подсветить. */
    highlightId: string | null;
    updateSession: (id: string, data: CrmSessionUpdate) => Promise<CrmSession>;
    deleteSession: (id: string, scope?: 'this' | 'future') => Promise<{ deleted: number; deletedGcal: number }>;
    quickPaySession: (id: string, account?: string) => Promise<{ amount: number; currency: string; added?: number; created?: boolean }>;
    onBookCab: (session: CrmSession, clientName: string) => void;
    /** Перечитать сессии и платежи месяца. */
    onReload: () => void;
    /** Карточка вместо строки таблицы (узкий контейнер). */
    narrow?: boolean;
    /** Телефон: цели касания 44 px. */
    touch?: boolean;
}

/**
 * Строка сессии (G5-08): одно главное действие —
 *   «Отметить оплату · 140 ₾», если сессия началась и не оплачена (В5: в один
 *   клик, тост «Отмечено · Вернуть»);
 *   иначе «Кабинет», если кабинета нет;
 * всё остальное — в «⋯ Ещё». Клик по строке (или Enter на ней) открывает
 * правку, имя клиента — ссылка на карточку.
 */
function GHSessionRow({
    session, client, editingId, setEditingId, highlightId, updateSession, deleteSession, quickPaySession,
    onBookCab, onReload, narrow, touch: touchScreen,
}: GHSessionRowProps) {
    const dt = parseSessionDate(session.date);
    const isEditing = editingId === session.id;
    const highlighted = highlightId === session.id;
    const effectiveStatus = getEffectiveStatus(session);
    const isCancelled = effectiveStatus === 'CANCELLED_CLIENT' || effectiveStatus === 'CANCELLED_THERAPIST';
    const clientName = client?.name || 'Клиент';
    // Одни слова для оплаты во всей CRM (G5-06): «Оплачено» — статус,
    // «Отметить оплату» — действие.
    // В узкой колонке таблицы длинный статус («Отменил специалист») переносится.
    const badgeClass = narrow ? undefined : 'whitespace-normal';
    const statusBadge = session.isPaid
        ? <StatusBadge kind="payment" status="paid" audience="staff" variant="dot" className={badgeClass} />
        : <StatusBadge kind="session" status={effectiveStatus} audience="staff" variant="dot" className={badgeClass} />;
    const amount = session.price ?? client?.basePrice;
    const price = formatMoney(amount, { currency: sessionCurrencyOf(session, client) });
    // На кнопке оплаты — остаток (цена минус внесённое), а не вся цена.
    const owed = sessionDebt(session, client);
    const owedText = formatMoney(owed.amount, { currency: owed.currency });
    const payVerb = partialPayment(session, client) ? 'Доплатить' : 'Отметить оплату';

    const canPay = !session.isPaid && !isCancelled;
    const canBook = !session.isBooked && !isCancelled;
    const primary: 'pay' | 'cab' | null = canPay && isPastSession(session) ? 'pay' : canBook ? 'cab' : null;

    // Кнопки строки: Plex Sans 12 px, без капса; на узком экране — 44 px (rule 9).
    const size = touchScreen ? 44 : 32;
    const mainBtnStyle: React.CSSProperties = {
        fontFamily: GH_SANS, fontSize: 12, fontWeight: 500, minHeight: size, padding: '0 10px',
        display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
        border: 'none', cursor: 'pointer',
    };

    const [paying, setPaying] = useState(false);
    const handleQuickPay = async () => {
        if (paying) return;
        setPaying(true);
        try { await payWithUndo(session.id, quickPaySession, onReload); } finally { setPaying(false); }
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
            // Стор уже показал «Не удалось удалить сессию».
        }
    };

    const toggleEdit = () => setEditingId(isEditing ? null : session.id);
    // Клик по пустому месту строки — правка; по кнопкам и ссылке — их действие.
    const onRowClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, a, input, select, [role="menu"]')) return;
        toggleEdit();
    };
    const onRowKey = (e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleEdit(); }
    };

    const nameLink = (
        <Link
            to={`/crm/clients/${session.clientId}`}
            style={{ color: 'inherit', textDecoration: 'none', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
        >
            {clientName}
        </Link>
    );

    const actions = (
        <>
            {primary === 'pay' && (
                <button type="button" onClick={handleQuickPay} disabled={paying} aria-busy={paying || undefined}
                    style={{ ...mainBtnStyle, background: GH.ink, color: GH.paper, opacity: paying ? 0.6 : 1 }}>
                    {narrow && <Banknote size={14} aria-hidden="true" />}
                    {paying ? 'Отмечаем…' : (owed.amount ? `${payVerb} · ${owedText}` : 'Отметить оплату')}
                </button>
            )}
            {primary === 'cab' && (
                <button type="button" onClick={() => onBookCab(session, clientName)}
                    title="Забронировать кабинет под эту сессию"
                    style={{ ...mainBtnStyle, background: 'transparent', border: ghsHairline, color: GH.ink }}>
                    <Plus size={14} aria-hidden="true" /> Кабинет
                </button>
            )}
            <RowMenu size={size}>
                {close => (
                    <>
                        <MenuItem aria-label="Изменить сессию" onSelect={() => { close(); toggleEdit(); }}>
                            <Pencil size={14} aria-hidden="true" /> {isEditing ? 'Закрыть правку' : 'Изменить'}
                        </MenuItem>
                        {canPay && primary !== 'pay' && (
                            <MenuItem onSelect={() => { close(); handleQuickPay(); }}>
                                <Banknote size={14} aria-hidden="true" /> {payVerb}{owed.amount ? ` · ${owedText}` : ''}
                            </MenuItem>
                        )}
                        {canBook && primary !== 'cab' && (
                            <MenuItem onSelect={() => { close(); onBookCab(session, clientName); }}>
                                <LayoutGrid size={14} aria-hidden="true" /> Забронировать кабинет
                            </MenuItem>
                        )}
                        {/* Удаление — через общее окно (серия: «только эту / эту и
                            будущие»). Красный — только здесь и в самом окне. */}
                        <MenuItem danger aria-label="Удалить сессию" onSelect={() => { close(); setDeleteOpen(true); }}>
                            <Trash2 size={14} aria-hidden="true" /> Удалить
                        </MenuItem>
                    </>
                )}
            </RowMenu>
        </>
    );

    const rowBase: React.CSSProperties = {
        borderBottom: ghsHairline,
        // Отменённые — приглушаем цветом, не прозрачностью (текст не бледнее ink-60).
        color: isCancelled ? GH.ink60 : undefined,
        background: highlighted ? COLOR_HIGHLIGHT : isEditing ? GH.ink5 : 'transparent',
        transition: 'background 400ms',
        cursor: 'pointer',
        outlineOffset: -2,
    };

    return (
        <>
            {narrow ? (
                /* ── Узко: карточка ── */
                <div id={`crm-session-${session.id}`} tabIndex={0} onClick={onRowClick} onKeyDown={onRowKey}
                    title="Нажмите, чтобы изменить" style={{ ...rowBase, padding: '12px 4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                                <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatTime(dt)}</span>
                                {nameLink}
                                {session.isBooked && <BookedMark />}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>{session.durationMinutes} мин</span>
                                <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{price}</span>
                                {statusBadge}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                            {actions}
                        </div>
                    </div>
                </div>
            ) : (
                /* ── Таблица ── */
                <div
                    id={`crm-session-${session.id}`}
                    tabIndex={0}
                    onClick={onRowClick}
                    onKeyDown={onRowKey}
                    title="Нажмите, чтобы изменить"
                    style={{
                        ...rowBase,
                        display: 'grid', gridTemplateColumns: GH_ROW_COLUMNS, columnGap: GH_ROW_GAP,
                        alignItems: 'center', padding: '8px 0',
                    }}
                    onMouseEnter={e => { if (!highlighted && !isEditing) e.currentTarget.style.background = GH.ink5; }}
                    onMouseLeave={e => { if (!highlighted && !isEditing) e.currentTarget.style.background = 'transparent'; }}
                >
                    <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatTime(dt)}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', minWidth: 0 }}>
                        {nameLink}
                        {session.isBooked && <BookedMark style={{ marginLeft: 8 }} />}
                    </div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>{session.durationMinutes}′</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{price}</div>
                    <div>{statusBadge}</div>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
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
                    onSave={async (data) => { await updateSession(session.id, data); setEditingId(null); toast.success('Сессия обновлена'); onReload(); }}
                    onQuickPay={async (acc) => { await quickPaySession(session.id, acc); toast.success('Оплата отмечена'); onReload(); }}
                    onCancel={() => setEditingId(null)}
                    onBookCab={() => onBookCab(session, clientName)}
                    onDelete={() => { setEditingId(null); setDeleteOpen(true); }}
                    onRefresh={onReload}
                />
            )}
            <DeleteSessionModal
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onConfirm={handleDelete}
                isRecurring={Boolean(session.recurringGroupId)}
                label={`${clientName} — ${dayTime(dt)}`}
            />
        </>
    );
}

/** Подложка только что созданной сессии — «выбрано» (бирюза-soft). */
const COLOR_HIGHLIGHT = 'var(--color-accent-soft)';

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
