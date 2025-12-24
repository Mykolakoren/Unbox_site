import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { Button } from '../ui/Button';
import { CheckCircle, Download, Home } from 'lucide-react';
import { useState, useMemo } from 'react';
import { calculatePrice } from '../../utils/pricing';
import { EXTRAS } from '../../utils/data';
import { useNavigate } from 'react-router-dom';

export function ConfirmationStep() {
    const state = useBookingStore();
    const { user, addBooking } = useUserStore();
    const [confirmed, setConfirmed] = useState(false);
    const navigate = useNavigate();

    const price = useMemo(() => {
        if (!state.startTime || state.duration === 0) {
            return { basePrice: 0, extrasPrice: 0, discountAmount: 0, discountType: 'none', finalPrice: 0 };
        }
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

    const handleConfirm = () => {
        // Simulate API call
        setTimeout(() => {
            const newBooking = {
                ...state,
                id: Math.random().toString(36).substr(2, 9),
                status: 'confirmed' as const,
                dateCreated: new Date().toISOString(),
                finalPrice: price.finalPrice
            };

            if (user) {
                addBooking(newBooking);
                // Redirect to dashboard after short delay
                setTimeout(() => {
                    navigate('/dashboard/bookings');
                }, 2000);
            } else {
                // If guest, maybe we should redirect to login or save to temp?
                // ideally save and prompted to login/register.
                // For now we just allow guest booking but wont save to history unless logged in logic is added.
                // Or we just save it to local storage without user?
                // The prompt is "User Personal Cabinet", so let's assume valid user scenario or we skip saving.
            }

            setConfirmed(true);
        }, 1000);
    };

    if (confirmed) {
        return (
            <div className="text-center py-12 animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle size={40} />
                </div>
                <h2 className="text-3xl font-bold mb-4">Бронирование подтверждено!</h2>
                <p className="text-gray-500 max-w-md mx-auto mb-8">
                    Мы отправили подтверждение на вашу почту. Ждем вас в Unbox!
                </p>

                <div className="flex justify-center gap-4">
                    <Button variant="outline" onClick={() => window.print()}>
                        <Download size={18} className="mr-2" />
                        Скачать чек
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
                <p className="text-gray-500">{user ? 'Проверьте данные бронирования' : 'Заполните контактную информацию'}</p>
            </div>

            <div className="space-y-4 max-w-md">
                {user ? (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 dark:bg-gray-800 dark:border-gray-700">
                        <div className="text-sm text-gray-500 mb-1">Бронирование на имя:</div>
                        <div className="font-bold">{user.name}</div>
                        <div className="text-sm text-gray-500 mt-2">Контакты:</div>
                        <div>{user.phone}</div>
                        <div>{user.email}</div>
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

            <div className="pt-8 border-t border-gray-100">
                <Button size="lg" className="w-full md:w-auto" onClick={handleConfirm}>
                    Подтвердить и оплатить {price.finalPrice} ₾
                </Button>
            </div>
        </div>
    );
}
