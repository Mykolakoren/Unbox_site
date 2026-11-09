import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Phone, Send, Mail, Plus, Wallet, CalendarPlus } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { useBookingStore } from '../../../store/bookingStore';
import { bookingsApi } from '../../../api/bookings';
import { usersApi, type BalanceLedgerResponse } from '../../../api/users';
import { bonusesApi, type Bonus } from '../../../api/bonuses';
import type { BookingHistoryItem } from '../../../store/types';
import { RESOURCES } from '../../../utils/data';
import { REASON_LABELS } from '../../../utils/ledgerReasons';
import { computeDueByBooking } from '../../../utils/dueAmounts';
import { applyAllocation, indexAllocation, ledgerRowLine, allocationHeadline } from '../../../utils/balanceAllocation';
import { useClientAllocation } from '../../../hooks/useBalanceAllocation';
import { batumiDayKey, bookingDayKey, futureChargedDue } from '../../../utils/adminToday';
import { cashBranchOfLastBooking } from '../../../utils/cashBranch';
import { AdminBookingSheets, getAdminUserName } from './bookingSheets';
import { humanizeMoneyText } from './branchLabel';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { phoneHref, telegramHref } from '../../../utils/contactLinks';
import { formatDateLabel, formatDayMonth, formatGel, formatTime } from '../../../utils/format';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { Skeleton, SkeletonList } from '../../../components/ui/Skeleton';
import { DueBadge } from '../../../components/admin/DueBadge';
import { TopupSheet } from './TopupSheet';
import { userCanAccessFinance } from '../../../utils/permissions';
import { extraPoolLabel } from '../../../utils/subscriptionHours';
import { DesktopLink } from './DesktopLink';
import { SummaryCard } from '../../../components/ui/SummaryCard';
import { Money } from '../../../components/ui/Money';
import { ListGroup, ListRow, ListIcon } from '../../../components/ui/ListRow';
import { AdminBookingRow } from './AdminBookingRow';

/**
 * Карточка клиента на телефоне — /m/admin/users/:email (волна 4, пакет A).
 *
 * Раньше здесь открывалась компьютерная страница AdminUserDetails, сжатая до
 * 390 px (G9-04, X1-08): две стрелки «назад», имя дважды, «Сбросить пароль» и
 * «Слить» выше контактов, а «Пополнить» — на пятом экране. Теперь порядок —
 * по частоте: имя и контакты → крупно баланс (минус красным), лимит,
 * абонемент → «Пополнить» и «Новая бронь» → свёрнутые «Ближайшие брони»,
 * «Движения баланса», «Бонусы» → в самом низу «Удобнее на компьютере»
 * (опасные действия: сброс пароля, склейка, архив — только там).
 *
 * Ничего не меняет в деньгах: пополнение — общая TopupSheet, суммы «к оплате»
 * — computeDueByBooking, как в шахматке.
 */
