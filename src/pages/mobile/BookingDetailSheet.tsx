import { useEffect, useState } from 'react';
import { formatChargeAt } from '../../utils/chargeTime';
import { useNavigate } from 'react-router-dom';
import { Clock, MapPin, X, Calendar, CalendarClock, Plus, AlertTriangle, Repeat, User as UserIcon, BellOff, Users, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { TrimBookingModal } from '../../components/TrimBookingModal';
import { useUserStore } from '../../store/userStore';
import { useCrmStore } from '../../store/crmStore';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { prepareRepeat } from './repeatBooking';
import { useScrollLock } from './useScrollLock';
import { priceLabel } from './priceLabel';
import { ruPlural } from '../../utils/plural';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import type { BookingHistoryItem } from '../../store/types';
import { COLOR, STATUS, Z } from '../../design/tokens';
import { formatDateLabel, formatGel } from '../../utils/format';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { Sheet } from '../../components/ui/Sheet';
import { Field as FormField, Input } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';

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
    const { confirm } = useConfirmDialog();
    // «Продлить серию»: число сессий — полем в шторке (было window.prompt).
    const [extendOpen, setExtendOpen] = useState(false);
    const [extendCount, setExtendCount] = useState('4');
    const [extendError, setExtendError] = useState<string | null>(null);

    // Lock scroll while the sheet is open — ref-counted, не залипает.
    useScrollLock();

    // Esc закрывает карточку. Если поверх открыта общая шторка или окно
    // подтверждения — Esc принадлежит им.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || document.querySelector('[data-sheet]')) return;
            onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

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
        const ok = await confirm(scope === 'tail'
            ? {
                title: 'Отменить эту и следующие брони серии?',
                body: 'Прошедшие брони серии не трогаем.',
                confirmLabel: 'Отменить эту и следующие',
                cancelLabel: 'Оставить',
                tone: 'danger',
            }
            : {
                title: 'Отменить всю серию?',
                body: 'Отменим все будущие брони серии, включая эту.',
                confirmLabel: 'Отменить всю серию',
                cancelLabel: 'Оставить',
                tone: 'danger',
            });
        if (!ok) return;
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

    function openExtendSeries() {
        setExtendCount('4');
        setExtendError(null);
        setExtendOpen(true);
    }

    async function doExtendSeries() {
        const groupId = (booking as any).recurringGroupId;
        if (!groupId) return;
        const n = parseInt(extendCount, 10);
        if (!Number.isFinite(n) || n <= 0 || n > 52) {
            setExtendError('Введите число от 1 до 52');
            return;
        }
        setExtendOpen(false);
        setBusy('extend_series');
        try {
            const res = await bookingsApi.extendRecurringSeries(groupId, n);
            await fetchBookings();
            toast.success(`Серия продлена на ${res.created} ${ruPlural(res.created, ['сессию', 'сессии', 'сессий'])} (${formatGel(res.totalCost, { sign: true, fraction: 0 })})`);
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
                ? 'Бронь на пересдаче. Если её займут, вернём 50% на баланс.'
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
                background: `${COLOR.ink}8C`,
                zIndex: Z.sheet,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Бронь"
                style={{
                    width: '100%',
                    maxWidth: 480,
                    background: COLOR.card,
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
                            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <UserIcon size={18} /> Привязать клиента
                            </h3>
                            <button
                                onClick={() => setMode('view')}
                                aria-label="Закрыть"
                                style={closeBtn}
                            >
                                <X size={22} />
                            </button>
                        </div>
                        <div style={{ fontSize: 12, color: COLOR.ink60 }}>
                            Из вашего CRM. Чтобы добавить нового клиента, откройте <a href="/crm/clients" style={{ color: COLOR.ink, textDecoration: 'underline' }}>десктопный CRM</a>.
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
                                <div style={{ background: COLOR.sunken, borderRadius: 12, padding: 16, textAlign: 'center', color: COLOR.ink60, fontSize: 13 }}>
                                    Загружаем клиентов…
                                </div>
                            )}
                        </div>
                    </>
                ) : mode === 'view' ? (
                    <>
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: COLOR.ink60 }}>
                                    {dt && formatDateLabel(dt)}
                                </div>
                                <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Clock size={18} /> {booking.startTime}{endDt && `–${formatHHMM(endDt)}`}
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                aria-label="Закрыть"
                                style={closeBtn}
                            >
                                <X size={22} />
                            </button>
                        </div>

                        {/* Status badges */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {/* Статусы брони и оплаты — слова из общего словаря (statuses.ts). */}
                            {isActive && <Tag tone="active">Идёт сейчас</Tag>}
                            {isPast && booking.status !== 'cancelled' && <StatusBadge kind="booking" status="completed" />}
                            <PaymentBadge status={booking.paymentStatus} />
                            {(booking as any).recurringGroupId && <Tag tone="muted">Серия</Tag>}
                            {booking.isReRentListed && <Tag tone="warn">На пересдаче</Tag>}
                            {booking.status === 'cancelled' && <StatusBadge kind="booking" status="cancelled" />}
                        </div>

                        {/* Place */}
                        <Field icon={<MapPin size={16} />} label="Кабинет">
                            {resource?.name ?? booking.resourceId}
                            {location && <span style={{ color: COLOR.ink60 }}> · {location.name}, {location.address}</span>}
                        </Field>

                        {/* Format + duration */}
                        <Field icon={<Calendar size={16} />} label="Формат">
                            {formatLabel(booking.format)}
                            <span style={{ color: COLOR.ink60 }}> · {formatBookingDuration(booking.duration ?? 60)}</span>
                        </Field>

                        {/* Price */}
                        <Field label="Цена" subtle>
                            <span style={{ fontSize: 17, fontWeight: 600 }}>{priceLabel(booking)}</span>
                            {booking.paymentMethod === 'balance' && booking.finalPrice != null && (
                                <span style={{ color: COLOR.ink60, marginLeft: 8, fontSize: 13 }}>с баланса</span>
                            )}
                            {booking.paymentStatus === 'pending' && dt && (
                                <div style={{ fontSize: 12, color: STATUS.pending.fg, marginTop: 4 }}>
                                    Спишется {formatChargeAt(dt)}
                                </div>
                            )}
                        </Field>

                        {/* CRM client — show current link + button to change */}
                        <Field label="CRM-клиент" subtle>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                {booking.crmClientId ? (
                                    <span style={{ color: COLOR.ink }}>
                                        {(() => {
                                            const c = crmClients.find(x => x.id === booking.crmClientId);
                                            return c?.name ?? `ID ${booking.crmClientId.slice(0, 8)}…`;
                                        })()}
                                    </span>
                                ) : (
                                    <span style={{ color: COLOR.ink60 }}>не привязан</span>
                                )}
                                <Button variant="secondary" onClick={() => setMode('pickClient')}>
                                    {booking.crmClientId ? 'Изменить' : 'Привязать'}
                                </Button>
                            </div>
                        </Field>

                        {/* Cancellation reason */}
                        {booking.cancellationReason && (
                            <Field label="Причина отмены" subtle>
                                <span style={{ color: COLOR.ink60 }}>{booking.cancellationReason}</span>
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
                                sub={`${nextWeekdayPhrase(dt)} в ${booking.startTime}`}
                                onClick={doRepeat}
                            />

                            {!isPast && booking.status !== 'cancelled' && (
                                <>
                                    <ActionRow
                                        icon={<CalendarClock size={18} />}
                                        label="Перенести"
                                        sub="Выберите новое время в «Свободно»"
                                        onClick={() => {
                                            onClose();
                                            navigate(`/m/find?reschedule=${booking.id}`);
                                        }}
                                    />

                                    {/* Пересдача — прямое действие в карточке (раньше
                                        было спрятано только в экране отмены). */}
                                    <ActionRow
                                        icon={<Users size={18} />}
                                        label={booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать'}
                                        sub={booking.isReRentListed
                                            ? 'Бронь снова станет только вашей'
                                            : 'Если её займут — вернём 50% на баланс'}
                                        busy={busy === 'rerent'}
                                        onClick={doToggleReRent}
                                    />

                                    <ActionRow
                                        danger
                                        icon={<AlertTriangle size={18} />}
                                        label="Отменить бронь"
                                        sub={within24h ? 'Меньше 24 ч до начала — без возврата (можно пересдать)' : 'Бесплатно, оплата ещё не списана'}
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
                                        fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                                        textTransform: 'uppercase', color: COLOR.ink60,
                                    }}>
                                        Управление серией
                                    </div>
                                    <ActionRow
                                        icon={<Plus size={18} />}
                                        label="Продлить серию"
                                        sub="Добавить N сессий после последней"
                                        busy={busy === 'extend_series'}
                                        onClick={openExtendSeries}
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
                            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
                                {within24h ? 'Отмена брони' : 'Точно отменить?'}
                            </h3>
                            <button
                                onClick={() => setMode('view')}
                                aria-label="Закрыть"
                                style={closeBtn}
                            >
                                <X size={22} />
                            </button>
                        </div>
                        <div style={{ fontSize: 14, color: COLOR.ink80 }}>
                            {dt && formatDateLabel(dt, { capitalize: true })} в {booking.startTime} — {resource?.name}
                        </div>
                        {within24h ? (
                            <>
                                <div style={{ fontSize: 13, background: STATUS.danger.bg, color: STATUS.danger.fg, padding: 12, borderRadius: 10 }}>
                                    Сумма не подлежит возврату — до брони осталось менее 24 часов.
                                </div>
                                <div style={{ fontSize: 13, color: COLOR.ink80, padding: '0 2px' }}>
                                    Можно <b>пересдать кабинет</b> — если его займёт другой специалист, вернём <b>50% на баланс</b>.
                                </div>
                                <div style={{ fontSize: 12, color: COLOR.ink60, padding: '0 2px' }}>
                                    Если ситуация форс-мажорная — напишите администратору.
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <Button
                                        variant={booking.isReRentListed ? 'secondary' : 'primary'}
                                        block
                                        onClick={doToggleReRent}
                                        disabled={busy !== null && busy !== 'rerent'}
                                        loading={busy === 'rerent'}
                                    >
                                        {booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать'}
                                    </Button>
                                    <div style={{ display: 'flex', gap: 10 }}>
                                        <Button
                                            variant="secondary"
                                            block
                                            onClick={() => setMode('view')}
                                            disabled={busy !== null}
                                        >
                                            Оставить
                                        </Button>
                                        <Button
                                            variant="danger"
                                            block
                                            onClick={doCancel}
                                            disabled={busy !== null && busy !== 'cancel'}
                                            loading={busy === 'cancel'}
                                        >
                                            {busy === 'cancel' ? 'Отменяем…' : 'Всё равно отменить'}
                                        </Button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ fontSize: 13, color: COLOR.ink60 }}>
                                    Оплата ещё не списана — отмена бесплатна.
                                </div>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <Button
                                        variant="secondary"
                                        block
                                        onClick={() => setMode('view')}
                                        disabled={busy === 'cancel'}
                                    >
                                        Оставить
                                    </Button>
                                    <Button
                                        variant="danger"
                                        block
                                        onClick={doCancel}
                                        loading={busy === 'cancel'}
                                    >
                                        {busy === 'cancel' ? 'Отменяем…' : 'Отменить бронь'}
                                    </Button>
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
        <Sheet
            open={extendOpen}
            onClose={() => setExtendOpen(false)}
            title="Продлить серию"
            description="Новые брони встанут после последней в серии, в то же время."
            layer="dialog"
            width={420}
            footer={
                <>
                    <Button block onClick={() => { void doExtendSeries(); }}>
                        Продлить серию
                    </Button>
                    <Button variant="secondary" block onClick={() => setExtendOpen(false)}>
                        Не сейчас
                    </Button>
                </>
            }
        >
            <FormField label="Сколько сессий добавить" hint="От 1 до 52" error={extendError ?? undefined}>
                <Input
                    kind="integer"
                    value={extendCount}
                    onChange={e => { setExtendCount(e.target.value.replace(/\D/g, '')); setExtendError(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void doExtendSeries(); } }}
                />
            </FormField>
        </Sheet>
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
                background: active ? COLOR.ink : COLOR.card,
                color: active ? COLOR.onInk : COLOR.ink,
                border: active ? 'none' : `1px solid ${COLOR.ink10}`,
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
                <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                {sub && <div style={{ fontSize: 12, color: active ? COLOR.onInk : COLOR.ink60, opacity: active ? 0.8 : 1, marginTop: 1 }}>{sub}</div>}
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
            background: subtle ? 'transparent' : COLOR.sunken,
            borderRadius: 10,
            padding: subtle ? '4px 0' : 12,
        }}>
            <div style={{
                fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: COLOR.ink60,
                display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 4,
            }}>
                {icon} {label}
            </div>
            <div style={{ fontSize: 14, color: COLOR.ink }}>
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
    const bg = primary ? COLOR.ink : danger ? STATUS.danger.bg : COLOR.card;
    const fg = primary ? COLOR.onInk : danger ? STATUS.danger.fg : COLOR.ink;
    const border = primary ? 'none' : `1px solid ${danger ? `${STATUS.danger.fg}33` : COLOR.ink10}`;
    // Подпись без прозрачности: на красном фоне opacity .7 давала 3.2:1.
    const subColor = primary ? COLOR.onInk : danger ? STATUS.danger.fg : COLOR.ink60;

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
                <div style={{ fontSize: 14, fontWeight: 600 }}>{busy ? 'Секунду…' : label}</div>
                {sub && <div style={{ fontSize: 12, color: subColor, opacity: primary ? 0.8 : 1, marginTop: 2 }}>{sub}</div>}
            </div>
            {external && <ArrowUpRight size={16} aria-hidden="true" style={{ opacity: 0.7 }} />}
        </button>
    );
}

/** Статус оплаты — слова и цвета только из общего словаря (statuses.ts). */
function PaymentBadge({ status }: { status?: 'pending' | 'paid' | 'waived' | null }) {
    if (!status) return null;
    return <StatusBadge kind="payment" status={status} />;
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'warn' | 'muted' | 'active' }) {
    const colors: Record<string, { bg: string; fg: string }> = {
        warn: { bg: STATUS.pending.bg, fg: STATUS.pending.fg },
        muted: { bg: STATUS.muted.bg, fg: STATUS.muted.fg },
        active: { bg: COLOR.ink, fg: COLOR.onInk },
    };
    const c = colors[tone];
    return (
        <span style={{
            background: c.bg, color: c.fg,
            fontSize: 12, fontWeight: 600,
            padding: '3px 8px', borderRadius: 999,
            whiteSpace: 'nowrap',
        }}>{children}</span>
    );
}

/** Крестик 44×44 — цель касания; видимый значок прежний. */
const closeBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', color: COLOR.ink60,
    width: 44, height: 44, margin: -10, padding: 0, flexShrink: 0,
    display: 'grid', placeItems: 'center',
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

/** «В следующий вторник» / «В следующую среду» / «В следующее воскресенье».
 *  Раньше писали «На следующий среда» — без падежа и рода. */
function nextWeekdayPhrase(d: Date | null): string {
    if (!d) return 'Через неделю';
    const phrases = [
        'В следующее воскресенье', 'В следующий понедельник', 'В следующий вторник',
        'В следующую среду', 'В следующий четверг', 'В следующую пятницу', 'В следующую субботу',
    ];
    return phrases[d.getDay()];
}

function formatLabel(f: string | undefined): string {
    if (f === 'group') return 'Групповой';
    if (f === 'intervision') return 'Интервизия';
    return 'Индивидуальный';
}

/** "T-24h" — booking start minus 24 hours, formatted human-readably. */
