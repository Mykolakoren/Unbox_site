import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Plus, SlidersHorizontal, X } from 'lucide-react';
import { addDays, format as fmtDate } from 'date-fns';
import { useUserStore } from '../../../store/userStore';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import type { BookingHistoryItem } from '../../../store/types';
import { AdminBookingSheets, getAdminUserName } from './bookingSheets';
import { useAdminDueMap, acceptPaymentFor, type AcceptPayment } from './adminPayment';
import { TopupSheet } from './TopupSheet';
import { DueBadge } from '../../../components/admin/DueBadge';
import { useBookingStore } from '../../../store/bookingStore';
import { formatGel } from '../../../utils/format';
import { statusLabel } from '../../../design/statuses';
import { Chip } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { COLOR } from '../../../design/tokens';
import { formatDateLabel, formatDayMonth } from '../../../utils/format';
import { useArchivedClients } from '../../../hooks/useArchivedClients';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Segmented } from '../../../components/ui/Chip';
import { matchesPerson } from './searchMatch';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { ListGroup } from '../../../components/ui/ListRow';
import { AdminBookingRow } from './AdminBookingRow';

/** «Unbox Uni» → «Uni»: в строке брони филиал коротко (на 360 px подпись не разваливается). */
const shortBranch = (name: string) => name.replace(/^Unbox\s+/i, '');

/** 1 прошедшая, 2 прошедшие, 5 прошедших. */
function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

/**
 * Mobile admin — bookings overview.
 *
 * Replaces the desktop chessboard (which is unusable at 375px) with a
 * chronological list filtered by day / location / status / search. Each
 * row is tappable → opens an action sheet with cancel / approve. The
 * full chessboard remains available via the desktop escape in /m/me.
 */
type LocFilter = 'all' | 'unbox_one' | 'unbox_uni';