export function MobileAdminUserCard() {
    // useParams уже раскодировал :email — второй decodeURIComponent ронял
    // страницу (URIError) на почте или id со знаком «%».
    const { email: rawParam } = useParams();
    const param = rawParam || '';
    const navigate = useNavigate();
    const { users, fetchUsers, currentUser } = useUserStore();
    // «Пополнить» — только с правом на кассу (как вкладка «Касса»).
    const canCash = userCanAccessFinance(currentUser);
    const setBookingForUser = useBookingStore(s => s.setBookingForUser);
    const [usersTried, setUsersTried] = useState(users.length > 0);
    const [topupOpen, setTopupOpen] = useState(false);
    // Ревью 09.11 (№7): бронь в карточке нажимается — та же шторка, что в «Бронях».
    const [activeBooking, setActiveBooking] = useState<BookingHistoryItem | null>(null);

    useEffect(() => {
        if (users.length === 0) Promise.resolve(fetchUsers()).finally(() => setUsersTried(true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const user = useMemo(
        () => users.find(u => u.email === param || u.id === param) ?? null,
        [users, param],
    );

    // Брони ЭТОГО клиента — с сервера, как на компьютере (общий список обрезан потолком).
    const [bookings, setBookings] = useState<BookingHistoryItem[] | null>(null);
    const [bookingsFailed, setBookingsFailed] = useState(false);
    const loadBookings = () => {
        if (!user?.email) return;
        setBookingsFailed(false);
        bookingsApi.getUserBookings(user.email)
            .then(setBookings)
            .catch(() => setBookingsFailed(true));
    };
    useEffect(() => { loadBookings(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.email]);

    const balance = Number(user?.balance ?? 0);
    // Раскладка ленты клиента (03.10) — для «к оплате» и «Движений баланса».
    const { data: alloc } = useClientAllocation(user ? String(user.id) : null, user ? balance : null);
    const dueMap = useMemo(() => {
        if (!bookings || !user) return new Map();
        const ids = new Set([user.email, String(user.id)]);
        const balanceOf = (uid: string) => (ids.has(uid) ? balance : null);
        const index = alloc ? indexAllocation([{ ...alloc, email: alloc.email ?? user.email }]) : null;
        return applyAllocation(computeDueByBooking(bookings, balanceOf), bookings, index, balanceOf);
    }, [bookings, user, balance, alloc]);

    // «Принять оплату · весь долг» наверху карточки: минус на балансе без будущих
    // броней, списанных заранее (их возьмут в свой день — решение 06.10).
    const payTotal = useMemo(() => {
        if (!user || !bookings) return Math.max(0, -balance);
        const fut = futureChargedDue(bookings, dueMap, batumiDayKey());
        const future = (fut.get(user.email) || 0) + (fut.get(String(user.id)) || 0);
        return Math.max(0, Math.round((Math.max(0, -balance) - future) * 100) / 100);
    }, [user, bookings, dueMap, balance]);
    // Филиал кассы — по последней брони клиента, как на компьютере; нет — выберут сами.
    const lastBranch = useMemo(() => (bookings ? cashBranchOfLastBooking(bookings) : undefined), [bookings]);

    const upcoming = useMemo(() => {
        if (!bookings) return [];
        const today = batumiDayKey();
        return bookings
            .filter(b => (b.status === 'confirmed' || b.status === 'pending_approval')
                && (bookingDayKey(b.date as any) ?? '') >= today)
            .sort((a, b) => `${bookingDayKey(a.date as any)} ${a.startTime}`.localeCompare(`${bookingDayKey(b.date as any)} ${b.startTime}`));
    }, [bookings]);

    if (!user) {
        return (
            <div style={{ paddingBottom: 24 }}>
                <MobilePageHeader title="Клиент" fallbackTo="/m/admin/users" />
                <div style={{ padding: '16px 16px 0' }}>
                {!usersTried ? (
                    <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <span className="sr-only">Загружаем клиента…</span>
                        <Skeleton height={28} width="60%" />
                        <Skeleton height={96} />
                    </div>
                ) : (
                    <EmptyState
                        title="Клиент не найден"
                        hint="Возможно, профиль архивирован или ссылка устарела. Найдите клиента в списке."
                        action={{ label: "К списку клиентов", onClick: () => navigate("/m/admin/users") }}
                    />
                )}
                </div>
            </div>
        );
    }

    const debt = balance < 0 ? -balance : 0;
    const limit = user.creditLimit ?? null;
    const overLimit = limit !== null && debt > limit;
    const tel = phoneHref(user.phone);
    // В поле telegramId бывает и числовой id чата — ссылку даём только на ник.
    const tg = user.telegramId && /^@?[A-Za-z]/.test(user.telegramId.trim()) ? telegramHref(user.telegramId) : null;
    const sub = user.subscription;

    return (
        <div>
            {/* 09.11 фаза 3: шапка во всю ширину (липкая строка), содержимое — с полями 16. */}
            <MobilePageHeader title={user.name || user.email} fallbackTo="/m/admin/users" />
        <div style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Контакты — одним рядом, телефон звонит. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {tel && (
                    <a href={tel} className="ui-btn ui-btn--secondary ui-btn--touch" aria-label={`Позвонить: ${user.phone}`}>
                        <Phone size={16} aria-hidden="true" /> <span className="num">{user.phone}</span>
                    </a>
                )}
                {tg && (
                    <a href={tg} target="_blank" rel="noreferrer" className="ui-btn ui-btn--secondary ui-btn--touch">
                        <Send size={16} aria-hidden="true" /> Telegram
                    </a>
                )}
                {!tel && !tg && (
                    <span style={{ fontSize: 14, color: 'var(--color-ink-60)', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44 }}>
                        <Mail size={16} aria-hidden="true" /> {user.email}
                    </span>
                )}
            </div>

            {/* Баланс — первым и крупно (G9-04). Минус — красным, словом «долг».
                09.11 фаза 3: общая SummaryCard, сумма — Money tone="balance"; числа во
                фразах — ровными цифрами шрифта фразы (num-inline), не моноширинным. */}
            <section aria-label="Баланс">
                <SummaryCard
                    size="lg"
                    label={debt > 0 ? 'Долг клиента' : 'Баланс'}
                    value={<Money value={balance} tone="balance" />}
                    caption={
                        <>
                            <span style={{ display: 'block' }}>
                                Кредитный лимит: {limit !== null ? <Money value={limit} inline /> : 'не задан'}
                                {overLimit && (
                                    <span style={{ color: 'var(--status-danger-fg)', fontWeight: 600 }}>
                                        {' '}· сверх лимита на <Money value={debt - (limit ?? 0)} inline />
                                    </span>
                                )}
                            </span>
                            <span className="num-inline" style={{ display: 'block', marginTop: 4 }}>
                                {sub
                                    ? <>Абонемент «{sub.name}»: осталось {sub.remainingHours} из {sub.totalHours} ч
                                        {extraPoolLabel(sub) ? <> · {extraPoolLabel(sub)!.toLowerCase()}</> : null}
                                        {sub.expiryDate && !sub.flexible ? <> до {formatDayMonth(sub.expiryDate)}</> : null}
                                        {sub.isFrozen ? ' · заморожен' : ''}</>
                                    : 'Абонемента нет'}
                            </span>
                        </>
                    }
                />
            </section>

            {/* Долг и «Принять оплату · весь долг» — сразу под балансом (ревью 09.11, №7). */}
            {canCash && payTotal > 0 && (
                <div data-card-debt style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 14, color: 'var(--status-danger-fg)', fontWeight: 600 }}>
                        К оплате сейчас <Money value={payTotal} inline />
                        {payTotal < debt && <span style={{ fontWeight: 400, color: 'var(--color-ink-60)' }}> · остальное — за будущие брони, их возьмут в свой день</span>}
                    </div>
                    <Button icon={<Wallet size={16} aria-hidden="true" />} onClick={() => setTopupOpen(true)}>
                        Принять оплату · {formatGel(payTotal)}
                    </Button>
                </div>
            )}

            {/* Главные действия. */}
            <div style={{ display: 'grid', gridTemplateColumns: canCash ? '1fr 1fr' : '1fr', gap: 8 }}>
                {canCash && (
                    // Одна бирюзовая кнопка на экран: есть долг — главная «Принять оплату» выше.
                    <Button variant={payTotal > 0 ? 'secondary' : 'primary'} icon={<Wallet size={16} aria-hidden="true" />} onClick={() => setTopupOpen(true)}>
                        Пополнить
                    </Button>
                )}
                <Button
                    variant="secondary"
                    icon={<CalendarPlus size={16} aria-hidden="true" />}
                    onClick={() => {
                        // Бронь от имени клиента — тот же механизм, что в мастере на
                        // компьютере (bookingForUser): в оформлении видно, у кого спишем.
                        setBookingForUser(user.email);
                        navigate('/m/find?admin=1');
                    }}
                >
                    Новая бронь
                </Button>
            </div>

            <Collapsible
                title="Ближайшие брони"
                badge={bookings ? String(upcoming.length) : undefined}
                defaultOpen
            >
                {bookingsFailed ? (
                    <ErrorBar message="Не удалось загрузить брони" onRetry={loadBookings} />
                ) : !bookings ? (
                    <SkeletonList count={2} label="Загружаем брони" cardHeight={56} />
                ) : upcoming.length === 0 ? (
                    <EmptyState compact title="Будущих броней нет" />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* 09.11 фаза 3: та же строка брони, что на «Сегодня» и в «Бронях». */}
                        <ListGroup aria-label="Ближайшие брони">
                        {upcoming.slice(0, 5).map(b => {
                            const info = dueMap.get(b.id);
                            const owes = !!info && info.due > 0 && b.status !== 'pending_approval';
                            return (
                                <AdminBookingRow
                                    key={b.id}
                                    onClick={() => setActiveBooking(b)}
                                    aria-label={`Бронь ${formatDateLabel(b.date as any)}, ${b.startTime} — перенести, отменить, принять оплату`}
                                    start={b.startTime}
                                    name={formatDateLabel(b.date as any, { capitalize: true })}
                                    subtitle={RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId}
                                    // Слово — statusLabel('booking', 'pending_approval', 'staff') внутри строки.
                                    status={b.status === 'pending_approval' ? b.status : null}
                                    owes={owes}
                                    badge={<DueBadge due={info?.due} paid={!!info} charged={info?.charged} price={info?.price} className="whitespace-normal h-auto py-1 max-w-[124px] text-right" status={b.status} method={b.paymentMethod as string | undefined} />}
                                />
                            );
                        })}
                        </ListGroup>
                        {upcoming.length > 5 && (
                            <Link
                                to={`/m/admin/bookings?q=${encodeURIComponent(user.email)}&past=0`}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14, fontWeight: 600, color: 'var(--color-ink)' }}
                            >
                                И ещё {upcoming.length - 5} — все брони клиента <ChevronRight size={16} aria-hidden="true" />
                            </Link>
                        )}
                    </div>
                )}
            </Collapsible>

            <Collapsible title="Движения баланса">
                <LedgerList userId={String(user.id)} balance={balance} />
            </Collapsible>

            <Collapsible title="Бонусы">
                <BonusList userId={String(user.id)} />
            </Collapsible>

            {/* Опасное и редкое — на компьютере (сброс пароля, склейка, архив, лимит). */}
            <section aria-label="Удобнее на компьютере" style={{
                background: 'var(--color-sunken)', borderRadius: 16, padding: 16,
                fontSize: 14, color: 'var(--color-ink-80)', lineHeight: 1.5,
            }}>
                <div style={{ fontWeight: 600, color: 'var(--color-ink)' }}>Удобнее на компьютере</div>
                Кредитный лимит, абонемент, сброс пароля, склейка профилей и архив.
                <div>
                    <DesktopLink href={`/admin/users/${encodeURIComponent(user.email)}`}>Открыть полную карточку →</DesktopLink>
                </div>
            </section>

            <AdminBookingSheets
                booking={activeBooking}
                getUserName={email => getAdminUserName(users, email)}
                onClose={() => setActiveBooking(null)}
                dueInfo={activeBooking ? dueMap.get(activeBooking.id) : undefined}
                onChanged={() => { loadBookings(); void fetchUsers(); }}
                acceptPayment={() => (payTotal > 0 ? {
                    total: payTotal,
                    sub: `Весь долг ${formatGel(payTotal)}`,
                    onClick: () => { setActiveBooking(null); setTopupOpen(true); },
                } : null)}
            />

            {canCash && topupOpen && (
                <TopupSheet
                    user={user}
                    defaultAmount={payTotal > 0 ? payTotal : undefined}
                    defaultBranch={lastBranch}
                    onClose={() => setTopupOpen(false)}
                    onDone={async () => { setTopupOpen(false); await fetchUsers(); loadBookings(); }}
                />
            )}
        </div>
        </div>
    );
}


