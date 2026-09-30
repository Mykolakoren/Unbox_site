import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Repeat } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { RESOURCES } from '../../utils/data';
import { BookingDetailSheet } from './BookingDetailSheet';
import { usePullToRefresh } from './usePullToRefresh';
import { PullIndicator } from './PullIndicator';
import { LoadErrorCard, SkeletonRows, StaleBar } from './LoadStates';
import { prepareRepeat } from './repeatBooking';
import { priceLabel } from './priceLabel';
import { ruPlural } from '../../utils/plural';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { formatDateLabel as formatDateLabelRu, formatDayMonth } from '../../utils/format';
import { SwipeRow } from './SwipeRow';
import { useLongPress } from './useLongPress';
import { bookingsApi } from '../../api/bookings';
import { toast } from 'sonner';
import type { BookingHistoryItem } from '../../store/types';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';
import { toastApiError } from '../../utils/errors';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Segmented } from '../../components/ui/Chip';
import { Button } from '../../components/ui/Button';
import { bookingPlace, bookingStartDate, bookingTimeRange, isLiveBooking } from './bookingView';

type Tab = 'upcoming' | 'series' | 'past';

export function MobileMyBookings() {
    const navigate = useNavigate();
    // Селективные селекторы — ре-рендер только на изменение нужных полей.
    const currentUser = useUserStore(s => s.currentUser);
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    const bookingsStatus = useUserStore(s => s.bookingsStatus);
    const bookingsLoadedAt = useUserStore(s => s.bookingsLoadedAt);
    // Брони хоть раз пришли с сервера. До этого ни «· 0», ни «броней нет»
    // писать нельзя — это неправда, данные просто ещё не загружены.
    const loaded = bookingsLoadedAt != null;
    const [tab, setTab] = useState<Tab>('upcoming');
    const [openBooking, setOpenBooking] = useState<BookingHistoryItem | null>(null);
    // Подтверждение постановки на пересдачу: свайп — жест лёгкий, а действие
    // денежное (если слот заберут, вернётся 50%). «Отменить» подтверждение уже
    // спрашивает — здесь было несимметрично. Снятие с пересдачи не спрашиваем:
    // оно безопасное и обратимое. Wave 1: общее окно подтверждения вместо
    // самодельного оверлея.
    const { confirm } = useConfirmDialog();

    const doToggleReRent = (b: BookingHistoryItem) => {
        bookingsApi.toggleReRent(b.id)
            .then(updated => {
                fetchBookings();
                toast.success(updated.isReRentListed
                    ? 'Выставлено на пересдачу'
                    : 'Снято с пересдачи');
            })
            .catch(e => toastApiError(e, 'Не удалось обновить'));
    };
    const askReRent = async (b: BookingHistoryItem) => {
        const ok = await confirm({
            title: 'Пересдать бронь?',
            body: 'Слот появится у других как свободный. Если его заберут — вернём 50% стоимости. Если не заберут — бронь останется за вами.',
            confirmLabel: 'Пересдать',
            cancelLabel: 'Оставить',
        });
        if (ok) doToggleReRent(b);
    };
    const [refreshing, setRefreshing] = useState(false);
    const pull = usePullToRefresh(async () => {
        setRefreshing(true);
        try { await fetchBookings(); } finally { setRefreshing(false); }
    });

    useEffect(() => { fetchBookings(); }, [fetchBookings]);

    // Telegram series-end reminder deep-link: /m/bookings?series=<group_id>.
    // Auto-jump to the Series tab and open the next-upcoming booking of
    // that series in BookingDetailSheet, where the user gets the
    // "Продлить серию" / "Пусть завершится в срок" actions.
    const [searchParams, setSearchParams] = useSearchParams();
    const seriesParam = searchParams.get('series');
    useEffect(() => {
        if (!seriesParam) return;
        const groupItems = bookings.filter(b => (b as any).recurringGroupId === seriesParam);
        if (groupItems.length === 0) return;
        const nextUpcoming = groupItems
            .map(b => ({ b, dt: bookingStartDate(b) }))
            .filter(x => x.dt && x.dt.getTime() > Date.now())
            .sort((a, b) => a.dt!.getTime() - b.dt!.getTime())[0];
        if (nextUpcoming) {
            setTab('series');
            setOpenBooking(nextUpcoming.b);
        }
        const next = new URLSearchParams(searchParams);
        next.delete('series');
        setSearchParams(next, { replace: true });
    }, [seriesParam, bookings, searchParams, setSearchParams]);

    const myBookings = useMemo(() => {
        if (!currentUser) return [];
        return bookings.filter(b =>
            b.userId === currentUser.email || (!!currentUser.id && (b as any).userUuid === currentUser.id)
        );
    }, [bookings, currentUser]);

    const now = new Date();
    // Волна 2 (G3-02): будущие — подтверждённые И ждущие одобрения
    // администратора. Раньше «горячая» бронь пропадала из списка целиком.
    const upcoming = useMemo(() => {
        return myBookings
            .map(b => ({ b, dt: bookingStartDate(b) }))
            .filter(x => isLiveBooking(x.b) && x.dt && x.dt.getTime() + (x.b.duration ?? 60) * 60000 > now.getTime())
            .sort((a, b) => a.dt!.getTime() - b.dt!.getTime());
    }, [myBookings, now]);

    // G4-18: группы «Сегодня / Завтра / На этой неделе / Позже».
    const upcomingGroups = useMemo(() => groupByDay(upcoming, now), [upcoming, now]);

    const past = useMemo(() => {
        return myBookings
            .map(b => ({ b, dt: bookingStartDate(b) }))
            .filter(x => x.dt && x.dt.getTime() + (x.b.duration ?? 60) * 60000 <= now.getTime())
            .sort((a, b) => b.dt!.getTime() - a.dt!.getTime())
            .slice(0, 50);
    }, [myBookings, now]);

    const series = useMemo(() => {
        // Only show series that still have at least one future confirmed item.
        // Past series (all sessions completed) don't need to be in this view —
        // they clutter and "Series" tab is meant for active management.
        const groups = new Map<string, { id: string; items: BookingHistoryItem[] }>();
        for (const b of myBookings) {
            const gid = (b as any).recurringGroupId;
            if (!gid || b.status !== 'confirmed') continue;
            if (!groups.has(gid)) groups.set(gid, { id: gid, items: [] });
            groups.get(gid)!.items.push(b);
        }
        const active: { id: string; items: BookingHistoryItem[] }[] = [];
        for (const g of groups.values()) {
            const hasFuture = g.items.some(b => {
                const dt = bookingStartDate(b);
                return dt && dt.getTime() + (b.duration ?? 60) * 60000 > now.getTime();
            });
            if (hasFuture) active.push(g);
        }
        return active;
    }, [myBookings, now]);

    return (
        <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />

            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: TEXT.heading, fontWeight: 600, lineHeight: 1.2, margin: 0 }}>
                    Мои брони
                </h1>
            </div>

            <div style={{ padding: '0 16px' }}>
                {/* Wave 1: общий Segmented (44 px, aria-pressed) вместо самодельных вкладок. */}
                <Segmented<Tab>
                    aria-label="Какие брони показать"
                    value={tab}
                    onChange={setTab}
                    options={[
                        { value: 'upcoming', label: loaded ? `Будущие · ${upcoming.length}` : 'Будущие' },
                        { value: 'series', label: loaded ? `Серии · ${series.length}` : 'Серии' },
                        { value: 'past', label: 'Прошедшие' },
                    ]}
                />
            </div>

            {/* Wave 1: без «лесенки» появления — экран открывают слишком часто. */}
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <StaleBar status={bookingsStatus} loadedAt={bookingsLoadedAt} onRetry={() => { fetchBookings(); }} />
                {!loaded && bookingsStatus !== 'error' && <SkeletonRows height={72} />}
                {!loaded && bookingsStatus === 'error' && (
                    <LoadErrorCard
                        title="Не удалось загрузить брони"
                        text="Они никуда не делись — просто сейчас не загрузились."
                        onRetry={() => { fetchBookings(); }}
                    />
                )}
                {loaded && tab === 'upcoming' && (
                    upcoming.length === 0
                        ? (
                            <EmptyState
                                title="Будущих броней пока нет"
                                hint="Выберите свободное время — займёт минуту."
                                action={{ label: 'Найти время', onClick: () => navigate('/m/find') }}
                            />
                        )
                        : upcomingGroups.map(group => (
                            <section key={group.key} aria-label={group.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <h2 style={groupTitle}>{group.label}</h2>
                                <div style={listCard}>
                                    {group.items.map(({ b, dt }, idx) => {
                                        const hoursToStart = (dt!.getTime() - Date.now()) / 3600000;
                                        const within24h = hoursToStart >= 0 && hoursToStart < 24;
                                        // Бронь на одобрении: ни отменить (меньше суток),
                                        // ни пересдать (только подтверждённую) — без свайпа.
                                        const pendingApproval = b.status === 'pending_approval';
                                        // Within 24h, swiping cancel doesn't refund — surface
                                        // the "Re-rent" action as the primary instead.
                                        const primary = within24h
                                            ? {
                                                label: 'Пересдать',
                                                color: COLOR.ink,
                                                onAction: () => {
                                                    // На пересдачу — только через подтверждение
                                                    // (денежное действие). Снятие — сразу.
                                                    if ((b as any).isReRentListed) doToggleReRent(b);
                                                    else void askReRent(b);
                                                },
                                            }
                                            : {
                                                label: 'Отменить',
                                                color: STATUS.danger.fg,
                                                onAction: () => setOpenBooking(b),
                                            };
                                        const secondary = {
                                            label: 'Детали',
                                            color: COLOR.ink60,
                                            onAction: () => setOpenBooking(b),
                                        };
                                        return (
                                            <SwipeRow key={b.id} primary={primary} secondary={secondary} disabled={pendingApproval}>
                                                <Row
                                                    booking={b}
                                                    dt={dt!}
                                                    withDate={group.withDate}
                                                    first={idx === 0}
                                                    today={group.key === 'today'}
                                                    onTap={() => setOpenBooking(b)}
                                                />
                                            </SwipeRow>
                                        );
                                    })}
                                </div>
                            </section>
                        ))
                )}
                {loaded && tab === 'series' && (
                    series.length === 0
                        ? <EmptyState title="Активных серий нет" hint="Серия — одна и та же бронь каждую неделю. Её можно создать при оформлении: «Повторять каждую неделю»." />
                        : series.map(s => (
                            <SeriesRow
                                key={s.id}
                                items={s.items}
                                onTap={() => {
                                    // Open the next upcoming booking in the
                                    // series — that's where the "Серия"
                                    // actions live in the detail sheet.
                                    const nextUpcoming = s.items
                                        .map(b => ({ b, dt: bookingStartDate(b) }))
                                        .filter(x => x.dt && x.dt.getTime() > Date.now())
                                        .sort((a, b) => a.dt!.getTime() - b.dt!.getTime())[0];
                                    if (nextUpcoming) setOpenBooking(nextUpcoming.b);
                                }}
                            />
                        ))
                )}
                {loaded && tab === 'past' && (
                    past.length === 0
                        ? <EmptyState title="Прошедших броней пока нет" />
                        : (
                            <div style={listCard}>
                                {past.map(({ b, dt }, idx) => (
                                    <Row
                                        key={b.id}
                                        booking={b}
                                        dt={dt!}
                                        dimmed
                                        withDate
                                        first={idx === 0}
                                        onTap={() => setOpenBooking(b)}
                                        onRepeat={() => {
                                            if (prepareRepeat(b)) navigate('/m/checkout');
                                        }}
                                    />
                                ))}
                            </div>
                        )
                )}
            </div>

            {openBooking && (
                <BookingDetailSheet
                    booking={openBooking}
                    onClose={() => setOpenBooking(null)}
                />
            )}

        </div>
    );
}

