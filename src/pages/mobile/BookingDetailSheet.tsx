import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, MapPin, X, Calendar, Plus, AlertTriangle, Smartphone, Repeat, User as UserIcon, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { TrimBookingModal } from '../../components/TrimBookingModal';
import { useUserStore } from '../../store/userStore';
import { useCrmStore } from '../../store/crmStore';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { prepareRepeat } from './repeatBooking';
import { priceLabel } from './priceLabel';
import { ruPlural } from '../../utils/plural';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import type { BookingHistoryItem } from '../../store/types';

/**
 * Bottom-sheet with full booking detail + actions.
 *
 * Two-step UX: viewing detail vs. confirming cancel — second step is in
 * the same sheet (just swaps content) so users keep the spatial context.
 *
 * Actions wired:
 *   - Cancel  : full implementation, calls bookingsApi.cancelBooking
 *   - Extend  : +30 min, only when booking is currently active and route
 *               accepts (server returns 400 if next slot is busy)
 *   - Reschedule / link CRM client : pointer to desktop for now (Phase 2)
 */
export function BookingDetailSheet({ booking, onClose }: {
    booking: BookingHistoryItem;
    onClose: () => void;
}) {
    const { fetchBookings } = useUserStore();
    const navigate = useNavigate();
    const [mode, setMode] = useState<'view' | 'confirmCancel' | 'pickClient'>('view');
    const [trimming, setTrimming] = useState(false);
    const [busy, setBusy] = useState<'cancel' | 'extend' | 'rerent' | 'link' | 'cancel_tail' | 'cancel_all_future' | 'extend_series' | 'dismiss_series_reminder' | null>(null);
    const { clients: crmClients, fetchClients: fetchCrmClients } = useCrmStore();

    // Lock scroll while the sheet is open. Реальный скролл — в
    // <main data-mobile-scroll>, поэтому одного body.overflow мало;
    // класс scroll-locked лочит и контейнер прокрутки (см. index.css).
    useEffect(() => {
        document.body.classList.add('scroll-locked');
        return () => { document.body.classList.remove('scroll-locked'); };
    }, []);

    useEffect(() => {
        // Lazy-load CRM clients only when the user opens the picker. Avoids
        // hammering /crm/clients every time someone opens a detail sheet.
        if (mode === 'pickClient' && crmClients.length === 0) {
            fetchCrmClients(true).catch(() => {});
        }
    }, [mode, crmClients.length, fetchCrmClients]);

    async function doLinkClient(crmClientId: string | null) {
        setBusy('link');
        try {
            await bookingsApi.linkCrmClient(booking.id, crmClientId);
            await fetchBookings();
            toast.success(crmClientId ? 'Клиент привязан к броне' : 'Привязка клиента снята');
            setMode('view');
        } catch (e: any) {
            const msg = e?.response?.data?.detail ?? e?.message ?? 'Не удалось обновить';
            toast.error(typeof msg === 'string' ? msg : 'Не удалось обновить');
        } finally { setBusy(null); }
    }

    const dt = bookingStartDate(booking);
    const endDt = dt ? new Date(dt.getTime() + (booking.duration ?? 60) * 60000) : null;
    const now = new Date();
    const hoursToStart = dt ? (dt.getTime() - now.getTime()) / 3600000 : 999;
    const within24h = hoursToStart >= 0 && hoursToStart < 24;
    const isActive = dt && endDt && dt.getTime() <= now.getTime() && endDt.getTime() > now.getTime();
    const isPast = dt && endDt && endDt.getTime() <= now.getTime();

    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const location = LOCATIONS.find(l => l.id === resource?.locationId);

    async function doCancel() {
        setBusy('cancel');
        try {
            await bookingsApi.cancelBooking(booking.id);
            await fetchBookings();
            toast.success('Бронь отменена');
            onClose();
        } catch (e: any) {
            const msg = e?.response?.data?.detail ?? e?.message ?? 'Не удалось отменить';
            toast.error(typeof msg === 'string' ? msg : 'Не удалось отменить');
        } finally { setBusy(null); }
    }

    async function doExtend() {
        setBusy('extend');
        try {
            await bookingsApi.extendBooking(booking.id, 30);
            await fetchBookings();
            toast.success('Сессия продлена на 30 минут');
        } catch (e: any) {
            const msg = e?.response?.data?.detail ?? e?.message ?? 'Не удалось продлить';
            toast.error(typeof msg === 'string' ? msg : 'Не удалось продлить');
        } finally { setBusy(null); }
    }

    /** Repeat this booking on the next same weekday at the same time/cabinet. */
    function doRepeat() {
        if (!prepareRepeat(booking)) return;
        onClose();
        navigate('/m/checkout');
    }

    async function doCancelSeries(scope: 'tail' | 'all_future') {
        const groupId = (booking as any).recurringGroupId;
        if (!groupId) return;
        const confirmMsg = scope === 'tail'
            ? `Отменить эту бронь и все последующие в серии?`
            : `Отменить все будущие брони серии (включая эту)?`;
        if (!window.confirm(confirmMsg)) return;
        setBusy(scope === 'tail' ? 'cancel_tail' : 'cancel_all_future');
        try {
            const res = await bookingsApi.cancelRecurringSeries(
                groupId,
                scope === 'tail' ? booking.id : undefined,
            );
            await fetchBookings();
            toast.success(`Отменено ${res.cancelled} ${ruPlural(res.cancelled, ['бронь', 'брони', 'бронь'])}`);
            onClose();
        } catch (e: any) {
            const msg = e?.response?.data?.detail ?? e?.message ?? 'Не удалось отменить серию';
            toast.error(typeof msg === 'string' ? msg : 'Не удалось отменить серию');
        } finally { setBusy(null); }
    }

    async function doDismissSeriesReminder() {
        const groupId = (booking as any).recurringGroupId;
        if (!groupId) return;
        setBusy('dismiss_series_reminder');
        try {
            await bookingsApi.dismissSeriesEndReminder(groupId);
            toast.success('Серия завершится в срок — больше не напомним');
            onClose();
        } catch (e: any) {
            const msg = e?.response?.data?.detail ?? e?.message ?? 'Не удалось сохранить';
            toast.error(typeof msg === 'string' ? msg : 'Не удалось сохранить');
        } finally { setBusy(null); }
    }

    async function doExtendSeries() {
        const groupId = (booking as any).recurringGroupId;
        if (!groupId) return;
        const ans = window.prompt('Добавить ещё сколько сессий в серию?', '4');
        if (!ans) return;
        const n = parseInt(ans, 10);
        if (!Number.isFinite(n) || n <= 0 || n > 52) {
            toast.error('Введи число от 1 до 52');
            return;
        }
        setBusy('extend_series');
        try {
            const res = await bookingsApi.extendRecurringSeries(groupId, n);
            await fetchBookings();
            toast.success(`Серия продлена на ${res.created} ${ruPlural(res.created, ['сессию', 'сессии', 'сессий'])} (+${res.totalCost.toFixed(0)} ₾)`);
            onClose();
        } catch (e: any) {
            const msg = e?.response?.data?.detail ?? e?.message ?? 'Не удалось продлить';
            toast.error(typeof msg === 'string' ? msg : 'Не удалось продлить');
        } finally { setBusy(null); }
    }

    async function doToggleReRent() {
        setBusy('rerent');
        try {
            const updated = await bookingsApi.toggleReRent(booking.id);
            await fetchBookings();
            toast.success(updated.isReRentListed
                ? 'Бронь выставлена на пересдачу. Другой специалист сможет её занять — получишь 50% на баланс.'
                : 'Снято с пересдачи');
            onClose();
        } catch (e: any) {
            const msg = e?.response?.data?.detail ?? e?.message ?? 'Не удалось обновить';
            toast.error(typeof msg === 'string' ? msg : 'Не удалось обновить');
        } finally { setBusy(null); }
    }

    return (
        <>
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.55)',
                zIndex: 200,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%',
                    maxWidth: 480,
                    background: '#fff',
                    borderRadius: '20px 20px 0 0',
                    padding: 20,
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    maxHeight: '85vh',
                    overflow: 'auto',
                    overscrollBehavior: 'contain',
                }}
            >
                {mode === 'pickClient' ? (
                    /* Pick CRM client mode */
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <UserIcon size={18} /> Привязать клиента
                            </h3>
                            <button
                                onClick={() => setMode('view')}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 0 }}
                            >
                                <X size={22} />
                            </button>
                        </div>
                        <div style={{ fontSize: 12, color: '#666' }}>
                            Из твоего CRM. Чтобы добавить нового клиента — открой <a href="/crm/clients" style={{ color: '#0E0E0E', textDecoration: 'underline' }}>десктопный CRM</a>.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflow: 'auto' }}>
                            <ClientPickRow
                                active={!booking.crmClientId}
                                disabled={busy === 'link'}
                                onClick={() => doLinkClient(null)}
                                title="Без привязки"
                                sub="Снять текущую"
                            />
                            {crmClients.map(c => (
                                <ClientPickRow
                                    key={c.id}
                                    active={booking.crmClientId === c.id}
                                    disabled={busy === 'link'}
                                    onClick={() => doLinkClient(c.id)}
                                    title={c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                                    sub={c.phone || c.email}
                                />
                            ))}
                            {crmClients.length === 0 && (
                                <div style={{ background: '#F4F4F2', borderRadius: 12, padding: 16, textAlign: 'center', color: '#666', fontSize: 13 }}>
                                    Загружаю клиентов…
                                </div>
                            )}
                        </div>
                    </>
                ) : mode === 'view' ? (
                    <>
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#999' }}>
                                    {dt && dt.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
                                </div>
                                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Clock size={18} /> {booking.startTime}{endDt && `–${formatHHMM(endDt)}`}
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 4 }}
                            >
                                <X size={22} />
                            </button>
                        </div>

                        {/* Status badges */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {isActive && <Tag tone="active">Идёт сейчас</Tag>}
                            {isPast && <Tag tone="muted">Прошла</Tag>}
                            <PaymentBadge status={booking.paymentStatus} />
                            {(booking as any).recurringGroupId && <Tag tone="muted">Серия</Tag>}
                            {booking.isReRentListed && <Tag tone="warn">На пересдаче</Tag>}
                            {booking.status === 'cancelled' && <Tag tone="danger">Отменена</Tag>}
                        </div>

                        {/* Place */}
                        <Field icon={<MapPin size={16} />} label="Кабинет">
                            {resource?.name ?? booking.resourceId}
                            {location && <span style={{ color: '#999' }}> · {location.name}, {location.address}</span>}
                        </Field>

                        {/* Format + duration */}
                        <Field icon={<Calendar size={16} />} label="Формат">
                            {formatLabel(booking.format)}
                            <span style={{ color: '#999' }}> · {formatBookingDuration(booking.duration ?? 60)}</span>
                        </Field>

                        {/* Price */}
                        <Field label="Цена" subtle>
                            <span style={{ fontSize: 17, fontWeight: 700 }}>{priceLabel(booking)}</span>
                            {booking.paymentMethod === 'balance' && booking.finalPrice != null && (
                                <span style={{ color: '#999', marginLeft: 8, fontSize: 13 }}>с баланса</span>
                            )}
                            {booking.paymentStatus === 'pending' && dt && (
                                <div style={{ fontSize: 12, color: '#8A5A00', marginTop: 4 }}>
                                    Спишется {formatChargeAt(dt)}
                                </div>
                            )}
                        </Field>

                        {/* CRM client — show current link + button to change */}
                        <Field label="CRM-клиент" subtle>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                {booking.crmClientId ? (
                                    <span style={{ color: '#0E0E0E' }}>
                                        {(() => {
                                            const c = crmClients.find(x => x.id === booking.crmClientId);
                                            return c?.name ?? `ID ${booking.crmClientId.slice(0, 8)}…`;
                                        })()}
                                    </span>
                                ) : (
                                    <span style={{ color: '#999' }}>не привязан</span>
                                )}
                                <button
                                    onClick={() => setMode('pickClient')}
                                    style={{
                                        background: 'transparent',
                                        border: '1px solid rgba(0,0,0,0.15)',
                                        borderRadius: 6,
                                        padding: '3px 8px',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: '#0E0E0E',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    {booking.crmClientId ? 'Изменить' : 'Привязать'}
                                </button>
                            </div>
                        </Field>

                        {/* Cancellation reason */}
                        {booking.cancellationReason && (
                            <Field label="Причина отмены" subtle>
                                <span style={{ color: '#666' }}>{booking.cancellationReason}</span>
                            </Field>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                            {!isPast && booking.status !== 'cancelled' && isActive && (
                                <ActionRow
                                    primary
                                    icon={<Plus size={18} />}
                                    label="Продлить +30 минут"
                                    sub="Если следующий слот свободен"
                                    busy={busy === 'extend'}
                                    onClick={doExtend}
                                />
                            )}

                            {/* Repeat — works for past and future. Pre-fills the
                                checkout with this booking's slot on the next
                                same weekday. */}
                            <ActionRow
                                primary={!!isPast}
                                icon={<Repeat size={18} />}
                                label="Повторить"
                                sub={`На следующий ${weekdayName(dt)} в ${booking.startTime}`}
                                onClick={doRepeat}
                            />

                            {!isPast && booking.status !== 'cancelled' && (
                                <>
                                    <ActionRow
                                        icon={<Smartphone size={18} />}
                                        label="Перенести"
                                        sub="Выбери новое время в «Свободно»"
                                        onClick={() => {
                                            onClose();
                                            navigate(`/m/find?reschedule=${booking.id}`);
                                        }}
                                    />

                                    <ActionRow
                                        danger
                                        icon={<AlertTriangle size={18} />}
                                        label="Отменить бронь"
                                        sub={within24h ? 'Менее 24ч — без возврата (можно пересдать)' : 'Бесплатно, оплата ещё не списана'}
                                        onClick={() => setMode('confirmCancel')}
                                    />

                                    {(booking.duration ?? 60) >= 120 && !booking.isReRentListed && (
                                        <ActionRow
                                            danger
                                            icon={<AlertTriangle size={18} />}
                                            label="Отменить часть"
                                            sub="Убрать часть брони, остальное оставить"
                                            onClick={() => setTrimming(true)}
                                        />
                                    )}
                                </>
                            )}

                            {/* Series actions — only when this booking is part of a recurring series. */}
                            {(booking as any).recurringGroupId && !isPast && booking.status !== 'cancelled' && (
                                <>
                                    <div style={{
                                        marginTop: 6,
                                        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                                        textTransform: 'uppercase', color: '#999',
                                    }}>
                                        Управление серией
                                    </div>
                                    <ActionRow
                                        icon={<Plus size={18} />}
                                        label="Продлить серию"
                                        sub="Добавить N сессий после последней"
                                        busy={busy === 'extend_series'}
                                        onClick={doExtendSeries}
                                    />
                                    <ActionRow
                                        icon={<BellOff size={18} />}
                                        label="ОК, завершится в срок"
                                        sub="Не присылать больше напоминаний"
                                        busy={busy === 'dismiss_series_reminder'}
                                        onClick={doDismissSeriesReminder}
                                    />
                                    <ActionRow
                                        danger
                                        icon={<AlertTriangle size={18} />}
                                        label="Отменить эту и последующие"
                                        sub="Прошедшие сессии серии не трогаем"
                                        busy={busy === 'cancel_tail'}
                                        onClick={() => doCancelSeries('tail')}
                                    />
                                    <ActionRow
                                        danger
                                        icon={<AlertTriangle size={18} />}
                                        label="Отменить всю серию"
                                        sub="Все будущие сессии"
                                        busy={busy === 'cancel_all_future'}
                                        onClick={() => doCancelSeries('all_future')}
                                    />
                                </>
                            )}
                        </div>
                    </>
                ) : (
                    /* Confirm cancel mode */
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                                {within24h ? 'Отмена брони' : 'Точно отменить?'}
                            </h3>
                            <button
                                onClick={() => setMode('view')}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 0 }}
                            >
                                <X size={22} />
                            </button>
                        </div>
                        <div style={{ fontSize: 14, color: '#444' }}>
                            {dt && dt.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })} в {booking.startTime} — {resource?.name}
                        </div>
                        {within24h ? (
                            <>
                                <div style={{ fontSize: 13, background: '#FEF2F2', color: '#991B1B', padding: 12, borderRadius: 10 }}>
                                    Сумма не подлежит возврату — до брони осталось менее 24 часов.
                                </div>
                                <div style={{ fontSize: 13, color: '#444', padding: '0 2px' }}>
                                    Можно <b>выставить кабинет на пересдачу</b> — если его займёт другой специалист, тебе вернётся <b>50% на баланс</b>.
                                </div>
                                <div style={{ fontSize: 12, color: '#666', padding: '0 2px' }}>
                                    Если ситуация форс-мажорная — напиши администратору.
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <button
                                        onClick={doToggleReRent}
                                        disabled={busy !== null}
                                        style={{
                                            padding: 14,
                                            background: booking.isReRentListed ? '#fff' : '#0E0E0E',
                                            color: booking.isReRentListed ? '#0E0E0E' : '#fff',
                                            border: booking.isReRentListed ? '1px solid #0E0E0E' : 'none',
                                            borderRadius: 12,
                                            fontSize: 15,
                                            fontWeight: 700,
                                            cursor: busy === 'rerent' ? 'wait' : 'pointer',
                                            fontFamily: 'inherit',
                                            opacity: busy === 'rerent' ? 0.7 : 1,
                                        }}
                                    >
                                        {busy === 'rerent'
                                            ? 'Подожди…'
                                            : booking.isReRentListed
                                                ? 'Снять с пересдачи'
                                                : 'Выставить на пересдачу'}
                                    </button>
                                    <div style={{ display: 'flex', gap: 10 }}>
                                        <button
                                            onClick={() => setMode('view')}
                                            disabled={busy !== null}
                                            style={btnSecondary}
                                        >
                                            Назад
                                        </button>
                                        <button
                                            onClick={doCancel}
                                            disabled={busy !== null}
                                            style={{
                                                ...btnDanger,
                                                cursor: busy === 'cancel' ? 'wait' : 'pointer',
                                                opacity: busy === 'cancel' ? 0.7 : 1,
                                            }}
                                        >
                                            {busy === 'cancel' ? 'Отменяю…' : 'Всё равно отменить'}
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ fontSize: 13, color: '#666' }}>
                                    Оплата ещё не списана — отмена бесплатна.
                                </div>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <button
                                        onClick={() => setMode('view')}
                                        disabled={busy === 'cancel'}
                                        style={btnSecondary}
                                    >
                                        Назад
                                    </button>
                                    <button
                                        onClick={doCancel}
                                        disabled={busy === 'cancel'}
                                        style={{
                                            ...btnDanger,
                                            cursor: busy === 'cancel' ? 'wait' : 'pointer',
                                            opacity: busy === 'cancel' ? 0.7 : 1,
                                        }}
                                    >
                                        {busy === 'cancel' ? 'Отменяю…' : 'Отменить бронь'}
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
        {trimming && (
            <TrimBookingModal
                booking={{
                    id: booking.id,
                    startTime: booking.startTime!,
                    duration: booking.duration ?? 60,
                    date: booking.date as any,
                }}
                onClose={() => setTrimming(false)}
                onDone={() => { fetchBookings(); }}
            />
        )}
        </>
    );
}