export function MobileAdminBookings() {
    // 2026-06-02 owner: fetchBookings() мержит /bookings/me + /bookings/public,
    // а /public маскирует user_id для приватности → чужие брони рендерились
    // как «Гость». Админу нужны полные данные → fetchAllBookings() →
    // /bookings/ (admin-only, возвращает все с реальными userId).
    const { bookings, users, fetchAllBookings, fetchUsers } = useUserStore();
    // Date selection: single source of truth — yyyy-MM-dd string.
    // ?day=tomorrow / ?day=YYYY-MM-DD из ссылок дашборда (owner 2026-06-02).
    const [searchParams] = useSearchParams();
    const [dayKey, setDayKey] = useState(() => {
        const param = searchParams.get('day');
        if (param === 'tomorrow') {
            return fmtDate(addDays(new Date(), 1), 'yyyy-MM-dd');
        }
        if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
            return param;
        }
        return fmtDate(new Date(), 'yyyy-MM-dd');
    });
    const [loc, setLoc] = useState<LocFilter>('all');
    // ?q=<почта> — из карточки клиента («И ещё N — все брони клиента»): все его
    // брони с сегодняшнего дня, а не один день (ревью 09.11, №7).
    const [query, setQuery] = useState(() => searchParams.get('q') || '');
    const [clientMode, setClientMode] = useState(() => !!searchParams.get('q'));
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [sheet, setSheet] = useState<BookingHistoryItem | null>(null);
    // 2026-06-03 owner: один тоггл вместо 5-чипа статуса. По умолчанию
    // показываем только актуальные брони (confirmed + pending_approval).
    // Чекбокс «Показать прошедшие» добавляет отменённые / завершённые /
    // перенесённые / пересданные / no-show в список.
    const [showPast, setShowPast] = useState(() => searchParams.get('past') === '1');
    // Волна 4 (В2, G9-24): «к оплате / ✓» в строке и «Принять оплату» в шторке.
    const dueMap = useAdminDueMap(bookings, users);
    const [pay, setPay] = useState<AcceptPayment | null>(null);
    const setBookingForUser = useBookingStore(s => s.setBookingForUser);

    useEffect(() => {
        fetchAllBookings();
        if (!users || users.length === 0) fetchUsers();
    }, []);

    const targetDate = useMemo(() => {
        const d = new Date(dayKey + 'T00:00:00');
        return Number.isFinite(d.getTime()) ? d : new Date();
    }, [dayKey]);
    const todayKey = useMemo(() => fmtDate(new Date(), 'yyyy-MM-dd'), []);
    // 25.10: брони держатся окном дат — выбрали день за краем окна, догружаем его.
    const ensureBookingsRange = useUserStore(s => s.ensureBookingsRange);
    useEffect(() => {
        void ensureBookingsRange(targetDate, addDays(targetDate, 1));
    }, [targetDate, ensureBookingsRange]);

    // Брони клиента, чей аккаунт в архиве (склейка дублей): в обычном списке
    // его нет — подписываем именем из архива с пометкой «архив», а не началом
    // почты (как «Сегодня» и шахматка). Только подпись: «к оплате» по-прежнему
    // из dueMap по обычному списку, архив в деньги не подмешиваем.
    const knownUserIds = useMemo(() => {
        const known = new Set<string>();
        for (const u of users || []) { if (u.id) known.add(String(u.id)); if (u.email) known.add(u.email); }
        return known;
    }, [users]);
    const missingUserIds = useMemo(
        () => bookings
            .filter(b => b.userId && !knownUserIds.has(b.userId) && (clientMode || bookingDayKey(b) === dayKey))
            .map(b => b.userId),
        [bookings, knownUserIds, dayKey, clientMode],
    );
    const archived = useArchivedClients(missingUserIds);
    const archivedNameOf = (email: string | null | undefined): string | undefined =>
        email && !knownUserIds.has(email) ? archived.get(email)?.name || undefined : undefined;

    const getUserName = (email: string | null | undefined) =>
        archivedNameOf(email) ?? getAdminUserName(users, email);

    /** System blockers (cleaning, maintenance, etc.) aren't real client
     *  bookings — admin shouldn't read them with the same scanning priority.
     *  Detect by known service emails; expand the list if more system
     *  accounts appear (cleaning-other-location, technician, etc.). */
    const isSystemBlocker = (email: string | null | undefined): boolean => {
        if (!email) return false;
        return email === 'lela@unbox.center'
            || email.startsWith('uborka@')
            || email.startsWith('cleaning@');
    };

    /** Human-readable duration. <60 → «N мин»; ≥60 → «Nч» or «Nч 30мин». */
    const formatDuration = (min: number): string => {
        if (min < 60) return `${min} мин`;
        const h = Math.floor(min / 60);
        const m = min % 60;
        if (m === 0) return `${h} ч`;
        if (m === 30) return `${h},5 ч`;
        return `${h} ч ${m} мин`;
    };

    /** Past/inactive statuses — hidden by default, surfaced when showPast=true. */
    const PAST_STATUSES = new Set(['cancelled', 'completed', 'rescheduled', 're-rented', 'no_show']);

    const dayBookings = useMemo(() => {
        const q = query.trim();
        return bookings
            .filter(b => {
                // Режим «все брони клиента»: с сегодняшнего дня, без фильтра по дню.
                if (clientMode ? bookingDayKey(b) < todayKey : bookingDayKey(b) !== dayKey) return false;
                if (!showPast && PAST_STATUSES.has(b.status)) return false;
                if (loc !== 'all' && b.locationId !== loc) return false;
                if (q) {
                    // Телефон — по цифрам, имя — словами в любом порядке (ревью 09.11, №6).
                    const u = users.find(x => x.email === b.userId || x.id === b.userId);
                    const res = RESOURCES.find(r => r.id === b.resourceId)?.name || '';
                    if (!matchesPerson(q, { name: getUserName(b.userId), email: b.userId, phone: u?.phone, extra: [res] })) return false;
                }
                return true;
            })
            .sort((a, b) => `${bookingDayKey(a)} ${a.startTime || ''}`.localeCompare(`${bookingDayKey(b)} ${b.startTime || ''}`));
    }, [bookings, dayKey, showPast, loc, query, users, clientMode, todayKey]);

    const counts = useMemo(() => {
        const dayAll = bookings.filter(b => bookingDayKey(b) === dayKey);
        return {
            active: dayAll.filter(b => !PAST_STATUSES.has(b.status)).length,
            past: dayAll.filter(b => PAST_STATUSES.has(b.status)).length,
        };
    }, [bookings, dayKey]);

    return (
        // Нижний отступ — под нижнее меню, чтобы последняя бронь не уходила под него.
        <div style={{ paddingTop: 8, paddingBottom: 96, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* «+ Бронь» — в шапке, как на «Сегодня», а не плавающей кнопкой:
                при прокрутке плавающий «+» ложился на отметку «к оплате / ✓»
                справа в строке. 09.11 фаза 3: общая крупная шапка, кнопка —
                бирюзовая главная (Button primary), без чёрной «пилюли». */}
            <MobilePageHeader
                variant="large"
                className="pb-0"
                title="Все брони"
                subtitle={clientMode
                    ? `Брони клиента с сегодняшнего дня · ${dayBookings.length}`
                    : <>
                        {formatDateLabel(targetDate, { capitalize: true })}
                        {' · '}
                        {showPast
                            ? `всего ${counts.active + counts.past}`
                            : `активных ${counts.active}${counts.past > 0
                                ? ` (${counts.past} ${plural(counts.past, 'прошедшая скрыта', 'прошедшие скрыты', 'прошедших скрыто')})`
                                : ''}`}
                    </>}
                action={
                    /* 2026-06-06 owner: «+ Новая бронь» для админа. Ведёт на /m/find —
                       общий flow поиска слота; MobileCheckout сам включает выбор
                       «За кого бронируешь?» (isAdminActor). Бронь от своего имени:
                       сбрасываем «бронь за клиента». */
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

            {/* Ревью 09.11 (№16): фильтры — одной строкой «Сегодня · Все филиалы ▾»
                (шторка по нажатию), поиск остаётся. Раньше «Когда» и «Что» занимали
                больше половины экрана, и первая бронь начиналась на 490 px. */}
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {clientMode ? (
                        <Chip selected onClick={() => { setClientMode(false); setQuery(''); }} style={{ flexShrink: 0 }}>
                            Все брони клиента <X size={14} aria-hidden="true" style={{ marginLeft: 4 }} />
                        </Chip>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setFiltersOpen(true)}
                            aria-label="Фильтры: день, филиал, прошедшие"
                            className="press"
                            style={{
                                flex: 1, minWidth: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 8,
                                padding: '0 12px', borderRadius: 8, border: '1px solid var(--color-ink-10)',
                                background: 'var(--color-card)', color: 'var(--color-ink)', fontFamily: 'inherit',
                                fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                            }}
                        >
                            <SlidersHorizontal size={16} aria-hidden="true" style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {dayChipLabel(dayKey, todayKey)} · {LOC_LABEL[loc]}{showPast ? ' · с прошедшими' : ''}
                            </span>
                            <span aria-hidden="true" style={{ color: 'var(--color-ink-60)' }}>▾</span>
                        </button>
                    )}
                </div>
                <div style={{
                    display: 'flex', alignItems: 'center',
                    background: 'var(--color-sunken)', borderRadius: 8,
                    padding: '10px 12px', gap: 8, minHeight: 44,
                }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск брони"
                        placeholder="Имя, телефон, кабинет…"
                        style={{
                            flex: 1, background: 'transparent', border: 'none',
                            outline: 'none', fontSize: 16, fontFamily: 'inherit', minWidth: 0,
                            color: 'var(--color-ink)',
                        }}
                    />
                </div>
            </div>

            {/* Booking list */}
            {/* Wave 1: без «лесенки» появления — список перерисовывается при
                каждой смене дня, волна в 1,2 с мешала (правило 10).
                09.11 фаза 3: одна группа строк AdminBookingRow (как «Сегодня» и
                карточка клиента): имя переносится, а не режется до «Ната…»,
                справа ОДНА плашка, статус «Ждёт подтверждения» — словом в подписи. */}
            <div style={{ padding: '0 16px' }}>
                {dayBookings.length === 0 && (
                    <EmptyState
                        compact
                        title={clientMode ? 'Будущих броней не нашлось' : 'На этот день броней нет'}
                        hint={clientMode ? 'Снимите «Все брони клиента», чтобы искать по дням.' : 'Выберите другой день в фильтре выше.'}
                    />
                )}
                {dayBookings.length > 0 && (
                <ListGroup aria-label="Брони">
                {dayBookings.map(b => {
                    const r = RESOURCES.find(x => x.id === b.resourceId);
                    const l = LOCATIONS.find(x => x.id === r?.locationId);
                    const isBlocker = isSystemBlocker(b.userId);
                    const userName = getUserName(b.userId);
                    const isArchived = !isBlocker && !!archivedNameOf(b.userId);
                    // Завершённое/отменённое/перенесённое — это прошлое.
                    // Притушиваем визуально, чтобы активные брони выделялись.
                    const isPast = b.status === 'completed'
                        || b.status === 'cancelled'
                        || b.status === 'rescheduled'
                        || b.status === 're-rented';
                    const due = dueMap.get(b.id);
                    const owes = !!due && due.due > 0 && b.status !== 'pending_approval';
                    return (
                        <AdminBookingRow
                            key={b.id}
                            onClick={() => setSheet(b)}
                            aria-label={`${b.startTime}, ${userName}${isArchived ? ' (архив)' : ''}, ${isBlocker ? 'блок' : statusLabel('booking', b.status, 'staff')}`}
                            start={b.startTime}
                            end={endTimeOf(b.startTime, b.duration ?? 60)}
                            // Системные брони (УБОРКА…) — обычный регистр, чтобы CAPS не кричал.
                            name={isBlocker ? userName.toLowerCase() : userName}
                            blocker={isBlocker}
                            archived={isArchived}
                            subtitle={<>
                                {clientMode ? `${formatDayMonth(bookingDayKey(b))} · ` : ''}
                                {/* Куски подписи не рвутся посередине («2 / ч»): перенос — только между ними. */}
                                {[r?.name || b.resourceId, l ? shortBranch(l.name) : '', formatDuration(b.duration ?? 60)].filter(Boolean).map((part, i) => (
                                    <span key={i} style={{ whiteSpace: 'nowrap' }}>{i > 0 ? ' · ' : ''}{part}</span>
                                ))}
                            </>}
                            // Статус — словом в подписи под именем, чтобы имя не резалось (№16).
                            status={b.status}
                            // Неоплаченная прошедшая не притушивается — её надо заметить (В2).
                            dimmed={isPast && !owes}
                            owes={owes}
                            badge={isBlocker
                                ? <span className="ui-badge ui-badge--muted">Блок</span>
                                : (
                                    // G9-14: «Подтверждена» на каждой строке — шум; справа
                                    // одна метка «к оплате / ✓» (В2), статус — в подписи.
                                    <DueBadge due={due?.due} paid={!!due} charged={due?.charged} price={due?.price} className="whitespace-normal h-auto py-1 max-w-[124px] text-right" status={b.status} method={b.paymentMethod as string | undefined} />
                                )
                            }
                        />
                    );
                })}
                </ListGroup>
                )}
            </div>

            <Sheet
                open={filtersOpen}
                onClose={() => setFiltersOpen(false)}
                title="Какие брони показать"
                footer={<Button block onClick={() => setFiltersOpen(false)}>Показать · {dayBookings.length}</Button>}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <GroupLabel>Когда</GroupLabel>
                        <div role="group" aria-label="День" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {[-1, 0, 1, 2].map(off => {
                                const key = fmtDate(addDays(new Date(), off), 'yyyy-MM-dd');
                                return (
                                    <Chip key={off} selected={dayKey === key} onClick={() => setDayKey(key)}>
                                        {dayChipLabel(key, todayKey)}
                                    </Chip>
                                );
                            })}
                        </div>
                        <input
                            type="date"
                            aria-label="Другая дата"
                            value={dayKey}
                            onChange={e => e.target.value && setDayKey(e.target.value)}
                            className="tap-target"
                            style={{
                                width: '100%', marginTop: 8,
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 8,
                                padding: '0 12px',
                                fontSize: 16,
                                fontFamily: 'inherit',
                                color: 'var(--color-ink)',
                            }}
                        />
                    </div>
                    <div>
                        <GroupLabel>Филиал</GroupLabel>
                        <Segmented<LocFilter>
                            aria-label="Филиал"
                            options={(['all', 'unbox_one', 'unbox_uni'] as LocFilter[]).map(id => ({ value: id, label: LOC_LABEL[id] }))}
                            value={loc}
                            onChange={setLoc}
                        />
                    </div>
                    <label
                        style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px',
                            background: 'var(--color-ink-04)', borderRadius: 8,
                            cursor: 'pointer', fontSize: 14, fontWeight: 600,
                            color: 'var(--color-ink)',
                            minHeight: 44,
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={showPast}
                            onChange={e => setShowPast(e.target.checked)}
                            style={{ width: 20, height: 20, cursor: 'pointer', flexShrink: 0 }}
                        />
                        <span style={{ flex: 1 }}>Показать прошедшие и отменённые</span>
                        {counts.past > 0 && <span className="num" style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>{counts.past}</span>}
                    </label>
                </div>
            </Sheet>

            {/* Шторки общие с дашбордом (bookingSheets.tsx). */}
            <AdminBookingSheets
                booking={sheet}
                getUserName={email => {
                    const arch = archivedNameOf(email);
                    return arch ? `${arch} (архив)` : getAdminUserName(users, email);
                }}
                onClose={() => setSheet(null)}
                dueInfo={sheet ? dueMap.get(sheet.id) : undefined}
                acceptPayment={b => {
                    const p = acceptPaymentFor(b, bookings, users, dueMap);
                    if (!p) return null;
                    return {
                        total: p.total,
                        sub: p.today > 0
                            ? `Весь долг ${formatGel(p.total)}, из них за сегодня ${formatGel(p.today)}`
                            : `Весь долг ${formatGel(p.total)}`,
                        onClick: () => { setSheet(null); setPay(p); },
                    };
                }}
            />

            {pay && (
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

/** День брони yyyy-MM-dd (в сторе дата бывает и строкой, и Date). */
function bookingDayKey(b: BookingHistoryItem): string {
    const d = b.date as any;
    return typeof d === 'string' ? d.slice(0, 10) : fmtDate(new Date(d), 'yyyy-MM-dd');
}

/** Section label — было визуально склеено в одну стену чипов. */
function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 12, fontWeight: 600,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--color-ink-60)', marginBottom: 8,
        }}>{children}</div>
    );
}

/** Филиал по-человечески — без кодов unbox_one / unbox_uni. */
const LOC_LABEL: Record<LocFilter, string> = { all: 'Все филиалы', unbox_one: 'One', unbox_uni: 'Uni' };

/** «Сегодня» / «Завтра» / «Вчера» / «12 ноября». */
function dayChipLabel(key: string, todayKey: string): string {
    const off = Math.round((new Date(key + 'T00:00:00').getTime() - new Date(todayKey + 'T00:00:00').getTime()) / 86_400_000);
    if (off === 0) return 'Сегодня';
    if (off === 1) return 'Завтра';
    if (off === -1) return 'Вчера';
    return formatDayMonth(key);
}

/** Конец брони «HH:MM» по началу и длительности (только подпись в строке). */
function endTimeOf(start: string | null | undefined, minutes: number): string | undefined {
    const m = /^(\d{1,2}):(\d{2})/.exec(start || '');
    if (!m) return undefined;
    const total = Number(m[1]) * 60 + Number(m[2]) + minutes;
    const h = Math.floor(total / 60) % 24;
    return `${String(h).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
