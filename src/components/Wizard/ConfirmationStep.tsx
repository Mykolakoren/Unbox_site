import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { Button } from '../ui/Button';
import { CheckCircle, Download, Home, Calendar as CalendarIcon, ArrowRight, RefreshCw, AlertTriangle } from 'lucide-react';
import { generateGoogleCalendarUrl, downloadIcsFile } from '../../utils/calendar';
import { googleCalendarService } from '../../services/googleCalendarMock';
import { useState, useMemo } from 'react';
import { calculatePrice } from '../../utils/pricing';
import { EXTRAS, RESOURCES } from '../../utils/data';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';


// ...

// ... (Imports and setup)
import { groupSlotsIntoBookings } from '../../utils/cartHelpers';

import { startOfWeek, endOfWeek, isWithinInterval, format } from 'date-fns';
import { ru } from 'date-fns/locale';

// ... (existing imports)

export function ConfirmationStep() {
    const state = useBookingStore();
    const { currentUser, addBookings, bookings, rescheduleBooking } = useUserStore();
    const [confirmed, setConfirmed] = useState(false);
    const navigate = useNavigate();

    const isEditing = !!state.editBookingId;
    const isRescheduling = state.mode === 'reschedule';

    // Fetch Old Booking for Comparison (if rescheduling)
    const oldBooking = useMemo(() => {
        if (!isRescheduling || !state.editBookingId) return null;
        return bookings.find(b => b.id === state.editBookingId);
    }, [isRescheduling, state.editBookingId, bookings]);

    // Calculate Accumulated Weekly Hours
    const accumulatedWeeklyHours = useMemo(() => {
        if (!currentUser) return 0;
        const now = state.date;
        const start = startOfWeek(now, { weekStartsOn: 1 });
        const end = endOfWeek(now, { weekStartsOn: 1 });

        // Filter confirmed bookings for this week
        const weeklyBookings = bookings.filter(b =>
            b.userId === currentUser.email &&
            b.status === 'confirmed' &&
            isWithinInterval(new Date(b.date), { start, end })
        );

        return weeklyBookings.reduce((sum, b) => sum + (b.duration / 60), 0);
    }, [currentUser, bookings, state.date]);

    // Calculate Price for ALL items in Cart
    const { cartDetails, totalPrice } = useMemo(() => {
        if (state.selectedSlots.length === 0) return { cartDetails: [], totalPrice: 0 };

        const bookingsList = groupSlotsIntoBookings(state.selectedSlots, state.date);

        let total = 0;
        console.log('--- Confirmation Debug ---');
        console.log('Slots:', state.selectedSlots);
        console.log('Bookings:', bookingsList);
        console.log('Accumulated Hours:', accumulatedWeeklyHours);
        const details = bookingsList.map(b => {
            const selectedExtras = EXTRAS.filter(e => state.extras.includes(e.id));
            const start = new Date(state.date);
            const [h, m] = b.startTime.split(':').map(Number);
            start.setHours(h, m, 0, 0);
            const end = new Date(start.getTime() + b.duration * 60000);

            const p = calculatePrice({
                format: state.format,
                startTime: start,
                endTime: end,
                extras: selectedExtras,
                paymentMethod: state.paymentMethod,
                resourceId: b.resourceId, // Use item's resourceId
                accumulatedWeeklyHours: accumulatedWeeklyHours,
                // User Settings
                personalDiscountPercent: currentUser?.personalDiscountPercent,
                pricingSystem: currentUser?.pricingSystem
            });
            console.log('Price for', b.startTime, p);
            total += p.finalPrice;
            return { ...b, price: p, startDateTime: start, endDateTime: end, resourceId: b.resourceId };
        });
        console.log('Total Price:', total);

        return { cartDetails: details, totalPrice: total };
    }, [state.selectedSlots, state.date, state.format, state.extras, state.paymentMethod, state.resourceId, accumulatedWeeklyHours]);

    // Payment method is now controlled by store (state.paymentMethod)

    // Determine if subscription is valid for this booking
    const { isSubscriptionEligible, subscriptionReason } = useMemo(() => {
        if (!currentUser?.subscription) return { isSubscriptionEligible: false, subscriptionReason: 'Нет абонемента' };
        if (currentUser.subscription.isFrozen) return { isSubscriptionEligible: false, subscriptionReason: 'Абонемент заморожен' };

        // Check hours
        const totalDurationHours = cartDetails.reduce((sum, item) => sum + (item.duration / 60), 0);
        if (currentUser.subscription.remainingHours < totalDurationHours - 0.1) { // -0.1 for float safety
            return { isSubscriptionEligible: false, subscriptionReason: `Недостаточно часов (${currentUser.subscription.remainingHours.toFixed(1)} доступно)` };
        }

        // Check format
        // Assumption: If includedFormats is missing, assume it covers everything (legacy) OR check prompt. 
        // Prompt said: "depending on ... individual or group". 
        // We added includedFormats to store. 
        const formats = currentUser.subscription.includedFormats || ['individual']; // Default to individual if missing
        if (!formats.includes(state.format)) {
            return { isSubscriptionEligible: false, subscriptionReason: `Абонемент только для ${formats.includes('individual') ? 'индивидуальной' : 'групповой'} работы` };
        }

        return { isSubscriptionEligible: true, subscriptionReason: '' };
    }, [currentUser, cartDetails, state.format]);

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
        try {
            if (cartDetails.length === 0) {
                toast.error("Ошибка: Корзина пуста. Пожалуйста, выберите время.");
                return;
            }

            const finalMethod: 'subscription' | 'balance' = (isSubscriptionEligible && state.paymentMethod === 'subscription') ? 'subscription' : 'balance';

            if (currentUser && finalMethod === 'balance') {
                const potentialBalance = currentUser.balance - totalPrice;
                // If Rescheduling, we consider the REFUND from old booking?
                // Simplified: Check absolute balance. If negative, verify limit.
                // Improve: Calculate Net Price (New - Old)

                let netPrice = totalPrice;
                if (isRescheduling && oldBooking) {
                    netPrice = totalPrice - oldBooking.finalPrice;
                }

                const projectedBalance = currentUser.balance - netPrice;
                if (projectedBalance < -currentUser.creditLimit) {
                    toast.error(`Ошибка: Недостаточно средств! \nВаш баланс: ${currentUser.balance} ₾\nКредитный лимит: ${currentUser.creditLimit} ₾\nК оплате (net): ${netPrice.toFixed(1)} ₾`);
                    return;
                }
            }

            // Create bookings array
            const newBookings: any[] = [];

            // Determine Payment Source Strategy (Global for the cart? Or per item? Usually global transaction)
            let currentPaymentSource: 'subscription' | 'deposit' | 'credit' = 'deposit';
            if (finalMethod === 'subscription') {
                currentPaymentSource = 'subscription';
            } else if (currentUser) {
                // Check if we are dipping into credit
                if (currentUser.balance < totalPrice) {
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
                    dateCreated: new Date().toISOString(),
                    finalPrice: item.price.finalPrice,
                    selectedSlots: [],
                    price: item.price,
                    paymentMethod: finalMethod,
                    paymentSource: currentPaymentSource, // Add source
                    hoursDeducted: finalMethod === 'subscription' ? (item.duration / 60) : 0
                };
                newBookings.push(bookingData);

                if (currentUser) {
                    // Sync to Google Calendar (Mock)
                    await googleCalendarService.addEvent({
                        resourceId: item.resourceId,
                        start: item.startDateTime.toISOString(),
                        end: item.endDateTime.toISOString(),
                        title: `Бронь: ${currentUser.name} (${state.format})`
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
                        addBookings(newBookings.slice(1));
                    }
                } else {
                    addBookings(newBookings);
                }

                setConfirmed(true);
                toast.success(isRescheduling ? 'Бронирование успешно перенесено!' : 'Бронирование успешно создано!');

                // Reset store and redirect AFTER delay, so user sees the success message
                setTimeout(() => {
                    state.reset();
                    navigate('/dashboard/bookings');
                }, 2000);
            } else {
                toast.error("Ошибка создания бронирования: не удалось сформировать данные.");
            }

        } catch (error) {
            console.error("Booking Confirmation Failed:", error);
            toast.error("Произошла ошибка при подтверждении бронирования.");
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

    if (confirmed) {
        return (
            <div className="text-center py-12 animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle size={40} />
                </div>
                <h2 className="text-3xl font-bold mb-4">{isEditing ? (isRescheduling ? 'Бронирование перенесено!' : 'Бронирование обновлено!') : 'Бронирование подтверждено!'}</h2>
                <p className="text-gray-500 max-w-md mx-auto mb-8">
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
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-bold mb-2">Подтверждение</h2>
                <p className="text-gray-500">{currentUser ? 'Проверьте данные бронирования' : 'Заполните контактную информацию'}</p>
            </div>

            <div className="space-y-4 max-w-md">
                {currentUser ? (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 dark:bg-gray-800 dark:border-gray-700">
                        <div className="text-sm text-gray-500 mb-1">Бронирование на имя:</div>
                        <div className="font-bold">{currentUser.name}</div>
                        <div className="text-sm text-gray-500 mt-2">Контакты:</div>
                        <div>{currentUser.phone}</div>
                        <div>{currentUser.email}</div>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Имя</label>
                            <input type="text" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black" placeholder="Иван Иванов" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Телефон</label>
                            <input type="tel" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black" placeholder="+995 555 00 00 00" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Email</label>
                            <input type="email" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black" placeholder="ivan@example.com" />
                        </div>
                    </>
                )}
            </div>

            {/* Payment Method Selector */}
            {currentUser && (
                <div className="space-y-3 pt-4 border-t border-gray-100">
                    <h3 className="font-bold text-lg">Способ оплаты</h3>
                    <div className="grid gap-3">
                        {/* Option: Subscription */}
                        <div
                            className={`
                                relative p-4 rounded-xl border-2 cursor-pointer transition-all
                                ${state.paymentMethod === 'subscription'
                                    ? 'border-black bg-gray-50'
                                    : 'border-gray-200 hover:border-gray-300'}
                                ${!isSubscriptionEligible ? 'opacity-50 pointer-events-none' : ''}
                            `}
                            onClick={() => isSubscriptionEligible && state.setPaymentMethod('subscription')}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${state.paymentMethod === 'subscription' ? 'border-black' : 'border-gray-300'}`}>
                                        {state.paymentMethod === 'subscription' && <div className="w-3 h-3 rounded-full bg-black" />}
                                    </div>
                                    <span className="font-medium">Списать с абонемента</span>
                                </div>
                                <span className="font-bold">
                                    {cartDetails.reduce((sum, i) => sum + i.duration / 60, 0)} ч
                                </span>
                            </div>
                            {currentUser.subscription && (
                                <div className="ml-7 text-xs text-gray-500 mt-1">
                                    Доступно: {currentUser.subscription.remainingHours} ч
                                    {!isSubscriptionEligible && <span className="text-red-500 ml-1">({subscriptionReason})</span>}
                                </div>
                            )}
                        </div>

                        {/* Option: Balance/Deposit */}
                        <div
                            className={`
                                relative p-4 rounded-xl border-2 cursor-pointer transition-all
                                ${state.paymentMethod === 'balance'
                                    ? 'border-black bg-gray-50'
                                    : 'border-gray-200 hover:border-gray-300'}
                            `}
                            onClick={() => state.setPaymentMethod('balance')}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${state.paymentMethod === 'balance' ? 'border-black' : 'border-gray-300'}`}>
                                        {state.paymentMethod === 'balance' && <div className="w-3 h-3 rounded-full bg-black" />}
                                    </div>
                                    <span className="font-medium">Списать с баланса</span>
                                </div>
                                <span className="font-bold">{totalPrice.toFixed(1)} ₾</span>
                            </div>
                            <div className="ml-7 text-xs text-gray-500 mt-1">
                                Текущий баланс: {currentUser.balance} ₾
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="pt-8 border-t border-gray-100">
                {isRescheduling && oldBooking && (
                    <div className="mb-6 bg-blue-50 p-4 rounded-xl border border-blue-100">
                        <h4 className="font-bold flex items-center gap-2 text-blue-800 mb-3">
                            <RefreshCw size={18} /> Перенос бронирования
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                            {/* Old */}
                            <div className="opacity-70">
                                <div className="text-xs uppercase font-bold text-gray-500 mb-1">Было</div>
                                <div className="font-medium text-gray-800">
                                    {format(new Date(oldBooking.date), 'd MMM', { locale: ru })}, {oldBooking.startTime}
                                </div>
                                <div className="text-sm text-gray-600">
                                    {RESOURCES.find(r => r.id === oldBooking.resourceId)?.name}
                                </div>
                                <div className="text-sm font-bold mt-1 line-through text-gray-400">
                                    {oldBooking.finalPrice} ₾
                                </div>
                            </div>

                            {/* Arrow */}
                            <div className="hidden md:flex justify-center text-blue-300">
                                <ArrowRight size={24} />
                            </div>

                            {/* New */}
                            <div>
                                <div className="text-xs uppercase font-bold text-blue-600 mb-1">Станет</div>
                                <div className="font-medium text-gray-900">
                                    {format(new Date(state.date), 'd MMM', { locale: ru })}, {state.startTime || cartDetails[0]?.startTime}
                                </div>
                                <div className="text-sm text-gray-600">
                                    {RESOURCES.find(r => r.id === (state.resourceId || cartDetails[0]?.resourceId))?.name}
                                </div>
                                <div className="text-sm font-bold mt-1 text-blue-700">
                                    {totalPrice} ₾
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-blue-100 flex justify-between items-center text-sm">
                            <span className="text-blue-800">Разница к оплате:</span>
                            <span className="font-bold text-lg">
                                {totalPrice - oldBooking.finalPrice > 0
                                    ? `+${(totalPrice - oldBooking.finalPrice).toFixed(1)} ₾`
                                    : `${(totalPrice - oldBooking.finalPrice).toFixed(1)} ₾ (Возврат)`
                                }
                            </span>
                        </div>
                    </div>
                )}

                <Button size="lg" className="w-full md:w-auto" onClick={handleConfirm}>
                    {isRescheduling
                        ? 'Подтвердить перенос'
                        : isEditing
                            ? 'Сохранить изменения'
                            : state.paymentMethod === 'subscription'
                                ? `Списать ${cartDetails.reduce((sum, i) => sum + i.duration / 60, 0)} ч`
                                : `Оплатить ${totalPrice.toFixed(1)} ₾`
                    }
                </Button>
            </div>
        </div>
    );
}
