import { useState, useEffect, useMemo } from 'react';
import { specialistsApi, type AvailableSlot, type AppointmentCreate } from '../../api/specialists';
import { LOCATIONS } from '../../utils/data';
import { ChevronLeft, ChevronRight, MapPin, Video, Loader2, Check, X } from 'lucide-react';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
    specialistId: string;
    specialistName: string;
    formats: string[];
    basePriceGel: number;
}

const TIME_SLOTS = Array.from({ length: 24 }, (_, i) => {
    const h = 9 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}).filter(t => t < '21:00');

const DOW_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function SpecialistBookingChessboard({ specialistId, specialistName, formats, basePriceGel }: Props) {
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [locationFilter, setLocationFilter] = useState<string | null | 'all'>('all');
    const [slots, setSlots] = useState<AvailableSlot[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
    const [bookingForm, setBookingForm] = useState({ name: '', phone: '', email: '' });
    const [submitting, setSubmitting] = useState(false);

    const weekDays = useMemo(() =>
        Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        [weekStart]
    );

    const dateFrom = format(weekDays[0], 'yyyy-MM-dd');
    const dateTo = format(weekDays[6], 'yyyy-MM-dd');

    useEffect(() => {
        setLoading(true);
        const locParam = locationFilter === 'all' ? undefined : locationFilter;
        specialistsApi.getAvailableSlots(specialistId, dateFrom, dateTo, locParam)
            .then(setSlots)
            .catch(() => setSlots([]))
            .finally(() => setLoading(false));
    }, [specialistId, dateFrom, dateTo, locationFilter]);

    // Build lookup: "YYYY-MM-DD|HH:MM" → AvailableSlot
    const slotMap = useMemo(() => {
        const map = new Map<string, AvailableSlot>();
        slots.forEach(s => map.set(`${s.date}|${s.start_time}`, s));
        return map;
    }, [slots]);

    const hasOffline = formats.includes('OFFLINE_ROOM');
    const hasOnline = formats.includes('ONLINE');

    const handleBook = async () => {
        if (!selectedSlot || !bookingForm.name.trim()) return;
        setSubmitting(true);
        try {
            const data: AppointmentCreate = {
                client_name: bookingForm.name.trim(),
                client_phone: bookingForm.phone.trim() || undefined,
                client_email: bookingForm.email.trim() || undefined,
                date: selectedSlot.date,
                start_time: selectedSlot.start_time,
                location_id: selectedSlot.location_id,
            };
            await specialistsApi.createAppointment(specialistId, data);
            toast.success('Вы записаны! Специалист получит уведомление.');
            setSelectedSlot(null);
            setBookingForm({ name: '', phone: '', email: '' });
            // Refresh slots
            const locParam = locationFilter === 'all' ? undefined : locationFilter;
            specialistsApi.getAvailableSlots(specialistId, dateFrom, dateTo, locParam)
                .then(setSlots);
        } catch (e: any) {
            const msg = e.response?.data?.detail || 'Ошибка при записи';
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    const getLocationLabel = (locId: string | null) => {
        if (!locId) return 'Онлайн';
        const loc = LOCATIONS.find(l => l.id === locId);
        return loc?.name || locId;
    };

    return (
        <div className="mt-8">
            <h3 className="text-xl font-bold text-unbox-dark mb-4">Записаться на приём</h3>

            {/* Location filter */}
            <div className="flex flex-wrap gap-2 mb-4">
                <button
                    onClick={() => setLocationFilter('all')}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${locationFilter === 'all' ? 'bg-unbox-green text-white' : 'bg-unbox-light text-unbox-dark/60 hover:bg-unbox-dark/10'}`}
                >
                    Все
                </button>
                {hasOnline && (
                    <button
                        onClick={() => setLocationFilter(null)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${locationFilter === null ? 'bg-unbox-green text-white' : 'bg-unbox-light text-unbox-dark/60 hover:bg-unbox-dark/10'}`}
                    >
                        <Video size={12} /> Онлайн
                    </button>
                )}
                {hasOffline && LOCATIONS.filter(l => l.id !== 'neo_school').map(loc => (
                    <button
                        key={loc.id}
                        onClick={() => setLocationFilter(loc.id)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${locationFilter === loc.id ? 'bg-unbox-green text-white' : 'bg-unbox-light text-unbox-dark/60 hover:bg-unbox-dark/10'}`}
                    >
                        <MapPin size={12} /> {loc.name}
                    </button>
                ))}
            </div>

            {/* Week navigation */}
            <div className="flex items-center justify-between mb-3">
                <button onClick={() => setWeekStart(s => subWeeks(s, 1))} className="p-2 rounded-lg hover:bg-unbox-light transition-colors">
                    <ChevronLeft size={18} />
                </button>
                <span className="text-sm font-medium text-unbox-dark">
                    {format(weekDays[0], 'd MMM', { locale: ru })} — {format(weekDays[6], 'd MMM yyyy', { locale: ru })}
                </span>
                <button onClick={() => setWeekStart(s => addWeeks(s, 1))} className="p-2 rounded-lg hover:bg-unbox-light transition-colors">
                    <ChevronRight size={18} />
                </button>
            </div>

            {/* Chessboard */}
            <div className="bg-white rounded-2xl border border-unbox-light overflow-hidden shadow-sm">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-unbox-dark/40">
                        <Loader2 size={24} className="animate-spin" />
                    </div>
                ) : slots.length === 0 ? (
                    <div className="text-center py-12 text-unbox-dark/40 text-sm">
                        Нет доступного времени на этой неделе
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-unbox-light">
                                    <th className="p-2 text-left text-unbox-dark/40 w-16 sticky left-0 bg-white z-10"></th>
                                    {weekDays.map((day, i) => (
                                        <th key={i} className={`p-2 text-center min-w-[80px] ${isSameDay(day, new Date()) ? 'text-unbox-green font-bold' : 'text-unbox-dark/60'}`}>
                                            <div>{DOW_LABELS[i]}</div>
                                            <div className="text-[10px]">{format(day, 'd MMM', { locale: ru })}</div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {TIME_SLOTS.map(time => (
                                    <tr key={time} className="border-b border-unbox-light/50">
                                        <td className="p-1.5 text-right text-unbox-dark/40 font-mono text-[10px] sticky left-0 bg-white z-10">{time}</td>
                                        {weekDays.map((day, i) => {
                                            const dateStr = format(day, 'yyyy-MM-dd');
                                            const key = `${dateStr}|${time}`;
                                            const slot = slotMap.get(key);
                                            const isSelected = selectedSlot && selectedSlot.date === dateStr && selectedSlot.start_time === time;

                                            return (
                                                <td key={i} className="p-0.5">
                                                    {slot ? (
                                                        <button
                                                            onClick={() => setSelectedSlot(slot)}
                                                            className={`w-full h-8 rounded-lg text-[10px] font-medium transition-all ${
                                                                isSelected
                                                                    ? 'bg-unbox-green text-white shadow-md scale-105'
                                                                    : 'bg-unbox-green/10 text-unbox-green hover:bg-unbox-green/25 hover:scale-105'
                                                            }`}
                                                            title={`${time} — ${getLocationLabel(slot.location_id)}`}
                                                        >
                                                            {slot.location_id ? (
                                                                <MapPin size={10} className="mx-auto" />
                                                            ) : (
                                                                <Video size={10} className="mx-auto" />
                                                            )}
                                                        </button>
                                                    ) : (
                                                        <div className="w-full h-8 rounded-lg bg-gray-50" />
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Booking Modal */}
            <AnimatePresence>
                {selectedSlot && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                        onClick={() => setSelectedSlot(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-lg text-unbox-dark">Запись к {specialistName}</h3>
                                <button onClick={() => setSelectedSlot(null)} className="text-unbox-dark/40 hover:text-unbox-dark">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="bg-unbox-light/50 rounded-xl p-4 mb-5 space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-unbox-dark/60">Дата:</span>
                                    <span className="font-medium">{format(new Date(selectedSlot.date + 'T00:00'), 'EEEE, d MMMM', { locale: ru })}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-unbox-dark/60">Время:</span>
                                    <span className="font-medium">{selectedSlot.start_time} — {selectedSlot.end_time}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-unbox-dark/60">Формат:</span>
                                    <span className="font-medium flex items-center gap-1">
                                        {selectedSlot.location_id ? <><MapPin size={12} /> {getLocationLabel(selectedSlot.location_id)}</> : <><Video size={12} /> Онлайн</>}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-unbox-dark/60">Стоимость:</span>
                                    <span className="font-bold text-unbox-green">от {basePriceGel} ₾</span>
                                </div>
                            </div>

                            <div className="space-y-3 mb-5">
                                <div>
                                    <label className="block text-xs font-medium text-unbox-dark/60 mb-1">Ваше имя *</label>
                                    <input
                                        type="text"
                                        value={bookingForm.name}
                                        onChange={e => setBookingForm(f => ({ ...f, name: e.target.value }))}
                                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/50"
                                        placeholder="Как к вам обращаться"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-unbox-dark/60 mb-1">Телефон</label>
                                    <input
                                        type="tel"
                                        value={bookingForm.phone}
                                        onChange={e => setBookingForm(f => ({ ...f, phone: e.target.value }))}
                                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/50"
                                        placeholder="+995..."
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-unbox-dark/60 mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={bookingForm.email}
                                        onChange={e => setBookingForm(f => ({ ...f, email: e.target.value }))}
                                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/50"
                                        placeholder="email@example.com"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={handleBook}
                                disabled={submitting || !bookingForm.name.trim()}
                                className="w-full py-3 rounded-xl bg-unbox-green text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
                            >
                                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                {submitting ? 'Записываю...' : 'Записаться'}
                            </button>

                            <p className="text-[10px] text-unbox-dark/40 text-center mt-3">
                                Оплата производится напрямую специалисту
                            </p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
