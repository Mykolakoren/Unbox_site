import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertTriangle, ChevronRight, Users as UsersIcon, ShieldCheck, BookOpen, DoorOpen, Plus, Contact, KeyRound, Wallet,
} from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { useBookingStore } from '../../../store/bookingStore';
import { bookingsApi } from '../../../api/bookings';
import type { BookingHistoryItem } from '../../../store/types';
import { RESOURCES } from '../../../utils/data';
import { todayRows, todaySummary, byClient, batumiDayKey, type TodayRow, type TodayClient } from '../../../utils/adminToday';
import { AdminBookingSheets, getAdminUserName } from './bookingSheets';
import { useAdminDueMap, acceptPaymentFor, branchOfBooking, type AcceptPayment } from './adminPayment';
import { userCanAccessFinance } from '../../../utils/permissions';
import { TopupSheet } from './TopupSheet';
import { DueBadge } from '../../../components/admin/DueBadge';
import { Button } from '../../../components/ui/Button';
import { Segmented } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { formatDateLabel, formatGel } from '../../../utils/format';
import { useArchivedClients } from '../../../hooks/useArchivedClients';

/** 1 клиент, 2 клиента, 5 клиентов. */
function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

type Seg = 'all' | 'due' | 'tomorrow';

const RESOURCE_NAMES = RESOURCES.map(r => ({ id: r.id, name: r.name }));

/**
 * «Сегодня» в мобильной админке (волна 4, пакет A) — лента дня.
 *
 * Утренний вопрос «кто сегодня и кто должен» — без тапов: сверху сводка
 * «Взять сегодня 86 ₾ · 2 клиента», ниже строки дня «время · клиент ·
 * кабинет · к оплате / ✓». Неоплаченные — тоном danger (решение владельца
 * В2), чтобы админы были внимательнее. Сегмент «Все | Должны | Завтра»:
 * «Должны» — по клиентам с кнопкой «Принять оплату» (сумма по умолчанию —
 * весь долг, В3). Закончившиеся брони (сервер отдаёт их как completed) из
 * ленты не пропадают (N3).
 *
 * Данные — то, что уже в сторе: fetchAllBookings + users, строки —
 * adminToday.todayRows, суммы — computeDueByBooking (как в шахматке).
 * Новых запросов к броням нет.
 */
