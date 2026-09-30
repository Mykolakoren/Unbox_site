import { useEffect, useState } from 'react';
import { formatChargeAt } from '../../utils/chargeTime';
import { useNavigate } from 'react-router-dom';
import { MapPin, Wallet, CalendarClock, Plus, AlertTriangle, Repeat, BellOff, Users, ArrowUpRight, MessageCircle, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { TrimBookingModal } from '../../components/TrimBookingModal';
import { useUserStore } from '../../store/userStore';
import { useCrmStore } from '../../store/crmStore';
import { prepareRepeat } from './repeatBooking';
import { priceLabel } from './priceLabel';
import { ruPlural } from '../../utils/plural';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import type { BookingHistoryItem } from '../../store/types';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';
import { formatDateLabel, formatGel } from '../../utils/format';
import { toastApiError } from '../../utils/errors';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { Sheet } from '../../components/ui/Sheet';
import { Field as FormField, Input } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { canUsePsyCrm, isBookingAdmin } from './crmAccess';
import { lateRescheduleLabel, lateRescheduleLeft } from '../../utils/subscription';
import { bookingEndDate, bookingPlace, bookingStartDate, bookingTimeRange, mapsUrl } from './bookingView';

const ADMIN_TG_URL = 'https://t.me/UnboxCenter';

/**
 * Шторка брони: подробности и действия (волна 2 — на общем Sheet).
 *
 * Общий Sheet даёт выезд снизу, свайп вниз, Esc, фокус внутри и крестик
 * 44 px (G4-13, X5-15). Второй шаг «Точно отменить?» и выбор CRM-клиента —
 * в той же шторке, контекст не теряется.
 *
 * Правило 24 часов (X3-21, G4-client-mobile-M2) — как на сервере:
 * клиент и специалист меньше чем за сутки до начала бронь не отменяют и не
 * переносят (routes.py → 400). Поэтому им в этом случае показываем только
 * «Пересдать» и «Написать администратору». Администраторам (owner /
 * senior_admin / admin — те же роли, что ADMIN_ROLES на сервере) — всё, как
 * раньше, включая «Всё равно отменить».
 *
 * Порядок действий у будущей брони (G4-14): Перенести → Пересдать →
 * Отменить; «Повторить» — ниже, второстепенным.
 */
export function BookingDetailSheet({ booking, onClose }: {
    booking: BookingHistoryItem;
    onClose: () => void;
}) {
    const { fetchBookings, currentUser } = useUserStore();
    const navigate = useNavigate();
    const [mode, setMode] = useState<'view' | 'confirmCancel' | 'pickClient'>('view');
    const [trimming, setTrimming] = useState(false);
    const [busy, setBusy] = useState<'cancel' | 'extend' | 'rerent' | 'link' | 'cancel_tail' | 'cancel_all_future' | 'extend_series' | 'dismiss_series_reminder' | null>(null);
    const { clients: crmClients, fetchClients: fetchCrmClients } = useCrmStore();
    const { confirm } = useConfirmDialog();
    // «Продлить серию»: число броней — полем в шторке (было window.prompt).
    const [extendOpen, setExtendOpen] = useState(false);
    const [extendCount, setExtendCount] = useState('4');
    const [extendError, setExtendError] = useState<string | null>(null);

    // Поле «CRM-клиент» — только тем, у кого есть Psy-CRM (G4-14): клиент
    // видел «Привязать CRM-клиента» и не понимал, что это.
    const showCrm = canUsePsyCrm(currentUser);
    const isAdmin = isBookingAdmin(currentUser);

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
            toastApiError(e, 'Не удалось обновить');
        } finally { setBusy(null); }
    }

    const dt = bookingStartDate(booking);
    const endDt = dt ? bookingEndDate(booking, dt) : null;
    const now = new Date();
    const hoursToStart = dt ? (dt.getTime() - now.getTime()) / 3600000 : 999;
    const within24h = hoursToStart >= 0 && hoursToStart < 24;
    const isActive = dt && endDt && dt.getTime() <= now.getTime() && endDt.getTime() > now.getTime();
    const isPast = dt && endDt && endDt.getTime() <= now.getTime();
    const isLive = !isPast && booking.status !== 'cancelled';
    // Клиенту меньше чем за сутки сервер не даст ни отменить, ни перенести.
    const lateForClient = within24h && !isAdmin;
    // …кроме бесплатного переноса по абонементу (владелец 01.10: Тёплый 1,
    // Регулярный 2, Профи+ 3; не позже чем за 3 ч до начала).
    const lateLeft = lateForClient && booking.status === 'confirmed'
        ? lateRescheduleLeft(currentUser?.subscription, hoursToStart)
        : 0;
    // Пересдать можно только подтверждённую бронь (сервер: status == confirmed).
    const canReRent = isLive && booking.status === 'confirmed';

    const place = bookingPlace(booking);
    const route = mapsUrl(place.location);

    async function doCancel() {
        setBusy('cancel');
        try {
            await bookingsApi.cancelBooking(booking.id);
            await fetchBookings();
            toast.success('Бронь отменена');
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось отменить');
        } finally { setBusy(null); }
    }

    async function doExtend() {
        setBusy('extend');
        try {
            await bookingsApi.extendBooking(booking.id, 30);
            await fetchBookings();
            toast.success('Бронь продлена на 30 минут');
        } catch (e: any) {
            toastApiError(e, 'Не удалось продлить');
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
            toast.success(`Отменено ${res.cancelled} ${ruPlural(res.cancelled, ['бронь', 'брони', 'броней'])}`);
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось отменить серию');
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
            toastApiError(e, 'Не удалось сохранить');
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
            toast.success(`Серия продлена на ${res.created} ${ruPlural(res.created, ['бронь', 'брони', 'броней'])} (${formatGel(res.totalCost, { sign: true, fraction: 0 })})`);
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось продлить');
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
            toastApiError(e, 'Не удалось обновить');
        } finally { setBusy(null); }
    }

    // Подсказка к «Отменить бронь» — от статуса оплаты (G4-14): раньше всегда
    // «оплата ещё не списана», даже при бейдже «Оплачено».
    const cancelHint = within24h
        ? 'Меньше 24 ч до начала — отменяете как администратор'
        : booking.paymentStatus === 'paid'
            ? 'Бесплатно — оплату вернём полностью'
            : 'Бесплатно — оплата ещё не списана';

    const dateTitle = dt ? formatDateLabel(dt, { capitalize: true }) : 'Бронь';
    const title = mode === 'pickClient'
        ? 'Привязать клиента'
        : mode === 'confirmCancel'
            ? (within24h ? 'Отменить бронь меньше чем за сутки?' : 'Отменить бронь?')
            : dateTitle;

    const footer = mode === 'confirmCancel' ? (
        <>
            <Button
                variant="danger"
                block
                onClick={doCancel}
                disabled={busy !== null && busy !== 'cancel'}
                loading={busy === 'cancel'}
            >
                {busy === 'cancel' ? 'Отменяем…' : within24h ? 'Всё равно отменить' : 'Отменить бронь'}
            </Button>
            <Button variant="secondary" block onClick={() => setMode('view')} disabled={busy === 'cancel'}>
                Оставить
            </Button>
        </>
    ) : mode === 'pickClient' ? (
        <Button variant="secondary" block onClick={() => setMode('view')}>
            Назад к брони
        </Button>
    ) : undefined;

    return (
        <>
        <Sheet
            open
            onClose={onClose}
            title={title}
            footer={footer}
            // Пока открыто старое окно «Сократить бронь», Esc и свайп
            // принадлежат ему — иначе закрылась бы карточка под ним.
            dismissible={!trimming}
        >
            {mode === 'pickClient' ? (
                /* Pick CRM client mode */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p style={{ margin: 0, fontSize: TEXT.small, color: COLOR.ink60 }}>
                        Клиенты из вашей CRM. Нового клиента можно добавить в разделе{' '}
                        <button type="button" onClick={() => { onClose(); navigate('/m/crm/clients'); }} style={inlineLink}>
                            «Клиенты» CRM
                        </button>.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                            <div style={{ background: COLOR.sunken, borderRadius: 12, padding: 16, textAlign: 'center', color: COLOR.ink60, fontSize: TEXT.small }}>
                                Загружаем клиентов…
                            </div>
                        )}
                    </div>
                </div>
            ) : mode === 'view' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Время крупно */}
                    <div>
                        <div className="num" style={{ fontSize: TEXT.heading, fontWeight: 600, lineHeight: 1.1 }}>
                            {dt ? bookingTimeRange(booking, dt) : booking.startTime}
                        </div>
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink60, marginTop: 4 }}>
                            {formatLabel(booking.format)} · {formatBookingDuration(booking.duration ?? 60)}
                        </div>
                    </div>

                    {/* Статусы брони и оплаты — слова из общего словаря (statuses.ts). */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {isActive && <Tag tone="active">Идёт сейчас</Tag>}
                        {booking.status === 'pending_approval' && <StatusBadge kind="booking" status="pending_approval" />}
                        {isPast && booking.status !== 'cancelled' && <StatusBadge kind="booking" status="completed" />}
                        {booking.status === 'cancelled' && <StatusBadge kind="booking" status="cancelled" />}
                        {booking.isReRentListed && <StatusBadge kind="booking" status="re-rent-listed" />}
                        <PaymentBadge status={booking.paymentStatus} />
                        {(booking as any).recurringGroupId && <Tag tone="muted">Серия</Tag>}
                    </div>

                    {booking.status === 'pending_approval' && (
                        <div style={{ fontSize: TEXT.small, lineHeight: 1.5, color: COLOR.ink80 }}>
                            Бронь ждёт подтверждения администратора — пришлём уведомление, как только её подтвердят.
                        </div>
                    )}

                    {/* Место */}
                    <Field icon={<MapPin size={16} aria-hidden="true" />} label="Где">
                        {place.title}
                        {place.address && <span style={{ color: COLOR.ink60 }}>, {place.address}</span>}
                        {route && isLive && (
                            <div>
                                <a href={route} target="_blank" rel="noopener noreferrer" style={{ ...inlineLink, display: 'inline-flex', alignItems: 'center', minHeight: 44, gap: 4 }}>
                                    Маршрут <ArrowUpRight size={14} aria-hidden="true" />
                                </a>
                            </div>
                        )}
                    </Field>

                    {/* Цена */}
                    <Field icon={<Wallet size={16} aria-hidden="true" />} label="Оплата">
                        <span style={{ fontSize: TEXT.body, fontWeight: 600 }}>{priceLabel(booking)}</span>
                        {booking.paymentMethod === 'balance' && booking.finalPrice != null && (
                            <span style={{ color: COLOR.ink60, marginLeft: 8 }}>с баланса</span>
                        )}
                        {booking.paymentStatus === 'pending' && dt && (
                            // Обычное состояние будущей брони — нейтрально, не янтарём (G4-08).
                            <div style={{ fontSize: TEXT.small, color: COLOR.ink60, marginTop: 4 }}>
                                Спишем {formatChargeAt(dt)} — за сутки до начала
                            </div>
                        )}
                    </Field>

                    {/* CRM-клиент — только специалистам (G4-14). */}
                    {showCrm && (
                        <Field label="Клиент из CRM" subtle>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                {booking.crmClientId ? (
                                    <span style={{ color: COLOR.ink }}>
                                        {(() => {
                                            const c = crmClients.find(x => x.id === booking.crmClientId);
                                            return c?.name ?? 'Клиент привязан';
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
                    )}

                    {/* Cancellation reason */}
                    {booking.cancellationReason && (
                        <Field label="Причина отмены" subtle>
                            <span style={{ color: COLOR.ink60 }}>{booking.cancellationReason}</span>
                        </Field>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                        {isLive && isActive && (
                            <ActionRow
                                primary
                                icon={<Plus size={18} />}
                                label="Продлить +30 минут"
                                sub="Если следующий слот свободен"
                                busy={busy === 'extend'}
                                onClick={doExtend}
                            />
                        )}

                        {/* Меньше суток до начала — клиенту только пересдача и связь (X3-21). */}
                        {isLive && !isActive && lateForClient && (
                            <>
                                <div style={{ fontSize: TEXT.small, lineHeight: 1.5, color: COLOR.ink80, background: COLOR.sunken, borderRadius: 12, padding: 12 }}>
                                    {lateLeft > 0
                                        ? 'До начала меньше 24 часов — отменить уже нельзя, но перенести можно: по абонементу есть бесплатные переносы.'
                                        : 'До начала меньше 24 часов — отменить или перенести уже нельзя.'}
                                    {canReRent ? ' Можно пересдать время: если его займёт другой специалист, вернём 50%.' : ''}
                                    {' '}Или напишите администратору.
                                </div>
                                {lateLeft > 0 && (
                                    <ActionRow
                                        icon={<CalendarClock size={18} />}
                                        label={lateRescheduleLabel(lateLeft)}
                                        sub="Не позже чем за 3 часа, в пределах срока абонемента"
                                        onClick={() => {
                                            onClose();
                                            navigate(`/m/find?reschedule=${booking.id}`);
                                        }}
                                    />
                                )}
                                {canReRent && (
                                    <ActionRow
                                        icon={<Users size={18} />}
                                        label={booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать'}
                                        sub={booking.isReRentListed
                                            ? 'Бронь снова станет только вашей'
                                            : 'Если её займут — вернём 50% на баланс'}
                                        busy={busy === 'rerent'}
                                        onClick={doToggleReRent}
                                    />
                                )}
                                <ActionLink
                                    href={ADMIN_TG_URL}
                                    icon={<MessageCircle size={18} />}
                                    label="Написать администратору"
                                    sub="Telegram · @UnboxCenter"
                                />
                            </>
                        )}

                        {isLive && !isActive && !lateForClient && (
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

                                {canReRent && (
                                    <ActionRow
                                        icon={<Users size={18} />}
                                        label={booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать'}
                                        sub={booking.isReRentListed
                                            ? 'Бронь снова станет только вашей'
                                            : 'Если её займут — вернём 50% на баланс'}
                                        busy={busy === 'rerent'}
                                        onClick={doToggleReRent}
                                    />
                                )}

                                <ActionRow
                                    danger
                                    icon={<AlertTriangle size={18} />}
                                    label="Отменить бронь"
                                    sub={cancelHint}
                                    onClick={() => setMode('confirmCancel')}
                                />

                                {(booking.duration ?? 60) >= 120 && !booking.isReRentListed && (
                                    <ActionRow
                                        danger
                                        icon={<Scissors size={18} />}
                                        label="Отменить часть"
                                        sub="Убрать часть брони, остальное оставить"
                                        onClick={() => setTrimming(true)}
                                    />
                                )}
                            </>
                        )}

                        {/* Repeat — works for past and future. Pre-fills the
                            checkout with this booking's slot on the next
                            same weekday. Второстепенное действие. */}
                        <ActionRow
                            primary={!!isPast}
                            icon={<Repeat size={18} />}
                            label="Повторить"
                            sub={`${nextWeekdayPhrase(dt)} в ${booking.startTime}`}
                            onClick={doRepeat}
                        />

                        {/* Series actions — only when this booking is part of a recurring series. */}
                        {(booking as any).recurringGroupId && isLive && (
                            <>
                                <h3 style={{
                                    margin: '6px 0 0',
                                    fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em',
                                    textTransform: 'uppercase', color: COLOR.ink60,
                                }}>
                                    Серия
                                </h3>
                                <ActionRow
                                    icon={<Plus size={18} />}
                                    label="Продлить серию"
                                    sub="Добавить ещё брони в конец серии"
                                    busy={busy === 'extend_series'}
                                    onClick={openExtendSeries}
                                />
                                <ActionRow
                                    icon={<BellOff size={18} />}
                                    label="Пусть завершится в срок"
                                    sub="Не присылать больше напоминаний"
                                    busy={busy === 'dismiss_series_reminder'}
                                    onClick={doDismissSeriesReminder}
                                />
                                {/* Серию с бронью меньше чем за сутки сервер клиенту не отменит. */}
                                {!lateForClient && (
                                    <>
                                        <ActionRow
                                            danger
                                            icon={<AlertTriangle size={18} />}
                                            label="Отменить эту и следующие"
                                            sub="Прошедшие брони серии не трогаем"
                                            busy={busy === 'cancel_tail'}
                                            onClick={() => doCancelSeries('tail')}
                                        />
                                        <ActionRow
                                            danger
                                            icon={<AlertTriangle size={18} />}
                                            label="Отменить всю серию"
                                            sub="Все будущие брони серии"
                                            busy={busy === 'cancel_all_future'}
                                            onClick={() => doCancelSeries('all_future')}
                                        />
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            ) : (
                /* Confirm cancel mode */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: TEXT.small, color: COLOR.ink80 }}>
                        {dateTitle}, <span className="num">{dt ? bookingTimeRange(booking, dt) : booking.startTime}</span> — {place.title}
                    </div>
                    {within24h ? (
                        // Сюда попадает только администратор: клиенту кнопку не показываем.
                        <>
                            <div style={{ fontSize: TEXT.small, background: STATUS.danger.bg, color: STATUS.danger.fg, padding: 12, borderRadius: 12 }}>
                                До начала меньше 24 часов. Клиент сам такую бронь отменить не может — вы отменяете как администратор.
                            </div>
                            {canReRent && (
                                <Button
                                    variant="secondary"
                                    block
                                    onClick={doToggleReRent}
                                    disabled={busy !== null && busy !== 'rerent'}
                                    loading={busy === 'rerent'}
                                >
                                    {booking.isReRentListed ? 'Снять с пересдачи' : 'Лучше пересдать'}
                                </Button>
                            )}
                        </>
                    ) : (
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>
                            {booking.paymentStatus === 'paid'
                                ? 'Отмена бесплатная — оплату вернём полностью.'
                                : 'Оплата ещё не списана — отмена бесплатная.'}
                        </div>
                    )}
                </div>
            )}
        </Sheet>
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
            <FormField label="Сколько броней добавить" hint="От 1 до 52" error={extendError ?? undefined}>
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
            aria-pressed={active}
            style={{
                width: '100%',
                minHeight: 48,
                background: active ? COLOR.accentSoft : COLOR.card,
                color: COLOR.ink,
                border: `1px solid ${active ? COLOR.accent : COLOR.ink10}`,
                borderRadius: RADIUS.control,
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
                <div style={{ fontSize: TEXT.small, fontWeight: 600 }}>{title}</div>
                {sub && <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 1 }}>{sub}</div>}
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
            borderRadius: 12,
            padding: subtle ? '4px 0' : 12,
        }}>
            <div style={{
                fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: COLOR.ink60,
                display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 4,
            }}>
                {icon} {label}
            </div>
            <div style={{ fontSize: TEXT.small, color: COLOR.ink }}>
                {children}
            </div>
        </div>
    );
}

const actionRowStyle = (primary?: boolean, danger?: boolean): React.CSSProperties => ({
    background: primary ? COLOR.ink : danger ? STATUS.danger.bg : COLOR.card,
    color: primary ? COLOR.onInk : danger ? STATUS.danger.fg : COLOR.ink,
    border: primary ? 'none' : `1px solid ${danger ? `${STATUS.danger.fg}33` : COLOR.ink10}`,
    borderRadius: 12,
    minHeight: 56,
    padding: '10px 14px',
    display: 'flex', alignItems: 'center', gap: 12,
    fontFamily: 'inherit',
    textAlign: 'left',
    textDecoration: 'none',
});

function ActionRow({ icon, label, sub, primary, danger, busy, onClick }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    primary?: boolean;
    danger?: boolean;
    busy?: boolean;
    onClick: () => void;
}) {
    // Подпись без прозрачности: на красном фоне opacity .7 давала 3.2:1.
    const subColor = primary ? COLOR.onInk : danger ? STATUS.danger.fg : COLOR.ink60;
    return (
        <button
            onClick={onClick}
            disabled={busy}
            className="press"
            style={{ ...actionRowStyle(primary, danger), cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
        >
            <span aria-hidden="true">{icon}</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: TEXT.small, fontWeight: 600 }}>{busy ? 'Секунду…' : label}</div>
                {sub && <div style={{ fontSize: TEXT.caption, color: subColor, marginTop: 2 }}>{sub}</div>}
            </div>
        </button>
    );
}

function ActionLink({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub?: string }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="press" style={actionRowStyle()}>
            <span aria-hidden="true">{icon}</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: TEXT.small, fontWeight: 600 }}>{label}</div>
                {sub && <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 2 }}>{sub}</div>}
            </div>
            <ArrowUpRight size={16} color={COLOR.ink60} aria-hidden="true" />
        </a>
    );
}

