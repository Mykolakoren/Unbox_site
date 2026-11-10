import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Users as UsersIcon, ShieldCheck, BookOpen, DoorOpen, Plus, Contact, KeyRound, Wallet,
} from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { useBookingStore } from '../../../store/bookingStore';
import { bookingsApi } from '../../../api/bookings';
import type { BookingHistoryItem, User } from '../../../store/types';
import { statusLabel } from '../../../design/statuses';
import { MorningChecklistCard } from '../../../components/admin/cashbox/MorningChecklistModal';
import { RESOURCES } from '../../../utils/data';
import { futureChargedDue, todayRows, todaySummary, byClient, batumiDayKey, type TodayRow, type TodayClient } from '../../../utils/adminToday';
import { AdminBookingSheets, getAdminUserName } from './bookingSheets';
import { useAdminDueMap, acceptPaymentFor, branchOfBooking, type AcceptPayment } from './adminPayment';
import { useAllocationIndex } from '../../../hooks/useBalanceAllocation';
import { hiddenDebts, hiddenDebtNote, type HiddenDebt } from '../../../utils/balanceAllocation';
import { userCanAccessFinance, hasPermission } from '../../../utils/permissions';
import { TopupSheet } from './TopupSheet';
import { DueBadge } from '../../../components/admin/DueBadge';
import { Button } from '../../../components/ui/Button';
import { Segmented } from '../../../components/ui/Chip';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { ListGroup, ListRow, ListIcon } from '../../../components/ui/ListRow';
import { Money } from '../../../components/ui/Money';
import { AdminBookingRow } from './AdminBookingRow';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { formatDateLabel, formatGel } from '../../../utils/format';
import { useArchivedClients } from '../../../hooks/useArchivedClients';
import { useRecentWeeklyRebates } from '../../../hooks/useRecentWeeklyRebates';
import { weeklyRebateNote, rebateFor, rebateRowsOnce } from '../../../utils/weeklyRebateNote';

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
    // Долги по броням вне списка (риск 1, 03.10): брони старше окна админки,
    // отменённые со штрафом, списания не за бронь — на бронях списка их не видно.
    const allocIndex = useAllocationIndex(users || [], bookings || []);
    const hidden = useMemo(() => {
        const bal = new Map<string, number>();
        for (const u of users || []) {
            if (u.email) bal.set(u.email, Number(u.balance ?? 0));
            if (u.id) bal.set(String(u.id), Number(u.balance ?? 0));
        }
        return hiddenDebts(dueMap, bookings, allocIndex, uid => (bal.has(uid) ? bal.get(uid)! : null));
    }, [dueMap, bookings, allocIndex, users]);
    const hiddenTotal = Math.round(hidden.reduce((s, h) => s + h.amount, 0) * 100) / 100;
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
    const futureDue = useMemo(() => futureChargedDue(bookings, dueMap, todayKey), [bookings, dueMap, todayKey]);
    const owing = useMemo(
        () => byClient(rowsToday, users, futureChargedDue(bookings, dueMap, todayKey)).filter(c => c.today > 0 || c.total > 0),
        [rowsToday, users, bookings, dueMap, todayKey],
    );
    // «Должны» делим: сначала те, с кого брать сегодня (today > 0), ниже — долг по
    // другим броням (today = 0: брони уже списаны с баланса, брать не сегодня).
    const owingToday = useMemo(() => owing.filter(c => c.today > 0), [owing]);
    const owingLater = useMemo(() => owing.filter(c => !(c.today > 0)), [owing]);

    // Ревью 09.11 (№15): ОДИН список «Должны» — все, у кого долг, а не только те,
    // у кого бронь сегодня. Долг без сегодняшней брони = минус на балансе минус
    // будущие брони, списанные заранее (их возьмут в свой день, решение 06.10),
    // плюс «долги по броням вне списка». Число на вкладке — все эти клиенты.
    const otherDebtors = useMemo(() => {
        const inOwing = new Set<string>();
        for (const c of owing) for (const r of c.rows) { inOwing.add(r.userId); inOwing.add(c.userId); }
        const hiddenOf = new Map<string, HiddenDebt>();
        for (const h of hidden) { hiddenOf.set(h.userId, h); if (h.email) hiddenOf.set(h.email, h); }
        const out: OtherDebtor[] = [];
        for (const u of users || []) {
            const keys = [String(u.id || ''), u.email || ''].filter(Boolean);
            if (keys.some(k => inOwing.has(k))) continue;
            const bal = Number(u.balance ?? 0);
            const future = keys.reduce((s, k) => s + (futureDue.get(k) || 0), 0);
            const amount = Math.round((Math.max(0, -bal) - future) * 100) / 100;
            if (!(amount > 0)) continue;
            const h = keys.map(k => hiddenOf.get(k)).find(v => v !== undefined);
            out.push({ user: u, amount, hidden: !!h && h.amount > 0, note: h && h.amount > 0 ? hiddenDebtNote(h) : undefined });
        }
        out.sort((a, b) => b.amount - a.amount || (a.user.name || '').localeCompare(b.user.name || '', 'ru'));
        return out;
    }, [owing, hidden, users, futureDue]);
    const debtorsCount = owing.filter(c => c.total > 0).length + otherDebtors.length;
    const debtTotal = Math.round((owing.reduce((s, c) => s + c.total, 0) + otherDebtors.reduce((s, d) => s + d.amount, 0)) * 100) / 100;
    const forecastCount = forecast?.count ?? 0;
    const urgentCount = pendingApprovals?.length ?? 0;

    // Брони могли уже лежать в сторе (открывали «Брони») — тогда показываем их.
    const bookingsPending = !bookingsLoaded && bookings.length === 0;
    const isOwnerish = currentUser?.role === 'owner' || currentUser?.role === 'senior_admin';
    // «Принять оплату» — только с правом на кассу (как вкладка «Касса»).
    const canCash = userCanAccessFinance(currentUser);
    // Недельные скидки с последнего понедельника — метка у клиента (02.10):
    // «скидка за неделю +9 ₾ уже учтена в «к оплате»», чтобы её не вычитали вручную.
    const rebates = useRecentWeeklyRebates(hasPermission(currentUser, 'finance.view_reports'));

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

    /** «Принять оплату · N ₾» — одна кнопка на всех строках «Должны». */
    const payButton = (amount: number, onClick: () => void) => canCash ? (
        // 09.11 фаза 3: «вторая» кнопка (рамка), не бирюзовая заливка — бирюза одна
        // на экран («+ Бронь»), а N мятных полос подряд кричали громче долгов.
        <Button
            variant="secondary"
            block
            icon={<Wallet size={16} aria-hidden="true" />}
            disabled={!(amount > 0)}
            onClick={onClick}
        >
            Принять оплату · <Money value={amount} inline />
        </Button>
    ) : null;

    // Карточка должника «Должны»; later — долг не за сегодня (нейтральная рамка).
    const renderOwing = (c: TodayClient, later = false) => {
        const rebate = rebateFor(rebates, c.userId, c.rows[0]?.userId);
        return (
        <div key={c.userId} style={debtorCard(!later)}>
            {!later && <span className="ui-row__stripe ui-row__stripe--danger" aria-hidden="true" />}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <Link
                    to={`/m/admin/users/${encodeURIComponent(c.rows[0]?.userId || c.userId)}`}
                    style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-ink)', textDecoration: 'none' }}
                >
                    {c.client}
                </Link>
                <Money value={c.total} tone="debt" className="text-body font-semibold" />
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>
                За сегодня <Money value={c.today} inline />
                {' · '}весь долг <Money value={c.total} inline />
                {c.creditLimit !== null && <> · лимит <Money value={c.creditLimit} inline /></>}
                {c.overLimit && <span style={{ color: 'var(--status-danger-fg)', fontWeight: 600 }}> · сверх лимита</span>}
            </div>
            <div className="num-inline" style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>
                {c.rows.map(r => `${r.time} ${r.cabinet}`).join(' · ')}
            </div>
            {rebate > 0 && (
                <div data-weekly-rebate-note style={{ fontSize: 14, color: 'var(--status-ok-fg)' }}>{weeklyRebateNote(rebate)}</div>
            )}
            {payButton(c.total, () => openPayFor(c))}
        </div>
        );
    };

    /** Должник без сегодняшней брони — строка ≥ 44 px с «Принять оплату · весь долг». */
    const renderOther = (d: OtherDebtor) => (
        <div key={String(d.user.id || d.user.email)} data-other-debtor style={debtorCard(false)}>
            <Link to={`/m/admin/users/${encodeURIComponent(d.user.email || String(d.user.id))}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44, color: 'var(--color-ink)', textDecoration: 'none' }}>
                <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 16, fontWeight: 600, overflowWrap: 'anywhere' }}>{d.user.name || d.user.email}</span>
                    {d.hidden && <span style={{ display: 'block', fontSize: 14, color: 'var(--color-ink-60)' }}>{d.note || 'долг по броням вне списка'}</span>}
                </span>
                <Money value={d.amount} tone="debt" className="text-body font-semibold" />
            </Link>
            {payButton(d.amount, () => setPay({ user: d.user, total: d.amount, today: 0 }))}
        </div>
    );

    return (
        <div style={{ paddingTop: 8, paddingBottom: 96, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* «+ Бронь» — в шапке, а не плавающей кнопкой: плавающий «+» лежал
                поверх строк ленты и закрывал отметку «к оплате / ✓» справа.
                09.11 фаза 3: общая крупная шапка, главная кнопка — бирюзовая
                (Button primary), без чёрной «пилюли». */}
            <MobilePageHeader
                variant="large"
                className="pb-0"
                title="Сегодня"
                subtitle={formatDateLabel(new Date(), { capitalize: true })}
                action={
                    /* Бронь от своего имени: сбрасываем «бронь за клиента». */
                    <Link
                        to="/m/find?admin=1"
                        aria-label="Новая бронь"
                        onClick={() => setBookingForUser(null)}
                        className="ui-btn ui-btn--primary"
                    >
                        <Plus size={18} aria-hidden="true" />
                        Бронь
                    </Link>
                }
            />

            {approvalsFailed && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось проверить заявки" onRetry={loadApprovals} />
                </div>
            )}

            {/* Сводка сразу под датой (ревью 09.11, admin-design №12): «Взять сегодня ·
                Должны · За лимит · Ждёт подтверждения». Ненулевая ячейка — своим тоном и
                ведёт на свой экран; нулевая — серая. Денежные предупреждения больше не
                внизу под лентой, а «Сегодня брать не с кого» — тихая серая надпись. */}
            <div style={{ padding: '0 16px' }}>
                {bookingsPending ? (
                    <SkeletonList count={1} label="Считаем, кто должен" cardHeight={72} />
                ) : (
                    <div data-today-summary role="group" aria-label="Сводка дня" style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                    }}>
                        <SummaryCell
                            label="Взять сегодня"
                            value={summary.amount > 0 ? formatGel(summary.amount) : null}
                            sub={summary.amount > 0
                                ? `${summary.clients} ${plural(summary.clients, 'клиент', 'клиента', 'клиентов')}`
                                : 'брать не с кого'}
                            tone="danger"
                            ariaLabel={summary.amount > 0
                                ? `Взять сегодня ${formatGel(summary.amount)} с ${summary.clients} ${plural(summary.clients, 'клиента', 'клиентов', 'клиентов')} — показать должников`
                                : 'Сегодня брать не с кого'}
                            onClick={() => setSeg('due')}
                        />
                        <SummaryCell
                            label="Должны всего"
                            value={debtorsCount > 0 ? formatGel(debtTotal) : null}
                            sub={debtorsCount > 0 ? `${debtorsCount} ${plural(debtorsCount, 'клиент', 'клиента', 'клиентов')}` : 'долгов нет'}
                            tone="danger"
                            onClick={() => setSeg('due')}
                        />
                        <SummaryCell
                            label="Уйдут за лимит"
                            value={forecastCount > 0 ? String(forecastCount) : null}
                            sub={forecastCount > 0 ? plural(forecastCount, 'клиент', 'клиента', 'клиентов') : 'никто'}
                            tone="pending"
                            onClick={() => setSeg('due')}
                        />
                        <SummaryCell
                            label={statusLabel('booking', 'pending_approval', 'staff')}
                            value={urgentCount > 0 ? String(urgentCount) : null}
                            sub={urgentCount > 0 ? plural(urgentCount, 'срочная бронь', 'срочные брони', 'срочных броней') : 'срочных нет'}
                            tone="pending"
                            to="/m/admin/inbox"
                        />
                    </div>
                )}
            </div>

            {/* Чек-лист смены — карточкой здесь, а не окном поверх «Кассы» (ревью 09.11, №17). */}
            {currentUser?.email && (
                <div style={{ padding: '0 16px' }}>
                    <MorningChecklistCard adminEmail={currentUser.email} />
                </div>
            )}

            <div style={{ padding: '0 16px' }}>
                <Segmented<Seg>
                    aria-label="Что показать"
                    options={[
                        { value: 'all', label: bookingsPending ? 'Все' : `Все · ${rowsToday.length}` },
                        { value: 'due', label: bookingsPending ? 'Должны' : `Должны · ${debtorsCount}` },
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
                    owing.length === 0 && otherDebtors.length === 0 && forecastCount === 0 ? (
                        <EmptyState compact title="Никто не должен" hint="Все брони списаны с баланса или идут по абонементу." />
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <DueSection title="Сегодня" count={owingToday.length} empty="Сегодня брать не с кого">
                                {owingToday.map(c => renderOwing(c))}
                            </DueSection>
                            {(owingLater.length > 0 || otherDebtors.length > 0) && (
                                <DueSection
                                    title="Старые долги"
                                    count={owingLater.length + otherDebtors.length}
                                    note="Эти брони уже списаны с баланса, оплатить их можно, когда клиент придёт"
                                >
                                    {owingLater.map(c => renderOwing(c, true))}
                                    {hidden.length > 0 && (
                                        <div data-hidden-debts style={{ fontSize: 14, color: 'var(--color-ink-60)', lineHeight: 1.45 }}>
                                            Долги вне списка броней: {hidden.length} {plural(hidden.length, 'клиент', 'клиента', 'клиентов')}
                                            {' '}(пакеты и абонементы в долг, старые брони, отмены со штрафом), всего <Money value={hiddenTotal} inline />
                                        </div>
                                    )}
                                    {otherDebtors.map(renderOther)}
                                </DueSection>
                            )}
                            {forecast && forecastCount > 0 && (
                                <DueSection
                                    title="Скоро уйдут за лимит"
                                    count={forecastCount}
                                    note="Будущие брони спишутся и уведут баланс за кредитный лимит — предложите пополнить"
                                >
                                    {forecast.clients.map(c => {
                                        const u = (users || []).find(x => String(x.id) === c.userId || x.email === c.email);
                                        return (
                                            <div key={c.userId} data-forecast-row style={debtorCard(false)}>
                                                <Link to={`/m/admin/users/${encodeURIComponent(c.email)}`}
                                                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 44, textDecoration: 'none', color: 'inherit' }}>
                                                    <span style={{ minWidth: 0 }}>
                                                        <span style={{ display: 'block', fontSize: 16, fontWeight: 600, overflowWrap: 'anywhere' }}>{c.name}</span>
                                                        <span className="num-inline" style={{ display: 'block', fontSize: 14, color: 'var(--color-ink-60)', marginTop: 2 }}>
                                                            баланс {formatGel(c.balance)} · лимит {formatGel(c.creditLimit)} · ждут списания {formatGel(c.pendingTotal)} ({c.pendingCount})
                                                        </span>
                                                    </span>
                                                    <span style={{ textAlign: 'right', flexShrink: 0 }}>
                                                        {/* Ещё не долг, а прогноз: чернилами, не красным и не янтарём (09.11 фаза 3). */}
                                                        <Money value={c.overLimitBy} className="block text-small font-semibold" />
                                                        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-ink-60)' }}>за лимит</span>
                                                    </span>
                                                </Link>
                                                {u && payButton(c.overLimitBy, () => setPay({ user: u, total: c.overLimitBy, today: 0 }))}
                                            </div>
                                        );
                                    })}
                                </DueSection>
                            )}
                        </div>
                    )
                ) : (
                    (() => {
                        const rows = seg === 'tomorrow' ? rowsTomorrow : rowsToday;
                        if (rows.length === 0) {
                            return <EmptyState compact title={seg === 'tomorrow' ? 'Завтра броней нет' : 'Сегодня броней нет'} />;
                        }
                        // Метка недельной скидки — один раз на клиента, у первой брони.
                        const rebateRow = rebateRowsOnce(rows, rebates);
                        // 09.11 фаза 3: строки в одной группе (как в CRM), а не стопка карточек.
                        return (
                            <ListGroup aria-label={seg === 'tomorrow' ? 'Брони завтра' : 'Брони сегодня'}>
                                {rows.map(r => <DayRow key={r.bookingId} row={r} archivedName={archived.get(r.userId)?.name} rebate={rebateRow.get(r.bookingId)} onOpen={() => openRow(r)} />)}
                            </ListGroup>
                        );
                    })()
                )}
            </div>

            {/* Разделы, которые не влезли в нижнее меню — списком, не плитками. */}
            <nav aria-label="Ещё разделы" style={{ padding: '8px 16px 0' }}>
                <ListGroup title="Ещё">
                    <QuickLink to="/m/admin/crm" icon={Contact} label="CRM клиентов" hint="Спящие клиенты, воронка" />
                    <QuickLink to="/m/admin/cabinets" icon={DoorOpen} label="Кабинеты" hint="Включить, закрыть, лист ожидания" />
                    <QuickLink to="/m/admin/specialists" icon={ShieldCheck} label="Специалисты" hint="Анкеты на проверке" />
                    <QuickLink to="/m/admin/team" icon={UsersIcon} label="Команда" />
                    <QuickLink to="/m/admin/kb" icon={BookOpen} label="База знаний" />
                    {isOwnerish && <QuickLink to="/m/admin/access-rights" icon={KeyRound} label="Права доступа" />}
                </ListGroup>
            </nav>

            <AdminBookingSheets
                booking={activeBooking}
                getUserName={email => getAdminUserName(users, email)}
                onClose={() => setActiveBooking(null)}
                dueInfo={activeBooking ? dueMap.get(activeBooking.id) : undefined}
                acceptPayment={b => {
                    const p = acceptPaymentFor(b, bookings, users, dueMap);
                    if (!p) return null;
                    return {
                        total: p.total,
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

/** Должник без брони сегодня (минус на балансе, не за завтрашние брони). */
interface OtherDebtor {
    user: User;
    amount: number;
    /** Часть долга — по броням вне списка (старые, отменённые со штрафом…). */
    hidden: boolean;
    /** Подпись: «пакет 16 ч на неделю 09.11–15.11» или «долг по броням вне списка». */
    note?: string;
}

/** Раздел «Должны»: заголовок с числом, пояснение, строки. */
function DueSection({ title, count, note, empty, children }: {
    title: string; count: number; note?: string; empty?: string; children: React.ReactNode;
}) {
    return (
        <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 09.11 фаза 3: подпись раздела — как у ListGroup (12/600 капсом), число справа. */}
            <div style={{ padding: '0 4px' }}>
                <div className="ui-list-group__head" style={{ margin: 0, padding: 0 }}>
                    <h2 className="ui-list-group__title">{title}</h2>
                    <span className="ui-list-group__aside num">{count}</span>
                </div>
                {note && <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 2, lineHeight: 1.45 }}>{note}</div>}
            </div>
            {count === 0 && empty
                ? <div style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>{empty}</div>
                : children}
        </section>
    );
}

/** Ячейка сводки дня: нулевая — серая, ненулевая — своим тоном и ведёт на свой экран. */
function SummaryCell({ label, value, sub, tone, onClick, to, ariaLabel }: {
    label: string;
    value: string | null;
    sub: string;
    tone: 'danger' | 'pending';
    onClick?: () => void;
    to?: string;
    ariaLabel?: string;
}) {
    const active = value !== null;
    const style: React.CSSProperties = {
        display: 'flex', flexDirection: 'column', gap: 2, minHeight: 64, width: '100%',
        padding: '8px 12px', borderRadius: 8, textAlign: 'left', fontFamily: 'inherit',
        // 09.11 фаза 3: нулевая ячейка — тихая серая (как ячейки SummaryCard), ненулевая — своим тоном.
        border: 'none',
        background: active ? `var(--status-${tone}-bg)` : 'var(--color-sunken)',
        color: active ? `var(--status-${tone}-fg)` : 'var(--color-ink-60)',
        cursor: active ? 'pointer' : 'default', textDecoration: 'none',
    };
    const body = (
        <>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
            {active && <span className="num" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2 }}>{value}</span>}
            <span className="num-inline" style={{ fontSize: 12 }}>{sub}</span>
        </>
    );
    if (to && active) return <Link to={to} className="press" style={style} aria-label={ariaLabel}>{body}</Link>;
    return (
        <button type="button" className={active ? 'press' : undefined} disabled={!active} onClick={onClick} style={style} aria-label={ariaLabel}>
            {body}
        </button>
    );
}


/** Строка дня: время · клиент · кабинет · «к оплате / ✓». Неоплаченная — полосой danger (В2).
 *  09.11 фаза 3: общая строка брони AdminBookingRow (ListRow + ListTime). */
function DayRow({ row, archivedName, rebate, onOpen }: { row: TodayRow; archivedName?: string; rebate?: number; onOpen: () => void }) {
    // У заявки «Ждёт подтверждения» денежной метки и красной полосы нет (решение 09.11).
    const owes = row.due !== null && row.due > 0 && row.status !== 'pending_approval';
    // Слово статуса — из statuses.ts (AdminBookingRow); «прошла» — тише, в подписи.
    const note = row.status === 'completed' ? ' · прошла' : '';
    return (
        <AdminBookingRow
            start={row.time}
            end={row.endTime}
            name={archivedName || row.client}
            archived={!!archivedName}
            subtitle={<><span style={{ whiteSpace: 'nowrap' }}>{row.cabinet}</span>{note}</>}
            status={row.status === 'pending_approval' ? row.status : null}
            dimmed={row.status === 'completed' && !owes}
            owes={owes}
            note={!!rebate && rebate > 0 ? (
                <span data-weekly-rebate-note style={{ fontSize: 12, color: 'var(--status-ok-fg)', lineHeight: 1.35 }}>
                    {weeklyRebateNote(rebate)}
                </span>
            ) : undefined}
            badge={<DueBadge due={row.due} paid={row.paid} charged={row.charged} uncharged={row.uncharged} price={row.price} className="whitespace-normal h-auto py-1 max-w-[124px] text-right" status={row.status} method={row.paymentMethod} />}
            onClick={onOpen}
        />
    );
}

function QuickLink({ to, icon: Icon, label, hint }: { to: string; icon: React.ElementType; label: string; hint?: string }) {
    return (
        <ListRow
            to={to}
            lead={<ListIcon><Icon size={20} /></ListIcon>}
            title={<span style={{ fontWeight: 500 }}>{label}</span>}
            subtitle={hint}
        />
    );
}

/** Карточка должника (09.11 фаза 3): радиус 16, тонкая рамка; «за сегодня» — красной полосой слева, а не красной рамкой. */
function debtorCard(stripe: boolean): React.CSSProperties {
    return {
        position: 'relative',
        background: 'var(--color-card)', border: '1px solid var(--color-ink-10)',
        borderRadius: 16, padding: stripe ? '12px 16px 12px 20px' : '12px 16px',
        display: 'flex', flexDirection: 'column', gap: 8,
    };
}
