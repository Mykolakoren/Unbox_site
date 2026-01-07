import { useBookingStore } from '../store/bookingStore';
import { Button } from './ui/Button';
import { Users, Clock, Tag, ShoppingCart } from 'lucide-react';
import { useMemo } from 'react';
import { calculatePrice } from '../utils/pricing';
import { EXTRAS } from '../utils/data';
import { groupSlotsIntoBookings } from '../utils/cartHelpers';

export function Summary() {
    const state = useBookingStore();

    const { cartBookings, total } = useMemo(() => {
        // 1. Group slots
        const bookings = groupSlotsIntoBookings(state.selectedSlots, state.date);

        if (bookings.length === 0) {
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

        const details = bookings.map(b => {
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
                resourceId: b.resourceId // Pass resourceId instead of Type
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

    }, [state.selectedSlots, state.date, state.format, state.extras]);

    const canProceed = () => {
        if (state.step === 1) return !!state.locationId; // Changed from resourceId since we select context first
        if (state.step === 2) return state.selectedSlots.length > 0;
        if (state.step === 3) return true;
        if (state.step === 4) return true;
        return false;
    };

    const handleNext = () => {
        state.setStep(state.step + 1);
    };

    const handleBack = () => {
        state.setStep(state.step - 1);
    };

    return (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 sticky top-24 max-h-[calc(100vh-100px)] overflow-y-auto">
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
                        <div key={idx} className="bg-gray-50 rounded-lg p-3 text-sm relative group">
                            <div className="flex justify-between font-medium">
                                <span>{b.resourceId}</span>
                                <span>{b.price.finalPrice} ₾</span>
                            </div>
                            <div className="text-gray-500 flex gap-1 items-center">
                                <Clock size={12} />
                                {b.startTime} - {b.endTime} ({b.duration / 60} ч)
                            </div>
                            {b.price.discountAmount > 0 && (
                                <div className="text-green-600 text-xs mt-1">
                                    Скидка -{b.price.discountAmount.toFixed(1)} ₾
                                </div>
                            )}
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
                                className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all ${state.paymentMethod === 'subscription'
                                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm'
                                    : 'bg-white border-gray-100 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                            >
                                <span className="text-sm font-medium">Абонемент</span>
                            </button>
                            <button
                                onClick={() => state.setPaymentMethod('balance')}
                                className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all ${state.paymentMethod === 'balance'
                                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm'
                                    : 'bg-white border-gray-100 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
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
                {total.discountAmount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                        <span className="flex items-center gap-1">
                            <Tag size={14} />
                            Экономия
                        </span>
                        <span>-{total.discountAmount.toFixed(1)} ₾</span>
                    </div>
                )}
                <div className="flex justify-between items-center pt-2 text-xl font-bold">
                    <span>Итого</span>
                    <span>{total.finalPrice.toFixed(1)} ₾</span>
                </div>
            </div>

            {/* Hide "Continue" button on Step 3 (Chessboard) and Step 4 (Confirmation) as they have their own buttons */}
            {state.step !== 3 && state.step !== 4 && (
                <Button
                    className="w-full mt-4"
                    size="lg"
                    disabled={!canProceed()}
                    onClick={handleNext}
                >
                    {state.step === 4 ? 'Подтвердить' : 'Продолжить'}
                </Button>
            )}

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
