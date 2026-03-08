import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Video, MapPin, Calendar, CheckCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { api } from '../api/client';
import type { Specialist } from '../components/Specialists/SpecialistCard';
import { useBookingStore } from '../store/bookingStore';

export function SpecialistProfilePage() {
    const { id } = useParams<{ id: string }>();
    const [specialist, setSpecialist] = useState<Specialist | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // To optionally pre-fill booking wizard
    const setStep = useBookingStore(s => s.setStep);

    useEffect(() => {
        const fetchSpecialist = async () => {
            try {
                const res = await api.get(`/specialists/${id}`);
                setSpecialist(res.data);
            } catch (err: any) {
                setError("Специалист не найден или страница удалена.");
            } finally {
                setIsLoading(false);
            }
        };
        fetchSpecialist();
    }, [id]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-unbox-dark"></div>
            </div>
        );
    }

    if (error || !specialist) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Упс!</h2>
                <p className="text-gray-600 mb-8">{error}</p>
                <Link to="/specialists">
                    <Button>Вернуться к списку</Button>
                </Link>
            </div>
        );
    }

    const hasOnline = specialist.formats.includes('ONLINE');
    const hasOfflineRoom = specialist.formats.includes('OFFLINE_ROOM');
    const hasOfflineCapsule = specialist.formats.includes('OFFLINE_CAPSULE');

    return (
        <div className="pt-24 pb-20 min-h-screen bg-gray-50/50">
            <div className="max-w-5xl mx-auto px-6">

                {/* Back Link */}
                <Link to="/specialists" className="inline-flex items-center text-gray-500 hover:text-unbox-dark mb-8 transition-colors">
                    <ArrowLeft size={20} className="mr-2" />
                    К списку специалистов
                </Link>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

                    {/* Left Column: Photo & Sticky Action Card */}
                    <div className="lg:col-span-4 lg:col-start-1">
                        <div className="sticky top-28">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="bg-white rounded-[2rem] p-4 shadow-sm border border-gray-100 mb-6"
                            >
                                <div className="aspect-[4/5] rounded-[1.5rem] overflow-hidden bg-gradient-to-br from-indigo-50 to-blue-50 relative mb-6">
                                    {specialist.photoUrl ? (
                                        <img
                                            src={specialist.photoUrl}
                                            alt={specialist.firstName}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-indigo-200">
                                            <span className="text-6xl font-light">{specialist.firstName[0]}</span>
                                        </div>
                                    )}
                                    <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm">
                                        <CheckCircle size={14} className="text-emerald-500" />
                                        <span className="text-xs font-semibold text-gray-700">Проверен Unbox</span>
                                    </div>
                                </div>

                                <div className="text-center px-2">
                                    <div className="text-3xl font-bold text-gray-900 mb-1">
                                        {specialist.basePriceGel} ₾ <span className="text-base font-normal text-gray-400">/ 55 мин</span>
                                    </div>
                                </div>
                            </motion.div>

                            {/* Booking CTA */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                            >
                                <Link to="/checkout" onClick={() => setStep(1)}>
                                    <Button size="lg" className="w-full h-14 text-lg rounded-2xl shadow-lg shadow-unbox-green/20 group">
                                        Записаться на сессию
                                        <Calendar className="ml-2 group-hover:scale-110 transition-transform" size={20} />
                                    </Button>
                                </Link>
                                <p className="text-center text-xs text-gray-400 mt-4 px-4 leading-relaxed">
                                    Вы будете перенаправлены в мастер бронирования пространств Unbox.
                                </p>
                            </motion.div>
                        </div>
                    </div>

                    {/* Right Column: Details */}
                    <div className="lg:col-span-8 lg:col-start-5 space-y-10">

                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-3 tracking-tight">
                                {specialist.firstName} {specialist.lastName}
                            </h1>
                            <p className="text-xl text-indigo-600 font-medium mb-8">
                                {specialist.tagline}
                            </p>

                            <div className="flex flex-wrap gap-2 mb-8">
                                {hasOnline && (
                                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">
                                        <Video size={16} /> Принимает онлайн
                                    </span>
                                )}
                                {(hasOfflineRoom || hasOfflineCapsule) && (
                                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium">
                                        <MapPin size={16} /> Принимает очно (Тбилиси)
                                    </span>
                                )}
                            </div>
                        </motion.div>

                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                            <h3 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                                С чем я работаю
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {specialist.specializations.map((spec, idx) => (
                                    <span key={idx} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium shadow-sm">
                                        {spec}
                                    </span>
                                ))}
                            </div>
                        </motion.div>

                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                            <h3 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                                Обо мне
                            </h3>
                            <Card className="p-6 sm:p-8 bg-white/50 backdrop-blur-sm shadow-sm border-gray-100">
                                <div className="prose prose-indigo max-w-none text-gray-600 leading-relaxed whitespace-pre-wrap">
                                    {specialist.bio || "Специалист пока не добавил описание о себе."}
                                </div>
                            </Card>
                        </motion.div>

                    </div>
                </div>

            </div>
        </div>
    );
}
