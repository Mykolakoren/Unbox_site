import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Repeat } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { BookingDetailSheet } from './BookingDetailSheet';
import { usePullToRefresh } from './usePullToRefresh';
import { PullIndicator } from './PullIndicator';
import { prepareRepeat } from './repeatBooking';
import { priceLabel } from './priceLabel';
import { ruPlural } from '../../utils/plural';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { SwipeRow } from './SwipeRow';
import { useLongPress } from './useLongPress';
import { bookingsApi } from '../../api/bookings';
import { toast } from 'sonner';
import type { BookingHistoryItem } from '../../store/types';

type Tab = 'upcoming' | 'series' | 'past';

export function MobileMyBookings() {
    const navigate = useNavigate();
    const { currentUser, bookings, fetchBookings } = useUserStore();
    const [tab, setTab] = useState<Tab>('upcoming');
    const [openBooking, setOpenBooking] = useState<BookingHistoryItem | null>(null);
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
            b.userId === currentUser.email || (b as any).user_uuid === currentUser.id
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
                <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Мои брони
                </h1>
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    background: '#F4F4F2',
                    borderRadius: 12,
                    padding: 4,
                    gap: 4,
                }}>
                    {([
                        ['upcoming', `Будущие · ${upcoming.length}`],
                        ['series', `Серии · ${series.length}`],
                        ['past', 'Прошедшие'],
                    ] as Array<[Tab, string]>).map(([id, label]) => {
                        const active = tab === id;
                        return (
                            <button
                                key={id}
                                onClick={() => setTab(id)}
                                style={{
                                    padding: '10px 4px',
                                    fontSize: 13,
                                    fontWeight: active ? 700 : 500,
                                    background: active ? '#fff' : 'transparent',
                                    color: active ? '#0E0E0E' : '#666',
                                    border: 'none',
                                    borderRadius: 9,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                                }}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="stagger-in" style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tab === 'upcoming' && (
                    upcoming.length === 0
                        ? <Empty>Будущих бронь пока нет</Empty>
                        : upcoming.map(({ b, dt }) => {
                            const hoursToStart = (dt!.getTime() - Date.now()) / 3600000;
                            const within24h = hoursToStart >= 0 && hoursToStart < 24;
                            // Within 24h, swiping cancel doesn't refund — surface
                            // the "Re-rent" action as the primary instead.
                            const primary = within24h
                                ? {
                                    label: '↪ Пересдать',
                                    color: '#0E0E0E',
                                    onAction: () => {
                                        // Rerent toggle uses the existing API; keep
                                        // confirmation lightweight via toast.
                                        bookingsApi.toggleReRent(b.id)
                                            .then(updated => {
                                                fetchBookings();
                                                toast.success(updated.isReRentListed
                                                    ? 'Выставлено на пересдачу'
                                                    : 'Снято с пересдачи');
                                            })
                                            .catch(() => toast.error('Не удалось обновить'));
                                    },
                                }
                                : {
                                    label: '✕ Отменить',
                                    color: '#C8253A',
                                    onAction: () => setOpenBooking(b),
                                };
                            const secondary = {
                                label: 'Детали',
                                color: '#666',
                                onAction: () => setOpenBooking(b),
                            };
                            return (
                                <SwipeRow key={b.id} primary={primary} secondary={secondary}>
                                    <Row booking={b} dt={dt!} onTap={() => setOpenBooking(b)} />
                                </SwipeRow>
                            );
                        })
                )}
                {tab === 'series' && (
                    series.length === 0
                        ? <Empty>Активных серий нет</Empty>
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
                {tab === 'past' && (
                    past.length === 0
                        ? <Empty>Истории нет</Empty>
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
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 14,
                padding: 14,
                opacity: dimmed ? 0.6 : 1,
                cursor: 'pointer',
            }}
            onClick={onTap}
            role="button"
            {...(onRepeat ? longPressProps : {})}
        >
            <div style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: '-0.01em',
                lineHeight: 1.1,
                color: '#0E0E0E',
            }}>
                {dateLabel}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#444', marginTop: 4 }}>
                {booking.startTime}–{endStr}
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                {resource?.name ?? booking.resourceId}
                {location && <span style={{ color: '#999' }}> · {location.name}</span>}
                <span style={{ color: '#999' }}> · {formatBookingDuration(booking.duration ?? 60)}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{priceLabel(booking)}</span>
                <PaymentBadge status={booking.paymentStatus} />
                {(booking as any).recurringGroupId && <Tag>серия</Tag>}
                {booking.isReRentListed && <Tag tone="warn">на пересдаче</Tag>}
                {onRepeat ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRepeat(); }}
                        style={{
                            marginLeft: 'auto',
                            background: '#0E0E0E',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            padding: '6px 12px',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                        }}
                    >
                        <Repeat size={12} />
                        Повторить
                    </button>
                ) : (
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#999' }}>тапни →</span>
                )}
            </div>
        </div>
    );
}

/** "Вс, 10 мая" — capitalised weekday short, day, full month. */
function formatDateLabel(d: Date): string {
    const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
    const day = d.getDate();
    const month = d.toLocaleDateString('ru-RU', { month: 'long' });
    return `${wd[0].toUpperCase()}${wd.slice(1)}, ${day} ${month}`;
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
    const fmt = (d: Date | null) => d ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '?';

    return (
        <button
            onClick={onTap}
            style={{
                width: '100%',
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 14,
                padding: 14,
                cursor: onTap ? 'pointer' : 'default',
                fontFamily: 'inherit',
                textAlign: 'left',
                color: '#0E0E0E',
            }}
        >
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#999' }}>
                Серия · {sorted.length} {ruPlural(sorted.length, ['сессия', 'сессии', 'сессий'])}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                {resource?.name} · {first?.startTime}
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                {fmt(dt0)} → {fmt(dtN)}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
                Тапни — продлить или отменить серию
                <ChevronRight size={14} />
            </div>
        </button>
    );
}

function PaymentBadge({ status }: { status?: 'pending' | 'paid' | 'waived' | null }) {
    if (status === 'paid') return <Tag tone="ok">Оплачено</Tag>;
    if (status === 'pending') return <Tag tone="warn">Не списано</Tag>;
    if (status === 'waived') return <Tag tone="muted">Без счёта</Tag>;
    return null;
}

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'muted' }) {
    const colors: Record<string, { bg: string; fg: string }> = {
        ok: { bg: '#E6F4EA', fg: '#1B6E36' },
        warn: { bg: '#FEF3C7', fg: '#8A5A00' },
        muted: { bg: '#EEE', fg: '#666' },
    };
    const c = colors[tone];
    return (
        <span style={{
            background: c.bg, color: c.fg,
            fontSize: 11, fontWeight: 700,
            padding: '2px 7px', borderRadius: 999,
            whiteSpace: 'nowrap',
        }}>{children}</span>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            background: '#F4F4F2',
            borderRadius: 14,
            padding: 24,
            textAlign: 'center',
            color: '#666',
            fontSize: 14,
        }}>
            {children}
        </div>
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
