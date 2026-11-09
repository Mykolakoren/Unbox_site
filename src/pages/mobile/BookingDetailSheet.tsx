import { useEffect, useState } from 'react';
import { formatChargeAt } from '../../utils/chargeTime';
import { useNavigate } from 'react-router-dom';
import { MapPin, Wallet, CalendarClock, Plus, AlertTriangle, Repeat, BellOff, Users, ArrowUpRight, MessageCircle, Scissors, BookOpen, UserRound, Info } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { TrimBookingModal } from '../../components/TrimBookingModal';
import { useUserStore } from '../../store/userStore';
import { useCrmStore } from '../../store/crmStore';
import { prepareRepeat, repeatTargetDate } from './repeatBooking';
import { EXTRAS } from '../../utils/data';
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
import { ListGroup, ListIcon, ListRow } from '../../components/ui/ListRow';
import { ChoiceCard, ChoiceGroup } from '../../components/ui/ChoiceCard';
import { canUsePsyCrm, isBookingAdmin } from './crmAccess';
import { hoursUntilBookingStart, lateRescheduleLabel, lateRescheduleLeft } from '../../utils/subscription';
import { bookingEndDate, bookingPlace, bookingStartDate, bookingTimeRange, mapsUrl } from './bookingView';
import { cancellationReasonText, cancelledRefund, reRentCaption, reRentConfirmBody, reRentToast, RE_RENT_TOO_EARLY_HINT } from './refundText';
import { calculatePrice } from '../../utils/pricing';
import { fmtHours, subscriptionHours } from '../../utils/paymentPriority';
import { resourceKind } from '../../utils/subscriptionHours';
import { format as fmtDate } from 'date-fns';

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
 *
 * 09.11 (владелец): «Пересдать» — только меньше чем за сутки до начала. Больше
 * суток — на месте кнопки подсказка «отмените бронь, деньги вернутся полностью».
 */