/** Свёрнутая секция: заголовок-кнопка 44 px, содержимое монтируется при открытии. */
function Collapsible({ title, badge, defaultOpen = false, children }: {
    title: string; badge?: string; defaultOpen?: boolean; children: ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                style={{
                    width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8,
                    background: 'none', border: 'none', borderBottom: '1px solid var(--color-ink-08)',
                    padding: '0 0 4px', fontFamily: 'inherit', cursor: 'pointer',
                    color: 'var(--color-ink)', fontSize: 16, fontWeight: 600, textAlign: 'left',
                }}
            >
                <span style={{ flex: 1 }}>{title}</span>
                {badge && <span className="num" style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>{badge}</span>}
                <ChevronDown size={18} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 140ms' }} />
            </button>
            {open && <div style={{ paddingTop: 10 }}>{children}</div>}
        </section>
    );
}

/** Движения баланса списком в две строки: дата и причина слева, ±сумма и итог справа.
 *  03.10: под строкой — куда ушли деньги / чем оплачено (раскладка ленты), сверху — сводка. */
function LedgerList({ userId, balance }: { userId: string; balance: number }) {
    const [data, setData] = useState<BalanceLedgerResponse | null>(null);
    const { data: alloc } = useClientAllocation(userId, balance);
    // Раскладка — к той же ленте, что на экране (баланс совпадает), иначе не показываем.
    const allocOk = !!alloc && alloc.consistent && !!data
        && Math.round(Number(alloc.balance) * 100) === Math.round(Number(data.balance) * 100);
    const allocRows = useMemo(() => new Map((allocOk ? alloc!.rows : []).map(r => [r.id, r])), [alloc, allocOk]);
    const headline = allocOk ? allocationHeadline(alloc) : null;
    const [failed, setFailed] = useState(false);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let alive = true;
        setFailed(false);
        usersApi.getBalanceLedger(userId)
            .then(r => { if (alive) setData(r); })
            .catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; };
        // balance — после пополнения лента перечитывается вместе с раскладкой.
    }, [userId, tick, balance]);

    if (failed) return <ErrorBar message="Не удалось загрузить движения баланса" onRetry={() => setTick(t => t + 1)} />;
    if (!data) return <SkeletonList count={3} label="Загружаем движения баланса" cardHeight={52} />;
    if (data.entries.length === 0) return <EmptyState compact title="Движений пока нет" />;
    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {headline && (
                <div data-alloc-headline style={{ fontSize: 14, color: 'var(--color-ink-80)', lineHeight: 1.45, paddingBottom: 8, borderBottom: '1px solid var(--color-ink-08)' }}>
                    {headline}
                </div>
            )}
            {/* 09.11 фаза 3: строки ленты — ListRow; сумма — Money tone="flow": приход
                зелёный, расход чернилами (не красным — красный только у долга), 0 — серый. */}
            <ListGroup bare aria-label="Движения баланса">
            {data.entries.slice(0, 30).map(e => {
                const when = e.date ? parseUTC(e.date) : null;
                const allocLine = ledgerRowLine(allocRows.get(e.id));
                return (
                    <ListRow
                        key={e.id}
                        title={<span style={{ fontWeight: 500 }}>{REASON_LABELS[e.reason] || 'Прочее движение'}</span>}
                        subtitle={<>
                            {when ? `${formatDayMonth(when, { timeZone: BATUMI_TZ })}, ${formatTime(when, { timeZone: BATUMI_TZ })}` : '—'}
                            {e.description ? ` · ${humanizeMoneyText(e.description)}` : ''}
                        </>}
                        meta={allocLine ? (
                            <span data-alloc-line style={{ fontSize: 14, color: 'var(--color-ink-60)', lineHeight: 1.4 }}>
                                {allocLine}
                            </span>
                        ) : undefined}
                        trail={<Money value={e.delta} tone="flow" />}
                        trailSub={<>итог <Money value={e.balanceAfter} inline /></>}
                    />
                );
            })}
            </ListGroup>
            {(data.entries.length > 30 || data.truncated) && (
                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', paddingTop: 8 }}>
                    Показаны последние 30 движений — вся лента в полной карточке.
                </div>
            )}
        </div>
    );
}

