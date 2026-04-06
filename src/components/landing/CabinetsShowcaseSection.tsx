import { motion } from 'framer-motion';
import { MapPin, ArrowRight, Wifi, Coffee, Shield, Volume2, Users, Armchair } from 'lucide-react';
import { useLocations } from '../../hooks/useLocations';
import { useBookingStore } from '../../store/bookingStore';
import { Link } from 'react-router-dom';

// Location-specific data for rich showcase cards
const LOCATION_META: Record<string, {
    photos: string[];
    tagline: string;
    description: string;
    highlights: { icon: typeof Wifi; label: string }[];
}> = {
    unbox_uni: {
        photos: [
            '/img/offices/cabinet_5_ira.jpg',
            '/img/offices/cabinet_6_ira.jpg',
            '/img/offices/cabinet_7_liza.webp',
            '/img/offices/cabinet_8_liza.webp',
        ],
        tagline: 'Основная локация',
        description: 'Просторные кабинеты и уютные капсулы для индивидуальной и групповой работы. Тихий район, панорамные окна, естественный свет.',
        highlights: [
            { icon: Armchair, label: 'Просторные кабинеты' },
            { icon: Shield, label: 'Звукоизоляция' },
            { icon: Coffee, label: 'Кухня и зона отдыха' },
            { icon: Wifi, label: 'Скоростной Wi-Fi' },
        ],
    },
    unbox_one: {
        photos: [
            '/img/offices/miniature_cab_1_pal.jpg',
            '/img/offices/miniature_cab_2_pal.jpg',
        ],
        tagline: 'Камерная локация',
        description: 'Компактное и уютное пространство в центре города. Идеально для индивидуальных консультаций в тихой обстановке.',
        highlights: [
            { icon: Volume2, label: 'Звукоизоляция' },
            { icon: Wifi, label: 'Wi-Fi' },
            { icon: Coffee, label: 'Кухня' },
        ],
    },
    neo_school: {
        photos: [],
        tagline: 'Партнёрская площадка',
        description: 'Большие аудитории для мероприятий, тренингов и групповых занятий.',
        highlights: [
            { icon: Users, label: 'Большие аудитории' },
        ],
    },
};

const LOCATION_ORDER: Record<string, number> = { unbox_uni: 0, unbox_one: 1, neo_school: 2 };

