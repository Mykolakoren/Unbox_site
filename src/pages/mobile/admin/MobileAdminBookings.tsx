import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Sparkles, Plus } from 'lucide-react';
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
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Chip } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { COLOR } from '../../../design/tokens';
import { formatDateLabel, formatDayMonth } from '../../../utils/format';

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
    const [query, setQuery] = useState('');
    const [sheet, setSheet] = useState<BookingHistoryItem | null>(null);
    // 2026-06-03 owner: один тоггл вместо 5-чипа статуса. По умолчанию
    // показываем только актуальные брони (confirmed + pending_approval).
    // Чекбокс «Показать прошедшие» добавляет отменённые / завершённые /
    // перенесённые / пересданные / no-show в список.
    const [showPast, setShowPast] = useState(false);
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

    const getUserName = (email: string | null | undefined) => getAdminUserName(users, email);

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
        const q = query.trim().toLowerCase();
        return bookings
            .filter(b => {
                const _d = b.date as any;
                const bDay = typeof _d === 'string'
                    ? _d.slice(0, 10)
                    : fmtDate(new Date(_d), 'yyyy-MM-dd');
                if (bDay !== dayKey) return false;
                if (!showPast && PAST_STATUSES.has(b.status)) return false;
                if (loc !== 'all' && b.locationId !== loc) return false;
                if (q) {
                    const name = getUserName(b.userId).toLowerCase();
                    const email = (b.userId || '').toLowerCase();
                    const res = (RESOURCES.find(r => r.id === b.resourceId)?.name || '').toLowerCase();
                    if (!name.includes(q) && !email.includes(q) && !res.includes(q)) return false;
                }
                return true;
            })
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    }, [bookings, dayKey, showPast, loc, query, users]);

    const counts = useMemo(() => {
        const dayAll = bookings.filter(b => {
            const _d = b.date as any;
            const bDay = typeof _d === 'string'
                ? _d.slice(0, 10)
                : fmtDate(new Date(_d), 'yyyy-MM-dd');
            return bDay === dayKey;
        });
        return {
            active: dayAll.filter(b => !PAST_STATUSES.has(b.status)).length,
            past: dayAll.filter(b => PAST_STATUSES.has(b.status)).length,
        };
    }, [bookings, dayKey]);

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, color: 'var(--color-ink)' }}>
                    Все брони
                </h1>
                {/* P0-fix: было #666 на #fff = 3.4:1 (FAIL). Теперь ink-60
                    через rgba — реальный контраст 5.4:1 (AA pass). */}
                <p style={{ fontSize: 13, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    {formatDateLabel(targetDate, { capitalize: true })}
                    {' · '}
                    {showPast
                        ? `всего ${counts.active + counts.past}`
                        : `активных ${counts.active}${counts.past > 0 ? ` (${counts.past} прошедших скрыто)` : ''}`}
                </p>
            </div>

            {/* ── КОГДА ── Day chips + date picker.
                Group label делает иерархию читаемой: было 13 чипов в один
                стек, читались как одна стена. */}
            <div style={{ padding: '0 16px' }}>
                <GroupLabel>Когда</GroupLabel>
                <div role="group" aria-label="День" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {Array.from({ length: 32 }, (_, i) => i - 1).map(off => {
                        const d = addDays(new Date(), off);
                        const key = fmtDate(d, 'yyyy-MM-dd');
                        const active = dayKey === key;
                        const label = off === 0 ? 'Сегодня'
                            : off === 1 ? 'Завтра'
                            : off === -1 ? 'Вчера'
                            : formatDayMonth(key);
                        return (
                            <Chip
                                key={off}
                                selected={active}
                                onClick={() => setDayKey(key)}
                                style={{ flexShrink: 0 }}
                            >
                                {label}
                            </Chip>
                        );
                    })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <input
                        type="date"
                        value={dayKey}
                        onChange={e => e.target.value && setDayKey(e.target.value)}
                        className="tap-target"
                        style={{
                            flex: 1,
                            background: 'var(--color-card)',
                            border: '1px solid var(--color-ink-08)',
                            borderRadius: 10,
                            padding: '0 12px',
                            fontSize: 14,
                            fontFamily: 'inherit',
                            color: 'var(--color-ink)',
                        }}
                    />
                    {dayKey !== todayKey && (
                        <button
                            onClick={() => setDayKey(todayKey)}
                            className="press tap-target"
                            style={{
                                background: 'var(--color-sunken)',
                                border: 'none',
                                borderRadius: 10,
                                padding: '0 14px',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                color: 'var(--color-ink)',
                            }}
                        >
                            Сегодня
                        </button>
                    )}
                </div>
            </div>

            {/* ── ЧТО ── Search + status + location filters */}
            <div style={{ padding: '0 16px' }}>
                <GroupLabel>Что</GroupLabel>
                <div style={{
                    display: 'flex', alignItems: 'center',
                    background: 'var(--color-sunken)', borderRadius: 12,
                    padding: '10px 12px', gap: 8, minHeight: 44,
                }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск брони"
                        placeholder="Имя, email, кабинет…"
                        style={{
                            flex: 1, background: 'transparent', border: 'none',
                            outline: 'none', fontSize: 14, fontFamily: 'inherit', minWidth: 0,
                            color: 'var(--color-ink)',
                        }}
                    />
                </div>

                <div role="group" aria-label="Филиал" style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {([
                        { id: 'all' as LocFilter, label: 'Все локации' },
                        { id: 'unbox_one' as LocFilter, label: 'Unbox One' },
                        { id: 'unbox_uni' as LocFilter, label: 'Unbox Uni' },
                    ]).map(f => (
                        <Chip key={f.id} selected={loc === f.id} onClick={() => setLoc(f.id)}>{f.label}</Chip>
                    ))}
                </div>

                {/* 2026-06-03 owner: вместо 5 чипов статуса (Все/Подтв./Ожидает/
                    Отмена/Завершено) одна понятная галочка. Default —
                    показываем только активные/подтверждённые брони,
                    отменённые и завершённые скрыты пока галочка не стоит. */}
                <label
                    style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        marginTop: 10, padding: '10px 12px',
                        background: 'var(--color-ink-04)', borderRadius: 10,
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
                    {counts.past > 0 && (
                        <span style={{
                            fontSize: 12, fontWeight: 600, color: 'var(--color-ink-60)',
                            background: 'var(--color-card)',
                            padding: '2px 8px', borderRadius: 999,
                        }}>{counts.past}</span>
                    )}
                </label>
            </div>

            {/* Booking list */}
            {/* Wave 1: без «лесенки» появления — список перерисовывается при
                каждой смене дня, волна в 1,2 с мешала (правило 10). */}
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayBookings.length === 0 && (
                    <EmptyState
                        compact
                        title="На этот день броней нет"
                        hint="Выберите соседний день в строке выше."
                    />
                )}
                {dayBookings.map(b => {
                    const r = RESOURCES.find(x => x.id === b.resourceId);
                    const l = LOCATIONS.find(x => x.id === r?.locationId);
                    const isBlocker = isSystemBlocker(b.userId);
                    const userName = getUserName(b.userId);
                    // Завершённое/отменённое/перенесённое — это прошлое.
                    // Притушиваем визуально, чтобы активные брони выделялись.
                    const isPast = b.status === 'completed'
                        || b.status === 'cancelled'
                        || b.status === 'rescheduled'
                        || b.status === 're-rented';
                    const due = dueMap.get(b.id);
                    const owes = !!due && due.due > 0;
                    return (
                        <button
                            key={b.id}
                            onClick={() => setSheet(b)}
                            aria-label={`${b.startTime}, ${userName}, ${isBlocker ? 'блок' : statusLabel('booking', b.status, 'staff')}`}
                            className="press"
                            style={{
                                background: isBlocker ? 'var(--color-sunken)' : 'var(--color-card)',
                                border: `1px solid ${isBlocker ? 'var(--color-ink-04)' : 'var(--color-ink-08)'}`,
                                borderRadius: 12, padding: '12px 14px',
                                display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10,
                                alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit',
                                textAlign: 'left', color: 'var(--color-ink)',
                                minHeight: 56,
                                // Неоплаченная прошедшая не притушивается — её надо заметить (В2).
                                opacity: isBlocker ? 0.78 : isPast && !owes ? 0.65 : 1,
                                ...(owes ? { borderColor: 'var(--status-danger-fg)', borderLeftWidth: 4 } : null),
                            }}
                        >
                            <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-ink)' }}>
                                {b.startTime}
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <div style={{
                                    fontSize: 14, fontWeight: 600,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    color: 'var(--color-ink)',
                                    display: 'flex', alignItems: 'center', gap: 5,
                                }}>
                                    {isBlocker && (
                                        <Sparkles
                                            size={13}
                                            style={{ color: 'var(--color-ink-60)', flexShrink: 0 }}
                                            aria-hidden="true"
                                        />
                                    )}
                                    <span style={{
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        // Системные брони (УБОРКА…) — обычный регистр,
                                        // чтобы CAPS не кричал в общем списке.
                                        textTransform: isBlocker ? 'capitalize' : 'none',
                                    }}>{isBlocker ? userName.toLowerCase() : userName}</span>
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2 }}>
                                    {r?.name || b.resourceId} · {l?.name || ''} · {formatDuration(b.duration ?? 60)}
                                </div>
                            </div>
                            {isBlocker
                                ? <span style={{
                                    background: 'var(--color-ink-08)',
                                    color: 'var(--color-ink-60)',
                                    fontSize: 12, fontWeight: 600,
                                    padding: '4px 9px', borderRadius: 999,
                                    whiteSpace: 'nowrap',
                                }}>Блок</span>
                                : (
                                    // G9-14: «Подтверждена» на каждой строке — шум; бейдж
                                    // статуса только у нестандартных, плюс «к оплате / ✓» (В2).
                                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                        {b.status !== 'confirmed' && <StatusBadge kind="booking" status={b.status} audience="staff" />}
                                        <DueBadge due={due?.due} paid={!!due} />
                                    </span>
                                )
                            }
                        </button>
                    );
                })}
            </div>

            {/* Шторки общие с дашбордом (bookingSheets.tsx). */}
            <AdminBookingSheets
                booking={sheet}
                getUserName={getUserName}
                onClose={() => setSheet(null)}
                acceptPayment={b => {
                    const p = acceptPaymentFor(b, bookings, users, dueMap);
                    if (!p) return null;
                    return {
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

            {/* 2026-06-06 owner: FAB «+ Новая бронь» для админа.
                Ведёт на /m/find — общий клиентский flow поиска слота, но
                MobileCheckout автоматически активирует admin user-picker
                «За кого бронируешь?» по isAdminActor-чеку (см. MobileCheckout
                lines 401-430). Минимум кода, переиспользует существующее. */}
            <Link
                to="/m/find"
                aria-label="Новая бронь"
                onClick={() => setBookingForUser(null)}
                style={{
                    position: 'fixed',
                    right: 16,
                    // Над bottom-nav (72px высота + 8px зазор + safe-area).
                    bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
                    width: 56, height: 56,
                    borderRadius: 28,
                    background: 'var(--color-ink)',
                    color: 'var(--color-on-ink)',
                    display: 'grid', placeItems: 'center',
                    boxShadow: 'var(--shadow-pop)',
                    textDecoration: 'none',
                    zIndex: 30,
                }}
            >
                <Plus size={24} strokeWidth={2.4} />
            </Link>
        </div>
    );
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

