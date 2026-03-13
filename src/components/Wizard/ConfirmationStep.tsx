import { useBookingStore } from '../../store/bookingStore';
import { calculatePrice } from '../../utils/pricing';
import { useUserStore } from '../../store/userStore';
import { bookingsApi } from '../../api/bookings';
import { Button } from '../ui/Button';
import {
    CheckCircle,
    Download,
    Calendar as CalendarIcon,
    ArrowRight,
    RefreshCw,
    Home,
    Loader2,
    AlertCircle,
} from 'lucide-react';
import { generateGoogleCalendarUrl, downloadIcsFile } from '../../utils/calendar';
import { googleCalendarService } from '../../services/googleCalendarMock';
import { useState, useMemo, useEffect, useRef } from 'react';
import { EXTRAS, RESOURCES } from '../../utils/data';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { groupSlotsIntoBookings } from '../../utils/cartHelpers';
import { format, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { ru } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { useCrmStore } from '../../store/crmStore';
import { User as UserIcon } from 'lucide-react';

export function ConfirmationStep() {
    const state = useBookingStore();
    const { currentUser, addBookings, bookings, rescheduleBooking, users } = useUserStore();
    const [confirmed, setConfirmed] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [availabilityError, setAvailabilityError] = useState<string | null>(null);
    const [isCheckingAvailability, setIsCheckingAvailability] = useState(true);
    const [selectedCrmClientId, setSelectedCrmClientId] = useState<string>('');
    const { clients: crmClients, fetchClients: fetchCrmClients } = useCrmStore();
    const navigate = useNavigate();
    const shouldResetOnUnmount = useRef(false);

    // Fetch CRM clients for specialist users
    useEffect(() => {
        if (currentUser) fetchCrmClients(true).catch(() => {});
    }, [currentUser, fetchCrmClients]);

    // Reset booking state only after unmount (route change) to avoid race with <Navigate to="/" />
    useEffect(() => {
        return () => {
            if (shouldResetOnUnmount.current) {
                state.reset();
            }
        };
    }, []);

    // Pre-check availability on mount — before showing payment form.
    // cartDetails is computed synchronously via useMemo, so it's ready at first render.
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
    }, []); // eslint-disable-line react-hooks/exhaustive-deps — run once on mount

    // Determine effective user for pricing and logic
    const effectiveUser = state.bookingForUser
        ? users?.find(u => u.email === state.bookingForUser) || currentUser
        : currentUser;

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

    // Determine if subscription is valid for this booking
    const { isSubscriptionEligible, subscriptionReason } = useMemo(() => {
        if (!effectiveUser?.subscription) return { isSubscriptionEligible: false, subscriptionReason: 'Нет абонемента' };
        if (effectiveUser.subscription.isFrozen) return { isSubscriptionEligible: false, subscriptionReason: 'Абонемент заморожен' };

        // Check hours
        const totalDurationHours = cartDetails.reduce((sum, item) => sum + (item.duration / 60), 0);
        if (effectiveUser.subscription.remainingHours < totalDurationHours - 0.1) { // -0.1 for float safety
            return { isSubscriptionEligible: false, subscriptionReason: `Недостаточно часов (${effectiveUser.subscription.remainingHours.toFixed(1)} доступно)` };
        }

        // Check format
        // Assumption: If includedFormats is missing, assume it covers everything (legacy) OR check prompt. 
        // Prompt said: "depending on ... individual or group". 
        // We added includedFormats to store. 
        const formats = effectiveUser.subscription.includedFormats || ['individual']; // Default to individual if missing
        if (!formats.includes(state.format)) {
            return { isSubscriptionEligible: false, subscriptionReason: `Абонемент только для ${formats.includes('individual') ? 'индивидуальной' : 'групповой'} работы` };
        }

        return { isSubscriptionEligible: true, subscriptionReason: '' };
    }, [effectiveUser, cartDetails, state.format]);

    // Auto-select subscription if eligible and balance logic prefers it? 
    // Or just default to balance. Let's default to balance but maybe switch to sub if balance is low? 
    // Let's keep simple default: Balance. Or 'subscription' if eligible? 
    // Prompt: "add button indicating write off from subscription (if available)". 
    // Ideally we default to Subscription if available as it saves money. 
    // Auto-select subscription if eligible?
    // We already do this via default paymentMethod in store or user action.
    // Logic: if current method is 'subscription' but not eligible, switch to 'balance'.
    useMemo(() => {
        if (!isSubscriptionEligible && state.paymentMethod === 'subscription') {
            state.setPaymentMethod('balance');
        }
    }, [isSubscriptionEligible, state.paymentMethod]);


    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            if (cartDetails.length === 0) {
                toast.error("Ошибка: Корзина пуста. Пожалуйста, выберите время.");
                return;
            }

            const finalMethod: 'subscription' | 'balance' = (isSubscriptionEligible && state.paymentMethod === 'subscription') ? 'subscription' : 'balance';

            // Check Balance (skip check if Admin is booking for another user - let Backend handle it or we need to fetch target user balance?
            // Ideally we check target user balance. But we might not have it loaded in 'currentUser'.
            // If bookingForUser is set, 'currentUser' is the Admin.
            // We should trust Backend check or relax this check for Admin.
            const isBookingForOther = !!state.bookingForUser && state.bookingForUser !== currentUser?.email;

            if (effectiveUser && finalMethod === 'balance' && !isBookingForOther) {
                let netPrice = totalPrice;
                if (isRescheduling && oldBooking && effectiveUser) {
                    netPrice = totalPrice - oldBooking.finalPrice;
                }

                const projectedBalance = effectiveUser.balance - netPrice;
                if (projectedBalance < -(effectiveUser.creditLimit || 0)) {
                    toast.custom((t) => (
                        <div className="w-full bg-white rounded-2xl shadow-xl border-l-4 border-red-500 overflow-hidden relative">
                            <div className="p-4">
                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-bold text-unbox-dark mb-1">
                                            Недостаточно средств
                                        </h3>
                                        <p className="text-sm text-unbox-grey leading-relaxed mb-3">
                                            Сумма бронирования превышает доступный лимит.
                                        </p>

                                        <div className="bg-unbox-light/30 rounded-lg p-3 space-y-2 text-xs">
                                            <div className="flex justify-between">
                                                <span className="text-unbox-grey">Ваш баланс:</span>
                                                <span className={effectiveUser.balance < 0 ? "text-red-600 font-medium" : "text-unbox-dark font-medium"}>
                                                    {effectiveUser.balance.toFixed(1)} ₾
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-unbox-grey">Кредитный лимит:</span>
                                                <span className="text-unbox-dark font-medium">
                                                    {effectiveUser.creditLimit || 0} ₾
                                                </span>
                                            </div>
                                            <div className="h-px bg-gray-200 my-1"></div>
                                            <div className="flex justify-between font-bold">
                                                <span className="text-unbox-dark">К оплате:</span>
                                                <span className="text-unbox-dark">
                                                    {netPrice.toFixed(1)} ₾
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toast.dismiss(t)}
                                        className="text-unbox-grey hover:text-unbox-grey transition-colors"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                    </button>
                                </div>
                            </div>
                            <div className="bg-red-50 px-4 py-2 border-t border-red-100 flex justify-between items-center">
                                <span className="text-xs text-red-600 font-medium">Не хватает: {Math.abs(projectedBalance + (effectiveUser.creditLimit || 0)).toFixed(1)} ₾</span>
                            </div>
                        </div>
                    ), { duration: 5000 });
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
                    date: state.date,
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

                if (effectiveUser) {
                    // Sync to Google Calendar (Mock)
                    await googleCalendarService.addEvent({
                        resourceId: item.resourceId,
                        start: item.startDateTime.toISOString(),
                        end: item.endDateTime.toISOString(),
                        title: `Бронь: ${effectiveUser.name} (${state.format})`
                    });
                }
            }

            if (newBookings.length > 0) {
                console.log(`Submitting ${newBookings.length} bookings...`);

                if (isRescheduling && oldBooking) {
                    // Reschedule Action
                    // Assuming 1:1 mapping for simplicity in this flow (User modifies 1 booking into 1 or more?)
                    // If cart has multiple items, Reschedule assumes we are replacing ONE old booking with MANY?
                    // Or usually 1 to 1.
                    // Let's assume the first item in cart replaces the old booking.
                    // Warn logic: "Reschedule" usually implies 1 slot -> 1 slot.
                    // But our cart allows multiple.
                    // We will mark old as Rescheduled and Add ALL new ones.
                    rescheduleBooking(oldBooking.id, newBookings[0]);
                    // Note: If multiple new bookings, we only pass first one to "reschedule" action linked?
                    // The action expects `newBooking` object.
                    // If user added 2 slots, we really are just cancelling old and adding 2 new.
                    // But for status tracking, we link 1.

                    if (newBookings.length > 1) {
                        // Add others manually
                        await addBookings(newBookings.slice(1));
                    }
                } else {
                    await addBookings(newBookings);
                }

                setConfirmed(true);
                shouldResetOnUnmount.current = true;
                toast.success(isRescheduling ? 'Бронирование успешно перенесено!' : 'Бронирование успешно создано!');

                // Navigate after showing success screen; reset happens in useEffect cleanup on unmount
                setTimeout(() => {
                    navigate('/dashboard/bookings');
                }, 2000);
            } else {
                toast.error("Ошибка создания бронирования: не удалось сформировать данные.");
            }

        } catch (error: any) {
            console.error("Booking Confirmation Failed:", error);
            const message = error.response?.data?.detail || "Произошла ошибка при подтверждении бронирования.";

            if (message.includes("Time slot is already booked") || message.includes("Conflict")) {
                toast.custom((t) => (
                    <div className="w-full bg-white rounded-2xl shadow-xl border-l-4 border-red-500 overflow-hidden relative">
                        <div className="p-4">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500">
                                    <CalendarIcon size={20} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-sm font-bold text-unbox-dark mb-1">
                                        Время уже занято
                                    </h3>
                                    <p className="text-sm text-unbox-grey leading-relaxed mb-2">
                                        К сожалению, выбранный слот был забронирован другим пользователем.
                                    </p>
                                    <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-xs font-medium border border-red-100">
                                        {message.replace("Time slot is already booked: ", "")}
                                    </div>
                                </div>
                                <button
                                    onClick={() => toast.dismiss(t)}
                                    className="text-unbox-grey hover:text-unbox-grey transition-colors"
                                >
                                    <ArrowRight size={16} className="rotate-45" />
                                </button>
                            </div>
                        </div>
                    </div>
                ), { duration: 5000 });
            } else {
                toast.error(message);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddToCalendar = () => {
        if (!state.startTime) return;
        const [h, m] = state.startTime.split(':').map(Number);
        const start = new Date(state.date);
        start.setHours(h, m, 0, 0);
        const end = new Date(start.getTime() + state.duration * 60000);

        const event = {
            title: `Бронирование Unbox: ${state.resourceId === 'cabinet-5' ? 'Кабинет 5' : 'Капсула 1'}`,
            description: `Бронирование в Unbox. ${state.format === 'individual' ? 'Индивидуально' : 'Группа'}.`,
            location: 'Unbox, Tbilisi',
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

        const event = {
            title: `Бронирование Unbox: ${state.resourceId === 'cabinet-5' ? 'Кабинет 5' : 'Капсула 1'}`,
            description: `Бронирование в Unbox. ${state.format === 'individual' ? 'Индивидуально' : 'Группа'}.`,
            location: 'Unbox, Tbilisi',
            startTime: start,
            endTime: end
        };
        downloadIcsFile(event);
    };

    // --- Loading state while checking availability ---
    if (isCheckingAvailability) {
        return (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-unbox-green" />
                <p className="text-unbox-grey text-sm">Проверяем доступность слота...</p>
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
                <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center text-red-500">
                    <AlertCircle size={40} />
                </div>

                <div className="space-y-2 max-w-sm">
                    <h2 className="text-2xl font-bold text-unbox-dark">Время уже занято</h2>
                    <p className="text-unbox-grey leading-relaxed">
                        К сожалению, выбранный слот был забронирован другим пользователем.
                        {timeRange && (
                            <> Конфликт: <span className="font-semibold text-unbox-dark">{timeRange}</span>.</>
                        )}
                    </p>
                    <p className="text-unbox-grey text-sm">Пожалуйста, выберите другое время.</p>
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
                <div className="w-20 h-20 bg-unbox-light text-unbox-green rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle size={40} />
                </div>
                <h2 className="text-3xl font-bold mb-4 text-unbox-dark">{isEditing ? (isRescheduling ? 'Бронирование перенесено!' : 'Бронирование обновлено!') : 'Бронирование подтверждено!'}</h2>
                <p className="text-unbox-grey max-w-md mx-auto mb-8">
                    {isEditing ? 'Изменения успешно сохранены.' : 'Мы отправили подтверждение на вашу почту. Ждем вас в Unbox!'}
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
            className="space-y-8"
        >
            <div>
                <h2 className="text-2xl font-bold mb-2">Подтверждение</h2>
                <p className="text-unbox-grey">{effectiveUser ? 'Проверьте данные бронирования' : 'Заполните контактную информацию'}</p>
            </div>

            <div className="space-y-4 max-w-md">
                {effectiveUser ? (
                    <div className="p-4 rounded-xl"
                        style={{
                            background: 'rgba(255,255,255,0.35)',
                            backdropFilter: 'blur(24px) saturate(150%)',
                            WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                            border: '1px solid rgba(255,255,255,0.55)',
                            boxShadow: '0 4px 16px rgba(71,109,107,0.06), inset 0 1px 0 rgba(255,255,255,0.70)',
                        }}>
                        <div className="text-sm text-unbox-grey mb-1">Бронирование на имя:</div>
                        <div className="font-bold text-unbox-dark">{effectiveUser.name}</div>
                        <div className="text-sm text-unbox-grey mt-2">Контакты:</div>
                        <div className="text-unbox-dark">{effectiveUser.phone}</div>
                        <div className="text-unbox-dark">{effectiveUser.email}</div>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-unbox-dark">Имя</label>
                            <input type="text" className="w-full px-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green" placeholder="Иван Иванов" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-unbox-dark">Телефон</label>
                            <input type="tel" className="w-full px-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green" placeholder="+995 555 00 00 00" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-unbox-dark">Email</label>
                            <input type="email" className="w-full px-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green" placeholder="ivan@example.com" />
                        </div>
                    </>
                )}
            </div>

            {/* CRM Client Selector (for specialists) */}
            {crmClients.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-unbox-light">
                    <h3 className="font-bold text-lg text-unbox-dark flex items-center gap-2">
                        <UserIcon size={18} /> Привязать клиента
                    </h3>
                    <select
                        value={selectedCrmClientId}
                        onChange={(e) => setSelectedCrmClientId(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green text-unbox-dark bg-white"
                    >
                        <option value="">— Без привязки к клиенту —</option>
                        {crmClients.map(c => (
                            <option key={c.id} value={c.id}>
                                {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-unbox-grey">Выберите клиента из CRM для привязки к бронированию</p>
                </div>
            )}

            {/* Payment Method Selector */}
            {effectiveUser && (
                <div className="space-y-3 pt-4 border-t border-unbox-light">
                    <h3 className="font-bold text-lg text-unbox-dark">Способ оплаты</h3>
                    <div className="grid gap-3">
                        {/* Option: Subscription */}
                        <div
                            className={`
                                relative p-4 rounded-xl border-2 cursor-pointer transition-all shadow-sm hover:shadow-md
                                ${state.paymentMethod === 'subscription'
                                    ? 'border-unbox-green bg-unbox-light/50 ring-1 ring-unbox-green'
                                    : 'border-gray-300 hover:border-gray-400 bg-white'}
                                ${!isSubscriptionEligible ? 'opacity-50 pointer-events-none' : ''}
                            `}
                            onClick={() => isSubscriptionEligible && state.setPaymentMethod('subscription')}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${state.paymentMethod === 'subscription' ? 'border-unbox-green' : 'border-gray-300'}`}>
                                        {state.paymentMethod === 'subscription' && <div className="w-2.5 h-2.5 rounded-full bg-unbox-green" />}
                                    </div>
                                    <span className="font-bold text-unbox-dark">Списать с абонемента</span>
                                </div>
                                <span className="font-bold text-unbox-dark">
                                    {cartDetails.reduce((sum, i) => sum + i.duration / 60, 0)} ч
                                </span>
                            </div>
                            {effectiveUser.subscription && (
                                <div className="ml-7 text-xs text-unbox-grey mt-1 font-medium">
                                    Доступно: {effectiveUser.subscription.remainingHours} ч
                                    {!isSubscriptionEligible && <span className="text-unbox-dark ml-1">({subscriptionReason})</span>}
                                </div>
                            )}
                        </div>

                        {/* Option: Balance/Deposit */}
                        <div
                            className={`
                                relative p-4 rounded-xl border-2 cursor-pointer transition-all shadow-sm hover:shadow-md
                                ${state.paymentMethod === 'balance'
                                    ? 'border-unbox-green bg-unbox-light/50 ring-1 ring-unbox-green'
                                    : 'border-gray-300 hover:border-gray-400 bg-white'}
                            `}
                            onClick={() => state.setPaymentMethod('balance')}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${state.paymentMethod === 'balance' ? 'border-unbox-green' : 'border-gray-300'}`}>
                                        {state.paymentMethod === 'balance' && <div className="w-2.5 h-2.5 rounded-full bg-unbox-green" />}
                                    </div>
                                    <span className="font-bold text-unbox-dark">Списать с баланса</span>
                                </div>
                                <span className="font-bold text-unbox-dark">{totalPrice.toFixed(1)} ₾</span>
                            </div>
                            <div className="ml-7 text-xs text-unbox-grey mt-1 font-medium">
                                Текущий баланс: {effectiveUser.balance} ₾
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="pt-8 border-t border-unbox-light">
                {isRescheduling && oldBooking && (
                    <div className="mb-6 p-4 rounded-xl"
                        style={{
                            background: 'rgba(255,255,255,0.35)',
                            backdropFilter: 'blur(24px) saturate(150%)',
                            WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                            border: '1px solid rgba(255,255,255,0.55)',
                            boxShadow: '0 4px 16px rgba(71,109,107,0.06), inset 0 1px 0 rgba(255,255,255,0.70)',
                        }}>
                        <h4 className="font-bold flex items-center gap-2 text-unbox-dark mb-3">
                            <RefreshCw size={18} /> Перенос бронирования
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                            {/* Old */}
                            <div className="opacity-70 text-unbox-dark/80">
                                <div className="text-xs uppercase font-bold text-unbox-grey mb-1">Было</div>
                                <div className="font-medium text-unbox-dark">
                                    {format(new Date(oldBooking.date), 'd MMM', { locale: ru })}, {oldBooking.startTime}
                                </div>
                                <div className="text-sm text-unbox-grey">
                                    {RESOURCES.find(r => r.id === oldBooking.resourceId)?.name}
                                </div>
                                <div className="text-sm font-bold mt-1 line-through text-unbox-grey">
                                    {oldBooking.finalPrice} ₾
                                </div>
                            </div>
                            {/* Arrow */}
                            <div className="hidden md:flex justify-center text-unbox-grey">
                                <ArrowRight size={24} />
                            </div>

                            {/* New */}
                            <div>
                                <div className="text-xs uppercase font-bold text-unbox-green mb-1">Станет</div>
                                <div className="font-medium text-unbox-dark">
                                    {format(new Date(state.date), 'd MMM', { locale: ru })}, {state.startTime || cartDetails[0]?.startTime}
                                </div>
                                <div className="text-sm text-unbox-grey">
                                    {RESOURCES.find(r => r.id === (state.resourceId || cartDetails[0]?.resourceId))?.name}
                                </div>
                                <div className="text-sm font-bold mt-1 text-unbox-green">
                                    {totalPrice} ₾
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-unbox-light flex justify-between items-center text-sm">
                            <span className="text-unbox-dark">Разница к оплате:</span>
                            <span className="font-bold text-lg text-unbox-dark">
                                {totalPrice - oldBooking.finalPrice > 0
                                    ? `+${(totalPrice - oldBooking.finalPrice).toFixed(1)} ₾`
                                    : `${(totalPrice - oldBooking.finalPrice).toFixed(1)} ₾ (Возврат)`
                                }
                            </span>
                        </div>
                    </div>
                )}

                <Button size="lg" className="w-full md:w-auto" onClick={handleConfirm} disabled={isLoadingPricing || isSubmitting}>
                    {isLoadingPricing || isSubmitting
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {isLoadingPricing ? 'Расчет цены...' : 'Оформление...'}</>
                        : isRescheduling
                            ? 'Подтвердить перенос'
                            : isEditing
                                ? 'Сохранить изменения'
                                : state.paymentMethod === 'subscription'
                                    ? `Списать ${cartDetails.reduce((sum, i) => sum + i.duration / 60, 0)} ч`
                                    : `Оплатить ${totalPrice.toFixed(1)} ₾`
                    }
                </Button>
            </div>
        </motion.div>
    );
}
