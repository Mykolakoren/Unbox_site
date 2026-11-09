import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, format as fmtDate } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, List, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import { BookingDetailSheet } from './BookingDetailSheet';
import { getFavoriteCabinet } from './favoriteCabinet';
import type { BookingHistoryItem } from '../../store/types';
import { COLOR, RADIUS, TEXT } from '../../design/tokens';
import { Chip } from '../../components/ui/Chip';
import { formatDateLabel, formatDayMonth } from '../../utils/format';
import { EmptyState } from '../../components/ui/EmptyState';
import { tbilisiNow } from '../../utils/dateUtils';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

// Compact enough that 09:00–22:00 (13h) fits within 2 phone-screens worth of
// scroll while still leaving each row tappable. Earlier 56px wasted vertical
// space and pushed labels to the top of the visible area.
// 09.11: 64 — час делится на две половины (:00 / :30), каждой нужна высота под палец.
const HOUR_PX = 64;
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
 *
 * Волна 2, пакет B: шапка со стрелкой «Назад» (G4-client-mobile-M4 — в
 * установленном приложении браузерной «Назад» нет; без истории — в «Свободно»),
 * подсказка над сеткой и «+ Свободно» в полностью свободных часах (G4-22),
 * чипы кабинетов 44 px.
 */
export function MobileCalendar() {
    const navigate = useNavigate();
    // Селективные селекторы — ре-рендер только на изменение нужных полей.
    const currentUser = useUserStore(s => s.currentUser);
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    const reset = useBookingStore(s => s.reset);

    const [dayOffset, setDayOffset] = useState(0);
    const [mode, setMode] = useState<'room' | 'schedule'>('room');
    const [openBooking, setOpenBooking] = useState<BookingHistoryItem | null>(null);

    // Default the active room to the user's favourite, falling back to the
    // first cabinet of Unbox Uni (the bigger site, more action there).
    // Любимый кабинет — только если он ещё сдаётся (кабинет 9 закрыт).
    const favRaw = getFavoriteCabinet(currentUser?.id);
    const fav = favRaw && RESOURCES.some(r => r.id === favRaw && r.isActive !== false) ? favRaw : null;
    const [activeResId, setActiveResId] = useState<string>(
        fav || RESOURCES.find(r => r.locationId === 'unbox_uni' && r.type === 'cabinet')?.id || RESOURCES[0]?.id
    );

    useEffect(() => { fetchBookings(); }, [fetchBookings]);
    useDocumentTitle('Календарь');

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
            // «На подтверждении» тоже держит время (12.10, как check_availability на сервере).
            .filter(b => (b.status === 'confirmed' || b.status === 'pending_approval') && b.date && fmtDate(new Date(b.date as any), 'yyyy-MM-dd') === dayKey)
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

    /** Тап по часу → сразу на страницу оформления с этим часом. Начало (шаг 30 мин),
     *  длительность, формат, допуслуги и цена правятся уже ТАМ — на одной
     *  скроллящейся странице, где ничего не перекрывается (всплывающая панель
     *  прятала кнопку «Забронировать» и уводила от допов — убрали). */
    // 09.11 (ревью №17): старт с :00 или :30 (верхняя / нижняя половина часа),
    // прошедшее время не нажимается — раньше вело на оформление с «уже началось».
    const quickBook = (startMin: number) => {
        const endMin = startMin + 60;
        const nowFrom = dayOffset < 0 ? Infinity : dayOffset === 0 ? tbilisiNow().totalMins : 0;
        if (startMin <= nowFrom) {
            toast.error('Это время уже прошло — выберите другое.');
            return;
        }
        if (roomBookings.some(x => x.startMin < endMin && x.endMin > startMin)) {
            toast.error('Это время уже занято — выберите другое.');
            return;
        }
        const resource = RESOURCES.find(r => r.id === activeResId);
        reset();
        useBookingStore.setState({
            locationId: resource?.locationId || 'unbox_one',
            date: targetDate,
            format: (resource?.formats?.[0] as any) || 'individual',
            selectedSlots: [`${activeResId}|${minToHHMM(startMin)}`, `${activeResId}|${minToHHMM(startMin + 30)}`],
            step: 3,
        });
        navigate('/m/checkout');
    };

    const isOwnBooking = (b: BookingHistoryItem) =>
        b.userId === currentUser?.email || (!!currentUser?.id && (b as any).userUuid === currentUser.id);

    return (
        <>
            <MobilePageHeader
                title="Календарь"
                fallbackTo="/m/find"
                action={
                    /* Режим: один кабинет по часам или лента всех броней дня */
                    <div role="group" aria-label="Вид календаря" style={{
                        display: 'flex',
                        background: COLOR.sunken,
                        borderRadius: RADIUS.control,
                        padding: 2,
                    }}>
                        <button
                            onClick={() => setMode('room')}
                            aria-label="Кабинет по часам"
                            aria-pressed={mode === 'room'}
                            style={modeBtn(mode === 'room')}
                        >
                            <LayoutGrid size={16} aria-hidden="true" />
                        </button>
                        <button
                            onClick={() => setMode('schedule')}
                            aria-label="Лента броней"
                            aria-pressed={mode === 'schedule'}
                            style={modeBtn(mode === 'schedule')}
                        >
                            <List size={16} aria-hidden="true" />
                        </button>
                    </div>
                }
            />
            <div style={{
                paddingTop: 12,
                paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
                display: 'flex', flexDirection: 'column', gap: 14,
            }}>
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
                        fontSize: TEXT.body,
                        fontWeight: 600,
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
                        {/* 09.11 фаза 3: выбранный кабинет — общий Chip (accent-soft + рамка),
                            не чёрная заливка; ряд листается с затуханием справа. */}
                        <div className="ui-chip-row ui-chip-row--scroll" role="group" aria-label="Кабинет" style={{
                            gap: 6,
                            padding: '0 16px 4px',
                        }}>
                            {visibleCabinets.map(r => {
                                const active = r.id === activeResId;
                                const loc = LOCATIONS.find(l => l.id === r.locationId);
                                return (
                                    <Chip
                                        key={r.id}
                                        selected={active}
                                        onClick={() => setActiveResId(r.id)}
                                        style={{
                                            flexDirection: 'column',
                                            alignItems: 'flex-start',
                                            gap: 1,
                                            padding: '6px 12px',
                                            flex: '0 0 auto',
                                        }}
                                    >
                                        <span style={{ fontWeight: 600 }}>{r.name}</span>
                                        <span style={{ fontSize: TEXT.caption, fontWeight: 500, color: COLOR.ink60 }}>
                                            {loc?.name?.replace('Unbox ', '')}
                                        </span>
                                    </Chip>
                                );
                            })}
                        </div>

                        {/* Vertical timeline */}
                        <div style={{ padding: '0 16px' }}>
                            <p style={{ fontSize: TEXT.small, color: COLOR.ink60, margin: '0 0 8px' }}>
                                Нажмите на свободный час: верх — начало в :00, низ — в :30. Прошедшее время закрыто.
                            </p>
                            <Timeline
                                bookings={roomBookings}
                                isOwnBooking={isOwnBooking}
                                onTapOwn={(b) => setOpenBooking(b)}
                                onTapEmpty={quickBook}
                                // Прошедшие часы не подписываем «+ Свободно»:
                                // вчера — весь день, сегодня — до текущего времени.
                                freeFromMin={dayOffset < 0 ? Infinity : dayOffset === 0 ? tbilisiNow().totalMins : 0}
                            />
                        </div>
                    </>
                ) : (
                    /* Schedule (all rooms, chronological) */
                    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {dayBookings.length === 0 ? (
                            <EmptyState compact illustration="plant" title="В этот день ничего не забронировано" />
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
                                        background: own ? COLOR.accentSoft : COLOR.sunken,
                                        color: own ? COLOR.accentInk : COLOR.ink60,
                                        border: own
                                            ? `1px solid ${COLOR.accent}`
                                            : `1px solid ${COLOR.ink05}`,
                                        borderRadius: RADIUS.control,
                                        padding: '10px 12px',
                                        textAlign: 'left',
                                        fontFamily: 'inherit',
                                        cursor: own ? 'pointer' : 'default',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                    }}
                                >
                                    <div className="num" style={{
                                        fontSize: TEXT.small,
                                        fontWeight: 600,
                                        minWidth: 88,
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {minToHHMM(startMin)}–{minToHHMM(endMin)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: TEXT.small, fontWeight: 600 }}>
                                            {r?.name ?? b.resourceId}
                                        </div>
                                        {/* Без прозрачности: ink-60 × 0.6 уходило ниже читаемого. */}
                                        <div style={{ fontSize: TEXT.caption, marginTop: 1 }}>
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
function Timeline({ bookings, isOwnBooking, onTapOwn, onTapEmpty, freeFromMin }: {
    bookings: { b: BookingHistoryItem; startMin: number; endMin: number }[];
    isOwnBooking: (b: BookingHistoryItem) => boolean;
    onTapOwn: (b: BookingHistoryItem) => void;
    /** Минута начала (шаг 30). */
    onTapEmpty: (startMin: number) => void;
    /** С какой минуты дня часы ещё впереди (подпись «+ Свободно»). */
    freeFromMin: number;
}) {
    const totalHours = DAY_END - DAY_START;
    const totalHeight = totalHours * HOUR_PX;

    return (
        <div style={{
            position: 'relative',
            height: totalHeight,
            background: COLOR.card,
            border: `1px solid ${COLOR.ink08}`,
            borderRadius: RADIUS.sheet,
            overflow: 'hidden',
        }}>
            {/* Hour rows — clickable for quick-book */}
            {/* Каждый час — две половины: верхняя начинает бронь с :00,
                нижняя — с :30 (ревью №17). Прошедшие половины не нажимаются. */}
            {Array.from({ length: totalHours * 2 }).map((_, j) => {
                const startMin = DAY_START * 60 + j * 30;
                const hourStart = startMin % 60 === 0;
                const past = startMin <= freeFromMin;
                const slotFree = (from: number) => !bookings.some(x => x.startMin < from + 60 && x.endMin > from);
                // «+ Свободно» — в верхней половине, если весь час свободен;
                // «+ с :30» — в нижней, если с :30 свободен час, а с :00 — нет.
                // 09.11 фаза 3: вместо десяти одинаковых «+ Свободно» — еле заметный
                // «+» справа (подсказка «нажмите на свободный час» — одна, сверху).
                const label = past || startMin + 60 > DAY_END * 60 ? null
                    : hourStart ? (slotFree(startMin) ? '+' : null)
                        : (slotFree(startMin) && (startMin - 30 <= freeFromMin || !slotFree(startMin - 30)) ? `+ :30` : null);
                const hh = `${Math.floor(startMin / 60)}:${hourStart ? '00' : '30'}`;
                return (
                    <button
                        key={startMin}
                        onClick={() => { if (!past) onTapEmpty(startMin); }}
                        disabled={past}
                        style={{
                            position: 'absolute',
                            top: j * (HOUR_PX / 2),
                            left: 0,
                            right: 0,
                            height: HOUR_PX / 2,
                            background: past ? COLOR.sunken : 'transparent',
                            border: 'none',
                            borderTop: j === 0 || !hourStart ? 'none' : `1px solid ${COLOR.ink05}`,
                            display: 'flex',
                            alignItems: 'center',
                            cursor: past ? 'default' : 'pointer',
                            fontFamily: 'inherit',
                            padding: `0 16px 0 ${TIME_RAIL_PX + 8}px`,
                            justifyContent: 'flex-end',
                            textAlign: 'right',
                            color: COLOR.ink60,
                            fontSize: TEXT.small,
                        }}
                        aria-label={past ? `${hh} — время прошло` : `Забронировать с ${hh}`}
                    >
                        {label && <span aria-hidden="true" className="num" style={{ fontWeight: 500 }}>{label}</span>}
                    </button>
                );
            })}

            {/* Vertical divider between time rail and content area. */}
            <div style={{
                position: 'absolute',
                top: 0, bottom: 0, left: TIME_RAIL_PX - 2,
                width: 1, background: COLOR.ink05,
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
                        className="num"
                        style={{
                            position: 'absolute',
                            top: i * HOUR_PX + 4,
                            left: 8,
                            fontSize: TEXT.caption,
                            fontWeight: 600,
                            color: COLOR.ink60,
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
                            background: own ? COLOR.accentSoft : COLOR.sunken,
                            color: own ? COLOR.accentInk : COLOR.ink60,
                            border: own ? `1px solid ${COLOR.accent}` : `1px solid ${COLOR.ink08}`,
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
                        <div className="num" style={{ fontSize: TEXT.caption, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {minToHHMM(startMin)}–{minToHHMM(endMin)}
                        </div>
                        <div style={{ fontSize: TEXT.caption }}>
                            {own ? 'Ваша бронь' : 'Занято'}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

// 09.11 фаза 3: стрелки дня — тихие иконки (были серые квадраты тяжелее заголовка).
const navBtn: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    borderRadius: RADIUS.control,
    width: 44, height: 44,
    display: 'grid', placeItems: 'center',
    cursor: 'pointer',
    color: COLOR.ink,
};

const modeBtn = (active: boolean): React.CSSProperties => ({
    background: active ? COLOR.card : 'transparent',
    color: active ? COLOR.ink : COLOR.ink60,
    border: 'none',
    borderRadius: RADIUS.control,
    width: 44, height: 44,
    display: 'grid', placeItems: 'center',
    cursor: 'pointer',
    boxShadow: active ? `0 1px 2px ${COLOR.ink08}` : 'none',
    fontFamily: 'inherit',
});

/** «Сегодня · вт, 30 сентября», «Завтра · 1 октября», «Пт, 3 октября».
 *  Wave 1: общий форматтер вместо date-fns + textTransform:'capitalize',
 *  который писал «Сентября» с большой буквы. */
function dayLabel(d: Date, offset: number): string {
    if (offset === 0) return 'Сегодня · ' + formatDateLabel(d);
    if (offset === 1) return 'Завтра · ' + formatDayMonth(d);
    if (offset === -1) return 'Вчера · ' + formatDayMonth(d);
    return formatDateLabel(d, { capitalize: true });
}

function pad(n: number) { return n.toString().padStart(2, '0'); }
function minToHHMM(m: number) {
    const h = Math.floor(m / 60), mm = m % 60;
    return `${pad(h)}:${pad(mm)}`;
}
