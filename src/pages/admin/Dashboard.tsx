import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutGrid, Wallet, TrendingUp, AlertCircle } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { AdminInbox } from '../../components/admin/AdminInbox';
import { AcceptPaymentButton } from '../../components/admin/BookingMoneyHints';
import { DueBadge } from '../../components/admin/DueBadge';
import { cashboxApi } from '../../api/cashbox';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { formatGel, formatDateLabel, formatDayMonth, formatTime } from '../../utils/format';
import { BATUMI_TZ, parseUTC } from '../../utils/dateUtils';
import type { BookingHistoryItem, User as AppUser } from '../../store/types';
import { statusLabel, getStatusDef } from '../../design/statuses';
import { STATUS, COLOR } from '../../design/tokens';
import { computeDueByBooking } from '../../utils/dueAmounts';
import { applyAllocation } from '../../utils/balanceAllocation';
import { useAllocationIndex } from '../../hooks/useBalanceAllocation';
import { todayRows, todaySummary, byClient, batumiDayKey, type TodayRow, type TodayClient } from '../../utils/adminToday';
import { hasPermission } from '../../utils/permissions';
import { cashBranchOfBooking } from '../../utils/cashBranch';
import { useArchivedClients } from '../../hooks/useArchivedClients';
import { useRecentWeeklyRebates } from '../../hooks/useRecentWeeklyRebates';
import { weeklyRebateNote, rebateFor, rebateRowsOnce } from '../../utils/weeklyRebateNote';
import { ruCountWord } from '../../utils/plural';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Chip';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusBadge } from '../../components/ui/StatusBadge';

/**
 * /admin — «Сегодня» (волна 4, вариант «Две колонки», решение владельца 01.10).
 *
 * Утром админ должен без кликов видеть, кто сегодня придёт и кто должен.
 *   - сверху: строка кассы (если есть доступ) и сводка «взять X ₾ с N клиентов»;
 *   - «Требует внимания» (AdminInbox) — над колонками;
 *   - слева «Кто придёт»: лента дня, у каждой брони «к оплате / ✓ оплачено»
 *     (неоплаченные — тоном danger, В2);
 *   - справа «Взять сегодня» по клиентам: за сегодня, весь долг, лимит,
 *     «Принять оплату» с суммой «весь долг» и подписью «из них за сегодня» (В3);
 *     ниже «Сверх лимита» и прогноз на завтра.
 *
 * Выручка за месяц и графики переехали в «Финансы» (пакет C): это вопросы
 * владельца, а не админа смены.
 *
 * Данные — только то, что уже грузит админка: fetchAllBookings + fetchUsers.
 * «Сколько взять» — только computeDueByBooking (src/utils/dueAmounts.ts),
 * строки и сводка — src/utils/adminToday.ts. Своих формул денег здесь нет.
 */

type LoadStatus = 'loading' | 'ready' | 'error';

/** «2026-10-02» — следующий календарный день после dayKey. */
function nextDayKey(dayKey: string): string {
    const [y, m, d] = dayKey.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    return t.toISOString().slice(0, 10);
}