const BONUS_STATUS: Record<string, string> = {
    pending: 'ждёт одобрения',
    approved: 'одобрен',
    active: 'активен',
    used: 'использован',
    expired: 'истёк',
    rejected: 'отклонён',
};

function BonusList({ userId }: { userId: string }) {
    const [items, setItems] = useState<Bonus[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let alive = true;
        setFailed(false);
        bonusesApi.listBonuses({ userId })
            // Страховка: показываем только бонусы этого клиента.
            .then(list => { if (alive) setItems(list.filter(b => String(b.userId) === userId)); })
            .catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [userId, tick]);

    if (failed) return <ErrorBar message="Не удалось загрузить бонусы" onRetry={() => setTick(t => t + 1)} />;
    if (!items) return <SkeletonList count={2} label="Загружаем бонусы" cardHeight={48} />;
    if (items.length === 0) return <EmptyState compact title="Бонусов нет" />;
    return (
        <ListGroup aria-label="Бонусы">
            {items.slice(0, 10).map(b => (
                <ListRow
                    key={b.id}
                    lead={<ListIcon><Plus size={18} /></ListIcon>}
                    title={<>{b.description || 'Бонус'} · <span className="num-inline">{b.quantity}</span> ч</>}
                    subtitle={<>
                        {BONUS_STATUS[b.status] || b.status}
                        {b.expiresAt && (b.status === 'active' || b.status === 'approved') ? ` · до ${formatDayMonth(b.expiresAt)}` : ''}
                    </>}
                />
            ))}
        </ListGroup>
    );
}
