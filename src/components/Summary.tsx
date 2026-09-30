import { useBookingStore } from '../store/bookingStore';
import { useUserStore } from '../store/userStore';
import type { PricingResult } from '../types';

import { Users, Clock, Tag, ShoppingCart, Zap, CalendarClock, TrendingUp, UserCheck, Sunrise, Plus, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { calculatePrice } from '../utils/pricing';
import { EXTRAS, RESOURCES } from '../utils/data';
import { groupSlotsIntoBookings } from '../utils/cartHelpers';
import { startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { COLOR, STATUS } from '../design/tokens';
import { formatDateLabel, formatGel, formatTimeRange } from '../utils/format';

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
        let totalPeakSurcharge = 0;
        let totalSubPeakDebt = 0;

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
            totalPeakSurcharge += p.peakSurcharge;
            totalSubPeakDebt += p.subscriptionPeakDebt;

            return { ...b, price: p };
        });

        return {
            cartBookings: details,
            total: {
                basePrice: totalBase,
                extrasPrice: totalExtras,
                discountAmount: totalDiscount,
                finalPrice: totalFinal,
                peakSurcharge: totalPeakSurcharge,
                subscriptionPeakDebt: totalSubPeakDebt,
            }
        };

    }, [state.selectedSlots, state.date, state.format, state.extras, state.paymentMethod, currentUser, bookings, accumulatedWeeklyHours]);

    const handleBack = () => {
        state.setStep(state.step - 1);
    };

    return (
        <div className="p-6 max-h-[calc(100vh-180px)] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <ShoppingCart size={20} aria-hidden="true" />
                Корзина ({cartBookings.length})
            </h2>

            {/* Bookings List */}
            <div className="space-y-4 mb-6">
                {cartBookings.length === 0 ? (
                    <div className="text-ink-60 text-sm text-center py-4">Выберите время в расписании</div>
                ) : (
                    cartBookings.map((b, idx) => {
                        // Excel #24 — show "+ Ещё период" only once per resource (on the
                        // last cart entry for that resource), and only when not
                        // already in add-mode for this resource.
                        const isLastForResource = !cartBookings
                            .slice(idx + 1)
                            .some(next => next.resourceId === b.resourceId);
                        const resourceLabel = RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId;
                        return (
                            <div key={idx} className="rounded-xl p-3 text-sm relative group"
                                style={{ background: COLOR.card, border: `1px solid ${COLOR.ink10}` }}>
                                <div className="flex justify-between font-medium">
                                    <span>{resourceLabel}</span>
                                    <span className="num">{formatGel(b.price.finalPrice)}</span>
                                </div>
                                <div className="text-ink-60 flex gap-1 items-center">
                                    <Clock size={12} aria-hidden="true" />
                                    <span className="num">{formatTimeRange(b.startTime, b.endTime)}</span> ({b.duration / 60} ч)
                                </div>
                                {b.price.discountAmount > 0 && (() => {
                                    const info = DISCOUNT_INFO[b.price.discountType];
                                    const pct = Math.round(b.price.discountAmount / b.price.basePrice * 100);
                                    return (
                                        <div className="mt-1.5 flex items-center gap-1.5 text-caption font-medium rounded-md px-2 py-0.5 w-fit"
                                            style={{ background: STATUS.ok.bg, color: STATUS.ok.fg }}>
                                            {info && <info.Icon size={12} aria-hidden="true" />}
                                            Скидка {pct}% · {formatGel(-b.price.discountAmount)}
                                            {info && <span className="font-normal">({info.label})</span>}
                                        </div>
                                    );
                                })()}
                                {/* Excel #24 — "+ Ещё период в этом же кабинете" */}
                                {isLastForResource && state.step !== 2 && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            state.startAddMoreSlots(b.resourceId);
                                            state.setStep(2);
                                        }}
                                        className="mt-2 flex items-center gap-1.5 text-caption font-medium text-ink-80 hover:text-ink hover:underline transition-colors"
                                        title={`Добавить второй период в ${resourceLabel}`}
                                    >
                                        <Plus size={12} aria-hidden="true" />
                                        Ещё период в этом кабинете
                                    </button>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Common Details */}
            {cartBookings.length > 0 && (
                <div className="space-y-3 mb-6 border-t border-ink-10 pt-4">
                    <div className="flex items-center gap-3 text-sm">
                        <div className="text-ink-40"><Clock size={16} aria-hidden="true" /></div>
                        <div>
                            <div className="text-ink-60">Дата</div>
                            <div>{formatDateLabel(state.date, { capitalize: true, withYear: 'auto' })}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                        <div className="text-ink-40"><Users size={16} aria-hidden="true" /></div>
                        <div>
                            <div className="text-ink-60">Формат</div>
                            <div>{
                                state.format === 'individual' ? 'Индивидуальный' :
                                state.format === 'intervision' ? 'Интервизия' : 'Групповой'
                            }</div>
                        </div>
                    </div>

                    {/* G3-03: тут был второй переключатель «Абонемент | Депозит» —
                        без бонусов и с другими словами, чем в «Способе оплаты».
                        Выбор живёт в одном месте (ConfirmationStep), здесь — только
                        итог того, что выбрано. */}
                    <div className="flex items-center gap-3 text-sm">
                        <div className="text-ink-40"><Wallet size={16} aria-hidden="true" /></div>
                        <div>
                            <div className="text-ink-60">Оплата</div>
                            <div>{
                                state.paymentMethod === 'bonus' ? 'Бонусные часы' :
                                state.paymentMethod === 'subscription' ? 'Абонемент' : 'Баланс'
                            }</div>
                        </div>
                    </div>
                </div>
            )}

            <div className="border-t border-ink-10 my-4 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                    <span className="text-ink-60">Базовая стоимость</span>
                    <span className="num">{formatGel(total.basePrice)}</span>
                </div>
                {(total.peakSurcharge ?? 0) > 0 && (
                    <div className="flex justify-between text-sm">
                        <span className="text-ink-60 flex items-center gap-1">
                            <Sunrise size={12} style={{ color: STATUS.pending.fg }} aria-hidden="true" />
                            Пиковые часы (+5 ₾/ч)
                        </span>
                        <span className="num" style={{ color: STATUS.pending.fg }}>вкл. {formatGel(total.peakSurcharge ?? 0)}</span>
                    </div>
                )}
                {(total.subscriptionPeakDebt ?? 0) > 0 && (
                    <div className="rounded-lg px-3 py-2"
                        style={{ background: STATUS.pending.bg, color: STATUS.pending.fg }}>
                        <div className="flex justify-between text-sm font-medium">
                            <span className="flex items-center gap-1">
                                <Sunrise size={12} aria-hidden="true" />
                                Доплата за пиковые часы
                            </span>
                            <span className="num">{formatGel(total.subscriptionPeakDebt ?? 0, { sign: true })}</span>
                        </div>
                        <div className="text-caption mt-0.5">
                            Абонемент покрывает стандартные часы. Пиковые часы (9–10, 20–22) — доплата 5 ₾/ч, записывается в счёт.
                        </div>
                    </div>
                )}
                {total.extrasPrice > 0 && (
                    <div className="flex justify-between text-sm">
                        <span className="text-ink-60">Доп. опции</span>
                        <span className="num">{formatGel(total.extrasPrice, { sign: true })}</span>
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
                            style={{ background: STATUS.ok.bg, color: STATUS.ok.fg }}>
                            <div className="flex justify-between text-sm font-semibold">
                                <span className="flex items-center gap-1.5">
                                    <Tag size={13} aria-hidden="true" />
                                    Экономия {pct}%
                                </span>
                                <span className="num">{formatGel(-total.discountAmount)}</span>
                            </div>
                            {info && (
                                <div className="flex items-center gap-1 text-caption">
                                    <info.Icon size={12} aria-hidden="true" />
                                    {info.label}
                                </div>
                            )}
                        </div>
                    );
                })()}
                <div className="flex justify-between items-center pt-2 text-xl font-semibold">
                    <span>Итого</span>
                    {/* Бонусные часы покрывают бронь целиком (иначе их не выбрать);
                        абонемент платит часами — деньгами только пиковая доплата. */}
                    <span className="num">{state.paymentMethod === 'subscription'
                        ? `${Number(cartBookings.reduce((s, b) => s + b.duration / 60, 0).toFixed(1))} ч${total.finalPrice > 0 ? ` + ${formatGel(total.finalPrice)}` : ''}`
                        : formatGel(state.paymentMethod === 'bonus' ? 0 : total.finalPrice)}</span>
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
                    className="w-full mt-3 text-sm text-ink-60 hover:text-ink"
                >
                    Назад
                </button>
            )}
        </div>
    );
}