export function AdminDashboard() {
    const { bookings, users, currentUser, fetchUsers, fetchAllBookings } = useUserStore();
    const resources = useBookingStore(s => s.resources);

    // Полный админский список — без него «сегодня никого» было бы неправдой.
    const [status, setStatus] = useState<LoadStatus>('loading');
    const load = useCallback(async () => {
        setStatus(s => (s === 'ready' ? 'ready' : 'loading'));
        const ok = await fetchAllBookings();
        setStatus(prev => (ok ? 'ready' : prev === 'ready' ? 'ready' : 'error'));
    }, [fetchAllBookings]);

    // Ждём роль вошедшего: без неё fetchAllBookings молча отказывается, и «Сегодня»
    // показало бы «никого нет» (02.10, тот же случай, что «Гость · 0 ₾» в шахматке).
    const viewerRole = currentUser?.role;
    useEffect(() => {
        if (!viewerRole) return;
        fetchUsers();
        void load();
    }, [viewerRole, fetchUsers, load]);

    // «Сегодня» — по Батуми; в полночь лента сама переключается на новый день.
    const [dayKey, setDayKey] = useState(() => batumiDayKey());
    useEffect(() => {
        const t = window.setInterval(() => setDayKey(batumiDayKey()), 60_000);
        return () => window.clearInterval(t);
    }, []);

    // «К оплате» по каждой брони — та же карта, что в шахматке (03.10: плюс
    // раскладка ленты applyAllocation — брони, покрытые скидкой за прошлую
    // неделю, «оплачено»; частично — «к оплате N из M»).
    const allocIndex = useAllocationIndex(users, bookings);
    const dueMap = useMemo(() => {
        const bal = new Map<string, number>();
        for (const u of users) {
            const v = Number((u as any).balance ?? 0);
            if (u.email) bal.set(u.email, v);
            if (u.id) bal.set(String(u.id), v);
        }
        const balanceOf = (uid: string) => (bal.has(uid) ? bal.get(uid)! : null);
        return applyAllocation(computeDueByBooking(bookings, balanceOf), bookings, allocIndex, balanceOf);
    }, [bookings, users, allocIndex]);

    const rows = useMemo(
        () => todayRows({ bookings, users, dueMap, dayKey, resources }),
        [bookings, users, dueMap, dayKey, resources],
    );
    const summary = useMemo(() => todaySummary(rows), [rows]);
    const clients = useMemo(() => byClient(rows, users), [rows, users]);

    // Брони клиентов, которых нет в обычном списке (аккаунт в архиве после
    // склейки), — подписываем именем из архива с пометкой «архив».
    const missingUserIds = useMemo(() => {
        const known = new Set<string>();
        for (const u of users) { if (u.id) known.add(String(u.id)); if (u.email) known.add(u.email); }
        return rows.filter(r => r.userId && !known.has(r.userId)).map(r => r.userId);
    }, [rows, users]);
    const archived = useArchivedClients(missingUserIds);

    const tomorrowSummary = useMemo(() => {
        const t = todayRows({ bookings, users, dueMap, dayKey: nextDayKey(dayKey), resources });
        return { count: t.length, ...todaySummary(t) };
    }, [bookings, users, dueMap, dayKey, resources]);

    // Сверх лимита — все клиенты, не только сегодняшние (сегодняшние уже справа).
    const overLimit = useMemo(() => {
        const todayKeys = new Set(clients.map(c => c.userId));
        return users
            .filter(u => {
                const debt = (u.balance ?? 0) < 0 ? -(u.balance ?? 0) : 0;
                const limit = u.creditLimit ?? 0;
                return limit > 0 && debt > limit && !todayKeys.has(String(u.id)) && !todayKeys.has(u.email);
            })
            .sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0));
    }, [users, clients]);

    // ── Касса: только при доступе к финансам ──
    const canCash = hasPermission(currentUser, 'finance.manage_cashbox')
        || hasPermission(currentUser, 'finance.view_reports');
    // Недельные скидки с последнего понедельника — метка у клиента (02.10):
    // «скидка за неделю +9 ₾ уже учтена в «к оплате»», чтобы её не вычитали вручную.
    const rebates = useRecentWeeklyRebates(hasPermission(currentUser, 'finance.view_reports'));
    const [cash, setCash] = useState<{ cash: number | null; openedAt: string | null; shiftKnown: boolean } | null>(null);
    // Перечитываем строку кассы и после «Принять оплату» — иначе «наличные»
    // стояли старые до перезагрузки страницы. Ответ, пришедший позже нового
    // запроса, не перетирает свежий (cashReq).
    const [cashReq, setCashReq] = useState(0);
    const reloadCash = useCallback(() => setCashReq(n => n + 1), []);
    useEffect(() => {
        if (!canCash) return;
        let cancelled = false;
        Promise.allSettled([cashboxApi.getBalance(), cashboxApi.getCurrentOpenShift()]).then(([b, s]) => {
            if (cancelled) return;
            setCash({
                cash: b.status === 'fulfilled' ? Number(b.value?.cash ?? 0) : null,
                openedAt: s.status === 'fulfilled' ? (s.value?.openedAt ?? null) : null,
                shiftKnown: s.status === 'fulfilled',
            });
        });
        return () => { cancelled = true; };
    }, [canCash, cashReq]);

    // Новые брони (созданы сегодня/вчера) — короткий поток внизу.
    const recentBookings = useMemo(
        () => [...bookings]
            .filter(b => String(b.paymentMethod || '') !== 'service')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5),
        [bookings],
    );

    return (
        <GridHouseToday
            dayKey={dayKey}
            status={status}
            onRetry={() => { void load(); }}
            rows={rows}
            summary={summary}
            clients={clients}
            users={users}
            overLimit={overLimit}
            tomorrow={tomorrowSummary}
            cash={canCash ? cash : undefined}
            onPaid={reloadCash}
            archived={archived}
            recentBookings={recentBookings}
            rebates={rebates}
        />
    );
}

