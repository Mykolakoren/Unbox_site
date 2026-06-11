import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Check, X, Clock, AlertTriangle, Loader2, Sparkles, CalendarClock, Repeat, DollarSign, Plus } from 'lucide-react';
import { addDays, format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { bookingsApi } from '../../../api/bookings';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import type { BookingHistoryItem } from '../../../store/types';

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
    const navigate = useNavigate();
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
    const [busy, setBusy] = useState<string | null>(null);
    const [sheet, setSheet] = useState<BookingHistoryItem | null>(null);
    // 2026-06-03 owner: один тоггл вместо 5-чипа статуса. По умолчанию
    // показываем только актуальные брони (confirmed + pending_approval).
    // Чекбокс «Показать прошедшие» добавляет отменённые / завершённые /
    // перенесённые / пересданные / no-show в список.
    const [showPast, setShowPast] = useState(false);

    useEffect(() => {
        fetchAllBookings();
        if (!users || users.length === 0) fetchUsers();
    }, []);

    const targetDate = useMemo(() => {
        const d = new Date(dayKey + 'T00:00:00');
        return Number.isFinite(d.getTime()) ? d : new Date();
    }, [dayKey]);
    const todayKey = useMemo(() => fmtDate(new Date(), 'yyyy-MM-dd'), []);

    const getUserName = (email: string | null | undefined) => {
        if (!email) return 'Гость';
        const u = users.find(u => u.email === email || u.id === email);
        if (u?.name) return u.name;
        if (email.includes('@')) return email.split('@')[0];
        return email.slice(0, 12) || 'Гость';
    };

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
        if (m === 30) return `${h}.5 ч`;
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

    const doCancel = async (b: BookingHistoryItem) => {
        // Refund-aware cancel — раньше mobile только звал «отменить» c
        // дефолтным 100% возвратом (= политика «бесплатной отмены»).
        // Десктоп даёт админу выбор. Симметрия.
        const fullRefund = window.confirm(
            `Отменить бронь ${b.startTime} · ${getUserName(b.userId)}?\n\n` +
            'OK = вернуть 100% (бесплатная отмена)\n' +
            'Отмена = выбрать другой процент возврата'
        );
        let refundPercent = 100;
        let reason = '';
        if (!fullRefund) {
            const choice = window.prompt(
                'Процент возврата клиенту: 100, 50 или 0\n' +
                '(100 = полный возврат, 50 = частичный, 0 = без возврата — например прогул)',
                '50',
            );
            if (choice === null) return;
            const parsed = parseInt(choice.trim(), 10);
            if (![100, 50, 0].includes(parsed)) {
                toast.error('Нужно 100, 50 или 0');
                return;
            }
            refundPercent = parsed;
            const r = window.prompt('Причина (видна в истории брони):', '');
            if (r === null) return; // юзер передумал
            reason = r.trim();
            if (refundPercent !== 100 && !reason) {
                toast.error('Для частичного возврата нужна причина');
                return;
            }
        }
        setBusy(b.id);
        try {
            await bookingsApi.cancelBooking(b.id, { refundPercent, reason: reason || undefined });
            await fetchAllBookings();
            toast.success(
                refundPercent === 100 ? 'Отменена (полный возврат)'
                : refundPercent === 50 ? 'Отменена (возврат 50%)'
                : 'Отменена (без возврата)'
            );
            setSheet(null);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось отменить');
        } finally {
            setBusy(null);
        }
    };

    const doEditPrice = async (b: BookingHistoryItem) => {
        const current = b.finalPrice ?? 0;
        const raw = window.prompt(
            `Новая цена в ₾ (текущая: ${current.toFixed(0)}):`,
            String(current),
        );
        if (raw === null) return;
        const num = parseFloat(raw.trim());
        if (!Number.isFinite(num) || num < 0) {
            toast.error('Нужно положительное число');
            return;
        }
        if (num === current) return; // ничего не меняется
        const reason = window.prompt('Причина изменения цены:', '');
        if (reason === null) return;
        setBusy(b.id);
        try {
            await bookingsApi.setPrice(b.id, num, reason.trim() || undefined);
            await fetchAllBookings();
            toast.success(`Цена обновлена: ${current.toFixed(0)} → ${num.toFixed(0)} ₾`);
            setSheet(null);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось изменить цену');
        } finally {
            setBusy(null);
        }
    };

    const doApprove = async (b: BookingHistoryItem) => {
        setBusy(b.id);
        try {
            await bookingsApi.approveBooking(b.id);
            await fetchAllBookings();
            toast.success('Одобрено');
            setSheet(null);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось одобрить');
        } finally {
            setBusy(null);
        }
    };

    const doReschedule = (b: BookingHistoryItem) => {
        setSheet(null);
        navigate(`/m/find?reschedule=${b.id}`);
    };

    const doToggleReRent = async (b: BookingHistoryItem) => {
        setBusy(b.id);
        try {
            const updated = await bookingsApi.toggleReRent(b.id);
            await fetchAllBookings();
            toast.success(updated.isReRentListed
                ? 'Выставлено на переаренду'
                : 'Снято с переаренды');
            setSheet(null);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось обновить статус');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--color-ink)' }}>
                    Все брони
                </h1>
                {/* P0-fix: было #666 на #fff = 3.4:1 (FAIL). Теперь ink-60
                    через rgba — реальный контраст 5.4:1 (AA pass). */}
                <p style={{ fontSize: 13, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    {fmtDate(targetDate, 'EEEE, d MMMM', { locale: ru })}
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
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {Array.from({ length: 32 }, (_, i) => i - 1).map(off => {
                        const d = addDays(new Date(), off);
                        const key = fmtDate(d, 'yyyy-MM-dd');
                        const active = dayKey === key;
                        const label = off === 0 ? 'Сегодня'
                            : off === 1 ? 'Завтра'
                            : off === -1 ? 'Вчера'
                            : fmtDate(d, 'd MMM', { locale: ru });
                        return (
                            <button
                                key={off}
                                onClick={() => setDayKey(key)}
                                className="press tap-target"
                                style={{
                                    flexShrink: 0,
                                    padding: '0 14px',
                                    background: active ? 'var(--color-ink)' : 'var(--color-surface)',
                                    color: active ? 'var(--color-paper)' : 'var(--color-ink)',
                                    border: 'none',
                                    borderRadius: 999,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    fontFamily: 'inherit',
                                }}
                            >
                                {label}
                            </button>
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
                            background: 'var(--color-paper)',
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
                                background: 'var(--color-surface)',
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
                    background: 'var(--color-surface)', borderRadius: 12,
                    padding: '10px 12px', gap: 8, minHeight: 44,
                }}>
                    <Search size={16} color="var(--color-ink-40)" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Имя, email, кабинет…"
                        style={{
                            flex: 1, background: 'transparent', border: 'none',
                            outline: 'none', fontSize: 14, fontFamily: 'inherit', minWidth: 0,
                            color: 'var(--color-ink)',
                        }}
                    />
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    {([
                        { id: 'all' as LocFilter, label: 'Все локации' },
                        { id: 'unbox_one' as LocFilter, label: 'Unbox One' },
                        { id: 'unbox_uni' as LocFilter, label: 'Unbox Uni' },
                    ]).map(f => (
                        <Chip key={f.id} active={loc === f.id} onClick={() => setLoc(f.id)} label={f.label} />
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
                            fontSize: 12, fontWeight: 700, color: 'var(--color-ink-60)',
                            background: 'var(--color-paper)',
                            padding: '2px 8px', borderRadius: 999,
                        }}>{counts.past}</span>
                    )}
                </label>
            </div>

            {/* Booking list */}
            <div className="stagger-in" style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayBookings.length === 0 && (
                    <div style={{
                        background: 'var(--color-surface)', borderRadius: 12,
                        padding: 32, textAlign: 'center', color: 'var(--color-ink-60)', fontSize: 14,
                        lineHeight: 1.5,
                    }}>
                        На этот день броней нет.<br/>
                        <span style={{ fontSize: 12, color: 'var(--color-ink-40)' }}>
                            Попробуй соседние дни в строке выше.
                        </span>
                    </div>
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
                    return (
                        <button
                            key={b.id}
                            onClick={() => setSheet(b)}
                            className="press"
                            style={{
                                background: isBlocker ? 'var(--color-surface)' : 'var(--color-paper)',
                                border: `1px solid ${isBlocker ? 'var(--color-ink-04)' : 'var(--color-ink-08)'}`,
                                borderRadius: 12, padding: '12px 14px',
                                display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10,
                                alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit',
                                textAlign: 'left', color: 'var(--color-ink)',
                                minHeight: 56,
                                opacity: isBlocker ? 0.78 : isPast ? 0.65 : 1,
                            }}
                        >
                            <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--color-ink)' }}>
                                {b.startTime}
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <div style={{
                                    fontSize: 14, fontWeight: 700,
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
                                    fontSize: 11, fontWeight: 700,
                                    padding: '4px 9px', borderRadius: 999,
                                    whiteSpace: 'nowrap',
                                }}>Блок</span>
                                : <StatusBadge status={b.status} />
                            }
                        </button>
                    );
                })}
            </div>

            {sheet && (
                <ActionSheet
                    booking={sheet}
                    userName={getUserName(sheet.userId)}
                    resourceName={RESOURCES.find(r => r.id === sheet.resourceId)?.name || sheet.resourceId || ''}
                    busy={busy === sheet.id}
                    onClose={() => setSheet(null)}
                    onCancel={() => doCancel(sheet)}
                    onApprove={() => doApprove(sheet)}
                    onReschedule={() => doReschedule(sheet)}
                    onToggleReRent={() => doToggleReRent(sheet)}
                    onEditPrice={() => doEditPrice(sheet)}
                    onOpenUser={() => navigate(`/m/admin/users/${encodeURIComponent(sheet.userId)}`)}
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
                style={{
                    position: 'fixed',
                    right: 16,
                    // Над bottom-nav (72px высота + 8px зазор + safe-area).
                    bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
                    width: 56, height: 56,
                    borderRadius: 28,
                    background: '#0E0E0E',
                    color: '#fff',
                    display: 'grid', placeItems: 'center',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
                    textDecoration: 'none',
                    zIndex: 30,
                }}
            >
                <Plus size={24} strokeWidth={2.4} />
            </Link>
        </div>
    );
}

