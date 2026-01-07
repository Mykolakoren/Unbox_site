import { useBookingStore } from '../../store/bookingStore';
import { Button } from '../ui/Button';
import { LOCATIONS } from '../../utils/data';
import clsx from 'clsx';
// import { ru } from 'date-fns/locale';

export function ContextStep({ onNext }: { onNext: () => void }) {
    const {
        locationId, setLocation,
        format: bookingFormat, setFormat
    } = useBookingStore();

    // Ensure defaults
    // If no location, set first one
    // If format not explicitly set, default to individual

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-bold mb-2">Найти свободное время</h2>
                <p className="text-gray-500">Выберите дату и локацию, чтобы увидеть доступность всех кабинетов.</p>
            </div>

            <div className="space-y-6">
                {/* Location Selection */}
                <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-700">Локация</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {LOCATIONS.map((loc) => (
                            <button
                                key={loc.id}
                                onClick={() => setLocation(loc.id)}
                                className={clsx(
                                    "p-4 rounded-xl border-2 text-left transition-all",
                                    locationId === loc.id
                                        ? "border-black bg-gray-50 ring-1 ring-black"
                                        : "border-gray-100 hover:border-gray-200"
                                )}
                            >
                                <div className="font-medium">{loc.name}</div>
                                <div className="text-sm text-gray-500">{loc.address}</div>
                            </button>
                        ))}
                    </div>
                </div>



                {/* Format Selection (Moved here) */}
                <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-700">Формат работы</label>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setFormat('individual')}
                            className={clsx(
                                "flex-1 p-3 rounded-xl border text-sm font-medium transition-all",
                                bookingFormat === 'individual'
                                    ? "bg-black text-white border-black"
                                    : "border-gray-200 hover:border-black/20"
                            )}
                        >
                            Индивидуально
                        </button>
                        <button
                            onClick={() => setFormat('group')}
                            className={clsx(
                                "flex-1 p-3 rounded-xl border text-sm font-medium transition-all",
                                bookingFormat === 'group'
                                    ? "bg-black text-white border-black"
                                    : "border-gray-200 hover:border-black/20"
                            )}
                        >
                            Группа
                        </button>
                    </div>
                </div>
            </div>

            <div className="pt-8">
                <Button size="lg" className="w-full" onClick={onNext} disabled={!locationId}>
                    Показать расписание
                </Button>
            </div>
        </div>
    );
}
