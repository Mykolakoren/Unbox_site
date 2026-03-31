import { motion } from 'framer-motion';
import { MapPin, ArrowRight } from 'lucide-react';
import { useLocations } from '../../hooks/useLocations';
import { useBookingStore } from '../../store/bookingStore';
import { Link } from 'react-router-dom';

// Map of location ID → representative cabinet photos
const LOCATION_PHOTOS: Record<string, string[]> = {
    unbox_one: ['/img/offices/miniature_cab_1_pal.jpg', '/img/offices/miniature_cab_2_pal.jpg'],
    unbox_uni: ['/img/offices/cabinet_5_ira.jpg', '/img/offices/cabinet_6_ira.jpg', '/img/offices/cabinet_7_liza.webp', '/img/offices/cabinet_8_liza.webp'],
};

export function CabinetsShowcaseSection() {
    const { data: locations = [] } = useLocations();
    const resources = useBookingStore(s => s.resources);

    if (locations.length === 0) return null;

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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {locations.map((loc, i) => {
                        const photos = LOCATION_PHOTOS[loc.id] || [];
                        const locResources = resources.filter(r => r.locationId === loc.id && r.isActive !== false);
                        const cabinetCount = locResources.filter(r => r.type === 'cabinet').length;
                        const capsuleCount = locResources.filter(r => r.type === 'capsule').length;

                        return (
                            <motion.div
                                key={loc.id}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                            >
                                <Link
                                    to={`/locations/${loc.id}`}
                                    className="block rounded-2xl overflow-hidden group cursor-pointer no-underline"
                                    style={{
                                        background: 'rgba(255,255,255,0.55)',
                                        backdropFilter: 'blur(20px) saturate(150%)',
                                        WebkitBackdropFilter: 'blur(20px) saturate(150%)',
                                        border: '1px solid rgba(255,255,255,0.65)',
                                        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                                    }}
                                >
                                    {/* Photo mosaic */}
                                    {photos.length > 0 && (
                                        <div className="grid grid-cols-2 gap-0.5 h-48 overflow-hidden">
                                            {photos.length === 1 ? (
                                                <div className="col-span-2">
                                                    <img src={photos[0]} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                                </div>
                                            ) : photos.length === 2 ? (
                                                <>
                                                    <img src={photos[0]} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                                    <img src={photos[1]} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                                </>
                                            ) : (
                                                <>
                                                    <img src={photos[0]} alt="" className="w-full h-full object-cover row-span-2 group-hover:scale-105 transition-transform duration-700" />
                                                    <div className="grid grid-rows-2 gap-0.5">
                                                        <img src={photos[1]} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                                        <div className="relative">
                                                            <img src={photos[2]} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                                            {photos.length > 3 && (
                                                                <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-white text-xs font-bold">
                                                                    +{photos.length - 3}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* No photos fallback */}
                                    {photos.length === 0 && loc.image && (
                                        <div className="aspect-video overflow-hidden">
                                            <img src={loc.image} alt={loc.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                        </div>
                                    )}

                                    <div className="p-5">
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="font-bold text-unbox-dark text-base">{loc.name}</div>
                                            <ArrowRight size={16} className="text-unbox-green opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300" />
                                        </div>
                                        <div className="flex items-center gap-1.5 text-unbox-dark/45 text-xs mb-3">
                                            <MapPin size={11} />
                                            {loc.address}
                                        </div>

                                        {/* Resource counts */}
                                        <div className="flex flex-wrap gap-1.5">
                                            {cabinetCount > 0 && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full text-unbox-dark/60 font-medium"
                                                    style={{ background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.07)' }}>
                                                    {cabinetCount} {cabinetCount === 1 ? 'кабинет' : cabinetCount < 5 ? 'кабинета' : 'кабинетов'}
                                                </span>
                                            )}
                                            {capsuleCount > 0 && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full text-unbox-dark/60 font-medium"
                                                    style={{ background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.07)' }}>
                                                    {capsuleCount} {capsuleCount === 1 ? 'капсула' : 'капсулы'}
                                                </span>
                                            )}
                                            {loc.features && loc.features.slice(0, 3).map((f: string) => (
                                                <span key={f} className="text-[10px] px-2 py-0.5 rounded-full text-unbox-dark/50"
                                                    style={{ background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.07)' }}>
                                                    {f}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </Link>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
