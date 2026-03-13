import { useBookingStore } from '../../store/bookingStore';
import { Card } from '../ui/Card';
import { User, Users } from 'lucide-react';
import { addDays, format, isSameDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import clsx from 'clsx';

export function FormatDateStep() {
    const { format: bookingFormat, date: selectedDate, setFormat, setDate } = useBookingStore();

    // Generate next 14 days
    const validDates = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Format Selection */}
            <section>
                <h2 className="text-2xl font-bold mb-2">Выберите формат</h2>
                <p className="text-unbox-grey mb-6">Индивидуально или группой?</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card
                        className="p-6 flex items-center gap-4"
                        selected={bookingFormat === 'individual'}
                        onClick={() => setFormat('individual')}
                    >
                        <div className={clsx(
                            "p-3 rounded-xl",
                            bookingFormat === 'individual' ? "bg-unbox-green text-white" : "bg-unbox-light/50 text-unbox-grey"
                        )}>
                            <User size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg">Индивидуальный</h3>
                            <p className="text-unbox-grey text-sm">20 ₾ / час</p>
                        </div>
                    </Card>

                    <Card
                        className="p-6 flex items-center gap-4"
                        selected={bookingFormat === 'group'}
                        onClick={() => setFormat('group')}
                    >
                        <div className={clsx(
                            "p-3 rounded-xl",
                            bookingFormat === 'group' ? "bg-unbox-green text-white" : "bg-unbox-light/50 text-unbox-grey"
                        )}>
                            <Users size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg">Групповой</h3>
                            <p className="text-unbox-grey text-sm">35 ₾ / час</p>
                        </div>
                    </Card>
                </div>
            </section>

            {/* Date Selection */}
            <section>
                <h2 className="text-2xl font-bold mb-2">Выберите дату</h2>
                <p className="text-unbox-grey mb-6">Доступно бронирование на 2 недели вперед</p>

                {/* Horizontal Scroll Area */}
                <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide -mx-2 px-2">
                    {validDates.map((date) => {
                        const isSelected = isSameDay(date, selectedDate);
                        return (
                            <button
                                key={date.toISOString()}
                                onClick={() => setDate(date)}
                                className={clsx(
                                    "flex flex-col items-center justify-center min-w-[4.5rem] h-20 rounded-xl border transition-all",
                                    isSelected
                                        ? "border-unbox-green bg-unbox-green text-white shadow-md"
                                        : "border-unbox-light bg-white hover:border-gray-300 hover:bg-unbox-light/30"
                                )}
                            >
                                <span className="text-xs font-medium uppercase opacity-60">
                                    {format(date, 'EEE', { locale: ru })}
                                </span>
                                <span className="text-xl font-bold">
                                    {format(date, 'd')}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