function Row({ booking, dt, dimmed, withDate, first, today, onTap, onRepeat }: {
    booking: BookingHistoryItem;
    dt: Date;
    dimmed?: boolean;
    /** День в строке — в группах «На этой неделе», «Позже» и в «Прошедших». */
    withDate?: boolean;
    first?: boolean;
    /** Сегодняшняя бронь — тонкая полоса слева. */
    today?: boolean;
    onTap: () => void;
    onRepeat?: () => void;
}) {
    const place = bookingPlace(booking);
    // Long-press → repeat (on past tab where onRepeat is set). For upcoming
    // tab onRepeat is undefined, so long-press is a no-op there.
    const longPressProps = useLongPress(() => onRepeat?.());
    // G4-18: строка около 72 px вместо карточки на 190 — неделя видна на одном экране.
    const badges = rowBadges(booking, !!dimmed);

    return (
        <div
            className="press"
            style={{
                background: COLOR.card,
                borderTop: first ? 'none' : `1px solid ${COLOR.ink10}`,
                boxShadow: today ? `inset 3px 0 0 ${COLOR.ink}` : undefined,
                minHeight: 72,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
            }}
            onClick={onTap}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }}
            role="button"
            tabIndex={0}
            {...(onRepeat ? longPressProps : {})}
        >
            {/* Прошедшие приглушаем цветом, а не прозрачностью: opacity .6
                роняла вторичный текст ниже читаемого (3:1). */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: TEXT.body, fontWeight: 600, color: dimmed ? COLOR.ink60 : COLOR.ink }}>
                    {withDate && <>{formatDateLabel(dt)} · </>}
                    <span className="num">{bookingTimeRange(booking, dt)}</span>
                </div>
                <div style={{ fontSize: TEXT.small, color: COLOR.ink60, marginTop: 2 }}>
                    {place.title} · {formatBookingDuration(booking.duration ?? 60)}
                    {(booking as any).recurringGroupId && <> · серия</>}
                </div>
                {badges && <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{badges}</div>}
            </div>
            {onRepeat ? (
                <Button
                    variant="secondary"
                    icon={<Repeat size={16} aria-hidden="true" />}
                    onClick={(e) => { e.stopPropagation(); onRepeat(); }}
                    aria-label={`Повторить: ${place.title}, ${booking.startTime}`}
                >
                    Повторить
                </Button>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span className="num" style={{ fontSize: TEXT.small, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {priceLabel(booking)}
                    </span>
                    {/* Строка и так нажимается — хватит шеврона (было «тапни →»). */}
                    <ChevronRight size={18} color={COLOR.ink60} aria-hidden="true" />
                </div>
            )}
        </div>
    );
}