/** Standalone duration formatter (используется ActionSheet — он отдельный
 *  компонент за пределами замыкания родителя). */
function formatDurationStandalone(min: number): string {
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (m === 0) return `${h} ч`;
    if (m === 30) return `${h}.5 ч`;
    return `${h} ч ${m} мин`;
}

/** Section label — было визуально склеено в одну стену чипов. */
function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--color-ink-40)', marginBottom: 8,
        }}>{children}</div>
    );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className="press tap-target"
            style={{
                flexShrink: 0,
                padding: '0 14px',
                background: active ? 'var(--color-ink)' : 'var(--color-ink-04)',
                color: active ? 'var(--color-paper)' : 'var(--color-ink)',
                border: 'none', borderRadius: 999,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                whiteSpace: 'nowrap', fontFamily: 'inherit',
            }}
        >
            {label}
        </button>
    );
}

/** Унифицированный StatusBadge.
 *  Было: 'OK'/'ждёт'/'отм'/'✓'/'пересд'/'no-show'/'перенос' — 7 разных
 *  стилей в одном компоненте, сканируемость нулевая.
 *  Стало: полные слова, один регистр, один источник цвета (CSS-токены). */
/** Status pill — это INFO, не ACTION. Полные слова в прошедшем времени
 *  (была отменена, была завершена), без × и других action-иконок.
 *  «Cancelled» раньше выглядел как красная кнопка-CTA — путал админов
 *  (owner 2026-06-02). */
