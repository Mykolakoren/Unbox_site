import { useBookingStore } from '../store/bookingStore';
import { useUserStore } from '../store/userStore';
import type { PricingResult } from '../types';

import { Users, Clock, Tag, ShoppingCart, Zap, CalendarClock, TrendingUp, UserCheck } from 'lucide-react';
import { useMemo } from 'react';
import { calculatePrice } from '../utils/pricing';
import { EXTRAS, RESOURCES } from '../utils/data';
import { groupSlotsIntoBookings } from '../utils/cartHelpers';
import { startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';

const DISCOUNT_INFO: Record<PricingResult['discountType'], { label: string; Icon: React.ElementType } | null> = {
    none:     null,
    duration: { label: 'За длительность', Icon: CalendarClock },
    hot:      { label: 'Горячая бронь',   Icon: Zap },
    loyalty:  { label: 'Накопительная (за неделю)', Icon: TrendingUp },
    personal: { label: 'Персональная скидка', Icon: UserCheck },
};

export function Summary() {
    const state = useBookingStore();
    const { currentUser, bookings, users } = useUserStore();

    // Determine effective user for pricing
    const effectiveUser = state.bookingForUser
        ? users.find(u => u.email === state.bookingForUser) || currentUser
        : currentUser;

    // Calculate Accumulated Weekly Hours (Same logic as ConfirmationStep)
    const accumulatedWeeklyHours = useMemo(() => {
        if (!effectiveUser) return 0;
        const now = state.date;
        const start = startOfWeek(now, { weekStartsOn: 1 });
        const end = endOfWeek(now, { weekStartsOn: 1 });

        // Filter confirmed bookings for this week
        const weeklyBookings = bookings.filter(b =>
            b.userId === effectiveUser.email &&
            b.status === 'confirmed' &&
            isWithinInterval(new Date(b.date), { start, end })
        );

        return weeklyBookings.reduce((sum, b) => sum + (b.duration / 60), 0);
    }, [effectiveUser, bookings, state.date]);

    const { cartBookings, total } = useMemo(() => {
        // 1. Group slots
        const bookingsList = groupSlotsIntoBookings(state.selectedSlots, state.date);

        if (bookingsList.length === 0) {
            return {
                cartBookings: [],
                total: { basePrice: 0, extrasPrice: 0, discountAmount: 0, finalPrice: 0 }
            };
        }

        // 2. Calculate Total Volume (Cart + History Mock)

        // 3. Calculate Price for each booking
        let totalBase = 0;
        let totalExtras = 0;
        let totalDiscount = 0;
        let totalFinal = 0;

        const details = bookingsList.map(b => {
            const selectedExtras = EXTRAS.filter(e => state.extras.includes(e.id));

            // Create date objects
            const startDateTime = new Date(state.date);
            const [h, m] = b.startTime.split(':').map(Number);
            startDateTime.setHours(h, m, 0, 0);
            const endDateTime = new Date(startDateTime.getTime() + b.duration * 60000);

            const p = calculatePrice({
                format: state.format,
                startTime: startDateTime,
                endTime: endDateTime,
                extras: selectedExtras,
                paymentMethod: state.paymentMethod,
                resourceId: b.resourceId,
                accumulatedWeeklyHours: accumulatedWeeklyHours,
                // Pass User Settings
                personalDiscountPercent: effectiveUser?.personalDiscountPercent,
                pricingSystem: effectiveUser?.pricingSystem
            });

            totalBase += p.basePrice;
            totalExtras += p.extrasPrice;
            totalDiscount += p.discountAmount;
            totalFinal += p.finalPrice;

            return { ...b, price: p };
        });

        return {
            cartBookings: details,
            total: {
                basePrice: totalBase,
                extrasPrice: totalExtras,
                discountAmount: totalDiscount,
                finalPrice: totalFinal
            }
        };

    }, [state.selectedSlots, state.date, state.format, state.extras, state.paymentMethod, currentUser, bookings, accumulatedWeeklyHours]);

    const handleBack = () => {
        state.setStep(state.step - 1);
    };

    return (
        <div className="p-6 max-h-[calc(100vh-180px)] overflow-y-auto">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
                <ShoppingCart size={20} />
                Корзина ({cartBookings.length})
            </h2>

            {/* Bookings List */}
            <div className="space-y-4 mb-6">
                {cartBookings.length === 0 ? (
                    <div className="text-gray-400 text-sm text-center py-4">Выберите время в расписании</div>
                ) : (
                    cartBookings.map((b, idx) => (
                        <div key={idx} className="rounded-xl p-3 text-sm relative group"
                            style={{
                                background: 'rgba(255,255,255,0.35)',
                                backdropFilter: 'blur(20px) saturate(150%)',
                                WebkitBackdropFilter: 'blur(20px) saturate(150%)',
                                border: '1px solid rgba(255,255,255,0.55)',
                                boxShadow: '0 4px 12px rgba(71,109,107,0.06), inset 0 1px 0 rgba(255,255,255,0.60)',
                            }}>
                            <div className="flex justify-between font-medium">
                                <span>{RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId}</span>
                                <span>{b.price.finalPrice} ₾</span>
                            </div>
                            <div className="text-gray-500 flex gap-1 items-center">
                                <Clock size={12} />
                                {b.startTime} - {b.endTime} ({b.duration / 60} ч)
                            </div>
                            {b.price.discountAmount > 0 && (() => {
                                const info = DISCOUNT_INFO[b.price.discountType];
                                const pct = Math.round(b.price.discountAmount / b.price.basePrice * 100);
                                return (
                                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-unbox-green bg-unbox-light/60 rounded-md px-2 py-0.5 w-fit">
                                        {info && <info.Icon size={10} />}
                                        Скидка {pct}% · -{b.price.discountAmount.toFixed(1)} ₾
                                        {info && <span className="text-unbox-grey/80 font-normal">({info.label})</span>}
                                    </div>
                                );
                            })()}
                        </div>
                    ))
                )}
            </div>

            {/* Common Details */}
            {cartBookings.length > 0 && (
                <div className="space-y-3 mb-6 border-t border-gray-100 pt-4">
                    <div className="flex items-center gap-3 text-sm">
                        <div className="text-gray-400"><Clock size={16} /></div>
                        <div>
                            <div className="text-gray-500">Дата</div>
                            <div>{state.date.toLocaleDateString('ru-RU')}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                        <div className="text-gray-400"><Users size={16} /></div>
                        <div>
                            <div className="text-gray-500">Формат</div>
                            <div>{state.format === 'individual' ? 'Индивидуальный' : 'Групповой'}</div>
                        </div>
                    </div>

                    <div className="pt-2">
                        <div className="text-xs text-gray-400 mb-2 uppercase font-medium tracking-wider">Оплата за счет</div>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => state.setPaymentMethod('subscription')}
                                className="flex flex-col items-center justify-center p-2 rounded-xl transition-all"
                                style={state.paymentMethod === 'subscription' ? {
                                    background: 'rgba(212,226,225,0.70)',
                                    backdropFilter: 'blur(16px) saturate(150%)',
                                    WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                                    border: '1px solid rgba(71,109,107,0.35)',
                                    boxShadow: '0 2px 8px rgba(71,109,107,0.12), inset 0 1px 0 rgba(255,255,255,0.60)',
                                    color: '#2C3240',
                                } : {
                                    background: 'rgba(255,255,255,0.40)',
                                    backdropFilter: 'blur(16px) saturate(130%)',
                                    WebkitBackdropFilter: 'blur(16px) saturate(130%)',
                                    border: '1px solid rgba(255,255,255,0.55)',
                                    color: '#9299A3',
                                }}
                            >
                                <span className="text-sm font-medium">Абонемент</span>
                            </button>
                            <button
                                onClick={() => state.setPaymentMethod('balance')}
                                className="flex flex-col items-center justify-center p-2 rounded-xl transition-all"
                                style={state.paymentMethod === 'balance' ? {
                                    background: 'rgba(212,226,225,0.70)',
                                    backdropFilter: 'blur(16px) saturate(150%)',
                                    WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                                    border: '1px solid rgba(71,109,107,0.35)',
                                    boxShadow: '0 2px 8px rgba(71,109,107,0.12), inset 0 1px 0 rgba(255,255,255,0.60)',
                                    color: '#2C3240',
                                } : {
                                    background: 'rgba(255,255,255,0.40)',
                                    backdropFilter: 'blur(16px) saturate(130%)',
                                    WebkitBackdropFilter: 'blur(16px) saturate(130%)',
                                    border: '1px solid rgba(255,255,255,0.55)',
                                    color: '#9299A3',
                                }}
                            >
                                <span className="text-sm font-medium">Депозит</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="border-t border-gray-100 my-4 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Базовая стоимость</span>
                    <span>{total.basePrice} ₾</span>
                </div>
                {total.extrasPrice > 0 && (
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Доп. опции</span>
                        <span>+{total.extrasPrice} ₾</span>
                    </div>
                )}
                {total.discountAmount > 0 && (() => {
                    const dtype = cartBookings[0]?.price.discountType ?? 'none';
                    const info = DISCOUNT_INFO[dtype];
                    const pct = total.basePrice > 0
                        ? Math.round(total.discountAmount / total.basePrice * 100)
                        : 0;
                    return (
                        <div className="rounded-lg px-3 py-2 space-y-0.5"
                            style={{
                                background: 'rgba(212,226,225,0.45)',
                                backdropFilter: 'blur(16px) saturate(140%)',
                                WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                                border: '1px solid rgba(71,109,107,0.20)',
                                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)',
                            }}>
                            <div className="flex justify-between text-sm font-semibold text-unbox-green">
                                <span className="flex items-center gap-1.5">
                                    <Tag size={13} />
                                    Экономия {pct}%
                                </span>
                                <span>-{total.discountAmount.toFixed(1)} ₾</span>
                            </div>
                            {info && (
                                <div className="flex items-center gap-1 text-[11px] text-unbox-grey">
                                    <info.Icon size={10} />
                                    {info.label}
                                </div>
                            )}
                        </div>
                    );
                })()}
                <div className="flex justify-between items-center pt-2 text-xl font-bold">
                    <span>Итого</span>
                    <span>{total.finalPrice.toFixed(1)} ₾</span>
                </div>
            </div>

            {/* Navigation buttons are now handled within each Step component to avoid duplication.
                Step 1: ContextStep has 'Show Schedule'
                Step 2: ChessboardStep has 'Next'
                Step 3: OptionsStep has 'Continue'
                Step 4: ConfirmationStep has 'Pay'
            */}

            {state.step > 1 && (
                <button
                    onClick={handleBack}
                    className="w-full mt-3 text-sm text-gray-400 hover:text-gray-600"
                >
                    Назад
                </button>
            )}
        </div>
    );
}