/** Бейджи строки — слова только из общего словаря. Янтарь — там, где ждём
 *  чего-то важного (одобрение, пересдача). «Ждёт списания» у будущей
 *  брони — обычное дело, его не красим (G4-08): сумма и так стоит справа. */
function rowBadges(booking: BookingHistoryItem, past: boolean): React.ReactNode {
    const out: React.ReactNode[] = [];
    if (booking.status === 'pending_approval') {
        out.push(<StatusBadge key="b" kind="booking" status="pending_approval" />);
    } else if (past && booking.status !== 'confirmed' && booking.status !== 'completed') {
        out.push(<StatusBadge key="b" kind="booking" status={booking.status} />);
    }
    if (booking.isReRentListed) out.push(<StatusBadge key="r" kind="booking" status="re-rent-listed" />);
    if (booking.status !== 'cancelled') {
        const pay = <PaymentBadge key="p" status={booking.paymentStatus} />;
        if (booking.paymentStatus && booking.paymentStatus !== 'pending') out.push(pay);
    }
    return out.length ? out : null;
}

/** Группы будущих броней по дням (G4-18). Неделя — с понедельника. */
function groupByDay(items: { b: BookingHistoryItem; dt: Date | null }[], now: Date) {
    const DAY = 86400000;
    const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const today = startOfDay(now);
    const weekEnd = today + (7 - ((now.getDay() + 6) % 7)) * DAY; // начало следующего понедельника
    const defs = [
        { key: 'today', label: 'Сегодня', withDate: false, test: (t: number) => t < today + DAY },
        { key: 'tomorrow', label: 'Завтра', withDate: false, test: (t: number) => t < today + 2 * DAY },
        { key: 'week', label: 'На этой неделе', withDate: true, test: (t: number) => t < weekEnd },
        { key: 'later', label: 'Позже', withDate: true, test: () => true },
    ];
    const groups = defs.map(d => ({ key: d.key, label: d.label, withDate: d.withDate, items: [] as { b: BookingHistoryItem; dt: Date | null }[] }));
    for (const x of items) {
        const t = x.dt ? startOfDay(x.dt) : Infinity;
        groups[defs.findIndex(d => d.test(t))].items.push(x);
    }
    return groups.filter(g => g.items.length > 0);
}

