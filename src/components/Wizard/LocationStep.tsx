import { useBookingStore } from '../../store/bookingStore';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import { Card } from '../ui/Card';
import { MapPin, Box } from 'lucide-react';
import clsx from 'clsx';

export function LocationStep() {
    const { locationId, resourceId, setLocation, setResource } = useBookingStore();

    const activeResources = RESOURCES.filter(r => r.locationId === locationId);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-bold mb-2">Выберите локацию</h2>
                <p className="text-unbox-grey">Где вы хотите работать?</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {LOCATIONS.map((loc) => (
                    <Card
                        key={loc.id}
                        className="p-6 flex items-start gap-4"
                        selected={locationId === loc.id}
                        onClick={() => setLocation(loc.id)}
                    >
                        <div className={clsx(
                            "p-3 rounded-xl transition-colors",
                            locationId === loc.id ? "bg-unbox-green text-white" : "bg-unbox-light text-unbox-grey group-hover:text-unbox-dark"
                        )}>
                            <MapPin size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg">{loc.name}</h3>
                            <p className="text-unbox-grey text-sm mt-1">{loc.address}</p>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Resources Selection - Only show if location selected */}
            {locationId && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-6">
                    <div className="border-t border-gray-100 pt-8">
                        <h2 className="text-xl font-bold mb-2">Выберите пространство</h2>
                        <p className="text-unbox-grey">Кабинет или капсула?</p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {activeResources.map((res) => (
                            <Card
                                key={res.id}
                                className="p-4"
                                selected={resourceId === res.id}
                                onClick={() => setResource(res.id)}
                            >
                                <div className="flex flex-col h-full justify-between gap-4">
                                    <div className="flex justify-between items-start">
                                        <span className={clsx(
                                            "text-xs font-bold px-2 py-1 rounded",
                                            "bg-unbox-light text-unbox-dark" // Unified peaceful style
                                        )}>
                                            {res.type === 'cabinet' ? 'Кабинет' : 'Капсула'}
                                        </span>
                                        {resourceId === res.id && (
                                            <div className="bg-unbox-green text-white rounded-full p-1">
                                                <Box size={12} />
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <h4 className="font-bold">{res.name}</h4>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
