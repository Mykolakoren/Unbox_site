import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, Loader2, Filter, X } from 'lucide-react';
import { SpecialistCard } from '../components/Specialists/SpecialistCard';
import type { Specialist } from '../components/Specialists/SpecialistCard';
import { api } from '../api/client';
import { Layout } from '../components/Layout';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

const FORMAT_FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'ONLINE', label: 'Онлайн' },
    { key: 'OFFLINE_ROOM', label: 'Кабинет' },
    { key: 'OFFLINE_CAPSULE', label: 'Капсула' },
];

const glassPanel: React.CSSProperties = {
    background: 'rgba(255,255,255,0.88)',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
};

export function SpecialistsPage() {
    const gridHouse = useDesignFlag();
    const [specialists, setSpecialists] = useState<Specialist[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [formatFilter, setFormatFilter] = useState('all');

    useEffect(() => {
        const fetchSpecialists = async () => {
            try {
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
        // Format filter
        if (formatFilter !== 'all' && !s.formats.includes(formatFilter)) return false;
        // Search
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            s.firstName?.toLowerCase().includes(q) ||
            s.lastName?.toLowerCase().includes(q) ||
            s.tagline?.toLowerCase().includes(q) ||
            s.specializations?.some(spec => spec.toLowerCase().includes(q))
        );
    });

    if (gridHouse) return (
        <GridHouseSpecialistsPage
            specialists={specialists} filteredSpecialists={filteredSpecialists}
            isLoading={isLoading} error={error}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            formatFilter={formatFilter} setFormatFilter={setFormatFilter}
        />
    );

    return (
        <Layout>
            <div className="pb-20 min-h-screen">
                {/* Hero header */}
                <div className="relative overflow-hidden mb-10">
                    {/* Decorative background */}
                    <div className="absolute inset-0 dot-pattern-light opacity-40 pointer-events-none" />
                    <div className="absolute -top-20 -right-20 w-80 h-80 bg-unbox-green/5 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-10 -left-20 w-60 h-60 bg-unbox-accent/5 rounded-full blur-3xl pointer-events-none" />

                    <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-6">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="text-center max-w-2xl mx-auto mb-8"
                        >
                            <div className="inline-block px-5 py-2 rounded-2xl mb-4" style={glassPanel}>
                                <p className="text-unbox-green text-xs font-bold uppercase tracking-widest">Специалисты</p>
                            </div>
                            <h1 className="text-3xl md:text-4xl font-bold text-unbox-dark mb-3 tracking-tight">
                                Наши резиденты
                            </h1>
                            <p className="text-unbox-dark/60 text-base sm:text-lg leading-relaxed">
                                Найдите своего специалиста среди профессионалов, принимающих в пространствах Unbox или онлайн.
                            </p>
                        </motion.div>

                        {/* Search + Filters */}
                        <motion.div
                            initial={{ opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, delay: 0.15 }}
                            className="max-w-2xl mx-auto space-y-4"
                        >
                            {/* Search bar */}
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-unbox-grey/60" size={18} />
                                <input
                                    type="text"
                                    placeholder="Поиск по имени, запросу или методу..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-11 pr-10 py-3 rounded-2xl text-sm text-unbox-dark placeholder:text-unbox-grey/50 outline-none transition-all focus:ring-2 focus:ring-unbox-green/30"
                                    style={{
                                        background: 'rgba(255,255,255,0.82)',
                                        backdropFilter: 'blur(16px)',
                                        WebkitBackdropFilter: 'blur(16px)',
                                        border: '1px solid rgba(255,255,255,0.60)',
                                        boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                                    }}
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-unbox-light/60 text-unbox-grey/50 hover:text-unbox-dark transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                )}
                            </div>

                            {/* Format filter pills */}
                            <div className="flex items-center justify-center gap-2 flex-wrap">
                                <Filter size={14} className="text-unbox-grey/50 mr-1" />
                                {FORMAT_FILTERS.map(f => (
                                    <button
                                        key={f.key}
                                        onClick={() => setFormatFilter(f.key)}
                                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                                            formatFilter === f.key
                                                ? 'bg-unbox-dark text-white shadow-sm'
                                                : 'text-unbox-dark/70 hover:bg-white/70'
                                        }`}
                                        style={formatFilter !== f.key ? {
                                            background: 'rgba(255,255,255,0.45)',
                                            border: '1px solid rgba(255,255,255,0.50)',
                                        } : undefined}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    </div>
                </div>

                {/* Content */}
                <div className="max-w-7xl mx-auto px-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-24 text-unbox-grey">
                            <Loader2 className="animate-spin mb-4" size={28} />
                            <p className="text-sm">Загрузка специалистов...</p>
                        </div>
                    ) : error ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-red-600 p-6 rounded-2xl text-center max-w-lg mx-auto"
                            style={{ ...glassPanel, borderColor: 'rgba(239,68,68,0.15)' }}
                        >
                            {error}
                        </motion.div>
                    ) : filteredSpecialists.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-center py-20 rounded-3xl"
                            style={glassPanel}
                        >
                            <h3 className="text-lg font-bold text-unbox-dark mb-2">Ничего не найдено</h3>
                            <p className="text-unbox-grey text-sm">Попробуйте изменить параметры поиска</p>
                        </motion.div>
                    ) : (
                        <>
                            {/* Results count */}
                            <div className="mb-5">
                                <p className="text-xs text-unbox-grey/70 font-medium">
                                    {filteredSpecialists.length === specialists.length
                                        ? `${specialists.length} специалистов`
                                        : `${filteredSpecialists.length} из ${specialists.length}`
                                    }
                                </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                                {filteredSpecialists.map((specialist, index) => (
                                    <motion.div
                                        key={specialist.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.4, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                                    >
                                        <SpecialistCard specialist={specialist} />
                                    </motion.div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Layout>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Grid House — SpecialistsPage
   ═══════════════════════════════════════════════════════════════ */

const ghspMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghspHairline = `1px solid ${GH.ink10}`;

interface GridHouseSpecialistsPageProps {
    specialists: Specialist[];
    filteredSpecialists: Specialist[];
    isLoading: boolean;
    error: string | null;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    formatFilter: string;
    setFormatFilter: (f: string) => void;
}

function GridHouseSpecialistsPage({
    specialists, filteredSpecialists, isLoading, error,
    searchQuery, setSearchQuery, formatFilter, setFormatFilter,
}: GridHouseSpecialistsPageProps) {
    return (
        <Layout>
            <div style={{ fontFamily: GH_SANS, color: GH.ink, minHeight: '100vh', paddingBottom: 80 }}>
                {/* Header */}
                <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 0' }}>
                    <div style={{ ...ghspMono, color: GH.ink30, marginBottom: 8 }}>СПЕЦИАЛИСТЫ</div>
                    <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                        Наши резиденты
                    </h1>
                    <p style={{ fontSize: 15, color: GH.ink60, marginBottom: 24 }}>
                        Найдите своего специалиста среди профессионалов, принимающих в пространствах Unbox или онлайн.
                    </p>

                    {/* Search + filters */}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                        <div style={{ position: 'relative', flex: '1 1 300px' }}>
                            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: GH.ink30 }} />
                            <input
                                type="text"
                                placeholder="Поиск по имени, запросу или методу..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{
                                    width: '100%', padding: '10px 36px 10px 36px', fontSize: 14, fontFamily: GH_SANS,
                                    border: ghspHairline, background: 'transparent', color: GH.ink, outline: 'none',
                                }}
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: GH.ink30 }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                            {FORMAT_FILTERS.map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => setFormatFilter(f.key)}
                                    style={{
                                        padding: '8px 16px', fontSize: 12, fontWeight: 600, fontFamily: GH_SANS, cursor: 'pointer',
                                        border: formatFilter === f.key ? `1px solid ${GH.ink}` : ghspHairline,
                                        background: formatFilter === f.key ? GH.ink : 'transparent',
                                        color: formatFilter === f.key ? GH.paper : GH.ink60,
                                    }}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ ...ghspMono, color: GH.ink30 }}>
                            {filteredSpecialists.length === specialists.length
                                ? `${specialists.length} СПЕЦИАЛИСТОВ`
                                : `${filteredSpecialists.length} ИЗ ${specialists.length}`
                            }
                        </span>
                    </div>
                </div>

                {/* Content */}
                <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
                    {isLoading ? (
                        <div style={{ textAlign: 'center', padding: '80px 0', color: GH.ink30 }}>
                            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                            <p style={{ fontSize: 13 }}>Загрузка специалистов...</p>
                        </div>
                    ) : error ? (
                        <div style={{ textAlign: 'center', padding: '60px 0', color: GH.danger, fontSize: 14 }}>
                            {error}
                        </div>
                    ) : filteredSpecialists.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 0', color: GH.ink30 }}>
                            <p style={{ fontSize: 15, fontWeight: 600 }}>Ничего не найдено</p>
                            <p style={{ fontSize: 13, color: GH.ink30 }}>Попробуйте изменить параметры поиска</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
                            {filteredSpecialists.map(specialist => (
                                <SpecialistCard key={specialist.id} specialist={specialist} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <footer style={{ maxWidth: 1200, margin: '0 auto', borderTop: `2px solid ${GH.ink}`, padding: '16px 24px', marginTop: 64, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ ...ghspMono, color: GH.ink30 }}>UNBOX · 2026</span>
                    <span style={{ ...ghspMono, color: GH.ink10 }}>GRID HOUSE</span>
                </footer>
            </div>
        </Layout>
    );
}
