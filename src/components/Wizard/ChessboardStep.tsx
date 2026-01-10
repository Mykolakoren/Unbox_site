import { useBookingStore } from '../../store/bookingStore';
import { useUserStore } from '../../store/userStore';
import { WaitlistModal } from '../WaitlistModal';
import { RESOURCES } from '../../utils/data';
import { format, addMinutes, setHours, setMinutes, startOfToday, isBefore, isSameDay, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isToday } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState, useMemo, useEffect } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { ArrowRight, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { googleCalendarService } from '../../services/googleCalendarMock';
import type { ExternalEvent } from '../../services/googleCalendarMock';

export function ChessboardStep() {
    const {
        locationId, date, setDate, format: bookingFormat,
        toggleSlot, selectedSlots,
        setStep
    } = useBookingStore();

    const { bookings } = useUserStore();
    const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);

    // Week View State
    const [weekStart, setWeekStart] = useState(() => startOfWeek(date, { weekStartsOn: 1 }));

    // Waitlist State
    const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
    const [waitlistData, setWaitlistData] = useState<{ resourceId: string; time: string } | null>(null);

    // Sync weekStart when date changes externally
    useEffect(() => {
        setWeekStart(startOfWeek(date, { weekStartsOn: 1 }));
    }, [date]);

    const weekDays = useMemo(() => {
        return eachDayOfInterval({
            start: weekStart,
            end: endOfWeek(weekStart, { weekStartsOn: 1 })
        });
    }, [weekStart]);

    const handlePrevWeek = () => setWeekStart(d => subWeeks(d, 1));
    const handleNextWeek = () => setWeekStart(d => addWeeks(d, 1));

    // 1. Get Resources for current location
    const resources = useMemo(() =>
        RESOURCES.filter(r => r.locationId === locationId),
        [locationId]);

    // 2. Fetch External Events (Mock)
    useEffect(() => {
        // Collect events for all visible resources
        let allEvents: ExternalEvent[] = [];
        resources.forEach(r => {
            const events = googleCalendarService.getEvents(r.id);
            allEvents = [...allEvents, ...events];
        });
        setExternalEvents(allEvents);
    }, [resources, date]);

    // 3. Generate Time Slots (09:00 - 21:00)
    const timeSlots = useMemo(() => {
        const slots = [];
        let time = setMinutes(setHours(startOfToday(), 9), 0);
        const end = setMinutes(setHours(startOfToday(), 21), 0);

        while (isBefore(time, end)) {
            slots.push(format(time, 'HH:mm'));
            time = addMinutes(time, 30);
        }
        return slots;
    }, []);

    // 4. Helper: Is slot blocked?
    const isSlotBlocked = (resId: string, timeStr: string) => {
        const slotDate = new Date(date);
        const [h, m] = timeStr.split(':').map(Number);
        slotDate.setHours(h, m, 0, 0);

        // CHECK: 3 Hour Buffer Rule (New)
        // Can't book earlier than 3 hours from now
        if (isBefore(slotDate, addMinutes(new Date(), 180))) { // 3 * 60 = 180
            return true;
        }

        // Check Internal Bookings
        // Check Internal Bookings
        // Filter out cancelled ones first
        // We find if there is a blocking booking
        const internalBooking = bookings.find(b =>
            b.resourceId === resId &&
            b.status === 'confirmed' && // Only confirmed blocks
            !b.isReRentListed && // Re-rent listed does NOT block
            isSameDay(new Date(b.date), new Date(date)) &&
            b.startTime &&
            (() => {
                const startMins = Number(b.startTime.split(':')[0]) * 60 + Number(b.startTime.split(':')[1]);
                const endMins = startMins + b.duration;
                const slotMins = Number(timeStr.split(':')[0]) * 60 + Number(timeStr.split(':')[1]);
                return slotMins >= startMins && slotMins < endMins;
            })()
        );

        if (internalBooking) return true;

        // Check External Events
        const externalEvent = externalEvents.find(e =>
            e.resourceId === resId &&
            isSameDay(new Date(e.start), new Date(date)) &&
            // Simple overlap check
            format(new Date(e.start), 'HH:mm') <= timeStr &&
            format(new Date(e.end), 'HH:mm') > timeStr
        );

        if (externalEvent) {
            // Check if this external event should be IGNORED because it overlaps with a valid Re-Rent booking
            // We search for ANY booking that is confirmed, Re-Rent Listed, and covers this slot
            const isCoveredByReRent = bookings.some(b =>
                b.resourceId === resId &&
                b.status === 'confirmed' &&
                b.isReRentListed &&
                isSameDay(new Date(b.date), new Date(date)) &&
                b.startTime &&
                (() => {
                    const startMins = Number(b.startTime.split(':')[0]) * 60 + Number(b.startTime.split(':')[1]);
                    const endMins = startMins + b.duration;
                    const slotMins = Number(timeStr.split(':')[0]) * 60 + Number(timeStr.split(':')[1]);
                    return slotMins >= startMins && slotMins < endMins;
                })()
            );

            if (isCoveredByReRent) {
                return false; // Ignored, so it's free
            }
            return true; // Blocked
        }

        return false;
    };

    // 5. Selection Logic
    // Helper to calculate selected range
    const isSelected = (resId: string, timeStr: string) => {
        return selectedSlots.includes(`${resId}|${timeStr}`);
    };

    const handleSlotClick = (resId: string, timeStr: string) => {
        if (isSlotBlocked(resId, timeStr)) {
            setWaitlistData({ resourceId: resId, time: timeStr });
            setIsWaitlistOpen(true);
            return;
        }

        const isCurrentlySelected = isSelected(resId, timeStr);

        // Toggle the clicked slot
        toggleSlot(resId, timeStr);

        // "Minimum 1 hour" logic: Auto-select next slot if starting a new block
        if (!isCurrentlySelected) {
            // We just selected a slot. Check if it's a start of a new block (prev slot not selected)
            const [h, m] = timeStr.split(':').map(Number);
            const currentSlotDate = setMinutes(setHours(new Date(date), h), m);

            const prevSlotTime = format(addMinutes(currentSlotDate, -30), 'HH:mm');
            const isPrevSelected = isSelected(resId, prevSlotTime);

            if (!isPrevSelected) {
                // This is a start of a new block. Auto-select next slot.
                const nextSlotTime = format(addMinutes(currentSlotDate, 30), 'HH:mm');

                // Check if next slot is valid
                const isNextBlocked = isSlotBlocked(resId, nextSlotTime);
                const isNextSelected = isSelected(resId, nextSlotTime);

                // Only select if valid and inside operating hours (09:00 - 21:00)
                // Timetable generation ends at 20:30 (so 21:00 is not in list usually? wait, list goes to 20:30 start)
                // If nextSlot is 21:00, is it valid? "timeSlots" generation loop: while isBefore(time, 21:00). Last slot 20:30.
                // 20:30 + 30 = 21:00. 21:00 is NOT in timeSlots. 
                // So check if nextSlotTime is in timeSlots? Or just rely on availability?
                // Actually if it's not in timeSlots, it won't be displayed/selectable usually?
                // But better check if it exists in timeSlots to be safe.
                const isInTimeSlots = timeSlots.includes(nextSlotTime);

                if (!isNextBlocked && !isNextSelected && isInTimeSlots) {
                    toggleSlot(resId, nextSlotTime);
                }
            }
        }
    };

    // Price Display Helper
    const getPrice = (resId: string) => {
        const resource = resources.find(r => r.id === resId);
        if (!resource) return '';

        // Determine Rate based on Format (duplicate logic from pricing.ts to avoid complex imports or async)
        // Ideally should import getBaseRate, but let's keep it simple here or export it.
        // Replicating logic for display speed:
        const isCapsule = resource.type === 'capsule';
        const rate = isCapsule
            ? (bookingFormat === 'group' ? 10 : 10)
            : (bookingFormat === 'group' ? 35 : 20); // Hardcoded from config for display

        // const slotPrice = resource.hourlyRate / 2; // OLD static way
        const slotPrice = rate / 2;

        return `${slotPrice} ₾`;
    };



    const handleNext = () => {
        setStep(3);
    }

    // Import Check icon
    const CheckIcon = ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold">Выберите время</h2>
                    <p className="text-gray-500">
                        {format(date, 'd MMMM yyyy', { locale: ru })} • {bookingFormat === 'individual' ? 'Индивидуально' : 'Группа'}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                        <ArrowLeft size={16} className="mr-2" /> Назад
                    </Button>
                </div>
            </div>

            {/* Week Picker */}
            <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl">
                <button
                    onClick={handlePrevWeek}
                    className="p-2 hover:bg-white rounded-lg transition-colors text-gray-500 hover:text-black hover:shadow-sm"
                >
                    <ChevronLeft size={20} />
                </button>

                <div className="flex-1 grid grid-cols-7 gap-1">
                    {weekDays.map(day => {
                        const isSelected = isSameDay(day, date);
                        const isCurrent = isToday(day);

                        return (
                            <button
                                key={day.toISOString()}
                                onClick={() => setDate(day)}
                                className={clsx(
                                    "flex flex-col items-center justify-center py-2 rounded-lg transition-all text-sm relative overflow-hidden",
                                    isSelected
                                        ? "bg-unbox-green text-white shadow-md font-medium"
                                        : "hover:bg-white text-gray-600 hover:shadow-sm"
                                )}
                            >
                                <span className={clsx("text-xs uppercase mb-0.5", isSelected ? "text-white/70" : "text-gray-400")}>
                                    {format(day, 'EEE', { locale: ru })}
                                </span>
                                <span className="text-lg leading-none">
                                    {format(day, 'd')}
                                </span>
                                {isCurrent && !isSelected && (
                                    <div className="absolute bottom-1 w-1 h-1 rounded-full bg-unbox-green" />
                                )}
                            </button>
                        );
                    })}
                </div>

                <button
                    onClick={handleNextWeek}
                    className="p-2 hover:bg-white rounded-lg transition-colors text-gray-500 hover:text-black hover:shadow-sm"
                >
                    <ChevronRight size={20} />
                </button>
            </div>

            {/* The Grid */}
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-gray-50 text-gray-700 font-medium border-b border-gray-200">
                            <tr>
                                <th className="sticky left-0 bg-gray-50 p-3 border-r border-gray-200 z-10 w-20 text-center">
                                    Время
                                </th>
                                {resources.map(r => (
                                    <th key={r.id} className="p-3 text-center min-w-[120px] border-r border-gray-100 last:border-0">
                                        {r.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {timeSlots.map(time => (
                                <tr key={time} className="hover:bg-gray-50/50">
                                    <td className="sticky left-0 bg-white p-2 border-r border-gray-200 text-center font-medium text-gray-500 z-10">
                                        {time}
                                    </td>
                                    {resources.map(r => {
                                        const isBlocked = isSlotBlocked(r.id, time);
                                        const selected = isSelected(r.id, time);

                                        return (
                                            <td key={`${r.id}-${time}`} className="p-1 border-r border-gray-100 last:border-0 h-12">
                                                <button
                                                    // disabled={!!isBlocked} // Allow Waitlist
                                                    onClick={() => handleSlotClick(r.id, time)}
                                                    className={clsx(
                                                        "w-full h-full rounded transition-all flex items-center justify-center text-xs relative",
                                                        isBlocked
                                                            ? "bg-gray-100 text-unbox-grey cursor-help hover:bg-gray-200" // Waitlist style (modified to be less aggressive)
                                                            : selected
                                                                ? "bg-unbox-green text-white shadow-md transform scale-95"
                                                                : "hover:bg-unbox-light/50 text-gray-400 hover:text-unbox-dark"
                                                    )}
                                                >
                                                    {selected && <CheckIcon className="w-4 h-4 absolute top-1 right-1" />}
                                                    {isBlocked ? 'Занято' : getPrice(r.id)}
                                                </button>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 p-4 -mx-6 -mb-6 mt-4 flex justify-end z-20 rounded-b-2xl">
                <Button disabled={selectedSlots.length === 0} onClick={handleNext}>
                    Далее <ArrowRight size={16} className="ml-2" />
                </Button>
            </div>


            <WaitlistModal
                isOpen={isWaitlistOpen}
                onClose={() => setIsWaitlistOpen(false)}
                resourceId={waitlistData?.resourceId || ''}
                startTime={waitlistData?.time || ''}
                date={date}
            />
        </div >
    );
}