/** Статус оплаты — слова и цвета только из общего словаря (statuses.ts).
 *  «Ждёт списания» у будущей брони — обычное состояние: вместо янтарного
 *  бейджа нейтральная строка «Спишем …» в блоке оплаты (G4-08). */
function PaymentBadge({ status }: { status?: 'pending' | 'paid' | 'waived' | null }) {
    if (!status || status === 'pending') return null;
    return <StatusBadge kind="payment" status={status} />;
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'muted' | 'active' }) {
    const colors: Record<string, { bg: string; fg: string }> = {
        muted: { bg: STATUS.muted.bg, fg: STATUS.muted.fg },
        active: { bg: COLOR.ink, fg: COLOR.onInk },
    };
    const c = colors[tone];
    return (
        <span style={{
            background: c.bg, color: c.fg,
            fontSize: TEXT.caption, fontWeight: 600,
            minHeight: 24, padding: '0 8px', borderRadius: RADIUS.control,
            display: 'inline-flex', alignItems: 'center',
            whiteSpace: 'nowrap',
        }}>{children}</span>
    );
}

const inlineLink: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0,
    color: COLOR.accentInk, fontWeight: 600, fontSize: 'inherit', fontFamily: 'inherit',
    textDecoration: 'underline', cursor: 'pointer',
};

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
