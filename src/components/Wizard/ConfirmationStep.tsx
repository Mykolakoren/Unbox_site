import { useBookingStore } from '../../store/bookingStore';
import { calculatePrice } from '../../utils/pricing';
import { getMyBookingsPath } from '../../utils/userPaths';
import { useUserStore } from '../../store/userStore';
import { bookingsApi } from '../../api/bookings';
import { LegacyButton as Button } from '../ui/LegacyButton';
import { PhoneInput } from '../ui/PhoneInput';
import {
    CheckCircle,
    Download,
    Calendar as CalendarIcon,
    ArrowRight,
    RefreshCw,
    Home,
    Loader2,
    AlertCircle,
    Repeat,
} from 'lucide-react';
import { generateGoogleCalendarUrl, downloadIcsFile } from '../../utils/calendar';
import { useState, useMemo, useEffect, useRef } from 'react';
import { EXTRAS, RESOURCES, availableExtrasForResource } from '../../utils/data';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { groupSlotsIntoBookings } from '../../utils/cartHelpers';
import { format, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { motion } from 'framer-motion';
import { useCrmStore } from '../../store/crmStore';
import { User as UserIcon, Gift, MessageCircle, Ticket } from 'lucide-react';
import { COLOR } from '../../design/tokens';
import { formatDayMonth, formatGel } from '../../utils/format';
import { ruCountWord } from '../../utils/plural';
import { Button as UiButton } from '../ui/Button';
import { BookingConflictDialog, type ConflictItem } from '../BookingConflictDialog';
import { useActiveBonusHours } from '../../hooks/useActiveBonusHours';
import {
    balanceLockedReason, fmtHours, isSelectable, paymentPlan, resolveFinalMethod,
    subscriptionHours, subscriptionHoursLabel, type PayMethod,
} from '../../utils/paymentPriority';

export function ConfirmationStep() {
    const state = useBookingStore();
    const { currentUser, addBookings, bookings, users, fetchCurrentUser, fetchUsers } = useUserStore();
    const [confirmed, setConfirmed] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [availabilityError, setAvailabilityError] = useState<string | null>(null);
    const [isCheckingAvailability, setIsCheckingAvailability] = useState(true);
    const [selectedCrmClientId, setSelectedCrmClientId] = useState<string>('');
    const { clients: crmClients, fetchClients: fetchCrmClients } = useCrmStore();
    const navigate = useNavigate();
    const shouldResetOnUnmount = useRef(false);
    // Synchronous re-entry guard. setIsSubmitting is async state, so a slow
    // network lets the button path AND the programmatic re-fire (alternative
    // cabinet) both pass the `isSubmitting` check before React re-renders —
    // firing two POSTs. This ref flips synchronously at the top of
    // handleConfirm and clears in finally, blocking the double-submit.
    const submittingRef = useRef(false);

    const [recurringPattern, setRecurringPattern] = useState<'' | 'weekly' | 'biweekly' | 'monthly'>('');
    const [recurringOccurrences, setRecurringOccurrences] = useState(12);
    // Branded conflict dialog state — replaces the bare red toast that used
    // to fire on 409/Conflict from the bookings API. See BookingConflictDialog
    // for the own-vs-other booking split + alternative-cabinet suggestions.
    const [conflictState, setConflictState] = useState<null | {
        conflicts: ConflictItem[];
        resourceId: string;
        time: string;
        duration: number;
    }>(null);

    // Guest form state (when no user is authenticated)
    const [guestName, setGuestName] = useState('');
    const [guestPhone, setGuestPhone] = useState('');
    const [guestEmail, setGuestEmail] = useState('');

    // Determine if the current user can act on behalf of others (admin-proxy
    // booking flow). Specialists only ever book for themselves.
    const isAdminActor = !!(currentUser && (
        currentUser.role === 'owner'
        || currentUser.role === 'senior_admin'
        || currentUser.role === 'admin'
        || currentUser.isAdmin
    ));

    // Resolve target specialist's UUID — needed to scope the CRM-clients
    // dropdown to that specialist's roster (otherwise an admin booking-for-
    // Yana would see only their own clients).
    const targetSpecialistUuid = useMemo(() => {
        if (!state.bookingForUser) return undefined;
        const target = users?.find(u => u.email === state.bookingForUser || u.id === state.bookingForUser);
        return target?.id;
    }, [state.bookingForUser, users]);

    // Specialists list for the "За кого бронируете?" picker — admins/owner
    // are included because they often have CRM clients of their own
    // (Yulia/Mykola see clients themselves).
    const specialistChoices = useMemo(() => {
        if (!isAdminActor || !users) return [];
        return users
            .filter(u => {
                const role = u.role;
                return role === 'specialist' || role === 'owner'
                    || role === 'senior_admin' || role === 'admin' || u.isAdmin;
            })
            .filter(u => !!u.email)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    }, [isAdminActor, users]);

    // Lazy-load users list for admins (otherwise specialistChoices stays empty).
    useEffect(() => {
        if (isAdminActor && (!users || users.length === 0)) {
            fetchUsers().catch(() => {});
        }
    }, [isAdminActor, users, fetchUsers]);

    // Fetch CRM clients (scoped to target specialist when in proxy mode).
    // Бонусы читает useActiveBonusHours ниже — для того, ЗА КОГО бронь.
    useEffect(() => {
        if (currentUser) {
            fetchCrmClients(true, false, targetSpecialistUuid).catch(() => {});
        }
    }, [currentUser, fetchCrmClients, targetSpecialistUuid]);

    // Reset booking state only after unmount (route change) to avoid race with <Navigate to="/" />
    useEffect(() => {
        return () => {
            if (shouldResetOnUnmount.current) {
                state.reset();
            }
        };
    }, []);

    // Stable identity of the slots being checked — drives the availability
    // pre-check below. Derived from the raw store inputs (not cartDetails,
    // which is declared later) so it's available as an effect dep. Changes
    // when the user swaps cabinets or picks a different time.
    const cartSignature = useMemo(
        () => `${format(state.date, 'yyyy-MM-dd')}::${[...state.selectedSlots].sort().join(',')}`,
        [state.date, state.selectedSlots]
    );

    // Pre-check availability — before showing payment form. Re-runs on slot
    // identity change (cartSignature) so an alternative-cabinet swap is
    // re-validated instead of showing the stale conflict screen.
    // cartDetails is computed synchronously via useMemo, so it's ready by the
    // time this effect's body runs.
    useEffect(() => {
        if (cartDetails.length === 0) {
            setIsCheckingAvailability(false);
            return;
        }

        const slots = cartDetails.map(item => ({
            resourceId: item.resourceId,
            date: format(state.date, 'yyyy-MM-dd'),
            startTime: item.startTime,
            duration: item.duration,
        }));

        // Clear any stale conflict from a previous slot/cabinet before the
        // fresh check resolves — otherwise swapping to an alternative cabinet
        // would briefly (or permanently, if the new check passes) keep the old
        // "время занято" guard screen up.
        setAvailabilityError(null);
        setIsCheckingAvailability(true);

        bookingsApi.checkAvailability(slots)
            .then(results => {
                const conflict = results.find(r => !r.available);
                if (conflict?.conflict) {
                    setAvailabilityError(conflict.conflict);
                }
            })
            .catch(err => {
                // Network error — non-blocking, let user attempt booking normally
                console.warn('Availability pre-check failed (non-blocking):', err);
            })
            .finally(() => setIsCheckingAvailability(false));
        // Re-run whenever the slot identity changes (e.g. user swaps to an
        // alternative cabinet via the conflict dialog → resourceId/cartDetails
        // change). cartSignature is a stable string of resourceId|startTime|
        // duration for each cart item plus the date, so the effect only re-fires
        // on a real slot change, not on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cartSignature]);

    // Determine effective user for pricing and logic
    const effectiveUser = state.bookingForUser
        ? users?.find(u => u.email === state.bookingForUser) || currentUser
        : currentUser;

    // Бонусные часы того, ЗА КОГО бронь: сервер тратит бонусы владельца брони.
    // ВАЖНО: бэкенд хранит тип подарочного часа как 'free_hour' (см.
    // auth._create_welcome_bonus). Раньше фильтр искал только 'freeHour'
    // (camelCase) → совпадений НИКОГДА не было → опция «оплатить бонусом»
    // не показывалась, и новичок платил балансом, а час сгорал (кейс Оксаны).
    // Оба написания принимает activeBonusHours (utils/paymentPriority).
    const isProxyBooking = !!effectiveUser && !!currentUser && effectiveUser.id !== currentUser.id;
    const totalBonusHours = useActiveBonusHours(effectiveUser?.id, isProxyBooking);

    const isEditing = !!state.editBookingId;
    const isRescheduling = state.mode === 'reschedule';

    // Fetch Old Booking for Comparison (if rescheduling)
    const oldBooking = useMemo(() => {
        if (!isRescheduling || !state.editBookingId) return null;
        return bookings.find(b => b.id === state.editBookingId);
    }, [isRescheduling, state.editBookingId, bookings]);



    // Calculate Cart Items (Basic grouping)
    const rawCartDetails = useMemo(() => {
        if (state.selectedSlots.length === 0) return [];
        return groupSlotsIntoBookings(state.selectedSlots, state.date);
    }, [state.selectedSlots, state.date]);

    // Calculate Accumulated Weekly Hours for progressive discount
    const accumulatedWeeklyHours = useMemo(() => {
        if (!effectiveUser) return 0;
        const now = state.date;
        const start = startOfWeek(now, { weekStartsOn: 1 });
        const end = endOfWeek(now, { weekStartsOn: 1 });

        const weeklyBookings = bookings.filter(b =>
            b.userId === effectiveUser.email &&
            b.status === 'confirmed' &&
            isWithinInterval(new Date(b.date), { start, end })
        );

        return weeklyBookings.reduce((sum, b) => sum + (b.duration / 60), 0);
    }, [effectiveUser, bookings, state.date]);

    // Synchronous Pricing State
    const { cartDetails, totalPrice } = useMemo(() => {
        if (rawCartDetails.length === 0) return { cartDetails: [], totalPrice: 0 };

        let total = 0;
        const details = rawCartDetails.map(b => {
            const selectedExtras = EXTRAS.filter(e => state.extras.includes(e.id));
            const startOriginal = new Date(state.date);
            const [h, m] = b.startTime.split(':').map(Number);
            startOriginal.setHours(h, m, 0, 0);
            const endDateTime = new Date(startOriginal.getTime() + b.duration * 60000);

            const p = calculatePrice({
                format: state.format,
                startTime: startOriginal,
                endTime: endDateTime,
                extras: selectedExtras,
                paymentMethod: state.paymentMethod,
                resourceId: b.resourceId,
                accumulatedWeeklyHours: accumulatedWeeklyHours,
                personalDiscountPercent: effectiveUser?.personalDiscountPercent,
                pricingSystem: effectiveUser?.pricingSystem
            });

            total += p.finalPrice;

            return {
                ...b,
                startDateTime: startOriginal,
                endDateTime: endDateTime,
                price: p,
                resourceId: b.resourceId
            };
        });

        return { cartDetails: details, totalPrice: total };
    }, [rawCartDetails, state.extras, state.format, state.date, state.paymentMethod, effectiveUser, accumulatedWeeklyHours]);

    const isLoadingPricing = false;


    // Payment method is now controlled by store (state.paymentMethod)

    // ── Порядок оплаты (владелец 29.09): бонус → абонемент → баланс ──
    // Тот же расчёт, что в мобильном оформлении и на сервере. Абонемент —
    // с честным остатком: часы будущих, ещё не списанных броней уже обещаны.
    const totalBookingHours = cartDetails.reduce((sum, item) => sum + (item.duration / 60), 0);
    const isSeries = !!recurringPattern;
    const subHours = useMemo(() => subscriptionHours(effectiveUser?.subscription, {
        format: state.format,
        bookingDate: state.date,
        bookings,
        ownerEmail: effectiveUser?.email,
        excludeBookingId: state.editBookingId,
    }), [effectiveUser, state.format, state.date, bookings, state.editBookingId]);
    const plan = useMemo(
        () => paymentPlan({ hours: totalBookingHours, bonusHours: totalBonusHours, sub: subHours, isSeries, moneyPrice: totalPrice }),
        [totalBookingHours, totalBonusHours, subHours, isSeries, totalPrice],
    );
    const isSubscriptionEligible = plan.subCovers;
    const isBonusEligible = plan.bonusCovers;
    // Что реально уйдёт на сервер (и что обещают подписи и кнопка).
    const payMethod: PayMethod = resolveFinalMethod(state.paymentMethod, plan, isSeries);
    const peakTotal = cartDetails.reduce((s, i) => s + (i.price.peakSurcharge ?? 0), 0);
    const extrasTotal = cartDetails.reduce((s, i) => s + i.price.extrasPrice, 0);
    // При абонементе деньгами идут только пиковая надбавка и допуслуги.
    const subMoney = peakTotal + extrasTotal;
    // Auto-prune extras that the chosen resource doesn't support — e.g.
    // user picked 'couch' on a cabinet, then re-routed to a capsule via
    // the conflict dialog's "альтернативный кабинет" CTA. The capsule
    // can't host a couch, so the extra silently drops. Otherwise the
    // booking would carry a phantom +5 ₾ for nothing.
    useEffect(() => {
        const currentResId = cartDetails[0]?.resourceId;
        if (!currentResId) return;
        const resource = RESOURCES.find(r => r.id === currentResId);
        const allowedIds = new Set(availableExtrasForResource(resource).map(e => e.id));
        const cleaned = state.extras.filter(id => allowedIds.has(id));
        if (cleaned.length !== state.extras.length) {
            useBookingStore.setState({ extras: cleaned });
        }
    }, [cartDetails, state.extras]);

    // Способ по умолчанию — тот, что выберет сервер (бонус → абонемент →
    // баланс). Раньше по умолчанию стоял «Списать с баланса 20 ₾», хотя сервер
    // брал часы абонемента (G3-03). Пока клиент сам не переключал, выбор
    // следует за планом (бонусы подгружаются позже); ручной выбор сбрасываем,
    // только если он стал недоступен.
    const userPickedPay = useRef(false);
    const oldPaymentMethod = oldBooking?.paymentMethod;
    useEffect(() => {
        const cur: PayMethod = state.paymentMethod ?? 'balance';
        if (isRescheduling) {
            // Перенос сервер пересчитывает по способу самой брони: абонементная
            // едет как есть, остальные — по деньгам. Выбор оплаты тут ничего не
            // меняет, поэтому цена и «Разница к оплате» считаются от него.
            const keep: PayMethod = oldPaymentMethod === 'subscription' ? 'subscription' : 'balance';
            if (cur !== keep) state.setPaymentMethod(keep);
            return;
        }
        const want: PayMethod = isSeries ? 'balance' : plan.auto;
        if (userPickedPay.current && isSelectable(cur, plan, isSeries)) return;
        userPickedPay.current = false;
        if (cur !== want) state.setPaymentMethod(want);
    }, [plan, isSeries, state.paymentMethod, isRescheduling, oldPaymentMethod]);
    const pickPay = (m: PayMethod) => {
        if (!isSelectable(m, plan, isSeries)) return;
        userPickedPay.current = true;
        state.setPaymentMethod(m);
    };
    // Перенос бонусной брони: её бонус-часы едут вместе с ней, деньгами —
    // только доля, не покрытая бонусом (так считает сервер). Иначе «Разница к
    // оплате» показывала полную цену, а новичок с 0 ₾ упирался в «Недостаточно
    // средств», хотя переносит бесплатную бронь.
    const rescheduleBonusShare = useMemo(() => {
        if (!oldBooking || oldBooking.paymentMethod !== 'bonus') return 0;
        const hrs = (oldBooking.duration || 0) / 60;
        const covered = Math.min(Number(oldBooking.hoursDeducted) || 0, hrs);
        return hrs > 0 ? covered / hrs : 0;
    }, [oldBooking]);
    const rescheduleNewPrice = Math.round(totalPrice * (1 - rescheduleBonusShare) * 100) / 100;
    const rescheduleDiff = oldBooking ? rescheduleNewPrice - (oldBooking.finalPrice || 0) : 0;


    const handleConfirm = async () => {
        // Synchronous re-entry guard — bail before any await if a submit is
        // already in flight (covers button double-tap + the alternative-cabinet
        // re-fire racing the async isSubmitting state).
        if (submittingRef.current) return;
        submittingRef.current = true;
        setIsSubmitting(true);
        try {
            // Validate guest form if no authenticated user
            if (!effectiveUser) {
                const trimmedName = guestName.trim();
                const trimmedEmail = guestEmail.trim();
                if (!trimmedName || !trimmedEmail) {
                    toast.error('Заполните имя и email для бронирования');
                    return;
                }
                // Minimal RFC-pragmatic email regex: local@host.tld, no spaces
                const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
                if (!emailOk) {
                    toast.error('Проверьте email — формат "name@example.com"');
                    return;
                }
            }

            if (cartDetails.length === 0) {
                toast.error('Корзина пуста — выберите время.');
                return;
            }

            // ── Recurring booking flow ──
            if (recurringPattern && cartDetails.length > 0 && !isRescheduling) {
                const item = cartDetails[0];
                const resource = RESOURCES.find(r => r.id === item.resourceId);
                try {
                    const result = await bookingsApi.createRecurringBooking({
                        resourceId: item.resourceId,
                        locationId: state.locationId || resource?.locationId || 'unbox_one',
                        startTime: item.startTime,
                        duration: item.duration,
                        format: state.format || 'individual',
                        // Серия: абонемент или «реши сам» (сервер: бонус → абонемент → баланс по каждой дате).
                        paymentMethod: resolveFinalMethod(state.paymentMethod, plan, true),
                        firstDate: format(new Date(state.date), 'yyyy-MM-dd'),
                        occurrences: recurringOccurrences,
                        pattern: recurringPattern,
                        crmClientId: selectedCrmClientId || undefined,
                        targetUserId: state.bookingForUser || undefined,
                    });
                    const patternLabel = recurringPattern === 'weekly' ? 'каждую неделю' : recurringPattern === 'biweekly' ? 'раз в 2 недели' : 'раз в 4 недели';
                    toast.success(`Серия создана: ${ruCountWord(result.created, ['бронь', 'брони', 'броней'])} (${patternLabel}), ${formatGel(result.totalCost ?? 0, { fraction: 0 })}`);
                    // Mark success BEFORE the refetch — the series IS created.
                    setConfirmed(true);
                    shouldResetOnUnmount.current = true;
                    // Refresh BOTH the user (balance) AND the bookings store —
                    // earlier we only refetched the user, so when the next
                    // chessboard render relied on a cached `bookings` array
                    // (e.g. when the destination route was already mounted),
                    // none of the new occurrences showed up. The chessboard's
                    // own useEffect on mount only fires on first mount.
                    //
                    // CRITICAL: swallow refetch errors. A failed refetch must
                    // NEVER bubble to the outer catch, which would render a
                    // "время занято"/conflict screen even though the series was
                    // created — the user would then retry and double-book.
                    await Promise.all([
                        fetchCurrentUser(),
                        useUserStore.getState().fetchBookings(),
                    ]).catch(() => {});
                    setTimeout(() => {
                        navigate(getMyBookingsPath(currentUser), { state: { targetDate: new Date(state.date).toISOString() } });
                    }, 2000);
                } catch (e: any) {
                    const detail = e?.response?.data?.detail;
                    if (typeof detail === 'object' && detail?.conflicts) {
                        const item = cartDetails[0];
                        if (item?.resourceId) {
                            setConflictState({
                                conflicts: detail.conflicts.map((c: any) => ({
                                    date: String(c.date || '').slice(0, 10),
                                    reason: c.reason
                                        || `${c.date}${c.start_time ? ' ' + c.start_time : ''} занято`,
                                })),
                                resourceId: item.resourceId,
                                time: item.startTime,
                                duration: item.duration,
                            });
                        } else {
                            toast.error(`Конфликт: заняты ${detail.conflicts.map((c: any) => c.date).join(', ')}`, { duration: 8000 });
                        }
                    } else {
                        toast.error(typeof detail === 'string' ? detail : e.message || 'Не удалось создать серию');
                    }
                }
                return;
            }

            // G3-03: раньше тип был только 'subscription' | 'balance', и выбор
            // «Бонусные часы — Бесплатно» уходил на сервер как 'balance' — с
            // баланса списывалась полная цена, а бонус оставался нетронутым.
            const finalMethod: PayMethod = resolveFinalMethod(state.paymentMethod, plan);

            // Check Balance (skip check if Admin is booking for another user - let Backend handle it or we need to fetch target user balance?
            // Ideally we check target user balance. But we might not have it loaded in 'currentUser'.
            // If bookingForUser is set, 'currentUser' is the Admin.
            // We should trust Backend check or relax this check for Admin.
            const isBookingForOther = !!state.bookingForUser && state.bookingForUser !== currentUser?.email;

            // Проверка баланса — только когда платим деньгами: бонусы и абонемент
            // сервер спишет часами (новичок с 0 ₾ и бонус-часом раньше получал
            // «Недостаточно средств» на «Забронировать бесплатно»). Перенос
            // сервер пересчитывает по способу оплаты самой брони: абонементная
            // едет как есть, остальные доплачивают разницу деньгами.
            const chargesMoney = isRescheduling
                ? (oldBooking?.paymentMethod ?? 'balance') !== 'subscription'
                : finalMethod === 'balance';
            if (effectiveUser && chargesMoney && !isBookingForOther) {
                let netPrice = totalPrice;
                if (isRescheduling && oldBooking && effectiveUser) {
                    netPrice = rescheduleDiff;
                }

                const projectedBalance = effectiveUser.balance - netPrice;
                if (projectedBalance < -(effectiveUser.creditLimit || 0)) {
                    const shortfall = Math.abs(projectedBalance + (effectiveUser.creditLimit || 0));
                    const hasSubscription = isSubscriptionEligible;

                    toast.custom((t) => (
                        <div className="w-full max-w-md bg-card rounded-2xl shadow-[var(--shadow-pop)] border border-ink-10 overflow-hidden relative">
                            <div className="p-5">
                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--status-danger-bg)] flex items-center justify-center text-[var(--status-danger-fg)]">
                                        <AlertCircle size={20} aria-hidden="true" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-semibold text-ink mb-1">
                                            Недостаточно средств для бронирования
                                        </h3>
                                        <p className="text-sm text-ink-60 leading-relaxed mb-3">
                                            Для бронирования не хватает <span className="num font-semibold text-[var(--status-danger-fg)]">{formatGel(shortfall)}</span>.
                                        </p>

                                        <div className="bg-sunken rounded-lg p-3 space-y-2 text-caption mb-3">
                                            <div className="flex justify-between">
                                                <span className="text-ink-60">Ваш баланс:</span>
                                                <span className={effectiveUser.balance < 0 ? "num text-[var(--status-danger-fg)] font-medium" : "num text-ink font-medium"}>
                                                    {formatGel(effectiveUser.balance)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-ink-60">Кредитный лимит:</span>
                                                <span className="num text-ink font-medium">
                                                    {formatGel(effectiveUser.creditLimit || 0)}
                                                </span>
                                            </div>
                                            <div className="h-px bg-ink-10 my-1"></div>
                                            <div className="flex justify-between font-semibold">
                                                <span className="text-ink">К оплате:</span>
                                                <span className="num text-ink">
                                                    {formatGel(netPrice)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Actionable guidance */}
                                        <div className="space-y-2 text-caption">
                                            <p className="font-semibold text-ink">Что можно сделать:</p>
                                            {hasSubscription && (
                                                <button
                                                    onClick={() => {
                                                        pickPay('subscription');
                                                        toast.dismiss(t);
                                                        toast.success('Способ оплаты изменён на абонемент');
                                                    }}
                                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] hover:brightness-95 transition-colors text-left"
                                                >
                                                    <Ticket size={16} className="shrink-0" aria-hidden="true" />
                                                    <span><strong>Списать с абонемента</strong> — у вас есть активный абонемент</span>
                                                </button>
                                            )}
                                            <a
                                                href="https://t.me/UnboxCenter"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="w-full flex items-start gap-2 px-3 py-2 rounded-lg border border-ink-20 text-ink hover:bg-ink-05 transition-colors cursor-pointer no-underline"
                                            >
                                                <MessageCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                                                <span>
                                                    <strong>Связаться с администратором</strong> — для пополнения баланса или установления кредитного лимита
                                                </span>
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-[var(--status-danger-bg)] px-4 py-3 flex justify-between items-center">
                                <span className="text-caption text-[var(--status-danger-fg)] font-medium">Не хватает: <span className="num">{formatGel(shortfall)}</span></span>
                                <UiButton variant="secondary" size="compact" onClick={() => toast.dismiss(t)}>
                                    Понятно
                                </UiButton>
                            </div>
                        </div>
                    ), { duration: Infinity });
                    return;
                }
            }
            // For Admin booking for other: we assume Admin knows what they are doing or Backend will reject.
            // Ideally prompt Admin "User has balance X, proceed?" but for now just bypass frontend block.

            // Create bookings array
            const newBookings: any[] = [];

            // Determine Payment Source Strategy (Global for the cart? Or per item? Usually global transaction)
            let currentPaymentSource: 'subscription' | 'deposit' | 'credit' = 'deposit';
            if (finalMethod === 'subscription') {
                currentPaymentSource = 'subscription';
            } else if (effectiveUser) {
                // Check if we are dipping into credit
                if (effectiveUser.balance < totalPrice) {
                    currentPaymentSource = 'credit';
                } else {
                    currentPaymentSource = 'deposit';
                }
            }

            // Create a booking for EACH cart item
            for (const item of cartDetails) {
                if (!item.resourceId) {
                    console.error("Missing resourceId for item", item);
                    continue; // Skip invalid items
                }

                const bookingData = {
                    id: Math.random().toString(36).substr(2, 9),
                    step: 4,
                    locationId: state.locationId || 'unbox_one', // Fallback
                    resourceId: item.resourceId,
                    format: state.format,
                    date: format(state.date, 'yyyy-MM-dd'),
                    startTime: item.startTime,
                    duration: item.duration,
                    extras: state.extras,
                    status: 'confirmed' as const,
                    createdAt: new Date().toISOString(),
                    finalPrice: item.price.finalPrice,
                    selectedSlots: [],
                    price: item.price,
                    paymentMethod: finalMethod,
                    paymentSource: currentPaymentSource, // Add source
                    hoursDeducted: finalMethod === 'subscription' ? (item.duration / 60) : 0,
                    targetUserId: state.bookingForUser || undefined, // Add target user
                    crmClientId: selectedCrmClientId || undefined, // CRM client link
                };
                newBookings.push(bookingData);
                // GCal sync is handled server-side: on booking confirm the
                // backend calls gcal_service.create_event(). The old
                // googleCalendarService.addEvent (mock) is gone.
            }

            if (newBookings.length > 0) {
                console.log(`Submitting ${newBookings.length} bookings...`);

                if (isRescheduling && state.editBookingId) {
                    // Reschedule a single existing booking — uses the new
                    // slot's date/time/resource. Critical: do NOT depend on
                    // `oldBooking` being present in the local store. When the
                    // wizard mounts before `bookings` is fetched (or the
                    // user reloads /checkout), `oldBooking` is null and the
                    // old code fell through to `addBookings`, creating a
                    // duplicate instead of moving the original.
                    const newSlot = newBookings[0];
                    await bookingsApi.rescheduleBooking(state.editBookingId, {
                        newDate: newSlot.date,
                        newStartTime: newSlot.startTime,
                        newResourceId: newSlot.resourceId,
                    });
                    // Mark success BEFORE the refetch — the move IS persisted.
                    setConfirmed(true);
                    shouldResetOnUnmount.current = true;
                    // Refetch both — user balance may have changed (price
                    // diff) and bookings array still holds the pre-move row.
                    // Swallow refetch errors so a failed GET can't bubble to
                    // the outer catch and masquerade as a booking conflict.
                    await Promise.all([
                        fetchCurrentUser(),
                        useUserStore.getState().fetchBookings(),
                    ]).catch(() => {});
                } else {
                    await addBookings(newBookings);
                    setConfirmed(true);
                    shouldResetOnUnmount.current = true;
                }

                // Check if booking is pending approval (hot booking) by checking store
                const latestBookings = useUserStore.getState().bookings;
                const isPending = latestBookings.some(b =>
                    b.status === 'pending_approval' || (b as any).status === 'pendingApproval'
                );

                // Check if any booking had GCal sync failure
                const hasGcalFailure = latestBookings.some(b => (b as any).gcalSyncFailed);

                if (isPending) {
                    toast.info('Запрос отправлен администратору — ждём подтверждения. Пришлём уведомление.');
                } else {
                    toast.success(isRescheduling ? 'Бронь перенесена' : 'Бронь создана');
                    if (!isRescheduling) {
                        // Invite the user to subscribe to Telegram booking notifications.
                        // Backend will only manage to send if the user has /start'ed the bot.
                        toast('Получайте уведомления о бронях в Telegram', {
                            icon: <MessageCircle size={16} aria-hidden="true" />,
                            description: 'Напишите /start нашему боту → @Unbox_Booking_G_Bot',
                            action: {
                                label: 'Открыть',
                                onClick: () => window.open('https://t.me/Unbox_Booking_G_Bot', '_blank'),
                            },
                            duration: 8000,
                        });
                    }
                }

                if (hasGcalFailure) {
                    toast.warning('Бронирование создано, но не синхронизировано с Google Calendar. Администратор уведомлён.');
                }

                // Navigate after showing success screen
                const bookingDate = state.date instanceof Date ? state.date.toISOString() : new Date(state.date).toISOString();
                setTimeout(() => {
                    navigate(getMyBookingsPath(currentUser), { state: { targetDate: bookingDate } });
                }, isPending ? 3000 : 2000);
            } else {
                toast.error('Не удалось оформить бронь. Попробуйте ещё раз.');
            }

        } catch (error: any) {
            console.error("Booking Confirmation Failed:", error);
            const detail = error.response?.data?.detail;
            const message = (typeof detail === 'string' ? detail : detail?.message)
                || "Произошла ошибка при подтверждении бронирования.";

            // 409/Conflict — open the branded dialog with own-vs-other split
            // + alternative-cabinet suggestions. Fall back to the single-slot
            // path when the backend didn't ship a structured conflicts list.
            const isConflict = message.includes("Time slot is already booked")
                || message.includes("уже занято")
                || message.includes("Conflict")
                || (typeof detail === 'object' && Array.isArray(detail?.conflicts));
            if (isConflict) {
                const firstSlot = cartDetails[0];
                const slotResourceId = firstSlot?.resourceId || state.resourceId;
                const slotTime = firstSlot?.startTime || state.startTime;
                const slotDuration = firstSlot?.duration || state.duration || 60;
                const baseDate = format(state.date, 'yyyy-MM-dd');

                let conflicts: ConflictItem[] = [];
                if (typeof detail === 'object' && Array.isArray(detail?.conflicts)) {
                    // Server returned a structured list (multi-slot / recurring).
                    conflicts = detail.conflicts.map((c: any) => ({
                        date: String(c.date || baseDate).slice(0, 10),
                        reason: c.reason || c.message || message,
                    }));
                } else {
                    conflicts = [{ date: baseDate, reason: message }];
                }

                if (slotResourceId && slotTime) {
                    setConflictState({
                        conflicts,
                        resourceId: slotResourceId,
                        time: slotTime,
                        duration: slotDuration,
                    });
                } else {
                    // Couldn't resolve the slot — fall back to a plain toast
                    // so the user at least sees what went wrong.
                    toast.error(message);
                }
            } else {
                toast.error(message);
            }
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    const handlePickAlternativeCabinet = (altResourceId: string) => {
        // Swap the cabinet, rewrite selectedSlots to point at it (keeping the
        // same times), and re-fire the booking. selectedSlots is keyed by
        // "resourceId|HH:MM" so a simple prefix swap is enough.
        const oldResourceId = conflictState?.resourceId;
        setConflictState(null);
        if (!oldResourceId) return;
        const newSlots = state.selectedSlots.map(s => {
            const parts = s.split('|');
            if (parts[0] === oldResourceId) {
                return `${altResourceId}|${parts[1]}`;
            }
            return s;
        });
        state.replaceSlots(newSlots);
        state.setResourceId(altResourceId);
        // Re-run the confirm flow in next tick so state has settled.
        setTimeout(() => { handleConfirm(); }, 0);
    };

    const handleAddToCalendar = () => {
        if (!state.startTime) return;
        const [h, m] = state.startTime.split(':').map(Number);
        const start = new Date(state.date);
        start.setHours(h, m, 0, 0);
        const end = new Date(start.getTime() + state.duration * 60000);

        const resource = RESOURCES.find(r => r.id === state.resourceId);
        const loc = resource?.locationId === 'unbox_one' ? 'Unbox One, ул. Палиашвили 4, Батуми'
            : resource?.locationId === 'unbox_uni' ? 'Unbox Uni, ул. Тбел Абусеридзе 38, Батуми'
            : resource?.locationId === 'neo_school' ? 'Neo School, ул. Сулаберидзе 80, Батуми'
            : 'Unbox, Батуми';
        const event = {
            title: `Unbox: ${resource?.name || 'Кабинет'}`,
            description: `${currentUser?.name || ''}\n${resource?.name || ''}, ${state.duration} мин`,
            location: loc,
            startTime: start,
            endTime: end
        };

        window.open(generateGoogleCalendarUrl(event), '_blank');
    };

    const handleDownloadIcs = () => {
        if (!state.startTime) return;
        const [h, m] = state.startTime.split(':').map(Number);
        const start = new Date(state.date);
        start.setHours(h, m, 0, 0);
        const end = new Date(start.getTime() + state.duration * 60000);

        const resource = RESOURCES.find(r => r.id === state.resourceId);
        const loc = resource?.locationId === 'unbox_one' ? 'Unbox One, ул. Палиашвили 4, Батуми'
            : resource?.locationId === 'unbox_uni' ? 'Unbox Uni, ул. Тбел Абусеридзе 38, Батуми'
            : resource?.locationId === 'neo_school' ? 'Neo School, ул. Сулаберидзе 80, Батуми'
            : 'Unbox, Батуми';
        const event = {
            title: `Unbox: ${resource?.name || 'Кабинет'}`,
            description: `${currentUser?.name || ''}\n${resource?.name || ''}, ${state.duration} мин`,
            location: loc,
            startTime: start,
            endTime: end
        };
        downloadIcsFile(event);
    };

    // --- Loading state while checking availability ---
    if (isCheckingAvailability) {
        return (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden="true" />
                <p className="text-ink-60 text-sm">Проверяем, свободно ли время…</p>
            </div>
        );
    }

    // --- Conflict detected: show inline error with Back button ---
    if (availabilityError) {
        // Extract time range from backend message: "Conflict with booking UUID (HH:MM-HH:MM)"
        const timeMatch = availabilityError.match(/\((\d{1,2}:\d{2})[–\-](\d{1,2}:\d{2})\)/);
        const timeRange = timeMatch ? `${timeMatch[1]}–${timeMatch[2]}` : null;

        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center text-center py-16 space-y-6"
            >
                <div className="w-20 h-20 rounded-full bg-[var(--status-danger-bg)] flex items-center justify-center text-[var(--status-danger-fg)]">
                    <AlertCircle size={40} aria-hidden="true" />
                </div>

                <div className="space-y-2 max-w-sm">
                    <h2 className="text-2xl font-semibold text-ink">Время уже занято</h2>
                    <p className="text-ink-60 leading-relaxed">
                        Это время только что занял кто-то другой.
                        {timeRange && (
                            <> Занято: <span className="num font-semibold text-ink">{timeRange}</span>.</>
                        )}
                    </p>
                    <p className="text-ink-60 text-sm">Выберите другое время.</p>
                </div>

                <Button
                    variant="outline"
                    size="lg"
                    onClick={() => navigate(-1)}
                    className="gap-2"
                >
                    <ArrowRight size={18} className="rotate-180" />
                    Вернуться к расписанию
                </Button>
            </motion.div>
        );
    }

    if (confirmed) {
        return (
            <div className="text-center py-12 animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle size={40} aria-hidden="true" />
                </div>
                <h2 className="text-heading font-semibold mb-4 text-ink">{isEditing ? (isRescheduling ? 'Бронирование перенесено!' : 'Бронирование обновлено!') : 'Бронирование подтверждено!'}</h2>
                <p className="text-ink-60 max-w-md mx-auto mb-8">
                    {isEditing ? 'Изменения сохранены.' : 'Мы отправили подтверждение на вашу почту. Ждём вас в Unbox!'}
                </p>

                <div className="flex flex-col sm:flex-row justify-center gap-4">
                    <Button variant="outline" onClick={handleAddToCalendar}>
                        <CalendarIcon size={18} className="mr-2" />
                        Google Calendar
                    </Button>
                    <Button variant="outline" onClick={handleDownloadIcs}>
                        <Download size={18} className="mr-2" />
                        Скачать .ics
                    </Button>
                    <Button onClick={() => window.location.reload()}>
                        <Home size={18} className="mr-2" />
                        На главную
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="space-y-4 sm:space-y-8"
        >
            <div>
                <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2">Подтверждение</h2>
                <p className="text-ink-60 text-sm sm:text-base">{effectiveUser ? 'Проверьте данные бронирования' : 'Заполните контактную информацию'}</p>
            </div>

            <div className="space-y-3 sm:space-y-4 max-w-md">
                {effectiveUser ? (
                    <div className="p-3 sm:p-4 rounded-xl"
                        style={{ background: COLOR.card, border: `1px solid ${COLOR.ink10}` }}>
                        <div className="text-xs sm:text-sm text-ink-60 mb-0.5">Бронирование на имя:</div>
                        <div className="font-semibold text-sm sm:text-base text-ink">{effectiveUser.name}</div>
                        <div className="text-xs sm:text-sm text-ink-60 mt-1.5 sm:mt-2">Контакты:</div>
                        <div className="text-sm text-ink">{effectiveUser.phone}</div>
                        <div className="text-sm text-ink">{effectiveUser.email}</div>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            <label htmlFor="guest-name" className="text-sm font-medium text-ink">Имя *</label>
                            <input id="guest-name" type="text" required value={guestName} onChange={(e) => setGuestName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-unbox-light bg-card focus:outline-none focus:ring-2 focus:ring-accent" placeholder="Иван Иванов" />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="guest-phone" className="text-sm font-medium text-ink">Телефон</label>
                            <PhoneInput id="guest-phone" value={guestPhone} onChange={setGuestPhone} className="w-full px-4 py-3 rounded-xl border border-unbox-light bg-card focus:outline-none focus:ring-2 focus:ring-accent" />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="guest-email" className="text-sm font-medium text-ink">Email *</label>
                            <input id="guest-email" type="email" required value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-unbox-light bg-card focus:outline-none focus:ring-2 focus:ring-accent" placeholder="ivan@example.com" />
                        </div>
                        {(!guestName.trim() || !guestEmail.trim()) && (
                            <p className="text-xs text-[var(--status-pending-fg)]">* Заполните имя и email для бронирования</p>
                        )}
                    </>
                )}
            </div>

            {/* Admin-proxy specialist picker — only for admins. Picking a
                specialist sets `bookingForUser` so the booking is owned by
                them (target_user_id), and the CRM-clients dropdown below
                refetches scoped to their roster. */}
            {isAdminActor && specialistChoices.length > 0 && (
                <div className="space-y-2 sm:space-y-3 pt-3 sm:pt-4 border-t border-unbox-light">
                    <h3 className="font-semibold text-base sm:text-lg text-ink flex items-center gap-2">
                        <UserIcon size={16} aria-hidden="true" /> За кого бронируете?
                    </h3>
                    <select
                        value={state.bookingForUser || ''}
                        onChange={(e) => {
                            const val = e.target.value || null;
                            state.setBookingForUser(val);
                            // Wipe selected client — old pick belongs to a
                            // different specialist's CRM and would 403 on submit.
                            setSelectedCrmClientId('');
                        }}
                        className="w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-accent text-sm sm:text-base text-ink bg-card"
                    >
                        <option value="">— За себя ({currentUser?.name || currentUser?.email}) —</option>
                        {specialistChoices
                            .filter(u => u.email !== currentUser?.email)
                            .map(u => (
                                <option key={u.id} value={u.email}>
                                    {u.name || u.email}
                                </option>
                            ))}
                    </select>
                    <p className="text-xs text-ink-60">
                        Бронь будет создана от имени выбранного специалиста (списание/абонемент тоже его).
                    </p>
                </div>
            )}

            {/* CRM Client Selector (for specialists) */}
            {crmClients.length > 0 && (
                <div className="space-y-2 sm:space-y-3 pt-3 sm:pt-4 border-t border-unbox-light">
                    <h3 className="font-semibold text-base sm:text-lg text-ink flex items-center gap-2">
                        <UserIcon size={16} aria-hidden="true" /> Привязать клиента
                    </h3>
                    <select
                        value={selectedCrmClientId}
                        onChange={(e) => setSelectedCrmClientId(e.target.value)}
                        className="w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-accent text-sm sm:text-base text-ink bg-card"
                    >
                        <option value="">— Без привязки к клиенту —</option>
                        {crmClients.map(c => (
                            <option key={c.id} value={c.id}>
                                {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-ink-60">Выберите клиента из CRM для привязки к бронированию</p>
                </div>
            )}

            {/* Payment Method Selector — при переносе способ оплаты не меняется. */}
            {effectiveUser && !isRescheduling && (
                <div className="space-y-2 sm:space-y-3 pt-3 sm:pt-4 border-t border-unbox-light">
                    <h3 className="font-semibold text-base sm:text-lg text-ink">Способ оплаты</h3>
                    {/* Варианты в порядке сервера: бонус → абонемент → баланс. */}
                    <div role="radiogroup" aria-label="Способ оплаты" className="grid gap-2 sm:gap-3">
                        {/* Option: Bonus */}
                        {totalBonusHours > 0 && !isSeries && !plan.free && (
                            <div
                                role="radio"
                                tabIndex={isBonusEligible ? 0 : -1}
                                aria-checked={payMethod === 'bonus'}
                                aria-disabled={!isBonusEligible}
                                className={`
                                    relative p-3 sm:p-4 rounded-xl border-2 cursor-pointer transition-all
                                    ${payMethod === 'bonus'
                                        ? 'border-accent bg-accent-soft ring-1 ring-accent'
                                        : 'border-ink-20 hover:border-ink-40 bg-card'}
                                    ${!isBonusEligible ? 'opacity-50 pointer-events-none' : ''}
                                `}
                                onClick={() => pickPay('bonus')}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        pickPay('bonus');
                                    }
                                }}
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${payMethod === 'bonus' ? 'border-accent' : 'border-ink-60'}`}>
                                            {payMethod === 'bonus' && <div className="w-2.5 h-2.5 rounded-full bg-accent" />}
                                        </div>
                                        <Gift size={16} className="text-ink-60" aria-hidden="true" />
                                        <span className="font-semibold text-ink">Бонусные часы</span>
                                    </div>
                                    <span className="font-semibold text-[var(--status-ok-fg)]">Бесплатно</span>
                                </div>
                                <div className="ml-7 text-xs text-ink-60 mt-1 font-medium">
                                    Доступно: {fmtHours(totalBonusHours)} бонусов
                                    {!isBonusEligible && <span className="text-ink ml-1">(нужно {fmtHours(totalBookingHours)})</span>}
                                </div>
                            </div>
                        )}

                        {/* Option: Subscription */}
                        <div
                            role="radio"
                            tabIndex={isSubscriptionEligible ? 0 : -1}
                            aria-checked={payMethod === 'subscription'}
                            aria-disabled={!isSubscriptionEligible}
                            className={`
                                relative p-3 sm:p-4 rounded-xl border-2 cursor-pointer transition-all
                                ${payMethod === 'subscription'
                                    ? 'border-accent bg-accent-soft ring-1 ring-accent'
                                    : 'border-ink-20 hover:border-ink-40 bg-card'}
                                ${!isSubscriptionEligible ? 'opacity-50 pointer-events-none' : ''}
                            `}
                            onClick={() => pickPay('subscription')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    pickPay('subscription');
                                }
                            }}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${payMethod === 'subscription' ? 'border-accent' : 'border-ink-60'}`}>
                                        {payMethod === 'subscription' && <div className="w-2.5 h-2.5 rounded-full bg-accent" />}
                                    </div>
                                    <span className="font-semibold text-ink">Списать с абонемента</span>
                                </div>
                                <span className="num font-semibold text-ink">
                                    {fmtHours(totalBookingHours)}{subMoney > 0 ? ` + ${formatGel(subMoney)}` : ''}
                                </span>
                            </div>
                            {effectiveUser.subscription && (
                                <div className="ml-7 text-xs text-ink-60 mt-1 font-medium">
                                    {subHours.ok ? subscriptionHoursLabel(subHours) : subHours.reason}
                                    {subHours.ok && !isSubscriptionEligible && <span className="text-ink ml-1">(нужно {fmtHours(totalBookingHours)})</span>}
                                </div>
                            )}
                            {/* Часть остатка уже обещана будущим броням — честно
                                говорим, что при нехватке часов крон за сутки до
                                встречи возьмёт деньги (billing_defer). */}
                            {payMethod === 'subscription' && !isSeries && !plan.subFreeCovers && (
                                <div className="ml-7 text-xs text-[var(--status-danger-fg)] mt-1">
                                    Свободно только {fmtHours(subHours.free)}: {fmtHours(subHours.reserved)} уже в других бронях. Если к списанию часов не хватит, одна из броней спишется с баланса по обычной цене.
                                </div>
                            )}
                        </div>

                        {/* Option: Balance/Deposit */}
                        <div
                            role="radio"
                            tabIndex={isSelectable('balance', plan, isSeries) ? 0 : -1}
                            aria-checked={payMethod === 'balance'}
                            aria-disabled={!isSelectable('balance', plan, isSeries)}
                            className={`
                                relative p-3 sm:p-4 rounded-xl border-2 cursor-pointer transition-all
                                ${payMethod === 'balance'
                                    ? 'border-accent bg-accent-soft ring-1 ring-accent'
                                    : 'border-ink-20 hover:border-ink-40 bg-card'}
                                ${!isSelectable('balance', plan, isSeries) ? 'opacity-50 pointer-events-none' : ''}
                            `}
                            onClick={() => pickPay('balance')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    pickPay('balance');
                                }
                            }}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${payMethod === 'balance' ? 'border-accent' : 'border-ink-60'}`}>
                                        {payMethod === 'balance' && <div className="w-2.5 h-2.5 rounded-full bg-accent" />}
                                    </div>
                                    <span className="font-semibold text-ink">Списать с баланса</span>
                                </div>
                                {isSelectable('balance', plan, isSeries) && (
                                    <span className="num font-semibold text-ink">{formatGel(totalPrice)}</span>
                                )}
                            </div>
                            <div className="ml-7 text-xs text-ink-60 mt-1 font-medium">
                                Текущий баланс: <span className="num">{formatGel(effectiveUser.balance)}</span>
                                {!isSelectable('balance', plan, isSeries) && (
                                    <span className="text-ink ml-1">· {balanceLockedReason(plan).toLowerCase()}</span>
                                )}
                                {isSeries && plan.subCovers && (
                                    <span className="text-ink ml-1">· сначала спишутся часы абонемента</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Extras accordion — owner 2026-05-27: merged here from the
                removed OptionsStep. Stays collapsed by default (90% of
                bookings have zero extras), expandable for the rare case. */}
            {effectiveUser && !isRescheduling && !isEditing && (
                <details
                    className="group pt-3 sm:pt-4 border-t border-unbox-light"
                    style={{ cursor: 'pointer' }}
                >
                    <summary
                        className="font-semibold text-base sm:text-lg text-ink flex items-center justify-between gap-2 list-none"
                    >
                        <span>Дополнительные услуги
                            {state.extras.length > 0 && (
                                <span className="ml-2 text-sm font-normal text-accent-ink">
                                    · {state.extras.length} выбрано
                                </span>
                            )}
                        </span>
                        <span className="text-xs text-ink-60 group-open:hidden">Показать</span>
                        <span className="text-xs text-ink-60 hidden group-open:inline">Скрыть</span>
                    </summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                        {availableExtrasForResource(
                            RESOURCES.find(r => r.id === cartDetails[0]?.resourceId)
                        ).map(e => {
                            const sel = state.extras.includes(e.id);
                            return (
                                <button
                                    key={e.id}
                                    type="button"
                                    onClick={() => state.toggleExtra(e.id)}
                                    aria-pressed={sel}
                                    className={`p-3 rounded-xl border text-left transition-colors ${
                                        sel
                                            ? 'bg-accent-soft border-accent'
                                            : 'bg-card border-ink-20 hover:border-ink-40'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium text-ink text-sm">{e.name}</span>
                                        <span className="num text-sm text-ink font-semibold">{formatGel(e.price, { sign: true })}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </details>
            )}

            {/* Recurring Booking Selector */}
            {effectiveUser && !isRescheduling && !isEditing && (
                <div className="space-y-2 sm:space-y-3 pt-3 sm:pt-4 border-t border-unbox-light">
                    <h3 className="font-semibold text-base sm:text-lg text-ink flex items-center gap-2">
                        <Repeat size={16} aria-hidden="true" /> Повторение
                    </h3>
                    <div className="grid grid-cols-4 gap-1.5">
                        {([
                            { id: '' as const, label: 'Разово' },
                            { id: 'weekly' as const, label: 'Каждую неделю' },
                            { id: 'biweekly' as const, label: 'Раз в 2 недели' },
                            { id: 'monthly' as const, label: 'Раз в 4 недели' },
                        ]).map(p => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => setRecurringPattern(p.id)}
                                aria-pressed={recurringPattern === p.id}
                                className={`py-2 sm:py-2.5 rounded-xl border text-xs font-semibold transition-colors text-center ${
                                    recurringPattern === p.id
                                        ? 'bg-accent text-on-accent border-accent'
                                        : 'border-ink-20 text-ink-60 hover:border-accent hover:text-accent-ink'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    {recurringPattern && (
                        <div className="flex items-center gap-2.5 bg-sunken rounded-xl px-3 py-2.5">
                            <input
                                type="number"
                                value={recurringOccurrences}
                                onChange={e => {
                                    const max = recurringPattern === 'monthly' ? 24 : 52;
                                    setRecurringOccurrences(Math.max(2, Math.min(max, Number(e.target.value))));
                                }}
                                min={2}
                                max={recurringPattern === 'monthly' ? 24 : 52}
                                className="w-16 px-2 py-1.5 rounded-lg border border-ink-20 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent bg-card"
                            />
                            <span className="text-xs text-ink-60">
                                повторений · {recurringPattern === 'monthly'
                                    ? `≈ ${Math.round(recurringOccurrences * 4 / 4.3)} мес.`
                                    : recurringPattern === 'biweekly'
                                        ? `≈ ${Math.round(recurringOccurrences / 2)} мес.`
                                        : `≈ ${Math.round(recurringOccurrences / 4.3)} мес.`}
                                {totalPrice > 0 && ` · ≈ ${formatGel(totalPrice * recurringOccurrences, { fraction: 0 })} всего`}
                            </span>
                        </div>
                    )}
                </div>
            )}

            <div className="pt-4 sm:pt-8 border-t border-unbox-light">
                {isRescheduling && oldBooking && (
                    <div className="mb-6 p-4 rounded-xl"
                        style={{ background: COLOR.card, border: `1px solid ${COLOR.ink10}` }}>
                        <h4 className="font-semibold flex items-center gap-2 text-ink mb-3">
                            <RefreshCw size={18} aria-hidden="true" /> Перенос бронирования
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                            {/* Old */}
                            <div className="text-ink-60">
                                <div className="text-xs uppercase font-semibold text-ink-60 mb-1">Было</div>
                                <div className="font-medium text-ink-80">
                                    {formatDayMonth(new Date(oldBooking.date))}, {oldBooking.startTime}
                                </div>
                                <div className="text-sm text-ink-60">
                                    {RESOURCES.find(r => r.id === oldBooking.resourceId)?.name}
                                </div>
                                <div className="num text-sm font-semibold mt-1 line-through text-ink-60">
                                    {formatGel(oldBooking.finalPrice)}
                                </div>
                            </div>
                            {/* Arrow */}
                            <div className="hidden md:flex justify-center text-ink-40">
                                <ArrowRight size={24} aria-hidden="true" />
                            </div>

                            {/* New — read from cartDetails first. state.startTime/
                                state.resourceId may still hold the OLD values
                                that startEditing pre-populated, so falling
                                back to them as a primary source made the
                                "Станет" panel show the time the user is
                                leaving instead of the new pick. */}
                            <div>
                                <div className="text-xs uppercase font-semibold text-accent-ink mb-1">Станет</div>
                                <div className="font-medium text-ink">
                                    {formatDayMonth(new Date(state.date))}, {cartDetails[0]?.startTime || state.startTime}
                                </div>
                                <div className="text-sm text-ink-60">
                                    {RESOURCES.find(r => r.id === (cartDetails[0]?.resourceId || state.resourceId))?.name}
                                </div>
                                <div className="num text-sm font-semibold mt-1 text-ink">
                                    {formatGel(rescheduleNewPrice)}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-unbox-light flex justify-between items-center text-sm">
                            <span className="text-ink">Разница к оплате:</span>
                            <span className="num font-semibold text-lg text-ink">
                                {rescheduleDiff > 0.005
                                    ? formatGel(rescheduleDiff, { sign: true })
                                    : rescheduleDiff < -0.005
                                        ? `${formatGel(rescheduleDiff)} (возврат)`
                                        : formatGel(0)
                                }
                            </span>
                        </div>
                    </div>
                )}

                <div className="flex gap-3 flex-col sm:flex-row">
                    <button
                        type="button"
                        onClick={() => state.setStep(state.step - 1)}
                        className="px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl border-2 border-unbox-light text-ink font-semibold text-sm sm:text-base hover:bg-ink-05 transition-colors cursor-pointer"
                    >
                        ← Назад
                    </button>
                    <Button size="lg" className="flex-1 md:flex-none" onClick={handleConfirm} disabled={isLoadingPricing || isSubmitting}>
                        {isLoadingPricing || isSubmitting
                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> {isLoadingPricing ? 'Считаем цену…' : 'Бронируем…'}</>
                            : isRescheduling
                                ? 'Подтвердить перенос'
                                : isEditing
                                    ? 'Сохранить изменения'
                                    : recurringPattern
                                        ? `Создать серию · ${ruCountWord(recurringOccurrences, ['бронь', 'брони', 'броней'])}`
                                        : payMethod === 'bonus'
                                            ? 'Забронировать бесплатно'
                                            : payMethod === 'subscription'
                                                ? `Списать ${fmtHours(totalBookingHours)} абонемента${subMoney > 0 ? ` + ${formatGel(subMoney)}` : ''}`
                                                : `Оплатить ${formatGel(totalPrice)}`
                        }
                    </Button>
                </div>
            </div>

            {conflictState && (
                <BookingConflictDialog
                    conflicts={conflictState.conflicts}
                    resourceId={conflictState.resourceId}
                    time={conflictState.time}
                    duration={conflictState.duration}
                    ownBookings={bookings}
                    onClose={() => setConflictState(null)}
                    onOpenBooking={(bookingId) => {
                        setConflictState(null);
                        // Drop the wizard reset on unmount so we don't wipe the
                        // booking the user is heading to in case they hit Back.
                        navigate(getMyBookingsPath(currentUser), {
                            state: { highlightBookingId: bookingId },
                        });
                    }}
                    onPickCabinet={handlePickAlternativeCabinet}
                />
            )}
        </motion.div>
    );
}
