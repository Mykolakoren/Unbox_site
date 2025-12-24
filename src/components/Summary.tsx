import { useBookingStore } from '../store/bookingStore';
import { Button } from './ui/Button';
import { Box, Users, Clock, Tag } from 'lucide-react';
import { useMemo } from 'react';
import { calculatePrice } from '../utils/pricing';
import { EXTRAS } from '../utils/data';

export function Summary() {
    const state = useBookingStore();

    const price = useMemo(() => {
        if (!state.startTime || state.duration === 0) {
            return { basePrice: 0, extrasPrice: 0, discountAmount: 0, discountType: 'none', finalPrice: 0 };
        }

        // Parse start/end
        const [hours, minutes] = state.startTime.split(':').map(Number);
        const startDateTime = new Date(state.date);
        startDateTime.setHours(hours, minutes, 0, 0);

        const endDateTime = new Date(startDateTime.getTime() + state.duration * 60000);

        const selectedExtras = EXTRAS.filter(e => state.extras.includes(e.id));

        return calculatePrice({
            format: state.format,
            startTime: startDateTime,
            endTime: endDateTime,
            extras: selectedExtras,
            loyaltyLevel: 'none',
        });
    }, [state.date, state.startTime, state.duration, state.format, state.extras]);

    const canProceed = () => {
        if (state.step === 1) return !!state.resourceId;
        if (state.step === 2) return true; // Date/Format defaults are set
        if (state.step === 3) return !!state.startTime && state.duration > 0;
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
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 sticky top-24">
            <h2 className="text-lg font-bold mb-6">Ваше бронирование</h2>

            {/* Details List */}
            <div className="space-y-4 mb-8">
                {/* Resource */}
                <div className="flex items-start gap-3">
                    <div className="mt-1 text-gray-400"><Box size={18} /></div>
                    <div>
                        <div className="text-sm font-medium text-gray-500">Локация и Ресурс</div>
                        <div className="font-medium">
                            {state.locationId ? (state.locationId === 'one' ? 'Unbox One' : 'Unbox Uni') : 'Не выбрано'}
                        </div>
                        {state.resourceId && (
                            <div className="text-sm text-gray-600">
                                Ресурс выбран
                            </div>
                        )}
                    </div>
                </div>

                {/* Date & Time */}
                <div className="flex items-start gap-3">
                    <div className="mt-1 text-gray-400"><Clock size={18} /></div>
                    <div>
                        <div className="text-sm font-medium text-gray-500">Время</div>
                        <div className="font-medium">
                            {state.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                        </div>
                        {state.startTime ? (
                            <div className="text-sm text-gray-600">
                                {state.startTime} ({state.duration / 60} ч)
                            </div>
                        ) : (
                            <div className="text-sm text-gray-400">–</div>
                        )}
                    </div>
                </div>

                {/* Format */}
                <div className="flex items-start gap-3">
                    <div className="mt-1 text-gray-400"><Users size={18} /></div>
                    <div>
                        <div className="text-sm font-medium text-gray-500">Формат</div>
                        <div className="font-medium">
                            {state.format === 'individual' ? 'Индивидуальный' : 'Групповой'}
                        </div>
                    </div>
                </div>
            </div>

            <div className="border-t border-gray-100 my-4 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Базовая стоимость</span>
                    <span>{price.basePrice} ₾</span>
                </div>
                {price.extrasPrice > 0 && (
                    <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Доп. опции</span>
                        <span>+{price.extrasPrice} ₾</span>
                    </div>
                )}
                {price.discountAmount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                        <span className="flex items-center gap-1">
                            <Tag size={14} />
                            Скидка ({price.discountType})
                        </span>
                        <span>-{price.discountAmount.toFixed(1)} ₾</span>
                    </div>
                )}
                <div className="flex justify-between items-center pt-2 text-xl font-bold">
                    <span>Итого</span>
                    <span>{price.finalPrice.toFixed(1)} ₾</span>
                </div>
            </div>

            <Button
                className="w-full mt-4"
                size="lg"
                disabled={!canProceed()}
                onClick={handleNext}
            >
                {state.step === 4 ? 'Подтвердить' : 'Продолжить'}
            </Button>

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
