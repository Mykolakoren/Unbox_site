import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, User, Video, MapPin } from 'lucide-react';
import { api } from '../api/client';
import type { Specialist } from './Specialists/SpecialistCard';

const FORMAT_LABEL: Record<string, string> = {
    ONLINE: 'Онлайн',
    OFFLINE_ROOM: 'Оффлайн',
    OFFLINE_CAPSULE: 'Капсула',
};

const FORMAT_ICON: Record<string, React.FC<{ size: number; className?: string }>> = {
    ONLINE: ({ size, className }) => <Video size={size} className={className} />,
    OFFLINE_ROOM: ({ size, className }) => <MapPin size={size} className={className} />,
    OFFLINE_CAPSULE: ({ size, className }) => <MapPin size={size} className={className} />,
};

const CATEGORY_LABELS: Record<string, string> = {
    psychology: 'Психологи и психотерапевты',
    psychiatry: 'Психиатры',
    narcology: 'Наркология / Неврология',
    coaching: 'Коучи и консультанты',
    education: 'Игропрактики / Педагоги',
};

interface Props {
    categoryFilter?: string | null;
}

export function SpecialistsSection({ categoryFilter }: Props) {
    const [specialists, setSpecialists] = useState<Specialist[]>([]);

    useEffect(() => {
        const params = categoryFilter ? `?category=${categoryFilter}` : '';
        api.get(`/specialists${params}`).then(r => setSpecialists(r.data.slice(0, 8))).catch(() => {});
    }, [categoryFilter]);

    if (specialists.length === 0) return null;

    return (
        <section id="specialists" className="max-w-6xl mx-auto px-6 pt-10 pb-12">
            {/* Heading */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="flex items-end justify-between mb-8"
            >
                <div>
                    <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Резиденты</p>
                    <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark leading-tight">
                        {categoryFilter && CATEGORY_LABELS[categoryFilter]
                            ? CATEGORY_LABELS[categoryFilter]
                            : 'Наши специалисты'}
                    </h2>
                    <p className="mt-1.5 text-unbox-dark/55 max-w-xl text-sm">
                        Профессионалы, которые принимают в пространствах Unbox
                    </p>
                </div>
                <Link
                    to="/specialists"
                    className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-unbox-dark/60 hover:text-unbox-dark transition-colors shrink-0"
                    style={{
                        background: 'rgba(255,255,255,0.55)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        border: '1px solid rgba(255,255,255,0.65)',
                    }}
                >
                    Все специалисты
                    <ArrowRight size={14} />
                </Link>
            </motion.div>

            {/* Cards grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {specialists.map((s, i) => (
                    <motion.div
                        key={s.id}
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: i * 0.06 }}
                    >
                        <Link
                            to={`/specialists/${s.id}`}
                            className="group flex flex-col rounded-2xl overflow-hidden h-full"
                            style={{
                                background: 'rgba(255,255,255,0.55)',
                                backdropFilter: 'blur(20px) saturate(150%)',
                                WebkitBackdropFilter: 'blur(20px) saturate(150%)',
                                border: '1px solid rgba(255,255,255,0.65)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
                            }}
                        >
                            {/* Photo */}
                            <div className="relative aspect-square overflow-hidden">
                                {s.photoUrl ? (
                                    <img
                                        src={s.photoUrl}
                                        alt={`${s.firstName} ${s.lastName}`}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                    />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-unbox-green/20 to-unbox-dark/20 flex items-center justify-center">
                                        <User size={40} className="text-unbox-dark/20" strokeWidth={1.5} />
                                    </div>
                                )}
                                {/* Price badge */}
                                <div
                                    className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full text-xs font-bold text-unbox-dark"
                                    style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(6px)' }}
                                >
                                    от {s.basePriceGel} ₾
                                </div>
                                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                            </div>

                            {/* Info */}
                            <div className="p-3.5 flex-1 flex flex-col gap-1.5">
                                <div className="font-bold text-unbox-dark text-sm leading-tight">
                                    {s.firstName} {s.lastName}
                                </div>
                                <div className="text-unbox-dark/50 text-xs line-clamp-2 leading-relaxed">
                                    {s.tagline}
                                </div>

                                {s.formats && s.formats.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-auto pt-1.5">
                                        {s.formats.slice(0, 2).map(fmt => {
                                            const Icon = FORMAT_ICON[fmt];
                                            return (
                                                <span
                                                    key={fmt}
                                                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-unbox-dark/50"
                                                    style={{ background: 'rgba(0,0,0,0.06)' }}
                                                >
                                                    {Icon && <Icon size={9} />}
                                                    {FORMAT_LABEL[fmt] ?? fmt}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </Link>
                    </motion.div>
                ))}
            </div>

            {/* Mobile CTA */}
            <div className="mt-6 flex justify-center sm:hidden">
                <Link
                    to="/specialists"
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-unbox-dark/70 hover:text-unbox-dark transition-colors"
                    style={{
                        background: 'rgba(255,255,255,0.55)',
                        border: '1px solid rgba(255,255,255,0.65)',
                    }}
                >
                    Все специалисты
                    <ArrowRight size={14} />
                </Link>
            </div>

            <div className="mt-12 border-b border-black/10" />
        </section>
    );
}
