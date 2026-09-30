import { useBookingStore } from '../../store/bookingStore';
import { Card } from '../ui/Card';
import { User, Users, GraduationCap } from 'lucide-react';
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
                <h2 className="text-2xl font-semibold mb-2">Выберите формат</h2>
                <p className="text-ink-60 mb-6">Индивидуально, групповой или интервизия?</p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card
                        className="p-5 flex items-center gap-3"
                        selected={bookingFormat === 'individual'}
                        onClick={() => setFormat('individual')}
                    >
                        <div className={clsx(
                            "p-3 rounded-xl shrink-0",
                            bookingFormat === 'individual' ? "bg-accent text-on-accent" : "bg-unbox-light/50 text-ink-60"
                        )}>
                            <User size={22} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-base">Индивидуальный</h3>
                            <p className="text-ink-60 text-sm">20 ₾ / час</p>
                        </div>
                    </Card>

                    <Card
                        className="p-5 flex items-center gap-3"
                        selected={bookingFormat === 'group'}
                        onClick={() => setFormat('group')}
                    >
                        <div className={clsx(
                            "p-3 rounded-xl shrink-0",
                            bookingFormat === 'group' ? "bg-accent text-on-accent" : "bg-unbox-light/50 text-ink-60"
                        )}>
                            <Users size={22} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-base">Групповой</h3>
                            <p className="text-ink-60 text-sm">35 ₾ / час</p>
                        </div>
                    </Card>

                    <Card
                        className="p-5 flex items-center gap-3"
                        selected={bookingFormat === 'intervision'}
                        onClick={() => setFormat('intervision')}
                    >
                        <div className={clsx(
                            "p-3 rounded-xl shrink-0",
                            bookingFormat === 'intervision' ? "bg-accent text-on-accent" : "bg-unbox-light/50 text-ink-60"
                        )}>
                            <GraduationCap size={22} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-base">Интервизия</h3>
                            <p className="text-ink-60 text-sm">30 ₾ / час</p>
                        </div>
                    </Card>
                </div>
            </section>

            {/* Date Selection */}
            <section>
                <h2 className="text-2xl font-semibold mb-2">Выберите дату</h2>
                <p className="text-ink-60 mb-6">Доступно бронирование на 2 недели вперед</p>

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
                                        ? "border-accent bg-accent text-on-accent shadow-md"
                                        : "border-unbox-light bg-card hover:border-ink-20 hover:bg-unbox-light/30"
                                )}
                            >
                                <span className="text-xs font-medium uppercase">
                                    {format(date, 'EEE', { locale: ru })}
                                </span>
                                <span className="text-xl font-semibold">
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