function ClientPickRow({ active, disabled, onClick, title, sub }: {
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
    title: string;
    sub?: string;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            style={{
                width: '100%',
                background: active ? '#0E0E0E' : '#fff',
                color: active ? '#fff' : '#0E0E0E',
                border: active ? 'none' : '1px solid rgba(0,0,0,0.10)',
                borderRadius: 10,
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: disabled ? 'wait' : 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                opacity: disabled ? 0.6 : 1,
            }}
        >
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
                {sub && <div style={{ fontSize: 11, opacity: active ? 0.8 : 0.55, marginTop: 1 }}>{sub}</div>}
            </div>
        </button>
    );
}

function Field({ icon, label, subtle, children }: {
    icon?: React.ReactNode;
    label: string;
    subtle?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div style={{
            background: subtle ? 'transparent' : '#F4F4F2',
            borderRadius: 10,
            padding: subtle ? '4px 0' : 12,
        }}>
            <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: '#999',
                display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 4,
            }}>
                {icon} {label}
            </div>
            <div style={{ fontSize: 14, color: '#0E0E0E' }}>
                {children}
            </div>
        </div>
    );
}

function ActionRow({ icon, label, sub, primary, danger, external, busy, onClick }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    primary?: boolean;
    danger?: boolean;
    external?: boolean;
    busy?: boolean;
    onClick: () => void;
}) {
    const bg = primary ? '#0E0E0E' : danger ? '#FEF2F2' : '#fff';
    const fg = primary ? '#fff' : danger ? '#C8253A' : '#0E0E0E';
    const border = primary ? 'none' : `1px solid ${danger ? '#FCA5A5' : 'rgba(0,0,0,0.10)'}`;

    return (
        <button
            onClick={onClick}
            disabled={busy}
            style={{
                background: bg, color: fg, border,
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex', alignItems: 'center', gap: 12,
                cursor: busy ? 'wait' : 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                opacity: busy ? 0.7 : 1,
            }}
        >
            <span>{icon}</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{busy ? 'Подожди…' : label}</div>
                {sub && <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{sub}</div>}
            </div>
            {external && <span style={{ fontSize: 11, opacity: 0.6 }}>↗</span>}
        </button>
    );
}

