import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Repeat } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { RESOURCES } from '../../utils/data';
import { BookingDetailSheet } from './BookingDetailSheet';
import { usePullToRefresh } from './usePullToRefresh';
import { PullIndicator } from './PullIndicator';
import { LoadErrorCard, SkeletonRows, StaleBar } from './LoadStates';
import { prepareRepeat } from './repeatBooking';
import { priceTrail } from './priceLabel';
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
import { ListGroup, ListRow } from '../../components/ui/ListRow';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { bookingPlace, bookingStartDate, bookingTimeRange, isLiveBooking } from './bookingView';
import { cancelledRefund, reRentConfirmBody, reRentToast } from './refundText';
import { hoursUntilBookingStart } from '../../utils/subscription';

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
    // Свайп «Отменить» — сразу шаг «Отменить бронь?» (ревью №15).
    const [openMode, setOpenMode] = useState<'view' | 'confirmCancel'>('view');
    const open = (b: BookingHistoryItem, mode: 'view' | 'confirmCancel' = 'view') => { setOpenMode(mode); setOpenBooking(b); };
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
                toast.success(updated.isReRentListed ? reRentToast(b) : 'Снято с пересдачи');
            })
            .catch(e => toastApiError(e, 'Не удалось обновить'));
    };
    const askReRent = async (b: BookingHistoryItem) => {
        const ok = await confirm({
            title: 'Пересдать бронь?',
            body: reRentConfirmBody(b),
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
        <div style={{ paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />

            {/* 09.11 фаза 3: общая крупная шапка корня раздела. */}
            <MobilePageHeader variant="large" title="Мои брони" />

            <div style={{ padding: '0 16px' }}>
                {/* Wave 1: общий Segmented (44 px, aria-pressed) вместо самодельных вкладок. */}
                <Segmented<Tab>
                    aria-label="Какие брони показать"
                    value={tab}
                    onChange={setTab}
                    options={[
                        { value: 'upcoming', label: loaded ? `Будущие · ${upcoming.length}` : 'Будущие' },
                        { value: 'series', label: loaded && series.length > 0 ? `Серии · ${series.length}` : 'Серии' },
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
                                illustration="door"
                                title="Будущих броней пока нет"
                                hint="Выберите свободное время — займёт минуту."
                                action={{ label: 'Найти время', onClick: () => navigate('/m/find') }}
                            />
                        )
                        // 09.11 фаза 3: группа дня — общий ListGroup, строки — классы ListRow
                        // (своя разметка только ради свайпа и долгого нажатия).
                        : upcomingGroups.map(group => (
                            <ListGroup key={group.key} title={group.label}>
                                    {group.items.map(({ b, dt }) => {
                                        // Часы до начала — по времени Тбилиси, как на сервере
                                        // (_booking_hours_until_start), а не по поясу телефона.
                                        const hoursToStart = hoursUntilBookingStart(b);
                                        const within24h = hoursToStart >= 0 && hoursToStart < 24;
                                        // Бронь на одобрении: ни отменить (меньше суток),
                                        // ни пересдать (только подтверждённую) — без свайпа.
                                        const pendingApproval = b.status === 'pending_approval';
                                        // Within 24h, swiping cancel doesn't refund — surface
                                        // the "Re-rent" action as the primary instead.
                                        // 09.11 (владелец): «Пересдать» — ТОЛЬКО меньше суток до
                                        // начала; раньше — «Отменить» с полным возвратом.
                                        // 09.11 фаза 3: «Пересдать» в свайпе — тёмно-бирюзовая панель, не чёрная.
                                        const primary = within24h
                                            ? {
                                                label: 'Пересдать',
                                                color: COLOR.panel, fg: COLOR.onPanel,
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
                                                onAction: () => open(b, 'confirmCancel'),
                                            };
                                        const secondary = {
                                            label: 'Детали',
                                            color: COLOR.ink60,
                                            onAction: () => open(b),
                                        };
                                        return (
                                            <SwipeRow key={b.id} as="li" className="ui-row" flat primary={primary} secondary={secondary} disabled={pendingApproval}>
                                                <Row
                                                    as="div"
                                                    booking={b}
                                                    dt={dt!}
                                                    withDate={group.withDate}
                                                    onTap={() => open(b)}
                                                />
                                            </SwipeRow>
                                        );
                                    })}
                            </ListGroup>
                        ))
                )}
                {loaded && tab === 'series' && (
                    series.length === 0
                        ? <EmptyState illustration="plant" title="Активных серий нет" hint="Серия — одна и та же бронь каждую неделю. Её можно создать при оформлении: «Повторять каждую неделю»." />
                        : <ListGroup aria-label="Серии">{series.map(s => (
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
                                    if (nextUpcoming) open(nextUpcoming.b);
                                }}
                            />
                        ))}</ListGroup>
                )}
                {loaded && tab === 'past' && (
                    past.length === 0
                        ? <EmptyState illustration="cup" title="Прошедших броней пока нет" hint="Здесь появятся брони, которые уже прошли, — их можно повторить в одно касание." />
                        : (
                            <ListGroup aria-label="Прошедшие брони">
                                {past.map(({ b, dt }) => (
                                    <Row
                                        key={b.id}
                                        booking={b}
                                        dt={dt!}
                                        dimmed
                                        withDate
                                        onTap={() => open(b)}
                                        onRepeat={() => {
                                            if (prepareRepeat(b)) navigate('/m/checkout');
                                        }}
                                    />
                                ))}
                            </ListGroup>
                        )
                )}
            </div>

            {openBooking && (
                <BookingDetailSheet
                    key={`${openBooking.id}-${openMode}`}
                    booking={openBooking}
                    initialMode={openMode}
                    onClose={() => { setOpenBooking(null); setOpenMode('view'); }}
                />
            )}

        </div>
    );
}

