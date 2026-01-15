import { useUserStore } from '../store/userStore';
import { useBookingStore } from '../store/bookingStore';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { BadgeCheck, XCircle, Clock, Calendar as CalendarIcon } from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Link, useNavigate } from 'react-router-dom';
import { RESOURCES, EXTRAS } from '../utils/data';
import { generateGoogleCalendarUrl } from '../utils/calendar';
import { toast } from 'sonner';
import { useState } from 'react';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';

export function MyBookingsPage() {
    const navigate = useNavigate();
    const { currentUser, bookings, cancelBooking, listForReRent } = useUserStore();
    const startEditing = useBookingStore(s => s.startEditing);

    // Modal State
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: React.ReactNode;
        onConfirm: () => void;
        isDestructive?: boolean;
        confirmLabel?: string;
    }>({
        isOpen: false,
        title: '',
        message: null,
        onConfirm: () => { },
    });

    const userBookings = bookings
        .filter(b => b.userId === currentUser?.email)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const handleEdit = (booking: any) => {
        startEditing(booking, 'reschedule');
        navigate('/');
    };

    const handleCancel = (id: string) => {
        const booking = bookings.find(b => b.id === id);
        if (!booking) return;

        setModalConfig({
            isOpen: true,
            title: 'Отменить бронирование?',
            message: 'Это действие нельзя отменить. Средства будут возвращены согласно правилам отмены.',
            confirmLabel: 'Отменить бронь',
            isDestructive: true,
            onConfirm: () => {
                cancelBooking(id);
                // Notification logic
                if (booking.paymentMethod === 'subscription') {
                    toast.success(`Бронирование отменено. ${booking.hoursDeducted || (booking.duration / 60)} ч. возвращено на абонемент.`);
                } else {
                    toast.success(`Бронирование отменено. ${booking.finalPrice} ₾ возвращено на ваш депозит.`);
                }
            }
        });
    };

    const handleReRent = (id: string) => {
        setModalConfig({
            isOpen: true,
            title: 'Выставить на переаренду?',
            message: (
                <span>
                    Если другой пользователь забронирует это время,
                    вам вернется <b>50%</b> от стоимости бронирования на баланс.
                    Вы останетесь владельцем брони до момента её выкупа.
                </span>
            ),
            confirmLabel: 'Выставить',
            isDestructive: false,
            onConfirm: () => {
                listForReRent(id);
                toast.success('Время выставлено на переаренду. Мы уведомим вас, если его забронируют.');
            }
        });
    };


    return (
        <div className="space-y-6 pb-20">
            <h1 className="text-2xl font-bold px-4 pt-6">Мои бронирования</h1>

            {currentUser?.subscription && (
                <div className="px-4">
                    <SubscriptionCard user={currentUser} />
                </div>
            )}

            {userBookings.length === 0 ? (
                <div className="text-center py-20 text-gray-500">
                    <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Clock size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">У вас пока нет бронирований</h2>
                    <p className="mb-6">Самое время забронировать кабинет!</p>
                    <Link to="/">
                        <Button onClick={() => useBookingStore.getState().reset()}>Забронировать</Button>
                    </Link>
                </div>
            ) : (
                <div className="px-4 space-y-4">
                    {userBookings.map((booking) => (
                        <Card key={booking.id} className="p-6">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <div className="text-xs text-gray-500 mb-1">
                                        Забронировано: {format(new Date(booking.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}
                                    </div>
                                    <h3 className="font-bold text-lg mb-1">
                                        {RESOURCES.find(r => r.id === booking.resourceId)?.name || 'Кабинет'}
                                    </h3>
                                    <div className="text-sm text-gray-500 mb-2">
                                        {booking.locationId === 'unbox_one' ? 'Unbox One' : 'Unbox Uni'} · {booking.format === 'individual' ? 'Индивидуальный' : 'Групповой'}
                                    </div>

                                    <div className="text-unbox-dark mt-1 flex items-center gap-2 font-medium">
                                        <Clock size={16} />
                                        {format(new Date(booking.date), 'd MMMM', { locale: ru })}, {booking.startTime} ({booking.duration / 60}ч)
                                    </div>

                                    {/* Add to Calendar Link */}
                                    {booking.status === 'confirmed' && (
                                        <button
                                            onClick={() => {
                                                if (!booking.startTime) return;
                                                const [h, m] = booking.startTime.split(':').map(Number);
                                                const start = new Date(booking.date);
                                                start.setHours(h, m, 0, 0);
                                                const end = new Date(start.getTime() + booking.duration * 60000);

                                                const event = {
                                                    title: `Бронирование Unbox`,
                                                    description: `Бронирование кабинета`,
                                                    location: 'Unbox, Tbilisi',
                                                    startTime: start,
                                                    endTime: end
                                                };
                                                window.open(generateGoogleCalendarUrl(event), '_blank');
                                            }}
                                            className="text-xs text-unbox-green hover:underline flex items-center gap-1 mt-1"
                                        >
                                            <CalendarIcon size={12} />
                                            Добавить в календарь
                                        </button>
                                    )}

                                    {booking.extras.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {booking.extras.map((extraId: string) => {
                                                const extra = EXTRAS.find(e => e.id === extraId);
                                                return extra ? (
                                                    <span key={extraId} className="text-xs bg-gray-100 px-2 py-1 rounded-md text-gray-600 border border-gray-200">
                                                        + {extra.name}
                                                    </span>
                                                ) : null;
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className={clsx(
                                    "px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1",
                                    {
                                        'bg-unbox-light text-unbox-dark': booking.status === 'confirmed',
                                        // 'bg-white border border-unbox-green text-unbox-green': booking.status === 'confirmed', // Alternative
                                        'bg-gray-100 text-unbox-grey': booking.status === 'cancelled',
                                        'bg-gray-100 text-gray-500': booking.status === 'completed',
                                        'bg-white border border-unbox-green text-unbox-green': booking.status === 're-rented',
                                    }
                                )}>
                                    {booking.status === 'confirmed' && <><BadgeCheck size={12} /> Подтверждено</>}
                                    {booking.status === 'cancelled' && <><XCircle size={12} /> Отменено</>}
                                    {booking.status === 'completed' && 'Завершено'}
                                    {booking.status === 're-rented' && 'Пересдано'}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 pt-4 border-t border-gray-100">
                                <div>
                                    <div className="text-xs text-gray-400 mb-0.5 uppercase font-medium">Оплата</div>
                                    <div className="font-medium text-unbox-dark flex items-center gap-2">
                                        {booking.paymentMethod === 'subscription' ? (
                                            <>
                                                <span className="w-2 h-2 rounded-full bg-unbox-dark"></span>
                                                Абонемент
                                            </>
                                        ) : booking.paymentSource === 'credit' ? (
                                            <>
                                                <span className="w-2 h-2 rounded-full bg-unbox-grey"></span>
                                                Кредит
                                            </>
                                        ) : (
                                            <>
                                                <span className="w-2 h-2 rounded-full bg-unbox-green"></span>
                                                Депозит
                                            </>
                                        )}
                                    </div>
                                    <div className="text-sm text-gray-500 mt-0.5">
                                        {booking.paymentMethod === 'subscription' ? (
                                            <span>Списано: <span className="font-bold text-unbox-dark">{booking.hoursDeducted || (booking.duration / 60)} ч</span></span>
                                        ) : (
                                            <span>
                                                {booking.paymentSource === 'credit' ? 'Долг: ' : 'Оплачено: '}
                                                <span className="font-bold text-unbox-dark">{booking.finalPrice} ₾</span>
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {booking.price && booking.price.discountAmount > 0 && (
                                    <div className="bg-orange-50 p-2 rounded-lg border border-orange-100 text-sm">
                                        <div className="flex justify-between items-center text-orange-800">
                                            <span className="font-medium">🏷️ Скидка применена</span>
                                            <span className="font-bold">-{booking.price.discountAmount} ₾</span>
                                        </div>
                                        {booking.price.discountRule && (
                                            <div className="text-xs text-orange-600 mt-0.5">
                                                {booking.price.discountRule === 'volume' ? 'Скидка за объем (неделя)' : booking.price.discountRule}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Mock Admin Edit Price Action */}
                                <div className="flex justify-end pt-1">
                                    <button
                                        className="text-[10px] text-gray-400 hover:text-unbox-green underline"
                                        onClick={() => {
                                            const newPriceString = prompt('👨‍💻 Админ: Введите новую финальную цену (GEL):', booking.finalPrice.toString());
                                            if (newPriceString !== null) {
                                                const newPrice = parseFloat(newPriceString);
                                                if (!isNaN(newPrice)) {
                                                    // Call store action
                                                    useUserStore.getState().setManualPrice(booking.id, newPrice);
                                                    toast.success(`Цена обновлена! Баланс пользователя скорректирован.`);
                                                }
                                            }
                                        }}
                                    >
                                        Изменить цену (Admin)
                                    </button>
                                </div>
                            </div>

                            {/* Actions for active bookings */}
                            {booking.status === 'confirmed' && (
                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    {(() => {
                                        let bookingTime = new Date(booking.date).getTime();
                                        if (booking.startTime) {
                                            const [h, m] = booking.startTime.split(':').map(Number);
                                            const d = new Date(booking.date);
                                            d.setHours(h, m, 0, 0);
                                            bookingTime = d.getTime();
                                        }
                                        const now = Date.now();
                                        const diffHours = (bookingTime - now) / (1000 * 60 * 60);

                                        return diffHours > 24;
                                    })() ? (
                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="flex-1"
                                                onClick={() => handleEdit(booking)}
                                            >
                                                Перенести
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="flex-1 text-unbox-grey hover:text-red-600 hover:bg-red-50"
                                                onClick={() => handleCancel(booking.id)}
                                            >
                                                Отменить
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="text-xs text-center text-unbox-grey italic bg-gray-50 p-2 rounded-lg">
                                                Менее 24ч до начала. Бесплатная отмена недоступна.
                                            </div>

                                            {booking.isReRentListed ? (
                                                <div className="bg-unbox-light text-unbox-dark border border-unbox-green/30 p-3 rounded-lg text-sm text-center font-medium">
                                                    ⏳ Выставлено на переаренду
                                                    <div className="text-xs text-unbox-grey font-normal mt-1">
                                                        Если время забронируют, средства вернутся на счет.
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="w-full border-dashed border-unbox-green text-unbox-green hover:bg-unbox-light"
                                                        onClick={() => handleReRent(booking.id)}
                                                    >
                                                        ♻️ Выставить на переаренду
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="w-full text-unbox-grey hover:text-unbox-dark"
                                                        onClick={() => window.open('https://t.me/UnboxCenter', '_blank')}
                                                    >
                                                        💬 Связаться с администратором
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {booking.status === 're-rented' && (
                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm text-center font-medium border border-green-100 flex flex-col items-center">
                                        <span>💰 Средства возвращены на баланс</span>
                                        <span className="text-lg font-bold text-green-800">
                                            +{(booking.finalPrice * 0.5).toFixed(1)} ₾
                                        </span>
                                    </div>
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            )}

            <ConfirmationModal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                isDestructive={modalConfig.isDestructive}
                confirmLabel={modalConfig.confirmLabel}
            />
        </div>
    );
}
