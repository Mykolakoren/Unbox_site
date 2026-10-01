import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { totalInGel } from '../../utils/currency';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    CartesianGrid,
} from 'recharts';
import { format, addMonths, subMonths, isAfter, addDays } from 'date-fns';
import { crmApi, type CrmClient, type CrmSession } from '../../api/crm';
import { parseUTC } from '../../utils/dateUtils';
import { useUserStore } from '../../store/userStore';
import { RESOURCES } from '../../utils/data';
import { toast } from 'sonner';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { STATUS } from '../../design/tokens';
import { formatMoney, formatGel, formatDayMonth, formatDateLabel, formatMonthLabel, formatTime } from '../../utils/format';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { undoToast } from '../../components/ui/undoToast';
import { NewSessionSheet } from '../../components/crm/NewSessionSheet';
import { NewClientSheet } from '../../components/crm/NewClientSheet';
import { UnpaidSessionsSheet } from '../../components/crm/UnpaidSessionsSheet';
import { toastApiError } from '../../utils/errors';
import { addDaysYmd, tbilisiToday, utcNaiveToTbilisi } from '../../utils/crmNextSession';
import { Check, Plus, Circle, CheckCircle2 } from 'lucide-react';

/** «1 сессия / 2 сессии / 5 сессий». */
function sessionsWord(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сессия';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сессии';
    return 'сессий';
}

/** «5 октября, 09:00». */
function dayTime(d: Date): string {
    return `${formatDayMonth(d, { withYear: 'auto' })}, ${formatTime(d)}`;
}

const CANCELLED = new Set(['CANCELLED_CLIENT', 'CANCELLED_THERAPIST']);

/** Сколько строк на полках «Долги» и «Без следующей встречи». */
const SHELF_LIMIT = 5;

export function CrmDashboard() {
    useDocumentTitle('Дашборд · Psy-CRM');
    const { dashboard, fetchDashboard, loading, error } = useCrmStore();
    const navigate = useNavigate();
    const [calendarIdSaved, setCalendarIdSaved] = useState<string | null>(null);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const monthStr = format(currentMonth, 'yyyy-MM');
    const isThisMonth = format(new Date(), 'yyyy-MM') === monthStr;
    // Ошибку показываем только после своей попытки загрузки, а не чужую из стора.
    const [dashTried, setDashTried] = useState(false);
    // Когда цифры на экране были свежими — для полосы «Показаны данные на 14:05».
    const [loadedAt, setLoadedAt] = useState<Date | null>(null);
    const reloadDashboard = () => fetchDashboard(monthStr).finally(() => {
        setDashTried(true);
        if (!useCrmStore.getState().error) setLoadedAt(new Date());
    });

    useEffect(() => {
        // Auto-complete past PLANNED sessions, then load dashboard
        crmApi.autoCompleteSessions().then((result) => {
            if (result.autoCompleted > 0) {
                const n = result.autoCompleted;
                toast.info(`${n} ${sessionsWord(n)} ${n === 1 ? 'отмечена прошедшей' : 'отмечены прошедшими'}`);
            }
        }).catch(() => {}).finally(() => {
            reloadDashboard();
        });
        crmApi.getSettings().then((s) => {
            setCalendarIdSaved(s.calendarId);
        }).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchDashboard, monthStr]);

    // Загрузка ≠ ошибка ≠ пусто (rule 8): пока данных нет — скелетон, а не
    // «0 ₾» и «нет сессий»; если запрос упал — полоса с «Повторить».
    if (!dashboard) {
        if (error && !loading && dashTried) {
            return <ErrorBar message="Не удалось загрузить кабинет" onRetry={reloadDashboard} />;
        }
        return (
            <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <span className="sr-only">Загружаем кабинет…</span>
                <Skeleton height={56} width="40%" radius={0} />
                <Skeleton height={120} radius={0} />
                <Skeleton height={120} radius={0} />
            </div>
        );
    }

    // Новый месяц не загрузился, а на экране остались прежние цифры — не
    // прячем их, а честно говорим над ними, что они не обновились.
    const staleError = !!error && !loading && dashTried;
    return (
        <>
            {staleError && (
                <ErrorBar
                    message={`Не удалось загрузить ${formatMonthLabel(currentMonth)}`}
                    onRetry={reloadDashboard}
                    staleAt={loadedAt ?? undefined}
                    className="mb-6"
                />
            )}
            <GridHouseDashboard
                dashboard={dashboard}
                currentMonth={currentMonth}
                setCurrentMonth={setCurrentMonth}
                isThisMonth={isThisMonth}
                navigate={navigate}
                calendarIdSaved={calendarIdSaved}
                reloadDashboard={reloadDashboard}
            />
        </>
    );
}