export function MobileAdminDashboard() {
    // fetchAllBookings (/bookings, только админ) — как во вкладке «Брони».
    const { bookings, users, fetchAllBookings, fetchUsers, currentUser } = useUserStore();
    const setBookingForUser = useBookingStore(s => s.setBookingForUser);
    const [pendingApprovals, setPendingApprovals] = useState<BookingHistoryItem[] | null>(null);
    const [approvalsFailed, setApprovalsFailed] = useState(false);
    // Пока брони не пришли, не рисуем «0» и «Сегодня пусто».
    const [bookingsLoaded, setBookingsLoaded] = useState(false);
    const [activeBooking, setActiveBooking] = useState<BookingHistoryItem | null>(null);
    const [pay, setPay] = useState<AcceptPayment | null>(null);
    const [seg, setSeg] = useState<Seg>('all');
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

    const dueMap = useAdminDueMap(bookings, users);
    const todayKey = batumiDayKey();
    const tomorrowKey = batumiDayKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

    // Лента дня: confirmed + pending_approval + completed (прошедшие не пропадают).
    const rowsToday = useMemo(
        () => todayRows({ bookings, users, dueMap, dayKey: todayKey, resources: RESOURCE_NAMES }),
        [bookings, users, dueMap, todayKey],
    );
    const rowsTomorrow = useMemo(
        () => todayRows({ bookings, users, dueMap, dayKey: tomorrowKey, resources: RESOURCE_NAMES }),
        [bookings, users, dueMap, tomorrowKey],
    );
    const summary = useMemo(() => todaySummary(rowsToday), [rowsToday]);
    // Брони клиента, чей аккаунт в архиве (склейка дублей): в обычном списке
    // его нет — подписываем именем из архива с пометкой «архив».
    const missingUserIds = useMemo(() => {
        const known = new Set<string>();
        for (const u of users || []) { if (u.id) known.add(String(u.id)); if (u.email) known.add(u.email); }
        return [...rowsToday, ...rowsTomorrow].filter(r => r.userId && !known.has(r.userId)).map(r => r.userId);
    }, [rowsToday, rowsTomorrow, users]);
    const archived = useArchivedClients(missingUserIds);
    const owing = useMemo(
        () => byClient(rowsToday, users).filter(c => c.today > 0 || c.total > 0),
        [rowsToday, users],
    );
    // «Должны» делим: сначала те, с кого брать сегодня (today > 0), ниже — долг по
    // другим броням (today = 0: брони уже списаны с баланса, брать не сегодня).
    const owingToday = useMemo(() => owing.filter(c => c.today > 0), [owing]);
    const owingLater = useMemo(() => owing.filter(c => !(c.today > 0)), [owing]);

    // Брони могли уже лежать в сторе (открывали «Брони») — тогда показываем их.
    const bookingsPending = !bookingsLoaded && bookings.length === 0;
    const isOwnerish = currentUser?.role === 'owner' || currentUser?.role === 'senior_admin';
    // «Принять оплату» — только с правом на кассу (как вкладка «Касса»).
    const canCash = userCanAccessFinance(currentUser);

    const openRow = (r: TodayRow) => {
        const b = bookings.find(x => x.id === r.bookingId);
        if (b) setActiveBooking(b);
    };

    // Филиал — по кабинету первой сегодняшней брони клиента (rows отсортированы
    // по времени), так же, как acceptPaymentFor берёт его по брони. Раньше не
    // передавался, и шторка подставляла «Unbox Uni» даже клиенту One.
    const openPayFor = (c: TodayClient) => {
        const user = users.find(u => String(u.id || u.email) === c.userId || u.email === c.userId);
        const first = c.rows[0];
        if (user) setPay({
            user, total: c.total, today: c.today,
            branch: first ? branchOfBooking({ resourceId: first.cabinetId }) : undefined,
        });
    };

    // Карточка должника «Должны»; later — долг не за сегодня (нейтральная рамка).
    const renderOwing = (c: TodayClient, later = false) => (
        <div key={c.userId} style={{
            background: 'var(--color-card)', border: `1px solid ${later ? 'var(--color-ink-10)' : 'var(--status-danger-fg)'}`,
            borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <Link
                    to={`/m/admin/users/${encodeURIComponent(c.rows[0]?.userId || c.userId)}`}
                    style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-ink)', textDecoration: 'none' }}
                >
                    {c.client}
                </Link>
                <span className="num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--status-danger-fg)' }}>
                    {formatGel(c.total)}
                </span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-ink-80)' }}>
                За сегодня <span className="num">{formatGel(c.today)}</span>
                {' · '}весь долг <span className="num">{formatGel(c.total)}</span>
                {c.creditLimit !== null && <> · лимит <span className="num">{formatGel(c.creditLimit)}</span></>}
                {c.overLimit && <span style={{ color: 'var(--status-danger-fg)', fontWeight: 600 }}> · сверх лимита</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                {c.rows.map(r => `${r.time} ${r.cabinet}`).join(' · ')}
            </div>
            {canCash && (
                <Button
                    block
                    icon={<Wallet size={16} aria-hidden="true" />}
                    disabled={!(c.total > 0)}
                    onClick={() => openPayFor(c)}
                >
                    Принять оплату · {formatGel(c.total)}
                </Button>
            )}
        </div>
    );

    return (
        <div style={{ paddingTop: 16, paddingBottom: 96, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* «+ Бронь» — в шапке, а не плавающей кнопкой: плавающий «+» лежал
                поверх строк ленты и закрывал отметку «к оплате / ✓» справа. */}
            <div style={{ padding: '0 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                    <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                        Сегодня
                    </h1>
                    <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                        {formatDateLabel(new Date(), { capitalize: true })}
                    </p>
                </div>
                {/* Бронь от своего имени: сбрасываем «бронь за клиента». */}
                <Link
                    to="/m/find"
                    aria-label="Новая бронь"
                    onClick={() => setBookingForUser(null)}
                    className="press"
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
                        minHeight: 44, padding: '0 16px', borderRadius: 22,
                        background: 'var(--color-ink)', color: 'var(--color-on-ink)',
                        fontSize: 14, fontWeight: 600, textDecoration: 'none',
                    }}
                >
                    <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
                    Бронь
                </Link>
            </div>

            {approvalsFailed && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось проверить заявки" onRetry={loadApprovals} />
                </div>
            )}

            {/* Срочные брони ждут решения — самое срочное. */}
            {pendingApprovals && pendingApprovals.length > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <Link to="/m/admin/inbox" style={bannerStyle}>
                        <AlertTriangle size={20} aria-hidden="true" />
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
                            Ждут вашего решения: {pendingApprovals.length} {plural(pendingApprovals.length, 'срочная бронь', 'срочные брони', 'срочных броней')}
                        </span>
                        <ChevronRight size={18} aria-hidden="true" />
                    </Link>
                </div>
            )}

            {/* Сводка «Взять сегодня» — ответ «кто должен» без тапов; тап — «Должны». */}
            <div style={{ padding: '0 16px' }}>
                {bookingsPending ? (
                    <SkeletonList count={1} label="Считаем, кто должен" cardHeight={72} />
                ) : (
                    <button
                        type="button"
                        onClick={() => setSeg('due')}
                        aria-label={summary.amount > 0
                            ? `Взять сегодня ${formatGel(summary.amount)} с ${summary.clients} ${plural(summary.clients, 'клиента', 'клиентов', 'клиентов')} — показать должников`
                            : 'Сегодня брать не с кого'}
                        className="press"
                        style={{
                            width: '100%', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
                            background: summary.amount > 0 ? 'var(--status-danger-bg)' : 'var(--status-ok-bg)',
                            color: summary.amount > 0 ? 'var(--status-danger-fg)' : 'var(--status-ok-fg)',
                            border: 'none', borderRadius: 16, padding: '14px 16px',
                            display: 'flex', alignItems: 'center', gap: 12,
                        }}
                    >
                        <Wallet size={22} aria-hidden="true" />
                        <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                                {summary.amount > 0 ? 'Взять сегодня' : 'Сегодня брать не с кого'}
                            </span>
                            {summary.amount > 0 && (
                                <span style={{ display: 'block', fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>
                                    <span className="num">{formatGel(summary.amount)}</span>
                                    <span style={{ fontSize: 16 }}> · {summary.clients} {plural(summary.clients, 'клиент', 'клиента', 'клиентов')}</span>
                                </span>
                            )}
                        </span>
                        {summary.amount > 0 && <ChevronRight size={18} aria-hidden="true" />}
                    </button>
                )}
            </div>

            <div style={{ padding: '0 16px' }}>
                <Segmented<Seg>
                    aria-label="Что показать"
                    options={[
                        { value: 'all', label: bookingsPending ? 'Все' : `Все · ${rowsToday.length}` },
                        { value: 'due', label: bookingsPending ? 'Должны' : `Должны · ${owingToday.length}` },
                        { value: 'tomorrow', label: bookingsPending ? 'Завтра' : `Завтра · ${rowsTomorrow.length}` },
                    ]}
                    value={seg}
                    onChange={setSeg}
                />
            </div>

            <div style={{ padding: '0 16px' }}>
                {bookingsPending ? (
                    <SkeletonList count={4} label="Загружаем брони" cardHeight={56} />
                ) : seg === 'due' ? (
                    owing.length === 0 ? (
                        <EmptyState compact title="Сегодня никто не должен" hint="Все сегодняшние брони оплачены или идут по абонементу." />
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {owingToday.map(c => renderOwing(c))}
                            {owingLater.length > 0 && (
                                <div data-owing-later style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: owingToday.length > 0 ? 8 : 0 }}>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)' }}>Долг по другим броням: не сегодня</div>
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2 }}>
                                            Эти брони уже списаны с баланса, оплатить их можно, когда клиент придёт
                                        </div>
                                    </div>
                                    {owingLater.map(c => renderOwing(c, true))}
                                </div>
                            )}
                        </div>
                    )
                ) : (
                    (() => {
                        const rows = seg === 'tomorrow' ? rowsTomorrow : rowsToday;
                        if (rows.length === 0) {
                            return <EmptyState compact title={seg === 'tomorrow' ? 'Завтра броней нет' : 'Сегодня броней нет'} />;
                        }
                        return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {rows.map(r => <DayRow key={r.bookingId} row={r} archivedName={archived.get(r.userId)?.name} onOpen={() => openRow(r)} />)}
                            </div>
                        );
                    })()
                )}
            </div>

            {/* Прогноз должников — одной строкой, раскрывается по тапу. */}
            {forecast && forecast.count > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <button
                        type="button"
                        onClick={() => setForecastExpanded(v => !v)}
                        aria-expanded={forecastExpanded}
                        style={{ ...bannerStyle, width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                        <AlertTriangle size={18} aria-hidden="true" />
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
                            {forecast.count} {plural(forecast.count, 'клиент уйдёт', 'клиента уйдут', 'клиентов уйдут')} за лимит
                        </span>
                        <ChevronRight size={18} aria-hidden="true" style={{ transform: forecastExpanded ? 'rotate(90deg)' : undefined }} />
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
                                        <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2 }}>
                                            баланс {formatGel(c.balance)} · лимит {formatGel(c.creditLimit)} · ждут списания {formatGel(c.pendingTotal)} ({c.pendingCount})
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div className="num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--status-pending-fg)' }}>{formatGel(-c.overLimitBy)}</div>
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>за лимит</div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Разделы, которые не влезли в нижнее меню — списком, не плитками. */}
            <nav aria-label="Ещё разделы" style={{ padding: '8px 16px 0' }}>
                <SectionTitle>Ещё</SectionTitle>
                <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--color-ink-08)' }}>
                    <QuickLink to="/m/admin/crm" icon={Contact} label="CRM клиентов" hint="Спящие клиенты, воронка" />
                    <QuickLink to="/m/admin/cabinets" icon={DoorOpen} label="Кабинеты" hint="Включить, закрыть, лист ожидания" />
                    <QuickLink to="/m/admin/specialists" icon={ShieldCheck} label="Специалисты" hint="Анкеты на проверке" />
                    <QuickLink to="/m/admin/team" icon={UsersIcon} label="Команда" />
                    <QuickLink to="/m/admin/kb" icon={BookOpen} label="База знаний" />
                    {isOwnerish && <QuickLink to="/m/admin/access-rights" icon={KeyRound} label="Права доступа" />}
                </div>
            </nav>

            <AdminBookingSheets
                booking={activeBooking}
                getUserName={email => getAdminUserName(users, email)}
                onClose={() => setActiveBooking(null)}
                acceptPayment={b => {
                    const p = acceptPaymentFor(b, bookings, users, dueMap);
                    if (!p) return null;
                    return {
                        sub: p.today > 0
                            ? `Весь долг ${formatGel(p.total)}, из них за сегодня ${formatGel(p.today)}`
                            : `Весь долг ${formatGel(p.total)}`,
                        onClick: () => { setActiveBooking(null); setPay(p); },
                    };
                }}
            />

            {canCash && pay && (
                <TopupSheet
                    user={pay.user}
                    defaultAmount={pay.total}
                    todayAmount={pay.today}
                    defaultBranch={pay.branch}
                    onClose={() => setPay(null)}
                    onDone={async () => { setPay(null); await fetchUsers(); }}
                />
            )}

        </div>
    );
}

const bannerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, minHeight: 48,
    background: 'var(--status-pending-bg)', border: '1px solid var(--color-ink-10)', borderRadius: 14,
    padding: '10px 14px', color: 'var(--status-pending-fg)', textDecoration: 'none',
};

/** Строка дня: время · клиент · кабинет · «к оплате / ✓». Неоплаченная — рамкой danger (В2). */
function DayRow({ row, archivedName, onOpen }: { row: TodayRow; archivedName?: string; onOpen: () => void }) {
    const owes = row.due !== null && row.due > 0;
    const note = row.status === 'completed' ? ' · прошла'
        : row.status === 'pending_approval' ? ' · ждёт одобрения' : '';
    return (
        <button
            type="button"
            onClick={onOpen}
            className="press"
            style={{
                background: 'var(--color-card)',
                border: `1px solid ${owes ? 'var(--status-danger-fg)' : 'var(--color-ink-08)'}`,
                borderLeftWidth: owes ? 4 : 1,
                borderRadius: 12,
                padding: '8px 10px 8px 12px',
                minHeight: 56,
                display: 'flex', gap: 10, alignItems: 'center',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
                color: 'var(--color-ink)',
            }}
        >
            <span className="num" style={{ fontSize: 14, fontWeight: 600, minWidth: 48, lineHeight: 1.25 }}>
                {row.time}
                <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--color-ink-60)' }}>{row.endTime}</span>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {archivedName || row.client}
                    </span>
                    {archivedName && <span className="ui-badge ui-badge--muted" style={{ flexShrink: 0 }}>архив</span>}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-ink-60)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.cabinet}{note}
                </span>
            </span>
            <DueBadge due={row.due} paid={row.paid} charged={row.charged} uncharged={row.uncharged} />
        </button>
    );
}

function QuickLink({ to, icon: Icon, label, hint }: { to: string; icon: React.ElementType; label: string; hint?: string }) {
    return (
        <Link
            to={to}
            style={{
                display: 'flex', alignItems: 'center', gap: 12, minHeight: 52,
                padding: '6px 0', borderBottom: '1px solid var(--color-ink-08)',
                color: 'var(--color-ink)', textDecoration: 'none',
            }}
        >
            <Icon size={20} style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} aria-hidden="true" />
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 16, fontWeight: 500 }}>{label}</span>
                {hint && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-ink-60)' }}>{hint}</span>}
            </span>
            <ChevronRight size={18} aria-hidden="true" style={{ color: 'var(--color-ink-60)' }} />
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
