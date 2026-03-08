import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBookingStore } from '../store/bookingStore';
import { MinimalLayout } from '../components/MinimalLayout';
import { ChessboardStep } from '../components/Wizard/ChessboardStep';
import { MapPin, Wifi, Coffee, Users, Shield, Calendar, Clock, CreditCard } from 'lucide-react';
import clsx from 'clsx';

export function LocationDetailsPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { locations, fetchLocations, setLocation, setStep, selectedSlots, date } = useBookingStore();

    useEffect(() => {
        if (locations.length === 0) {
            fetchLocations();
        }
    }, [locations.length, fetchLocations]);

    const location = locations.find(loc => loc.id === id);

    useEffect(() => {
        if (id) {
            setLocation(id);
            // Default to individual format when entering straight from location
            // useBookingStore.getState().setFormat('individual'); // Or leave whatever is in store
        }
    }, [id, setLocation]);

    if (!location) {
        return (
            <MinimalLayout>
                <div className="flex justify-center py-20 text-unbox-dark font-medium">Загрузка локации...</div>
            </MinimalLayout>
        );
    }

    // Force step 2 (chessboard) internally so the Summary or other components relying on step work correctly if mounted
    useEffect(() => {
        setStep(2);
    }, [setStep]);

    // Mocking an array of photos for the gallery
    const photos = [
        location.image || 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1556761175-5973dc0f32d7?auto=format&fit=crop&q=80'
    ];

    // Total price calculation for the sticky widget
    const calculateTotal = () => {
        let total = 0;
        selectedSlots.forEach(() => {
            // just a rough estimate since we don't have exact resource price here easily, 
            // but we can assume an average or fetch from store if needed. 
            // For now, let's use a mock flat rate for the widget preview
            total += 10; // 10GEL per 30m
        });
        return total;
    };

    return (
        <MinimalLayout>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mb-20">
                {/* Header */}
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">{location.name}</h1>
                        <div className="flex items-center text-gray-500 font-medium">
                            <MapPin className="w-4 h-4 mr-1.5 text-teal-600" />
                            {location.address}
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/')}
                        className="text-sm font-bold text-teal-600 hover:text-teal-700 bg-teal-50 px-4 py-2 rounded-full transition-colors"
                    >
                        Сменить локацию
                    </button>
                </div>

                {/* Hero Gallery (1 large, 2 small) */}
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
                    {/* Left Column: Info & Chessboard */}
                    <div className="flex-1 min-w-0">
                        {/* Features & Amenities */}
                        <div className="mb-12">
                            <h2 className="text-2xl font-bold text-gray-900 mb-6">Удобства локации</h2>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {location.features?.map((feature, i) => {
                                    // Assign random icons based on text content (mock logic)
                                    let Icon = Coffee;
                                    if (feature.toLowerCase().includes('wifi') || feature.toLowerCase().includes('интернет')) Icon = Wifi;
                                    if (feature.toLowerCase().includes('переговор')) Icon = Users;
                                    if (feature.toLowerCase().includes('охран') || feature.toLowerCase().includes('доступ')) Icon = Shield;
                                    
                                    return (
                                        <div key={i} className="flex items-center gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                            <div className="bg-white p-2 rounded-xl text-teal-600 shadow-sm border border-gray-100">
                                                <Icon className="w-5 h-5" />
                                            </div>
                                            <span className="font-medium text-gray-700 text-sm leading-tight">{feature}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        <hr className="border-gray-100 my-10" />

                        {/* Chessboard Section */}
                        <div id="booking-section">
                            <div className="mb-6">
                                <h2 className="text-2xl font-bold text-gray-900 mb-2">Доступные пространства</h2>
                                <p className="text-gray-500">Выберите подходящий кабинет и выделите желаемое время.</p>
                            </div>
                            
                            {/* Render the unified Chessboard directly */}
                            <div className="bg-white p-1 rounded-3xl">
                                <ChessboardStep />
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Sticky Booking Widget */}
                    <div className="w-full lg:w-[380px] shrink-0">
                        <div className="sticky top-8 bg-white rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-gray-100">
                            <div className="mb-6">
                                <div className="text-2xl font-black text-gray-900 mb-1">
                                    <span className="text-teal-600">от 10 ₾</span> <span className="text-base font-medium text-gray-400">/ 30 мин</span>
                                </div>
                                <div className="flex items-center gap-1 text-sm font-medium text-amber-500">
                                    ★ 4.9 <span className="text-gray-400 underline decoration-dotted ml-1">(128 отзывов)</span>
                                </div>
                            </div>

                            <div className="space-y-3 mb-6">
                                <div className="flex items-center justify-between p-4 rounded-2xl border border-gray-200 bg-gray-50/50">
                                    <div className="flex items-center gap-3">
                                        <Calendar className="w-5 h-5 text-gray-400" />
                                        <div>
                                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Дата</div>
                                            <div className="text-sm font-medium text-gray-900">{date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="flex items-center justify-between p-4 rounded-2xl border border-gray-200 bg-gray-50/50">
                                    <div className="flex items-center gap-3">
                                        <Clock className="w-5 h-5 text-gray-400" />
                                        <div>
                                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Выбрано слотов</div>
                                            <div className="text-sm font-medium text-gray-900">
                                                {selectedSlots.length > 0 ? `${selectedSlots.length} (по 30 мин)` : 'Не выбрано'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-gray-100 mb-6">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-gray-500 font-medium text-sm">Всего</span>
                                    <span className="text-xl font-bold text-gray-900">{calculateTotal()} ₾</span>
                                </div>
                                <div className="text-xs text-gray-400 text-right">Включая налоги</div>
                            </div>

                            <button 
                                disabled={selectedSlots.length === 0}
                                onClick={() => navigate('/checkout')}
                                className={clsx(
                                    "w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all duration-300",
                                    selectedSlots.length > 0 
                                        ? "bg-teal-600 hover:bg-teal-700 text-white shadow-xl shadow-teal-500/30 hover:-translate-y-1 active:scale-95" 
                                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                )}
                            >
                                <CreditCard className="w-5 h-5" />
                                {selectedSlots.length > 0 ? 'Забронировать' : 'Выберите время'}
                            </button>

                            <div className="mt-4 text-center text-xs text-gray-500 flex flex-col items-center gap-1">
                                <span>Деньги пока не будут списаны</span>
                                <span className="flex items-center gap-1 text-teal-600 bg-teal-50 px-2 py-0.5 rounded text-[10px] font-bold">
                                    <Shield className="w-3 h-3" /> Безопасная оплата
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </MinimalLayout>
    );
}