// ────────────────────────────────────────────────────────────────────────
// GRID HOUSE — дашборд CRM (волна 3, G5-04).
// Сверху то, что нужно сделать сегодня: «Сегодня» (все сессии дня, в т.ч.
// прошедшие, с оплатой в один клик), «Долги», «Без следующей встречи».
// Ниже — один ряд показателей месяца и график, ещё ниже — справочное.
// ────────────────────────────────────────────────────────────────────────

interface GHDashProps {
    dashboard: ReturnType<typeof useCrmStore.getState>['dashboard'];
    currentMonth: Date;
    setCurrentMonth: (d: Date) => void;
    isThisMonth: boolean;
    navigate: (path: string, state?: any) => void;
    calendarIdSaved: string | null;
    reloadDashboard: () => void;
}

const monoLabel: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: '12px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: GH.ink60,
    fontWeight: 500,
};
const sectionHead: React.CSSProperties = {
    fontFamily: GH_SANS,
    fontSize: '20px',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    margin: 0,
    color: GH.ink,
};
const hairline = `1px solid ${GH.ink10}`;
const linkStyle: React.CSSProperties = { color: 'inherit', textDecoration: 'none' };
const moreLinkStyle: React.CSSProperties = { fontFamily: GH_SANS, fontSize: 14, fontWeight: 500, color: GH.ink, textDecoration: 'underline', textUnderlineOffset: 3 };

/** Шапка полки: заголовок слева, ссылка/счётчик справа. */
function ShelfHead({ title, right }: { title: string; right?: React.ReactNode }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
            borderBottom: `1px solid ${GH.ink}`, paddingBottom: 10,
        }}>
            <h2 style={sectionHead}>{title}</h2>
            {right}
        </div>
    );
}

