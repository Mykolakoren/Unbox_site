import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Repeat } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { RESOURCES, LOCATIONS } from '../../utils/data';
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
import { COLOR, STATUS } from '../../design/tokens';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Segmented } from '../../components/ui/Chip';
import { Button } from '../../components/ui/Button';

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
            .catch(() => toast.error('Не удалось обновить'));
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
    // "Продлить серию" / "ОК завершится в срок" actions.
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
    const upcoming = useMemo(() => {
        return myBookings
            .map(b => ({ b, dt: bookingStartDate(b) }))
            .filter(x => x.b.status === 'confirmed' && x.dt && x.dt.getTime() + (x.b.duration ?? 60) * 60000 > now.getTime())
            .sort((a, b) => a.dt!.getTime() - b.dt!.getTime());
    }, [myBookings, now]);

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
        <div style={{ paddingTop: 8, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />

            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
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
                {!loaded && bookingsStatus !== 'error' && <SkeletonRows height={118} />}
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
                        : upcoming.map(({ b, dt }) => {
                            const hoursToStart = (dt!.getTime() - Date.now()) / 3600000;
                            const within24h = hoursToStart >= 0 && hoursToStart < 24;
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
                                <SwipeRow key={b.id} primary={primary} secondary={secondary}>
                                    <Row booking={b} dt={dt!} onTap={() => setOpenBooking(b)} />
                                </SwipeRow>
                            );
                        })
                )}
                {loaded && tab === 'series' && (
                    series.length === 0
                        ? <EmptyState title="Активных серий нет" />
                        : series.map(s => (
                            <SeriesRow
                                key={s.id}
                                items={s.items}
                                onTap={() => {
                                    // Open the next upcoming booking in the
                                    // series — that's where the "Управление
                                    // серией" actions live in the detail sheet.
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
                        : past.map(({ b, dt }) => (
                            <Row
                                key={b.id}
                                booking={b}
                                dt={dt!}
                                dimmed
                                onTap={() => setOpenBooking(b)}
                                onRepeat={() => {
                                    if (prepareRepeat(b)) navigate('/m/checkout');
                                }}
                            />
                        ))
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

function Row({ booking, dt, dimmed, onTap, onRepeat }: {
    booking: BookingHistoryItem;
    dt: Date;
    dimmed?: boolean;
    onTap: () => void;
    onRepeat?: () => void;
}) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const location = LOCATIONS.find(l => l.id === resource?.locationId);
    // Lead with date — "Вс, 10 мая" — large + bold so the eye finds the day
    // first. Time follows in a second row, slightly smaller.
    const dateLabel = formatDateLabel(dt);
    const endStr = formatHHMM(new Date(dt.getTime() + (booking.duration ?? 60) * 60000));
    // Long-press → repeat (on past tab where onRepeat is set). For upcoming
    // tab onRepeat is undefined, so long-press is a no-op there.
    const longPressProps = useLongPress(() => onRepeat?.());

    return (
        <div
            className="press"
            style={{
                background: COLOR.card,
                border: `1px solid ${COLOR.ink08}`,
                borderRadius: 14,
                padding: 14,
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
            <div style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                lineHeight: 1.1,
                color: dimmed ? COLOR.ink60 : COLOR.ink,
            }}>
                {dateLabel}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: dimmed ? COLOR.ink60 : COLOR.ink80, marginTop: 4 }}>
                {booking.startTime}–{endStr}
            </div>
            <div style={{ fontSize: 13, color: COLOR.ink60, marginTop: 4 }}>
                {resource?.name ?? booking.resourceId}
                {location && <span style={{ color: COLOR.ink60 }}> · {location.name}</span>}
                <span style={{ color: COLOR.ink60 }}> · {formatBookingDuration(booking.duration ?? 60)}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{priceLabel(booking)}</span>
                <PaymentBadge status={booking.paymentStatus} />
                {(booking as any).recurringGroupId && <Tag>Серия</Tag>}
                {booking.isReRentListed && <Tag tone="warn">На пересдаче</Tag>}
                {onRepeat ? (
                    <Button
                        variant="secondary"
                        icon={<Repeat size={16} aria-hidden="true" />}
                        onClick={(e) => { e.stopPropagation(); onRepeat(); }}
                        style={{ marginLeft: 'auto' }}
                    >
                        Повторить
                    </Button>
                ) : (
                    // Карточка и так нажимается — хватит шеврона (было «тапни →»).
                    <ChevronRight size={18} color={COLOR.ink60} aria-hidden="true" style={{ marginLeft: 'auto' }} />
                )}
            </div>
        </div>
    );
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
            style={{
                width: '100%',
                background: COLOR.card,
                border: `1px solid ${COLOR.ink08}`,
                borderRadius: 14,
                padding: 14,
                cursor: onTap ? 'pointer' : 'default',
                fontFamily: 'inherit',
                textAlign: 'left',
                color: COLOR.ink,
            }}
        >
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: COLOR.ink60 }}>
                Серия · {sorted.length} {ruPlural(sorted.length, ['сессия', 'сессии', 'сессий'])}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
                {resource?.name} · {first?.startTime}
            </div>
            <div style={{ fontSize: 13, color: COLOR.ink60, marginTop: 4 }}>
                {fmt(dt0)} → {fmt(dtN)}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: COLOR.ink60, display: 'flex', alignItems: 'center', gap: 4 }}>
                Нажмите, чтобы продлить или отменить серию
                <ChevronRight size={14} />
            </div>
        </button>
    );
}

/** Статус оплаты — слова и цвета только из общего словаря (statuses.ts). */
function PaymentBadge({ status }: { status?: 'pending' | 'paid' | 'waived' | null }) {
    if (!status) return null;
    return <StatusBadge kind="payment" status={status} />;
}

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'muted' }) {
    const colors: Record<string, { bg: string; fg: string }> = {
        ok: { bg: STATUS.ok.bg, fg: STATUS.ok.fg },
        warn: { bg: STATUS.pending.bg, fg: STATUS.pending.fg },
        muted: { bg: STATUS.muted.bg, fg: STATUS.muted.fg },
    };
    const c = colors[tone];
    return (
        <span style={{
            background: c.bg, color: c.fg,
            fontSize: 12, fontWeight: 600,
            padding: '2px 7px', borderRadius: 999,
            whiteSpace: 'nowrap',
        }}>{children}</span>
    );
}

function bookingStartDate(b: BookingHistoryItem): Date | null {
    try {
        const d = b.date instanceof Date ? b.date : new Date(b.date as any);
        if (isNaN(d.getTime()) || !b.startTime) return null;
        const [h, m] = b.startTime.split(':').map(Number);
        const out = new Date(d);
        out.setHours(h, m, 0, 0);
        return out;
    } catch { return null; }
}

function formatHHMM(d: Date) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
