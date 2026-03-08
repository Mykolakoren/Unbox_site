import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, Loader2 } from 'lucide-react';
import { SpecialistCard } from '../components/Specialists/SpecialistCard';
import type { Specialist } from '../components/Specialists/SpecialistCard';
import { api } from '../api/client';
import { Layout } from '../components/Layout';

export function SpecialistsPage() {
    const [specialists, setSpecialists] = useState<Specialist[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const fetchSpecialists = async () => {
            try {
                // Fetch public specialists list
                const res = await api.get('/specialists');
                setSpecialists(res.data);
            } catch (err: any) {
                console.error("Failed to fetch specialists:", err);
                setError(err.response?.data?.detail || "Не удалось загрузить список специалистов.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchSpecialists();
    }, []);

    const filteredSpecialists = specialists.filter(s => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            s.firstName?.toLowerCase().includes(q) ||
            s.lastName?.toLowerCase().includes(q) ||
            s.tagline?.toLowerCase().includes(q) ||
            s.specializations?.some(spec => spec.toLowerCase().includes(q))
        );
    });

    return (
        <Layout>
            <div className="pb-16 min-h-screen">
                <div className="max-w-7xl mx-auto px-6">

                    {/* Header */}
                    <div className="mb-10 text-center max-w-2xl mx-auto">
                        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 tracking-tight">Наши резиденты</h1>
                        <p className="text-gray-600 text-lg">
                            Найдите своего специалиста среди профессионалов, принимающих в пространствах Unbox или онлайн.
                        </p>
                    </div>

                    {/* Filters / Search Bar (Simplified MVP) */}
                    <div className="mb-10 max-w-xl mx-auto">
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="text"
                                placeholder="Поиск по имени, запросу или методу..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-unbox-dark outline-none transition-all placeholder:text-gray-400"
                            />
                        </div>
                    </div>

                    {/* Content */}
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                            <Loader2 className="animate-spin mb-4" size={32} />
                            <p>Загрузка специалистов...</p>
                        </div>
                    ) : error ? (
                        <div className="bg-red-50 text-red-600 p-6 rounded-2xl text-center max-w-lg mx-auto border border-red-100">
                            {error}
                        </div>
                    ) : filteredSpecialists.length === 0 ? (
                        <div className="text-center py-20 bg-white rounded-3xl border border-gray-100 shadow-sm">
                            <h3 className="text-xl font-bold text-gray-800 mb-2">Ничего не найдено</h3>
                            <p className="text-gray-500">Попробуйте изменить параметры поиска</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredSpecialists.map((specialist, index) => (
                                <motion.div
                                    key={specialist.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4, delay: index * 0.05 }}
                                >
                                    <SpecialistCard specialist={specialist} />
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
}