export function BookingDetailSheet({ booking, onClose, initialMode = 'view' }: {
    booking: BookingHistoryItem;
    onClose: () => void;
    /** Свайп «Отменить» в «Моих бронях» открывает сразу подтверждение (ревью №15). */
    initialMode?: 'view' | 'confirmCancel';
}) {
    const { fetchBookings, currentUser, bookings } = useUserStore();
    const navigate = useNavigate();
    const [mode, setMode] = useState<'view' | 'confirmCancel' | 'pickClient'>(initialMode);
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
    // sandbox_toys — старый id песочницы (снят с витрины, но живёт в старых бронях).
    const extrasNames = (booking.extras || [])
        .map(id => EXTRAS.find(e => e.id === id)?.name ?? (id === 'sandbox_toys' ? 'Песочница с игрушками' : null))
        .filter(Boolean)
        .join(', ');

    useEffect(() => {
        // Lazy-load CRM clients only when the user opens the picker — или когда
        // к брони уже привязан клиент: без списка карточка писала «Клиент
        // привязан» вместо имени (обход мобильной версии 10.10). Список один
        // на все экраны (store), повторно не грузится.
        if (showCrm && (mode === 'pickClient' || booking.crmClientId) && crmClients.length === 0) {
            fetchCrmClients(true).catch(() => {});
        }
    }, [showCrm, mode, booking.crmClientId, crmClients.length, fetchCrmClients]);

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
    // 12.10: заявку «на подтверждении» (денег не брали) клиент снимает сам и
    // меньше чем за сутки — сервер это разрешает (cancel_booking).
    const isRequest = booking.status === 'pending_approval';
    const lateForClient = within24h && !isAdmin && !isRequest;
    // …кроме бесплатного переноса по абонементу (владелец 01.10: Тёплый 1,
    // Регулярный 2, Профи+ 3; не позже чем за 3 ч до начала).
    const lateLeft = lateForClient && booking.status === 'confirmed'
        ? lateRescheduleLeft(currentUser?.subscription, hoursToStart)
        : 0;
    // Пересдать можно только подтверждённую бронь (сервер: status == confirmed).
    // 09.11 (владелец): пересдача — только когда до начала меньше суток. Раньше
    // бронь просто отменяют с полным возвратом. Часы — по времени Тбилиси, как
    // на сервере (_booking_hours_until_start), а не по часовому поясу телефона.
    // Уже выставленную раньше (до правила) бронь можно снять с пересдачи всегда.
    const reRentWindow = hoursUntilBookingStart(booking) < 24;
    const canReRent = isLive && booking.status === 'confirmed' && (reRentWindow || !!booking.isReRentListed);
    // Где раньше была «Пересдать», а до начала больше суток — подсказка вместо кнопки.
    const reRentTooEarly = isLive && booking.status === 'confirmed' && !reRentWindow && !booking.isReRentListed;

    const place = bookingPlace(booking);
    // Ревью №1: «Свободно» открываем на дне самой брони.
    const rescheduleUrl = `/m/find?reschedule=${booking.id}${dt ? `&date=${fmtDate(dt, 'yyyy-MM-dd')}` : ''}`;
    const isCancelled = booking.status === 'cancelled';
    const refund = isCancelled ? cancelledRefund(booking) : null;
    const reasonText = cancellationReasonText(booking);
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

    // Ревью №4 (09.11): «Продлить +30 минут» — с ценой и источником на кнопке и
    // коротким подтверждением. Оценка — как считает сервер: абонементная бронь
    // берёт 0,5 ч абонемента (+ пиковая доплата), если часов хватает, иначе деньги;
    // остальные — разница цены (пик учтён) с баланса.
    const extendQuote = (() => {
        if (!dt || !endDt) return null;
        const start = new Date(endDt);
        const end = new Date(start.getTime() + 30 * 60000);
        const p = calculatePrice({
            format: (booking.format as 'individual' | 'group' | 'intervision') || 'individual',
            startTime: start, endTime: end, extras: [], resourceId: booking.resourceId || undefined,
            personalDiscountPercent: currentUser?.personalDiscountPercent, pricingSystem: currentUser?.pricingSystem,
        });
        const peak = p.peakSurcharge ?? 0;
        if (booking.paymentMethod === 'subscription' && (Number(booking.hoursDeducted) || 0) > 0) {
            const sub = subscriptionHours(currentUser?.subscription, {
                format: (booking.format as 'individual' | 'group' | 'intervision') || 'individual',
                bookingDate: dt, bookings, ownerEmail: currentUser?.email, resourceKind: resourceKind(booking.resourceId),
            });
            if (sub.ok && sub.remaining >= 0.5 - 0.01) {
                return { short: `${fmtHours(0.5)} абонемента${peak > 0 ? ` + ${formatGel(peak)}` : ''}`,
                    long: `Спишем ${fmtHours(0.5)} абонемента${peak > 0 ? ` и ${formatGel(peak)} за пиковое время с баланса` : ''}.` };
            }
        }
        return { short: `≈ ${formatGel(p.finalPrice)} с баланса`, long: `Спишем ≈ ${formatGel(p.finalPrice)} с баланса (точная сумма — по цене брони).` };
    })();

    async function askExtend() {
        const newEnd = endDt ? new Date(endDt.getTime() + 30 * 60000) : null;
        const ok = await confirm({
            title: 'Продлить бронь на 30 минут?',
            body: `${newEnd ? `До ${String(newEnd.getHours()).padStart(2, '0')}:${String(newEnd.getMinutes()).padStart(2, '0')}. ` : ''}${extendQuote?.long ?? ''} Отменить продление потом нельзя.`,
            confirmLabel: 'Продлить',
            cancelLabel: 'Не надо',
        });
        if (ok) await doExtend();
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
        // Выставить на пересдачу — только после вопроса, как в списке броней (UX 24.10).
        if (!booking.isReRentListed && !(await confirm({
            title: 'Пересдать бронь?',
            body: reRentConfirmBody(booking),
            confirmLabel: 'Пересдать',
            cancelLabel: 'Оставить',
        }))) return;
        setBusy('rerent');
        try {
            const updated = await bookingsApi.toggleReRent(booking.id);
            await fetchBookings();
            toast.success(updated.isReRentListed ? reRentToast(booking) : 'Снято с пересдачи');
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось обновить');
        } finally { setBusy(null); }
    }

    // Подсказка к «Отменить бронь» — от статуса оплаты (G4-14): раньше всегда
    // «оплата ещё не списана», даже при бейдже «Оплачено».
    const cancelHint = isRequest && !isAdmin
        ? 'Заявку можно снять в любой момент — оплата не списана'
        : within24h
        ? 'Меньше 24 ч до начала — отменяете как администратор'
        : booking.paymentStatus === 'paid'
            ? 'Бесплатно — оплату вернём полностью'
            : 'Бесплатно — оплата ещё не списана';

    const dateTitle = dt ? formatDateLabel(dt, { capitalize: true }) : 'Бронь';
    const title = mode === 'pickClient'
        ? 'Привязать клиента'
        : mode === 'confirmCancel'
            ? (isRequest ? 'Снять заявку?' : within24h ? 'Отменить бронь меньше чем за сутки?' : 'Отменить бронь?')
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
                {busy === 'cancel' ? 'Отменяем…' : isRequest && !isAdmin ? 'Снять заявку' : within24h ? 'Всё равно отменить' : 'Отменить бронь'}
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
                    <ChoiceGroup label="Клиент из CRM">
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
                            <div style={{ background: COLOR.sunken, borderRadius: RADIUS.control, padding: 16, textAlign: 'center', color: COLOR.ink60, fontSize: TEXT.small }}>
                                Загружаем клиентов…
                            </div>
                        )}
                    </ChoiceGroup>
                </div>
            ) : mode === 'view' ? (
                // 09.11 фаза 3: шапка (время 28/600, бирки) → одна группа сведений
                // (Где / Оплата / Клиент из CRM) → главное действие (если есть) →
                // группа действий → правило мелкой подписью. Раньше — шесть разных
                // контейнеров подряд (серые плашки, карточки-действия в рамках).
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Время крупно */}
                    <div>
                        <div className="num" style={{ fontSize: TEXT.heading, fontWeight: 600, lineHeight: 1.1, whiteSpace: 'nowrap' }}>
                            {dt ? bookingTimeRange(booking, dt) : booking.startTime}
                        </div>
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink60, marginTop: 4 }}>
                            {formatLabel(booking.format)} · {formatBookingDuration(booking.duration ?? 60)}
                        </div>
                        {/* Статусы брони и оплаты — слова из общего словаря (statuses.ts). */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                            {isActive && <Tag tone="active">Идёт сейчас</Tag>}
                            {booking.status === 'pending_approval' && <StatusBadge kind="booking" status="pending_approval" />}
                            {isPast && booking.status !== 'cancelled' && <StatusBadge kind="booking" status="completed" />}
                            {booking.status === 'cancelled' && <StatusBadge kind="booking" status="cancelled" />}
                            {booking.isReRentListed && <StatusBadge kind="booking" status="re-rent-listed" />}
                            {/* Отменённая: не «Оплачено», а что вернули (ревью №7). */}
                            {isCancelled
                                ? (refund?.badge ? <StatusBadge kind="payment" status={refund.badge} /> : null)
                                : <PaymentBadge status={booking.paymentStatus} />}
                            {(booking as any).recurringGroupId && <Tag tone="muted">Серия</Tag>}
                        </div>
                    </div>

                    {booking.status === 'pending_approval' && (
                        <div style={{ fontSize: TEXT.small, lineHeight: 1.5, color: COLOR.ink80 }}>
                            Бронь ждёт подтверждения администратора — пришлём уведомление, как только её подтвердят.
                        </div>
                    )}

                    <ListGroup bare aria-label="Сведения о брони">
                        {/* Место; «Маршрут» — вторичная кнопка в строке, без подчёркивания. */}
                        <ListRow
                            lead={<ListIcon><MapPin size={20} /></ListIcon>}
                            title={place.title}
                            subtitle={place.address || undefined}
                            action={route && isLive ? (
                                <a
                                    href={route}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ui-btn ui-btn--secondary ui-btn--sm"
                                >
                                    Маршрут <ArrowUpRight size={14} aria-hidden="true" />
                                </a>
                            ) : undefined}
                        />

                        {/* Цена */}
                        <ListRow
                            lead={<ListIcon><Wallet size={20} /></ListIcon>}
                            title={<>
                                <span className="num-inline" style={{ textDecoration: isCancelled ? 'line-through' : undefined, color: isCancelled ? COLOR.ink60 : undefined }}>
                                    {priceLabel(booking)}
                                </span>
                                {booking.paymentMethod === 'balance' && booking.finalPrice != null && !isCancelled && (
                                    <span style={{ color: COLOR.ink60, fontWeight: 400, marginLeft: 8 }}>с баланса</span>
                                )}
                            </>}
                            subtitle={(refund || extrasNames || (booking.paymentStatus === 'pending' && dt && !isCancelled)) ? <>
                                {refund && (
                                    <span style={{ display: 'block', fontWeight: 600, color: refund.badge === 'refunded' ? STATUS.ok.fg : COLOR.ink80 }}>
                                        {refund.text}
                                    </span>
                                )}
                                {extrasNames && (
                                    // Допуслуги входят в цену — раньше на телефоне их не было видно (обход 10.10).
                                    <span style={{ display: 'block' }}>в т.ч. допуслуги: {extrasNames}</span>
                                )}
                                {booking.paymentStatus === 'pending' && dt && !isCancelled && (
                                    // Обычное состояние будущей брони — нейтрально, не янтарём (G4-08).
                                    // Срочная бронь списывается при подтверждении админом
                                    // (charge_hot_booking_on_approval), не «за сутки» (обход 10.10).
                                    <span style={{ display: 'block' }}>
                                        {booking.status === 'pending_approval'
                                            ? 'Спишем, когда администратор подтвердит бронь'
                                            : `Спишем ${formatChargeAt(dt)} — за сутки до начала`}
                                    </span>
                                )}
                            </> : undefined}
                        />

                        {/* CRM-клиент — только специалистам (G4-14). */}
                        {showCrm && (
                            <ListRow
                                lead={<ListIcon><UserRound size={20} /></ListIcon>}
                                title="Клиент из CRM"
                                subtitle={booking.crmClientId
                                    ? (crmClients.find(x => x.id === booking.crmClientId)?.name ?? 'Клиент привязан')
                                    : 'не привязан'}
                                trail={<span style={{ color: COLOR.accentInk }}>{booking.crmClientId ? 'Изменить' : 'Привязать'}</span>}
                                onClick={() => setMode('pickClient')}
                            />
                        )}

                        {/* Cancellation reason */}
                        {/* По-русски, как на компьютере (ревью №10): без «User cancelled». */}
                        {reasonText && (
                            <ListRow
                                lead={<ListIcon><Info size={20} /></ListIcon>}
                                title="Причина отмены"
                                subtitle={reasonText}
                            />
                        )}
                    </ListGroup>

                    {/* Главное действие шторки — одно, бирюзовое: «Продлить» у идущей,
                        «Повторить» у прошедшей. */}
                    {isLive && isActive && (
                        <PrimaryAction
                            icon={<Plus size={18} aria-hidden="true" />}
                            label={`Продлить на 30 минут${extendQuote ? ` · ${extendQuote.short}` : ''}`}
                            sub="Если следующие полчаса свободны — спросим подтверждение"
                            busy={busy === 'extend'}
                            onClick={() => { void askExtend(); }}
                        />
                    )}
                    {/* Actions (у прошедшей брони действий, кроме «Повторить», нет — группу не рисуем). */}
                    {(isLive || !isPast) && (
                    <ListGroup bare title="Действия">
                        {/* Меньше суток до начала — клиенту только пересдача и связь (X3-21). */}
                        {isLive && !isActive && lateForClient && (
                            <>
                                {lateLeft > 0 && (
                                    <ActionRow
                                        icon={<CalendarClock size={20} />}
                                        label={lateRescheduleLabel(lateLeft)}
                                        sub="Не позже чем за 3 часа, в пределах срока абонемента"
                                        onClick={() => {
                                            onClose();
                                            navigate(rescheduleUrl);
                                        }}
                                    />
                                )}
                                {canReRent && (
                                    <ActionRow
                                        icon={<Users size={20} />}
                                        label={booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать'}
                                        sub={booking.isReRentListed
                                            ? 'Бронь снова станет только вашей'
                                            : reRentCaption(booking)}
                                        busy={busy === 'rerent'}
                                        onClick={doToggleReRent}
                                    />
                                )}
                                <ActionLink
                                    href={ADMIN_TG_URL}
                                    icon={<MessageCircle size={20} />}
                                    label="Написать администратору"
                                    sub="Telegram · @UnboxCenter"
                                />
                            </>
                        )}

                        {isLive && !isActive && !lateForClient && (
                            <>
                                {!isRequest && (
                                <ActionRow
                                    icon={<CalendarClock size={20} />}
                                    label="Перенести"
                                    sub="Выберите новое время в «Свободно»"
                                    onClick={() => {
                                        onClose();
                                        navigate(rescheduleUrl);
                                    }}
                                />
                                )}

                                {canReRent && (
                                    <ActionRow
                                        icon={<Users size={20} />}
                                        label={booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать'}
                                        sub={booking.isReRentListed
                                            ? 'Бронь снова станет только вашей'
                                            : reRentCaption(booking)}
                                        busy={busy === 'rerent'}
                                        onClick={doToggleReRent}
                                    />
                                )}

                                <ActionRow
                                    danger
                                    icon={<AlertTriangle size={20} />}
                                    label="Отменить бронь"
                                    sub={cancelHint}
                                    onClick={() => setMode('confirmCancel')}
                                />

                                {(booking.duration ?? 60) >= 120 && !booking.isReRentListed && (
                                    <ActionRow
                                        danger
                                        icon={<Scissors size={20} />}
                                        label="Отменить часть"
                                        sub="Убрать часть брони, остальное оставить"
                                        onClick={() => setTrimming(true)}
                                    />
                                )}
                            </>
                        )}

                        {/* Repeat — works for past and future. Pre-fills the
                            checkout with this booking's slot on the next
                            same weekday. У будущей — второстепенное действие
                            (у прошедшей это главная кнопка выше). */}
                        {!isPast && (
                            <ActionRow
                                icon={<Repeat size={20} />}
                                label="Повторить"
                                sub={`${repeatDayLabel(repeatTargetDate(booking))} в ${booking.startTime}`}
                                onClick={doRepeat}
                            />
                        )}

                        {/* Ревью №11: правила — одной строкой из шторки. */}
                        {isLive && (
                            <ActionRow
                                icon={<BookOpen size={20} />}
                                label="Правила отмены и переноса"
                                onClick={() => { onClose(); navigate('/m/booking-rules'); }}
                            />
                        )}
                    </ListGroup>
                    )}

                    {/* У прошедшей брони «Повторить» — главная (бирюзовая) кнопка шторки. */}
                    {isPast && (
                        <PrimaryAction
                            icon={<Repeat size={18} aria-hidden="true" />}
                            label="Повторить"
                            sub={`${repeatDayLabel(repeatTargetDate(booking))} в ${booking.startTime}`}
                            onClick={doRepeat}
                        />
                    )}

                    {/* Правило «меньше суток» — подписью под действиями, без серой заливки. */}
                    {isLive && !isActive && lateForClient && (
                        <p style={ruleNote}>
                            {lateLeft > 0
                                ? 'До начала меньше 24 часов — отменить уже нельзя, но перенести можно: по абонементу есть бесплатные переносы.'
                                : 'До начала меньше 24 часов — отменить или перенести уже нельзя.'}
                            {canReRent ? ' Можно пересдать время: если его займёт другой специалист, вернём 50 % тем же, чем платили.' : ''}
                            {' '}Или напишите администратору.
                        </p>
                    )}
                    {isLive && !isActive && !lateForClient && reRentTooEarly && !isRequest && (
                        <p style={ruleNote}>{RE_RENT_TOO_EARLY_HINT}</p>
                    )}

                    {/* Series actions — only when this booking is part of a recurring series. */}
                    {(booking as any).recurringGroupId && isLive && (
                        <ListGroup bare title="Серия">
                            <ActionRow
                                icon={<Plus size={20} />}
                                label="Продлить серию"
                                sub="Добавить ещё брони в конец серии"
                                busy={busy === 'extend_series'}
                                onClick={openExtendSeries}
                            />
                            <ActionRow
                                icon={<BellOff size={20} />}
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
                                        icon={<AlertTriangle size={20} />}
                                        label="Отменить эту и следующие"
                                        sub="Прошедшие брони серии не трогаем"
                                        busy={busy === 'cancel_tail'}
                                        onClick={() => doCancelSeries('tail')}
                                    />
                                    <ActionRow
                                        danger
                                        icon={<AlertTriangle size={20} />}
                                        label="Отменить всю серию"
                                        sub="Все будущие брони серии"
                                        busy={busy === 'cancel_all_future'}
                                        onClick={() => doCancelSeries('all_future')}
                                    />
                                </>
                            )}
                        </ListGroup>
                    )}
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
                            <div style={{ fontSize: TEXT.small, background: STATUS.danger.bg, color: STATUS.danger.fg, padding: 12, borderRadius: RADIUS.control }}>
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

/** Выбор CRM-клиента — общая ChoiceCard (тот же язык «выбрано»). */
function ClientPickRow({ active, disabled, onClick, title, sub }: {
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
    title: string;
    sub?: string;
}) {
    return (
        <ChoiceCard
            selected={active}
            disabled={disabled}
            onClick={onClick}
            title={title}
            description={sub}
            style={disabled ? { cursor: 'wait' } : undefined}
        />
    );
}

/** Главное действие шторки: одна бирюзовая кнопка во всю ширину и пояснение под ней. */
function PrimaryAction({ icon, label, sub, busy, onClick }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    busy?: boolean;
    onClick: () => void;
}) {
    return (
        <div>
            <Button block icon={icon} loading={busy} onClick={onClick}>
                {busy ? 'Секунду…' : label}
            </Button>
            {sub && <p style={{ ...ruleNote, marginTop: 6 }}>{sub}</p>}
        </div>
    );
}