function PaymentBadge({ status }: { status?: 'pending' | 'paid' | 'waived' | null }) {
    if (status === 'paid') return <Tag tone="ok">Оплачено</Tag>;
    if (status === 'pending') return <Tag tone="warn">Не списано</Tag>;
    if (status === 'waived') return <Tag tone="muted">Без счёта</Tag>;
    return null;
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'ok' | 'warn' | 'muted' | 'danger' | 'active' }) {
    const colors: Record<string, { bg: string; fg: string }> = {
        ok: { bg: '#E6F4EA', fg: '#1B6E36' },
        warn: { bg: '#FEF3C7', fg: '#8A5A00' },
        muted: { bg: '#EEE', fg: '#666' },
        danger: { bg: '#FEF2F2', fg: '#991B1B' },
        active: { bg: '#0E0E0E', fg: '#fff' },
    };
    const c = colors[tone];
    return (
        <span style={{
            background: c.bg, color: c.fg,
            fontSize: 11, fontWeight: 700,
            padding: '3px 8px', borderRadius: 999,
            whiteSpace: 'nowrap',
        }}>{children}</span>
    );
}

const btnSecondary: React.CSSProperties = {
    flex: 1, padding: 14,
    background: '#F4F4F2', color: '#0E0E0E',
    border: 'none', borderRadius: 12,
    fontSize: 15, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
};