function GridHouseDashboard({ dashboard, currentMonth, setCurrentMonth, isThisMonth, navigate, calendarIdSaved, reloadDashboard }: GHDashProps) {
    // Excel #33 — show specialist's own coworking bookings (the cabinets
    // they've reserved as a renter) on the CRM dashboard alongside their
    // therapy sessions. Two separate worlds, but admins want one screen
    // to plan their week.
    const { bookings, fetchBookings, currentUser } = useUserStore();
    const quickPaySession = useCrmStore(s => s.quickPaySession);
    const viewAs = useCrmStore(s => s.viewAsSpecialistId);
    // Админ смотрит чужой кабинет — кнопки создания прячем.
    const viewingOther = !!viewAs;
    useEffect(() => { fetchBookings(); }, [fetchBookings]);

    // ── Клиенты: для имён в «Сегодня» и для шторок (нужен весь объект) ──
    const [clients, setClients] = useState<CrmClient[] | null>(null);
    const loadClients = useCallback(() => {
        crmApi.getClients(false, viewAs ?? undefined)
            .then(setClients)
            .catch(() => setClients(prev => prev ?? []));
    }, [viewAs]);
    useEffect(() => { loadClients(); }, [loadClients]);
    const clientById = useMemo(() => new Map((clients ?? []).map(c => [c.id, c])), [clients]);

    // ── «Сегодня»: ВСЕ сессии дня по Тбилиси, включая прошедшие ─────────
    // Сервер в upcomingSessions отдаёт только date >= now — прошедшие
    // сегодня (их как раз надо отметить оплатой) туда не попадают.
    const today = tbilisiToday();
    const [todayList, setTodayList] = useState<CrmSession[] | null>(null);
    const [todayFailed, setTodayFailed] = useState(false);
    const loadToday = useCallback(() => {
        setTodayFailed(false);
        // В базе UTC: день по Батуми начинается накануне в 20:00 UTC —
        // берём два дня и оставляем свой.
        crmApi.getSessions({ dateFrom: addDaysYmd(today, -1), dateTo: today, specialistId: viewAs ?? undefined })
            .then(list => setTodayList(
                list
                    .filter(s => utcNaiveToTbilisi(s.date)?.date === today)
                    .sort((a, b) => a.date.localeCompare(b.date)),
            ))
            .catch(() => setTodayFailed(true));
    }, [today, viewAs]);
    useEffect(() => { loadToday(); }, [loadToday]);

    /** Что-то поменялось в деньгах или сессиях — перечитать всё, что на экране. */
    const refreshAll = () => {
        loadToday();
        loadClients();
        reloadDashboard();
    };

    // ── Шторки ──────────────────────────────────────────────────────────
    // undefined — закрыта; null — «Новая сессия» с поиском клиента.
    const [newFor, setNewFor] = useState<CrmClient | null | undefined>(undefined);
    const [debtFor, setDebtFor] = useState<CrmClient | null>(null);
    const [newClientOpen, setNewClientOpen] = useState(false);

    // ── Оплата в один клик (В5) ─────────────────────────────────────────
    const [payingId, setPayingId] = useState<string | null>(null);
    const handlePay = async (s: CrmSession) => {
        if (payingId) return;
        setPayingId(s.id);
        let res: { amount: number; currency: string };
        try {
            // ТОЛЬКО quickPaySession: платёж на счёт клиента по умолчанию,
            // повторный клик ловит стор (_quickPayInFlight).
            res = await quickPaySession(s.id);
        } catch {
            // Стор уже показал «Не удалось отметить оплату».
            setPayingId(null);
            return;
        }
        setPayingId(null);
        setTodayList(list => list?.map(x => (x.id === s.id ? { ...x, isPaid: true } : x)) ?? list);
        reloadDashboard();
        const sum = res.amount ? ` · ${formatMoney(res.amount, { currency: res.currency || 'GEL' })}` : '';
        // «Вернуть» — тот же путь, что снятие оплаты в шторке сессии:
        // unmarkPaidSession снимает отметку и удаляет платёж.
        undoToast(`Отмечено${sum}`, async () => {
            try {
                await crmApi.unmarkPaidSession(s.id);
                toast.success('Отметка об оплате снята');
            } catch (e) {
                toastApiError(e, 'Не удалось снять отметку об оплате. Обновите страницу и попробуйте ещё раз');
            } finally {
                refreshAll();
            }
        });
    };

    // Кабинет под сессию — тот же путь, что в «Сессиях»: /dashboard/bookings
    // с привязкой брони к сессии.
    const bookCabinetFor = (s: CrmSession, clientName: string) => {
        navigate('/dashboard/bookings', {
            state: {
                crmMode: {
                    sessionId: s.id,
                    clientId: s.clientId,
                    clientName,
                    date: parseUTC(s.date).toISOString(),
                    duration: s.durationMinutes,
                },
            },
        });
    };

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
        } catch (e) {
            toastApiError(e, 'Не удалось объединить бронь и сессию. Попробуйте ещё раз');
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

    const monthLabel = formatMonthLabel(currentMonth, { capitalize: true });
    const revenueByCurrency = dashboard?.revenueByCurrency;
    const hasMultiCurrency = revenueByCurrency && Object.keys(revenueByCurrency).length > 1;
    const revenueValue = revenueByCurrency && Object.keys(revenueByCurrency).length > 0
        ? totalInGel(revenueByCurrency)
        : (dashboard?.revenueThisMonth ?? 0);
    const debtByCurrency = dashboard?.debtByCurrency;
    const hasDebt = (dashboard?.totalActiveDebt ?? 0) > 0 || (debtByCurrency && Object.keys(debtByCurrency).length > 0);
    const debtTotal = debtByCurrency && Object.keys(debtByCurrency).length > 0
        ? totalInGel(debtByCurrency)
        : 0;
    const unpaidCount = dashboard?.unpaidSessions ?? 0;

    // Один ряд показателей (G5-04). «Касса · с долгами» — все деньги,
    // полученные в месяце, включая оплату старых долгов (решение В1).
    const kpiCells: Array<{ label: string; value: string | number; to: string; warn?: boolean; sub?: string; hint?: string }> = [
        {
            label: 'Активных клиентов',
            value: dashboard?.activeClients ?? 0,
            to: '/crm/clients',
        },
        {
            label: 'Сессий за месяц',
            value: dashboard?.sessionsThisMonth ?? 0,
            to: '/crm/sessions',
        },
        {
            label: 'Касса · с долгами',
            value: formatGel(revenueValue, { fraction: 0 }),
            to: '/crm/finances',
            sub: hasMultiCurrency
                ? Object.entries(revenueByCurrency!).map(([c, v]) => formatMoney(v as number, { currency: c, fraction: 0 })).join(' · ')
                : undefined,
            hint: 'Все деньги, полученные в этом месяце, включая оплату старых долгов',
        },
        {
            label: 'Долги сейчас',
            value: formatGel(debtTotal, { fraction: 0 }),
            to: '/crm/finances',
            warn: !!hasDebt,
            sub: unpaidCount > 0
                ? `${unpaidCount} ${sessionsWord(unpaidCount)}${hasMultiCurrency && debtByCurrency && Object.keys(debtByCurrency).length > 1
                    ? ' · ' + Object.entries(debtByCurrency!).map(([c, v]) => formatMoney(v as number, { currency: c, fraction: 0 })).join(' · ')
                    : ''}`
                : undefined,
            hint: 'Прошедшие неоплаченные сессии за всё время',
        },
    ];

    // Новый аккаунт: вместо стены нулей и пустого графика — чек-лист.
    const isNewAccount = (dashboard?.activeClients ?? 0) === 0 && clients !== null && clients.length === 0;

    const debts = dashboard?.debtByClient ?? [];
    const noNext = dashboard?.clientsWithoutFutureSessions ?? [];
    // «Дальше на неделе» — сегодняшние уже наверху, в «Сегодня».
    const laterSessions = (dashboard?.upcomingSessions ?? []).filter(
        x => utcNaiveToTbilisi(x.date)?.date !== today,
    );
    const nowMs = Date.now();
    const todayCount = todayList?.filter(s => !CANCELLED.has(s.status)).length ?? 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
            <div>
                {/* ── Шапка: сегодняшний день и «Новая сессия» ── */}
                <PageHeader
                    title="Сегодня"
                    description={`${formatDateLabel(today, { capitalize: true })}${todayList ? ` · ${todayCount ? `${todayCount} ${sessionsWord(todayCount)}` : 'сессий нет'}` : ''}`}
                    actions={viewingOther ? undefined : (
                        <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setNewFor(null)}>
                            Новая сессия
                        </Button>
                    )}
                />

                {/* ── «Сегодня»: все сессии дня, вкл. прошедшие ── */}
                <section aria-label="Сессии сегодня">
                    {todayFailed ? (
                        <ErrorBar message="Не удалось загрузить сессии на сегодня" onRetry={loadToday} />
                    ) : todayList === null || clients === null ? (
                        <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <span className="sr-only">Загружаем сессии на сегодня…</span>
                            <Skeleton height={40} radius={0} />
                            <Skeleton height={40} radius={0} />
                        </div>
                    ) : todayList.length === 0 ? (
                        <div style={{ padding: '12px 0', fontSize: 14, color: GH.ink60 }}>
                            Сегодня сессий нет.{' '}
                            <Link to="/crm/sessions" style={moreLinkStyle}>Все сессии</Link>
                        </div>
                    ) : (
                        <div>
                            {todayList.map(s => {
                                const client = clientById.get(s.clientId);
                                const name = client?.name || 'Клиент';
                                const wall = utcNaiveToTbilisi(s.date);
                                const cancelled = CANCELLED.has(s.status);
                                const started = parseUTC(s.date).getTime() <= nowMs;
                                const amount = s.price ?? client?.basePrice;
                                const currency = s.currency || client?.currency;
                                // Прошедшая-по-времени PLANNED на экране — «Прошла»
                                // (сервер закрывает их автозавершением).
                                const shownStatus = s.status === 'PLANNED' && started ? 'COMPLETED' : s.status;
                                return (
                                    <div key={s.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                                        padding: '10px 0', borderBottom: hairline, minHeight: 56,
                                        color: cancelled ? GH.ink60 : GH.ink,
                                    }}>
                                        <span style={{ fontFamily: GH_MONO, fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums', width: 52 }}>
                                            {wall?.time ?? '—'}
                                        </span>
                                        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                                            <Link to={`/crm/clients/${s.clientId}`} style={{ ...linkStyle, fontSize: 16, fontWeight: 600 }}>
                                                {name}
                                            </Link>
                                            <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span>{s.durationMinutes} мин</span>
                                                {/* «Без кабинета» — нейтрально: онлайн-сессии не ошибка (M5). */}
                                                {s.isBooked
                                                    ? <span style={{ color: STATUS.ok.fg, display: 'inline-flex', alignItems: 'center', gap: 2 }}><Check size={12} aria-hidden="true" /> Кабинет</span>
                                                    : <span>Без кабинета</span>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            {s.isPaid
                                                ? <StatusBadge kind="payment" status="paid" audience="staff" />
                                                : <StatusBadge kind="session" status={shownStatus} audience="staff" />}
                                            {!cancelled && !s.isPaid && started && (
                                                <Button
                                                    loading={payingId === s.id}
                                                    disabled={!!payingId && payingId !== s.id}
                                                    onClick={() => handlePay(s)}
                                                >
                                                    {/* Действие, а не статус (G5-06). */}
                                                    {amount ? `Отметить оплату · ${formatMoney(amount, { currency: currency ?? undefined })}` : 'Отметить оплату'}
                                                </Button>
                                            )}
                                            {!cancelled && !started && !s.isBooked && !viewingOther && (
                                                <Button variant="secondary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => bookCabinetFor(s, name)}>
                                                    Кабинет
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>

            {/* Merge-suggestions banner — appears only when there's at
                least one unlinked (session, booking) pair at the same
                time. Click "Объединить" applies the link; click
                "Пропустить" hides this pair until the next page load. */}
            {mergePairs.length > 0 && (
                <div style={{
                    border: `1px solid ${GH.ink}`,
                    background: GH.sunken,
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                }}>
                    <div>
                        <div style={{ ...monoLabel, marginBottom: 4 }}>Совпадения по времени</div>
                        <div style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink }}>
                            Найдено <b>{mergePairs.length}</b> {mergePairs.length === 1 ? 'пара' : mergePairs.length < 5 ? 'пары' : 'пар'} «бронь+сессия» в одно время. Объединить в одно событие?
                        </div>
                    </div>
                    <Button variant="secondary" onClick={() => setMergeOpen(true)}>
                        Просмотреть
                    </Button>
                </div>
            )}

            {/* Merge dialog — list of pairs with per-row Объединить /
                Пропустить buttons. Closes itself when the list is empty. */}
            {/* Общая шторка вместо самодельного окна: Esc, фокус внутри. */}
            <Sheet
                open={mergeOpen}
                onClose={() => setMergeOpen(false)}
                title="Объединить бронь и сессию"
                width={640}
            >
                    <div>
                        {mergePairs.length === 0 ? (
                            <div style={{ fontSize: 14, color: GH.ink60, padding: '32px 0', textAlign: 'center' }}>
                                Всё объединено
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
                                                borderTop: hairline,
                                                padding: '14px 0',
                                                display: 'grid',
                                                gridTemplateColumns: '1fr auto',
                                                gap: 12,
                                                alignItems: 'center',
                                            }}
                                        >
                                            <div>
                                                <div style={{ fontFamily: GH_SANS, fontSize: 16, fontWeight: 600, color: GH.ink }}>
                                                    {pair.clientName || 'Клиент'} · {dayTime(dt)}
                                                </div>
                                                <div style={{ fontSize: 14, color: GH.ink60, marginTop: 4 }}>
                                                    {resName} · {pair.bookingDuration} мин
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <Button variant="secondary" onClick={() => handleSkipMerge(pair)}>
                                                    Пропустить
                                                </Button>
                                                <Button loading={mergingId === pair.sessionId} onClick={() => handleAcceptMerge(pair)}>
                                                    Объединить
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
            </Sheet>

            {/* ── Новый аккаунт: чек-лист вместо нулей ── */}
            {isNewAccount && (
                <section>
                    <ShelfHead title="С чего начать" />
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {[
                            {
                                done: false,
                                title: 'Добавьте первого клиента',
                                hint: 'Имя и код для календаря — остальное потом.',
                                action: viewingOther ? null : <Button onClick={() => setNewClientOpen(true)} icon={<Plus size={16} aria-hidden="true" />}>Новый клиент</Button>,
                            },
                            {
                                done: !!calendarIdSaved,
                                title: 'Подключите Google Календарь',
                                hint: 'Сессии из календаря подтянутся сами.',
                                action: <Link to="/crm/settings" style={moreLinkStyle}>Настройки</Link>,
                            },
                            {
                                done: false,
                                title: 'Заполните анкету',
                                hint: 'Её видят клиенты в каталоге специалистов.',
                                action: <Link to="/crm/profile" style={moreLinkStyle}>Анкета</Link>,
                            },
                            {
                                done: false,
                                title: 'Забронируйте кабинет',
                                hint: 'Unbox One · Uni · Neo — по часам.',
                                action: <Link to="/crm/bookings" style={moreLinkStyle}>Бронирования</Link>,
                            },
                        ].map(step => (
                            <li key={step.title} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: hairline, flexWrap: 'wrap' }}>
                                {step.done
                                    ? <CheckCircle2 size={20} aria-label="Сделано" style={{ color: STATUS.ok.fg, flexShrink: 0 }} />
                                    : <Circle size={20} aria-hidden="true" color={GH.ink30} style={{ flexShrink: 0 }} />}
                                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                                    <div style={{ fontSize: 16, fontWeight: 600 }}>{step.title}</div>
                                    <div style={{ fontSize: 14, color: GH.ink60, marginTop: 2 }}>{step.hint}</div>
                                </div>
                                {!step.done && step.action}
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {/* ── Две полки: «Долги» и «Без следующей встречи» ── */}
            {!isNewAccount && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 32 }}>
                    <section>
                        <ShelfHead
                            title="Долги"
                            right={debts.length > SHELF_LIMIT
                                ? <Link to="/crm/finances" style={moreLinkStyle}>Все ({debts.length})</Link>
                                : undefined}
                        />
                        {debts.length === 0 ? (
                            <div style={{ padding: '12px 0', fontSize: 14, color: GH.ink60 }}>
                                Долгов нет — все прошедшие сессии оплачены.
                            </div>
                        ) : debts.slice(0, SHELF_LIMIT).map(d => {
                            const client = clientById.get(d.clientId);
                            return (
                                <div key={d.clientId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: hairline, flexWrap: 'wrap' }}>
                                    <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                        <Link to={`/crm/clients/${d.clientId}`} style={{ ...linkStyle, fontSize: 16, fontWeight: 600 }}>
                                            {d.clientName}
                                        </Link>
                                        <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2 }}>
                                            {d.unpaidSessionsCount} {sessionsWord(d.unpaidSessionsCount)} без оплаты
                                        </div>
                                    </div>
                                    {/* Открывает список неоплаченных клиента: там по строке
                                        или «Отметить все» — с тем же вопросом, что в карточке. */}
                                    <Button variant="secondary" disabled={!client} onClick={() => client && setDebtFor(client)}>
                                        Отметить оплату · {formatMoney(d.totalDebt, { currency: d.currency, fraction: 0 })}
                                    </Button>
                                </div>
                            );
                        })}
                    </section>

                    <section>
                        <ShelfHead
                            title="Без следующей встречи"
                            right={noNext.length > SHELF_LIMIT
                                ? <Link to="/crm/clients" style={moreLinkStyle}>Все ({noNext.length})</Link>
                                : undefined}
                        />
                        {noNext.length === 0 ? (
                            <div style={{ padding: '12px 0', fontSize: 14, color: GH.ink60 }}>
                                У всех активных клиентов есть следующая встреча.
                            </div>
                        ) : noNext.slice(0, SHELF_LIMIT).map(c => {
                            const client = clientById.get(c.id);
                            return (
                                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: hairline, flexWrap: 'wrap' }}>
                                    <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                        <Link to={`/crm/clients/${c.id}`} style={{ ...linkStyle, fontSize: 16, fontWeight: 600 }}>
                                            {c.name}
                                        </Link>
                                        <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2 }}>
                                            {c.lastSessionDate
                                                ? `Была ${formatDayMonth(parseUTC(c.lastSessionDate), { withYear: 'auto' })}`
                                                : 'Сессий ещё не было'}
                                        </div>
                                    </div>
                                    {!viewingOther && (
                                        <Button variant="secondary" disabled={!client} onClick={() => client && setNewFor(client)}>
                                            Записать
                                        </Button>
                                    )}
                                </div>
                            );
                        })}
                    </section>
                </div>
            )}

            {/* ── Месяц: один ряд показателей + график ── */}
            {!isNewAccount && (
                <section aria-label="Показатели месяца">
                    <ShelfHead
                        title={monthLabel}
                        right={(
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Button variant="secondary" aria-label="Предыдущий месяц" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                                    &larr;
                                </Button>
                                <Button variant="quiet" disabled={isThisMonth} onClick={() => setCurrentMonth(new Date())}>
                                    Этот месяц
                                </Button>
                                <Button variant="secondary" aria-label="Следующий месяц" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                                    &rarr;
                                </Button>
                            </div>
                        )}
                    />
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        // Линии между ячейками — зазором 1 px на фоне ink10: при
                        // переносе на узком окне сетка остаётся ровной.
                        gap: 1,
                        background: GH.ink10,
                        borderBottom: hairline,
                    }}>
                        {kpiCells.map((cell) => (
                            <Link
                                key={cell.label}
                                to={cell.to}
                                title={cell.hint}
                                style={{
                                    ...linkStyle,
                                    display: 'block',
                                    padding: 20,
                                    background: GH.paper,
                                    transition: 'background 0.12s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = GH.sunken; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = GH.paper; }}
                            >
                                <div style={monoLabel}>{cell.label}</div>
                                <div style={{
                                    fontFamily: GH_SANS, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em',
                                    lineHeight: 1.2, marginTop: 8, color: GH.ink, fontVariantNumeric: 'tabular-nums',
                                    display: 'flex', alignItems: 'center', gap: 8,
                                }}>
                                    {cell.warn && (
                                        <span aria-hidden="true" style={{ width: 8, height: 8, background: GH.danger, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
                                    )}
                                    <span>{cell.value}</span>
                                </div>
                                {cell.sub && (
                                    <div style={{ fontSize: 12, color: GH.ink60, marginTop: 4 }}>{cell.sub}</div>
                                )}
                            </Link>
                        ))}
                    </div>

                    {/* ── График: получено / ожидалось по месяцам ── */}
                    {dashboard?.monthlyStats && dashboard.monthlyStats.some(m => (m.received || m.expected)) && (
                        <div style={{ marginTop: 32 }}>
                            <div style={{
                                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                                marginBottom: 12, flexWrap: 'wrap', gap: 16,
                            }}>
                                <h3 style={{ ...sectionHead, fontSize: 16 }}>Доход по месяцам</h3>
                                <div style={{ display: 'flex', gap: 20 }}>
                                    <span style={{ fontSize: 12, color: GH.ink60, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span aria-hidden="true" style={{ width: 14, height: 10, background: GH.ink, display: 'inline-block' }} />
                                        Получено
                                    </span>
                                    <span style={{ fontSize: 12, color: GH.ink60, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span aria-hidden="true" style={{ width: 14, height: 10, background: GH.ink10, display: 'inline-block' }} />
                                        Ожидалось
                                    </span>
                                </div>
                            </div>
                            <div style={{ border: hairline, padding: 20, background: GH.paper }}>
                                <ResponsiveContainer width="100%" height={240}>
                                    <BarChart data={dashboard.monthlyStats} barCategoryGap="24%">
                                        <CartesianGrid strokeDasharray="0" vertical={false} stroke={GH.ink10} />
                                        <XAxis
                                            dataKey="month"
                                            tickFormatter={(v: string) => {
                                                const [, m] = v.split('-');
                                                const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
                                                return months[parseInt(m, 10) - 1] || m;
                                            }}
                                            tick={{ fontSize: 12, fontFamily: GH_SANS, fill: GH.ink60 }}
                                            tickLine={false}
                                            axisLine={{ stroke: GH.ink }}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 12, fontFamily: GH_MONO, fill: GH.ink60 }}
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
                                                        padding: '12px 14px',
                                                        fontFamily: GH_SANS,
                                                        fontSize: '12px',
                                                        color: GH.ink,
                                                        minWidth: '180px',
                                                    }}>
                                                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                            <span style={{ color: GH.ink60 }}>Ожидалось</span>
                                                            <span style={{ fontFamily: GH_MONO, fontWeight: 600 }}>{formatGel(Number(data.expected || 0), { fraction: 0 })}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                            <span style={{ color: GH.ink60 }}>Получено</span>
                                                            <span style={{ fontFamily: GH_MONO, fontWeight: 600 }}>{formatGel(Number(data.received || 0), { fraction: 0 })}</span>
                                                        </div>
                                                        <div style={{ color: GH.ink60, paddingTop: '6px', borderTop: hairline }}>
                                                            {data.sessionCount || 0} {sessionsWord(data.sessionCount || 0)}
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
                        </div>
                    )}
                </section>
            )}

            {/* ── Дальше на неделе (сегодняшние — наверху) ── */}
            <section>
                <ShelfHead title="Дальше на неделе" right={<Link to="/crm/sessions" style={moreLinkStyle}>Все сессии</Link>} />
                {laterSessions.length === 0 ? (
                    <div style={{ padding: '12px 0', fontSize: 14, color: GH.ink60 }}>
                        На ближайшие 7 дней больше ничего не запланировано.
                    </div>
                ) : laterSessions.map((s) => {
                    const dt = parseUTC(s.date);
                    return (
                        <div
                            key={s.id}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(120px, 160px) 56px minmax(0, 1fr) auto',
                                gap: 16,
                                alignItems: 'center',
                                padding: '12px 0',
                                borderBottom: hairline,
                            }}
                        >
                            <span style={{ fontSize: 14, color: GH.ink60 }}>{formatDateLabel(dt)}</span>
                            <span style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatTime(dt)}</span>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <Link to={`/crm/clients/${s.clientId}`} style={{ ...linkStyle, fontSize: 14, fontWeight: 600 }}>{s.clientName}</Link>
                                <span style={{ fontSize: 12, color: s.isBooked ? STATUS.ok.fg : GH.ink60, marginLeft: 8 }}>
                                    {s.isBooked ? 'Кабинет' : 'Без кабинета'}
                                </span>
                            </span>
                            <StatusBadge kind="session" status={s.status} audience="staff" variant="dot" />
                        </div>
                    );
                })}
            </section>

            {/* ── My coworking bookings (Excel #33) ── */}
            <section>
                <ShelfHead title="Мои бронирования кабинетов" right={<Link to="/crm/bookings" style={moreLinkStyle}>Все брони</Link>} />
                {upcomingMyBookings.length === 0 ? (
                    <div style={{ padding: '12px 0', fontSize: 14, color: GH.ink60 }}>
                        На ближайшие 7 дней вы не арендовали ни одного кабинета.{' '}
                        <Link to="/crm/bookings" style={moreLinkStyle}>Забронировать</Link>
                    </div>
                ) : (
                    <div>
                        {upcomingMyBookings.map(b => {
                            const res = RESOURCES.find(r => r.id === b.resourceId);
                            const startT = b.startTime || '';
                            const dur = b.duration || 60;
                            const [hh, mm] = startT.split(':').map(Number);
                            const endMins = (hh || 0) * 60 + (mm || 0) + dur;
                            const endStr = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
                            return (
                                <Link
                                    key={b.id}
                                    to="/crm/bookings"
                                    style={{
                                        ...linkStyle,
                                        display: 'grid', gridTemplateColumns: 'minmax(120px, 160px) 110px minmax(0, 1fr) auto',
                                        gap: 16, alignItems: 'center',
                                        padding: '12px 0', borderBottom: hairline,
                                        transition: 'background 0.12s',
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = GH.ink5; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <span style={{ fontSize: 14, color: GH.ink60 }}>{formatDateLabel(b._dt)}</span>
                                    <span style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                        {startT}–{endStr}
                                    </span>
                                    <span style={{ fontSize: 14 }}>{res?.name || b.resourceId}</span>
                                    <span style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 600 }}>
                                        {b.finalPrice ? formatGel(b.finalPrice) : '—'}
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ── Быстрые действия: без «→ ДЕЙСТВИЕ · 01», создание — шторками ── */}
            <section>
                <ShelfHead title="Быстрые действия" />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                    {!viewingOther && (
                        <>
                            <Button variant="secondary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setNewClientOpen(true)}>
                                Новый клиент
                            </Button>
                            <Button variant="secondary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setNewFor(null)}>
                                Новая сессия
                            </Button>
                        </>
                    )}
                    <Button variant="secondary" onClick={() => navigate('/crm/bookings')}>
                        Забронировать кабинет
                    </Button>
                    {/* Excel #19 — абонемент прямо из CRM, без ухода в клиентский
                        кабинет: /crm/subscription (раньше — витрина /subscriptions). */}
                    <Button variant="secondary" onClick={() => navigate('/crm/subscription')}>
                        Купить абонемент
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={() => window.open(
                            calendarIdSaved
                                ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarIdSaved)}`
                                : 'https://calendar.google.com/calendar/u/0/r',
                            '_blank', 'noopener,noreferrer',
                        )}
                    >
                        Открыть Google Календарь
                    </Button>
                </div>
                {calendarIdSaved && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 14, color: GH.ink60 }}>
                        <span aria-hidden="true" style={{ width: 8, height: 8, background: STATUS.ok.fg, borderRadius: '50%' }} />
                        Google Календарь подключён ·{' '}
                        <Link to="/crm/sessions" style={moreLinkStyle}>Синхронизация в «Сессиях»</Link>
                    </div>
                )}
            </section>

            {/* ── Шторки волны 3 (стор не трогают — перечитываем сами) ── */}
            <NewSessionSheet
                open={newFor !== undefined}
                onClose={() => setNewFor(undefined)}
                client={newFor ?? undefined}
                clients={(clients ?? []).filter(c => c.isActive)}
                onCreated={() => refreshAll()}
            />
            {debtFor && (
                <UnpaidSessionsSheet
                    open={!!debtFor}
                    onClose={() => setDebtFor(null)}
                    client={debtFor}
                    onChanged={() => refreshAll()}
                />
            )}
            <NewClientSheet
                open={newClientOpen}
                onClose={() => setNewClientOpen(false)}
                clients={clients ?? undefined}
                onCreated={(c) => { refreshAll(); navigate(`/crm/clients/${c.id}`); }}
            />
        </div>
    );
}