interface TodayProps {
    dayKey: string;
    status: LoadStatus;
    onRetry: () => void;
    rows: TodayRow[];
    summary: ReturnType<typeof todaySummary>;
    clients: TodayClient[];
    users: AppUser[];
    overLimit: AppUser[];
    tomorrow: { count: number; amount: number; clients: number; label: string };
    /** undefined — нет доступа к кассе (строку не показываем); null — грузится. */
    cash: { cash: number | null; openedAt: string | null; shiftKnown: boolean } | null | undefined;
    /** После «Принять оплату» — перечитать строку кассы. */
    onPaid: () => void;
    /** Архивные клиенты по userId брони — только имя для подписи. */
    archived: Map<string, AppUser>;
    recentBookings: BookingHistoryItem[];
    /** Недельная скидка с последнего понедельника, ₾ — по id клиента и почте. */
    rebates: Map<string, number>;
}

const hairline = `1px solid ${GH.ink10}`;
const monoLabel: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: GH.ink60,
};

function GridHouseToday({
    dayKey, status, onRetry, rows, summary, clients, users, overLimit, tomorrow, cash, onPaid, archived, recentBookings, rebates,
}: TodayProps) {
    const navigate = useNavigate();
    const [filter, setFilter] = useState<'all' | 'due'>('all');
    const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1100);
    useEffect(() => {
        const h = () => setWide(window.innerWidth >= 1100);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    const dueRows = rows.filter(r => r.due !== null && r.due > 0);
    const shown = filter === 'due' ? dueRows : rows;
    // Метка недельной скидки — один раз на клиента, у его первой брони в списке.
    const rebateRow = rebateRowsOnce(shown, rebates);
    const toCollect = clients.filter(c => c.today > 0 || c.total > 0);
    // «Взять сегодня» — только те, у кого есть что взять за сегодняшние брони.
    // Остальные с общим долгом (today = 0: брони уже списаны с баланса) — отдельным
    // блоком ниже, чтобы не выглядели как «брать сегодня». Суммы — те же, byClient.
    const collectToday = toCollect.filter(c => c.today > 0);
    const collectLater = toCollect.filter(c => !(c.today > 0));
    const settled = clients.length - toCollect.length;
    const loading = status !== 'ready' && rows.length === 0;
    const findUser = (key: string) => users.find(u => String(u.id) === key || u.email === key) ?? null;
    const [y, m, d] = dayKey.split('-').map(Number);
    const dayDate = new Date(y, m - 1, d, 12);

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            <PageHeader
                title="Сегодня"
                description={formatDateLabel(dayDate, { capitalize: true })}
                actions={
                    <Button variant="secondary" icon={<LayoutGrid size={16} aria-hidden="true" />}
                        onClick={() => navigate('/admin/bookings?view=grid')}>
                        Шахматка
                    </Button>
                }
            />

            {/* Касса — одна строка, только с доступом к финансам. */}
            {cash !== undefined && (
                <CashLine cash={cash} dayKey={dayKey} />
            )}

            {/* Сводка дня — главная цифра утра. */}
            <div
                data-today-summary
                style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: '14px 16px', marginBottom: 16,
                    border: `1px solid ${summary.amount > 0 ? STATUS.danger.fg : GH.ink10}`,
                    background: summary.amount > 0 ? STATUS.danger.bg : STATUS.ok.bg,
                    color: summary.amount > 0 ? STATUS.danger.fg : STATUS.ok.fg,
                }}
            >
                {summary.amount > 0
                    ? <AlertCircle size={20} aria-hidden="true" />
                    : <TrendingUp size={20} aria-hidden="true" />}
                <span style={{ fontSize: 20, fontWeight: 600 }}>
                    {loading ? 'Считаем, кто сегодня должен…' : summary.label.charAt(0).toUpperCase() + summary.label.slice(1)}
                </span>
                {!loading && (
                    <span style={{ fontSize: 14, color: GH.ink60 }}>
                        · {ruCountWord(rows.length, ['бронь', 'брони', 'броней'])} сегодня
                    </span>
                )}
            </div>

            <AdminInbox users={users} />

            {status === 'error' && (
                <div style={{ marginBottom: 16 }}>
                    <ErrorBar message="Не удалось загрузить брони" onRetry={onRetry} />
                </div>
            )}

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: wide ? 'minmax(0, 1.5fr) minmax(320px, 1fr)' : 'minmax(0, 1fr)',
                    gap: 24,
                    alignItems: 'start',
                    marginBottom: 40,
                }}
            >
                {/* ── Слева: кто придёт ── */}
                <section aria-labelledby="today-who" style={{ border: hairline, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: hairline, flexWrap: 'wrap' }}>
                        <h2 id="today-who" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Кто придёт</h2>
                        <Segmented
                            aria-label="Какие брони показать"
                            value={filter}
                            onChange={setFilter}
                            options={[
                                { value: 'all', label: `Все · ${rows.length}` },
                                // «Должны · 2» — клиентов, как на телефоне (броней у них может быть больше).
                                { value: 'due', label: `Должны · ${summary.clients}` },
                            ]}
                        />
                    </div>
                    {loading ? (
                        <div style={{ padding: 16 }}>
                            <SkeletonList count={4} label="Загружаем брони на сегодня" />
                        </div>
                    ) : shown.length === 0 ? (
                        <EmptyState
                            compact
                            title={filter === 'due' ? 'Сегодня все оплатили' : 'Сегодня броней нет'}
                            hint={filter === 'due' ? 'Брать сегодня не с кого.' : 'Новые брони появятся здесь сами.'}
                        />
                    ) : (
                        // Ширины колонок заданы: имя клиента — одной строкой с обрезкой,
                        // телефон — под ним тоже в одну строку (раньше узкая колонка
                        // клиента переносила имя и телефон на 3–4 строки). Кабинет — под
                        // временем, чтобы отдать место имени.
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, tableLayout: 'fixed' }}>
                            <colgroup>
                                <col style={{ width: 124 }} />
                                <col />
                                <col style={{ width: 150 }} />
                                <col style={{ width: 200 }} />
                            </colgroup>
                            <thead>
                                <tr style={{ background: GH.ink5 }}>
                                    {['Время', 'Клиент', 'Статус', 'Оплата'].map((h, i) => (
                                        <th key={h} scope="col" style={{ ...monoLabel, textAlign: i === 3 ? 'right' : 'left', padding: '8px 12px', fontWeight: 500 }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map(r => {
                                    const owes = r.due !== null && r.due > 0;
                                    const open = () => navigate(`/admin/bookings?view=grid&highlight=${r.bookingId}`);
                                    // Клиента нет в обычном списке — аккаунт в архиве (склейка дублей).
                                    const arch = archived.get(r.userId);
                                    const name = arch?.name || r.client;
                                    const phone = r.phone || arch?.phone || null;
                                    const rebate = rebateRow.get(r.bookingId) ?? 0;
                                    return (
                                        <tr
                                            key={r.bookingId}
                                            data-due={owes ? 'danger' : r.paid ? 'ok' : 'none'}
                                            onClick={open}
                                            onKeyDown={e => { if (e.key === 'Enter') open(); }}
                                            tabIndex={0}
                                            title="Открыть в шахматке"
                                            style={{
                                                borderTop: hairline,
                                                cursor: 'pointer',
                                                // Неоплаченная бронь — заметно (В2): полоса danger слева + бейдж.
                                                boxShadow: owes ? `inset 3px 0 0 ${STATUS.danger.fg}` : undefined,
                                                background: owes ? STATUS.danger.bg : undefined,
                                            }}
                                        >
                                            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                <div className="num" style={{ fontFamily: GH_MONO }}>{r.time}–{r.endTime}</div>
                                                <div style={{ fontSize: 12, color: GH.ink60, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.cabinet}</div>
                                            </td>
                                            <td style={{ padding: '10px 12px', minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                                                    <Link
                                                        to={`/admin/users/${encodeURIComponent(r.userId)}`}
                                                        onClick={e => e.stopPropagation()}
                                                        title={name}
                                                        style={{ color: GH.ink, fontWeight: 600, textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                    >
                                                        {name}
                                                    </Link>
                                                    {arch && (
                                                        <span className="ui-badge ui-badge--muted" title="Аккаунт клиента в архиве (склеен с другим)" style={{ flexShrink: 0 }}>архив</span>
                                                    )}
                                                </div>
                                                {phone && (
                                                    <div style={{ fontSize: 12, color: GH.ink60, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        <a href={`tel:${phone}`} onClick={e => e.stopPropagation()} style={{ color: GH.ink60 }}>{phone}</a>
                                                    </div>
                                                )}
                                                {rebate > 0 && (
                                                    <div data-weekly-rebate-note style={{ fontSize: 12, color: STATUS.ok.fg, lineHeight: 1.35 }}>
                                                        {weeklyRebateNote(rebate)}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                <StatusBadge kind="booking" status={r.status} audience="staff" variant="dot" />
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <DueBadge due={r.due} paid={r.paid} charged={r.charged} uncharged={r.uncharged} price={r.price} />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </section>

                {/* ── Справа: взять сегодня ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
                    <section aria-labelledby="today-collect" style={{ border: hairline }}>
                        <div style={{ padding: '12px 16px', borderBottom: loading || toCollect.length === 0 || collectToday.length > 0 ? hairline : 'none' }}>
                            <h2 id="today-collect" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Взять сегодня</h2>
                            {!loading && (
                                <div style={{ fontSize: 14, color: GH.ink60, marginTop: 2 }}>
                                    {summary.amount > 0 ? summary.label : 'Сегодня брать не с кого'}
                                    {settled > 0 && ` · ${ruCountWord(settled, ['клиент', 'клиента', 'клиентов'])} уже оплатили`}
                                </div>
                            )}
                        </div>
                        {loading ? (
                            <div style={{ padding: 16 }}><SkeletonList count={2} label="Считаем долги" /></div>
                        ) : toCollect.length === 0 ? (
                            <EmptyState compact title="Все оплатили" hint="У сегодняшних клиентов нет долга." />
                        ) : collectToday.length > 0 && (
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                {collectToday.map(c => (
                                    <CollectRow key={c.userId} c={c} user={findUser(c.userId) ?? findUser(c.rows[0]?.userId ?? '')} onPaid={onPaid} rebates={rebates} />
                                ))}
                            </ul>
                        )}
                    </section>

                    {!loading && collectLater.length > 0 && (
                        <section aria-labelledby="today-later" data-collect-later style={{ border: hairline }}>
                            <div style={{ padding: '12px 16px' }}>
                                <h2 id="today-later" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Долг по другим броням: не сегодня</h2>
                                <div style={{ fontSize: 14, color: GH.ink60, marginTop: 2 }}>
                                    Эти брони уже списаны с баланса, оплатить их можно, когда клиент придёт
                                </div>
                            </div>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                {collectLater.map(c => (
                                    <CollectRow key={c.userId} c={c} user={findUser(c.userId) ?? findUser(c.rows[0]?.userId ?? '')} onPaid={onPaid} rebates={rebates} />
                                ))}
                            </ul>
                        </section>
                    )}

                    {overLimit.length > 0 && (
                        <section aria-labelledby="today-over" style={{ border: hairline }}>
                            <div style={{ padding: '12px 16px', borderBottom: hairline, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                <h2 id="today-over" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Сверх лимита</h2>
                                <Link to="/admin/users?filter=over_limit" style={{ fontSize: 14, color: GH.ink60 }}>
                                    Все · {overLimit.length}
                                </Link>
                            </div>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                {overLimit.slice(0, 6).map(u => (
                                    <li key={u.id || u.email} style={{ borderTop: hairline, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                                        <Link to={`/admin/users/${encodeURIComponent(u.email || u.id)}`} style={{ color: GH.ink, textDecoration: 'none', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {u.name || u.email}
                                        </Link>
                                        <span className="num" style={{ whiteSpace: 'nowrap', color: STATUS.danger.fg }}>
                                            {formatGel(u.balance ?? 0)} <span style={{ color: GH.ink60 }}>· лимит {formatGel(u.creditLimit ?? 0, { fraction: 0 })}</span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <section aria-labelledby="today-forecast" style={{ border: hairline, padding: '12px 16px' }}>
                        <h2 id="today-forecast" style={{ ...monoLabel, margin: 0, marginBottom: 6 }}>Прогноз · завтра</h2>
                        <div style={{ fontSize: 14 }}>
                            {loading
                                ? '—'
                                : tomorrow.count === 0
                                    ? 'Завтра броней пока нет'
                                    : <>{ruCountWord(tomorrow.count, ['бронь', 'брони', 'броней'])} · {tomorrow.amount > 0 ? tomorrow.label : 'брать не с кого'}</>}
                        </div>
                    </section>
                </div>
            </div>

            <RecentBookings recentBookings={recentBookings} users={users} />
        </div>
    );
}

function CashLine({ cash, dayKey }: { cash: TodayProps['cash']; dayKey: string }) {
    if (cash === undefined) return null;
    let shiftText = 'Касса: …';
    if (cash) {
        if (!cash.shiftKnown) shiftText = 'Касса';
        else if (!cash.openedAt) shiftText = 'Касса: смена не открыта';
        else {
            const at = parseUTC(cash.openedAt);
            const sameDay = batumiDayKey(at) === dayKey;
            shiftText = `Касса: смена открыта с ${sameDay ? '' : formatDayMonth(at, { timeZone: BATUMI_TZ }) + ', '}${formatTime(at, { timeZone: BATUMI_TZ })}`;
        }
    }
    return (
        <div
            data-cash-line
            style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '8px 0', marginBottom: 12, fontSize: 14, color: GH.ink,
                borderBottom: hairline,
            }}
        >
            <Wallet size={16} aria-hidden="true" style={{ color: GH.ink60 }} />
            <span>{shiftText}</span>
            {cash && cash.cash !== null && (
                <span>· наличные <span className="num" style={{ fontWeight: 600 }}>{formatGel(cash.cash, { fraction: 0 })}</span></span>
            )}
            <Link to="/admin/finance" style={{ marginLeft: 'auto', color: GH.ink60, fontSize: 14 }}>Открыть кассу</Link>
        </div>
    );
}

function CollectRow({ c, user, onPaid, rebates }: { c: TodayClient; user: AppUser | null; onPaid: () => void; rebates: Map<string, number> }) {
    // В3: по умолчанию — весь долг клиента, подпись «из них за сегодня».
    const amount = c.total > 0 ? c.total : c.today;
    const rebate = rebateFor(rebates, c.userId, c.rows[0]?.userId, user?.id, user?.email);
    const hint = c.total > 0
        ? (c.today > 0
            ? `Весь долг ${formatGel(c.total)}, из них за сегодня ${formatGel(c.today)}`
            : `Весь долг ${formatGel(c.total)} — по броням, уже списанным с баланса, не за сегодня`)
        : `За сегодня ${formatGel(c.today)}`;
    return (
        <li style={{ borderTop: hairline, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <Link to={`/admin/users/${encodeURIComponent(user?.email || c.userId)}`} style={{ color: GH.ink, fontWeight: 600, textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.client}
                </Link>
                <span className="num" style={{ fontSize: 16, fontWeight: 600, color: STATUS.danger.fg, whiteSpace: 'nowrap' }}>
                    {formatGel(amount)}
                </span>
            </div>
            <div style={{ fontSize: 14, color: GH.ink60, display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                <span>за сегодня <span className="num" style={{ color: GH.ink }}>{formatGel(c.today)}</span></span>
                <span>весь долг <span className="num" style={{ color: GH.ink }}>{formatGel(c.total)}</span>{c.total > c.today && c.today > 0 && <> (из них за сегодня {formatGel(c.today)})</>}</span>
                <span>
                    {c.creditLimit !== null && c.creditLimit > 0
                        ? <>лимит <span className="num" style={{ color: GH.ink }}>{formatGel(c.creditLimit, { fraction: 0 })}</span></>
                        : 'лимит не задан'}
                </span>
                {c.overLimit && (
                    <span className="ui-badge ui-badge--danger">сверх лимита</span>
                )}
            </div>
            {rebate > 0 && (
                <div data-weekly-rebate-note style={{ fontSize: 12, color: STATUS.ok.fg }}>{weeklyRebateNote(rebate)}</div>
            )}
            <div>
                {/* Филиал — по кабинету первой сегодняшней брони (rows по времени), как на телефоне. */}
                <AcceptPaymentButton
                    client={user} defaultAmount={amount} hint={hint} appearance="primary"
                    branch={c.rows[0] ? cashBranchOfBooking({ resourceId: c.rows[0].cabinetId }) : undefined}
                    onPaid={onPaid}
                />
            </div>
        </li>
    );
}

function RecentBookings({ recentBookings, users }: { recentBookings: BookingHistoryItem[]; users: AppUser[] }) {
    const navigate = useNavigate();
    if (recentBookings.length === 0) return null;
    return (
        <section aria-labelledby="today-recent" style={{ marginBottom: 40 }}>
            <h2 id="today-recent" style={{ ...monoLabel, margin: 0, marginBottom: 10 }}>Новые брони</h2>
            <div style={{ border: hairline }}>
                {recentBookings.map((b, i) => {
                    const clientName = users.find(u => u.email === b.userId || u.id === b.userId)?.name || b.userId;
                    // Слово и цвет — из общего словаря статусов (цвет = смысл статуса).
                    const statusColor = STATUS[getStatusDef('booking', b.status).tone].fg;
                    const statusText = statusLabel('booking', b.status, 'staff');
                    return (
                        <button
                            key={b.id}
                            type="button"
                            onClick={() => navigate(`/admin/bookings?view=grid&highlight=${b.id}`)}
                            title="Открыть в шахматке"
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '150px minmax(0, 1fr) 140px 110px',
                                gap: 12,
                                padding: '10px 16px',
                                borderTop: i > 0 ? hairline : 'none',
                                alignItems: 'center',
                                width: '100%',
                                textAlign: 'left',
                                background: COLOR.card,
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 14,
                                color: GH.ink,
                            }}
                        >
                            <span className="num" style={{ color: GH.ink }}>
                                {formatDayMonth(parseUTC(b.date), { timeZone: 'UTC' })} · {b.startTime}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clientName}</span>
                            <span style={{ color: statusColor, fontSize: 12 }}>{statusText}</span>
                            <span className="num" style={{ textAlign: 'right' }}>
                                {b.paymentMethod === 'subscription' ? 'Абонемент' : formatGel(b.finalPrice)}
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