/** «Вт, 29 сентября». Wave 1: месяц брался отдельно (month:'long') — это
 *  именительный падеж, и карточки писали «29 сентябрь». Теперь общий
 *  форматтер: день и месяц одной строкой, месяц в родительном. */
function formatDateLabel(d: Date): string {
    return formatDateLabelRu(d, { capitalize: true });
}

function SeriesRow({ items, onTap }: { items: BookingHistoryItem[]; onTap?: () => void }) {
    const sorted = [...items].sort((a, b) => {
        const da = bookingStartDate(a)?.getTime() ?? 0;
        const db = bookingStartDate(b)?.getTime() ?? 0;
        return da - db;
    });
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const resource = RESOURCES.find(r => r.id === first?.resourceId);

    const dt0 = bookingStartDate(first);
    const dtN = bookingStartDate(last);
    const fmt = (d: Date | null) => d ? formatDayMonth(d) : '?';

    return (
        <button
            onClick={onTap}
            className="press"
            style={{
                width: '100%',
                background: COLOR.card,
                border: `1px solid ${COLOR.ink10}`,
                borderRadius: RADIUS.sheet,
                padding: '12px 16px',
                cursor: onTap ? 'pointer' : 'default',
                fontFamily: 'inherit',
                textAlign: 'left',
                color: COLOR.ink,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
            }}
        >
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: COLOR.ink60 }}>
                    Серия · {sorted.length} {ruPlural(sorted.length, ['бронь', 'брони', 'броней'])}
                </span>
                <span style={{ display: 'block', fontSize: TEXT.body, fontWeight: 600, marginTop: 2 }}>
                    {resource?.name} · <span className="num">{first?.startTime}</span>
                </span>
                <span style={{ display: 'block', fontSize: TEXT.small, color: COLOR.ink60, marginTop: 2 }}>
                    {fmt(dt0)} → {fmt(dtN)} · продлить или отменить
                </span>
            </span>
            <ChevronRight size={18} color={COLOR.ink60} aria-hidden="true" />
        </button>
    );
}

/** Статус оплаты — слова и цвета только из общего словаря (statuses.ts). */
function PaymentBadge({ status }: { status?: 'pending' | 'paid' | 'waived' | null }) {
    if (!status) return null;
    return <StatusBadge kind="payment" status={status} />;
}

const listCard: React.CSSProperties = {
    background: COLOR.card,
    border: `1px solid ${COLOR.ink10}`,
    borderRadius: RADIUS.sheet,
    overflow: 'hidden',
};

const groupTitle: React.CSSProperties = {
    margin: '8px 0 0',
    fontSize: TEXT.caption,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: COLOR.ink60,
};
