import { motion } from 'framer-motion';
import { MapPin } from 'lucide-react';
import { useLocations } from '../../hooks/useLocations';

export function CabinetsShowcaseSection() {
    const { data: locations = [] } = useLocations();

    if (locations.length === 0) return null;

    return (
        <section className="max-w-6xl mx-auto px-6 py-12">
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
                    {locations.map((loc, i) => (
                        <motion.div
                            key={loc.id}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            className="rounded-2xl overflow-hidden group"
                            style={{
                                background: 'rgba(255,255,255,0.55)',
                                backdropFilter: 'blur(20px) saturate(150%)',
                                WebkitBackdropFilter: 'blur(20px) saturate(150%)',
                                border: '1px solid rgba(255,255,255,0.65)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                            }}
                        >
                            {loc.image && (
                                <div className="aspect-video overflow-hidden">
                                    <img
                                        src={loc.image}
                                        alt={loc.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                    />
                                </div>
                            )}

                            <div className="p-5">
                                <div className="font-bold text-unbox-dark text-base mb-1">{loc.name}</div>
                                <div className="flex items-center gap-1.5 text-unbox-dark/45 text-xs mb-3">
                                    <MapPin size={11} />
                                    {loc.address}
                                </div>
                                {loc.features && loc.features.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {loc.features.slice(0, 4).map((f: string) => (
                                            <span
                                                key={f}
                                                className="text-[10px] px-2 py-0.5 rounded-full text-unbox-dark/50"
                                                style={{ background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.07)' }}
                                            >
                                                {f}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