const btnDanger: React.CSSProperties = {
    flex: 1, padding: 14,
    background: '#C8253A', color: '#fff',
    border: 'none', borderRadius: 12,
    fontSize: 15, fontWeight: 700,
    fontFamily: 'inherit',
};

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

function weekdayName(d: Date | null): string {
    if (!d) return 'день';
    const long = d.toLocaleDateString('ru-RU', { weekday: 'long' });
    return long.toLowerCase();
}

function formatLabel(f: string | undefined): string {
    if (f === 'group') return 'Групповой';
    if (f === 'intervision') return 'Интервизия';
    return 'Индивидуальный';
}

/** "T-24h" — booking start minus 24 hours, formatted human-readably. */
function formatChargeAt(start: Date): string {
    const charge = new Date(start.getTime() - 24 * 3600 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
    const dayAfter = new Date(today.getTime() + 48 * 3600 * 1000);
    const dCharge = new Date(charge);
    dCharge.setHours(0, 0, 0, 0);

    if (charge.getTime() <= Date.now()) return `совсем скоро`;
    if (dCharge.getTime() === today.getTime()) return `сегодня в ${formatHHMM(charge)}`;
    if (dCharge.getTime() === tomorrow.getTime()) return `завтра в ${formatHHMM(charge)}`;
    if (dCharge.getTime() === dayAfter.getTime()) return `послезавтра в ${formatHHMM(charge)}`;
    return charge.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ` в ${formatHHMM(charge)}`;
}
