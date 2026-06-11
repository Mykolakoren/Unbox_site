import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, List, LayoutGrid } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import { BookingDetailSheet } from './BookingDetailSheet';
import { getFavoriteCabinet } from './favoriteCabinet';
import type { BookingHistoryItem } from '../../store/types';

// Compact enough that 09:00–22:00 (13h) fits within 2 phone-screens worth of
// scroll while still leaving each row tappable. Earlier 56px wasted vertical
// space and pushed labels to the top of the visible area.
const HOUR_PX = 48;
const TIME_RAIL_PX = 44;   // left margin for hour labels
const DAY_START = 9;
const DAY_END = 22;

/**
 * Mobile-native chessboard view.
 *
 * Two modes:
 *   - "room"     — focus on one cabinet, vertical timeline 09–22, Google
 *                  Calendar Day-view feel. Pick a different cabinet via the
 *                  horizontal chips at top. Tap empty space → quick-book.
 *   - "schedule" — chronological list of all bookings on the chosen day
 *                  across all rooms. Browse-only, "what's happening today".
 *
 * Replaces the desktop /dashboard/bookings chessboard for the mobile flow.
 */
export function MobileCalendar() {
    const navigate = useNavigate();
    const { currentUser, bookings, fetchBookings } = useUserStore();
    const reset = useBookingStore(s => s.reset);

    const [dayOffset, setDayOffset] = useState(0);
    const [mode, setMode] = useState<'room' | 'schedule'>('room');
    const [openBooking, setOpenBooking] = useState<BookingHistoryItem | null>(null);

    // Default the active room to the user's favourite, falling back to the
    // first cabinet of Unbox Uni (the bigger site, more action there).
    const fav = getFavoriteCabinet(currentUser?.id);
    const [activeResId, setActiveResId] = useState<string>(
        fav || RESOURCES.find(r => r.locationId === 'unbox_uni' && r.type === 'cabinet')?.id || RESOURCES[0]?.id
    );

    useEffect(() => { fetchBookings(); }, [fetchBookings]);

    const targetDate = useMemo(() => {
        const d = addDays(new Date(), dayOffset);
        d.setHours(0, 0, 0, 0);
        return d;
    }, [dayOffset]);

    const dayKey = fmtDate(targetDate, 'yyyy-MM-dd');

    // All bookings on the chosen day (across rooms) — used for both the
    // single-room timeline and the all-day schedule.
    const dayBookings = useMemo(() => {
        return bookings
            .filter(b => b.status === 'confirmed' && b.date && fmtDate(new Date(b.date as any), 'yyyy-MM-dd') === dayKey)
            .map(b => {
                const [h, m] = (b.startTime || '00:00').split(':').map(Number);
                const startMin = h * 60 + m;
                return { b, startMin, endMin: startMin + (b.duration ?? 60) };
            })
            .sort((a, b) => a.startMin - b.startMin);
    }, [bookings, dayKey]);

    const roomBookings = useMemo(
        () => dayBookings.filter(x => x.b.resourceId === activeResId),
        [dayBookings, activeResId],
    );

    // Visible cabinets — exclude Neo School (group-only, niche) and any
    // resource explicitly marked inactive (e.g., temporarily not rented).
    const visibleCabinets = useMemo(
        () => RESOURCES.filter(r => r.locationId !== 'neo_school' && r.isActive !== false),
        [],
    );

    /** Quick-book: tap an empty hour → pre-fill /m/checkout with that slot. */
    const quickBook = (hour: number) => {
        const slotStrs = [`${activeResId}|${pad(hour)}:00`, `${activeResId}|${pad(hour)}:30`];
        const resource = RESOURCES.find(r => r.id === activeResId);
        reset();
        useBookingStore.setState({
            locationId: resource?.locationId || 'unbox_one',
            date: targetDate,
            format: (resource?.formats?.[0] as any) || 'individual',
            selectedSlots: slotStrs,
            step: 3,
        });
        navigate('/m/checkout');
    };

    const isOwnBooking = (b: BookingHistoryItem) =>
        b.userId === currentUser?.email || (b as any).user_uuid === currentUser?.id;

    return (
        <>
            <div style={{
                paddingTop: 12,
                paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
                display: 'flex', flexDirection: 'column', gap: 14,
            }}>
                <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, flex: 1 }}>
                        Календарь
                    </h1>
                    {/* Mode toggle: room timeline vs schedule list */}
                    <div style={{
                        display: 'flex',
                        background: '#F4F4F2',
                        borderRadius: 10,
                        padding: 3,
                    }}>
                        <button
                            onClick={() => setMode('room')}
                            aria-label="Кабинет"
                            style={modeBtn(mode === 'room')}
                        >
                            <LayoutGrid size={16} />
                        </button>
                        <button
                            onClick={() => setMode('schedule')}
                            aria-label="Лента"
                            style={modeBtn(mode === 'schedule')}
                        >
                            <List size={16} />
                        </button>
                    </div>
                </div>

                {/* Day picker — arrows + label */}
                <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                        onClick={() => setDayOffset(o => o - 1)}
                        style={navBtn}
                        aria-label="Предыдущий день"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <div style={{
                        flex: 1,
                        textAlign: 'center',
                        fontSize: 14,
                        fontWeight: 700,
                        textTransform: 'capitalize',
                    }}>
                        {dayLabel(targetDate, dayOffset)}
                    </div>
                    <button
                        onClick={() => setDayOffset(o => o + 1)}
                        style={navBtn}
                        aria-label="Следующий день"
                    >
                        <ChevronRight size={20} />
                    </button>
                </div>

                {mode === 'room' ? (
                    <>
                        {/* Cabinet chips — horizontal scroll */}
                        <div style={{
                            display: 'flex',
                            gap: 6,
                            overflowX: 'auto',
                            padding: '0 16px 4px',
                            scrollbarWidth: 'none',
                        }}>
                            {visibleCabinets.map(r => {
                                const active = r.id === activeResId;
                                const loc = LOCATIONS.find(l => l.id === r.locationId);
                                return (
                                    <button
                                        key={r.id}
                                        onClick={() => setActiveResId(r.id)}
                                        style={{
                                            background: active ? '#0E0E0E' : '#F4F4F2',
                                            color: active ? '#fff' : '#0E0E0E',
                                            border: 'none',
                                            borderRadius: 10,
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            flex: '0 0 auto',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <div style={{ fontSize: 12, fontWeight: 700 }}>{r.name}</div>
                                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>
                                            {loc?.name?.replace('Unbox ', '')}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Vertical timeline */}
                        <div style={{ padding: '0 16px' }}>
                            <Timeline
                                bookings={roomBookings}
                                isOwnBooking={isOwnBooking}
                                onTapOwn={(b) => setOpenBooking(b)}
                                onTapEmpty={quickBook}
                            />
                        </div>
                    </>
                ) : (
                    /* Schedule (all rooms, chronological) */
                    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {dayBookings.length === 0 ? (
                            <div style={{
                                background: '#F4F4F2',
                                borderRadius: 14,
                                padding: 18,
                                textAlign: 'center',
                                color: '#666',
                                fontSize: 14,
                            }}>
                                В этот день ничего не забронировано.
                            </div>
                        ) : dayBookings.map(({ b, startMin, endMin }) => {
                            const own = isOwnBooking(b);
                            const r = RESOURCES.find(x => x.id === b.resourceId);
                            return (
                                <button
                                    key={b.id}
                                    onClick={() => own ? setOpenBooking(b) : null}
                                    disabled={!own}
                                    style={{
                                        // Own bookings — brand teal (Unbox accent
                                        // #476D6B from the favicon/landing). Reads
                                        // as "mine, active", not "blocked".
                                        // Others stay neutral light gray = "busy".
                                        background: own ? '#E8F0EF' : '#F4F4F2',
                                        color: own ? '#1C3835' : '#666',
                                        border: own
                                            ? '1px solid #476D6B'
                                            : '1px solid rgba(0,0,0,0.06)',
                                        borderRadius: 12,
                                        padding: '10px 12px',
                                        textAlign: 'left',
                                        fontFamily: 'inherit',
                                        cursor: own ? 'pointer' : 'default',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                    }}
                                >
                                    <div style={{
                                        fontSize: 14,
                                        fontWeight: 700,
                                        minWidth: 88,
                                    }}>
                                        {minToHHMM(startMin)}–{minToHHMM(endMin)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                                            {r?.name ?? b.resourceId}
                                        </div>
                                        <div style={{ fontSize: 11, opacity: own ? 0.85 : 0.6, marginTop: 1 }}>
                                            {own ? 'Ваша бронь' : 'Занято'}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {openBooking && (
                <BookingDetailSheet
                    booking={openBooking}
                    onClose={() => setOpenBooking(null)}
                />
            )}
        </>
    );
}

/** Vertical timeline grid — 1 hour = HOUR_PX. Free hours are tappable. */
function Timeline({ bookings, isOwnBooking, onTapOwn, onTapEmpty }: {
    bookings: { b: BookingHistoryItem; startMin: number; endMin: number }[];
    isOwnBooking: (b: BookingHistoryItem) => boolean;
    onTapOwn: (b: BookingHistoryItem) => void;
    onTapEmpty: (hour: number) => void;
}) {
    const totalHours = DAY_END - DAY_START;
    const totalHeight = totalHours * HOUR_PX;

    return (
        <div style={{
            position: 'relative',
            height: totalHeight,
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 14,
            overflow: 'hidden',
        }}>
            {/* Hour rows — clickable for quick-book */}
            {Array.from({ length: totalHours }).map((_, i) => {
                const hour = DAY_START + i;
                return (
                    <button
                        key={hour}
                        onClick={() => onTapEmpty(hour)}
                        style={{
                            position: 'absolute',
                            top: i * HOUR_PX,
                            left: 0,
                            right: 0,
                            height: HOUR_PX,
                            background: 'transparent',
                            border: 'none',
                            borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.06)',
                            display: 'flex',
                            alignItems: 'flex-start',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            padding: `6px 12px 6px ${TIME_RAIL_PX + 8}px`,
                            textAlign: 'left',
                            color: 'transparent',
                        }}
                        aria-label={`Забронировать на ${hour}:00`}
                    >
                        {/* Hover-only "+ Забронировать" prompt would be too noisy on
                            mobile — skip; the hour label on left is the only label. */}
                    </button>
                );
            })}

            {/* Vertical divider between time rail and content area. */}
            <div style={{
                position: 'absolute',
                top: 0, bottom: 0, left: TIME_RAIL_PX - 2,
                width: 1, background: 'rgba(0,0,0,0.06)',
                pointerEvents: 'none',
            }} />

            {/* Hour labels — sit inside the top of each hour row, not on the
                grid line. That avoids the previous clipping at i=0 (label was
                at top=-7, half hidden under the rounded corner). */}
            {Array.from({ length: totalHours }).map((_, i) => {
                const hour = DAY_START + i;
                return (
                    <div
                        key={`lbl-${hour}`}
                        style={{
                            position: 'absolute',
                            top: i * HOUR_PX + 4,
                            left: 8,
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#999',
                            pointerEvents: 'none',
                        }}
                    >
                        {hour}:00
                    </div>
                );
            })}

            {/* Booking blocks */}
            {bookings.map(({ b, startMin, endMin }) => {
                const top = ((startMin / 60) - DAY_START) * HOUR_PX;
                const height = ((endMin - startMin) / 60) * HOUR_PX;
                const own = isOwnBooking(b);
                return (
                    <button
                        key={b.id}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (own) onTapOwn(b);
                        }}
                        disabled={!own}
                        style={{
                            position: 'absolute',
                            top,
                            left: TIME_RAIL_PX + 4,
                            right: 8,
                            height: Math.max(28, height - 2),
                            // Own bookings — soft Unbox teal (brand accent),
                            // not black: tests showed black timeline blocks
                            // read as "blocked/inactive", not "yours".
                            // Others — neutral gray = "busy" (replacing the
                            // earlier red, which felt too alarming for what's
                            // just a slot taken by a colleague).
                            background: own ? '#E8F0EF' : '#F4F4F2',
                            color: own ? '#1C3835' : '#666',
                            border: own ? '1px solid #476D6B' : '1px solid rgba(0,0,0,0.08)',
                            borderRadius: 8,
                            padding: '6px 10px',
                            textAlign: 'left',
                            fontFamily: 'inherit',
                            cursor: own ? 'pointer' : 'default',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-start',
                            overflow: 'hidden',
                        }}
                    >
                        <div style={{ fontSize: 12, fontWeight: 700 }}>
                            {minToHHMM(startMin)}–{minToHHMM(endMin)}
                        </div>
                        <div style={{ fontSize: 11, opacity: own ? 0.85 : 0.7 }}>
                            {own ? 'Ваша бронь' : 'Занято'}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

const navBtn: React.CSSProperties = {
    background: '#F4F4F2',
    border: 'none',
    borderRadius: 10,
    width: 40, height: 40,
    display: 'grid', placeItems: 'center',
    cursor: 'pointer',
    color: '#0E0E0E',
};

const modeBtn = (active: boolean): React.CSSProperties => ({
    background: active ? '#fff' : 'transparent',
    color: active ? '#0E0E0E' : '#999',
    border: 'none',
    borderRadius: 7,
    width: 32, height: 30,
    display: 'grid', placeItems: 'center',
    cursor: 'pointer',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
    fontFamily: 'inherit',
});

function dayLabel(d: Date, offset: number): string {
    if (offset === 0) return 'Сегодня · ' + fmtDate(d, 'd MMMM, EEEE', { locale: ru });
    if (offset === 1) return 'Завтра · ' + fmtDate(d, 'd MMMM', { locale: ru });
    if (offset === -1) return 'Вчера · ' + fmtDate(d, 'd MMMM', { locale: ru });
    return fmtDate(d, 'EEEE, d MMMM', { locale: ru });
}

function pad(n: number) { return n.toString().padStart(2, '0'); }
function minToHHMM(m: number) {
    const h = Math.floor(m / 60), mm = m % 60;
    return `${pad(h)}:${pad(mm)}`;
}