function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { bgVar: string; fgVar: string; label: string; icon?: any }> = {
        // Активные/будущие — выраженный цвет, иконка ок (это операционный state)
        confirmed:        { bgVar: '--status-ok-bg',      fgVar: '--status-ok-fg',      label: 'Подтверждена', icon: Check },
        pending_approval: { bgVar: '--status-pending-bg', fgVar: '--status-pending-fg', label: 'Ожидает',      icon: Clock },

        // Завершённые/неактивные — мутный тон, без иконок. Они в прошлом,
        // не должны кричать.
        completed:        { bgVar: '--status-muted-bg',   fgVar: '--status-muted-fg',   label: 'Завершена' },
        cancelled:        { bgVar: '--status-muted-bg',   fgVar: '--status-danger-fg',  label: 'Отменена' },
        're-rented':      { bgVar: '--status-muted-bg',   fgVar: '--status-info-fg',    label: 'Пересдана' },
        rescheduled:      { bgVar: '--status-muted-bg',   fgVar: '--status-muted-fg',   label: 'Перенесена' },
        // No-show — единственный «прошедший» статус с тревожным тоном,
        // потому что это требует реакции админа (списать как штраф?).
        no_show:          { bgVar: '--status-warn-bg',    fgVar: '--status-warn-fg',    label: 'Не пришёл',    icon: AlertTriangle },
    };
    const s = map[status] || { bgVar: '--status-muted-bg', fgVar: '--status-muted-fg', label: status };
    const Icon = s.icon;
    return (
        <span style={{
            background: `var(${s.bgVar})`,
            color: `var(${s.fgVar})`,
            fontSize: 11, fontWeight: 700,
            padding: '4px 9px', borderRadius: 999,
            whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
            {Icon && <Icon size={11} aria-hidden="true" />}
            {s.label}
        </span>
    );
}

function ActionSheet({
    booking, userName, resourceName, busy, onClose, onCancel, onApprove, onReschedule, onToggleReRent, onEditPrice, onOpenUser,
}: {
    booking: BookingHistoryItem;
    userName: string;
    resourceName: string;
    busy: boolean;
    onClose: () => void;
    onCancel: () => void;
    onApprove: () => void;
    onReschedule: () => void;
    onToggleReRent: () => void;
    onEditPrice: () => void;
    onOpenUser: () => void;
}) {
    const canCancel = booking.status === 'confirmed' || booking.status === 'pending_approval';
    const canApprove = booking.status === 'pending_approval';
    // Reschedule / re-rent — только для активных будущих броней.
    // Прошедшие/отменённые не имеет смысла переносить.
    const isActive = booking.status === 'confirmed' || booking.status === 'pending_approval';
    const isFuture = (() => {
        try {
            const d = new Date(booking.date as any);
            const [h, m] = (booking.startTime || '00:00').split(':').map(Number);
            d.setHours(h, m, 0, 0);
            return d.getTime() > Date.now();
        } catch { return false; }
    })();
    const canReschedule = isActive && isFuture;
    const canReRent = isActive && isFuture;
    const isReRented = (booking as any).isReRentListed === true;
    return (
        <div
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(14,14,14,0.55)', zIndex: 200,
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 480, background: 'var(--color-paper)',
                    borderRadius: '20px 20px 0 0',
                    padding: 20,
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
                    display: 'flex', flexDirection: 'column', gap: 14,
                }}
            >
                <div>
                    <div style={{
                        fontSize: 11, fontWeight: 700, color: 'var(--color-ink-40)',
                        letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}>
                        {fmtDate(new Date(booking.date as any), 'd MMMM', { locale: ru })} · {booking.startTime}
                    </div>
                    <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, color: 'var(--color-ink)' }}>
                        {userName}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-ink-60)', marginTop: 4 }}>
                        {resourceName} · {formatDurationStandalone(booking.duration ?? 60)}
                        {booking.finalPrice > 0 && ` · ${booking.finalPrice} ₾`}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {canApprove && (
                        <ActionRow
                            label="Одобрить бронь"
                            tone="ok"
                            icon={<Check size={18} />}
                            busy={busy}
                            onClick={onApprove}
                        />
                    )}
                    {canReschedule && (
                        <ActionRow
                            label="Перенести бронь"
                            sub="Выбрать новый слот"
                            icon={<CalendarClock size={18} />}
                            onClick={onReschedule}
                        />
                    )}
                    {canReRent && (
                        <ActionRow
                            label={isReRented ? 'Снять с переаренды' : 'Выставить на переаренду'}
                            sub={isReRented
                                ? 'Бронь снова станет личной'
                                : 'Если кто-то заберёт — 50% вернётся клиенту'}
                            tone={isReRented ? 'ok' : undefined}
                            icon={<Repeat size={18} />}
                            busy={busy}
                            onClick={onToggleReRent}
                        />
                    )}
                    {isActive && (
                        <ActionRow
                            label="Изменить цену"
                            sub={`Текущая: ${(booking.finalPrice ?? 0).toFixed(0)} ₾`}
                            icon={<DollarSign size={18} />}
                            busy={busy}
                            onClick={onEditPrice}
                        />
                    )}
                    <ActionRow
                        label="Открыть карточку клиента"
                        icon={<Search size={18} />}
                        onClick={onOpenUser}
                    />
                    {canCancel && (
                        <ActionRow
                            label="Отменить бронь"
                            tone="danger"
                            icon={<X size={18} />}
                            busy={busy}
                            onClick={onCancel}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function ActionRow({
    label, sub, icon, tone, busy, onClick,
}: { label: string; sub?: string; icon: React.ReactNode; tone?: 'ok' | 'danger'; busy?: boolean; onClick: () => void }) {
    const bgVar = tone === 'danger' ? '--status-danger-bg'
        : tone === 'ok' ? '--status-ok-bg'
        : '--color-surface';
    const fgVar = tone === 'danger' ? '--status-danger-solid'
        : tone === 'ok' ? '--status-ok-fg'
        : '--color-ink';
    return (
        <button
            onClick={onClick}
            disabled={busy}
            aria-busy={busy || undefined}
            className="press"
            style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: `var(${bgVar})`,
                color: `var(${fgVar})`,
                border: 'none', borderRadius: 12,
                padding: '12px 16px', fontFamily: 'inherit',
                fontSize: 15, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.6 : 1, textAlign: 'left',
                minHeight: 52,
            }}
        >
            {busy ? <Loader2 size={18} className="animate-spin-fast" style={{ flexShrink: 0 }} /> : <span style={{ flexShrink: 0 }}>{icon}</span>}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span>{label}</span>
                {sub && <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>{sub}</span>}
            </span>
        </button>
    );
}
