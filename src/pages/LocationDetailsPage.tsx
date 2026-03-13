import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { MinimalLayout } from '../components/MinimalLayout';
import { ChessboardStep } from '../components/Wizard/ChessboardStep';
import { CABINET_SERVICES } from '../utils/data';
import { MapPin, Wifi, Coffee, Users, Shield, Calendar, Clock, CreditCard, Ruler, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

export function LocationDetailsPage() {
    const { locationId: id } = useParams<{ locationId: string }>();
    const navigate = useNavigate();
    const chessboardRef = useRef<HTMLDivElement>(null);
    const { locations, resources, fetchLocations, fetchResources, setLocation, setStep, selectedSlots, date } = useBookingStore();

    useEffect(() => {
        if (locations.length === 0) fetchLocations();
        if (resources.length === 0) fetchResources();
    }, [locations.length, resources.length, fetchLocations, fetchResources]);

    const location = locations.find(loc => loc.id === id);

    useEffect(() => {
        if (id) setLocation(id);
    }, [id, setLocation]);

    useEffect(() => {
        setStep(2);
    }, [setStep]);

    if (!location) {
        return (
            <MinimalLayout>
                <div className="flex justify-center py-20 text-unbox-dark font-medium">Загрузка локации...</div>
            </MinimalLayout>
        );
    }

    // Location resources (active only)
    const locationResources = resources.filter(r => r.locationId === id && r.isActive !== false);

    // Gallery photos
    const photos = [
        location.image || 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1556761175-5973dc0f32d7?auto=format&fit=crop&q=80'
    ];

    const calculateTotal = () => {
        let total = 0;
        selectedSlots.forEach(() => { total += 10; });
        return total;
    };

    const scrollToChessboard = () => {
        chessboardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <MinimalLayout>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mb-20">
                {/* Header */}
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="text-4xl font-black text-unbox-dark tracking-tight mb-2">{location.name}</h1>
                        <div className="flex items-center text-unbox-grey font-medium">
                            <MapPin className="w-4 h-4 mr-1.5 text-unbox-green" />
                            {location.address}
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/')}
                        className="text-sm font-bold text-unbox-green hover:text-unbox-dark bg-unbox-light px-4 py-2 rounded-full transition-colors"
                    >
                        Сменить локацию
                    </button>
                </div>

                {/* Hero Gallery */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 md:h-[400px] rounded-3xl overflow-hidden mb-12">
                    <div className="md:col-span-3 h-64 md:h-full relative group cursor-pointer">
                        <img src={photos[0]} alt="Main" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors duration-500" />
                    </div>
                    <div className="hidden md:flex flex-col gap-2 h-full">
                        <div className="flex-1 relative group cursor-pointer overflow-hidden">
                            <img src={photos[1]} alt="Side 1" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                            <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors duration-500" />
                        </div>
                        <div className="flex-1 relative group cursor-pointer overflow-hidden">
                            <img src={photos[2]} alt="Side 2" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-500" />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-white font-bold bg-black/30 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
                                    Все фото
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-12">
                    {/* Left Column */}
                    <div className="flex-1 min-w-0">
                        {/* Location Features */}
                        {location.features && location.features.length > 0 && (
                            <div className="mb-12">
                                <h2 className="text-2xl font-bold text-unbox-dark mb-6">Удобства локации</h2>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {location.features.map((feature, i) => {
                                        let Icon = Coffee;
                                        if (feature.toLowerCase().includes('wifi') || feature.toLowerCase().includes('интернет')) Icon = Wifi;
                                        if (feature.toLowerCase().includes('переговор')) Icon = Users;
                                        if (feature.toLowerCase().includes('охран') || feature.toLowerCase().includes('доступ')) Icon = Shield;
                                        return (
                                            <div key={i} className="flex items-center gap-3 bg-unbox-light/30 p-4 rounded-2xl border border-unbox-light">
                                                <div className="bg-white p-2 rounded-xl text-unbox-green shadow-sm border border-unbox-light">
                                                    <Icon className="w-5 h-5" />
                                                </div>
                                                <span className="font-medium text-unbox-dark text-sm leading-tight">{feature}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── Cabinet Cards Section ── */}
                        {locationResources.length > 0 && (
                            <div className="mb-12">
                                <div className="flex items-end justify-between mb-6">
                                    <div>
                                        <h2 className="text-2xl font-bold text-unbox-dark">Кабинеты и пространства</h2>
                                        <p className="text-unbox-grey text-sm mt-1">
                                            {locationResources.length} {locationResources.length === 1 ? 'пространство доступно' : locationResources.length < 5 ? 'пространства доступны' : 'пространств доступно'} для аренды
                                        </p>
                                    </div>
                                    <button
                                        onClick={scrollToChessboard}
                                        className="flex items-center gap-1 text-sm font-medium text-unbox-green hover:text-unbox-dark transition-colors"
                                    >
                                        Выбрать время <ChevronRight size={16} />
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    {locationResources.map(resource => {
                                        const coverPhoto = resource.photos?.[0];
                                        const resourceServices = (resource.services || [])
                                            .map(sid => CABINET_SERVICES.find(s => s.id === sid))
                                            .filter(Boolean);

                                        return (
                                            <div
                                                key={resource.id}
                                                className="group bg-white rounded-3xl overflow-hidden border border-unbox-light shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col"
                                            >
                                                {/* Photo */}
                                                <div className="relative h-52 bg-gradient-to-br from-unbox-light to-gray-100 overflow-hidden">
                                                    {coverPhoto ? (
                                                        <img
                                                            src={coverPhoto}
                                                            alt={resource.name}
                                                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <div className="text-center text-gray-300">
                                                                <div className="text-5xl mb-2">🏠</div>
                                                                <div className="text-sm font-medium text-gray-400">{resource.name}</div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Type badge */}
                                                    <div className="absolute top-3 left-3">
                                                        <span className={clsx(
                                                            'px-2.5 py-1 rounded-full text-xs font-bold uppercase backdrop-blur-sm',
                                                            resource.type === 'capsule'
                                                                ? 'bg-purple-500/90 text-white'
                                                                : 'bg-white/90 text-unbox-green'
                                                        )}>
                                                            {resource.type === 'capsule' ? 'Капсула' : 'Кабинет'}
                                                        </span>
                                                    </div>

                                                    {/* Price */}
                                                    <div className="absolute bottom-3 right-3">
                                                        <span className="bg-unbox-dark/80 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-sm font-bold">
                                                            {resource.hourlyRate} ₾/час
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Content */}
                                                <div className="p-5 flex flex-col gap-3 flex-1">
                                                    <div>
                                                        <h3 className="text-lg font-bold text-unbox-dark">{resource.name}</h3>
                                                        <div className="flex items-center gap-3 mt-1 text-sm text-unbox-grey">
                                                            <span className="flex items-center gap-1">
                                                                <Users size={13} /> до {resource.capacity} чел.
                                                            </span>
                                                            {resource.area && (
                                                                <span className="flex items-center gap-1">
                                                                    <Ruler size={13} /> {resource.area} м²
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {resource.description && (
                                                        <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">
                                                            {resource.description}
                                                        </p>
                                                    )}

                                                    {/* Services */}
                                                    {resourceServices.length > 0 && (
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {resourceServices.slice(0, 5).map(svc => svc && (
                                                                <span
                                                                    key={svc.id}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-unbox-light/70 rounded-full text-xs text-gray-600 border border-unbox-light"
                                                                >
                                                                    <span>{svc.emoji}</span>
                                                                    <span>{svc.label}</span>
                                                                </span>
                                                            ))}
                                                            {resourceServices.length > 5 && (
                                                                <span className="px-2.5 py-1 bg-unbox-light/70 rounded-full text-xs text-unbox-grey border border-unbox-light">
                                                                    +{resourceServices.length - 5}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* CTA button */}
                                                    <button
                                                        onClick={scrollToChessboard}
                                                        className="mt-auto w-full py-3 rounded-2xl font-semibold text-sm bg-unbox-light/50 text-unbox-dark border border-unbox-light hover:bg-unbox-green hover:text-white hover:border-unbox-green transition-all duration-200"
                                                    >
                                                        Выбрать время →
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <hr className="border-unbox-light my-10" />

                        {/* Chessboard Section */}
                        <div id="booking-section" ref={chessboardRef}>
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold text-unbox-dark mb-2">Доступные пространства</h2>
                                <p className="text-unbox-grey">Выберите подходящий кабинет и выделите желаемое время.</p>
                            </div>
                            <div className="bg-white p-1 rounded-3xl">
                                <ChessboardStep />
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Sticky Booking Widget */}
                    <div className="w-full lg:w-[380px] shrink-0">
                        <div className="sticky top-8 bg-white rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-unbox-light">
                            <div className="mb-6">
                                <div className="text-2xl font-black text-unbox-dark mb-1">
                                    <span className="text-unbox-green">от 10 ₾</span> <span className="text-base font-medium text-unbox-grey">/ 30 мин</span>
                                </div>
                                <div className="flex items-center gap-1 text-sm font-medium text-amber-500">
                                    ★ 4.9 <span className="text-unbox-grey underline decoration-dotted ml-1">(128 отзывов)</span>
                                </div>
                            </div>

                            <div className="space-y-3 mb-6">
                                <div className="flex items-center justify-between p-4 rounded-2xl border border-unbox-light bg-unbox-light/30">
                                    <div className="flex items-center gap-3">
                                        <Calendar className="w-5 h-5 text-unbox-grey" />
                                        <div>
                                            <div className="text-xs font-bold text-unbox-grey uppercase tracking-wider">Дата</div>
                                            <div className="text-sm font-medium text-unbox-dark">{date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-2xl border border-unbox-light bg-unbox-light/30">
                                    <div className="flex items-center gap-3">
                                        <Clock className="w-5 h-5 text-unbox-grey" />
                                        <div>
                                            <div className="text-xs font-bold text-unbox-grey uppercase tracking-wider">Выбрано слотов</div>
                                            <div className="text-sm font-medium text-unbox-dark">
                                                {selectedSlots.length > 0 ? `${selectedSlots.length} (по 30 мин)` : 'Не выбрано'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-unbox-light mb-6">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-unbox-grey font-medium text-sm">Всего</span>
                                    <span className="text-xl font-bold text-unbox-dark">{calculateTotal()} ₾</span>
                                </div>
                                <div className="text-xs text-unbox-grey text-right">Включая налоги</div>
                            </div>

                            <button
                                disabled={selectedSlots.length === 0}
                                onClick={() => navigate('/checkout')}
                                className={clsx(
                                    "w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all duration-300",
                                    selectedSlots.length > 0
                                        ? "bg-unbox-green hover:bg-unbox-dark text-white shadow-xl shadow-unbox-green/30 hover:-translate-y-1 active:scale-95"
                                        : "bg-unbox-light/50 text-unbox-grey cursor-not-allowed"
                                )}
                            >
                                <CreditCard className="w-5 h-5" />
                                {selectedSlots.length > 0 ? 'Забронировать' : 'Выберите время'}
                            </button>

                            <div className="mt-4 text-center text-xs text-unbox-grey flex flex-col items-center gap-1">
                                <span>Деньги пока не будут списаны</span>
                                <span className="flex items-center gap-1 text-unbox-green bg-unbox-light px-2 py-0.5 rounded text-[10px] font-bold">
                                    <Shield className="w-3 h-3" /> Безопасная оплата
                                </span>
                            </div>

                            {/* Quick cabinet list */}
                            {locationResources.length > 0 && (
                                <div className="mt-5 pt-4 border-t border-unbox-light">
                                    <p className="text-[10px] font-semibold text-unbox-grey uppercase tracking-wider mb-2">Кабинеты</p>
                                    <div className="space-y-1.5">
                                        {locationResources.slice(0, 5).map(r => (
                                            <div key={r.id} className="flex items-center justify-between text-xs">
                                                <span className="text-unbox-dark font-medium">{r.name}</span>
                                                <span className="text-unbox-grey">{r.hourlyRate} ₾/ч</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </MinimalLayout>
    );
}