/** Строка действия — общий ListRow (09.11 фаза 3; были карточки в рамках,
 *  «главная» — чёрной плитой). Необратимое — красным словом и значком. */
function ActionRow({ icon, label, sub, danger, busy, onClick }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    danger?: boolean;
    busy?: boolean;
    onClick: () => void;
}) {
    return (
        <ListRow
            onClick={onClick}
            disabled={busy}
            lead={<ListIcon><span style={{ display: 'flex', color: danger ? STATUS.danger.fg : undefined }}>{icon}</span></ListIcon>}
            title={<span style={danger ? { color: STATUS.danger.fg } : undefined}>{busy ? 'Секунду…' : label}</span>}
            subtitle={sub}
            chevron={!danger}
        />
    );
}

function ActionLink({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub?: string }) {
    return (
        <ListRow href={href} target="_blank" lead={<ListIcon>{icon}</ListIcon>} title={label} subtitle={sub} />
    );
}

const ruleNote: React.CSSProperties = {
    margin: 0, fontSize: TEXT.small, lineHeight: 1.5, color: COLOR.ink60,
};

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
        // 09.11 фаза 3: «Идёт сейчас» — язык «выбрано/сейчас» (бирюза), не чёрная бирка.
        active: { bg: COLOR.accentSoft, fg: COLOR.accentInk },
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
/** «Среда, 21 октября» — точная дата повтора (раньше «В следующую среду» без
 *  даты, и для будущей брони это была её же среда). */
function repeatDayLabel(d: Date): string {
    const s = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatLabel(f: string | undefined): string {
    if (f === 'group') return 'Групповой';
    if (f === 'intervision') return 'Интервизия';
    return 'Индивидуальный';
}
