import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, AlertTriangle, CheckCircle, Calendar, X, Loader2, Trash2, Clock, ArrowRight, Users as UsersIcon, ShieldCheck, BookOpen, DoorOpen, Plus } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { bookingsApi } from '../../../api/bookings';
import type { BookingHistoryItem } from '../../../store/types';
import { RESOURCES } from '../../../utils/data';
import { formatBookingDuration } from '../../../utils/bookingHelpers';

/**
 * Mobile admin dashboard — quick numbers for "what's happening today" plus
 * a count of hot-bookings waiting for approval.
 *
 * Counts are derived from already-loaded bookings (no extra API hits) for
 * snappy UX. The pending-approval count is a separate fetch since those
 * rows live in their own endpoint slice.
 */
export function MobileAdminDashboard() {
    const { bookings, fetchBookings } = useUserStore();
    const [pendingApprovals, setPendingApprovals] = useState<BookingHistoryItem[] | null>(null);
    // Owner asked 2026-05-25: today's booking list was inert. Tapping a row
    // now opens a bottom sheet with admin actions (cancel, +30, set price,
    // see breakdown). Implemented inline so it shares dashboard's already-
    // loaded bookings array — no extra fetch.
    const [activeBooking, setActiveBooking] = useState<BookingHistoryItem | null>(null);
    // Owner 2026-06-02: «и ещё 20…» под списком был просто текстом, не
    // открывался. Делаю expand-toggle: тап → раскрывает остальные брони
    // (чтобы можно было быстро тапнуть, например, 19:00 без перехода
    // на /m/admin/bookings).
    const [todayExpanded, setTodayExpanded] = useState(false);

    useEffect(() => {
        fetchBookings();
        bookingsApi.getPendingApprovals().then(setPendingApprovals).catch(() => setPendingApprovals([]));
    }, [fetchBookings]);

    const today = useMemo(() => {
        const todayKey = fmtDate(new Date(), 'yyyy-MM-dd');
        return bookings.filter(b =>
            b.status === 'confirmed' && b.date && fmtDate(new Date(b.date as any), 'yyyy-MM-dd') === todayKey
        );
    }, [bookings]);

    const tomorrow = useMemo(() => {
        const t = new Date();
        t.setDate(t.getDate() + 1);
        const tomKey = fmtDate(t, 'yyyy-MM-dd');
        return bookings.filter(b =>
            b.status === 'confirmed' && b.date && fmtDate(new Date(b.date as any), 'yyyy-MM-dd') === tomKey
        );
    }, [bookings]);

    return (
        <div style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Дашборд
                </h1>
                <p style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                    {fmtDate(new Date(), 'EEEE, d MMMM', { locale: ru })}
                </p>
            </div>

            {/* Pending approvals — most urgent */}
            {pendingApprovals && pendingApprovals.length > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <Link
                        to="/m/admin/inbox"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            background: '#FEF2F2',
                            border: '1px solid #FCA5A5',
                            borderRadius: 14,
                            padding: '14px 16px',
                            color: '#991B1B',
                            textDecoration: 'none',
                        }}
                    >
                        <AlertTriangle size={20} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>
                                Hot-booking на одобрении
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                                Ждут вашей реакции — {pendingApprovals.length} шт.
                            </div>
                        </div>
                        <span style={{
                            background: '#991B1B',
                            color: '#fff',
                            fontSize: 13,
                            fontWeight: 800,
                            padding: '4px 10px',
                            borderRadius: 999,
                            minWidth: 28,
                            textAlign: 'center',
                        }}>{pendingApprovals.length}</span>
                    </Link>
                </div>
            )}

            {/* Today / tomorrow numbers — owner 2026-06-02: каждая метрика
                кликабельна, ведёт в /m/admin/bookings с предзаполненным
                фильтром (день и/или статус). Раньше карточки были немыми
                и админ не понимал куда дальше идти. */}
            <div style={{ padding: '0 16px' }}>
                <SectionTitle>Активность</SectionTitle>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                }}>
                    <Stat
                        icon={<Calendar size={16} />}
                        label="Сегодня бронь"
                        value={today.length}
                        to="/m/admin/bookings"
                    />
                    <Stat
                        icon={<Calendar size={16} />}
                        label="Завтра бронь"
                        value={tomorrow.length}
                        to="/m/admin/bookings?day=tomorrow"
                    />
                    <Stat
                        icon={<CheckCircle size={16} />}
                        label="Hold pending"
                        value={pendingApprovals?.length ?? '…'}
                        to="/m/admin/inbox"
                    />
                    <Stat
                        icon={<Inbox size={16} />}
                        label="Все брони в системе"
                        value={bookings.length}
                        to="/m/admin/bookings"
                    />
                </div>
            </div>

            {/* Today list — at-a-glance who's where */}
            <div style={{ padding: '0 16px' }}>
                <SectionTitle>Сегодня · {today.length}</SectionTitle>
                {today.length === 0 ? (
                    <div style={{
                        background: '#F4F4F2',
                        borderRadius: 14,
                        padding: 18,
                        textAlign: 'center',
                        color: '#666',
                        fontSize: 14,
                    }}>
                        Сегодня пока пусто.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {today
                            .slice()
                            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
                            .slice(0, todayExpanded ? today.length : 8)
                            .map(b => (
                                <button
                                    key={b.id}
                                    onClick={() => setActiveBooking(b)}
                                    style={{
                                        background: '#fff',
                                        border: '1px solid rgba(0,0,0,0.08)',
                                        borderRadius: 10,
                                        padding: '8px 12px',
                                        display: 'flex',
                                        gap: 10,
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        textAlign: 'left',
                                        width: '100%',
                                    }}
                                >
                                    <div style={{ fontSize: 13, fontWeight: 700, minWidth: 50 }}>
                                        {b.startTime}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.25 }}>
                                            {RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#666', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {b.userId}
                                        </div>
                                    </div>
                                    <ArrowRight size={14} style={{ color: '#bbb', flexShrink: 0 }} />
                                </button>
                            ))}
                        {today.length > 8 && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                <button
                                    onClick={() => setTodayExpanded(v => !v)}
                                    style={{
                                        flex: 1,
                                        background: '#F4F4F2', color: '#0E0E0E',
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        borderRadius: 10,
                                        padding: '8px 10px',
                                        fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {todayExpanded
                                        ? 'Свернуть'
                                        : `Показать ещё ${today.length - 8}`}
                                </button>
                                <Link
                                    to="/m/admin/bookings"
                                    style={{
                                        flex: 1,
                                        background: '#0E0E0E', color: '#fff',
                                        border: 'none', borderRadius: 10,
                                        padding: '8px 10px',
                                        fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                                        cursor: 'pointer',
                                        textAlign: 'center', textDecoration: 'none',
                                        lineHeight: 1.4,
                                    }}
                                >
                                    Открыть все →
                                </Link>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Quick links to admin sub-screens that don't fit the bottom
                nav (6 tabs is already cramped). Owner 2026-05-26: surface
                Команда / Специалисты / БЗ here so admins find them without
                falling back to desktop. */}
            <div style={{ padding: '8px 16px 0' }}>
                <SectionTitle>Управление</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <QuickLink to="/m/admin/cabinets" icon={DoorOpen} label="Кабинеты" />
                    <QuickLink to="/m/admin/team" icon={UsersIcon} label="Команда" />
                    <QuickLink to="/m/admin/specialists" icon={ShieldCheck} label="Специал." />
                    <QuickLink to="/m/admin/kb" icon={BookOpen} label="База знаний" />
                </div>
            </div>

            {activeBooking && (
                <BookingActionSheet
                    booking={activeBooking}
                    onClose={() => setActiveBooking(null)}
                    onChanged={async () => {
                        await fetchBookings();
                        setActiveBooking(null);
                    }}
                />
            )}

            {/* 2026-06-06 owner: тот же FAB что и на /m/admin/bookings — для
                консистентности «создать бронь» доступно с любого админ-
                экрана, не только из списка броней. */}
            <Link
                to="/m/find"
                aria-label="Новая бронь"
                style={{
                    position: 'fixed',
                    right: 16,
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

function QuickLink({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
        <Link
            to={to}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '14px 8px',
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 11,
                color: '#0E0E0E',
                textDecoration: 'none',
                fontSize: 11,
                fontWeight: 600,
            }}
        >
            <Icon size={18} style={{ color: '#1B7430' }} />
            <span>{label}</span>
        </Link>
    );
}

// ── Admin booking action sheet ──────────────────────────────────────────────
// Bottom sheet shown when admin taps a today/tomorrow booking row. Surfaces
// the same actions desktop admins have on the chessboard popup (cancel, +30,
// set price, reschedule), plus the discount/applied-rule breakdown so the
// admin can answer "why does this say 18 ₾ not 20?" without leaving the page.
function BookingActionSheet({
    booking, onClose, onChanged,
}: {
    booking: BookingHistoryItem;
    onClose: () => void;
    onChanged: () => Promise<void>;
}) {
    const [busy, setBusy] = useState<null | 'cancel' | 'extend' | 'price' | 'reschedule'>(null);
    const [priceInput, setPriceInput] = useState<string>('');
    const [showPriceForm, setShowPriceForm] = useState(false);
    const [rescheduleDate, setRescheduleDate] = useState('');
    const [rescheduleTime, setRescheduleTime] = useState(booking.startTime || '');
    const [showRescheduleForm, setShowRescheduleForm] = useState(false);

    const resource = RESOURCES.find(r => r.id === booking.resourceId);

    const handleCancel = async () => {
        if (!confirm('Отменить бронь? Деньги вернутся на баланс юзера.')) return;
        setBusy('cancel');
        try {
            await bookingsApi.cancelBooking(booking.id);
            toast.success('Бронь отменена');
            await onChanged();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось отменить');
        } finally {
            setBusy(null);
        }
    };

    const handleExtend = async () => {
        setBusy('extend');
        try {
            await bookingsApi.extendBooking(booking.id, 30);
            toast.success('Бронь продлена на 30 минут');
            await onChanged();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось продлить — возможно, следующий слот занят');
        } finally {
            setBusy(null);
        }
    };

    const handleSetPrice = async () => {
        const n = parseFloat(priceInput);
        if (Number.isNaN(n) || n < 0) {
            toast.error('Введите неотрицательное число');
            return;
        }
        setBusy('price');
        try {
            await bookingsApi.setPrice(booking.id, n);
            toast.success(`Цена обновлена: ${n} ₾`);
            await onChanged();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось изменить цену');
        } finally {
            setBusy(null);
        }
    };

    const handleReschedule = async () => {
        if (!rescheduleDate || !rescheduleTime) {
            toast.error('Дата и время обязательны');
            return;
        }
        setBusy('reschedule');
        try {
            await bookingsApi.rescheduleBooking(booking.id, {
                newDate: rescheduleDate,
                newStartTime: rescheduleTime,
            });
            toast.success('Бронь перенесена');
            await onChanged();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось перенести');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div onClick={onClose} style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 200,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
                background: '#fff',
                borderTopLeftRadius: 18, borderTopRightRadius: 18,
                padding: '14px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
                boxShadow: '0 -8px 24px rgba(0,0,0,0.18)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>
                            {resource?.name || booking.resourceId}
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                            {booking.userId}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888' }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Inline details */}
                <div style={{
                    background: '#F6F6F4', borderRadius: 10, padding: '10px 12px',
                    fontSize: 13, marginBottom: 14, lineHeight: 1.6,
                }}>
                    <Row label="Дата" value={fmtDate(new Date(booking.date as any), 'd MMMM yyyy', { locale: ru })} />
                    <Row label="Время" value={`${booking.startTime} · ${formatBookingDuration(booking.duration ?? 60)}`} />
                    {booking.appliedRule && booking.appliedRule !== 'NONE' && booking.appliedRule !== 'SUBSCRIPTION'
                     && (booking.discountPercent || booking.discountAmount) ? (
                        <>
                            <Row label="Цена" value={`${booking.finalPrice} ₾ (база ${booking.basePrice ?? booking.finalPrice} − ${booking.discountAmount?.toFixed(0) ?? 0})`} />
                            <Row label="Скидка" value={`${discountLabel(booking.appliedRule)} · −${booking.discountPercent ?? 0}%`} />
                        </>
                    ) : (
                        <Row label="Цена" value={`${booking.finalPrice} ₾${booking.appliedRule === 'SUBSCRIPTION' ? ' (по абонементу)' : ''}`} />
                    )}
                    <Row label="Статус" value={booking.status === 'confirmed' ? '✅ Активно' : booking.status} />
                </div>

                {/* Reschedule inline form */}
                {showRescheduleForm && (
                    <div style={{ marginBottom: 12, padding: 12, background: '#EFF6FF', borderRadius: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#1E40AF', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Перенос
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                            <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} style={inputStyle} />
                            <input type="time" value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)} step={1800} style={inputStyle} />
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setShowRescheduleForm(false)} style={secondaryBtn}>Отмена</button>
                            <button onClick={handleReschedule} disabled={busy !== null} style={primaryBtn}>
                                {busy === 'reschedule' ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
                                Перенести
                            </button>
                        </div>
                    </div>
                )}

                {/* Price inline form */}
                {showPriceForm && (
                    <div style={{ marginBottom: 12, padding: 12, background: '#FEF3C7', borderRadius: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Новая цена (₾)
                        </div>
                        <input
                            type="number" inputMode="decimal" min={0}
                            value={priceInput} onChange={e => setPriceInput(e.target.value)}
                            placeholder={String(booking.finalPrice ?? 0)}
                            style={{ ...inputStyle, marginBottom: 8 }}
                            autoFocus
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setShowPriceForm(false)} style={secondaryBtn}>Отмена</button>
                            <button onClick={handleSetPrice} disabled={busy !== null} style={primaryBtn}>
                                {busy === 'price' ? <Loader2 size={14} className="animate-spin" /> : null}
                                Сохранить
                            </button>
                        </div>
                    </div>
                )}

                {/* Actions */}
                {booking.status === 'confirmed' && !showRescheduleForm && !showPriceForm && (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                            <button onClick={() => setShowRescheduleForm(true)} style={actionBtn('#EFF6FF', '#1E40AF')}>
                                <Clock size={14} /> Перенести
                            </button>
                            <button onClick={handleExtend} disabled={busy !== null} style={actionBtn('#ECFDF5', '#065F46')}>
                                {busy === 'extend' ? <Loader2 size={14} className="animate-spin" /> : null}
                                +30 мин
                            </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <button onClick={() => { setPriceInput(String(booking.finalPrice ?? 0)); setShowPriceForm(true); }} style={actionBtn('#FEF3C7', '#92400E')}>
                                Цена
                            </button>
                            <button onClick={handleCancel} disabled={busy !== null} style={actionBtn('#FEE2E2', '#991B1B')}>
                                {busy === 'cancel' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                Удалить
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: '#888' }}>{label}</span>
            <span style={{ color: '#0E0E0E', textAlign: 'right' }}>{value}</span>
        </div>
    );
}

function discountLabel(rule: string | undefined | null): string {
    switch (rule) {
        case 'PERSONAL_DISCOUNT':     return 'Личная скидка';
        case 'WEEKLY_PROGRESSIVE':    return 'Недельная (накопленные часы)';
        case 'CONSECUTIVE_HOURS':     return 'За длительность брони';
        case 'MANUAL_OVERRIDE':       return 'Ручная корректировка';
        case 'SUBSCRIPTION':          return 'Абонемент';
        case 'SUBSCRIPTION_DISCOUNT': return 'Скидка по абонементу';
        case 'HOT_BOOKING':           return 'Горячая бронь';
        default:                      return rule || '';
    }
}

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8,
    fontSize: 14, background: '#fff', color: '#0E0E0E', outline: 'none',
};

const primaryBtn: React.CSSProperties = {
    flex: 1, padding: '10px',
    background: '#0E0E0E', color: '#fff',
    border: 'none', borderRadius: 8,
    fontWeight: 700, fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
};

const secondaryBtn: React.CSSProperties = {
    flex: 1, padding: '10px',
    background: 'rgba(0,0,0,0.05)', color: '#0E0E0E',
    border: 'none', borderRadius: 8,
    fontWeight: 600, fontSize: 13, cursor: 'pointer',
};

const actionBtn = (bg: string, fg: string): React.CSSProperties => ({
    padding: '11px 8px',
    background: bg, color: fg,
    border: 'none', borderRadius: 9,
    fontWeight: 700, fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
});

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: '#999',
            marginBottom: 8,
        }}>{children}</div>
    );
}

function Stat({ icon, label, value, to }: { icon: React.ReactNode; label: string; value: number | string; to?: string }) {
    const inner = (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-ink-60)' }}>
                {icon}
                <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
            </div>
            <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 6,
            }}>
                <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: 'var(--color-ink)' }}>
                    {value}
                </span>
                {to && <ArrowRight size={14} style={{ color: 'var(--color-ink-40)', flexShrink: 0 }} />}
            </div>
        </>
    );
    const baseStyle: React.CSSProperties = {
        background: 'var(--color-paper)',
        border: '1px solid var(--color-ink-08)',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        color: 'var(--color-ink)',
        textDecoration: 'none',
        fontFamily: 'inherit',
        textAlign: 'left',
    };
    if (to) {
        return <Link to={to} className="press" style={baseStyle}>{inner}</Link>;
    }
    return <div style={baseStyle}>{inner}</div>;
}
