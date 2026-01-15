import { useBookingStore } from '../../store/bookingStore';
import { Button } from '../ui/Button';
import { LOCATIONS } from '../../utils/data';
import clsx from 'clsx';
import { MapPin, User, Users, ArrowRight } from 'lucide-react';

export function ContextStep({ onNext }: { onNext: () => void }) {
    const {
        locationId, setLocation,
        format: bookingFormat, setFormat
    } = useBookingStore();

    // Ensure defaults
    // If no location, set first one
    // If format not explicitly set, default to individual

    const activeStyle = "border-unbox-green bg-unbox-light/50 ring-1 ring-unbox-green";
    const inactiveStyle = "border-gray-200 hover:border-unbox-green/50 hover:bg-white";

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
            <div className="text-center md:text-left">
                <h2 className="text-3xl font-bold mb-3 text-unbox-dark">Найти свободное время</h2>
                <p className="text-unbox-grey text-lg">Выберите локацию и формат, чтобы увидеть расписание.</p>
            </div>

            <div className="space-y-8">
                {/* Location Selection */}
                <div className="space-y-4">
                    <label className="text-sm font-bold text-unbox-dark uppercase tracking-wider flex items-center gap-2">
                        <MapPin size={16} /> Локация
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {LOCATIONS.map((loc) => (
                            <button
                                key={loc.id}
                                onClick={() => setLocation(loc.id)}
                                className={clsx(
                                    "p-5 rounded-2xl border-2 text-left transition-all duration-200 relative overflow-hidden group",
                                    locationId === loc.id ? activeStyle : inactiveStyle
                                )}
                            >
                                <div className="relative z-10">
                                    <div className="font-bold text-lg text-unbox-dark mb-1">{loc.name}</div>
                                    <div className="text-sm text-unbox-grey group-hover:text-unbox-dark transition-colors">{loc.address}</div>
                                </div>
                                {locationId === loc.id && (
                                    <div className="absolute top-0 right-0 p-3">
                                        <div className="w-2 h-2 rounded-full bg-unbox-green animate-pulse" />
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Format Selection */}
                <div className="space-y-4">
                    <label className="text-sm font-bold text-unbox-dark uppercase tracking-wider flex items-center gap-2">
                        <Users size={16} /> Формат работы
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                            onClick={() => setFormat('individual')}
                            className={clsx(
                                "p-5 rounded-2xl border-2 text-left transition-all duration-200 flex items-center gap-4 group",
                                bookingFormat === 'individual' ? activeStyle : inactiveStyle
                            )}
                        >
                            <div className={clsx(
                                "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                                bookingFormat === 'individual' ? "bg-unbox-green text-white" : "bg-gray-100 text-unbox-grey group-hover:bg-gray-200"
                            )}>
                                <User size={20} />
                            </div>
                            <div>
                                <div className="font-bold text-lg text-unbox-dark">Индивидуально</div>
                                <div className="text-sm text-unbox-grey">Для одного человека</div>
                            </div>
                        </button>

                        <button
                            onClick={() => setFormat('group')}
                            className={clsx(
                                "p-5 rounded-2xl border-2 text-left transition-all duration-200 flex items-center gap-4 group",
                                bookingFormat === 'group' ? activeStyle : inactiveStyle
                            )}
                        >
                            <div className={clsx(
                                "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                                bookingFormat === 'group' ? "bg-unbox-green text-white" : "bg-gray-100 text-unbox-grey group-hover:bg-gray-200"
                            )}>
                                <Users size={20} />
                            </div>
                            <div>
                                <div className="font-bold text-lg text-unbox-dark">Группа</div>
                                <div className="text-sm text-unbox-grey">Для команды</div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>

            <div className="pt-4 flex justify-end">
                <Button
                    size="lg"
                    className="w-full md:w-auto px-8 py-6 text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    onClick={onNext}
                    disabled={!locationId}
                >
                    Показать расписание <ArrowRight className="ml-2" />
                </Button>
            </div>
        </div>
    );
}
