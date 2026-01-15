import { useState, useEffect } from 'react';
import { LOCATIONS } from '../../utils/data';
import { useBookingStore } from '../../store/bookingStore';
import { Card } from '../../components/ui/Card';
import { MapPin, Users, Ruler, Settings } from 'lucide-react';
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
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Кабинеты</h1>
                    <p className="text-gray-500">Управление пространствами и ресурсами</p>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setFilterLocation('all')}
                        className={clsx(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            filterLocation === 'all' ? "bg-black text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                        )}
                    >
                        Все
                    </button>
                    {LOCATIONS.map(loc => (
                        <button
                            key={loc.id}
                            onClick={() => setFilterLocation(loc.id)}
                            className={clsx(
                                "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                                filterLocation === loc.id ? "bg-black text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                            )}
                        >
                            {loc.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredResources.map(resource => (
                    <Card key={resource.id} className="p-6 flex flex-col gap-4 hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="font-bold text-lg">{resource.name}</h3>
                                <div className="flex items-center text-sm text-gray-500 mt-1">
                                    <MapPin size={14} className="mr-1" />
                                    {LOCATIONS.find(l => l.id === resource.locationId)?.name}
                                </div>
                            </div>
                            <span className={clsx(
                                "px-2 py-1 rounded text-xs font-bold uppercase",
                                resource.type === 'cabinet' ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                            )}>
                                {resource.type === 'cabinet' ? 'Кабинет' : 'Капсула'}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 py-2 border-t border-b border-gray-100 text-sm">
                            <div className="flex items-center gap-2 text-gray-600">
                                <Users size={16} />
                                <span>до {resource.capacity} чел.</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                                <Ruler size={16} />
                                <span>{resource.area} м²</span>
                            </div>
                        </div>

                        <div className="flex justify-between items-center text-sm">
                            <div className="flex items-center gap-2 font-medium">
                                <span>{resource.hourlyRate} ₾ / час</span>
                            </div>
                            <button
                                onClick={() => handleEdit(resource)}
                                className="text-gray-400 hover:text-black flex items-center gap-1 transition-colors"
                            >
                                <Settings size={14} /> Настройки
                            </button>
                        </div>
                    </Card>
                ))}
            </div>

            <ResourceModal
                resource={editingResource}
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
            />
        </div>
    );
}