export function CabinetsShowcaseSection() {
    const { data: locations = [] } = useLocations();
    const resources = useBookingStore(s => s.resources);

    if (locations.length === 0) return null;

    const sorted = [...locations].sort((a, b) => (LOCATION_ORDER[a.id] ?? 99) - (LOCATION_ORDER[b.id] ?? 99));
    // Main locations (with photos) and secondary (neo_school)
    const mainLocations = sorted.filter(l => LOCATION_META[l.id]?.photos.length > 0);
    const secondaryLocations = sorted.filter(l => !LOCATION_META[l.id]?.photos.length);

    return (
        <section id="locations" className="max-w-6xl mx-auto px-6 py-12">
            <div className="border-t border-black/10 pt-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-10"
                >
                    <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Локации</p>
                    <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark">Наши пространства</h2>
                    <p className="mt-2 text-unbox-dark/50 text-sm">Кабинеты и капсулы в двух локациях Батуми</p>
                </motion.div>

                {/* Main location cards — full showcase */}
                <div className="flex flex-col gap-6">
                    {mainLocations.map((loc, i) => {
                        const meta = LOCATION_META[loc.id];
                        const photos = meta?.photos || [];
                        const locResources = resources.filter(r => r.locationId === loc.id && r.isActive !== false);
                        const cabinetCount = locResources.filter(r => r.type === 'cabinet').length;
                        const capsuleCount = locResources.filter(r => r.type === 'capsule').length;

                        return (
                            <motion.div
                                key={loc.id}
                                initial={{ opacity: 0, y: 24 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.12 }}
                            >
                                <Link
                                    to={`/location/${loc.id}`}
                                    className="block rounded-3xl overflow-hidden group cursor-pointer no-underline"
                                    style={{
                                        background: 'rgba(255,255,255,0.82)',
                                        backdropFilter: 'blur(24px) saturate(150%)',
                                        WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                                        border: '1px solid rgba(255,255,255,0.70)',
                                        boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.03)',
                                    }}
                                >
                                    {/* Photo gallery — hero style */}
                                    <div className="grid grid-cols-4 gap-1 h-56 sm:h-72 overflow-hidden">
                                        {/* Main photo — takes 2 columns */}
                                        <div className="col-span-2 relative overflow-hidden">
                                            <img
                                                src={photos[0]}
                                                alt={loc.name}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                            />
                                            {/* Gradient overlay with tagline */}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                                            <div className="absolute bottom-3 left-3">
                                                <span className="text-white/80 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                                                    style={{ background: 'rgba(71,109,107,0.70)', backdropFilter: 'blur(8px)' }}>
                                                    {meta?.tagline}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Secondary photos */}
                                        <div className={`col-span-2 grid ${photos.length > 2 ? 'grid-rows-2' : ''} gap-1`}>
                                            {photos.slice(1, 3).map((photo, pi) => (
                                                <div key={pi} className={`relative overflow-hidden ${photos.length === 2 ? 'row-span-1' : ''}`}>
                                                    <img
                                                        src={photo}
                                                        alt=""
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                                    />
                                                    {/* "+N" overlay on last visible photo */}
                                                    {pi === 1 && photos.length > 3 && (
                                                        <div className="absolute inset-0 bg-black/35 flex items-center justify-center backdrop-blur-[1px]">
                                                            <span className="text-white text-sm font-bold">+{photos.length - 3} фото</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            {/* If only 2 photos total, second one fills the space */}
                                            {photos.length === 2 && (
                                                <div className="overflow-hidden">
                                                    <img
                                                        src={photos[1]}
                                                        alt=""
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Content area */}
                                    <div className="p-6 sm:p-7">
                                        {/* Header row */}
                                        <div className="flex items-start justify-between gap-4 mb-3">
                                            <div>
                                                <h3 className="font-bold text-unbox-dark text-xl mb-1">{loc.name}</h3>
                                                <div className="flex items-center gap-1.5 text-unbox-dark/45 text-xs">
                                                    <MapPin size={12} />
                                                    {loc.address}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 text-unbox-green text-sm font-semibold opacity-0 group-hover:opacity-100 translate-x-[-8px] group-hover:translate-x-0 transition-all duration-300 shrink-0 mt-1">
                                                Подробнее <ArrowRight size={16} />
                                            </div>
                                        </div>

                                        {/* Description */}
                                        <p className="text-unbox-dark/55 text-sm leading-relaxed mb-4 max-w-xl">
                                            {meta?.description || loc.description}
                                        </p>

                                        {/* Highlights + counts */}
                                        <div className="flex flex-wrap gap-2">
                                            {/* Resource counts */}
                                            {cabinetCount > 0 && (
                                                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium text-unbox-dark/65"
                                                    style={{ background: 'rgba(71,109,107,0.08)', border: '1px solid rgba(71,109,107,0.16)' }}>
                                                    <Armchair size={12} className="text-unbox-green" />
                                                    {cabinetCount} {cabinetCount === 1 ? 'кабинет' : cabinetCount < 5 ? 'кабинета' : 'кабинетов'}
                                                </span>
                                            )}
                                            {capsuleCount > 0 && (
                                                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium text-unbox-dark/65"
                                                    style={{ background: 'rgba(71,109,107,0.08)', border: '1px solid rgba(71,109,107,0.16)' }}>
                                                    {capsuleCount} {capsuleCount === 1 ? 'капсула' : 'капсулы'}
                                                </span>
                                            )}
                                            {/* Feature highlights */}
                                            {meta?.highlights.map(h => {
                                                const Icon = h.icon;
                                                return (
                                                    <span key={h.label}
                                                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium text-unbox-dark/55"
                                                        style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}>
                                                        <Icon size={12} className="text-unbox-dark/40" />
                                                        {h.label}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </Link>
                            </motion.div>
                        );
                    })}
                </div>

                {/* Secondary locations — compact */}
                {secondaryLocations.length > 0 && (
                    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {secondaryLocations.map(loc => {
                            const meta = LOCATION_META[loc.id];
                            return (
                                <motion.div
                                    key={loc.id}
                                    initial={{ opacity: 0, y: 16 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                >
                                    <Link
                                        to={`/location/${loc.id}`}
                                        className="flex items-center gap-4 p-5 rounded-2xl group cursor-pointer no-underline transition-shadow hover:shadow-md"
                                        style={{
                                            background: 'rgba(255,255,255,0.75)',
                                            backdropFilter: 'blur(20px)',
                                            WebkitBackdropFilter: 'blur(20px)',
                                            border: '1px solid rgba(255,255,255,0.60)',
                                            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                                        }}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-unbox-dark text-sm mb-0.5">{loc.name}</div>
                                            <div className="flex items-center gap-1 text-unbox-dark/40 text-xs mb-2">
                                                <MapPin size={10} />
                                                {loc.address}
                                            </div>
                                            <p className="text-unbox-dark/50 text-xs leading-relaxed">{meta?.description}</p>
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {meta?.highlights.map(h => (
                                                    <span key={h.label} className="text-[10px] px-2 py-0.5 rounded-lg text-unbox-dark/50 font-medium"
                                                        style={{ background: 'rgba(0,0,0,0.05)' }}>
                                                        {h.label}
                                                    </span>
                                                ))}
                                                {loc.features?.slice(0, 2).map((f: string) => (
                                                    <span key={f} className="text-[10px] px-2 py-0.5 rounded-lg text-unbox-dark/50 font-medium"
                                                        style={{ background: 'rgba(0,0,0,0.05)' }}>
                                                        {f}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <ArrowRight size={16} className="text-unbox-green/40 group-hover:text-unbox-green shrink-0 transition-colors" />
                                    </Link>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
}
