import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { useLocations } from '../hooks/useLocations';
import { MinimalLayout } from '../components/MinimalLayout';
import { JoinWaitlistModal } from '../components/JoinWaitlistModal';
import { Card } from '../components/ui/Card';
import { MapPin, ArrowRight, User, Users, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import clsx from 'clsx';
import type { Format, GroupSize } from '../types';

// Fix for default Leaflet marker icons in Vite
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

function MapBounds({ locations, selectedLocId }: { locations: any[], selectedLocId: string | null }) {
    const map = useMap();
    useEffect(() => {
        if (selectedLocId) {
            const loc = locations.find((l: any) => l.id === selectedLocId);
            if (loc && loc.lat && loc.lng) {
                map.flyTo([loc.lat, loc.lng], 15, { duration: 1.5 });
            }
        } else {
            const validLocs = locations.filter((l: any) => l.lat && l.lng);
            if (validLocs.length > 0) {
                const bounds = L.latLngBounds(validLocs.map((l: any) => [l.lat, l.lng]));
                // Add padding to ensure points aren't exactly on the edge
                map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
            }
        }
    }, [locations, selectedLocId, map]);
    return null;
}

const GROUP_SIZES: { value: GroupSize; label: string }[] = [
    { value: '4-8', label: '4-8 человек' },
    { value: '8-14', label: '8-14 человек' },
    { value: '14-20', label: '14-20 человек' },
    { value: '20-30', label: '20-30 человек' },
    { value: '30+', label: '30+ человек' },
];

export function ExplorePage() {
    const { setLocation, setFormat, setGroupSize, setStep } = useBookingStore();
    const { data: locations = [], isLoading } = useLocations();
    const navigate = useNavigate();

    const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
    const [selectedFormat, setSelectedFormat] = useState<Format | null>(null);
    const [selectedSize, setSelectedSize] = useState<GroupSize | null>(null);
    const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);

    // Validation
    const canProceed = selectedLocId && selectedFormat && (selectedFormat === 'individual' || selectedSize);

    const handleProceed = () => {
        if (!canProceed) return;

        setLocation(selectedLocId);
        setFormat(selectedFormat);
        setGroupSize(selectedFormat === 'group' ? selectedSize : null);
        setStep(2); // Go straight to chessboard

        navigate('/checkout');
    };

    return (
        <MinimalLayout showBackButton={false} fullWidth noPadding>
            {isLoading ? (
                <div className="flex flex-col items-center justify-center h-[70vh] space-y-4">
                    <div className="w-12 h-12 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin"></div>
                    <p className="text-gray-500 font-medium">Загружаем пространства...</p>
                </div>
            ) : (
                <div className="flex flex-col lg:flex-row min-h-[calc(100vh-80px)] w-full">
                    {/* ЛЕВАЯ КОЛОНКА: Настройки и список (Сценарий) */}
                    <div className="w-full lg:w-2/3 shrink-0 bg-white border-r border-gray-100 flex flex-col relative z-10 shadow-xl overflow-y-auto" style={{ maxHeight: 'calc(100vh - 80px)' }}>
                        <div className="p-6 md:p-10 space-y-10 w-full max-w-4xl mx-auto">
                            {/* Заголовок */}
                            <div>
                                <h1 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-br from-teal-700 to-indigo-800 mb-3 tracking-tight">
                                    Где вы хотите работать?
                                </h1>
                                <p className="text-gray-500 text-lg">
                                    Выберите формат и локацию на карте.
                                </p>
                            </div>

                        {/* Формат Работы */}
                        <section>
                            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-5 flex items-center justify-center gap-2">
                                <Users className="w-5 h-5" />
                                1. Выберите формат
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
                                <button
                                    onClick={() => {
                                        setSelectedFormat('individual');
                                        setSelectedSize(null);
                                    }}
                                    className={clsx(
                                        "flex items-center gap-3 sm:gap-5 p-4 sm:p-6 rounded-2xl border-2 transition-all duration-300 text-left w-full overflow-hidden",
                                        selectedFormat === 'individual'
                                            ? "border-teal-500 bg-teal-50/50 shadow-lg shadow-teal-500/20 scale-[1.02]"
                                            : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-md"
                                    )}
                                >
                                    <div className={clsx("p-3 sm:p-4 rounded-full transition-colors shrink-0", selectedFormat === 'individual' ? "bg-teal-600 text-white shadow-md shadow-teal-600/30" : "bg-gray-100 text-gray-500")}>
                                        <User className="w-6 h-6 sm:w-7 sm:h-7" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className={clsx("font-bold text-lg sm:text-xl break-words leading-tight", selectedFormat === 'individual' ? "text-teal-900" : "text-gray-900")}>
                                            Индивидуально
                                        </h3>
                                        <p className="text-gray-500 mt-1 text-xs sm:text-sm break-words leading-snug">Для одного человека</p>
                                    </div>
                                </button>

                                <button
                                    onClick={() => setSelectedFormat('group')}
                                    className={clsx(
                                        "flex items-center gap-3 sm:gap-5 p-4 sm:p-6 rounded-2xl border-2 transition-all duration-300 text-left w-full overflow-hidden",
                                        selectedFormat === 'group'
                                            ? "border-teal-500 bg-teal-50/50 shadow-lg shadow-teal-500/20 scale-[1.02]"
                                            : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-md"
                                    )}
                                >
                                    <div className={clsx("p-3 sm:p-4 rounded-full transition-colors shrink-0", selectedFormat === 'group' ? "bg-teal-600 text-white shadow-md shadow-teal-600/30" : "bg-gray-100 text-gray-500")}>
                                        <Users className="w-6 h-6 sm:w-7 sm:h-7" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className={clsx("font-bold text-lg sm:text-xl break-words leading-tight", selectedFormat === 'group' ? "text-teal-900" : "text-gray-900")}>
                                            Группа
                                        </h3>
                                        <p className="text-gray-500 mt-1 text-xs sm:text-sm break-words leading-snug">Для команд и мероприятий</p>
                                    </div>
                                </button>
                            </div>
                        </section>

                        {/* Размер группы */}
                        <AnimatePresence>
                            {selectedFormat === 'group' && (
                                <motion.section
                                    initial={{ opacity: 0, height: 0, y: -20 }}
                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                    exit={{ opacity: 0, height: 0, y: -20 }}
                                    className="overflow-hidden"
                                >
                                    <div className="py-2 max-w-3xl mx-auto text-center">
                                        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-5">
                                            Количество человек
                                        </h2>
                                        <div className="flex flex-wrap justify-center gap-3">
                                            {GROUP_SIZES.map(size => (
                                                <button
                                                    key={size.value}
                                                    onClick={() => setSelectedSize(size.value)}
                                                    className={clsx(
                                                        "px-6 py-3 rounded-full border-2 text-base font-medium transition-all hover:scale-105 active:scale-95",
                                                        selectedSize === size.value
                                                            ? "border-teal-500 bg-teal-500 text-white shadow-md shadow-teal-500/30"
                                                            : "border-gray-200 bg-white text-gray-600 hover:border-teal-300 hover:text-teal-700"
                                                    )}
                                                >
                                                    {size.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </motion.section>
                            )}
                        </AnimatePresence>

                        {/* Локация */}
                        <AnimatePresence>
                            {selectedFormat && (selectedFormat === 'individual' || selectedSize) && (
                                <motion.section
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.1 }}
                                >
                                    <hr className="my-10 border-gray-100" />
                                    <div className="flex items-center justify-between mb-6">
                                        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                                            <MapPin className="w-5 h-5 text-teal-600" />
                                            2. Выберите локацию
                                        </h2>
                                        <div className="text-xs font-medium bg-gray-100 text-gray-500 px-3 py-1 rounded-full">
                                            Найдено: {locations.length}
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-col gap-5">
                                        {locations.map((loc, index) => {
                                            const isSelected = selectedLocId === loc.id;
                                            return (
                                                <motion.div
                                                    key={loc.id}
                                                    initial={{ opacity: 0, y: 20 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ duration: 0.4, delay: index * 0.1 }}
                                                >
                                                    <Card
                                                        className={clsx(
                                                            "flex flex-col sm:flex-row transition-all duration-300 cursor-pointer overflow-hidden border-2 group",
                                                            isSelected
                                                                ? "border-teal-500 shadow-xl shadow-teal-500/10 bg-teal-50/20"
                                                                : "border-gray-100 hover:border-teal-200 hover:shadow-lg"
                                                        )}
                                                        onClick={() => setSelectedLocId(loc.id)}
                                                    >
                                                        {/* Изображение сбоку для компактности */}
                                                        <div className="h-40 sm:h-auto sm:w-48 bg-gray-100 relative overflow-hidden shrink-0">
                                                            {loc.image ? (
                                                                <img
                                                                    src={loc.image}
                                                                    alt={loc.name}
                                                                    className={clsx(
                                                                        "w-full h-full object-cover transition-transform duration-700",
                                                                        !isSelected && "group-hover:scale-105"
                                                                    )}
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-200">
                                                                    <span className="text-gray-400 font-medium tracking-wide text-sm">Нет фото</span>
                                                                </div>
                                                            )}
                                                            <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-teal-700 shadow-sm">
                                                                Partner
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="p-5 flex-1 flex flex-col justify-between">
                                                            <div>
                                                                <div className="flex justify-between items-start mb-1">
                                                                    <h3 className="text-xl font-bold text-gray-900 leading-tight">{loc.name}</h3>
                                                                    {isSelected && (
                                                                        <div className="text-teal-500 bg-teal-50 p-1.5 rounded-full">
                                                                            <ArrowRight className="w-4 h-4" />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-start text-gray-500 mb-3 text-sm font-medium">
                                                                    <MapPin className="w-4 h-4 mr-1 mt-0.5 shrink-0 text-gray-400" />
                                                                    <span className="line-clamp-2">{loc.address}</span>
                                                                </div>
                                                            </div>

                                                            {loc.features && loc.features.length > 0 && (
                                                                <div className="flex flex-wrap gap-1.5 mt-3">
                                                                    {loc.features.slice(0, 3).map((feature: string, i: number) => (
                                                                        <span key={i} className="text-[11px] bg-gray-100/80 text-gray-600 px-2 py-1 rounded-md font-medium border border-gray-200/50">
                                                                            {feature}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </Card>
                                                </motion.div>
                                            );
                                        })}
                                    </div>
                                </motion.section>
                            )}
                        </AnimatePresence>

                        {/* Продолжить */}
                        <div className="pt-10 flex flex-col items-center">
                            <AnimatePresence>
                                {canProceed ? (
                                    <motion.div
                                        key="proceed-btn"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 10 }}
                                        className="w-full flex flex-col items-center"
                                    >
                                        <button
                                            onClick={handleProceed}
                                            className="flex items-center justify-center gap-3 w-full max-w-sm py-4 rounded-2xl font-bold text-lg bg-teal-600 hover:bg-teal-700 text-white shadow-xl shadow-teal-500/30 hover:shadow-teal-500/40 hover:-translate-y-1 transition-all active:scale-95"
                                        >
                                            Смотреть расписание
                                            <ArrowRight className="w-5 h-5" />
                                        </button>
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="waitlist-btn"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.5 }}
                                        className="mt-4 pt-6 border-t border-gray-100 max-w-sm w-full text-center"
                                    >
                                        <p className="text-gray-500 mb-3 font-medium text-sm">Не нашли подходящий вариант?</p>
                                        <button
                                            onClick={() => setIsWaitlistOpen(true)}
                                            className="text-indigo-600 font-bold hover:text-indigo-700 underline underline-offset-4 decoration-indigo-200 hover:decoration-indigo-600 transition-colors text-sm"
                                        >
                                            Присоединиться к листу ожидания
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* ПРАВАЯ КОЛОНКА: Карта */}
                    <div className="hidden lg:flex lg:w-1/3 shrink-0 relative z-0 bg-unbox-light/30 items-center justify-center p-4 xl:p-8">
                        <div className="w-full h-full max-h-[600px] min-h-[400px] rounded-3xl overflow-hidden shadow-xl border-4 border-white/90 relative">
                            <MapContainer 
                                center={[41.6416, 41.6415]} // Batumi center fallback
                                zoom={12}
                                style={{ height: '100%', width: '100%' }}
                            zoomControl={false}
                        >
                            <MapBounds locations={locations} selectedLocId={selectedLocId} />
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                            />
                            {locations.filter(l => l.lat && l.lng).map(loc => (
                                <Marker 
                                    key={loc.id} 
                                    position={[loc.lat!, loc.lng!]}
                                    eventHandlers={{
                                        click: () => {
                                            setSelectedLocId(loc.id);
                                            // Optional: Scroll left panel to the card
                                        },
                                    }}
                                >
                                    <Popup className="premium-popup">
                                        <div className="font-bold text-gray-900 text-base">{loc.name}</div>
                                        <div className="text-gray-500 text-xs mt-1">{loc.address}</div>
                                        {selectedLocId !== loc.id && (
                                            <button 
                                                onClick={() => setSelectedLocId(loc.id)}
                                                className="mt-2 w-full bg-teal-600 hover:bg-teal-700 text-white py-1.5 rounded text-xs font-bold transition-colors"
                                            >
                                                Выбрать
                                            </button>
                                        )}
                                    </Popup>
                                </Marker>
                            ))}
                        </MapContainer>
                        
                            {/* Плашка с фильтром на карте (декоративная/резерв для будущего) */}
                            <div className="absolute top-4 right-4 z-[400]">
                                <button className="bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl shadow-lg border border-gray-200 flex items-center gap-2 text-sm font-bold text-gray-700 hover:bg-white transition-colors">
                                    <Filter className="w-4 h-4" />
                                    Фильтры
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            <JoinWaitlistModal isOpen={isWaitlistOpen} onClose={() => setIsWaitlistOpen(false)} />
        </MinimalLayout>
    );
}
