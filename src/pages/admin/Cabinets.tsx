import { useState, useEffect } from 'react';
import { LOCATIONS, CABINET_SERVICES } from '../../utils/data';
import { useBookingStore } from '../../store/bookingStore';
import { MapPin, Users, Ruler, Settings, ImageOff } from 'lucide-react';
import clsx from 'clsx';
import { ResourceModal } from '../../components/admin/ResourceModal';
import type { Resource } from '../../types';

export function AdminCabinets() {
    const { resources, fetchResources } = useBookingStore();
    const [filterLocation, setFilterLocation] = useState<string | 'all'>('all');

    // Edit State
    const [editingResource, setEditingResource] = useState<Resource | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        fetchResources();
    }, [fetchResources]);

    const filteredResources = filterLocation === 'all'
        ? resources
        : resources.filter(r => r.locationId === filterLocation);

    const handleEdit = (resource: Resource) => {
        setEditingResource(resource);
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-wrap justify-between items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Кабинеты</h1>
                    <p className="text-unbox-grey">Управление пространствами и ресурсами</p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setFilterLocation('all')}
                        className={clsx(
                            "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
                            filterLocation === 'all' ? "bg-unbox-green text-white" : "bg-white text-unbox-grey hover:bg-unbox-light/30"
                        )}
                    >
                        Все
                    </button>
                    {LOCATIONS.map(loc => (
                        <button
                            key={loc.id}
                            onClick={() => setFilterLocation(loc.id)}
                            className={clsx(
                                "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
                                filterLocation === loc.id ? "bg-unbox-green text-white" : "bg-white text-unbox-grey hover:bg-unbox-light/30"
                            )}
                        >
                            {loc.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredResources.map(resource => {
                    const coverPhoto = resource.photos?.[0];
                    const locationName = LOCATIONS.find(l => l.id === resource.locationId)?.name;
                    const resourceServices = (resource.services || [])
                        .map(id => CABINET_SERVICES.find(s => s.id === id))
                        .filter(Boolean)
                        .slice(0, 4);

                    return (
                        <div
                            key={resource.id}
                            className="bg-white/80 backdrop-blur-sm rounded-2xl overflow-hidden border border-white/70 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col"
                        >
                            {/* Photo / Placeholder */}
                            <div className="relative h-44 bg-gradient-to-br from-unbox-light to-gray-100 overflow-hidden">
                                {coverPhoto ? (
                                    <img
                                        src={coverPhoto}
                                        alt={resource.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 gap-2">
                                        <ImageOff size={32} />
                                        <span className="text-xs">Нет фото</span>
                                    </div>
                                )}

                                {/* Overlay badges */}
                                <div className="absolute top-3 left-3 flex gap-1.5">
                                    <span className={clsx(
                                        "px-2.5 py-1 rounded-full text-[11px] font-bold uppercase backdrop-blur-sm",
                                        resource.type === 'cabinet'
                                            ? "bg-white/90 text-unbox-green"
                                            : "bg-purple-500/90 text-white"
                                    )}>
                                        {resource.type === 'cabinet' ? 'Кабинет' : 'Капсула'}
                                    </span>
                                    {resource.isActive === false && (
                                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase bg-gray-800/80 text-white backdrop-blur-sm">
                                            Скрыт
                                        </span>
                                    )}
                                </div>

                                {resource.photos && resource.photos.length > 1 && (
                                    <span className="absolute bottom-2 right-2 text-[10px] bg-black/50 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
                                        +{resource.photos.length - 1} фото
                                    </span>
                                )}
                            </div>

                            {/* Content */}
                            <div className="p-4 flex flex-col gap-3 flex-1">
                                {/* Name + Location */}
                                <div>
                                    <h3 className="font-bold text-base">{resource.name}</h3>
                                    {locationName && (
                                        <div className="flex items-center text-xs text-unbox-grey mt-0.5 gap-1">
                                            <MapPin size={11} />
                                            {locationName}
                                        </div>
                                    )}
                                </div>

                                {/* Description */}
                                {resource.description && (
                                    <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                                        {resource.description}
                                    </p>
                                )}

                                {/* Services chips */}
                                {resourceServices.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {resourceServices.map(svc => svc && (
                                            <span
                                                key={svc.id}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-unbox-light/60 rounded-full text-[11px] text-gray-600"
                                                title={svc.label}
                                            >
                                                <span>{svc.emoji}</span>
                                                <span>{svc.label}</span>
                                            </span>
                                        ))}
                                        {(resource.services || []).length > 4 && (
                                            <span className="px-2 py-0.5 bg-unbox-light/60 rounded-full text-[11px] text-unbox-grey">
                                                +{(resource.services || []).length - 4}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Stats + Action */}
                                <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-auto">
                                    <div className="flex items-center gap-3 text-xs text-unbox-grey">
                                        <span className="flex items-center gap-1">
                                            <Users size={12} /> {resource.capacity} чел.
                                        </span>
                                        {resource.area && (
                                            <span className="flex items-center gap-1">
                                                <Ruler size={12} /> {resource.area} м²
                                            </span>
                                        )}
                                        <span className="font-semibold text-unbox-dark">{resource.hourlyRate} ₾/ч</span>
                                    </div>
                                    <button
                                        onClick={() => handleEdit(resource)}
                                        className="flex items-center gap-1.5 text-xs font-medium text-unbox-grey hover:text-unbox-green transition-colors px-3 py-1.5 rounded-lg hover:bg-unbox-light/50"
                                    >
                                        <Settings size={13} /> Настройки
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <ResourceModal
                resource={editingResource}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
            />
        </div>
    );
}
