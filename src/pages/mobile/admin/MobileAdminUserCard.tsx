import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Phone, Send, Mail, Plus, Wallet, CalendarPlus } from 'lucide-react';
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
import { batumiDayKey, bookingDayKey } from '../../../utils/adminToday';
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
            <div style={{ padding: '0 16px 24px' }}>
                <MobilePageHeader title="Клиент" fallbackTo="/m/admin/users" />
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
        <div style={{ padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <MobilePageHeader title={user.name || user.email} fallbackTo="/m/admin/users" />

            {/* Контакты — одним рядом, телефон звонит. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: -8 }}>
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

            {/* Баланс — первым и крупно (G9-04). Минус — красным, словом «долг». */}
            <section
                aria-label="Баланс"
                style={{
                    background: debt > 0 ? 'var(--status-danger-bg)' : 'var(--color-sunken)',
                    borderRadius: 16, padding: 16,
                    display: 'flex', flexDirection: 'column', gap: 8,
                }}
            >
                <div style={{ fontSize: 14, fontWeight: 600, color: debt > 0 ? 'var(--status-danger-fg)' : 'var(--color-ink-60)' }}>
                    {debt > 0 ? 'Долг клиента' : 'Баланс'}
                </div>
                <div className="num" style={{
                    fontSize: 40, fontWeight: 600, lineHeight: 1.1,
                    color: debt > 0 ? 'var(--status-danger-fg)' : 'var(--color-ink)',
                }}>
                    {formatGel(balance)}
                </div>
                <div style={{ fontSize: 14, color: 'var(--color-ink-80)' }}>
                    Кредитный лимит: <span className="num">{limit !== null ? formatGel(limit) : 'не задан'}</span>
                    {overLimit && (
                        <span style={{ color: 'var(--status-danger-fg)', fontWeight: 600 }}>
                            {' '}· сверх лимита на <span className="num">{formatGel(debt - (limit ?? 0))}</span>
                        </span>
                    )}
                </div>
                <div style={{ fontSize: 14, color: 'var(--color-ink-80)' }}>
                    {sub
                        ? <>Абонемент «{sub.name}»: осталось <span className="num">{sub.remainingHours}</span> из <span className="num">{sub.totalHours}</span> ч
                            {extraPoolLabel(sub) ? <> · {extraPoolLabel(sub)!.toLowerCase()}</> : null}
                            {sub.expiryDate && !sub.flexible ? <> до {formatDayMonth(sub.expiryDate)}</> : null}
                            {sub.isFrozen ? ' · заморожен' : ''}</>
                        : 'Абонемента нет'}
                </div>
            </section>

            {/* Главные действия. */}
            <div style={{ display: 'grid', gridTemplateColumns: canCash ? '1fr 1fr' : '1fr', gap: 8 }}>
                {canCash && (
                    <Button icon={<Wallet size={16} aria-hidden="true" />} onClick={() => setTopupOpen(true)}>
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
                        navigate('/m/find');
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {upcoming.slice(0, 5).map(b => {
                            const info = dueMap.get(b.id);
                            return (
                                <div key={b.id} style={rowStyle}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                                            {formatDateLabel(b.date as any, { capitalize: true })}, <span className="num">{b.startTime}</span>
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                                            {RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId}
                                            {b.status === 'pending_approval' ? ' · ждёт одобрения' : ''}
                                        </div>
                                    </div>
                                    <DueBadge due={info?.due} paid={!!info} charged={info?.charged} price={info?.price} className="whitespace-normal h-auto py-1 max-w-[124px] text-right" />
                                </div>
                            );
                        })}
                        {upcoming.length > 5 && (
                            <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                                И ещё {upcoming.length - 5} — все брони клиента в разделе «Брони».
                            </div>
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
                background: 'var(--color-sunken)', borderRadius: 12, padding: 12,
                fontSize: 14, color: 'var(--color-ink-80)', lineHeight: 1.5,
            }}>
                <div style={{ fontWeight: 600, color: 'var(--color-ink)' }}>Удобнее на компьютере</div>
                Кредитный лимит, абонемент, сброс пароля, склейка профилей и архив.
                <div>
                    <DesktopLink href={`/admin/users/${encodeURIComponent(user.email)}`}>Открыть полную карточку →</DesktopLink>
                </div>
            </section>

            {canCash && topupOpen && (
                <TopupSheet
                    user={user}
                    onClose={() => setTopupOpen(false)}
                    onDone={async () => { setTopupOpen(false); await fetchUsers(); loadBookings(); }}
                />
            )}
        </div>
    );
}

const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'var(--color-card)', border: '1px solid var(--color-ink-08)',
    borderRadius: 12, padding: '10px 12px', minHeight: 52,
};

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
                <div data-alloc-headline style={{ fontSize: 13, color: 'var(--color-ink-80)', lineHeight: 1.45, paddingBottom: 8, borderBottom: '1px solid var(--color-ink-08)' }}>
                    {headline}
                </div>
            )}
            {data.entries.slice(0, 30).map(e => {
                const when = e.date ? parseUTC(e.date) : null;
                const allocLine = ledgerRowLine(allocRows.get(e.id));
                return (
                    <div key={e.id} style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        padding: '8px 0', borderBottom: '1px solid var(--color-ink-08)',
                    }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>
                                {REASON_LABELS[e.reason] || `Прочее (${e.reason})`}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                                {when ? `${formatDayMonth(when, { timeZone: BATUMI_TZ })}, ${formatTime(when, { timeZone: BATUMI_TZ })}` : '—'}
                                {e.description ? ` · ${e.description}` : ''}
                            </div>
                            {allocLine && (
                                <div data-alloc-line style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2, lineHeight: 1.4 }}>
                                    {allocLine}
                                </div>
                            )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div className="num" style={{
                                fontSize: 14, fontWeight: 600,
                                color: e.delta < 0 ? 'var(--status-danger-fg)' : 'var(--status-ok-fg)',
                            }}>
                                {formatGel(e.delta, { sign: true })}
                            </div>
                            <div className="num" style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                                итог {formatGel(e.balanceAfter)}
                            </div>
                        </div>
                    </div>
                );
            })}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.slice(0, 10).map(b => (
                <div key={b.id} style={rowStyle}>
                    <Plus size={16} aria-hidden="true" style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                            {b.description || 'Бонус'} · <span className="num">{b.quantity}</span> ч
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                            {BONUS_STATUS[b.status] || b.status}
                            {b.expiresAt && (b.status === 'active' || b.status === 'approved') ? ` · до ${formatDayMonth(b.expiresAt)}` : ''}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