function Row({ booking, dt, dimmed, withDate, onTap, onRepeat, as = 'li' }: {
    booking: BookingHistoryItem;
    /** div — внутри SwipeRow (он сам строка списка). */
    as?: 'li' | 'div';
    dt: Date;
    dimmed?: boolean;
    /** День в строке — в группах «На этой неделе», «Позже» и в «Прошедших». */
    withDate?: boolean;
    onTap: () => void;
    onRepeat?: () => void;
}) {
    const place = bookingPlace(booking);
    // Long-press → repeat (on past tab where onRepeat is set). For upcoming
    // tab onRepeat is undefined, so long-press is a no-op there.
    const longPressProps = useLongPress(() => onRepeat?.());
    const badges = rowBadges(booking, !!dimmed);
    const cancelled = booking.status === 'cancelled';
    const price = priceTrail(booking);

    // 09.11 фаза 3: строка — общий ListRow: «Ср, 11 нояб. · 12:00–14:00» + сумма справа;
    // ниже «Кабинет 5 · Unbox Uni · 2 ч». Способ оплаты коротко («Абонемент»), доплата —
    // второй строкой справа (priceTrail). Бейджи — только исключения. Долгое нажатие
    // (повторить) передаётся на нажимаемую часть строки; свайп — обёртка SwipeRow снаружи.
    return (
        <ListRow
            as={as}
            dimmed={dimmed}
            onClick={onTap}
            {...(onRepeat ? longPressProps : {})}
            title={<>
                {withDate && <><span style={{ whiteSpace: 'nowrap' }}>{formatDateLabel(dt)} ·</span>{' '}</>}
                <span className="num" style={{ whiteSpace: 'nowrap' }}>{bookingTimeRange(booking, dt)}</span>
            </>}
            subtitle={<>
                {place.title} · <span style={{ whiteSpace: 'nowrap' }}>{formatBookingDuration(booking.duration ?? 60)}</span>
                {(booking as any).recurringGroupId && <> · серия</>}
                {cancelled && <> · {cancelledRefund(booking).text}</>}
            </>}
            meta={badges}
            trail={cancelled ? undefined : <span className="num">{price.main}</span>}
            trailSub={!cancelled && price.sub ? <span className="num">{price.sub}</span> : undefined}
            chevron={!onRepeat}
            action={onRepeat && (
                <Button
                    variant="quiet"
                    size="sm"
                    icon={<Repeat size={20} aria-hidden="true" />}
                    onClick={(e) => { e.stopPropagation(); onRepeat(); }}
                    aria-label={`Повторить: ${place.title}, ${booking.startTime}`}
                    title="Повторить"
                />
            )}
        />
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
    // 09.11 фаза 3: «Оплачено» у каждой строки — шум (оплачено почти всё);
    // показываем только исключение — «без оплаты» (waived).
    if (booking.status !== 'cancelled' && booking.paymentStatus === 'waived') {
        out.push(<PaymentBadge key="p" status={booking.paymentStatus} />);
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
        <ListRow
            onClick={onTap}
            title={<>{resource?.name} · <span className="num">{first?.startTime}</span></>}
            subtitle={<>{fmt(dt0)} → {fmt(dtN)} · продлить или отменить</>}
            trail={<span className="num">{sorted.length} {ruPlural(sorted.length, ['бронь', 'брони', 'броней'])}</span>}
        />
    );
}

/** Статус оплаты — слова и цвета только из общего словаря (statuses.ts). */
function PaymentBadge({ status }: { status?: 'pending' | 'paid' | 'waived' | null }) {
    if (!status) return null;
    return <StatusBadge kind="payment" status={status} />;
}
